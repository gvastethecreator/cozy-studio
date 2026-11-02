import { Hono } from 'hono';
import {
  CATALOG_PURGE_CONFIRMATION,
  CATALOG_SORT_OPTIONS,
  CatalogOrganizeError,
  parseCatalogOrganizeInput,
  validateCatalogCollectionImageIds,
  validateCatalogCollectionName,
  validateCatalogCollectionWorkspaceId,
  type CatalogCollectionPatch,
  type CatalogTagPatch,
  normalizeImageHashtag,
  validateTagColor,
  validateCollectionEmoji,
} from '../../../packages/shared/src';

import type { CatalogBatchCommandResult, CatalogCommandFilter } from '../../../packages/shared/src';
import type { CatalogCommandResult } from './catalogCommands';
import type { StudioCatalogStore } from './catalogStore';
import { extractMetadata, type embedMetadata as embedMetadataFn } from './metadataEmbedder';
import type { getJob as getJobFn } from './db/jobs';
import { catalogImageMetadata, jobImageMetadata } from './providers/jobImageMetadata';
import type { updateCatalogImageFileSize as updateCatalogImageFileSizeFn } from './catalog';

interface CatalogCommandsBoundary {
  update(
    id: string,
    patch: { isFavorite?: boolean; workspaceId?: string | null },
  ): CatalogCommandResult;
  softDelete(id: string): CatalogCommandResult;
  restore(id: string): CatalogCommandResult;
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

/** A purge without its confirm token answers code confirmation_required, like a reset. */
class ConfirmationRequiredError extends Error {}

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
    unorganized: searchParams.get('unorganized') === 'true' || undefined,
    favorite: searchParams.has('favorite') ? searchParams.get('favorite') === 'true' : undefined,
    isDeleted: searchParams.get('deleted') === 'true',
    q: searchParams.get('q'),
    sort: CATALOG_SORT_OPTIONS.find((option) => option === searchParams.get('sort')),
    offset: Number(searchParams.get('offset') || 0),
    limit: Number(searchParams.get('limit') || 50),
  };
}

async function readCatalogCommandFilter(
  request: { json: () => Promise<unknown> },
  action: 'archive' | 'restore' | 'purge',
) {
  const { confirm, ...raw } = await readJsonRecord(request);
  if (action === 'purge' && confirm !== CATALOG_PURGE_CONFIRMATION) {
    throw new ConfirmationRequiredError(
      `Send {"confirm":"${CATALOG_PURGE_CONFIRMATION}"} to permanently delete trashed images.`,
    );
  }
  if (
    (action !== 'purge' && confirm !== undefined) ||
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
  // Open windows refresh their Tags and Collections menus, including after agent changes.
  const publishOrganized = (changedCount: number, workspaceId?: string) =>
    publishEvent?.('catalog.batch_changed', {
      action: 'organize',
      changedCount,
      scope: workspaceId ? { kind: 'workspace', workspaceId } : { kind: 'all' },
    });

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
      if (patch.name && patch.name !== c.req.param('name'))
        publishOrganized(updated.imageCount, workspaceId);
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
      const created = catalogStore.createCollection({
        workspaceId: validateCatalogCollectionWorkspaceId(body.workspaceId),
        name: validateCatalogCollectionName(body.name),
        emoji: validateCollectionEmoji(body.emoji ?? null),
        imageIds:
          body.imageIds === undefined || (Array.isArray(body.imageIds) && !body.imageIds.length)
            ? []
            : validateCatalogCollectionImageIds(body.imageIds),
      });
      publishOrganized(created.imageCount, created.workspaceId);
      return c.json(created, 201);
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
      publishOrganized(updated.imageCount, updated.workspaceId);
      return c.json(updated);
    } catch (error) {
      return c.json(collectionError(error), 400);
    }
  });

  routes.delete('/collections/:collectionId', (c) => {
    if (!catalogStore.deleteCollection(c.req.param('collectionId'))) {
      return c.json({ error: 'Collection not found' }, 404);
    }
    // The store does not return the deleted collection's workspace.
    publishOrganized(0);
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
        return c.json(
          catalogCommands[`${action}ByFilter`](await readCatalogCommandFilter(c.req, action)),
        );
      } catch (error) {
        return c.json(
          {
            ...collectionError(error),
            ...(error instanceof ConfirmationRequiredError && { code: 'confirmation_required' }),
          },
          400,
        );
      }
    });
  }

  routes.post('/commands/organize', async (c) => {
    try {
      const body = await c.req.json().catch(() => null);
      const result = catalogStore.organizeImages(parseCatalogOrganizeInput(body));
      const changed = new Set([
        ...Object.values(result.tags.added).flat(),
        ...Object.values(result.tags.removed).flat(),
        ...(result.collection?.addedImageIds ?? []),
        ...(result.removedFrom?.removedImageIds ?? []),
      ]).size;
      if (changed) publishOrganized(changed, result.workspaceId);
      return c.json(result);
    } catch (error) {
      return c.json(
        {
          ...collectionError(error),
          ...(error instanceof CatalogOrganizeError &&
            error.imageIds && { imageIds: error.imageIds }),
        },
        // Input and organize errors are the caller's; a database failure is Studio's.
        error instanceof Error && error.name === 'SQLiteError' ? 500 : 400,
      );
    }
  });

  routes.get('/:id', (c) => {
    const image = catalogStore.getCatalogImage(c.req.param('id'));
    if (!image) return jsonNotFound(c);
    return c.json(image);
  });

  routes.patch('/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('Expected an image update object.');
      }
      // Every tag write goes through the organize command.
      if (['tags', 'addTags', 'removeTags'].some((key) => key in body)) {
        throw new Error('Change tags with POST /api/catalog/commands/organize.');
      }
      const workspaceId: string | null | undefined =
        body.workspaceId === undefined || body.workspaceId === null
          ? body.workspaceId
          : validateCatalogCollectionWorkspaceId(body.workspaceId);
      // An unknown workspace throws before anything is written.
      const result = catalogCommands.update(c.req.param('id'), {
        isFavorite: body.isFavorite,
        workspaceId,
      });
      if (!result.ok) return jsonNotFound(c);
      return c.json(result.image);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid update' }, 400);
    }
  });

  routes.delete('/:id', (c) => {
    const result = catalogCommands.softDelete(c.req.param('id'));
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
