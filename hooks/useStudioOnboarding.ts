import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HealthResponse } from '../packages/shared/src';
import type { Toast } from '../types';
import { getStudioApiBase } from '../services/studio-api/http';
import { startStudioAppServer } from '../services/studio-api/runtime';
import { resolveStudioRuntime } from '../services/studioRuntime';
import { useLocalStorage } from './useLocalStorage';
import {
  shouldAutoOpenOnboarding,
  shouldCloseOnboardingBecauseReady,
} from '../lib/onboardingEventLog';

interface UseStudioOnboardingProps {
  log: (message: string) => void;
  addToast: (message: string, type?: Toast['type']) => void;
  shouldAutoOpen: boolean;
  health: HealthResponse | null;
  refreshHealth: () => Promise<void>;
  healthError?: string | null;
  isCheckingHealth?: boolean;
}

export function useStudioOnboarding({
  log,
  addToast,
  shouldAutoOpen,
  health,
  refreshHealth,
  healthError = null,
  isCheckingHealth = false,
}: UseStudioOnboardingProps) {
  const [hasSeenOnboarding, setHasSeenOnboarding] = useLocalStorage(
    'studio-onboarding-complete',
    false,
  );
  const [opening, setOpening] = useState<'none' | 'auto' | 'manual' | 'complete'>('none');
  const [autoOpened, setAutoOpened] = useState(false);
  const isOpen = opening === 'auto' || opening === 'manual';
  const [isStartingAppServer, setIsStartingAppServer] = useState(false);

  const runtime = useMemo(() => resolveStudioRuntime(), []);
  const apiBase = useMemo(() => getStudioApiBase(), []);
  const isDesktopRuntime = runtime.isDesktop;
  const isReady = Boolean(health?.ok && health.checks.onboardingReady);

  const openOnboarding = useCallback(() => {
    setOpening('manual');
    void refreshHealth();
  }, [refreshHealth]);

  const closeOnboarding = useCallback(() => {
    setHasSeenOnboarding(true);
    setOpening('none');
  }, [setHasSeenOnboarding]);

  const completeOnboarding = useCallback(() => {
    setHasSeenOnboarding(true);
    setOpening('none');
  }, [setHasSeenOnboarding]);

  if (
    opening === 'none' &&
    !autoOpened &&
    shouldAutoOpenOnboarding({
      hasSeenOnboarding,
      shouldAutoOpen,
      isReady,
      hasHealthSnapshot: health !== null,
    })
  ) {
    setAutoOpened(true);
    setOpening('auto');
  }
  if (opening === 'auto' && shouldCloseOnboardingBecauseReady(isReady, isOpen)) {
    setOpening('complete');
  }
  useEffect(() => {
    if (opening === 'complete') setHasSeenOnboarding(true);
  }, [opening, setHasSeenOnboarding]);

  const ensureAppServer = useCallback(async () => {
    setIsStartingAppServer(true);
    try {
      const result = await startStudioAppServer();
      await refreshHealth();
      addToast(
        result.running
          ? 'Codex app-server started'
          : (result.codexRuntime?.recommendedAction ?? 'Could not start Codex app-server'),
        result.running ? 'success' : 'info',
      );
    } catch (startError) {
      const message =
        startError instanceof Error ? startError.message : 'Could not start codex app-server';
      addToast(message, 'error');
      log(`Studio onboarding failed to start app-server: ${message}`);
    } finally {
      setIsStartingAppServer(false);
    }
  }, [addToast, log, refreshHealth]);

  return {
    apiBase,
    closeOnboarding,
    completeOnboarding,
    ensureAppServer,
    error: healthError,
    health,
    isChecking: isCheckingHealth,
    isDesktopRuntime,
    isOpen,
    isReady,
    isStartingAppServer,
    openOnboarding,
    refreshHealth,
    runtime,
  };
}
