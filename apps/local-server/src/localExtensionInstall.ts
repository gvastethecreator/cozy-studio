import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import type { Handler } from 'hono';
import JSZip from 'jszip';
import studioPackage from '../../../package.json';
import {
  composeStyleRuntimePacksFromManifests,
  createStylePackManifests,
  createStylePresetManifests,
  createStylePresetCatalogSearchIndexFromRuntimePacks,
  validateStyleManifestGraph,
} from '../../../components/recipes/stylePresetManifests';
import type {
  StylePackManifest,
  StylePresetManifest,
} from '../../../components/recipes/styles/manifestTypes';
import type { StyleRuntimePack } from '../../../components/recipes/styles/runtimeTypes';
import { validateSnapshot } from '../../../packages/shared/src/styles/intentional-v1/validation';
import { FIELDS } from '../../../packages/shared/src/styles/intentional-v1/types';
import {
  parseExtensionManifest,
  parseExtensionReleaseIndex,
  parseStylePackPreview,
} from '../../../packages/shared/src/extensions';
import { ExtensionInstallError, installExtensionArchive } from './extensionInstaller';
import type { ExtensionStore } from './extensionStore';

const { satisfies } = createRequire(import.meta.url)('semver') as {
  satisfies: (version: string, range: string) => boolean;
};
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const LOCAL_EXTENSION_BODY_LIMIT = Math.ceil((MAX_ARCHIVE_BYTES * 4) / 3) + 64 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;

function reject(message: string): never {
  throw new ExtensionInstallError(message);
}

function safePath(name: string) {
  return (
    name.length > 0 &&
    !name.startsWith('/') &&
    !/[\\:\0]/.test(name) &&
    !name.split('/').some((part) => part === '..' || part === '.')
  );
}

/** Counts actual inflated chunks, so forged ZIP size metadata cannot bypass the limit. */
function readBounded(file: JSZip.JSZipObject, limit: number): Promise<Buffer> {
  return new Promise((resolve, rejectRead) => {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const stream = file.nodeStream();
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > limit) {
        stream.pause();
        rejectRead(new ExtensionInstallError('Expanded archive exceeds the size limit'));
      } else chunks.push(chunk);
    });
    stream.on('error', rejectRead);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.resume();
  });
}

