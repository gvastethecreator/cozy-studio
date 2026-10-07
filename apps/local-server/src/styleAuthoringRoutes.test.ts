import { describe, expect, it, vi } from 'vitest';
import { createStyleAuthoringRoutes } from './styleAuthoringRoutes';
import { createChatgptTextAuthoring } from './providers/chatgptTextAuthoring';
import { SubscriptionHttpError } from './providers/subscriptionHttpError';
import {
  STYLE_AUTHORING_MAX_OUTPUT_CHARS,
  STYLE_AUTHORING_MAX_REQUEST_BYTES,
} from '../../../packages/shared/src/styleAuthoring';

const input = { instructions: 'Return JSON.', prompt: 'Describe a style.' };
const settings = () => ({
  providerDefaults: {
    chatgpt: {
      providerId: 'chatgpt' as const,
      model: 'chosen-model',
      reasoningEffort: null,
      serviceTier: null,
    },
  },
});
const signal = () => new AbortController().signal;
const completed = (text: string) => ({
  type: 'response.completed',
  response: {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  },
});
const sse = (...events: unknown[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
const post = (value: unknown, abortSignal?: AbortSignal) =>
  new Request('http://studio/propose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    signal: abortSignal,
  });

describe('Studio ChatGPT style authoring', () => {
  it('uses the configured model, no tools and structured output, parsing deltas without duplicating the completed text', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      sse(
        { type: 'response.output_text.delta', delta: '{"name":' },
        { type: 'response.output_text.delta', delta: '"Style"}' },
        completed('{"name":"Style"}'),
      ),
    );
    const authoring = createChatgptTextAuthoring({
      fetch,
      getAccessToken: async () => 'private-token',
    });
    const routes = createStyleAuthoringRoutes({ readSettings: settings, authoring });
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    };
    const response = await routes.request(post({ ...input, prompt: 'x'.repeat(24_000), schema }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: '{"name":"Style"}' });
    const request = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(request).toMatchObject({
      model: 'chosen-model',
      store: false,
      stream: true,
      tools: [],
      text: { format: { type: 'json_schema', strict: true, schema } },
    });
    fetch.mockImplementationOnce(async () =>
      sse(
        { type: 'response.output_text.delta', delta: '{"ok":true}' },
        { type: 'response.output_text.done', text: '{"ok":true}' },
        { type: 'response.completed', response: { status: 'completed', output: [] } },
      ),
    );
    expect(await (await routes.request(post(input))).json()).toEqual({ text: '{"ok":true}' });
  });

  it('rejects invalid and oversized requests before authentication or submission', async () => {
    const getAccessToken = vi.fn(async () => 'private-token');
    const fetch = vi.fn(async () => sse(completed('ok')));
    const routes = createStyleAuthoringRoutes({
      readSettings: settings,
      authoring: createChatgptTextAuthoring({ getAccessToken, fetch }),
    });
    for (const value of [
      null,
      { ...input, prompt: '' },
      { ...input, prompt: 'x'.repeat(24_001) },
      { ...input, schema: [] },
      { ...input, schema: { type: 'array' } },
      { ...input, tools: ['shell'] },
    ])
      expect((await routes.request(post(value))).status).toBe(400);
    expect(
      (
        await routes.request(
          post({ ...input, prompt: 'x'.repeat(STYLE_AUTHORING_MAX_REQUEST_BYTES) }),
        )
      ).status,
    ).toBe(413);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports disconnected auth as unavailable and rejects a proposal without contacting the provider', async () => {
    const fetch = vi.fn(async () => sse(completed('ok')));
    const routes = createStyleAuthoringRoutes({
      readSettings: settings,
      authoring: createChatgptTextAuthoring({
        fetch,
        getAccessToken: async () => {
          throw new SubscriptionHttpError('Sign in in Studio Settings.', {
            code: 'not_signed_in',
            fallbackAllowed: false,
          });
        },
      }),
    });
    expect(await (await routes.request('/capabilities')).json()).toEqual({
      available: false,
      reason: 'Sign in in Studio Settings.',
    });
    expect((await routes.request(post(input))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('verifies capabilities with real structured text, caches the probe and rechecks when model, token or time changes', async () => {
    let token = 'one';
    let now = 0;
    const fetch = vi.fn(async () => sse(completed('{"ok":true}')));
    const authoring = createChatgptTextAuthoring({
      fetch,
      getAccessToken: async () => token,
      now: () => now,
    });
    expect(await authoring.capabilities('model-one', signal())).toEqual({
      available: true,
      reason: null,
    });
    expect(await authoring.capabilities('model-one', signal())).toEqual({
      available: true,
      reason: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await authoring.capabilities('model-two', signal());
    token = 'two';
    await authoring.capabilities('model-two', signal());
    now = 300_001;
    await authoring.capabilities('model-two', signal());
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('does not claim text support from login or a partial stream, and caches a rejected probe briefly', async () => {
    const fetch = vi.fn(async () =>
      sse({ type: 'response.output_text.delta', delta: '{"ok":true}' }),
    );
    const authoring = createChatgptTextAuthoring({
      fetch,
      getAccessToken: async () => 'private-token',
    });
    expect((await authoring.capabilities('model', signal())).available).toBe(false);
    expect((await authoring.capabilities('model', signal())).available).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('redacts rejected HTTP diagnostics and invalidates rejected credentials without retries', async () => {
    const invalidateAccessToken = vi.fn();
    const fetch = vi.fn(async () => new Response('private-token', { status: 401 }));
    const routes = createStyleAuthoringRoutes({
      readSettings: settings,
      authoring: createChatgptTextAuthoring({
        fetch,
        getAccessToken: async () => 'private-token',
        invalidateAccessToken,
      }),
    });
    const response = await routes.request(post(input));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('private-token');
    expect(invalidateAccessToken).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects failed, incomplete and oversized SSE responses', async () => {
    for (const [events, code] of [
      [
        [
          {
            type: 'response.failed',
            response: {
              error: { code: 'usage_limit_reached', message: 'Usage limit private-token' },
            },
          },
        ],
        'source_limit',
      ],
      [
        [
          {
            type: 'response.incomplete',
            response: { incomplete_details: { reason: 'max_output_tokens' } },
          },
        ],
        'http_error',
      ],
      [
        [
          {
            type: 'response.output_text.delta',
            delta: 'x'.repeat(STYLE_AUTHORING_MAX_OUTPUT_CHARS + 1),
          },
        ],
        'invalid_request',
      ],
    ] as const) {
      const authoring = createChatgptTextAuthoring({
        getAccessToken: async () => 'private-token',
        fetch: async () => sse(...events),
      });
      await expect(authoring.propose(input, 'model', signal())).rejects.toMatchObject({ code });
    }
  });

  it('cancels an active response reader and releases the provider request', async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    let requestSignal: AbortSignal | undefined;
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(stream) {
              stream.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
                ),
              );
              queueMicrotask(() => controller.abort());
            },
            cancel: cancelled,
          },
          { highWaterMark: 0 },
        ),
      );
    });
    const routes = createStyleAuthoringRoutes({
      readSettings: settings,
      authoring: createChatgptTextAuthoring({ fetch, getAccessToken: async () => 'private-token' }),
    });
    const response = await routes.request(post(input, controller.signal));
    expect(response.status).toBe(499);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(true);
  });

  it('bounds stalled text streams by timeout and closes the stream', async () => {
    const cancelled = vi.fn();
    const authoring = createChatgptTextAuthoring({
      getAccessToken: async () => 'private-token',
      requestTimeoutMs: 10,
      fetch: async () => new Response(new ReadableStream({ cancel: cancelled })),
    });
    await expect(authoring.propose(input, 'model', signal())).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
