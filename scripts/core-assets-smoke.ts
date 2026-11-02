#!/usr/bin/env bun
/** Build and boot the UI from a temporary checkout with every optional asset pack absent. */
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';

const root = process.cwd();
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cozy-studio-core-assets-'));
const isolatedLibraryDir = path.join(tempRoot, '.local', 'library');
const isolatedProfileDir = path.join(tempRoot, '.local', 'profile');
const expectedTempPrefix = normalize(path.join(os.tmpdir(), 'cozy-studio-core-assets-'));
if (!normalize(tempRoot).startsWith(expectedTempPrefix)) {
  throw new Error(`Unexpected core asset smoke path: ${tempRoot}`);
}

// Bun loads the checkout's `.env.local` into this process. Keep it, and any Studio or provider
// setting from the shell, out of every child: the scratch Studio must not see the developer's setup.
const DEVELOPER_ENV_KEY =
  /^(STUDIO_|COZY_|VITE_|CODEX_|GROK_|GOOGLE_|GEMINI_|NANO_BANANA_|XAI_|OPENAI_|FAL_|REPLICATE_|COMFY|ANTIGRAVITY_|AGY_|ANTHROPIC_)/i;
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !DEVELOPER_ENV_KEY.test(key)),
);

function normalize(filePath: string) {
  return filePath.replaceAll('\\', '/');
}

function shouldCopy(source: string) {
  const relative = normalize(path.relative(root, source));
  if (!relative) return true;
  if (
    relative === '.git' ||
    relative.startsWith('.git/') ||
    relative === '.scratch' ||
    relative.startsWith('.scratch/') ||
    relative === '.tmp' ||
    relative.startsWith('.tmp/') ||
    relative === 'tmp' ||
    relative.startsWith('tmp/') ||
    relative === '.local' ||
    relative.startsWith('.local/') ||
    relative === 'logs' ||
    relative.startsWith('logs/') ||
    relative.startsWith('.env') ||
    relative === 'dist' ||
    relative.startsWith('dist/') ||
    relative === 'node_modules' ||
    relative.startsWith('node_modules/')
  ) {
    return false;
  }
  if (relative.startsWith('assets/recipes/character-lab/sources/')) return false;
  if (
    relative.startsWith('assets/recipes/character-lab/character-lab-') &&
    !relative.endsWith('-atlas.webp')
  ) {
    return false;
  }
  return true;
}

async function findAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a preview port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForPreview(url: string, child: ChildProcessWithoutNullStreams) {
  const deadline = Date.now() + 20_000;
  let lastError = 'preview did not respond';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Preview exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        const health = (await response.json()) as { ok?: boolean; libraryDir?: string };
        if (health.ok && path.resolve(health.libraryDir ?? '') === isolatedLibraryDir) return;
        lastError = 'Health response did not use the isolated Studio Library';
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(100);
  }

  throw new Error(`Preview readiness timed out: ${lastError}`);
}

async function stopPreview(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    Bun.sleep(2_000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function runBrowserSmoke(tempDir: string, baseUrl: string) {
  const child = spawn(
    'node',
    [
      path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(tempDir, 'scripts', 'core-assets-browser-smoke.ts'),
      `--url=${baseUrl}`,
      `--library-dir=${isolatedLibraryDir}`,
      `--screenshot=${path.join(root, '.scratch', 'screenshots', 'core-assets-smoke', 'library-url.png')}`,
    ],
    {
      cwd: tempDir,
      env: childEnv,
      windowsHide: true,
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timeoutId = setTimeout(() => resolve(null), 120_000);
    child.once('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeoutId);
      resolve(code);
    });
  });
  if (exitCode === null) {
    await stopPreview(child);
    throw new Error(`Core asset browser smoke timed out.\n${output}`);
  }
  if (exitCode !== 0) {
    throw new Error(`Core asset browser smoke failed with code ${exitCode}.\n${output}`);
  }

  const resultLine = output.split(/\r?\n/).findLast((line) => line.startsWith('{"ok":'));
  if (!resultLine) throw new Error(`Core asset browser smoke returned no result.\n${output}`);
  return JSON.parse(resultLine) as { routes: string[] };
}

let preview: ChildProcessWithoutNullStreams | null = null;
try {
  cpSync(root, tempRoot, { recursive: true, filter: shouldCopy });
  symlinkSync(
    path.join(root, 'node_modules'),
    path.join(tempRoot, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  const result = spawnSync(process.execPath, ['x', 'vp', 'build'], {
    cwd: tempRoot,
    env: { ...childEnv, VITE_STUDIO_API_BASE: '' },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    process.exitCode = 1;
  } else {
    const port = await findAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    preview = spawn(process.execPath, ['apps/local-server/src/index.ts'], {
      cwd: tempRoot,
      env: {
        ...childEnv,
        // Installed extensions, sign-in files and preview caches live under these profile folders.
        // ponytail: macOS resolves them under HOME; isolate HOME too if this smoke runs there.
        LOCALAPPDATA: isolatedProfileDir,
        XDG_DATA_HOME: isolatedProfileDir,
        XDG_STATE_HOME: isolatedProfileDir,
        STUDIO_LIBRARY_DIR: isolatedLibraryDir,
        STUDIO_IMAGES_DIR: path.join(tempRoot, '.local', 'images'),
        STUDIO_SERVER_PORT: String(port),
        STUDIO_CODEX_WS_PORT: String(port + 1),
        STUDIO_UI_DIST: path.join(tempRoot, 'dist'),
      },
      windowsHide: true,
    });
    let previewOutput = '';
    preview.stdout.on('data', (chunk) => {
      previewOutput += String(chunk);
    });
    preview.stderr.on('data', (chunk) => {
      previewOutput += String(chunk);
    });
    await waitForPreview(baseUrl, preview);
    const { extensions } = (await (await fetch(`${baseUrl}/api/extensions`)).json()) as {
      extensions: unknown[];
    };
    if (extensions.length > 0) {
      throw new Error(`Scratch Studio found ${extensions.length} extensions; packs must be absent`);
    }
    let browserResult: { routes: string[] };
    try {
      browserResult = await runBrowserSmoke(tempRoot, baseUrl);
    } catch (error) {
      if (previewOutput.trim()) process.stderr.write(previewOutput);
      throw error;
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          optionalPacksPresent: false,
          isolatedLibrary: true,
          build: 'vp build',
          browser: 'playwright chromium',
          routes: browserResult.routes,
          assetFailures: 0,
        },
        null,
        2,
      ),
    );
  }
} finally {
  if (preview) await stopPreview(preview);
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
