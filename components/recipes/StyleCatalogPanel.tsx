import { getStyleCategoryDisplayName } from './styles/collections/categoryDisplayNames';
import {
  NavArrowLeft as ChevronLeft,
  NavArrowRight as ChevronRight,
  Copy,
  Filter,
  Heart,
  ViewGrid as LayoutGrid,
  MultiplePages as Layers,
  MoreHoriz,
  EditPencil as PenTool,
  Plus,
  Search,
  ControlSlider as SlidersHorizontal,
  Sparks as Sparkles,
  MagicWand as Wand2,
  Xmark as X,
} from 'iconoir-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleCategoryGlyph } from './StyleCategoryGlyph';
import { resolveStyleCategoryIdentity } from './styleCategoryIdentity';
import { DemandMountedGsapDropdown } from '../ui/DemandMountedGsapDropdown';
import { LazySurfaceFallback } from '../ui/LazySurfaceFallback';
import { StyleBrowseSwitch } from './StyleBrowseSwitch';
import { STYLE_BROWSER_FLAT_GROUP_KEY, type StyleBrowserSortOrder } from './styleBrowserRenderPlan';
import {
  STYLE_GRID_DEFAULT_VIEWPORT_HEIGHT_PX,
  createStyleGridVirtualWindow,
  estimateStyleGroupPlaceholderHeight,
  type StyleGridVirtualWindow,
} from './styleGridVirtualization';
import { type StyleRuntimePreset } from './stylesData';
import { getStyleCollectionTabId, STYLE_PACKS_TAB_ID } from './styleTabRouting';
import { USER_STYLE_PACK_ID, USER_STYLE_PACK_NAME } from './userStyleRuntimeAdapter';
import { FAVORITES_PACK_ID, ALL_STYLE_CARDS_TAB_ID } from './styleTabRouting';
import type { StylesBrowserViewModel } from './StylesBrowser';
interface StylePresetGroupSectionProps {
  groupKey: string;
  title: string;
  icon?: React.ReactNode;
  presets: StyleRuntimePreset[];
  gridColumns: number;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerWidth: number;
  initiallyVisible: boolean;
  headerClassName: string;
  accentClassName: string;
  titleClassName: string;
  dividerClassName: string;
  renderPresetCard: (preset: StyleRuntimePreset) => React.ReactNode;
}

function areStyleGridVirtualWindowsEqual(
  first: StyleGridVirtualWindow,
  second: StyleGridVirtualWindow,
) {
  return (
    first.startIndex === second.startIndex &&
    first.endIndex === second.endIndex &&
    first.topSpacerHeight === second.topSpacerHeight &&
    first.bottomSpacerHeight === second.bottomSpacerHeight &&
    first.totalHeight === second.totalHeight
  );
}

function StyleGridPlaceholderCells({
  gridColumns,
  presetCount,
}: {
  gridColumns: number;
  presetCount: number;
}) {
  const placeholderCount = Math.min(Math.max(0, presetCount), Math.max(gridColumns * 3, 3));

  if (placeholderCount <= 0) return null;

  return (
    <div
      data-style-grid-placeholder
      className="grid gap-2.5"
      style={{
        gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: placeholderCount }, (_, index) => (
        <div
          key={index}
          data-style-grid-placeholder-card
          className="aspect-[3/4] rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)]/32 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
        >
          <div className="h-full rounded-[var(--wb-radius)] bg-linear-to-b from-white/[0.035] via-transparent to-black/20" />
        </div>
      ))}
    </div>
  );
}

