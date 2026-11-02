import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { openTestDatabase } from './testDatabase';

describe('migrateDatabase', () => {
  it('creates composite catalog indexes for hot workspace and gallery queries', () => {
    const source = readFileSync(fileURLToPath(new URL('./migrations.ts', import.meta.url)), 'utf8');

    expect(source).toContain(
      'CREATE INDEX IF NOT EXISTS idx_catalog_deleted_created_desc ON catalog_images(is_deleted, created_at DESC)',
    );
    expect(source).toContain(
      "CREATE INDEX IF NOT EXISTS idx_catalog_workspace_key_deleted_created_desc ON catalog_images(COALESCE(workspace_id, 'default'), is_deleted, created_at DESC)",
    );
    expect(source).toContain(
      "CREATE INDEX IF NOT EXISTS idx_catalog_deleted_workspace_created_cover ON catalog_images(is_deleted, COALESCE(workspace_id, 'default'), created_at DESC, id DESC, library_id, file_size_bytes)",
    );
    expect(source).toContain(
      'CREATE INDEX IF NOT EXISTS idx_jobs_created_desc ON jobs(created_at DESC)',
    );
    expect(source).toContain(
      'CREATE INDEX IF NOT EXISTS idx_job_events_job_id_id ON job_events(job_id, id)',
    );
    expect(source).toContain(
      'CREATE INDEX IF NOT EXISTS idx_codex_turns_job_updated_desc ON codex_turns(job_id, updated_at DESC)',
    );
  });

  it('drops tags of deleted workspaces and cross-workspace collection members, idempotently', () => {
    const database = openTestDatabase();
    const at = '2026-11-02T00:00:00.000Z';
    database
      .query(
        "INSERT INTO libraries (id, name, path, is_default, created_at) VALUES ('lib', 'Data', '/data', 1, ?)",
      )
      .run(at);
    database
      .query("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('ws-a', 'A', ?, ?)")
      .run(at, at);
    const addImage = (id: string, workspaceId: string, isDeleted: number) =>
      database
        .query(`INSERT INTO catalog_images
         (id, library_id, file_path, public_url, mime_type, workspace_id, is_deleted, created_at)
         VALUES (?, 'lib', ?, ?, 'image/png', ?, ?, ?)`)
        .run(id, `/data/${id}.png`, `/library/lib/${id}.png`, workspaceId, isDeleted, at);
    addImage('image-a', 'ws-a', 0);
    addImage('image-b', 'ws-b', 0);
    addImage('image-live', 'ws-live', 0);
    addImage('image-trash', 'ws-trash', 1);
    for (const [workspaceId, name] of [
      ['default', 'x'],
      ['ws-a', 'y'],
      ['ws-gone', 'z'],
      ['ws-live', 'w'],
      ['ws-trash', 't'],
    ]) {
      database
        .query('INSERT INTO catalog_tags (workspace_id, name, color) VALUES (?, ?, ?)')
        .run(workspaceId, name, '#fb7185');
    }
    database
      .query(
        "INSERT INTO catalog_collections (id, workspace_id, name, created_at, updated_at) VALUES ('set-a', 'ws-a', 'Set', ?, ?)",
      )
      .run(at, at);
    for (const imageId of ['image-a', 'image-b']) {
      database
        .query(
          "INSERT INTO catalog_collection_images (collection_id, image_id, added_at) VALUES ('set-a', ?, ?)",
        )
        .run(imageId, at);
    }
    const images = () =>
      database.query('SELECT * FROM catalog_images ORDER BY id').all() as unknown[];
    const imagesBefore = images();

    database.run('DELETE FROM schema_migrations WHERE version IN (15, 16)');
    migrateDatabase(database);
    migrateDatabase(database);

    // A tag stays while its workspace exists or a live image still uses that workspace id.
    expect(
      database.query('SELECT workspace_id, name FROM catalog_tags ORDER BY name').all(),
    ).toEqual([
      { workspace_id: 'ws-live', name: 'w' },
      { workspace_id: 'default', name: 'x' },
      { workspace_id: 'ws-a', name: 'y' },
    ]);
    expect(database.query('SELECT image_id FROM catalog_collection_images').all()).toEqual([
      { image_id: 'image-a' },
    ]);
    expect(images()).toEqual(imagesBefore);
  });
});
