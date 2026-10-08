import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseListeningUrl, portableServerArgv, resolvePortableLibraryDir } from './portableLaunch';
import { readBootstrapEnv, resolveStudioDataRoot } from '../apps/local-server/src/config';
import { resolveUiDistDir, uiDistIsReady } from '../apps/local-server/src/uiStaticRoutes';

export interface PortableStartDependencies {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  spawnServer?: (argv: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;
  openBrowser?: (url: string) => void;
  waitMs?: (ms: number) => Promise<void>;
  distReady?: (rootDir: string) => boolean;
  forwardOutput?: (chunk: string) => void;
  now?: () => number;
  listenDeadlineMs?: number;
}

function defaultOpenBrowser(url: string) {
  const [command, args] =
    process.platform === 'win32'
      ? (['cmd', ['/d', '/c', 'start', '', url]] as const)
      : process.platform === 'darwin'
        ? (['open', [url]] as const)
        : (['xdg-open', [url]] as const);
  const browser = spawn(command, [...args], { detached: true, stdio: 'ignore', windowsHide: true });
  browser.once('error', () => console.warn(`Could not open a browser. Open ${url} manually.`));
  browser.unref();
}

function defaultSpawnServer(argv: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
  return spawn(process.execPath, argv, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function runPortableStart(dependencies: PortableStartDependencies = {}) {
  const cwd = dependencies.cwd ?? path.resolve(import.meta.dirname, '..');
  const envPath = path.join(cwd, '.env.local');
  const env = dependencies.env
    ? { ...dependencies.env }
    : {
        ...(existsSync(envPath) ? readBootstrapEnv(readFileSync(envPath, 'utf8')) : {}),
        ...process.env,
      };
  const portable = env.STUDIO_PORTABLE === '1';
  env.STUDIO_LIBRARY_DIR = resolvePortableLibraryDir({
    studioLibraryDir: env.STUDIO_LIBRARY_DIR,
    portable,
    unpackRoot: cwd,
    homeDefault: path.join(resolveStudioDataRoot(env), 'Library'),
  });

  const distDir = resolveUiDistDir(env, cwd);
  const distReady = dependencies.distReady ?? uiDistIsReady;
  if (!distReady(distDir)) {
    throw new Error(
      'Build the UI first with `bun run build`. Portable start serves dist/ from one local-server process.',
    );
  }

  const child = (dependencies.spawnServer ?? defaultSpawnServer)(portableServerArgv(), {
    cwd,
    env,
  });
  let spawnError: Error | null = null;
  child.once('error', (error) => {
    spawnError = error;
  });

  let combined = '';
  const forward =
    dependencies.forwardOutput ??
    ((chunk: string) => {
      process.stdout.write(chunk);
    });
  child.stdout?.on('data', (chunk) => {
    const text = String(chunk);
    combined += text;
    forward(text);
  });
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk);
    combined += text;
    forward(text);
  });

  const waitMs =
    dependencies.waitMs ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now ?? Date.now;
  const deadline = now() + (dependencies.listenDeadlineMs ?? 30_000);
  let url: string | null = null;
  while (now() < deadline) {
    if (spawnError) throw spawnError;
    url = parseListeningUrl(combined);
    if (url) break;
    if (child.exitCode !== null) {
      throw new Error('local-server exited before it started listening.');
    }
    await waitMs(100);
  }
  if (!url) {
    child.kill();
    throw new Error('local-server did not report a listening URL before the deadline.');
  }

  (dependencies.openBrowser ?? defaultOpenBrowser)(url);
  return { url, libraryDir: env.STUDIO_LIBRARY_DIR, child };
}

if (import.meta.main) {
  try {
    const started = await runPortableStart();
    const exitCode =
      started.child.exitCode ??
      (await new Promise<number>((resolve) => {
        started.child.once('exit', (code) => resolve(code ?? 1));
      }));
    process.exitCode = exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
