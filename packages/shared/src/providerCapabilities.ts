import type {
  BuiltInGenerationProvider,
  GenerationProviderId,
  ProviderRuntimeKind,
} from './generationContracts';
import type { EditableStudioSettings } from './studioSettings';
import { CODEX_HTTP_MAX_INPUT_IMAGES } from './codexExecutionContract';
import { MAX_GROK_IMAGINE_SOURCE_IMAGES } from './grokImagineContract';

export type ProviderCapabilityStatus = 'active' | 'planned' | 'not_configured';
export type ProviderSecretState = 'not_required' | 'configured' | 'missing';
export type ProviderLocalRuntimeState = 'not_required' | 'configured' | 'missing' | 'invalid';
export type ProviderSubscriptionAuthState =
  | 'not_applicable'
  | 'logged_out'
  | 'pending'
  | 'logged_in'
  | 'refresh_failed';

export interface GenerationProviderCapability {
  providerId: GenerationProviderId;
  label: string;
  runtimeKind: ProviderRuntimeKind;
  status: ProviderCapabilityStatus;
  isDefault: boolean;
  hasAdapter: boolean;
  canExecute: boolean;
  secretState: ProviderSecretState;
  subscriptionAuthState: ProviderSubscriptionAuthState;
  detail: string;
}

export interface GenerationProviderCapabilitiesResponse {
  providers: GenerationProviderCapability[];
}

export interface GenerationProviderRuntimePreflight {
  providerId: GenerationProviderId;
  runtimeKind: ProviderRuntimeKind;
  /** Every execution route currently usable for this provider. */
  availableRuntimeKinds?: ProviderRuntimeKind[];
  secretState: ProviderSecretState;
  secretSource: string | null;
  /** Captured subscription route readiness, even when another secret source takes priority. */
  subscriptionAuthReady?: boolean;
  localRuntimeState: ProviderLocalRuntimeState;
  localRuntimeSource: string | null;
  canAttemptExecution: boolean;
  diagnostics: string[];
  availableModels?: string[];
  defaultModel?: string | null;
}

export interface GenerationProviderRuntimePreflightResponse {
  providers: GenerationProviderRuntimePreflight[];
}

export type StudioImageSize = '512px' | '1K' | '2K' | '4K';

/** Fixed, non-secret facts about one built-in provider. The UI derives its labels and limits from these. */
export interface ProviderFacts {
  /** Full name, such as `Codex app-server`. */
  label: string;
  /** Brand name next to the provider mark, such as `Antigravity`. */
  shortLabel: string;
  /** Narrow chrome such as the status bar and the provider switch, such as `AGY`. */
  compactLabel: string;
  maxInputImages: number;
  /** Images one generation can request. */
  maxOutputCount: number;
  /** Native transparent output. */
  supportsTransparentBackground: boolean;
  /** Output sizes the provider honors; other saved sizes run at 1K. */
  imageSizes: readonly StudioImageSize[];
}

const STUDIO_MAX_INPUT_IMAGES = 10;
const PROVIDER_BATCH_MAX = 10;

const STANDARD_SIZES = ['512px', '1K'] as const satisfies readonly StudioImageSize[];

function providerFacts(
  label: string,
  shortLabel: string,
  overrides: Partial<Omit<ProviderFacts, 'label' | 'shortLabel'>> = {},
): ProviderFacts {
  return {
    label,
    shortLabel,
    compactLabel: shortLabel,
    maxInputImages: STUDIO_MAX_INPUT_IMAGES,
    maxOutputCount: PROVIDER_BATCH_MAX,
    supportsTransparentBackground: false,
    imageSizes: STANDARD_SIZES,
    ...overrides,
  };
}

export const PROVIDER_FACTS: Readonly<Record<BuiltInGenerationProvider, ProviderFacts>> = {
  codex: providerFacts('Codex app-server', 'Codex', {
    maxInputImages: Math.min(STUDIO_MAX_INPUT_IMAGES, CODEX_HTTP_MAX_INPUT_IMAGES),
  }),
  chatgpt: providerFacts('ChatGPT', 'ChatGPT', {
    supportsTransparentBackground: true,
    imageSizes: ['512px', '1K', '2K', '4K'],
  }),
  grok: providerFacts('Grok Imagine', 'Grok', {
    maxInputImages: MAX_GROK_IMAGINE_SOURCE_IMAGES,
    maxOutputCount: 1,
  }),
  google: providerFacts('Nano Banana 2.1', 'Google', { maxOutputCount: 1 }),
  antigravity: providerFacts('Antigravity', 'Antigravity', {
    compactLabel: 'AGY',
    maxOutputCount: 1,
  }),
  fal: providerFacts('fal.ai', 'fal.ai', { maxOutputCount: 4 }),
  openai: providerFacts('OpenAI Images API', 'OpenAI', { maxOutputCount: 1 }),
  replicate: providerFacts('Replicate', 'Replicate', { maxOutputCount: 1 }),
  comfy: providerFacts('ComfyUI local', 'Comfy'),
  dry_run: providerFacts('Dry run', 'Dry run'),
};

