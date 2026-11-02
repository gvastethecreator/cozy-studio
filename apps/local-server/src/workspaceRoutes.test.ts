import { describe, expect, it, vi } from 'vitest';

import { openTestDatabase } from './db/testDatabase';
import { createWorkspaceInDb, deleteWorkspaceFromDb } from './db/workspaces';
import { createWorkspaceRoutes, type WorkspaceRoutesDependencies } from './workspaceRoutes';

function createRouteHarness() {
  const createCatalogWorkspace: WorkspaceRoutesDependencies['createCatalogWorkspace'] = vi.fn(
    (input) => ({
      id: input.id ?? 'created-workspace',
      name: input.name,
      filter: input.filter ?? {},
      sortOrder: input.sortOrder ?? 'newest',
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    }),
  );
  const routes = createWorkspaceRoutes({
    listCatalogWorkspaces: vi.fn(() => []),
    getCatalogWorkspace: vi.fn(() => null),
    createCatalogWorkspace,
    updateCatalogWorkspace: vi.fn(() => null),
    deleteCatalogWorkspace: vi.fn(() => false),
    trashWorkspaceImages: vi.fn(),
  });
  return { routes, createCatalogWorkspace };
}

describe('Workspace API shared boundary', () => {
  it('accepts the canonical StudioWorkspace input shape', async () => {
    const { routes, createCatalogWorkspace } = createRouteHarness();
    const response = await routes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'References',
        filter: { favorite: true },
        sortOrder: 'favorite',
      }),
    });

    expect(response.status).toBe(201);
    expect(createCatalogWorkspace).toHaveBeenCalledWith({
      id: undefined,
      name: 'References',
      filter: { favorite: true },
      sortOrder: 'favorite',
    });
  });

  it('rejects values outside the shared Workspace schema', async () => {
    const { routes, createCatalogWorkspace } = createRouteHarness();
    const response = await routes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Broken', sortOrder: 'manual' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_request_body' });
    expect(createCatalogWorkspace).not.toHaveBeenCalled();
  });
});

describe('deleteWorkspaceFromDb', () => {
  it('trashes the images first, then deletes the tags, collections and row of one workspace', () => {
    const database = openTestDatabase();
    const at = '2026-11-02T00:00:00.000Z';
    database
      .query(
        "INSERT INTO libraries (id, name, path, is_default, created_at) VALUES ('lib', 'Data', '/data', 1, ?)",
      )
      .run(at);
    createWorkspaceInDb(database, { id: 'ws-a', name: 'A' });
    createWorkspaceInDb(database, { id: 'ws-b', name: 'B' });
    database
      .query(`INSERT INTO catalog_images (id, library_id, file_path, public_url, mime_type, workspace_id, created_at)
       VALUES ('image-a', 'lib', '/data/a.png', '/library/lib/a.png', 'image/png', 'ws-a', ?)`)
      .run(at);
    for (const workspaceId of ['ws-a', 'ws-b']) {
      database
        .query("INSERT INTO catalog_tags (workspace_id, name, color) VALUES (?, 'boss', '#fb7185')")
        .run(workspaceId);
      database
        .query(
          `INSERT INTO catalog_organize_history (id, workspace_id, source, changes_json, created_at) VALUES (?, ?, 'ui', '{}', ?)`,
        )
        .run(`organize-${workspaceId}`, workspaceId, at);
    }
    database
      .query(
        "INSERT INTO catalog_collections (id, workspace_id, name, created_at, updated_at) VALUES ('set-a', 'ws-a', 'Set', ?, ?)",
      )
      .run(at, at);
    database
      .query(
        "INSERT INTO catalog_collection_images (collection_id, image_id, added_at) VALUES ('set-a', 'image-a', ?)",
      )
      .run(at);
    const rows = (sql: string) => database.query(sql).all();
    const state = () => ({
      workspaces: rows('SELECT id FROM workspaces ORDER BY id'),
      tags: rows('SELECT workspace_id FROM catalog_tags ORDER BY workspace_id'),
      collections: rows('SELECT id FROM catalog_collections'),
      members: rows('SELECT image_id FROM catalog_collection_images'),
      history: rows('SELECT workspace_id FROM catalog_organize_history ORDER BY workspace_id'),
    });
    const kept = state();
    const trash = vi.fn(() => ({ failed: [] }));

    expect(deleteWorkspaceFromDb(database, 'default', trash)).toMatchObject({ status: 400 });
    expect(deleteWorkspaceFromDb(database, 'missing', trash)).toMatchObject({ status: 404 });
    expect(trash).not.toHaveBeenCalled();

    const failed = [{ id: 'image-a', reason: 'operation_failed' as const }];
    expect(deleteWorkspaceFromDb(database, 'ws-a', () => ({ failed }))).toMatchObject({
      ok: false,
      status: 500,
      failed,
    });
    expect(state()).toEqual(kept);

    // The trash ran, but a live image is still in the workspace.
    expect(deleteWorkspaceFromDb(database, 'ws-a', trash)).toMatchObject({ status: 409 });
    expect(state()).toEqual(kept);

    trash.mockImplementation(() => {
      database.run("UPDATE catalog_images SET is_deleted = 1 WHERE workspace_id = 'ws-a'");
      return { failed: [] };
    });
    expect(deleteWorkspaceFromDb(database, 'ws-a', trash)).toEqual({ ok: true });
    expect(trash).toHaveBeenLastCalledWith('ws-a');
    expect(state()).toEqual({
      workspaces: [{ id: 'default' }, { id: 'ws-b' }],
      tags: [{ workspace_id: 'ws-b' }],
      collections: [],
      members: [],
      history: [{ workspace_id: 'ws-b' }],
    });
    expect(rows('SELECT id, is_deleted FROM catalog_images')).toEqual([
      { id: 'image-a', is_deleted: 1 },
    ]);
  });
});
