import {
  compareGenerationProviderPresentation,
  type GenerationProviderId,
} from '../../packages/shared/src/generationContracts';
import type {
  GenerationProviderCapabilitiesResponse,
  GenerationProviderRuntimePreflightResponse,
} from '../../packages/shared/src/providerCapabilities';
import { subscriptionProviderIdForGeneration } from '../../packages/shared/src/subscriptionAuth';
import type { ProviderDefaultSettings } from '../../packages/shared/src/studioSettings';
import type { StudioSettingsFormState } from '../../lib/studioSettingsForm';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  providerReadyLabel,
  providerRuntimeLabel,
  providerSecretLabel,
} from '../../lib/subscriptionAuthUi';
import { providerBrandChipLabel, providerReadyPillClass } from '../../lib/providerBrand';
import { useT } from '../../lib/i18n';
import { ProviderBrandMark, ProviderUntestedBadge } from '../ProviderBrandMark';
import { SubscriptionAuthControls } from './SubscriptionAuthControls';
import { ProviderExecutionDefaultsFields } from './ProviderExecutionDefaultsFields';

interface SettingsProvidersPanelProps {
  formState: StudioSettingsFormState;
  onFormChange: Dispatch<SetStateAction<StudioSettingsFormState>>;
  providerOptions: GenerationProviderId[];
  providerCapabilities: GenerationProviderCapabilitiesResponse | null;
  providerRuntimePreflight: GenerationProviderRuntimePreflightResponse | null;
}