/** Facts for a built-in provider, or null for an unknown id such as one from an old record. */
export function getProviderFacts(providerId: string | null | undefined): ProviderFacts | null {
  return providerId && Object.hasOwn(PROVIDER_FACTS, providerId)
    ? PROVIDER_FACTS[providerId as BuiltInGenerationProvider]
    : null;
}

export interface CreateProviderCapabilitiesInput {
  settings: Pick<EditableStudioSettings, 'defaultProviderId'>;
  secretConfigured?: Partial<Record<GenerationProviderId, boolean>>;
  localRuntimeConfigured?: Partial<Record<GenerationProviderId, boolean>>;
  subscriptionAuthConfigured?: Partial<Record<GenerationProviderId, boolean>>;
  subscriptionAuthState?: Partial<Record<GenerationProviderId, ProviderSubscriptionAuthState>>;
  providers?: readonly ProviderCapabilityDefinition[];
}

export interface ProviderCapabilityDefinition {
  providerId: GenerationProviderId;
  label: string;
  runtimeKind: ProviderRuntimeKind;
  hasAdapter: boolean;
  requiresSecret: boolean;
  requiresLocalRuntime?: boolean;
  activeDetail: string;
  subscriptionReadyDetail?: string;
  plannedDetail: string;
  missingDetail: string;
}

export const BUILT_IN_PROVIDER_CAPABILITIES = [
  {
    providerId: 'codex',
    label: PROVIDER_FACTS.codex.label,
    runtimeKind: 'codex_app_server',
    hasAdapter: true,
    requiresSecret: false,
    requiresLocalRuntime: true,
    activeDetail: 'Codex Product Runtime adapter is available.',
    plannedDetail: 'Codex adapter is available.',
    missingDetail: 'Start Codex Product Runtime and sign in through Codex.',
  },
  {
    providerId: 'chatgpt',
    label: PROVIDER_FACTS.chatgpt.label,
    runtimeKind: 'subscription_http',
    hasAdapter: true,
    requiresSecret: true,
    activeDetail: 'ChatGPT session connected. Availability is checked when generating.',
    plannedDetail: 'ChatGPT direct HTTP adapter is available.',
    missingDetail: 'Sign in with ChatGPT in Studio Settings.',
  },
  {
    providerId: 'grok',
    label: PROVIDER_FACTS.grok.label,
    runtimeKind: 'agent_cli',
    hasAdapter: true,
    requiresSecret: false,
    requiresLocalRuntime: true,
    activeDetail: 'Grok Imagine is available through the authenticated local Grok Build CLI.',
    subscriptionReadyDetail: 'xAI HTTP credentials are ready. Grok Build CLI stays as fallback.',
    plannedDetail: 'Grok Imagine adapter is available.',
    missingDetail: 'Sign in with xAI in Studio Settings, set XAI_API_KEY, or install Grok Build.',
  },
  {
    providerId: 'google',
    label: PROVIDER_FACTS.google.label,
    runtimeKind: 'hosted_api',
    hasAdapter: true,
    requiresSecret: true,
    activeDetail: 'Nano Banana 2.1 is ready through the Google Interactions API.',
    subscriptionReadyDetail: 'Google OAuth is connected for direct Nano Banana 2.1 requests.',
    plannedDetail: 'Google Nano Banana adapter is available.',
    missingDetail: 'Add a Google API key or connect Google OAuth in Studio Settings.',
  },
  {
    providerId: 'antigravity',
    label: PROVIDER_FACTS.antigravity.label,
    runtimeKind: 'agent_cli',
    hasAdapter: true,
    requiresSecret: false,
    requiresLocalRuntime: true,
    activeDetail: 'Antigravity image generation is ready through the authenticated local CLI.',
    plannedDetail: 'Antigravity adapter is available.',
    missingDetail: 'Install Antigravity CLI and complete its local login.',
  },
  {
    providerId: 'fal',
    label: PROVIDER_FACTS.fal.label,
    runtimeKind: 'hosted_api',
    hasAdapter: true,
    requiresSecret: true,
    activeDetail: 'fal.ai adapter is available.',
    plannedDetail: 'fal.ai adapter is available once the backend Provider Secret is configured.',
    missingDetail: 'Add a backend FAL_KEY or FAL_API_KEY before enabling this adapter.',
  },
  {
    providerId: 'openai',
    label: PROVIDER_FACTS.openai.label,
    runtimeKind: 'hosted_api',
    hasAdapter: true,
    requiresSecret: true,
    activeDetail: 'OpenAI Images API adapter is available.',
    plannedDetail: 'OpenAI Images API adapter is available once OPENAI_API_KEY is configured.',
    missingDetail: 'Add a backend OPENAI_API_KEY before enabling this adapter.',
  },
  {
    providerId: 'replicate',
    label: PROVIDER_FACTS.replicate.label,
    runtimeKind: 'hosted_api',
    hasAdapter: true,
    requiresSecret: true,
    activeDetail: 'Replicate adapter is available.',
    plannedDetail: 'Replicate adapter is available once REPLICATE_API_TOKEN is configured.',
    missingDetail: 'Add a backend REPLICATE_API_TOKEN before enabling this adapter.',
  },
  {
    providerId: 'comfy',
    label: PROVIDER_FACTS.comfy.label,
    runtimeKind: 'local_workflow',
    hasAdapter: true,
    requiresSecret: false,
    requiresLocalRuntime: true,
    activeDetail: 'ComfyUI adapter is available.',
    plannedDetail:
      'Local runtime endpoint detected. Configure the workflow template before enabling this adapter.',
    missingDetail:
      'Configure a backend ComfyUI endpoint and workflow template before enabling this adapter.',
  },
  {
    providerId: 'dry_run',
    label: PROVIDER_FACTS.dry_run.label,
    runtimeKind: 'dry_run',
    hasAdapter: true,
    requiresSecret: false,
    activeDetail: 'Diagnostic local adapter is available.',
    plannedDetail: 'Diagnostic local adapter is available.',
    missingDetail: 'Diagnostic local adapter is available.',
  },
] satisfies readonly ProviderCapabilityDefinition[];

