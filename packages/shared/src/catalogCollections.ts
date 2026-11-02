import { normalizeImageHashtag, validateCatalogTags } from './catalogTags';
import { isRecord } from './types';

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

/** Tags and a collection that Studio applies to each Catalog Entry of a generation as it is saved. */
export interface LibraryOrganization {
  tags: string[];
  collection: string | null;
}

/** Throws on invalid input. Returns null when nothing is requested. */
export function parseLibraryOrganization(value: unknown): LibraryOrganization | null {
  if (value == null) return null;
  if (!isRecord(value)) throw new Error('Library organization must be an object.');
  const tags = [...new Set(validateCatalogTags(value.tags ?? []).map(normalizeImageHashtag))];
  const collection =
    value.collection == null ? null : validateCatalogCollectionName(value.collection);
  return tags.length || collection ? { tags, collection } : null;
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

/** One organize call: the same tag and collection changes for every image, all or nothing. */
export interface CatalogOrganizeInput {
  workspaceId: string;
  imageIds: string[];
  addTags?: string[];
  removeTags?: string[];
  /** Created when the workspace has no collection of that name. */
  addToCollection?: string;
  removeFromCollection?: string;
}

/** The ids each change touched; images that already had a tag or membership are not listed. */
export interface CatalogOrganizeResult {
  workspaceId: string;
  imageCount: number;
  tags: { added: Record<string, string[]>; removed: Record<string, string[]> };
  collection: {
    id: string;
    name: string;
    created: boolean;
    imageCount: number;
    addedImageIds: string[];
  } | null;
  removedFrom: { id: string; name: string; removedImageIds: string[] } | null;
}

/** A rejected organize call. It changed nothing; `imageIds` names the images at fault. */
export class CatalogOrganizeError extends Error {
  constructor(
    message: string,
    readonly imageIds?: string[],
  ) {
    super(message);
  }
}

const ORGANIZE_KEYS = [
  'workspaceId',
  'imageIds',
  'addTags',
  'removeTags',
  'addToCollection',
  'removeFromCollection',
];

/** A tag name as Studio stores it, so #Pick and pick are one name. */
function storedTagName(name: string) {
  try {
    return normalizeImageHashtag(name).toLowerCase();
  } catch {
    return name.toLowerCase();
  }
}

/** Throws on invalid input, on a call with no change and on one that adds and removes one name. */
export function parseCatalogOrganizeInput(value: unknown): CatalogOrganizeInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !ORGANIZE_KEYS.includes(key))) {
    throw new Error(`Send an object with only ${ORGANIZE_KEYS.join(', ')}.`);
  }
  const tags = (list: unknown) => {
    const names = list === undefined ? [] : validateCatalogTags(list);
    return names.length ? names : undefined;
  };
  const collection = (name: unknown) =>
    name === undefined ? undefined : validateCatalogCollectionName(name);
  const input: CatalogOrganizeInput = {
    workspaceId: validateCatalogCollectionWorkspaceId(value.workspaceId),
    imageIds: validateCatalogCollectionImageIds(value.imageIds),
    addTags: tags(value.addTags),
    removeTags: tags(value.removeTags),
    addToCollection: collection(value.addToCollection),
    removeFromCollection: collection(value.removeFromCollection),
  };
  if (!input.addTags && !input.removeTags && !input.addToCollection && !input.removeFromCollection)
    throw new Error('Set addTags, removeTags, addToCollection or removeFromCollection.');
  const removed = new Set(input.removeTags?.map(storedTagName));
  if (
    input.addTags?.some((name) => removed.has(storedTagName(name))) ||
    (input.addToCollection &&
      input.addToCollection.toLowerCase() === input.removeFromCollection?.toLowerCase())
  )
    throw new Error('Do not add and remove the same tag or collection.');
  return input;
}
