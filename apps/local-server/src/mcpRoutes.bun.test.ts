import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import sharp from 'sharp';
import JSZip from 'jszip';
import { createLibraryArchiveRoutes } from './libraryArchiveRoutes';
import { createWorkspaceInDb } from './db/workspaces';
import { createCatalogCollection } from './catalogCollections';
import { libraryArchiveManifest } from '../../../packages/shared/src/libraryArchive';
import {
  referenceImportResult,
  STUDIO_REFERENCE_IMPORT_MAX_BASE64_CHARS,
  STUDIO_REFERENCE_IMPORT_MAX_BYTES,
} from '../../../packages/shared/src/studioMcp';
import { createDefaultEditableStudioSettings } from '../../../packages/shared/src/studioSettings';
import { getCatalogImage, queryCatalog, registerCatalogImage } from './catalog';
import { listCatalogCollections } from './catalogCollections';
import { listCatalogTags } from './catalogTags';
import { migrateDatabase } from './db/migrations';
import { createMcpRoutes } from './mcpRoutes';
import { importStudioReference, importStudioReferenceFile } from './referenceImport';

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
      const wide = await sharp({
        create: { width: 8000, height: 5001, channels: 3, background: 'red' },
      })
        .png()
        .toBuffer();
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
              if (requestPath.startsWith('/api/catalog'))
                return Response.json(queryCatalog({}, database));
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
        storedSha256: createdBody.storedSha256,
        mimeType: 'image/webp',
        byteLength: createdBody.byteLength,
      });
      expect(createdBody).not.toHaveProperty('filePath');
      expect(JSON.stringify(createdBody)).not.toContain(libraryDir);

      database.close();
      database = openLibrary(dbPath, libraryDir);
      app = build();
      const retried = await call('studio_import_reference', input);
      expect(retried.status).toBe(200);
      expect(await retried.json()).toEqual(createdBody);
      expect(
        await importStudioReference(input, {
          database,
          library: { id: 'another-library', path: path.join(libraryDir, 'another') },
        }),
      ).toEqual(createdBody);
      expect(countRows(database, 'catalog_images')).toBe(1);
      expect(countRows(database, 'reference_import_receipts')).toBe(1);

      const image = getCatalogImage(createdBody.catalogImageId, database);
      expect(image).toMatchObject({
        id: createdBody.catalogImageId,
        jobId: null,
        providerId: null,
        recipeId: null,
        batchId: null,
        mimeType: 'image/webp',
        prompt: 'Forest still',
        tags: ['imported reference'],
        generationConfig: { source: 'imported reference' },
        isDeleted: false,
      });
      expect(image?.filePath.startsWith(libraryDir)).toBe(true);
      expect(image?.filePath.replaceAll('\\', '/')).toContain('/.studio/references/imports/');
      const savedBytes = readFileSync(image!.filePath);
      expect(digest(savedBytes)).toBe(createdBody.storedSha256);
      expect(savedBytes.length).toBe(createdBody.byteLength);
      expect(await sharp(savedBytes).raw().toBuffer()).toEqual(
        await sharp(ONE_BY_ONE_PNG).raw().toBuffer(),
      );
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
      expect(readFileSync(image!.filePath)).toEqual(savedBytes);
      expect(getCatalogImage(createdBody.catalogImageId, database)?.generationConfig).toEqual({
        source: 'imported reference',
        sha256: input.sha256,
        storedSha256: createdBody.storedSha256,
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

      const listed = await call('studio_catalog', { workspace_id: 'default' });
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({
        images: [
          {
            id: createdBody.catalogImageId,
            mimeType: 'image/webp',
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
        workspaceId: 'default',
        tags: ['forest'],
        collection: null,
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

  it('limits file imports to allowed real folders and rejects unsafe or invalid files', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'studio-reference-path-security-'));
    const allowed = path.join(root, 'allowed');
    const outside = path.join(root, 'allowed-sibling');
    mkdirSync(allowed);
    mkdirSync(outside);
    const database = openLibrary(path.join(root, 'library.sqlite'), root);
    try {
      const settings = createDefaultEditableStudioSettings();
      const source = path.join(allowed, '..source.png');
      writeFileSync(source, ONE_BY_ONE_PNG);
      writeFileSync(path.join(outside, 'secret.png'), ONE_BY_ONE_PNG);
      writeFileSync(path.join(allowed, 'fake.png'), 'not an image');
      writeFileSync(
        path.join(allowed, 'too-large.png'),
        Buffer.alloc(STUDIO_REFERENCE_IMPORT_MAX_BYTES + 1),
      );
      symlinkSync(outside, path.join(allowed, 'escape'), 'junction');
      const app = new Hono().route(
        '/api/mcp',
        createMcpRoutes({
          readSettings: () => settings,
          importReferenceFile: (input, roots) =>
            importStudioReferenceFile(input, roots, {
              database,
              library: { id: LIBRARY_ID, path: root },
            }),
          request: async () => {
            throw new Error('File import must not call a provider or another route.');
          },
        }),
      );
      const call = (filePath: string, extra = {}) =>
        app.request('/api/mcp/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'studio_import_reference_file',
            arguments: {
              requestId: 'reference-file-security',
              path: filePath,
              ...extra,
            },
          }),
        });
      for (const access of ['off', 'read', 'organize'] as const) {
        settings.mcpAccess = access;
        expect((await call(source)).status).toBe(403);
      }
      settings.mcpAccess = 'write';
      expect(await (await call(source)).json()).toMatchObject({
        error: expect.stringContaining('disabled'),
      });
      settings.mcpAllowedImportRoots = [allowed];
      const rejected = [
        path.join(outside, 'secret.png'),
        `${allowed}${path.sep}..${path.sep}allowed${path.sep}source.png`,
        path.join(allowed, 'escape', 'secret.png'),
        'source.png',
        allowed,
        path.join(allowed, 'fake.png'),
        path.join(allowed, 'too-large.png'),
        path.join(allowed, 'missing.png'),
      ];
      for (const filePath of rejected) {
        const response = await call(filePath);
        expect(response.status).toBe(400);
        const body = await response.text();
        expect(body).not.toContain(root.replaceAll('\\', '\\\\'));
      }
      expect((await call(source, { allowedRoots: [root] })).status).toBe(400);
      expect(countRows(database, 'reference_import_receipts')).toBe(0);
      expect(countRows(database, 'catalog_images')).toBe(0);
      expect(importFileNames(root)).toEqual([]);
      const imported = await call(source);
      expect(imported.status).toBe(200);
      settings.mcpAllowedImportRoots = [];
      expect((await call(source)).status).toBe(400);
      expect(countRows(database, 'catalog_images')).toBe(1);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('optimizes files, preserves alpha and uses their catalog IDs for image edit', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'studio-reference-path-import-'));
    const sourceDir = path.join(root, 'source');
    mkdirSync(sourceDir);
    const dbPath = path.join(root, 'library.sqlite');
    let database = openLibrary(dbPath, root);
    try {
      const settings = createDefaultEditableStudioSettings();
      settings.mcpAccess = 'write';
      settings.mcpAllowedImportRoots = [sourceDir];
      const requests: Array<{ path: string; body: unknown }> = [];
      const build = () =>
        new Hono().route(
          '/api/mcp',
          createMcpRoutes({
            readSettings: () => settings,
            importReferenceFile: (input, roots) =>
              importStudioReferenceFile(input, roots, {
                database,
                library: { id: LIBRARY_ID, path: root },
              }),
            request: async (requestPath, init) => {
              requests.push({
                path: requestPath,
                body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
              });
              if (requestPath.startsWith('/api/catalog/'))
                return Response.json(
                  getCatalogImage(requestPath.slice('/api/catalog/'.length), database),
                );
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
      const examples = [
        {
          width: 1493,
          height: 2000,
          alpha: 0.5,
          format: 'webp',
          expectedWidth: 1493,
          expectedHeight: 2000,
        },
        {
          // Wide and short keeps the 2048 px resize under test without slow full-size encodes.
          width: 4096,
          height: 256,
          alpha: 0.5,
          format: 'png',
          expectedWidth: 2048,
          expectedHeight: 128,
        },
        {
          width: 3072,
          height: 192,
          alpha: 1,
          format: 'jpeg',
          expectedWidth: 2048,
          expectedHeight: 128,
        },
      ] as const;
      for (const example of examples) {
        const bytes = await sharp({
          create: {
            width: example.width,
            height: example.height,
            channels: 4,
            background: { r: 180, g: 70, b: 30, alpha: example.alpha },
          },
        })
          .toFormat(example.format)
          .toBuffer();
        const filePath = path.join(sourceDir, `reference.${example.format}`);
        writeFileSync(filePath, bytes);
        const input = { requestId: `reference-file-${example.format}`, path: filePath };
        const response = await call('studio_import_reference_file', input);
        expect(response.status).toBe(200);
        const result = referenceImportResult.parse(await response.json());
        expect(result.sha256).toBe(digest(bytes));
        expect(result.mimeType).toBe('image/webp');
        const image = getCatalogImage(result.catalogImageId, database)!;
        const stored = readFileSync(image.filePath);
        expect(digest(stored)).toBe(result.storedSha256);
        expect(result.byteLength).toBe(stored.length);
        expect(image).toMatchObject({
          width: example.expectedWidth,
          height: example.expectedHeight,
          mimeType: 'image/webp',
        });
        const metadata = await sharp(stored).metadata();
        expect(metadata.format).toBe('webp');
        if (example.alpha < 1) {
          expect(metadata.hasAlpha).toBe(true);
          const { data, info } = await sharp(stored).raw().toBuffer({ resolveWithObject: true });
          expect(data[info.channels - 1]).toBe(128);
        }
        database.close();
        database = openLibrary(dbPath, root);
        app = build();
        expect(await (await call('studio_import_reference_file', input)).json()).toEqual(result);
        expect(
          (await call('studio_import_reference_file', { ...input, name: 'Changed name' })).status,
        ).toBe(409);
        writeFileSync(filePath, ONE_BY_ONE_PNG);
        expect((await call('studio_import_reference_file', input)).status).toBe(409);
        expect(readFileSync(image.filePath)).toEqual(stored);
        expect(
          (
            await call('studio_generate', {
              requestId: `batch-path-${example.format}`,
              prompt: 'Edit this reference',
              task: 'image_edit',
              referenceIds: [result.catalogImageId],
              workspaceId: 'default',
              tags: [],
              collection: null,
            })
          ).status,
        ).toBe(200);
        expect(requests.at(-1)).toMatchObject({
          path: '/api/jobs/batches',
          body: {
            items: [
              {
                providerId: 'chatgpt',
                kind: 'image_edit',
                sourceSpec: { assets: [{ localPath: image.filePath }] },
              },
            ],
          },
        });
      }
      expect(countRows(database, 'catalog_images')).toBe(examples.length);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('migrates previous receipts without rewriting their image or changing replay identity', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'studio-reference-previous-receipt-'));
    const database = openLibrary(path.join(root, 'library.sqlite'), root);
    try {
      const input = referenceArgs(ONE_BY_ONE_PNG, 'image/png');
      const filePath = path.join(root, 'previous.png');
      writeFileSync(filePath, ONE_BY_ONE_PNG);
      const image = registerCatalogImage(
        {
          libraryId: LIBRARY_ID,
          filePath,
          prompt: input.name,
          width: 1,
          height: 1,
          mimeType: input.mimeType,
          fileSizeBytes: ONE_BY_ONE_PNG.length,
          generationConfig: { source: 'imported reference' },
        },
        database,
      );
      database.run('ALTER TABLE reference_import_receipts DROP COLUMN stored_sha256');
      database.run('DELETE FROM schema_migrations WHERE version = 14');
      const hash = digest(
        Buffer.from(
          JSON.stringify({ mimeType: input.mimeType, name: input.name, sha256: input.sha256 }),
        ),
      );
      database
        .query(`INSERT INTO reference_import_receipts
        (request_id, request_hash, catalog_image_id, sha256, mime_type, byte_length, name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          input.requestId,
          hash,
          image.id,
          input.sha256,
          input.mimeType,
          ONE_BY_ONE_PNG.length,
          input.name,
          new Date().toISOString(),
        );
      migrateDatabase(database);
      const result = await importStudioReference(input, {
        database,
        library: { id: LIBRARY_ID, path: root },
      });
      expect(result).toMatchObject({
        catalogImageId: image.id,
        sha256: input.sha256,
        storedSha256: input.sha256,
        mimeType: 'image/png',
      });
      expect(readFileSync(filePath)).toEqual(ONE_BY_ONE_PNG);
      expect(countRows(database, 'catalog_images')).toBe(1);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('registerCatalogImage filing', () => {
  it('files tags and a named collection with the insert, also inside an outer transaction', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'studio-catalog-filing-'));
    const database = openLibrary(path.join(root, 'library.sqlite'), root);
    try {
      const register = (name: string, collectionName: string, workspaceId = 'default') =>
        registerCatalogImage(
          {
            libraryId: LIBRARY_ID,
            filePath: path.join(root, name),
            mimeType: 'image/png',
            workspaceId,
            tags: ['cover'],
            collectionName,
          },
          database,
        );
      register('a.png', 'Covers');
      database.transaction(() => register('b.png', 'covers'))();
      // A workspace deleted mid-batch gets no orphan collection, and the image is still saved.
      register('c.png', 'Covers', 'deleted-workspace');
      expect(listCatalogCollections('default', database)).toMatchObject([
        { name: 'Covers', imageCount: 2 },
      ]);
      expect(countRows(database, 'catalog_images')).toBe(3);
      expect(database.query('SELECT workspace_id FROM catalog_collections').all()).toEqual([
        { workspace_id: 'default' },
      ]);
      expect(listCatalogTags('default', database)).toMatchObject([
        { name: 'cover', imageCount: 2 },
      ]);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Library archives', () => {
  it('round trips originals and workspace organization with portable metadata and new identities', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'studio-library-archive-'));
    const database = openLibrary(path.join(root, 'library.sqlite'), root);
    try {
      const workspace = createWorkspaceInDb(database, { name: 'Sprites', sortOrder: 'oldest' });
      const png = await sharp({
        create: { width: 2, height: 2, channels: 4, background: '#aa3300' },
      })
        .png()
        .toBuffer();
      const source = ['a', 'b', 'missing'].map((name, index) => {
        const filePath = path.join(root, `${name}.png`);
        if (name !== 'missing') writeFileSync(filePath, png);
        return registerCatalogImage(
          {
            libraryId: LIBRARY_ID,
            workspaceId: workspace.id,
            filePath,
            mimeType: 'image/png',
            width: 2,
            height: 2,
            batchId: 'source-batch',
            isFavorite: index === 0,
            createdAt: '2024-01-02T03:04:05.000Z',
            tags: ['boss'],
            generationConfig: {
              prompt: 'A boss',
              executionReasoningEffort: 'high',
              providerId: 'chatgpt',
              apiKey: 'private-value',
              filePath: 'C:/private/source.png',
              recipeParams: {
                layout: 'grid',
                selectedStyles: [{ presetId: 'ink', presetName: 'Ink', strength: 0.5 }],
                nested: {
                  localPath: 'C:/private/nested.png',
                  token: 'private-token',
                  color: 'red',
                },
              },
              attachments: [
                {
                  name: 'C:/private/source.png',
                  role: 'input',
                  strength: 0.7,
                  localPath: 'C:/private/source.png',
                  sourceUrl: 'file:///private/source.png',
                  dataUrl: 'private-data',
                },
              ],
            },
          },
          database,
        );
      });
      database
        .query('UPDATE catalog_tags SET color = ? WHERE workspace_id = ?')
        .run('#aa3300', workspace.id);
      database
        .query('INSERT INTO catalog_tags (workspace_id, name, color) VALUES (?, ?, ?)')
        .run(workspace.id, 'unused', '#00aa55');
      createCatalogCollection(
        { workspaceId: workspace.id, name: 'Picks', emoji: '⭐', imageIds: [source[0].id] },
        database,
      );
      createCatalogCollection({ workspaceId: workspace.id, name: 'Empty', imageIds: [] }, database);
      const sourceRows = database.query('SELECT * FROM catalog_images ORDER BY id').all();
      const events: unknown[] = [];
      const app = new Hono().route(
        '/api/workspaces',
        createLibraryArchiveRoutes({
          database,
          library: { id: LIBRARY_ID, path: root },
          publishEvent: (type, payload) => events.push({ type, payload }),
        }),
      );
      expect((await app.request('/api/workspaces/unknown/export')).status).toBe(404);
      const response = await app.request(`/api/workspaces/${workspace.id}/export`);
      expect(response.status).toBe(200);
      expect(response.headers.get('X-Archive-Images')).toBe('2');
      expect(response.headers.get('X-Archive-Missing')).toBe('1');
      const archive = Buffer.from(await response.arrayBuffer());
      const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
      const manifest = libraryArchiveManifest.parse(
        JSON.parse(await zip.file('manifest.json')!.async('string')),
      );
      expect(manifest.missing).toEqual([{ id: source[2].id, reason: 'file_missing' }]);
      expect(JSON.stringify(manifest)).not.toContain('private');
      expect(manifest.images[0].generationConfig.recipeParams).toEqual({
        layout: 'grid',
        selectedStyles: [{ presetId: 'ink', presetName: 'Ink', strength: 0.5 }],
        nested: { color: 'red' },
      });
      const upload = () =>
        app.request('/api/workspaces/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip' },
          body: new Uint8Array(archive),
        });
      const importedResponse = await upload();
      expect(importedResponse.status).toBe(201);
      const result = await importedResponse.json();
      expect(result).toMatchObject({
        imported: 2,
        skipped: [],
        workspace: { name: 'Sprites (imported)', sortOrder: 'oldest' },
        missing: manifest.missing,
      });
      expect(result.workspace.id).not.toBe(workspace.id);
      const rows = (
        database
          .query('SELECT id FROM catalog_images WHERE workspace_id = ?')
          .all(result.workspace.id) as { id: string }[]
      ).map(({ id }) => getCatalogImage(id, database)!);
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.isFavorite)).toHaveLength(1);
      expect(new Set(rows.map((row) => row.batchId)).size).toBe(1);
      for (const row of rows) {
        expect(source.map((item) => item.id)).not.toContain(row.id);
        expect(row.batchId).not.toBe('source-batch');
        expect(row.createdAt).toBe('2024-01-02T03:04:05.000Z');
        expect(row.providerId).toBe('chatgpt');
        expect(row.tags).toEqual(['boss']);
        expect(
          row.filePath.startsWith(path.join(root, 'outputs', 'imports', result.workspace.id)),
        ).toBe(true);
        expect(readFileSync(row.filePath)).toEqual(png);
        expect(row.jobId).toBeNull();
        expect(JSON.stringify(row.generationConfig)).not.toContain('localPath');
      }
      expect(
        listCatalogTags(result.workspace.id, database)
          .map(({ name, color }) => ({ name, color }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ).toEqual([
        { name: 'boss', color: '#aa3300' },
        { name: 'unused', color: '#00aa55' },
      ]);
      const collections = listCatalogCollections(result.workspace.id, database);
      expect(collections.find((collection) => collection.name === 'Empty')?.imageCount).toBe(0);
      const picks = collections.find((collection) => collection.name === 'Picks')!;
      expect(picks).toMatchObject({ emoji: '⭐', imageCount: 1 });
      expect(
        database
          .query('SELECT image_id FROM catalog_collection_images WHERE collection_id = ?')
          .get(picks.id),
      ).toEqual({ image_id: rows.find((row) => row.isFavorite)!.id });
      const second = await (await upload()).json();
      const secondBatch = database
        .query('SELECT batch_id FROM catalog_images WHERE workspace_id = ? LIMIT 1')
        .get(second.workspace.id) as { batch_id: string };
      expect(secondBatch.batch_id).not.toBe(rows[0].batchId);
      expect(
        database
          .query('SELECT * FROM catalog_images WHERE workspace_id = ? ORDER BY id')
          .all(workspace.id),
      ).toEqual(sourceRows);
      expect(readFileSync(source[0].filePath)).toEqual(png);
      expect(events).toContainEqual({
        type: 'catalog.batch_changed',
        payload: {
          action: 'import',
          changedCount: 2,
          scope: { kind: 'workspace', workspaceId: result.workspace.id },
        },
      });
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects hostile ZIP structure, CRC corruption and forged expansion sizes without durable writes; skips invalid images', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'studio-library-hostile-'));
    const database = openLibrary(path.join(root, 'library.sqlite'), root);
    try {
      const app = new Hono().route(
        '/api/workspaces',
        createLibraryArchiveRoutes({ database, library: { id: LIBRARY_ID, path: root } }),
      );
      const manifest = {
        format: 'cozy-studio.library',
        version: 1,
        exportedAt: new Date().toISOString(),
        studioVersion: '1.0.0',
        workspace: { name: 'Hostile', sortOrder: 'newest' },
        tags: [],
        collections: [],
        missing: [],
        images: [
          {
            id: 'a',
            file: 'images/a.png',
            mimeType: 'image/png',
            width: 1,
            height: 1,
            prompt: null,
            negativePrompt: null,
            aspectRatio: null,
            imageSize: null,
            recipeId: null,
            batchId: null,
            tags: [],
            isFavorite: false,
            createdAt: new Date().toISOString(),
            providerId: null,
            generationConfig: {},
          },
        ],
      };
      const makeZip = (image: Buffer = ONE_BY_ONE_PNG, payload: unknown = manifest) =>
        new JSZip()
          .file('manifest.json', JSON.stringify(payload), { createFolders: false })
          .file('images/a.png', image, { createFolders: false });
      const baseline = database.query('SELECT * FROM workspaces').all();
      const upload = (bytes: Buffer) =>
        app.request('/api/workspaces/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip' },
          body: new Uint8Array(bytes),
        });
      const rejected = async (bytes: Buffer) => {
        const response = await upload(bytes);
        expect(response.status).toBe(400);
        expect(database.query('SELECT * FROM workspaces').all()).toEqual(baseline);
        expect(countRows(database, 'catalog_images')).toBe(0);
        expect(existsSync(path.join(root, 'outputs'))).toBe(false);
        return response.json();
      };
      await rejected(Buffer.from('not a ZIP'));
      for (const name of ['../evil.png', 'images/../../x.png', '/evil.png', 'C:/evil.png']) {
        await rejected(
          await makeZip()
            .file(name, ONE_BY_ONE_PNG, { createFolders: false })
            .generateAsync({ type: 'nodebuffer' }),
        );
      }
      await rejected(
        await makeZip()
          .file('images/link.png', 'target', { unixPermissions: 0o120777, createFolders: false })
          .generateAsync({ type: 'nodebuffer', platform: 'UNIX' }),
      );
      await rejected(
        await makeZip(ONE_BY_ONE_PNG, { ...manifest, format: 'legacy.snapshot' }).generateAsync({
          type: 'nodebuffer',
        }),
      );
      await rejected(
        await makeZip(ONE_BY_ONE_PNG, {
          ...manifest,
          images: [...manifest.images, ...manifest.images],
        }).generateAsync({ type: 'nodebuffer' }),
      );
      await rejected(
        await makeZip()
          .file('images/extra.png', ONE_BY_ONE_PNG, { createFolders: false })
          .generateAsync({ type: 'nodebuffer' }),
      );
      const corrupt = await makeZip().generateAsync({ type: 'nodebuffer' });
      corrupt[corrupt.indexOf(ONE_BY_ONE_PNG)] ^= 1;
      await rejected(corrupt);
      const oversizedImage = Buffer.alloc(64 * 1024 * 1024 + 1);
      const oversizedDeflate = await makeZip(oversizedImage).generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      });
      const bomb = Buffer.from(oversizedDeflate);
      for (let cursor = 0; cursor < bomb.length - 46; cursor++) {
        const signature = bomb.readUInt32LE(cursor);
        if (
          signature === 0x04034b50 &&
          bomb.readUInt16LE(cursor + 26) === 12 &&
          bomb.subarray(cursor + 30, cursor + 42).toString() === 'images/a.png'
        )
          bomb.writeUInt32LE(1, cursor + 22);
        if (
          signature === 0x02014b50 &&
          bomb.readUInt16LE(cursor + 28) === 12 &&
          bomb.subarray(cursor + 46, cursor + 58).toString() === 'images/a.png'
        )
          bomb.writeUInt32LE(1, cursor + 24);
      }
      expect(await rejected(bomb)).toEqual({
        error: 'ZIP entry cannot be decompressed within the size limit.',
      });
      const validPng = await sharp({
        create: { width: 2, height: 2, channels: 4, background: '#112233' },
      })
        .png()
        .toBuffer();
      const fileNames = () =>
        readdirSync(root, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => path.join(entry.parentPath, entry.name))
          .sort();
      const beforeFiles = fileNames();
      database.run(`CREATE TRIGGER reject_archive_insert BEFORE INSERT ON catalog_images
        BEGIN SELECT RAISE(ABORT, 'Archive rollback probe'); END`);
      const rolledBack = await upload(
        await makeZip(validPng).generateAsync({ type: 'nodebuffer' }),
      );
      expect(rolledBack.status).toBe(500);
      expect(database.query('SELECT * FROM workspaces').all()).toEqual(baseline);
      expect(countRows(database, 'catalog_images')).toBe(0);
      expect(fileNames()).toEqual(beforeFiles);
      for (const oversized of [
        await makeZip(oversizedImage).generateAsync({ type: 'nodebuffer', compression: 'STORE' }),
        oversizedDeflate,
      ]) {
        const skippedResponse = await upload(oversized);
        expect(skippedResponse.status).toBe(201);
        expect(await skippedResponse.json()).toMatchObject({
          imported: 0,
          skipped: [{ file: 'images/a.png', reason: 'Exceeds the 64 MiB image limit.' }],
        });
        expect(countRows(database, 'catalog_images')).toBe(0);
        expect(fileNames()).toEqual(beforeFiles);
      }
      database.run('DROP TRIGGER reject_archive_insert');
      const invalid = await upload(
        await makeZip(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')).generateAsync({
          type: 'nodebuffer',
          compression: 'DEFLATE',
        }),
      );
      expect(invalid.status).toBe(201);
      expect(await invalid.json()).toMatchObject({
        imported: 0,
        skipped: [{ file: 'images/a.png', reason: 'Not a valid image of the declared type.' }],
      });
      expect(countRows(database, 'catalog_images')).toBe(0);
      expect(fileNames()).toEqual(beforeFiles);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
