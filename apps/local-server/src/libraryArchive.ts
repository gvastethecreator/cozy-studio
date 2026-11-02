import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';
import { inflateRawSync } from 'node:zlib';
import type { Database } from 'bun:sqlite';
import JSZip from 'jszip';
import { authoringSharp as sharp } from './sharpAuthoringAdapter';
import studioPackage from '../../../package.json';
import {
  LIBRARY_ARCHIVE_FORMAT,
  LIBRARY_ARCHIVE_VERSION,
  LIBRARY_ARCHIVE_MAX_BYTES,
  LIBRARY_ARCHIVE_IMAGE_PATH,
  libraryArchiveManifest,
  portableGenerationConfig,
  type LibraryArchiveImportResult,
  type LibraryArchiveManifest,
} from '../../../packages/shared/src/libraryArchive';
import { STUDIO_REFERENCE_IMPORT_MAX_PIXELS } from '../../../packages/shared/src/studioMcp';
import { getCatalogImage, listCatalogImageIds, registerCatalogImage } from './catalog';
import { createCatalogCollection, listCatalogCollections } from './catalogCollections';
import { getDb } from './db/connection';
import { createWorkspaceInDb, getWorkspaceFromDb } from './db/workspaces';
import { ensureDefaultLibrary, getLibrary } from './libraries';
import { resolveLibraryPathFromRoot } from './library';
import { ensureThumbnailVariant, resolveLibraryThumbnailPath } from './libraryAssetVariants';
import { safePath } from './localExtensionInstall';
import { isPathInside } from './pathContainment';
import { mimeFromSignature, placeManagedFile } from './referenceImport';

const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 2 * LIBRARY_ARCHIVE_MAX_BYTES;
const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

export interface LibraryArchiveDependencies {
  database?: Database;
  library?: { id: string; path: string };
}

export class LibraryArchiveError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 500 = 400,
  ) {
    super(message);
  }
}

function reject(message: string): never {
  throw new LibraryArchiveError(message);
}

interface ZipEntry {
  name: string;
  compression: number;
  crc: number;
  size: number;
  data: Buffer;
}

