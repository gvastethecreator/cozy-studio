import { DatabaseSync } from 'node:sqlite';
import type { Database } from 'bun:sqlite';
import { describe, expect, it, vi } from 'vitest';

import {
  createCatalogTag,
  listCatalogTags,
  recordCatalogTagUse,
  updateCatalogTag,
} from './catalogTags';
import { queryCatalog } from './catalog';
import {
  createCatalogCollection,
  deleteCatalogCollection,
  listCatalogCollections,
  listCatalogCollectionSelection,
  updateCatalogCollection,
} from './catalogCollections';

const testDb = vi.hoisted(() => ({ current: undefined as Database | undefined }));
vi.mock('./db/connection', () => ({ getDb: (db?: Database) => db ?? testDb.current }));

function openTestDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const database = {
    query: (sql: string) => sqlite.prepare(sql),
    transaction: (work: () => unknown) => () => {
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
  testDb.current = database;
  sqlite.exec(`
    CREATE TABLE catalog_tags (workspace_id TEXT, name TEXT, color TEXT, last_used_at TEXT, PRIMARY KEY(workspace_id, name));
    CREATE TABLE jobs (id TEXT, provider_id TEXT);
    CREATE TABLE catalog_images (
      id TEXT PRIMARY KEY, library_id TEXT, file_path TEXT, thumbnail_path TEXT,
      public_url TEXT, thumbnail_url TEXT, prompt TEXT, negative_prompt TEXT,
      aspect_ratio TEXT, image_size TEXT, width INTEGER, height INTEGER, mime_type TEXT,
      file_size_bytes INTEGER, job_id TEXT, workspace_id TEXT, batch_id TEXT, recipe_id TEXT,
      is_favorite INTEGER, is_deleted INTEGER, deleted_at TEXT, tags TEXT, created_at TEXT
    );
    CREATE TABLE catalog_collections (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, emoji TEXT, last_used_at TEXT
    );
    CREATE UNIQUE INDEX idx_catalog_collections_workspace_name
      ON catalog_collections(workspace_id, name COLLATE NOCASE);
    CREATE TABLE catalog_collection_images (
      collection_id TEXT NOT NULL REFERENCES catalog_collections(id) ON DELETE CASCADE,
      image_id TEXT NOT NULL REFERENCES catalog_images(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL,
      PRIMARY KEY (collection_id, image_id)
    );
  `);
  const insert = sqlite.prepare(
    `INSERT INTO catalog_images (id, workspace_id, prompt, is_favorite, is_deleted, tags, created_at)
     VALUES (?, ?, ?, 0, 0, ?, ?)`,
  );
  insert.run('kept', 'default', 'Alpha boss', '["boss"]', '2026-02-01');
  insert.run('extra', 'default', 'Beta', '[]', '2026-03-01');
  insert.run('other', 'other', 'Alpha', '["boss"]', '2026-01-01');
  return { sqlite, database };
}

describe('catalog collections', () => {
  it('renames valid tags without rewriting malformed legacy tag data', () => {
    const { sqlite, database } = openTestDatabase();
    try {
      const legacy = ['not-json', '{"label":"boss"}', '["boss",42]'];
      for (const [index, tags] of legacy.entries()) {
        sqlite
          .prepare(
            'INSERT INTO catalog_images (id, workspace_id, is_deleted, tags) VALUES (?, ?, 0, ?)',
          )
          .run(`invalid-${index}`, 'default', tags);
      }
      createCatalogTag('default', 'boss', null, database);
      expect(() => listCatalogTags('default', database)).not.toThrow();
      expect(updateCatalogTag('default', 'boss', { name: 'hero' }, database)).toMatchObject({
        name: 'hero',
      });
      expect(sqlite.prepare('SELECT tags FROM catalog_images WHERE id = ?').get('kept')).toEqual({
        tags: '["hero"]',
      });
      for (const [index, tags] of legacy.entries()) {
        expect(
          sqlite.prepare('SELECT tags FROM catalog_images WHERE id = ?').get(`invalid-${index}`),
        ).toEqual({ tags });
      }
    } finally {
      sqlite.close();
    }
  });

  it('preserves appearance, recency and workspace membership when renaming organization entries', () => {
    const { sqlite, database } = openTestDatabase();
    createCatalogTag('default', 'boss', '#818cf8', database);
    recordCatalogTagUse('default', ['boss'], database);
    createCatalogTag('default', 'later', null, database);
    const renamed = updateCatalogTag(
      'default',
      'boss',
      { name: 'hero', color: '#fb7185' },
      database,
    );
    expect(renamed).toMatchObject({
      name: 'hero',
      color: '#fb7185',
      imageCount: 1,
      lastUsedAt: expect.any(String),
    });
    expect(listCatalogTags('default', database).map((tag) => tag.name)).toEqual(['hero', 'later']);
    expect(sqlite.prepare('SELECT tags FROM catalog_images WHERE id = ?').get('kept')).toEqual({
      tags: '["hero"]',
    });
    expect(sqlite.prepare('SELECT tags FROM catalog_images WHERE id = ?').get('other')).toEqual({
      tags: '["boss"]',
    });
    expect(() => updateCatalogTag('default', 'hero', { name: 'later' }, database)).toThrow(
      /already exists/,
    );
    const album = createCatalogCollection(
      { workspaceId: 'default', name: 'Empty', emoji: '🎨', imageIds: [] },
      database,
    );
    expect(album).toMatchObject({ emoji: '🎨', imageCount: 0, lastUsedAt: null });
    const updated = updateCatalogCollection(
      album.id,
      { name: 'Heroes', emoji: '✨', addImageIds: ['kept'] },
      database,
    );
    expect(updated).toMatchObject({
      name: 'Heroes',
      emoji: '✨',
      imageCount: 1,
      lastUsedAt: expect.any(String),
    });
    expect(() =>
      updateCatalogCollection(
        album.id,
        { name: 'Wrong', emoji: '📁', addImageIds: ['other'] },
        database,
      ),
    ).toThrow();
    expect(listCatalogCollections('default', database)[0]).toEqual(updated);
    sqlite.close();
  });

  it('keeps a workspace album and filters the catalog to its live images', () => {
    const { sqlite, database } = openTestDatabase();
    const created = createCatalogCollection(
      { workspaceId: 'default', name: 'Bosses', imageIds: ['kept', 'other', 'missing'] },
      database,
    );
    expect(created.imageCount).toBe(1);
    expect(listCatalogCollectionSelection('default', ['kept', 'extra', 'other'], database)).toEqual(
      [{ ...created, selectedImageCount: 1 }],
    );
    expect(
      listCatalogCollectionSelection('default', ['extra'], database)[0]?.selectedImageCount,
    ).toBe(0);
    expect(listCatalogCollectionSelection('other', ['kept'], database)).toEqual([]);
    expect(
      queryCatalog({ workspaceId: 'default', collectionId: created.id }, database).images.map(
        (image) => image.id,
      ),
    ).toEqual(['kept']);
    expect(
      queryCatalog({ workspaceId: 'default', collectionId: created.id, q: '#boss' }, database)
        .total,
    ).toBe(1);

    expect(() =>
      createCatalogCollection(
        { workspaceId: 'default', name: 'bosses', imageIds: ['extra'] },
        database,
      ),
    ).toThrow(/already exists/);
    sqlite.prepare('UPDATE catalog_images SET workspace_id = ? WHERE id = ?').run('other', 'kept');
    expect(listCatalogCollections('default', database)[0]?.imageCount).toBe(0);
    expect(queryCatalog({ workspaceId: 'other', collectionId: created.id }, database).total).toBe(
      0,
    );
    expect(queryCatalog({ collectionId: created.id }, database).total).toBe(0);
    sqlite
      .prepare('UPDATE catalog_images SET workspace_id = ? WHERE id = ?')
      .run('default', 'kept');
    expect(listCatalogCollections('default', database)[0]?.imageCount).toBe(1);
    sqlite.prepare('UPDATE catalog_images SET is_deleted = 1 WHERE id = ?').run('kept');
    expect(listCatalogCollections('default', database)[0]?.imageCount).toBe(0);
    expect(
      listCatalogCollectionSelection('default', ['kept', 'other'], database)[0]?.selectedImageCount,
    ).toBe(0);
    expect(queryCatalog({ workspaceId: 'default', collectionId: created.id }, database).total).toBe(
      0,
    );

    const added = updateCatalogCollection(created.id, { addImageIds: ['extra'] }, database);
    expect(added?.imageCount).toBe(1);
    expect(deleteCatalogCollection(created.id, database)).toBe(true);
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM catalog_collection_images').get() as {
        count: number;
      },
    ).toEqual({ count: 0 });
    expect(queryCatalog({ workspaceId: 'default' }, database).total).toBe(1);
  });
});
