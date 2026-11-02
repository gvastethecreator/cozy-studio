import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';

import {
  CatalogOrganizeError,
  type CatalogCollection,
  type CatalogCollectionPatch,
  type CatalogCollectionSelection,
  type CatalogOrganizeInput,
  type CatalogOrganizeResult,
} from '../../../packages/shared/src/catalogCollections';
import { applyCatalogTagChanges } from '../../../packages/shared/src/catalogTags';
import { recordCatalogTagUse } from './catalogTags';
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

/**
 * Finds or creates a collection by name in the image's workspace and adds the image. It never
 * throws for a missing collection or workspace, because it runs after the asset file has moved.
 */
export function addImageToNamedCollection(
  database: Database,
  input: { imageId: string; workspaceId: string; name: string; timestamp: string },
) {
  const { imageId, workspaceId, name, timestamp } = input;
  // The unique (workspace_id, name NOCASE) index makes this a race-free find-or-create. Without a
  // workspace row (deleted mid-batch) no collection is created.
  database
    .query(
      `INSERT OR IGNORE INTO catalog_collections (id, workspace_id, name, emoji, last_used_at, created_at, updated_at)
       SELECT ?, ?, ?, NULL, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)`,
    )
    .run(
      `collection-${randomUUID()}`,
      workspaceId,
      name,
      timestamp,
      timestamp,
      timestamp,
      workspaceId,
    );
  database
    .query(
      `INSERT OR IGNORE INTO catalog_collection_images (collection_id, image_id, added_at)
       SELECT id, ?, ? FROM catalog_collections WHERE workspace_id = ? AND name = ? COLLATE NOCASE`,
    )
    .run(imageId, timestamp, workspaceId, name);
  database
    .query(
      `UPDATE catalog_collections SET last_used_at = ?, updated_at = ?
       WHERE workspace_id = ? AND name = ? COLLATE NOCASE`,
    )
    .run(timestamp, timestamp, workspaceId, name);
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

function parseTags(value: string | null): string[] {
  try {
    const tags: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Applies one organize call in one transaction. Every image and change is checked before the
 * first write, so a rejected call changes nothing. It never deletes, archives or moves images.
 * It calls no helper that opens its own transaction: the Vitest database cannot nest them.
 */
export function organizeCatalogImages(
  input: CatalogOrganizeInput,
  db?: Database,
): CatalogOrganizeResult {
  const database = getDb(db);
  const { workspaceId, imageIds, addTags, removeTags, addToCollection, removeFromCollection } =
    input;
  const placeholders = imageIds.map(() => '?').join(', ');
  return database.transaction(() => {
    const rows = database
      .query(
        `SELECT id, workspace_id, is_deleted, tags FROM catalog_images WHERE id IN (${placeholders})`,
      )
      .all(...imageIds) as {
      id: string;
      workspace_id: string | null;
      is_deleted: number;
      tags: string | null;
    }[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const outside = imageIds.filter((id) => {
      const row = byId.get(id);
      return !row || row.is_deleted || (row.workspace_id ?? 'default') !== workspaceId;
    });
    if (outside.length)
      throw new CatalogOrganizeError(
        'Every image must be live and in workspaceId. Nothing changed.',
        outside,
      );

    // Per tag, the images that gain or lose it, so an undo touches only those images.
    const added: Record<string, string[]> = {};
    const removed: Record<string, string[]> = {};
    const retagged = new Map<string, string[]>();
    if (addTags || removeTags) {
      const known = (
        database.query('SELECT name FROM catalog_tags WHERE workspace_id = ?').all(workspaceId) as {
          name: string;
        }[]
      ).map(({ name }) => name);
      const record = (byTag: Record<string, string[]>, from: string[], to: string[], id: string) =>
        from.filter((tag) => !to.includes(tag)).forEach((tag) => (byTag[tag] ??= []).push(id));
      const rejected: string[] = [];
      let tagError = '';
      for (const id of imageIds) {
        const current = parseTags(byId.get(id)!.tags);
        try {
          const tags = applyCatalogTagChanges(current, { addTags, removeTags }, known);
          if (tags.join('\n') === current.join('\n')) continue;
          retagged.set(id, tags);
          record(added, tags, current, id);
          record(removed, current, tags, id);
        } catch (error) {
          rejected.push(id);
          tagError = error instanceof Error ? error.message : 'Invalid tags.';
        }
      }
      if (rejected.length) throw new CatalogOrganizeError(`${tagError} Nothing changed.`, rejected);
    }

    const byName = (name: string) =>
      database
        .query(
          'SELECT id, name FROM catalog_collections WHERE workspace_id = ? AND name = ? COLLATE NOCASE',
        )
        .get(workspaceId, name) as { id: string; name: string } | null;
    const target = addToCollection ? byName(addToCollection) : null;
    const removeFrom = removeFromCollection ? byName(removeFromCollection) : null;
    if (removeFromCollection && !removeFrom)
      throw new CatalogOrganizeError(
        'removeFromCollection is not a collection in this workspace. Nothing changed.',
      );
    const membersOf = (collectionId: string) =>
      new Set(
        (
          database
            .query(
              `SELECT image_id FROM catalog_collection_images
               WHERE collection_id = ? AND image_id IN (${placeholders})`,
            )
            .all(collectionId, ...imageIds) as { image_id: string }[]
        ).map(({ image_id }) => image_id),
      );
    const alreadyIn = target ? membersOf(target.id) : new Set<string>();
    const wasIn = removeFrom ? membersOf(removeFrom.id) : new Set<string>();

    // Every check passed; the writes follow.
    const timestamp = now();
    const setTags = database.query('UPDATE catalog_images SET tags = ? WHERE id = ?');
    for (const [id, tags] of retagged) setTags.run(JSON.stringify(tags), id);
    recordCatalogTagUse(workspaceId, Object.keys(added), database);

    let collection: CatalogOrganizeResult['collection'] = null;
    if (addToCollection) {
      const addedImageIds = imageIds.filter((id) => !alreadyIn.has(id));
      let id = target?.id;
      if (id) {
        const insert = database.query(
          'INSERT INTO catalog_collection_images (collection_id, image_id, added_at) VALUES (?, ?, ?)',
        );
        for (const imageId of addedImageIds) insert.run(id, imageId, timestamp);
        database
          .query(
            `UPDATE catalog_collections SET last_used_at = ?,
             updated_at = CASE WHEN ? THEN ? ELSE updated_at END WHERE id = ?`,
          )
          .run(timestamp, addedImageIds.length ? 1 : 0, timestamp, id);
      } else {
        id = createCatalogCollection({ workspaceId, name: addToCollection, imageIds }, database).id;
      }
      const saved = getCatalogCollection(id, database)!;
      collection = {
        id: saved.id,
        name: saved.name,
        created: !target,
        imageCount: saved.imageCount,
        addedImageIds,
      };
    }
    if (removeFrom && wasIn.size) {
      const ids = [...wasIn];
      database
        .query(
          `DELETE FROM catalog_collection_images
           WHERE collection_id = ? AND image_id IN (${ids.map(() => '?').join(', ')})`,
        )
        .run(removeFrom.id, ...ids);
      database
        .query('UPDATE catalog_collections SET updated_at = ? WHERE id = ?')
        .run(timestamp, removeFrom.id);
    }
    return {
      workspaceId,
      imageCount: imageIds.length,
      tags: { added, removed },
      collection,
      removedFrom: removeFrom
        ? {
            id: removeFrom.id,
            name: removeFrom.name,
            removedImageIds: imageIds.filter((id) => wasIn.has(id)),
          }
        : null,
    };
  })();
}