/** Validate both directories before inflation. ZIP64 and split archives cannot fit this format. */
function archiveEntries(archive: Buffer): Map<string, ZipEntry> {
  if (archive.length > LIBRARY_ARCHIVE_MAX_BYTES) reject('Library archive exceeds 1 GiB.');
  let end = archive.length - 22;
  for (; end >= Math.max(0, archive.length - 65_557); end--) {
    if (
      archive.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + archive.readUInt16LE(end + 20) === archive.length
    )
      break;
  }
  if (end < Math.max(0, archive.length - 65_557)) reject('Invalid ZIP archive.');
  const count = archive.readUInt16LE(end + 10);
  const centralSize = archive.readUInt32LE(end + 12);
  const centralStart = archive.readUInt32LE(end + 16);
  if (
    archive.readUInt32LE(end + 4) !== 0 ||
    archive.readUInt16LE(end + 8) !== count ||
    count > 20_001 ||
    centralStart + centralSize !== end
  )
    reject('Unsupported ZIP directory.');
  const entries = new Map<string, ZipEntry>();
  const regions: { start: number; end: number }[] = [];
  let cursor = centralStart;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== 0x02014b50)
      reject('Invalid ZIP entry.');
    const flags = archive.readUInt16LE(cursor + 8);
    const compression = archive.readUInt16LE(cursor + 10);
    const crc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const next =
      cursor +
      46 +
      nameLength +
      archive.readUInt16LE(cursor + 30) +
      archive.readUInt16LE(cursor + 32);
    if (next > end) reject('Truncated ZIP directory.');
    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    const permissions = archive.readUInt32LE(cursor + 38);
    if (
      !safePath(name) ||
      (name !== 'manifest.json' && name !== 'images/' && !LIBRARY_ARCHIVE_IMAGE_PATH.test(name))
    )
      reject('Archive contains an unsupported path.');
    if (entries.has(name) || !nameBytes.equals(Buffer.from(name)))
      reject('Duplicate or invalid ZIP name.');
    const kind = (permissions >>> 16) & 0o170000;
    if (kind !== 0 && kind !== 0o100000 && !(name === 'images/' && kind === 0o040000))
      reject('Archive cannot contain links or special files.');
    if ((permissions & 0x10) !== 0 && name !== 'images/') reject('Invalid ZIP directory entry.');
    if (
      (flags & ~0x808) !== 0 ||
      ![0, 8].includes(compression) ||
      archive.readUInt16LE(cursor + 34) !== 0
    )
      reject('Unsupported ZIP encoding.');
    const local = archive.readUInt32LE(cursor + 42);
    if (local + 30 > centralStart || archive.readUInt32LE(local) !== 0x04034b50)
      reject('Invalid ZIP local header.');
    const localNameLength = archive.readUInt16LE(local + 26);
    const dataStart = local + 30 + localNameLength + archive.readUInt16LE(local + 28);
    const dataEnd = dataStart + compressedSize;
    if (
      dataEnd > centralStart ||
      archive.readUInt16LE(local + 6) !== flags ||
      archive.readUInt16LE(local + 8) !== compression ||
      !archive.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)
    )
      reject('ZIP headers disagree.');
    let regionEnd = dataEnd;
    if (flags & 8) {
      const descriptor =
        dataEnd +
        (dataEnd + 4 <= centralStart && archive.readUInt32LE(dataEnd) === 0x08074b50 ? 4 : 0);
      if (
        descriptor + 12 > centralStart ||
        archive.readUInt32LE(descriptor) !== crc ||
        archive.readUInt32LE(descriptor + 4) !== compressedSize ||
        archive.readUInt32LE(descriptor + 8) !== size
      )
        reject('Invalid ZIP data descriptor.');
      regionEnd = descriptor + 12;
    } else if (
      archive.readUInt32LE(local + 14) !== crc ||
      archive.readUInt32LE(local + 18) !== compressedSize ||
      archive.readUInt32LE(local + 22) !== size
    )
      reject('ZIP headers disagree.');
    if (name === 'images/' && (size !== 0 || compressedSize !== 0 || crc !== 0))
      reject('Invalid images directory.');
    regions.push({ start: local, end: regionEnd });
    entries.set(name, { name, compression, crc, size, data: archive.subarray(dataStart, dataEnd) });
    cursor = next;
  }
  if (cursor !== end) reject('Invalid ZIP directory length.');
  let offset = 0;
  for (const region of regions.sort((a, b) => a.start - b.start)) {
    if (region.start !== offset) reject('Overlapping or unlisted ZIP entries.');
    offset = region.end;
  }
  if (offset !== centralStart) reject('Unlisted ZIP contents.');
  return entries;
}

/** Native inflation bounds actual output, including when the central-directory size is forged. */
function readEntry(entry: ZipEntry, limit: number): Buffer {
  if (entry.size > limit || limit <= 0) reject('Expanded archive exceeds the size limit.');
  let bytes: Buffer;
  try {
    bytes =
      entry.compression === 0 ? entry.data : inflateRawSync(entry.data, { maxOutputLength: limit });
  } catch {
    reject('ZIP entry cannot be decompressed within the size limit.');
  }
  if (bytes.length > limit || bytes.length !== entry.size) reject('Invalid expanded ZIP size.');
  if (Bun.hash.crc32(bytes) !== entry.crc) reject('ZIP CRC-32 mismatch.');
  return bytes;
}

