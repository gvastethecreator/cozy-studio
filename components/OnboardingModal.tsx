import { useDefaultStylePack } from '../hooks/useDefaultStylePack';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { CozyMascot, CozyLoader } from './CozyMascot';
import React from 'react';
import { AnimatePresence, MotionDiv } from '../lib/gsapMotion';
import {
  ArrowRight,
  CheckCircle as CheckCircle2,
  WarningCircle as CircleAlert,
  Circle as CircleDashed,
  PasteClipboard as Clipboard,
  ClipboardCheck,
  Folder,
  Palette,
  MediaImage,
  OpenNewWindow,
  Play,
  Refresh as RefreshCw,
  Sparks as Sparkles,
  Terminal,
  Xmark as X,
} from 'iconoir-react';
import {
  buildCozyStudioSetupPrompt,
  COZY_STUDIO_SETUP_SKILL_PATH,
} from '../lib/onboardingSetupPrompt';
import {
  detectCloudSyncLibraryPath,
  type HealthResponse,
  type LocalCodexSessionResponse,
  type OnboardingCheck,
  type OnboardingProbe,
  type StudioReadinessSnapshot,
} from '../packages/shared/src';
import { resolveOnboardingPrimaryAction } from '../lib/onboardingPrimaryAction';
import { useSubscriptionAuth } from './settings/SubscriptionAuthControls';
import { ProviderBrandMark } from './ProviderBrandMark';
import { useT } from '../lib/i18n';
import { isInstalledStylePack } from '../lib/installedStylePacks';
import { providerBrandChipLabel } from '../lib/providerBrand';
import {
  buildInAppSetupRequest,
  inAppSetupCanSubmit,
  resolveInAppSetupDraftPath,
} from '../lib/onboardingInAppSetup';
import {
  grokRowNeedsInstall,
  grokRowNeedsLogin,
  ONBOARDING_GROK_INSTALL_URL,
} from '../lib/onboardingGrokRow';
import { StudioApiError } from '../services/studio-api/http';
import {
  getEditableStudioSettings,
  updateEditableStudioSettings,
} from '../services/studio-api/settings';
import { listInstalledExtensions } from '../services/studio-api/extensions';
import { cancelSubscriptionAuth, startSubscriptionAuth } from '../services/studio-api/auth';
import { runOnboardingSetup } from '../services/studio-api/runtime';
import { createStudioEventStream } from '../services/studioEventSource';
import {
  appendOnboardingLogLine,
  ONBOARDING_LOG_PANEL_EMPTY,
  onboardingLogLineFromStage,
  onboardingLogLineFromSystemLog,
  type OnboardingLogLine,
} from '../lib/onboardingEventLog';

type OnboardingStatus = 'idle' | 'checking' | 'starting' | 'ready';
type CheckTone = 'ready' | 'warning' | 'error' | 'pending';

const CODEX_RUNTIME_REPAIR_COMMANDS = [
  {
    label: 'Remove old shim',
    command: 'npm uninstall -g codex',
  },
  {
    label: 'Login ChatGPT',
    command: 'codex login',
  },
  {
    label: 'Check runtime',
    command: 'bun run runtime:doctor',
  },
] as const;

interface OnboardingModalProps {
  apiBase: string;
  error: string | null;
  health: HealthResponse | null;
  probe: OnboardingProbe | null;
  localCodexSession: LocalCodexSessionResponse | null;
  readiness: StudioReadinessSnapshot;
  status: OnboardingStatus;
  isDesktopRuntime: boolean;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onRefresh: () => void;
  onStartAppServer: () => void;
  onOpenSettings: () => void;
  onOpenStylePacks: () => void;
}

function getToneIcon(tone: CheckTone) {
  if (tone === 'ready') return CheckCircle2;
  if (tone === 'pending') return CircleDashed;
  return CircleAlert;
}

function CheckRow({
  detail,
  icon,
  meta,
  status,
  title,
  tone,
}: {
  detail: string;
  icon: React.ReactNode;
  meta?: string | null;
  status: string;
  title: string;
  tone: CheckTone;
}) {
  const StatusIcon = getToneIcon(tone);
  const toneClass = {
    ready: 'text-[color:var(--wb-success)] ',
    warning: 'text-[color:var(--wb-warning)] ',
    error: 'text-[color:var(--wb-danger)] ',
    pending: 'text-[color:var(--wb-muted)]',
  }[tone];

  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-start gap-4 border-b border-[color:var(--wb-line)] py-5 last:border-b-0 xl:grid-cols-[36px_minmax(0,1fr)_auto] xl:gap-3 xl:py-3">
      <div className="grid size-11 place-items-center rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] text-[color:var(--wb-ink)] xl:size-9 xl:rounded-[var(--wb-radius)]">
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-[color:var(--wb-ink)] ">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-[color:var(--wb-muted)] xl:mt-0.5  ">{detail}</p>
        {meta ? (
          <p className="mt-2 inline-flex max-w-full rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-2.5 py-1 font-mono text-sm text-[color:var(--wb-muted)] xl:mt-1 xl:max-w-[18rem] ">
            <span className="truncate">{meta}</span>
          </p>
        ) : null}
      </div>
      <div className={`flex items-center gap-2 pt-1 text-sm  ${toneClass}`}>
        <span className="hidden sm:inline">{status}</span>
        <StatusIcon width={16} height={16} />
      </div>
    </div>
  );
}

