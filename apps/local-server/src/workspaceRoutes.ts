import { Hono, type Context } from 'hono';
import { Exit, Schema } from 'effect';

import {
  CreateStudioWorkspaceRequestSchema,
  UpdateStudioWorkspaceRequestSchema,
} from '../../../packages/shared/src/studioApiSchemas';
import type { CatalogBatchCommandResult } from '../../../packages/shared/src/types';

import {
  createWorkspaceInDb,
  deleteWorkspaceFromDb,
  getWorkspaceFromDb,
  listWorkspacesFromDb,
  updateWorkspaceInDb,
  type DeleteWorkspaceResult,
} from './db/workspaces';
import { getDb } from './db/connection';

function listCatalogWorkspaces() {
  return listWorkspacesFromDb(getDb());
}

function getCatalogWorkspace(id: string) {
  return getWorkspaceFromDb(getDb(), id);
}

function createCatalogWorkspace(input: {
  id?: string;
  name: string;
  filter?: Record<string, unknown>;
  sortOrder?: 'newest' | 'oldest' | 'favorite';
}) {
  return createWorkspaceInDb(getDb(), input);
}

function updateCatalogWorkspace(
  id: string,
  patch: {
    name?: string;
    filter?: Record<string, unknown>;
    sortOrder?: 'newest' | 'oldest' | 'favorite';
  },
) {
  return updateWorkspaceInDb(getDb(), id, patch);
}

export interface WorkspaceRoutesDependencies {
  listCatalogWorkspaces: typeof listCatalogWorkspaces;
  getCatalogWorkspace: typeof getCatalogWorkspace;
  createCatalogWorkspace: typeof createCatalogWorkspace;
  updateCatalogWorkspace: typeof updateCatalogWorkspace;
  deleteCatalogWorkspace: (id: string) => DeleteWorkspaceResult | boolean;
  /** Moves the workspace's live images to Archived Images through the soft-delete path. */
  trashWorkspaceImages: (workspaceId: string) => CatalogBatchCommandResult;
}

function normalizeWorkspaceBoundaryAliases(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  return {
    ...record,
    filter: record.filter ?? record.filterJson ?? record.filter_json,
    sortOrder: record.sortOrder ?? record.sort_order,
  };
}

function invalidWorkspaceBody(c: Context) {
  return c.json(
    {
      error: 'Invalid request body',
      code: 'invalid_request_body',
      reason: 'Request payload does not match the shared Workspace boundary schema.',
    },
    400,
  );
}

export function createWorkspaceRoutes(
  dependencies: Partial<WorkspaceRoutesDependencies> &
    Pick<WorkspaceRoutesDependencies, 'trashWorkspaceImages'>,
) {
  const {
    listCatalogWorkspaces: listWorkspaces = listCatalogWorkspaces,
    getCatalogWorkspace: readWorkspace = getCatalogWorkspace,
    createCatalogWorkspace: createWorkspace = createCatalogWorkspace,
    updateCatalogWorkspace: updateWorkspace = updateCatalogWorkspace,
    trashWorkspaceImages,
    deleteCatalogWorkspace: deleteWorkspace = (id: string) =>
      deleteWorkspaceFromDb(getDb(), id, trashWorkspaceImages),
  } = dependencies;
  const routes = new Hono();
  routes.get('/', (c) => c.json(listWorkspaces()));
  routes.post('/', async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    const decoded = Schema.decodeUnknownExit(CreateStudioWorkspaceRequestSchema)(
      normalizeWorkspaceBoundaryAliases(rawBody),
    );
    if (Exit.isFailure(decoded)) return invalidWorkspaceBody(c);
    const body = decoded.value;
    const requestedId = typeof body.id === 'string' ? body.id.trim() : '';
    const existingWorkspace = requestedId ? readWorkspace(requestedId) : null;
    if (existingWorkspace) {
      return c.json(existingWorkspace, 200);
    }
    return c.json(
      createWorkspace({
        id: requestedId || undefined,
        name: body.name?.trim() || 'Untitled Workspace',
        filter: body.filter ?? {},
        sortOrder: body.sortOrder ?? 'newest',
      }),
      201,
    );
  });
  routes.get('/:id', (c) => {
    const workspace = readWorkspace(c.req.param('id'));
    return workspace ? c.json(workspace) : c.json({ error: 'Workspace not found' }, 404);
  });
  routes.patch('/:id', async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    const decoded = Schema.decodeUnknownExit(UpdateStudioWorkspaceRequestSchema)(
      normalizeWorkspaceBoundaryAliases(rawBody),
    );
    if (Exit.isFailure(decoded)) return invalidWorkspaceBody(c);
    const body = decoded.value;
    const workspace = updateWorkspace(c.req.param('id'), {
      name: body.name,
      filter: body.filter,
      sortOrder: body.sortOrder,
    });
    return workspace ? c.json(workspace) : c.json({ error: 'Workspace not found' }, 404);
  });
  routes.delete('/:id', (c) => {
    const result = deleteWorkspace(c.req.param('id'));
    if (result === true) return c.json({ ok: true });
    if (result && typeof result === 'object' && 'ok' in result) {
      if (result.ok) return c.json({ ok: true });
      const { error, failed } = result;
      return c.json({ error, ...(failed && { failed }) }, result.status);
    }
    return c.json({ error: 'Workspace not found' }, 404);
  });
  return routes;
}
