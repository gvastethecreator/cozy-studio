import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import {
  composeStyleRuntimePacksFromManifests,
  createStylePackManifests,
  createStylePresetManifests,
  createStylePresetCatalogSearchIndexFromRuntimePacks,
} from '../../../components/recipes/stylePresetManifests';
import type { StyleRuntimePack } from '../../../components/recipes/styles/runtimeTypes';
import { createExtensionRoutes } from './extensionRoutes';
import { createExtensionStore } from './extensionStore';
import type { ExtensionSourceClient } from './extensionSources';

let installDir = '';
afterEach(async () => {
  if (installDir) await rm(installDir, { recursive: true, force: true });
});

async function archive(
  name: string,
  modify?: (files: Record<string, unknown>, zip: JSZip) => void,
) {
  const seed: StyleRuntimePack = {
    id: 'pack_14',
    name,
    description: 'A focused style pack.',
    presets: [
      {
        id: 'SP14-001',
        name: 'Sculptural Light',
        category: 'Portraits',
        negativePrompt: 'text, watermark',
        style: {
          aesthetic: 'sculptural realism',
          subject_treatment: 'carved contours',
          color_and_tone: 'cool hues',
          lighting_and_shadow: 'hard side light',
          texture_and_material: 'cut glass',
          camera_and_composition: 'centered portrait',
          atmosphere_and_mood: 'quiet tension',
          rendering_and_quality: 'precise material detail',
        },
      },
    ],
  };
  const packs = createStylePackManifests([seed]);
  const presets = createStylePresetManifests([seed]);
  const runtime = composeStyleRuntimePacksFromManifests(packs, presets)[0];
  const manifest = {
    schemaVersion: 1,
    id: 'cozy.pack-14',
    kind: 'style-pack',
    version: '1.0.0',
    studio: '>=0.0.0',
    title: name,
    files: {
      pack: 'pack.json',
      runtime: 'runtime.json',
      search: 'search.json',
      thumbnails: 'thumbnails.json',
    },
    stylePack: { id: seed.id, name, description: seed.description, presetCount: 1 },
    assets: [],
  };
  const files: Record<string, unknown> = {
    'extension.json': manifest,
    'pack.json': { packManifest: packs[0], presetManifests: presets },
    'runtime.json': runtime,
    'search.json': createStylePresetCatalogSearchIndexFromRuntimePacks([runtime], {
      includeStyleText: false,
    }),
    'thumbnails.json': {},
  };
  const zip = new JSZip();
  modify?.(files, zip);
  for (const [file, value] of Object.entries(files)) zip.file(file, JSON.stringify(value));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    archiveBase64: bytes.toString('base64'),
    entry: {
      id: manifest.id,
      version: manifest.version,
      title: name,
      tag: 'local',
      archive: 'local.zip',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
    },
  };
}

async function setup() {
  installDir = await mkdtemp(path.join(tmpdir(), 'cozy-local-install-'));
  const store = createExtensionStore([installDir]);
  const routes = createExtensionRoutes({
    store,
    remote: {
      installDir,
      sources: [],
      client: {} as ExtensionSourceClient,
    },
  });
  const install = (body: unknown) =>
    routes.request('/install-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { routes, install };
}

describe('local style-pack install', () => {
  it('installs without cards and replaces same-version content through the existing file route', async () => {
    const { routes, install } = await setup();
    const first = await install(await archive('First Pack'));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      extension: { id: 'cozy.pack-14' },
      installedLayers: [],
    });
    const updated = await install(
      await archive('Updated Pack', (files, zip) => {
        zip.file('cards/SP14-001.webp', 'existing card');
        zip.file('thumbnails/SP14-001.webp', 'existing thumbnail');
        files['thumbnails.json'] = { 'SP14-001': 'thumbnails/SP14-001.webp' };
      }),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ installedLayers: ['cards'] });
    const runtime = await routes.request('/cozy.pack-14/files/runtime.json');
    expect(runtime.status).toBe(200);
    expect(await runtime.json()).toMatchObject({
      name: 'Updated Pack',
      presets: [{ id: 'SP14-001' }],
    });
  });

  it('rejects unsafe, incompatible and semantically invalid archives before changing the installed copy', async () => {
    const { routes, install } = await setup();
    expect((await install(await archive('Preserved Pack'))).status).toBe(200);
    const invalid = [
      await archive('Invalid', (_, zip) => {
        zip.file('../outside.json', '{}');
      }),
      await archive('Invalid', (_, zip) => {
        zip.file('execute.js', 'throw Error()');
      }),
      await archive('Invalid', (files) => {
        (files['extension.json'] as { studio: string }).studio = '>=9.0.0';
      }),
      await archive('Invalid', (files) => {
        delete files['runtime.json'];
      }),
      await archive('Invalid', (files) => {
        (files['runtime.json'] as { presets: unknown[] }).presets = [];
      }),
      await archive('Invalid', (files) => {
        (
          files['pack.json'] as { packManifest: { presetRefs: string[] } }
        ).packManifest.presetRefs.push('pack_14/missing.yaml');
      }),
      await archive('Invalid', (files) => {
        (files['search.json'] as { presets: { ref: string }[] }).presets[0].ref =
          'pack_14/missing.yaml';
      }),
      await archive('Invalid', (files) => {
        files['thumbnails.json'] = { 'SP14-001': 'thumbnails/missing.webp' };
      }),
      await archive('Invalid', (files) => {
        (files['extension.json'] as { files: Record<string, string> }).files.archived =
          'archived.json';
        files['archived.json'] = {};
      }),
      await archive('Invalid', (_, zip) => {
        zip.file('cards/oversized.webp', Buffer.alloc(32 * 1024 * 1024 + 1));
      }),
    ];
    const traversal = await archive('Invalid');
    traversal.entry.id = '../outside';
    invalid.push(traversal);
    for (const body of invalid) {
      const rejected = await install(body);
      expect(rejected.status, JSON.stringify(await rejected.json())).toBe(422);
      const content = await routes.request('/cozy.pack-14/files/runtime.json');
      expect(await content.json()).toMatchObject({ name: 'Preserved Pack' });
    }
  });
});
