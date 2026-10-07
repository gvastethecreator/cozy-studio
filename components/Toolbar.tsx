import { useLatestRef } from '../hooks/useLatestRef';
import { CATALOG_IMAGE_DRAG_TYPE } from '../lib/catalogImageDrag';
import { getCatalogImageDetail } from '../services/studio-api/catalog';
import { materializeCatalogEntryImage } from '../lib/studioCatalogImageAdapter';
import { buildGeneratedImageContextAttachment } from '../hooks/useGenerationConfig';
import { CozyLoader as Loader2, CozyLoader } from './CozyMascot';
import {
  getGenerationRequirement,
  getGenerationOutputSummary,
} from '../packages/shared/src/generationRequirements';
import { ReferenceTray } from './ReferenceTray';
import {
  Prohibition as Ban,
  ElectronicsChip as Bot,
  Brain as BrainCircuit,
  Check,
  NavArrowDown as ChevronDown,
  Erase as Eraser,
  Hashtag as Hash,
  MediaImagePlus as ImagePlus,
  MultiplePages as Layers,
  Computer as Monitor,
  MoreHoriz as MoreHorizontal,
  PlusCircle,
  Minus,
  Plus,
  Crop as Ratio,
  Square as RectangleHorizontal,
  ControlSlider as SlidersHorizontal,
  ShieldAlert,
  Square,
  Sparks as Sparkles,
  MagicWand as Wand,
  MagicWand as Wand2,
  Xmark as X,
  Flash as Zap,
} from 'iconoir-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatCodexModelLabel,
  formatCodexSpeedLabel,
  getCodexSpeedOptions,
  normalizeCodexReasoningEffort,
  normalizeCodexSpeed,
} from '../lib/codexExecution';
import {
  buildComposerProviderProjection,
  resolveProviderImageSize,
  resolveProviderSupportsTransparentBackground,
} from '../lib/composerProviderProjection';
import { resolveGenerationBackground } from '../lib/generationBackground';
import { getActiveRecipeIndicator } from '../lib/activeRecipeIndicator';
import type {
  CodexModel,
  CodexModelCatalogResponse,
  CodexServiceTier,
  GenerationProviderId,
} from '../packages/shared/src';
import type {
  CodexExecutionTransport,
  CodexHttpImageModelOption,
  CodexHttpImageSizeTier,
} from '../packages/shared/src/codexExecutionContract';
import type { AspectRatio, Attachment, ImageGenerationConfig } from '../types';
import { OutputBackgroundControl } from './create/OutputBackgroundControl';
import {
  getRatioOrientation,
  getRatioShapeStyle,
  RATIO_ORIENTATION_LABELS,
} from '../utils/imageGenSizing';
import KeyPopover from './KeyPopover';
import Tooltip from './Tooltip';
import { DemandMountedGsapDropdown } from './ui/DemandMountedGsapDropdown';
import type { StudioCommandCenterProjection } from '../lib/commandCenterProjection';
import { ProviderQuickSwitch } from './header/ProviderQuickSwitch';
import { ProviderBrandMark } from './ProviderBrandMark';
import { GenerationElapsedStatus, LivePromptTextarea } from './ToolbarLiveStatus';

export interface ToolbarProps {
  generationConfig: ImageGenerationConfig;
  updateConfig: <K extends keyof ImageGenerationConfig>(
    key: K,
    value: ImageGenerationConfig[K],
  ) => void;
  updateAttachment: (id: string, newProps: Partial<Attachment>) => void;
  onGenerate: (
    prompt?: string,
    configOverrides?: Partial<ImageGenerationConfig>,
    options?: { preventModal?: boolean; useCurrentAttachments?: boolean },
  ) => void;
  isGenerating: boolean;
  generationStartTime: number | null;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFilesDrop: (files: File[], replaceId?: string) => void;
  onRemoveAttachment: (id: string) => void;
  setPreviewRatio: (ratio: AspectRatio | null) => void;
  setIsInteracting: (isInteracting: boolean) => void;
  onOpenEditor: (attachment: Attachment) => void;
  isKeyPopoverOpen: boolean;
  onOpenKeySelector: () => void;
  onSelectKey: () => Promise<void>;
  maxAttachments: number;
  interactionScope?: string;
  codexModelCatalog: CodexModelCatalogResponse | null;
  isLoadingCodexModelCatalog: boolean;
  codexModelCatalogError: string | null;
  activeProviderId: GenerationProviderId;
  codexTransport?: CodexExecutionTransport;
  codexAvailableTransports?: readonly CodexExecutionTransport[];
  grokCanExecute?: boolean;
  grokStatus?: string;
  grokDiagnostics?: string[];
  commandCenter?: StudioCommandCenterProjection;
  onSelectProvider?: (providerId: GenerationProviderId) => Promise<void> | void;
  isProviderSaving?: boolean;
  onOpenSettings?: () => void;
  activeRecipe?: ImageGenerationConfig['recipeId'];
  mode?: 'full' | 'context-only';
  railTools?: React.ReactNode;
  railAction?: React.ReactNode;
  layout?: 'dock' | 'rail';
}

const ICON_SIZE = 14;

const AspectRatioIcon: React.FC<{ ratio: AspectRatio }> = ({ ratio }) => {
  const [width = 1, height = 1] = ratio.split(':').map(Number);
  if (width === height) return <Square width={ICON_SIZE} height={ICON_SIZE} />;
  if (width > height)
    return <RectangleHorizontal width={ICON_SIZE} height={ICON_SIZE} className="scale-y-75" />;
  return <RectangleHorizontal width={ICON_SIZE} height={ICON_SIZE} className="scale-x-75" />;
};

const BATCH_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const GENERATION_PROVIDER_LABELS: Partial<Record<GenerationProviderId, string>> = {
  codex: 'Codex',
  grok: 'Grok Imagine',
  google: 'Google',
  fal: 'fal.ai',
  comfy: 'ComfyUI',
  dry_run: 'Dry run',
};

function formatGenerationProviderLabel(providerId: GenerationProviderId) {
  return GENERATION_PROVIDER_LABELS[providerId] ?? providerId;
}

import { useToastUi, useWorkspaceState } from '../contexts/GlobalContext';

