import { describe, expect, it } from 'vitest';

import { openTestDatabase } from './testDatabase';

describe('migrateDatabase', () => {
  it('creates composite catalog indexes for hot workspace and gallery queries', () => {
    const database = openTestDatabase();
    const indexSql = (name: string) =>
      (
        database
          .query("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(name) as { sql: string } | undefined
      )?.sql;

    expect(indexSql('idx_catalog_deleted_created_desc')).toBe(
      'CREATE INDEX idx_catalog_deleted_created_desc ON catalog_images(is_deleted, created_at DESC)',
    );
    expect(indexSql('idx_catalog_workspace_key_deleted_created_desc')).toBe(
      "CREATE INDEX idx_catalog_workspace_key_deleted_created_desc ON catalog_images(COALESCE(workspace_id, 'default'), is_deleted, created_at DESC)",
    );
    expect(indexSql('idx_catalog_deleted_workspace_created_cover')).toBe(
      "CREATE INDEX idx_catalog_deleted_workspace_created_cover ON catalog_images(is_deleted, COALESCE(workspace_id, 'default'), created_at DESC, id DESC, library_id, file_size_bytes)",
    );
    expect(indexSql('idx_jobs_created_desc')).toBe(
      'CREATE INDEX idx_jobs_created_desc ON jobs(created_at DESC)',
    );
    expect(indexSql('idx_job_events_job_id_id')).toBe(
      'CREATE INDEX idx_job_events_job_id_id ON job_events(job_id, id)',
    );
    expect(indexSql('idx_codex_turns_job_updated_desc')).toBe(
      'CREATE INDEX idx_codex_turns_job_updated_desc ON codex_turns(job_id, updated_at DESC)',
    );
  });
});
