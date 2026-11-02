import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DEFAULT_GENERATION_CONFIG } from '../../../constants';
import { RECIPE_DISCOVERY_CATALOG } from '../../../lib/recipeCatalog';
import { buildGenerationTaskSpecFromRecipe } from '../../../lib/recipeModules/taskSpec';
import {
  studioMcpTools,
  STUDIO_MCP_ACCESS_LABELS,
  STUDIO_REFERENCE_IMPORT_MAX_BASE64_CHARS,
  canCallStudioMcpTool,
  type StudioMcpToolName,
  type StudioReferenceImportInput,
  type StudioReferenceFileImportInput,
  type StudioReferenceImportResult,
} from '../../../packages/shared/src/studioMcp';
import type { EditableStudioSettings } from '../../../packages/shared/src/studioSettings';
import type { CatalogImage } from '../../../packages/shared/src/types';
import type { ImageGenerationConfig, Attachment } from '../../../types';
import { ReferenceImportConflictError } from './referenceImport';

interface Dependencies {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  readSettings: () => EditableStudioSettings;
  importReference?: (input: StudioReferenceImportInput) => Promise<StudioReferenceImportResult>;
  importReferenceFile?: (
    input: StudioReferenceFileImportInput,
    allowedRoots: string[],
  ) => Promise<StudioReferenceImportResult>;
}

