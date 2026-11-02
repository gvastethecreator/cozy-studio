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
import { openTestDatabase } from './db/testDatabase';
import { createWorkspaceInDb } from './db/workspaces';
import { embedMetadata, extractMetadata } from './metadataEmbedder';

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
  });
}

describe('catalog routes', () => {
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
    const image = catalogImage({ id: 'image-99', isFavorite: false });
    const store = await createStore([image]);
    const routes = createRoutes(store);

    const patched = await routes.request('/image-99', {
      method: 'PATCH',
      body: JSON.stringify({ isFavorite: true, tags: ['imported reference', 'kept', 'kept'] }),
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

  it('rejects malformed or excessive tags before changing image metadata', async () => {
    const store = await createStore([catalogImage({ tags: ['imported reference'] })]);
    const routes = createRoutes(store);
    for (const tags of [
      'jefe',
      null,
      [42],
      [''],
      ['x'.repeat(65)],
      Array.from({ length: 33 }, (_, i) => `tag-${i}`),
    ]) {
      const response = await routes.request('/image-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite: true, tags }),
      });
      expect(response.status).toBe(400);
      expect(store.getCatalogImage('image-1')).toMatchObject({
        isFavorite: false,
        tags: ['imported reference'],
      });
    }
  });

  it('merges tag changes with current metadata instead of replacing a stale client list', async () => {
    const store = await createStore([catalogImage({ tags: ['imported reference'] })]);
    const routes = createRoutes(store);
    const patch = (body: unknown) =>
      routes.request('/image-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const results = await Promise.all([
      patch({ addTags: ['#ACCIÓN', 'accio\u0301n'] }),
      patch({ addTags: ['jefe'] }),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(store.getCatalogImage('image-1')?.tags).toEqual([
      'imported reference',
      'acción',
      'jefe',
    ]);
    const invalid = await patch({ addTags: ['new tag'], isFavorite: true });
    expect(invalid.status).toBe(400);
    expect(store.getCatalogImage('image-1')?.isFavorite).toBe(false);
    expect((await patch({ tags: [], addTags: ['other'] })).status).toBe(400);
    await patch({ removeTags: ['acción'] });
    const reopened = await routes.request('/image-1');
    await expect(reopened.json()).resolves.toMatchObject({ tags: ['imported reference', 'jefe'] });
    await patch({ removeTags: ['imported reference'] });
    expect((await patch({ addTags: ['imported reference'] })).status).toBe(200);
    expect(store.getCatalogImage('image-1')?.tags).toEqual(['jefe', 'imported reference']);
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
