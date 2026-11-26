import { useCallback, useEffect, useState } from 'react';

import type { AntigravityUsageStatus } from '../packages/shared/src/antigravityUsage';
import { getAntigravityUsageStatus } from '../services/studio-api/providers';
import { ANTIGRAVITY_REFRESHED_EVENT } from '../components/settings/AntigravityProviderControls';

export function useAntigravityUsage(enabled: boolean) {
  const [usage, setUsage] = useState<AntigravityUsageStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal, force = false) => {
      if (!enabled) {
        setUsage(null);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const next = await getAntigravityUsageStatus({ force, signal });
        if (signal?.aborted) return;
        setUsage(next);
      } catch {
        // Keep previous snapshot or null quietly when offline/unavailable.
      } finally {
        // react-doctor-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- aborted requests must not clear a newer load
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let activeController: AbortController | null = null;
    const handleRefresh = () => {
      activeController?.abort();
      activeController = new AbortController();
      void load(activeController.signal, false);
    };
    window.addEventListener(ANTIGRAVITY_REFRESHED_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(ANTIGRAVITY_REFRESHED_EVENT, handleRefresh);
      activeController?.abort();
    };
  }, [enabled, load]);

  return { usage, isLoading };
}
