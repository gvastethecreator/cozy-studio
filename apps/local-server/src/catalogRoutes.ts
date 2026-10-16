import { Hono } from 'hono';
import {
  applyCatalogTagChanges,
  CATALOG_SORT_OPTIONS,
  validateCatalogCollectionImageIds,
  validateCatalogCollectionName,
  validateCatalogCollectionWorkspaceId,
  validateCatalogTags,
  type CatalogCollectionPatch,
  type CatalogTag,
  type CatalogTagPatch,
  normalizeImageHashtag,
  validateTagColor,
  validateCollectionEmoji,
} from '../../../packages/shared/src';

import type {
  CatalogBatchCommandResult,
  CatalogCommandFilter,
  CatalogImage,
} from '../../../packages/shared/src';
import type { CatalogCommandResult } from './catalogCommands';
import type { StudioCatalogStore } from './catalogStore';
import { extractMetadata, type embedMetadata as embedMetadataFn } from './metadataEmbedder';
import type { getJob as getJobFn } from './db/jobs';
import { catalogImageMetadata, jobImageMetadata } from './providers/jobImageMetadata';
import type { updateCatalogImageFileSize as updateCatalogImageFileSizeFn } from './catalog';

interface CatalogCommandsBoundary {
  update(
    id: string,
    patch: { isFavorite?: boolean; tags?: string[]; workspaceId?: string | null },
  ): CatalogCommandResult;
  softDelete(id: string): CatalogCommandResult;
  restore(id: string): CatalogCommandResult;
  purge(id: string): CatalogCommandResult;
  archiveByFilter(filters: CatalogCommandFilter): CatalogBatchCommandResult;
  restoreByFilter(filters: CatalogCommandFilter): CatalogBatchCommandResult;
  purgeByFilter(filters: CatalogCommandFilter): CatalogBatchCommandResult;
}

export interface CreateCatalogRoutesDependencies {
  catalogStore: StudioCatalogStore;
  catalogCommands: CatalogCommandsBoundary;
  embedMetadata: typeof embedMetadataFn;
  getJob: typeof getJobFn;
  updateCatalogImageFileSize: typeof updateCatalogImageFileSizeFn;
  publishEvent?: (type: string, payload: unknown) => void;
}

async function readJsonRecord(request: { json: () => Promise<unknown> }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Expected an object.');
  }
  return body as Record<string, unknown>;
}

function collectionError(error: unknown) {
  return { error: error instanceof Error ? error.message : 'Invalid collection' };
}

function jsonNotFound(c: { json: (payload: unknown, status: 404) => Response }) {
  return c.json({ error: 'Catalog image not found' }, 404);
}

function catalogFiltersFromUrl(url: string) {
  const searchParams = new URL(url).searchParams;
  return {
    ...(searchParams.has('id') ? { id: searchParams.get('id')! } : {}),
    libraryId: searchParams.get('library_id'),
    workspaceId: searchParams.get('workspace_id'),
    recipeId: searchParams.has('recipe_id')
      ? searchParams.get('recipe_id') === 'default'
        ? null
        : searchParams.get('recipe_id')
      : undefined,
    jobId: searchParams.get('job_id'),
    batchId: searchParams.get('batch_id'),
    collectionId: searchParams.get('collection_id') || undefined,
    favorite: searchParams.has('favorite') ? searchParams.get('favorite') === 'true' : undefined,
    isDeleted: searchParams.get('deleted') === 'true',
    q: searchParams.get('q'),
    sort: CATALOG_SORT_OPTIONS.find((option) => option === searchParams.get('sort')),
    offset: Number(searchParams.get('offset') || 0),
    limit: Number(searchParams.get('limit') || 50),
  };
}

