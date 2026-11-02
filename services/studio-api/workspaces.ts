import type { StudioWorkspace, StudioWorkspaceSortOrder } from '../../packages/shared/src';
import type { LibraryArchiveImportResult } from '../../packages/shared/src/libraryArchive';
import {
  getStudioApiBase,
  readAttachmentFilename,
  readLocalStudioErrorMessage,
  request,
} from './http';

export async function listWorkspaces() {
  return request<StudioWorkspace[]>('/api/workspaces');
}

export async function exportLibraryArchive(workspaceId: string) {
  const response = await fetch(
    `${getStudioApiBase()}/api/workspaces/${encodeURIComponent(workspaceId)}/export`,
  );
  if (!response.ok)
    throw new Error(readLocalStudioErrorMessage(await response.text(), response.status));
  return {
    blob: await response.blob(),
    filename: readAttachmentFilename(response, 'library.zip'),
    images: Number(response.headers.get('X-Archive-Images') ?? 0),
    missing: Number(response.headers.get('X-Archive-Missing') ?? 0),
  };
}

export function importLibraryArchive(file: File, name?: string) {
  const query = name === undefined ? '' : `?name=${encodeURIComponent(name)}`;
  return request<LibraryArchiveImportResult>(`/api/workspaces/import${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: file,
  });
}

export async function createWorkspace(input: {
  id?: string;
  name: string;
  filter?: Record<string, unknown>;
  sortOrder?: StudioWorkspaceSortOrder;
}) {
  return request<StudioWorkspace>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateWorkspace(
  id: string,
  patch: {
    name?: string;
    filter?: Record<string, unknown>;
    sortOrder?: StudioWorkspaceSortOrder;
  },
) {
  return request<StudioWorkspace>(`/api/workspaces/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteWorkspace(id: string) {
  return request<{ ok: boolean }>(`/api/workspaces/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