/** Shows the registered destination, including the Pictures folder detected during setup. */
function ImagesFolderRow({ isOpen }: { isOpen: boolean }) {
  const [folder, setFolder] = React.useState<string | null | undefined>(undefined);
  const [draft, setDraft] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setError(null);
    setFolder(undefined);
    getEditableStudioSettings()
      .then((settings) => {
        if (!cancelled) setFolder(settings.outputDirectory);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Could not read the images folder.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await updateEditableStudioSettings({ outputDirectory: draft.trim() || null });
      setFolder(saved.outputDirectory);
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="onboarding-connection">
      <span className="onboarding-connection-icon" aria-hidden="true">
        <Folder width={18} height={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h3>Images folder</h3>
        {editing ? (
          <input
            className="studio-field mt-2 w-full font-mono text-sm"
            aria-label="Images folder"
            value={draft}
            placeholder="Absolute folder path"
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : (
          <p className="break-all font-mono">
            {folder === undefined
              ? error
                ? 'Images folder unavailable.'
                : 'Checking…'
              : (folder ?? 'Inside the Studio data folder, in its outputs folder.')}
          </p>
        )}
        {error ? (
          <p role="alert" className="text-[color:var(--wb-danger)]">
            {error}
          </p>
        ) : null}
      </div>
      {editing ? (
        <div className="flex gap-2">
          <button
            type="button"
            className="studio-ghost-control onboarding-connections-button px-3"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="studio-primary-control onboarding-connections-button px-3"
            onClick={() => void save()}
            disabled={saving || !draft.trim()}
          >
            {saving ? 'Saving…' : 'Use this folder'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="studio-ghost-control onboarding-connections-button px-3"
          onClick={() => {
            setDraft(folder ?? '');
            setEditing(true);
          }}
          disabled={folder === undefined && !error}
        >
          Change
        </button>
      )}
    </div>
  );
}

type SetupTone = 'success' | 'info' | 'warning' | 'danger' | 'muted';

/** One setup card: icon, title with its status, what happens and why, and one main action. */
function SetupRow({
  icon,
  title,
  status,
  children,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  status?: { tone: SetupTone; label: string };
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="onboarding-connection">
      <span className="onboarding-connection-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="onboarding-connection-title">
          <h3>{title}</h3>
          {status ? (
            <span className="onboarding-status" data-tone={status.tone}>
              {status.label}
            </span>
          ) : null}
        </div>
        {children}
      </div>
      {actions ? <div className="onboarding-connection-actions">{actions}</div> : null}
    </div>
  );
}

const ROW_PRIMARY = 'studio-primary-control onboarding-connections-button';
const ROW_GHOST = 'studio-ghost-control onboarding-connections-button';

/** ChatGPT web sign-in, the default provider. Studio polls until the browser step finishes. */
function ChatGptRow({
  isReady,
  onRefresh,
  onOpenProviders,
}: {
  isReady: boolean;
  onRefresh: () => void;
  onOpenProviders: () => void;
}) {
  const { t } = useT();
  const { status, error, copied, busy, isLoadingStatus, browserUrl, run, copyCode, loadStatus } =
    useSubscriptionAuth('codex');
  const state = status?.status ?? null;
  const pending = state === 'pending' && browserUrl ? status : null;

  // The footer and auto-close read onboarding readiness, which only changes on a health refresh.
  const refreshReadiness = React.useEffectEvent(() => {
    if (!isReady) onRefresh();
  });
  React.useEffect(() => {
    if (state === 'logged_in') refreshReadiness();
  }, [state]);

  const view = pending
    ? {
        tone: 'info' as const,
        label: t('onboarding.status.waiting'),
        detail: pending.userCode
          ? t('onboarding.chatgpt.pendingCode')
          : t('onboarding.chatgpt.pendingApprove'),
      }
    : state === 'logged_in'
      ? {
          tone: 'success' as const,
          label: t('onboarding.status.signedIn'),
          detail: status?.accountLabel
            ? t('onboarding.chatgpt.signedInAs', { account: status.accountLabel })
            : t('onboarding.chatgpt.signedIn'),
        }
      : state === 'refresh_failed'
        ? {
            tone: 'danger' as const,
            label: t('onboarding.status.expired'),
            detail: t('onboarding.chatgpt.expired'),
          }
        : state === null && !isLoadingStatus
          ? {
              tone: 'danger' as const,
              label: t('onboarding.status.unavailable'),
              detail: t('onboarding.chatgpt.statusError'),
            }
          : state === null
            ? {
                tone: 'muted' as const,
                label: t('onboarding.status.checking'),
                detail: t('onboarding.chatgpt.checking'),
              }
            : {
                tone: 'muted' as const,
                label: t('onboarding.status.notSignedIn'),
                detail: t('onboarding.chatgpt.signedOut'),
              };
  const alert = error || status?.lastError;

  const actions = pending ? (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => cancelSubscriptionAuth('codex'))}
        className={ROW_GHOST}
      >
        {t('onboarding.chatgpt.cancel')}
      </button>
      <a href={browserUrl ?? undefined} target="_blank" rel="noreferrer" className={ROW_PRIMARY}>
        <OpenNewWindow width={15} height={15} aria-hidden="true" />
        {t('onboarding.chatgpt.open')}
      </a>
    </>
  ) : state === 'logged_in' ? (
    <button type="button" onClick={onOpenProviders} className={ROW_GHOST}>
      {t('onboarding.manage')}
    </button>
  ) : state === null && !isLoadingStatus ? (
    <button type="button" onClick={() => void loadStatus()} className={ROW_GHOST}>
      {t('onboarding.retry')}
    </button>
  ) : (
    <button
      type="button"
      disabled={busy || isLoadingStatus}
      onClick={() => void run(() => startSubscriptionAuth('codex'))}
      className={ROW_PRIMARY}
    >
      {state === 'refresh_failed'
        ? t('onboarding.chatgpt.signInAgain')
        : t('onboarding.chatgpt.signIn')}
    </button>
  );

  return (
    <SetupRow
      icon={<ProviderBrandMark providerId="chatgpt" size="sm" />}
      title={providerBrandChipLabel('chatgpt')}
      status={{ tone: view.tone, label: view.label }}
      actions={actions}
    >
      <p>{view.detail}</p>
      {pending?.userCode ? (
        <div className="onboarding-code">
          <code>{pending.userCode}</code>
          <button
            type="button"
            onClick={() => void copyCode()}
            aria-label={t('onboarding.chatgpt.copyCode')}
            className="studio-ghost-control onboarding-code-copy"
          >
            {copied ? (
              <ClipboardCheck width={16} height={16} />
            ) : (
              <Clipboard width={16} height={16} />
            )}
          </button>
          <span role="status" aria-live="polite" className="sr-only">
            {copied ? t('onboarding.chatgpt.codeCopied') : ''}
          </span>
        </div>
      ) : null}
      {alert ? (
        <p role="alert" className="onboarding-alert">
          {alert}
        </p>
      ) : null}
      {pending || state === 'logged_in' ? null : (
        <button type="button" onClick={onOpenProviders} className="onboarding-link">
          {t('onboarding.otherProvider')}
        </button>
      )}
    </SetupRow>
  );
}

/** Any other default provider: its setup lives in Settings, Providers and the footer action. */
function ProviderRow({
  providerId,
  isReady,
  onOpenProviders,
}: {
  providerId: string;
  isReady: boolean;
  onOpenProviders: () => void;
}) {
  const { t } = useT();
  const provider = providerBrandChipLabel(providerId);
  return (
    <SetupRow
      icon={<ProviderBrandMark providerId={providerId} size="sm" />}
      title={provider}
      status={
        isReady
          ? { tone: 'success', label: t('onboarding.status.ready') }
          : { tone: 'warning', label: t('onboarding.status.needsSetup') }
      }
      actions={
        <button type="button" onClick={onOpenProviders} className={ROW_GHOST}>
          {t('onboarding.manage')}
        </button>
      }
    >
      <p>
        {isReady
          ? t('onboarding.provider.ready', { provider })
          : t('onboarding.provider.setup', { provider })}
      </p>
    </SetupRow>
  );
}

interface StylePackListing {
  packs: number;
  styles: number;
  /** Installed packs this page has not loaded: Studio reads them once at startup (ADR 0011). */
  unloaded: { name: string; styles: number }[];
}

function StylePacksRow({ isOpen, onOpen }: { isOpen: boolean; onOpen: () => void }) {
  const { t } = useT();
  const [listing, setListing] = React.useState<StylePackListing | 'loading' | 'error'>('loading');
  const empty = typeof listing === 'object' && listing.packs === 0;
  // With no pack yet, Studio installs Essentials in the background; follow its progress.
  const defaultPack = useDefaultStylePack(isOpen && empty);
  const essentialsInstalled = defaultPack?.state === 'installed';

  React.useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    listInstalledExtensions({ signal: controller.signal })
      .then(({ extensions }) => {
        const packs = extensions.flatMap((item) =>
          item.kind === 'style-pack' ? [item.stylePack] : [],
        );
        setListing({
          packs: packs.length,
          styles: packs.reduce((total, pack) => total + pack.presetCount, 0),
          unloaded: packs
            .filter((pack) => !isInstalledStylePack(pack.id))
            .map((pack) => ({ name: pack.name, styles: pack.presetCount })),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setListing('error');
      });
    return () => controller.abort();
  }, [isOpen, essentialsInstalled]);

  const openPacks = (label: string, primary = false) => (
    <button type="button" onClick={onOpen} className={primary ? ROW_PRIMARY : ROW_GHOST}>
      {label}
    </button>
  );
  const row = (
    detail: string,
    status?: { tone: SetupTone; label: string },
    actions?: React.ReactNode,
  ) => (
    <SetupRow
      icon={<Palette width={18} height={18} />}
      title={t('onboarding.stylePacks.title')}
      status={status}
      actions={actions}
    >
      <p>{detail}</p>
    </SetupRow>
  );

  if (listing === 'loading') return row(t('onboarding.stylePacks.checking'));
  if (listing === 'error')
    return row(
      t('onboarding.stylePacks.error'),
      { tone: 'danger', label: t('onboarding.status.unavailable') },
      openPacks(t('onboarding.stylePacks.open')),
    );
  if (listing.unloaded.length > 0) {
    const [first] = listing.unloaded;
    return row(
      listing.unloaded.length === 1
        ? t('onboarding.stylePacks.reloadOne', { name: first.name, count: first.styles })
        : t('onboarding.stylePacks.reloadMany', {
            count: listing.unloaded.reduce((total, pack) => total + pack.styles, 0),
          }),
      { tone: 'warning', label: t('onboarding.status.reloadNeeded') },
      <button type="button" onClick={() => window.location.reload()} className={ROW_PRIMARY}>
        <RefreshCw width={15} height={15} aria-hidden="true" />
        {t('onboarding.stylePacks.reload')}
      </button>,
    );
  }
  if (listing.packs > 0)
    return row(
      t('onboarding.stylePacks.ready', { count: listing.packs, styles: listing.styles }),
      { tone: 'success', label: t('onboarding.status.ready') },
      openPacks(t('onboarding.manage')),
    );
  // Installed with no listing yet: the effect above is fetching the new listing.
  if (defaultPack === null || essentialsInstalled) return row(t('onboarding.stylePacks.checking'));
  if (defaultPack.state === 'installing')
    return row(t('onboarding.stylePacks.installing'), {
      tone: 'info',
      label: t('onboarding.status.installing'),
    });
  return row(
    defaultPack.state === 'failed' || defaultPack.state === 'unavailable'
      ? t('onboarding.stylePacks.failed')
      : t('onboarding.stylePacks.empty'),
    { tone: 'muted', label: t('onboarding.status.notInstalled') },
    openPacks(t('onboarding.stylePacks.get'), true),
  );
}

function SetupPromptCard({ prompt }: { prompt: string }) {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const CopyIcon = copyState === 'copied' ? ClipboardCheck : Clipboard;

  const copyPrompt = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 2200);
    }
  }, [prompt]);

  return (
    <div className="mt-6 rounded-[var(--wb-radius)] border border-blue-500/2 bg-blue-500/[0.06] p-4 xl:mt-3 xl:p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-normal text-[color:var(--wb-ink)] ">
            Setup prompt for your agent
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:var(--wb-muted)] xl:mt-1  ">
            Paste it into any coding agent opened in this folder. It runs the repo-local setup
            skill.
          </p>
        </div>
        <button
          type="button"
          onClick={copyPrompt}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[var(--wb-radius)] border border-blue-400/2 bg-blue-500/12 px-3 text-sm font-semibold tracking-normal text-[color:var(--wb-ink)] transition-colors hover:bg-blue-500/20 xl:h-9 xl:px-2.5"
        >
          <CopyIcon width={15} height={15} />
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy'}
        </button>
      </div>
      <p className="mt-3 truncate rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-2.5 py-1 font-mono text-sm text-[color:var(--wb-muted)] xl:mt-2 ">
        {COZY_STUDIO_SETUP_SKILL_PATH}
      </p>
      <textarea
        readOnly
        value={prompt}
        aria-label="Cozy Studio setup prompt"
        className="custom-scrollbar mt-3 h-52 w-full resize-none rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3 font-mono text-sm leading-5 text-[color:var(--wb-ink)] outline-none xl:hidden"
      />
      <details className="hidden xl:block">
        <summary className="mt-2 cursor-pointer rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-2.5 py-1.5 text-sm font-semibold tracking-normal text-[color:var(--wb-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] hover:text-[color:var(--wb-ink)]">
          Prompt preview
        </summary>
        <textarea
          readOnly
          value={prompt}
          aria-label="Cozy Studio setup prompt preview"
          className="custom-scrollbar mt-2 h-20 w-full resize-none rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-2 font-mono text-sm leading-4 text-[color:var(--wb-ink)] outline-none"
        />
      </details>
    </div>
  );
}

