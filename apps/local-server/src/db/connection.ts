import type { Database } from 'bun:sqlite';
import { createRequire } from 'node:module';

import { resolveLibraryPath } from '../library';

let defaultDb: Database | null = null;
const runtimeRequire = createRequire(import.meta.url);

export function getDb(db?: Database) {
  if (db) return db;
  if (!defaultDb) {
    const { Database: DatabaseConstructor } = runtimeRequire(
      'bun:sqlite',
    ) as typeof import('bun:sqlite');
    defaultDb = new DatabaseConstructor(resolveLibraryPath('library.sqlite'));
    // Wait for another connection (maintenance, CLI tools) instead of failing at once with
    // SQLITE_BUSY; an unhandled busy error in the worker takes the whole server down.
    defaultDb.run('PRAGMA busy_timeout = 5000');
    defaultDb.run('PRAGMA journal_mode = WAL');
    defaultDb.run('PRAGMA foreign_keys = ON');
    // Sized for a Library database of several hundred MB. NORMAL is durable with WAL: a commit
    // waits for no fsync, and only a power loss can drop the last commits, never corrupt the file.
    defaultDb.run('PRAGMA synchronous = NORMAL');
    defaultDb.run('PRAGMA cache_size = -65536');
    defaultDb.run('PRAGMA mmap_size = 268435456');
    defaultDb.run('PRAGMA temp_store = MEMORY');
  }
  return defaultDb;
}

export function closeDb(db?: Database) {
  const target = db ?? defaultDb;
  if (!target) return;

  try {
    target.close();
  } catch {
    // Best effort; reset flows can recreate the database afterwards.
  } finally {
    if (!db) defaultDb = null;
  }
}
