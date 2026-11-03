import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  backfillMissingThumbnails,
  compactInlineImagePayloads,
  computeImageDHash,
  findCatalogDuplicates,
  readReferenceDedupeStats,
} from './studio-storage-maintenance';
import { resolveLibraryPathFromRoot } from '../apps/local-server/src/library';
import { openTestDatabase } from '../apps/local-server/src/db/testDatabase';
import { authoringSharp } from '../apps/local-server/src/sharpAuthoringAdapter';

describe('catalog duplicate review', () => {
  it('caches bounded scans, scopes live images and groups by keeper without similarity chains', async () => {
    const db = openTestDatabase();
    db.query(
      "INSERT INTO libraries (id, name, path, created_at) VALUES ('test', 'Test', '/test', '2026-01-01')",
    ).run();
    const hashes: Record<string, string> = {
      favorite: '0'.repeat(64),
      near: 'ffff' + '0'.repeat(60),
      chain: 'ffff8' + '0'.repeat(59),
      organized: '0'.repeat(64),
      otherOrganized: 'f'.repeat(64),
      newerOrganized: 'f'.repeat(64),
      older: 'f'.repeat(62) + '00',
    };
    const createdAt: Record<string, string> = {
      otherOrganized: '2026-11-01T00:00:00Z',
      newerOrganized: '2026-11-01T00:00:00.001Z',
      older: '2026-01-01',
    };
    for (const id of [
      ...Object.keys(hashes),
      'missing',
      'unreadable',
      'otherWorkspace',
      'archived',
    ]) {
      db.query(`INSERT INTO catalog_images
        (id, library_id, file_path, public_url, mime_type, created_at, workspace_id, is_deleted, is_favorite, tags)
        VALUES (?, 'test', ?, ?, 'image/png', ?, ?, ?, ?, ?)`).run(
        id,
        id,
        `/library/${id}.png`,
        createdAt[id] ?? '2026-02-01',
        id === 'otherWorkspace' ? 'other' : 'default',
        Number(id === 'archived'),
        Number(id === 'favorite'),
        ['organized', 'otherOrganized', 'newerOrganized'].includes(id) ? '["tag"]' : '[]',
      );
    }
    let computeCalls = 0;
    const dependencies = {
      fileExists: (filePath: string) => filePath !== 'missing',
      computeDHash: async (filePath: string) => {
        computeCalls += 1;
        if (filePath === 'unreadable') throw new Error('Unreadable');
        return hashes[filePath]!;
      },
    };
    const first = await findCatalogDuplicates(
      db,
      { workspaceId: 'default', hashLimit: 2 },
      dependencies,
    );
    expect(first).toMatchObject({ hashedNow: 2, total: 9, checked: 2, pending: 7, groups: [] });
    const complete = await findCatalogDuplicates(db, { workspaceId: 'default' }, dependencies);
    expect(complete).toMatchObject({ hashedNow: 7, total: 9, checked: 9, pending: 0, skipped: 2 });
    expect(
      complete.groups.map((group) => ({
        keeper: group.keeperId,
        ids: group.images.map((image) => image.id),
      })),
    ).toEqual([
      { keeper: 'favorite', ids: ['favorite', 'organized', 'near'] },
      { keeper: 'otherOrganized', ids: ['otherOrganized', 'newerOrganized', 'older'] },
    ]);
    expect(complete.groups[0]!.images[0]!.isFavorite).toBe(true);
    expect(
      db
        .query(
          "SELECT id, dhash FROM catalog_images WHERE id IN ('missing', 'unreadable') ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: 'missing', dhash: '' },
      { id: 'unreadable', dhash: '' },
    ]);
    expect(
      db.query("SELECT dhash FROM catalog_images WHERE id IN ('otherWorkspace', 'archived')").all(),
    ).toEqual([{ dhash: null }, { dhash: null }]);
    const cached = await findCatalogDuplicates(db, { workspaceId: 'default' }, dependencies);
    expect(cached).toEqual({ ...complete, hashedNow: 0 });
    expect(computeCalls).toBe(8);
  });

  it('matches a JPEG resave of a gradient and separates its mirror with 256-bit dHash', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cozy-dhash-'));
    try {
      const width = 256;
      const pixels = Buffer.alloc(width * width * 3);
      for (let y = 0; y < width; y += 1) {
        for (let x = 0; x < width; x += 1) {
          for (let channel = 0; channel < 3; channel += 1)
            pixels[(y * width + x) * 3 + channel] = x;
        }
      }
      const original = path.join(directory, 'gradient.png');
      const jpeg = path.join(directory, 'gradient.jpg');
      const mirror = path.join(directory, 'mirror.png');
      await authoringSharp(pixels, { raw: { width, height: width, channels: 3 } })
        .png()
        .toFile(original);
      await authoringSharp(original).jpeg({ quality: 70 }).toFile(jpeg);
      await authoringSharp(original).flop().png().toFile(mirror);
      const [pngHash, jpegHash, mirrorHash] = await Promise.all(
        [original, jpeg, mirror].map(computeImageDHash),
      );
      const distance = (left: string, right: string) =>
        left
          .split('')
          .reduce(
            (total, digit, index) =>
              total +
              (Number.parseInt(digit, 16) ^ Number.parseInt(right[index]!, 16))
                .toString(2)
                .replaceAll('0', '').length,
            0,
          );
      expect(pngHash).toMatch(/^[a-f0-9]{64}$/);
      expect(distance(pngHash!, jpegHash!)).toBeLessThanOrEqual(16);
      expect(distance(pngHash!, mirrorHash!)).toBeGreaterThan(16);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('compactInlineImagePayloads', () => {
  it('omits inline image bytes while preserving non-inline task data', () => {
    const result = compactInlineImagePayloads({
      prompt: 'keep the prompt',
      assets: [
        {
          role: 'reference',
          name: 'reference.png',
          dataUrl: 'data:image/png;base64,aGVsbG8=',
        },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.replacements).toBe(1);
    expect(result.omittedBytes).toBe(5);
    expect(result.nonRecoverablePayloads).toBe(1);
    expect(result.value).toMatchObject({
      prompt: 'keep the prompt',
      assets: [
        {
          role: 'reference',
          name: 'reference.png',
          omittedInlinePayload: true,
          inlinePayloadSummary: {
            omittedInlinePayload: true,
            kind: 'image_data_url',
            mimeType: 'image/png',
            byteCount: 5,
            recoverable: false,
          },
        },
      ],
    });
  });

  it('marks compacted payloads recoverable when a local path still exists', () => {
    const result = compactInlineImagePayloads({
      assets: [
        {
          localPath: path.resolve('package.json'),
          dataUrl: 'data:image/png;base64,aGVsbG8=',
        },
      ],
    });

    expect(result.recoverablePayloads).toBe(1);
    expect(result.nonRecoverablePayloads).toBe(0);
    expect(result.value).toMatchObject({
      assets: [
        {
          localPath: path.resolve('package.json'),
          inlinePayloadSummary: {
            recoverable: true,
            localPath: path.resolve('package.json'),
          },
        },
      ],
    });
  });
});

describe('readReferenceDedupeStats', () => {
  it('counts duplicate reference bytes without exposing content', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codex-reference-dedupe-'));
    try {
      writeFileSync(path.join(dir, 'a.bin'), 'same');
      writeFileSync(path.join(dir, 'b.bin'), 'same');
      writeFileSync(path.join(dir, 'c.bin'), 'different');

      expect(readReferenceDedupeStats(dir)).toMatchObject({
        files: 3,
        uniqueHashes: 2,
        duplicateFiles: 1,
        duplicateBytes: 4,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

function createStorageMaintenanceDb() {
  const catalogRows = new Map<
    string,
    { filePath: string; thumbnailPath: string | null; thumbnailUrl: string | null }
  >();
  const assetRows = new Map<string, { thumbnailPath: string | null }>();
  const db = {
    query(sql: string) {
      if (sql.includes('SELECT id, file_path as filePath')) {
        return {
          all(limit: number) {
            return Array.from(catalogRows, ([id, row]) => ({ id, filePath: row.filePath }))
              .filter((row) => {
                const source = catalogRows.get(row.id)!;
                return !source.thumbnailPath || !source.thumbnailUrl;
              })
              .slice(0, limit);
          },
        };
      }
      if (sql.startsWith('UPDATE catalog_images')) {
        return {
          run(thumbnailPath: string, thumbnailUrl: string, id: string) {
            const row = catalogRows.get(id);
            if (row) {
              row.thumbnailPath = thumbnailPath;
              row.thumbnailUrl = thumbnailUrl;
            }
          },
        };
      }
      if (sql.startsWith('UPDATE assets')) {
        return {
          run(thumbnailPath: string, filePath: string) {
            const row = assetRows.get(filePath);
            if (row && !row.thumbnailPath) {
              row.thumbnailPath = thumbnailPath;
            }
          },
        };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };

  return { assetRows, catalogRows, db };
}

describe('backfillMissingThumbnails', () => {
  it('plans missing thumbnail rows without creating thumbnails in dry-run mode', async () => {
    const libraryDir = mkdtempSync(path.join(tmpdir(), 'codex-thumbnail-backfill-'));
    const { catalogRows, db } = createStorageMaintenanceDb();
    try {
      const sourcePath = resolveLibraryPathFromRoot(libraryDir, 'outputs', 'sample.png');
      mkdirSync(path.dirname(sourcePath), { recursive: true });
      writeFileSync(sourcePath, 'not-real-image');
      catalogRows.set('catalog-1', {
        filePath: sourcePath,
        thumbnailPath: null,
        thumbnailUrl: null,
      });

      const result = await backfillMissingThumbnails(
        db as never,
        { libraryDir, limit: 10, write: false },
        {
          ensureThumbnailVariant: async () => {
            throw new Error('dry-run should not write thumbnails');
          },
          fileExists: () => true,
        },
      );

      expect(result).toMatchObject({
        mode: 'dry-run',
        scannedRows: 1,
        plannedRows: 1,
        wroteRows: 0,
      });
    } finally {
      rmSync(libraryDir, { force: true, recursive: true });
    }
  });

  it('writes thumbnail path and public URL for bounded backfill rows', async () => {
    const libraryDir = mkdtempSync(path.join(tmpdir(), 'codex-thumbnail-backfill-'));
    const { assetRows, catalogRows, db } = createStorageMaintenanceDb();
    try {
      const sourcePath = resolveLibraryPathFromRoot(libraryDir, 'outputs', 'sample.png');
      const thumbnailPath = resolveLibraryPathFromRoot(
        libraryDir,
        'outputs',
        'thumbnails',
        'sample.webp',
      );
      mkdirSync(path.dirname(sourcePath), { recursive: true });
      writeFileSync(sourcePath, 'not-real-image');
      catalogRows.set('catalog-1', {
        filePath: sourcePath,
        thumbnailPath: null,
        thumbnailUrl: null,
      });
      assetRows.set(sourcePath, { thumbnailPath: null });

      const result = await backfillMissingThumbnails(
        db as never,
        { libraryDir, limit: 10, write: true },
        {
          ensureThumbnailVariant: async () => thumbnailPath,
          fileExists: () => true,
        },
      );
      const row = catalogRows.get('catalog-1');

      expect(result.wroteRows).toBe(1);
      expect(row).toEqual({
        filePath: sourcePath,
        thumbnailPath,
        thumbnailUrl: '/library/outputs/thumbnails/sample.webp',
      });
    } finally {
      rmSync(libraryDir, { force: true, recursive: true });
    }
  });
});
