import { useEffect, useState } from 'react';
import type {
  RepositoryUpdateChannel,
  RepositoryUpdateStatus,
} from '../../packages/shared/src/repositoryUpdates';
import {
  applyRepositoryUpdate,
  checkRepositoryUpdates,
  forgetStudioRestart,
  getRepositoryUpdateStatus,
  rememberStudioRestart,
  restartStudio,
} from '../../services/studio-api/updates';
import { ConfirmationModal } from '../ConfirmationModal';
import { formatDateTime, t, useT } from '../../lib/i18n';

function useRepositoryUpdates() {
  const [status, setStatus] = useState<RepositoryUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    action: 'update' | 'restart';
    status: RepositoryUpdateStatus;
  } | null>(null);
  const updating = status?.phase === 'updating' || status?.phase === 'restarting';
  useEffect(() => {
    let disposed = false;
    let polling = false;
    async function refresh() {
      if (polling) return;
      polling = true;
      try {
        const result = await getRepositoryUpdateStatus();
        if (!disposed) {
          setStatus(result);
          setConnectionError(null);
        }
      } catch (cause) {
        if (!disposed)
          setConnectionError(cause instanceof Error ? cause.message : 'Unable to read updates.');
      } finally {
        polling = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await checkRepositoryUpdates());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to check updates.');
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!status || !confirmation) return;
    const { action, status: reviewedStatus } = confirmation;
    setConfirmation(null);
    setBusy(true);
    setError(null);
    try {
      const result =
        action === 'update'
          ? await applyRepositoryUpdate(reviewedStatus.latestCommit!)
          : await restartStudio();
      rememberStudioRestart(result.instanceId);
      setStatus(result);
    } catch (cause) {
      forgetStudioRestart();
      setError(cause instanceof Error ? cause.message : 'Unable to restart Studio.');
    } finally {
      setBusy(false);
    }
  }

  return {
    status,
    busy,
    error,
    connectionError,
    confirmation,
    setConfirmation,
    updating,
    check,
    confirm,
  };
}

function updateStatusText(status: RepositoryUpdateStatus | null, busy: boolean) {
  const updating = status?.phase === 'updating' || status?.phase === 'restarting';
  return updating
    ? status.phase === 'updating'
      ? status.source === 'release'
        ? t('updates.staging')
        : 'Updating Studio and installing dependencies…'
      : 'Restarting Studio… This page will reconnect automatically.'
    : status?.phase === 'checking' || busy
      ? 'Checking for updates…'
      : status?.behind
        ? status.channel === 'releases'
          ? t('updates.available', { version: status.latestVersion ?? '' })
          : `${status.behind} new commit${status.behind === 1 ? '' : 's'} available on main.`
        : status?.checkedAt && !status.error
          ? status.channel === 'releases'
            ? t('updates.current')
            : 'Studio is up to date with main.'
          : 'Check for Studio updates.';
}

function UpdateConfirmation({
  confirmation,
  setConfirmation,
  confirm,
}: Pick<ReturnType<typeof useRepositoryUpdates>, 'confirmation' | 'setConfirmation' | 'confirm'>) {
  return (
    <ConfirmationModal
      isOpen={confirmation !== null}
      title={confirmation?.action === 'update' ? 'Update and restart Studio?' : 'Restart Studio?'}
      description={
        confirmation?.action === 'update'
          ? confirmation.status.source === 'release'
            ? t('updates.confirmRelease', { version: confirmation.status.latestVersion ?? '' })
            : confirmation.status.channel === 'releases'
              ? t('updates.confirmGitRelease', { version: confirmation.status.latestVersion ?? '' })
              : 'Studio will download the new commits, install dependencies, and restart. This page will reconnect automatically.'
          : 'Studio will restart and this page will reconnect automatically.'
      }
      confirmLabel={confirmation?.action === 'update' ? 'Update and restart' : 'Restart Studio'}
      tone="accent"
      onClose={() => setConfirmation(null)}
      onConfirm={confirm}
    />
  );
}

