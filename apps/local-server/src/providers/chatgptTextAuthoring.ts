import { Effect, Result } from 'effect';
import type {
  StyleAuthoringCapabilities,
  StyleAuthoringRequest,
  StyleAuthoringResult,
} from '../../../../packages/shared/src/styleAuthoring';
import { STYLE_AUTHORING_MAX_OUTPUT_CHARS } from '../../../../packages/shared/src/styleAuthoring';
import {
  CODEX_RESPONSES_BASE_URL,
  studioCodexOriginator,
  studioUserAgent,
} from '../auth/constants';
import { readChatgptAccountId } from '../auth/jwt';
import { getUsableAccessToken, invalidateStoredAccessToken } from '../auth/tokens';
import { consumeSseJson } from './subscriptionSse';
import { providerFetch, providerOperation, providerTimeout } from './providerEffect';
import {
  isRecord,
  readResponseTextLimited,
  responseSnippet,
  type ExternalProviderFetch,
} from './externalProviderResults';
import { SubscriptionHttpError } from './subscriptionHttpError';

interface ChatgptTextAuthoringDependencies {
  fetch?: ExternalProviderFetch;
  getAccessToken?: () => Promise<string>;
  invalidateAccessToken?: (message: string) => void;
  now?: () => number;
  requestTimeoutMs?: number;
}

function failure(message: string, code: SubscriptionHttpError['code'], httpStatus?: number) {
  return new SubscriptionHttpError(message, { code, httpStatus, fallbackAllowed: false });
}

