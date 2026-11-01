import { getStyleCategoryDisplayName } from './categoryDisplayNames';
import type { StylePresetSource } from '../../../../packages/shared/src/extensions';
import type { StyleRuntimePack, StyleRuntimePreset } from '../runtimeTypes';
import type {
  ResolvedStyleCollection,
  StyleCollection,
  StyleCollectionCopy,
  StyleCollectionEntry,
  StyleCollectionRole,
  StyleCollectionRuntimePreset,
  StyleCollectionRuntimeSummary,
  StyleCollectionSourceIndex,
} from './styleCollectionTypes';

function fallbackRole(role: StyleCollectionEntry['role']): StyleCollectionRole {
  return role ?? 'primary';
}

type IncludedPreset = {
  pack: StyleRuntimePack;
  preset: StyleRuntimePreset;
  entry: StyleCollectionEntry;
  source?: StylePresetSource;
};

/**
 * `copiedFrom` maps copied preset ids, such as Essentials entries, to their source. A copy
 * resolves as its source preset while that source pack is not in `packs`.
 */
export function createStyleCollectionSourceIndex(
  packs: StyleRuntimePack[],
  copiedFrom: Readonly<Record<string, StylePresetSource>> = {},
): StyleCollectionSourceIndex {
  const packsById = new Map<string, StyleRuntimePack>();
  const presetsById = new Map<string, { pack: StyleRuntimePack; preset: StyleRuntimePreset }>();
  const categoryNamesByPackId = new Map<string, Set<string>>();

  for (const pack of packs) {
    packsById.set(pack.id, pack);
    const categoryNames = new Set<string>();
    for (const preset of pack.presets) {
      presetsById.set(preset.id, { pack, preset });
      if (preset.category) categoryNames.add(preset.category);
    }
    categoryNamesByPackId.set(pack.id, categoryNames);
  }

  const copies: StyleCollectionCopy[] = [];
  for (const pack of packs)
    for (const preset of pack.presets) {
      const source = copiedFrom[preset.id];
      if (source && !packsById.has(source.packId)) copies.push({ pack, preset, source });
    }

  return { packsById, presetsById, categoryNamesByPackId, copies };
}

function copiesFrom(
  index: StyleCollectionSourceIndex,
  entry: StyleCollectionEntry,
  matches: (source: StylePresetSource) => boolean = () => true,
): IncludedPreset[] {
  return index.copies
    .filter(({ source }) => source.packId === entry.packId && matches(source))
    .map((copy) => ({ ...copy, entry }));
}

function findPresetInPack(
  index: StyleCollectionSourceIndex,
  packId: string | undefined,
  presetId: string,
) {
  if (!packId) return index.presetsById.get(presetId) ?? null;
  const pack = index.packsById.get(packId);
  const preset = pack?.presets.find((item) => item.id === presetId) ?? null;
  return pack && preset ? { pack, preset } : null;
}

function resolveIncludedEntry(
  entry: StyleCollectionEntry,
  index: StyleCollectionSourceIndex,
): IncludedPreset[] {
  if (entry.kind === 'manual_group') {
    return (entry.entries ?? []).flatMap((child) => resolveIncludedEntry(child, index));
  }

  if (entry.kind === 'pack') {
    const pack = entry.packId ? index.packsById.get(entry.packId) : null;
    return pack
      ? pack.presets.map((preset) => ({ pack, preset, entry }))
      : copiesFrom(index, entry);
  }

  if (entry.kind === 'category') {
    const pack = entry.packId ? index.packsById.get(entry.packId) : null;
    if (!entry.categoryName) return [];
    if (!pack) return copiesFrom(index, entry, (source) => source.category === entry.categoryName);
    return pack.presets
      .filter((preset) => preset.category === entry.categoryName)
      .map((preset) => ({ pack, preset, entry }));
  }

  if (entry.kind === 'preset') {
    const presetIds = entry.presetIds ?? (entry.presetId ? [entry.presetId] : []);
    return presetIds.flatMap((presetId) => {
      const result = findPresetInPack(index, entry.packId, presetId);
      if (result) return [{ ...result, entry }];
      return index.copies
        .filter(
          ({ source }) =>
            source.presetId === presetId && (!entry.packId || source.packId === entry.packId),
        )
        .map((copy) => ({ ...copy, entry }));
    });
  }

  if (entry.kind === 'query') {
    const packIds = new Set(entry.query?.packIds ?? [...index.packsById.keys()]);
    const categoryNames = new Set(entry.query?.categoryNames ?? []);
    const presetIds = new Set(entry.query?.presetIds ?? []);
    const hasCategoryFilter = categoryNames.size > 0;
    const hasPresetFilter = presetIds.size > 0;

    return [...packIds].flatMap((packId) => {
      const pack = index.packsById.get(packId);
      if (!pack) return [];
      return pack.presets
        .filter((preset) => {
          if (hasPresetFilter && !presetIds.has(preset.id)) return false;
          if (hasCategoryFilter && (!preset.category || !categoryNames.has(preset.category))) {
            return false;
          }
          return true;
        })
        .map((preset) => ({ pack, preset, entry }));
    });
  }

  return [];
}

