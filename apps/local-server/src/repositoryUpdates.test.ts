import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createRepositoryUpdates } from './repositoryUpdates';
import { createRepositoryUpdateRoutes } from './repositoryUpdateRoutes';
import { createLocalApiSecurityMiddleware } from './localApiSecurity';

const roots: string[] = [];
const activeUpdates: ReturnType<typeof createRepositoryUpdates>[] = [];
afterEach(async () => {
  // A timed-out assertion must not remove a checkout while Git still uses it.
  await vi.waitFor(
    () => {
      for (const updates of activeUpdates)
        expect(['checking', 'updating']).not.toContain(updates.status().phase);
    },
    { timeout: 5000 },
  );
  activeUpdates.length = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'studio-update-'));
  roots.push(base);
  const remote = join(base, 'remote');
  const root = join(base, 'studio');
  mkdirSync(remote);
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
        'core.hooksPath=',
        ...args,
      ],
      { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  git(remote, 'init', '-b', 'main');
  writeFileSync(join(remote, 'app.txt'), 'v1');
  git(remote, 'add', '.');
  git(remote, 'commit', '-m', 'initial');
  git(base, 'clone', remote, root);
  function advance(contents = 'v2') {
    writeFileSync(join(remote, 'app.txt'), contents);
    git(remote, 'commit', '-am', 'update');
    return git(remote, 'rev-parse', 'HEAD');
  }
  const install = vi.fn(async () => {});
  const restart = vi.fn();
  let busy = false;
  const updates = createRepositoryUpdates({ root, install, restart, isBusy: () => busy });
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
