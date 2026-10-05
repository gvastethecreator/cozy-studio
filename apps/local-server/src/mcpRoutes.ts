import { Hono } from 'hono';
import { DEFAULT_GENERATION_CONFIG } from '../../../constants';
import { RECIPE_DISCOVERY_CATALOG } from '../../../lib/recipeCatalog';
import { buildGenerationTaskSpecFromRecipe } from '../../../lib/recipeModules/taskSpec';
import {
  studioMcpTools,
  isStudioMcpMutation,
  type StudioMcpToolName,
} from '../../../packages/shared/src/studioMcp';
import type { EditableStudioSettings } from '../../../packages/shared/src/studioSettings';
import type { CatalogImage } from '../../../packages/shared/src/types';
import type { ImageGenerationConfig, Attachment } from '../../../types';

interface Dependencies {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  readSettings: () => EditableStudioSettings;
}

export function createMcpRoutes({ request, readSettings }: Dependencies) {
  const routes = new Hono();
  routes.post('/call', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.name !== 'string' || !Object.hasOwn(studioMcpTools, body.name)) {
      return c.json({ error: 'Unknown Studio MCP tool' }, 400);
    }
    const name = body.name as StudioMcpToolName;
    const settings = readSettings();
    if (
      settings.mcpAccess === 'off' ||
      (isStudioMcpMutation(name) && settings.mcpAccess !== 'write')
    ) {
      return c.json(
        {
          error: 'MCP access denied. Change Agent access (MCP) in Studio Settings > General.',
          access: settings.mcpAccess,
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
    const post = (path: string, payload: unknown = {}) =>
      request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    const query = (path: string) =>
      get(
        `${path}?${new URLSearchParams(Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)]))).toString()}`,
      );
    switch (name) {
      case 'studio_status': {
        const health = await get('/api/health');
        return c.json({ health: await health.json(), mcpAccess: settings.mcpAccess });
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
    }
  });
  return routes;
}