async function readCatalogCommandFilter(request: { json: () => Promise<unknown> }) {
  const raw = await readJsonRecord(request);
  if (
    Object.keys(raw).some((key) => !['ids', 'workspaceId', 'batchId', 'isDeleted'].includes(key)) ||
    Object.keys(raw).length === 0 ||
    (raw.ids !== undefined &&
      (!Array.isArray(raw.ids) ||
        raw.ids.length === 0 ||
        raw.ids.some((id) => typeof id !== 'string' || id.trim().length === 0))) ||
    (raw.workspaceId !== undefined &&
      (typeof raw.workspaceId !== 'string' || raw.workspaceId.trim().length === 0)) ||
    (raw.batchId !== undefined &&
      (typeof raw.batchId !== 'string' || raw.batchId.trim().length === 0)) ||
    (raw.isDeleted !== undefined && typeof raw.isDeleted !== 'boolean')
  ) {
    throw new Error('Send a valid catalog command filter.');
  }
  return {
    ids: Array.isArray(raw.ids) ? (raw.ids as string[]) : undefined,
    workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : undefined,
    batchId: typeof raw.batchId === 'string' ? raw.batchId : undefined,
    isDeleted: typeof raw.isDeleted === 'boolean' ? raw.isDeleted : undefined,
  } satisfies CatalogCommandFilter;
}

