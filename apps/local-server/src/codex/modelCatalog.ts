import { Effect } from 'effect';
import { getSubscriptionAuthStore, isSubscriptionLoggedIn } from '../auth/store';
import { readChatgptHttpModels } from './chatgptAccountHttp';
import { isAppServerRunning } from './processSupervisor';
import { CodexRpcClient } from './rpcClient';
import type { CodexModel, CodexModelCatalogResponse } from '../../../../packages/shared/src';
import {
  resolveCodexAuthMode,
  type CodexRpcTransportFactory,
  withInitializedCodexClient,
} from './localCodexSession';

export const CODEX_RESERVE_MODEL_ID = 'gpt-reserve';

const FALLBACK_MODELS: CodexModel[] = [
  {
    id: CODEX_RESERVE_MODEL_ID,
    model: CODEX_RESERVE_MODEL_ID,
    displayName: 'GPT-Reserve',
    description: 'Reserve model exposed by the signed-in Codex account.',
    hidden: true,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Lower latency' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'More thinking' },
      { reasoningEffort: 'xhigh', description: 'Extra high reasoning' },
      { reasoningEffort: 'max', description: 'Maximum reasoning' },
    ],
    additionalSpeedTiers: ['fast'],
    inputModalities: ['text', 'image'],
    supportsPersonality: true,
    isDefault: false,
  },
  {
    id: 'gpt-5.4-mini',
    model: 'gpt-5.4-mini',
    displayName: 'GPT-5.4 mini',
    description: 'Fast, efficient Codex model for routine local tasks and subagents.',
    hidden: false,
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Lower latency' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'More thinking' },
    ],
    additionalSpeedTiers: [],
    inputModalities: ['text', 'image'],
    supportsPersonality: true,
    isDefault: false,
  },
  {
    id: 'gpt-5.3-codex-spark',
    model: 'gpt-5.3-codex-spark',
    displayName: 'GPT-5.3-Codex-Spark',
    description: 'Near-instant research-preview Codex model for fast day-to-day coding iteration.',
    hidden: false,
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Lower latency' },
      { reasoningEffort: 'medium', description: 'Balanced' },
    ],
    additionalSpeedTiers: [],
    inputModalities: ['text'],
    supportsPersonality: true,
    isDefault: false,
  },
  {
    id: 'gpt-5.5',
    model: 'gpt-5.5',
    displayName: 'GPT-5.5',
    description: 'Recommended Codex model for most implementation, debugging, and validation work.',
    hidden: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Lower latency' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'More thinking' },
    ],
    additionalSpeedTiers: ['fast'],
    inputModalities: ['text', 'image'],
    supportsPersonality: true,
    isDefault: false,
  },
  {
    id: 'gpt-5.4',
    model: 'gpt-5.4',
    displayName: 'GPT-5.4',
    description: 'Capable frontier Codex model for complex workflows and long-horizon tasks.',
    hidden: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Lower latency' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'More thinking' },
    ],
    additionalSpeedTiers: ['fast'],
    inputModalities: ['text', 'image'],
    supportsPersonality: true,
    isDefault: true,
  },
  {
    id: 'gpt-5.3-codex',
    model: 'gpt-5.3-codex',
    displayName: 'GPT-5.3-Codex',
    description: 'Agentic coding model tuned for complex real-world software engineering tasks.',
    hidden: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Lower latency' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'More thinking' },
    ],
    additionalSpeedTiers: [],
    inputModalities: ['text', 'image'],
    supportsPersonality: true,
    isDefault: false,
  },
  {
    id: 'gpt-5.2',
    model: 'gpt-5.2',
    displayName: 'GPT-5.2',
    description: 'Broadly compatible Codex fallback model for ChatGPT sign-in users.',
    hidden: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Lower latency' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'More thinking' },
    ],
    additionalSpeedTiers: [],
    inputModalities: ['text', 'image'],
    supportsPersonality: true,
    isDefault: false,
  },
];

function now() {
  return new Date().toISOString();
}

export function filterSelectableCodexModels(models: CodexModel[]) {
  return models.filter((model) => !model.hidden || model.id === CODEX_RESERVE_MODEL_ID);
}

function normalizeSpeedTiers(value: unknown): CodexModel['additionalSpeedTiers'] {
  if (!Array.isArray(value)) return [];
  return value.filter((tier): tier is CodexModel['additionalSpeedTiers'][number] => {
    return tier === 'fast' || tier === 'flex';
  });
}

function normalizeReasoningOptions(value: unknown): CodexModel['supportedReasoningEfforts'] {
  if (!Array.isArray(value)) return [];

  return value.reduce<{ reasoningEffort: string; description: string | null }[]>((acc, entry) => {
    const reasoningEffort =
      entry && typeof entry === 'object' && typeof (entry as any).reasoningEffort === 'string'
        ? (entry as any).reasoningEffort
        : '';
    if (!reasoningEffort) return acc;
    const description =
      entry && typeof entry === 'object' && typeof (entry as any).description === 'string'
        ? (entry as any).description
        : null;
    acc.push({ reasoningEffort, description });
    return acc;
  }, []);
}