function StatusPill({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center rounded-[var(--wb-radius)] border px-1.5 text-[length:var(--wbp-label)] font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

export function SettingsProvidersPanel({
  formState,
  onFormChange: setFormState,
  providerOptions,
  providerCapabilities,
  providerRuntimePreflight,
}: SettingsProvidersPanelProps) {
  const { t } = useT();
  const { defaultProviderId, providerDefaults } = formState;
  const selectedProviderDefaults: ProviderDefaultSettings = providerDefaults[defaultProviderId] ?? {
    providerId: defaultProviderId,
    model: null,
    reasoningEffort: null,
    serviceTier: null,
  };
  const updateSelectedProviderDefaults = (patch: Partial<ProviderDefaultSettings>) => {
    setFormState((prev) => {
      const current = prev.providerDefaults[prev.defaultProviderId] ?? {
        providerId: prev.defaultProviderId,
        model: null,
        reasoningEffort: null,
        serviceTier: null,
      };
      return {
        ...prev,
        providerDefaults: {
          ...prev.providerDefaults,
          [prev.defaultProviderId]: {
            ...current,
            ...patch,
            providerId: prev.defaultProviderId,
          },
        },
      };
    });
  };

  const preflightByProvider = new Map(
    providerRuntimePreflight?.providers.map((p) => [p.providerId, p]) ?? [],
  );
  const capabilityByProvider = new Map(
    providerCapabilities?.providers.map((p) => [p.providerId, p]) ?? [],
  );
  const defaultCapability = capabilityByProvider.get(defaultProviderId);

  return (
    <>
      <div className="settings-provider-section">
        <div className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-muted)]">
          Default provider
        </div>
        <fieldset className="settings-provider-picker">
          <legend className="sr-only">Default provider</legend>
          {providerOptions.map((providerId) => {
            const isSelected = providerId === defaultProviderId;
            return (
              <label
                key={providerId}
                className="studio-ghost-control settings-provider-option"
                data-selected={isSelected}
              >
                <input
                  type="radio"
                  name="default-provider"
                  value={providerId}
                  checked={isSelected}
                  onChange={() =>
                    setFormState((prev) => ({
                      ...prev,
                      defaultProviderId: providerId,
                    }))
                  }
                  className="sr-only"
                />
                <ProviderBrandMark
                  providerId={providerId}
                  size="sm"
                  canExecute={capabilityByProvider.get(providerId)?.canExecute}
                  status={capabilityByProvider.get(providerId)?.status}
                />
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-medium">
                  {providerBrandChipLabel(providerId)}
                  <ProviderUntestedBadge providerId={providerId} />
                </span>
              </label>
            );
          })}
        </fieldset>
        {defaultCapability && !defaultCapability.canExecute ? (
          <p className="settings-provider-attention" role="status">
            {t('settings.providers.defaultNotReady', {
              provider: providerBrandChipLabel(defaultProviderId),
            })}
          </p>
        ) : null}
      </div>

      <details className="settings-provider-defaults">
        <summary aria-label="Model and execution settings">
          Model and execution settings <span>{providerBrandChipLabel(defaultProviderId)}</span>
        </summary>
        <ProviderExecutionDefaultsFields
          value={selectedProviderDefaults}
          onChange={updateSelectedProviderDefaults}
          availableModels={preflightByProvider.get(defaultProviderId)?.availableModels}
          providerDefaultModel={preflightByProvider.get(defaultProviderId)?.defaultModel}
        />
      </details>

      {providerCapabilities ? (
        <div className="settings-provider-section">
          <div>
            <div className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-muted)]">
              Accounts
            </div>
          </div>
          <div className="settings-provider-accounts">
            {providerCapabilities.providers
              .toSorted((left, right) =>
                compareGenerationProviderPresentation(left.providerId, right.providerId),
              )
              .map((provider) => {
                const preflight = preflightByProvider.get(provider.providerId);
                const subscriptionId = subscriptionProviderIdForGeneration(provider.providerId);
                const runtimeLabel =
                  provider.providerId === 'comfy'
                    ? provider.canExecute
                      ? 'Endpoint and workflow ready'
                      : 'Set an endpoint and workflow'
                    : ['codex', 'grok', 'antigravity'].includes(provider.providerId)
                      ? providerRuntimeLabel(preflight?.localRuntimeState)
                      : null;
                const secretLabel =
                  subscriptionId || provider.providerId === 'comfy'
                    ? null
                    : providerSecretLabel(preflight?.secretState, preflight?.secretSource);
                const readyLabel =
                  provider.providerId === 'chatgpt' && provider.canExecute
                    ? 'Connected'
                    : providerReadyLabel({
                        canExecute: provider.canExecute,
                        status: provider.status,
                      });
                // The sign-in row below is the action; don't send the user to Settings from Settings.
                const attention =
                  provider.providerId === 'chatgpt'
                    ? t(
                        provider.subscriptionAuthState === 'refresh_failed'
                          ? 'onboarding.chatgpt.expired'
                          : 'onboarding.chatgpt.signedOut',
                      )
                    : provider.providerId === 'google'
                      ? t('settings.providers.googleSetup')
                      : provider.providerId === 'grok'
                        ? t('settings.providers.grokSetup')
                        : provider.detail;

                return (
                  <div
                    key={provider.providerId}
                    className="settings-provider-account"
                    data-provider={provider.providerId}
                  >
                    <div className="settings-provider-account-header">
                      <ProviderBrandMark
                        providerId={provider.providerId}
                        size="md"
                        canExecute={provider.canExecute}
                        status={provider.status}
                      />
                      <div className="settings-provider-account-heading">
                        <div className="settings-provider-account-title">
                          <span>{provider.label}</span>
                          {provider.isDefault ? <small>Default</small> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <ProviderUntestedBadge providerId={provider.providerId} />
                          <StatusPill
                            className={providerReadyPillClass({
                              canExecute: provider.canExecute,
                              status: provider.status,
                            })}
                          >
                            {readyLabel}
                          </StatusPill>
                        </div>
                      </div>
                    </div>
                    {runtimeLabel || secretLabel ? (
                      <p className="settings-provider-runtime">
                        {[runtimeLabel, secretLabel].filter(Boolean).join(' · ')}
                      </p>
                    ) : null}
                    {!provider.canExecute && (
                      <p className="settings-provider-attention" title={attention}>
                        {attention}
                      </p>
                    )}
                    {subscriptionId ? (
                      <SubscriptionAuthControls
                        providerId={subscriptionId}
                        compact
                        optional={provider.canExecute}
                      />
                    ) : null}
                    <details className="settings-provider-details">
                      <summary>Connection details</summary>
                      {provider.canExecute ? <p>{provider.detail}</p> : null}
                      {preflight?.diagnostics.length ? (
                        <p>
                          {preflight.diagnostics
                            .filter((detail) => detail !== provider.detail)
                            .join(' ')}
                        </p>
                      ) : null}
                    </details>
                  </div>
                );
              })}
          </div>
        </div>
      ) : (
        <p className="md:col-span-2 text-[12px] leading-relaxed text-[color:var(--wb-muted)]">
          Provider status loads with Studio Settings.
        </p>
      )}
    </>
  );
}
