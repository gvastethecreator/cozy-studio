import { Hono } from 'hono';
import type { ReadProviderRuntimeSnapshot } from './providerRuntimeSnapshot';
import type {
  ChatgptCreditSpendPolicy,
  ChatgptUsageStatus,
} from '../../../packages/shared/src/chatgptUsage';
import { describeChatgptUsage } from '../../../packages/shared/src/chatgptUsage';
import {
  UNKNOWN_ANTIGRAVITY_USAGE,
  type AntigravityUsageStatus,
} from '../../../packages/shared/src/antigravityUsage';
import type { OnboardingHostActionResult } from '../../../packages/shared/src/onboardingContracts';
import { applyOnboardingHostAction, OnboardingHostActionError } from './hostTerminal';

/** Provider status waits for each CLI's first probe, so it never reports a checking state. */
const SETTLED_PROVIDERS = ['grok', 'antigravity'] as const;

export function createProviderRoutes({
  readProviderRuntimeSnapshot,
  readChatgptUsageStatus,
  readChatgptCreditSpend,
  readAntigravityUsageStatus = async () => UNKNOWN_ANTIGRAVITY_USAGE,
  refreshAntigravityRuntime,
  launchAntigravityLogin = () =>
    applyOnboardingHostAction({ action: 'antigravity_login', consent: true }),
}: {
  readProviderRuntimeSnapshot: ReadProviderRuntimeSnapshot;
  readChatgptUsageStatus: () => Promise<ChatgptUsageStatus>;
  readChatgptCreditSpend: () => ChatgptCreditSpendPolicy;
  readAntigravityUsageStatus?: (options?: { force?: boolean }) => Promise<AntigravityUsageStatus>;
  refreshAntigravityRuntime?: () => Promise<unknown>;
  launchAntigravityLogin?: () => OnboardingHostActionResult;
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

  // Zero-quota read of Antigravity CLI usage windows and G1 credits.
  routes.get('/antigravity/usage', async (c) => {
    c.header('Cache-Control', 'no-store');
    const force = c.req.query('force') === '1';
    const usage = await readAntigravityUsageStatus({ force });
    return c.json(usage);
  });

  routes.post('/antigravity/refresh', async (c) => {
    c.header('Cache-Control', 'no-store');
    await refreshAntigravityRuntime?.();
    const [snapshot, usage] = await Promise.all([
      readProviderRuntimeSnapshot({ settledFor: SETTLED_PROVIDERS }),
      readAntigravityUsageStatus({ force: true }),
    ]);
    return c.json({
      capabilities: snapshot.capabilities,
      preflights: snapshot.preflights,
      usage,
    });
  });

  routes.post('/antigravity/login', async (c) => {
    c.header('Cache-Control', 'no-store');
    const contentType = c.req.header('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return c.json({ error: 'Antigravity login requires a JSON request body with consent.' }, 415);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON request body.' }, 400);
    }
    if (!body || typeof body !== 'object' || (body as { consent?: unknown }).consent !== true) {
      return c.json(
        { error: 'Explicit user consent is required to open the Antigravity login terminal.' },
        400,
      );
    }
    try {
      return c.json(launchAntigravityLogin());
    } catch (error) {
      if (error instanceof OnboardingHostActionError) {
        return c.json(error.body, error.status as 400 | 500);
      }
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Could not open a terminal for Antigravity login.',
        },
        500,
      );
    }
  });

  return routes;
}
