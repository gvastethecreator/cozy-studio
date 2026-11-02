import { createHash } from 'node:crypto';
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
import {
  parseLibraryOrganization,
  validateCatalogCollectionName,
  type CatalogCollection,
  type LibraryOrganization,
} from '../../../packages/shared/src/catalogCollections';
import { applyCatalogTagChanges, type CatalogTag } from '../../../packages/shared/src/catalogTags';
import type { EditableStudioSettings } from '../../../packages/shared/src/studioSettings';
import type { CatalogImage } from '../../../packages/shared/src/types';
import type { StudioWorkspace } from '../../../packages/shared/src/workspaceContracts';
import type { ImageGenerationConfig, Attachment } from '../../../types';
import { ReferenceImportConflictError } from './referenceImport';

type GenerateInput = ReturnType<typeof studioMcpTools.studio_generate.schema.parse>;
type HttpCall = (path: string, payload?: unknown) => Promise<Response>;

// Their runs coordinate many frames in the Studio UI (D6).
const UI_ONLY_RECIPES = new Set(['sprite-atlas', 'animation-sequence']);
// lib/recipeModules/styles.ts trusts these recipeParams as an already compiled style plan.
const COMPILED_STYLE_FIELDS = [
  'compilerVersion',
  'styleRequestHash',
  'effectivePrompt',
  'selectedStyles',
  'selectedStyleDraft',
];

/** A name maps to one id, so a timeout retry keeps its batch hash even after a rename. */
function workspaceIdForName(name: string) {
  return `ws-${createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 12)}`;
}