export function exportLibraryArchive(workspaceId: string, deps: LibraryArchiveDependencies = {}) {
  const database = getDb(deps.database);
  const workspace = getWorkspaceFromDb(database, workspaceId);
  if (!workspace) throw new LibraryArchiveError('Workspace not found.', 404);
  const ids = listCatalogImageIds({ workspaceId, isDeleted: false }, database);
  if (ids.length > 20_000) reject('Library archive supports up to 20,000 images.');
  const zip = new JSZip();
  const sources: Readable[] = [];
  const images: LibraryArchiveManifest['images'] = [];
  const missing: LibraryArchiveManifest['missing'] = [];
  let totalBytes = 0;
  for (const id of ids) {
    const row = getCatalogImage(id, database)!;
    const library = getLibrary(row.libraryId, database);
    if (
      !library ||
      !isPathInside(library.path, row.filePath) ||
      !existsSync(row.filePath) ||
      !statSync(row.filePath).isFile()
    ) {
      missing.push({ id, reason: 'file_missing' });
      continue;
    }
    const mimeType = row.mimeType as keyof typeof EXTENSIONS;
    if (!EXTENSIONS[mimeType]) reject('Library contains an unsupported image format.');
    const size = statSync(row.filePath).size;
    if (size > MAX_IMAGE_BYTES) reject('An image exceeds the 64 MiB archive limit.');
    totalBytes += size;
    const file = `images/${id}.${EXTENSIONS[mimeType]}`;
    // Opening streams only when consumed avoids one file descriptor and buffer per catalog row.
    const source = Readable.from(
      (async function* () {
        yield* createReadStream(row.filePath);
      })(),
    );
    sources.push(source);
    zip.file(file, source, { createFolders: false });
    images.push({
      id,
      file,
      mimeType,
      width: row.width,
      height: row.height,
      prompt: row.prompt,
      negativePrompt: row.negativePrompt,
      aspectRatio: row.aspectRatio,
      imageSize: row.imageSize,
      recipeId: row.recipeId,
      batchId: row.batchId,
      tags: row.tags,
      isFavorite: row.isFavorite,
      createdAt: row.createdAt,
      providerId: row.providerId ?? null,
      generationConfig: portableGenerationConfig(row.generationConfig),
    });
  }
  const manifest = libraryArchiveManifest.parse({
    format: LIBRARY_ARCHIVE_FORMAT,
    version: LIBRARY_ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    studioVersion: studioPackage.version,
    workspace: { name: workspace.name, sortOrder: workspace.sortOrder },
    images,
    missing,
    tags: database
      .query('SELECT name, color FROM catalog_tags WHERE workspace_id = ?')
      .all(workspaceId),
    collections: listCatalogCollections(workspaceId, database).map((collection) => ({
      name: collection.name,
      emoji: collection.emoji ?? null,
      imageIds: (
        database
          .query(`SELECT member.image_id FROM catalog_collection_images member
        JOIN catalog_images image ON image.id = member.image_id
        WHERE member.collection_id = ? AND image.is_deleted = 0 AND COALESCE(image.workspace_id, 'default') = ?`)
          .all(collection.id, workspaceId) as { image_id: string }[]
      ).map((member) => member.image_id),
    })),
  });
  const json = JSON.stringify(manifest);
  const manifestBytes = Buffer.byteLength(json);
  if (
    manifestBytes > MAX_MANIFEST_BYTES ||
    totalBytes + manifestBytes + (images.length + 1) * 256 > LIBRARY_ARCHIVE_MAX_BYTES
  )
    reject('Library archive exceeds the 1 GiB import limit.');
  zip.file('manifest.json', json);
  const stream = zip.generateNodeStream({ streamFiles: true, compression: 'STORE' });
  stream.on('close', () => {
    for (const source of sources) source.destroy();
  });
  const slug =
    workspace.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'workspace';
  return {
    stream,
    filename: `${slug}-library-${manifest.exportedAt.slice(0, 10)}.zip`,
    images: images.length,
    missing: missing.length,
  };
}

