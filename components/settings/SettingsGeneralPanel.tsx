import type { Dispatch, SetStateAction } from 'react';
import {
  WORKFLOW_CATEGORIES,
  type PreferredWorkflow,
} from '../../packages/shared/src/workflowCatalog';
import { isWorkflowEnabled } from '../../lib/workflowModuleState';
import { RECIPE_DISCOVERY_CATALOG } from '../../lib/recipeCatalog';
import type { StudioSettingsFormState } from '../../lib/studioSettingsForm';

export function SettingsGeneralPanel({
  value,
  onChange,
}: {
  value: StudioSettingsFormState;
  onChange: Dispatch<SetStateAction<StudioSettingsFormState>>;
}) {
  return (
    <section className="settings-form-stack">
      <div className="settings-group">
        <h3>Startup</h3>
        <label className="settings-row">
          <span>
            <strong>Startup workflow</strong>
            <small>Used when Studio opens and in new workspaces.</small>
          </span>
          <select
            className="studio-field"
            aria-label="Startup workflow"
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
                      {id === 'default'
                        ? 'Default'
                        : (RECIPE_DISCOVERY_CATALOG.find((entry) => entry.id === id)?.title ?? id)}
                      {isWorkflowEnabled(id) ? '' : ' (turned off)'}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
      </div>
      <div className="settings-group">
        <h3>New style defaults</h3>
        <label className="settings-row">
          <span>
            <strong>Default style intensity</strong>
            <small>For newly added styles. Existing styles keep their settings.</small>
          </span>
          <span className="flex items-center gap-2">
            <input
              type="range"
              className="studio-range"
              aria-label="Default style intensity"
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
            <strong>Default style reference mode</strong>
            <small>Preserve follows the reference closely. Reinterpret allows more freedom.</small>
          </span>
          <select
            className="studio-field"
            aria-label="Default style reference mode"
            value={value.defaultStyleReferenceMode}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                defaultStyleReferenceMode: event.target
                  .value as StudioSettingsFormState['defaultStyleReferenceMode'],
              }))
            }
          >
            <option value="preserve">Preserve</option>
            <option value="reinterpret">Reinterpret</option>
          </select>
        </label>
      </div>
      <details className="settings-disclosure">
        <summary>Advanced style options</summary>
        <label className="settings-row">
          <span>
            <strong>Detailed style instructions</strong>
            <small>Experimental: apply each selected visual field separately.</small>
          </span>
          <input
            type="checkbox"
            aria-label="Detailed style instructions"
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
