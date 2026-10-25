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
import {
  referenceImportResult,
  STUDIO_REFERENCE_IMPORT_MAX_BASE64_CHARS,
  STUDIO_REFERENCE_IMPORT_MAX_BYTES,
} from '../../../packages/shared/src/studioMcp';
import { createDefaultEditableStudioSettings } from '../../../packages/shared/src/studioSettings';
import { getCatalogImage, queryCatalog, registerCatalogImage } from './catalog';
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

      const listed = await call('studio_catalog', {});
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
      for (const access of ['off', 'read'] as const) {
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
          width: 3200,
          height: 1600,
          alpha: 0.5,
          format: 'png',
          expectedWidth: 2048,
          expectedHeight: 1024,
        },
        {
          width: 3000,
          height: 1500,
          alpha: 1,
          format: 'jpeg',
          expectedWidth: 2048,
          expectedHeight: 1024,
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
