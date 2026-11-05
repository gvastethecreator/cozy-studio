import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Database } from 'bun:sqlite';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CATALOG_PURGE_CONFIRMATION, type CatalogImage } from '../../../packages/shared/src';
import { updateCatalogImageFileSize } from './catalog';
import { createCatalogRoutes } from './catalogRoutes';
import { createCatalogCommands } from './catalogCommands';
import {
  createDefaultCatalogStore,
  type QueryCatalogFilters,
  type StudioCatalogStore,
} from './catalogStore';
import { recordCatalogTagUse } from './catalogTags';
import { addImageToNamedCollection } from './catalogCollections';
import { openTestDatabase } from './db/testDatabase';
import { createWorkspaceInDb } from './db/workspaces';
import { embedMetadata, extractMetadata } from './metadataEmbedder';
import { createContainingFolderOpener } from './openContainingFolder';
import { EventEmitter } from 'node:events';
import type { spawn as spawnFn, ChildProcess } from 'node:child_process';

const testDb = vi.hoisted(() => ({ current: undefined as Database | undefined }));
vi.mock('./db/connection', () => ({ getDb: (db?: Database) => db ?? testDb.current }));

let libraryDir: string;
beforeEach(() => {
  libraryDir = mkdtempSync(path.join(os.tmpdir(), 'studio-catalog-routes-'));
  testDb.current = openTestDatabase();
  const createdAt = '2026-05-26T00:00:00.000Z';
  testDb.current
    .query(
      'INSERT INTO libraries (id, name, path, is_default, created_at, kind) VALUES (?, ?, ?, 1, ?, ?)',
    )
    .run('library-1', 'Test library', libraryDir, createdAt, 'library');
  testDb.current
    .query(
      `INSERT INTO jobs (id, kind, status, original_prompt, final_prompt_used, created_at, updated_at)
       VALUES ('job-1', 'image_generate', 'completed', '', '', ?, ?)`,
    )
    .run(createdAt, createdAt);
});
afterEach(() => {
  testDb.current = undefined;
  rmSync(libraryDir, { recursive: true, force: true });
});

function catalogImage(overrides: Partial<CatalogImage> = {}): CatalogImage {
  return {
    id: overrides.id ?? 'image-1',
    libraryId: overrides.libraryId ?? 'library-1',
    // Inside the temp library: trash, restore and purge move or delete real files.
    filePath: overrides.filePath ?? path.join(libraryDir, 'outputs', 'image-1.png'),
    thumbnailPath: overrides.thumbnailPath ?? null,
    publicUrl: overrides.publicUrl ?? '/library/outputs/image-1.png',
    thumbnailUrl: overrides.thumbnailUrl ?? null,
    prompt: overrides.prompt ?? 'prompt',
    negativePrompt: overrides.negativePrompt ?? null,
    aspectRatio: overrides.aspectRatio ?? '1:1',
    imageSize: overrides.imageSize ?? '1024x1024',
    width: overrides.width ?? null,
    height: overrides.height ?? null,
    mimeType: overrides.mimeType ?? 'image/png',
    fileSizeBytes: overrides.fileSizeBytes ?? null,
    jobId: overrides.jobId ?? null,
    workspaceId: overrides.workspaceId ?? null,
    batchId: overrides.batchId ?? null,
    recipeId: overrides.recipeId ?? null,
    isFavorite: overrides.isFavorite ?? false,
    isDeleted: overrides.isDeleted ?? false,
    deletedAt: overrides.deletedAt ?? null,
    tags: overrides.tags ?? [],
    generationConfig: overrides.generationConfig ?? null,
    createdAt: overrides.createdAt ?? '2026-05-26T00:00:00.000Z',
  };
}

/** Seeds rows as registerCatalogImage writes them, but keeps each fixture's id. */
async function createStore(
  images: CatalogImage[],
  onQuery?: (filters: QueryCatalogFilters | undefined) => void,
): Promise<StudioCatalogStore> {
  const insert = testDb.current!.query(`INSERT INTO catalog_images (
    id, library_id, file_path, thumbnail_path, public_url, thumbnail_url, prompt, negative_prompt,
    aspect_ratio, image_size, width, height, mime_type, file_size_bytes, job_id, workspace_id,
    batch_id, recipe_id, is_favorite, is_deleted, deleted_at, tags, generation_config, created_at
  ) VALUES (${Array(24).fill('?').join(', ')})`);
  for (const image of images) {
    insert.run(
      image.id,
      image.libraryId,
      image.filePath,
      image.thumbnailPath,
      image.publicUrl,
      image.thumbnailUrl,
      image.prompt,
      image.negativePrompt,
      image.aspectRatio,
      image.imageSize,
      image.width,
      image.height,
      image.mimeType,
      image.fileSizeBytes,
      image.jobId,
      image.workspaceId,
      image.batchId,
      image.recipeId,
      image.isFavorite ? 1 : 0,
      image.isDeleted ? 1 : 0,
      image.deletedAt,
      JSON.stringify(image.tags),
      image.generationConfig === null ? null : JSON.stringify(image.generationConfig),
      image.createdAt,
    );
    recordCatalogTagUse(image.workspaceId ?? 'default', image.tags);
  }
  const store = await createDefaultCatalogStore();
  if (!onQuery) return store;
  return {
    ...store,
    queryCatalog: (filters) => {
      onQuery(filters);
      return store.queryCatalog(filters);
    },
  };
}