function mapModel(entry: any): CodexModel | null {
  const id = typeof entry?.id === 'string' ? entry.id : null;
  if (!id) return null;

  const model = typeof entry?.model === 'string' ? entry.model : id;
  const displayName = typeof entry?.displayName === 'string' ? entry.displayName : model;

  return {
    id,
    model,
    displayName,
    description: typeof entry?.description === 'string' ? entry.description : null,
    hidden: Boolean(entry?.hidden),
    defaultReasoningEffort:
      typeof entry?.defaultReasoningEffort === 'string' ? entry.defaultReasoningEffort : null,
    supportedReasoningEfforts: normalizeReasoningOptions(entry?.supportedReasoningEfforts),
    additionalSpeedTiers: normalizeSpeedTiers(entry?.additionalSpeedTiers),
    inputModalities: Array.isArray(entry?.inputModalities)
      ? entry.inputModalities.filter(
          (modality: unknown): modality is string => typeof modality === 'string',
        )
      : ['text', 'image'],
    supportsPersonality: Boolean(entry?.supportsPersonality),
    isDefault: Boolean(entry?.isDefault),
  };
}

function pickRecommendedModel(models: CodexModel[]) {
  const preferred = [
    'gpt-5.6-luna',
    'gpt-6-astra',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.5',
    'gpt-5.3-codex-spark',
  ];
  for (const modelId of preferred) {
    if (models.some((model) => model.id === modelId)) {
      return modelId;
    }
  }

  return models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? null;
}

function buildFallbackCatalog(error: unknown): CodexModelCatalogResponse {
  return {
    models: FALLBACK_MODELS,
    authMode: null,
    planType: null,
    recommendedDefaultModel: pickRecommendedModel(FALLBACK_MODELS),
    source: 'fallback',
    fetchedAt: now(),
    error: error instanceof Error ? error.message : String(error),
  };
}

const MODEL_CATALOG_TTL_MS = 10 * 60_000;
let cachedCatalog: { key: string; expiresAt: number; catalog: CodexModelCatalogResponse } | null =
  null;
let inFlightCatalog: { key: string; promise: Promise<CodexModelCatalogResponse> } | null = null;

/**
 * Who answers the model list. A sign-in, sign-out, account switch or app-server start or stop
 * changes the key, which drops the cached catalog.
 */
function modelCatalogSourceKey() {
  if (isAppServerRunning()) return 'app-server';
  const record = getSubscriptionAuthStore().readProvider('codex');
  return isSubscriptionLoggedIn(record) ? `chatgpt:${record.chatgptAccountId ?? ''}` : 'codex-cli';
}

async function readChatgptHttpCatalog(key: string): Promise<CodexModelCatalogResponse> {
  try {
    const models = filterSelectableCodexModels(await readChatgptHttpModels());
    if (models.length === 0) throw new Error('ChatGPT returned no selectable models.');
    return {
      models,
      authMode: 'chatgpt',
      planType: null,
      recommendedDefaultModel: pickRecommendedModel(models),
      source: 'chatgpt-http',
      fetchedAt: now(),
      error: null,
    };
  } catch (error) {
    // A ChatGPT sign-in never starts app-server for a model list: that spawns a Codex process on
    // every UI load. Keep the last good list for this account, or the built-in one.
    return cachedCatalog?.key === key ? cachedCatalog.catalog : buildFallbackCatalog(error);
  }
}

/**
 * A running app-server answers first. Otherwise the Studio ChatGPT sign-in lists models over HTTP.
 * App-server starts only without a ChatGPT sign-in, where the Codex CLI login is the only source.
 * Successful answers are cached for 10 minutes and concurrent callers share one read.
 */
export async function getCodexModelCatalog(): Promise<CodexModelCatalogResponse> {
  const key = modelCatalogSourceKey();
  if (cachedCatalog?.key === key && Date.now() < cachedCatalog.expiresAt) {
    return cachedCatalog.catalog;
  }
  if (inFlightCatalog?.key === key) return inFlightCatalog.promise;
  const promise = (
    key.startsWith('chatgpt:') ? readChatgptHttpCatalog(key) : createCodexModelCatalogReader()()
  )
    .then((catalog) => {
      if (catalog.source !== 'fallback' && catalog !== cachedCatalog?.catalog) {
        cachedCatalog = { key, expiresAt: Date.now() + MODEL_CATALOG_TTL_MS, catalog };
      }
      return catalog;
    })
    .finally(() => {
      if (inFlightCatalog?.promise === promise) inFlightCatalog = null;
    });
  inFlightCatalog = { key, promise };
  return promise;
}

function createCodexModelCatalogReader({
  createClient = () => new CodexRpcClient(),
}: {
  createClient?: CodexRpcTransportFactory;
} = {}) {
  return async function readCodexModelCatalog(): Promise<CodexModelCatalogResponse> {
    try {
      return await Effect.runPromise(
        withInitializedCodexClient({ createClient }, (client) =>
          Effect.gen(function* () {
            const [modelResponse, accountResponse] = yield* Effect.all(
              [
                client.request('model/list', { limit: 100, includeHidden: true }),
                client
                  .request('account/read', { refreshToken: false })
                  .pipe(Effect.catch(() => Effect.succeed(null))),
              ],
              { concurrency: 2 },
            );

            const models = Array.isArray((modelResponse as any)?.data)
              ? filterSelectableCodexModels(
                  ((modelResponse as any).data as any[])
                    .map(mapModel)
                    .filter((model): model is CodexModel => Boolean(model)),
                )
              : [];

            const account = accountResponse?.account ?? null;

            return {
              models,
              authMode: resolveCodexAuthMode(account),
              planType: typeof account?.planType === 'string' ? account.planType : null,
              recommendedDefaultModel: pickRecommendedModel(models),
              source: 'app-server',
              fetchedAt: now(),
              error: null,
            };
          }),
        ),
      );
    } catch (error) {
      return buildFallbackCatalog(error);
    }
  };
}
