import { openStorageMaintenanceDatabase } from './storageAudit';

// No app imports: storageVacuumWorker.ts loads this module in a Bun Worker.

export interface VacuumCheckpoint {
  busy: number;
  log: number;
  checkpointed: number;
}

/**
 * VACUUM rewrites the whole database under the write lock, then TRUNCATE shrinks the WAL file
 * that kept the old pages. Both run on a connection of their own: Studio's connection is
 * synchronous, so VACUUM on it would stop every request for the whole run.
 */
export async function vacuumStorageDatabase(dbPath: string): Promise<VacuumCheckpoint> {
  const db = await openStorageMaintenanceDatabase(dbPath);
  try {
    // Studio's own writes are short; wait for them rather than fail with SQLITE_BUSY.
    db.run('PRAGMA busy_timeout = 60000');
    db.run('VACUUM');
    return db.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as VacuumCheckpoint;
  } finally {
    db.close();
  }
}
