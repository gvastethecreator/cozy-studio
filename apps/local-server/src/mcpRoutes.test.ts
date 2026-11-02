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
    const app = new Hono().route(
      '/api/mcp',
      createMcpRoutes({
        readSettings: () => settings,
        request: async (path, init) => {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
          requests.push({ path, body });
          if (path === '/api/catalog/reference-1')
            return Response.json({
              id: 'reference-1',
              filePath: '/managed/reference.png',
              isDeleted: false,
            });
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
    });
    expect((await call('studio_workspaces', { workspaceId: 'missing' })).status).toBe(400);
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
