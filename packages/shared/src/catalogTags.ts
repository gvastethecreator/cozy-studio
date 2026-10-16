export const MAX_CATALOG_TAGS = 32;
export const MAX_CATALOG_TAG_LENGTH = 64;

export interface CatalogTagChanges {
  addTags?: string[];
  removeTags?: string[];
}

export interface CatalogTag {
  name: string;
  color: string | null;
  imageCount: number;
  lastUsedAt: string | null;
}

export interface CatalogTagPatch {
  name?: string;
  color?: string | null;
}

export function validateTagColor(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) {
    throw new Error('Choose a six-digit hex color.');
  }
  return value.toLowerCase();
}

const hashtagPattern = /^[\p{L}\p{M}\p{N}_-]+$/u;

export function normalizeImageHashtag(value: string): string {
  const tag = value.trim().replace(/^#/, '').toLowerCase().normalize('NFC');
  if (!tag || !hashtagPattern.test(tag)) {
    throw new Error('Use letters, numbers, underscores or hyphens in each hashtag.');
  }
  if (tag.length > MAX_CATALOG_TAG_LENGTH) {
    throw new Error(`Each hashtag can have up to ${MAX_CATALOG_TAG_LENGTH} characters.`);
  }
  return tag;
}

export function parseImageHashtags(input: string): string[] {
  return [
    ...new Set(
      input
        .trim()
        .split(/[\s,]+/u)
        .filter(Boolean)
        .map(normalizeImageHashtag),
    ),
  ];
}

export function validateCatalogTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_CATALOG_TAGS) {
    throw new Error(`Use an array of up to ${MAX_CATALOG_TAGS} tags.`);
  }
  if (
    value.some(
      (tag) =>
        typeof tag !== 'string' ||
        !tag.trim() ||
        tag.length > MAX_CATALOG_TAG_LENGTH ||
        /[\u0000-\u001f\u007f]/u.test(tag),
    )
  ) {
    throw new Error(`Tags must be non-empty text of up to ${MAX_CATALOG_TAG_LENGTH} characters.`);
  }
  // Catalog tags also include existing metadata such as "imported reference".
  return [...new Set(value as string[])];
}

export function applyCatalogTagChanges(
  current: string[],
  changes: CatalogTagChanges,
  knownTags: readonly string[] = [],
): string[] {
  const known = new Set(knownTags);
  const added =
    changes.addTags === undefined
      ? []
      : validateCatalogTags(changes.addTags).map((tag) =>
          known.has(tag) ? tag : normalizeImageHashtag(tag),
        );
  const removed = new Set(
    changes.removeTags === undefined ? [] : validateCatalogTags(changes.removeTags),
  );
  const kept = current.filter((tag) => !removed.has(tag));
  // SQLite NOCASE folds ASCII only; preserve older Unicode tags beside the canonical hashtag.
  const existing = new Set(
    kept.map((tag) => tag.replace(/[A-Z]/g, (letter) => letter.toLowerCase())),
  );
  return validateCatalogTags([...kept, ...added.filter((tag) => !existing.has(tag))]);
}

export function parseCatalogSearch(query: string) {
  const tags: string[] = [];
  const text = query
    .replace(/(^|\s)#("(?:[^"\\]|\\.)*"|[\p{L}\p{M}\p{N}_-]+)(?=\s|$)/gu, (token, space, tag) => {
      try {
        tags.push(
          ...validateCatalogTags([
            tag.startsWith('"') ? JSON.parse(tag) : normalizeImageHashtag(tag),
          ]),
        );
      } catch {
        return token;
      }
      return space;
    })
    .trim()
    .replace(/\s+/gu, ' ');
  return { text, tags: [...new Set(tags)] };
}

export function formatCatalogSearchTag(tag: string) {
  const canonical =
    hashtagPattern.test(tag) &&
    tag.length <= MAX_CATALOG_TAG_LENGTH &&
    tag.toLowerCase().normalize('NFC') === tag;
  return `#${canonical ? tag : JSON.stringify(tag)}`;
}