export function createChatgptTextAuthoring({
  fetch: fetchImpl = fetch,
  getAccessToken = () => getUsableAccessToken('codex'),
  invalidateAccessToken = (message) => invalidateStoredAccessToken('codex', message),
  now = Date.now,
  requestTimeoutMs = 120_000,
}: ChatgptTextAuthoringDependencies = {}) {
  let cache: {
    token: string;
    model: string;
    expiresAt: number;
    result: Promise<StyleAuthoringCapabilities>;
  } | null = null;

  async function execute(
    input: StyleAuthoringRequest,
    model: string,
    signal: AbortSignal,
    token: string,
    timeout: number,
  ): Promise<StyleAuthoringResult> {
    signal.throwIfAborted();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'User-Agent': studioUserAgent(),
      originator: studioCodexOriginator(),
    };
    const accountId = readChatgptAccountId(token);
    if (accountId) headers['ChatGPT-Account-ID'] = accountId;
    const operation = providerOperation(
      Effect.gen(function* () {
        const response = yield* providerFetch(fetchImpl, `${CODEX_RESPONSES_BASE_URL}/responses`, {
          method: 'POST',
          headers,
          redirect: 'error',
          signal,
          body: JSON.stringify({
            model,
            store: false,
            stream: true,
            instructions: input.instructions,
            input: [
              {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: input.prompt }],
              },
            ],
            tools: [],
            ...(input.schema
              ? {
                  text: {
                    format: {
                      type: 'json_schema',
                      name: 'style_authoring',
                      strict: true,
                      schema: input.schema,
                    },
                  },
                }
              : {}),
          }),
        });
        if (!response.ok) {
          const detail = responseSnippet(yield* readResponseTextLimited(response, 16 * 1024), [
            token,
          ]);
          if (response.status === 401) {
            const message = 'ChatGPT session was rejected. Sign in again in Studio Settings.';
            invalidateAccessToken(message);
            throw failure(message, 'invalid_grant', 401);
          }
          throw failure(
            `ChatGPT text request failed (${response.status}): ${detail}`,
            response.status === 429
              ? 'rate_limit'
              : response.status === 403
                ? 'entitlement_denied'
                : 'http_error',
            response.status,
          );
        }
        if (!response.body)
          throw failure('ChatGPT returned no text event stream.', 'empty_response');
        let text = '';
        let completed = false;
        yield* consumeSseJson(
          response.body,
          (event) => {
            if (!isRecord(event)) return;
            if (
              event.type === 'error' ||
              event.type === 'response.failed' ||
              event.type === 'response.incomplete'
            ) {
              const response = isRecord(event.response) ? event.response : event;
              const error = isRecord(response.error) ? response.error : response;
              const providerCode = typeof error.code === 'string' ? error.code : '';
              const code = ['invalid_token', 'invalid_grant', 'token_expired'].includes(
                providerCode,
              )
                ? 'invalid_grant'
                : ['usage_limit_reached', 'insufficient_quota', 'quota_exceeded'].includes(
                      providerCode,
                    )
                  ? 'source_limit'
                  : ['rate_limit_exceeded', 'rate_limit_error'].includes(providerCode)
                    ? 'rate_limit'
                    : 'http_error';
              const message = `ChatGPT text request failed: ${responseSnippet(typeof error.message === 'string' ? error.message : String(event.type), [token])}`;
              if (code === 'invalid_grant')
                invalidateAccessToken(
                  'ChatGPT session was rejected. Sign in again in Studio Settings.',
                );
              throw failure(message, code);
            }
            if (event.type === 'response.output_text.delta' && typeof event.delta === 'string')
              text += event.delta;
            if (
              event.type === 'response.output_text.done' &&
              !text &&
              typeof event.text === 'string'
            )
              text = event.text;
            if (event.type === 'response.completed') {
              const response = isRecord(event.response) ? event.response : null;
              if (response && Array.isArray(response.output)) {
                const finalText = response.output
                  .flatMap((item: unknown) =>
                    isRecord(item) && item.type === 'message' && Array.isArray(item.content)
                      ? item.content.flatMap((part: unknown) =>
                          isRecord(part) &&
                          part.type === 'output_text' &&
                          typeof part.text === 'string'
                            ? [part.text]
                            : [],
                        )
                      : [],
                  )
                  .join('');
                if (finalText) text = finalText;
              }
              completed = true;
            }
            if (text.length > STYLE_AUTHORING_MAX_OUTPUT_CHARS)
              throw failure('ChatGPT text response exceeded the size limit.', 'invalid_request');
          },
          STYLE_AUTHORING_MAX_OUTPUT_CHARS * 2,
        );
        if (!completed || !text.trim())
          throw failure('ChatGPT returned no completed text response.', 'empty_response');
        return { text };
      }),
    );
    try {
      const result = await Effect.runPromise(
        Effect.scoped(operation).pipe(providerTimeout(timeout), Effect.result),
        { signal },
      );
      return Result.getOrThrowWith(result, (error) => error);
    } catch (error) {
      if (signal.aborted) throw failure('Style authoring was cancelled.', 'cancelled');
      if (error instanceof SubscriptionHttpError) throw error;
      if (error instanceof Error && error.name === 'TimeoutError')
        throw failure('ChatGPT text request timed out.', 'timeout');
      throw failure(
        `ChatGPT text request failed: ${responseSnippet(error instanceof Error ? error.message : '', [token])}`,
        'http_error',
      );
    }
  }

  return {
    async propose(input: StyleAuthoringRequest, model: string, signal: AbortSignal) {
      signal.throwIfAborted();
      const token = await getAccessToken();
      return execute(input, model, signal, token, requestTimeoutMs);
    },
    async capabilities(model: string, signal: AbortSignal): Promise<StyleAuthoringCapabilities> {
      signal.throwIfAborted();
      try {
        const token = await getAccessToken();
        signal.throwIfAborted();
        if (cache?.model === model && cache.token === token && cache.expiresAt > now()) {
          const cached = cache.result;
          return await Effect.runPromise(
            Effect.promise(() => cached),
            { signal },
          );
        }
        const result = (async (): Promise<StyleAuthoringCapabilities> => {
          try {
            const { text } = await execute(
              {
                instructions: 'Return only the requested JSON.',
                prompt: 'Return {"ok":true}.',
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' } },
                  required: ['ok'],
                  additionalProperties: false,
                },
              },
              model,
              signal,
              token,
              Math.min(requestTimeoutMs, 20_000),
            );
            if (JSON.parse(text).ok !== true)
              throw failure(
                'ChatGPT text capability probe returned an invalid response.',
                'empty_response',
              );
            return { available: true, reason: null };
          } catch (error) {
            if (signal.aborted) throw failure('Style authoring was cancelled.', 'cancelled');
            return {
              available: false,
              reason:
                error instanceof SubscriptionHttpError
                  ? error.message
                  : 'ChatGPT text capability probe returned invalid JSON.',
            };
          }
        })();
        const entry = { token, model, expiresAt: now() + 5 * 60_000, result };
        cache = entry;
        const capability = await result;
        if (!capability.available) entry.expiresAt = now() + 60_000;
        return capability;
      } catch (error) {
        if (signal.aborted) throw failure('Style authoring was cancelled.', 'cancelled');
        cache = null;
        return {
          available: false,
          reason:
            error instanceof SubscriptionHttpError
              ? error.message
              : 'ChatGPT text authoring could not be verified. Sign in in Studio Settings.',
        };
      }
    },
  };
}
