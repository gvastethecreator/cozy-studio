import {
  extensionFilePath,
  type AvailableExtensionsResponse,
  type DefaultStylePackState,
  type ExtensionHubState,
  type ExtensionHubUnlockResponse,
  type ExtensionInstallResponse,
  type InstalledExtensionsResponse,
  type StylePackPreviewResponse,
} from '../../packages/shared/src/extensions';
import { getStudioApiBase, request } from './http';

export async function listInstalledExtensions(
  options: { refresh?: boolean; signal?: AbortSignal } = {},
) {
  return request<InstalledExtensionsResponse>(
    `/api/extensions${options.refresh ? '?refresh=1' : ''}`,
    { signal: options.signal },
  );
}

/** Absolute URL of a file inside an installed extension, for images. */
export function extensionFileUrl(extensionId: string, relativePath: string) {
  return `${getStudioApiBase()}${extensionFilePath(extensionId, relativePath)}`;
}

export async function fetchExtensionJson<T>(extensionId: string, relativePath: string) {
  return request<T>(extensionFilePath(extensionId, relativePath));
}

/** Extensions published by each remote source, with their installed state. */
export async function listAvailableExtensions() {
  return request<AvailableExtensionsResponse>('/api/extensions/available');
}

export async function installExtension(sourceId: string, id: string, layers: 'cards'[] = []) {
  return request<ExtensionInstallResponse>('/api/extensions/install', {
    method: 'POST',
    body: JSON.stringify({ sourceId, id, layers }),
  });
}

/** The private hub unlocked in this Studio; the password never comes back from the backend. */
export async function getExtensionHub() {
  return request<ExtensionHubState>('/api/extensions/hub');
}

export async function unlockExtensionHub(url: string, password: string) {
  return request<ExtensionHubUnlockResponse>('/api/extensions/hub', {
    method: 'PUT',
    body: JSON.stringify({ url, password }),
  });
}

export async function forgetExtensionHub() {
  return request<void>('/api/extensions/hub', { method: 'DELETE' });
}

export async function removeExtension(id: string) {
  return request<void>(`/api/extensions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Asks the backend to install the default style pack once when Studio has none. */
export async function requestDefaultStylePack() {
  return request<DefaultStylePackState>('/api/extensions/default-pack', { method: 'POST' });
}

export async function getDefaultStylePackState() {
  return request<DefaultStylePackState>('/api/extensions/default-pack');
}

/** Preview of an installed pack, read from its own files. */
export async function getInstalledPackPreview(id: string) {
  return request<StylePackPreviewResponse>(`/api/extensions/${encodeURIComponent(id)}/preview`);
}

/** Preview of a pack a remote source publishes; the backend downloads and caches it. */
export async function getRemotePackPreview(sourceId: string, id: string) {
  const query = new URLSearchParams({ source: sourceId, id });
  return request<StylePackPreviewResponse>(`/api/extensions/remote-preview?${query}`);
}

export function previewImageUrl(imageBase: string, image: string) {
  return `${getStudioApiBase()}${imageBase}${image.split('/').map(encodeURIComponent).join('/')}`;
}

export async function getStyleImageMetadata(src: string) {
  const url = new URL(src, window.location.href);
  if (!url.pathname.startsWith('/api/extensions/')) return null;
  url.searchParams.set('metadata', 'true');
  const result = await request<{ metadata: Record<string, unknown> | null }>(
    `${url.pathname}${url.search}`,
  );
  return result.metadata;
}
