import type { Database } from 'bun:sqlite';
import { existsSync, realpathSync, statSync, statfsSync } from 'node:fs';
import { readSchemaVersion } from './db/migrations';

export interface StudioStorage {
  /** Free and total space on the disk that holds the Library, through a junction or a link. */
  libraryFreeBytes: number;
  libraryTotalBytes: number;
  /** The SQLite database with its write-ahead log. */
  databaseBytes: number;
  schemaVersion: number | null;
}

const sizeOf = (path: string) => (existsSync(path) ? statSync(path).size : 0);

export function readStudioStorage(libraryDir: string, database: Database): StudioStorage {
  const disk = statfsSync(realpathSync.native(libraryDir));
  const file = database.filename;
  const onDisk = file && file !== ':memory:';
  return {
    libraryFreeBytes: disk.bavail * disk.bsize,
    libraryTotalBytes: disk.blocks * disk.bsize,
    databaseBytes: onDisk ? sizeOf(file) + sizeOf(`${file}-wal`) : 0,
    schemaVersion: readSchemaVersion(database),
  };
}
