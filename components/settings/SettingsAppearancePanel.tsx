import type { Dispatch, SetStateAction } from 'react';
import type { StudioSettingsFormState } from '../../lib/studioSettingsForm';
import { ACCENT_PALETTES, useTheme } from '../../hooks/useTheme';

export function SettingsAppearancePanel({
  value,
  onChange,
}: {
  value: StudioSettingsFormState;
  onChange: Dispatch<SetStateAction<StudioSettingsFormState>>;
}) {
  const { preferences, previewPreferences } = useTheme();
  return (
    <div className="settings-form-stack">
      <div className="settings-group">
        <h3>Appearance</h3>
        <label className="settings-row">
          <span>
            <strong>Theme</strong>
          </span>
          <select
            className="studio-field"
            aria-label="Theme"
            value={preferences.appearance}
            onChange={(event) =>
              previewPreferences({
                ...preferences,
                appearance: event.target.value === 'light' ? 'light' : 'dark',
              })
            }
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <fieldset className="settings-accent-picker">
          <legend>Accent color</legend>
          <div>
            {ACCENT_PALETTES.map((palette) => (
              <button
                key={palette.name}
                type="button"
                className="settings-accent-option"
                aria-label={`Accent: ${palette.name}`}
                aria-pressed={preferences.accent === palette.name}
                onClick={() => previewPreferences({ ...preferences, accent: palette.name })}
              >
                <span
                  style={{ backgroundColor: `rgb(${palette.colors[500]})` }}
                  aria-hidden="true"
                />
                {palette.name}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="settings-row">
          <span>
            <strong>Motion</strong>
            <small>Follow your system or reduce movement.</small>
          </span>
          <select
            className="studio-field"
            aria-label="Motion preference"
            value={preferences.motion}
            onChange={(event) =>
              previewPreferences({
                ...preferences,
                motion: event.target.value === 'reduced' ? 'reduced' : 'system',
              })
            }
          >
            <option value="system">System</option>
            <option value="reduced">Reduced</option>
          </select>
        </label>
      </div>
      <div className="settings-group">
        <h3>Panel layout</h3>
        {(
          [
            { key: 'toolsPanelSide', label: 'Tools panel position' },
            { key: 'jobsPanelSide', label: 'Jobs panel position' },
          ] as const
        ).map(({ key, label }) => (
          <label className="settings-row" key={key}>
            <strong>{label}</strong>
            <select
              className="studio-field"
              aria-label={label}
              value={value[key]}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  [key]: event.target.value as 'left' | 'right',
                }))
              }
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
        ))}
        <label className="settings-row">
          <strong>Compact workspace controls</strong>
          <input
            type="checkbox"
            aria-label="Compact workspace controls"
            checked={value.commandCenterCompactMode}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                commandCenterCompactMode: event.target.checked,
              }))
            }
          />
        </label>
      </div>
      <div className="settings-group">
        <h3>History &amp; jobs</h3>
        <label className="settings-row">
          <span>
            <strong>Show all workspace results</strong>
            <small>Include results from every workflow in the carousel.</small>
          </span>
          <input
            type="checkbox"
            aria-label="Show all workspace results"
            checked={value.showWorkspaceHistoryInCarousel}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                showWorkspaceHistoryInCarousel: event.target.checked,
              }))
            }
          />
        </label>
        <label className="settings-row">
          <span>
            <strong>Clear review list on startup</strong>
            <small>Hide past review and failed jobs. Keep their records and images.</small>
          </span>
          <input
            type="checkbox"
            aria-label="Clear review list on startup"
            checked={value.clearReviewJobsOnStartup}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                clearReviewJobsOnStartup: event.target.checked,
              }))
            }
          />
        </label>
      </div>
    </div>
  );
}
