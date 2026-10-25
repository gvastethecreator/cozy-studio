import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { open, realpath, stat } from 'node:fs/promises';
import type { Database } from 'bun:sqlite';
import {
  referenceFileImportInput,
  referenceImportInput,
  referenceImportResult,
  STUDIO_REFERENCE_IMPORT_MAX_BYTES,
  STUDIO_REFERENCE_IMPORT_MAX_DIMENSION,
  STUDIO_REFERENCE_IMPORT_MAX_PIXELS,
  type StudioReferenceFileImportInput,
  type StudioReferenceImportInput,
  type StudioReferenceImportResult,
} from '../../../packages/shared/src/studioMcp';
import { getCatalogImage, registerCatalogImage } from './catalog';
import { getDb } from './db/connection';
import { resolveLibraryPathFromRoot } from './library';
import { getDefaultLibrary, getLibrary } from './libraries';
import { authoringSharp as sharp, type Metadata } from './sharpAuthoringAdapter';

const MIME_FORMAT = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

type ReferenceMime = keyof typeof MIME_FORMAT;

interface ImportLibrary {
  id: string;
  path: string;
}

interface ValidatedReference {
  name: string;
  mimeType: ReferenceMime;
  sha256: string;
  bytes: Buffer;
  width: number;
  height: number;
}

interface ReceiptRow {
  request_id: string;
  request_hash: string;
  catalog_image_id: string;
  sha256: string;
  stored_sha256: string;
  mime_type: string;
  byte_length: number;
  name: string;
}

export class ReferenceImportConflictError extends Error {
  constructor() {
    super('This reference request identity was already used for different input.');
    this.name = 'ReferenceImportConflictError';
  }
}

export interface ReferenceImportDependencies {
  database?: Database;
  library?: ImportLibrary;
}

function requestHash(input: Pick<ValidatedReference, 'name' | 'mimeType' | 'sha256'>) {
  return createHash('sha256')
    .update(JSON.stringify({ mimeType: input.mimeType, name: input.name, sha256: input.sha256 }))
    .digest('hex');
}

function mimeFromSignature(bytes: Buffer): ReferenceMime | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6) {
    const signature = bytes.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function isInsideLibrary(libraryPath: string, filePath: string) {
  const root = path.resolve(libraryPath);
  const relative = path.relative(root, path.resolve(filePath));
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function managedPath(libraryPath: string, sha256: string) {
  const destination = resolveLibraryPathFromRoot(
    libraryPath,
    'references',
    'imports',
    `${sha256}.webp`,
  );
  if (!isInsideLibrary(libraryPath, destination)) {
    throw new Error('Reference import could not be stored in the Studio Library.');
  }
  return destination;
}

function placeManagedFile(destination: string, bytes: Buffer) {
  mkdirSync(path.dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    if (!readFileSync(destination).equals(bytes)) {
      throw new Error(
        'A managed reference file already exists for this digest and was left unchanged.',
      );
    }
    return;
  }
  const partial = `${destination}.${randomUUID()}.partial`;
  const fd = openSync(partial, 'wx');
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(partial);
    throw error;
  }
  closeSync(fd);
  try {
    renameSync(partial, destination);
  } catch (error) {
    try {
      unlinkSync(partial);
    } catch {
      // The partial file is disposable. The named reference file stays as it is.
    }
    if (existsSync(destination) && readFileSync(destination).equals(bytes)) return;
    throw error;
  }
}

function readReceipt(database: Database, requestId: string) {
  return database
    .query(
      `SELECT request_id, request_hash, catalog_image_id, sha256, stored_sha256, mime_type, byte_length, name
       FROM reference_import_receipts WHERE request_id = ?`,
    )
    .get(requestId) as ReceiptRow | null;
}

function toResult(row: ReceiptRow): StudioReferenceImportResult {
  return referenceImportResult.parse({
    requestId: row.request_id,
    catalogImageId: row.catalog_image_id,
    sha256: row.sha256,
    storedSha256: row.stored_sha256,
    mimeType: row.mime_type,
    byteLength: row.byte_length,
  });
}

async function validateReferenceBytes(
  name: string,
  mimeType: ReferenceMime,
  bytes: Buffer,
  expectedSha256?: string,
): Promise<ValidatedReference> {
  if (bytes.length === 0 || bytes.length > STUDIO_REFERENCE_IMPORT_MAX_BYTES) {
    throw new Error('Reference image exceeds 8 MiB.');
  }
  const actualSha = createHash('sha256').update(bytes).digest();
  if (expectedSha256 && !timingSafeEqual(actualSha, Buffer.from(expectedSha256, 'hex'))) {
    throw new Error('Reference digest does not match the image bytes.');
  }
  if (mimeFromSignature(bytes) !== mimeType) {
    throw new Error('Reference image type does not match its contents.');
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      limitInputPixels: STUDIO_REFERENCE_IMPORT_MAX_PIXELS,
    }).metadata();
  } catch {
    throw new Error('Reference image could not be decoded.');
  }
  if (metadata.format !== MIME_FORMAT[mimeType]) {
    throw new Error('Reference image type does not match its contents.');
  }
  if (!metadata.width || !metadata.height) {
    throw new Error('Reference image could not be decoded.');
  }
  if (metadata.width * metadata.height > STUDIO_REFERENCE_IMPORT_MAX_PIXELS) {
    throw new Error('Reference image exceeds 40 million pixels.');
  }
  return {
    name,
    mimeType,
    sha256: actualSha.toString('hex'),
    bytes,
    width: metadata.width,
    height: metadata.height,
  };
}