/** Checks a studio_generate input and returns its batch items, or the 400 body. */
async function buildGenerationRequest(
  input: GenerateInput,
  { get, post }: { get: HttpCall; post: HttpCall },
): Promise<{ error: string; imageId?: string } | { items: Record<string, unknown>[] }> {
  if (!input.workspaceId === !input.workspaceName)
    return {
      error:
        'Set workspaceId (an existing workspace) or workspaceName (find or create by name), not both.',
    };
  const recipe = input.recipeId
    ? RECIPE_DISCOVERY_CATALOG.find((entry) => entry.id === input.recipeId)
    : null;
  if (input.recipeId && !recipe) return { error: 'Unknown recipe. Use studio_recipes.' };
  if (recipe && UI_ONLY_RECIPES.has(recipe.targetRecipeId))
    return {
      error:
        'This workflow needs its run in the Studio UI (Workflows). studio_generate makes single images.',
    };
  if (COMPILED_STYLE_FIELDS.some((key) => Object.hasOwn(input.recipeParams ?? {}, key)))
    return { error: 'Compiled style fields are not accepted in recipeParams.' };
  // Normalized before hashing, so #Cover and cover give the same batch.
  let libraryOrganization: LibraryOrganization | null;
  try {
    libraryOrganization = parseLibraryOrganization({
      tags: input.tags,
      collection: input.collection,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid library organization' };
  }
  const attachments: Attachment[] = [];
  for (const imageId of input.referenceIds) {
    const response = await get(`/api/catalog/${imageId}`);
    if (!response.ok) return { error: 'Catalog reference not found', imageId };
    const image = (await response.json()) as CatalogImage;
    if (image.isDeleted || image.sourceExists === false)
      return { error: 'Catalog reference is unavailable', imageId };
    attachments.push({
      id: image.id,
      name: image.id,
      dataUrl: '',
      localPath: image.filePath,
      strength: 1,
    });
  }
  let sourceSpec: ReturnType<typeof buildGenerationTaskSpecFromRecipe>;
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
    sourceSpec = buildGenerationTaskSpecFromRecipe({
      id: input.requestId,
      providerId: input.providerId,
      task: input.task,
      config,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid generation recipe' };
  }
  // The normal intake resolves execution defaults from Studio Settings.
  delete sourceSpec.metadata.execution;
  if (libraryOrganization) sourceSpec.metadata.libraryOrganization = libraryOrganization;

  // The workspace is resolved last, so a rejected request creates no workspace.
  let workspaceId = input.workspaceId;
  if (workspaceId) {
    if ((await get(`/api/workspaces/${workspaceId}`)).status === 404)
      return {
        error: 'Unknown workspaceId. Use studio_workspaces, or workspaceName to create one.',
      };
  } else {
    const name = input.workspaceName!;
    const listed: unknown = await get('/api/workspaces')
      .then((response) => response.json())
      .catch(() => null);
    workspaceId = (Array.isArray(listed) ? (listed as StudioWorkspace[]) : []).find(
      (workspace) =>
        String(workspace?.name ?? '')
          .trim()
          .toLowerCase() === name.toLowerCase(),
    )?.id;
    if (!workspaceId) {
      workspaceId = workspaceIdForName(name);
      // Idempotent by id: an existing workspace with this id is returned unchanged.
      if (!(await post('/api/workspaces', { id: workspaceId, name })).ok)
        return { error: 'Could not create the workspace.' };
    }
  }
  return {
    items: Array.from({ length: input.count }, () => ({
      workspaceId,
      providerId: input.providerId,
      kind: sourceSpec.task,
      sourceSpec,
    })),
  };
}

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
    const list = <T>(path: string) =>
      readJson(path).then((value: unknown) => (Array.isArray(value) ? (value as T[]) : []));
    const unorganizedCount = (workspaceId?: string) =>
      readJson(
        `/api/catalog?${workspaceId ? `workspace_id=${workspaceId}&` : ''}unorganized=true&limit=1`,
      ).then((page) => (page as { total?: number } | null)?.total ?? 0);
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
        const unorganized = await unorganizedCount();
        return c.json({
          health: await health.json(),
          mcpAccess: settings.mcpAccess,
          mcpAccessLabel: STUDIO_MCP_ACCESS_LABELS[settings.mcpAccess],
          library: { unorganized },
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
          ...(unorganized > 0 && {
            organizeNotice: `${unorganized} Library image${unorganized === 1 ? ' has' : 's have'} no tags or collection. Recommend organizing them: propose a scheme, apply only after the user confirms.`,
          }),
        });
      }
      case 'studio_providers':
        return get('/api/providers');
      case 'studio_recipes':
        return c.json({ recipes: RECIPE_DISCOVERY_CATALOG });
      case 'studio_workspaces': {
        const { workspaceId } = studioMcpTools.studio_workspaces.schema.parse(args);
        if (!workspaceId) return get('/api/workspaces');
        const [workspace, tags, collections, unorganized] = await Promise.all([
          get(`/api/workspaces/${workspaceId}`),
          list<CatalogTag>(`/api/catalog/tags?workspace_id=${workspaceId}`),
          list<CatalogCollection>(`/api/catalog/collections?workspace_id=${workspaceId}`),
          unorganizedCount(workspaceId),
        ]);
        if (workspace.status === 404) return c.json({ error: 'Unknown workspaceId.' }, 400);
        return c.json({
          workspace: await workspace.json(),
          tags: tags.map(({ name, color, imageCount }) => ({ name, color, imageCount })),
          collections: collections.map(({ id, name, emoji, imageCount }) => ({
            id,
            name,
            emoji,
            imageCount,
          })),
          unorganized,
        });
      }
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
      case 'studio_organize_images': {
        const input = studioMcpTools.studio_organize_images.schema.parse(args);
        const { workspaceId, addTags, removeTags } = input;
        const imageIds = [...new Set(input.imageIds)];
        // Check every image and change first, so a rejected call writes nothing.
        const images = await Promise.all(
          imageIds.map((imageId) =>
            get(`/api/catalog/${imageId}`).then((response) =>
              response.ok ? (response.json() as Promise<CatalogImage>) : null,
            ),
          ),
        );
        const outside = imageIds.filter((_, index) => {
          const image = images[index];
          return !image || image.isDeleted || (image.workspaceId ?? 'default') !== workspaceId;
        });
        if (outside.length)
          return c.json(
            {
              error: 'Every image must be live and in workspaceId. Nothing changed.',
              imageIds: outside,
            },
            400,
          );
        const tagChanges = addTags || removeTags ? { addTags, removeTags } : null;
        const knownTags = tagChanges
          ? (await list<CatalogTag>(`/api/catalog/tags?workspace_id=${workspaceId}`)).map(
              ({ name }) => name,
            )
          : [];
        // PATCH checks each image's own tags (at most 32), so check them all here first.
        const retagged: string[] = [];
        const rejected: string[] = [];
        let tagError = '';
        for (const image of tagChanges ? (images as CatalogImage[]) : []) {
          try {
            const tags = applyCatalogTagChanges(image.tags, tagChanges!, knownTags);
            if (tags.join('\n') !== image.tags.join('\n')) retagged.push(image.id);
          } catch (error) {
            rejected.push(image.id);
            tagError = error instanceof Error ? error.message : 'Invalid tags.';
          }
        }
        if (rejected.length)
          return c.json({ error: `${tagError} Nothing changed.`, imageIds: rejected }, 400);
        let addName: string | undefined;
        try {
          addName = input.addToCollection && validateCatalogCollectionName(input.addToCollection);
        } catch (error) {
          return c.json({ error: error instanceof Error ? error.message : 'Invalid name' }, 400);
        }
        const collections = await list<CatalogCollection>(
          `/api/catalog/collections?workspace_id=${workspaceId}`,
        );
        const byName = (name: string) =>
          collections.find((collection) => collection.name.toLowerCase() === name.toLowerCase());
        const target = addName ? byName(addName) : undefined;
        const removeFrom = input.removeFromCollection
          ? byName(input.removeFromCollection)
          : undefined;
        if (input.removeFromCollection && !removeFrom)
          return c.json(
            {
              error: 'removeFromCollection is not a collection in this workspace. Nothing changed.',
            },
            400,
          );

        // ponytail: up to 100 per-image PATCHes, not one transaction; every step is idempotent,
        // so a repeated call converges. Add POST /api/catalog/commands/organize if partial
        // failures show up.
        for (const imageId of retagged) {
          const response = await send('PATCH', `/api/catalog/${imageId}`, tagChanges);
          if (!response.ok) return response;
        }
        let collection = null;
        if (addName) {
          const response = target
            ? await send('PATCH', `/api/catalog/collections/${target.id}`, {
                addImageIds: imageIds,
              })
            : await post('/api/catalog/collections', { workspaceId, name: addName, imageIds });
          if (!response.ok) return response;
          const saved = (await response.json()) as CatalogCollection;
          collection = {
            id: saved.id,
            name: saved.name,
            created: !target,
            imageCount: saved.imageCount,
          };
        }
        if (removeFrom) {
          const response = await send('PATCH', `/api/catalog/collections/${removeFrom.id}`, {
            removeImageIds: imageIds,
          });
          if (!response.ok) return response;
        }
        return c.json({
          workspaceId,
          imageCount: imageIds.length,
          tags: {
            added: addTags ? applyCatalogTagChanges([], { addTags }, knownTags) : [],
            removed: removeTags ?? [],
          },
          collection,
          removedFrom: removeFrom ? { id: removeFrom.id, name: removeFrom.name } : null,
        });
      }
      case 'studio_cancel':
        return post(`/api/jobs/${String(args.jobId)}/cancel`);
      case 'studio_generate': {
        const input = studioMcpTools.studio_generate.schema.parse(args);
        const built = await buildGenerationRequest(input, { get, post });
        if ('error' in built) return c.json(built, 400);
        return post('/api/jobs/batches', { requestId: input.requestId, items: built.items });
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
