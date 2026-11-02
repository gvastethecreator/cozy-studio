import type { Database } from 'bun:sqlite';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { migrateDatabase } from './migrations';

/**
 * Test-only. Vitest runs on Node, which has no bun:sqlite, so this opens an in-memory
 * node:sqlite database with the real migrated schema behind the bun:sqlite calls the stores make.
 * Pass it to a store directly, or return it from a `vi.mock('./db/connection')` getDb.
 */
export function openTestDatabase(): Database {
  const sqlite = new DatabaseSync(':memory:');
  const database = {
    run: (sql: string, ...params: SQLInputValue[]) =>
      params.length ? sqlite.prepare(sql).run(...params) : sqlite.exec(sql),
    query: (sql: string) => sqlite.prepare(sql),
    transaction:
      <T>(work: () => T) =>
      () => {
        sqlite.exec('BEGIN');
        try {
          const result = work();
          sqlite.exec('COMMIT');
          return result;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      },
  } as unknown as Database;
  migrateDatabase(database);
  return database;
}
