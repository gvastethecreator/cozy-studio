import { CozyLoader as LoaderCircle } from './CozyMascot';
import { useTheme } from '../hooks/useTheme';
import { validateOutputTemplate } from '../packages/shared/src/outputLayout';
import { SettingsGeneralPanel } from './settings/SettingsGeneralPanel';
import { SettingsUpdatesPanel } from './settings/SettingsUpdatesPanel';
import { StudioHelpGuide } from './StudioHelpGuide';
import { ConfirmationModal } from './ConfirmationModal';
import { Refresh as RefreshCw, FloppyDisk as Save, Settings, Xmark as X } from 'iconoir-react';
import type React from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BUILT_IN_GENERATION_PROVIDERS,
  compareGenerationProviderPresentation,
} from '../packages/shared/src/generationContracts';
import type {
  ExternalOutputSourceFile,
  ExternalOutputSourcesResponse,
  RegisterExternalOutputSourceInput,
} from '../packages/shared/src/outputSources';
import type {
  GenerationProviderCapabilitiesResponse,
  GenerationProviderRuntimePreflightResponse,
} from '../packages/shared/src/providerCapabilities';
import type {
  EditableStudioSettings,
  EditableStudioSettingsPatch,
} from '../packages/shared/src/studioSettings';
import {
  buildStudioSettingsPatch,
  createInitialStudioSettingsFormState,
  getStudioSettingsFormState,
  type StudioSettingsFormState,
} from '../lib/studioSettingsForm';
import {
  STUDIO_SETTINGS_DOMAIN_TABS,
  takeRequestedStudioSettingsDomain,
  type StudioSettingsDomainId,
} from '../lib/studioSettingsDomains';
import { SettingsFormPanel } from './settings/SettingsFormPanel';
import { SettingsOutputSourcesPanel } from './settings/SettingsOutputSourcesPanel';
import { SettingsExtensionsPanel } from './settings/SettingsExtensionsPanel';
import {
  SettingsMaintenancePanel,
  type SettingsMaintenancePanelProps,
} from './settings/SettingsMaintenancePanel';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface StudioSettingsModalProps {
  onExportLegacyWorkspaceSnapshot: () => void;
  isOpen: boolean;
  onClose: () => void;
  settings: EditableStudioSettings | null;
  libraryDir: string | null;
  isLoading: boolean;
  isSaving: boolean;
  providerCapabilities: GenerationProviderCapabilitiesResponse | null;
  providerRuntimePreflight: GenerationProviderRuntimePreflightResponse | null;
  outputSources: ExternalOutputSourcesResponse | null;
  outputSourceFiles: Record<string, ExternalOutputSourceFile[]>;
  isLoadingOutputSources: boolean;
  loadingOutputSourceFiles: Record<string, boolean>;
  isRegisteringOutputSource: boolean;
  importingOutputSources: Record<string, boolean>;
  error: string | null;
  onRefresh: () => void | Promise<void>;
  onUpdate: (patch: EditableStudioSettingsPatch) => void | Promise<void | boolean>;
  onRegisterOutputSource: (input: RegisterExternalOutputSourceInput) => void | Promise<void>;
  onLoadOutputSourceFiles: (sourceId: string) => void | Promise<void>;
  onImportOutputSourceFiles: (
    sourceId: string,
    files: string[],
    workspaceId?: string | null,
  ) => void | Promise<void>;
  maintenance: SettingsMaintenancePanelProps['maintenance'];
  onResetStudio: () => void | Promise<void>;
  isResettingStudio: boolean;
}

