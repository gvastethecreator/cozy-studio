import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import catalog from '../../../packages/shared/src/styles/intentional-v1/catalog.fixture.json';
import { createGenerationTaskSpec } from '../../../packages/shared/src/generationContracts';
import { summarizeJobBatch } from '../../../packages/shared/src/jobBatches';
import { createDefaultEditableStudioSettings } from '../../../packages/shared/src/studioSettings';
import type { Job, JobStatus } from '../../../packages/shared/src/types';
import { createMcpRoutes } from './mcpRoutes';

const headshot = catalog.find(({ id }) => id === 'SP01-001')!;
const runtimePack = {
  id: headshot.packId,
  name: headshot.packName,
  description: '',
  presets: [
    {
      id: headshot.id,
      name: headshot.name,
      category: 'Portrait',
      style: headshot.snapshot.dna,
      intentional: { policy: headshot.snapshot.policy, presetVersion: headshot.snapshot.version },
    },
  ],
};
const styleExtension = {
  id: 'cozy.fixture',
  kind: 'style-pack',
  files: { runtime: 'runtime.json' },
  stylePack: { id: headshot.packId },
};

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
    const collections: object[] = [];
    let workspacesDown = false;
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
            collections.push({
              id: 'collection-1',
              workspaceId: 'default',
              name: body.name,
              emoji: null,
              imageCount: 2,
            });
            return Response.json(collections[0], { status: 201 });
          }
          if (path.startsWith('/api/catalog/collections/')) return Response.json(collections[0]);
          if (path.startsWith('/api/catalog?')) return Response.json({ images: [], total: 3 });
          if (path === '/api/workspaces')
            return init?.method === 'POST'
              ? Response.json(workspaces[workspaces.push(body) - 1], { status: 201 })
              : Response.json(workspacesDown ? { error: 'Unavailable' } : workspaces, {
                  status: workspacesDown ? 500 : 200,
                });
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
          if (path === '/api/extensions') return Response.json({ extensions: [styleExtension] });
          if (path === '/api/extensions/cozy.fixture/files/runtime.json')
            return Response.json(runtimePack);
          if (path === '/api/jobs/batches/plan') {
            const [item] = body.items;
            return body.items.length === 1 && item.providerId === 'chatgpt'
              ? Response.json({
                  items: [
                    { ...item, recipeId: 'styles', prompt: 'Planned prompt', model: 'gpt-image-2' },
                  ],
                })
              : Response.json(
                  { error: 'Not ready', code: 'provider_unavailable' },
                  { status: 400 },
                );
          }
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
    // Without the workspace list, a name never becomes a second workspace.
    workspacesDown = true;
    expect((await call('studio_generate', { ...named, workspaceName: 'Default' })).status).toBe(
      400,
    );
    workspacesDown = false;
    expect(requests.filter(({ path, body }) => path === '/api/workspaces' && body)).toHaveLength(1);

    // styles compile on the server as in the Studio UI; model applies to this call only.
    const styles = [{ packId: headshot.packId, presetId: headshot.id }];
    const styled = {
      ...input,
      requestId: 'batch-mcp-styled',
      task: 'image_generate',
      referenceIds: [],
      styles,
      styleMode: 'generate',
      model: 'gpt-image-2',
    };
    for (const intentionalStylesV1 of [true, false]) {
      settings.intentionalStylesV1 = intentionalStylesV1;
      expect((await call('studio_generate', styled)).status).toBe(200);
      expect(requests.at(-1)?.body).toMatchObject({
        items: [
          {
            execution: { providerOptions: { chatgpt: { imageModel: 'gpt-image-2' } } },
            sourceSpec: {
              recipeId: 'styles',
              recipeParams: intentionalStylesV1
                ? { compilerVersion: expect.stringMatching(/^intentional-styles\//) }
                : { mode: 'DIRECT_STYLE_SYNTHESIS', selectedStyles: [{ presetId: headshot.id }] },
            },
          },
          {},
        ],
      });
    }
    const batchesBefore = requests.filter(({ path }) => path === '/api/jobs/batches').length;
    for (const rejected of [
      { ...styled, styles: [{ ...styles[0], presetId: 'missing' }] },
      { ...styled, recipeId: 'remaster' },
      { ...styled, model: 'gpt-image-9' },
      { ...styled, providerId: 'grok' },
    ])
      expect((await call('studio_generate', rejected)).status).toBe(400);
    expect(requests.filter(({ path }) => path === '/api/jobs/batches')).toHaveLength(batchesBefore);

    // A plan runs at Read only and never queues a batch or creates a workspace.
    settings.mcpAccess = 'read';
    const {
      requestId: _requestId,
      workspaceId: _id,
      ...planInput
    } = {
      ...styled,
      workspaceName: 'Poster Run',
      tags: ['#Poster'],
    };
    const planStart = requests.length;
    expect(await (await call('studio_plan_generation', planInput)).json()).toEqual({
      ready: true,
      jobCount: 2,
      providerId: 'chatgpt',
      model: 'gpt-image-2',
      task: 'image_generate',
      recipeId: 'styles',
      workspace: {
        id: `ws-${createHash('sha256').update('poster run').digest('hex').slice(0, 12)}`,
        name: 'Poster Run',
        willCreate: true,
      },
      filing: { tags: ['poster'], collection: { name: 'Covers', exists: false } },
      providerPrompt: 'Planned prompt',
      promptChars: 14,
      styles: { compiler: 'legacy', mode: 'preserve', issues: [] },
    });
    const { model: _model, ...unplannable } = { ...planInput, providerId: 'dry_run' };
    expect(await (await call('studio_plan_generation', unplannable)).json()).toEqual({
      ready: false,
      blocker: { error: 'Not ready', code: 'provider_unavailable' },
    });
    const planned = requests.slice(planStart);
    expect(planned.filter(({ path }) => path === '/api/jobs/batches/plan')).toHaveLength(2);
    expect(planned.some(({ path }) => path === '/api/jobs/batches')).toBe(false);
    expect(planned.some(({ path, body }) => path === '/api/workspaces' && body)).toBe(false);

    const { recipes } = await (await call('studio_recipes')).json();
    expect(recipes.find(({ id }: { id: string }) => id === 'sprite-atlas')).toMatchObject({
      uiOnly: true,
    });
    expect(recipes.some((recipe: object) => 'parameters' in recipe)).toBe(false);
    expect(
      (await (await call('studio_recipes', { q: 'poses' })).json()).recipes.map(
        ({ id }: { id: string }) => id,
      ),
    ).toContain('character-poses');
    expect(await (await call('studio_recipes', { id: 'styles' })).json()).toHaveProperty(
      'parameters',
    );
    expect(await (await call('studio_find_styles', { q: 'portrait' })).json()).toEqual({
      styles: [
        {
          packId: headshot.packId,
          presetId: headshot.id,
          name: headshot.name,
          category: 'Portrait',
          hasIntentionalPolicy: true,
          summary: headshot.snapshot.dna.aesthetic.slice(0, 160),
        },
      ],
    });

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
    expect(await (await call('studio_workspaces', { workspaceId: 'default' })).json()).toEqual({
      workspace: { id: 'default', name: 'Default' },
      tags: [{ name: 'cover', color: null, imageCount: 2 }],
      collections: [{ id: 'collection-1', name: 'Picks', emoji: null, imageCount: 2 }],
      unorganized: 3,
    });
    expect((await call('studio_workspaces', { workspaceId: 'missing' })).status).toBe(400);

    settings.mcpAccess = 'write';
    expect((await call('studio_cancel', { jobId: 'job-1' })).status).toBe(200);
    expect(requests.at(-1)?.path).toBe('/api/jobs/job-1/cancel');
    settings.mcpAccess = 'off';
    expect((await call('studio_recipes')).status).toBe(403);
    expect((await call('studio_generate', input)).status).toBe(403);
  });

  it('routes onboarding, settings, jobs, packs and updates with an agent settings allowlist', async () => {
    const settings = createDefaultEditableStudioSettings();
    settings.mcpAccess = 'read';
    const requests: { method: string; path: string; body: unknown }[] = [];
    const job = (id: string, status: JobStatus, attempt = 1) =>
      ({ id, status, attempt, providerId: 'dry_run', execution: null }) as Job;
    const batch = (id: string, jobs: Job[]) => ({
      ...summarizeJobBatch(
        { id, workspaceId: 'default', requestedCount: jobs.length, createdAt: '' },
        jobs,
      ),
      jobs,
    });
    const event = (type: string, message: string, createdAt: string) => ({
      id: 0,
      jobId: 'job-1',
      type,
      message,
      metadata: { provider: 'raw' },
      createdAt,
    });
    const detail = {
      job: {
        ...job('job-1', 'completed', 2),
        kind: 'image_generate',
        providerId: 'chatgpt',
        workspaceId: 'default',
        batchId: 'batch-1',
        execution: { providerOptions: { chatgpt: { imageModel: 'gpt-image-2' } } },
        sourceSpec: createGenerationTaskSpec({
          id: 'job-1',
          task: 'image_generate',
          providerId: 'chatgpt',
          prompt: 'Private prompt',
          metadata: { libraryOrganization: { tags: ['cover'], collection: 'Covers' } },
        }),
        finalPromptUsed: 'Private prompt',
        error: null,
        createdAt: 'created',
        updatedAt: 'updated',
        completedAt: 'completed',
      },
      events: [
        event('asset.dimensions.info', 'Provider returned 1024x1536.', 'notice'),
        ...Array.from({ length: 20 }, (_, index) => event('job.progress', `Step ${index}`, '')),
      ],
      turn: { id: 'turn-1', transcriptPath: '/private/transcript.jsonl' },
      transcriptEntries: [{ text: 'private' }],
      catalogImages: [
        {
          id: 'image-1',
          filePath: '/a.png',
          thumbnailPath: '/a.webp',
          tags: ['cover'],
          prompt: 'Private prompt',
        },
      ],
      metrics: {},
      traceSummary: {},
    };
    const fixtures: Record<string, unknown> = {
      '/api/jobs/job-1': detail,
      '/api/jobs/batches/batch-1': batch('batch-1', [
        job('job-failed', 'failed', 2),
        job('job-done', 'completed'),
      ]),
      '/api/jobs/batches/batch-done': batch('batch-done', [job('job-done', 'completed')]),
    };
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
          return Response.json((!init?.method && fixtures[path]) || { path });
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
    await call('studio_job', { jobId: 'job-1' });
    expect(requests.at(-1)?.path).toBe('/api/jobs/job-1/status');
    // detail is an allowlist: prompts, transcripts and event metadata stay in Studio.
    expect(await (await call('studio_job', { jobId: 'job-1', detail: true })).json()).toEqual({
      id: 'job-1',
      status: 'completed',
      kind: 'image_generate',
      providerId: 'chatgpt',
      recipeId: null,
      workspaceId: 'default',
      batchId: 'batch-1',
      attempt: 2,
      createdAt: 'created',
      updatedAt: 'updated',
      completedAt: 'completed',
      error: null,
      notices: ['Provider returned 1024x1536.'],
      model: 'gpt-image-2',
      libraryOrganization: { tags: ['cover'], collection: 'Covers' },
      events: Array.from({ length: 20 }, (_, index) => ({
        type: 'job.progress',
        message: `Step ${index}`,
        createdAt: '',
      })),
      catalogImages: [
        { id: 'image-1', filePath: '/a.png', thumbnailPath: '/a.webp', tags: ['cover'] },
      ],
    });

    const retry = { batchId: 'batch-1', requestId: 'retry-batch-1' };
    const writes: [string, object][] = [
      ['studio_update_settings', { notifyOnUpdates: false }],
      ['studio_retry_batch', retry],
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
      { defaultProviderId: 'codex' },
      { outputDirectory: 'C:/' },
      { disabledWorkflowModules: ['styles'] },
      { toolsPanelSide: 'left' },
      { preferredWorkflow: 'not-a-workflow' },
      {},
    ])
      expect((await call('studio_update_settings', forbidden)).status).toBe(400);
    expect(requests).toHaveLength(before);

    const patch = {
      language: 'es',
      disabledWorkflowModules: ['camera'],
      outputOrganization: { subfolderTokens: ['date'] },
    };
    expect((await call('studio_update_settings', patch)).status).toBe(200);
    expect(requests.at(-1)).toEqual({ method: 'PATCH', path: '/api/settings', body: patch });

    // Only the failed job is retried, with its current attempt.
    expect(await (await call('studio_retry_batch', retry)).json()).toMatchObject({ retried: 1 });
    expect(requests.at(-1)).toEqual({
      method: 'POST',
      path: '/api/jobs/batches/batch-1/retry',
      body: { requestId: retry.requestId, items: [{ jobId: 'job-failed', attempt: 2 }] },
    });
    const beforeRetry = requests.length;
    const nothingFailed = await call('studio_retry_batch', { ...retry, batchId: 'batch-done' });
    expect(await nothingFailed.json()).toMatchObject({ retried: 0, batch: { id: 'batch-done' } });
    expect(requests.slice(beforeRetry).map(({ method }) => method)).toEqual(['GET']);
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
