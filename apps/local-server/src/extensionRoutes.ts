import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  compareExtensionVersions,
  EXTENSION_LAYERS,
  parseStylePackPreview,
  type ExtensionLayerName,
} from '../../../packages/shared/src/extensions';
import {
  ExtensionInstallError,
  extractPreviewArchive,
  installExtensionArchive,
  installExtensionLayer,
} from './extensionInstaller';
import type { ExtensionHubStore } from './extensionHubStore';
import {
  createHubSourceClient,
  ExtensionSourceError,
  HUB_SOURCE,
  normalizeHubUrl,
  type ExtensionHub,
  type ExtensionSourceClient,
  type RemoteExtensionSource,
} from './extensionSources';
import type { ExtensionStore } from './extensionStore';
import { extractImageMetadata } from './metadataEmbedder';
import {
  createLocalExtensionInstallHandler,
  LOCAL_EXTENSION_BODY_LIMIT,
} from './localExtensionInstall';

interface ExtensionRoutesDependencies {
  store: ExtensionStore;
  /** Remote install support; omitted in contexts that only read local extensions. */
  remote?: {
    client: ExtensionSourceClient;
    sources: RemoteExtensionSource[];
    installDir: string;
    /** The private hub the user unlocked with a URL and password, if any. */
    hub?: ExtensionHubStore;
    createHubClient?: (hub: ExtensionHub) => ExtensionSourceClient;
  };
  /**
   * Extension id Studio installs once when no style pack is present, such as `cozy.pack-00`
   * (Essentials). Omitted where Studio should not install anything by itself.
   */
  defaultPackId?: string;
}

export type DefaultPackState =
  | { state: 'idle' | 'installing' | 'installed' | 'skipped' }
  | { state: 'unavailable' | 'failed'; error: string };

