import type { Database } from 'bun:sqlite';
import {
  validateCatalogTags,
  type CatalogTag,
  type CatalogTagPatch,
} from '../../../packages/shared/src/catalogTags';
import { getDb } from './db/connection';

const catalogTagArraySql = `CASE WHEN json_valid(image.tags)
  THEN CASE WHEN json_type(image.tags) = 'array' THEN image.tags ELSE '[]' END
  ELSE '[]' END`;

export function recordCatalogTagUse(workspaceId: string, tags: string[], db?: Database) {
  const database = getDb(db);
  const timestamp = new Date().toISOString();
  for (const tag of tags) {
    database
      .query(`INSERT INTO catalog_tags (workspace_id, name, last_used_at) VALUES (?, ?, ?)
      ON CONFLICT(workspace_id, name) DO UPDATE SET last_used_at = excluded.last_used_at`)
      .run(workspaceId, tag, timestamp);
  }
}

// Reads the workspace's image tags once. A per-tag subquery over catalog_images rescans every live
// image for each tag, which blocked the server for minutes on a large Library.
export function listCatalogTags(workspaceId: string, db?: Database): CatalogTag[] {
  return getDb(db)
    .query(`WITH image_tag AS MATERIALIZED (
      SELECT DISTINCT image.id AS image_id, tag_value.value AS name
      FROM catalog_images image, json_each(${catalogTagArraySql}) AS tag_value
      WHERE COALESCE(image.workspace_id, 'default') = ?1 AND image.is_deleted = 0
    )
    SELECT tag.name, tag.color, tag.last_used_at AS lastUsedAt,
      (SELECT COUNT(DISTINCT image_id) FROM image_tag WHERE image_tag.name = tag.name) AS imageCount
    FROM catalog_tags tag WHERE tag.workspace_id = ?1 ORDER BY tag.last_used_at DESC, tag.name ASC`)
    .all(workspaceId) as CatalogTag[];
}

export function createCatalogTag(
  workspaceId: string,
  name: string,
  color: string | null,
  db?: Database,
): CatalogTag {
  const database = getDb(db);
  if (
    database
      .query('SELECT 1 FROM catalog_tags WHERE workspace_id = ? AND name = ?')
      .get(workspaceId, name)
  ) {
    throw new Error('A tag with that name already exists in this workspace.');
  }
  database
    .query('INSERT INTO catalog_tags (workspace_id, name, color) VALUES (?, ?, ?)')
    .run(workspaceId, name, color);
  return { name, color, imageCount: 0, lastUsedAt: null };
}

export function updateCatalogTag(
  workspaceId: string,
  name: string,
  patch: CatalogTagPatch,
  db?: Database,
) {
  const database = getDb(db);
  const current = listCatalogTags(workspaceId, database).find((tag) => tag.name === name);
  if (!current) return null;
  const nextName = patch.name ?? name;
  if (
    nextName !== name &&
    database
      .query('SELECT 1 FROM catalog_tags WHERE workspace_id = ? AND name = ?')
      .get(workspaceId, nextName)
  ) {
    throw new Error('A tag with that name already exists in this workspace.');
  }
  database.transaction(() => {
    if (nextName !== name) {
      const images = database
        .query(`SELECT image.id, image.tags FROM catalog_images image WHERE COALESCE(image.workspace_id, 'default') = ?
        AND EXISTS (SELECT 1 FROM json_each(${catalogTagArraySql}) WHERE value = ?)`)
        .all(workspaceId, name) as { id: string; tags: string }[];
      for (const image of images) {
        let currentTags: string[];
        try {
          currentTags = validateCatalogTags(JSON.parse(image.tags));
        } catch {
          // Preserve invalid legacy values rather than replacing their stored data.
          continue;
        }
        const tags = [...new Set(currentTags.map((tag) => (tag === name ? nextName : tag)))];
        database
          .query('UPDATE catalog_images SET tags = ? WHERE id = ?')
          .run(JSON.stringify(tags), image.id);
      }
    }
    database
      .query('UPDATE catalog_tags SET name = ?, color = ? WHERE workspace_id = ? AND name = ?')
      .run(nextName, patch.color === undefined ? current.color : patch.color, workspaceId, name);
  })();
  return {
    ...current,
    name: nextName,
    color: patch.color === undefined ? current.color : patch.color,
  };
}
