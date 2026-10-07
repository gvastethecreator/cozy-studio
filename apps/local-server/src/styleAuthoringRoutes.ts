import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { CODEX_HTTP_CHAT_MODEL } from '../../../packages/shared/src/codexExecutionContract';
import type { EditableStudioSettings } from '../../../packages/shared/src/studioSettings';
import {
  parseStyleAuthoringRequest,
  STYLE_AUTHORING_MAX_REQUEST_BYTES,
} from '../../../packages/shared/src/styleAuthoring';
import { createChatgptTextAuthoring } from './providers/chatgptTextAuthoring';
import { SubscriptionHttpError } from './providers/subscriptionHttpError';

interface StyleAuthoringRoutesDependencies {
  readSettings: () => Pick<EditableStudioSettings, 'providerDefaults'>;
  authoring?: ReturnType<typeof createChatgptTextAuthoring>;
}

export function createStyleAuthoringRoutes({
  readSettings,
  authoring = createChatgptTextAuthoring(),
}: StyleAuthoringRoutesDependencies) {
  const app = new Hono();
  const model = () =>
    readSettings().providerDefaults.chatgpt?.model?.trim() || CODEX_HTTP_CHAT_MODEL;
  app.onError((error, c) => {
    if (
      c.req.raw.signal.aborted ||
      (error instanceof SubscriptionHttpError && error.code === 'cancelled')
    )
      return new Response(
        JSON.stringify({ error: 'Style authoring was cancelled.', code: 'cancelled' }),
        { status: 499, headers: { 'Content-Type': 'application/json' } },
      );
    if (error instanceof SubscriptionHttpError) {
      const status =
        error.code === 'not_signed_in' || error.code === 'invalid_grant'
          ? 401
          : error.code === 'rate_limit' || error.code === 'source_limit'
            ? 429
            : error.code === 'timeout'
              ? 504
              : 502;
      return c.json({ error: error.message, code: error.code }, status);
    }
    return c.json({ error: 'ChatGPT text authoring failed.', code: 'http_error' }, 502);
  });
  app.use(
    '/propose',
    bodyLimit({
      maxSize: STYLE_AUTHORING_MAX_REQUEST_BYTES,
      onError: (c) =>
        c.json(
          { error: 'Style authoring request exceeded the size limit.', code: 'invalid_request' },
          413,
        ),
    }),
  );
  app.get('/capabilities', async (c) =>
    c.json(await authoring.capabilities(model(), c.req.raw.signal)),
  );
  app.post('/propose', async (c) => {
    let input;
    try {
      input = parseStyleAuthoringRequest(await c.req.json());
    } catch {
      return c.json({ error: 'Invalid style authoring request.', code: 'invalid_request' }, 400);
    }
    return c.json(await authoring.propose(input, model(), c.req.raw.signal));
  });
  return app;
}
