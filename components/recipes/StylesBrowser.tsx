import { RecipeWorkbenchContext } from './recipeWorkbenchContextState';
import { getStyleCategoryDisplayName } from './styles/collections/categoryDisplayNames';
import { runtimeLogger } from '../../utils/runtimeLogger';
import { AnimatePresence } from '../../lib/gsapMotion';
import { useWorkspaceState } from '../../contexts/GlobalContext';
import {
  Check,
  Heart,
  ViewGrid as LayoutGrid,
  MultiplePages as Layers,
  Play,
  ControlSlider as SlidersHorizontal,
  Sparks as Sparkles,
  Xmark as X,
} from 'iconoir-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLatestRef } from '../../hooks/useLatestRef';
import {
  getStyleCategoryImage,
  getStyleThumbnail,
  STYLE_CATEGORY_PREVIEWS,
  resolveStyleDefaultImageThumbnail,
  resolveStyleDefaultImageVariantThumbnails,
} from '../../lib/styleThumbnailCatalog';
import { styleCategoryImageKey } from '../../lib/recipeAssetKeys';
import { hasStylePresetIdentity } from '../../lib/recipeIdentity';
import type { Attachment, GeneratedImageWithConfig, ImageGenerationConfig } from '../../types';
import type { EditableStudioSettings, GenerationProviderId } from '../../packages/shared/src';
import { resolveGrokImagineGenerateBlock } from '../../lib/grokImagineUiPolicy';
import { useStyleRuntimePacks } from '../../hooks/useStyleRuntimePacks';
import { LazySurfaceFallback } from '../ui/LazySurfaceFallback';
import {
  RecipeControls,
  RecipeOverlay,
  RecipeSidePanel,
  RecipeResults,
} from './RecipeWorkbenchContext';
import { RecipeLayout } from './RecipeLayout';
import {
  STYLE_BROWSER_EAGER_SECTION_LIMIT,
  collectStylePresetPreviewSources,
  createStyleBrowserProcessedData,
  createStyleBrowserRenderPlan,
} from './styleBrowserRenderPlan';
import { fitStyleGridColumns, resolveStyleGridColumns } from './styleGridVirtualization';
import {
  createStylePresetCatalogSearchIndexFromRuntimePacks,
  type StylePresetCatalogSearchResult,
} from './stylePresetManifests';
import {
  getStyleRuntimePresetDisplayName,
  STYLE_RUNTIME_PACK_SUMMARIES,
  type StyleRuntimePreset,
} from './stylesData';
import type { ArchivedStylePresetEntry } from './archivedStylePresets';
import { resolveStyleRuntimePackLoadRequest } from './styleRuntimePackRequirements';
import {
  getStyleCollectionIdFromTabId,
  getStyleCollectionTabId,
  getStyleTabHash as getStyleTabHashForRoute,
  normalizeStyleTabId as normalizeStyleTabRouteId,
  readStyleTabIdFromHash as readStyleTabIdFromRouteHash,
  STYLE_PACKS_TAB_ID,
  STYLE_RECIPE_HASH_PREFIX,
  type StyleTabId,
  type StyleTabRouteOptions,
} from './styleTabRouting';
import {
  USER_STYLE_PACK_DESCRIPTION,
  USER_STYLE_PACK_ID,
  USER_STYLE_PACK_NAME,
  userStylePresetToRuntimePreset,
} from './userStyleRuntimeAdapter';
import { useUserStyleLibrary } from './useUserStyleLibrary';
import { useStyleComposition } from './useStyleComposition';
import { useStyleBrowserNavigation } from './useStyleBrowserNavigation';
import { projectActiveStylePack } from './styleActivePackProjection';
import { groupStyleResultImagesByPreset } from './styleResultImagesByPreset';
import {
  PACK_THEMES,
  getPackIcon,
  getStyleCollectionIcon,
  getStyleCollectionTheme,
} from './styleNavigationPresentation';
import type {
  StyleRecipeNavigationItem,
  StyleRecipeNavigationSection,
} from './StyleRecipeNavigationPanel';
import type { StylePresetSourceProvenance, StylePresetVisualState } from './StylePresetCardSurface';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { FAVORITES_PACK_ID, ALL_STYLE_CARDS_TAB_ID } from './styleTabRouting';
const StyleCatalogPanel = React.lazy(() =>
  import('./StyleCatalogPanel').then((module) => ({ default: module.StyleCatalogPanel })),
);

const StyleDetailPreview = React.lazy(() => import('./StyleDetailPreview'));

export interface StylesBrowserProps {
  catalogOnly?: boolean;
  config: ImageGenerationConfig;
  updateConfig: <K extends keyof ImageGenerationConfig>(
    key: K,
    value: ImageGenerationConfig[K],
  ) => void;
  updateAttachment: (id: string, newProps: Partial<Attachment>) => void;
  onFileSelect: (files: File[]) => void;
  onGenerate: (
    prompt?: string,
    configOverrides?: Partial<ImageGenerationConfig>,
    options?: { preventModal?: boolean },
  ) => void;
  isGenerating: boolean;
  images?: GeneratedImageWithConfig[];
  onSelectImage?: (image: GeneratedImageWithConfig) => void;
  activeProviderId?: GenerationProviderId;
  grokCanExecute?: boolean;
  intentionalStylesV1?: boolean;
  defaultStyleIntensity?: number;
  defaultStyleReferenceMode?: EditableStudioSettings['defaultStyleReferenceMode'];
}

const ALL_STYLE_CATEGORIES_TAB_ID = 'all_categories';
const EMPTY_IMAGES: GeneratedImageWithConfig[] = [];
// Installed packs are listed before React mounts and do not change until reload, so these
// are computed on first use and stay stable for hook dependencies.
let styleRuntimePackIdsCache: string[] | null = null;
function styleRuntimePackIds() {
  styleRuntimePackIdsCache ??= STYLE_RUNTIME_PACK_SUMMARIES.map((pack) => pack.id);
  return styleRuntimePackIdsCache;
}
function defaultStylePackId() {
  return styleRuntimePackIds()[0] ?? 'pack_01';
}
let styleTabRouteOptionsCache: StyleTabRouteOptions | null = null;
function styleTabRouteOptions() {
  styleTabRouteOptionsCache ??= {
    favoritesPackId: FAVORITES_PACK_ID,
    runtimePackIds: styleRuntimePackIds(),
    specialTabIds: [ALL_STYLE_CATEGORIES_TAB_ID, ALL_STYLE_CARDS_TAB_ID],
    userStylePackId: USER_STYLE_PACK_ID,
  };
  return styleTabRouteOptionsCache;
}
const USER_STYLE_PACK_SUMMARY = {
  id: USER_STYLE_PACK_ID,
  name: USER_STYLE_PACK_NAME,
  description: USER_STYLE_PACK_DESCRIPTION,
  presetCount: 0,
};
const MAX_STYLE_REFERENCE_IMAGES = 5;
const MAX_SELECTED_STYLE_SLOTS = 5;
type StyleCollectionsModule = typeof import('./styles/collections');

interface StylePanelVisibility {
  references: boolean;
  navigation: boolean;
  slots: boolean;
}

const DEFAULT_STYLE_PANEL_VISIBILITY: StylePanelVisibility = {
  references: true,
  navigation: true,
  slots: true,
};

const CompactStyleSelector = React.lazy(() =>
  import('./CompactStyleSelector').then((module) => ({
    default: module.CompactStyleSelector,
  })),
);

const StyleAdvancedControlsPanel = React.lazy(() =>
  import('./StyleAdvancedControlsPanel').then((module) => ({
    default: module.StyleAdvancedControlsPanel,
  })),
);

const UserStyleEditorSurface = React.lazy(() =>
  import('./UserStyleEditorSurface').then((module) => ({
    default: module.UserStyleEditorSurface,
  })),
);

const StylePresetCard = React.lazy(() =>
  import('./StylePresetCardSurface').then((module) => ({
    default: module.StylePresetCard,
  })),
);

// Color mapping for each pack to give them distinct identities

function getStyleTabHash(tabId: StyleTabId) {
  return getStyleTabHashForRoute(tabId, styleTabRouteOptions());
}

function compactStyleRecipeHash() {
  return `#${STYLE_RECIPE_HASH_PREFIX}`;
}

function createStylePresetVisualState({
  preset,
  presetPackId,
  presetPackName,
  images,
}: {
  preset: StyleRuntimePreset;
  presetPackId: string;
  presetPackName: string;
  images: GeneratedImageWithConfig[];
}): StylePresetVisualState {
  const resultImages = images
    .filter((img) => hasStylePresetIdentity(img.config, preset.id))
    .sort((a, b) => b.createdAt - a.createdAt);
  const defaultImage = resolveStyleDefaultImageThumbnail(preset.id);
  const defaultImageVariants = resolveStyleDefaultImageVariantThumbnails(preset.id);
  const categoryImage = preset.category
    ? (getStyleThumbnail(styleCategoryImageKey(presetPackId, preset.category)) ??
      getStyleCategoryImage(styleCategoryImageKey(presetPackId, preset.category)))
    : undefined;
  const previewImage =
    categoryImage || (preset.category ? STYLE_CATEGORY_PREVIEWS[preset.category] : undefined);

  return {
    presetPackName,
    resultImages,
    defaultImage,
    defaultImageVariants,
    previewImage,
    exampleImageSrc:
      resultImages[0]?.thumbnail ||
      resultImages[0]?.preview ||
      resultImages[0]?.src ||
      defaultImage ||
      defaultImageVariants[0]?.src ||
      previewImage ||
      null,
  };
}

type StyleFadeImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  fadeDuration?: number;
  fadeScale?: number;
};

function shouldReduceStyleImageMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const StyleFadeImage = React.memo(function StyleFadeImage({
  src,
  style,
  ...imageProps
}: StyleFadeImageProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [isVisible, setIsVisible] = useState(() => shouldReduceStyleImageMotion());

  useLayoutEffect(() => {
    const node = imageRef.current;
    if (!node) return;
    if (shouldReduceStyleImageMotion() || node.complete) {
      setIsVisible(true);
      return;
    }
    setIsVisible(false);
  }, [src]);

  return (
    <img
      ref={imageRef}
      src={src}
      alt=""
      data-style-fade-image
      {...imageProps}
      style={{
        ...style,
        opacity: isVisible ? (style?.opacity ?? 1) : 0,
        transition: shouldReduceStyleImageMotion() ? undefined : 'opacity 180ms ease',
      }}
      onLoad={() => setIsVisible(true)}
      onError={() => setIsVisible(true)}
    />
  );
});

function getStylePackSummary(packId: string) {
  if (packId === USER_STYLE_PACK_ID) return USER_STYLE_PACK_SUMMARY;
  return STYLE_RUNTIME_PACK_SUMMARIES.find((pack) => pack.id === packId) ?? null;
}

// react-doctor-disable-next-line react-doctor/no-giant-component
/** Style prompt text loads on demand when the user copies or uses a style as a prompt. */
const buildStylePromptText = (preset: StyleRuntimePreset) =>
  import('./stylePromptText').then((module) => module.buildStylePromptText(preset));

