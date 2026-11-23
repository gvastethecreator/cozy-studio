import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { createMaintenanceRoutes } from './maintenanceRoutes';
import {
  compactStorageInlinePayloadFields,
  StorageMaintenanceBusyError,
} from './storageMaintenance';
import { vacuumStorageDatabase } from './storageVacuum';

// Vitest runs on Node: back the bun:sqlite calls of storageMaintenance with node:sqlite.
vi.mock('bun:sqlite', () => ({
  Database: class {
    private readonly db: DatabaseSync;
    constructor(filePath: string, options?: { readonly?: boolean }) {
      this.db = new DatabaseSync(filePath, { readOnly: options?.readonly === true });
    }
    query(sql: string) {
      return this.db.prepare(sql);
    }
    run(sql: string) {
      this.db.exec(sql);
    }
    close() {
      this.db.close();
    }
  },
}));

describe('maintenanceRoutes', () => {
  it('requires a workspace and bounds duplicate scans without accepting a custom threshold', async () => {
    const findDuplicates = vi.fn(async () => ({
      hashedNow: 2,
      pending: 3,
      checked: 2,
      total: 5,
      skipped: 0,
      groups: [],
    }));
    const routes = createMaintenanceRoutes({ findDuplicates });
    for (const body of [
      {},
      null,
      { workspaceId: ' ' },
      { workspaceId: 'default', hashLimit: 51 },
      { workspaceId: 'default', retrySkipped: 'true' },
    ]) {
      const response = await routes.request('/catalog/duplicates', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(findDuplicates).not.toHaveBeenCalled();
    const response = await routes.request('/catalog/duplicates', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'default',
        hashLimit: 2,
        maxDistance: 256,
        retrySkipped: true,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pending: 3, checked: 2, total: 5 });
    expect(findDuplicates).toHaveBeenCalledWith({
      workspaceId: 'default',
      hashLimit: 2,
      retrySkipped: true,
    });
  });

  it('returns the storage audit report', async () => {
    const readStorageAudit = vi.fn(async () => ({
      libraryDir: 'D:/library',
      dbPath: 'D:/library/.studio/studio.sqlite',
      database: { bytes: 1, formattedBytes: '1 B', walBytes: 0, shmBytes: 0 },
      counts: {},
      payloadFields: [],
      catalog: { rows: 0, missingThumbnails: 0 },
      references: {
        files: 0,
        bytes: 0,
        uniqueHashes: 0,
        duplicateFiles: 0,
        duplicateBytes: 0,
        formattedDuplicateBytes: '0 B',
      },
      directories: {},
    }));
    const routes = createMaintenanceRoutes({ readStorageAudit });

    const response = await routes.request('/storage/audit');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ libraryDir: 'D:/library' });
    expect(readStorageAudit).toHaveBeenCalledOnce();
  });

  it('runs compaction as dry-run unless write is requested explicitly', async () => {
    const compactStorage = vi.fn(async (input) => ({
      libraryDir: 'D:/library',
      dbPath: 'D:/library/.studio/studio.sqlite',
      mode: input.write ? ('write' as const) : ('dry-run' as const),
      backup: null,
      vacuumRan: false,
      checkpoint: null,
      results: [],
    }));
    const routes = createMaintenanceRoutes({ compactStorage });

    const response = await routes.request('/storage/compact', { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: 'dry-run' });
    expect(compactStorage).toHaveBeenCalledWith({
      write: false,
      vacuum: false,
      confirm: null,
    });
  });

  it('truncates the WAL right after VACUUM so the database file shrinks at once', async () => {
    const libraryDir = mkdtempSync(path.join(tmpdir(), 'cozy-compact-'));
    const dbPath = path.join(libraryDir, '.studio', 'studio.sqlite');
    mkdirSync(path.dirname(dbPath), { recursive: true });
    // Stands in for the Studio connection that stays open, so SQLite keeps the WAL file.
    const studioDb = new DatabaseSync(dbPath);
    try {
      studioDb.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE jobs (id TEXT PRIMARY KEY, source_spec_json TEXT);
        CREATE TABLE catalog_images (id TEXT PRIMARY KEY, generation_config TEXT);
      `);
      const inline = JSON.stringify({ dataUrl: `data:image/png;base64,${'A'.repeat(400_000)}` });
      const insert = studioDb.prepare('INSERT INTO jobs VALUES (?, ?)');
      for (let index = 0; index < 20; index += 1) insert.run(`job-${index}`, inline);
      studioDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const bytesBefore = statSync(dbPath).size;
      const routes = createMaintenanceRoutes({
        // The Bun Worker does not exist on Node; run the worker's function in-process.
        compactStorage: (input) =>
          compactStorageInlinePayloadFields(
            { ...input, libraryDir, dbPath },
            { runVacuum: vacuumStorageDatabase },
          ),
      });

      const response = await routes.request('/storage/compact', {
        method: 'POST',
        body: JSON.stringify({ write: true, vacuum: true, confirm: 'compact-inline-payloads' }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        vacuumRan: true,
        checkpoint: { busy: 0 },
      });
      expect(statSync(`${dbPath}-wal`).size).toBe(0);
      expect(statSync(dbPath).size).toBeLessThan(bytesBefore / 10);
    } finally {
      studioDb.close();
      rmSync(libraryDir, { force: true, recursive: true });
    }
  });

  it('refuses VACUUM with 409 while jobs run or another VACUUM is running', async () => {
    const compactStorage = vi.fn(async () => {
      throw new StorageMaintenanceBusyError('A storage compaction with VACUUM is already running.');
    });
    const request = (routes: ReturnType<typeof createMaintenanceRoutes>, vacuum: boolean) =>
      routes.request('/storage/compact', {
        method: 'POST',
        body: JSON.stringify({ write: true, vacuum, confirm: 'compact-inline-payloads' }),
      });

    const busy = createMaintenanceRoutes({
      compactStorage: vi.fn(),
      readBusyReason: () => '2 job(s) running',
    });
    const refused = await request(busy, true);
    expect(refused.status).toBe(409);
    await expect(refused.json()).resolves.toMatchObject({
      error: expect.stringContaining('2 job'),
    });

    // Compaction without VACUUM never takes the write lock for long, so jobs do not block it.
    const withoutVacuum = vi.fn(async () => ({}) as never);
    const allowed = createMaintenanceRoutes({
      compactStorage: withoutVacuum,
      readBusyReason: () => '2 job(s) running',
    });
    expect((await request(allowed, false)).status).toBe(200);

    const concurrent = createMaintenanceRoutes({ compactStorage });
    expect((await request(concurrent, true)).status).toBe(409);
  });

  it('passes bounded thumbnail backfill write confirmation', async () => {
    const backfillThumbnails = vi.fn(async (input) => ({
      libraryDir: 'D:/library',
      dbPath: 'D:/library/.studio/studio.sqlite',
      backup: null,
      mode: input.write ? ('write' as const) : ('dry-run' as const),
      limit: input.limit ?? 100,
      scannedRows: 0,
      plannedRows: 0,
      missingSourceFiles: 0,
      wroteRows: 0,
      errors: 0,
    }));
    const routes = createMaintenanceRoutes({ backfillThumbnails });

    const response = await routes.request('/storage/thumbnails/backfill', {
      method: 'POST',
      body: JSON.stringify({
        write: true,
        confirm: 'backfill-thumbnails',
        limit: 1000,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: 'write', limit: 1000 });
    expect(backfillThumbnails).toHaveBeenCalledWith({
      write: true,
      confirm: 'backfill-thumbnails',
      limit: 1000,
    });
  });

  it('prunes tooling logs with bounded retention', async () => {
    const pruneLogs = vi.fn(() => ({
      logDir: 'D:/repo/logs/tooling',
      retainPerTask: 10,
      pruned: 3,
    }));
    const routes = createMaintenanceRoutes({ pruneLogs });

    const response = await routes.request('/tooling/logs/prune', {
      method: 'POST',
      body: JSON.stringify({ retainPerTask: 10 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ pruned: 3 });
    expect(pruneLogs).toHaveBeenCalledWith(10);
  });
});