function UpdateStatusSummary({
  status,
  busy,
  error,
  connectionError,
  updating,
}: Pick<
  ReturnType<typeof useRepositoryUpdates>,
  'status' | 'busy' | 'error' | 'connectionError' | 'updating'
>) {
  const displayedError = error || status?.error || connectionError;
  return (
    <>
      {(status?.currentCommit || status?.currentVersion) && (
        <p className="studio-muted text-xs">
          Installed:{' '}
          {status.currentVersion
            ? `v${status.currentVersion.replace(/^v/, '')}`
            : status.currentCommit?.slice(0, 8)}
          {status.currentVersion && status.currentCommit
            ? ` · ${status.currentCommit.slice(0, 8)}`
            : ''}
          {status.checkedAt ? ` · Last checked: ${formatDateTime(status.checkedAt)}` : ''}
        </p>
      )}
      {!updating && displayedError && (
        <p role="alert" className="text-sm text-[color:var(--wb-danger)]">
          {displayedError}
        </p>
      )}
      {!updating && status?.blocker && <p className="studio-muted text-sm">{status.blocker}</p>}
    </>
  );
}

export function SettingsUpdatesPanel({
  hasUnsavedChanges,
  channel,
  onChannelChange,
  disabled,
}: {
  hasUnsavedChanges: boolean;
  channel: RepositoryUpdateChannel;
  onChannelChange: (channel: RepositoryUpdateChannel) => void;
  disabled: boolean;
}) {
  useT();
  const {
    status,
    busy,
    error,
    connectionError,
    confirmation,
    setConfirmation,
    updating,
    check,
    confirm,
  } = useRepositoryUpdates();

  const controlsDisabled = busy || updating || hasUnsavedChanges;
  return (
    <section className="settings-form-stack" aria-label="Studio updates">
      <h3 className="studio-dialog-title">Studio updates</h3>
      <label className="settings-form-stack">
        <span>{t('updates.channel')}</span>
        <select
          className="h-10 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] px-3 text-sm text-[color:var(--wb-ink)]"
          aria-label={t('updates.channel')}
          value={status?.source === 'release' ? 'releases' : channel}
          disabled={disabled || busy || updating || status?.source === 'release'}
          onChange={(event) => onChannelChange(event.target.value as RepositoryUpdateChannel)}
        >
          <option value="releases">{t('updates.releases')}</option>
          <option value="commits">{t('updates.commits')}</option>
        </select>
      </label>
      <p className="studio-muted text-xs">
        {t(status?.source === 'release' ? 'updates.portable' : 'updates.git')}
      </p>
      <p className="studio-muted text-sm" role="status">
        {updateStatusText(status, busy)}
      </p>
      {/* Details sit below the buttons, so lines that appear after a check never move them. */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="studio-ghost-control px-4 disabled:opacity-60"
          disabled={controlsDisabled || status?.phase === 'checking'}
          aria-label="Check for updates"
          onClick={() => void check()}
        >
          Check for updates
        </button>
        <button
          type="button"
          className="studio-primary-control disabled:opacity-60"
          disabled={controlsDisabled || !status?.canUpdate}
          onClick={() => status && setConfirmation({ action: 'update', status })}
        >
          Update and restart
        </button>
        <button
          type="button"
          className="studio-ghost-control px-4 disabled:opacity-60"
          disabled={controlsDisabled || !status?.canRestart}
          onClick={() => status && setConfirmation({ action: 'restart', status })}
        >
          Restart Studio
        </button>
      </div>
      {hasUnsavedChanges && (
        <p className="studio-muted text-sm">Save your settings before updating or restarting.</p>
      )}
      <UpdateStatusSummary
        status={status}
        busy={busy}
        error={error}
        connectionError={connectionError}
        updating={updating}
      />
      <UpdateConfirmation
        confirmation={confirmation}
        setConfirmation={setConfirmation}
        confirm={confirm}
      />
    </section>
  );
}
