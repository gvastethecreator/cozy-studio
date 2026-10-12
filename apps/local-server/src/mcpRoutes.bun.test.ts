import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import {
  referenceImportResult,
  STUDIO_REFERENCE_IMPORT_MAX_BASE64_CHARS,
} from '../../../packages/shared/src/studioMcp';
import { createDefaultEditableStudioSettings } from '../../../packages/shared/src/studioSettings';
import { getCatalogImage, queryCatalog } from './catalog';
import { migrateDatabase } from './db/migrations';
import { createMcpRoutes } from './mcpRoutes';
import { importStudioReference } from './referenceImport';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const LIBRARY_ID = 'library-import-test';

function digest(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function referenceArgs(
  bytes: Buffer,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
  overrides: Record<string, unknown> = {},
) {
  return {
    requestId: 'reference-mcp-import',
    name: 'Forest still',
    mimeType,
    base64: bytes.toString('base64'),
    sha256: digest(bytes),
    ...overrides,
  };
}

function openLibrary(dbPath: string, libraryDir: string) {
  const database = new Database(dbPath, { create: true });
  database.run('PRAGMA foreign_keys = ON');
  migrateDatabase(database);
  if (!database.query('SELECT id FROM libraries WHERE id = ?').get(LIBRARY_ID)) {
    database
      .query(
        'INSERT INTO libraries (id, name, path, is_default, created_at, kind) VALUES (?, ?, ?, 1, ?, ?)',
      )
      .run(LIBRARY_ID, 'Import test library', libraryDir, new Date().toISOString(), 'library');
  }
  return database;
}

function countRows(database: Database, table: 'reference_import_receipts' | 'catalog_images') {
  return (
    database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

function importFileNames(libraryDir: string) {
  const directory = path.join(libraryDir, '.studio', 'references', 'imports');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => !name.endsWith('.partial'));
}

describe('studio_import_reference', () => {
  it('rejects reference import without write access, a valid digest, image contents, paths, or the size limit', async () => {
    const libraryDir = mkdtempSync(path.join(os.tmpdir(), 'studio-reference-import-reject-'));
    const dbPath = path.join(libraryDir, 'library.sqlite');
    let database: Database | null = null;
    try {
      database = openLibrary(dbPath, libraryDir);
      const settings = createDefaultEditableStudioSettings();
      let imports = 0;
      const app = new Hono().route(
        '/api/mcp',
        createMcpRoutes({
          readSettings: () => settings,
          importReference: async (input) => {
            imports += 1;
            return importStudioReference(input, {
              database: database!,
              library: { id: LIBRARY_ID, path: libraryDir },
            });
          },
          request: async () => Response.json({ ok: true }),
        }),
      );
      const call = (args: unknown) =>
        app.request('/api/mcp/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'studio_import_reference', arguments: args }),
        });
      const png = referenceArgs(ONE_BY_ONE_PNG, 'image/png');
      const denied = await call(png);
      expect(denied.status).toBe(403);
      expect(imports).toBe(0);

      settings.mcpAccess = 'write';
      const jpeg = Buffer.from(await new Bun.Image(ONE_BY_ONE_PNG).jpeg().bytes());
      const wide = Buffer.from(
        await new Bun.Image(ONE_BY_ONE_PNG).resize(2561, 2, { fit: 'fill' }).png().bytes(),
      );
      const rejected = [
        await call({ ...png, sha256: '0'.repeat(64) }),
        await call({ ...png, sha256: digest(ONE_BY_ONE_PNG).toUpperCase() }),
        await call(
          referenceArgs(Buffer.from('not-an-image'), 'image/png', {
            sha256: digest(Buffer.from('not-an-image')),
          }),
        ),
        await call(referenceArgs(jpeg, 'image/png')),
        await call({ ...png, localPath: 'C:/secret/reference.png' }),
        await call({ ...png, filePath: libraryDir }),
        await call({ ...png, name: '../secret.png' }),
        await call({ ...png, name: '..' }),
        await call({ ...png, base64: 'A'.repeat(STUDIO_REFERENCE_IMPORT_MAX_BASE64_CHARS + 4) }),
        await call(
          referenceArgs(wide, 'image/png', {
            requestId: 'reference-too-wide',
          }),
        ),
      ];
      expect(rejected.map((response) => response.status)).toEqual(Array(rejected.length).fill(400));
      expect(imports).toBe(4);
      expect(countRows(database, 'reference_import_receipts')).toBe(0);
      expect(countRows(database, 'catalog_images')).toBe(0);
      expect(importFileNames(libraryDir)).toEqual([]);
    } finally {
      database?.close();
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it('keeps one catalog id across a reopened database and accepts it for image edit', async () => {
    const libraryDir = mkdtempSync(path.join(os.tmpdir(), 'studio-reference-import-'));
    const dbPath = path.join(libraryDir, 'library.sqlite');
    let database = openLibrary(dbPath, libraryDir);
    try {
      const settings = createDefaultEditableStudioSettings();
      settings.mcpAccess = 'write';
      const requests: { path: string; body: unknown }[] = [];
      const build = () =>
        new Hono().route(
          '/api/mcp',
          createMcpRoutes({
            readSettings: () => settings,
            importReference: (input) =>
              importStudioReference(input, {
                database,
                library: { id: LIBRARY_ID, path: libraryDir },
              }),
            request: async (requestPath, init) => {
              requests.push({
                path: requestPath,
                body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
              });
              if (requestPath.startsWith('/api/catalog/')) {
                const imageId = decodeURIComponent(requestPath.slice('/api/catalog/'.length));
                const image = getCatalogImage(imageId, database);
                return image
                  ? Response.json(image)
                  : Response.json({ error: 'Catalog image not found' }, { status: 404 });
              }
              if (requestPath.startsWith('/api/catalog')) return Response.json(queryCatalog({}, database));
              return Response.json({ ok: true });
            },
          }),
        );
      let app = build();
      const call = (name: string, args: unknown) =>
        app.request('/api/mcp/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, arguments: args }),
        });
      const input = referenceArgs(ONE_BY_ONE_PNG, 'image/png');
      const created = await call('studio_import_reference', input);
      expect(created.status).toBe(200);
      const createdBody = referenceImportResult.parse(await created.json());
      expect(createdBody).toEqual({
        requestId: input.requestId,
        catalogImageId: createdBody.catalogImageId,
        sha256: input.sha256,
        mimeType: 'image/png',
        byteLength: ONE_BY_ONE_PNG.length,
      });
      expect(createdBody).not.toHaveProperty('filePath');
      expect(JSON.stringify(createdBody)).not.toContain(libraryDir);

      database.close();
      database = openLibrary(dbPath, libraryDir);
      app = build();
      const retried = await call('studio_import_reference', input);
      expect(retried.status).toBe(200);
      expect(await retried.json()).toEqual(createdBody);
      expect(await importStudioReference(input, {
        database,
        library: { id: 'another-library', path: path.join(libraryDir, 'another') },
      })).toEqual(createdBody);
      expect(countRows(database, 'catalog_images')).toBe(1);
      expect(countRows(database, 'reference_import_receipts')).toBe(1);

      const image = getCatalogImage(createdBody.catalogImageId, database);
      expect(image).toMatchObject({
        id: createdBody.catalogImageId,
        jobId: null,
        providerId: null,
        recipeId: null,
        batchId: null,
        mimeType: 'image/png',
        prompt: 'Forest still',
        tags: ['imported reference'],
        generationConfig: { source: 'imported reference' },
        isDeleted: false,
      });
      expect(image?.filePath.startsWith(libraryDir)).toBe(true);
      expect(image?.filePath.replaceAll('\\', '/')).toContain('/.studio/references/imports/');
      expect(readFileSync(image!.filePath).equals(ONE_BY_ONE_PNG)).toBe(true);
      expect(importFileNames(libraryDir)).toEqual([path.basename(image!.filePath)]);

      const renamed = await call('studio_import_reference', { ...input, name: 'Other still' });
      expect(renamed.status).toBe(409);
      const jpeg = Buffer.from(await new Bun.Image(ONE_BY_ONE_PNG).jpeg().bytes());
      const conflictingBytes = await call(
        'studio_import_reference',
        referenceArgs(jpeg, 'image/jpeg', { requestId: input.requestId }),
      );
      expect(conflictingBytes.status).toBe(409);
      expect(countRows(database, 'catalog_images')).toBe(1);
      expect(countRows(database, 'reference_import_receipts')).toBe(1);
      expect(importFileNames(libraryDir)).toEqual([path.basename(image!.filePath)]);
      expect(readFileSync(image!.filePath).equals(ONE_BY_ONE_PNG)).toBe(true);
      expect(getCatalogImage(createdBody.catalogImageId, database)?.generationConfig).toEqual({
        source: 'imported reference',
      });

      const duplicate = await call(
        'studio_import_reference',
        referenceArgs(ONE_BY_ONE_PNG, 'image/png', { requestId: 'reference-mcp-import-again' }),
      );
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toEqual({
        ...createdBody,
        requestId: 'reference-mcp-import-again',
      });
      expect(countRows(database, 'catalog_images')).toBe(1);
      expect(countRows(database, 'reference_import_receipts')).toBe(2);
      expect(
        database
          .query('SELECT request_id FROM reference_import_receipts ORDER BY request_id')
          .all(),
      ).toEqual([
        { request_id: 'reference-mcp-import' },
        { request_id: 'reference-mcp-import-again' },
      ]);

      const listed = await call('studio_catalog', {});
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({
        images: [
          {
            id: createdBody.catalogImageId,
            mimeType: 'image/png',
            jobId: null,
            providerId: null,
            recipeId: null,
            tags: ['imported reference'],
            prompt: 'Forest still',
            isDeleted: false,
          },
        ],
        total: 1,
      });

      const generated = await call('studio_generate', {
        requestId: 'batch-imported-reference',
        prompt: 'Edit the imported still',
        task: 'image_edit',
        referenceIds: [createdBody.catalogImageId],
      });
      expect(generated.status).toBe(200);
      expect(requests.at(-1)).toMatchObject({
        path: '/api/jobs/batches',
        body: {
          requestId: 'batch-imported-reference',
          items: [
            {
              providerId: 'chatgpt',
              kind: 'image_edit',
              sourceSpec: { assets: [{ localPath: image?.filePath }] },
            },
          ],
        },
      });
      expect(requests.some((entry) => entry.path.includes('/api/providers'))).toBe(false);
    } finally {
      database.close();
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });
});