function StyleGridVirtualSpacer({
  align,
  gridColumns,
  height,
  presetCount,
}: {
  align: 'start' | 'end';
  gridColumns: number;
  height: number;
  presetCount: number;
}) {
  if (height <= 0) return null;

  return (
    <div
      aria-hidden="true"
      data-style-grid-virtual-spacer={align}
      className="relative overflow-hidden"
      style={{ height }}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 ${
          align === 'end' ? 'bottom-0' : 'top-0'
        } opacity-55`}
      >
        <StyleGridPlaceholderCells gridColumns={gridColumns} presetCount={presetCount} />
      </div>
    </div>
  );
}

const StylePresetGroupSection = React.memo(
  ({
    groupKey,
    title,
    icon,
    presets,
    gridColumns,
    scrollRootRef,
    scrollContainerWidth,
    initiallyVisible,
    headerClassName,
    accentClassName,
    titleClassName,
    dividerClassName,
    renderPresetCard,
  }: StylePresetGroupSectionProps) => {
    const sectionRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const [isNearViewport, setIsNearViewport] = useState(() => initiallyVisible);
    const createInitialGridWindow = useCallback(
      () =>
        createStyleGridVirtualWindow({
          presetCount: presets.length,
          gridColumns,
          containerWidth: scrollContainerWidth,
          viewportTop: 0,
          viewportBottom: STYLE_GRID_DEFAULT_VIEWPORT_HEIGHT_PX,
        }),
      [gridColumns, presets.length, scrollContainerWidth],
    );
    const [gridWindow, setGridWindow] = useState(createInitialGridWindow);
    const placeholderHeight = estimateStyleGroupPlaceholderHeight({
      renderedPresetCount: presets.length,
      gridColumns,
      containerWidth: scrollContainerWidth,
      hasShowMore: false,
    });
    const visiblePresets = useMemo(
      () => presets.slice(gridWindow.startIndex, gridWindow.endIndex),
      [gridWindow.endIndex, gridWindow.startIndex, presets],
    );

    useLayoutEffect(() => {
      if (initiallyVisible || isNearViewport) return;
      const node = sectionRef.current;
      const root = scrollRootRef.current;
      if (!node) return;
      const rootRect = root?.getBoundingClientRect() ?? {
        top: 0,
        bottom: typeof window === 'undefined' ? 0 : window.innerHeight,
      };
      const rect = node.getBoundingClientRect();
      if (rect.bottom >= rootRect.top - 220 && rect.top <= rootRect.bottom + 220) {
        setIsNearViewport(true);
      }
    }, [initiallyVisible, isNearViewport, scrollRootRef]);

    useEffect(() => {
      if (initiallyVisible) {
        setIsNearViewport(true);
        return;
      }

      const node = sectionRef.current;
      const root = scrollRootRef.current;
      if (!node || typeof IntersectionObserver === 'undefined') {
        setIsNearViewport(true);
        return;
      }

      const observer = new IntersectionObserver(
        ([entry]) => {
          setIsNearViewport(Boolean(entry?.isIntersecting));
        },
        {
          root,
          rootMargin: STYLE_GROUP_VIEWPORT_ROOT_MARGIN,
        },
      );

      observer.observe(node);
      return () => observer.disconnect();
    }, [initiallyVisible, scrollRootRef]);

    useEffect(() => {
      if (!isNearViewport) return;

      const root = scrollRootRef.current;
      const grid = gridRef.current;
      if (!root || !grid) {
        setGridWindow(createInitialGridWindow());
        return;
      }

      let animationFrame = 0;
      const updateGridWindow = () => {
        animationFrame = 0;
        const rootRect = root.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const nextWindow = createStyleGridVirtualWindow({
          presetCount: presets.length,
          gridColumns,
          containerWidth: scrollContainerWidth,
          viewportTop: rootRect.top - gridRect.top,
          viewportBottom: rootRect.bottom - gridRect.top,
        });

        setGridWindow((currentWindow) =>
          areStyleGridVirtualWindowsEqual(currentWindow, nextWindow) ? currentWindow : nextWindow,
        );
      };
      const scheduleGridWindowUpdate = () => {
        if (animationFrame !== 0) return;
        animationFrame = window.requestAnimationFrame(updateGridWindow);
      };

      updateGridWindow();
      root.addEventListener('scroll', scheduleGridWindowUpdate, { passive: true });
      window.addEventListener('resize', scheduleGridWindowUpdate);

      return () => {
        root.removeEventListener('scroll', scheduleGridWindowUpdate);
        window.removeEventListener('resize', scheduleGridWindowUpdate);
        if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      };
    }, [
      createInitialGridWindow,
      gridColumns,
      isNearViewport,
      presets.length,
      scrollContainerWidth,
      scrollRootRef,
    ]);

    return (
      <div
        ref={sectionRef}
        data-style-group={groupKey}
        data-style-group-state={isNearViewport ? 'eager' : 'placeholder'}
        data-style-group-planned-cards={presets.length}
        data-style-group-mounted-cards={isNearViewport ? gridWindow.renderedPresetCount : 0}
        data-style-group-hidden-cards={0}
        className="relative"
        style={isNearViewport ? undefined : { minHeight: placeholderHeight }}
      >
        <div
          className={`sticky top-0 z-30 mb-2 flex items-center gap-2 border-y border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] px-2 py-2 shadow-[0_10px_18px_rgba(0,0,0,0.28)] ${headerClassName}`}
        >
          <div className={`h-4 w-1 rounded-[var(--wb-radius)] ${accentClassName}`} />
          {icon ? <span className="text-[color:var(--wb-muted)]">{icon}</span> : null}
          <h3
            className={`text-[length:var(--wbp-label)] font-semibold tracking-normal ${titleClassName}`}
          >
            {title}
          </h3>
          <div className={`h-px flex-1 ${dividerClassName}`} />
        </div>

        {isNearViewport ? (
          <>
            <div
              ref={gridRef}
              data-style-group-grid={groupKey}
              data-style-grid-window={`${gridWindow.startIndex}:${gridWindow.endIndex}`}
              data-style-grid-total-cards={presets.length}
              data-style-grid-mounted-cards={gridWindow.renderedPresetCount}
            >
              <StyleGridVirtualSpacer
                align="end"
                gridColumns={gridColumns}
                height={gridWindow.topSpacerHeight}
                presetCount={presets.length}
              />
              <div
                className="grid gap-2.5"
                style={{
                  gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                }}
              >
                {visiblePresets.map(renderPresetCard)}
              </div>
              <StyleGridVirtualSpacer
                align="start"
                gridColumns={gridColumns}
                height={gridWindow.bottomSpacerHeight}
                presetCount={presets.length}
              />
            </div>
          </>
        ) : (
          <div
            aria-hidden="true"
            data-style-group-placeholder
            className="relative overflow-hidden rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)]/20 p-2"
            style={{ height: Math.max(120, placeholderHeight - 40) }}
          >
            <StyleGridPlaceholderCells gridColumns={gridColumns} presetCount={presets.length} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-zinc-950/90 to-transparent" />
          </div>
        )}
      </div>
    );
  },
);

function StyleCatalogDisplayOptions({
  model,
}: {
  model: Pick<
    StylesBrowserViewModel,
    | 'displayOptionsRef'
    | 'isDisplayOptionsOpen'
    | 'displayOptionsId'
    | 'setIsDisplayOptionsOpen'
    | 'sortOrder'
    | 'updateFilters'
    | 'isGlobalStyleBrowseTab'
    | 'activeStyleViewMode'
    | 'gridColumns'
    | 'fitColumns'
    | 'catalogExpanded'
    | 'setExplorerColumnPref'
    | 'setGridColumnPref'
    | 'currentPackId'
    | 'showFavoritesOnly'
    | 'toggleFavoritesOnly'
  >;
}) {
  const {
    displayOptionsRef,
    isDisplayOptionsOpen,
    displayOptionsId,
    setIsDisplayOptionsOpen,
    sortOrder,
    updateFilters,
    isGlobalStyleBrowseTab,
    activeStyleViewMode,
    gridColumns,
    fitColumns,
    catalogExpanded,
    setExplorerColumnPref,
    setGridColumnPref,
    currentPackId,
    showFavoritesOnly,
    toggleFavoritesOnly,
  } = model;

  return (
    <div className="relative">
      <button
        ref={displayOptionsRef}
        type="button"
        className="studio-ghost-control style-catalog-control style-catalog-icon"
        aria-label="Style display options"
        aria-haspopup="dialog"
        aria-expanded={isDisplayOptionsOpen}
        aria-controls={displayOptionsId}
        data-tooltip="Display options"
        onClick={() => setIsDisplayOptionsOpen((open) => !open)}
      >
        <SlidersHorizontal width={16} height={16} />
      </button>
      <DemandMountedGsapDropdown
        id={displayOptionsId}
        open={isDisplayOptionsOpen}
        onOpenChange={setIsDisplayOptionsOpen}
        triggerRef={displayOptionsRef}
        placement="bottom-right"
        portal
        role="dialog"
        aria-label="Style display options"
        className="style-display-options"
      >
        <label className="style-display-field">
          <span>Sort</span>
          <select
            aria-label="Sort style cards"
            value={sortOrder}
            onChange={(event) =>
              updateFilters({
                sortOrder: event.target.value as StyleBrowserSortOrder,
              })
            }
          >
            {STYLE_BROWSER_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {!isGlobalStyleBrowseTab && (
          <div className="style-display-field">
            <span>Layout</span>
            <div className="style-display-layout" role="group" aria-label="Style card layout">
              <button
                type="button"
                onClick={() => updateFilters({ viewMode: 'grouped' })}
                aria-label="Show grouped style categories"
                aria-pressed={activeStyleViewMode === 'grouped'}
              >
                <Layers width={14} height={14} /> Categories
              </button>
              <button
                type="button"
                onClick={() => updateFilters({ viewMode: 'flat' })}
                aria-label="Show all style cards in one grid"
                aria-pressed={activeStyleViewMode === 'flat'}
              >
                <LayoutGrid width={14} height={14} /> Cards
              </button>
            </div>
          </div>
        )}
        <div className="style-display-field">
          <span>
            Columns <output>{gridColumns}</output>
          </span>
          <input
            type="range"
            min={1}
            max={Math.max(1, fitColumns)}
            step={1}
            value={gridColumns}
            aria-label="Style grid columns"
            onChange={(event) =>
              (catalogExpanded ? setExplorerColumnPref : setGridColumnPref)(
                Number(event.target.value),
              )
            }
          />
        </div>
        {currentPackId !== FAVORITES_PACK_ID && (
          <button
            type="button"
            className="style-display-favorites"
            aria-label="Filter favorite styles"
            aria-pressed={showFavoritesOnly}
            onClick={() => toggleFavoritesOnly()}
          >
            <Heart width={15} height={15} fill={showFavoritesOnly ? 'currentColor' : 'none'} />{' '}
            Favorites only
          </button>
        )}
      </DemandMountedGsapDropdown>
    </div>
  );
}

function StyleCatalogManagement({
  model,
}: {
  model: Pick<
    StylesBrowserViewModel,
    | 'manageStylesButtonRef'
    | 'manageStylesMenuId'
    | 'isManageStylesOpen'
    | 'setIsManageStylesOpen'
    | 'handleCreateUserStyle'
    | 'handleSaveSelectedStyleBlend'
    | 'canSaveStyleBlend'
    | 'canEditActiveUserStyle'
    | 'handleEditActiveUserStyle'
    | 'handleCloneActiveStyle'
    | 'canCloneActiveStyle'
  >;
}) {
  const {
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
  } = model;

  return (
    <div className="relative">
      <button
        ref={manageStylesButtonRef}
        type="button"
        aria-haspopup="menu"
        aria-label="Style actions"
        aria-controls={manageStylesMenuId}
        aria-expanded={isManageStylesOpen}
        data-tooltip="Style actions"
        onClick={() => setIsManageStylesOpen((open) => !open)}
        className="studio-ghost-control style-catalog-control style-catalog-icon"
      >
        <MoreHoriz width={18} height={18} aria-hidden="true" />
      </button>
      <DemandMountedGsapDropdown
        id={manageStylesMenuId}
        open={isManageStylesOpen}
        onOpenChange={setIsManageStylesOpen}
        triggerRef={manageStylesButtonRef}
        placement="bottom-right"
        portal
        role="menu"
        aria-label="Style actions"
        className="grid w-48 gap-1 p-2"
      >
        <button
          type="button"
          role="menuitem"
          data-dropdown-item
          onClick={() => {
            setIsManageStylesOpen(false);
            handleCreateUserStyle();
          }}
          className="studio-ghost-control style-catalog-control style-catalog-menu-action"
          data-style-create-user-style
        >
          <Plus width={15} height={15} /> New style
        </button>
        <button
          type="button"
          role="menuitem"
          data-dropdown-item
          onClick={() => {
            setIsManageStylesOpen(false);
            handleSaveSelectedStyleBlend();
          }}
          disabled={!canSaveStyleBlend}
          data-style-save-blend
          className="studio-ghost-control style-catalog-control style-catalog-menu-action"
        >
          <Layers width={15} height={15} />
          <span>Save blend</span>
        </button>

        <button
          type="button"
          role="menuitem"
          data-dropdown-item
          onClick={() => {
            setIsManageStylesOpen(false);
            if (canEditActiveUserStyle) handleEditActiveUserStyle();
            else handleCloneActiveStyle();
          }}
          disabled={!canEditActiveUserStyle && !canCloneActiveStyle}
          data-style-edit-or-clone
          className="studio-ghost-control style-catalog-control style-catalog-menu-action"
        >
          {canEditActiveUserStyle ? (
            <PenTool width={15} height={15} />
          ) : (
            <Copy width={15} height={15} />
          )}
          <span>{canEditActiveUserStyle ? 'Edit style' : 'Clone style'}</span>
        </button>
      </DemandMountedGsapDropdown>
    </div>
  );
}

function StyleCatalogTabs({
  model,
}: {
  model: Pick<
    StylesBrowserViewModel,
    'getStyleTabHash' | 'navigateToStyleTab' | 'isPackLandingOpen' | 'currentPackId'
  >;
}) {
  const { getStyleTabHash, navigateToStyleTab, isPackLandingOpen, currentPackId } = model;

  return (
    <div className="styles-catalog-tabs vt-recipe-tabs vt-style-tabs">
      <div className="styles-catalog-tab-group">
        <button
          type="button"
          onClick={() => navigateToStyleTab(ALL_STYLE_CARDS_TAB_ID)}
          data-style-tab-url={`#${getStyleTabHash(ALL_STYLE_CARDS_TAB_ID)}`}
          aria-label="Show all styles"
          aria-pressed={!isPackLandingOpen && currentPackId === ALL_STYLE_CARDS_TAB_ID}
          className={styleCatalogTabClass(
            !isPackLandingOpen && currentPackId === ALL_STYLE_CARDS_TAB_ID,
          )}
        >
          <LayoutGrid width={15} height={15} />
          All styles
        </button>
        <button
          type="button"
          onClick={() => navigateToStyleTab(STYLE_PACKS_TAB_ID)}
          data-style-tab-url={`#${getStyleTabHash(STYLE_PACKS_TAB_ID)}`}
          aria-label="Show collections"
          aria-pressed={isPackLandingOpen}
          className={styleCatalogTabClass(isPackLandingOpen)}
        >
          <Layers width={15} height={15} />
          Collections
        </button>
        <button
          type="button"
          onClick={() => navigateToStyleTab(USER_STYLE_PACK_ID)}
          data-style-pack-id={USER_STYLE_PACK_ID}
          data-style-pack-active={
            !isPackLandingOpen && currentPackId === USER_STYLE_PACK_ID ? 'true' : 'false'
          }
          data-style-tab-url={`#${getStyleTabHash(USER_STYLE_PACK_ID)}`}
          aria-label={`Show ${USER_STYLE_PACK_NAME}`}
          aria-pressed={!isPackLandingOpen && currentPackId === USER_STYLE_PACK_ID}
          className={styleCatalogTabClass(
            !isPackLandingOpen && currentPackId === USER_STYLE_PACK_ID,
          )}
        >
          <Sparkles width={15} height={15} />
          {USER_STYLE_PACK_NAME}
        </button>
        <button
          type="button"
          onClick={() => navigateToStyleTab(FAVORITES_PACK_ID)}
          data-style-tab-url={`#${getStyleTabHash(FAVORITES_PACK_ID)}`}
          aria-label="Show favorite styles"
          aria-pressed={!isPackLandingOpen && currentPackId === FAVORITES_PACK_ID}
          className={styleCatalogTabClass(
            !isPackLandingOpen && currentPackId === FAVORITES_PACK_ID,
          )}
        >
          <Heart
            width={15}
            height={15}
            fill={
              !isPackLandingOpen && currentPackId === FAVORITES_PACK_ID ? 'currentColor' : 'none'
            }
          />
          Favorites
        </button>
      </div>
    </div>
  );
}

