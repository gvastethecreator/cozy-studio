import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LIBRARY_ARCHIVE_MAX_BYTES } from '../../../packages/shared/src/libraryArchive';
import {
  exportLibraryArchive,
  importLibraryArchive,
  LibraryArchiveError,
  type LibraryArchiveDependencies,
} from './libraryArchive';

export function createLibraryArchiveRoutes(
  deps: LibraryArchiveDependencies & {
    publishEvent?: (type: string, payload: unknown) => void;
  } = {},
) {
  const routes = new Hono();
  routes.get('/:id/export', (c) => {
    try {
      const result = exportLibraryArchive(c.req.param('id'), deps);
      return new Response(Readable.toWeb(result.stream) as ReadableStream<Uint8Array>, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
          'X-Archive-Images': String(result.images),
          'X-Archive-Missing': String(result.missing),
          'Access-Control-Expose-Headers':
            'Content-Disposition, X-Archive-Images, X-Archive-Missing',
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Archive export failed.' },
        error instanceof LibraryArchiveError ? error.status : 500,
      );
    }
  });
  routes.post('/import', bodyLimit({ maxSize: LIBRARY_ARCHIVE_MAX_BYTES }), async (c) => {
    if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/zip')
      return c.json({ error: 'Choose a Library ZIP archive.' }, 400);
    try {
      const result = await importLibraryArchive(
        Buffer.from(await c.req.arrayBuffer()),
        { name: c.req.query('name') },
        deps,
      );
      deps.publishEvent?.('catalog.batch_changed', {
        action: 'import',
        changedCount: result.imported,
        scope: { kind: 'workspace', workspaceId: result.workspace.id },
      });
      return c.json(result, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Invalid Library archive.' },
        error instanceof LibraryArchiveError ? error.status : 500,
      );
    }
  });
  return routes;
}
