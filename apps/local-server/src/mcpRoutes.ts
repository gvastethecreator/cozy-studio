import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DEFAULT_GENERATION_CONFIG } from '../../../constants';
import { RECIPE_DISCOVERY_CATALOG, searchRecipeCatalog } from '../../../lib/recipeCatalog';
import { buildGenerationTaskSpecFromRecipe } from '../../../lib/recipeModules/taskSpec';
import {
  CODEX_HTTP_IMAGE_MODELS,
  isCodexHttpImageModel,
  resolveGenerationExecutionOverride,
} from '../../../packages/shared/src/codexExecutionContract';
import {
  studioMcpTools,
  STUDIO_MCP_ACCESS_LABELS,
  STUDIO_REFERENCE_IMPORT_MAX_BASE64_CHARS,
  canCallStudioMcpTool,
  type StudioGenerationInput,
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
import type { JobBatchDetail } from '../../../packages/shared/src/jobBatches';
import type {
  CatalogImage,
  JobDetailResponse,
  JobExecutionOptions,
} from '../../../packages/shared/src/types';
import type { StudioWorkspace } from '../../../packages/shared/src/workspaceContracts';
import type { ImageGenerationConfig, Attachment } from '../../../types';
import { compileMcpStyles, findStyles, loadInstalledStylePacks } from './mcpStyles';
import { jobImageMetadata } from './providers/jobImageMetadata';
import { ReferenceImportConflictError } from './referenceImport';

type HttpCall = (path: string, payload?: unknown) => Promise<Response>;

// The job events that GET /api/jobs/:id/status reports as notices.
const NOTICE_EVENT_TYPES = new Set(['asset.dimensions.info', 'asset.transparency.warning']);

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

/**
 * Checks a studio_generate input and returns its batch items, or the 400 body. Without `create`
 * (a plan), a workspace that does not exist yet is reported, not created.
 */
async function buildGenerationRequest(
  input: StudioGenerationInput,
  requestId: string,
  {
    get,
    post,
    settings,
    create,
  }: { get: HttpCall; post: HttpCall; settings: EditableStudioSettings; create: boolean },
): Promise<
  | { error: string; imageId?: string; issues?: unknown[] }
  | {
      items: Record<string, unknown>[];
      workspace: { id: string; name: string; willCreate: boolean };
      libraryOrganization: LibraryOrganization | null;
      styles?: object;
    }
> {
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
    return { error: 'Pass styles instead of compiled style fields.' };
  if (input.styles && recipe && recipe.targetRecipeId !== 'styles')
    return { error: 'styles uses the styles recipe. Leave recipeId out.' };
  // Same scope as the Studio toolbar; MCP never falls back silently to another image model.
  let execution: Partial<JobExecutionOptions> | undefined;
  if (input.model && input.providerId === 'chatgpt') {
    if (!isCodexHttpImageModel(input.model))
      return {
        error: `Unknown ChatGPT image model. Use one of: ${CODEX_HTTP_IMAGE_MODELS.map((option) => option.id).join(', ')}.`,
      };
    execution = resolveGenerationExecutionOverride('chatgpt', { codexImageModel: input.model });
  } else if (input.model && input.providerId === 'codex') {
    execution = resolveGenerationExecutionOverride('codex', { executionModel: input.model });
  } else if (input.model) {
    return { error: 'This provider uses its Settings default model.' };
  }
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
  let recipeId = recipe?.targetRecipeId ?? null;
  let recipeParams = recipe
    ? { ...recipe.defaultParams, ...input.recipeParams }
    : input.recipeParams;
  let negativePrompt = input.negativePrompt;
  let styles: object | undefined;
  if (input.styles) {
    const styled = await compileMcpStyles(get, {
      styles: input.styles,
      prompt: input.prompt,
      negativePrompt,
      references: attachments,
      styleMode: input.styleMode,
      settings,
    });
    if ('error' in styled) return styled;
    recipeId = 'styles';
    recipeParams = { ...input.recipeParams, ...styled.recipeParams };
    negativePrompt = styled.negativePrompt ?? negativePrompt;
    styles = styled.styles;
  }
  let sourceSpec: ReturnType<typeof buildGenerationTaskSpecFromRecipe>;
  try {
    const config: ImageGenerationConfig = {
      ...DEFAULT_GENERATION_CONFIG,
      prompt: input.prompt,
      negativePrompt,
      recipeId,
      recipeParams,
      attachments,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      batchCount: 1,
    };
    sourceSpec = buildGenerationTaskSpecFromRecipe({
      id: requestId,
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
  let workspace: Pick<StudioWorkspace, 'id' | 'name'> | undefined;
  let willCreate = false;
  if (input.workspaceId) {
    const response = await get(`/api/workspaces/${input.workspaceId}`);
    if (response.status === 404)
      return {
        error: 'Unknown workspaceId. Use studio_workspaces, or workspaceName to create one.',
      };
    workspace = (await response.json().catch(() => undefined)) as typeof workspace;
  } else {
    const name = input.workspaceName!;
    const listed: unknown = await get('/api/workspaces')
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    // Without the list, a create could duplicate a workspace that already has this name.
    if (!Array.isArray(listed))
      return { error: 'Could not read the workspaces. Call studio_status, then retry.' };
    workspace = (listed as StudioWorkspace[]).find(
      (entry) =>
        String(entry?.name ?? '')
          .trim()
          .toLowerCase() === name.toLowerCase(),
    );
    if (!workspace) {
      workspace = { id: workspaceIdForName(name), name };
      willCreate = !create;
      // Idempotent by id: an existing workspace with this id is returned unchanged.
      if (create && !(await post('/api/workspaces', { id: workspace.id, name })).ok)
        return { error: 'Could not create the workspace.' };
    }
  }
  const workspaceId = input.workspaceId ?? workspace!.id;
  return {
    items: Array.from({ length: input.count }, () => ({
      workspaceId,
      providerId: input.providerId,
      kind: sourceSpec.task,
      sourceSpec,
      ...(execution && { execution }),
    })),
    workspace: { id: workspaceId, name: workspace?.name ?? workspaceId, willCreate },
    libraryOrganization,
    ...(styles && { styles }),
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
      case 'studio_recipes': {
        const { id: recipeId, q } = studioMcpTools.studio_recipes.schema.parse(args);
        const uiOnly = (targetRecipeId: string) =>
          UI_ONLY_RECIPES.has(targetRecipeId) ? { uiOnly: true } : {};
        if (recipeId) {
          const entry = RECIPE_DISCOVERY_CATALOG.find((recipe) => recipe.id === recipeId);
          return entry
            ? c.json({ ...entry, ...uiOnly(entry.targetRecipeId) })
            : c.json({ error: 'Unknown recipe. Call studio_recipes without id.' }, 400);
        }
        return c.json({
          recipes: searchRecipeCatalog({ query: q }, RECIPE_DISCOVERY_CATALOG).map((recipe) => ({
            id: recipe.id,
            title: recipe.title,
            description: recipe.description,
            targetRecipeId: recipe.targetRecipeId,
            supportedTasks: recipe.supportedTasks,
            supportedProviders: recipe.supportedProviders,
            requiredParameterIds: recipe.requiredParameterIds,
            ...uiOnly(recipe.targetRecipeId),
          })),
        });
      }
      case 'studio_find_styles': {
        const { q, packId, limit } = studioMcpTools.studio_find_styles.schema.parse(args);
        const packs = await loadInstalledStylePacks(get, packId ? new Set([packId]) : undefined);
        return c.json({ styles: findStyles(packs, { q, limit }) });
      }
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
      case 'studio_job': {
        if (!args.detail) return get(`/api/jobs/${String(args.jobId)}/status`);
        const response = await get(`/api/jobs/${String(args.jobId)}`);
        if (!response.ok) return response;
        // An allowlist, never a spread: transcripts and provider payloads stay in Studio.
        const { job, events, catalogImages } = (await response.json()) as JobDetailResponse;
        return c.json({
          id: job.id,
          status: job.status,
          kind: job.kind,
          providerId: job.providerId,
          recipeId: job.recipeId ?? null,
          workspaceId: job.workspaceId,
          batchId: job.batchId ?? null,
          attempt: job.attempt ?? 1,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          completedAt: job.completedAt,
          error: job.error,
          notices: events
            .filter(({ type }) => NOTICE_EVENT_TYPES.has(type))
            .map(({ message }) => message),
          model: jobImageMetadata(job).model,
          libraryOrganization: job.sourceSpec?.metadata.libraryOrganization ?? null,
          events: events
            .slice(-20)
            .map(({ type, message, createdAt }) => ({ type, message, createdAt })),
          catalogImages: catalogImages.map(({ id, filePath, thumbnailPath, tags }) => ({
            id,
            filePath,
            thumbnailPath,
            tags,
          })),
        });
      }
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
      case 'studio_plan_generation': {
        const input = studioMcpTools.studio_plan_generation.schema.parse(args);
        const built = await buildGenerationRequest(input, 'batch-plan', {
          get,
          post,
          settings,
          create: false,
        });
        if ('error' in built) return c.json(built, 400);
        // One item is enough: every item of a studio_generate call is identical.
        const response = await post('/api/jobs/batches/plan', { items: built.items.slice(0, 1) });
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          code?: string;
          items?: {
            providerId: string;
            kind: string;
            recipeId: string;
            prompt: string;
            model: string;
          }[];
        } | null;
        const plan = body?.items?.[0];
        if (!response.ok || !plan)
          return c.json({
            ready: false,
            blocker: {
              error: body?.error ?? `Studio answered HTTP ${response.status}.`,
              code: body?.code ?? null,
            },
          });
        const { workspace, libraryOrganization } = built;
        const collection = libraryOrganization?.collection ?? null;
        const collections = collection
          ? await list<CatalogCollection>(`/api/catalog/collections?workspace_id=${workspace.id}`)
          : [];
        return c.json({
          ready: true,
          jobCount: input.count,
          providerId: plan.providerId,
          model: plan.model,
          task: plan.kind,
          recipeId: plan.recipeId,
          workspace,
          filing: {
            tags: libraryOrganization?.tags ?? [],
            collection: collection && {
              name: collection,
              exists: collections.some(
                ({ name }) => name.toLowerCase() === collection.toLowerCase(),
              ),
            },
          },
          providerPrompt: plan.prompt.slice(0, 4000),
          promptChars: plan.prompt.length,
          ...(built.styles && { styles: built.styles }),
        });
      }
      case 'studio_generate': {
        const input = studioMcpTools.studio_generate.schema.parse(args);
        const built = await buildGenerationRequest(input, input.requestId, {
          get,
          post,
          settings,
          create: true,
        });
        if ('error' in built) return c.json(built, 400);
        return post('/api/jobs/batches', { requestId: input.requestId, items: built.items });
      }
      case 'studio_retry_batch': {
        const response = await get(`/api/jobs/batches/${String(args.batchId)}`);
        if (!response.ok) return response;
        const batch = (await response.json()) as JobBatchDetail;
        // retryable lists the failed jobs Studio can requeue, the same list the UI retries.
        if (!batch.retryable.length) return c.json({ retried: 0, batch });
        const retried = await post(`/api/jobs/batches/${batch.id}/retry`, {
          requestId: args.requestId,
          items: batch.retryable,
        });
        return retried.ok
          ? c.json({ retried: batch.retryable.length, batch: await retried.json() })
          : retried;
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