function StyleCatalogHeader({
  model,
}: {
  model: Pick<
    StylesBrowserViewModel,
    | 'catalogExpanded'
    | 'searchQuery'
    | 'isPackLandingOpen'
    | 'applyStyleTab'
    | 'writeStyleTabHash'
    | 'updateFilters'
    | 'openStyleCatalog'
    | 'closeStyleCatalog'
    | 'selectedStyles'
    | 'displayOptionsRef'
    | 'isDisplayOptionsOpen'
    | 'displayOptionsId'
    | 'setIsDisplayOptionsOpen'
    | 'sortOrder'
    | 'isGlobalStyleBrowseTab'
    | 'activeStyleViewMode'
    | 'gridColumns'
    | 'fitColumns'
    | 'setExplorerColumnPref'
    | 'setGridColumnPref'
    | 'currentPackId'
    | 'showFavoritesOnly'
    | 'toggleFavoritesOnly'
    | 'manageStylesButtonRef'
    | 'manageStylesMenuId'
    | 'isManageStylesOpen'
    | 'setIsManageStylesOpen'
    | 'handleCreateUserStyle'
    | 'handleSaveSelectedStyleBlend'
    | 'canSaveStyleBlend'
    | 'canEditActiveUserStyle'
    | 'handleEditActiveUserStyle'
    | 'handleCloneActiveStyle'
    | 'canCloneActiveStyle'
    | 'navigateToStyleTab'
    | 'getStyleTabHash'
  >;
}) {
  const {
    catalogExpanded,
    searchQuery,
    isPackLandingOpen,
    applyStyleTab,
    writeStyleTabHash,
    updateFilters,
    openStyleCatalog,
    closeStyleCatalog,
    selectedStyles,
  } = model;

  return (
    <div className="styles-catalog-chrome">
      <div className="styles-catalog-header">
        <h2 className="styles-catalog-title">{catalogExpanded ? 'Style explorer' : 'Styles'}</h2>
        <label className="styles-catalog-search">
          <Search width={16} height={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search styles"
            placeholder="Search styles…"
            value={searchQuery}
            onChange={(event) => {
              const nextQuery = event.target.value;
              if (isPackLandingOpen) {
                applyStyleTab(ALL_STYLE_CARDS_TAB_ID, {
                  browserStatePatch: { searchQuery: nextQuery },
                });
                writeStyleTabHash(ALL_STYLE_CARDS_TAB_ID);
              } else updateFilters({ searchQuery: nextQuery });
            }}
          />
        </label>
        <StyleBrowseSwitch
          catalogOpen
          expanded={catalogExpanded}
          onCatalog={() => openStyleCatalog(false)}
          onExplore={() => openStyleCatalog(true)}
        />
        {catalogExpanded && (
          <button type="button" className="styles-explorer-done" onClick={closeStyleCatalog}>
            {selectedStyles.length > 0 ? `Use ${selectedStyles.length} selected` : 'Back to create'}
          </button>
        )}
        {!isPackLandingOpen && <StyleCatalogDisplayOptions model={model} />}
        <StyleCatalogManagement model={model} />
        <button
          type="button"
          className="styles-catalog-close"
          data-close-style-catalog
          aria-label="Close style catalog"
          onClick={closeStyleCatalog}
        >
          <X width={14} height={14} />
          Close
        </button>
        <StyleCatalogTabs model={model} />
      </div>
    </div>
  );
}

function StyleCatalogEmptyState({
  model,
}: {
  model: Pick<
    StylesBrowserViewModel,
    | 'currentPackId'
    | 'styleRuntimeError'
    | 'retryStylePacks'
    | 'userStyleError'
    | 'refreshUserStyles'
    | 'isLoadingUserStyles'
    | 'normalizedStyleSearchQuery'
    | 'handleCreateUserStyle'
    | 'isLoadingStylePacks'
  >;
}) {
  const {
    currentPackId,
    styleRuntimeError,
    retryStylePacks,
    userStyleError,
    refreshUserStyles,
    isLoadingUserStyles,
    normalizedStyleSearchQuery,
    handleCreateUserStyle,
    isLoadingStylePacks,
  } = model;

  return (
    <div className="h-64 flex flex-col items-center justify-center text-[color:var(--wb-dim)] gap-4">
      {currentPackId !== USER_STYLE_PACK_ID && styleRuntimeError ? (
        <>
          <Filter width={32} height={32} className="opacity-20" />
          <span className="text-xs font-bold tracking-normal">Could not load this style pack</span>
          <button
            type="button"
            onClick={retryStylePacks}
            className="flex h-9 items-center gap-2 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] px-3 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)]"
          >
            <Wand2 width={13} height={13} />
            Retry
          </button>
        </>
      ) : currentPackId === USER_STYLE_PACK_ID && userStyleError ? (
        <>
          <Filter width={32} height={32} className="opacity-20" />
          <span className="text-xs font-bold tracking-normal">Could not load styles</span>
          <button
            type="button"
            onClick={() => void refreshUserStyles()}
            className="flex h-9 items-center gap-2 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] px-3 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)]"
          >
            <Wand2 width={13} height={13} />
            Retry
          </button>
        </>
      ) : currentPackId === USER_STYLE_PACK_ID &&
        !isLoadingUserStyles &&
        normalizedStyleSearchQuery.length === 0 ? (
        <>
          <Sparkles width={32} height={32} className="opacity-30 text-[color:var(--wb-info)] " />
          <span className="text-xs font-bold tracking-normal text-[color:var(--wb-muted)]">
            No custom styles yet
          </span>
          <button
            type="button"
            onClick={handleCreateUserStyle}
            className="flex h-9 items-center gap-2 rounded-[var(--wb-radius)] border border-sky-400/2 bg-sky-500/10 px-3 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-info)]  transition-colors hover:bg-sky-500/16"
          >
            <Plus width={13} height={13} />
            Create Style
          </button>
        </>
      ) : (
        <>
          <Filter width={32} height={32} className="opacity-20" />
          <span className="text-xs font-bold tracking-normal">
            {isLoadingUserStyles || isLoadingStylePacks
              ? 'Loading styles'
              : 'No styles found matching criteria'}
          </span>
        </>
      )}
    </div>
  );
}

function StyleCatalogGroups({
  model,
}: {
  model: Pick<
    StylesBrowserViewModel,
    | 'currentPackId'
    | 'setTcgCatalogView'
    | 'tcgCatalogView'
    | 'searchQuery'
    | 'images'
    | 'generateTcgRecipeArt'
    | 'isGenerating'
    | 'processedData'
    | 'gridColumns'
    | 'styleScrollWidth'
    | 'styleScrollRootRef'
    | 'renderPresetCard'
    | 'visibleStyleGroupEntries'
    | 'activeStyleViewMode'
    | 'getPackNameForId'
    | 'getPackIdForPreset'
    | 'styleCategoryEagerBudget'
    | 'activeTheme'
    | 'filteredStylePresets'
    | 'styleRuntimeError'
    | 'retryStylePacks'
    | 'userStyleError'
    | 'refreshUserStyles'
    | 'isLoadingUserStyles'
    | 'normalizedStyleSearchQuery'
    | 'handleCreateUserStyle'
    | 'isLoadingStylePacks'
  >;
}) {
  const {
    currentPackId,
    setTcgCatalogView,
    tcgCatalogView,
    searchQuery,
    images,
    generateTcgRecipeArt,
    isGenerating,
    processedData,
    gridColumns,
    styleScrollWidth,
    styleScrollRootRef,
    renderPresetCard,
    visibleStyleGroupEntries,
    activeStyleViewMode,
    getPackNameForId,
    getPackIdForPreset,
    styleCategoryEagerBudget,
    activeTheme,
    filteredStylePresets,
  } = model;

  return (
    <div className="w-full space-y-6 pb-20">
      {currentPackId === 'pack_22' ? (
        <div
          className="flex w-fit flex-wrap gap-1 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] p-1"
          role="group"
          aria-label="Trading card atlas sections"
        >
          <button
            type="button"
            onClick={() => setTcgCatalogView('visual')}
            aria-pressed={tcgCatalogView === 'visual'}
            className="rounded-[var(--wb-radius)] px-3 py-1.5 text-xs font-semibold text-[color:var(--wb-ink)] transition-colors aria-pressed:bg-[color-mix(in_srgb,var(--wb-ink)_12%,transparent)]"
          >
            Visual styles
          </button>
          <button
            type="button"
            onClick={() => setTcgCatalogView('components')}
            aria-pressed={tcgCatalogView === 'components'}
            className="rounded-[var(--wb-radius)] px-3 py-1.5 text-xs font-semibold text-[color:var(--wb-ink)] transition-colors aria-pressed:bg-[color-mix(in_srgb,var(--wb-ink)_12%,transparent)]"
          >
            Components · 42
          </button>
        </div>
      ) : null}
      {currentPackId === 'pack_22' && tcgCatalogView === 'components' ? (
        <TcgComponentStudio
          query={searchQuery}
          images={images}
          onGenerateArtwork={generateTcgRecipeArt}
          isGenerating={isGenerating}
        />
      ) : (
        <>
          {/* FAVORITES SECTION (If any exist in current filter and not in favorites tab) */}
          {processedData.favorites.length > 0 && currentPackId !== FAVORITES_PACK_ID && (
            <StylePresetGroupSection
              key={`favorites:${gridColumns}:${styleScrollWidth}:${processedData.favorites.length}`}
              groupKey="favorites"
              title="Pinned / Favorites"
              presets={processedData.favorites}
              gridColumns={gridColumns}
              scrollRootRef={styleScrollRootRef}
              scrollContainerWidth={styleScrollWidth}
              initiallyVisible
              headerClassName="opacity-100"
              accentClassName="bg-rose-500"
              titleClassName="text-[color:var(--wb-danger)]"
              dividerClassName="bg-linear-to-r from-rose-500/20 to-transparent"
              renderPresetCard={renderPresetCard}
            />
          )}

          {visibleStyleGroupEntries.map(([groupKey, presets], index) => {
            const isFlatStyleGroup =
              activeStyleViewMode === 'flat' && groupKey === STYLE_BROWSER_FLAT_GROUP_KEY;
            const categoryIdentity = isFlatStyleGroup
              ? null
              : resolveStyleCategoryIdentity(currentPackId, groupKey);
            return (
              <StylePresetGroupSection
                key={`${groupKey}:${gridColumns}:${styleScrollWidth}:${presets.length}`}
                groupKey={groupKey}
                title={
                  isFlatStyleGroup
                    ? 'All Styles'
                    : presets[0]
                      ? `${groupKey.includes(' / ') ? `${getPackNameForId(getPackIdForPreset(presets[0]))} / ` : ''}${getStyleCategoryDisplayName(getPackIdForPreset(presets[0]), presets[0].category || 'General')}`
                      : groupKey
                }
                icon={
                  isFlatStyleGroup || !categoryIdentity ? (
                    <LayoutGrid width={12} height={12} />
                  ) : (
                    <StyleCategoryGlyph iconId={categoryIdentity.iconId} size={12} />
                  )
                }
                presets={presets}
                gridColumns={gridColumns}
                scrollRootRef={styleScrollRootRef}
                scrollContainerWidth={styleScrollWidth}
                initiallyVisible={index < styleCategoryEagerBudget}
                headerClassName=""
                accentClassName={categoryIdentity?.accentClassName ?? activeTheme.bg}
                titleClassName={categoryIdentity?.titleClassName ?? 'text-[color:var(--wb-ink)]'}
                dividerClassName="bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)]"
                renderPresetCard={renderPresetCard}
              />
            );
          })}

          {filteredStylePresets.length === 0 && <StyleCatalogEmptyState model={model} />}
        </>
      )}
    </div>
  );
}

export function StyleCatalogPanel({
  model,
}: {
  model: Pick<
    StylesBrowserViewModel,
    | 'catalogExpanded'
    | 'catalogRootRef'
    | 'closeStyleCatalog'
    | 'searchQuery'
    | 'isPackLandingOpen'
    | 'applyStyleTab'
    | 'writeStyleTabHash'
    | 'updateFilters'
    | 'openStyleCatalog'
    | 'selectedStyles'
    | 'displayOptionsRef'
    | 'isDisplayOptionsOpen'
    | 'displayOptionsId'
    | 'setIsDisplayOptionsOpen'
    | 'sortOrder'
    | 'isGlobalStyleBrowseTab'
    | 'activeStyleViewMode'
    | 'gridColumns'
    | 'fitColumns'
    | 'setExplorerColumnPref'
    | 'setGridColumnPref'
    | 'currentPackId'
    | 'showFavoritesOnly'
    | 'toggleFavoritesOnly'
    | 'manageStylesButtonRef'
    | 'manageStylesMenuId'
    | 'isManageStylesOpen'
    | 'setIsManageStylesOpen'
    | 'handleCreateUserStyle'
    | 'handleSaveSelectedStyleBlend'
    | 'canSaveStyleBlend'
    | 'canEditActiveUserStyle'
    | 'handleEditActiveUserStyle'
    | 'handleCloneActiveStyle'
    | 'canCloneActiveStyle'
    | 'navigateToStyleTab'
    | 'favorites'
    | 'userStylePresets'
    | 'isStyleNavigationPanelOpen'
    | 'getStyleTabHash'
    | 'prefetchStyleTab'
    | 'toggleStylePanel'
    | 'userStyleError'
    | 'refreshUserStyles'
    | 'previousStyleTab'
    | 'currentStyleTabId'
    | 'styleTabNavigationItems'
    | 'nextStyleTab'
    | 'styleRuntimePackLoadRequest'
    | 'onlyArchivedFavoritesSelected'
    | 'unsearchedFavoritesRoute'
    | 'archivedFavoritePresets'
    | 'styleScrollRootRef'
    | 'styleScrollWidth'
    | 'renderPresetCard'
    | 'userSearchIndex'
    | 'loadedStylePacksById'
    | 'userStylePack'
    | 'loadStyleRuntimePacks'
    | 'setStyleScrollWidth'
    | 'styleRecipeNavigationSections'
    | 'setTcgCatalogView'
    | 'tcgCatalogView'
    | 'images'
    | 'generateTcgRecipeArt'
    | 'isGenerating'
    | 'processedData'
    | 'visibleStyleGroupEntries'
    | 'getPackNameForId'
    | 'getPackIdForPreset'
    | 'styleCategoryEagerBudget'
    | 'activeTheme'
    | 'filteredStylePresets'
    | 'styleRuntimeError'
    | 'retryStylePacks'
    | 'isLoadingUserStyles'
    | 'normalizedStyleSearchQuery'
    | 'isLoadingStylePacks'
    | 'isCatalogSearchOpen'
    | 'handleCloseCatalogSearch'
    | 'handleSelectCatalogPreset'
    | 'handleChooseCompactStyle'
    | 'selectedStyleIds'
    | 'toggleFavorite'
    | 'handleCatalogPrompt'
    | 'styleDetail'
  >;
}) {
  const {
    catalogExpanded,
    catalogRootRef,
    closeStyleCatalog,
    isPackLandingOpen,
    navigateToStyleTab,
    favorites,
    userStylePresets,
    isStyleNavigationPanelOpen,
    getStyleTabHash,
    prefetchStyleTab,
    toggleStylePanel,
    isCatalogSearchOpen,
    handleCloseCatalogSearch,
    handleSelectCatalogPreset,
    handleChooseCompactStyle,
    selectedStyleIds,
    toggleFavorite,
    handleCatalogPrompt,
    styleDetail,
  } = model;

  return (
    <div
      className="studio-surface create-side-panel-dialog styles-catalog-panel"
      data-workspace-expanded={catalogExpanded}
    >
      <dialog
        open
        ref={catalogRootRef}
        data-style-browser-root
        aria-modal="false"
        aria-label="Style catalog"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            closeStyleCatalog();
          }
        }}
        className="studio-panel-dialog vt-style-browser-surface studio-surface relative flex h-full min-w-0 flex-1 flex-col bg-[color:var(--wb-bg)] outline-none"
      >
        <StyleCatalogHeader model={model} />

        {isPackLandingOpen ? (
          <React.Suspense
            fallback={
              <LazySurfaceFallback
                label="Loading collections"
                className="flex flex-1 items-center justify-center bg-[color:var(--wb-panel)]/40 text-[color:var(--wb-muted)]"
              />
            }
          >
            <StyleCollectionsLandingSurface
              favoritesCount={favorites.length}
              userStyleCount={userStylePresets.length}
              isNavigationPanelOpen={isStyleNavigationPanelOpen}
              getCollectionTabId={getStyleCollectionTabId}
              getStyleTabHash={getStyleTabHash}
              onNavigateToStyleTab={navigateToStyleTab}
              onPrefetchStyleTab={prefetchStyleTab}
              onToggleNavigationPanel={() => toggleStylePanel('navigation')}
            />
          </React.Suspense>
        ) : (
          <StyleCatalogFolder model={model} />
        )}

        {isCatalogSearchOpen && (
          <React.Suspense
            fallback={
              <LazySurfaceFallback
                label="Loading catalog"
                className="absolute inset-0 z-40 grid place-items-center bg-[color:var(--wb-panel)] text-[color:var(--wb-muted)]"
              />
            }
          >
            <StylePresetCatalogSearchSurface
              onClose={handleCloseCatalogSearch}
              onSelectPreset={handleSelectCatalogPreset}
              onApplyPreset={handleChooseCompactStyle}
              selectedIds={selectedStyleIds}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              onCopyPrompt={(result) => void handleCatalogPrompt(result, 'copy')}
              onUsePrompt={(result) => void handleCatalogPrompt(result, 'use')}
            />
          </React.Suspense>
        )}
        {catalogExpanded ? <div className="style-explorer-detail">{styleDetail}</div> : null}
      </dialog>
    </div>
  );
}

