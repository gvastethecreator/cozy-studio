import { z } from 'zod';
import { validateCatalogTags, validateTagColor } from './catalogTags';
import { validateCatalogCollectionName, validateCollectionEmoji } from './catalogCollections';
import { isRecord } from './types';
import type { StudioWorkspace } from './workspaceContracts';

export const LIBRARY_ARCHIVE_FORMAT = 'cozy-studio.library';
export const LIBRARY_ARCHIVE_VERSION = 1;
export const LIBRARY_ARCHIVE_MAX_BYTES = 1024 * 1024 * 1024;
export const LIBRARY_ARCHIVE_IMAGE_PATH = /^images\/[A-Za-z0-9-]{1,64}\.(png|jpg|jpeg|webp|gif)$/;

const privateKey = /path|url|secret|token|password|credential|authorization|api.?key|job.?id/i;
const localLocation = /^(?:[A-Za-z]:[\\/]|[\\/]|file:|data:)/i;

function portableParameter(value: unknown, depth = 0): unknown {
  if (depth > 10) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string')
    return value.length <= 65_536 && !localLocation.test(value) ? value : undefined;
  if (Array.isArray(value))
    return value.slice(0, 2000).map((item) => portableParameter(item, depth + 1) ?? null);
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 2000)
      .flatMap(([key, item]) => {
        if (privateKey.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key))
          return [];
        const clean = portableParameter(item, depth + 1);
        return clean === undefined ? [] : [[key, clean]];
      }),
  );
}

/** Recipe parameters are data, never a portable source-asset reference. */
export function portableGenerationConfig(config: unknown): Record<string, unknown> {
  if (!isRecord(config)) return {};
  const result: Record<string, unknown> = {};
  for (const key of [
    'prompt',
    'negativePrompt',
    'recipeId',
    'aspectRatio',
    'imageSize',
    'outputBackground',
    'executionModel',
    'executionSpeed',
    'executionReasoningEffort',
    'batchCount',
    'temperature',
    'providerId',
  ]) {
    const value = config[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      result[key] = value;
  }
  if (isRecord(config.recipeParams)) result.recipeParams = portableParameter(config.recipeParams);
  if (Array.isArray(config.attachments)) {
    result.attachments = config.attachments
      .slice(0, 100)
      .filter(isRecord)
      .map((attachment) => ({
        name:
          typeof attachment.name === 'string'
            ? (attachment.name.split(/[\\/]/).pop()?.slice(0, 256) ?? '')
            : '',
        ...(attachment.role === 'input' || attachment.role === 'reference'
          ? { role: attachment.role }
          : {}),
        ...(typeof attachment.strength === 'number' && Number.isFinite(attachment.strength)
          ? { strength: attachment.strength }
          : {}),
      }));
  }
  return result;
}

function validated<T>(check: (value: unknown) => T) {
  return z.unknown().transform((value, ctx) => {
    try {
      return check(value);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid value',
      });
      return z.NEVER;
    }
  });
}

const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const text = z.string().max(65_536).nullable();
const shortText = z.string().max(256).nullable();
export const libraryArchiveManifest = z
  .object({
    format: z.literal(LIBRARY_ARCHIVE_FORMAT),
    version: z.literal(LIBRARY_ARCHIVE_VERSION),
    exportedAt: z.iso.datetime(),
    studioVersion: z.string().min(1).max(64),
    workspace: z
      .object({
        name: z.string().trim().min(1).max(128),
        sortOrder: z.enum(['newest', 'oldest', 'favorite']),
      })
      .strict(),
    tags: z
      .array(
        z
          .object({
            name: validated((value) => validateCatalogTags([value])[0]),
            color: validated(validateTagColor),
          })
          .strict(),
      )
      .max(20_000),
    collections: z
      .array(
        z
          .object({
            name: validated(validateCatalogCollectionName),
            emoji: validated(validateCollectionEmoji),
            imageIds: z.array(id).max(20_000),
          })
          .strict(),
      )
      .max(20_000),
    images: z
      .array(
        z
          .object({
            id,
            file: z.string().regex(LIBRARY_ARCHIVE_IMAGE_PATH),
            mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
            width: z.number().int().positive().nullable(),
            height: z.number().int().positive().nullable(),
            prompt: text,
            negativePrompt: text,
            aspectRatio: shortText,
            imageSize: shortText,
            recipeId: shortText,
            batchId: shortText,
            tags: validated(validateCatalogTags),
            isFavorite: z.boolean(),
            createdAt: z.iso.datetime(),
            providerId: shortText,
            generationConfig: z.record(z.string(), z.unknown()).transform(portableGenerationConfig),
          })
          .strict(),
      )
      .max(20_000),
    missing: z.array(z.object({ id, reason: z.literal('file_missing') }).strict()).max(20_000),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const unique = (values: string[], label: string) => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', message: `Duplicate ${label}` });
    };
    unique(
      [...manifest.images, ...manifest.missing].map((image) => image.id),
      'image id',
    );
    unique(
      manifest.images.map((image) => image.file),
      'image file',
    );
    const fold = (name: string) => name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    unique(
      manifest.tags.map((tag) => tag.name),
      'tag',
    );
    unique(
      manifest.collections.map((collection) => fold(collection.name)),
      'collection',
    );
    const ids = new Set([...manifest.images, ...manifest.missing].map((image) => image.id));
    if (
      manifest.collections.some((collection) =>
        collection.imageIds.some((value) => !ids.has(value)),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Collection refers to an unknown image' });
  });

export type LibraryArchiveManifest = z.infer<typeof libraryArchiveManifest>;
export interface LibraryArchiveImportResult {
  workspace: StudioWorkspace;
  imported: number;
  skipped: { file: string; reason: string }[];
  missing: LibraryArchiveManifest['missing'];
}
