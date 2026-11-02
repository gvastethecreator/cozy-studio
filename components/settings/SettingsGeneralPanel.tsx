import type { Dispatch, SetStateAction } from 'react';
import {
  WORKFLOW_CATEGORIES,
  type PreferredWorkflow,
} from '../../packages/shared/src/workflowCatalog';
import { isWorkflowEnabled } from '../../lib/workflowModuleState';
import { RECIPE_DISCOVERY_CATALOG } from '../../lib/recipeCatalog';
import type { StudioSettingsFormState } from '../../lib/studioSettingsForm';
import type { StudioLanguage } from '../../packages/shared/src/studioSettings';
import { useT } from '../../lib/i18n';

// Each language is named in itself so a user can find theirs whatever the current language is.
const LANGUAGE_OPTIONS: { value: StudioLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

export function SettingsGeneralPanel({
  value,
  onChange,
}: {
  value: StudioSettingsFormState;
  onChange: Dispatch<SetStateAction<StudioSettingsFormState>>;
}) {
  const { t } = useT();
  return (
    <section className="settings-form-stack">
      <div className="settings-group">
        <h3>{t('settings.language.heading')}</h3>
        <label className="settings-row">
          <span>
            <strong>{t('settings.language.label')}</strong>
            <small>{t('settings.language.hint')}</small>
          </span>
          <select
            className="studio-field"
            aria-label={t('settings.language.label')}
            lang={value.language}
            value={value.language}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                language: event.target.value as StudioLanguage,
              }))
            }
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} lang={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="settings-group">
        <h3>{t('settings.general.startup')}</h3>
        <label className="settings-row">
          <span>
            <strong>{t('settings.general.startupWorkflow')}</strong>
            <small>{t('settings.general.startupWorkflowHint')}</small>
          </span>
          <select
            className="studio-field"
            aria-label={t('settings.general.startupWorkflow')}
            value={value.preferredWorkflow}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                preferredWorkflow: event.target.value as PreferredWorkflow,
              }))
            }
          >
            {WORKFLOW_CATEGORIES.map((category) => {
              // Workflows of turned-off modules are hidden, except the current choice.
              const workflows = category.workflows.filter(
                (id) => isWorkflowEnabled(id) || id === value.preferredWorkflow,
              );
              if (workflows.length === 0) return null;
              return (
                <optgroup key={category.id} label={category.label}>
                  {workflows.map((id) => (
                    <option key={id} value={id}>
                      {formatWorkflowOption(id, t)}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
      </div>
      <div className="settings-group">
        <h3>{t('settings.general.styleDefaults')}</h3>
        <label className="settings-row">
          <span>
            <strong>{t('settings.general.styleIntensity')}</strong>
            <small>{t('settings.general.styleIntensityHint')}</small>
          </span>
          <span className="flex items-center gap-2">
            <input
              type="range"
              className="studio-range"
              aria-label={t('settings.general.styleIntensity')}
              aria-valuetext={`${Math.round(value.defaultStyleIntensity * 100)}%`}
              min={0.1}
              max={1}
              step={0.05}
              value={value.defaultStyleIntensity}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  defaultStyleIntensity: Number(event.target.value),
                }))
              }
            />
            <span>{Math.round(value.defaultStyleIntensity * 100)}%</span>
          </span>
        </label>
        <label className="settings-row">
          <span>
            <strong>{t('settings.general.referenceMode')}</strong>
            <small>{t('settings.general.referenceModeHint')}</small>
          </span>
          <select
            className="studio-field"
            aria-label={t('settings.general.referenceMode')}
            value={value.defaultStyleReferenceMode}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                defaultStyleReferenceMode: event.target
                  .value as StudioSettingsFormState['defaultStyleReferenceMode'],
              }))
            }
          >
            <option value="preserve">{t('settings.general.referencePreserve')}</option>
            <option value="reinterpret">{t('settings.general.referenceReinterpret')}</option>
          </select>
        </label>
      </div>
      <details className="settings-disclosure">
        <summary>{t('settings.general.advancedStyle')}</summary>
        <label className="settings-row">
          <span>
            <strong>{t('settings.general.detailedInstructions')}</strong>
            <small>{t('settings.general.detailedInstructionsHint')}</small>
          </span>
          <input
            type="checkbox"
            aria-label={t('settings.general.detailedInstructions')}
            checked={value.intentionalStylesV1}
            onChange={(event) =>
              onChange((current) => ({ ...current, intentionalStylesV1: event.target.checked }))
            }
          />
        </label>
      </details>
    </section>
  );
}

function formatWorkflowOption(id: PreferredWorkflow, t: ReturnType<typeof useT>['t']) {
  const name =
    id === 'default'
      ? t('settings.general.defaultWorkflow')
      : (RECIPE_DISCOVERY_CATALOG.find((entry) => entry.id === id)?.title ?? id);
  return isWorkflowEnabled(id) ? name : t('settings.general.workflowTurnedOff', { name });
}
