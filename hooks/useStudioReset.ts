import { useCallback, useEffect, useRef, useState } from 'react';
import { resetStudioData as requestStudioResetData } from '../services/studio-api/runtime';
import { clearAll as clearAllIndexedDb } from '../utils/idb';

interface UseStudioResetProps {
  addToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  resetStudioState: () => void;
  refreshRuntime: () => Promise<unknown>;
  clearGenerationState: () => void;
  ui: StudioUiResetActions;
}

export interface StudioUiResetActions {
  setActiveRecipe: (recipeId: null) => void;
  setToolbarInteraction: (isInteracting: boolean) => void;
  setKeyPopoverOpen: (isOpen: boolean) => void;
  closeModal: () => void;
  navigateToStudio: () => void;
  clearSelectedJob: () => void;
  resetViewState: () => void;
}

export function resetStudioUi(actions: StudioUiResetActions) {
  actions.setActiveRecipe(null);
  actions.setToolbarInteraction(false);
  actions.setKeyPopoverOpen(false);
  actions.closeModal();
  actions.navigateToStudio();
  actions.clearSelectedJob();
  actions.resetViewState();
}

interface PerformStudioResetOptions {
  addToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  resetStudioState: () => void;
  refreshRuntime: () => Promise<unknown>;
  clearGenerationState: () => void;
  clearUiState: () => void;
  requestStudioReset?: () => Promise<unknown>;
  clearIndexedDb?: () => Promise<unknown>;
  startTransition?: (callback: () => void) => void;
}

export async function performStudioReset({
  addToast,
  resetStudioState,
  refreshRuntime,
  clearGenerationState,
  clearUiState,
  requestStudioReset = requestStudioResetData,
  clearIndexedDb = clearAllIndexedDb,
  startTransition = (callback) => callback(),
}: PerformStudioResetOptions) {
  try {
    await requestStudioReset();
    await clearIndexedDb();

    clearGenerationState();

    startTransition(() => {
      resetStudioState();
      clearUiState();
    });

    await refreshRuntime();
    addToast(
      'Studio reset complete. The Studio data folder, workspace cache, and database were rebuilt.',
      'success',
    );
    return true;
  } catch (error) {
    addToast(error instanceof Error ? error.message : 'Studio reset failed', 'error');
    return false;
  }
}

/**
 * Own the destructive studio reset choreography behind one seam so the app
 * shell only provides adapters for local UI state and generation state.
 */
export function useStudioReset({
  addToast,
  resetStudioState,
  refreshRuntime,
  clearGenerationState,
  ui,
}: UseStudioResetProps) {
  const [isResettingStudio, setIsResettingStudio] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const {
    setActiveRecipe,
    setToolbarInteraction,
    setKeyPopoverOpen,
    closeModal,
    navigateToStudio,
    clearSelectedJob,
    resetViewState,
  } = ui;

  const clearUiState = useCallback(
    () =>
      resetStudioUi({
        setActiveRecipe,
        setToolbarInteraction,
        setKeyPopoverOpen,
        closeModal,
        navigateToStudio,
        clearSelectedJob,
        resetViewState,
      }),
    [
      setActiveRecipe,
      setToolbarInteraction,
      setKeyPopoverOpen,
      closeModal,
      navigateToStudio,
      clearSelectedJob,
      resetViewState,
    ],
  );

  const resetStudio = useCallback(async () => {
    if (isResettingStudio) return;

    setIsResettingStudio(true);

    try {
      await performStudioReset({
        addToast,
        resetStudioState,
        refreshRuntime,
        clearGenerationState,
        clearUiState,
      });
    } finally {
      if (isMountedRef.current) {
        setIsResettingStudio(false);
      }
    }
  }, [
    addToast,
    clearGenerationState,
    clearUiState,
    isResettingStudio,
    refreshRuntime,
    resetStudioState,
  ]);

  return {
    isResettingStudio,
    resetStudio,
  };
}
