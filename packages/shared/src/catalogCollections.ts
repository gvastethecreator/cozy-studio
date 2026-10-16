export const MAX_CATALOG_COLLECTION_NAME = 80;
export const MAX_CATALOG_COLLECTION_IMAGES = 2000;
const emojiSegmenter = new Intl.Segmenter();

export interface CatalogCollection {
  id: string;
  workspaceId: string;
  name: string;
  emoji?: string | null;
  lastUsedAt?: string | null;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogCollectionPatch {
  name?: string;
  emoji?: string | null;
  addImageIds?: string[];
  removeImageIds?: string[];
}

export function validateCollectionEmoji(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    value.length > 32 ||
    [...emojiSegmenter.segment(value)].length !== 1 ||
    !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value)
  ) {
    throw new Error('Choose one emoji.');
  }
  return value;
}

export interface CatalogCollectionSelection extends CatalogCollection {
  selectedImageCount: number;
}

export function validateCatalogCollectionWorkspaceId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Workspace id is required.');
  const workspaceId = value.trim();
  if (!workspaceId || workspaceId.length > 128 || /[\u0000-\u001f\u007f]/u.test(workspaceId)) {
    throw new Error('Workspace id is required.');
  }
  return workspaceId;
}

export function validateCatalogCollectionName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Collection name is required.');
  const name = value.trim().replace(/\s+/gu, ' ').normalize('NFC');
  if (!name || name.length > MAX_CATALOG_COLLECTION_NAME) {
    throw new Error(`Use a collection name of up to ${MAX_CATALOG_COLLECTION_NAME} characters.`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error('Collection name cannot include control characters.');
  }
  return name;
}

export function validateCatalogCollectionImageIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CATALOG_COLLECTION_IMAGES) {
    throw new Error(`Choose 1 to ${MAX_CATALOG_COLLECTION_IMAGES} images.`);
  }
  if (
    value.some(
      (id) =>
        typeof id !== 'string' ||
        !id.trim() ||
        id.length > 200 ||
        /[\u0000-\u001f\u007f]/u.test(id),
    )
  ) {
    throw new Error('Image ids must be non-empty text.');
  }
  return [...new Set(value.map((id) => id.trim()))];
}