const SETTINGS_SEARCH_ITEMS: {
  domain: StudioSettingsDomainId;
  label: string;
  description: string;
  target: string;
}[] = [
  {
    domain: 'general',
    label: 'Startup workflow',
    description: 'Choose what opens first',
    target: 'Startup workflow',
  },
  {
    domain: 'general',
    label: 'Default style intensity',
    description: 'Strength of newly added styles',
    target: 'Default style intensity',
  },
  {
    domain: 'general',
    label: 'Default style reference mode',
    description: 'Preserve or reinterpret references',
    target: 'Default style reference mode',
  },
  {
    domain: 'general',
    label: 'Detailed style instructions',
    description: 'Experimental style compiler',
    target: 'Detailed style instructions',
  },
  {
    domain: 'appearance',
    label: 'Theme',
    description: 'Light or dark appearance',
    target: 'Theme',
  },
  {
    domain: 'appearance',
    label: 'Accent color',
    description: 'Workspace colors',
    target: 'Accent: Apricot',
  },
  {
    domain: 'appearance',
    label: 'Motion',
    description: 'Animation and reduced movement',
    target: 'Motion preference',
  },
  {
    domain: 'appearance',
    label: 'Tools panel position',
    description: 'Left or right side',
    target: 'Tools panel position',
  },
  {
    domain: 'appearance',
    label: 'Jobs panel position',
    description: 'Left or right side',
    target: 'Jobs panel position',
  },
  {
    domain: 'appearance',
    label: 'Compact workspace controls',
    description: 'Control density',
    target: 'Compact workspace controls',
  },
  {
    domain: 'appearance',
    label: 'Show all workspace results',
    description: 'Carousel history across workflows',
    target: 'Show all workspace results',
  },
  {
    domain: 'appearance',
    label: 'Clear review list on startup',
    description: 'Hide past review and failed jobs',
    target: 'Clear review list on startup',
  },
  {
    domain: 'providers',
    label: 'Accounts and sign in',
    description: 'Provider connections and setup',
    target: '',
  },
  {
    domain: 'providers',
    label: 'Default provider',
    description: 'Choose who generates your images',
    target: '',
  },
  {
    domain: 'providers',
    label: 'Models and execution',
    description: 'Generation defaults and quality',
    target: 'Model and execution settings',
  },
  {
    domain: 'output',
    label: 'Output directory',
    description: 'Where new images are saved',
    target: 'Output directory',
  },
  {
    domain: 'output',
    label: 'Folder structure',
    description: 'Organize files by workspace, date or workflow',
    target: 'Output folder preset',
  },
  {
    domain: 'output',
    label: 'Filename preset',
    description: 'Choose how images are named',
    target: 'Filename preset',
  },
  {
    domain: 'output',
    label: 'File name template',
    description: 'Custom naming tokens',
    target: 'File name template',
  },
  {
    domain: 'library',
    label: 'External folder to scan',
    description: 'Find images to import',
    target: 'External folder to scan',
  },
  {
    domain: 'library',
    label: 'Discover external images',
    description: 'Automatic import discovery',
    target: 'Discover external images',
  },
  {
    domain: 'library',
    label: 'Import sources',
    description: 'Register a folder or import images',
    target: '',
  },
  {
    domain: 'library',
    label: 'Export workspace metadata',
    description: 'Legacy settings snapshot without images',
    target: 'Export workspace metadata',
  },
  {
    domain: 'extensions',
    label: 'Style packs',
    description: 'Installed styles and downloads',
    target: '',
  },
  {
    domain: 'extensions',
    label: 'Workflow modules',
    description: 'Enable or disable workflows',
    target: 'Workflow modules',
  },
  {
    domain: 'maintenance',
    label: 'Agent access (MCP)',
    description: 'Local agent permissions and automation',
    target: 'Agent access (MCP)',
  },
  {
    domain: 'maintenance',
    label: 'Storage audit',
    description: 'Inspect library storage',
    target: 'Audit storage',
  },
  {
    domain: 'maintenance',
    label: 'Database cleanup',
    description: 'Plan storage compaction',
    target: 'Plan database cleanup',
  },
  {
    domain: 'maintenance',
    label: 'Missing thumbnails',
    description: 'Preview thumbnail repair',
    target: 'Plan missing thumbnails',
  },
  {
    domain: 'maintenance',
    label: 'Diagnostic logs',
    description: 'Remove old tooling logs',
    target: 'Prune diagnostic logs',
  },
  {
    domain: 'maintenance',
    label: 'Rebuild Library',
    description: 'Repair the library index',
    target: 'Rebuild Library',
  },
  {
    domain: 'help',
    label: 'Update notifications',
    description: 'Check for new versions automatically',
    target: 'Notify me about updates',
  },
  {
    domain: 'help',
    label: 'Studio updates',
    description: 'Check, update or restart Studio',
    target: 'Check for updates',
  },
  {
    domain: 'help',
    label: 'Getting started',
    description: 'Workflows, references and results',
    target: 'Getting started with Studio',
  },
];