function CopyCommandButton({ command, label }: { command: string; label: string }) {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const CopyIcon = copyState === 'copied' ? ClipboardCheck : Clipboard;

  const copyCommand = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 2200);
    }
  }, [command]);

  return (
    <button
      type="button"
      onClick={copyCommand}
      className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] px-3 text-left transition-colors hover:border-blue-400/2 hover:bg-blue-500/10 xl:min-h-9 xl:px-2.5"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold tracking-normal text-[color:var(--wb-ink)]">
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : label}
        </span>
        <span className="mt-1 block truncate font-mono text-sm text-[color:var(--wb-muted)] xl:mt-0.5 ">
          {command}
        </span>
      </span>
      <CopyIcon width={15} height={15} className="shrink-0 text-[color:var(--wb-ink)]" />
    </button>
  );
}

function InAppSetupForm({
  cloudProvider,
  confirmCloudSync,
  consent,
  error,
  libraryPath,
  onConfirmCloudSyncChange,
  onConsentChange,
  onLibraryPathChange,
}: {
  cloudProvider: string | null;
  confirmCloudSync: boolean;
  consent: boolean;
  error: string | null;
  libraryPath: string;
  onConfirmCloudSyncChange: (value: boolean) => void;
  onConsentChange: (value: boolean) => void;
  onLibraryPathChange: (value: string) => void;
}) {
  return (
    <div className="mt-5 rounded-[var(--wb-radius)] border border-blue-500/2 bg-blue-500/[0.06] p-4 xl:mt-3 xl:p-3">
      <p className="text-sm font-semibold tracking-normal text-[color:var(--wb-ink)] ">
        Studio data folder
      </p>
      <p className="mt-2 text-sm leading-6 text-[color:var(--wb-muted)] xl:mt-1  ">
        Choose an absolute folder. By default the Studio data folder is in Cozy Studio's private
        app-data folder. Images use the Pictures folder configured by your operating system. You can
        change their destination under Images folder.
      </p>
      <label className="mt-3 block xl:mt-2">
        <span className="sr-only">Studio data folder path</span>
        <input
          type="text"
          value={libraryPath}
          onChange={(event) => onLibraryPathChange(event.target.value)}
          aria-label="Studio data folder path"
          className="w-full rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-3 py-2.5 font-mono text-sm text-[color:var(--wb-ink)] outline-none focus:border-blue-400/2 xl:py-2 "
        />
      </label>
      {cloudProvider ? (
        <label className="mt-3 flex items-start gap-2 text-sm leading-6 text-[color:var(--wb-warning)]  xl:mt-2  ">
          <input
            type="checkbox"
            checked={confirmCloudSync}
            onChange={(event) => onConfirmCloudSyncChange(event.target.checked)}
            className="mt-1"
          />
          <span>
            This folder looks like it syncs through {cloudProvider}. SQLite and images can break if
            the folder syncs. Continue anyway.
          </span>
        </label>
      ) : null}
      <label className="mt-3 flex items-start gap-2 text-sm leading-6 text-[color:var(--wb-ink)] xl:mt-2  ">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => onConsentChange(event.target.checked)}
          className="mt-1"
        />
        <span>
          Create this Studio data folder and write Bootstrap Configuration on this machine.
        </span>
      </label>
      {error ? (
        <p className="mt-3 rounded-[var(--wb-radius)] border border-rose-500/2 bg-rose-500/8 px-3 py-2 text-sm leading-6 text-[color:var(--wb-danger)]  xl:mt-2  ">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function OptionalGrokRow({
  busy,
  onInstall,
  onLogin,
  row,
}: {
  busy: boolean;
  onInstall: () => void;
  onLogin: () => void;
  row: NonNullable<OnboardingProbe['grok']>;
}) {
  const needsInstall = grokRowNeedsInstall(row);
  const needsLogin = grokRowNeedsLogin(row);
  return (
    <div className="mt-5 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_3%,transparent)] p-4 xl:mt-3 xl:p-3">
      <div className="flex items-start gap-3">
        <ProviderBrandMark providerId="grok" size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-normal text-[color:var(--wb-muted)] ">
            Optional provider
          </p>
          <p className="mt-2 text-sm font-semibold text-[color:var(--wb-ink)] xl:mt-1 ">
            {row.label}
          </p>
          <p className="mt-1 text-sm leading-6 text-[color:var(--wb-muted)]  ">{row.detail}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 xl:mt-2">
        {needsLogin ? (
          <button
            type="button"
            onClick={onLogin}
            disabled={busy}
            className="inline-flex h-10 items-center rounded-[var(--wb-radius)] border border-accent-400/2 bg-accent-500/18 px-3 text-sm font-semibold tracking-normal text-[color:var(--wb-ink)] transition-colors hover:bg-accent-500/28 disabled:cursor-not-allowed disabled:opacity-60 xl:h-9"
          >
            {busy ? 'Opening settings' : 'Sign in'}
          </button>
        ) : null}
        {needsInstall ? (
          <button
            type="button"
            onClick={onInstall}
            className="inline-flex h-10 items-center rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] px-3 text-sm font-semibold tracking-normal text-[color:var(--wb-ink)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] xl:h-9"
          >
            Install Grok Build
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CodexRuntimeRepairCard({
  health,
  subscriptionReady,
  onRefresh,
}: {
  health: HealthResponse | null;
  subscriptionReady: boolean;
  onRefresh: () => void;
}) {
  const runtime = health?.codexRuntime ?? null;
  if (!runtime || runtime.canRunJobs || subscriptionReady) return null;

  const primaryIssue = runtime.issues[0];
  const selectedCandidate = runtime.candidates.find((candidate) => candidate.selected);

  return (
    <div className="mt-5 rounded-[var(--wb-radius)] border border-rose-500/2 bg-rose-500/[0.06] p-4 xl:mt-3 xl:p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-normal text-[color:var(--wb-danger)]  ">
            Codex runtime repair
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:var(--wb-danger)]  xl:mt-1  ">
            {primaryIssue?.message ?? runtime.recommendedAction}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:var(--wb-muted)] xl:mt-1  ">
            {runtime.recommendedAction}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] px-3 text-sm font-semibold tracking-normal text-[color:var(--wb-ink)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)] xl:h-9"
        >
          <RefreshCw width={14} height={14} />
          Refresh
        </button>
      </div>

      <div className="mt-4 grid gap-2 xl:mt-3 xl:grid-cols-3">
        <p className="truncate rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-2.5 py-1 font-mono text-sm text-[color:var(--wb-muted)] ">
          selected: {runtime.selectedExecutable}
        </p>
        <p className="truncate rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-2.5 py-1 font-mono text-sm text-[color:var(--wb-muted)] ">
          command: {runtime.selectedCommand}
        </p>
        {selectedCandidate ? (
          <p className="truncate rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-2.5 py-1 font-mono text-sm text-[color:var(--wb-muted)] ">
            source: {selectedCandidate.source}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:mt-3 xl:grid-cols-3">
        {CODEX_RUNTIME_REPAIR_COMMANDS.map((item) => (
          <CopyCommandButton key={item.command} label={item.label} command={item.command} />
        ))}
      </div>

      <div className="mt-4 grid gap-1.5 xl:hidden">
        {runtime.candidates.slice(0, 5).map((candidate) => (
          <div
            key={`${candidate.source}-${candidate.executable}`}
            className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-2.5 py-1.5 font-mono text-sm text-[color:var(--wb-muted)]"
          >
            <span
              className={
                candidate.selected ? 'text-[color:var(--wb-danger)] ' : 'text-[color:var(--wb-ink)]'
              }
            >
              {candidate.selected ? 'selected' : candidate.exists ? 'exists' : 'missing'}
            </span>
            <span className="truncate">{candidate.executable}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnboardingLogPanel({ lines }: { lines: OnboardingLogLine[] }) {
  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <section
      aria-live="polite"
      aria-label="Setup log"
      className="mt-4 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-3 py-3 xl:mt-3"
    >
      <p className="text-sm font-semibold tracking-normal text-[color:var(--wb-muted)] ">
        Setup log
      </p>
      <div className="custom-scrollbar mt-2 max-h-36 overflow-y-auto font-mono text-sm leading-5 text-[color:var(--wb-muted)] xl:max-h-28  ">
        {lines.length === 0 ? (
          <p>{ONBOARDING_LOG_PANEL_EMPTY}</p>
        ) : (
          lines.map((line) => (
            <p
              key={line.id}
              className={line.kind === 'stage' ? 'text-[color:var(--wb-ink)]' : undefined}
            >
              {line.text}
            </p>
          ))
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function checkIcon(id: OnboardingCheck['id']) {
  if (id === 'studio_library' || id === 'bootstrap_config')
    return <Folder width={18} height={18} />;
  if (id === 'chatgpt_login') return <ProviderBrandMark providerId="chatgpt" size="sm" />;
  return <Terminal width={18} height={18} />;
}

function checkTone(ready: boolean, backendReachable: boolean): CheckTone {
  if (!backendReachable) return 'pending';
  return ready ? 'ready' : 'warning';
}

function useOnboardingSetup({
  apiBase,
  health,
  isDesktopRuntime,
  localCodexSession,
  readiness,
  probe,
  isOpen,
  onRefresh,
}: OnboardingModalProps) {
  const [libraryPathDraft, setLibraryPathDraft] = React.useState('');
  const [consent, setConsent] = React.useState(false);
  const [confirmCloudSync, setConfirmCloudSync] = React.useState(false);
  const [setupBusy, setSetupBusy] = React.useState(false);
  const [setupError, setSetupError] = React.useState<string | null>(null);
  const [logLines, setLogLines] = React.useState<OnboardingLogLine[]>([]);
  const [lastProbePath, setLastProbePath] = React.useState<string | null>(null);
  const setupPrompt = React.useMemo(
    () =>
      buildCozyStudioSetupPrompt({
        apiBase,
        health,
        isDesktopRuntime,
        localCodexSession,
        readiness,
      }),
    [apiBase, health, isDesktopRuntime, localCodexSession, readiness],
  );
  const probePath = resolveInAppSetupDraftPath(probe);
  if (lastProbePath !== probePath) {
    setLastProbePath(probePath);
    setLibraryPathDraft(probePath);
    setConfirmCloudSync(false);
    setSetupError(null);
  }

  React.useEffect(() => {
    if (!isOpen) return;
    const stream = createStudioEventStream(apiBase);
    const unstage = stream.onOnboardingStage((payload) => {
      setLogLines((lines) => appendOnboardingLogLine(lines, onboardingLogLineFromStage(payload)));
    });
    const unlog = stream.onLogAdded((entry) => {
      const line = onboardingLogLineFromSystemLog(entry);
      if (!line) return;
      setLogLines((lines) => appendOnboardingLogLine(lines, line));
    });
    return () => {
      unstage();
      unlog();
      stream.close();
    };
  }, [apiBase, isOpen]);

  const runSetup = React.useCallback(async () => {
    if (!inAppSetupCanSubmit({ consent, libraryPath: libraryPathDraft, confirmCloudSync })) {
      return;
    }
    setSetupBusy(true);
    setSetupError(null);
    try {
      await runOnboardingSetup(
        buildInAppSetupRequest({
          consent,
          libraryPath: libraryPathDraft,
          confirmCloudSync,
        }),
      );
      onRefresh();
    } catch (caught) {
      setSetupError(
        caught instanceof StudioApiError || caught instanceof Error
          ? caught.message
          : 'Setup failed.',
      );
    } finally {
      setSetupBusy(false);
    }
  }, [confirmCloudSync, consent, libraryPathDraft, onRefresh]);

  return {
    libraryPathDraft,
    setLibraryPathDraft,
    consent,
    setConsent,
    confirmCloudSync,
    setConfirmCloudSync,
    setupBusy,
    setupError,
    logLines,
    setupPrompt,
    runSetup,
  };
}

function onboardingCheckState({
  error,
  health,
  probe,
  localCodexSession,
}: Pick<OnboardingModalProps, 'error' | 'health' | 'probe' | 'localCodexSession'>) {
  const subscriptionReady = Boolean(probe?.facts.codexSubscriptionReady);
  const backendReachable = !error && Boolean(health);
  const codexRuntimeBlocked = Boolean(health?.codexRuntime && !health.codexRuntime.canRunJobs);
  const libraryReady = Boolean(health?.checks.libraryReady);
  const codexReady = Boolean(localCodexSession?.canRunLocalJobs || subscriptionReady);
  const appServerReady = Boolean(health?.appServer.running || subscriptionReady);
  const libraryTone: CheckTone = !backendReachable ? 'pending' : libraryReady ? 'ready' : 'warning';
  const sessionTone: CheckTone = !backendReachable
    ? 'pending'
    : codexReady
      ? 'ready'
      : localCodexSession?.state === 'unsupported_auth'
        ? 'error'
        : 'warning';
  const serverTone: CheckTone = !backendReachable
    ? 'pending'
    : appServerReady
      ? 'ready'
      : codexRuntimeBlocked
        ? 'error'
        : 'warning';
  const sessionDetail = codexReady
    ? 'You are signed in and ready to generate.'
    : codexRuntimeBlocked
      ? (health?.codexRuntime.recommendedAction ?? 'Repair the local Codex runtime.')
      : localCodexSession?.reason === 'chatgpt_login_required'
        ? 'Sign in with ChatGPT. A local Codex session is only for the Codex connection.'
        : localCodexSession?.error || 'Connect your local Codex session.';
  const appServerDetail = appServerReady
    ? 'Codex app-server is running and reachable.'
    : codexRuntimeBlocked
      ? (health?.codexRuntime.recommendedAction ?? 'Repair the local Codex runtime.')
      : 'Start the local app-server when the backend is ready.';
  return {
    backendReachable,
    codexRuntimeBlocked,
    libraryReady,
    codexReady,
    appServerReady,
    libraryTone,
    sessionTone,
    serverTone,
    sessionDetail,
    appServerDetail,
  };
}

function OnboardingChecks({
  apiBase,
  error,
  health,
  probe,
  localCodexSession,
}: OnboardingModalProps) {
  const {
    backendReachable,
    codexRuntimeBlocked,
    libraryReady,
    codexReady,
    appServerReady,
    libraryTone,
    sessionTone,
    serverTone,
    sessionDetail,
    appServerDetail,
  } = onboardingCheckState({ error, health, probe, localCodexSession });
  return (
    <div className="mt-4 xl:mt-3">
      {probe ? (
        probe.checks.map((row) => (
          <CheckRow
            key={row.id}
            icon={checkIcon(row.id)}
            title={row.label}
            detail={row.detail}
            meta={row.meta}
            status={
              row.requirement === 'not_required'
                ? row.ready
                  ? 'Available'
                  : 'Not required'
                : row.ready
                  ? 'Ready'
                  : 'Needs attention'
            }
            tone={
              row.requirement === 'not_required'
                ? row.ready
                  ? 'ready'
                  : 'pending'
                : checkTone(row.ready, backendReachable)
            }
          />
        ))
      ) : (
        <>
          <CheckRow
            icon={<Folder width={18} height={18} />}
            title="Studio data folder"
            detail={
              libraryReady
                ? 'Your assets and generations are stored locally.'
                : 'Repair the Studio data folder path or permissions.'
            }
            meta={health?.libraryDir || 'path not set'}
            status={libraryReady ? 'Ready' : 'Needs attention'}
            tone={libraryTone}
          />
          <CheckRow
            icon={<Sparkles width={18} height={18} />}
            title="ChatGPT Codex login"
            detail={sessionDetail}
            meta={localCodexSession?.authLabel}
            status={codexReady ? 'Ready' : 'Action needed'}
            tone={sessionTone}
          />
          <CheckRow
            icon={<Terminal width={18} height={18} />}
            title="app-server connection"
            detail={appServerDetail}
            meta={appServerReady ? health?.appServer.wsUrl : apiBase}
            status={appServerReady ? 'Running' : codexRuntimeBlocked ? 'Blocked' : 'Not running'}
            tone={serverTone}
          />
        </>
      )}
    </div>
  );
}

function onboardingPrimaryState(
  primaryAction: ReturnType<typeof resolveOnboardingPrimaryAction> | null,
  isStartingAppServer: boolean,
  canSubmitSetup: boolean,
  setupBusy: boolean,
  isReady: boolean,
) {
  if (primaryAction?.type === 'start_app_server' && isStartingAppServer)
    return { disabled: true, label: 'Starting' };
  if (primaryAction?.type === 'in_app_setup')
    return {
      disabled: !canSubmitSetup || setupBusy,
      label: setupBusy ? 'Setting up' : primaryAction.label,
    };
  return { disabled: false, label: primaryAction?.label ?? (isReady ? 'Open Studio' : 'Got it') };
}

function OnboardingPrimaryAction({
  primaryAction,
  isStartingAppServer,
  canSubmitSetup,
  setupBusy,
  isReady,
  onAction,
}: {
  primaryAction: ReturnType<typeof resolveOnboardingPrimaryAction> | null;
  isStartingAppServer: boolean;
  canSubmitSetup: boolean;
  setupBusy: boolean;
  isReady: boolean;
  onAction: () => void;
}) {
  if (primaryAction?.type === 'connect_chatgpt') return null;
  const { disabled, label } = onboardingPrimaryState(
    primaryAction,
    isStartingAppServer,
    canSubmitSetup,
    setupBusy,
    isReady,
  );
  return (
    <button
      type="button"
      onClick={onAction}
      disabled={disabled}
      className="studio-primary-control onboarding-start disabled:cursor-not-allowed disabled:opacity-60"
    >
      {label}
      <ArrowRight width={17} height={17} />
    </button>
  );
}

function OnboardingActions({
  primaryAction,
  isStartingAppServer,
  canSubmitSetup,
  setupBusy,
  isReady,
  handlePrimaryCta,
  onClose,
  setupPrompt,
  showLegacyStartAppServer,
  onStartAppServer,
}: {
  primaryAction: ReturnType<typeof resolveOnboardingPrimaryAction> | null;
  isStartingAppServer: boolean;
  canSubmitSetup: boolean;
  setupBusy: boolean;
  isReady: boolean;
  handlePrimaryCta: () => void;
  onClose: () => void;
  setupPrompt: string;
  showLegacyStartAppServer: boolean;
  onStartAppServer: () => void;
}) {
  const { t } = useT();
  // Any coding agent (Claude Code, Codex, Cursor…) can run the setup skill from this prompt.
  const [promptCopy, setPromptCopy] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const askAgent = async () => {
    try {
      await navigator.clipboard.writeText(setupPrompt);
      setPromptCopy('copied');
    } catch {
      setPromptCopy('failed');
    }
  };
  return (
    <footer className="onboarding-footer shrink-0 border-t border-[color:var(--wb-line)] px-5 py-4 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <OnboardingPrimaryAction
            primaryAction={primaryAction}
            isStartingAppServer={isStartingAppServer}
            canSubmitSetup={canSubmitSetup}
            setupBusy={setupBusy}
            isReady={isReady}
            onAction={handlePrimaryCta}
          />
          {!isReady && (
            <button
              type="button"
              onClick={onClose}
              className="studio-ghost-control onboarding-start"
            >
              Explore first
            </button>
          )}
          {!isReady && (
            <button
              type="button"
              onClick={() => void askAgent()}
              className="studio-ghost-control onboarding-start"
            >
              {promptCopy === 'copied' ? (
                <ClipboardCheck width={16} height={16} aria-hidden="true" />
              ) : (
                <Clipboard width={16} height={16} aria-hidden="true" />
              )}
              {promptCopy === 'copied' ? t('onboarding.askAgent.done') : t('onboarding.askAgent')}
            </button>
          )}
          {showLegacyStartAppServer ? (
            <button
              type="button"
              onClick={onStartAppServer}
              disabled={isStartingAppServer}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--wb-radius)] border border-blue-500/2 bg-blue-500/10 px-5 py-3 text-sm font-semibold text-[color:var(--wb-ink)] transition-colors hover:bg-blue-500/18 disabled:cursor-not-allowed disabled:opacity-60 xl:px-4 xl:py-2.5"
            >
              <Play width={16} height={16} />
              {isStartingAppServer ? 'Starting' : 'Start app-server'}
            </button>
          ) : null}
        </div>
        {promptCopy === 'idle' ? (
          <div className="hidden items-center gap-2 text-sm text-[color:var(--wb-muted)] md:flex">
            <Folder width={15} height={15} />
            Files stay on this device.
          </div>
        ) : (
          <p
            role="status"
            className={`max-w-sm text-sm text-balance ${promptCopy === 'failed' ? 'text-[color:var(--wb-danger)]' : 'text-[color:var(--wb-muted)]'}`}
          >
            {promptCopy === 'copied'
              ? t('onboarding.askAgent.copied')
              : t('onboarding.askAgent.failed')}
          </p>
        )}
      </div>
    </footer>
  );
}

function onboardingConnectionState({
  error,
  health,
  probe,
}: Pick<OnboardingModalProps, 'error' | 'health' | 'probe'>) {
  const canStartAppServer =
    !error &&
    Boolean(health) &&
    !health?.appServer.running &&
    health?.codexRuntime?.canRunJobs !== false;
  const subscriptionReady = Boolean(probe?.facts.codexSubscriptionReady);

  const primaryAction = probe ? resolveOnboardingPrimaryAction(probe.primaryCta) : null;
  const connectedProvider = probe?.facts.selectedProviderId ?? 'chatgpt';
  // app-server serves only the Codex connection; ChatGPT and other providers never need it.
  const showLegacyStartAppServer =
    connectedProvider === 'codex' &&
    canStartAppServer &&
    primaryAction?.type !== 'start_app_server';
  return { subscriptionReady, primaryAction, connectedProvider, showLegacyStartAppServer };
}

function OnboardingDiagnostics({
  modal,
  setup,
}: {
  modal: OnboardingModalProps;
  setup: ReturnType<typeof useOnboardingSetup>;
}) {
  const { error, health, probe, onRefresh, onOpenSettings } = modal;
  const {
    libraryPathDraft,
    setLibraryPathDraft,
    consent,
    setConsent,
    confirmCloudSync,
    setConfirmCloudSync,
    setupError,
    logLines,
    setupPrompt,
  } = setup;
  const isReady = modal.status === 'ready';
  const showInAppSetup =
    (probe ? resolveOnboardingPrimaryAction(probe.primaryCta).type : null) === 'in_app_setup';
  const subscriptionReady = Boolean(probe?.facts.codexSubscriptionReady);
  const cloudProvider = detectCloudSyncLibraryPath(libraryPathDraft);
  return (
    <div className="onboarding-diagnostics min-w-0">
      <details open={showInAppSetup || Boolean(error)}>
        <summary className="cursor-pointer text-sm text-[color:var(--wb-muted)]">
          {isReady ? 'Setup details' : 'Check setup'}
        </summary>

        <OnboardingChecks {...modal} />
        <OnboardingLogPanel lines={logLines} />
        <CodexRuntimeRepairCard
          health={health}
          subscriptionReady={subscriptionReady}
          onRefresh={onRefresh}
        />
        {probe?.grok ? (
          <OptionalGrokRow
            row={probe.grok}
            busy={false}
            onInstall={() => {
              window.open(ONBOARDING_GROK_INSTALL_URL, '_blank', 'noopener,noreferrer');
            }}
            onLogin={onOpenSettings}
          />
        ) : null}
        {showInAppSetup ? (
          <InAppSetupForm
            libraryPath={libraryPathDraft}
            consent={consent}
            confirmCloudSync={confirmCloudSync}
            cloudProvider={cloudProvider}
            error={setupError}
            onLibraryPathChange={setLibraryPathDraft}
            onConsentChange={setConsent}
            onConfirmCloudSyncChange={setConfirmCloudSync}
          />
        ) : null}
        {!isReady && <SetupPromptCard prompt={setupPrompt} />}
      </details>
    </div>
  );
}

export const OnboardingModal: React.FC<OnboardingModalProps> = (props) => {
  const {
    error,
    health,
    probe,
    status,
    isDesktopRuntime,
    isOpen,
    onClose,
    onComplete,
    onRefresh,
    onStartAppServer,
    onOpenSettings,
    onOpenStylePacks,
  } = props;
  const setup = useOnboardingSetup(props);
  const { libraryPathDraft, consent, confirmCloudSync, setupBusy, runSetup } = setup;
  const isChecking = status === 'checking';
  const isReady = status === 'ready';
  const isStartingAppServer = status === 'starting';
  const dialogRef = useDialogFocus<HTMLDialogElement>(
    isOpen,
    onClose,
    '[aria-label^="Open runtime status:"]',
  );

  const { primaryAction, connectedProvider, showLegacyStartAppServer } = onboardingConnectionState({
    error,
    health,
    probe,
  });
  const canSubmitSetup = inAppSetupCanSubmit({
    consent,
    libraryPath: libraryPathDraft,
    confirmCloudSync,
  });

  const runtimeLabel = isDesktopRuntime ? 'Desktop runtime' : 'Web runtime';
  const headline = isReady ? 'Ready for your next idea.' : 'Make yourself at home.';
  const intro = 'Describe it, add a reference, and make it yours.';

  const handlePrimaryCta = React.useCallback(() => {
    if (!primaryAction) {
      onComplete();
      return;
    }
    if (primaryAction.type === 'open_url') {
      window.open(primaryAction.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (primaryAction.type === 'start_app_server') {
      onStartAppServer();
      return;
    }
    if (primaryAction.type === 'in_app_setup') {
      void runSetup();
      return;
    }
    if (primaryAction.type === 'codex_login') {
      onOpenSettings();
      return;
    }
    if (primaryAction.type === 'complete') {
      onComplete();
    }
  }, [onComplete, onOpenSettings, onStartAppServer, primaryAction, runSetup]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <dialog
          aria-modal="true"
          ref={dialogRef}
          aria-label="Cozy Studio"
          tabIndex={-1}
          className="studio-modal fixed inset-0 z-120 grid place-items-center p-3 sm:p-4"
        >
          <MotionDiv
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 studio-scrim"
          />

          <MotionDiv
            initial={{ opacity: 0, scale: 0.98, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 16 }}
            className="studio-dialog studio-onboarding relative z-10 flex flex-col overflow-hidden"
          >
            <header className="onboarding-header flex shrink-0 items-center justify-between border-b border-[color:var(--wb-line)] px-5 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-10 place-items-center rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] text-[color:var(--wb-ink)] xl:size-9 xl:rounded-[var(--wb-radius)]">
                  <CozyMascot compact size={34} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold tracking-normal text-[color:var(--wb-ink)] xl:text-base">
                    Cozy <span className="font-semibold text-[color:var(--wb-muted)]">Studio</span>
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tracking-normal text-[color:var(--wb-ink)]">
                    {runtimeLabel}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={isChecking}
                  className="hidden h-10 items-center gap-2 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] px-3 text-sm font-semibold tracking-normal text-[color:var(--wb-ink)] transition-colors hover:border-[color:var(--wb-border)] hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)] disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex"
                >
                  {isChecking ? <CozyLoader size={18} /> : <RefreshCw width={14} height={14} />}
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="grid size-10 place-items-center rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] text-[color:var(--wb-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)]"
                  aria-label="Close onboarding"
                >
                  <X width={18} height={18} />
                </button>
              </div>
            </header>

            <main className="onboarding-main custom-scrollbar min-h-0 overflow-y-auto overflow-x-hidden">
              <div className="w-full">
                <section className="onboarding-hero">
                  <div>
                    <h2>{headline}</h2>
                    <p>
                      {error
                        ? 'Studio could not reach the local backend. Check the setup details below.'
                        : intro}
                    </p>
                  </div>
                  <CozyMascot size="clamp(96px, 14vw, 152px)" state="welcome" />
                </section>
                <div className="onboarding-steps" aria-label="Three steps to your first image">
                  {[
                    {
                      title: 'Pick a workflow',
                      detail: 'Create, restyle, or work on a character.',
                      Icon: MediaImage,
                    },
                    {
                      title: 'Add your idea',
                      detail: 'Write a prompt or drop a reference.',
                      Icon: Sparkles,
                    },
                    {
                      title: 'Keep creating',
                      detail: 'Generate, then reuse results from History.',
                      Icon: Folder,
                    },
                  ].map(({ title, detail, Icon }, index) => (
                    <MotionDiv
                      key={title}
                      className="onboarding-step"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.16, delay: index * 0.06 }}
                    >
                      <span className="onboarding-step-marker">
                        <Icon width={20} height={20} />
                        <span>{index + 1}</span>
                      </span>
                      <h3>{title}</h3>
                      <p>{detail}</p>
                    </MotionDiv>
                  ))}
                </div>
                <section className="onboarding-setup">
                  {connectedProvider === 'chatgpt' ? (
                    <ChatGptRow
                      isReady={isReady}
                      onRefresh={onRefresh}
                      onOpenProviders={onOpenSettings}
                    />
                  ) : (
                    <ProviderRow
                      providerId={connectedProvider}
                      isReady={isReady}
                      onOpenProviders={onOpenSettings}
                    />
                  )}
                  <StylePacksRow isOpen={isOpen} onOpen={onOpenStylePacks} />
                  <ImagesFolderRow isOpen={isOpen} />
                  <OnboardingDiagnostics modal={props} setup={setup} />
                </section>
              </div>
            </main>

            <OnboardingActions
              primaryAction={primaryAction}
              isStartingAppServer={isStartingAppServer}
              canSubmitSetup={canSubmitSetup}
              setupBusy={setupBusy}
              isReady={isReady}
              handlePrimaryCta={handlePrimaryCta}
              onClose={onClose}
              setupPrompt={setup.setupPrompt}
              showLegacyStartAppServer={showLegacyStartAppServer}
              onStartAppServer={onStartAppServer}
            />
          </MotionDiv>
        </dialog>
      ) : null}
    </AnimatePresence>
  );
};
