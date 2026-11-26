import { Hono } from 'hono';
import {
  isSubscriptionProviderId,
  type GoogleCredentialsClearScope,
  type SaveGoogleCredentialsInput,
  type SubscriptionProviderId,
} from '../../../../packages/shared/src/subscriptionAuth';
import { publishEvent } from '../events';
import {
  getSubscriptionAuthController,
  SubscriptionAuthRouteError,
  type SubscriptionAuthController,
} from './controller';
import {
  getGoogleCredentialsStore,
  GoogleCredentialsError,
  readGoogleCredentialsPublicStatus,
  saveGoogleCredentials,
  type GoogleCredentialsStore,
} from './googleCredentials';
import { safeOAuthText } from './oauthHttp';
import type { AuthFetch } from './tokens';

function providerFromParam(value: string): SubscriptionProviderId | null {
  return isSubscriptionProviderId(value) ? value : null;
}

function parseClearScope(value: string | undefined): GoogleCredentialsClearScope {
  if (value === 'api_key' || value === 'oauth') return value;
  return 'all';
}

export interface SubscriptionAuthRoutesDependencies {
  googleCredentialsStore?: GoogleCredentialsStore;
  env?: Record<string, string | undefined>;
  fetch?: AuthFetch;
  publish?: (type: string, payload: unknown) => unknown;
}

export function createSubscriptionAuthRoutes(
  controller: SubscriptionAuthController = getSubscriptionAuthController(),
  dependencies: SubscriptionAuthRoutesDependencies = {},
) {
  const routes = new Hono();
  const googleCredentialsStore = dependencies.googleCredentialsStore ?? getGoogleCredentialsStore();
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetch ?? fetch;
  const publish = dependencies.publish ?? publishEvent;

  routes.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
  });

  const handleError = (error: unknown) => {
    if (error instanceof GoogleCredentialsError) {
      return {
        body: { error: error.message, code: error.code },
        status: error.status,
      };
    }
    if (error instanceof SubscriptionAuthRouteError) {
      return {
        body: { error: error.message, code: error.code },
        status: error.status as 409 | 503,
      };
    }
    const candidate = safeOAuthText(error instanceof Error ? error.message : '');
    const message = /^(ChatGPT|xAI|Google|Studio Sign in credential store)\b/.test(candidate)
      ? candidate
      : 'Authentication request failed.';
    return { body: { error: message, code: 'auth_failed' }, status: 503 as const };
  };

  routes.get('/google/credentials', (c) => {
    try {
      return c.json(readGoogleCredentialsPublicStatus({ env, store: googleCredentialsStore }));
    } catch (error) {
      const mapped = handleError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  routes.put('/google/credentials', async (c) => {
    const contentType = c.req.header('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('application/json')) {
      return c.json(
        {
          error: 'Google credential updates require Content-Type: application/json.',
          code: 'unsupported_media_type',
        },
        415,
      );
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON request body.', code: 'invalid_json' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Invalid Google credentials payload.', code: 'invalid_payload' }, 400);
    }
    try {
      const next = await saveGoogleCredentials(body as SaveGoogleCredentialsInput, {
        env,
        store: googleCredentialsStore,
        fetch: fetchImpl,
      });
      const oauthState = controller.readPublic('google');
      publish('auth.updated', {
        providerId: 'google',
        status: oauthState.status,
        accountLabel: oauthState.accountLabel,
      });
      return c.json(next);
    } catch (error) {
      const mapped = handleError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  routes.delete('/google/credentials', (c) => {
    const scope = parseClearScope(c.req.query('scope'));
    try {
      googleCredentialsStore.assertWritable();
      googleCredentialsStore.clear(scope);
      const next = readGoogleCredentialsPublicStatus({ env, store: googleCredentialsStore });
      const oauthState = controller.readPublic('google');
      publish('auth.updated', {
        providerId: 'google',
        status: oauthState.status,
        accountLabel: oauthState.accountLabel,
      });
      return c.json(next);
    } catch (error) {
      const mapped = handleError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  routes.get('/:provider', (c) => {
    const providerId = providerFromParam(c.req.param('provider'));
    if (!providerId) return c.json({ error: 'Unknown provider.', code: 'unknown_provider' }, 404);
    try {
      return c.json(controller.readPublic(providerId));
    } catch (error) {
      const mapped = handleError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  routes.post('/:provider/start', async (c) => {
    const providerId = providerFromParam(c.req.param('provider'));
    if (!providerId) return c.json({ error: 'Unknown provider.', code: 'unknown_provider' }, 404);
    try {
      return c.json(await controller.start(providerId));
    } catch (error) {
      const mapped = handleError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  routes.post('/:provider/cancel', (c) => {
    const providerId = providerFromParam(c.req.param('provider'));
    if (!providerId) return c.json({ error: 'Unknown provider.', code: 'unknown_provider' }, 404);
    try {
      return c.json(controller.cancel(providerId));
    } catch (error) {
      const mapped = handleError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  routes.post('/:provider/logout', async (c) => {
    const providerId = providerFromParam(c.req.param('provider'));
    if (!providerId) return c.json({ error: 'Unknown provider.', code: 'unknown_provider' }, 404);
    try {
      return c.json(await controller.logout(providerId));
    } catch (error) {
      const mapped = handleError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  return routes;
}
