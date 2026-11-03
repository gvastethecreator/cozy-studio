import { CozyLoader as LoaderCircle } from './CozyMascot';
import { useTheme } from '../hooks/useTheme';
import { validateOutputTemplate } from '../packages/shared/src/outputLayout';
import { SettingsGeneralPanel } from './settings/SettingsGeneralPanel';
import { SettingsOrganizationPanel } from './settings/SettingsOrganizationPanel';
import { SettingsUpdatesPanel } from './settings/SettingsUpdatesPanel';
import { SettingsDuplicatesPanel } from './settings/SettingsDuplicatesPanel';
import { SettingsLibraryArchivePanel } from './settings/SettingsLibraryArchivePanel';
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
import { useT } from '../lib/i18n';
import { en, type MessageKey } from '../lib/i18n/en';
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
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  target: string;
}[] = [
  {
    domain: 'organization',
    labelKey: 'settings.search.organization.label',
    descriptionKey: 'settings.search.organization.description',
    target: 'Manage tags',
  },
  {
    domain: 'general',
    labelKey: 'settings.search.language.label',
    descriptionKey: 'settings.search.language.description',
    target: 'settings.language.label',
  },
  {
    domain: 'general',
    labelKey: 'settings.search.startupWorkflow.label',
    descriptionKey: 'settings.search.startupWorkflow.description',
    target: 'settings.general.startupWorkflow',
  },
  {
    domain: 'general',
    labelKey: 'settings.search.styleIntensity.label',
    descriptionKey: 'settings.search.styleIntensity.description',
    target: 'settings.general.styleIntensity',
  },
  {
    domain: 'general',
    labelKey: 'settings.search.referenceMode.label',
    descriptionKey: 'settings.search.referenceMode.description',
    target: 'settings.general.referenceMode',
  },
  {
    domain: 'general',
    labelKey: 'settings.search.detailedInstructions.label',
    descriptionKey: 'settings.search.detailedInstructions.description',
    target: 'settings.general.detailedInstructions',
  },
  {
    domain: 'appearance',
    labelKey: 'settings.search.theme.label',
    descriptionKey: 'settings.search.theme.description',
    target: 'Theme',
  },
  {
    domain: 'appearance',
    labelKey: 'settings.search.accent.label',
    descriptionKey: 'settings.search.accent.description',
    target: 'Accent: Violet',
  },
  {
    domain: 'appearance',
    labelKey: 'settings.search.motion.label',
    descriptionKey: 'settings.search.motion.description',
    target: 'Motion preference',
  },
  {
    domain: 'appearance',
    labelKey: 'settings.search.zoom.label',
    descriptionKey: 'settings.search.zoom.description',
    target: 'settings.appearance.zoomSensitivity',
  },
  {
    domain: 'appearance',
    labelKey: 'settings.search.toolsPosition.label',
    descriptionKey: 'settings.search.toolsPosition.description',
    target: 'Tools panel position',
  },
  {
    domain: 'appearance',
    labelKey: 'settings.search.jobsPosition.label',
    descriptionKey: 'settings.search.jobsPosition.description',
    target: 'Jobs panel position',
  },
  {
    domain: 'appearance',
    labelKey: 'settings.search.compactControls.label',
    descriptionKey: 'settings.search.compactControls.description',
    target: 'Compact workspace controls',
  },
  {
    domain: 'appearance',
    labelKey: 'settings.search.allResults.label',
    descriptionKey: 'settings.search.allResults.description',
    target: 'Show all workspace results',
  },
  {
    domain: 'appearance',
    labelKey: 'settings.search.clearReview.label',
    descriptionKey: 'settings.search.clearReview.description',
    target: 'Clear review list on startup',
  },
  {
    domain: 'providers',
    labelKey: 'settings.search.accounts.label',
    descriptionKey: 'settings.search.accounts.description',
    target: '',
  },
  {
    domain: 'providers',
    labelKey: 'settings.search.defaultProvider.label',
    descriptionKey: 'settings.search.defaultProvider.description',
    target: '',
  },
  {
    domain: 'providers',
    labelKey: 'settings.search.models.label',
    descriptionKey: 'settings.search.models.description',
    target: 'Model and execution settings',
  },
  {
    domain: 'output',
    labelKey: 'settings.search.outputDirectory.label',
    descriptionKey: 'settings.search.outputDirectory.description',
    target: 'Output directory',
  },
  {
    domain: 'output',
    labelKey: 'settings.search.folderStructure.label',
    descriptionKey: 'settings.search.folderStructure.description',
    target: 'Output folder preset',
  },
  {
    domain: 'output',
    labelKey: 'settings.search.filenamePreset.label',
    descriptionKey: 'settings.search.filenamePreset.description',
    target: 'Filename preset',
  },
  {
    domain: 'output',
    labelKey: 'settings.search.filenameTemplate.label',
    descriptionKey: 'settings.search.filenameTemplate.description',
    target: 'File name template',
  },
  {
    domain: 'library',
    labelKey: 'settings.search.externalFolder.label',
    descriptionKey: 'settings.search.externalFolder.description',
    target: 'External folder to scan',
  },
  {
    domain: 'library',
    labelKey: 'settings.search.discoverImages.label',
    descriptionKey: 'settings.search.discoverImages.description',
    target: 'Discover external images',
  },
  {
    domain: 'library',
    labelKey: 'settings.search.importSources.label',
    descriptionKey: 'settings.search.importSources.description',
    target: '',
  },
  {
    domain: 'library',
    labelKey: 'settings.search.libraryArchive.label',
    descriptionKey: 'settings.search.libraryArchive.description',
    target: 'Export this workspace',
  },
  {
    domain: 'library',
    labelKey: 'settings.search.workspaceMetadata.label',
    descriptionKey: 'settings.search.workspaceMetadata.description',
    target: 'Export workspace metadata',
  },
  {
    domain: 'extensions',
    labelKey: 'settings.search.stylePacks.label',
    descriptionKey: 'settings.search.stylePacks.description',
    target: '',
  },
  {
    domain: 'extensions',
    labelKey: 'settings.search.workflowModules.label',
    descriptionKey: 'settings.search.workflowModules.description',
    target: 'Workflow modules',
  },
  {
    domain: 'maintenance',
    labelKey: 'settings.search.agentAccess.label',
    descriptionKey: 'settings.search.agentAccess.description',
    target: 'settings.agents.access',
  },
  {
    domain: 'maintenance',
    labelKey: 'settings.search.importFolders.label',
    descriptionKey: 'settings.search.importFolders.description',
    target: 'settings.agents.importFolders',
  },
  {
    domain: 'maintenance',
    labelKey: 'settings.search.storageAudit.label',
    descriptionKey: 'settings.search.storageAudit.description',
    target: 'settings.maintenance.audit',
  },
  {
    domain: 'maintenance',
    labelKey: 'settings.search.databaseCleanup.label',
    descriptionKey: 'settings.search.databaseCleanup.description',
    target: 'settings.maintenance.planCleanup',
  },
  {
    domain: 'maintenance',
    labelKey: 'settings.search.missingThumbnails.label',
    descriptionKey: 'settings.search.missingThumbnails.description',
    target: 'settings.maintenance.planThumbnails',
  },
  {
    domain: 'maintenance',
    labelKey: 'settings.search.diagnosticLogs.label',
    descriptionKey: 'settings.search.diagnosticLogs.description',
    target: 'settings.maintenance.pruneLogs',
  },
  {
    domain: 'maintenance',
    labelKey: 'settings.search.rebuild.label',
    descriptionKey: 'settings.search.rebuild.description',
    target: 'settings.maintenance.rebuild',
  },
  {
    domain: 'help',
    labelKey: 'settings.search.updateNotifications.label',
    descriptionKey: 'settings.search.updateNotifications.description',
    target: 'Notify me about updates',
  },
  {
    domain: 'help',
    labelKey: 'settings.search.updates.label',
    descriptionKey: 'settings.search.updates.description',
    target: 'Check for updates',
  },
  {
    domain: 'help',
    labelKey: 'settings.search.gettingStarted.label',
    descriptionKey: 'settings.search.gettingStarted.description',
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
  const { t } = useT();
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
  const domainLabelKey = STUDIO_SETTINGS_DOMAIN_TABS.find(
    (tab) => tab.id === activeDomain,
  )?.labelKey;
  const domainLabel = domainLabelKey ? t(domainLabelKey) : undefined;
  switch (activeDomain) {
    case 'general':
      return (
        <fieldset disabled={formDisabled}>
          <legend className="sr-only">{domainLabel}</legend>
          <SettingsGeneralPanel value={formState} onChange={setFormState} />
        </fieldset>
      );
    case 'help':
      return (
        <div className="settings-form-stack">
          <fieldset disabled={formDisabled}>
            <legend className="sr-only">{domainLabel}</legend>
            <label className="settings-row">
              <span>
                <strong>Notify me about updates</strong>
                <small>Studio checks when it starts; this adds an hourly check.</small>
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
          <SettingsUpdatesPanel
            hasUnsavedChanges={hasChanges}
            channel={formState.updateChannel}
            onChannelChange={(updateChannel) =>
              setFormState((current) => ({ ...current, updateChannel }))
            }
            disabled={formDisabled}
          />
          <StudioHelpGuide />
        </div>
      );
    case 'organization':
      return <SettingsOrganizationPanel />;
    case 'extensions':
      return <SettingsExtensionsPanel />;
    case 'maintenance':
      return (
        <div className="settings-form-stack">
          <fieldset className="settings-group" disabled={formDisabled}>
            <legend className="sr-only">{t('settings.agents.heading')}</legend>
            <h3>{t('settings.agents.heading')}</h3>
            <label className="settings-row">
              <span>
                <strong>{t('settings.agents.access')}</strong>
                <small>{t('settings.agents.accessHint')}</small>
              </span>
              <select
                className="studio-field"
                aria-label={t('settings.agents.access')}
                value={formState.mcpAccess}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    mcpAccess: event.target.value as StudioSettingsFormState['mcpAccess'],
                  }))
                }
              >
                <option value="off">{t('settings.agents.access.off')}</option>
                <option value="read">{t('settings.agents.access.read')}</option>
                <option value="organize">{t('settings.agents.access.organize')}</option>
                <option value="write">{t('settings.agents.access.write')}</option>
              </select>
            </label>
            <label className="settings-row">
              <span>
                <strong>{t('settings.agents.importFolders')}</strong>
                <small>{t('settings.agents.importFoldersHint')}</small>
              </span>
              <textarea
                className="studio-field"
                aria-label={t('settings.agents.importFolders')}
                rows={3}
                value={formState.mcpAllowedImportRoots}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    mcpAllowedImportRoots: event.target.value,
                  }))
                }
              />
            </label>
          </fieldset>
          <SettingsMaintenancePanel maintenance={maintenance} />
          <SettingsDuplicatesPanel />
          <details className="settings-disclosure">
            <summary>{t('settings.maintenance.repairData')}</summary>
            <p className="studio-muted text-sm mb-3">{t('settings.maintenance.rebuildHint')}</p>
            <button
              type="button"
              className="studio-ghost-control px-3"
              aria-label={t('settings.maintenance.rebuild')}
              disabled={isResettingStudio || isSaving}
              onClick={() => void onResetStudio()}
            >
              {isResettingStudio
                ? t('settings.maintenance.rebuilding')
                : t('settings.maintenance.rebuild')}
            </button>
          </details>
        </div>
      );
    default:
      return (
        <div className={activeDomain === 'output' ? 'grid gap-4' : undefined}>
          <fieldset disabled={formDisabled} className="min-w-0">
            <legend className="sr-only">{domainLabel}</legend>
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
          {activeDomain === 'library' && (
            <>
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
              <SettingsLibraryArchivePanel />
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
            </>
          )}
        </div>
      );
  }
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
  const { t } = useT();
  const query = value.trim().toLowerCase();
  return (
    <div className="settings-search">
      <input
        className="studio-field"
        type="search"
        aria-label={t('settings.search.label')}
        placeholder={t('settings.search.placeholder')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value.trim() && (
        <div className="settings-search-results" aria-label={t('settings.search.results')}>
          {SETTINGS_SEARCH_ITEMS.filter((item) =>
            `${t(item.labelKey)} ${t(item.descriptionKey)}`.toLowerCase().includes(query),
          ).map((item) => (
            <button
              key={item.labelKey}
              type="button"
              className="studio-menu-item"
              onClick={() => onSelect(item.domain, item.target)}
            >
              <strong>{t(item.labelKey)}</strong>
              <small>{t(item.descriptionKey)}</small>
            </button>
          ))}
          {!SETTINGS_SEARCH_ITEMS.some((item) =>
            `${t(item.labelKey)} ${t(item.descriptionKey)}`.toLowerCase().includes(query),
          ) && <p role="status">{t('settings.search.empty')}</p>}
        </div>
      )}
    </div>
  );
}

