import type {
  CatalogBatchCommandResult,
  CatalogCollection,
  CatalogCollectionPatch,
  CatalogCollectionSelection,
  CatalogTagChanges,
  CatalogTag,
  CatalogTagPatch,
  CatalogCommandFilter,
  CatalogImage,
  CatalogPage,
  CatalogSortOption,
  CatalogWorkspaceSummary,
  StudioLibrary,
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

export async function updateCatalogImage(
  imageId: string,
  patch: { isFavorite?: boolean; tags?: string[]; workspaceId?: string | null } & CatalogTagChanges,
) {
  return request<CatalogImage>(`/api/catalog/${encodeURIComponent(imageId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
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

export async function purgeCatalogImage(imageId: string) {
  return request<CatalogImage>(`/api/catalog/${encodeURIComponent(imageId)}/permanent`, {
    method: 'DELETE',
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
    body: JSON.stringify(filter),
  });
}
