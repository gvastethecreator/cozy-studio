import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import type { RepositoryUpdateStatus } from '../../../packages/shared/src/repositoryUpdates';

export const studioAppRoot = resolve(import.meta.dirname, '../../..');
const busyMessage = 'Wait for active jobs and operations to finish before updating.';
const launcherMessage = 'Start Studio with the launcher in the main Cozy Studio folder to update.';
const dataMessage =
  'Move Studio data, output folders and user extension folders outside the app folder before updating.';
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1536 * 1024 * 1024;
const MAX_ENTRIES = 30_000;
type FetchRelease = (url: string, init?: RequestInit) => Promise<Response>;
interface PortableManifest {
  version: string;
  target: string;
}
export interface PublishedStudioRelease {
  version: string;
  tag: string;
  assets: { name: string; browser_download_url: string; digest: string | null; size: number }[];
}

function stableVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) &&
    value.split('.').every((part) => Number.isSafeInteger(Number(part)))
  );
}

function compareVersions(left: string, right: string) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function parseManifest(contents: string): PortableManifest {
  const value = JSON.parse(contents) as PortableManifest;
  if (!stableVersion(value.version) || !/^(windows|linux|macos)-(x64|arm64)$/.test(value.target))
    throw new Error('The portable version or target is invalid.');
  return value;
}

