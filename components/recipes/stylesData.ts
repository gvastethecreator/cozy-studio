import { normalizeStyleRuntimePack, type StyleRuntimePack } from './styles/runtimeTypes';
import { loadStyleThumbnailPack } from '../../lib/styleThumbnailCatalog';
import {
  fetchStylePackFile,
  INSTALLED_STYLE_PACK_SUMMARIES,
  isHiddenStylePreset,
  isInstalledStylePack,
} from '../../lib/installedStylePacks';

/** Installed style packs (ADR 0011), filled at startup before React mounts. */
export const STYLE_RUNTIME_PACK_SUMMARIES = INSTALLED_STYLE_PACK_SUMMARIES;

export function createStyleRuntimeRegistry({
  packIds,
  loadPack,
  loadThumbnail,
}: {
  packIds: () => readonly string[];
  loadPack: (packId: string) => Promise<StyleRuntimePack | null>;
  loadThumbnail: (packId: string) => Promise<unknown>;
}) {
  const values = new Map<string, StyleRuntimePack | null>();
  const pending = new Map<string, Promise<StyleRuntimePack | null>>();

  const loadRuntimePack = async (packId: string): Promise<StyleRuntimePack | null> => {
    if (values.has(packId)) return values.get(packId) ?? null;
    const inFlight = pending.get(packId);
    if (inFlight) return inFlight;

    const request = Promise.all([loadPack(packId), loadThumbnail(packId)])
      .then(([pack]) => {
        const normalized = pack ? normalizeStyleRuntimePack(pack) : null;
        values.set(packId, normalized);
        return normalized;
      })
      .finally(() => {
        if (pending.get(packId) === request) pending.delete(packId);
      });
    pending.set(packId, request);
    return request;
  };

  const loadRuntimePacks = async () => {
    const packs = await Promise.all(packIds().map(loadRuntimePack));
    return packs.filter((pack): pack is StyleRuntimePack => pack !== null);
  };

  return {
    loadRuntimePack,
    loadRuntimePacks,
  };
}

const styleRuntimeRegistry = createStyleRuntimeRegistry({
  packIds: () => STYLE_RUNTIME_PACK_SUMMARIES.map((pack) => pack.id),
  loadPack: async (packId) => {
    if (!isInstalledStylePack(packId)) return null;
    const pack = await fetchStylePackFile<StyleRuntimePack>(packId, 'runtime');
    return {
      ...pack,
      presets: pack.presets.filter((preset) => !isHiddenStylePreset(packId, preset.id)),
    };
  },
  loadThumbnail: loadStyleThumbnailPack,
});

export const loadStyleRuntimePack = styleRuntimeRegistry.loadRuntimePack;
export const loadStyleRuntimePacks = styleRuntimeRegistry.loadRuntimePacks;

export * from './styles/manifestTypes';
export * from './styles/runtimeTypes';