function useStyleCatalogLayout(
  workbench: React.ContextType<typeof RecipeWorkbenchContext>,
  navigation: ReturnType<typeof useStyleBrowserNavigation>,
) {
  const { currentPackId, isPackLandingOpen, writeStyleTabHash } = navigation;
  const [styleScrollWidth, setStyleScrollWidth] = useState(0);
  const [gridColumnPref, setGridColumnPref] = useLocalStorage<number | 'auto'>(
    'styles-grid-columns-v2',
    'auto',
  );
  const [localCatalogExpanded, setCatalogExpanded] = useState(false);
  const catalogExpanded = workbench.catalogExpanded ?? localCatalogExpanded;
  const [explorerColumnPref, setExplorerColumnPref] = useLocalStorage<number | 'auto'>(
    'styles-explorer-columns-v1',
    'auto',
  );
  const fitColumns = fitStyleGridColumns(styleScrollWidth);
  const gridColumns = resolveStyleGridColumns(
    catalogExpanded ? explorerColumnPref : gridColumnPref,
    fitColumns,
  );
  const [isDisplayOptionsOpen, setIsDisplayOptionsOpen] = useState(false);
  const [isManageStylesOpen, setIsManageStylesOpen] = useState(false);
  const manageStylesButtonRef = useRef<HTMLButtonElement>(null);
  const manageStylesMenuId = React.useId();
  const [stylePanelVisibility, setStylePanelVisibility] = useLocalStorage<
    Partial<StylePanelVisibility>
  >('styles-panel-visibility', DEFAULT_STYLE_PANEL_VISIBILITY);
  const [inspectedStyle, setInspectedStyle] = useState<{
    preset: StyleRuntimePreset;
    packId: string;
  } | null>(null);
  const inspectTriggerRef = useRef<HTMLElement | null>(null);
  const [localExplorerOpen, setExplorerOpen] = useState(
    () => readStyleTabIdFromRouteHash(window.location.hash, styleTabRouteOptions()) !== null,
  );
  const explorerOpen = workbench.stylesOpen ?? localExplorerOpen;
  const [catalogMounted, setCatalogMounted] = useState(explorerOpen);
  // Retain the catalog after its first opening, before children commit, so later
  // openings preserve its scroll state without an extra effect-driven frame.
  if (explorerOpen && !catalogMounted) setCatalogMounted(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedPanelRef = useRef<HTMLDivElement>(null);
  const catalogRootRef = useRef<HTMLDialogElement>(null);
  const closeStyleCatalog = useCallback(() => {
    if (workbench.closeStyles) {
      workbench.closeStyles();
      return;
    }
    setCatalogExpanded(false);
    setExplorerOpen(false);
    const compactHash = compactStyleRecipeHash();
    if (window.location.hash !== compactHash) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${compactHash}`,
      );
    }
    window.setTimeout(() => {
      const focusTarget =
        document.querySelector<HTMLElement>('#style-advanced-panel button') ??
        document.querySelector<HTMLElement>('[data-open-style-catalog]');
      focusTarget?.focus();
    }, 0);
  }, [workbench.closeStyles]);
  const openStyleCatalog = useCallback(
    (expanded = false) => {
      if (workbench.openStyles) {
        workbench.openStyles(expanded);
        return;
      }
      setCatalogExpanded(expanded);
      setExplorerOpen(true);
      writeStyleTabHash(isPackLandingOpen ? STYLE_PACKS_TAB_ID : currentPackId);
    },
    [currentPackId, isPackLandingOpen, writeStyleTabHash, workbench.openStyles],
  );
  const isStyleNavigationPanelOpen = Boolean(
    stylePanelVisibility.navigation ?? DEFAULT_STYLE_PANEL_VISIBILITY.navigation,
  );
  const toggleStylePanel = useCallback(
    (panel: keyof StylePanelVisibility) => {
      setStylePanelVisibility((current) => {
        const normalized = { ...DEFAULT_STYLE_PANEL_VISIBILITY, ...current };
        return {
          ...normalized,
          [panel]: !normalized[panel],
        };
      });
    },
    [setStylePanelVisibility],
  );
  const styleScrollRootRef = useRef<HTMLDivElement>(null);
  const displayOptionsRef = useRef<HTMLButtonElement>(null);
  const displayOptionsId = React.useId();

  return {
    styleScrollWidth,
    setStyleScrollWidth,
    gridColumnPref,
    setGridColumnPref,
    catalogExpanded,
    setCatalogExpanded,
    explorerColumnPref,
    setExplorerColumnPref,
    fitColumns,
    gridColumns,
    isDisplayOptionsOpen,
    setIsDisplayOptionsOpen,
    isManageStylesOpen,
    setIsManageStylesOpen,
    manageStylesButtonRef,
    manageStylesMenuId,
    inspectedStyle,
    setInspectedStyle,
    inspectTriggerRef,
    explorerOpen,
    setExplorerOpen,
    catalogMounted,
    advancedOpen,
    setAdvancedOpen,
    advancedPanelRef,
    catalogRootRef,
    closeStyleCatalog,
    openStyleCatalog,
    isStyleNavigationPanelOpen,
    toggleStylePanel,
    styleScrollRootRef,
    displayOptionsRef,
    displayOptionsId,
  };
}

function resolveCatalogTheme(
  collection: Parameters<typeof getStyleCollectionTheme>[0] | null,
  packId: string,
  allCards: boolean,
  allCategories: boolean,
) {
  if (collection) return getStyleCollectionTheme(collection);
  if (allCards) return PACK_THEMES.pack_06;
  if (allCategories) return PACK_THEMES.pack_10;
  return PACK_THEMES[packId] || PACK_THEMES.pack_01;
}

function useArchivedStyleFavorites(
  currentPackId: string,
  normalizedStyleSearchQuery: string,
  favorites: string[],
  presetPackIdById: Map<string, string>,
) {
  const retiredFavoriteIds = useMemo(() => {
    if (currentPackId !== FAVORITES_PACK_ID || normalizedStyleSearchQuery) return [];
    return favorites.filter(
      (presetId) => !presetPackIdById.has(presetId) && /^SP(?:14|15)-\d{3}$/.test(presetId),
    );
  }, [currentPackId, favorites, normalizedStyleSearchQuery, presetPackIdById]);
  const [archivedFavoriteEntries, setArchivedFavoriteEntries] = useState<
    ArchivedStylePresetEntry[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    if (retiredFavoriteIds.length === 0) {
      setArchivedFavoriteEntries([]);
      return;
    }

    void import('./archivedStylePresets')
      .then(({ loadArchivedStylePresetsByIds }) =>
        loadArchivedStylePresetsByIds(retiredFavoriteIds),
      )
      .then((entries) => {
        if (!cancelled) setArchivedFavoriteEntries(entries);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        runtimeLogger.error('Could not load archived style favorites.', error);
        setArchivedFavoriteEntries([]);
      });

    return () => {
      cancelled = true;
    };
  }, [retiredFavoriteIds]);

  const archivedFavoriteById = useMemo(
    () => new Map(archivedFavoriteEntries.map((entry) => [entry.preset.id, entry])),
    [archivedFavoriteEntries],
  );
  const unsearchedFavoritesRoute =
    currentPackId === FAVORITES_PACK_ID && normalizedStyleSearchQuery.length === 0;
  const archivedFavoritePresets = useMemo(() => {
    if (!unsearchedFavoritesRoute) return [];
    const favoriteIds = new Set(favorites);
    return archivedFavoriteEntries
      .filter((entry) => favoriteIds.has(entry.preset.id))
      .map((entry) => entry.preset);
  }, [archivedFavoriteEntries, favorites, unsearchedFavoritesRoute]);
  const onlyArchivedFavoritesSelected =
    unsearchedFavoritesRoute &&
    favorites.length > 0 &&
    favorites.every((presetId) => archivedFavoriteById.has(presetId));

  return {
    archivedFavoriteById,
    unsearchedFavoritesRoute,
    archivedFavoritePresets,
    onlyArchivedFavoritesSelected,
  };
}

function useStyleCatalogInteraction(config: ImageGenerationConfig) {
  const recipePresetId =
    config.recipeId === 'styles' && typeof config.recipeParams?.presetId === 'string'
      ? config.recipeParams.presetId
      : null;
  const [interactionState, setInteractionState] = useState({
    activePresetId: null as string | null,
    sourcePresetId: null as string | null,
    copiedStyleId: null as string | null,
  });
  const activePresetId =
    interactionState.sourcePresetId === recipePresetId
      ? interactionState.activePresetId
      : recipePresetId;
  const { copiedStyleId } = interactionState;
  const timeoutRef = useRef<number | null>(null);
  const clearCopyFeedback = useCallback(() => {
    if (timeoutRef.current === null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);
  useEffect(
    () => () => {
      clearCopyFeedback();
    },
    [clearCopyFeedback],
  );

  return {
    recipePresetId,
    setInteractionState,
    activePresetId,
    copiedStyleId,
    timeoutRef,
  };
}

function useStylesBrowserController({
  config,
  updateConfig,
  onFileSelect,
  onGenerate,
  isGenerating,
  images = EMPTY_IMAGES,
  activeProviderId = 'codex',
  grokCanExecute = false,
  intentionalStylesV1 = false,
  defaultStyleIntensity,
  defaultStyleReferenceMode,
}: StylesBrowserProps) {
  const workbench = React.useContext(RecipeWorkbenchContext);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tcgCatalogView, setTcgCatalogView] = useState<'visual' | 'components'>('visual');
  const generateTcgRecipeArt = (artPrompt: string) => {
    onGenerate(
      artPrompt,
      {
        recipeId: null,
        recipeParams: null,
        attachments: [],
        aspectRatio: '3:4',
        batchCount: 1,
      },
      { preventModal: true },
    );
  };
  const referenceImages = useMemo(
    () => config.attachments.slice(0, MAX_STYLE_REFERENCE_IMAGES),
    [config.attachments],
  );
  const referenceSlotsRemaining = Math.max(0, MAX_STYLE_REFERENCE_IMAGES - referenceImages.length);
  const grokGenerateBlock = resolveGrokImagineGenerateBlock({
    providerId: activeProviderId,
    recipeId: 'styles',
    aspectRatio: config.aspectRatio,
    attachments: referenceImages,
    canExecute: grokCanExecute,
  });

  const composition = useStyleComposition({
    config,
    updateConfig,
    onGenerate,
    referenceImages,
    generationBlocked: Boolean(grokGenerateBlock),
    maxSlots: MAX_SELECTED_STYLE_SLOTS,
    intentionalStylesV1,
    defaultStyleIntensity,
    defaultStyleReferenceMode,
  });
  const {
    selectedStyles,
    selectedStyleIds,
    selectedStyleLayers,
    activeSelectedStyleCount,
    toggleStyle,
    updateSelectedStyleStrength,
    toggleSelectedStyleEnabled,
    toggleSelectedStyleField,
    updateSelectedStyleFieldWeight,
    setSelectedStyleAvoidRulesMode,
    removeSelectedStyle,
    moveSelectedStyle,
    handleGenerateSelectedStyles,
    compileIssues,
    intentionalMode,
    setIntentionalMode,
  } = composition;
  const [styleCollectionsModule, setStyleCollectionsModule] =
    useState<StyleCollectionsModule | null>(null);
  const [styleCollectionsLoadError, setStyleCollectionsLoadError] = useState<string | null>(null);
  const { recipePresetId, setInteractionState, activePresetId, copiedStyleId, timeoutRef } =
    useStyleCatalogInteraction(config);

  // -- FILTERS & STATE --
  const { activeWorkspaceId } = useWorkspaceState();
  const navigation = useStyleBrowserNavigation({
    syncRoute: !workbench.openStyles,
    scopeKey: activeWorkspaceId,
    routeOptions: styleTabRouteOptions(),
    defaultPackId: defaultStylePackId(),
    allCategoriesTabId: ALL_STYLE_CATEGORIES_TAB_ID,
    allCardsTabId: ALL_STYLE_CARDS_TAB_ID,
  });
  const {
    currentPackId,
    isPackLandingOpen,
    searchQuery,
    sortOrder,
    showFavoritesOnly,
    isCatalogSearchOpen,
    isAllStyleCategoriesTab,
    isAllStyleCardsTab,
    isGlobalStyleBrowseTab,
    activeStyleViewMode,
    favorites,
    applyStyleTab,
    navigateToStyleTab,
    writeStyleTabHash,
    toggleFavorite,
    updateFilters,
    setCatalogOpen,
    toggleFavoritesOnly,
  } = navigation;
  const normalizedStyleSearchQuery = searchQuery.trim();
  const isGlobalStyleSearchActive = normalizedStyleSearchQuery.length > 0;
  const {
    styleScrollWidth,
    setStyleScrollWidth,
    gridColumnPref,
    setGridColumnPref,
    catalogExpanded,
    setCatalogExpanded,
    explorerColumnPref,
    setExplorerColumnPref,
    fitColumns,
    gridColumns,
    isDisplayOptionsOpen,
    setIsDisplayOptionsOpen,
    isManageStylesOpen,
    setIsManageStylesOpen,
    manageStylesButtonRef,
    manageStylesMenuId,
    inspectedStyle,
    setInspectedStyle,
    inspectTriggerRef,
    explorerOpen,
    setExplorerOpen,
    catalogMounted,
    advancedOpen,
    setAdvancedOpen,
    advancedPanelRef,
    catalogRootRef,
    closeStyleCatalog,
    openStyleCatalog,
    isStyleNavigationPanelOpen,
    toggleStylePanel,
    styleScrollRootRef,
    displayOptionsRef,
    displayOptionsId,
  } = useStyleCatalogLayout(workbench, navigation);

  const userStyles = useUserStyleLibrary({
    onReconciled: (style, archived) => {
      setInspectedStyle((current) =>
        current?.preset.id === style.id
          ? archived
            ? null
            : { ...current, preset: userStylePresetToRuntimePreset(style) }
          : current,
      );
      if (archived) {
        removeSelectedStyle(style.id);
        setInteractionState((prev) => ({
          ...prev,
          activePresetId: prev.activePresetId === style.id ? null : prev.activePresetId,
        }));
      } else composition.replacePreset(userStylePresetToRuntimePreset(style));
    },
    onSaved: (style) => {
      setInteractionState((prev) => ({
        ...prev,
        activePresetId: style.id,
        sourcePresetId: recipePresetId,
      }));
      navigateToStyleTab(USER_STYLE_PACK_ID);
    },
    onArchived: () => {
      navigateToStyleTab(USER_STYLE_PACK_ID);
    },
  });
  const {
    presets: userStylePresets,
    loading: isLoadingUserStyles,
    error: userStyleError,
    session: userStyleEditorSession,
    runtimePack: userStylePack,
    byId: userStylePresetById,
    refresh: refreshUserStyles,
  } = userStyles;
  const userSearchIndex = useMemo(
    () =>
      userStylePack.presets.length > 0
        ? createStylePresetCatalogSearchIndexFromRuntimePacks([userStylePack], {
            resolveDefaultImage: resolveStyleDefaultImageThumbnail,
          })
        : null,
    [userStylePack],
  );

  useEffect(() => {
    if (workbench.openStyles) return;
    const syncExplorerFromHash = () => {
      const tab = readStyleTabIdFromRouteHash(window.location.hash, styleTabRouteOptions());
      setExplorerOpen(tab !== null);
      if (tab === null) setCatalogExpanded(false);
    };
    syncExplorerFromHash();
    window.addEventListener('hashchange', syncExplorerFromHash);
    return () => window.removeEventListener('hashchange', syncExplorerFromHash);
  }, [workbench.openStyles, setExplorerOpen, setCatalogExpanded]);

  useEffect(() => {
    if (!advancedOpen) return;
    const root = advancedPanelRef.current;
    root
      ?.querySelector<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')
      ?.focus({
        preventScroll: true,
      });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setAdvancedOpen(false);
      document.querySelector<HTMLElement>('[data-style-advanced-toggle]')?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [advancedOpen, advancedPanelRef, setAdvancedOpen]);

  useEffect(() => {
    if (explorerOpen && (!workbench.openStyles || catalogExpanded)) {
      catalogRootRef.current?.focus({ preventScroll: true });
    }
  }, [explorerOpen, workbench.openStyles, catalogExpanded, catalogRootRef]);

  useEffect(() => {
    if (!explorerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (userStyleEditorSession) return;
      event.preventDefault();
      closeStyleCatalog();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeStyleCatalog, explorerOpen, userStyleEditorSession]);

  useEffect(() => {
    if (styleCollectionsModule) return;

    let cancelled = false;
    setStyleCollectionsLoadError(null);
    void import('./styles/collections')
      .then((module) => {
        if (!cancelled) setStyleCollectionsModule(module);
      })
      .catch(() => {
        if (!cancelled) setStyleCollectionsLoadError('Could not load style collections.');
      });
    return () => {
      cancelled = true;
    };
  }, [styleCollectionsModule]);

  const activeStyleCollectionId = getStyleCollectionIdFromTabId(currentPackId);
  const activeStyleCollection = useMemo(() => {
    if (!activeStyleCollectionId || !styleCollectionsModule) return null;
    return (
      styleCollectionsModule.STYLE_COLLECTIONS.find(
        (collection) => collection.id === activeStyleCollectionId && collection.entries.length > 0,
      ) ?? null
    );
  }, [activeStyleCollectionId, styleCollectionsModule]);

  const styleRuntimePackLoadRequest = useMemo(
    () =>
      resolveStyleRuntimePackLoadRequest({
        isPackLandingOpen,
        currentPackId,
        activeStyleCollectionId,
        activeCollectionSourcePackIds: activeStyleCollection?.sourcePackIds ?? [],
        isGlobalStyleBrowseTab,
        favoritesCount: favorites.length,
        isGlobalStyleSearchActive,
        runtimePackIds: styleRuntimePackIds(),
        favoritesPackId: FAVORITES_PACK_ID,
      }),
    [
      activeStyleCollection,
      activeStyleCollectionId,
      currentPackId,
      favorites.length,
      isGlobalStyleBrowseTab,
      isGlobalStyleSearchActive,
      isPackLandingOpen,
    ],
  );
  const {
    loadedStylePacksById,
    loadStyleRuntimePacks,
    isLoadingStylePacks,
    styleRuntimeError,
    retryStylePacks,
  } = useStyleRuntimePacks({
    requiredPackIds:
      explorerOpen && !styleRuntimePackLoadRequest.loadAll
        ? styleRuntimePackLoadRequest.requiredPackIds
        : [],
    loadAll: false,
  });

  const prefetchStyleTab = useCallback(
    (tabId: StyleTabId) => {
      const normalizedTabId = normalizeStyleTabRouteId(tabId, styleTabRouteOptions());
      if (normalizedTabId === STYLE_PACKS_TAB_ID) return;
      if (
        normalizedTabId === ALL_STYLE_CATEGORIES_TAB_ID ||
        normalizedTabId === ALL_STYLE_CARDS_TAB_ID
      ) {
        void loadStyleRuntimePacks(styleRuntimePackIds().slice(0, 3));
        return;
      }
      const collectionId = getStyleCollectionIdFromTabId(normalizedTabId);
      if (collectionId) {
        const collection = styleCollectionsModule?.STYLE_COLLECTIONS.find(
          (item) => item.id === collectionId,
        );
        const installedPackIds = new Set(styleRuntimePackIds());
        const packIds = (collection?.sourcePackIds ?? []).filter((packId) =>
          installedPackIds.has(packId),
        );
        if (packIds.length > 0) void loadStyleRuntimePacks(packIds);
        return;
      }
      if (styleRuntimePackIds().includes(normalizedTabId)) {
        void loadStyleRuntimePacks([normalizedTabId]);
      }
    },
    [loadStyleRuntimePacks, styleCollectionsModule],
  );

  // react-doctor-disable-next-line react-doctor/no-initialize-state
  useEffect(() => {
    const node = styleScrollRootRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const updateWidth = () => setStyleScrollWidth(node.clientWidth);
    // react-doctor-disable-next-line react-doctor/no-initialize-state
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [styleScrollRootRef, setStyleScrollWidth, currentPackId, isPackLandingOpen, explorerOpen]);

  const loadedRuntimeStylePacks = useMemo(
    () =>
      styleRuntimePackIds().flatMap((packId) => {
        const pack = loadedStylePacksById[packId];
        return pack ? [pack] : [];
      }),
    [loadedStylePacksById],
  );
  const globalStylePacks = useMemo(
    () => [userStylePack, ...loadedRuntimeStylePacks],
    [loadedRuntimeStylePacks, userStylePack],
  );
  const allRuntimeStylePacksLoaded = styleRuntimePackIds().every((packId) =>
    Boolean(loadedStylePacksById[packId]),
  );
  const globalStylePresetCount = STYLE_RUNTIME_PACK_SUMMARIES.reduce(
    (total, pack) => total + pack.presetCount,
    userStylePack.presets.length,
  );
  const globalStyleCategoryCount = useMemo(() => {
    const keys = new Set<string>();
    for (const pack of globalStylePacks) {
      for (const preset of pack.presets) {
        keys.add(`${pack.id}:${preset.category || 'General'}`);
      }
    }
    return keys.size;
  }, [globalStylePacks]);
  const activePack = useMemo(
    () =>
      projectActiveStylePack({
        currentPackId,
        isGlobalStyleBrowseTab,
        isAllStyleCardsTab,
        activeStyleCollectionId,
        activeStyleCollection,
        collectionProjection: styleCollectionsModule,
        collectionLoadError: styleCollectionsLoadError,
        allRuntimeStylePacksLoaded,
        globalStylePresetCount,
        globalStyleCategoryCount,
        globalStylePacks,
        userStylePack,
        loadedStylePacksById,
        runtimePackIds: styleRuntimePackIds(),
        summaries: STYLE_RUNTIME_PACK_SUMMARIES,
        favoritesPackId: FAVORITES_PACK_ID,
      }),
    [
      activeStyleCollection,
      activeStyleCollectionId,
      allRuntimeStylePacksLoaded,
      currentPackId,
      globalStyleCategoryCount,
      globalStylePacks,
      globalStylePresetCount,
      isAllStyleCardsTab,
      isGlobalStyleBrowseTab,
      loadedStylePacksById,
      styleCollectionsLoadError,
      styleCollectionsModule,
      userStylePack,
    ],
  );

  const activeStyleCollectionSourceByPresetId = useMemo(() => {
    const sourceByPresetId = new Map<string, StylePresetSourceProvenance>();
    if (!activeStyleCollection || !styleCollectionsModule) return sourceByPresetId;

    const sourcePacks = activeStyleCollection.sourcePackIds.flatMap((packId) => {
      if (packId === USER_STYLE_PACK_ID) return [userStylePack];
      const pack = loadedStylePacksById[packId];
      return pack ? [pack] : [];
    });
    const installedPackIds = new Set(styleRuntimePackIds());
    const missingSourcePack = activeStyleCollection.sourcePackIds.some(
      (packId) => installedPackIds.has(packId) && !loadedStylePacksById[packId],
    );
    if (missingSourcePack) return sourceByPresetId;

    const packNameById = new Map(sourcePacks.map((pack) => [pack.id, pack.name]));
    const resolved = styleCollectionsModule.resolveStyleCollection(
      activeStyleCollection,
      styleCollectionsModule.createStyleCollectionSourceIndex(sourcePacks),
    );
    for (const item of resolved.presets) {
      sourceByPresetId.set(item.presetId, {
        sourcePackId: item.sourcePackId,
        sourcePackName: packNameById.get(item.sourcePackId) ?? item.sourcePackId,
        sourceCategory: item.sourceCategory,
        collectionRole: item.collectionRole,
      });
    }

    return sourceByPresetId;
  }, [activeStyleCollection, loadedStylePacksById, styleCollectionsModule, userStylePack]);

  const globalStyleSourceByPresetId = useMemo(() => {
    const sourceByPresetId = new Map<string, StylePresetSourceProvenance>();
    if (!isGlobalStyleBrowseTab) return sourceByPresetId;

    for (const pack of globalStylePacks) {
      for (const preset of pack.presets) {
        sourceByPresetId.set(preset.id, {
          sourcePackId: pack.id,
          sourcePackName: pack.name,
          sourceCategory: preset.category ?? 'General',
          collectionRole: 'primary',
        });
      }
    }

    return sourceByPresetId;
  }, [globalStylePacks, isGlobalStyleBrowseTab]);

  const styleSourceByPresetId = isGlobalStyleBrowseTab
    ? globalStyleSourceByPresetId
    : activeStyleCollectionSourceByPresetId;

  const activeTheme = resolveCatalogTheme(
    activeStyleCollection,
    currentPackId,
    isAllStyleCardsTab,
    isAllStyleCategoriesTab,
  );
  const orderedLoadedStylePacks = useMemo(() => globalStylePacks, [globalStylePacks]);
  const searchableStylePresets = useMemo(
    () => orderedLoadedStylePacks.flatMap((pack) => pack.presets),
    [orderedLoadedStylePacks],
  );
  const presetPackIdById = useMemo(() => {
    const packIdByPresetId = new Map<string, string>();
    for (const pack of orderedLoadedStylePacks) {
      for (const preset of pack.presets) packIdByPresetId.set(preset.id, pack.id);
    }
    return packIdByPresetId;
  }, [orderedLoadedStylePacks]);

  const {
    archivedFavoriteById,
    unsearchedFavoritesRoute,
    archivedFavoritePresets,
    onlyArchivedFavoritesSelected,
  } = useArchivedStyleFavorites(
    currentPackId,
    normalizedStyleSearchQuery,
    favorites,
    presetPackIdById,
  );

  const favoritePresets = useMemo(() => {
    const presetById = new Map<string, StyleRuntimePreset>();
    for (const pack of orderedLoadedStylePacks) {
      for (const preset of pack.presets) presetById.set(preset.id, preset);
    }
    return favorites.flatMap((presetId) => {
      const preset =
        presetById.get(presetId) ??
        (currentPackId === FAVORITES_PACK_ID
          ? archivedFavoriteById.get(presetId)?.preset
          : undefined);
      return preset ? [preset] : [];
    });
  }, [archivedFavoriteById, currentPackId, favorites, orderedLoadedStylePacks]);

  const getPackIdForPreset = React.useCallback(
    (preset: StyleRuntimePreset) => {
      return (
        presetPackIdById.get(preset.id) ??
        archivedFavoriteById.get(preset.id)?.packId ??
        (currentPackId !== FAVORITES_PACK_ID ? currentPackId : activePack.id)
      );
    },
    [activePack.id, archivedFavoriteById, currentPackId, presetPackIdById],
  );

  const getPackNameForId = useCallback(
    (packId: string) =>
      packId === USER_STYLE_PACK_ID
        ? USER_STYLE_PACK_NAME
        : (loadedStylePacksById[packId]?.name ?? getStylePackSummary(packId)?.name ?? 'Styles'),
    [loadedStylePacksById],
  );
  const getGlobalStyleCategoryKeyForPreset = useCallback(
    (preset: StyleRuntimePreset) => {
      const presetPackId = getPackIdForPreset(preset);
      return `${getPackNameForId(presetPackId)} / ${preset.category || 'General'}`;
    },
    [getPackIdForPreset, getPackNameForId],
  );

  const fullProcessedData = useMemo(
    () =>
      createStyleBrowserProcessedData({
        activePack,
        currentPackId,
        favoritesPackId: FAVORITES_PACK_ID,
        favoritePresets,
        searchPresets:
          isGlobalStyleSearchActive && !activeStyleCollectionId
            ? searchableStylePresets
            : undefined,
        favoriteIds: favorites,
        categoryLabelForPreset: (preset) =>
          getStyleCategoryDisplayName(getPackIdForPreset(preset), preset.category || 'General'),
        categoryKeyForPreset: isAllStyleCategoriesTab
          ? getGlobalStyleCategoryKeyForPreset
          : undefined,
        pinFavorites: !isGlobalStyleBrowseTab,
        searchQuery,
        sortOrder,
        showFavoritesOnly,
        viewMode: activeStyleViewMode,
      }),
    [
      activePack,
      activeStyleViewMode,
      activeStyleCollectionId,
      currentPackId,
      favoritePresets,
      getGlobalStyleCategoryKeyForPreset,
      getPackIdForPreset,
      isGlobalStyleSearchActive,
      isGlobalStyleBrowseTab,
      isAllStyleCategoriesTab,
      searchQuery,
      searchableStylePresets,
      sortOrder,
      favorites,
      showFavoritesOnly,
    ],
  );

  const processedData = fullProcessedData;

  const styleRenderPlan = useMemo(
    () =>
      createStyleBrowserRenderPlan({
        groupOrder: isAllStyleCategoriesTab && sortOrder === 'source' ? 'source' : 'natural',
        processedData,
        viewMode: activeStyleViewMode,
      }),
    [activeStyleViewMode, isAllStyleCategoriesTab, processedData, sortOrder],
  );
  const { visibleStyleGroupEntries } = styleRenderPlan;
  const styleCategoryEagerBudget = Math.max(
    0,
    STYLE_BROWSER_EAGER_SECTION_LIMIT - (processedData.favorites.length > 0 ? 1 : 0),
  );

  const filteredStylePresets = useMemo(() => {
    const presetById = new Map<string, StyleRuntimePreset>();
    for (const preset of processedData.flatPresets) presetById.set(preset.id, preset);
    return [...presetById.values()];
  }, [processedData]);

  const resultImagesByPresetId = useMemo(() => groupStyleResultImagesByPreset(images), [images]);

  const getPresetVisualState = useCallback(
    (preset: StyleRuntimePreset) => {
      const presetPackId = getPackIdForPreset(preset);
      const archivedEntry = archivedFavoriteById.get(preset.id);
      const presetPack =
        presetPackId === USER_STYLE_PACK_ID
          ? userStylePack
          : (loadedStylePacksById[presetPackId] ?? activePack);
      return createStylePresetVisualState({
        preset,
        presetPackId,
        presetPackName: archivedEntry ? `Archived · ${archivedEntry.packName}` : presetPack.name,
        images: resultImagesByPresetId.get(preset.id) ?? EMPTY_IMAGES,
      });
    },
    [
      activePack,
      archivedFavoriteById,
      getPackIdForPreset,
      loadedStylePacksById,
      resultImagesByPresetId,
      userStylePack,
    ],
  );

  const eagerPresetVisualStateById = useMemo(() => {
    const stateMap = new Map<string, StylePresetVisualState>();
    const addPresets = (presets: StyleRuntimePreset[]) => {
      for (const preset of presets) {
        if (!stateMap.has(preset.id)) stateMap.set(preset.id, getPresetVisualState(preset));
      }
    };
    if (processedData.favorites.length > 0) addPresets(processedData.favorites);
    for (const [, presets] of styleRenderPlan.visibleStyleGroupEntries.slice(
      0,
      styleCategoryEagerBudget,
    )) {
      addPresets(presets);
    }
    return stateMap;
  }, [
    getPresetVisualState,
    processedData.favorites,
    styleCategoryEagerBudget,
    styleRenderPlan.visibleStyleGroupEntries,
  ]);

  const stylePreviewPreloadSources = useMemo(
    () =>
      collectStylePresetPreviewSources({
        processedData,
        renderPlan: styleRenderPlan,
        visualStateByPresetId: eagerPresetVisualStateById,
        gridColumns,
        containerWidth: styleScrollWidth,
      }),
    [eagerPresetVisualStateById, gridColumns, processedData, styleRenderPlan, styleScrollWidth],
  );

  useEffect(() => {
    stylePreviewPreloadSources.forEach((src) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    });
  }, [stylePreviewPreloadSources]);

  const handleSelectStyle = useCallback(
    (
      preset: StyleRuntimePreset,
      presetPackIdOverride?: string,
      presetPackNameOverride?: string,
    ) => {
      const packId = presetPackIdOverride ?? getPackIdForPreset(preset);
      setInteractionState((prev) => ({
        ...prev,
        activePresetId: preset.id,
        sourcePresetId: recipePresetId,
      }));
      toggleStyle(preset, packId, presetPackNameOverride ?? getPackNameForId(packId));
    },
    [getPackIdForPreset, getPackNameForId, toggleStyle, recipePresetId, setInteractionState],
  );

  const handleApplyStyleRef = useLatestRef(handleSelectStyle);

  const activePreset = useMemo(
    () => searchableStylePresets.find((preset) => preset.id === activePresetId) ?? null,
    [activePresetId, searchableStylePresets],
  );
  const activePresetPackId = activePreset ? getPackIdForPreset(activePreset) : null;
  const activeUserStyle = activePresetId ? (userStylePresetById.get(activePresetId) ?? null) : null;
  const canSaveStyleBlend = activeSelectedStyleCount > 0;
  const canCloneActiveStyle = Boolean(activePreset && activePresetPackId !== USER_STYLE_PACK_ID);
  const canEditActiveUserStyle = Boolean(activeUserStyle);

  const handleCreateUserStyle = () => {
    void userStyles.open({ kind: 'create' });
  };
  const handleSaveSelectedStyleBlend = () => {
    if (canSaveStyleBlend)
      void userStyles.open({ kind: 'blend', slots: selectedStyles, layers: selectedStyleLayers });
  };
  const handleCloneActiveStyle = () => {
    if (activePreset && activePresetPackId && canCloneActiveStyle)
      void userStyles.open({
        kind: 'clone',
        preset: activePreset,
        packId: activePresetPackId,
        packName: getPackNameForId(activePresetPackId),
      });
  };
  const handleEditActiveUserStyle = () => {
    if (activeUserStyle) void userStyles.open({ kind: 'edit', styleId: activeUserStyle.id });
  };
  const handleCloseCatalogSearch = useCallback(() => setCatalogOpen(false), [setCatalogOpen]);

  const handleSelectCatalogPreset = useCallback(
    (result: StylePresetCatalogSearchResult) => {
      applyStyleTab(result.packId, {
        browserStatePatch: {
          searchQuery: result.name,
        },
      });
      writeStyleTabHash(result.packId);
      setInteractionState((prev) => ({
        ...prev,
        activePresetId: result.id,
        sourcePresetId: recipePresetId,
      }));
      setCatalogOpen(false);
    },
    [applyStyleTab, setCatalogOpen, writeStyleTabHash, recipePresetId, setInteractionState],
  );

  const handleChooseCompactStyle = useCallback(
    async (result: StylePresetCatalogSearchResult) => {
      if (selectedStyleIds.has(result.id)) {
        removeSelectedStyle(result.id);
        return;
      }
      if (selectedStyles.length >= MAX_SELECTED_STYLE_SLOTS) return;
      if (result.packId === USER_STYLE_PACK_ID) {
        const preset = userStylePack.presets.find((candidate) => candidate.id === result.id);
        if (preset) handleApplyStyleRef.current(preset, result.packId);
        return;
      }
      let loadedPack = loadedStylePacksById[result.packId];
      if (!loadedPack) {
        try {
          [loadedPack] = await loadStyleRuntimePacks([result.packId]);
        } catch {
          return;
        }
      }
      const preset = loadedPack?.presets.find((candidate) => candidate.id === result.id);
      if (preset) handleApplyStyleRef.current(preset, result.packId);
    },
    [
      handleApplyStyleRef,
      loadStyleRuntimePacks,
      loadedStylePacksById,
      removeSelectedStyle,
      selectedStyleIds,
      selectedStyles.length,
      userStylePack.presets,
    ],
  );

  const [previousPrompt, setPreviousPrompt] = useState<string | null>(null);
  const [promptNotice, setPromptNotice] = useState('');
  const handleUseStylePrompt = useCallback(
    async (preset: StyleRuntimePreset) => {
      const promptText = await buildStylePromptText(preset);
      setPreviousPrompt(config.prompt ?? '');
      updateConfig('prompt', promptText);
      setPromptNotice('Style added as prompt.');
      if (catalogExpanded) closeStyleCatalog();
    },
    [catalogExpanded, closeStyleCatalog, config.prompt, updateConfig],
  );
  const handleCatalogPrompt = async (
    result: StylePresetCatalogSearchResult,
    action: 'copy' | 'use',
  ) => {
    try {
      const pack =
        result.packId === USER_STYLE_PACK_ID
          ? userStylePack
          : (loadedStylePacksById[result.packId] ??
            (await loadStyleRuntimePacks([result.packId]))[0]);
      const preset = pack?.presets.find((candidate) => candidate.id === result.id);
      if (!preset) throw new Error('Style unavailable');
      if (action === 'use') await handleUseStylePrompt(preset);
      else {
        await navigator.clipboard.writeText(await buildStylePromptText(preset));
        setPromptNotice('Prompt copied.');
      }
    } catch {
      setPromptNotice('Could not load or copy this style. Please try again.');
    }
  };

  const handleCopyStylePrompt = useCallback(
    async (e: React.MouseEvent, preset: StyleRuntimePreset) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(await buildStylePromptText(preset));
      } catch {
        setPromptNotice('Could not copy prompt. Please try again.');
        return;
      }
      setInteractionState((prev) => ({ ...prev, copiedStyleId: preset.id }));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(
        () => setInteractionState((prev) => ({ ...prev, copiedStyleId: null })),
        2000,
      );
    },
    [setInteractionState, timeoutRef],
  );

  const renderPresetCard = React.useCallback(
    (preset: StyleRuntimePreset) => {
      const presetPackId = getPackIdForPreset(preset);
      const archivedEntry = archivedFavoriteById.get(preset.id);
      const displayedPreset = archivedEntry
        ? {
            ...preset,
            displayName: `Archived · ${getStyleRuntimePresetDisplayName(preset)}`,
          }
        : preset;
      const presetTheme = PACK_THEMES[presetPackId] || activeTheme;
      return (
        <StylePresetCard
          key={preset.id}
          preset={displayedPreset}
          packId={presetPackId}
          sourceProvenance={styleSourceByPresetId.get(preset.id)}
          visualState={eagerPresetVisualStateById.get(preset.id) ?? getPresetVisualState(preset)}
          active={selectedStyleIds.has(preset.id)}
          previewOnClick={catalogExpanded}
          onInspect={() => {
            inspectTriggerRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setInspectedStyle({ preset, packId: presetPackId });
            setInteractionState((prev) => ({
              ...prev,
              activePresetId: preset.id,
              sourcePresetId: recipePresetId,
            }));
          }}
          selectionDisabled={
            selectedStyles.length >= MAX_SELECTED_STYLE_SLOTS && !selectedStyleIds.has(preset.id)
          }
          copied={copiedStyleId === preset.id}
          favorite={favorites.includes(preset.id)}
          theme={presetTheme}
          FadeImageComponent={StyleFadeImage}
          onApply={() => handleApplyStyleRef.current(preset, presetPackId, archivedEntry?.packName)}
          onCopy={(event) => handleCopyStylePrompt(event, preset)}
          onUsePrompt={() =>
            void handleUseStylePrompt(preset).catch(() =>
              setPromptNotice('Could not load this style prompt. Please try again.'),
            )
          }
          onToggleFavorite={toggleFavorite}
        />
      );
    },
    [
      catalogExpanded,
      selectedStyleIds,
      selectedStyles.length,
      copiedStyleId,
      favorites,
      activeTheme,
      styleSourceByPresetId,
      archivedFavoriteById,
      getPackIdForPreset,
      toggleFavorite,
      eagerPresetVisualStateById,
      getPresetVisualState,
      handleCopyStylePrompt,
      handleUseStylePrompt,
      handleApplyStyleRef,
      recipePresetId,
      inspectTriggerRef,
      setInspectedStyle,
      setInteractionState,
    ],
  );

  const currentStyleTabId = isPackLandingOpen ? STYLE_PACKS_TAB_ID : currentPackId;
  const styleRecipeNavigationSections = useMemo<StyleRecipeNavigationSection[]>(() => {
    const browseItems: StyleRecipeNavigationItem[] = [
      {
        id: 'browse:all_categories',
        label: 'All Categories',
        caption: 'Global',
        countLabel: `${globalStyleCategoryCount}`,
        tabId: ALL_STYLE_CATEGORIES_TAB_ID,
        theme: PACK_THEMES.pack_10,
        icon: <Layers width={14} height={14} />,
      },
      {
        id: 'browse:all_cards',
        label: 'All styles',
        caption: 'Global',
        countLabel: `${globalStylePresetCount}`,
        tabId: ALL_STYLE_CARDS_TAB_ID,
        theme: PACK_THEMES.pack_06,
        icon: <LayoutGrid width={14} height={14} />,
      },
    ];
    const personalItems: StyleRecipeNavigationItem[] = [
      {
        id: 'personal:my_styles',
        label: USER_STYLE_PACK_NAME,
        caption: 'Personal',
        countLabel: `${userStylePresets.length}`,
        tabId: USER_STYLE_PACK_ID,
        theme: PACK_THEMES[USER_STYLE_PACK_ID],
        icon: <Sparkles width={14} height={14} />,
      },
      {
        id: 'personal:favorites',
        label: 'Favorites',
        caption: 'Personal',
        countLabel: `${favorites.length}`,
        tabId: FAVORITES_PACK_ID,
        theme: PACK_THEMES[FAVORITES_PACK_ID],
        icon: <Heart width={14} height={14} fill="currentColor" />,
      },
    ];

    const collectionSections =
      styleCollectionsModule?.STYLE_COLLECTION_FAMILIES.map((family) => {
        const collections = styleCollectionsModule.STYLE_COLLECTIONS.filter(
          (collection) =>
            collection.familyId === family.id &&
            collection.entries.length > 0 &&
            collection.id !== 'my_styles' &&
            collection.id !== 'favorites',
        );
        return {
          id: family.id,
          title: family.title,
          items: collections.map((collection) => ({
            id: `collection:${collection.id}`,
            label: collection.title,
            caption: family.title,
            countLabel: `${collection.sourcePackIds.length}`,
            tabId: getStyleCollectionTabId(collection.id),
            theme: getStyleCollectionTheme(collection),
            icon: getStyleCollectionIcon(collection.icon, 14),
          })),
        } satisfies StyleRecipeNavigationSection;
      }).filter((section) => section.items.length > 0) ?? [];

    return [
      { id: 'browse', title: 'Browse', items: browseItems },
      { id: 'personal', title: 'Personal', items: personalItems },
      ...collectionSections,
      {
        id: 'source',
        title: 'Source',
        items: STYLE_RUNTIME_PACK_SUMMARIES.map((pack) => {
          const theme = PACK_THEMES[pack.id] ?? PACK_THEMES.pack_01;
          return {
            id: `source:${pack.id}`,
            label: pack.name,
            caption: 'Source pack',
            countLabel: `${pack.presetCount}`,
            tabId: pack.id,
            theme,
            icon: getPackIcon(pack.id),
          } satisfies StyleRecipeNavigationItem;
        }),
      },
    ];
  }, [
    favorites.length,
    globalStyleCategoryCount,
    globalStylePresetCount,
    styleCollectionsModule,
    userStylePresets.length,
  ]);
  const styleTabNavigationItems = useMemo(
    () => [
      { id: STYLE_PACKS_TAB_ID, label: 'Collections' },
      ...styleRecipeNavigationSections.flatMap((section) =>
        section.items.map((item) => ({ id: item.tabId, label: item.label })),
      ),
    ],
    [styleRecipeNavigationSections],
  );
  const currentStyleTabIndex = Math.max(
    0,
    styleTabNavigationItems.findIndex((item) => item.id === currentStyleTabId),
  );
  const previousStyleTab = styleTabNavigationItems[currentStyleTabIndex - 1] ?? null;
  const nextStyleTab = styleTabNavigationItems[currentStyleTabIndex + 1] ?? null;

  const styleDetail = inspectedStyle ? (
    <StylePreviewDetail
      model={{
        inspectedStyle: inspectedStyle,
        getPresetVisualState: getPresetVisualState,
        selectedStyleIds: selectedStyleIds,
        selectedStyles: selectedStyles,
        copiedStyleId: copiedStyleId,
        handleApplyStyleRef: handleApplyStyleRef,
        handleCopyStylePrompt: handleCopyStylePrompt,
        handleUseStylePrompt: handleUseStylePrompt,
        setPromptNotice: setPromptNotice,
        userStyles: userStyles,
        getPackNameForId: getPackNameForId,
        setInspectedStyle: setInspectedStyle,
        inspectTriggerRef: inspectTriggerRef,
      }}
    />
  ) : (
    <div className="style-explorer-empty">
      <h2>Explore styles</h2>
      <p>Select a card to see its examples, visual DNA and prompt.</p>
    </div>
  );

  return {
    catalogMounted,
    isGenerating,
    explorerOpen,
    catalogExpanded,
    inspectedStyle,
    styleDetail,
    fileInputRef,
    onFileSelect,
    referenceSlotsRemaining,
    catalogRootRef,
    closeStyleCatalog,
    searchQuery,
    isPackLandingOpen,
    applyStyleTab,
    writeStyleTabHash,
    updateFilters,
    openStyleCatalog,
    selectedStyles,
    displayOptionsRef,
    isDisplayOptionsOpen,
    displayOptionsId,
    setIsDisplayOptionsOpen,
    sortOrder,
    isGlobalStyleBrowseTab,
    activeStyleViewMode,
    gridColumns,
    fitColumns,
    setExplorerColumnPref,
    setGridColumnPref,
    currentPackId,
    showFavoritesOnly,
    toggleFavoritesOnly,
    manageStylesButtonRef,
    manageStylesMenuId,
    isManageStylesOpen,
    setIsManageStylesOpen,
    handleCreateUserStyle,
    handleSaveSelectedStyleBlend,
    canSaveStyleBlend,
    canEditActiveUserStyle,
    handleEditActiveUserStyle,
    handleCloneActiveStyle,
    canCloneActiveStyle,
    navigateToStyleTab,
    getStyleTabHash,
    favorites,
    userStylePresets,
    isStyleNavigationPanelOpen,
    prefetchStyleTab,
    toggleStylePanel,
    userStyleError,
    refreshUserStyles,
    previousStyleTab,
    currentStyleTabId,
    styleTabNavigationItems,
    nextStyleTab,
    styleRuntimePackLoadRequest,
    onlyArchivedFavoritesSelected,
    unsearchedFavoritesRoute,
    archivedFavoritePresets,
    styleScrollRootRef,
    styleScrollWidth,
    renderPresetCard,
    userSearchIndex,
    loadedStylePacksById,
    userStylePack,
    loadStyleRuntimePacks,
    setStyleScrollWidth,
    styleRecipeNavigationSections,
    setTcgCatalogView,
    tcgCatalogView,
    images,
    generateTcgRecipeArt,
    processedData,
    visibleStyleGroupEntries,
    getPackNameForId,
    getPackIdForPreset,
    styleCategoryEagerBudget,
    activeTheme,
    filteredStylePresets,
    styleRuntimeError,
    retryStylePacks,
    isLoadingUserStyles,
    normalizedStyleSearchQuery,
    isLoadingStylePacks,
    isCatalogSearchOpen,
    handleCloseCatalogSearch,
    handleSelectCatalogPreset,
    handleChooseCompactStyle,
    selectedStyleIds,
    toggleFavorite,
    handleCatalogPrompt,
    promptNotice,
    previousPrompt,
    updateConfig,
    setPreviousPrompt,
    setPromptNotice,
    removeSelectedStyle,
    updateSelectedStyleStrength,
    toggleSelectedStyleEnabled,
    moveSelectedStyle,
    advancedOpen,
    setAdvancedOpen,
    advancedPanelRef,
    selectedStyleLayers,
    toggleSelectedStyleField,
    updateSelectedStyleFieldWeight,
    setSelectedStyleAvoidRulesMode,
    intentionalStylesV1,
    referenceImages,
    intentionalMode,
    setIntentionalMode,
    compileIssues,
    handleGenerateSelectedStyles,
    activeSelectedStyleCount,
    grokGenerateBlock,
    userStyleEditorSession,
    userStyles,
    getPresetVisualState,
    copiedStyleId,
    handleApplyStyleRef,
    handleCopyStylePrompt,
    handleUseStylePrompt,
    setInspectedStyle,
    inspectTriggerRef,
  };
}

export type StylesBrowserViewModel = ReturnType<typeof useStylesBrowserController>;

function StylesBrowserView({
  model,
}: {
  model: StylesBrowserViewModel & { catalogOnly: boolean };
}) {
  const {
    catalogOnly,
    catalogMounted,
    isGenerating,
    explorerOpen,
    catalogExpanded,
    inspectedStyle,
    styleDetail,
    fileInputRef,
    onFileSelect,
    referenceSlotsRemaining,
    selectedStyleLayers,
    userStyleEditorSession,
    userStyles,
  } = model;

  return (
    <>
      {!catalogOnly && (
        <RecipeLayout isGenerating={isGenerating} className="styles-workbench flex size-full">
          {explorerOpen && !catalogExpanded && inspectedStyle ? styleDetail : <RecipeResults />}
        </RecipeLayout>
      )}
      <input
        type="file"
        ref={fileInputRef}
        aria-label="Upload reference images"
        onChange={(e) => {
          if (e.target.files) {
            onFileSelect(Array.from(e.target.files).slice(0, referenceSlotsRemaining));
            e.target.value = '';
          }
        }}
        className="hidden"
        accept="image/*"
        multiple
      />
      <RecipeSidePanel>
        <AnimatePresence>
          {catalogMounted || explorerOpen ? (
            <div className="styles-catalog-mount" hidden={!explorerOpen} inert={!explorerOpen}>
              <React.Suspense fallback={<LazySurfaceFallback label="Loading styles" />}>
                <StyleCatalogPanel model={model} />
              </React.Suspense>
            </div>
          ) : null}
        </AnimatePresence>
      </RecipeSidePanel>

      {!catalogOnly && <StyleCompositionControls model={model} />}
      <RecipeOverlay>
        <AnimatePresence>
          {userStyleEditorSession && (
            <React.Suspense
              fallback={
                <LazySurfaceFallback
                  label="Loading style editor"
                  className="absolute inset-0 z-50 grid place-items-center bg-[color:var(--wb-panel)]/86 text-[color:var(--wb-muted)] backdrop-blur-xl"
                />
              }
            >
              <UserStyleEditorSurface
                sessionId={userStyleEditorSession.id}
                mode={userStyleEditorSession.mode}
                initialDraft={userStyleEditorSession.draft}
                initialSource={userStyleEditorSession.source}
                editingStyleId={userStyleEditorSession.editingStyleId}
                selectedStyleLayers={selectedStyleLayers}
                onClose={userStyles.close}
                onSaved={(style) => userStyles.reconcile(userStyleEditorSession.id, style, false)}
                onArchived={(style) => userStyles.reconcile(userStyleEditorSession.id, style, true)}
              />
            </React.Suspense>
          )}
        </AnimatePresence>
      </RecipeOverlay>
    </>
  );
}

export const StylesBrowser: React.FC<StylesBrowserProps> = (props) => {
  const [catalogDraft, setCatalogDraft] = useState<ImageGenerationConfig>(() => ({
    ...props.config,
    recipeId: null,
    recipeParams: null,
  }));
  const updateCatalogDraft = useCallback<StylesBrowserProps['updateConfig']>(
    (key, value) => setCatalogDraft((draft) => ({ ...draft, [key]: value })),
    [],
  );
  const view = useStylesBrowserController(
    props.catalogOnly
      ? { ...props, config: catalogDraft, updateConfig: updateCatalogDraft }
      : props,
  );
  return <StylesBrowserView model={{ ...view, catalogOnly: Boolean(props.catalogOnly) }} />;
};

function StyleCompositionControls({
  model,
}: {
  model: Pick<
    StylesBrowserViewModel,
    | 'promptNotice'
    | 'previousPrompt'
    | 'updateConfig'
    | 'setPreviousPrompt'
    | 'setPromptNotice'
    | 'explorerOpen'
    | 'catalogExpanded'
    | 'openStyleCatalog'
    | 'selectedStyles'
    | 'favorites'
    | 'userSearchIndex'
    | 'toggleFavorite'
    | 'handleChooseCompactStyle'
    | 'handleCatalogPrompt'
    | 'removeSelectedStyle'
    | 'updateSelectedStyleStrength'
    | 'toggleSelectedStyleEnabled'
    | 'moveSelectedStyle'
    | 'advancedOpen'
    | 'setAdvancedOpen'
    | 'advancedPanelRef'
    | 'selectedStyleLayers'
    | 'toggleSelectedStyleField'
    | 'updateSelectedStyleFieldWeight'
    | 'setSelectedStyleAvoidRulesMode'
    | 'intentionalStylesV1'
    | 'referenceImages'
    | 'intentionalMode'
    | 'setIntentionalMode'
    | 'compileIssues'
    | 'handleGenerateSelectedStyles'
    | 'activeSelectedStyleCount'
    | 'grokGenerateBlock'
    | 'isGenerating'
  >;
}) {
  const {
    promptNotice,
    previousPrompt,
    updateConfig,
    setPreviousPrompt,
    setPromptNotice,
    explorerOpen,
    catalogExpanded,
    openStyleCatalog,
    selectedStyles,
    favorites,
    userSearchIndex,
    toggleFavorite,
    handleChooseCompactStyle,
    handleCatalogPrompt,
    removeSelectedStyle,
    updateSelectedStyleStrength,
    toggleSelectedStyleEnabled,
    moveSelectedStyle,
    advancedOpen,
    setAdvancedOpen,
    advancedPanelRef,
    selectedStyleLayers,
    toggleSelectedStyleField,
    updateSelectedStyleFieldWeight,
    setSelectedStyleAvoidRulesMode,
    intentionalStylesV1,
    referenceImages,
    compileIssues,
    handleGenerateSelectedStyles,
    activeSelectedStyleCount,
    grokGenerateBlock,
    isGenerating,
  } = model;

  return (
    <RecipeControls compact>
      {promptNotice && (
        <div className="style-prompt-notice" role="status">
          {promptNotice}
          {previousPrompt !== null && (
            <button
              type="button"
              onClick={() => {
                updateConfig('prompt', previousPrompt);
                setPreviousPrompt(null);
                setPromptNotice('Previous prompt restored.');
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      <React.Suspense fallback={<LazySurfaceFallback label="Loading styles" />}>
        <CompactStyleSelector
          catalogOpen={explorerOpen}
          catalogExpanded={catalogExpanded}
          onExploreStyles={() => openStyleCatalog(true)}
          selectedStyles={selectedStyles}
          maxSlots={MAX_SELECTED_STYLE_SLOTS}
          favorites={favorites}
          extraIndex={userSearchIndex}
          onToggleFavorite={toggleFavorite}
          onChooseStyle={handleChooseCompactStyle}
          onCopyPrompt={(result) => void handleCatalogPrompt(result, 'copy')}
          onUsePrompt={(result) => void handleCatalogPrompt(result, 'use')}
          onRemove={removeSelectedStyle}
          onSetStrength={updateSelectedStyleStrength}
          onToggleEnabled={toggleSelectedStyleEnabled}
          onMove={moveSelectedStyle}
          onBrowseCatalog={() => openStyleCatalog(false)}
        />
      </React.Suspense>
      {selectedStyles.length > 0 ? (
        <button
          type="button"
          className="cs-advanced-toggle"
          data-style-advanced-toggle
          aria-expanded={advancedOpen}
          aria-controls="style-advanced-panel"
          onClick={() => {
            setAdvancedOpen((open) => !open);
            openStyleCatalog();
          }}
        >
          <span>Advanced layers</span>
          <SlidersHorizontal width={13} height={13} />
        </button>
      ) : null}
      {advancedOpen && selectedStyles.length > 0 ? (
        <RecipeSidePanel>
          <div
            ref={advancedPanelRef}
            id="style-advanced-panel"
            className="studio-surface style-advanced-rail"
            role="region"
            aria-label="Advanced layers"
          >
            <div className="create-side-panel-head">
              <strong>Advanced layers</strong>
              <span className="create-side-panel-count">{selectedStyles.length} active</span>
              <button
                type="button"
                aria-label="Close advanced layers"
                onClick={() => {
                  setAdvancedOpen(false);
                  document.querySelector<HTMLElement>('[data-style-advanced-toggle]')?.focus();
                }}
              >
                <X width={14} height={14} />
              </button>
            </div>
            <div className="create-side-panel-body custom-scrollbar">
              <React.Suspense fallback={<LazySurfaceFallback label="Loading advanced controls" />}>
                <StyleAdvancedControlsPanel
                  selectedStyles={selectedStyles}
                  selectedStyleLayers={selectedStyleLayers}
                  onToggleStyleEnabled={toggleSelectedStyleEnabled}
                  onToggleField={toggleSelectedStyleField}
                  onUpdateFieldWeight={updateSelectedStyleFieldWeight}
                  onSetAvoidRulesMode={setSelectedStyleAvoidRulesMode}
                />
              </React.Suspense>
            </div>
          </div>
        </RecipeSidePanel>
      ) : null}
      {selectedStyles.length > 0 && (intentionalStylesV1 || referenceImages.length > 0) ? (
        <div className="mt-3 space-y-2">
          <StyleApplicationMode model={model} />
          {intentionalStylesV1 && compileIssues.length > 0 ? (
            <ul className="space-y-1 text-xs text-[color:var(--wb-warning)]">
              {compileIssues.map((issue) => (
                <li key={`${issue.code}:${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        onClick={handleGenerateSelectedStyles}
        disabled={activeSelectedStyleCount === 0 || Boolean(grokGenerateBlock)}
        data-tooltip={grokGenerateBlock?.message}
        hidden
        data-style-generate-button
        data-generate-active={isGenerating ? 'true' : 'false'}
        className="mt-3 flex h-11 items-center justify-center gap-2 rounded-[var(--wb-radius)] border border-accent-400/2 bg-accent-500/18 px-4 text-[length:var(--wbp-label)] font-semibold tracking-normal text-accent-100 transition-[background-color,border-color,opacity] hover:border-accent-300/2 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-[color:var(--wb-line)] disabled:bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] disabled:text-[color:var(--wb-dim)]"
      >
        <Play width={16} height={16} />
        {isGenerating ? 'Queue' : 'Generate'}
      </button>
    </RecipeControls>
  );
}

function StylePreviewDetail({
  model,
}: {
  model: Pick<
    StylesBrowserViewModel,
    | 'inspectedStyle'
    | 'getPresetVisualState'
    | 'selectedStyleIds'
    | 'selectedStyles'
    | 'copiedStyleId'
    | 'handleApplyStyleRef'
    | 'handleCopyStylePrompt'
    | 'handleUseStylePrompt'
    | 'setPromptNotice'
    | 'userStyles'
    | 'getPackNameForId'
    | 'setInspectedStyle'
    | 'inspectTriggerRef'
  >;
}): React.ReactElement | null {
  const {
    inspectedStyle,
    getPresetVisualState,
    selectedStyleIds,
    selectedStyles,
    copiedStyleId,
    handleApplyStyleRef,
    handleCopyStylePrompt,
    handleUseStylePrompt,
    setPromptNotice,
    userStyles,
    getPackNameForId,
    setInspectedStyle,
    inspectTriggerRef,
  } = model;

  if (!inspectedStyle) return null;
  return (
    <React.Suspense fallback={<LazySurfaceFallback label="Loading style details" />}>
      <StyleDetailPreview
        preset={inspectedStyle.preset}
        visualState={getPresetVisualState(inspectedStyle.preset)}
        selected={selectedStyleIds.has(inspectedStyle.preset.id)}
        selectionDisabled={
          selectedStyles.length >= MAX_SELECTED_STYLE_SLOTS &&
          !selectedStyleIds.has(inspectedStyle.preset.id)
        }
        copied={copiedStyleId === inspectedStyle.preset.id}
        onApply={() => handleApplyStyleRef.current(inspectedStyle.preset, inspectedStyle.packId)}
        onCopy={(event) => handleCopyStylePrompt(event, inspectedStyle.preset)}
        onUsePrompt={() =>
          void handleUseStylePrompt(inspectedStyle.preset).catch(() =>
            setPromptNotice('Could not load this style prompt. Please try again.'),
          )
        }
        onEdit={
          inspectedStyle.packId === USER_STYLE_PACK_ID
            ? () => void userStyles.open({ kind: 'edit', styleId: inspectedStyle.preset.id })
            : undefined
        }
        onClone={() =>
          void userStyles.open({
            kind: 'clone',
            preset: inspectedStyle.preset,
            packId: inspectedStyle.packId,
            packName: getPackNameForId(inspectedStyle.packId),
          })
        }
        onClose={() => {
          setInspectedStyle(null);
          requestAnimationFrame(
            () => inspectTriggerRef.current?.isConnected && inspectTriggerRef.current.focus(),
          );
        }}
      />
    </React.Suspense>
  );
}

function StyleApplicationMode({
  model,
}: {
  model: React.ComponentProps<typeof StyleCompositionControls>['model'];
}) {
  const { intentionalStylesV1, intentionalMode, setIntentionalMode } = model;
  return (
    <div role="group" aria-label="Style application mode" className="flex gap-1">
      {(intentionalStylesV1
        ? (['generate', 'preserve', 'reinterpret'] as const)
        : (['preserve', 'reinterpret'] as const)
      ).map((mode) => {
        const isActive = intentionalMode === mode;

        return (
          <button
            key={mode}
            type="button"
            aria-pressed={isActive}
            onClick={() => setIntentionalMode(mode)}
            className={`${
              isActive ? 'studio-primary-control' : 'studio-ghost-control'
            } min-h-8 flex-1 gap-1.5 px-2 text-xs font-semibold capitalize transition-[background-color,border-color,color,box-shadow]`}
          >
            <Check
              width={14}
              height={14}
              strokeWidth={3}
              aria-hidden="true"
              className={isActive ? 'opacity-100' : 'opacity-0'}
            />
            <span>{mode}</span>
          </button>
        );
      })}
    </div>
  );
}
