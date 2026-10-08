import { useEffect, useState } from 'react';
import type { RepositoryUpdateStatus } from '../../packages/shared/src/repositoryUpdates';
import {
  applyRepositoryUpdate,
  checkRepositoryUpdates,
  forgetStudioRestart,
  getRepositoryUpdateStatus,
  rememberStudioRestart,
  restartStudio,
} from '../../services/studio-api/updates';
import { ConfirmationModal } from '../ConfirmationModal';

function useRepositoryUpdates() {
  const [status, setStatus] = useState<RepositoryUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'update' | 'restart' | null>(null);
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
    const action = confirmation;
    setConfirmation(null);
    setBusy(true);
    setError(null);
    try {
      const result =
        action === 'update'
          ? await applyRepositoryUpdate(status.latestCommit!)
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
      ? 'Updating Studio and installing dependencies…'
      : 'Restarting Studio… This page will reconnect automatically.'
    : status?.phase === 'checking' || busy
      ? 'Checking for updates…'
      : status?.behind
        ? `${status.behind} new commit${status.behind === 1 ? '' : 's'} available on main.`
        : status?.checkedAt && !status.error
          ? 'Studio is up to date with main.'
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
      title={confirmation === 'update' ? 'Update and restart Studio?' : 'Restart Studio?'}
      description={
        confirmation === 'update'
          ? 'Studio will download the new commits, install dependencies, and restart. This page will reconnect automatically.'
          : 'Studio will restart and this page will reconnect automatically.'
      }
      confirmLabel={confirmation === 'update' ? 'Update and restart' : 'Restart Studio'}
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
      <p className="studio-muted text-sm" role="status">
        {updateStatusText(status, busy)}
      </p>
      {status?.currentCommit && (
        <p className="studio-muted text-xs">
          Installed: {status.currentCommit.slice(0, 8)}
          {status.checkedAt
            ? ` · Last checked: ${new Date(status.checkedAt).toLocaleString()}`
            : ''}
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

export function SettingsUpdatesPanel({ hasUnsavedChanges }: { hasUnsavedChanges: boolean }) {
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
      <UpdateStatusSummary
        status={status}
        busy={busy}
        error={error}
        connectionError={connectionError}
        updating={updating}
      />
      {hasUnsavedChanges && (
        <p className="studio-muted text-sm">Save your settings before updating or restarting.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="studio-ghost-control px-4 disabled:opacity-60"
          disabled={busy || updating || status?.phase === 'checking'}
          aria-label="Check for updates"
          onClick={() => void check()}
        >
          Check for updates
        </button>
        <button
          type="button"
          className="studio-primary-control disabled:opacity-60"
          disabled={controlsDisabled || !status?.canUpdate}
          onClick={() => setConfirmation('update')}
        >
          Update and restart
        </button>
        <button
          type="button"
          className="studio-ghost-control px-4 disabled:opacity-60"
          disabled={controlsDisabled || !status?.canRestart}
          onClick={() => setConfirmation('restart')}
        >
          Restart Studio
        </button>
      </div>
      <UpdateConfirmation
        confirmation={confirmation}
        setConfirmation={setConfirmation}
        confirm={confirm}
      />
    </section>
  );
}