export async function importLibraryArchive(
  archive: Buffer,
  options: { name?: string } = {},
  deps: LibraryArchiveDependencies = {},
): Promise<LibraryArchiveImportResult> {
  const entries = archiveEntries(archive);
  const manifestEntry = entries.get('manifest.json');
  if (!manifestEntry) reject('Archive has no manifest.json.');
  const manifestBytes = readEntry(manifestEntry, MAX_MANIFEST_BYTES);
  let manifest: LibraryArchiveManifest;
  try {
    manifest = libraryArchiveManifest.parse(JSON.parse(manifestBytes.toString('utf8')));
  } catch {
    reject('Invalid Library archive manifest or version.');
  }
  const listed = new Set(manifest.images.map((image) => image.file));
  for (const file of listed)
    if (!entries.has(file)) reject('A manifest image is missing from the ZIP.');
  for (const file of entries.keys())
    if (file !== 'manifest.json' && file !== 'images/' && !listed.has(file))
      reject('ZIP contains an unlisted image.');
  const database = getDb(deps.database);
  const name = options.name === undefined ? manifest.workspace.name : options.name.trim();
  if (!name || name.length > 128) reject('Workspace name must have 1 to 128 characters.');
  const library = deps.library ?? ensureDefaultLibrary();
  const workspaceId = randomUUID();
  const written: string[] = [];
  const imported: {
    image: LibraryArchiveManifest['images'][number];
    filePath: string;
    thumbnailPath: string | null;
    width: number;
    height: number;
    size: number;
  }[] = [];
  const skipped: LibraryArchiveImportResult['skipped'] = [];
  let expanded = manifestBytes.length;
  try {
    for (const image of manifest.images) {
      const entry = entries.get(image.file)!;
      if (entry.size > MAX_IMAGE_BYTES) {
        // Structure is already checked. Skipped payloads are never inflated or CRC-verified.
        skipped.push({ file: image.file, reason: 'Exceeds the 64 MiB image limit.' });
        continue;
      }
      const bytes = readEntry(entry, Math.min(MAX_IMAGE_BYTES, MAX_EXPANDED_BYTES - expanded));
      expanded += bytes.length;
      let width: number;
      let height: number;
      try {
        if (mimeFromSignature(bytes) !== image.mimeType)
          throw new Error('Not an image of the declared type.');
        const decoder = sharp(bytes, {
          limitInputPixels: STUDIO_REFERENCE_IMPORT_MAX_PIXELS,
          failOn: 'warning',
        });
        const metadata = await decoder.metadata();
        if (!metadata.width || !metadata.height) throw new Error('Invalid image dimensions.');
        await decoder.resize(1, 1).raw().toBuffer();
        width = metadata.width;
        height = metadata.height;
      } catch {
        skipped.push({ file: image.file, reason: 'Not a valid image of the declared type.' });
        continue;
      }
      const filePath = resolveLibraryPathFromRoot(
        library.path,
        'outputs',
        'imports',
        workspaceId,
        `${randomUUID()}.${EXTENSIONS[image.mimeType]}`,
      );
      if (!isPathInside(library.path, filePath) || existsSync(filePath))
        reject('Unsafe import destination.');
      placeManagedFile(filePath, bytes);
      written.push(filePath);
      const thumbnail = resolveLibraryThumbnailPath(filePath, { libraryDir: library.path });
      if (!isPathInside(library.path, thumbnail)) reject('Unsafe thumbnail destination.');
      const thumbnailExisted = existsSync(thumbnail);
      let thumbnailPath: string | null = null;
      try {
        thumbnailPath = await ensureThumbnailVariant(filePath, { libraryDir: library.path });
      } catch {
        /* Originals remain usable without thumbnails. */
      } finally {
        if (!thumbnailExisted && existsSync(thumbnail)) written.push(thumbnail);
      }
      imported.push({ image, filePath, thumbnailPath, width, height, size: bytes.length });
    }
    const workspace = database.transaction(() => {
      let importedName = name;
      let collision = 0;
      while (
        database.query('SELECT 1 FROM workspaces WHERE name = ? COLLATE NOCASE').get(importedName)
      ) {
        collision += 1;
        const suffix = collision === 1 ? ' (imported)' : ` (imported ${collision})`;
        importedName = `${name.slice(0, 128 - suffix.length)}${suffix}`;
      }
      const created = createWorkspaceInDb(database, {
        id: workspaceId,
        name: importedName,
        sortOrder: manifest.workspace.sortOrder,
      });
      const imageIds = new Map<string, string>();
      const batchIds = new Map<string, string>();
      for (const item of imported) {
        const { image } = item;
        if (image.batchId && !batchIds.has(image.batchId))
          batchIds.set(image.batchId, randomUUID());
        const row = registerCatalogImage(
          {
            ...image,
            libraryId: library.id,
            workspaceId,
            filePath: item.filePath,
            thumbnailPath: item.thumbnailPath,
            width: item.width,
            height: item.height,
            fileSizeBytes: item.size,
            batchId: image.batchId ? batchIds.get(image.batchId) : null,
            generationConfig: portableGenerationConfig({
              ...image.generationConfig,
              providerId: image.providerId,
            }),
          },
          database,
        );
        imageIds.set(image.id, row.id);
      }
      for (const tag of manifest.tags)
        database
          .query(`INSERT INTO catalog_tags (workspace_id, name, color) VALUES (?, ?, ?)
          ON CONFLICT(workspace_id, name) DO UPDATE SET color = excluded.color`)
          .run(workspaceId, tag.name, tag.color);
      for (const collection of manifest.collections)
        createCatalogCollection(
          {
            ...collection,
            workspaceId,
            imageIds: collection.imageIds.flatMap((id) =>
              imageIds.has(id) ? [imageIds.get(id)!] : [],
            ),
          },
          database,
        );
      return created;
    })();
    return { workspace, imported: imported.length, skipped, missing: manifest.missing };
  } catch (error) {
    for (const file of written) {
      if (existsSync(file)) unlinkSync(file);
    }
    throw error;
  }
}
