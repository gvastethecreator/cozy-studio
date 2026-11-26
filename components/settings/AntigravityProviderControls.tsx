import { useCallback, useEffect, useState } from 'react';

import {
  formatAntigravityWindowLabel,
  type AntigravityUsageStatus,
} from '../../packages/shared/src/antigravityUsage';
import type { GenerationProviderRuntimePreflight } from '../../packages/shared/src/providerCapabilities';
import {
  getAntigravityUsageStatus,
  launchAntigravityLoginTerminal,
  refreshAntigravityProviderRuntime,
} from '../../services/studio-api/providers';

export const ANTIGRAVITY_REFRESHED_EVENT = 'cozy:antigravity-refreshed';

const controlBase =
  'inline-flex h-9 items-center justify-center gap-2 rounded-[var(--wb-radius)] px-3 text-[11px] font-semibold transition-[color,background-color,border-color,scale] studio-pressable disabled:cursor-not-allowed disabled:opacity-60';
const controlPrimary = `${controlBase} studio-primary-control`;
const controlGhost = `${controlBase} studio-ghost-control`;

function summarizeAntigravityUsageLine(usage: AntigravityUsageStatus | null): string | null {
  if (!usage?.available) return null;
  const byWindow = new Map<string, number>();
  for (const bucket of usage.buckets) {
    const key = formatAntigravityWindowLabel(bucket.window);
    const current = byWindow.get(key);
    if (current === undefined || bucket.remainingPercent < current) {
      byWindow.set(key, bucket.remainingPercent);
    }
  }
  const parts = Array.from(byWindow.entries()).map(
    ([label, remaining]) => `${label}: ${Math.round(remaining)}% left`,
  );
  if (usage.remainingCredits !== null) {
    parts.push(`${usage.remainingCredits} G1 credits`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function AntigravityProviderControls({
  canExecute,
  localRuntimeState,
  onRefreshProviders,
}: {
  canExecute: boolean;
  localRuntimeState?: GenerationProviderRuntimePreflight['localRuntimeState'];
  onRefreshProviders?: () => Promise<void> | void;
}) {
  const [usage, setUsage] = useState<AntigravityUsageStatus | null>(null);
  const [busyAction, setBusyAction] = useState<'login' | 'refresh' | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUsage = useCallback(
    async (signal?: AbortSignal) => {
      if (!canExecute) {
        setUsage(null);
        return;
      }
      try {
        const next = await getAntigravityUsageStatus({ signal });
        if (signal?.aborted) return;
        setUsage(next);
      } catch {
        // Quota display is optional; keep card clean when offline or unavailable.
      }
    },
    [canExecute],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadUsage(controller.signal);
    return () => controller.abort();
  }, [loadUsage]);

  const handleLaunchLogin = async () => {
    setBusyAction('login');
    setError(null);
    setStatusMessage(null);
    try {
      const result = await launchAntigravityLoginTerminal();
      setStatusMessage(
        `Opened a terminal running "${result.command}". Finish Google sign-in there, then press Refresh status.`,
      );
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : 'Could not launch Antigravity login terminal.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleRefresh = async () => {
    setBusyAction('refresh');
    setError(null);
    setStatusMessage(null);
    try {
      const result = await refreshAntigravityProviderRuntime();
      setUsage(result.usage);
      await onRefreshProviders?.();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(ANTIGRAVITY_REFRESHED_EVENT));
      }
      const ready = result.capabilities.providers.find(
        (provider) => provider.providerId === 'antigravity',
      )?.canExecute;
      setStatusMessage(
        ready
          ? 'Antigravity status and quota refreshed.'
          : 'Antigravity status refreshed. Finish signing in if still unavailable.',
      );
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Could not refresh Antigravity status.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const usageLine = summarizeAntigravityUsageLine(usage);
  const showLoginButton = !canExecute && localRuntimeState !== 'missing';

  return (
    <div className="settings-account-auth" data-compact="true">
      {usageLine ? <p className="settings-google-meta">{usageLine}</p> : null}
      <div className="settings-google-actions">
        {showLoginButton ? (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleLaunchLogin()}
            className={controlPrimary}
          >
            {busyAction === 'login' ? 'Opening terminal…' : 'Sign in with Antigravity'}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => void handleRefresh()}
          className={controlGhost}
        >
          {busyAction === 'refresh' ? 'Refreshing…' : 'Refresh status'}
        </button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={statusMessage ? 'settings-google-status' : 'sr-only'}
      >
        {statusMessage ?? ''}
      </p>
      {error ? (
        <p role="alert" className="text-[12px] leading-relaxed text-[color:var(--wb-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