async function readResponse(response: Response, limit: number) {
  if (!response.ok || !response.body)
    throw new Error('Cannot download the Studio release. Check your connection and try again.');
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new Error('The Studio release exceeds the download size limit.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('The Studio release exceeds the download size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

export async function readPublishedStudioRelease(
  fetchImpl: FetchRelease = fetch,
): Promise<PublishedStudioRelease> {
  const base = process.env.STUDIO_GITHUB_API_BASE ?? 'https://api.github.com';
  const response = await fetchImpl(
    `${base.replace(/\/$/, '')}/repos/gvastethecreator/cozy-studio/releases/latest`,
    {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Cozy-Studio' },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const value = JSON.parse((await readResponse(response, 1024 * 1024)).toString('utf8'));
  const version = typeof value.tag_name === 'string' ? value.tag_name.replace(/^v/, '') : null;
  if (value.draft || value.prerelease || !stableVersion(version) || !Array.isArray(value.assets))
    throw new Error('The latest published Studio release has an invalid version.');
  return { version, tag: value.tag_name, assets: value.assets };
}

function contains(root: string, path: string) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function physicalPath(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(physicalPath(parent), relative(parent, absolute));
}

function overlapsData(path: string, libraryDir: string) {
  return (
    contains(resolve(path), resolve(libraryDir)) ||
    contains(resolve(libraryDir), resolve(path)) ||
    contains(physicalPath(path), physicalPath(libraryDir)) ||
    contains(physicalPath(libraryDir), physicalPath(path))
  );
}

function isStateName(name: string) {
  return (
    name.toLowerCase() === '.studio' || /^(library|studio)\.sqlite(?:-(?:wal|shm))?$/i.test(name)
  );
}

/** Recovery folders are disposable only after proving they contain app code, never Studio data. */
export function removeAppCopy(dir: string, appRoot: string, protectedRoots: string[]) {
  const installRoot = dirname(resolve(appRoot));
  if (
    !['app.next', 'app.next.tmp', 'app.previous', 'app.failed'].some(
      (name) => join(installRoot, name) === resolve(dir),
    )
  )
    throw new Error('Refusing to remove a folder outside the portable app copies.');
  if (!existsSync(dir)) return;
  if (protectedRoots.some((root) => overlapsData(dir, root)))
    throw new Error('A recovery folder overlaps a registered storage folder. It was preserved.');
  const inspect = (path: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error('A recovery folder contains a symbolic link. It was preserved.');
    if (stat.isDirectory())
      for (const name of readdirSync(path)) {
        if (isStateName(name))
          throw new Error('A recovery folder contains Studio data. It was preserved.');
        inspect(join(path, name));
      }
    else if (!stat.isFile())
      throw new Error('A recovery folder contains an unsupported file. It was preserved.');
  };
  inspect(dir);
  parseManifest(readFileSync(join(dir, 'portable.json'), 'utf8'));
  if (!contains(realpathSync(installRoot), realpathSync(dir)))
    throw new Error('The recovery folder leaves the install folder.');
  rmSync(dir, { recursive: true });
}

function safeArchiveName(name: string) {
  const parts = name.replace(/\/$/, '').split('/');
  return (
    !name.includes('\\') &&
    parts.every(
      (part) =>
        part !== '' &&
        part !== '.' &&
        part !== '..' &&
        !/[<>:"|?*\x00-\x1f]/.test(part) &&
        !/[. ]$/.test(part) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  );
}

async function stageArchive(bytes: Buffer, dir: string, expected: PortableManifest) {
  const archive = await JSZip.loadAsync(bytes);
  const entries = Object.values(archive.files);
  if (entries.length > MAX_ENTRIES) throw new Error('The Studio release contains too many files.');
  const names = new Set<string>();
  for (const entry of entries) {
    const original =
      (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ??
      entry.name;
    const permissions =
      typeof entry.unixPermissions === 'string'
        ? parseInt(entry.unixPermissions, 8)
        : (entry.unixPermissions ?? 0);
    if (
      !safeArchiveName(original) ||
      !safeArchiveName(entry.name) ||
      (permissions & 0xf000) === 0xa000
    )
      throw new Error('The Studio release contains an unsafe archive entry.');
    const key = entry.name.toLowerCase().replace(/\/$/, '');
    if (names.has(key)) throw new Error('The Studio release contains duplicate archive paths.');
    names.add(key);
  }
  const prefix = 'Cozy Studio/app/';
  const files = entries.filter((entry) => entry.name.startsWith(prefix) && !entry.dir);
  if (files.some((entry) => entry.name.slice(prefix.length).split('/').some(isStateName)))
    throw new Error('The Studio release contains Studio data.');
  const manifestEntry = archive.file(`${prefix}portable.json`);
  if (!manifestEntry) throw new Error('The Studio release is missing portable.json.');
  const manifestChunks: Buffer[] = [];
  let manifestBytes = 0;
  await pipeline(
    manifestEntry.nodeStream(),
    new Writable({
      write(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        manifestBytes += buffer.length;
        if (manifestBytes > 64 * 1024) callback(new Error('The portable manifest is too large.'));
        else {
          manifestChunks.push(buffer);
          callback();
        }
      },
    }),
  );
  const manifest = Buffer.concat(manifestChunks).toString('utf8');
  const parsed = parseManifest(manifest);
  if (parsed.target !== expected.target || parsed.version !== expected.version)
    throw new Error('The staged Studio version or target does not match the checked release.');
  mkdirSync(dir);
  writeFileSync(join(dir, 'portable.json'), manifest, { flag: 'wx' });
  let totalBytes = manifestBytes;
  for (const entry of files) {
    const rel = entry.name.slice(prefix.length);
    if (rel === 'portable.json') continue;
    const destination = resolve(dir, rel);
    if (!contains(dir, destination))
      throw new Error('The Studio release contains an unsafe archive entry.');
    mkdirSync(dirname(destination), { recursive: true });
    let fileBytes = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        fileBytes += chunk.length;
        totalBytes += chunk.length;
        callback(
          fileBytes > MAX_DOWNLOAD_BYTES || totalBytes > MAX_EXTRACTED_BYTES
            ? new Error('The extracted Studio release exceeds the size limit.')
            : null,
          chunk,
        );
      },
    });
    await pipeline(entry.nodeStream(), limit, createWriteStream(destination, { flags: 'wx' }));
    const permissions =
      typeof entry.unixPermissions === 'string'
        ? parseInt(entry.unixPermissions, 8)
        : (entry.unixPermissions ?? 0);
    if (permissions & 0o111) chmodSync(destination, 0o755);
  }
}

export function createReleaseUpdates({
  appRoot = studioAppRoot,
  getProtectedRoots,
  restart,
  isBusy,
  fetchImpl = fetch,
}: {
  appRoot?: string;
  getProtectedRoots: () => string[];
  restart?: () => void;
  isBusy: () => boolean;
  fetchImpl?: FetchRelease;
}) {
  appRoot = resolve(appRoot);
  const current = parseManifest(readFileSync(join(appRoot, 'portable.json'), 'utf8'));
  const state: RepositoryUpdateStatus = {
    source: 'release',
    channel: 'releases',
    currentVersion: current.version,
    latestVersion: null,
    instanceId: randomUUID(),
    phase: 'idle',
    checkedAt: null,
    currentCommit: null,
    latestCommit: null,
    behind: 0,
    canUpdate: false,
    canRestart: false,
    blocker: null,
    error: null,
  };
  let pending: Promise<void> | null = null;
  let assetUrl: string | null = null;
  function blocker() {
    return getProtectedRoots().some((root) => overlapsData(appRoot, root))
      ? dataMessage
      : basename(appRoot) !== 'app' || lstatSync(appRoot).isSymbolicLink() || !restart
        ? launcherMessage
        : null;
  }
  function status(): RepositoryUpdateStatus {
    const locked = state.phase === 'updating' || state.phase === 'restarting';
    const busy = isBusy();
    const blocked = blocker();
    return {
      ...state,
      blocker: blocked ?? (busy ? busyMessage : null),
      canUpdate: state.canUpdate && !blocked && !pending && !locked && !busy,
      canRestart: !!restart && !pending && !locked && !busy,
    };
  }
  function assertUnblocked() {
    const blocked = blocker();
    if (blocked) throw new Error(blocked);
    if (isBusy()) throw new Error(busyMessage);
  }
  async function inspect() {
    state.canUpdate = false;
    state.latestCommit = null;
    state.latestVersion = null;
    state.behind = 0;
    assetUrl = null;
    const release = await readPublishedStudioRelease(fetchImpl);
    const asset = release.assets.find((item) => item.name === `Cozy-Studio-${current.target}.zip`);
    if (
      !asset ||
      !/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? '') ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > MAX_DOWNLOAD_BYTES
    )
      throw new Error(
        'The Studio release needs a matching ZIP with a SHA-256 digest and a valid size.',
      );
    const url = new URL(asset.browser_download_url);
    if (
      url.protocol !== 'https:' &&
      !(
        process.env.STUDIO_GITHUB_API_BASE &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      )
    )
      throw new Error('The Studio release download must use HTTPS.');
    assetUrl = url.href;
    state.latestVersion = release.version;
    state.latestCommit = asset.digest!.slice(7).toLowerCase();
    state.behind = compareVersions(release.version, current.version) > 0 ? 1 : 0;
    state.checkedAt = new Date().toISOString();
    state.canUpdate = state.behind > 0;
  }
  async function check() {
    if (pending || state.phase === 'restarting') return status();
    state.phase = 'checking';
    state.error = null;
    pending = inspect()
      .then(() => {
        state.phase = 'idle';
      })
      .catch((error: Error) => {
        state.phase = 'error';
        state.error = error.message;
        state.canUpdate = false;
      });
    try {
      await pending;
    } finally {
      pending = null;
    }
    return status();
  }
  function scheduleRestart() {
    state.phase = 'restarting';
    setTimeout(() => restart?.(), 500);
  }
  function apply(token: string) {
    if (pending || state.phase === 'restarting')
      throw new Error('An update operation is already running.');
    assertUnblocked();
    if (!state.latestCommit || token !== state.latestCommit)
      throw new Error('Check for updates again before updating.');
    const version = state.latestVersion;
    state.phase = 'updating';
    state.error = null;
    pending = (async () => {
      await inspect();
      if (token !== state.latestCommit || version !== state.latestVersion)
        throw new Error('A new release arrived. Check and review the update again.');
      if (!state.canUpdate) throw new Error('Studio is already up to date.');
      assertUnblocked();
      const bytes = await readResponse(
        await fetchImpl(assetUrl!, { signal: AbortSignal.timeout(300_000) }),
        MAX_DOWNLOAD_BYTES,
      );
      if (createHash('sha256').update(bytes).digest('hex') !== token)
        throw new Error('The Studio release ZIP failed its SHA-256 check.');
      assertUnblocked();
      const root = dirname(appRoot);
      for (const name of ['app.next', 'app.next.tmp', 'app.previous', 'app.failed'])
        removeAppCopy(join(root, name), appRoot, getProtectedRoots());
      await stageArchive(bytes, join(root, 'app.next.tmp'), {
        target: current.target,
        version: version!,
      });
      assertUnblocked();
      renameSync(join(root, 'app.next.tmp'), join(root, 'app.next'));
      scheduleRestart();
    })()
      .catch((error: Error) => {
        state.phase = 'error';
        state.error = error.message;
        state.canUpdate = false;
      })
      .finally(() => {
        pending = null;
      });
    return status();
  }
  function restartNow() {
    if (!status().canRestart)
      throw new Error(
        'Restart is unavailable. Finish active jobs or retry the failed update first.',
      );
    scheduleRestart();
    return status();
  }
  return {
    status,
    check,
    apply,
    restart: restartNow,
    blocksMutations: () => state.phase === 'updating' || state.phase === 'restarting',
  };
}
