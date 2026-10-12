import { createHash, randomUUID } from 'node:crypto';
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
import type { Database } from 'bun:sqlite';
import {
  referenceImportInput,
  referenceImportResult,
  STUDIO_REFERENCE_IMPORT_MAX_BYTES,
  STUDIO_REFERENCE_IMPORT_MAX_DIMENSION,
  type StudioReferenceImportInput,
  type StudioReferenceImportResult,
} from '../../../packages/shared/src/studioMcp';
import { getCatalogImage, registerCatalogImage } from './catalog';
import { getDb } from './db/connection';
import { readImageMetadata } from './imagePipeline';
import { resolveLibraryPathFromRoot } from './library';
import { getDefaultLibrary, getLibrary } from './libraries';
import {
  prepareReferencesForPersistence,
  ReferenceProcessingError,
} from './referenceManager';

const MIME_FORMAT = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;
const MIME_EXTENSION = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
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
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function managedPath(libraryPath: string, sha256: string, mimeType: ReferenceMime) {
  const destination = resolveLibraryPathFromRoot(
    libraryPath,
    'references',
    'imports',
    `${sha256}${MIME_EXTENSION[mimeType]}`,
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
      `SELECT request_id, request_hash, catalog_image_id, sha256, mime_type, byte_length, name
       FROM reference_import_receipts WHERE request_id = ?`,
    )
    .get(requestId) as ReceiptRow | null;
}

function toResult(row: ReceiptRow): StudioReferenceImportResult {
  return referenceImportResult.parse({
    requestId: row.request_id,
    catalogImageId: row.catalog_image_id,
    sha256: row.sha256,
    mimeType: row.mime_type,
    byteLength: row.byte_length,
  });
}

async function validateReference(input: StudioReferenceImportInput): Promise<ValidatedReference> {
  const parsed = referenceImportInput.safeParse(input);
  if (!parsed.success) throw new Error('Invalid reference import.');
  let decoded: ReturnType<typeof prepareReferencesForPersistence>[number];
  try {
    decoded = prepareReferencesForPersistence(
      [
        {
          name: parsed.data.name,
          dataUrl: `data:${parsed.data.mimeType};base64,${parsed.data.base64}`,
          strength: 1,
        },
      ],
      {
        maxCount: 1,
        maxBytes: STUDIO_REFERENCE_IMPORT_MAX_BYTES,
        maxTotalBytes: STUDIO_REFERENCE_IMPORT_MAX_BYTES,
        maxOutputBytes: STUDIO_REFERENCE_IMPORT_MAX_BYTES,
      },
    )[0]!;
  } catch (error) {
    if (error instanceof ReferenceProcessingError) {
      throw new Error(
        error.reason.includes('exceeds')
          ? 'Reference image exceeds 8 MiB.'
          : 'Reference image bytes are invalid.',
      );
    }
    throw error;
  }
  const bytes = Buffer.from(decoded.bytes);
  if (bytes.length === 0 || bytes.length > STUDIO_REFERENCE_IMPORT_MAX_BYTES) {
    throw new Error('Reference image exceeds 8 MiB.');
  }
  const actualSha = createHash('sha256').update(bytes).digest('hex');
  if (actualSha !== parsed.data.sha256) {
    throw new Error('Reference digest does not match the image bytes.');
  }
  if (mimeFromSignature(bytes) !== parsed.data.mimeType) {
    throw new Error('Reference image type does not match its contents.');
  }
  let metadata: Awaited<ReturnType<typeof readImageMetadata>>;
  try {
    metadata = await readImageMetadata(bytes);
  } catch {
    throw new Error('Reference image could not be decoded.');
  }
  if (metadata.format !== MIME_FORMAT[parsed.data.mimeType]) {
    throw new Error('Reference image type does not match its contents.');
  }
  if (!metadata.width || !metadata.height) {
    throw new Error('Reference image could not be decoded.');
  }
  if (
    metadata.width > STUDIO_REFERENCE_IMPORT_MAX_DIMENSION ||
    metadata.height > STUDIO_REFERENCE_IMPORT_MAX_DIMENSION
  ) {
    throw new Error('Reference image exceeds 2560 pixels on a side.');
  }
  return {
    name: parsed.data.name,
    mimeType: parsed.data.mimeType,
    sha256: parsed.data.sha256,
    bytes,
    width: metadata.width,
    height: metadata.height,
  };
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

function reusableCatalogId(database: Database, library: ImportLibrary, validated: ValidatedReference) {
  const rows = database
    .query(
      `SELECT catalog_image_id FROM reference_import_receipts
       WHERE sha256 = ? ORDER BY created_at ASC, request_id ASC`,
    )
    .all(validated.sha256) as Array<{ catalog_image_id: string }>;
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
      !readFileSync(image.filePath).equals(validated.bytes)
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
    const validated = await validateReference(input);
    const hash = requestHash(validated);
    const database = deps.database ?? getDb();
    const library = deps.library ?? getDefaultLibrary();
    if (!library) throw new Error('No studio library registered.');
    const existing = readReceipt(database, input.requestId);
    if (existing) {
      if (existing.request_hash !== hash) throw new ReferenceImportConflictError();
      const image = getCatalogImage(existing.catalog_image_id, database);
      const originalLibrary = image && getLibrary(image.libraryId, database);
      if (!image || image.isDeleted || !originalLibrary) {
        throw new Error('Reference image is no longer available in the catalog.');
      }
      restoreIfMissing(image.filePath, validated.bytes, originalLibrary.path);
      return toResult(existing);
    }

    const destination = managedPath(library.path, validated.sha256, validated.mimeType);
    // Bytes are durable before the receipt commits. A crash keeps one managed file and no second catalog row.
    if (!reusableCatalogId(database, library, validated)) {
      placeManagedFile(destination, validated.bytes);
    }

    return database.transaction(() => {
      const raced = readReceipt(database, input.requestId);
      if (raced) {
        if (raced.request_hash !== hash) throw new ReferenceImportConflictError();
        return toResult(raced);
      }
      let catalogImageId = reusableCatalogId(database, library, validated);
      if (!catalogImageId) {
        placeManagedFile(destination, validated.bytes);
        catalogImageId = registerCatalogImage(
          {
            libraryId: library.id,
            filePath: destination,
            prompt: validated.name,
            width: validated.width,
            height: validated.height,
            mimeType: validated.mimeType,
            fileSizeBytes: validated.bytes.length,
            workspaceId: 'default',
            tags: ['imported reference'],
            generationConfig: { source: 'imported reference' },
          },
          database,
        ).id;
      }
      database
        .query(
          `INSERT INTO reference_import_receipts (
            request_id, request_hash, catalog_image_id, sha256, mime_type, byte_length, name, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.requestId,
          hash,
          catalogImageId,
          validated.sha256,
          validated.mimeType,
          validated.bytes.length,
          validated.name,
          new Date().toISOString(),
        );
      const saved = readReceipt(database, input.requestId);
      if (!saved) throw new Error('Reference import could not be saved.');
      return toResult(saved);
    })();
  } catch (error) {
    throw publicImportError(error);
  }
}