function resolveSecretState(requiresSecret: boolean, configured: boolean): ProviderSecretState {
  if (!requiresSecret) return 'not_required';
  return configured ? 'configured' : 'missing';
}

function resolveSubscriptionAuthState(
  providerId: GenerationProviderId,
  subscriptionAuthState: Partial<Record<GenerationProviderId, ProviderSubscriptionAuthState>>,
): ProviderSubscriptionAuthState {
  if (providerId === 'chatgpt' || providerId === 'grok' || providerId === 'google') {
    return subscriptionAuthState[providerId] ?? 'logged_out';
  }
  return 'not_applicable';
}

export function createGenerationProviderCapabilities({
  settings,
  secretConfigured = {},
  localRuntimeConfigured = {},
  subscriptionAuthConfigured = {},
  subscriptionAuthState = {},
  providers = BUILT_IN_PROVIDER_CAPABILITIES,
}: CreateProviderCapabilitiesInput): GenerationProviderCapabilitiesResponse {
  return {
    providers: providers.map((provider) => {
      const secretReady = Boolean(secretConfigured[provider.providerId]);
      const subscriptionReady = Boolean(subscriptionAuthConfigured[provider.providerId]);
      const localReady = Boolean(localRuntimeConfigured[provider.providerId]);
      const runtimeReady = provider.requiresLocalRuntime ? localReady || subscriptionReady : true;
      const credentialReady = !provider.requiresSecret || secretReady || subscriptionReady;
      const configured = credentialReady && runtimeReady;
      const canExecute = provider.hasAdapter && configured;
      const status: ProviderCapabilityStatus = canExecute
        ? 'active'
        : configured
          ? 'planned'
          : 'not_configured';
      const runtimeKind =
        subscriptionReady && provider.providerId === 'grok'
          ? 'subscription_http'
          : provider.runtimeKind;
      const activeDetail =
        subscriptionReady && provider.subscriptionReadyDetail
          ? provider.subscriptionReadyDetail
          : provider.activeDetail;

      return {
        providerId: provider.providerId,
        label: provider.label,
        runtimeKind,
        status,
        isDefault: settings.defaultProviderId === provider.providerId,
        hasAdapter: provider.hasAdapter,
        canExecute,
        secretState: resolveSecretState(provider.requiresSecret, secretReady || subscriptionReady),
        subscriptionAuthState: resolveSubscriptionAuthState(
          provider.providerId,
          subscriptionAuthState,
        ),
        detail:
          status === 'active'
            ? activeDetail
            : status === 'planned'
              ? provider.plannedDetail
              : provider.missingDetail,
      };
    }),
  };
}
