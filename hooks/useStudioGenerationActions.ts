import { useCallback, useRef, useState } from 'react';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import { resolveGrokImagineGenerateBlock } from '../lib/grokImagineUiPolicy';
import {
  prepareStudioGenerationRequest,
  resolveStudioGenerateRecipeId,
} from '../lib/studioGenerationRequest';
import type { Attachment, ImageGenerationConfig, RecipeId } from '../types';
import { fetchImageBlob } from '../utils/fileUtils';
import { isInlineImageDataUrl } from '../lib/browserPersistenceBudget';
import { toStudioAssetUrl } from '../services/studio-api/assetUrls';
import { useLatestRef } from './useLatestRef';
import type {
  CodexExecutionTransport,
  GenerationProviderId,
  Job as StudioJob,
} from '../packages/shared/src';

type GenerateOptions = {
  preventModal?: boolean;
  useCurrentAttachments?: boolean;
  onJobCreated?: (job: StudioJob) => void;
};

function cloneGenerationAttachments(attachments: Attachment[]): Attachment[] {
  return attachments.map((attachment) => ({ ...attachment }));
}

export function buildGenerateOverridesWithCurrentAttachments(
  configOverrides: Partial<ImageGenerationConfig> | undefined,
  currentAttachments: Attachment[],
): Partial<ImageGenerationConfig> | undefined {
  if (!configOverrides) {
    return undefined;
  }

  return {
    ...configOverrides,
    attachments: cloneGenerationAttachments(currentAttachments),
  };
}

export function buildRecipeRestoreConfig(
  nextConfig: ImageGenerationConfig,
  currentAttachments: Attachment[],
  restoreOriginalReferences = false,
): ImageGenerationConfig {
  return {
    ...nextConfig,
    attachments: cloneGenerationAttachments(
      restoreOriginalReferences ? nextConfig.attachments : currentAttachments,
    ),
  };
}

interface UseStudioGenerationActionsProps {
  generationConfigRef: React.RefObject<ImageGenerationConfig>;
  activeWorkspaceId: string;
  setGenerationConfig: React.Dispatch<React.SetStateAction<ImageGenerationConfig>>;
  setRecipeDraft: (recipeId: RecipeId, config: ImageGenerationConfig) => void;
  updateGenerationConfig: <K extends keyof ImageGenerationConfig>(
    key: K,
    value: ImageGenerationConfig[K],
  ) => void;
  executeEdit: (original: Attachment, mask: string, prompt: string) => Promise<unknown>;
  executeGeneration: (
    config: Partial<ImageGenerationConfig>,
    options?: {
      preventModal?: boolean;
      workspaceId?: string;
      onJobCreated?: (job: StudioJob) => void;
    },
  ) => Promise<unknown>;
  addToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  closeModal: () => void;
  closeOverlay: () => void;
  isModalOpen: boolean;
  onRecipeSelection: (id: RecipeId) => void;
  onViewChange: (view: 'studio' | 'recipes') => void;
  onEditSettled?: () => void;
  activeProviderId: GenerationProviderId;
  defaultCodexTransport?: CodexExecutionTransport;
  grokCanExecute: boolean;
  grokStatus?: string;
  grokDiagnostics?: string[];
  activeRecipe: RecipeId;
}

/**
 * Own the Studio's generation-facing actions: enqueue,
 * image editing and recipe restore.
 */