function SettingsDomainContent({
  activeDomain,
  formState,
  setFormState,
  hasChanges,
  providerOptions,
  modal,
}: {
  activeDomain: StudioSettingsDomainId;
  formState: StudioSettingsFormState;
  setFormState: React.Dispatch<React.SetStateAction<StudioSettingsFormState>>;
  hasChanges: boolean;
  providerOptions: string[];
  modal: StudioSettingsModalProps;
}) {
  const {
    isSaving,
    settings,
    libraryDir,
    providerCapabilities,
    providerRuntimePreflight,
    outputSources,
    outputSourceFiles,
    loadingOutputSourceFiles,
    importingOutputSources,
    isLoadingOutputSources,
    isRegisteringOutputSource,
    onLoadOutputSourceFiles,
    onImportOutputSourceFiles,
    onRegisterOutputSource,
    onExportLegacyWorkspaceSnapshot,
    maintenance,
    isResettingStudio,
    onResetStudio,
  } = modal;
  const formDisabled = isSaving || !settings;
  return (
    <>
      {activeDomain === 'general' && (
        <fieldset disabled={formDisabled}>
          <SettingsGeneralPanel value={formState} onChange={setFormState} />
        </fieldset>
      )}
      {activeDomain === 'help' && (
        <div className="settings-form-stack">
          <fieldset disabled={formDisabled}>
            <label className="settings-row">
              <span>
                <strong>Notify me about updates</strong>
                <small>Check at startup and hourly.</small>
              </span>
              <input
                type="checkbox"
                aria-label="Notify me about updates"
                checked={formState.notifyOnUpdates}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    notifyOnUpdates: event.target.checked,
                  }))
                }
              />
            </label>
          </fieldset>
          <SettingsUpdatesPanel hasUnsavedChanges={hasChanges} />
          <StudioHelpGuide />
        </div>
      )}
      {activeDomain === 'appearance' ||
      activeDomain === 'library' ||
      activeDomain === 'providers' ||
      activeDomain === 'output' ? (
        <div className={activeDomain === 'output' ? 'grid gap-4' : undefined}>
          <fieldset disabled={formDisabled} className="min-w-0">
            <SettingsFormPanel
              domain={activeDomain}
              formState={formState}
              onFormChange={setFormState}
              libraryDir={libraryDir}
              providerOptions={providerOptions}
              providerCapabilities={providerCapabilities}
              providerRuntimePreflight={providerRuntimePreflight}
            />
          </fieldset>
          {activeDomain === 'library' ? (
            <SettingsOutputSourcesPanel
              outputSources={outputSources}
              outputSourceFiles={outputSourceFiles}
              loadingOutputSourceFiles={loadingOutputSourceFiles}
              importingOutputSources={importingOutputSources}
              isLoadingOutputSources={isLoadingOutputSources}
              isRegisteringOutputSource={isRegisteringOutputSource}
              onLoadOutputSourceFiles={onLoadOutputSourceFiles}
              onImportOutputSourceFiles={onImportOutputSourceFiles}
              onRegisterOutputSource={onRegisterOutputSource}
            />
          ) : null}
        </div>
      ) : null}
      {activeDomain === 'library' && (
        <details className="settings-disclosure mt-4">
          <summary>Export workspace metadata</summary>
          <p className="my-2 text-xs studio-muted">
            Exports settings only. Image files are not included; this is not a library backup.
          </p>
          <button
            type="button"
            className="studio-ghost-control px-3"
            aria-label="Export workspace metadata"
            onClick={onExportLegacyWorkspaceSnapshot}
          >
            Export legacy snapshot
          </button>
        </details>
      )}
      {activeDomain === 'extensions' ? <SettingsExtensionsPanel /> : null}
      {activeDomain === 'maintenance' ? (
        <div className="settings-form-stack">
          <fieldset className="settings-group" disabled={formDisabled}>
            <h3>Local agents</h3>
            <label className="settings-row">
              <span>
                <strong>Agent access (MCP)</strong>
                <small>
                  Read only lets agents inspect Studio. Generate and cancel also uses your provider
                  account.
                </small>
              </span>
              <select
                className="studio-field"
                aria-label="Agent access (MCP)"
                value={formState.mcpAccess}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    mcpAccess: event.target.value as StudioSettingsFormState['mcpAccess'],
                  }))
                }
              >
                <option value="off">Off</option>
                <option value="read">Read only</option>
                <option value="write">Generate and cancel</option>
              </select>
            </label>
          </fieldset>
          <SettingsMaintenancePanel maintenance={maintenance} />
          <details className="settings-disclosure">
            <summary>Repair library</summary>
            <p className="studio-muted text-sm mb-3">
              Rebuild the library index from saved files. Review the confirmation before continuing.
            </p>
            <button
              type="button"
              className="studio-ghost-control px-3"
              aria-label="Rebuild Library"
              disabled={isResettingStudio || isSaving}
              onClick={() => void onResetStudio()}
            >
              {isResettingStudio ? 'Rebuilding…' : 'Rebuild Library'}
            </button>
          </details>
        </div>
      ) : null}
    </>
  );
}

