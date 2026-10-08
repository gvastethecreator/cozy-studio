import { getStyleCategoryDisplayName } from './styles/collections/categoryDisplayNames';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadStylePresetCatalogSearchIndex,
  STYLE_PRESET_CATALOG_SEARCH_PACK_SUMMARIES,
} from './stylePresetCatalogSearchData';
import type {
  StylePresetCatalogSearchIndex,
  StylePresetCatalogSearchIndexEntry,
} from './stylePresetManifests';
import type { StyleRuntimePack, StyleRuntimePreset } from './styles/runtimeTypes';
import type { StyleBrowserSortOrder } from './styleBrowserRenderPlan';
import {
  createStyleGridMetrics,
  createStyleGridVirtualWindow,
  STYLE_GRID_CARD_GAP_PX,
  STYLE_GRID_DEFAULT_VIEWPORT_HEIGHT_PX,
  STYLE_GRID_GROUP_HEADER_HEIGHT_PX,
} from './styleGridVirtualization';

export function PagedStyleCatalog({
  query,
  sortOrder,
  favorites,
  favoritesOnly,
  extraIndex,
  loadedPacks,
  loadPacks,
  renderCard,
  columns,
  grouped,
  onWidthChange,
}: {
  query: string;
  sortOrder: StyleBrowserSortOrder;
  favorites: string[];
  favoritesOnly: boolean;
  extraIndex: StylePresetCatalogSearchIndex | null;
  loadedPacks: Record<string, StyleRuntimePack>;
  loadPacks: (ids: readonly string[]) => Promise<StyleRuntimePack[]>;
  renderCard: (preset: StyleRuntimePreset) => React.ReactNode;
  columns: number;
  grouped: boolean;
  onWidthChange: (width: number) => void;
}) {
  const [index, setIndex] = useState<StylePresetCatalogSearchIndex | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({
    top: 0,
    height: STYLE_GRID_DEFAULT_VIEWPORT_HEIGHT_PX,
    width: 0,
  });
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const width = Math.max(0, element.clientWidth - 24);
      const next = {
        top: element.scrollTop,
        height: element.clientHeight || STYLE_GRID_DEFAULT_VIEWPORT_HEIGHT_PX,
        width,
      };
      setViewport((current) =>
        current.top === next.top && current.height === next.height && current.width === next.width
          ? current
          : next,
      );
      onWidthChange(width);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', scheduleUpdate, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', scheduleUpdate);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [onWidthChange]);
  useEffect(() => {
    let cancelled = false;
    loadStylePresetCatalogSearchIndex(
      STYLE_PRESET_CATALOG_SEARCH_PACK_SUMMARIES.map((pack) => pack.id),
    ).then(
      (value) => {
        if (!cancelled) {
          setIndex(value);
          setError(false);
        }
      },
      () => {
        if (!cancelled) setError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const results = useMemo(() => {
    const search = query.trim().toLowerCase();
    const favoriteIds = new Set(favorites);
    const entries = [...(extraIndex?.presets ?? []), ...(index?.presets ?? [])].filter(
      (entry) =>
        (!search || entry.searchableText.includes(search)) &&
        (!favoritesOnly || favoriteIds.has(entry.id)),
    );
    if (sortOrder === 'az' || sortOrder === 'za')
      entries.sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true }) *
          (sortOrder === 'za' ? -1 : 1),
      );
    else if (sortOrder !== 'source') {
      const key = sortOrder.startsWith('created') ? 'createdAt' : 'updatedAt';
      const timestamp = (entry: StylePresetCatalogSearchIndexEntry) =>
        typeof entry[key] === 'number'
          ? (entry[key] as number)
          : Date.parse(String(entry[key] ?? '')) || 0;
      entries.sort((a, b) => (timestamp(a) - timestamp(b)) * (sortOrder.endsWith('desc') ? -1 : 1));
    }
    return entries;
  }, [extraIndex, favorites, favoritesOnly, index, query, sortOrder]);
  const layout = useMemo(() => {
    const groups = new Map<string, StylePresetCatalogSearchIndexEntry[]>();
    for (const entry of results) {
      const key = grouped ? `${entry.packName} / ${entry.categoryName}` : '';
      const entries = groups.get(key);
      if (entries) entries.push(entry);
      else groups.set(key, [entry]);
    }
    let height = 0;
    const sections = [...groups].map(([name, entries]) => {
      const metrics = createStyleGridMetrics({
        presetCount: entries.length,
        gridColumns: columns,
        containerWidth: viewport.width,
      });
      const headerHeight = name ? STYLE_GRID_GROUP_HEADER_HEIGHT_PX : 0;
      const top = height;
      height += headerHeight + metrics.totalHeight + STYLE_GRID_CARD_GAP_PX;
      return { name, entries, top, headerHeight, metrics };
    });
    return { sections, height };
  }, [results, grouped, columns, viewport.width]);
  const visibleSections = useMemo(() => {
    const top = Math.max(0, viewport.top - 12);
    const bottom = top + viewport.height;
    return layout.sections
      .filter((section) => {
        const overscan = section.metrics.rowHeight * 2;
        return (
          section.top <= bottom + overscan &&
          section.top + section.headerHeight + section.metrics.totalHeight >= top - overscan
        );
      })
      .map((section) => ({
        ...section,
        window: createStyleGridVirtualWindow({
          presetCount: section.entries.length,
          gridColumns: columns,
          containerWidth: viewport.width,
          viewportTop: top - section.top - section.headerHeight,
          viewportBottom: bottom - section.top - section.headerHeight,
          overscanRows: 2,
          targetPresetCount: 0,
        }),
      }));
  }, [layout, viewport, columns]);
  const visibleEntries = visibleSections.flatMap((section) =>
    section.entries.slice(section.window.startIndex, section.window.endIndex),
  );
  const visiblePackIds = [...new Set(visibleEntries.map((entry) => entry.packId))];
  const presetById = new Map(
    visiblePackIds.flatMap((id) =>
      (loadedPacks[id]?.presets ?? []).map((preset) => [preset.id, preset] as const),
    ),
  );
  const unloadedPackKey = visiblePackIds.filter((id) => !loadedPacks[id]).join('|');
  useEffect(() => {
    if (!unloadedPackKey) return;
    let cancelled = false;
    setError(false);
    void loadPacks(unloadedPackKey.split('|')).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [unloadedPackKey, loadPacks, attempt]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setViewport((current) => (current.top ? { ...current, top: 0 } : current));
  }, [query, sortOrder, favoritesOnly, grouped]);
  return (
    <div className="paged-style-catalog">
      <div
        ref={scrollRef}
        className="paged-style-catalog-scroll custom-scrollbar"
        aria-busy={!index || Boolean(unloadedPackKey)}
      >
        {error ? (
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Could not load styles · Retry
          </button>
        ) : !index ? (
          <p role="status">Loading styles…</p>
        ) : !results.length ? (
          <p>No styles found matching criteria.</p>
        ) : null}
        <div style={{ position: 'relative', height: layout.height }}>
          {visibleSections.map(({ name, entries, top, headerHeight, window }) => (
            <section key={name} style={{ position: 'absolute', top, width: '100%' }}>
              {name && (
                <h3
                  style={{ margin: 0, height: headerHeight, display: 'flex', alignItems: 'center' }}
                >
                  {entries[0]
                    ? `${entries[0].packName} / ${getStyleCategoryDisplayName(entries[0].packId, entries[0].categoryName)}`
                    : name}
                </h3>
              )}
              <div style={{ position: 'relative', height: window.totalHeight }}>
                <div
                  className="paged-style-grid"
                  style={{
                    gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
                    position: 'absolute',
                    top: window.topSpacerHeight,
                    width: '100%',
                    gap: STYLE_GRID_CARD_GAP_PX,
                  }}
                >
                  {entries.slice(window.startIndex, window.endIndex).map((entry) => {
                    const preset = presetById.get(entry.id);
                    return preset ? (
                      renderCard(preset)
                    ) : (
                      <div
                        key={entry.id}
                        className="style-card-loading"
                        aria-label={`Loading ${entry.name}`}
                      />
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
