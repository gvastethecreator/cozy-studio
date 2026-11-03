import { Hono } from 'hono';

import {
  findCatalogDuplicates,
  backfillStorageThumbnails,
  compactStorageInlinePayloadFields,
  readStorageMaintenanceAudit,
  type CompactStorageMaintenanceOptions,
  type ThumbnailBackfillStorageMaintenanceOptions,
  type CatalogDuplicateScanOptions,
} from './storageMaintenance';
import { getDb } from './db/connection';
import { pruneToolingLogs } from './toolingLogMaintenance';

interface MaintenanceRoutesDependencies {
  findDuplicates?: (input: CatalogDuplicateScanOptions) => ReturnType<typeof findCatalogDuplicates>;
  readStorageAudit?: typeof readStorageMaintenanceAudit;
  compactStorage?: typeof compactStorageInlinePayloadFields;
  backfillThumbnails?: typeof backfillStorageThumbnails;
  pruneLogs?: typeof pruneToolingLogs;
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
  readStorageAudit = readStorageMaintenanceAudit,
  compactStorage = compactStorageInlinePayloadFields,
  backfillThumbnails = backfillStorageThumbnails,
  pruneLogs = pruneToolingLogs,
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
    return c.json(
      await findDuplicates({ workspaceId: body.workspaceId.trim(), hashLimit: body.hashLimit }),
    );
  });

  routes.get('/storage/audit', async (c) => c.json(await readStorageAudit()));

  routes.post('/storage/compact', async (c) => {
    const body = await readJsonBody<CompactStorageMaintenanceOptions>(c.req.raw);
    return c.json(
      await compactStorage({
        write: body.write === true,
        vacuum: body.vacuum === true,
        confirm: body.confirm ?? null,
      }),
    );
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