function StyleCatalogFolder({
  model,
}: {
  model: React.ComponentProps<typeof StyleCatalogPanel>['model'];
}) {
  const {
    searchQuery,
    sortOrder,
    activeStyleViewMode,
    gridColumns,
    currentPackId,
    showFavoritesOnly,
    navigateToStyleTab,
    favorites,
    userStylePresets,
    isStyleNavigationPanelOpen,
    toggleStylePanel,
    userStyleError,
    refreshUserStyles,
    currentStyleTabId,
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
  } = model;
  return (
    <div data-style-folder={currentPackId} className="flex min-h-0 flex-1 flex-col">
      {currentPackId === USER_STYLE_PACK_ID && userStyleError && userStylePresets.length > 0 ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 p-3 text-xs text-[color:var(--wb-warning)] "
        >
          <span>{userStyleError} The list may be incomplete.</span>
          <button type="button" onClick={() => void refreshUserStyles()}>
            Retry
          </button>
        </div>
      ) : null}
      {/* Pack Header Info + Search Bar */}
      <div
        className={`style-folder-heading grid min-h-12 min-w-0 items-center gap-4 border-b border-[color:var(--wb-line)] px-4 py-2.5 sm:px-5 2xl:px-6 ${
          isStyleNavigationPanelOpen
            ? 'lg:grid-cols-[260px_minmax(0,1fr)]'
            : 'lg:grid-cols-[40px_minmax(0,1fr)]'
        }`}
      >
        <div className="hidden lg:block" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <StyleCategoryNavigation model={model} />
        </div>
      </div>

      {styleRuntimePackLoadRequest.loadAll && !onlyArchivedFavoritesSelected ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {unsearchedFavoritesRoute && archivedFavoritePresets.length > 0 ? (
            <div
              ref={styleScrollRootRef}
              data-style-archived-favorites
              className="max-h-[38vh] min-h-0 shrink-0 overflow-y-auto px-4 pb-3"
            >
              <StylePresetGroupSection
                groupKey="archived-favorites"
                title="Archived favorites"
                presets={archivedFavoritePresets}
                gridColumns={gridColumns}
                scrollRootRef={styleScrollRootRef}
                scrollContainerWidth={styleScrollWidth}
                initiallyVisible
                headerClassName=""
                accentClassName="bg-amber-500"
                titleClassName="text-[color:var(--wb-muted)]"
                dividerClassName="bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)]"
                renderPresetCard={renderPresetCard}
              />
            </div>
          ) : null}
          <React.Suspense fallback={<LazySurfaceFallback label="Loading styles" />}>
            <PagedStyleCatalog
              query={searchQuery}
              sortOrder={sortOrder}
              favorites={favorites}
              favoritesOnly={showFavoritesOnly || currentPackId === FAVORITES_PACK_ID}
              extraIndex={userSearchIndex}
              loadedPacks={{
                ...loadedStylePacksById,
                [USER_STYLE_PACK_ID]: userStylePack,
              }}
              loadPacks={loadStyleRuntimePacks}
              renderCard={renderPresetCard}
              columns={gridColumns}
              onWidthChange={setStyleScrollWidth}
              grouped={activeStyleViewMode === 'grouped'}
            />
          </React.Suspense>
        </div>
      ) : (
        <div
          className={`style-folder-layout grid min-h-0 min-w-0 flex-1 gap-4 px-4 py-3 sm:px-5 2xl:px-6 ${
            isStyleNavigationPanelOpen
              ? 'lg:grid-cols-[260px_minmax(0,1fr)]'
              : 'lg:grid-cols-[40px_minmax(0,1fr)]'
          }`}
        >
          {isStyleNavigationPanelOpen ? (
            <React.Suspense
              fallback={
                <LazySurfaceFallback label="Loading style map" className="hidden min-h-0 lg:flex" />
              }
            >
              <StyleRecipeNavigationPanel
                sections={styleRecipeNavigationSections}
                activeTabId={currentStyleTabId}
                onOpen={navigateToStyleTab}
                onClose={() => toggleStylePanel('navigation')}
              />
            </React.Suspense>
          ) : (
            <aside
              data-style-detail-navigation-rail
              className="hidden min-h-0 min-w-0 items-start justify-center rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)]/70 p-1.5 lg:flex"
            >
              <button
                type="button"
                onClick={() => toggleStylePanel('navigation')}
                data-style-detail-navigation-toggle
                className="flex size-7 items-center justify-center rounded-[var(--wb-radius)] text-[color:var(--wb-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)]"
                aria-label="Show style map"
                data-tooltip="Show style map"
              >
                <ChevronRight width={14} height={14} />
              </button>
            </aside>
          )}
          <div
            ref={styleScrollRootRef}
            className="min-h-0 min-w-0 overflow-y-auto pb-12 custom-scrollbar"
          >
            <React.Suspense
              fallback={
                <LazySurfaceFallback
                  label="Loading style cards"
                  className="flex min-h-64 items-center justify-center text-[color:var(--wb-muted)]"
                />
              }
            >
              <StyleCatalogGroups model={model} />
            </React.Suspense>
          </div>
        </div>
      )}
    </div>
  );
}

