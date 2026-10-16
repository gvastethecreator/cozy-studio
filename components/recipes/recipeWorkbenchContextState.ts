import type { UseCatalogResult } from '../../hooks/useCatalogPage';
import { createContext, type ReactNode } from 'react';
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
  prompt?: WorkflowPrompt | null;
  setPrompt?: (prompt: WorkflowPrompt | null) => void;
  primaryAction?: WorkflowAction | null;
  setPrimaryAction?: (action: WorkflowAction | null) => void;
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
});
