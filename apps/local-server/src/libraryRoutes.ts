import { existsSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { resolvePublicLibraryPath } from './library';
import {
  buildLibraryAssetHeaders,
  ensureThumbnailVariant,
  resolveAssetCacheSeconds,
  resolveThumbnailMaxEdge,
} from './libraryAssetVariants';
import type { log } from './logger';
import { isPublicLibraryAssetPath } from './publicLibraryAssetPolicy';

interface LibraryRoutesDependencies {
  resolvePublicLibraryPath: typeof resolvePublicLibraryPath;
  resolvePublicLibraryAssetRequest?: (
    relativePath: string,
  ) => { filePath: string; assetRelativePath: string } | null;
  ensureThumbnailVariant: typeof ensureThumbnailVariant;
  buildLibraryAssetHeaders: typeof buildLibraryAssetHeaders;
  resolveAssetCacheSeconds: typeof resolveAssetCacheSeconds;
  resolveThumbnailMaxEdge: typeof resolveThumbnailMaxEdge;
  isPublicLibraryAssetPath?: typeof isPublicLibraryAssetPath;
  fileExists?: (filePath: string) => boolean;
  createFileResponse?: (filePath: string) => Response;
  logger?: typeof log;
}

const NOT_MODIFIED_HEADERS = ['ETag', 'Cache-Control', 'Last-Modified'] as const;

function stripWeakPrefix(tag: string) {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

/** If-None-Match uses weak comparison: `*`, or any listed tag equal to the current one, W/ ignored. */
function ifNoneMatchHits(header: string | undefined, etag: string | undefined) {
  if (!header || !etag) return false;
  const value = header.trim();
  if (value === '*') return true;
  const current = stripWeakPrefix(etag);
  return value.split(',').some((candidate) => stripWeakPrefix(candidate.trim()) === current);
}

export function createLibraryRoutes({
  resolvePublicLibraryPath,
  resolvePublicLibraryAssetRequest,
  ensureThumbnailVariant,
  buildLibraryAssetHeaders,
  resolveAssetCacheSeconds,
  resolveThumbnailMaxEdge,
  isPublicLibraryAssetPath: canServePublicLibraryAsset = isPublicLibraryAssetPath,
  fileExists = existsSync,
  createFileResponse = (filePath: string) => new Response(Bun.file(filePath)),
  logger,
}: LibraryRoutesDependencies) {
  const routes = new Hono();

  routes.get('/library/*', async (c) => {
    const encoded = c.req.path.replace('/library/', '');
    let relative = '';
    try {
      relative = decodeURIComponent(encoded);
    } catch {
      return c.notFound();
    }
    const resolved = resolvePublicLibraryAssetRequest?.(relative) ?? {
      filePath: resolvePublicLibraryPath(relative),
      assetRelativePath: relative,
    };
    if (!resolved || !canServePublicLibraryAsset(resolved.assetRelativePath)) return c.notFound();
    const filePath = resolved.filePath;
    if (!fileExists(filePath)) return c.notFound();

    const url = new URL(c.req.url);
    const variant = url.searchParams.get('variant');
    let servedPath = filePath;

    if (variant === 'thumb') {
      try {
        servedPath = await ensureThumbnailVariant(filePath, {
          maxEdge: resolveThumbnailMaxEdge(url.searchParams.get('max')),
        });
      } catch (error) {
        logger?.(
          'warn',
          'library',
          `Thumbnail generation failed for ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const headers = buildLibraryAssetHeaders(servedPath, {
      cacheSeconds: resolveAssetCacheSeconds(variant),
    });

    // A matching validator wins over Range (RFC 9110 13.2.2), so a revalidating browser gets
    // a 304 without the file being opened.
    if (ifNoneMatchHits(c.req.header('If-None-Match'), headers.ETag)) {
      const notModified = new Headers();
      for (const name of NOT_MODIFIED_HEADERS) {
        const value = headers[name];
        if (value) notModified.set(name, value);
      }
      return new Response(null, { status: 304, headers: notModified });
    }

    // The Bun.file response goes out as it is, so Bun sends the file directly; copying its body
    // into a new Response turned it into a plain stream.
    const fileResponse = createFileResponse(servedPath);
    for (const [name, value] of Object.entries(headers)) fileResponse.headers.set(name, value);
    return fileResponse;
  });

  return routes;
}