function SettingsDialogActions({
  showChanges,
  hasChanges,
  isSaving,
  fileNameError,
  canSave,
  onFixFileName,
  onDiscard,
  onClose,
  onSave,
}: {
  showChanges: boolean;
  hasChanges: boolean;
  isSaving: boolean;
  fileNameError: string | null;
  canSave: boolean;
  onFixFileName: () => void;
  onDiscard: () => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const { t } = useT();
  return (
    <div className="studio-dialog-actions">
      {showChanges && (
        <>
          <span role="status" className="mr-auto text-xs studio-muted">
            {fileNameError ? (
              <span className="text-[color:var(--wb-danger)]">
                <span className="block">{fileNameError}</span>
                <button
                  type="button"
                  className="studio-hit-target underline"
                  onClick={onFixFileName}
                >
                  {t('settings.chrome.fixFilename')}
                </button>
              </span>
            ) : isSaving ? (
              t('settings.chrome.savingSettings')
            ) : hasChanges ? (
              t('settings.chrome.unsaved')
            ) : null}
          </span>
          <button
            type="button"
            disabled={!hasChanges || isSaving}
            className="studio-ghost-control px-4"
            onClick={onDiscard}
          >
            {t('settings.chrome.discard')}
          </button>
        </>
      )}
      <button type="button" onClick={onClose} className="studio-ghost-control px-4">
        {t('settings.chrome.close')}
      </button>
      {showChanges && (
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="studio-primary-control disabled:opacity-60"
        >
          {isSaving ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <Save width={15} height={15} />
          )}
          {isSaving ? t('settings.chrome.saving') : t('settings.chrome.save')}
        </button>
      )}
    </div>
  );
}

