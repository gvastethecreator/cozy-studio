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

    // The Bun.file response goes out as it is, so Bun sends the file directly; copying its body
    // into a new Response turned it into a plain stream.
    const fileResponse = createFileResponse(servedPath);
    const headers = buildLibraryAssetHeaders(servedPath, {
      cacheSeconds: resolveAssetCacheSeconds(variant),
    });
    for (const [name, value] of Object.entries(headers)) fileResponse.headers.set(name, value);
    return fileResponse;
  });

  return routes;
}
