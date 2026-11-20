import type {
  GenerationProviderCapabilitiesResponse,
  GenerationProviderId,
  GenerationProviderRuntimePreflightResponse,
} from '../packages/shared/src';
import type { ChatgptUsageCopy } from '../packages/shared/src/chatgptUsage';

/** Whether a provider can run a job now, with the facts that explain a block. */
export interface ProviderReadiness {
  canExecute: boolean;
  status?: string;
  diagnostics?: string[];
  /** ChatGPT only: the usage state in the wording every surface shares. */
  usage?: ChatgptUsageCopy | null;
}

export const PROVIDER_NOT_READY: ProviderReadiness = { canExecute: false };

/** Ready only when both the capability report and the runtime preflight allow execution. */
export function selectProviderReadiness(
  providerDomain: {
    capabilities: GenerationProviderCapabilitiesResponse | null;
    runtimePreflight: GenerationProviderRuntimePreflightResponse | null;
  },
  providerId: GenerationProviderId,
): ProviderReadiness {
  const capability = providerDomain.capabilities?.providers.find(
    (provider) => provider.providerId === providerId,
  );
  const preflight = providerDomain.runtimePreflight?.providers.find(
    (provider) => provider.providerId === providerId,
  );
  return {
    canExecute: capability?.canExecute === true && preflight?.canAttemptExecution === true,
    status: capability?.status,
    diagnostics: preflight?.diagnostics,
  };
}