function createRoutes(
  store: StudioCatalogStore,
  embed: typeof embedMetadata = async (filePath: string) => ({
    filePath,
    bytesWritten: 0,
    format: 'png' as const,
  }),
  openFolder?: (filePath: string) => Promise<void>,
) {
  return createCatalogRoutes({
    catalogStore: store,
    catalogCommands: createCatalogCommands({
      listCatalogImageIds: (...args) => store.listCatalogImageIds(...args),
      updateCatalogImage: (...args) => store.updateCatalogImage(...args),
      softDeleteCatalogImage: (...args) => store.softDeleteCatalogImage(...args),
      restoreCatalogImage: (...args) => store.restoreCatalogImage(...args),
      purgeCatalogImage: (...args) => store.purgeCatalogImage(...args),
      publishEvent: () => {},
    }),
    embedMetadata: embed,
    getJob: () => null,
    updateCatalogImageFileSize,
    openContainingFolder: openFolder,
  });
}

describe('catalog routes', () => {
  it('opens only a live registered image folder from an explicit local browser request', async () => {
    const filePath = path.join(libraryDir, 'image & data.png');
    writeFileSync(filePath, 'image');
    const store = await createStore([
      catalogImage({ id: 'local', filePath }),
      catalogImage({ id: 'missing', filePath: path.join(libraryDir, 'missing.png') }),
      catalogImage({ id: 'outside', filePath: path.join(libraryDir, '..', 'outside.png') }),
      catalogImage({ id: 'deleted', filePath, isDeleted: true }),
    ]);
    const openFolder = vi.fn(async (_filePath: string) => {});
    const routes = createRoutes(store, undefined, openFolder);
    const headers = { Origin: 'http://localhost:17222', 'X-Requested-With': 'CozyStudio' };
    expect((await routes.request('/local/open-folder', { method: 'POST', headers })).status).toBe(
      200,
    );
    expect(openFolder).toHaveBeenCalledExactlyOnceWith(filePath);
    for (const requestHeaders of [
      undefined,
      { ...headers, Origin: 'https://studio.example' },
      { Origin: headers.Origin },
    ]) {
      expect(
        (await routes.request('/local/open-folder', { method: 'POST', headers: requestHeaders }))
          .status,
      ).toBe(403);
    }
    for (const id of ['missing', 'deleted', 'unknown']) {
      expect((await routes.request(`/${id}/open-folder`, { method: 'POST', headers })).status).toBe(
        404,
      );
    }
    expect((await routes.request('/outside/open-folder', { method: 'POST', headers })).status).toBe(
      400,
    );
    expect(openFolder).toHaveBeenCalledTimes(1);
    openFolder.mockRejectedValueOnce(new Error('Not installed'));
    expect((await routes.request('/local/open-folder', { method: 'POST', headers })).status).toBe(
      500,
    );
  });

  it('passes containing folders as one shell-free argument on each supported OS', async () => {
    for (const [platform, filePath, command, folderPath] of [
      ['win32', 'C:\\Studio & data\\image.png', 'explorer.exe', 'C:\\Studio & data'],
      ['darwin', '/Studio & data/image.png', 'open', '/Studio & data'],
      ['linux', '/Studio & data/image.png', 'xdg-open', '/Studio & data'],
    ] as const) {
      const spawn = vi.fn(() => {
        const child = new EventEmitter() as ChildProcess;
        child.unref = vi.fn();
        queueMicrotask(() => child.emit('spawn'));
        return child;
      });
      await createContainingFolderOpener({
        platform,
        spawnProcess: spawn as unknown as typeof spawnFn,
      })(filePath);
      expect(spawn).toHaveBeenCalledExactlyOnceWith(command, [folderPath], {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
      });
    }
    const failedSpawn = vi.fn(() => {
      const child = new EventEmitter() as ChildProcess;
      queueMicrotask(() => child.emit('error', new Error('File manager unavailable')));
      return child;
    });
    await expect(
      createContainingFolderOpener({
        platform: 'linux',
        spawnProcess: failedSpawn as unknown as typeof spawnFn,
      })('/Studio/image.png'),
    ).rejects.toThrow('File manager unavailable');
  });

  it('evaluates smart rules live, narrows them with request filters and rejects manual membership', async () => {
    const other = createWorkspaceInDb(testDb.current!, { name: 'Other' });
    const config = {
      providerId: 'chatgpt',
      recipeParams: {
        presetId: 'ink',
        presetName: 'Ink',
        selectedStyles: [{ presetId: 'ink', presetName: 'Ink' }],
      },
    };
    const store = await createStore([
      catalogImage({
        id: 'alpha',
        workspaceId: 'default',
        prompt: 'Alpha castle',
        tags: ['boss'],
        isFavorite: true,
        generationConfig: config,
        createdAt: '2026-11-01T00:00:00.000Z',
      }),
      catalogImage({
        id: 'beta',
        workspaceId: 'default',
        prompt: 'Beta castle',
        isFavorite: true,
        generationConfig: config,
        createdAt: '2026-11-02T00:00:00.000Z',
      }),
      catalogImage({
        id: 'job',
        workspaceId: 'default',
        prompt: 'Alpha castle',
        jobId: 'job-1',
        generationConfig: config,
        recipeId: 'character-lab',
      }),
      catalogImage({
        id: 'outside',
        workspaceId: other.id,
        generationConfig: {
          providerId: 'outside-only',
          recipeParams: { presetId: 'outside-style' },
        },
      }),
      catalogImage({
        id: 'archived',
        workspaceId: 'default',
        isDeleted: true,
        generationConfig: { providerId: 'archived-only' },
      }),
    ]);
    testDb.current!.query("UPDATE jobs SET provider_id = 'codex' WHERE id = 'job-1'").run();
    const routes = createRoutes(store);
    const send = (method: string, url: string, body: unknown) =>
      routes.request(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const rule = {
      q: 'castle',
      favorite: true,
      providerId: 'chatgpt',
      recipeId: 'default',
      stylePresetId: 'ink',
      createdFrom: '2026-11-01T00:00:00.000Z',
      createdTo: '2026-11-03T00:00:00.000Z',
    };
    const created = await send('POST', '/collections', {
      workspaceId: 'default',
      name: 'Live picks',
      rule,
    });
    expect(created.status).toBe(201);
    const smart = await created.json();
    expect(smart).toMatchObject({ kind: 'smart', rule, imageCount: 2 });
    const page = async (query = '') =>
      (await routes.request(`/?workspace_id=default&collection_id=${smart.id}${query}`)).json();
    expect((await page('&q=Alpha')).images.map((image: CatalogImage) => image.id)).toEqual([
      'alpha',
    ]);
    expect((await page('&q=%23boss')).total).toBe(1);
    expect((await page('&q=absent')).total).toBe(0);
    expect(
      (await (await routes.request(`/?workspace_id=${other.id}&collection_id=${smart.id}`)).json())
        .total,
    ).toBe(0);
    const facets = await (await routes.request('/facets?workspace_id=default')).json();
    expect(facets).toEqual({
      providers: [
        { id: 'chatgpt', count: 2 },
        { id: 'codex', count: 1 },
      ],
      recipes: [
        { id: 'character-lab', count: 1 },
        { id: 'default', count: 2 },
      ],
      styles: [{ presetId: 'ink', name: 'Ink', count: 3 }],
    });
    expect((await routes.request('/facets')).status).toBe(400);
    expect(
      (await send('POST', '/collections/selection', { workspaceId: 'default', imageIds: ['beta'] }))
        .status,
    ).toBe(200);
    expect(
      await (
        await send('POST', '/collections/selection', { workspaceId: 'default', imageIds: ['beta'] })
      ).json(),
    ).toEqual([]);
    const snapshot = () =>
      testDb.current!.query('SELECT tags FROM catalog_images ORDER BY id').all();
    const before = snapshot();
    for (const action of ['addToCollection', 'removeFromCollection']) {
      expect(
        (
          await send('POST', '/commands/organize', {
            source: 'ui',
            workspaceId: 'default',
            imageIds: ['beta'],
            addTags: ['new'],
            [action]: smart.name,
          })
        ).status,
      ).toBe(400);
    }
    for (const patch of [{ addImageIds: ['beta'] }, { removeImageIds: ['beta'] }])
      expect((await send('PATCH', `/collections/${smart.id}`, patch)).status).toBe(400);
    expect(
      (
        await send('POST', '/collections', {
          workspaceId: 'default',
          name: 'Invalid members',
          rule,
          imageIds: ['beta'],
        })
      ).status,
    ).toBe(400);
    expect(snapshot()).toEqual(before);
    addImageToNamedCollection(testDb.current!, {
      imageId: 'beta',
      workspaceId: 'default',
      name: smart.name,
      timestamp: new Date().toISOString(),
    });
    expect(testDb.current!.query('SELECT * FROM catalog_collection_images').all()).toEqual([]);
    expect((await page('&unorganized=true')).images.map((image: CatalogImage) => image.id)).toEqual(
      ['beta'],
    );
    await send('PATCH', '/beta', { isFavorite: false });
    expect((await page()).total).toBe(1);
    expect(
      (await (await routes.request('/collections?workspace_id=default')).json())[0].imageCount,
    ).toBe(1);
    const edited = await send('PATCH', `/collections/${smart.id}`, {
      rule: { favorite: false, providerId: 'chatgpt' },
      emoji: '⭐',
      name: 'Unpicked',
    });
    expect(await edited.json()).toMatchObject({
      kind: 'smart',
      name: 'Unpicked',
      emoji: '⭐',
      imageCount: 1,
    });
    const manual = await (
      await send('POST', '/collections', { workspaceId: 'default', name: 'Manual' })
    ).json();
    expect(
      (await send('PATCH', `/collections/${manual.id}`, { rule: { favorite: true } })).status,
    ).toBe(400);
    expect(
      (
        await send('PATCH', `/collections/${smart.id}`, {
          rule: { createdTo: '2026-11-02T00:00:00.000Z' },
        })
      ).status,
    ).toBe(200);
    expect((await page()).images.map((image: CatalogImage) => image.id).sort()).toEqual([
      'alpha',
      'job',
    ]);
    const realNow = Date.now;
    Date.now = () => Date.parse('2026-11-03T00:00:00.000Z');
    try {
      await send('PATCH', `/collections/${smart.id}`, { rule: { withinDays: 1 } });
      expect((await page()).images.map((image: CatalogImage) => image.id)).toEqual(['beta']);
      Date.now = () => Date.parse('2026-11-04T00:00:00.000Z');
      expect((await page()).total).toBe(0);
    } finally {
      Date.now = realNow;
    }
    testDb
      .current!.query('UPDATE catalog_images SET created_at = ? WHERE id = ?')
      .run('2026-11-01T00:00:00Z', 'beta');
    await send('PATCH', `/collections/${smart.id}`, {
      rule: { providerId: 'chatgpt', createdTo: '2026-11-01T00:00:00.001Z' },
    });
    expect((await page()).images.map((image: CatalogImage) => image.id).sort()).toEqual([
      'alpha',
      'beta',
    ]);
    await send('PATCH', `/collections/${smart.id}`, {
      rule: { providerId: 'chatgpt', createdFrom: '2026-11-01T00:00:00.001Z' },
    });
    expect((await page()).total).toBe(0);
    testDb
      .current!.query('UPDATE catalog_collections SET rule_json = ? WHERE id = ?')
      .run('{"unsupported":true}', smart.id);
    expect((await page()).total).toBe(0);
    expect((await routes.request(`/collections/${smart.id}`, { method: 'DELETE' })).status).toBe(
      200,
    );
    expect(store.queryCatalog({ workspaceId: 'default' }).total).toBe(3);
  });

  it('rejects malformed smart rules before creating a collection', async () => {
    const routes = createRoutes(await createStore([]));
    for (const rule of [
      {},
      null,
      [],
      { unknown: true },
      { q: 'x'.repeat(2001) },
      { q: Array.from({ length: 33 }, (_, i) => `#tag${i}`).join(' ') },
      { favorite: 'true' },
      { providerId: 42 },
      { withinDays: 0 },
      { withinDays: 1.5 },
      { createdFrom: 'yesterday' },
      { createdFrom: '2026-02-30T00:00:00.000Z' },
      { createdFrom: '2026-11-02T00:00:00Z', createdTo: '2026-11-01T00:00:00Z' },
    ]) {
      expect(
        (
          await routes.request('/collections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId: 'default', name: 'Invalid', rule }),
          })
        ).status,
      ).toBe(400);
    }
    expect(await (await routes.request('/collections?workspace_id=default')).json()).toEqual([]);
  });

  it('preserves converted image metadata and refreshes its Catalog file size', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'studio-catalog-embed-'));
    try {
      const filePath = path.join(directory, 'converted.png');
      const original = await sharp({
        create: { width: 2, height: 2, channels: 3, background: '#765432' },
      })
        .png()
        .toBuffer();
      writeFileSync(filePath, original);
      const existingMetadata = {
        prompt: 'Exact embedded prompt',
        model: 'embedded-model',
        negativePrompt: 'Original exclusions',
        generatedAt: '2026-05-20T00:00:00.000Z',
        studioVersion: '0.0.0',
      };
      await embedMetadata(filePath, existingMetadata);
      const image = catalogImage({
        filePath,
        fileSizeBytes: original.length,
        jobId: null,
        generationConfig: {
          model: 'catalog-model',
          imageConversion: {
            originalPrompt: 'Compiled original prompt',
            originalModel: 'original-model',
          },
        },
      });
      const routes = createRoutes(await createStore([image]), embedMetadata);
      const response = await routes.request('/image-1/embed', { method: 'POST' });
      expect(response.status).toBe(200);
      await expect(extractMetadata(filePath)).resolves.toMatchObject({
        ...existingMetadata,
        libraryId: image.libraryId,
        catalogId: image.id,
      });
      const fileSizeBytes = statSync(filePath).size;
      await expect(response.json()).resolves.toMatchObject({ bytesWritten: fileSizeBytes });
      await expect((await routes.request('/image-1')).json()).resolves.toMatchObject({
        fileSizeBytes,
      });

      // A converted copy with stripped metadata can still recover its original provenance.
      writeFileSync(filePath, original);
      expect((await routes.request('/image-1/embed', { method: 'POST' })).status).toBe(200);
      await expect(extractMetadata(filePath)).resolves.toMatchObject({
        prompt: 'Compiled original prompt',
        model: 'original-model',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('queries through an injected Catalog Store', async () => {
    const calls: QueryCatalogFilters[] = [];
    // Matches every filter below; unorganized means no tags, so q matches the prompt.
    const image = catalogImage({
      id: 'image-42',
      workspaceId: 'workspace-1',
      recipeId: 'styles',
      jobId: 'job-1',
      batchId: 'batch-1',
      isFavorite: true,
      prompt: 'studio still life',
    });
    const routes = createRoutes(await createStore([image], (filters) => calls.push(filters ?? {})));

    const response = await routes.request(
      '/?workspace_id=workspace-1&recipe_id=styles&job_id=job-1&batch_id=batch-1&unorganized=true&favorite=true&deleted=false&q=studio&sort=asc&offset=5&limit=10',
    );

    // The one match counts in the total; offset 5 pages past it.
    await expect(response.json()).resolves.toEqual({
      images: [],
      total: 1,
      hasMore: false,
    });
    expect(calls).toEqual([
      {
        libraryId: null,
        workspaceId: 'workspace-1',
        recipeId: 'styles',
        jobId: 'job-1',
        batchId: 'batch-1',
        unorganized: true,
        favorite: true,
        isDeleted: false,
        q: 'studio',
        sort: 'asc',
        offset: 5,
        limit: 10,
      },
    ]);
    await routes.request('/?recipe_id=default');
    expect(calls.at(-1)?.recipeId).toBeNull();
    await routes.request('/');
    expect(calls.at(-1)?.recipeId).toBeUndefined();
    const invalidSort = await routes.request('/?sort=invalid');
    expect(invalidSort.status).toBe(400);
    await expect(invalidSort.json()).resolves.toEqual({ error: 'Invalid catalog sort' });
  });

  it('updates and restores Catalog Entries', async () => {
    const image = catalogImage({
      id: 'image-99',
      isFavorite: false,
      tags: ['imported reference', 'kept'],
    });
    const store = await createStore([image]);
    const routes = createRoutes(store);

    const patched = await routes.request('/image-99', {
      method: 'PATCH',
      body: JSON.stringify({ isFavorite: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    const deleted = await routes.request('/image-99', { method: 'DELETE' });
    // A workspace delete removes its tag rows; the restored image brings its tags back.
    testDb.current!.run('DELETE FROM catalog_tags');
    const restored = await routes.request('/image-99/restore', { method: 'POST' });
    expect(store.listTags('default').map((tag) => tag.name)).toContain('kept');
    const missing = await routes.request('/missing');

    await expect(patched.json()).resolves.toMatchObject({
      id: 'image-99',
      isFavorite: true,
      tags: ['imported reference', 'kept'],
    });
    await expect(deleted.json()).resolves.toMatchObject({
      id: 'image-99',
      isDeleted: true,
    });
    await expect(restored.json()).resolves.toMatchObject({
      id: 'image-99',
      isDeleted: false,
    });
    expect(missing.status).toBe(404);
  });

  it('moves an image with its tags, out of its old collections, only to a known workspace', async () => {
    const store = await createStore([catalogImage({ workspaceId: 'default', tags: ['boss'] })]);
    store.updateTag('default', 'boss', { color: '#fb7185' });
    store.createCollection({ workspaceId: 'default', name: 'Bosses', imageIds: ['image-1'] });
    createWorkspaceInDb(testDb.current!, { id: 'ws-b', name: 'B' });
    const routes = createRoutes(store);
    const move = (workspaceId: string) =>
      routes.request('/image-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
    const members = () =>
      testDb.current!.query('SELECT image_id FROM catalog_collection_images').all();

    const unknown = await move('missing');
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toEqual({ error: 'Unknown workspace.' });
    expect(store.getCatalogImage('image-1')?.workspaceId).toBe('default');
    expect(members()).toHaveLength(1);

    const moved = await move('ws-b');
    expect(moved.status).toBe(200);
    await expect(moved.json()).resolves.toMatchObject({ workspaceId: 'ws-b', tags: ['boss'] });
    expect(store.listTags('ws-b')).toEqual([
      expect.objectContaining({ name: 'boss', color: '#fb7185', imageCount: 1 }),
    ]);
    expect(members()).toEqual([]);
  });

  it('rejects an organize call before any write, so a bad image mid-batch changes nothing', async () => {
    const image = (id: string, overrides: Partial<CatalogImage> = {}) =>
      catalogImage({ id, workspaceId: 'default', ...overrides });
    const store = await createStore([
      image('image-1', { tags: ['imported reference'] }),
      image('image-2'),
      image('full', { tags: Array.from({ length: 32 }, (_, index) => `tag-${index}`) }),
      image('foreign', { workspaceId: 'other' }),
      image('archived', { isDeleted: true }),
    ]);
    store.createCollection({ workspaceId: 'default', name: 'Bosses', imageIds: ['image-1'] });
    const routes = createRoutes(store);
    const rows = (sql: string) => testDb.current!.query(sql).all();
    const snapshot = () => [
      rows('SELECT id, tags, is_favorite FROM catalog_images ORDER BY id'),
      rows('SELECT * FROM catalog_collection_images ORDER BY image_id'),
      rows('SELECT * FROM catalog_collections ORDER BY id'),
      rows('SELECT * FROM catalog_tags ORDER BY workspace_id, name'),
      rows('SELECT * FROM catalog_organize_history ORDER BY rowid'),
    ];
    const before = snapshot();
    const send = (method: string, path: string, body: unknown) =>
      routes.request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const both = { source: 'ui', workspaceId: 'default', imageIds: ['image-1', 'image-2'] };
    for (const [body, imageIds] of [
      [null],
      [{ workspaceId: 'default', imageIds: ['image-1'] }],
      [{ ...both, addTags: ['#Jefe'], removeTags: ['jefe'] }],
      [{ ...both, addToCollection: 'Best  Picks', removeFromCollection: 'best picks' }],
      [{ ...both, addTags: ['jefe'], source: 'other' }],
      [{ ...both, imageIds: Array.from({ length: 2001 }, (_, i) => `id-${i}`), addTags: ['x'] }],
      [{ ...both, addTags: Array.from({ length: 33 }, (_, i) => `tag-${i}`) }],
      [{ ...both, addTags: ['jefe'], removeFromCollection: 'Missing' }],
      // Each image is checked before the first write, wherever it sits in the batch.
      [
        {
          ...both,
          imageIds: ['image-1', 'foreign', 'image-2'],
          addTags: ['jefe'],
          addToCollection: 'New',
        },
        ['foreign'],
      ],
      // `workspaces` is a route name, not an image.
      [
        { ...both, imageIds: ['image-1', 'archived', 'workspaces'], addTags: ['jefe'] },
        ['archived', 'workspaces'],
      ],
      [
        {
          ...both,
          imageIds: ['image-1', 'full', 'image-2'],
          addTags: ['jefe'],
          addToCollection: 'Bosses',
        },
        ['full'],
      ],
      [{ ...both, addTags: ['bad tag!'] }, ['image-1', 'image-2']],
    ] as const) {
      const response = await send('POST', '/commands/organize', body);
      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toEqual(expect.any(String));
      expect(payload.imageIds).toEqual(imageIds);
    }
    // PATCH no longer changes tags, so every tag write goes through the command.
    for (const body of [
      { addTags: ['jefe'] },
      { tags: [] },
      { removeTags: ['imported reference'], isFavorite: true },
    ])
      expect((await send('PATCH', '/image-1', body)).status).toBe(400);
    expect(snapshot()).toEqual(before);
  });

  it('organizes images in one call and lists only the images it changed', async () => {
    const store = await createStore([
      catalogImage({ id: 'image-1', workspaceId: 'default', tags: ['imported reference'] }),
      catalogImage({ id: 'image-2', workspaceId: 'default', tags: ['jefe'] }),
    ]);
    const bosses = store.createCollection({
      workspaceId: 'default',
      name: 'Bosses',
      imageIds: ['image-1'],
    });
    const routes = createRoutes(store);
    const organize = async (body: object) => {
      const response = await routes.request('/commands/organize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'ui', workspaceId: 'default', ...body }),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const tagsOf = (id: string) => store.getCatalogImage(id)?.tags;
    const [accent, jefe] = await Promise.all([
      organize({ imageIds: ['image-1'], addTags: ['#ACCIÓN', 'acción'] }),
      organize({ imageIds: ['image-1', 'image-2'], addTags: ['jefe'], addToCollection: 'bosses' }),
    ]);
    expect(accent.tags).toEqual({ added: { acción: ['image-1'] }, removed: {} });
    // image-2 had jefe and image-1 was a member, so an undo must leave both of those alone.
    expect(jefe).toEqual({
      operationId: expect.stringMatching(/^organize-/),
      workspaceId: 'default',
      imageCount: 2,
      tags: { added: { jefe: ['image-1'] }, removed: {} },
      collection: {
        id: bosses.id,
        name: 'Bosses',
        created: false,
        imageCount: 2,
        addedImageIds: ['image-2'],
      },
      removedFrom: null,
    });
    expect(tagsOf('image-1')).toEqual(['imported reference', 'acción', 'jefe']);
    expect(store.listTags('default').map(({ name }) => name)).toEqual(
      expect.arrayContaining(['acción', 'jefe']),
    );

    const moved = await organize({
      imageIds: ['image-1', 'image-2'],
      removeTags: ['acción'],
      removeFromCollection: 'BOSSES',
      addToCollection: 'Covers',
    });
    expect(moved).toMatchObject({
      tags: { added: {}, removed: { acción: ['image-1'] } },
      collection: {
        name: 'Covers',
        created: true,
        imageCount: 2,
        addedImageIds: ['image-1', 'image-2'],
      },
      removedFrom: { id: bosses.id, name: 'Bosses', removedImageIds: ['image-1', 'image-2'] },
    });
    expect(
      Object.fromEntries(
        store.listCollections('default').map(({ name, imageCount }) => [name, imageCount]),
      ),
    ).toEqual({ Covers: 2, Bosses: 0 });
    const history = async () =>
      (await routes.request('/commands/organize/history?workspace_id=default')).json();
    const undo = (operationId: string) =>
      routes.request(`/commands/organize/${operationId}/undo`, { method: 'POST' });
    const beforeNoop = await history();
    expect(await organize({ imageIds: ['image-1'], removeTags: ['acción'] })).toMatchObject({
      operationId: null,
      tags: { added: {}, removed: {} },
    });
    expect(await history()).toEqual(beforeNoop);
    expect(beforeNoop[0]).toMatchObject({
      operationId: moved.operationId,
      source: 'ui',
      undoneAt: null,
      counts: { collection: { name: 'Covers', added: 2 } },
    });
    const conflict = await undo(jefe.operationId);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: 'newer_change',
      operationId: moved.operationId,
    });
    expect(await (await undo(moved.operationId)).json()).toMatchObject({
      alreadyUndone: false,
      skippedImageIds: [],
      imageCount: 2,
    });
    expect(
      Object.fromEntries(
        store.listCollections('default').map(({ name, imageCount }) => [name, imageCount]),
      ),
    ).toEqual({ Covers: 0, Bosses: 2 });
    expect(tagsOf('image-1')).toEqual(['imported reference', 'jefe', 'acción']);
    expect(await (await undo(moved.operationId)).json()).toMatchObject({
      alreadyUndone: true,
      imageCount: 0,
    });
    expect((await undo(jefe.operationId)).status).toBe(200);
    expect(tagsOf('image-1')).toEqual(['imported reference', 'acción']);
    expect(tagsOf('image-2')).toEqual(['jefe']);
    expect(
      testDb
        .current!.query('SELECT image_id FROM catalog_collection_images WHERE collection_id = ?')
        .all(bosses.id),
    ).toEqual([{ image_id: 'image-1' }]);
    expect((await history())[0].undoneAt).toEqual(expect.any(String));
    expect((await undo('missing')).status).toBe(404);
    expect((await undo(accent.operationId)).status).toBe(200);
    // A known tag with a space can be added back after it was removed.
    await organize({ imageIds: ['image-1'], removeTags: ['imported reference'] });
    await organize({ imageIds: ['image-1'], addTags: ['imported reference'] });
    expect(tagsOf('image-1')).toEqual(['imported reference']);

    const removed = await organize({ imageIds: ['image-1'], removeTags: ['imported reference'] });
    testDb
      .current!.query('UPDATE catalog_images SET tags = ? WHERE id = ?')
      .run(JSON.stringify(Array.from({ length: 32 }, (_, index) => `full-${index}`)), 'image-1');
    expect(await (await undo(removed.operationId)).json()).toMatchObject({
      skippedImageIds: ['image-1'],
      imageCount: 0,
    });
    expect(tagsOf('image-1')).toHaveLength(32);
    testDb.current!.query("UPDATE catalog_images SET tags = '[]' WHERE id = 'image-1'").run();
    const archivedAndMoved = await organize({
      imageIds: ['image-1', 'image-2'],
      addTags: ['temporary'],
    });
    testDb.current!.query("UPDATE catalog_images SET is_deleted = 1 WHERE id = 'image-1'").run();
    testDb
      .current!.query("UPDATE catalog_images SET workspace_id = 'elsewhere' WHERE id = 'image-2'")
      .run();
    expect(await (await undo(archivedAndMoved.operationId)).json()).toMatchObject({
      skippedImageIds: ['image-2'],
      tags: { removed: { temporary: ['image-1'] } },
    });
    expect(tagsOf('image-1')).toEqual([]);
    expect(tagsOf('image-2')).toEqual(['jefe', 'temporary']);
    testDb.current!.query("UPDATE catalog_images SET is_deleted = 0 WHERE id = 'image-1'").run();
    const renamed = await organize({ imageIds: ['image-1'], addTags: ['before'] });
    store.updateTag('default', 'before', { name: 'after' });
    expect(await (await undo(renamed.operationId)).json()).toMatchObject({ imageCount: 0 });
    expect(tagsOf('image-1')).toEqual(['after']);
    for (let index = 0; index < 22; index++) {
      await organize({
        imageIds: ['image-1'],
        ...(index % 2 ? { removeTags: ['cycle'] } : { addTags: ['cycle'] }),
      });
    }
    expect(await history()).toHaveLength(20);
    expect((await undo(renamed.operationId)).status).toBe(404);
  });

  it('returns exact workspace summaries independent of catalog page budgets', async () => {
    const routes = createRoutes(
      await createStore([
        catalogImage({
          id: 'default-old',
          workspaceId: null,
          fileSizeBytes: 1024,
          createdAt: '2026-05-24T00:00:00.000Z',
        }),
        catalogImage({
          id: 'default-new',
          workspaceId: 'default',
          filePath: 'D:/library/outputs/default-new.png',
          thumbnailUrl: '/thumbs/default-new.webp',
          fileSizeBytes: 2048,
          createdAt: '2026-05-25T00:00:00.000Z',
        }),
        catalogImage({
          id: 'concept-a',
          workspaceId: 'concepts',
          filePath: 'D:/library/outputs/image-1.png',
          fileSizeBytes: null,
          createdAt: '2026-05-23T00:00:00.000Z',
        }),
        catalogImage({
          id: 'archived-default',
          workspaceId: 'default',
          isDeleted: true,
          fileSizeBytes: 99_999,
          createdAt: '2026-05-26T00:00:00.000Z',
        }),
      ]),
    );

    const response = await routes.request('/workspaces?deleted=false');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        workspaceId: 'default',
        imageCount: 2,
        totalFileSizeBytes: 3072,
        knownFileSizeCount: 2,
        firstCreatedAt: '2026-05-24T00:00:00.000Z',
        latestCreatedAt: '2026-05-25T00:00:00.000Z',
        sampleFilePath: 'D:/library/outputs/default-new.png',
        lastImage: expect.objectContaining({
          id: 'default-new',
          generationConfig: null,
        }),
      },
      {
        workspaceId: 'concepts',
        imageCount: 1,
        totalFileSizeBytes: 0,
        knownFileSizeCount: 0,
        firstCreatedAt: '2026-05-23T00:00:00.000Z',
        latestCreatedAt: '2026-05-23T00:00:00.000Z',
        sampleFilePath: 'D:/library/outputs/image-1.png',
        lastImage: expect.objectContaining({
          id: 'concept-a',
          generationConfig: null,
        }),
      },
    ]);
  });

  it('archives Catalog Entries by full-scope command filter', async () => {
    const routes = createRoutes(
      await createStore([
        catalogImage({ id: 'image-1', workspaceId: 'workspace-a' }),
        catalogImage({ id: 'image-2', workspaceId: 'workspace-a' }),
        catalogImage({ id: 'image-3', workspaceId: 'workspace-b' }),
      ]),
    );

    const response = await routes.request('/commands/archive', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: 'workspace-a' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      action: 'archive',
      matchedCount: 2,
      changedCount: 2,
      failed: [],
    });
  });

  it('rejects malformed batch filters without broadening their selection', async () => {
    const image = catalogImage({ id: 'trashed-image', isDeleted: true });
    const live = catalogImage({ id: 'live-image' });
    const store = await createStore([image, live]);
    const routes = createRoutes(store);
    for (const action of ['archive', 'restore', 'purge']) {
      for (const body of [
        '{',
        'null',
        '[]',
        '{}',
        '{"ids":42}',
        '{"ids":[]}',
        '{"ids":["trashed-image",42]}',
        '{"workspaceId":null}',
        '{"batchId":""}',
        '{"isDeleted":"true"}',
        '{"id":"trashed-image"}',
      ]) {
        const response = await routes.request(`/commands/${action}`, { method: 'POST', body });
        expect(response.status, `${action}: ${body}`).toBe(400);
        expect(store.getCatalogImage(image.id)?.isDeleted).toBe(true);
      }
    }
    for (const body of [
      '{"isDeleted":true}',
      '{"isDeleted":false}',
      '{"isDeleted":true,"confirm":"reset-studio"}',
    ]) {
      const response = await routes.request('/commands/purge', { method: 'POST', body });
      expect(response.status, `purge: ${body}`).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'confirmation_required' });
      expect(store.getCatalogImage(image.id)?.isDeleted).toBe(true);
    }
    // The token alone is not a filter, and it does not excuse a malformed one.
    for (const body of ['{"confirm":"purge-trash"}', '{"ids":42,"confirm":"purge-trash"}']) {
      const response = await routes.request('/commands/purge', { method: 'POST', body });
      expect(response.status, `purge: ${body}`).toBe(400);
      expect(store.getCatalogImage(image.id)?.isDeleted).toBe(true);
    }
    const response = await routes.request('/commands/purge', {
      method: 'POST',
      body: JSON.stringify({ isDeleted: false, confirm: CATALOG_PURGE_CONFIRMATION }),
    });
    expect(response.status).toBe(200);
    expect(store.getCatalogImage(image.id)).toBeNull();
    expect(store.getCatalogImage(live.id)?.isDeleted).toBe(false);
  });

  it('creates a collection from workspace images and forwards it as a catalog filter', async () => {
    const calls: QueryCatalogFilters[] = [];
    const store = await createStore(
      [
        catalogImage({ id: 'image-1', workspaceId: 'default' }),
        catalogImage({ id: 'image-2', workspaceId: 'other' }),
      ],
      (filters) => calls.push(filters ?? {}),
    );
    const routes = createRoutes(store);
    expect((await routes.request('/suggestions')).status).toBe(400);
    const suggestions = await routes.request('/suggestions?workspace_id=default');
    expect(suggestions.status).toBe(200);
    await expect(suggestions.json()).resolves.toEqual({
      total: 1,
      scanned: 1,
      ungrouped: 1,
      groups: [],
    });
    const rejected = await routes.request('/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'default', name: ' ', imageIds: ['image-1'] }),
    });
    expect(rejected.status).toBe(400);
    const created = await routes.request('/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'default',
        name: 'Bosses',
        imageIds: ['image-1', 'image-2'],
      }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ name: 'Bosses', imageCount: 1 });
    await expect(
      (await routes.request('/suggestions?workspace_id=default')).json(),
    ).resolves.toEqual({ total: 0, scanned: 0, ungrouped: 0, groups: [] });
    const listed = await routes.request('/collections?workspace_id=default');
    const collections = (await listed.json()) as Array<{ id: string }>;
    expect(collections).toHaveLength(1);
    const selection = await routes.request('/collections/selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'default', imageIds: ['image-1', 'image-2', 'image-1'] }),
    });
    expect(selection.status).toBe(200);
    await expect(selection.json()).resolves.toMatchObject([
      { id: collections[0].id, selectedImageCount: 1 },
    ]);
    const invalidSelection = await routes.request('/collections/selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'default', imageIds: [] }),
    });
    expect(invalidSelection.status).toBe(400);
    await routes.request(`/?collection_id=${collections[0].id}`);
    expect(calls.at(-1)?.collectionId).toBe(collections[0].id);
    const removed = await routes.request(`/collections/${collections[0].id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    const remaining = await routes.request('/collections?workspace_id=default');
    await expect(remaining.json()).resolves.toEqual([]);
  });

  it('validates organization appearance and renames tags within one workspace', async () => {
    const store = await createStore([
      catalogImage({ tags: ['boss'] }),
      catalogImage({ id: 'other', workspaceId: 'other', tags: ['boss'] }),
    ]);
    const routes = createRoutes(store);
    const patch = (body: unknown) =>
      routes.request('/tags/boss', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await patch({ workspaceId: 'default', color: 'red' })).status).toBe(400);
    expect((await patch({ workspaceId: 'default', name: '#HERO', color: '#FB7185' })).status).toBe(
      200,
    );
    expect(store.getCatalogImage('image-1')?.tags).toEqual(['hero']);
    expect(store.getCatalogImage('other')?.tags).toEqual(['boss']);
    const tags = await routes.request('/tags?workspace_id=default');
    expect(await tags.json()).toEqual([
      expect.objectContaining({ name: 'hero', color: '#fb7185' }),
    ]);
    for (const [emoji, status] of [
      ['🎨', 201],
      ['📷✨', 400],
      ['text', 400],
    ] as const) {
      const response = await routes.request('/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'default', name: emoji, emoji }),
      });
      expect(response.status).toBe(status);
    }
  });
});