export function createMcpRoutes({
  request,
  readSettings,
  importReference,
  importReferenceFile,
}: Dependencies) {
  const routes = new Hono();
  routes.use('/call', bodyLimit({ maxSize: STUDIO_REFERENCE_IMPORT_MAX_BASE64_CHARS + 16 * 1024 }));
  routes.post('/call', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.name !== 'string' || !Object.hasOwn(studioMcpTools, body.name)) {
      return c.json(
        {
          // A bridge started after an update can list tools that the running server predates.
          error:
            'Unknown Studio MCP tool. If Studio was updated, restart Studio so it knows the new tools.',
        },
        400,
      );
    }
    const name = body.name as StudioMcpToolName;
    const settings = readSettings();
    if (!canCallStudioMcpTool(settings.mcpAccess, name)) {
      const required = studioMcpTools[name].access;
      return c.json(
        {
          error: `This tool needs ${STUDIO_MCP_ACCESS_LABELS[required]} access. Agent access is ${STUDIO_MCP_ACCESS_LABELS[settings.mcpAccess]}. Ask the user to change Agent access (MCP) in Studio Settings > Advanced & maintenance. Do not work around this with HTTP calls.`,
          access: settings.mcpAccess,
          required,
        },
        403,
      );
    }
    const parsed = studioMcpTools[name].schema.safeParse(body.arguments ?? {});
    if (!parsed.success)
      return c.json(
        {
          error: 'Invalid tool arguments',
          issues: parsed.error.issues.map(({ path, message }) => ({ path, message })),
        },
        400,
      );
    const args = parsed.data as Record<string, unknown>;
    const get = (path: string) => request(path);
    const send = (method: string, path: string, payload: unknown = {}) =>
      request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    const post = (path: string, payload?: unknown) => send('POST', path, payload);
    const readJson = (path: string) =>
      get(path)
        .then((response) => response.json())
        .catch(() => null);
    const query = (path: string) =>
      get(
        `${path}?${new URLSearchParams(Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)]))).toString()}`,
      );
    switch (name) {
      case 'studio_status': {
        const health = await get('/api/health');
        // Startup fetches origin/main once, so agents learn about updates on their first call.
        const update = (await readJson('/api/updates')) as {
          behind?: number;
          latestCommit?: string | null;
          canUpdate?: boolean;
          blocker?: string | null;
          checkedAt?: string | null;
        } | null;
        const behind = update?.behind ?? 0;
        return c.json({
          health: await health.json(),
          mcpAccess: settings.mcpAccess,
          update: update && {
            behind,
            latestCommit: update.latestCommit ?? null,
            canUpdate: update.canUpdate ?? false,
            blocker: update.blocker ?? null,
            checkedAt: update.checkedAt ?? null,
          },
          ...(behind > 0 && {
            notice: `Studio is ${behind} commit${behind === 1 ? '' : 's'} behind origin/main. Tell the user an update is available and ask before applying it with studio_apply_update, or point them to Settings → Help & updates.`,
          }),
        });
      }
      case 'studio_providers':
        return get('/api/providers');
      case 'studio_recipes':
        return c.json({ recipes: RECIPE_DISCOVERY_CATALOG });
      case 'studio_workspaces':
        return get('/api/workspaces');
      case 'studio_extensions':
        return get('/api/extensions');
      case 'studio_extension_json':
        return get(`/api/extensions/${String(args.extensionId)}/files/${String(args.path)}`);
      case 'studio_user_styles':
        return get('/api/styles/user');
      case 'studio_jobs':
        return query('/api/jobs');
      case 'studio_job':
        return get(`/api/jobs/${String(args.jobId)}/status`);
      case 'studio_batch':
        return get(`/api/jobs/batches/${String(args.batchId)}`);
      case 'studio_catalog':
        return query('/api/catalog');
      case 'studio_cancel':
        return post(`/api/jobs/${String(args.jobId)}/cancel`);
      case 'studio_generate': {
        const input = studioMcpTools.studio_generate.schema.parse(args);
        const recipe = input.recipeId
          ? RECIPE_DISCOVERY_CATALOG.find((entry) => entry.id === input.recipeId)
          : null;
        if (input.recipeId && !recipe)
          return c.json({ error: 'Unknown recipe. Use studio_recipes.' }, 400);
        const attachments: Attachment[] = [];
        for (const imageId of input.referenceIds) {
          const response = await get(`/api/catalog/${imageId}`);
          if (!response.ok) return c.json({ error: 'Catalog reference not found', imageId }, 400);
          const image = (await response.json()) as CatalogImage;
          if (image.isDeleted || image.sourceExists === false)
            return c.json({ error: 'Catalog reference is unavailable', imageId }, 400);
          attachments.push({
            id: image.id,
            name: image.id,
            dataUrl: '',
            localPath: image.filePath,
            strength: 1,
          });
        }
        try {
          const config: ImageGenerationConfig = {
            ...DEFAULT_GENERATION_CONFIG,
            prompt: input.prompt,
            negativePrompt: input.negativePrompt,
            recipeId: recipe?.targetRecipeId ?? null,
            recipeParams: recipe
              ? { ...recipe.defaultParams, ...input.recipeParams }
              : input.recipeParams,
            attachments,
            aspectRatio: input.aspectRatio,
            imageSize: input.imageSize,
            batchCount: 1,
          };
          const sourceSpec = buildGenerationTaskSpecFromRecipe({
            id: input.requestId,
            providerId: input.providerId,
            task: input.task,
            config,
          });
          // The normal intake resolves execution defaults from Studio Settings.
          delete sourceSpec.metadata.execution;
          const items = Array.from({ length: input.count }, () => ({
            workspaceId: input.workspaceId,
            providerId: input.providerId,
            kind: sourceSpec.task,
            sourceSpec,
          }));
          return post('/api/jobs/batches', { requestId: input.requestId, items });
        } catch (error) {
          return c.json(
            { error: error instanceof Error ? error.message : 'Invalid generation recipe' },
            400,
          );
        }
      }
      case 'studio_import_reference': {
        if (!importReference) return c.json({ error: 'Reference import is unavailable.' }, 400);
        try {
          const input = studioMcpTools.studio_import_reference.schema.parse(args);
          return c.json(await importReference(input));
        } catch (error) {
          const status = error instanceof ReferenceImportConflictError ? 409 : 400;
          return c.json(
            { error: error instanceof Error ? error.message : 'Invalid reference import' },
            status,
          );
        }
      }
      case 'studio_import_reference_file': {
        if (!importReferenceFile)
          return c.json({ error: 'Reference file import is unavailable.' }, 400);
        try {
          const input = studioMcpTools.studio_import_reference_file.schema.parse(args);
          return c.json(await importReferenceFile(input, settings.mcpAllowedImportRoots));
        } catch (error) {
          const status = error instanceof ReferenceImportConflictError ? 409 : 400;
          return c.json(
            { error: error instanceof Error ? error.message : 'Invalid reference file import' },
            status,
          );
        }
      }
      case 'studio_onboarding': {
        const [probe, readiness, chatgptAuth] = await Promise.all(
          ['/api/onboarding/probe', '/api/readiness', '/api/auth/chatgpt'].map(readJson),
        );
        return c.json({
          probe,
          readiness,
          chatgptAuth,
          signIn: 'ChatGPT Sign in is a user action in Studio Settings.',
        });
      }
      case 'studio_settings':
        return get('/api/settings');
      case 'studio_update_settings':
        return send('PATCH', '/api/settings', args);
      case 'studio_available_extensions':
        return get('/api/extensions/available');
      case 'studio_install_extension': {
        // Without explicit layers, an update keeps the layers already installed.
        const installed = args.layers
          ? null
          : ((await readJson('/api/extensions')) as {
              installedLayers?: Record<string, string[]>;
            } | null);
        return post('/api/extensions/install', {
          sourceId: args.sourceId,
          id: args.extensionId,
          layers: args.layers ?? installed?.installedLayers?.[String(args.extensionId)] ?? [],
        });
      }
      case 'studio_remove_extension': {
        const response = await request(`/api/extensions/${String(args.extensionId)}`, {
          method: 'DELETE',
        });
        return response.ok ? c.json({ removed: args.extensionId }) : response;
      }
      case 'studio_updates':
        return args.check ? post('/api/updates/check') : get('/api/updates');
      case 'studio_apply_update':
        return post('/api/updates/apply', { commit: args.commit });
    }
  });
  return routes;
}
