import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

import {
  DEFAULT_WORKSPACE_ID,
  isDefaultWorkspaceId,
} from '../../../../packages/shared/src/workspaceContracts';
import type {
  StudioWorkspace,
  StudioWorkspaceSortOrder,
} from '../../../../packages/shared/src/workspaceContracts';
import type { CatalogBatchCommandResult } from '../../../../packages/shared/src/types';
import { getDb } from './connection';

export type DeleteWorkspaceResult =
  | { ok: true }
  | {
      ok: false;
      status: 400 | 404 | 409 | 500;
      error: string;
      failed?: CatalogBatchCommandResult['failed'];
    };

function now() {
  return new Date().toISOString();
}

function parseJson(value: string | null) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function readSortOrder(value: unknown): StudioWorkspaceSortOrder {
  return value === 'oldest' || value === 'favorite' ? value : 'newest';
}

function mapWorkspace(row: Record<string, unknown>): StudioWorkspace {
  return {
    id: String(row.id),
    name: typeof row.name === 'string' && row.name.trim() ? row.name : 'Default',
    filter: parseJson(typeof row.filter_json === 'string' ? row.filter_json : null),
    sortOrder: readSortOrder(row.sort_order),
    createdAt: String(row.created_at),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : String(row.created_at),
  };
}

export function getWorkspaceFromDb(database: Database, id: string) {
  const row = database.query('SELECT * FROM workspaces WHERE id = ?').get(id);
  return row ? mapWorkspace(row as Record<string, unknown>) : null;
}

export function ensureDefaultWorkspaceRow(database: Database) {
  const existing = getWorkspaceFromDb(database, DEFAULT_WORKSPACE_ID);
  const timestamp = now();
  if (existing) {
    database
      .query(
        `UPDATE workspaces
         SET name = COALESCE(NULLIF(name, ''), 'Default'),
             updated_at = COALESCE(updated_at, created_at, ?)
         WHERE id = ?`,
      )
      .run(timestamp, DEFAULT_WORKSPACE_ID);
    return getWorkspaceFromDb(database, DEFAULT_WORKSPACE_ID)!;
  }

  database
    .query(
      `INSERT INTO workspaces
       (id, name, filter_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(DEFAULT_WORKSPACE_ID, 'Default', '{}', 'newest', timestamp, timestamp);
  return getWorkspaceFromDb(database, DEFAULT_WORKSPACE_ID)!;
}

export function listWorkspacesFromDb(database: Database) {
  ensureDefaultWorkspaceRow(database);
  return database
    .query('SELECT * FROM workspaces ORDER BY created_at ASC')
    .all()
    .map((row) => mapWorkspace(row as Record<string, unknown>));
}

export function createWorkspaceInDb(
  database: Database,
  input: {
    id?: string;
    name: string;
    filter?: Record<string, unknown>;
    sortOrder?: StudioWorkspaceSortOrder;
  },
) {
  const timestamp = now();
  const workspace: StudioWorkspace = {
    id: input.id?.trim() || randomUUID(),
    name: input.name.trim() || 'Untitled Workspace',
    filter: input.filter ?? {},
    sortOrder: input.sortOrder ?? 'newest',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  database
    .query(
      `INSERT INTO workspaces
       (id, name, filter_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      workspace.id,
      workspace.name,
      JSON.stringify(workspace.filter),
      workspace.sortOrder,
      workspace.createdAt,
      workspace.updatedAt,
    );
  return workspace;
}

export function updateWorkspaceInDb(
  database: Database,
  id: string,
  patch: {
    name?: string;
    filter?: Record<string, unknown>;
    sortOrder?: StudioWorkspaceSortOrder;
  },
) {
  const current = getWorkspaceFromDb(database, id);
  if (!current) return null;
  database
    .query(
      `UPDATE workspaces
       SET name = ?, filter_json = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.name ?? current.name,
      JSON.stringify(patch.filter === undefined ? current.filter : patch.filter),
      patch.sortOrder ?? current.sortOrder,
      now(),
      id,
    );
  return getWorkspaceFromDb(database, id);
}

/**
 * Deletes a workspace with its Library: its live images move to the trash through
 * `trashImages`, then its tags, collections and row go in one transaction.
 */
export function deleteWorkspaceFromDb(
  database: Database,
  id: string,
  trashImages: (workspaceId: string) => Pick<CatalogBatchCommandResult, 'failed'>,
): DeleteWorkspaceResult {
  if (isDefaultWorkspaceId(id)) {
    return { ok: false, status: 400, error: 'The default workspace cannot be deleted.' };
  }
  if (!getWorkspaceFromDb(database, id)) {
    return { ok: false, status: 404, error: 'Workspace not found' };
  }
  // File moves cannot join a SQLite transaction, so they run first. A failure keeps the workspace.
  const { failed } = trashImages(id);
  if (failed.length > 0) {
    return {
      ok: false,
      status: 500,
      failed,
      error: `${failed.length} image(s) could not move to Archived Images. The workspace, its tags and its collections were kept. Try again.`,
    };
  }
  return database.transaction((): DeleteWorkspaceResult => {
    const live = database
      .query(
        'SELECT COUNT(*) AS count FROM catalog_images WHERE workspace_id = ? AND is_deleted = 0',
      )
      .get(id) as { count: number };
    if (live.count > 0) {
      return { ok: false, status: 409, error: 'New images arrived in this workspace. Try again.' };
    }
    database.query('DELETE FROM catalog_tags WHERE workspace_id = ?').run(id);
    database.query('DELETE FROM catalog_organize_history WHERE workspace_id = ?').run(id);
    // Collection members cascade (FK ON DELETE CASCADE).
    database.query('DELETE FROM catalog_collections WHERE workspace_id = ?').run(id);
    database.query('DELETE FROM workspaces WHERE id = ?').run(id);
    return { ok: true };
  })();
}

export function ensureDefaultWorkspace(db?: Database) {
  const database = getDb(db);
  ensureDefaultWorkspaceRow(database);
  return getWorkspaceFromDb(database, DEFAULT_WORKSPACE_ID);
}

export function getWorkspace(id: string, db?: Database) {
  return getWorkspaceFromDb(getDb(db), id);
}

export function listWorkspaces(db?: Database) {
  return listWorkspacesFromDb(getDb(db));
}
