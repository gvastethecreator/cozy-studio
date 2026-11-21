import type { UseCatalogResult } from '../../hooks/useCatalogPage';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ImageGenerationConfig } from '../../types';
export type CanvasCompareChrome = {
  showReference: boolean;
  toggle: () => void;
} | null;

export type WorkflowPrompt = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
};

export type WorkflowAction = { execute: () => void; disabled: boolean };

/** The open workflow's prompt, kept outside React state so typing re-renders only its readers. */
export type WorkflowPromptStore = {
  get: () => WorkflowPrompt | null;
  subscribe: (listener: () => void) => () => void;
  publish: (prompt: WorkflowPrompt | null) => void;
  /** Show the typed value now, then hand it to the workflow, so a keystroke is one commit. */
  change: (value: string) => void;
};

export function createWorkflowPromptStore(): WorkflowPromptStore {
  let current: WorkflowPrompt | null = null;
  const listeners = new Set<() => void>();
  const set = (next: WorkflowPrompt | null) => {
    current = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (next) => {
      if (
        next &&
        current &&
        next.value === current.value &&
        next.label === current.label &&
        next.placeholder === current.placeholder
      )
        return;
      set(next);
    },
    change: (value) => {
      if (!current) return;
      const { onChange } = current;
      if (value !== current.value) set({ ...current, value });
      onChange(value);
    },
  };
}

export const RecipeWorkbenchContext = createContext<{
  controls: HTMLElement | null;
  action: HTMLElement | null;
  overlay: HTMLElement | null;
  sidePanel: HTMLElement | null;
  compare: CanvasCompareChrome;
  setCompare: (compare: CanvasCompareChrome) => void;
  history?: UseCatalogResult;
  results?: ReactNode;
  latestResultId?: string;
  imageActions?: {
    workspaceId: string;
    onLoadConfig: (config: ImageGenerationConfig) => void;
    onRegenerate: (config: ImageGenerationConfig) => void;
    onDelete: (id: string) => void;
  };
  promptStore: WorkflowPromptStore;
  primaryAction?: WorkflowAction | null;
  setPrimaryAction?: (action: WorkflowAction | null) => void;
  /** Why the selected provider cannot run this workflow; set by the context-only composer. */
  generateBlock?: string | null;
  setGenerateBlock?: (message: string | null) => void;
  stylesOpen?: boolean;
  catalogExpanded?: boolean;
  openStyles?: (expanded?: boolean) => void;
  closeStyles?: () => void;
  compactControls?: HTMLElement | null;
}>({
  controls: null,
  action: null,
  overlay: null,
  sidePanel: null,
  compare: null,
  setCompare: () => {},
  promptStore: createWorkflowPromptStore(),
});

export function useWorkflowPromptState(): WorkflowPrompt | null {
  const { promptStore } = useContext(RecipeWorkbenchContext);
  return useSyncExternalStore(promptStore.subscribe, promptStore.get);
}