async function validateContents(archive: Buffer, entry: { id: string; version: string }) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archive);
  } catch {
    reject('Invalid ZIP archive');
  }
  const files = Object.values(zip.files);
  if (files.length > 10_000) reject('Archive has too many entries');
  for (const file of files) {
    if (!safePath(file.name) || !safePath(file.unsafeOriginalName ?? file.name))
      reject('Archive entry escapes the extension folder');
    if (file.unixPermissions && (Number(file.unixPermissions) & 0o170000) === 0o120000)
      reject('Archive cannot contain symbolic links');
  }
  const manifestFile = zip.file('extension.json');
  if (!manifestFile) reject('Archive has no extension.json');
  const parsed = parseExtensionManifest(
    JSON.parse((await readBounded(manifestFile, 8 * 1024 * 1024)).toString('utf8')),
  );
  if (!parsed.ok) reject(parsed.issues.join('; '));
  const manifest = parsed.manifest;
  if (
    manifest.kind !== 'style-pack' ||
    manifest.id !== entry.id ||
    manifest.version !== entry.version
  )
    reject('Archive does not match the style-pack entry');
  if (!satisfies(studioPackage.version, manifest.studio))
    reject(
      `Style pack requires Studio ${manifest.studio}; current version is ${studioPackage.version}`,
    );
  const jsonPaths = new Set(['extension.json', ...Object.values(manifest.files)]);
  const json = new Map<string, unknown>();
  const hashes = new Map<string, string>();
  let expandedBytes = 0;
  for (const file of files) {
    if (file.dir) {
      if (!['cards/', 'thumbnails/'].includes(file.name)) reject('Unsupported archive directory');
      continue;
    }
    const isJson = jsonPaths.has(file.name) && file.name.endsWith('.json');
    if (
      !isJson &&
      !/^(cards|thumbnails)\/[a-zA-Z0-9._-]+\.(webp|png|jpg|jpeg|avif)$/.test(file.name)
    )
      reject(`Archive must contain style data only: ${file.name}`);
    const bytes = await readBounded(
      file,
      Math.min(isJson ? 8 * 1024 * 1024 : 32 * 1024 * 1024, MAX_EXPANDED_BYTES - expandedBytes),
    );
    expandedBytes += bytes.byteLength;
    if (isJson) {
      json.set(file.name, JSON.parse(bytes.toString('utf8')));
      hashes.set(file.name, createHash('sha256').update(bytes).digest('hex'));
    }
  }
  for (const name of jsonPaths) if (!json.has(name)) reject(`Missing style-pack file: ${name}`);
  const payload = json.get(manifest.files.pack) as {
    packManifest: StylePackManifest;
    presetManifests: StylePresetManifest[];
  };
  if (!payload?.packManifest || !Array.isArray(payload.presetManifests))
    reject('Invalid pack payload');
  const graph = validateStyleManifestGraph([payload.packManifest], payload.presetManifests);
  if (!graph.valid) reject(graph.errors.slice(0, 10).join('; '));
  const expected = composeStyleRuntimePacksFromManifests(
    [payload.packManifest],
    payload.presetManifests,
  )[0];
  const runtime = json.get(manifest.files.runtime) as StyleRuntimePack;
  if (
    expected.id !== manifest.stylePack.id ||
    !expected.presets.length ||
    expected.presets.length !== manifest.stylePack.presetCount ||
    runtime?.id !== expected.id ||
    runtime.name !== expected.name ||
    runtime.description !== expected.description ||
    !Array.isArray(runtime.presets) ||
    runtime.presets.length !== expected.presets.length
  )
    reject('Style pack must contain usable presets and matching runtime data');
  const presetVersions = new Map(payload.presetManifests.map((preset) => [preset.id, preset.version]));
  for (const [index, preset] of runtime.presets.entries()) {
    const { intentional, ...data } = preset;
    const { intentional: sourcePolicy, ...source } = expected.presets[index];
    if (
      !isDeepStrictEqual(data, source) ||
      (sourcePolicy && !isDeepStrictEqual(intentional, sourcePolicy))
    )
      reject('Runtime preset does not match its source manifest');
    if (intentional) {
      if (intentional.presetVersion !== presetVersions.get(preset.id))
        reject('Runtime intentional policy does not match its preset version');
      try {
        validateSnapshot({
          presetId: preset.id,
          packId: runtime.id,
          version: intentional.presetVersion,
          name: preset.name,
          dna: Object.fromEntries(FIELDS.map((field) => [field, preset.style[field]])),
          policy: intentional.policy,
        });
      } catch {
        reject('Invalid runtime intentional policy');
      }
    }
  }
  const expectedSearch = createStylePresetCatalogSearchIndexFromRuntimePacks([runtime], {
    includeStyleText: false,
  });
  if (
    !isDeepStrictEqual(json.get(manifest.files.search), JSON.parse(JSON.stringify(expectedSearch)))
  )
    reject('Search references do not match runtime presets');
  if (manifest.files.archived) {
    const archived = json.get(manifest.files.archived) as {
      packName: string;
      presets: StyleRuntimePack['presets'];
    };
    if (typeof archived?.packName !== 'string' || !Array.isArray(archived.presets))
      reject('Invalid archived presets');
    const archivedPack = { ...expected, name: archived.packName, presets: archived.presets };
    const archivedGraph = validateStyleManifestGraph(
      createStylePackManifests([archivedPack]),
      createStylePresetManifests([archivedPack]),
    );
    if (!archivedGraph.valid) reject(archivedGraph.errors.slice(0, 10).join('; '));
    for (const preset of archived.presets) {
      if (!preset.intentional) continue;
      try {
        validateSnapshot({
          presetId: preset.id, packId: runtime.id, version: preset.intentional.presetVersion,
          name: preset.name, dna: Object.fromEntries(FIELDS.map((field) => [field, preset.style[field]])),
          policy: preset.intentional.policy,
        });
      } catch { reject('Invalid archived intentional policy'); }
    }
    const allIds = [...runtime.presets, ...archived.presets].map((preset) => preset.id);
    if (new Set(allIds).size !== allIds.length)
      reject('Archived presets duplicate runtime presets');
  }
  const thumbnails = json.get(manifest.files.thumbnails);
  if (!thumbnails || typeof thumbnails !== 'object' || Array.isArray(thumbnails))
    reject('Invalid thumbnails');
  const imageExists = (value: unknown) =>
    typeof value === 'string' &&
    /^(cards|thumbnails)\//.test(value) &&
    safePath(value) &&
    zip.file(value) !== null;
  if (!Object.values(thumbnails).every(imageExists)) reject('Missing thumbnail image');
  if (manifest.files.preview) {
    const preview = parseStylePackPreview(json.get(manifest.files.preview));
    if (
      !preview ||
      (preview.cover && !imageExists(preview.cover)) ||
      preview.samples.some((sample) => !imageExists(sample.image))
    )
      reject('Invalid preview references');
  }
  return { manifest, runtimeSha256: hashes.get(manifest.files.runtime)! };
}

