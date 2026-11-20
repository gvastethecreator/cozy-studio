import type {
  CodexRuntimeDoctorReport,
  GenerationProviderCapabilitiesResponse,
  GenerationProviderId,
  GenerationProviderRuntimePreflight,
} from '../../../packages/shared/src';
import type { EditableStudioSettings } from '../../../packages/shared/src/studioSettings';
import type { AntigravityRuntimeDoctorReport } from './antigravityRuntimeDoctor';
import type { GrokRuntimeDoctorReport } from './grokRuntimeDoctor';
import {
  getProviderExecutionBlocker,
  readProviderCapabilities,
  type ProviderExecutionBlocker,
} from './providerCapabilities';
import { readGenerationProviderRuntimePreflights } from './providers/runtimeConfig';

type MaybePromise<T> = T | Promise<T>;

/**
 * Where each local runtime report comes from. `settled` asks for a report that is not a
 * checking placeholder: the source waits for its probe instead of returning the last state.
 */
export interface ProviderRuntimeSources {
  readSettings: () => Pick<EditableStudioSettings, 'defaultProviderId'>;
  readCodexRuntime: (settled: boolean) => MaybePromise<CodexRuntimeDoctorReport>;
  readGrokRuntime: (settled: boolean) => MaybePromise<GrokRuntimeDoctorReport>;
  readAntigravityRuntime: (settled: boolean) => MaybePromise<AntigravityRuntimeDoctorReport>;
  env?: Record<string, string | undefined>;
}

/** One consistent read of provider readiness: every answer comes from the same runtime reports. */
export interface ProviderRuntimeSnapshot {
  preflights: GenerationProviderRuntimePreflight[];
  capabilities: GenerationProviderCapabilitiesResponse;
  blockerFor(providerId: GenerationProviderId): ProviderExecutionBlocker | null;
}

export type ReadProviderRuntimeSnapshot = (options: {
  /** Providers whose runtime report must be settled before the snapshot is built. */
  settledFor: readonly GenerationProviderId[];
}) => Promise<ProviderRuntimeSnapshot>;

export function createProviderRuntimeSnapshotReader(
  sources: ProviderRuntimeSources,
): ReadProviderRuntimeSnapshot {
  return async ({ settledFor }) => {
    const settled = (providerId: GenerationProviderId) => settledFor.includes(providerId);
    const [codexRuntime, grokRuntime, antigravityRuntime] = await Promise.all([
      sources.readCodexRuntime(settled('codex')),
      sources.readGrokRuntime(settled('grok')),
      sources.readAntigravityRuntime(settled('antigravity')),
    ]);
    const env = sources.env ?? process.env;
    const preflights = readGenerationProviderRuntimePreflights(
      env,
      codexRuntime,
      grokRuntime,
      antigravityRuntime,
    );
    const capabilities = readProviderCapabilities(sources.readSettings(), { env, preflights });
    return {
      preflights,
      capabilities,
      blockerFor: (providerId) => getProviderExecutionBlocker(capabilities, providerId, preflights),
    };
  };
}
