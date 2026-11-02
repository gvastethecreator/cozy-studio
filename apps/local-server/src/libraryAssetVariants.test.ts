import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveLibraryPathFromRoot } from './library';
import { resolveLibraryThumbnailPath, resolveThumbnailMaxEdge } from './libraryAssetVariants';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function cleanupTempLibrary(libraryDir: string) {
  try {
    rmSync(libraryDir, { recursive: true, force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'EPERM') {
      throw error;
    }
  }
}

function readHotPathSource(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('libraryAssetVariants', () => {
  it('clamps thumbnail max-edge values to safe bounds', () => {
    expect(resolveThumbnailMaxEdge(undefined)).toBe(512);
    expect(resolveThumbnailMaxEdge('12')).toBe(48);
    expect(resolveThumbnailMaxEdge('2048')).toBe(1024);
  });

  it('maps generated assets into the thumbnails folder', () => {
    const libraryDir = mkdtempSync(path.join(os.tmpdir(), 'cozy-studio-thumbs-'));

    try {
      const sourceFilePath = resolveLibraryPathFromRoot(
        libraryDir,
        'outputs',
        '2026-05-26',
        'sample.png',
      );
      mkdirSync(path.dirname(sourceFilePath), { recursive: true });
      writeFileSync(sourceFilePath, ONE_BY_ONE_PNG);

      const thumbnailPath = resolveLibraryThumbnailPath(sourceFilePath, {
        libraryDir,
        maxEdge: 256,
      });

      expect(thumbnailPath).toContain(path.join('.studio', 'thumbnails'));
      expect(path.extname(thumbnailPath)).toBe('.webp');
      expect(existsSync(sourceFilePath)).toBe(true);
    } finally {
      cleanupTempLibrary(libraryDir);
    }
  });

  it('does not import sharp on the thumbnail hot path', () => {
    const source = readHotPathSource('./libraryAssetVariants.ts');
    expect(source).not.toMatch(/from ['"]sharp['"]/);
    expect(source).toMatch(/encodeResizedWebpFromPath/);
  });
});
