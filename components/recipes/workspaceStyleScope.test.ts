import { describe, expect, it } from 'vitest';

import {
  createWorkspaceStyleCollection,
  setStyleCategoryLinked,
  setStylePackLinked,
  suggestWorkspaceProjectPacks,
} from './workspaceStyleScope';

describe('workspaceStyleScope', () => {
  it('suggests project packs by name and edits pack and category links', () => {
    const packs = [
      { id: 'pack_35', name: 'Black Flag', project: { name: 'Black Flag' } },
      { id: 'pack_36', name: 'Moklos Jam', project: { name: 'Moklos' } },
      { id: 'pack_01', name: 'Photography' },
    ];
    expect(suggestWorkspaceProjectPacks('Black Flag biomas', packs).map((p) => p.id)).toEqual([
      'pack_35',
    ]);
    expect(suggestWorkspaceProjectPacks('MOKLOS The Game', packs).map((p) => p.id)).toEqual([
      'pack_36',
    ]);
    expect(suggestWorkspaceProjectPacks('Flagstone', packs)).toEqual([]);

    const categories = ['1. Biomes', '2. Characters'];
    const single = { packId: 'pack_35', presetId: 'SP35-009' };
    const whole = setStylePackLinked([single], 'pack_35', true);
    expect(whole).toEqual([single, { packId: 'pack_35' }]);
    const narrowed = setStyleCategoryLinked(whole, 'pack_35', categories, '1. Biomes', false);
    expect(narrowed).toEqual([single, { packId: 'pack_35', category: '2. Characters' }]);
    expect(setStyleCategoryLinked(narrowed, 'pack_35', categories, '1. Biomes', true)).toEqual(
      whole,
    );

    expect(createWorkspaceStyleCollection([], { title: 'T', description: 'D' })).toBeNull();
    expect(
      createWorkspaceStyleCollection(narrowed, { title: 'T', description: 'D' })?.entries.map(
        (entry) => [entry.kind, entry.categoryName ?? entry.presetId],
      ),
    ).toEqual([
      ['preset', 'SP35-009'],
      ['category', '2. Characters'],
    ]);
  });
});
