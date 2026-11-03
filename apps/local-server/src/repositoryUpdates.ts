import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  RepositoryUpdateChannel,
  RepositoryUpdateStatus,
} from '../../../packages/shared/src/repositoryUpdates';
import { readPublishedStudioRelease } from './releaseUpdates';

const exec = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../../..');
const busyMessage = 'Wait for active jobs and operations to finish before updating.';
// Only the dev launcher restarts Studio after an update; other launches update by hand.
const launcherMessage =
  'In-app updates need Studio started with bun run dev. Otherwise run git pull and bun install, then restart Studio.';

interface RepositoryUpdateOptions {
  root?: string;
  restart?: () => void;
  isBusy: () => boolean;
  install?: () => Promise<void>;
  getChannel?: () => RepositoryUpdateChannel;
  readRelease?: typeof readPublishedStudioRelease;
}

export function createRepositoryUpdates({
  root = repoRoot,
  restart,
  isBusy,
  getChannel = () => 'commits',
  readRelease = readPublishedStudioRelease,
  install = async () => {
    await exec(process.execPath, ['install', '--frozen-lockfile'], {
      cwd: root,
      windowsHide: true,
      timeout: 300_000,
      maxBuffer: 1024 * 1024,
    }).catch(() => {
      throw new Error(
        'Dependency installation failed. Retry the update, or run bun install --frozen-lockfile in the repository.',
      );
    });
  },
}: RepositoryUpdateOptions) {
  const state: RepositoryUpdateStatus = {
    source: 'git',
    channel: getChannel(),
    currentVersion: null,
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
  let needsInstall = false;
  let pending: Promise<void> | null = null;

  function invalidateCheckedResult() {
    state.latestCommit = null;
    state.latestVersion = null;
    state.checkedAt = null;
    state.behind = 0;
    state.canUpdate = false;
    state.blocker = null;
    state.error = null;
  }
  function syncChannel() {
    const channel = getChannel();
    if (state.channel !== channel) {
      state.channel = channel;
      invalidateCheckedResult();
    }
    return channel;
  }
  function assertChannel(channel: RepositoryUpdateChannel) {
    if (channel !== getChannel()) {
      syncChannel();
      invalidateCheckedResult();
      throw new Error('The update channel changed. Check for updates again before updating.');
    }
  }

  async function git(args: string[], failure: string) {
    try {
      const { stdout } = await exec(
        'git',
        ['-c', 'core.hooksPath=', '-c', 'merge.autoStash=false', ...args],
        {
          cwd: root,
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
        },
      );
      return stdout.trim();
    } catch {
      // Git diagnostics may contain remote URLs with credentials.
      throw new Error(failure);
    }
  }

  async function readCommitVersion(commit: string) {
    try {
      const version: unknown = JSON.parse(
        await git(['show', `${commit}:package.json`], 'Cannot read the installed version.'),
      ).version;
      return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : null;
    } catch {
      return null;
    }
  }

  async function inspect(channel: RepositoryUpdateChannel) {
    state.canUpdate = false;
    state.blocker = null;
    const top = await git(
      ['rev-parse', '--show-toplevel'],
      'Updates require a Git checkout with an origin remote.',
    );
    if (resolve(top) !== resolve(root))
      throw new Error('Updates require the Studio repository root.');
    state.currentCommit = await git(['rev-parse', 'HEAD'], 'Cannot read the installed commit.');
    state.currentVersion = await readCommitVersion(state.currentCommit);
    state.latestCommit = null;
    state.latestVersion = null;
    state.behind = 0;
    if (channel === 'releases') {
      const release = await readRelease();
      await git(
        ['check-ref-format', `refs/tags/${release.tag}`],
        'The published Studio release has an invalid Git tag.',
      );
      await git(
        [
          'fetch',
          '--no-tags',
          '--no-recurse-submodules',
          'origin',
          `+refs/tags/${release.tag}:refs/studio/latest-release`,
        ],
        'Cannot fetch the published release tag from origin. Check your connection and Git access, then try again.',
      );
      state.latestCommit = await git(
        ['rev-parse', 'refs/studio/latest-release^{commit}'],
        'The release tag does not point to a commit.',
      );
      state.latestVersion = release.version;
    } else {
      await git(
        [
          'fetch',
          '--no-tags',
          '--no-recurse-submodules',
          'origin',
          '+refs/heads/main:refs/remotes/origin/main',
        ],
        'Cannot check origin/main. Check your connection and Git access, then try again.',
      );
      state.latestCommit = await git(
        ['rev-parse', 'refs/remotes/origin/main'],
        'The origin remote has no fetched main branch.',
      );
    }
    assertChannel(channel);
    state.checkedAt = new Date().toISOString();
    const [branch, dirty, counts] = await Promise.all([
      git(['branch', '--show-current'], 'Cannot read the current branch.'),
      git(['status', '--porcelain', '--untracked-files=normal'], 'Cannot inspect local changes.'),
      git(
        ['rev-list', '--left-right', '--count', `HEAD...${state.latestCommit}`],
        'Cannot compare commits with the update target.',
      ),
    ]);
    const [ahead, behind] = counts.split(/\s+/).map(Number);
    assertChannel(channel);
    state.behind = behind;
    // A blocker only matters when there is something to apply.
    state.blocker =
      behind === 0 && !needsInstall
        ? null
        : branch !== 'main'
          ? 'Switch to main before updating.'
          : dirty
            ? 'Save or commit local changes and untracked files before updating.'
            : ahead > 0
              ? `Local commits differ from the update target: ${ahead} commit${ahead === 1 ? ' is' : 's are'} not in it. Review the repository before updating.`
              : !restart
                ? launcherMessage
                : null;
    state.canUpdate = !state.blocker && (behind > 0 || needsInstall);
  }

  function status(): RepositoryUpdateStatus {
    syncChannel();
    const locked = state.phase === 'updating' || state.phase === 'restarting';
    const busy = isBusy();
    return {
      ...state,
      blocker: state.blocker ?? (busy ? busyMessage : null),
      canRestart: !!restart && !locked && !pending && !needsInstall && !busy,
      canUpdate: state.canUpdate && !locked && !pending && !busy,
    };
  }

  async function check() {
    if (pending || state.phase === 'restarting' || needsInstall) return status();
    state.phase = 'checking';
    state.error = null;
    const channel = syncChannel();
    pending = inspect(channel)
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
    // Allow the accepted response to reach the browser before closing HTTP.
    setTimeout(() => restart?.(), 500);
  }

  function apply(expectedCommit: string) {
    if (pending || state.phase === 'restarting')
      throw new Error('An update operation is already running.');
    if (!restart) throw new Error(launcherMessage);
    if (isBusy()) throw new Error(busyMessage);
    const channel = syncChannel();
    if (!state.latestCommit || expectedCommit !== state.latestCommit)
      throw new Error('Check for updates again before updating.');
    state.phase = 'updating';
    state.error = null;
    pending = (async () => {
      if (needsInstall) {
        const head = await git(['rev-parse', 'HEAD'], 'Cannot read the installed commit.');
        if (head !== state.currentCommit || head !== expectedCommit)
          throw new Error(
            'The repository changed after the update. Restore the applied commit before retrying installation.',
          );
      } else {
        await inspect(channel);
        if (state.latestCommit !== expectedCommit)
          throw new Error('New commits arrived. Check and review the update again.');
        if (state.blocker) throw new Error(state.blocker);
        if (isBusy()) throw new Error(busyMessage);
        if (!state.canUpdate) throw new Error('Studio is already up to date.');
        assertChannel(channel);
        await git(
          ['merge', '--ff-only', '--no-edit', expectedCommit],
          'Update could not fast-forward safely. Local work was preserved; check the repository manually.',
        );
        needsInstall = true;
        state.currentCommit = expectedCommit;
        state.currentVersion = await readCommitVersion(expectedCommit);
        state.behind = 0;
      }
      await install();
      needsInstall = false;
      scheduleRestart();
    })()
      .catch((error: Error) => {
        state.phase = 'error';
        state.error = error.message;
        state.canUpdate = needsInstall;
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
    blocksMutations: () =>
      needsInstall || state.phase === 'updating' || state.phase === 'restarting',
  };
}

export type RepositoryUpdates = ReturnType<typeof createRepositoryUpdates>;
