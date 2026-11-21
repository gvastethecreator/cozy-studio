import { describe, expect, it } from 'vitest';
import { parseExtensionManifest } from './extensions';

const valid = {
  schemaVersion: 1,
  id: 'cozy.mythic-noir',
  kind: 'style-pack',
  version: '1.4.0',
  studio: '>=0.9 <2',
  title: 'Mythic Noir Curated Vault',
  files: {
    pack: 'pack.json',
    runtime: 'runtime.json',
    search: 'search.json',
    thumbnails: 'thumbnails.json',
  },
  stylePack: { id: 'pack_14', name: 'Mythic Noir', description: 'Myths.', presetCount: 197 },
  assets: [{ name: 'cards-full', optional: true, sha256: 'a'.repeat(64), bytes: 10 }],
};

describe('parseExtensionManifest', () => {
  it('accepts a style-pack manifest', () => {
    const result = parseExtensionManifest(valid);
    expect(result.ok).toBe(true);
    const project = { ...valid.stylePack, project: { name: 'Black Flag' } };
    expect(parseExtensionManifest({ ...valid, stylePack: project }).ok).toBe(true);
  });

  it('rejects unsafe paths, bad ids and unverifiable assets', () => {
    const result = parseExtensionManifest({
      ...valid,
      id: 'Mythic',
      files: { ...valid.files, pack: '../pack.json' },
      stylePack: { ...valid.stylePack, project: { name: ' ' } },
      assets: [{ name: 'cards-full', optional: true, sha256: 'nope', bytes: 10 }],
    });
    expect(result).toEqual({
      ok: false,
      issues: [
        'id must be a lowercase publisher.name',
        'files.pack must be a relative path',
        'stylePack.project needs a name',
        'assets[0] needs name, optional, sha256 and bytes',
      ],
    });
  });
});
