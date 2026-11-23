import {
  isPresetInWorkspaceStyleScope,
  type WorkspaceStyleRef,
} from '../../packages/shared/src/workspaceContracts';
import { rankStyleSearch, styleSearchTerms } from '../../packages/shared/src/styles/styleSearch';
import {
  styleCatalogIndexEntrySearchFields,
  type StylePresetCatalogSearchIndex,
  type StylePresetCatalogSearchPackSummary,
  type StylePresetCatalogSearchResult,
} from './stylePresetManifests';

export type CompactStyleRoute =
  | { view: 'all' }
  | { view: 'packs' }
  | { view: 'categories'; packId: string }
  | { view: 'styles'; packId: string; categoryId: string }
  | { view: 'favorites' }
  | { view: 'project' };

export interface CompactStylePackSummary {
  id: string;
  name: string;
  presetCount: number;
}

export function clampCompactStyleStrength(value: number) {
  if (!Number.isFinite(value)) return 0.75;
  return Math.max(0.1, Math.min(1, Math.round(value * 100) / 100));
}

export function formatCompactStyleStrength(value: number) {
  return `${Math.round(clampCompactStyleStrength(value) * 100)}%`;
}

export function mergeCompactStyleSearchIndexes(
  primary: StylePresetCatalogSearchIndex | null,
  extra: StylePresetCatalogSearchIndex | null,
): StylePresetCatalogSearchIndex {
  if (!primary && !extra) {
    return { packs: [], presets: [], totalPresetCount: 0 };
  }
  if (!primary) return extra as StylePresetCatalogSearchIndex;
  if (!extra) return primary;
  const seen = new Set(primary.presets.map((preset) => preset.id));
  const presets = [
    ...primary.presets,
    ...extra.presets.filter((preset) => {
      if (seen.has(preset.id)) return false;
      seen.add(preset.id);
      return true;
    }),
  ];
  const packIds = new Set(primary.packs.map((pack) => pack.id));
  const packs = [...primary.packs, ...extra.packs.filter((pack) => !packIds.has(pack.id))];
  return {
    packs,
    presets,
    totalPresetCount: presets.length,
  };
}

export function listCompactStylePacks(
  packSummaries: readonly StylePresetCatalogSearchPackSummary[],
  extraIndex?: StylePresetCatalogSearchIndex | null,
): CompactStylePackSummary[] {
  const packs: CompactStylePackSummary[] = packSummaries.map((pack) => ({
    id: pack.id,
    name: pack.name,
    presetCount: pack.presetCount,
  }));
  const known = new Set(packs.map((pack) => pack.id));
  for (const pack of extraIndex?.packs ?? []) {
    if (known.has(pack.id)) continue;
    packs.push({ id: pack.id, name: pack.name, presetCount: pack.presetCount });
  }
  return packs;
}

export function planCompactStyleCatalogPackIds({
  route,
  query,
  packSummaries,
  projectScope = [],
}: {
  route: CompactStyleRoute;
  query: string;
  packSummaries: readonly CompactStylePackSummary[];
  projectScope?: readonly WorkspaceStyleRef[];
}) {
  const runtimePackIds = packSummaries
    .map((pack) => pack.id)
    .filter((packId) => packId !== 'user_styles' && packId !== 'favorites');
  if (styleSearchTerms(query).length > 0) return runtimePackIds;
  if (route.view === 'packs') return [];
  if (route.view === 'project') {
    const scopedPackIds = new Set(projectScope.map((ref) => ref.packId));
    return runtimePackIds.filter((packId) => scopedPackIds.has(packId));
  }
  if (route.view === 'categories' || route.view === 'styles') {
    return runtimePackIds.includes(route.packId) ? [route.packId] : [];
  }
  return runtimePackIds;
}

export function filterCompactStyleCatalog({
  index,
  route,
  query,
  favorites,
  projectScope = [],
}: {
  index: StylePresetCatalogSearchIndex;
  route: CompactStyleRoute;
  query: string;
  favorites: readonly string[];
  projectScope?: readonly WorkspaceStyleRef[];
}): StylePresetCatalogSearchResult[] {
  if (styleSearchTerms(query).length > 0) {
    return rankStyleSearch(index.presets, query, styleCatalogIndexEntrySearchFields);
  }
  const favoriteIds = new Set(favorites);
  return index.presets.filter((preset) => {
    if (route.view === 'favorites') return favoriteIds.has(preset.id);
    if (route.view === 'project') {
      return isPresetInWorkspaceStyleScope(projectScope, {
        packId: preset.packId,
        presetId: preset.id,
        category: preset.categoryName,
      });
    }
    if (route.view === 'styles') {
      return preset.packId === route.packId && preset.categoryId === route.categoryId;
    }
    if (route.view === 'categories') return preset.packId === route.packId;
    if (route.view === 'packs') return false;
    return true;
  });
}

export function compactStyleMenuTitle({
  route,
  query,
  resultCount,
  packs,
  projectTitle = 'Project styles',
}: {
  route: CompactStyleRoute;
  query: string;
  resultCount: number;
  packs: readonly CompactStylePackSummary[];
  projectTitle?: string;
}) {
  const trimmed = query.trim();
  if (trimmed) return `${resultCount} results`;
  if (route.view === 'packs') return 'Packs';
  if (route.view === 'project') return projectTitle;
  if (route.view === 'favorites') return 'Favorites';
  if (route.view === 'categories') {
    return packs.find((pack) => pack.id === route.packId)?.name ?? 'Categories';
  }
  if (route.view === 'styles') {
    return packs.find((pack) => pack.id === route.packId)?.name ?? 'Styles';
  }
  return 'All styles';
}

export function compactStyleParentRoute(route: CompactStyleRoute): CompactStyleRoute {
  if (route.view === 'styles') return { view: 'categories', packId: route.packId };
  if (route.view === 'categories' || route.view === 'project') return { view: 'packs' };
  return { view: 'all' };
}

export interface CompactStyleCategoryGroup {
  id: string;
  name: string;
  packId: string;
  presets: StylePresetCatalogSearchResult[];
}

export function groupCompactStylePresetsByCategory(
  presets: readonly StylePresetCatalogSearchResult[],
): CompactStyleCategoryGroup[] {
  const groups: CompactStyleCategoryGroup[] = [];
  const byKey = new Map<string, CompactStyleCategoryGroup>();
  for (const preset of presets) {
    const key = `${preset.packId}:${preset.categoryId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.presets.push(preset);
      continue;
    }
    const next: CompactStyleCategoryGroup = {
      id: preset.categoryId,
      name: preset.categoryName,
      packId: preset.packId,
      presets: [preset],
    };
    byKey.set(key, next);
    groups.push(next);
  }
  return groups;
}
