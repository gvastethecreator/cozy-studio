import { Hono } from 'hono';
import type { ReadProviderRuntimeSnapshot } from './providerRuntimeSnapshot';
import type {
  ChatgptCreditSpendPolicy,
  ChatgptUsageStatus,
} from '../../../packages/shared/src/chatgptUsage';
import { describeChatgptUsage } from '../../../packages/shared/src/chatgptUsage';

/** Provider status waits for each CLI's first probe, so it never reports a checking state. */
const SETTLED_PROVIDERS = ['grok', 'antigravity'] as const;

export function createProviderRoutes({
  readProviderRuntimeSnapshot,
  readChatgptUsageStatus,
  readChatgptCreditSpend,
}: {
  readProviderRuntimeSnapshot: ReadProviderRuntimeSnapshot;
  readChatgptUsageStatus: () => Promise<ChatgptUsageStatus>;
  readChatgptCreditSpend: () => ChatgptCreditSpendPolicy;
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

  // A fresh read of the ChatGPT window and credits, with the policy intake applies to it.
  routes.get('/chatgpt/usage', async (c) => {
    const usage = await readChatgptUsageStatus();
    const creditPolicy = readChatgptCreditSpend();
    const { line, blocksGeneration } = describeChatgptUsage(usage, creditPolicy);
    return c.json({ ...usage, creditPolicy, summary: line, blocksGeneration });
  });

  return routes;
}