export function createCatalogRoutes({
  catalogStore,
  catalogCommands,
  embedMetadata,
  getJob,
  updateCatalogImageFileSize,
  publishEvent,
}: CreateCatalogRoutesDependencies) {
  const routes = new Hono();

  routes.get('/tags', (c) => {
    try {
      return c.json(
        catalogStore.listTags(validateCatalogCollectionWorkspaceId(c.req.query('workspace_id'))),
      );
    } catch (error) {
      return c.json(collectionError(error), 400);
    }
  });
  routes.post('/tags', async (c) => {
    try {
      const body = await readJsonRecord(c.req);
      if (typeof body.name !== 'string') throw new Error('Tag name is required.');
      return c.json(
        catalogStore.createTag(
          validateCatalogCollectionWorkspaceId(body.workspaceId),
          normalizeImageHashtag(body.name),
          validateTagColor(body.color ?? null),
        ),
        201,
      );
    } catch (error) {
      return c.json(collectionError(error), 400);
    }
  });
  routes.patch('/tags/:name', async (c) => {
    try {
      const body = await readJsonRecord(c.req);
      const workspaceId = validateCatalogCollectionWorkspaceId(body.workspaceId);
      const patch: CatalogTagPatch = {};
      if (body.name !== undefined) {
        if (typeof body.name !== 'string') throw new Error('Tag name is required.');
        patch.name = normalizeImageHashtag(body.name);
      }
      if (body.color !== undefined) patch.color = validateTagColor(body.color);
      if (!Object.keys(patch).length) throw new Error('Send a name or color.');
      const updated = catalogStore.updateTag(workspaceId, c.req.param('name'), patch);
      if (!updated) return c.json({ error: 'Tag not found' }, 404);
      if (patch.name && patch.name !== c.req.param('name')) {
        publishEvent?.('catalog.batch_changed', {
          action: 'organize',
          changedCount: updated.imageCount,
          scope: { kind: 'workspace', workspaceId },
        });
      }
      return c.json(updated);
    } catch (error) {
      return c.json(collectionError(error), 400);
    }
  });

  routes.get('/', (c) => {
    const filters = catalogFiltersFromUrl(c.req.url);
    if (new URL(c.req.url).searchParams.has('sort') && !filters.sort) {
      return c.json({ error: 'Invalid catalog sort' }, 400);
    }
    return c.json(catalogStore.queryCatalog(filters));
  });

  routes.get('/search', (c) => {
    const url = new URL(c.req.url);
    return c.json(
      catalogStore.queryCatalog({
        q: url.searchParams.get('q'),
        offset: Number(url.searchParams.get('offset') || 0),
        limit: Number(url.searchParams.get('limit') || 50),
      }),
    );
  });

  routes.get('/collections', (c) => {
    try {
      return c.json(
        catalogStore.listCollections(
          validateCatalogCollectionWorkspaceId(new URL(c.req.url).searchParams.get('workspace_id')),
        ),
      );
    } catch (error) {
      return c.json(collectionError(error), 400);
    }
  });

  routes.post('/collections/selection', async (c) => {
    try {
      const body = await readJsonRecord(c.req);
      return c.json(
        catalogStore.listCollectionSelection(
          validateCatalogCollectionWorkspaceId(body.workspaceId),
          validateCatalogCollectionImageIds(body.imageIds),
        ),
      );
    } catch (error) {
      return c.json(collectionError(error), 400);
    }
  });

  routes.post('/collections', async (c) => {
    try {
      const body = await readJsonRecord(c.req);
      return c.json(
        catalogStore.createCollection({
          workspaceId: validateCatalogCollectionWorkspaceId(body.workspaceId),
          name: validateCatalogCollectionName(body.name),
          emoji: validateCollectionEmoji(body.emoji ?? null),
          imageIds:
            body.imageIds === undefined || (Array.isArray(body.imageIds) && !body.imageIds.length)
              ? []
              : validateCatalogCollectionImageIds(body.imageIds),
        }),
        201,
      );
    } catch (error) {
      return c.json(collectionError(error), 400);
    }
  });

  routes.patch('/collections/:collectionId', async (c) => {
    try {
      const body = await readJsonRecord(c.req);
      const patch: CatalogCollectionPatch = {};
      if (body.name !== undefined) patch.name = validateCatalogCollectionName(body.name);
      if (body.emoji !== undefined) patch.emoji = validateCollectionEmoji(body.emoji);
      if (body.addImageIds !== undefined) {
        patch.addImageIds = validateCatalogCollectionImageIds(body.addImageIds);
      }
      if (body.removeImageIds !== undefined) {
        patch.removeImageIds = validateCatalogCollectionImageIds(body.removeImageIds);
      }
      if (!Object.keys(patch).length) {
        throw new Error('Send a name or image changes.');
      }
      const updated = catalogStore.updateCollection(c.req.param('collectionId'), patch);
      if (!updated) return c.json({ error: 'Collection not found' }, 404);
      return c.json(updated);
    } catch (error) {
      return c.json(collectionError(error), 400);
    }
  });

  routes.delete('/collections/:collectionId', (c) => {
    if (!catalogStore.deleteCollection(c.req.param('collectionId'))) {
      return c.json({ error: 'Collection not found' }, 404);
    }
    return c.json({ ok: true });
  });

  routes.get('/workspaces', (c) => {
    const searchParams = new URL(c.req.url).searchParams;
    return c.json(
      catalogStore.queryWorkspaceSummaries({
        libraryId: searchParams.get('library_id'),
        isDeleted: searchParams.get('deleted') === 'true',
      }),
    );
  });

  for (const action of ['archive', 'restore', 'purge'] as const) {
    routes.post(`/commands/${action}`, async (c) => {
      try {
        return c.json(catalogCommands[`${action}ByFilter`](await readCatalogCommandFilter(c.req)));
      } catch (error) {
        return c.json(collectionError(error), 400);
      }
    });
  }

  routes.get('/:id', (c) => {
    const image = catalogStore.getCatalogImage(c.req.param('id'));
    if (!image) return jsonNotFound(c);
    return c.json(image);
  });

  routes.patch('/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    let tags: string[] | undefined;
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('Expected an image update object.');
      }
      if (body.tags !== undefined) tags = validateCatalogTags(body.tags);
      if (body.addTags !== undefined || body.removeTags !== undefined) {
        if (body.tags !== undefined) throw new Error('Send tag changes or a tag list, not both.');
        const current = catalogStore.getCatalogImage(c.req.param('id'));
        if (!current) return jsonNotFound(c);
        tags = applyCatalogTagChanges(
          current.tags,
          body,
          catalogStore.listTags(current.workspaceId ?? 'default').map((tag) => tag.name),
        );
      }
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid tags' }, 400);
    }
    const result = catalogCommands.update(c.req.param('id'), {
      isFavorite: body.isFavorite,
      tags,
      workspaceId: body.workspaceId,
    });
    if (!result.ok) return jsonNotFound(c);
    return c.json(result.image);
  });

  routes.delete('/:id', (c) => {
    const result = catalogCommands.softDelete(c.req.param('id'));
    if (!result.ok) return jsonNotFound(c);
    return c.json(result.image);
  });

  routes.delete('/:id/permanent', (c) => {
    const result = catalogCommands.purge(c.req.param('id'));
    if (!result.ok) return jsonNotFound(c);
    return c.json(result.image);
  });

  routes.post('/:id/restore', (c) => {
    const result = catalogCommands.restore(c.req.param('id'));
    if (!result.ok) return jsonNotFound(c);
    return c.json(result.image);
  });

  routes.post('/:id/embed', async (c) => {
    const image = catalogStore.getCatalogImage(c.req.param('id'));
    if (!image) return jsonNotFound(c);
    const job = image.jobId ? getJob(image.jobId) : null;
    const metadata = job
      ? jobImageMetadata(job)
      : ((await extractMetadata(image.filePath)) ?? catalogImageMetadata(image));
    const result = await embedMetadata(image.filePath, {
      negativePrompt: image.negativePrompt,
      aspectRatio: image.aspectRatio,
      imageSize: image.imageSize,
      recipe: image.recipeId,
      batchId: image.batchId,
      generatedAt: image.createdAt,
      studioVersion: '0.0.0',
      ...metadata,
      libraryId: image.libraryId,
      catalogId: image.id,
    });
    updateCatalogImageFileSize(image.id, result.bytesWritten);
    return c.json(result);
  });

  return routes;
}

