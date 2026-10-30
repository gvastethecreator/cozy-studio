import { Effect } from 'effect';
import {
  providerOperation,
  providerBody,
  type ProviderEffect,
  type ProviderSleep,
} from './providerEffect';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { TurnResult } from '../codex/turn';
import { resolveLibraryPath } from '../library';
import type {
  ExternalProviderExecutionContext,
  ExternalProviderExecutor,
} from './externalProvider';
import type { HostedImageApiCompiledPayload } from './externalProviderInputs';
import {
  fetchExternalProviderWithRetry,
  isRecord,
  responseSnippet,
  storeInlineImageResult,
  type ExternalProviderFetch,
} from './externalProviderResults';
import { DEFAULT_OPENAI_IMAGE_MODEL } from './providerExecutionDefaults';

export interface OpenaiImagesExecutorDependencies {
  env?: Record<string, string | undefined>;
  fetch?: ExternalProviderFetch;
  resolveLibraryPath?: typeof resolveLibraryPath;
  mkdir?: typeof mkdirSync;
  writeFile?: typeof writeFileSync;
  now?: () => number;
  sleep?: ProviderSleep;
  maxAttempts?: number;
  retryDelayMs?: number;
}

const OPENAI_IMAGES_ENDPOINT = 'https://api.openai.com/v1/images/generations';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 750;

function asOpenaiPayload(value: unknown): HostedImageApiCompiledPayload {
  if (!isRecord(value) || value.apiFamily !== 'openai_image' || typeof value.prompt !== 'string') {
    throw new Error('Compiled OpenAI Images Provider Input payload is invalid.');
  }
  return value as unknown as HostedImageApiCompiledPayload;
}

/** GPT Image models accept three fixed sizes; pick the one matching the requested orientation. */
function openaiImageSize(aspectRatio: string | null) {
  const [width, height] = (aspectRatio ?? '').split(':').map(Number);
  if (!width || !height) return null;
  if (width > height) return '1536x1024';
  if (width < height) return '1024x1536';
  return '1024x1024';
}

export function createOpenaiImagesExecutor({
  env = process.env,
  fetch: fetchFn = fetch,
  resolveLibraryPath: resolveLibrary = resolveLibraryPath,
  mkdir = mkdirSync,
  writeFile = writeFileSync,
  now = () => Date.now(),
  sleep = (durationMs) => Effect.sleep(durationMs),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: OpenaiImagesExecutorDependencies = {}): ExternalProviderExecutor {
  return function executeOpenaiImagesJob({
    providerId,
    job,
    compiledInput,
  }: ExternalProviderExecutionContext): ProviderEffect<TurnResult> {
    return providerOperation(
      Effect.gen(function* () {
        if (providerId !== 'openai' || compiledInput.providerId !== 'openai') {
          throw new Error(`OpenAI Images executor received provider "${providerId}".`);
        }
        const payload = asOpenaiPayload(compiledInput.payload);
        if (payload.assets.length > 0) {
          throw new Error('The OpenAI Images adapter supports text-to-image only.');
        }
        const apiKey = env.OPENAI_API_KEY?.trim();
        if (!apiKey) throw new Error('Missing Provider Secret source: OPENAI_API_KEY.');

        const startedAt = now();
        const model =
          payload.model?.trim() || env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
        const size = openaiImageSize(payload.output.aspectRatio);
        const requestBody = { model, prompt: payload.prompt, ...(size ? { size } : {}) };
        const { response, attempts: requestAttempts } = yield* fetchExternalProviderWithRetry({
          label: 'OpenAI Images request',
          fetch: fetchFn,
          input: OPENAI_IMAGES_ENDPOINT,
          init: {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: job.signal,
          },
          maxAttempts,
          retryDelayMs,
          sleep,
        });

        if (!response.ok) {
          const body = yield* providerBody(() => response.text().catch(() => ''));
          throw new Error(
            `OpenAI Images request failed after ${requestAttempts} attempt(s): ${response.status} ${response.statusText}${body ? ` ${responseSnippet(body, [apiKey])}` : ''}`,
          );
        }

        const json: unknown = yield* providerBody(() => response.json());
        const first = isRecord(json) && Array.isArray(json.data) ? json.data[0] : null;
        if (!isRecord(first) || typeof first.b64_json !== 'string') {
          throw new Error('OpenAI Images response did not include image data.');
        }

        return yield* storeInlineImageResult({
          providerId: 'openai',
          providerSlug: 'openai',
          model,
          endpointBase: OPENAI_IMAGES_ENDPOINT,
          job,
          compiledInput,
          responseJson: json,
          image: { data: first.b64_json, mimeType: null },
          requestAttempts,
          startedAt,
          diagnostics: { requestFieldNames: Object.keys(requestBody).sort() },
          files: { resolveLibraryPath: resolveLibrary, mkdir, writeFile, now },
        });
      }),
    );
  };
}
