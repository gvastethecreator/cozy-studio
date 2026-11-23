import { describe, expect, it, vi } from 'vitest';
import type { ExtensionManifest } from '../packages/shared/src/extensions';
import {
  getInstalledStylePacksVersion,
  getStyleLandingFolder,
  INSTALLED_STYLE_PACK_SUMMARIES,
  isHiddenStylePreset,
  registerInstalledStylePacks,
  reloadInstalledStylePacksOnReconnect,
  subscribeInstalledStylePacks,
} from './installedStylePacks';

const listInstalledExtensions = vi.hoisted(() => vi.fn());
vi.mock('../services/studio-api/extensions', () => ({ listInstalledExtensions }));

function stylePack(
  packId: string,
  presetCount: number,
  copiedFrom?: ExtensionManifest['stylePack']['copiedFrom'],
): ExtensionManifest {
  return {
    schemaVersion: 1,
    id: `cozy.${packId.replace('_', '-')}`,
    kind: 'style-pack',
    version: '1.0.0',
    studio: '>=0.1.0',
    title: packId,
    files: {
      pack: 'pack.json',
      runtime: 'runtime.json',
      search: 'search.json',
      thumbnails: 'thumbnails.json',
    },
    stylePack: { id: packId, name: packId, description: '', presetCount, copiedFrom },
    assets: [],
  };
}

const essentials = stylePack('pack_00', 2, {
  'SP00-001': { packId: 'pack_01', presetId: 'SP01-001' },
  'SP00-002': { packId: 'pack_02', presetId: 'SP02-012' },
});
essentials.stylePack.landing = {
  imageKeys: [],
  collections: {
    photo: { presetCount: 2, imageKeys: [], copiedFromPackCounts: { pack_01: 1, pack_02: 1 } },
    film: { presetCount: 1, imageKeys: [], copiedFromPackCounts: { pack_01: 1 } },
  },
};

describe('installed style packs', () => {
  it('hides a copied preset only while its source pack is installed', () => {
    registerInstalledStylePacks([essentials, stylePack('pack_01', 140)]);
    expect(isHiddenStylePreset('pack_00', 'SP00-001')).toBe(true);
    expect(isHiddenStylePreset('pack_00', 'SP00-002')).toBe(false);
    expect(INSTALLED_STYLE_PACK_SUMMARIES.find((pack) => pack.id === 'pack_00')?.presetCount).toBe(
      1,
    );
    expect(getStyleLandingFolder('photo')?.presetCount).toBe(1);
    expect(getStyleLandingFolder('film')).toBeNull();

    registerInstalledStylePacks([essentials]);
    expect(isHiddenStylePreset('pack_00', 'SP00-001')).toBe(false);

    registerInstalledStylePacks([essentials, stylePack('pack_01', 140), stylePack('pack_02', 176)]);
    expect(INSTALLED_STYLE_PACK_SUMMARIES.map((pack) => pack.id)).toEqual(['pack_01', 'pack_02']);
  });

  it('applies a changed pack list once and reloads it when the event stream comes back', async () => {
    const onChange = vi.fn();
    const stop = subscribeInstalledStylePacks(onChange);
    registerInstalledStylePacks([stylePack('pack_01', 140)]);
    registerInstalledStylePacks([stylePack('pack_01', 140)]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const version = getInstalledStylePacksVersion();

    let emit: (connected: boolean) => void = () => undefined;
    const unsubscribe = reloadInstalledStylePacksOnReconnect((listener) => {
      emit = listener;
      return () => undefined;
    });
    listInstalledExtensions.mockResolvedValue({
      extensions: [stylePack('pack_01', 140), stylePack('pack_33', 60)],
      installedLayers: {},
    });
    emit(true);
    expect(listInstalledExtensions).not.toHaveBeenCalled();

    emit(false);
    emit(true);
    await vi.waitFor(() => expect(INSTALLED_STYLE_PACK_SUMMARIES).toHaveLength(2));
    expect(listInstalledExtensions).toHaveBeenCalledWith({ refresh: true });
    expect(getInstalledStylePacksVersion()).toBe(version + 1);
    expect(onChange).toHaveBeenCalledTimes(2);
    emit(true);
    expect(listInstalledExtensions).toHaveBeenCalledTimes(1);
    unsubscribe();
    stop();
  });
});
