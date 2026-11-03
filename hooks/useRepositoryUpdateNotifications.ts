import { useEffect, useRef } from 'react';
import type { RepositoryUpdateStatus } from '../packages/shared/src/repositoryUpdates';
import {
  checkRepositoryUpdates,
  forgetStudioRestart,
  getRepositoryUpdateStatus,
  readPendingStudioRestart,
} from '../services/studio-api/updates';
import { useLatestRef } from './useLatestRef';
import { t } from '../lib/i18n';

const STARTUP_POLL_MS = 3000;
const STARTUP_POLL_LIMIT = 20;

export function useRepositoryUpdateNotifications(
  enabled: boolean,
  addToast: (message: string, type?: 'info' | 'error', duration?: number) => void,
) {
  const notifiedCommit = useRef<string | null>(null);
  const notify = (result: RepositoryUpdateStatus) => {
    if (result.error || result.behind <= 0 || result.latestCommit === notifiedCommit.current)
      return;
    notifiedCommit.current = result.latestCommit;
    addToast(
      result.channel === 'releases'
        ? t('updates.notice', { version: result.latestVersion ?? '' })
        : `A Studio update is available (${result.behind} new commit${result.behind === 1 ? '' : 's'}). Open Settings → Help & updates to update and restart.`,
      'info',
      0, // Stays until dismissed: an update notice is easy to miss in a timed toast.
    );
  };
  const notifyRef = useLatestRef(notify);

  // The server checks origin/main once at startup; show its result when it lands.
  useEffect(() => {
    let disposed = false;
    let polls = 0;
    const timer = setInterval(() => void read(), STARTUP_POLL_MS);
    async function read() {
      try {
        const status = await getRepositoryUpdateStatus();
        if (disposed) return;
        if (status.checkedAt || status.phase === 'error' || ++polls >= STARTUP_POLL_LIMIT) {
          clearInterval(timer);
          notifyRef.current(status);
        }
      } catch {
        if (++polls >= STARTUP_POLL_LIMIT) clearInterval(timer);
      }
    }
    void read();
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  // "Notify me about updates" adds an hourly check while Studio stays open.
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let checking = false;
    async function check() {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const result = await checkRepositoryUpdates();
        if (!disposed) notifyRef.current(result);
      } catch {
        /* Manual checks in Settings show network errors. */
      } finally {
        checking = false;
      }
    }
    const timer = setInterval(() => void check(), 60 * 60 * 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [enabled, addToast]);

  useEffect(() => {
    let disposed = false;
    let polling = false;
    async function pollRestart() {
      const pending = readPendingStudioRestart();
      if (!pending || polling) return;
      if (Date.now() - pending.startedAt > 8 * 60 * 1000) {
        forgetStudioRestart();
        addToast(
          'Studio did not reconnect. Check Settings → Help & updates or the launch terminal.',
          'error',
        );
        return;
      }
      polling = true;
      try {
        const status = await getRepositoryUpdateStatus();
        if (disposed) return;
        if (status.instanceId !== pending.instanceId) {
          // The managed launcher starts this backend only after the renderer is ready.
          forgetStudioRestart();
          window.location.reload();
        } else if (status.phase === 'error') {
          forgetStudioRestart();
          addToast(
            status.error ?? 'Studio could not update. Open Settings → Help & updates.',
            'error',
          );
        }
      } catch {
        /* The server is expected to disconnect during restart. */
      } finally {
        polling = false;
      }
    }
    void pollRestart();
    const timer = setInterval(() => void pollRestart(), 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [addToast]);
}
