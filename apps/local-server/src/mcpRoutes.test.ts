import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createDefaultEditableStudioSettings } from '../../../packages/shared/src/studioSettings';
import { createMcpRoutes } from './mcpRoutes';

describe('Studio MCP boundary', () => {
  it('enforces live access, validates arguments and routes generation through persistent intake', async () => {
    const settings = createDefaultEditableStudioSettings();
    const requests: { path: string; body: unknown }[] = [];
    const workspaces = [{ id: 'default', name: 'Default' }];
    const image = (id: string, workspaceId: string | null, tags: string[] = []) => ({
      id,
      workspaceId,
      tags,
      isDeleted: false,
    });
    const images: Record<string, object> = {
      'reference-1': { ...image('reference-1', null), filePath: '/managed/reference.png' },
      'image-1': image('image-1', null),
      'image-2': image('image-2', 'default', ['pick']),
      foreign: image('foreign', 'other'),
      full: image(
        'full',
        'default',
        Array.from({ length: 32 }, (_, index) => `tag-${index}`),
      ),
    };
    const collections: { id: string; name: string; imageCount: number }[] = [];
    const app = new Hono().route(
      '/api/mcp',
      createMcpRoutes({
        readSettings: () => settings,
        request: async (path, init) => {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
          requests.push({ path, body });
          const catalogImage = images[path.slice('/api/catalog/'.length)];
          if (path.startsWith('/api/catalog/') && catalogImage && !init?.method)
            return Response.json(catalogImage);
          if (path === '/api/catalog/collections?workspace_id=default')
            return Response.json(collections);
          if (path === '/api/catalog/collections') {
            collections.push({ id: 'collection-1', name: body.name, imageCount: 2 });
            return Response.json(collections[0], { status: 201 });
          }
          if (path.startsWith('/api/catalog/collections/')) return Response.json(collections[0]);
          if (path.startsWith('/api/catalog?')) return Response.json({ images: [], total: 3 });
          if (path === '/api/workspaces')
            return init?.method === 'POST'
              ? Response.json(workspaces[workspaces.push(body) - 1], { status: 201 })
              : Response.json(workspaces);
          if (path.startsWith('/api/workspaces/')) {
            const workspace = workspaces.find(({ id }) => path.endsWith(`/${id}`));
            return Response.json(workspace ?? { error: 'Workspace not found' }, {
              status: workspace ? 200 : 404,
            });
          }
          if (path === '/api/catalog/tags?workspace_id=default')
            return Response.json([
              { name: 'cover', color: null, imageCount: 2, lastUsedAt: '2026-11-01' },
            ]);
          return Response.json({ ok: true });
        },
      }),
    );
    const call = (name: string, args = {}) =>
      app.request('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
      });
    const input = {
      requestId: 'batch-mcp-test',
      prompt: 'A quiet forest',
      task: 'image_edit',
      count: 2,
      referenceIds: ['reference-1'],
      workspaceId: 'default',
      tags: ['#Cover', 'cover', 'forest'],
      collection: 'Covers',
    };
    const denied = await call('studio_generate', input);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      error:
        'This tool needs Full control access. Agent access is Read only. Ask the user to change Agent access (MCP) in Studio Settings > Advanced & maintenance. Do not work around this with HTTP calls.',
      access: 'read',
      required: 'write',
    });
    expect((await call('studio_cancel', { jobId: 'job-1' })).status).toBe(403);
    const organize = {
      workspaceId: 'default',
      imageIds: ['image-1', 'image-2'],
      addTags: ['#Pick'],
      addToCollection: 'Picks',
    };
    expect(await (await call('studio_organize_images', organize)).json()).toMatchObject({
      access: 'read',
      required: 'organize',
    });
    expect(requests).toHaveLength(0);
    expect((await call('studio_recipes')).status).toBe(200);
    settings.mcpAccess = 'organize';
    expect((await call('studio_recipes')).status).toBe(200);
    const organizeDenied = await call('studio_generate', input);
    expect(organizeDenied.status).toBe(403);
    expect(await organizeDenied.json()).toMatchObject({ access: 'organize', required: 'write' });
    expect(requests).toHaveLength(0);
    settings.mcpAccess = 'write';
    expect((await call('studio_generate', { ...input, localPath: '/secret' })).status).toBe(400);
    expect(
      (await call('studio_extension_json', { extensionId: 'test', path: '../secret.json' })).status,
    ).toBe(400);
    expect((await call('studio_generate', { ...input, recipeId: 'missing' })).status).toBe(400);
    const { workspaceId: _workspaceId, ...withoutWorkspace } = input;
    const { tags: _tags, ...withoutTags } = input;
    for (const rejected of [
      withoutTags,
      withoutWorkspace,
      { ...input, workspaceName: 'Comic' },
      { ...input, workspaceId: 'missing' },
      { ...input, recipeId: 'sprite-atlas' },
      { ...input, recipeParams: { selectedStyles: [] } },
    ])
      expect((await call('studio_generate', rejected)).status).toBe(400);
    expect(requests.some(({ path }) => path === '/api/jobs/batches')).toBe(false);
    expect((await call('studio_generate', input)).status).toBe(200);
    const accepted = requests.at(-1);
    expect(accepted?.path).toBe('/api/jobs/batches');
    const filed = {
      workspaceId: 'default',
      sourceSpec: {
        metadata: { libraryOrganization: { tags: ['cover', 'forest'], collection: 'Covers' } },
      },
    };
    expect(accepted?.body).toMatchObject({
      requestId: input.requestId,
      items: [
        {
          providerId: 'chatgpt',
          kind: 'image_edit',
          ...filed,
          sourceSpec: { ...filed.sourceSpec, assets: [{ localPath: '/managed/reference.png' }] },
        },
        { providerId: 'chatgpt', kind: 'image_edit', ...filed },
      ],
    });
    await call('studio_generate', input);
    expect(requests.at(-1)).toEqual(accepted);

    // A new workspace gets an id derived from its name, so a replay sends the same batch.
    const named = {
      ...withoutWorkspace,
      requestId: 'batch-mcp-named',
      workspaceName: 'Comic Book',
    };
    const namedId = `ws-${createHash('sha256').update('comic book').digest('hex').slice(0, 12)}`;
    await call('studio_generate', named);
    const namedBatch = requests.at(-1);
    await call('studio_generate', named);
    expect(requests.at(-1)).toEqual(namedBatch);
    expect(requests.filter(({ path, body }) => path === '/api/workspaces' && body)).toHaveLength(1);
    expect(workspaces.at(-1)).toEqual({ id: namedId, name: 'Comic Book' });
    expect(namedBatch?.body).toMatchObject({ items: [{ workspaceId: namedId }, {}] });

    expect(await (await call('studio_workspaces', { workspaceId: 'default' })).json()).toEqual({
      workspace: { id: 'default', name: 'Default' },
      tags: [{ name: 'cover', color: null, imageCount: 2 }],
      collections: [],
      unorganized: 3,
    });
    expect((await call('studio_workspaces', { workspaceId: 'missing' })).status).toBe(400);

    settings.mcpAccess = 'organize';
    expect(await (await call('studio_status')).json()).toMatchObject({
      mcpAccessLabel: 'Organize',
      library: { unorganized: 3 },
      organizeNotice: expect.stringContaining('3 Library images have no tags or collection.'),
    });
    // Every image and tag change is checked before the first write.
    const writes = () => requests.filter(({ body }) => body);
    const writesBefore = writes().length;
    for (const [imageIds, rejected] of [
      [['image-1', 'foreign'], 'foreign'],
      [['image-1', 'full'], 'full'],
    ] as const) {
      const response = await call('studio_organize_images', { ...organize, imageIds });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ imageIds: [rejected] });
    }
    const unknownCollection = { ...organize, removeFromCollection: 'Missing' };
    expect((await call('studio_organize_images', unknownCollection)).status).toBe(400);
    expect(writes()).toHaveLength(writesBefore);
    expect(await (await call('studio_organize_images', organize)).json()).toEqual({
      workspaceId: 'default',
      imageCount: 2,
      tags: { added: ['pick'], removed: [] },
      collection: { id: 'collection-1', name: 'Picks', created: true, imageCount: 2 },
      removedFrom: null,
    });
    // image-2 already has the tag, so only image-1 is patched.
    expect(writes().slice(writesBefore)).toEqual([
      { path: '/api/catalog/image-1', body: { addTags: ['#Pick'] } },
      {
        path: '/api/catalog/collections',
        body: { workspaceId: 'default', name: 'Picks', imageIds: ['image-1', 'image-2'] },
      },
    ]);
    const repeated = await call('studio_organize_images', {
      ...organize,
      addToCollection: 'picks',
    });
    expect(await repeated.json()).toMatchObject({ collection: { created: false } });
    expect(requests.at(-1)).toEqual({
      path: '/api/catalog/collections/collection-1',
      body: { addImageIds: ['image-1', 'image-2'] },
    });

    settings.mcpAccess = 'write';
    expect((await call('studio_cancel', { jobId: 'job-1' })).status).toBe(200);
    expect(requests.at(-1)?.path).toBe('/api/jobs/job-1/cancel');
    settings.mcpAccess = 'off';
    expect((await call('studio_recipes')).status).toBe(403);
    expect((await call('studio_generate', input)).status).toBe(403);
  });

  it('routes onboarding, settings, packs and updates with an agent settings allowlist', async () => {
    const settings = createDefaultEditableStudioSettings();
    settings.mcpAccess = 'read';
    const requests: { method: string; path: string; body: unknown }[] = [];
    const app = new Hono().route(
      '/api/mcp',
      createMcpRoutes({
        readSettings: () => settings,
        request: async (path, init) => {
          requests.push({
            method: init?.method ?? 'GET',
            path,
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
          });
          if (init?.method === 'DELETE') return new Response(null, { status: 204 });
          return Response.json({ path });
        },
      }),
    );
    const call = (name: string, args = {}) =>
      app.request('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
      });
    const commit = 'a'.repeat(40);

    expect(await (await call('studio_onboarding')).json()).toMatchObject({
      probe: { path: '/api/onboarding/probe' },
      readiness: { path: '/api/readiness' },
      chatgptAuth: { path: '/api/auth/chatgpt' },
    });
    for (const name of ['studio_settings', 'studio_available_extensions', 'studio_updates'])
      expect((await call(name)).status).toBe(200);
    expect((await call('studio_updates', { check: true })).status).toBe(200);
    expect(requests.slice(-4).map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/settings',
      'GET /api/extensions/available',
      'GET /api/updates',
      'POST /api/updates/check',
    ]);

    const writes: [string, object][] = [
      ['studio_update_settings', { notifyOnUpdates: false }],
      ['studio_install_extension', { sourceId: 'styles', extensionId: 'pack-1' }],
      ['studio_remove_extension', { extensionId: 'pack-1' }],
      ['studio_apply_update', { commit }],
    ];
    const before = requests.length;
    for (const [name, args] of writes) expect((await call(name, args)).status).toBe(403);
    expect(requests).toHaveLength(before);

    settings.mcpAccess = 'write';
    for (const forbidden of [
      { mcpAccess: 'write' },
      { mcpAllowedImportRoots: ['C:/'] },
      { toolsPanelSide: 'left' },
      { preferredWorkflow: 'not-a-workflow' },
      {},
    ])
      expect((await call('studio_update_settings', forbidden)).status).toBe(400);
    expect(requests).toHaveLength(before);

    const patch = {
      defaultProviderId: 'chatgpt',
      outputOrganization: { subfolderTokens: ['date'] },
    };
    expect((await call('studio_update_settings', patch)).status).toBe(200);
    expect(requests.at(-1)).toEqual({ method: 'PATCH', path: '/api/settings', body: patch });
    await call('studio_install_extension', {
      sourceId: 'styles',
      extensionId: 'pack-1',
      layers: ['cards'],
    });
    expect(requests.at(-1)).toEqual({
      method: 'POST',
      path: '/api/extensions/install',
      body: { sourceId: 'styles', id: 'pack-1', layers: ['cards'] },
    });
    expect(await (await call('studio_remove_extension', { extensionId: 'pack-1' })).json()).toEqual(
      { removed: 'pack-1' },
    );
    expect(requests.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/extensions/pack-1' });
    expect((await call('studio_apply_update', { commit: 'main' })).status).toBe(400);
    expect((await call('studio_apply_update', { commit })).status).toBe(200);
    expect(requests.at(-1)).toEqual({
      method: 'POST',
      path: '/api/updates/apply',
      body: { commit },
    });
  });
});