export const Toolbar: React.FC<ToolbarProps> = React.memo(
  ({
    generationConfig,
    updateConfig,
    onGenerate,
    isGenerating,
    generationStartTime,
    onFileSelect,
    onFilesDrop,
    onRemoveAttachment,
    setPreviewRatio,
    setIsInteracting,
    onOpenEditor,
    isKeyPopoverOpen,
    onOpenKeySelector,
    onSelectKey,
    maxAttachments,
    interactionScope,
    codexModelCatalog,
    isLoadingCodexModelCatalog,
    codexModelCatalogError,
    activeProviderId,
    codexTransport,
    codexAvailableTransports,
    grokCanExecute = false,
    grokStatus,
    grokDiagnostics,
    commandCenter,
    onSelectProvider,
    isProviderSaving = false,
    onOpenSettings,
    activeRecipe = null,
    mode = 'full',
    railTools,
    railAction,
    layout = 'dock',
  }) => {
    const { addToast } = useToastUi();
    const { activeWorkspaceId } = useWorkspaceState();
    const containerRef = useRef<HTMLDivElement>(null);
    const toolScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (toolScrollRef.current) toolScrollRef.current.scrollTop = 0;
    }, [interactionScope, layout]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const aspectRatioButtonRef = useRef<HTMLButtonElement>(null);
    const sizeButtonRef = useRef<HTMLButtonElement>(null);
    const batchButtonRef = useRef<HTMLButtonElement>(null);
    const negativeInputRef = useRef<HTMLInputElement>(null);
    const executionButtonRef = useRef<HTMLButtonElement>(null);

    const [localPrompt, setLocalPrompt] = useState(generationConfig.prompt || '');
    const [quickStartError, setQuickStartError] = useState(false);
    const [quickStartErrorScope, setQuickStartErrorScope] = useState<string | undefined>();
    const [isPromptFocused, setIsPromptFocused] = useState(false);

    // Menu States
    const [isAspectRatioOpen, setIsAspectRatioOpen] = useState(false);
    const [isExecutionOpen, setIsExecutionOpen] = useState(false);
    const [isSizeOpen, setIsSizeOpen] = useState(false);
    const [isBatchOpen, setIsBatchOpen] = useState(false);
    const [isMobileControlsOpen, setIsMobileControlsOpen] = useState(false);

    // Logic AI Popover States
    const [isNegativeOpen, setIsNegativeOpen] = useState(false);
    const [composerDragDepth, setComposerDragDepth] = useState(0);

    const selectedCodexTransport =
      activeProviderId === 'chatgpt' ? 'subscription_http' : 'codex_app_server';

    const providerChrome = useMemo(
      () =>
        buildComposerProviderProjection({
          providerId: activeProviderId,
          recipeId: activeRecipe,
          aspectRatio: generationConfig.aspectRatio,
          attachments: generationConfig.attachments,
          grokCanExecute,
          grokStatus,
          grokDiagnostics,
          codexModelCatalog,
          codexTransport: selectedCodexTransport,
          codexAvailableTransports,
          codexImageModel: generationConfig.codexImageModel,
          executionModel: generationConfig.executionModel,
          executionReasoningEffort: generationConfig.executionReasoningEffort,
          executionSpeed: generationConfig.executionSpeed,
          imageSize: generationConfig.imageSize,
          catalogError: codexModelCatalogError,
        }),
      [
        activeProviderId,
        activeRecipe,
        codexModelCatalog,
        codexModelCatalogError,
        codexTransport,
        codexAvailableTransports,
        generationConfig.codexImageModel,
        selectedCodexTransport,
        generationConfig.aspectRatio,
        generationConfig.attachments,
        generationConfig.executionModel,
        generationConfig.executionReasoningEffort,
        generationConfig.executionSpeed,
        generationConfig.imageSize,
        grokCanExecute,
        grokDiagnostics,
        grokStatus,
      ],
    );
    const {
      generateBlock,
      ratios: currentRatios,
      showCodexPromptTools,
      showCodexModelChrome,
      maxOutputCount,
      execution,
    } = providerChrome;
    const codexModels = execution.models;
    const selectedExecutionModel = execution.selectedModel;
    const executionReasoningOptions = execution.reasoningOptions;
    const executionSpeedOptions = execution.speedOptions;
    const executionImageModels = execution.imageModels;
    const selectedExecutionImageModel = execution.selectedImageModel;
    const executionImageSizeOptions = execution.imageSizeOptions;
    const selectedExecutionImageSize = execution.selectedImageSize;
    const showSizeControl = execution.showImageSizeControl;
    const executionSourceMessage = execution.sourceMessage;
    const executionSummary = execution.summary;
    const executionChipLabel = formatCodexModelLabel(
      selectedExecutionModel?.id ?? generationConfig.executionModel,
      selectedExecutionModel?.displayName,
    );

    const isScrambling = false;

    const handleSelectExecutionModel = useCallback(
      (model: CodexModel) => {
        if (selectedCodexTransport === 'subscription_http') return;
        updateConfig('executionModel', model.id);
        updateConfig(
          'executionReasoningEffort',
          normalizeCodexReasoningEffort(model, generationConfig.executionReasoningEffort),
        );
        updateConfig('executionSpeed', normalizeCodexSpeed(model, generationConfig.executionSpeed));
      },
      [
        generationConfig.executionReasoningEffort,
        generationConfig.executionSpeed,
        selectedCodexTransport,
        updateConfig,
      ],
    );

    const handleSelectExecutionImageModel = useCallback(
      (model: CodexHttpImageModelOption) => {
        if (selectedCodexTransport !== 'subscription_http') return;
        updateConfig('codexImageModel', model.id);
      },
      [selectedCodexTransport, updateConfig],
    );

    const handleSelectExecutionImageSize = useCallback(
      (size: CodexHttpImageSizeTier) => {
        if (selectedCodexTransport !== 'subscription_http') return;
        updateConfig('imageSize', size);
      },
      [selectedCodexTransport, updateConfig],
    );

    const handleSelectExecutionSpeed = useCallback(
      (speed: CodexServiceTier) => {
        if (selectedCodexTransport === 'subscription_http') return;
        updateConfig('executionSpeed', normalizeCodexSpeed(selectedExecutionModel, speed));
      },
      [selectedCodexTransport, selectedExecutionModel, updateConfig],
    );

    const closeAllMenus = useCallback(() => {
      setIsAspectRatioOpen(false);
      setIsExecutionOpen(false);
      setIsSizeOpen(false);
      setIsBatchOpen(false);
      setIsInteracting(false);
      setPreviewRatio(null);
    }, [setIsInteracting, setPreviewRatio]);

    const handleToolbarMouseEnter = useCallback(() => {
      setIsInteracting(true);
    }, [setIsInteracting]);

    const handleToolbarMouseLeave = useCallback(() => {
      setIsInteracting(false);
      setPreviewRatio(null);
    }, [setIsInteracting, setPreviewRatio]);

    // Click outside
    useEffect(() => {
      const handleOutsideClick = (event: MouseEvent) => {
        if (event.target instanceof Element && event.target.closest('[data-toolbar-popup]')) return;
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          closeAllMenus();
          setIsNegativeOpen(false);
          setIsMobileControlsOpen(false);
        }
      };
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [closeAllMenus]);

    const lastPushedPromptRef = useRef(generationConfig.prompt);
    const debounceTimerRef = useRef<number | null>(null);

    useEffect(() => {
      const timer = debounceTimerRef.current;
      return () => {
        if (timer) clearTimeout(timer);
      };
    }, []);

    useEffect(() => {
      if (
        generationConfig.prompt !== lastPushedPromptRef.current &&
        generationConfig.prompt !== localPrompt
      ) {
        lastPushedPromptRef.current = generationConfig.prompt;
        // react-doctor-disable-next-line react-doctor/no-chain-state-updates
        // react-doctor-disable-next-line react-doctor/no-derived-state
        setLocalPrompt(generationConfig.prompt || '');
      }
    }, [generationConfig.prompt, localPrompt]);

    useEffect(() => {
      const current = generationConfig.batchCount || 1;
      if (current > maxOutputCount) {
        updateConfig('batchCount', maxOutputCount);
      }
    }, [generationConfig.batchCount, maxOutputCount, updateConfig]);

    const removesBackground =
      resolveGenerationBackground({ ...generationConfig, recipeId: activeRecipe }) ===
      'transparent';
    const canRemoveBackground = resolveProviderSupportsTransparentBackground(activeProviderId);
    useEffect(() => {
      if (canRemoveBackground || !removesBackground) return;
      updateConfig('outputBackground', 'workflow');
      addToast('Remove background needs ChatGPT. Background set to Maintain background.', 'info');
    }, [addToast, canRemoveBackground, removesBackground, updateConfig]);

    const requirement = getGenerationRequirement({
      ...generationConfig,
      recipeId: activeRecipe,
      prompt: localPrompt,
      referenceCount: generationConfig.attachments.length,
    });
    const sourceFirst =
      activeRecipe === 'remaster' || activeRecipe === 'camera' || activeRecipe === 'character-lab';

    const handleTriggerGenerate = useCallback(() => {
      if (generateBlock) return;
      if (requirement) {
        setQuickStartErrorScope(interactionScope);
        setQuickStartError(requirement.field === 'prompt');
        const target =
          requirement.field === 'source'
            ? '[aria-label="Add image reference"]'
            : requirement.field === 'styles'
              ? '[aria-label="Add a style"]'
              : 'textarea';
        containerRef.current?.querySelector<HTMLElement>(target)?.focus();
        return;
      }
      const trimmedPrompt =
        localPrompt.trim() ||
        (activeRecipe === 'styles'
          ? 'Create a balanced composition using the selected styles.'
          : activeRecipe === 'character-lab' &&
              typeof generationConfig.recipeParams?.subject === 'string'
            ? generationConfig.recipeParams.subject
            : '');
      // Force sync immediately before generating
      updateConfig('prompt', localPrompt);
      onGenerate(
        trimmedPrompt,
        {
          recipeId: activeRecipe,
          codexTransport: selectedCodexTransport,
          imageSize: resolveProviderImageSize(activeProviderId, generationConfig.imageSize),
        },
        { preventModal: true },
      );

      closeAllMenus();
      setIsNegativeOpen(false);
      setIsMobileControlsOpen(false);
    }, [
      localPrompt,
      requirement,
      activeRecipe,
      activeProviderId,
      generationConfig.imageSize,
      generationConfig.recipeParams,
      updateConfig,
      onGenerate,
      selectedCodexTransport,
      closeAllMenus,
      interactionScope,
      generateBlock,
    ]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (layout === 'rail') return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleTriggerGenerate();
      }
    };

    useEffect(() => {
      if (layout !== 'rail') return;
      const handleGlobalGenerate = (event: KeyboardEvent) => {
        if (event.defaultPrevented) return;
        if (document.querySelector('[aria-modal="true"]')) return;
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          if (mode === 'context-only') {
            containerRef.current
              ?.querySelector<HTMLButtonElement>('.recipe-primary-action button')
              ?.click();
          } else {
            handleTriggerGenerate();
          }
        }
      };
      document.addEventListener('keydown', handleGlobalGenerate);
      return () => document.removeEventListener('keydown', handleGlobalGenerate);
    }, [handleTriggerGenerate, layout, mode]);

    const currentSizes = executionImageSizeOptions;

    const btnClass =
      'studio-ghost-control h-10 min-h-10 w-full touch-manipulation sm:w-auto flex items-center justify-center gap-2 px-3 text-[length:var(--wbp-label)] font-semibold leading-none tracking-normal transition-[color,background-color,border-color,opacity,transform] hover:text-[color:var(--wb-ink)] active:scale-95 disabled:opacity-30 group whitespace-nowrap cursor-pointer';
    const iconBtnClass =
      'studio-ghost-control size-10 min-w-10 flex-shrink-0 touch-manipulation flex items-center justify-center transition-[color,background-color,border-color,opacity,transform] hover:text-[color:var(--wb-ink)] active:scale-90 relative cursor-pointer disabled:cursor-not-allowed';
    const activeIconBtnClass =
      'bg-gradient-to-b from-accent-800 to-accent-950 border border-accent-700/2 text-accent-300 shadow-[0_2px_10px_rgba(0,0,0,0.5)] cursor-pointer';

    const hasAttachments = generationConfig.attachments.length > 0;
    const isContextOnly = mode === 'context-only';
    const isNearLimit = generationConfig.attachments.length >= maxAttachments;
    const hasQuickStartInput = localPrompt.trim().length > 0 || hasAttachments;
    const activeRecipeIndicator = getActiveRecipeIndicator(activeRecipe);

    if (quickStartError && (quickStartErrorScope !== interactionScope || hasQuickStartInput)) {
      setQuickStartError(false);
    }

    const shouldShowQuickStartError =
      quickStartError && quickStartErrorScope === interactionScope && !hasQuickStartInput;
    const showQuickStartErrorText = shouldShowQuickStartError && isPromptFocused;
    const isRail = layout === 'rail';
    const currentBatch = Math.min(generationConfig.batchCount || 1, maxOutputCount);
    const batchCounts = BATCH_COUNTS.filter((count) => count <= maxOutputCount);
    const outputSummary = getGenerationOutputSummary(
      activeRecipe,
      generationConfig.recipeParams,
      currentBatch,
    );
    const nextBatchCount = Math.min(maxOutputCount, currentBatch + 1);
    const previousBatchCount = Math.max(1, currentBatch - 1);
    const formatOrientation =
      RATIO_ORIENTATION_LABELS[getRatioOrientation(generationConfig.aspectRatio)];
    const shortcutHint =
      typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)
        ? '⌘ ↵'
        : 'Ctrl ↵';
    const dropInFlight = useRef(false);
    const attachmentsRef = useLatestRef(generationConfig.attachments);
    const dropScope = useMemo(
      () => ({ activeWorkspaceId, interactionScope }),
      [activeWorkspaceId, interactionScope],
    );
    const dropScopeRef = useLatestRef<typeof dropScope | null>(dropScope);
    useEffect(
      () => () => {
        dropScopeRef.current = null;
      },
      [dropScopeRef],
    );
    const acceptRailImageDrop = useCallback(
      async (event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const imageId = event.dataTransfer.getData(CATALOG_IMAGE_DRAG_TYPE).trim();
        if (imageId) {
          if (
            imageId.length > 512 ||
            dropInFlight.current ||
            generationConfig.attachments.length >= maxAttachments
          )
            return;
          dropInFlight.current = true;
          const pendingScope = dropScopeRef.current;
          try {
            const entry = await getCatalogImageDetail(imageId);
            if (dropScopeRef.current !== pendingScope) return;
            if (entry.sourceExists === false) throw new Error('The original image is unavailable.');
            const attachment = buildGeneratedImageContextAttachment(
              materializeCatalogEntryImage(entry),
            );
            updateConfig(
              'attachments',
              [...attachmentsRef.current, attachment].slice(0, maxAttachments),
            );
          } catch (error) {
            if (dropScopeRef.current !== pendingScope) return;
            addToast(
              error instanceof Error ? error.message : 'Could not add this image as a source.',
              'error',
            );
          } finally {
            dropInFlight.current = false;
          }
          return;
        }
        const files = Array.from(event.dataTransfer.files).filter((file) =>
          file.type.startsWith('image/'),
        );
        if (files.length) onFilesDrop(files);
      },
      [
        onFilesDrop,
        generationConfig.attachments,
        maxAttachments,
        updateConfig,
        addToast,
        attachmentsRef,
        dropScopeRef,
      ],
    );

    const negativePromptButton = showCodexPromptTools ? (
      <Tooltip content="Negative prompt">
        <button
          type="button"
          className={`create-icon-button ${isNegativeOpen || generationConfig.negativePrompt ? 'is-active' : ''}`}
          aria-label="Toggle negative prompt"
          aria-expanded={isNegativeOpen}
          aria-controls="create-negative-input"
          onClick={() => {
            setIsNegativeOpen(!isNegativeOpen);
            if (!isNegativeOpen) requestAnimationFrame(() => negativeInputRef.current?.focus());
          }}
        >
          <Ban width={15} height={15} aria-hidden="true" />
        </button>
      </Tooltip>
    ) : null;
    const negativePromptField =
      showCodexPromptTools && isNegativeOpen ? (
        <input
          ref={negativeInputRef}
          id="create-negative-input"
          aria-label="Negative prompt"
          type="text"
          className="studio-input mt-1 w-full"
          style={{ height: 30, minHeight: 30 }}
          value={generationConfig.negativePrompt || ''}
          onChange={(event) => updateConfig('negativePrompt', event.target.value)}
          placeholder="Exclude: blurry, low quality, distortion…"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setIsNegativeOpen(false);
          }}
        />
      ) : null;

    const fileInput = (
      <input
        type="file"
        ref={fileInputRef}
        onChange={onFileSelect}
        aria-label="Upload images"
        className="hidden"
        accept="image/*"
        multiple
      />
    );

    const promptField = (
      <LivePromptTextarea
        textareaRef={textareaRef}
        id={isRail ? 'create-prompt-input' : undefined}
        variant={isRail ? 'rail' : 'dock'}
        prompt={localPrompt}
        isScrambling={isScrambling}
        isHidden={isContextOnly}
        onFocus={() => {
          setIsInteracting(true);
          setIsPromptFocused(true);
        }}
        onBlur={() => {
          setIsPromptFocused(false);
          updateConfig('prompt', localPrompt);
          closeAllMenus();
        }}
        onChange={(e) => {
          const next = e.target.value;
          setLocalPrompt(next);
          setIsInteracting(true);
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = window.setTimeout(() => {
            lastPushedPromptRef.current = next;
            updateConfig('prompt', next);
          }, 300);
        }}
        onKeyDown={handleKeyDown}
        onPaste={(e) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          const files = Array.from(items as any as Iterable<DataTransferItem>).reduce<File[]>(
            (acc, item) => {
              if (!item.type.startsWith('image/')) return acc;
              const file = item.getAsFile();
              if (file !== null) acc.push(file);
              return acc;
            },
            [],
          );
          if (files.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            onFilesDrop(files);
          }
        }}
        onDrop={acceptRailImageDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      />
    );

    const referenceField = (
      <div className="create-reference-area" aria-label="Reference images">
        <div className="create-reference-heading">
          <span>{sourceFirst ? 'Source image' : 'References'}</span>
          <span className="create-reference-count">
            {generationConfig.attachments.length} / {maxAttachments}
          </span>
        </div>
        <div className="create-reference-list">
          {hasAttachments ? (
            <ReferenceTray
              attachments={generationConfig.attachments}
              onEdit={onOpenEditor}
              onRemove={onRemoveAttachment}
              onFiles={onFilesDrop}
              density="thumbs"
            />
          ) : (
            <span className="create-reference-empty">
              Drop an image or paste it into the prompt.
            </span>
          )}
          {isNearLimit ? null : (
            <button
              type="button"
              className="create-add-reference"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Add image reference"
            >
              <Plus width={16} height={16} aria-hidden="true" />
              <span>Add</span>
            </button>
          )}
        </div>
      </div>
    );

    return (
      <div
        ref={containerRef}
        data-toolbar-mode={mode}
        data-toolbar-layout={layout}
        onMouseEnter={handleToolbarMouseEnter}
        onMouseMove={handleToolbarMouseEnter}
        onMouseLeave={handleToolbarMouseLeave}
        className={
          isRail
            ? 'create-tool-composer relative z-50 flex h-full min-h-0 w-full flex-col'
            : 'w-full flex flex-col justify-end z-50 transition-colors duration-200 ease-out relative'
        }
      >
        {isRail ? null : (
          <div className="absolute inset-x-0 bottom-0 h-[106px] pointer-events-none bg-black/80 transition-colors duration-200 ease-out sm:h-[56px]" />
        )}

        <div
          className={
            isRail
              ? 'relative z-10 flex min-h-0 w-full flex-1 flex-col'
              : 'relative z-10 flex w-full flex-col items-stretch gap-1 px-2 py-1.5 sm:flex-row sm:items-end sm:gap-1.5'
          }
        >
          {fileInput}

          {isRail ? (
            <div ref={toolScrollRef} className="create-tool-scroll min-h-0 flex-1">
              {!sourceFirst || isContextOnly ? railTools : null}
              {isContextOnly ? (
                <>
                  <section className="create-tool-block" aria-label="Attachments">
                    <div className="create-section-header">
                      <span>References</span>
                      <span className="create-reference-count">
                        {generationConfig.attachments.length} / {maxAttachments}
                      </span>
                    </div>
                    <div
                      className={`create-composer ${composerDragDepth > 0 ? 'is-dragover' : ''}`}
                      onDragEnter={(event) => {
                        if (
                          !event.dataTransfer?.types.some(
                            (type) => type === 'Files' || type === CATALOG_IMAGE_DRAG_TYPE,
                          )
                        )
                          return;
                        event.preventDefault();
                        setComposerDragDepth((depth) => depth + 1);
                      }}
                      onDragOver={(event) => {
                        if (
                          !event.dataTransfer?.types.some(
                            (type) => type === 'Files' || type === CATALOG_IMAGE_DRAG_TYPE,
                          )
                        )
                          return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                      }}
                      onDragLeave={() => setComposerDragDepth((depth) => Math.max(0, depth - 1))}
                      onDrop={(event) => {
                        setComposerDragDepth(0);
                        void acceptRailImageDrop(event);
                      }}
                    >
                      <div className="create-reference-area">
                        <div className="create-reference-list">
                          {hasAttachments ? (
                            <ReferenceTray
                              attachments={generationConfig.attachments}
                              onEdit={onOpenEditor}
                              onRemove={onRemoveAttachment}
                              onFiles={onFilesDrop}
                              density="thumbs"
                            />
                          ) : (
                            <span className="create-reference-empty">
                              Drop an image or paste it into the prompt.
                            </span>
                          )}
                          {isNearLimit ? null : (
                            <button
                              type="button"
                              className="create-add-reference"
                              onClick={() => fileInputRef.current?.click()}
                              aria-label="Add image reference"
                            >
                              <Plus width={16} height={16} aria-hidden="true" />
                              <span>Add</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                  <OutputBackgroundControl
                    config={{ ...generationConfig, recipeId: activeRecipe }}
                    providerId={activeProviderId}
                    transport={selectedCodexTransport}
                    onChange={(value) => updateConfig('outputBackground', value)}
                  />
                  <p className="create-tool-hint">
                    Add references here. Use the selected task action above to continue.
                  </p>
                </>
              ) : (
                <>
                  <section className="create-prompt-section" aria-label="Prompt">
                    <div className="create-section-header">
                      <label htmlFor="create-prompt-input">Prompt</label>
                      <div className="create-prompt-tools">{negativePromptButton}</div>
                    </div>
                    <div
                      data-composer-input
                      className={`create-composer ${composerDragDepth > 0 ? 'is-dragover' : ''} ${shouldShowQuickStartError ? 'quick-start-error-frame' : ''}`}
                      onDragEnter={(event) => {
                        if (
                          !event.dataTransfer?.types.some(
                            (type) => type === 'Files' || type === CATALOG_IMAGE_DRAG_TYPE,
                          )
                        )
                          return;
                        event.preventDefault();
                        setComposerDragDepth((depth) => depth + 1);
                      }}
                      onDragOver={(event) => {
                        if (
                          !event.dataTransfer?.types.some(
                            (type) => type === 'Files' || type === CATALOG_IMAGE_DRAG_TYPE,
                          )
                        )
                          return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                      }}
                      onDragLeave={() => setComposerDragDepth((depth) => Math.max(0, depth - 1))}
                      onDrop={(event) => {
                        setComposerDragDepth(0);
                        void acceptRailImageDrop(event);
                      }}
                    >
                      {showQuickStartErrorText ? (
                        <div className="quick-start-error-float pointer-events-none absolute -top-5 left-4 z-[120] text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-danger)]">
                          {requirement?.message ?? 'Add a prompt or image.'}
                        </div>
                      ) : null}
                      {sourceFirst ? referenceField : null}
                      {promptField}
                      {!sourceFirst ? referenceField : null}
                    </div>
                    {negativePromptField}
                    {shouldShowQuickStartError ? (
                      <p id="generation-requirement" className="create-prompt-error" role="status">
                        {requirement?.message ?? 'Add a prompt or image.'}
                      </p>
                    ) : null}
                  </section>

                  {sourceFirst ? railTools : null}
                  <OutputBackgroundControl
                    config={{ ...generationConfig, recipeId: activeRecipe }}
                    providerId={activeProviderId}
                    transport={selectedCodexTransport}
                    onChange={(value) => updateConfig('outputBackground', value)}
                  />
                  <div
                    className="create-output-grid"
                    data-has-size={showSizeControl ? 'true' : undefined}
                  >
                    <div className="create-field">
                      <span className="create-field-label" id="create-format-label">
                        Format
                      </span>
                      <button
                        ref={aspectRatioButtonRef}
                        type="button"
                        className="create-select-field"
                        aria-haspopup="listbox"
                        aria-expanded={isAspectRatioOpen}
                        aria-label={`Format: ${generationConfig.aspectRatio}, ${formatOrientation}`}
                        onClick={() => {
                          setIsAspectRatioOpen(!isAspectRatioOpen);
                          setIsExecutionOpen(false);
                          setIsSizeOpen(false);
                          setIsBatchOpen(false);
                        }}
                      >
                        <span className="create-ratio-symbol" aria-hidden="true">
                          <span
                            className="create-ratio-shape"
                            style={getRatioShapeStyle(generationConfig.aspectRatio)}
                          />
                        </span>
                        <span className="create-select-value">
                          <strong id="create-format-value">{generationConfig.aspectRatio}</strong>
                          <small id="create-format-orientation">{formatOrientation}</small>
                        </span>
                        <ChevronDown width={14} height={14} aria-hidden="true" />
                      </button>
                      <DemandMountedGsapDropdown
                        portal
                        data-toolbar-popup
                        open={isAspectRatioOpen}
                        onOpenChange={setIsAspectRatioOpen}
                        triggerRef={aspectRatioButtonRef}
                        placement="bottom-left"
                        role="listbox"
                        aria-label="Output format"
                        className="create-format-popover"
                      >
                        <div className="create-popover-title">Output format</div>
                        <div className="create-ratio-grid">
                          {currentRatios.map((option) => {
                            const selected = generationConfig.aspectRatio === option.ratio;
                            const orientation =
                              RATIO_ORIENTATION_LABELS[getRatioOrientation(option.ratio)];
                            return (
                              <button
                                type="button"
                                key={option.ratio}
                                role="option"
                                aria-selected={selected}
                                aria-label={`${option.ratio} · ${orientation}`}
                                className={`create-ratio-choice${selected ? ' is-selected' : ''}`}
                                onClick={() => {
                                  updateConfig('aspectRatio', option.ratio);
                                  setIsAspectRatioOpen(false);
                                  setPreviewRatio(null);
                                }}
                                onMouseEnter={() => setPreviewRatio(option.ratio)}
                                onMouseLeave={() => setPreviewRatio(null)}
                              >
                                <span className="create-ratio-symbol" aria-hidden="true">
                                  <span
                                    className="create-ratio-shape"
                                    style={getRatioShapeStyle(option.ratio, 31, 27)}
                                  />
                                </span>
                                <span className="create-ratio-label">{option.ratio}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="create-popover-note">
                          {showSizeControl
                            ? 'Aspect ratio. Choose 1K, 2K, or 4K next to it.'
                            : 'Aspect ratio, not resolution.'}
                        </div>
                      </DemandMountedGsapDropdown>
                    </div>
                    {showSizeControl ? (
                      <div className="create-field">
                        <span className="create-field-label" id="create-size-label">
                          Size
                        </span>
                        <button
                          ref={sizeButtonRef}
                          type="button"
                          className="create-select-field"
                          aria-haspopup="listbox"
                          aria-expanded={isSizeOpen}
                          aria-label={`Image size: ${selectedExecutionImageSize?.tier ?? generationConfig.imageSize ?? '1K'}`}
                          onClick={() => {
                            setIsSizeOpen(!isSizeOpen);
                            setIsAspectRatioOpen(false);
                            setIsExecutionOpen(false);
                            setIsBatchOpen(false);
                          }}
                        >
                          <span className="create-select-value">
                            <strong>{selectedExecutionImageSize?.tier ?? '1K'}</strong>
                            <small>
                              {selectedExecutionImageSize
                                ? `${selectedExecutionImageSize.width}×${selectedExecutionImageSize.height}`
                                : 'Default'}
                            </small>
                          </span>
                          <ChevronDown width={14} height={14} aria-hidden="true" />
                        </button>
                        <DemandMountedGsapDropdown
                          portal
                          data-toolbar-popup
                          open={isSizeOpen}
                          onOpenChange={setIsSizeOpen}
                          triggerRef={sizeButtonRef}
                          placement="bottom-left"
                          role="listbox"
                          aria-label="Image size"
                          className="create-format-popover"
                        >
                          <div className="create-popover-title">Image size</div>
                          <div className="flex flex-col gap-1.5">
                            {executionImageSizeOptions.map((option) => {
                              const selected = selectedExecutionImageSize?.tier === option.tier;
                              return (
                                <button
                                  type="button"
                                  key={option.tier}
                                  role="option"
                                  aria-selected={selected}
                                  aria-label={`${option.tier}: ${option.width}×${option.height}`}
                                  className={`create-size-choice${selected ? ' is-selected' : ''}`}
                                  onClick={() => {
                                    handleSelectExecutionImageSize(option.tier);
                                    setIsSizeOpen(false);
                                  }}
                                >
                                  <span className="create-select-value">
                                    <strong>{option.tier}</strong>
                                    <small>
                                      {option.width}×{option.height}
                                      {option.experimental ? ' · experimental' : ''}
                                    </small>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          {selectedExecutionImageSize?.experimental ? (
                            <div className="create-popover-note">
                              ChatGPT marks output above 2560×1440 as experimental.
                            </div>
                          ) : (
                            <div className="create-popover-note">
                              Available with ChatGPT Sign in and GPT Image models.
                            </div>
                          )}
                        </DemandMountedGsapDropdown>
                      </div>
                    ) : null}
                    <div className="create-field">
                      <label className="create-field-label" htmlFor="create-quantity-input">
                        Images
                      </label>
                      <div className="create-stepper">
                        <button
                          type="button"
                          className="create-step-button"
                          aria-label="Decrease image count"
                          disabled={currentBatch === previousBatchCount}
                          onClick={() => updateConfig('batchCount', previousBatchCount)}
                        >
                          <Minus width={16} height={16} />
                        </button>
                        <input
                          id="create-quantity-input"
                          className="create-quantity-input"
                          type="text"
                          inputMode="numeric"
                          value={String(currentBatch)}
                          role="spinbutton"
                          aria-valuemin={1}
                          aria-valuemax={maxOutputCount}
                          aria-valuenow={currentBatch}
                          aria-label="Image count"
                          autoComplete="off"
                          onChange={(event) => {
                            const rawValue = event.target.value.trim();
                            if (!/^\d+$/.test(rawValue)) return;
                            const value = Number.parseInt(rawValue, 10);
                            if (Number.isInteger(value) && value >= 1 && value <= maxOutputCount) {
                              updateConfig('batchCount', value);
                            }
                          }}
                          onBlur={() => updateConfig('batchCount', currentBatch)}
                        />
                        <button
                          type="button"
                          className="create-step-button"
                          aria-label="Increase image count"
                          disabled={currentBatch === nextBatchCount}
                          onClick={() => updateConfig('batchCount', nextBatchCount)}
                        >
                          <Plus width={16} height={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 relative min-w-0">
              {/* Input Container */}
              <div
                data-composer-input
                className={`studio-field flex min-h-9 items-end gap-1.5 p-1 px-2 transition-colors duration-300 ${shouldShowQuickStartError ? 'quick-start-error-frame' : ''}`}
              >
                {showQuickStartErrorText && (
                  <div className="quick-start-error-float pointer-events-none absolute -top-5 left-4 z-[120] text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-danger)] animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
                    {requirement?.message ?? 'Add a prompt or image.'}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isNearLimit}
                  aria-label="Add image reference"
                  className={iconBtnClass}
                  data-tooltip="Add Image"
                >
                  <PlusCircle width={17} height={17} />
                </button>

                {hasAttachments && (
                  <ReferenceTray
                    attachments={generationConfig.attachments}
                    onEdit={onOpenEditor}
                    onRemove={onRemoveAttachment}
                    onFiles={onFilesDrop}
                  />
                )}

                {activeRecipeIndicator && (
                  <div
                    data-active-recipe-card={activeRecipeIndicator.id}
                    aria-label={`Active recipe: ${activeRecipeIndicator.title}. ${activeRecipeIndicator.summary}.`}
                    data-tooltip={`${activeRecipeIndicator.title}: ${activeRecipeIndicator.summary}`}
                    className={`group flex h-10 min-h-10 min-w-[6rem] max-w-[10.75rem] flex-[0_1_10.75rem] items-center gap-1.5 overflow-hidden rounded-[var(--wb-radius)] border px-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,box-shadow] hover:shadow-[0_0_18px_rgba(255,255,255,0.05)] sm:flex-[0_0_10.75rem] ${activeRecipeIndicator.toneClassName}`}
                  >
                    <span
                      className={`h-5 w-1 shrink-0 rounded-[var(--wb-radius)] shadow-[0_0_12px_currentColor] ${activeRecipeIndicator.dotClassName}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-[length:var(--wbp-label)] font-semibold leading-none tracking-[0.12em] opacity-60">
                        Recipe
                      </span>
                      <span className="block truncate text-[11px] font-semibold leading-tight tracking-[0.06em] text-[color:var(--wb-ink)]">
                        {activeRecipeIndicator.title}
                      </span>
                      <span className="block truncate text-[length:var(--wbp-label)] font-medium leading-none opacity-70">
                        {activeRecipeIndicator.summary}
                      </span>
                    </span>
                  </div>
                )}

                {isContextOnly ? (
                  <div
                    data-task-context
                    className="studio-muted hidden min-w-0 flex-1 px-1.5 py-1 text-[11px] leading-relaxed sm:block"
                  >
                    Add references here. Use the selected task action above to continue.
                  </div>
                ) : null}

                {promptField}

                {/* LOGIC AI TOOLS */}
                <div
                  className={`${
                    showCodexPromptTools
                      ? isContextOnly
                        ? 'flex shrink-0 items-center gap-1.5'
                        : 'hidden shrink-0 items-center gap-1.5 sm:flex sm:gap-2'
                      : 'hidden'
                  }`}
                >
                  {negativePromptButton}
                </div>
              </div>
              {negativePromptField}
            </div>
          )}

          {/* CONTROLS ROW */}
          <div
            className={
              isRail
                ? 'create-tool-footer'
                : 'studio-field pointer-events-auto flex w-full min-w-0 items-end justify-between gap-1 p-1 transition-colors duration-300 sm:w-auto sm:justify-start'
            }
          >
            {isRail ? null : (
              <button
                type="button"
                onClick={() => {
                  closeAllMenus();
                  setIsNegativeOpen(false);
                  setIsMobileControlsOpen(true);
                }}
                aria-label={
                  isContextOnly ? 'Open frame context controls' : 'Open generation controls'
                }
                aria-expanded={isMobileControlsOpen}
                className={`${btnClass} min-w-0 flex-1 sm:hidden`}
              >
                <SlidersHorizontal width={14} height={14} />
                <span>{isContextOnly ? 'Context' : 'Controls'}</span>
              </button>
            )}

            <div
              className={
                isRail
                  ? 'create-tool-execution'
                  : `${isMobileControlsOpen ? 'fixed' : 'hidden'} studio-popover custom-scrollbar inset-x-2 z-[90] flex-col gap-3 overflow-y-auto p-3 sm:static sm:flex sm:max-h-none sm:flex-row sm:items-end sm:gap-1 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`
              }
              style={
                !isRail && isMobileControlsOpen
                  ? {
                      bottom: 'calc(var(--studio-mobile-dock-height) + 0.75rem)',
                      maxHeight: 'min(62vh, 28rem)',
                    }
                  : undefined
              }
            >
              <div
                className={
                  isRail
                    ? 'hidden'
                    : 'flex items-center justify-between border-b border-white/2 pb-2 sm:hidden'
                }
              >
                <div className="text-[length:var(--wbp-label)] font-semibold tracking-[0.16em] text-zinc-500">
                  {isContextOnly ? 'Frame context' : 'Generation'}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    closeAllMenus();
                    setIsMobileControlsOpen(false);
                  }}
                  aria-label="Close generation controls"
                  className="flex size-10 items-center justify-center rounded-[var(--wb-radius)] border border-white/2 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X width={14} height={14} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:contents">
                {!isRail && (
                  <OutputBackgroundControl
                    config={{ ...generationConfig, recipeId: activeRecipe }}
                    providerId={activeProviderId}
                    transport={selectedCodexTransport}
                    onChange={(value) => updateConfig('outputBackground', value)}
                  />
                )}
                {isRail || isContextOnly ? null : (
                  <div className="relative min-w-0">
                    <button
                      ref={aspectRatioButtonRef}
                      type="button"
                      onClick={() => {
                        setIsAspectRatioOpen(!isAspectRatioOpen);
                        setIsExecutionOpen(false);
                        setIsBatchOpen(false);
                      }}
                      aria-label={`Aspect ratio: ${generationConfig.aspectRatio}`}
                      aria-haspopup="menu"
                      aria-expanded={isAspectRatioOpen}
                      className={btnClass}
                    >
                      <AspectRatioIcon ratio={generationConfig.aspectRatio} />
                      <span>{generationConfig.aspectRatio}</span>
                    </button>
                    <DemandMountedGsapDropdown
                      portal
                      data-toolbar-popup
                      open={isAspectRatioOpen}
                      onOpenChange={setIsAspectRatioOpen}
                      triggerRef={aspectRatioButtonRef}
                      placement="top-left"
                      className="studio-mobile-popover absolute bottom-full left-0 z-[100] mb-4 grid w-[270px] grid-cols-3 gap-2 p-3"
                    >
                      {currentRatios.map((option) => (
                        <button
                          type="button"
                          key={option.ratio}
                          role="menuitemradio"
                          aria-checked={generationConfig.aspectRatio === option.ratio}
                          data-dropdown-item
                          onClick={() => {
                            updateConfig('aspectRatio', option.ratio);
                            setIsAspectRatioOpen(false);
                            setPreviewRatio(null);
                          }}
                          onMouseEnter={() => setPreviewRatio(option.ratio)}
                          data-tooltip={`${option.label}: ${option.size}`}
                          className={`aspect-square rounded-[var(--wb-radius)] flex flex-col items-center justify-center gap-1 transition-[color,background-color,border-color,opacity,transform,box-shadow] ${
                            generationConfig.aspectRatio === option.ratio
                              ? 'bg-gradient-to-b from-accent-700 to-accent-900 border border-accent-600/2 text-white shadow-lg'
                              : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <AspectRatioIcon ratio={option.ratio} />
                          <span className="text-[length:var(--wbp-label)] font-semibold">
                            {option.ratio}
                          </span>
                          <span className="text-[6px] font-bold text-zinc-500">{option.size}</span>
                        </button>
                      ))}
                    </DemandMountedGsapDropdown>
                  </div>
                )}

                {/* Resolution */}
                {showSizeControl && !isRail ? (
                  <div className="relative min-w-0">
                    <button
                      ref={sizeButtonRef}
                      type="button"
                      onClick={() => {
                        setIsSizeOpen(!isSizeOpen);
                        setIsExecutionOpen(false);
                      }}
                      aria-label={`Image size: ${generationConfig.imageSize || '1K'}`}
                      aria-haspopup="menu"
                      aria-expanded={isSizeOpen}
                      className={btnClass}
                    >
                      <Monitor width={14} height={14} />
                      <span>{generationConfig.imageSize || '1K'}</span>
                    </button>
                    <DemandMountedGsapDropdown
                      portal
                      data-toolbar-popup
                      open={isSizeOpen}
                      onOpenChange={setIsSizeOpen}
                      triggerRef={sizeButtonRef}
                      placement="top-left"
                      className="studio-mobile-popover absolute bottom-full left-0 z-[100] mb-4 flex min-w-24 flex-col gap-1 p-2"
                    >
                      {currentSizes.map((option) => (
                        <button
                          type="button"
                          key={option.tier}
                          role="menuitemradio"
                          aria-checked={selectedExecutionImageSize?.tier === option.tier}
                          data-dropdown-item
                          onClick={() => {
                            handleSelectExecutionImageSize(option.tier);
                            setIsSizeOpen(false);
                          }}
                          className={`min-h-10 w-full rounded-[var(--wb-radius)] px-3 text-left text-[length:var(--wbp-label)] font-semibold transition-[color,background-color,border-color,opacity,transform] ${selectedExecutionImageSize?.tier === option.tier ? 'bg-gradient-to-r from-accent-700 to-accent-800 text-white' : 'text-zinc-400 hover:bg-white/10'}`}
                        >
                          {option.tier}
                          <span className="mt-0.5 block text-[length:var(--wbp-label)] font-bold tracking-normal text-zinc-500">
                            {option.width}×{option.height}
                          </span>
                        </button>
                      ))}
                    </DemandMountedGsapDropdown>
                  </div>
                ) : null}

                {isRail || isContextOnly ? null : (
                  <div className="relative min-w-0">
                    <button
                      ref={batchButtonRef}
                      type="button"
                      onClick={() => {
                        setIsBatchOpen(!isBatchOpen);
                        setIsExecutionOpen(false);
                      }}
                      aria-label={`Batch count: ${generationConfig.batchCount || 1}`}
                      aria-haspopup="menu"
                      aria-expanded={isBatchOpen}
                      className={btnClass}
                    >
                      <Layers width={14} height={14} />
                      <span>{generationConfig.batchCount || 1}x</span>
                    </button>
                    <DemandMountedGsapDropdown
                      portal
                      data-toolbar-popup
                      open={isBatchOpen}
                      onOpenChange={setIsBatchOpen}
                      triggerRef={batchButtonRef}
                      placement="top-left"
                      className="studio-mobile-popover absolute bottom-full left-0 z-[100] mb-4 flex gap-2 p-2"
                    >
                      {batchCounts.map((count) => (
                        <button
                          type="button"
                          key={count}
                          role="menuitemradio"
                          aria-checked={generationConfig.batchCount === count}
                          data-dropdown-item
                          onClick={() => {
                            updateConfig('batchCount', count);
                            setIsBatchOpen(false);
                          }}
                          className={`flex size-10 touch-manipulation items-center justify-center rounded-[var(--wb-radius)] text-[length:var(--wbp-label)] font-semibold transition-[color,background-color,border-color,opacity,transform] ${generationConfig.batchCount === count ? 'bg-gradient-to-b from-accent-700 to-accent-900 border border-accent-600/2 text-white' : 'bg-white/5 text-zinc-400 hover:bg-white/10'}`}
                        >
                          {count}
                        </button>
                      ))}
                    </DemandMountedGsapDropdown>
                  </div>
                )}

                <div className={isRail ? 'create-tool-provider-row' : 'contents'}>
                  {commandCenter && onSelectProvider ? (
                    <ProviderQuickSwitch
                      provider={commandCenter.provider}
                      providerOptions={commandCenter.providerOptions}
                      compactMode={commandCenter.compactMode}
                      isProviderSaving={isProviderSaving}
                      onSelectProvider={onSelectProvider}
                      onOpenSettings={onOpenSettings}
                      placement="top-left"
                      showLabel
                      variant={isRail ? 'rail' : 'toolbar'}
                      className={isRail ? 'min-w-0' : undefined}
                      triggerClassName={isRail ? 'create-tool-chip' : btnClass}
                    />
                  ) : null}

                  {showCodexModelChrome ? (
                    <div className="relative min-w-0">
                      <button
                        ref={executionButtonRef}
                        type="button"
                        onClick={() => {
                          setIsExecutionOpen(!isExecutionOpen);
                          setIsAspectRatioOpen(false);
                          setIsSizeOpen(false);
                          setIsBatchOpen(false);
                        }}
                        aria-label={`${activeProviderId === 'chatgpt' ? 'ChatGPT' : 'Codex'} task execution: ${executionSummary}`}
                        aria-haspopup="dialog"
                        aria-expanded={isExecutionOpen}
                        className={isRail ? 'create-tool-chip' : btnClass}
                      >
                        {isRail ? null : <BrainCircuit width={14} height={14} />}
                        {isRail ? (
                          <span className="create-engine-copy">
                            <span className="create-engine-kicker">Model</span>
                            <span className="create-engine-name">{executionChipLabel}</span>
                          </span>
                        ) : (
                          <span className="min-w-0 truncate text-[length:var(--wbp-label)]">
                            {executionSummary}
                          </span>
                        )}
                        {isRail ? <ChevronDown width={12} height={12} aria-hidden="true" /> : null}
                      </button>
                      <DemandMountedGsapDropdown
                        portal
                        data-toolbar-popup
                        open={isExecutionOpen}
                        onOpenChange={setIsExecutionOpen}
                        triggerRef={executionButtonRef}
                        placement="top-right"
                        role="dialog"
                        aria-label="Image generation settings"
                        className="create-execution-menu"
                      >
                        <header className="create-execution-header">
                          <div>
                            <h3>Generation settings</h3>
                            <p>Applies to the next image.</p>
                          </div>
                          {activeProviderId === 'codex' && isLoadingCodexModelCatalog && (
                            <Loader2 size={14} className="animate-spin" />
                          )}
                          <button
                            type="button"
                            className="studio-ghost-control"
                            aria-label="Close generation settings"
                            onClick={() => setIsExecutionOpen(false)}
                          >
                            <X width={14} height={14} />
                          </button>
                        </header>
                        <div className="create-execution-body">
                          <section aria-labelledby="codex-execution-model-label">
                            <h4 id="codex-execution-model-label">Text model</h4>
                            {selectedCodexTransport === 'subscription_http' ? (
                              <div className="create-execution-managed">
                                <strong>
                                  {selectedExecutionModel?.displayName ||
                                    generationConfig.executionModel}
                                </strong>
                                <span>Managed by ChatGPT</span>
                              </div>
                            ) : (
                              <div className="create-execution-model-list">
                                {codexModels.map((model) => {
                                  const isSelected = model.id === selectedExecutionModel?.id;
                                  const modelLabel = formatCodexModelLabel(
                                    model.id,
                                    model.displayName,
                                  );
                                  return (
                                    <button
                                      type="button"
                                      key={model.id}
                                      data-codex-model={model.id}
                                      aria-pressed={isSelected}
                                      aria-label={modelLabel}
                                      data-tooltip={model.description || modelLabel}
                                      onClick={() => handleSelectExecutionModel(model)}
                                      className="studio-ghost-control create-execution-choice"
                                    >
                                      <span className="create-execution-copy">
                                        <strong>{model.displayName || modelLabel}</strong>
                                      </span>
                                      {model.isDefault && (
                                        <span className="create-execution-badge">Default</span>
                                      )}
                                      {getCodexSpeedOptions(model).includes('fast') && (
                                        <span className="create-execution-badge">Fast</span>
                                      )}
                                      {isSelected && (
                                        <Check width={14} height={14} aria-hidden="true" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </section>

                          {selectedCodexTransport === 'subscription_http' ? (
                            <>
                              <section aria-labelledby="codex-image-model-label">
                                <h4 id="codex-image-model-label">Image model</h4>
                                <div className="create-execution-options">
                                  {executionImageModels.map((imageModel) => {
                                    const isSelected =
                                      imageModel.id === selectedExecutionImageModel?.id;
                                    return (
                                      <button
                                        type="button"
                                        key={imageModel.id}
                                        data-codex-image-model={imageModel.id}
                                        aria-pressed={isSelected}
                                        aria-label={imageModel.displayName}
                                        onClick={() => handleSelectExecutionImageModel(imageModel)}
                                        className="studio-ghost-control create-execution-choice"
                                      >
                                        <span className="create-execution-copy">
                                          <strong>{imageModel.displayName}</strong>
                                        </span>
                                        {imageModel.lifecycle === 'previous' && (
                                          <span className="create-execution-badge">Previous</span>
                                        )}
                                        {isSelected && (
                                          <Check width={14} height={14} aria-hidden="true" />
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </section>
                              <section aria-labelledby="codex-image-size-label">
                                <h4 id="codex-image-size-label">Output size</h4>
                                <div
                                  className="create-execution-sizes"
                                  role="group"
                                  aria-label="ChatGPT image size"
                                >
                                  {executionImageSizeOptions.map((option) => (
                                    <button
                                      type="button"
                                      key={option.tier}
                                      data-codex-image-size={option.tier}
                                      aria-pressed={
                                        selectedExecutionImageSize?.tier === option.tier
                                      }
                                      aria-label={`${option.tier}: ${option.width}×${option.height}`}
                                      data-tooltip={`${option.width}×${option.height}${option.experimental ? ' · experimental' : ''}`}
                                      onClick={() => handleSelectExecutionImageSize(option.tier)}
                                      className="studio-ghost-control create-execution-choice"
                                    >
                                      <span className="create-execution-copy">
                                        <strong>{option.tier}</strong>
                                        <small>
                                          {option.width}×{option.height}
                                        </small>
                                      </span>
                                    </button>
                                  ))}
                                </div>
                                {selectedExecutionImageSize?.experimental && (
                                  <p className="create-execution-note">
                                    ChatGPT marks output above 2560×1440 as experimental.
                                  </p>
                                )}
                              </section>
                              <p className="create-execution-note">
                                Reasoning and speed are managed by ChatGPT.
                              </p>
                            </>
                          ) : (
                            <div className="create-execution-tuning">
                              <section aria-labelledby="codex-reasoning-label">
                                <h4 id="codex-reasoning-label">Reasoning</h4>
                                <div className="create-execution-segments">
                                  {executionReasoningOptions.map((effort) => {
                                    const isManaged = effort === 'provider_default';
                                    const label = isManaged
                                      ? 'Auto'
                                      : effort.charAt(0).toUpperCase() + effort.slice(1);
                                    return (
                                      <button
                                        type="button"
                                        key={effort}
                                        aria-label={`Reasoning: ${isManaged ? 'Managed' : effort}`}
                                        aria-pressed={
                                          generationConfig.executionReasoningEffort === effort
                                        }
                                        onClick={() => {
                                          if (!isManaged)
                                            updateConfig('executionReasoningEffort', effort);
                                        }}
                                        className="studio-ghost-control create-execution-choice"
                                      >
                                        {label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </section>
                              <section aria-labelledby="codex-speed-label">
                                <h4 id="codex-speed-label">Speed</h4>
                                <div className="create-execution-segments">
                                  {executionSpeedOptions.map((speed) => (
                                    <button
                                      type="button"
                                      key={speed}
                                      aria-label={`Speed: ${formatCodexSpeedLabel(speed)}`}
                                      aria-pressed={generationConfig.executionSpeed === speed}
                                      onClick={() => handleSelectExecutionSpeed(speed)}
                                      className="studio-ghost-control create-execution-choice"
                                    >
                                      {formatCodexSpeedLabel(speed)}
                                    </button>
                                  ))}
                                </div>
                              </section>
                            </div>
                          )}
                        </div>

                        {executionSourceMessage && (
                          <div className="create-execution-warning">{executionSourceMessage}</div>
                        )}
                      </DemandMountedGsapDropdown>
                    </div>
                  ) : commandCenter && onSelectProvider ? null : (
                    <div
                      role="status"
                      aria-label={`Generation provider: ${formatGenerationProviderLabel(activeProviderId)}`}
                      data-tooltip="Generation provider"
                      className={`${btnClass} cursor-default`}
                    >
                      <Zap width={14} height={14} />
                      <span className="text-[length:var(--wbp-label)] font-semibold tracking-normal">
                        {formatGenerationProviderLabel(activeProviderId)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!isRail && requirement ? (
              <p id="generation-requirement" className="create-style-empty" role="status">
                {requirement.message}
              </p>
            ) : null}
            {isRail ? railAction : null}
            {!isContextOnly ? (
              <Tooltip
                content={generateBlock?.message || 'Generate images'}
                position="top"
                className={isRail ? 'w-full' : undefined}
                hidden={isRail && !generateBlock}
              >
                <button
                  type="button"
                  onClick={handleTriggerGenerate}
                  disabled={Boolean(generateBlock)}
                  data-tooltip={generateBlock?.message ?? requirement?.message}
                  aria-describedby={
                    requirement
                      ? 'generation-requirement'
                      : generateBlock
                        ? 'grok-generate-block'
                        : undefined
                  }
                  data-studio-generate-button
                  data-generate-active={isGenerating ? 'true' : 'false'}
                  className={
                    isRail
                      ? `create-generate-button ${isGenerating ? 'is-busy' : ''}`
                      : `group relative h-10 min-h-10 min-w-[8.75rem] px-4 rounded-[var(--wb-radius)] flex items-center justify-center gap-2 sm:ml-1 overflow-hidden
                    text-[length:var(--wbp-label)] tracking-normal font-semibold transition-[color,background-color,border-color,opacity,transform,box-shadow] cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${
                      isGenerating
                        ? 'bg-gradient-to-b from-accent-800 to-accent-950 text-accent-200 border border-accent-500/2 shadow-lg hover:border-accent-300/2 hover:text-white active:scale-95'
                        : 'bg-gradient-to-b from-accent-700 via-accent-800 to-accent-950 hover:from-accent-600 hover:via-accent-700 hover:to-accent-900 text-accent-100 border-t border-accent-500/2 shadow-[0_4px_20px_rgba(0,0,0,0.5)] hover:shadow-[0_0_25px_rgba(var(--accent-600),0.3)] active:scale-95'
                    }`
                  }
                >
                  {isGenerating ? (
                    <GenerationElapsedStatus
                      startTime={generationStartTime}
                      variant={isRail ? 'rail' : 'dock'}
                    />
                  ) : isRail ? (
                    <>
                      <Sparkles width={17} height={17} aria-hidden="true" />
                      <span>{`Generate ${outputSummary}`}</span>
                    </>
                  ) : (
                    <>
                      <div className="absolute inset-0 z-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:animate-[shimmer_1.5s_infinite]" />
                      <div className="relative z-10 flex items-center gap-2">
                        <>
                          <Wand2
                            width={14}
                            height={14}
                            className="group-hover:rotate-12 transition-transform text-accent-300"
                          />
                          <span className="text-white">GENERATE</span>
                        </>
                      </div>
                    </>
                  )}
                </button>
              </Tooltip>
            ) : null}
            {isRail && !isContextOnly ? (
              <div className="create-footer-meta">
                <span className="create-local-status">
                  <span className="create-status-dot" aria-hidden="true" />
                  <span
                    id={
                      generateBlock
                        ? 'grok-generate-block'
                        : requirement && !shouldShowQuickStartError
                          ? 'generation-requirement'
                          : undefined
                    }
                    role={
                      generateBlock || (requirement && !shouldShowQuickStartError)
                        ? 'status'
                        : undefined
                    }
                  >
                    {generateBlock?.message ??
                      (isGenerating
                        ? 'Generating'
                        : shouldShowQuickStartError
                          ? ''
                          : (requirement?.message ?? 'Ready to generate'))}
                  </span>
                </span>
                {isGenerating ? null : <kbd className="create-shortcut-hint">{shortcutHint}</kbd>}
              </div>
            ) : null}
          </div>
          {generateBlock && !isRail ? (
            <p
              id="grok-generate-block"
              role="status"
              className="order-first mt-0 max-w-xl text-[11px] font-medium leading-relaxed text-[color:var(--wb-warning)] sm:order-none sm:mt-2"
            >
              {generateBlock.message}
            </p>
          ) : null}
        </div>

        {/* Key Selector Popover (External) */}
        <KeyPopover
          isOpen={isKeyPopoverOpen}
          onClose={onOpenKeySelector}
          onSelectKey={onSelectKey}
        />
      </div>
    );
  },
);