/** Marks that the default pack was installed or declined, so removing it is not undone. */
const DEFAULT_PACK_MARKER = '.default-pack-offered';

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Lists, serves, installs and removes Cozy Extensions (ADR 0011). */
export function createExtensionRoutes({
  store,
  remote,
  defaultPackId,
}: ExtensionRoutesDependencies) {
  const app = new Hono();
  if (remote)
    app.post(
      '/install-local',
      bodyLimit({ maxSize: LOCAL_EXTENSION_BODY_LIMIT }),
      createLocalExtensionInstallHandler(store, remote.installDir),
    );
  const isInstalledCopy = (root: string) =>
    remote !== undefined && path.dirname(path.resolve(root)) === path.resolve(remote.installDir);

  // Configured sources plus the unlocked hub, read per request so unlocking needs no restart.
  const remoteSources = () => {
    if (!remote) return [];
    const hub = remote.hub?.read();
    return [
      ...remote.sources.map((source) => ({ source, client: remote.client, label: source.repo })),
      ...(hub
        ? [
            {
              source: HUB_SOURCE,
              client: (remote.createHubClient ?? createHubSourceClient)(hub),
              label: `Private hub · ${new URL(hub.url).host}`,
            },
          ]
        : []),
    ];
  };

  app.get('/', async (c) => {
    const { extensions, invalid } = await store.list({ refresh: c.req.query('refresh') === '1' });
    return c.json({
      extensions: extensions.map(({ manifest }) => manifest),
      installedLayers: Object.fromEntries(
        extensions.map(({ manifest, layers }) => [manifest.id, layers] as const),
      ),
      // Downloaded packs live in the install folder and can be removed; local ones are read in place.
      origins: Object.fromEntries(
        extensions.map(({ manifest, root, source }) => [
          manifest.id,
          { from: isInstalledCopy(root) ? 'download' : 'local', folder: source },
        ]),
      ),
      invalid: invalid.map(({ folder, issues }) => ({ folder: path.basename(folder), issues })),
    });
  });

  app.get('/available', async (c) => {
    if (!remote) return c.json({ error: 'Remote extension sources are not configured' }, 404);
    const installed = new Map(
      (await store.list()).extensions.map((item) => [item.manifest.id, item] as const),
    );
    const sources = await Promise.all(
      remoteSources().map(async ({ source, client, label }) => {
        try {
          const index = await client.fetchIndex(source);
          return {
            id: source.id,
            repo: source.repo,
            label,
            extensions: index.extensions.map((entry) => {
              const local = installed.get(entry.id);
              return {
                ...entry,
                installedVersion: local?.manifest.version ?? null,
                installedLayers: local?.layers ?? [],
                installedFrom: local ? (isInstalledCopy(local.root) ? 'download' : 'local') : null,
                updateAvailable: local
                  ? compareExtensionVersions(entry.version, local.manifest.version) > 0
                  : false,
              };
            }),
            error: null,
          };
        } catch (error) {
          return {
            id: source.id,
            repo: source.repo,
            label,
            extensions: [],
            error: errorMessage(error),
          };
        }
      }),
    );
    return c.json({ tokenConfigured: remote.client.tokenConfigured, sources });
  });

  /** Downloads, verifies and installs one published extension with the requested layers. */
  const installFromSource = async (
    client: ExtensionSourceClient,
    installDir: string,
    source: RemoteExtensionSource,
    id: string,
    requestedLayers: ExtensionLayerName[],
  ) => {
    const entry = (await client.fetchIndex(source)).extensions.find((item) => item.id === id);
    if (!entry) return null;
    const archive = await client.downloadAsset(source, entry.tag, entry.archive);
    const manifest = await installExtensionArchive({ archive, entry, installDir });
    const extensionRoot = path.join(installDir, entry.id);
    const installedLayers: string[] = [];
    const layersByName = new Map(entry.layers?.map((layer) => [layer.name, layer]));
    for (const name of requestedLayers) {
      const layer = layersByName.get(name);
      if (!layer) continue;
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Layers write the same extension root; finish each install before downloading the next.
      const layerArchive = await client.downloadAsset(source, entry.tag, layer.archive);
      await installExtensionLayer({ archive: layerArchive, layer, extensionRoot });
      installedLayers.push(name);
    }
    await store.list({ refresh: true });
    return { manifest, installedLayers };
  };

  app.post('/install', async (c) => {
    if (!remote) return c.json({ error: 'Remote extension sources are not configured' }, 404);
    const body = (await c.req.json().catch(() => null)) as {
      sourceId?: unknown;
      id?: unknown;
      layers?: unknown;
    };
    const requestedLayers = Array.isArray(body?.layers)
      ? body.layers.filter((layer): layer is ExtensionLayerName =>
          EXTENSION_LAYERS.includes(layer as ExtensionLayerName),
        )
      : [];
    const found = remoteSources().find((item) => item.source.id === body?.sourceId);
    if (!found || typeof body?.id !== 'string')
      return c.json({ error: 'Request needs a known sourceId and an extension id' }, 400);
    try {
      const result = await installFromSource(
        found.client,
        remote.installDir,
        found.source,
        body.id,
        requestedLayers,
      );
      if (!result) return c.json({ error: `${found.label} does not publish ${body.id}` }, 404);
      return c.json({ extension: result.manifest, installedLayers: result.installedLayers });
    } catch (error) {
      const status = error instanceof ExtensionInstallError ? 422 : 502;
      return c.json({ error: errorMessage(error) }, status);
    }
  });

  let defaultPack: DefaultPackState = { state: 'idle' };
  const markerPath = remote ? path.join(remote.installDir, DEFAULT_PACK_MARKER) : null;
  const markDefaultPackOffered = async () => {
    if (!markerPath) return;
    await mkdir(path.dirname(markerPath), { recursive: true });
    await writeFile(
      markerPath,
      `${new Date().toISOString()}
`,
      'utf8',
    );
  };

  const installDefaultPack = async (remoteSources: NonNullable<typeof remote>, id: string) => {
    try {
      for (const source of remoteSources.sources) {
        const result = await installFromSource(
          remoteSources.client,
          remoteSources.installDir,
          source,
          id,
          [],
        );
        if (!result) continue;
        await markDefaultPackOffered();
        defaultPack = { state: 'installed' };
        return;
      }
      defaultPack = { state: 'unavailable', error: `No source publishes ${id} yet.` };
    } catch (error) {
      defaultPack = { state: 'failed', error: errorMessage(error) };
    }
  };

  app.get('/default-pack', (c) => c.json(defaultPack));

  // Installs the default pack once when Studio has no style pack. Removing it later is respected.
  app.post('/default-pack', async (c) => {
    if (!remote || !defaultPackId || !markerPath) return c.json({ state: 'skipped' });
    if (defaultPack.state === 'installing') return c.json(defaultPack);
    if (existsSync(markerPath)) return c.json((defaultPack = { state: 'skipped' }));
    const { extensions } = await store.list();
    if (extensions.some(({ manifest }) => manifest.kind === 'style-pack')) {
      await markDefaultPackOffered();
      return c.json((defaultPack = { state: 'skipped' }));
    }
    defaultPack = { state: 'installing' };
    void installDefaultPack(remote, defaultPackId);
    return c.json(defaultPack);
  });

  // Previews downloaded from remote sources, cached per extension version.
  const previewCacheDir = remote ? path.join(path.dirname(remote.installDir), 'previews') : null;
  const PREVIEW_KEY = /^[a-z0-9][a-z0-9.-]*@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

  app.get('/remote-preview', async (c) => {
    if (!remote || !previewCacheDir)
      return c.json({ error: 'Remote extension sources are not configured' }, 404);
    const found = remoteSources().find((item) => item.source.id === c.req.query('source'));
    const id = c.req.query('id');
    if (!found || !id) return c.json({ error: 'Request needs a known source and an id' }, 400);
    const { source, client } = found;
    try {
      const entry = (await client.fetchIndex(source)).extensions.find((item) => item.id === id);
      if (!entry?.preview) return c.json({ error: `${id} has no published preview` }, 404);
      const key = `${entry.id}@${entry.version}`;
      const dir = path.join(previewCacheDir, key);
      if (!existsSync(path.join(dir, 'preview.json'))) {
        const archive = await client.downloadAsset(source, entry.tag, entry.preview.archive);
        await extractPreviewArchive({ archive, asset: entry.preview, targetDir: dir });
      }
      const preview = parseStylePackPreview(
        JSON.parse(await readFile(path.join(dir, 'preview.json'), 'utf8')),
      );
      if (!preview) return c.json({ error: `${id} has an invalid preview` }, 422);
      return c.json({ preview, imageBase: `/api/extensions/remote-preview-files/${key}/` });
    } catch (error) {
      const status = error instanceof ExtensionInstallError ? 422 : 502;
      return c.json({ error: errorMessage(error) }, status);
    }
  });

  app.get('/remote-preview-files/:key/*', async (c) => {
    const key = c.req.param('key');
    if (!previewCacheDir || !PREVIEW_KEY.test(key)) return c.json({ error: 'Not found' }, 404);
    const relativePath = decodeURIComponent(c.req.path.split(`/${key}/`)[1] ?? '');
    const contentType = CONTENT_TYPES[path.extname(relativePath).toLowerCase()];
    const root = path.join(previewCacheDir, key);
    const file = path.resolve(root, relativePath);
    if (!contentType || !file.startsWith(`${path.resolve(root)}${path.sep}`))
      return c.json({ error: 'Unsupported file' }, 400);
    if (!existsSync(file) || !(await stat(file)).isFile())
      return c.json({ error: 'Not found' }, 404);
    return c.body(new Uint8Array(await readFile(file)), 200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    });
  });

  app.get('/:id/preview', async (c) => {
    const id = c.req.param('id');
    const extension = (await store.list()).extensions.find((item) => item.manifest.id === id);
    if (!extension) return c.json({ error: 'Not found' }, 404);
    const previewFile = extension.manifest.files.preview;
    const raw = previewFile ? await store.readFile(id, previewFile) : null;
    const preview = raw ? parseStylePackPreview(JSON.parse(raw.toString('utf8'))) : null;
    if (!preview) return c.json({ error: `${id} has no preview` }, 404);
    return c.json({ preview, imageBase: `/api/extensions/${encodeURIComponent(id)}/files/` });
  });

  // The private hub: unlocking checks the password against the hub before saving it.
  app.get('/hub', (c) => {
    const hub = remote?.hub?.read();
    return c.json({ configured: Boolean(hub), url: hub?.url ?? null });
  });

  app.put('/hub', async (c) => {
    if (!remote?.hub) return c.json({ error: 'Private hubs are not available here' }, 404);
    const body = (await c.req.json().catch(() => null)) as { url?: unknown; password?: unknown };
    const url = typeof body?.url === 'string' ? normalizeHubUrl(body.url) : null;
    const password = typeof body?.password === 'string' ? body.password.trim() : '';
    if (!url) return c.json({ error: 'Enter the hub link, starting with https://' }, 400);
    if (!password || password.length > 256) return c.json({ error: 'Enter the password' }, 400);
    const hub = { url, password };
    try {
      const index = await (remote.createHubClient ?? createHubSourceClient)(hub).fetchIndex(
        HUB_SOURCE,
      );
      remote.hub.save(hub);
      return c.json({ configured: true, url, packs: index.extensions.length });
    } catch (error) {
      if (error instanceof ExtensionSourceError && (error.status === 401 || error.status === 403))
        return c.json({ error: 'Wrong password for this hub' }, 401);
      return c.json({ error: `Could not reach the hub: ${errorMessage(error)}` }, 502);
    }
  });

  app.delete('/hub', (c) => {
    remote?.hub?.clear();
    return c.body(null, 204);
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const extension = (await store.list()).extensions.find((item) => item.manifest.id === id);
    if (!extension) return c.json({ error: 'Not found' }, 404);
    if (!isInstalledCopy(extension.root))
      return c.json({ error: 'Built-in and local extensions cannot be removed here' }, 409);
    await rm(extension.root, { recursive: true, force: true });
    await store.list({ refresh: true });
    return c.body(null, 204);
  });

  app.get('/:id/files/*', async (c) => {
    const id = c.req.param('id');
    const relativePath = decodeURIComponent(c.req.path.split(`/${id}/files/`)[1] ?? '');
    const contentType = CONTENT_TYPES[path.extname(relativePath).toLowerCase()];
    if (!relativePath || !contentType) return c.json({ error: 'Unsupported file' }, 400);
    // A cards layer may carry only each style's main card; its variants fall back to their thumbnail.
    const file =
      (await store.readFile(id, relativePath)) ??
      (relativePath.startsWith('cards/')
        ? await store.readFile(id, `thumbnails/${relativePath.slice('cards/'.length)}`)
        : null);
    if (!file) return c.json({ error: 'Not found' }, 404);
    if (c.req.query('metadata') === 'true') {
      return c.json({ metadata: extractImageMetadata(file, path.extname(relativePath)) });
    }
    return c.body(new Uint8Array(file), 200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    });
  });

  return app;
}