export function createLocalExtensionInstallHandler(
  store: ExtensionStore,
  installDir: string,
): Handler {
  return async (c) => {
    try {
      const body = await c.req.json();
      const parsed = parseExtensionReleaseIndex({ schemaVersion: 1, extensions: [body?.entry] });
      if (!parsed.ok) reject(parsed.issues.join('; '));
      const entry = parsed.index.extensions[0];
      if (
        entry.bytes > MAX_ARCHIVE_BYTES ||
        typeof body.archiveBase64 !== 'string' ||
        body.archiveBase64.length > Math.ceil((MAX_ARCHIVE_BYTES * 4) / 3) ||
        body.archiveBase64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(body.archiveBase64)
      )
        reject('Invalid archiveBase64 or archive size');
      const archive = Buffer.from(body.archiveBase64, 'base64');
      if (
        archive.byteLength !== entry.bytes ||
        createHash('sha256').update(archive).digest('hex') !== entry.sha256
      )
        reject('Archive bytes or sha256 mismatch');
      const checked = await validateContents(archive, entry);
      let installedLayers: string[] = [];
      try {
        const extension = await installExtensionArchive({ archive, entry, installDir,
          validateInstalled: async () => {
            const installed = (await store.list({ refresh: true })).extensions.find((item) => item.manifest.id === entry.id);
            if (!installed || path.resolve(installed.root) !== path.resolve(installDir, entry.id) ||
                !isDeepStrictEqual(installed.manifest, checked.manifest)) reject('Installed extension does not match its archive');
            const runtime = await store.readFile(entry.id, checked.manifest.files.runtime);
            if (!runtime || createHash('sha256').update(runtime).digest('hex') !== checked.runtimeSha256)
              reject('Installed runtime does not match its archive');
            installedLayers = installed.layers;
          },
        });
        return c.json({ extension, installedLayers });
      } catch (error) {
        await store.list({ refresh: true }).catch((refreshError) => {
          console.warn('[extensions:install] Catalog refresh failed after rollback', refreshError);
        });
        throw error;
      }
    } catch (error) {
      const invalid =
        error instanceof ExtensionInstallError ||
        error instanceof SyntaxError ||
        error instanceof TypeError;
      return c.json(
        { error: error instanceof Error ? error.message : 'Local install failed' },
        invalid ? 422 : 500,
      );
    }
  };
}
