/** @vitest-environment jsdom */
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PagedStyleCatalog } from './PagedStyleCatalog';
import { loadStylePresetCatalogSearchIndex } from './stylePresetCatalogSearchData';
import { createStylePresetCatalogSearchIndexFromRuntimePacks } from './stylePresetManifests';
import type { StyleRuntimePack } from './styles/runtimeTypes';

vi.mock('./stylePresetCatalogSearchData', () => ({
  STYLE_PRESET_CATALOG_SEARCH_PACK_SUMMARIES: [
    { id: 'pack_01', name: 'First pack', presetCount: 200 },
    { id: 'pack_02', name: 'Second pack', presetCount: 200 },
  ],
  loadStylePresetCatalogSearchIndex: vi.fn(),
}));

const packs: StyleRuntimePack[] = ['pack_01', 'pack_02'].map((id) => ({
  id,
  name: id,
  description: '',
  presets: Array.from({ length: 200 }, (_, index) => ({
    id: `${id}-${index}`,
    name: `${id} ${index}`,
    category: 'Portrait',
    style: {
      aesthetic: '',
      subject_treatment: '',
      color_and_tone: '',
      lighting_and_shadow: '',
      texture_and_material: '',
      camera_and_composition: '',
      atmosphere_and_mood: '',
      rendering_and_quality: '',
    },
  })),
}));

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1024);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(720);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.mocked(loadStylePresetCatalogSearchIndex).mockResolvedValue(
    createStylePresetCatalogSearchIndexFromRuntimePacks(packs),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PagedStyleCatalog', () => {
  it.each([false, true])('loads and mounts only nearby cards (grouped: %s)', async (grouped) => {
    const loadPacks = vi.fn();
    function Catalog({ query = '' }: { query?: string }) {
      const [loadedPacks, setLoadedPacks] = useState<Record<string, StyleRuntimePack>>({});
      loadPacks.mockImplementation(async (ids: string[]) => {
        const loaded = packs.filter((pack) => ids.includes(pack.id));
        setLoadedPacks((current) => ({
          ...current,
          ...Object.fromEntries(loaded.map((pack) => [pack.id, pack])),
        }));
        return loaded;
      });
      return (
        <PagedStyleCatalog
          query={query}
          sortOrder="source"
          favorites={[]}
          favoritesOnly={false}
          extraIndex={null}
          loadedPacks={loadedPacks}
          loadPacks={loadPacks}
          renderCard={(preset) => (
            <button key={preset.id} data-testid="style-card">
              {preset.id}
            </button>
          )}
          columns={4}
          grouped={grouped}
          onWidthChange={vi.fn()}
        />
      );
    }
    const view = render(<Catalog />);
    await waitFor(() => expect(screen.queryByText('pack_01-0')).not.toBeNull());
    expect(screen.getAllByTestId('style-card').length).toBeLessThan(40);
    expect(loadPacks).toHaveBeenCalledWith(['pack_01']);
    expect(loadPacks).not.toHaveBeenCalledWith(expect.arrayContaining(['pack_02']));

    const scroll = view.container.querySelector<HTMLDivElement>('.paged-style-catalog-scroll')!;
    scroll.scrollTop = 32000;
    fireEvent.scroll(scroll);
    await waitFor(() => expect(loadPacks).toHaveBeenCalledWith(['pack_02']));
    await waitFor(() => expect(screen.queryByText('pack_02-199')).not.toBeNull());
    expect(screen.queryByText('pack_01-0')).toBeNull();
    expect(screen.getAllByTestId('style-card').length).toBeLessThan(40);

    view.rerender(<Catalog query="pack_01 0" />);
    await waitFor(() => expect(screen.queryByText('pack_01-0')).not.toBeNull());
    expect(scroll.scrollTop).toBe(0);
    expect(screen.getAllByTestId('style-card')).toHaveLength(1);
  });
});
