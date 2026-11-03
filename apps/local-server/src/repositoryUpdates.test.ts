import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createRepositoryUpdates } from './repositoryUpdates';
import { createReleaseUpdates, removeAppCopy } from './releaseUpdates';
import type { RepositoryUpdateChannel } from '../../../packages/shared/src/repositoryUpdates';
import { createRepositoryUpdateRoutes } from './repositoryUpdateRoutes';
import { createLocalApiSecurityMiddleware } from './localApiSecurity';

const roots: string[] = [];
const activeUpdates: ReturnType<typeof createRepositoryUpdates>[] = [];
const finishPendingRequests: (() => void)[] = [];
afterEach(async () => {
  const testUpdates = activeUpdates.splice(0);
  const testRoots = roots.splice(0);
  for (const finish of finishPendingRequests.splice(0)) finish();
  // A timed-out assertion must not remove a checkout while Git still uses it.
  await vi.waitFor(
    () => {
      for (const updates of testUpdates)
        expect(['checking', 'updating']).not.toContain(updates.status().phase);
    },
    { timeout: 5000 },
  );
  for (const root of testRoots) rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Studio Test',
      '-c',
      'user.email=studio@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'tag.gpgSign=false',
      '-c',
      'core.hooksPath=',
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();

// Build the remote and its clone once; each test gets its own copy.
let template: string;
beforeAll(() => {
  template = mkdtempSync(join(tmpdir(), 'studio-update-template-'));
  const remote = join(template, 'remote');
  mkdirSync(remote);
  git(remote, 'init', '-b', 'main');
  // Repository maintenance is unrelated to the update behavior exercised by these fixtures.
  git(remote, 'config', '--local', 'maintenance.auto', 'false');
  writeFileSync(join(remote, 'app.txt'), 'v1');
  writeFileSync(join(remote, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  git(remote, 'add', '.');
  git(remote, 'commit', '-m', 'initial');
  git(template, 'clone', remote, join(template, 'studio'));
  git(join(template, 'studio'), 'config', '--local', 'maintenance.auto', 'false');
  // A relative origin makes every copy fetch from its own remote.
  git(join(template, 'studio'), 'remote', 'set-url', 'origin', '../remote');
});
afterAll(() => rmSync(template, { recursive: true, force: true }));

function fixture(options: Partial<Parameters<typeof createRepositoryUpdates>[0]> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'studio-update-'));
  roots.push(base);
  cpSync(template, base, { recursive: true });
  const remote = join(base, 'remote');
  const root = join(base, 'studio');
  function advance(contents = 'v2') {
    writeFileSync(join(remote, 'app.txt'), contents);
    git(remote, 'commit', '-am', 'update');
    return git(remote, 'rev-parse', 'HEAD');
  }
  const install = vi.fn(async () => {});
  const restart = vi.fn();
  let busy = false;
  const updates = createRepositoryUpdates({
    root,
    install,
    restart,
    isBusy: () => busy,
    ...options,
  });
  activeUpdates.push(updates);
  return {
    root,
    remote,
    git,
    advance,
    install,
    restart,
    updates,
    setBusy: (value: boolean) => {
      busy = value;
    },
  };
}

describe('repository updates', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => {
    f = fixture();
  });
  describe('with a checked update', () => {
    let target: string;
    let checked: Awaited<ReturnType<typeof f.updates.check>>;
    beforeEach(async () => {
      target = f.advance();
      checked = await f.updates.check();
    });

    it('checks origin/main without changing HEAD, then fast-forwards, installs and restarts once', async () => {
      expect(checked).toMatchObject({
        behind: 1,
        latestCommit: target,
        canUpdate: true,
      });
      expect(readFileSync(join(f.root, 'app.txt'), 'utf8')).toBe('v1');
      expect(f.updates.apply(target).phase).toBe('updating');
      expect(() => f.updates.apply(target)).toThrow('already running');
      await vi.waitFor(() => expect(f.restart).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(f.git(f.root, 'rev-parse', 'HEAD')).toBe(target);
      expect(f.install).toHaveBeenCalledTimes(1);
    });

    it('rechecks active work when applying', async () => {
      f.setBusy(true);
      expect(await f.updates.check()).toMatchObject({
        canUpdate: false,
        blocker: expect.stringContaining('active jobs'),
      });
      expect(() => f.updates.apply(target)).toThrow('active jobs');
      expect(() => f.updates.restart()).toThrow('unavailable');
      f.setBusy(false);
      expect(f.updates.status()).toMatchObject({ canUpdate: true, blocker: null });
    });

    it('rechecks local changes when applying', async () => {
      writeFileSync(join(f.root, 'app.txt'), 'my changes');
      f.updates.apply(target);
      await vi.waitFor(() => expect(f.updates.status().phase).toBe('error'), { timeout: 5000 });
      expect(f.updates.status().error).toContain('local changes');
      expect(readFileSync(join(f.root, 'app.txt'), 'utf8')).toBe('my changes');
      expect(f.install).not.toHaveBeenCalled();
      expect(f.restart).not.toHaveBeenCalled();
    });

    it('keeps the server alive and permits retry if dependency installation fails after the merge', async () => {
      f.install.mockRejectedValueOnce(new Error('install failed'));
      f.updates.apply(target);
      await vi.waitFor(
        () =>
          expect(f.updates.status()).toMatchObject({
            phase: 'error',
            canUpdate: true,
            canRestart: false,
          }),
        { timeout: 5000 },
      );
      expect(f.restart).not.toHaveBeenCalled();
      expect(f.updates.blocksMutations()).toBe(true);
      expect(await f.updates.check()).toMatchObject({
        phase: 'error',
        error: 'install failed',
        canUpdate: true,
      });
      // Installation retries use the applied commit, even when Git goes offline.
      f.git(f.root, 'remote', 'set-url', 'origin', join(f.root, 'missing-remote'));
      f.updates.apply(target);
      await vi.waitFor(() => expect(f.restart).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(f.install).toHaveBeenCalledTimes(2);
    });

    it('rejects stale targets', async () => {
      const old = f.git(f.root, 'rev-parse', 'HEAD');
      const accepted = target;
      target = f.advance('v3');
      f.updates.apply(accepted);
      await vi.waitFor(() => expect(f.updates.status().error).toContain('New commits arrived'), {
        timeout: 5000,
      });
      expect(f.git(f.root, 'rev-parse', 'HEAD')).toBe(old);
      expect(f.updates.status().latestCommit).toBe(target);
    });

    it('reports remote failures without exposing Git credentials', async () => {
      f.git(f.root, 'remote', 'set-url', 'origin', join(f.root, 'secret-token-missing-remote'));
      const status = await f.updates.check();
      expect(status).toMatchObject({ phase: 'error', canUpdate: false, latestCommit: null });
      expect(status.error).not.toContain('secret-token');
    });
  });

  it.each(['untracked', 'Local commits', 'Switch to main'])(
    'blocks updates for %s without changing local files',
    async (blocker) => {
      f.advance();
      writeFileSync(join(f.root, 'notes.txt'), 'unique');
      if (blocker !== 'untracked') {
        f.git(f.root, 'add', '.');
        f.git(f.root, 'commit', '-m', 'local');
      }
      if (blocker === 'Switch to main') f.git(f.root, 'checkout', '-b', 'feature');
      expect(await f.updates.check()).toMatchObject({
        canUpdate: false,
        blocker: expect.stringContaining(blocker),
      });
      expect(readFileSync(join(f.root, 'notes.txt'), 'utf8')).toBe('unique');
    },
  );

  it('reports up to date without a blocker when only local commits differ', async () => {
    writeFileSync(join(f.root, 'notes.txt'), 'unique');
    f.git(f.root, 'add', '.');
    f.git(f.root, 'commit', '-m', 'local');
    expect(await f.updates.check()).toMatchObject({ behind: 0, canUpdate: false, blocker: null });
  });

  it('requires a managed launcher and protects mutation routes from foreign origins and simple form posts', async () => {
    f.advance();
    const unmanaged = createRepositoryUpdates({
      root: f.root,
      isBusy: () => false,
      install: f.install,
    });
    activeUpdates.push(unmanaged);
    expect(await unmanaged.check()).toMatchObject({
      canUpdate: false,
      canRestart: false,
      blocker: expect.stringContaining('bun run dev'),
    });
    const app = new Hono();
    app.use('*', createLocalApiSecurityMiddleware());
    app.route('/api/updates', createRepositoryUpdateRoutes(unmanaged));
    expect(
      (
        await app.request('/api/updates/restart', {
          method: 'POST',
          headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect((await app.request('/api/updates/restart', { method: 'POST', body: '' })).status).toBe(
      415,
    );
    expect(
      (
        await app.request('/api/updates/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"commit":"--evil"}',
        })
      ).status,
    ).toBe(400);
  });
});

describe('release channel in a Git checkout', () => {
  it('fetches an annotated published tag and stops before later main commits', async () => {
    const readRelease = vi.fn(async () => ({ version: '0.1.1', tag: 'v0.1.1', assets: [] }));
    const f = fixture({ getChannel: () => 'releases', readRelease });
    writeFileSync(join(f.remote, 'package.json'), JSON.stringify({ version: '0.1.1' }));
    const releaseCommit = f.advance();
    f.git(f.remote, 'tag', '-a', 'v0.1.1', '-m', 'Release');
    f.advance('unreleased');
    expect(await f.updates.check()).toMatchObject({
      source: 'git',
      channel: 'releases',
      latestVersion: '0.1.1',
      latestCommit: releaseCommit,
      canUpdate: true,
    });
    f.updates.apply(releaseCommit);
    await vi.waitFor(() => expect(f.restart).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(f.git(f.root, 'rev-parse', 'HEAD')).toBe(releaseCommit);
    expect(readFileSync(join(f.root, 'app.txt'), 'utf8')).toBe('v2');
    expect(f.updates.status().currentVersion).toBe('0.1.1');
    f.git(f.remote, 'tag', 'v0.1.2');
    readRelease.mockResolvedValue({ version: '0.1.2', tag: 'v0.1.2', assets: [] });
    const restarted = createRepositoryUpdates({
      root: f.root,
      restart: f.restart,
      install: f.install,
      isBusy: () => false,
      getChannel: () => 'releases',
      readRelease,
    });
    activeUpdates.push(restarted);
    expect(await restarted.check()).toMatchObject({
      currentVersion: '0.1.1',
      latestVersion: '0.1.2',
      canUpdate: true,
    });
  });

  it('invalidates a checked commit when the saved channel changes and rejects a change during apply', async () => {
    let channel: RepositoryUpdateChannel = 'commits';
    const release = { version: '0.1.1', tag: 'v0.1.1', assets: [] };
    let finishCheck!: () => void;
    const checkedRelease = new Promise<typeof release>((resolve) => {
      finishCheck = () => resolve(release);
    });
    let finishApply!: () => void;
    const appliedRelease = new Promise<typeof release>((resolve) => {
      finishApply = () => resolve(release);
    });
    finishPendingRequests.push(() => {
      finishCheck();
      finishApply();
    });
    const readRelease = vi
      .fn(async () => release)
      .mockReturnValueOnce(checkedRelease)
      .mockReturnValueOnce(appliedRelease);
    const f = fixture({ getChannel: () => channel, readRelease });
    const target = f.advance();
    f.git(f.remote, 'tag', 'v0.1.1');
    await f.updates.check();
    channel = 'releases';
    expect(f.updates.status()).toMatchObject({
      channel: 'releases',
      checkedAt: null,
      latestCommit: null,
      canUpdate: false,
    });
    expect(() => f.updates.apply(target)).toThrow('Check for updates');
    const checked = f.updates.check();
    await vi.waitFor(() => expect(readRelease).toHaveBeenCalledTimes(1));
    finishCheck();
    await checked;
    f.updates.apply(target);
    await vi.waitFor(() => expect(readRelease).toHaveBeenCalledTimes(2));
    channel = 'commits';
    finishApply();
    await vi.waitFor(() => expect(f.updates.status().phase).toBe('error'), { timeout: 5000 });
    expect(f.updates.status()).toMatchObject({
      latestCommit: null,
      canUpdate: false,
      channel: 'commits',
    });
    expect(readFileSync(join(f.root, 'app.txt'), 'utf8')).toBe('v1');
    expect(f.install).not.toHaveBeenCalled();
  });
});

async function releaseFixture(edit?: (zip: JSZip) => void) {
  const root = mkdtempSync(join(tmpdir(), 'studio-release-'));
  roots.push(root);
  const appRoot = join(root, 'app');
  const libraryDir = join(root, 'Cozy Studio Library');
  mkdirSync(appRoot);
  mkdirSync(libraryDir);
  writeFileSync(
    join(appRoot, 'portable.json'),
    JSON.stringify({ version: '0.1.1', target: 'windows-x64' }),
  );
  writeFileSync(join(libraryDir, 'unique.txt'), 'preserved');
  const zip = new JSZip();
  zip.file(
    'Cozy Studio/app/portable.json',
    JSON.stringify({ version: '0.1.2', target: 'windows-x64' }),
  );
  zip.file('Cozy Studio/app/app.txt', 'new app');
  zip.file('Cozy Studio/Cozy Studio.bat', 'must not replace launcher');
  edit?.(zip);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
  const digest = createHash('sha256').update(bytes).digest('hex');
  const release = {
    tag_name: 'v0.1.2',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'Cozy-Studio-windows-x64.zip',
        browser_download_url: 'https://release.invalid/studio.zip',
        digest: `sha256:${digest}`,
        size: bytes.length,
      },
    ],
  };
  const fetchImpl = vi.fn(async (url: string) =>
    url.endsWith('/releases/latest') ? Response.json(release) : new Response(new Uint8Array(bytes)),
  );
  const restart = vi.fn();
  let busy = false;
  const protectedRoots = [libraryDir];
  const updates = createReleaseUpdates({
    appRoot,
    getProtectedRoots: () => protectedRoots,
    restart,
    isBusy: () => busy,
    fetchImpl,
  });
  activeUpdates.push(updates);
  return {
    root,
    appRoot,
    libraryDir,
    protectedRoots,
    release,
    digest,
    updates,
    restart,
    fetchImpl,
    setBusy: (value: boolean) => {
      busy = value;
    },
  };
}

describe('portable release updates', () => {
  it('requires an upgrade, stages only app files, keeps the data folder and restarts once', async () => {
    const f = await releaseFixture();
    f.release.tag_name = 'v0.1.1';
    expect(await f.updates.check()).toMatchObject({ behind: 0, canUpdate: false });
    f.release.tag_name = 'v0.1.2';
    expect(await f.updates.check()).toMatchObject({
      source: 'release',
      channel: 'releases',
      currentVersion: '0.1.1',
      latestVersion: '0.1.2',
      latestCommit: f.digest,
      canUpdate: true,
    });
    f.setBusy(true);
    expect(() => f.updates.apply(f.digest)).toThrow('active jobs');
    f.setBusy(false);
    const app = new Hono();
    app.route('/api/updates', createRepositoryUpdateRoutes(f.updates));
    expect(
      (
        await app.request('/api/updates/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commit: f.digest }),
        })
      ).status,
    ).toBe(202);
    expect(f.updates.blocksMutations()).toBe(true);
    expect(() => f.updates.apply(f.digest)).toThrow('already running');
    await vi.waitFor(() => expect(f.restart).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(
      JSON.parse(readFileSync(join(f.root, 'app.next', 'portable.json'), 'utf8')).version,
    ).toBe('0.1.2');
    expect(readFileSync(join(f.root, 'app.next', 'app.txt'), 'utf8')).toBe('new app');
    expect(existsSync(join(f.root, 'Cozy Studio.bat'))).toBe(false);
    expect(readFileSync(join(f.libraryDir, 'unique.txt'), 'utf8')).toBe('preserved');
  });

  it('requires the asset digest, detects mismatches and rejects releases changed after checking', async () => {
    const f = await releaseFixture();
    f.release.assets[0].digest = '';
    expect(await f.updates.check()).toMatchObject({
      phase: 'error',
      canUpdate: false,
      latestCommit: null,
    });
    f.release.assets[0].digest = `sha256:${'0'.repeat(64)}`;
    await f.updates.check();
    f.updates.apply('0'.repeat(64));
    await vi.waitFor(() => expect(f.updates.status().error).toContain('SHA-256'));
    expect(existsSync(join(f.root, 'app.next.tmp'))).toBe(false);
    f.release.assets[0].digest = `sha256:${f.digest}`;
    await f.updates.check();
    f.fetchImpl.mockImplementationOnce(async () => Response.json(f.release));
    f.fetchImpl.mockImplementationOnce(
      async () =>
        new Response('oversized', { headers: { 'Content-Length': String(513 * 1024 * 1024) } }),
    );
    f.updates.apply(f.digest);
    await vi.waitFor(() => expect(f.updates.status().error).toContain('download size limit'));
    expect(existsSync(join(f.root, 'app.next.tmp'))).toBe(false);
    await f.updates.check();
    f.release.tag_name = 'v0.1.3';
    f.updates.apply(f.digest);
    await vi.waitFor(() => expect(f.updates.status().error).toContain('new release'));
    expect(f.restart).not.toHaveBeenCalled();
  });

  it.each(['unsafe path', 'symlink', 'wrong target', 'wrong version'])(
    'rejects %s in a downloaded archive',
    async (problem) => {
      const f = await releaseFixture((zip) => {
        if (problem === 'unsafe path') zip.file('Cozy Studio/app/../escape.txt', 'unsafe');
        if (problem === 'symlink')
          zip.file('Cozy Studio/app/link', '../../data', { unixPermissions: 0o120777 });
        if (problem.startsWith('wrong'))
          zip.file(
            'Cozy Studio/app/portable.json',
            JSON.stringify({
              version: problem === 'wrong version' ? '0.1.3' : '0.1.2',
              target: problem === 'wrong target' ? 'linux-x64' : 'windows-x64',
            }),
          );
      });
      await f.updates.check();
      f.updates.apply(f.digest);
      await vi.waitFor(() => expect(f.updates.status().phase).toBe('error'));
      expect(existsSync(join(f.root, 'app.next'))).toBe(false);
      expect(existsSync(join(f.root, 'escape.txt'))).toBe(false);
      expect(f.restart).not.toHaveBeenCalled();
    },
  );

  it('blocks registered storage inside the app, including junction aliases and output folders registered after check', async () => {
    const f = await releaseFixture();
    const inner = join(f.appRoot, 'data');
    mkdirSync(inner);
    const alias = join(f.root, 'alias');
    symlinkSync(inner, alias, 'junction');
    for (const libraryDir of [inner, alias]) {
      const updates = createReleaseUpdates({
        appRoot: f.appRoot,
        getProtectedRoots: () => [libraryDir],
        restart: f.restart,
        isBusy: () => false,
        fetchImpl: f.fetchImpl,
      });
      expect(await updates.check()).toMatchObject({
        canUpdate: false,
        blocker: expect.stringContaining('outside the app folder'),
      });
      expect(() => updates.apply(f.digest)).toThrow('outside the app folder');
    }
    expect(await f.updates.check()).toMatchObject({ canUpdate: true });
    const output = join(f.appRoot, 'my-images');
    mkdirSync(output);
    writeFileSync(join(output, 'original.png'), 'original');
    f.protectedRoots.push(output);
    expect(() => f.updates.apply(f.digest)).toThrow('outside the app folder');
    expect(readFileSync(join(output, 'original.png'), 'utf8')).toBe('original');
  });

  it('cleans only proven app copies and preserves physical SQLite state, legacy state and symlinks', async () => {
    const f = await releaseFixture();
    const copy = join(f.root, 'app.previous');
    for (const statePath of [
      '.studio/studio.sqlite',
      '.studio/studio.sqlite-wal',
      '.studio/studio.sqlite-shm',
      'library.sqlite',
      'library.sqlite-wal',
      'library.sqlite-shm',
      '.studio/other.json',
    ]) {
      mkdirSync(join(copy, statePath, '..'), { recursive: true });
      writeFileSync(
        join(copy, 'portable.json'),
        JSON.stringify({ version: '0.1.1', target: 'windows-x64' }),
      );
      writeFileSync(join(copy, statePath), 'unique state');
      expect(() => removeAppCopy(copy, f.appRoot, [f.libraryDir])).toThrow('Studio data');
      expect(readFileSync(join(copy, statePath), 'utf8')).toBe('unique state');
      rmSync(copy, { recursive: true });
    }
    mkdirSync(copy);
    writeFileSync(
      join(copy, 'portable.json'),
      JSON.stringify({ version: '0.1.1', target: 'windows-x64' }),
    );
    symlinkSync(f.libraryDir, join(copy, 'data'), 'junction');
    expect(() => removeAppCopy(copy, f.appRoot, [f.libraryDir])).toThrow('symbolic link');
    rmSync(join(copy, 'data'));
    expect(() => removeAppCopy(copy, f.appRoot, [copy])).toThrow('registered storage folder');
    const output = join(copy, 'my-images');
    mkdirSync(output);
    writeFileSync(join(output, 'original.png'), 'original');
    expect(() => removeAppCopy(copy, f.appRoot, [f.libraryDir, output])).toThrow(
      'registered storage folder',
    );
    expect(readFileSync(join(output, 'original.png'), 'utf8')).toBe('original');
    rmSync(output, { recursive: true });
    removeAppCopy(copy, f.appRoot, [f.libraryDir]);
    expect(existsSync(copy)).toBe(false);
    expect(readFileSync(join(f.libraryDir, 'unique.txt'), 'utf8')).toBe('preserved');
  });
});
