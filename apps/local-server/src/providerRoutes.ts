import { Hono } from 'hono';
import type { ReadProviderRuntimeSnapshot } from './providerRuntimeSnapshot';

/** Provider status waits for each CLI's first probe, so it never reports a checking state. */
const SETTLED_PROVIDERS = ['grok', 'antigravity'] as const;

export function createProviderRoutes({
  readProviderRuntimeSnapshot,
}: {
  readProviderRuntimeSnapshot: ReadProviderRuntimeSnapshot;
}) {
  const routes = new Hono();

  routes.get('/', async (c) => {
    const snapshot = await readProviderRuntimeSnapshot({ settledFor: SETTLED_PROVIDERS });
    return c.json(snapshot.capabilities);
  });

  routes.get('/preflight', async (c) => {
    const snapshot = await readProviderRuntimeSnapshot({ settledFor: SETTLED_PROVIDERS });
    return c.json({ providers: snapshot.preflights });
  });

  return routes;
}