export function useStudioGenerationActions({
  generationConfigRef,
  activeWorkspaceId,
  setGenerationConfig,
  setRecipeDraft,
  executeEdit,
  executeGeneration,
  addToast,
  closeModal,
  closeOverlay,
  isModalOpen,
  onRecipeSelection,
  onViewChange,
  onEditSettled,
  activeProviderId,
  defaultCodexTransport,
  grokCanExecute,
  grokStatus,
  grokDiagnostics,
  activeRecipe,
}: UseStudioGenerationActionsProps) {
  const [isEditingImage, setIsEditingImage] = useState(false);
  const restoreRequest = useRef(0);
  const scope = `${activeWorkspaceId}:${activeRecipe ?? 'studio'}`;
  const currentScope = useLatestRef(scope);
  const handleGenerate = useCallback(
    (
      promptOverride?: string,
      configOverrides?: Partial<ImageGenerationConfig>,
      options?: GenerateOptions,
    ) => {
      if (isModalOpen && !options?.preventModal) {
        closeModal();
      }

      const requestConfigOverrides = {
        ...(options?.useCurrentAttachments
          ? buildGenerateOverridesWithCurrentAttachments(
              configOverrides,
              generationConfigRef.current.attachments,
            )
          : configOverrides),
        recipeId: resolveStudioGenerateRecipeId(configOverrides, activeRecipe),
      };

      const request = prepareStudioGenerationRequest({
        generationConfig: generationConfigRef.current,
        promptOverride,
        configOverrides: requestConfigOverrides,
        providerId: activeProviderId,
        defaultCodexTransport,
        grokCanExecute,
        grokStatus,
        grokDiagnostics,
      });

      if (!request.ok) {
        addToast(request.message, 'info');
        return;
      }

      void executeGeneration(request.finalConfig, {
        preventModal: options?.preventModal,
        workspaceId: activeWorkspaceId,
        onJobCreated: options?.onJobCreated,
      });

      if (request.shouldClearComposerAttachments) {
        setGenerationConfig((previous) => ({
          ...previous,
          attachments: [],
        }));
      }
    },
    [
      activeWorkspaceId,
      addToast,
      closeModal,
      executeGeneration,
      generationConfigRef,
      isModalOpen,
      setGenerationConfig,
      activeProviderId,
      defaultCodexTransport,
      grokCanExecute,
      grokStatus,
      grokDiagnostics,
      activeRecipe,
    ],
  );

  const handleExecuteEdit = useCallback(
    async (original: Attachment, mask: string, prompt: string) => {
      const grokBlock = resolveGrokImagineGenerateBlock({
        providerId: activeProviderId,
        recipeId: activeRecipe,
        aspectRatio: generationConfigRef.current.aspectRatio,
        attachments: [original],
        canExecute: grokCanExecute,
        status: grokStatus,
        diagnostics: grokDiagnostics,
      });
      if (grokBlock) {
        addToast(grokBlock.message, 'info');
        return;
      }

      setIsEditingImage(true);
      try {
        await executeEdit(original, mask, prompt);
        closeOverlay();
      } catch {
        // The generation pipeline already reports failures.
      } finally {
        setIsEditingImage(false);
        onEditSettled?.();
      }
    },
    [
      activeProviderId,
      activeRecipe,
      addToast,
      closeOverlay,
      executeEdit,
      generationConfigRef,
      grokCanExecute,
      grokStatus,
      grokDiagnostics,
      onEditSettled,
    ],
  );

  const handleLoadRecipe = useCallback(
    async (
      nextConfig: ImageGenerationConfig,
      options?: { restoreOriginalReferences?: boolean },
    ) => {
      const request = ++restoreRequest.current;
      if (options?.restoreOriginalReferences) {
        if (!nextConfig.attachments.length) {
          addToast(
            'Original references are not available. Current references were kept.',
            'warning',
          );
          return false;
        }
        try {
          for (const attachment of nextConfig.attachments) {
            const url = attachment.dataUrl || attachment.sourceUrl;
            if (
              !url ||
              (!isInlineImageDataUrl(url) && !/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url))
            ) {
              throw new Error('Original reference has no readable image URL.');
            }
            const blob = await fetchImageBlob(url.startsWith('/') ? toStudioAssetUrl(url) : url);
            if (!blob.type.startsWith('image/'))
              throw new Error('Original reference is not an image.');
          }
        } catch {
          addToast(
            'Original references could not be read. Current references were kept.',
            'warning',
          );
          return false;
        }
      }
      if (request !== restoreRequest.current || currentScope.current !== scope) return false;

      const detectedRecipe = nextConfig.recipeId ?? null;
      setRecipeDraft(
        detectedRecipe,
        buildRecipeRestoreConfig(
          nextConfig,
          generationConfigRef.current.attachments,
          options?.restoreOriginalReferences,
        ),
      );
      if (detectedRecipe) {
        onRecipeSelection(detectedRecipe);
      } else {
        onViewChange('recipes');
      }
      addToast(
        options?.restoreOriginalReferences
          ? 'Settings and original references restored'
          : 'Settings restored. Current references kept.',
        'success',
      );
      return true;
    },
    [
      addToast,
      onRecipeSelection,
      onViewChange,
      setRecipeDraft,
      generationConfigRef,
      currentScope,
      scope,
    ],
  );

  const resetGenerationUi = useCallback(() => {
    setGenerationConfig({
      ...DEFAULT_GENERATION_CONFIG,
      attachments: [],
      recipeParams: null,
    });
    setIsEditingImage(false);
  }, [setGenerationConfig]);

  return {
    isEditingImage,
    handleGenerate,
    handleExecuteEdit,
    handleLoadRecipe,
    resetGenerationUi,
  };
}