export function createMemoryCatalogStore(
  images: CatalogImage[],
  onQuery?: (filters: Parameters<StudioCatalogStore['queryCatalog']>[0]) => void,
): StudioCatalogStore {
  const byId = new Map(images.map((image) => [image.id, image]));
  let collectionSequence = 0;
  const tags = new Map<string, Map<string, CatalogTag>>();
  const collections = new Map<
    string,
    {
      id: string;
      workspaceId: string;
      name: string;
      emoji?: string | null;
      lastUsedAt?: string | null;
      imageIds: string[];
      createdAt: string;
      updatedAt: string;
    }
  >();
  const workspaceImages = (workspaceId: string, imageIds: string[]) =>
    imageIds.filter((id) => {
      const image = byId.get(id);
      return Boolean(image && !image.isDeleted && (image.workspaceId ?? 'default') === workspaceId);
    });
  const toCollection = (collection: {
    id: string;
    workspaceId: string;
    name: string;
    emoji?: string | null;
    lastUsedAt?: string | null;
    imageIds: string[];
    createdAt: string;
    updatedAt: string;
  }) => ({
    id: collection.id,
    workspaceId: collection.workspaceId,
    name: collection.name,
    emoji: collection.emoji ?? null,
    lastUsedAt: collection.lastUsedAt ?? null,
    imageCount: workspaceImages(collection.workspaceId, collection.imageIds).length,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  });
  return {
    listTags(workspaceId) {
      const registry = tags.get(workspaceId) ?? new Map<string, CatalogTag>();
      const counts = new Map<string, number>();
      for (const image of byId.values()) {
        if ((image.workspaceId ?? 'default') !== workspaceId || image.isDeleted) continue;
        for (const name of image.tags) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
          if (!registry.has(name))
            registry.set(name, { name, color: null, imageCount: 0, lastUsedAt: image.createdAt });
        }
      }
      tags.set(workspaceId, registry);
      return [...registry.values()]
        .map((tag) => ({ ...tag, imageCount: counts.get(tag.name) ?? 0 }))
        .sort(
          (a, b) =>
            (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || a.name.localeCompare(b.name),
        );
    },
    createTag(workspaceId, name, color) {
      if (this.listTags(workspaceId).some((tag) => tag.name === name))
        throw new Error('A tag with that name already exists in this workspace.');
      const tag = { name, color, imageCount: 0, lastUsedAt: null };
      const registry = tags.get(workspaceId);
      if (!registry) throw new Error('Tag registry was not initialized.');
      registry.set(name, tag);
      return tag;
    },
    updateTag(workspaceId, name, patch) {
      const list = this.listTags(workspaceId);
      const current = list.find((tag) => tag.name === name);
      if (!current) return null;
      if (patch.name && patch.name !== name && list.some((tag) => tag.name === patch.name))
        throw new Error('A tag with that name already exists in this workspace.');
      const next = { ...current, ...patch };
      for (const image of byId.values()) {
        if ((image.workspaceId ?? 'default') === workspaceId)
          image.tags = [...new Set(image.tags.map((tag) => (tag === name ? next.name : tag)))];
      }
      const registry = tags.get(workspaceId);
      if (!registry) throw new Error('Tag registry was not initialized.');
      registry.delete(name);
      registry.set(next.name, next);
      return next;
    },
    getCatalogImage: (id) => byId.get(id) ?? null,
    listCatalogImageIds(filters = {}) {
      const ids: string[] = [];
      const filterIds = filters.ids && filters.ids.length > 0 ? new Set(filters.ids) : null;
      for (const image of byId.values()) {
        if (filterIds && !filterIds.has(image.id)) continue;
        if (
          filters.workspaceId !== undefined &&
          (image.workspaceId ?? 'default') !== filters.workspaceId
        ) {
          continue;
        }
        if (filters.batchId && image.batchId !== filters.batchId) continue;
        if (filters.isDeleted !== undefined && image.isDeleted !== filters.isDeleted) continue;
        ids.push(image.id);
      }
      return ids;
    },
    queryCatalog(filters = {}) {
      onQuery?.(filters);
      return {
        images,
        total: images.length,
        hasMore: false,
      };
    },
    queryWorkspaceSummaries(filters = {}) {
      const summaries = new Map<
        string,
        {
          images: CatalogImage[];
          imageCount: number;
          totalFileSizeBytes: number;
          knownFileSizeCount: number;
          libraryIds: Set<string>;
        }
      >();

      for (const image of byId.values()) {
        if (image.isDeleted !== Boolean(filters.isDeleted)) continue;
        if (filters.libraryId && image.libraryId !== filters.libraryId) continue;

        const workspaceId = image.workspaceId ?? 'default';
        const summary =
          summaries.get(workspaceId) ??
          ({
            images: [],
            imageCount: 0,
            totalFileSizeBytes: 0,
            knownFileSizeCount: 0,
            libraryIds: new Set<string>(),
          } satisfies {
            images: CatalogImage[];
            imageCount: number;
            totalFileSizeBytes: number;
            knownFileSizeCount: number;
            libraryIds: Set<string>;
          });

        summary.images.push(image);
        summary.imageCount += 1;
        summary.libraryIds.add(image.libraryId);
        if (image.fileSizeBytes !== null) {
          summary.totalFileSizeBytes += image.fileSizeBytes;
          summary.knownFileSizeCount += 1;
        }
        summaries.set(workspaceId, summary);
      }

      return [...summaries.entries()]
        .map(([workspaceId, summary]) => {
          const lastImage =
            summary.images.toSorted((left, right) =>
              right.createdAt.localeCompare(left.createdAt),
            )[0] ?? null;

          return {
            workspaceId,
            imageCount: summary.imageCount,
            totalFileSizeBytes: summary.totalFileSizeBytes,
            knownFileSizeCount: summary.knownFileSizeCount,
            libraryIds: [...summary.libraryIds],
            firstCreatedAt:
              summary.images.toSorted((left, right) =>
                left.createdAt.localeCompare(right.createdAt),
              )[0]?.createdAt ?? null,
            latestCreatedAt: lastImage?.createdAt ?? null,
            sampleFilePath: lastImage?.filePath ?? null,
            lastImage: lastImage ? { ...lastImage, generationConfig: null } : null,
          };
        })
        .sort((left, right) =>
          (right.latestCreatedAt ?? '').localeCompare(left.latestCreatedAt ?? ''),
        );
    },
    registerCatalogImage(input) {
      const image = {
        id: `image-${byId.size + 1}`,
        libraryId: input.libraryId ?? 'library-1',
        filePath: input.filePath,
        thumbnailPath: input.thumbnailPath ?? null,
        publicUrl: input.filePath,
        thumbnailUrl: null,
        prompt: input.prompt ?? null,
        negativePrompt: input.negativePrompt ?? null,
        aspectRatio: input.aspectRatio ?? null,
        imageSize: input.imageSize ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        mimeType: input.mimeType,
        fileSizeBytes: input.fileSizeBytes ?? null,
        jobId: input.jobId ?? null,
        workspaceId: input.workspaceId ?? null,
        batchId: input.batchId ?? null,
        recipeId: input.recipeId ?? null,
        isFavorite: false,
        isDeleted: false,
        deletedAt: null,
        tags: input.tags ?? [],
        generationConfig: input.generationConfig ?? null,
        createdAt: '2026-05-26T00:00:00.000Z',
      } satisfies CatalogImage;
      byId.set(image.id, image);
      return image;
    },
    updateCatalogImage: (id, patch) => {
      const image = byId.get(id);
      if (!image) return null;
      const updated = {
        ...image,
        isFavorite: patch.isFavorite ?? image.isFavorite,
        tags: patch.tags ?? image.tags,
        workspaceId: patch.workspaceId === undefined ? image.workspaceId : patch.workspaceId,
      };
      byId.set(id, updated);
      return updated;
    },
    softDeleteCatalogImage: (id) => {
      const image = byId.get(id);
      if (!image) return null;
      const updated = {
        ...image,
        isDeleted: true,
        deletedAt: '2026-05-26T00:00:00.000Z',
      };
      byId.set(id, updated);
      return updated;
    },
    restoreCatalogImage: (id) => {
      const image = byId.get(id);
      if (!image) return null;
      const updated = {
        ...image,
        isDeleted: false,
        deletedAt: null,
      };
      byId.set(id, updated);
      return updated;
    },
    purgeCatalogImage: (id) => {
      const image = byId.get(id) ?? null;
      byId.delete(id);
      return image;
    },
    listCollections(workspaceId) {
      return [...collections.values()]
        .filter((collection) => collection.workspaceId === workspaceId)
        .sort(
          (left, right) =>
            (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '') ||
            left.name.localeCompare(right.name),
        )
        .map(toCollection);
    },
    listCollectionSelection(workspaceId, imageIds) {
      const selected = new Set(workspaceImages(workspaceId, imageIds));
      return [...collections.values()]
        .filter((collection) => collection.workspaceId === workspaceId)
        .sort(
          (left, right) =>
            (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '') ||
            left.name.localeCompare(right.name),
        )
        .map((collection) => ({
          ...toCollection(collection),
          selectedImageCount: collection.imageIds.filter((id) => selected.has(id)).length,
        }));
    },
    createCollection(input) {
      const nameKey = input.name.toLowerCase();
      if (
        [...collections.values()].some(
          (collection) =>
            collection.workspaceId === input.workspaceId &&
            collection.name.toLowerCase() === nameKey,
        )
      ) {
        throw new Error('A collection with that name already exists in this workspace.');
      }
      const imageIds = workspaceImages(input.workspaceId, input.imageIds);
      if (input.imageIds.length && imageIds.length === 0)
        throw new Error('None of those images are in this workspace.');
      const collection = {
        id: `collection-${++collectionSequence}`,
        workspaceId: input.workspaceId,
        name: input.name,
        emoji: input.emoji ?? null,
        lastUsedAt: imageIds.length ? new Date().toISOString() : null,
        imageIds,
        createdAt: '2026-05-26T00:00:00.000Z',
        updatedAt: '2026-05-26T00:00:00.000Z',
      };
      collections.set(collection.id, collection);
      return toCollection(collection);
    },
    updateCollection(id, patch) {
      const collection = collections.get(id);
      if (!collection) return null;
      if (patch.emoji !== undefined) collection.emoji = patch.emoji;
      if (patch.name !== undefined) {
        const nameKey = patch.name.toLowerCase();
        if (
          [...collections.values()].some(
            (other) =>
              other.id !== id &&
              other.workspaceId === collection.workspaceId &&
              other.name.toLowerCase() === nameKey,
          )
        ) {
          throw new Error('A collection with that name already exists in this workspace.');
        }
        collection.name = patch.name;
      }
      if (patch.addImageIds) {
        const imageIds = workspaceImages(collection.workspaceId, patch.addImageIds);
        if (imageIds.length === 0) throw new Error('None of those images are in this workspace.');
        collection.imageIds = [...new Set([...collection.imageIds, ...imageIds])];
        collection.lastUsedAt = new Date().toISOString();
      }
      if (patch.removeImageIds) {
        const removed = new Set(patch.removeImageIds);
        collection.imageIds = collection.imageIds.filter((imageId) => !removed.has(imageId));
      }
      collection.updatedAt = '2026-05-26T00:00:01.000Z';
      return toCollection(collection);
    },
    deleteCollection(id) {
      return collections.delete(id);
    },
  };
}
