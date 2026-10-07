import { SettingsAppearancePanel } from './SettingsAppearancePanel';
import { SettingsOutputPanel } from './SettingsOutputPanel';
import type React from 'react';
import { type GenerationProviderId } from '../../packages/shared/src/generationContracts';
import type {
  GenerationProviderCapabilitiesResponse,
  GenerationProviderRuntimePreflightResponse,
} from '../../packages/shared/src/providerCapabilities';
import {
  EXTERNAL_SCAN_PATH_HELP,
  EXTERNAL_SCAN_PATH_LABEL,
  type StudioSettingsFormState,
} from '../../lib/studioSettingsForm';
import { type StudioSettingsDomainId } from '../../lib/studioSettingsDomains';
import { SettingsProvidersPanel } from './SettingsProvidersPanel';

interface SettingsFormPanelProps {
  domain: Extract<StudioSettingsDomainId, 'appearance' | 'library' | 'providers' | 'output'>;
  formState: StudioSettingsFormState;
  onFormChange: React.Dispatch<React.SetStateAction<StudioSettingsFormState>>;
  libraryDir: string | null;
  providerOptions: GenerationProviderId[];
  providerCapabilities: GenerationProviderCapabilitiesResponse | null;
  providerRuntimePreflight: GenerationProviderRuntimePreflightResponse | null;
}

export function SettingsFormPanel({
  domain,
  formState,
  onFormChange: setFormState,
  libraryDir,
  providerOptions,
  providerCapabilities,
  providerRuntimePreflight,
}: SettingsFormPanelProps) {
  return (
    <div className="settings-form-stack">
      {domain === 'library' && (
        <section className="settings-group">
          <h3>Library location</h3>
          <p className="settings-path">{libraryDir ?? 'Loading library location…'}</p>
          <h3>Import discovery</h3>
          <label className="settings-row">
            <span>
              <strong>{EXTERNAL_SCAN_PATH_LABEL}</strong>
              <small>{EXTERNAL_SCAN_PATH_HELP}</small>
            </span>
            <input
              className="studio-field"
              value={formState.preferredOutputPath}
              aria-label={EXTERNAL_SCAN_PATH_LABEL}
              placeholder="D:/images"
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, preferredOutputPath: event.target.value }))
              }
            />
          </label>
          <label className="settings-row">
            <strong>Discover external images</strong>
            <input
              type="checkbox"
              aria-label="Discover external images"
              checked={formState.autoDetectOutputSources}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, autoDetectOutputSources: event.target.checked }))
              }
            />
          </label>
        </section>
      )}
      {domain === 'appearance' && (
        <SettingsAppearancePanel value={formState} onChange={setFormState} />
      )}
      {domain === 'providers' && (
        <SettingsProvidersPanel
          formState={formState}
          onFormChange={setFormState}
          providerOptions={providerOptions}
          providerCapabilities={providerCapabilities}
          providerRuntimePreflight={providerRuntimePreflight}
        />
      )}
      {domain === 'output' && (
        <SettingsOutputPanel value={formState} onChange={setFormState} libraryDir={libraryDir} />
      )}
    </div>
  );
}
