import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { isAbsolutePlatformPath, resolveUserHome } from './platformHome';

export type PlatformPathKey =
  | 'codex-binary'
  | 'codex-skills-dir'
  | 'codex-generated-images'
  | 'codex-config-dir';

function firstExisting(paths: string[], fallback: string) {
  return paths.find((candidate) => existsSync(candidate)) ?? fallback;
}

export interface PlatformPathCandidate {
  path: string;
  source: string;
}

function windowsOpenAiRuntimeCandidates(localAppData: string): PlatformPathCandidate[] {
  const runtimeRoot = path.win32.join(localAppData, 'OpenAI', 'Codex', 'bin');
  try {
    return readdirSync(runtimeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.win32.join(runtimeRoot, entry.name, 'codex.exe'))
      .filter((candidate) => existsSync(candidate))
      .toSorted((left, right) => {
        try {
          return statSync(right).mtimeMs - statSync(left).mtimeMs;
        } catch {
          return 0;
        }
      })
      .map((candidate) => ({
        path: candidate,
        source: 'OpenAI desktop runtime',
      }));
  } catch {
    return [];
  }
}

function windowsCodexBinaryCandidates(env: NodeJS.ProcessEnv) {
  const home = resolveUserHome({ env, platform: 'win32' });
  const appData = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming');
  const localAppData = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
  const pathCandidates = (env.PATH || '')
    .split(path.win32.delimiter)
    .filter(Boolean)
    .flatMap((dir) => [
      {
        path: path.win32.join(dir, 'codex.exe'),
        source: 'PATH executable',
      },
      {
        path: path.win32.join(dir, 'codex.cmd'),
        source: 'PATH command shim',
      },
      {
        path: path.win32.join(dir, 'codex'),
        source: 'PATH shell shim',
      },
    ])
    .filter((candidate) => existsSync(candidate.path));

  return [
    ...(env.STUDIO_CODEX_CLI_PATH
      ? [{ path: env.STUDIO_CODEX_CLI_PATH, source: 'STUDIO_CODEX_CLI_PATH' }]
      : []),
    ...windowsOpenAiRuntimeCandidates(localAppData),
    ...(env.CODEX_CLI_PATH ? [{ path: env.CODEX_CLI_PATH, source: 'CODEX_CLI_PATH' }] : []),
    {
      path: path.win32.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
      source: 'OpenAI desktop install',
    },
    {
      path: path.win32.join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
      source: 'npm command shim',
    },
    {
      path: path.win32.join(appData, 'npm', 'codex.cmd'),
      source: 'npm command shim',
    },
    {
      path: path.win32.join(appData, 'npm', 'codex.exe'),
      source: 'npm executable shim',
    },
    {
      path: path.win32.join(appData, 'npm', 'codex'),
      source: 'npm shell shim',
    },
    {
      path: path.win32.join(home, '.bun', 'bin', 'codex.exe'),
      source: 'Bun global executable shim',
    },
    {
      path: path.win32.join(localAppData, 'Microsoft', 'WindowsApps', 'codex.exe'),
      source: 'WindowsApps alias',
    },
    ...pathCandidates,
    // Package-internal vendor paths are recovery fallbacks only. Their layout
    // changes across Codex releases, while the launchers above are stable.
    {
      path: path.win32.join(
        appData,
        'npm',
        'node_modules',
        '@openai',
        'codex',
        'node_modules',
        '@openai',
        'codex-win32-x64',
        'vendor',
        'x86_64-pc-windows-msvc',
        'codex.exe',
      ),
      source: 'npm package vendor binary',
    },
    {
      path: path.win32.join(
        appData,
        'npm',
        'node_modules',
        '@openai',
        'codex',
        'node_modules',
        '@openai',
        'codex-win32-x64',
        'vendor',
        'x86_64-pc-windows-msvc',
        'bin',
        'codex.exe',
      ),
      source: 'npm package bin vendor binary',
    },
    {
      path: 'codex',
      source: 'PATH fallback',
    },
  ] satisfies PlatformPathCandidate[];
}

function unixCodexBinaryCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  const home = resolveUserHome({ env, platform });
  return [
    ...(env.STUDIO_CODEX_CLI_PATH
      ? [{ path: env.STUDIO_CODEX_CLI_PATH, source: 'STUDIO_CODEX_CLI_PATH' }]
      : []),
    ...(env.CODEX_CLI_PATH ? [{ path: env.CODEX_CLI_PATH, source: 'CODEX_CLI_PATH' }] : []),
    { path: path.posix.join(home, '.local', 'bin', 'codex'), source: 'local bin' },
    { path: path.posix.join(home, '.bun', 'bin', 'codex'), source: 'Bun global executable shim' },
    {
      path: path.posix.join(home, '.local', 'share', 'npm', 'bin', 'codex'),
      source: 'npm local bin',
    },
    { path: path.posix.join(home, '.npm-global', 'bin', 'codex'), source: 'npm global bin' },
    { path: 'codex', source: 'PATH fallback' },
  ] satisfies PlatformPathCandidate[];
}

export function resolvePlatformPath(
  key: PlatformPathKey,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  if (key === 'codex-binary') {
    return firstExisting(
      listPlatformPathCandidates(key, env, platform)
        .map((candidate) => candidate.path)
        .filter((candidate) => candidate !== 'codex'),
      'codex',
    );
  }
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const configured = env.CODEX_HOME?.trim() || undefined;
  if (configured && !isAbsolutePlatformPath(configured, platform)) {
    throw new Error('CODEX_HOME must be an absolute path for this operating system.');
  }
  const codexConfig = configured ?? pathApi.join(resolveUserHome({ env, platform }), '.codex');
  if (key === 'codex-config-dir') return codexConfig;
  return pathApi.join(codexConfig, key === 'codex-skills-dir' ? 'skills' : 'generated_images');
}

export function listPlatformPathCandidates(
  key: PlatformPathKey,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): PlatformPathCandidate[] {
  if (key !== 'codex-binary')
    return [{ path: resolvePlatformPath(key, env, platform), source: 'resolved path' }];
  return platform === 'win32'
    ? windowsCodexBinaryCandidates(env)
    : unixCodexBinaryCandidates(env, platform);
}