function StyleCategoryNavigation({
  model,
}: {
  model: React.ComponentProps<typeof StyleCatalogFolder>['model'];
}) {
  const {
    navigateToStyleTab,
    previousStyleTab,
    currentStyleTabId,
    styleTabNavigationItems,
    nextStyleTab,
  } = model;
  return (
    <div className="styles-category-navigation">
      <button
        type="button"
        onClick={() => previousStyleTab && navigateToStyleTab(previousStyleTab.id)}
        disabled={!previousStyleTab}
        data-style-tab-previous
        aria-label="Previous category"
        data-tooltip={
          previousStyleTab ? `Previous: ${previousStyleTab.label}` : 'No previous category'
        }
      >
        <ChevronLeft width={15} height={15} />
      </button>
      <label className="styles-catalog-map-select">
        <select
          aria-label="Browse collections and categories"
          value={currentStyleTabId}
          onChange={(event) => navigateToStyleTab(event.target.value)}
        >
          {styleTabNavigationItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => nextStyleTab && navigateToStyleTab(nextStyleTab.id)}
        disabled={!nextStyleTab}
        data-style-tab-next
        aria-label="Next category"
        data-tooltip={nextStyleTab ? `Next: ${nextStyleTab.label}` : 'No next category'}
      >
        <ChevronRight width={15} height={15} />
      </button>
    </div>
  );
}

