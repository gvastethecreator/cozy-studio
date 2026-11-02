import {
  CATALOG_PURGE_CONFIRMATION,
  type CatalogBatchCommandResult,
  type CatalogCollection,
  type CatalogCollectionPatch,
  type CatalogCollectionSelection,
  type CatalogOrganizeInput,
  type CatalogOrganizeResult,
  type CatalogTag,
  type CatalogTagPatch,
  type CatalogCommandFilter,
  type CatalogImage,
  type CatalogPage,
  type CatalogSortOption,
  type CatalogWorkspaceSummary,
  type StudioLibrary,
} from '../../packages/shared/src';
import { request } from './http';

export async function listLibraries() {
  return request<StudioLibrary[]>('/api/libraries');
}

export interface CatalogQueryParams {
  id?: string;
  workspaceId?: string;
  recipeId?: string | null;
  libraryId?: string;
  jobId?: string;
  batchId?: string;
  favorite?: boolean;
  collectionId?: string;
  /** Only images with no tags and no collection in their workspace. */
  unorganized?: boolean;
  deleted?: boolean;
  q?: string;
  sort?: CatalogSortOption;
  offset?: number;
  limit?: number;
}

export function buildCatalogQuery(params: CatalogQueryParams = {}) {
  const search = new URLSearchParams();
  if (params.id) search.set('id', params.id);
  if (params.workspaceId) search.set('workspace_id', params.workspaceId);
  if (params.collectionId) search.set('collection_id', params.collectionId);
  if (params.unorganized) search.set('unorganized', 'true');
  if (params.recipeId !== undefined) search.set('recipe_id', params.recipeId ?? 'default');
  if (params.libraryId) search.set('library_id', params.libraryId);
  if (params.jobId) search.set('job_id', params.jobId);
  if (params.batchId) search.set('batch_id', params.batchId);
  if (params.favorite !== undefined) search.set('favorite', String(params.favorite));
  if (params.deleted !== undefined) search.set('deleted', String(params.deleted));
  if (params.q) search.set('q', params.q);
  if (params.sort) search.set('sort', params.sort);
  if (params.offset !== undefined) search.set('offset', String(params.offset));
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  return search.size > 0 ? `?${search.toString()}` : '';
}

export async function queryCatalog(params: CatalogQueryParams = {}) {
  return request<CatalogPage>(`/api/catalog${buildCatalogQuery(params)}`);
}

export async function getCatalogImageDetail(imageId: string) {
  return request<CatalogImage>(`/api/catalog/${encodeURIComponent(imageId)}`);
}

export async function queryCatalogWorkspaceSummaries(
  params: Pick<CatalogQueryParams, 'deleted'> = {},
) {
  const search = new URLSearchParams();
  if (params.deleted !== undefined) search.set('deleted', String(params.deleted));
  return request<CatalogWorkspaceSummary[]>(
    `/api/catalog/workspaces${search.size > 0 ? `?${search.toString()}` : ''}`,
  );
}

/** Favorite or workspace. Tags change through organizeCatalogImages. */
export async function updateCatalogImage(
  imageId: string,
  patch: { isFavorite?: boolean; workspaceId?: string | null },
) {
  return request<CatalogImage>(`/api/catalog/${encodeURIComponent(imageId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** One transaction: a rejected call changes nothing and names the images at fault. */
export async function organizeCatalogImages(input: CatalogOrganizeInput) {
  return request<CatalogOrganizeResult>('/api/catalog/commands/organize', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteCatalogImage(imageId: string) {
  return request<CatalogImage>(`/api/catalog/${encodeURIComponent(imageId)}`, { method: 'DELETE' });
}

export async function restoreCatalogImage(imageId: string) {
  return request<CatalogImage>(`/api/catalog/${encodeURIComponent(imageId)}/restore`, {
    method: 'POST',
  });
}

export async function archiveCatalogByFilter(filter: CatalogCommandFilter) {
  return request<CatalogBatchCommandResult>('/api/catalog/commands/archive', {
    method: 'POST',
    body: JSON.stringify(filter),
  });
}

export async function restoreCatalogByFilter(filter: CatalogCommandFilter) {
  return request<CatalogBatchCommandResult>('/api/catalog/commands/restore', {
    method: 'POST',
    body: JSON.stringify(filter),
  });
}

export async function listCatalogCollections(workspaceId: string) {
  const search = new URLSearchParams({ workspace_id: workspaceId });
  return request<CatalogCollection[]>(`/api/catalog/collections?${search}`);
}

export async function createCatalogCollection(input: {
  workspaceId: string;
  name: string;
  emoji?: string | null;
  imageIds: string[];
}) {
  return request<CatalogCollection>('/api/catalog/collections', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export const CATALOG_ORGANIZATION_CHANGED = 'studio:catalog-organization-changed';

export function notifyCatalogOrganizationChanged() {
  window.dispatchEvent(new Event(CATALOG_ORGANIZATION_CHANGED));
}

/** A `CustomEvent<string>` with the workspace id of a new Catalog Entry. */
export const CATALOG_WORKSPACE_SEEN = 'studio:catalog-workspace-seen';

export function listCatalogTags(workspaceId: string) {
  return request<CatalogTag[]>(
    `/api/catalog/tags?${new URLSearchParams({ workspace_id: workspaceId })}`,
  );
}

export function createCatalogTag(input: {
  workspaceId: string;
  name: string;
  color: string | null;
}) {
  return request<CatalogTag>('/api/catalog/tags', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCatalogTag(workspaceId: string, name: string, patch: CatalogTagPatch) {
  return request<CatalogTag>(`/api/catalog/tags/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify({ workspaceId, ...patch }),
  });
}

export async function getCatalogCollectionSelection(workspaceId: string, imageIds: string[]) {
  return request<CatalogCollectionSelection[]>('/api/catalog/collections/selection', {
    method: 'POST',
    body: JSON.stringify({ workspaceId, imageIds }),
  });
}

export async function updateCatalogCollection(collectionId: string, patch: CatalogCollectionPatch) {
  return request<CatalogCollection>(
    `/api/catalog/collections/${encodeURIComponent(collectionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
}

export async function deleteCatalogCollection(collectionId: string) {
  return request<{ ok: true }>(`/api/catalog/collections/${encodeURIComponent(collectionId)}`, {
    method: 'DELETE',
  });
}

export async function purgeCatalogByFilter(filter: CatalogCommandFilter) {
  return request<CatalogBatchCommandResult>('/api/catalog/commands/purge', {
    method: 'POST',
    body: JSON.stringify({ ...filter, confirm: CATALOG_PURGE_CONFIRMATION }),
  });
}