function collectExcludedPresetIds(
  entries: StyleCollectionEntry[],
  index: StyleCollectionSourceIndex,
): Set<string> {
  const excluded = new Set<string>();
  for (const entry of entries) {
    if (entry.includeMode === 'exclude') {
      for (const { preset } of resolveIncludedEntry({ ...entry, includeMode: 'include' }, index)) {
        excluded.add(preset.id);
      }
      continue;
    }
    if (entry.kind === 'manual_group') {
      for (const presetId of collectExcludedPresetIds(entry.entries ?? [], index)) {
        excluded.add(presetId);
      }
    }
  }
  return excluded;
}

export function resolveStyleCollection(
  collection: StyleCollection,
  index: StyleCollectionSourceIndex,
): ResolvedStyleCollection {
  const excludedPresetIds = collectExcludedPresetIds(collection.entries, index);
  const seenPresetIds = new Set<string>();
  const presets: StyleCollectionRuntimePreset[] = [];

  for (const entry of collection.entries) {
    if (entry.includeMode === 'exclude') continue;
    for (const resolved of resolveIncludedEntry(entry, index)) {
      const presetId = resolved.preset.id;
      if (excludedPresetIds.has(presetId) || seenPresetIds.has(presetId)) {
        continue;
      }
      seenPresetIds.add(presetId);
      const categoryPackId = resolved.source?.packId ?? resolved.pack.id;
      const category =
        (resolved.source ? resolved.source.category : resolved.preset.category) ?? 'General';
      presets.push({
        preset: resolved.preset,
        presetId,
        sourcePackId: resolved.pack.id,
        sourceCategory: category,
        displayCategory:
          resolved.entry.displayCategory ?? getStyleCategoryDisplayName(categoryPackId, category),
        collectionId: collection.id,
        collectionEntryId: resolved.entry.id,
        collectionRole: fallbackRole(resolved.entry.role),
        facetOverrides: resolved.entry.facetOverrides,
      });
    }
  }

  const sourcePackIds = [...new Set(presets.map((preset) => preset.sourcePackId))];
  const summary: StyleCollectionRuntimeSummary = {
    id: collection.id,
    title: collection.title,
    familyId: collection.familyId,
    description: collection.description,
    icon: collection.icon,
    order: collection.order,
    presetCount: presets.length,
    sourcePackIds,
    featuredPresetIds:
      collection.featuredPresetIds ?? presets.slice(0, 5).map((item) => item.presetId),
    facets: collection.facets,
  };

  return { collection, summary, presets };
}

export function resolveStyleCollections(
  collections: readonly StyleCollection[],
  packs: StyleRuntimePack[],
): ResolvedStyleCollection[] {
  const index = createStyleCollectionSourceIndex(packs);
  return collections.map((collection) => resolveStyleCollection(collection, index));
}

export function createStyleCollectionRuntimeSummaries(
  collections: readonly StyleCollection[],
  packs: StyleRuntimePack[],
): StyleCollectionRuntimeSummary[] {
  return resolveStyleCollections(collections, packs).map((collection) => collection.summary);
}
