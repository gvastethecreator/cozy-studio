import {
  parseExtensionReleaseIndex,
  type ExtensionReleaseIndex,
} from '../../../packages/shared/src/extensions';

/** A GitHub repository that publishes Cozy Extensions as release assets (ADR 0011). */
export interface RemoteExtensionSource {
  id: string;
  repo: string;
}

const DEFAULT_REMOTE_SOURCES = ['gvastethecreator/cozy-styles'];
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Remote sources from `STUDIO_EXTENSION_REMOTE_SOURCES` (comma-separated `owner/repo`), else the
 * public cozy-styles repository. Invalid entries are skipped.
 */
export function resolveRemoteExtensionSources(
  env: Record<string, string | undefined> = process.env,
): RemoteExtensionSource[] {
  const configured = env.STUDIO_EXTENSION_REMOTE_SOURCES?.split(',')
    .map((repo) => repo.trim())
    .filter((repo) => REPO_PATTERN.test(repo));
  const repos = configured?.length ? configured : DEFAULT_REMOTE_SOURCES;
  return repos.map((repo) => ({ id: repo, repo }));
}

/** A private Cozy hub: its URL and password, which the user enters in Settings > Extensions. */
export interface ExtensionHub {
  url: string;
  password: string;
}

/** The hub serves the GitHub-shaped `cozy/private` repository under `/gh`. */
export const HUB_SOURCE: RemoteExtensionSource = { id: 'cozy-hub', repo: 'cozy/private' };

/** The hub origin, or null. Plain http is allowed only for a hub on this machine. */
export function normalizeHubUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function createHubSourceClient(hub: ExtensionHub, fetchImpl: typeof fetch = fetch) {
  return createGitHubExtensionSourceClient({
    fetchImpl,
    apiBase: `${hub.url}/gh`,
    token: hub.password,
  });
}

export class ExtensionSourceError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ExtensionSourceError';
    this.status = status;
  }
}

export interface ExtensionSourceClient {
  /** True when a GitHub token is configured; the value is never exposed. */
  readonly tokenConfigured: boolean;
  fetchIndex(source: RemoteExtensionSource): Promise<ExtensionReleaseIndex>;
  downloadAsset(source: RemoteExtensionSource, tag: string, assetName: string): Promise<Uint8Array>;
}

/**
 * Reads `index.json` and release assets through the GitHub API, so public and private
 * repositories use the same path. The token comes from `COZY_STYLES_GITHUB_TOKEN`.
 */
export function createGitHubExtensionSourceClient({
  fetchImpl = fetch,
  apiBase = process.env.STUDIO_GITHUB_API_BASE ?? 'https://api.github.com',
  token = process.env.COZY_STYLES_GITHUB_TOKEN?.trim() || undefined,
}: {
  fetchImpl?: typeof fetch;
  apiBase?: string;
  token?: string;
} = {}): ExtensionSourceClient {
  const headers = (accept: string) => ({
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'X-Cozy-Client': 'cozy-studio',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  async function get(url: string, accept: string) {
    const response = await fetchImpl(url, { headers: headers(accept) });
    if (!response.ok) {
      const reason =
        response.status === 404
          ? 'not found (for a private repository, check COZY_STYLES_GITHUB_TOKEN)'
          : `HTTP ${response.status}`;
      throw new ExtensionSourceError(`${url.replace(apiBase, '')}: ${reason}`, response.status);
    }
    return response;
  }

  return {
    tokenConfigured: Boolean(token),
    async fetchIndex(source) {
      const response = await get(
        `${apiBase}/repos/${source.repo}/contents/index.json`,
        'application/vnd.github.raw+json',
      );
      const parsed = parseExtensionReleaseIndex(await response.json());
      if (!parsed.ok)
        throw new ExtensionSourceError(`${source.repo} index.json: ${parsed.issues.join('; ')}`);
      return parsed.index;
    },
    async downloadAsset(source, tag, assetName) {
      const release = (await (
        await get(
          `${apiBase}/repos/${source.repo}/releases/tags/${encodeURIComponent(tag)}`,
          'application/vnd.github+json',
        )
      ).json()) as { assets?: { name: string; url: string }[] };
      const asset = release.assets?.find((item) => item.name === assetName);
      if (!asset) throw new ExtensionSourceError(`${source.repo} ${tag}: no asset ${assetName}`);
      const response = await get(asset.url, 'application/octet-stream');
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