function SettingsSearch({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (domain: StudioSettingsDomainId, target: string) => void;
}) {
  const query = value.trim().toLowerCase();
  return (
    <div className="settings-search">
      <input
        className="studio-field"
        type="search"
        aria-label="Search settings"
        placeholder="Search settings…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value.trim() && (
        <div className="settings-search-results" aria-label="Settings search results">
          {SETTINGS_SEARCH_ITEMS.filter((item) =>
            `${item.label} ${item.description}`.toLowerCase().includes(query),
          ).map((item) => (
            <button
              key={item.label}
              type="button"
              className="studio-menu-item"
              onClick={() => onSelect(item.domain, item.target)}
            >
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </button>
          ))}
          {!SETTINGS_SEARCH_ITEMS.some((item) =>
            `${item.label} ${item.description}`.toLowerCase().includes(query),
          ) && <p role="status">No settings match this search.</p>}
        </div>
      )}
    </div>
  );
}

export const StudioSettingsModal: React.FC<StudioSettingsModalProps> = (props) => {
  const { isOpen, onClose, settings, isLoading, isSaving, error, onRefresh, onUpdate } = props;
  const [formState, setFormState] = useState<StudioSettingsFormState>(
    createInitialStudioSettingsFormState,
  );
  const [activeDomain, setActiveDomain] = useState<StudioSettingsDomainId>('general');
  useEffect(() => {
    if (!isOpen) return;
    const requested = takeRequestedStudioSettingsDomain();
    if (requested) setActiveDomain(requested);
  }, [isOpen]);
  const { preferences, savedPreferences, previewPreferences, commitPreferences } = useTheme();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) previewPreferences(null);
  }, [isOpen, previewPreferences]);
  useEffect(() => () => previewPreferences(null), [previewPreferences]);
  const dirtyRef = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    if (isSaving) return;
    if (dirtyRef.current) setConfirmDiscard(true);
    else onClose();
  };
  const dialogRef = useDialogFocus<HTMLDialogElement>(
    isOpen,
    requestClose,
    undefined,
    '[aria-label="Close settings"]',
  );

  const searchTarget = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (searchTarget.current === null) return;
    const target = searchTarget.current;
    searchTarget.current = null;
    const panel = dialogRef.current?.querySelector<HTMLElement>('.studio-settings-content');
    const control = target
      ? panel?.querySelector<HTMLElement>(`[aria-label="${target}"]`)
      : panel?.querySelector<HTMLElement>('button, input, select');
    for (
      let ancestor = control?.parentElement;
      ancestor && ancestor !== panel;
      ancestor = ancestor.parentElement
    ) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    }
    (control ?? panel)?.focus();
    control?.scrollIntoView({ block: 'nearest' });
  }, [activeDomain, search, dialogRef]);

  const [savedForm, setSavedForm] = useState(createInitialStudioSettingsFormState);
  const savedFormRef = useRef(savedForm);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (isOpen && settings) {
      const next = getStudioSettingsFormState(settings);
      const reopening = !wasOpen.current;
      setFormState((current) =>
        reopening || JSON.stringify(current) === JSON.stringify(savedFormRef.current)
          ? next
          : current,
      );
      savedFormRef.current = next;
      setSavedForm(next);
    }
    wasOpen.current = isOpen;
  }, [isOpen, settings]);
  const hasChanges =
    JSON.stringify(preferences) !== JSON.stringify(savedPreferences) ||
    JSON.stringify(buildStudioSettingsPatch(formState)) !==
      JSON.stringify(buildStudioSettingsPatch(savedForm));
  useLayoutEffect(() => {
    dirtyRef.current = hasChanges;
  }, [hasChanges]);
  const fileNameError = validateOutputTemplate(formState.outputFileNameTemplate);

  const { defaultProviderId, providerDefaults } = formState;

  const providerOptions = useMemo(
    () =>
      [...BUILT_IN_GENERATION_PROVIDERS, ...Object.keys(providerDefaults), defaultProviderId]
        .filter((providerId, index, all) => all.indexOf(providerId) === index)
        .sort(compareGenerationProviderPresentation),
    [defaultProviderId, providerDefaults],
  );
  if (!isOpen) return null;

  const canSave = hasChanges && !fileNameError && Boolean(settings) && !isSaving && !isLoading;
  const handleSave = async () => {
    if (!canSave) return;
    const nextAppearance = { ...preferences };
    const saved = await onUpdate(buildStudioSettingsPatch(formState));
    if (saved !== false) commitPreferences(nextAppearance);
  };

  return (
    <dialog
      aria-modal="true"
      ref={dialogRef}
      aria-labelledby="studio-settings-title"
      tabIndex={-1}
      className="studio-modal fixed inset-0 z-100 flex items-center justify-center studio-scrim p-4"
    >
      <div className="studio-dialog studio-settings-dialog">
        <div className="studio-dialog-header">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded studio-ghost-control text-[color:var(--wb-accent)]">
              <Settings width={18} height={18} />
            </div>
            <div>
              <h2 id="studio-settings-title" className="studio-dialog-title">
                Studio Settings
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Refresh settings"
              onClick={() => void onRefresh()}
              disabled={isLoading}
              className="studio-ghost-control disabled:opacity-60"
            >
              {isLoading ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <RefreshCw width={16} height={16} />
              )}
            </button>
            <button
              type="button"
              aria-label="Close settings"
              onClick={requestClose}
              className="studio-ghost-control"
            >
              <X width={18} height={18} />
            </button>
          </div>
        </div>

        <SettingsSearch
          value={search}
          onChange={setSearch}
          onSelect={(domain, target) => {
            setActiveDomain(domain);
            setSearch('');
            searchTarget.current = target;
          }}
        />
        <div className="studio-settings-layout">
          <label className="studio-settings-section-select">
            <span>Section</span>
            <select
              className="studio-field"
              aria-label="Settings section"
              value={activeDomain}
              onChange={(event) => setActiveDomain(event.target.value as StudioSettingsDomainId)}
            >
              {STUDIO_SETTINGS_DOMAIN_TABS.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.label}
                </option>
              ))}
            </select>
          </label>
          <nav className="studio-settings-nav" aria-label="Settings sections">
            {STUDIO_SETTINGS_DOMAIN_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveDomain(tab.id)}
                aria-pressed={activeDomain === tab.id}
                className={`studio-tab ${activeDomain === tab.id ? 'is-active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div
            tabIndex={-1}
            aria-busy={isLoading || isSaving}
            data-motion-panel
            key={activeDomain}
            className="studio-dialog-body studio-settings-content custom-scrollbar"
          >
            {error && (
              <div
                role="alert"
                className="mb-4 rounded-[var(--wb-radius)] border border-rose-500/2 bg-rose-500/10 px-4 py-3 text-xs font-bold text-[color:var(--wb-danger)] "
              >
                {error}
              </div>
            )}

            <SettingsDomainContent
              activeDomain={activeDomain}
              formState={formState}
              setFormState={setFormState}
              hasChanges={hasChanges}
              providerOptions={providerOptions}
              modal={props}
            />
          </div>
        </div>
        <div className="studio-dialog-actions">
          <span role="status" className="mr-auto text-xs studio-muted">
            {isSaving ? 'Saving settings…' : hasChanges ? 'Unsaved changes' : 'No unsaved changes'}
          </span>
          <button
            type="button"
            disabled={!hasChanges || isSaving}
            className="studio-ghost-control px-4"
            onClick={() => {
              setFormState(savedForm);
              previewPreferences(null);
            }}
          >
            Discard
          </button>
          <button type="button" onClick={requestClose} className="studio-ghost-control px-4">
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="studio-primary-control disabled:opacity-60"
          >
            {isSaving ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <Save width={15} height={15} />
            )}
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <ConfirmationModal
        isOpen={confirmDiscard}
        title="Discard unsaved settings?"
        description="Your saved settings will stay unchanged."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="warning"
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          previewPreferences(null);
          onClose();
        }}
      />
    </dialog>
  );
};