/** `target` is a control's aria-label, or the message key of a translated one. */
function focusSettingsControl(
  dialog: HTMLDialogElement | null,
  target: string,
  translate: (key: MessageKey) => string,
) {
  const panel = dialog?.querySelector<HTMLElement>('.studio-settings-content');
  const label = Object.hasOwn(en, target) ? translate(target as MessageKey) : target;
  const control = target
    ? panel?.querySelector<HTMLElement>(`[aria-label="${label}"]`)
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
}

export const StudioSettingsModal: React.FC<StudioSettingsModalProps> = (props) => {
  const { t } = useT();
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
    `[aria-label="${t('settings.chrome.closeSettings')}"]`,
  );

  const searchTarget = useRef<string | null>(null);
  const selectSearchTarget = (domain: StudioSettingsDomainId, target: string) => {
    if (domain === activeDomain) focusSettingsControl(dialogRef.current, target, t);
    else searchTarget.current = target;
    setActiveDomain(domain);
    setSearch('');
  };
  useLayoutEffect(() => {
    if (searchTarget.current === null) return;
    focusSettingsControl(dialogRef.current, searchTarget.current, t);
    searchTarget.current = null;
  }, [activeDomain, dialogRef, t]);

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
                {t('settings.chrome.title')}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t('settings.chrome.refresh')}
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
              aria-label={t('settings.chrome.closeSettings')}
              onClick={requestClose}
              className="studio-ghost-control"
            >
              <X width={18} height={18} />
            </button>
          </div>
        </div>

        <SettingsSearch value={search} onChange={setSearch} onSelect={selectSearchTarget} />
        <div className="studio-settings-layout">
          <label className="studio-settings-section-select">
            <span>{t('settings.chrome.section')}</span>
            <select
              className="studio-field"
              aria-label={t('settings.chrome.sectionLabel')}
              value={activeDomain}
              onChange={(event) => setActiveDomain(event.target.value as StudioSettingsDomainId)}
            >
              {STUDIO_SETTINGS_DOMAIN_TABS.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {t(tab.labelKey)}
                  {tab.id === 'output' && fileNameError ? ` ${t('settings.chrome.error')}` : ''}
                </option>
              ))}
            </select>
          </label>
          <nav className="studio-settings-nav" aria-label={t('settings.chrome.sections')}>
            {STUDIO_SETTINGS_DOMAIN_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveDomain(tab.id)}
                aria-pressed={activeDomain === tab.id}
                className={`studio-tab ${activeDomain === tab.id ? 'is-active' : ''}`}
              >
                {t(tab.labelKey)}
                {tab.id === 'output' && fileNameError ? (
                  <>
                    {' '}
                    <span className="text-[color:var(--wb-danger)]">
                      {t('settings.chrome.error')}
                    </span>
                  </>
                ) : null}
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
        <SettingsDialogActions
          showChanges={activeDomain !== 'organization' || hasChanges}
          hasChanges={hasChanges}
          isSaving={isSaving}
          fileNameError={fileNameError}
          canSave={canSave}
          onFixFileName={() => selectSearchTarget('output', 'File name template')}
          onDiscard={() => {
            setFormState(savedForm);
            previewPreferences(null);
          }}
          onClose={requestClose}
          onSave={handleSave}
        />
      </div>
      <ConfirmationModal
        isOpen={confirmDiscard}
        title={t('settings.chrome.discardTitle')}
        description={t('settings.chrome.discardDescription')}
        confirmLabel={t('settings.chrome.discardChanges')}
        cancelLabel={t('settings.chrome.keepEditing')}
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
