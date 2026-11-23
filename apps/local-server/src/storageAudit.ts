import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { StorageMaintenanceAuditReport } from '../../../packages/shared/src';

// No app imports: storageAuditWorker.ts loads this module in a Bun Worker.

export interface SqliteDatabase {
  query(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
  run(sql: string): unknown;
  close(): void;
}

export interface StorageAuditPaths {
  libraryDir: string;
  dbPath: string;
  directories: {
    transcripts: string;
    logs: string;
    references: string;
    outputs: string;
    thumbnails: string;
    toolingLogs: string;
  };
}

export const PAYLOAD_FIELDS = [
  { table: 'jobs', idColumn: 'id', field: 'source_spec_json' },
  { table: 'catalog_images', idColumn: 'id', field: 'generation_config' },
] as const;

const COUNT_TABLES = [
  'jobs',
  'catalog_images',
  'assets',
  'codex_turns',
  'job_events',
  'system_logs',
] as const;

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

export async function openStorageMaintenanceDatabase(
  dbPath: string,
  options: { readonly?: boolean } = {},
) {
  const { Database } = (await import('bun:sqlite')) as {
    Database: new (path: string, options?: { readonly?: boolean }) => SqliteDatabase;
  };
  return options.readonly ? new Database(dbPath, { readonly: true }) : new Database(dbPath);
}

function listFiles(dirPath: string) {
  const files: { path: string; bytes: number }[] = [];
  if (!existsSync(dirPath)) return files;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile()) files.push({ path: entryPath, bytes: statSync(entryPath).size });
    }
  }
  return files;
}

function readDirectoryStats(dirPath: string) {
  const files = listFiles(dirPath);
  return { files: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0) };
}

/**
 * Hashes only files whose size matches another file: a file with a unique size has no duplicate.
 * Hard-linked names share one stored file, so they count once and are not duplicates.
 */
export function readReferenceDedupeStats(dirPath: string) {
  const files = listFiles(dirPath);
  const storedFiles = new Set<string>();
  const bySize = new Map<number, string[]>();
  let bytes = 0;
  for (const file of files) {
    const { dev, ino } = statSync(file.path, { bigint: true });
    const identity = `${dev}:${ino}`;
    if (storedFiles.has(identity)) continue;
    storedFiles.add(identity);
    bytes += file.bytes;
    const group = bySize.get(file.bytes);
    if (group) group.push(file.path);
    else bySize.set(file.bytes, [file.path]);
  }

  const stats = {
    files: files.length,
    bytes,
    uniqueHashes: 0,
    duplicateFiles: 0,
    duplicateBytes: 0,
  };
  for (const [bytes, paths] of bySize) {
    if (paths.length === 1) {
      stats.uniqueHashes += 1;
      continue;
    }
    const hashes = new Set<string>();
    for (const filePath of paths) {
      const sha256 = createHash('sha256').update(readFileSync(filePath)).digest('hex');
      if (hashes.has(sha256)) {
        stats.duplicateFiles += 1;
        stats.duplicateBytes += bytes;
      } else {
        hashes.add(sha256);
      }
    }
    stats.uniqueHashes += hashes.size;
  }
  return stats;
}

function readCountStats(db: SqliteDatabase) {
  return Object.fromEntries(
    COUNT_TABLES.map((table) => {
      const row = db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
      return [table, row.count];
    }),
  );
}

function readPayloadFieldStats(db: SqliteDatabase, field: (typeof PAYLOAD_FIELDS)[number]) {
  const row = db
    .query(
      `
      SELECT
        COUNT(*) as rows,
        COALESCE(SUM(LENGTH(${field.field})), 0) as bytes,
        COALESCE(MAX(LENGTH(${field.field})), 0) as maxBytes,
        COALESCE(SUM(CASE WHEN ${field.field} LIKE '%data:image/%' THEN 1 ELSE 0 END), 0) as inlineRows,
        COALESCE(SUM(CASE WHEN ${field.field} LIKE '%data:image/%' THEN LENGTH(${field.field}) ELSE 0 END), 0) as inlineBytes
      FROM ${field.table}
      WHERE ${field.field} IS NOT NULL
    `,
    )
    .get() as {
    rows: number;
    bytes: number;
    maxBytes: number;
    inlineRows: number;
    inlineBytes: number;
  };

  return {
    table: field.table,
    field: field.field,
    rows: row.rows,
    bytes: row.bytes,
    formattedBytes: formatBytes(row.bytes),
    maxBytes: row.maxBytes,
    formattedMaxBytes: formatBytes(row.maxBytes),
    inlineRows: row.inlineRows,
    inlineBytes: row.inlineBytes,
    formattedInlineBytes: formatBytes(row.inlineBytes),
  };
}

function readCatalogMaintenanceStats(db: SqliteDatabase) {
  return db
    .query(
      `
      SELECT
        COUNT(*) as rows,
        COALESCE(SUM(CASE WHEN thumbnail_path IS NULL OR thumbnail_url IS NULL THEN 1 ELSE 0 END), 0) as missingThumbnails
      FROM catalog_images
      WHERE is_deleted = 0
    `,
    )
    .get() as { rows: number; missingThumbnails: number };
}

function readDatabaseFileStats(dbPath: string) {
  const databaseBytes = existsSync(dbPath) ? statSync(dbPath).size : 0;
  const walBytes = existsSync(`${dbPath}-wal`) ? statSync(`${dbPath}-wal`).size : 0;
  const shmBytes = existsSync(`${dbPath}-shm`) ? statSync(`${dbPath}-shm`).size : 0;
  return {
    bytes: databaseBytes,
    formattedBytes: formatBytes(databaseBytes),
    walBytes,
    shmBytes,
  };
}

export async function readStorageAuditReport(
  paths: StorageAuditPaths,
): Promise<StorageMaintenanceAuditReport> {
  const db = await openStorageMaintenanceDatabase(paths.dbPath, { readonly: true });
  try {
    const referenceDedupe = readReferenceDedupeStats(paths.directories.references);

    return {
      libraryDir: paths.libraryDir,
      dbPath: paths.dbPath,
      database: readDatabaseFileStats(paths.dbPath),
      counts: readCountStats(db),
      payloadFields: PAYLOAD_FIELDS.map((field) => readPayloadFieldStats(db, field)),
      catalog: readCatalogMaintenanceStats(db),
      references: {
        ...referenceDedupe,
        formattedDuplicateBytes: formatBytes(referenceDedupe.duplicateBytes),
      },
      directories: Object.fromEntries(
        Object.entries(paths.directories).map(([key, dirPath]) => {
          const value =
            key === 'references'
              ? { files: referenceDedupe.files, bytes: referenceDedupe.bytes }
              : readDirectoryStats(dirPath);
          return [key, { ...value, formattedBytes: formatBytes(value.bytes) }];
        }),
      ),
    };
  } finally {
    db.close();
  }
}
