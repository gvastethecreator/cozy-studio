import type { CodexModel } from './types';

/** Studio's order for an account that names no default model. The UI and the server share it. */
export const PREFERRED_CODEX_MODEL_IDS = [
  'gpt-5.6-luna',
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.3-codex-spark',
] as const;

/** The account's own visible default first, then Studio's preference list, then the first model. */
export function pickRecommendedCodexModel(
  models: readonly Pick<CodexModel, 'id' | 'isDefault' | 'hidden'>[],
) {
  const accountDefault =
    models.find((model) => model.isDefault && !model.hidden) ??
    models.find((model) => model.isDefault);
  if (accountDefault) return accountDefault.id;
  for (const preferred of PREFERRED_CODEX_MODEL_IDS) {
    if (models.some((model) => model.id === preferred)) return preferred;
  }
  return models[0]?.id ?? null;
}
