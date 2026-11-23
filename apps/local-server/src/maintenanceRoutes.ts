import { Hono } from 'hono';

import {
  findCatalogDuplicates,
  backfillStorageThumbnails,
  compactStorageInlinePayloadFields,
  readStorageMaintenanceAuditInWorker,
  StorageMaintenanceBusyError,
  type CompactStorageMaintenanceOptions,
  type ThumbnailBackfillStorageMaintenanceOptions,
  type CatalogDuplicateScanOptions,
} from './storageMaintenance';
import { getDb } from './db/connection';
import { pruneToolingLogs } from './toolingLogMaintenance';

interface MaintenanceRoutesDependencies {
  findDuplicates?: (input: CatalogDuplicateScanOptions) => ReturnType<typeof findCatalogDuplicates>;
  readStorageAudit?: typeof readStorageMaintenanceAuditInWorker;
  compactStorage?: typeof compactStorageInlinePayloadFields;
  backfillThumbnails?: typeof backfillStorageThumbnails;
  pruneLogs?: typeof pruneToolingLogs;
  /** Why Studio should not be locked out of its database now (running or queued jobs), or null. */
  readBusyReason?: () => string | null;
}

async function readJsonBody<T>(request: Request): Promise<Partial<T>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Partial<T>) : {};
  } catch {
    return {};
  }
}

export function createMaintenanceRoutes({
  findDuplicates = (input) => findCatalogDuplicates(getDb(), input),
  readStorageAudit = readStorageMaintenanceAuditInWorker,
  compactStorage = compactStorageInlinePayloadFields,
  backfillThumbnails = backfillStorageThumbnails,
  pruneLogs = pruneToolingLogs,
  readBusyReason = () => null,
}: MaintenanceRoutesDependencies = {}) {
  const routes = new Hono();

  routes.post('/catalog/duplicates', async (c) => {
    const body = await readJsonBody<CatalogDuplicateScanOptions>(c.req.raw);
    if (typeof body.workspaceId !== 'string' || !body.workspaceId.trim()) {
      return c.json({ error: 'workspaceId is required' }, 400);
    }
    if (
      body.hashLimit !== undefined &&
      (!Number.isInteger(body.hashLimit) || body.hashLimit < 1 || body.hashLimit > 50)
    ) {
      return c.json({ error: 'hashLimit must be an integer from 1 to 50' }, 400);
    }
    if (body.retrySkipped !== undefined && typeof body.retrySkipped !== 'boolean') {
      return c.json({ error: 'retrySkipped must be a boolean' }, 400);
    }
    return c.json(
      await findDuplicates({
        workspaceId: body.workspaceId.trim(),
        hashLimit: body.hashLimit,
        ...(body.retrySkipped !== undefined ? { retrySkipped: body.retrySkipped } : {}),
      }),
    );
  });

  routes.get('/storage/audit', async (c) => c.json(await readStorageAudit()));

  routes.post('/storage/compact', async (c) => {
    const body = await readJsonBody<CompactStorageMaintenanceOptions>(c.req.raw);
    const vacuum = body.write === true && body.vacuum === true;
    // VACUUM holds the write lock for its whole run. A job's write would wait on the main thread
    // for up to the 5 s busy timeout and then fail, so VACUUM starts only when no job is active.
    const busyReason = vacuum ? readBusyReason() : null;
    if (busyReason) return c.json({ error: `Compaction with VACUUM is busy: ${busyReason}` }, 409);
    try {
      return c.json(
        await compactStorage({
          write: body.write === true,
          vacuum: body.vacuum === true,
          confirm: body.confirm ?? null,
        }),
      );
    } catch (error) {
      if (error instanceof StorageMaintenanceBusyError)
        return c.json({ error: error.message }, 409);
      throw error;
    }
  });

  routes.post('/storage/thumbnails/backfill', async (c) => {
    const body = await readJsonBody<ThumbnailBackfillStorageMaintenanceOptions>(c.req.raw);
    return c.json(
      await backfillThumbnails({
        write: body.write === true,
        confirm: body.confirm ?? null,
        limit: typeof body.limit === 'number' ? body.limit : undefined,
      }),
    );
  });

  routes.post('/tooling/logs/prune', async (c) => {
    const body = await readJsonBody<{ retainPerTask?: number }>(c.req.raw);
    return c.json(pruneLogs(body.retainPerTask));
  });

  return routes;
}
