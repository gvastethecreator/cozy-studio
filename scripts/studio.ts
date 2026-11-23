/**
 * Daily Studio launcher: one local-server process serves the built UI from dist/, without the Vite
 * dev server. It builds the UI when dist/ is missing or was built from another commit, and builds
 * it again after each update restart. `bun run dev` stays the development path.
 *
 * Usage: bun run studio [--rebuild]. STUDIO_SERVER_PORT and STUDIO_UI_DIST change the port and the
 * build folder.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stopDevProcesses, waitForFirstDevProcessExit } from './devProcessPolicy';
import { isPortAvailable, waitForPortRelease } from './devPortFinder';
import { STUDIO_RESTART_EXIT_CODE } from '../packages/shared/src/repositoryUpdates';
import { resolveUiDistDir, uiDistIsReady } from '../apps/local-server/src/uiStaticRoutes';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.STUDIO_SERVER_PORT) || 17223;
const distDir = resolveUiDistDir(process.env, root);
const stampPath = path.join(distDir, '.studio-build-commit');

function headCommit() {
  const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

function builtCommit() {
  if (!uiDistIsReady(distDir) || !existsSync(stampPath)) return null;
  return readFileSync(stampPath, 'utf8').trim();
}

/**
 * Builds dist/ unless it already matches HEAD and this port. Uncommitted UI edits need --rebuild.
 * The build gets this server as its API base, so a .env value for another port cannot leak in.
 */
function ensureUiBuild(force: boolean) {
  const commit = headCommit();
  const stamp = commit && `${commit} ${port}`;
  if (!force && stamp && builtCommit() === stamp) {
    console.log(`[studio] UI build is current (${stamp.slice(0, 8)}).`);
    return;
  }
  console.log('[studio] Building the UI. This takes a minute...');
  const build = Bun.spawnSync(
    [process.execPath, 'x', 'vp', 'build', '--outDir', distDir, '--emptyOutDir'],
    {
      cwd: root,
      stdout: 'inherit',
      stderr: 'inherit',
      env: { ...process.env, VITE_STUDIO_API_BASE: `http://127.0.0.1:${port}` },
    },
  );
  if (build.exitCode !== 0 || !uiDistIsReady(distDir)) {
    throw new Error(
      'The UI build failed, so Studio did not start. Read the build output above, or start the development server with `bun run dev`.',
    );
  }
  if (stamp) writeFileSync(stampPath, `${stamp}\n`);
}

const stopOptions = {
  platform: process.platform,
  killProcessTree:
    process.platform === 'win32'
      ? (pid: number) =>
          Bun.spawnSync(['taskkill', '/PID', String(pid), '/T', '/F'], {
            stdout: 'ignore',
            stderr: 'ignore',
          }).exitCode === 0
      : undefined,
};

let processes: ReturnType<typeof Bun.spawn>[] = [];

function startServer() {
  processes = [
    Bun.spawn([process.execPath, 'apps/local-server/src/index.ts'], {
      cwd: root,
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
      env: {
        ...process.env,
        STUDIO_SERVER_PORT: String(port),
        STUDIO_MANAGED_RESTART: '1',
        STUDIO_UI_DIST: distDir,
      },
    }),
  ];
  console.log(`[studio] Open http://127.0.0.1:${port}/ in your browser.`);
}

function shutdown() {
  stopDevProcesses(processes, stopOptions);
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

if (!(await isPortAvailable(port))) {
  throw new Error(
    `Studio port ${port} is already in use. Close that Studio first, or choose another STUDIO_SERVER_PORT.`,
  );
}

ensureUiBuild(process.argv.includes('--rebuild'));
startServer();

while (true) {
  const exitCode = await waitForFirstDevProcessExit(processes, stopOptions);
  if (exitCode !== STUDIO_RESTART_EXIT_CODE) {
    process.exitCode = exitCode;
    break;
  }
  console.log('[studio] Restarting Studio after the update...');
  await waitForPortRelease([port]);
  ensureUiBuild(false);
  startServer();
}
