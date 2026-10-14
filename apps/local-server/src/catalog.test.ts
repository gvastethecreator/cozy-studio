import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { Database } from 'bun:sqlite';

import { describe, expect, it, vi } from 'vitest';

import { buildCatalogWorkspaceClause } from './catalogWorkspaceClause';
import { queryCatalog, updateCatalogImage } from './catalog';
import { applyCatalogTagChanges } from '../../../packages/shared/src/catalogTags';

const testDb = vi.hoisted(() => ({ current: undefined as Database | undefined }));
vi.mock('./db/connection', () => ({ getDb: (db?: Database) => db ?? testDb.current }));

describe('buildCatalogWorkspaceClause', () => {
  it('filters and sorts the complete catalog before paging, with stable ties', () => {
    const sqlite = new DatabaseSync(':memory:');
    const database = { query: (sql: string) => sqlite.prepare(sql) } as unknown as Database;
    testDb.current = database;
    try {
      sqlite.exec(`
        CREATE TABLE jobs (id TEXT, provider_id TEXT);
        CREATE TABLE catalog_images (
          id TEXT PRIMARY KEY, library_id TEXT, file_path TEXT DEFAULT '/missing-test-image.png', thumbnail_path TEXT,
          public_url TEXT, thumbnail_url TEXT, prompt TEXT, negative_prompt TEXT,
          aspect_ratio TEXT, image_size TEXT, width INTEGER, height INTEGER, mime_type TEXT,
          file_size_bytes INTEGER, job_id TEXT, workspace_id TEXT, batch_id TEXT, recipe_id TEXT,
          is_favorite INTEGER, is_deleted INTEGER, deleted_at TEXT, tags TEXT, created_at TEXT
        );
      `);
      const insert = sqlite.prepare(`INSERT INTO catalog_images
        (id, workspace_id, prompt, aspect_ratio, is_favorite, is_deleted, tags, created_at)
        VALUES (?, ?, ?, ?, ?, ?, '[]', ?)`);
      insert.run('old', null, 'Zulu', '2:3', 1, 0, '2026-01-01');
      insert.run('middle', 'default', 'Alpha', '16:9', 1, 0, '2026-02-01');
      insert.run('tie', 'default', 'Alpha', '16:9', 1, 0, '2026-02-01');
      insert.run('new', 'default', 'Beta', '1:1', 0, 0, '2026-03-01');
      insert.run('other', 'other', 'Alpha', '1:1', 1, 0, '2025-01-01');
      insert.run('deleted', 'default', 'Alpha', '1:1', 1, 1, '2025-01-01');

      const first = queryCatalog(
        { workspaceId: 'default', favorite: true, sort: 'asc', limit: 1 },
        database,
      );
      expect(first.images.map((image) => image.id)).toEqual(['old']);
      expect(first.total).toBe(3);
      expect(first.hasMore).toBe(true);
      const second = queryCatalog(
        { workspaceId: 'default', favorite: true, sort: 'asc', limit: 1, offset: 1 },
        database,
      );
      const third = queryCatalog(
        { workspaceId: 'default', favorite: true, sort: 'asc', limit: 1, offset: 2 },
        database,
      );
      expect([...first.images, ...second.images, ...third.images].map((image) => image.id)).toEqual(
        ['old', 'middle', 'tie'],
      );
      expect(third.hasMore).toBe(false);
      expect(
        queryCatalog({ workspaceId: 'default', favorite: true, q: 'Alpha' }, database).total,
      ).toBe(2);
      const expected = {
        desc: ['new', 'tie', 'middle', 'old'],
        asc: ['old', 'middle', 'tie', 'new'],
        prompt: ['middle', 'tie', 'new', 'old'],
        prompt_desc: ['old', 'new', 'tie', 'middle'],
        ratio: ['middle', 'tie', 'new', 'old'],
        id: ['middle', 'new', 'old', 'tie'],
      } as const;
      for (const sort of Object.keys(expected) as Array<keyof typeof expected>) {
        expect(
          queryCatalog({ workspaceId: 'default', sort }, database).images.map((image) => image.id),
        ).toEqual(expected[sort]);
      }
      updateCatalogImage('old', {
        tags: applyCatalogTagChanges(['imported reference', 'ACCIÓN'], {
          addTags: ['jefe', 'bosque', 'pixel_art', 'acción'],
        }),
      });
      updateCatalogImage('middle', { tags: ['jefe'] });
      updateCatalogImage('tie', { tags: ['jefe', 'bosque'] });
      updateCatalogImage('new', { tags: ['jefecito', 'pixelXart'] });
      updateCatalogImage('other', { tags: ['jefe', 'bosque'] });
      updateCatalogImage('deleted', { tags: ['jefe', 'bosque'] });
      expect(sqlite.prepare('SELECT tags FROM catalog_images WHERE id = ?').get('old')).toEqual({
        tags: '["imported reference","ACCIÓN","jefe","bosque","pixel_art","acción"]',
      });
      const tagged = queryCatalog(
        { workspaceId: 'default', q: '#JEFE #bosque', sort: 'asc', limit: 1 },
        database,
      );
      expect(tagged.images.map((image) => image.id)).toEqual(['old']);
      expect(tagged.total).toBe(2);
      expect(tagged.hasMore).toBe(true);
      expect(
        queryCatalog(
          { workspaceId: 'default', q: '#jefe #bosque', sort: 'asc', limit: 1, offset: 1 },
          database,
        ).images.map((image) => image.id),
      ).toEqual(['tie']);
      expect(queryCatalog({ workspaceId: 'default', q: '#jefe' }, database).total).toBe(3);
      expect(queryCatalog({ workspaceId: 'default', q: 'Alpha #jefe' }, database).total).toBe(2);
      expect(
        queryCatalog(
          { workspaceId: 'default', q: '#pixel_art #ACCIO\u0301N' },
          database,
        ).images.map((image) => image.id),
      ).toEqual(['old']);
      expect(queryCatalog({ workspaceId: 'default', q: '#jefe%' }, database).total).toBe(0);
    } finally {
      testDb.current = undefined;
      sqlite.close();
    }
  });

  it('treats the default workspace as default plus legacy null entries', () => {
    expect(buildCatalogWorkspaceClause('default')).toEqual({
      clause: "COALESCE(workspace_id, 'default') = ?",
      params: ['default'],
    });
  });

  it('keeps named workspaces exact and skips empty filters', () => {
    expect(buildCatalogWorkspaceClause('concepts')).toEqual({
      clause: "COALESCE(workspace_id, 'default') = ?",
      params: ['concepts'],
    });
    expect(buildCatalogWorkspaceClause(undefined)).toBeNull();
  });

  it('keeps catalog page queries on explicit summary columns', () => {
    const source = readFileSync(fileURLToPath(new URL('./catalog.ts', import.meta.url)), 'utf8');

    const summaryColumns = source.match(
      /const CATALOG_IMAGE_SUMMARY_COLUMNS = \[[\s\S]*?\]\.join/,
    )?.[0];

    expect(summaryColumns).toBeTruthy();
    expect(summaryColumns).not.toContain('generation_config');
    expect(source).toContain('options.includeGenerationConfig ?');
    expect(source).toContain('includeGenerationConfig: true');
    expect(source).toContain('row.prompt.slice(0, 240)');
    expect(source).toContain("detailLevel: summary ? 'summary' : 'detail'");
  });

  it('keeps workspace aggregation free of large prompt payloads', () => {
    const source = readFileSync(fileURLToPath(new URL('./catalog.ts', import.meta.url)), 'utf8');

    const aggregateColumns = source.match(
      /const CATALOG_WORKSPACE_AGGREGATE_COLUMNS = \[[\s\S]*?\]\.join/,
    )?.[0];

    expect(aggregateColumns).toBeTruthy();
    expect(aggregateColumns).not.toContain('prompt');
    expect(aggregateColumns).not.toContain('negative_prompt');
    expect(aggregateColumns).not.toContain('file_path');
    expect(source).toContain('LEFT JOIN catalog_images AS latest_image');
  });
});