async function optimizeReference(input: ValidatedReference): Promise<ValidatedReference> {
  try {
    const image = sharp(input.bytes, { limitInputPixels: STUDIO_REFERENCE_IMPORT_MAX_PIXELS });
    const metadata = await image.metadata();
    const transparent = metadata.hasAlpha && !(await image.stats()).isOpaque;
    const { data, info } = await image
      .autoOrient()
      .resize(STUDIO_REFERENCE_IMPORT_MAX_DIMENSION, STUDIO_REFERENCE_IMPORT_MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        lossless: transparent || input.width * input.height <= 512 * 512,
        quality: 90,
        alphaQuality: 100,
      })
      .toBuffer({ resolveWithObject: true });
    if (data.length > STUDIO_REFERENCE_IMPORT_MAX_BYTES) {
      throw new Error('Reference optimized image exceeds 8 MiB.');
    }
    return {
      name: input.name,
      mimeType: 'image/webp',
      sha256: createHash('sha256').update(data).digest('hex'),
      bytes: data,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Reference ')) throw error;
    throw new Error('Reference image could not be decoded or optimized.');
  }
}

function isAbsoluteImportPath(value: string) {
  return path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
}

async function readAllowedReference(filePath: string, allowedRoots: string[]) {
  if (allowedRoots.length === 0) {
    throw new Error(
      'Reference file import is disabled. Set Allowed import folders in Studio Settings.',
    );
  }
  if (!isAbsoluteImportPath(filePath)) {
    throw new Error('Reference file requires an absolute path without parent traversal.');
  }
  const candidateRoots = allowedRoots.filter(
    (root) => isAbsoluteImportPath(root) && isInsideLibrary(root, filePath),
  );
  if (candidateRoots.length === 0) {
    throw new Error('Reference file is outside Allowed import folders.');
  }
  try {
    const resolved = await realpath(filePath);
    let allowed = false;
    for (const root of candidateRoots) {
      try {
        const resolvedRoot = await realpath(root);
        if ((await stat(resolvedRoot)).isDirectory() && isInsideLibrary(resolvedRoot, resolved)) {
          allowed = true;
          break;
        }
      } catch {
        // A missing or inaccessible allowlisted folder grants no access.
      }
    }
    if (!allowed) throw new Error('Reference file is outside Allowed import folders.');
    if (!(await stat(resolved)).isFile()) throw new Error('Reference path must be a regular file.');
    const handle = await open(resolved, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('Reference path must be a regular file.');
      if (info.size === 0 || info.size > STUDIO_REFERENCE_IMPORT_MAX_BYTES) {
        throw new Error('Reference image must contain between 1 byte and 8 MiB.');
      }
      const bytes = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      const current = await stat(resolved);
      if (
        length !== info.size ||
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs ||
        current.dev !== info.dev ||
        current.ino !== info.ino ||
        (await realpath(filePath)) !== resolved
      ) {
        throw new Error('Reference file changed during import. Retry with a stable file.');
      }
      return bytes.subarray(0, length);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Reference ')) throw error;
    throw new Error('Reference file could not be read. Check the path and folder permissions.');
  }
}

function restoreIfMissing(filePath: string, bytes: Buffer, libraryPath: string) {
  if (!isInsideLibrary(libraryPath, filePath)) {
    throw new Error('Imported reference is not in the Studio Library.');
  }
  if (!existsSync(filePath)) placeManagedFile(filePath, bytes);
  else if (!readFileSync(filePath).equals(bytes)) {
    throw new Error('Reference image changed on disk and was left unchanged.');
  }
}

function reusableCatalogId(
  database: Database,
  library: ImportLibrary,
  sourceSha256: string,
  storedBytes: Buffer,
) {
  const rows = database
    .query(
      `SELECT catalog_image_id FROM reference_import_receipts
       WHERE sha256 = ? ORDER BY created_at ASC, request_id ASC`,
    )
    .all(sourceSha256) as Array<{ catalog_image_id: string }>;
  for (const row of rows) {
    const image = getCatalogImage(row.catalog_image_id, database);
    const source = image?.generationConfig?.source;
    if (
      !image ||
      image.isDeleted ||
      image.jobId ||
      source !== 'imported reference' ||
      !isInsideLibrary(library.path, image.filePath) ||
      !existsSync(image.filePath) ||
      !readFileSync(image.filePath).equals(storedBytes)
    ) {
      continue;
    }
    return image.id;
  }
  return null;
}

function publicImportError(error: unknown) {
  if (error instanceof ReferenceImportConflictError) return error;
  if (
    error instanceof Error &&
    error.message.startsWith('Reference ') &&
    !/[\\/]/.test(error.message)
  ) {
    return error;
  }
  return new Error('Reference import could not be saved.');
}

export async function importStudioReference(
  input: StudioReferenceImportInput,
  deps: ReferenceImportDependencies = {},
): Promise<StudioReferenceImportResult> {
  try {
    const parsed = referenceImportInput.safeParse(input);
    if (!parsed.success) throw new Error('Reference import arguments are invalid.');
    const validated = await validateReferenceBytes(
      parsed.data.name,
      parsed.data.mimeType,
      Buffer.from(parsed.data.base64, 'base64'),
      parsed.data.sha256,
    );
    return await persistReference(input.requestId, validated, deps);
  } catch (error) {
    throw publicImportError(error);
  }
}

export async function importStudioReferenceFile(
  input: StudioReferenceFileImportInput,
  allowedRoots: string[],
  deps: ReferenceImportDependencies = {},
): Promise<StudioReferenceImportResult> {
  try {
    const parsed = referenceFileImportInput.safeParse(input);
    if (!parsed.success) throw new Error('Reference file import arguments are invalid.');
    const bytes = await readAllowedReference(parsed.data.path, allowedRoots);
    const mimeType = mimeFromSignature(bytes);
    if (!mimeType) throw new Error('Reference file must contain a PNG, JPEG, WebP or GIF image.');
    const name = parsed.data.name ?? path.basename(parsed.data.path);
    if (!referenceImportInput.shape.name.safeParse(name).success) {
      throw new Error('Reference image name is invalid. Supply a name of up to 200 characters.');
    }
    const validated = await validateReferenceBytes(name, mimeType, bytes);
    return await persistReference(parsed.data.requestId, validated, deps);
  } catch (error) {
    throw publicImportError(error);
  }
}

async function persistReference(
  requestId: string,
  validated: ValidatedReference,
  deps: ReferenceImportDependencies,
): Promise<StudioReferenceImportResult> {
  const hash = requestHash(validated);
  const database = deps.database ?? getDb();
  const library = deps.library ?? getDefaultLibrary();
  if (!library) throw new Error('No studio library registered.');
  const existing = readReceipt(database, requestId);
  if (existing) {
    if (existing.request_hash !== hash) throw new ReferenceImportConflictError();
    const image = getCatalogImage(existing.catalog_image_id, database);
    const originalLibrary = image && getLibrary(image.libraryId, database);
    if (!image || image.isDeleted || !originalLibrary) {
      throw new Error('Reference image is no longer available in the catalog.');
    }
    if (!isInsideLibrary(originalLibrary.path, image.filePath)) {
      throw new Error('Reference image is not in its Studio Library.');
    }
    const bytes = existsSync(image.filePath)
      ? readFileSync(image.filePath)
      : existing.stored_sha256 === validated.sha256
        ? validated.bytes
        : (await optimizeReference(validated)).bytes;
    if (createHash('sha256').update(bytes).digest('hex') !== existing.stored_sha256) {
      throw new Error('Reference image changed on disk and was left unchanged.');
    }
    restoreIfMissing(image.filePath, bytes, originalLibrary.path);
    return toResult(existing);
  }

  const stored = await optimizeReference(validated);
  const destination = managedPath(library.path, stored.sha256);
  // Bytes are durable before the receipt commits. A crash keeps one managed file and no second catalog row.
  if (!reusableCatalogId(database, library, validated.sha256, stored.bytes)) {
    placeManagedFile(destination, stored.bytes);
  }

  return database.transaction(() => {
    const raced = readReceipt(database, requestId);
    if (raced) {
      if (raced.request_hash !== hash) throw new ReferenceImportConflictError();
      return toResult(raced);
    }
    let catalogImageId = reusableCatalogId(database, library, validated.sha256, stored.bytes);
    if (!catalogImageId) {
      placeManagedFile(destination, stored.bytes);
      catalogImageId = registerCatalogImage(
        {
          libraryId: library.id,
          filePath: destination,
          prompt: validated.name,
          width: stored.width,
          height: stored.height,
          mimeType: stored.mimeType,
          fileSizeBytes: stored.bytes.length,
          workspaceId: 'default',
          tags: ['imported reference'],
          generationConfig: {
            source: 'imported reference',
            sha256: validated.sha256,
            storedSha256: stored.sha256,
          },
        },
        database,
      ).id;
    }
    database
      .query(
        `INSERT INTO reference_import_receipts (
            request_id, request_hash, catalog_image_id, sha256, stored_sha256, mime_type, byte_length, name, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        requestId,
        hash,
        catalogImageId,
        validated.sha256,
        stored.sha256,
        stored.mimeType,
        stored.bytes.length,
        validated.name,
        new Date().toISOString(),
      );
    const saved = readReceipt(database, requestId);
    if (!saved) throw new Error('Reference import could not be saved.');
    return toResult(saved);
  })();
}
