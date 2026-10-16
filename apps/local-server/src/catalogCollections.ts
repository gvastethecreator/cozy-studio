import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';

import type {
  CatalogCollection,
  CatalogCollectionPatch,
  CatalogCollectionSelection,
} from '../../../packages/shared/src/catalogCollections';
import { getDb } from './db/connection';

function now() {
  return new Date().toISOString();
}

function isUniqueConstraint(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';
  return code.includes('SQLITE_CONSTRAINT') || /unique/i.test(message);
}

const COLLECTION_SELECT = `
  id, workspace_id, name, emoji, last_used_at, created_at, updated_at,
  (
    SELECT COUNT(*)
    FROM catalog_collection_images AS member
    JOIN catalog_images AS image ON image.id = member.image_id
    WHERE member.collection_id = catalog_collections.id AND image.is_deleted = 0
      AND COALESCE(image.workspace_id, 'default') = catalog_collections.workspace_id
  ) AS image_count
`;

function mapCollection(row: {
  id: string;
  workspace_id: string;
  name: string;
  emoji: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  image_count: number;
}): CatalogCollection {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    emoji: row.emoji,
    lastUsedAt: row.last_used_at,
    imageCount: row.image_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertMembers(
  database: Database,
  collectionId: string,
  workspaceId: string,
  imageIds: string[],
  timestamp: string,
) {
  if (!imageIds.length) return;
  const placeholders = imageIds.map(() => '?').join(', ');
  const matched = database
    .query(
      `SELECT COUNT(*) AS count FROM catalog_images
       WHERE id IN (${placeholders}) AND is_deleted = 0
         AND COALESCE(workspace_id, 'default') = ?`,
    )
    .get(...imageIds, workspaceId) as { count: number } | null;
  if (!matched?.count) throw new Error('None of those images are in this workspace.');
  database
    .query(
      `INSERT OR IGNORE INTO catalog_collection_images (collection_id, image_id, added_at)
       SELECT ?, id, ? FROM catalog_images
       WHERE id IN (${placeholders}) AND is_deleted = 0
         AND COALESCE(workspace_id, 'default') = ?`,
    )
    .run(collectionId, timestamp, ...imageIds, workspaceId);
}

export function listCatalogCollections(workspaceId: string, db?: Database) {
  return (
    getDb(db)
      .query(
        `SELECT ${COLLECTION_SELECT} FROM catalog_collections
         WHERE workspace_id = ? ORDER BY last_used_at DESC, name COLLATE NOCASE ASC, id ASC`,
      )
      .all(workspaceId) as Array<Parameters<typeof mapCollection>[0]>
  ).map(mapCollection);
}

export function getCatalogCollection(id: string, db?: Database) {
  const row = getDb(db)
    .query(`SELECT ${COLLECTION_SELECT} FROM catalog_collections WHERE id = ?`)
    .get(id) as Parameters<typeof mapCollection>[0] | null;
  return row ? mapCollection(row) : null;
}

export function listCatalogCollectionSelection(
  workspaceId: string,
  imageIds: string[],
  db?: Database,
): CatalogCollectionSelection[] {
  const database = getDb(db);
  const selected = database
    .query(
      `SELECT member.collection_id, COUNT(*) AS count
     FROM catalog_collection_images AS member
     JOIN catalog_images AS image ON image.id = member.image_id
     JOIN catalog_collections AS collection ON collection.id = member.collection_id
     WHERE collection.workspace_id = ? AND COALESCE(image.workspace_id, 'default') = ?
       AND image.is_deleted = 0 AND image.id IN (${imageIds.map(() => '?').join(', ')})
     GROUP BY member.collection_id`,
    )
    .all(workspaceId, workspaceId, ...imageIds) as { collection_id: string; count: number }[];
  const counts = new Map(selected.map((row) => [row.collection_id, row.count]));
  return listCatalogCollections(workspaceId, database).map((collection) => ({
    ...collection,
    selectedImageCount: counts.get(collection.id) ?? 0,
  }));
}

export function createCatalogCollection(
  input: { workspaceId: string; name: string; emoji?: string | null; imageIds: string[] },
  db?: Database,
) {
  const database = getDb(db);
  const id = `collection-${randomUUID()}`;
  const timestamp = now();
  try {
    database
      .query(
        `INSERT INTO catalog_collections (id, workspace_id, name, emoji, last_used_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.name,
        input.emoji ?? null,
        input.imageIds.length ? timestamp : null,
        timestamp,
        timestamp,
      );
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new Error('A collection with that name already exists in this workspace.');
    }
    throw error;
  }
  try {
    insertMembers(database, id, input.workspaceId, input.imageIds, timestamp);
  } catch (error) {
    database.query('DELETE FROM catalog_collections WHERE id = ?').run(id);
    throw error;
  }
  const created = getCatalogCollection(id, database);
  if (!created) throw new Error('Could not create the collection.');
  return created;
}

export function updateCatalogCollection(id: string, patch: CatalogCollectionPatch, db?: Database) {
  const database = getDb(db);
  return database.transaction(() => {
    const current = getCatalogCollection(id, database);
    if (!current) return null;
    const timestamp = now();
    if (patch.emoji !== undefined) {
      database
        .query('UPDATE catalog_collections SET emoji = ?, updated_at = ? WHERE id = ?')
        .run(patch.emoji, timestamp, id);
    }
    if (patch.name !== undefined && patch.name !== current.name) {
      try {
        const renamed = database
          .query('UPDATE catalog_collections SET name = ?, updated_at = ? WHERE id = ?')
          .run(patch.name, timestamp, id);
        if (renamed.changes !== 1) return null;
      } catch (error) {
        if (isUniqueConstraint(error)) {
          throw new Error('A collection with that name already exists in this workspace.');
        }
        throw error;
      }
    }
    if (patch.addImageIds) {
      insertMembers(database, id, current.workspaceId, patch.addImageIds, timestamp);
      database
        .query('UPDATE catalog_collections SET last_used_at = ? WHERE id = ?')
        .run(timestamp, id);
    }
    if (patch.removeImageIds?.length) {
      const placeholders = patch.removeImageIds.map(() => '?').join(', ');
      database
        .query(
          `DELETE FROM catalog_collection_images WHERE collection_id = ? AND image_id IN (${placeholders})`,
        )
        .run(id, ...patch.removeImageIds);
    }
    if (patch.addImageIds || patch.removeImageIds) {
      database
        .query('UPDATE catalog_collections SET updated_at = ? WHERE id = ?')
        .run(timestamp, id);
    }
    return getCatalogCollection(id, database);
  })();
}

export function deleteCatalogCollection(id: string, db?: Database) {
  return getDb(db).query('DELETE FROM catalog_collections WHERE id = ?').run(id).changes === 1;
}