function styleCatalogTabClass(active: boolean) {
  return `styles-catalog-tab${active ? ' is-active' : ''}`;
}

const STYLE_BROWSER_SORT_OPTIONS = [
  { value: 'source', label: 'Source' },
  { value: 'az', label: 'Name A-Z' },
  { value: 'za', label: 'Name Z-A' },
  { value: 'created_desc', label: 'Created New' },
  { value: 'created_asc', label: 'Created Old' },
  { value: 'updated_desc', label: 'Updated New' },
  { value: 'updated_asc', label: 'Updated Old' },
] satisfies Array<{ value: StyleBrowserSortOrder; label: string }>;
const STYLE_GROUP_VIEWPORT_ROOT_MARGIN = '220px 0px';

const TcgComponentStudio = React.lazy(() =>
  import('./styles/TcgComponentStudio').then((module) => ({ default: module.TcgComponentStudio })),
);

const StylePresetCatalogSearchSurface = React.lazy(() =>
  import('./StylePresetCatalogSearchSurface').then((module) => ({
    default: module.StylePresetCatalogSearchSurface,
  })),
);

const PagedStyleCatalog = React.lazy(() =>
  import('./PagedStyleCatalog').then((module) => ({ default: module.PagedStyleCatalog })),
);

const StyleCollectionsLandingSurface = React.lazy(() =>
  import('./StyleCollectionsLandingSurface').then((module) => ({
    default: module.StyleCollectionsLandingSurface,
  })),
);

const StyleRecipeNavigationPanel = React.lazy(() =>
  import('./StyleRecipeNavigationPanel').then((module) => ({
    default: module.StyleRecipeNavigationPanel,
  })),
);
