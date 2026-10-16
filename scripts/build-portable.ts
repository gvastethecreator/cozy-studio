import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import { uiDistIsReady } from '../apps/local-server/src/uiStaticRoutes';

const repoRoot = path.resolve(import.meta.dirname, '..');

export const PORTABLE_TARGETS = {
  'windows-x64': {
    platform: 'win32',
    arch: 'x64',
    asset: 'bun-windows-x64',
    launcher: 'Cozy Studio.bat',
    requirements: 'Windows 10 version 1809 or newer, x64 with SSE4.2',
  },
  'windows-arm64': {
    platform: 'win32',
    arch: 'arm64',
    asset: 'bun-windows-aarch64',
    launcher: 'Cozy Studio.bat',
    requirements: 'Windows on ARM64',
  },
  'linux-x64': {
    platform: 'linux',
    arch: 'x64',
    asset: 'bun-linux-x64',
    launcher: 'Cozy Studio.sh',
    requirements: 'Linux with glibc 2.28 or newer, x64 with SSE4.2, Bash and a browser',
  },
  'linux-arm64': {
    platform: 'linux',
    arch: 'arm64',
    asset: 'bun-linux-aarch64',
    launcher: 'Cozy Studio.sh',
    requirements: 'Linux with glibc 2.28 or newer, ARM64, Bash and a browser',
  },
  'macos-x64': {
    platform: 'darwin',
    arch: 'x64',
    asset: 'bun-darwin-x64',
    launcher: 'Cozy Studio.command',
    requirements: 'macOS 13 or newer, Intel x64',
  },
  'macos-arm64': {
    platform: 'darwin',
    arch: 'arm64',
    asset: 'bun-darwin-aarch64',
    launcher: 'Cozy Studio.command',
    requirements: 'macOS 13 or newer, Apple Silicon ARM64',
  },
} as const;

function run(command: string, args: string[], cwd: string, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

async function download(url: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Cozy-Studio-portable-builder' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return response;
}

async function* fileChunks(file: string) {
  yield* createReadStream(file);
}

export async function buildPortable(targetName: string) {
  if (!Object.hasOwn(PORTABLE_TARGETS, targetName)) {
    throw new Error(
      `Unknown portable target. Choose: ${Object.keys(PORTABLE_TARGETS).join(', ')}.`,
    );
  }
  const target = PORTABLE_TARGETS[targetName as keyof typeof PORTABLE_TARGETS];
  if (!uiDistIsReady(path.join(repoRoot, 'dist'))) {
    throw new Error('Build the UI first with bun run build.');
  }
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const version = /^bun@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager)?.[1];
  if (!version) throw new Error('packageManager must pin an exact Bun release.');
  if (process.versions.bun !== version) throw new Error(`Build with the pinned Bun ${version}.`);

  const outputRoot = path.join(repoRoot, '.scratch', 'portable');
  mkdirSync(outputRoot, { recursive: true });
  const buildRoot = mkdtempSync(path.join(outputRoot, `${targetName}-`));
  const appRoot = path.join(buildRoot, 'Cozy Studio');
  const runtimeRoot = path.join(appRoot, 'runtime');
  mkdirSync(runtimeRoot, { recursive: true });

  const release = (await (
    await download(`https://api.github.com/repos/oven-sh/bun/releases/tags/bun-v${version}`)
  ).json()) as {
    assets: { name: string; browser_download_url: string; digest: string | null }[];
  };
  const asset = release.assets.find(({ name }) => name === `${target.asset}.zip`);
  if (!asset?.digest || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    throw new Error(
      `The official Bun release must publish a SHA-256 digest for ${target.asset}.zip.`,
    );
  }
  const binaryArchive = Buffer.from(
    await (await download(asset.browser_download_url)).arrayBuffer(),
  );
  const archiveHash = createHash('sha256').update(binaryArchive).digest('hex');
  if (`sha256:${archiveHash}` !== asset.digest)
    throw new Error('The Bun release ZIP failed its SHA-256 check.');
  const bunArchive = await JSZip.loadAsync(binaryArchive);
  const runtimeName = target.platform === 'win32' ? 'bun.exe' : 'bun';
  const bunEntry = bunArchive.file(`${target.asset}/${runtimeName}`);
  if (!bunEntry)
    throw new Error(`The official Bun ZIP does not contain ${target.asset}/${runtimeName}.`);
  const bunPath = path.join(runtimeRoot, runtimeName);
  writeFileSync(bunPath, await bunEntry.async('nodebuffer'));
  if (target.platform !== 'win32') chmodSync(bunPath, 0o755);
  if (
    process.platform === target.platform &&
    process.arch === target.arch &&
    run(bunPath, ['--version'], appRoot).trim() !== version
  ) {
    throw new Error('The bundled Bun version does not match packageManager.');
  }
  const sourceUrl = `https://github.com/oven-sh/bun/tree/bun-v${version}`;
  writeFileSync(
    path.join(runtimeRoot, 'BUN-LICENSE.md'),
    await (
      await download(`https://raw.githubusercontent.com/oven-sh/bun/bun-v${version}/LICENSE.md`)
    ).text(),
  );
  writeFileSync(
    path.join(runtimeRoot, 'BUN-SOURCE.txt'),
    [
      `Bun ${version}, official unmodified ${targetName} release.`,
      `Source and build instructions: ${sourceUrl}`,
      `Release archive: ${asset.browser_download_url}`,
      `Release archive SHA-256: ${archiveHash}`,
      'See BUN-LICENSE.md for Bun, JavaScriptCore and linked-library notices and relinking instructions.',
      '',
    ].join('\n'),
  );

  const files = new Set([
    ...run('git', ['ls-files', '--cached', '-z'], repoRoot).split('\0').filter(Boolean),
    'scripts/build-portable.ts',
    'scripts/portable-launch.sh',
    'scripts/Cozy Studio.sh',
  ]);
  const launchers = [
    'scripts/Cozy Studio.bat',
    'scripts/Cozy Studio.command',
    'scripts/Cozy Studio.sh',
  ];
  for (const file of files) {
    if (
      /^(?:landing\/|\.github\/|docs\/codemap\/)/.test(file) ||
      (/^\.env(?:\.|$)/.test(file) && file !== '.env.example') ||
      /\.test\.[cm]?[jt]sx?$/.test(file) ||
      (launchers.includes(file) && file !== `scripts/${target.launcher}`) ||
      (target.platform === 'win32' && file === 'scripts/portable-launch.sh')
    )
      continue;
    const destination = path.join(appRoot, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(repoRoot, file), destination);
    if (file.endsWith('.sh') || file.endsWith('.command') || file.endsWith('.bat')) {
      const text = readFileSync(destination, 'utf8').replaceAll('\r\n', '\n');
      writeFileSync(destination, file.endsWith('.bat') ? text.replaceAll('\n', '\r\n') : text);
    }
  }
  cpSync(path.join(repoRoot, 'dist'), path.join(appRoot, 'dist'), { recursive: true });
  console.log(`[portable] Installing ${targetName} production dependencies with Bun ${version}.`);
  run(
    process.execPath,
    [
      'install',
      '--frozen-lockfile',
      '--production',
      '--ignore-scripts',
      `--os=${target.platform}`,
      `--cpu=${target.arch}`,
    ],
    appRoot,
    {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  );
  const sharpPlatform = `${target.platform}-${target.arch}`;
  const sharpPackage = path.join(appRoot, 'node_modules', '@img', `sharp-${sharpPlatform}`);
  const sharpMetadata = JSON.parse(readFileSync(path.join(sharpPackage, 'package.json'), 'utf8'));
  if (
    !sharpMetadata.os.includes(target.platform) ||
    !sharpMetadata.cpu.includes(target.arch) ||
    !readdirSync(path.join(sharpPackage, 'lib')).some((name) => name.endsWith('.node'))
  ) {
    throw new Error(`Required prebuilt Sharp runtime is missing for ${targetName}.`);
  }
  writeFileSync(
    path.join(appRoot, 'portable.json'),
    JSON.stringify(
      {
        target: targetName,
        platform: target.platform,
        arch: target.arch,
        libc: target.platform === 'linux' ? 'glibc' : undefined,
        runtime: `runtime/${runtimeName}`,
        bunVersion: version,
        launcher: `scripts/${target.launcher}`,
        requirements: target.requirements,
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(
    path.join(appRoot, 'PORTABLE.txt'),
    [
      `Cozy Studio portable: ${targetName}`,
      target.requirements,
      `Start: scripts/${target.launcher}`,
      target.platform === 'win32'
        ? 'Open the launcher after extracting the complete ZIP.'
        : `If executable permissions were not preserved: chmod +x "scripts/${target.launcher}" scripts/portable-launch.sh runtime/bun`,
      `Includes Bun ${version}, production dependencies and the built UI. No global Bun or Codex install is needed to open Studio.`,
      'ChatGPT login and other provider accounts remain user-owned. Sign in from Studio.',
      'The default portable Library stays inside this folder. An explicit STUDIO_LIBRARY_DIR is preserved.',
      'See runtime/BUN-LICENSE.md, runtime/BUN-SOURCE.txt and LICENSE for notices.',
      '',
    ].join('\n'),
  );

  const archive = new JSZip();
  function addDirectory(directory: string, prefix: string) {
    for (const name of readdirSync(directory)) {
      if (prefix === 'Cozy Studio/node_modules' && name === '.bin') continue;
      if (
        target.platform === 'linux' &&
        prefix === 'Cozy Studio/node_modules/@img' &&
        name.includes('linuxmusl')
      )
        continue;
      const file = path.join(directory, name);
      const entry = `${prefix}/${name}`;
      if (statSync(file).isDirectory()) addDirectory(file, entry);
      else
        archive.file(entry, Readable.from(fileChunks(file)), {
          unixPermissions:
            entry === `Cozy Studio/runtime/${runtimeName}` || /\.(?:sh|command)$/.test(entry)
              ? 0o100755
              : 0o100644,
        });
    }
  }
  addDirectory(appRoot, 'Cozy Studio');
  const zipPath = path.join(buildRoot, `Cozy-Studio-${targetName}.zip`);
  console.log('[portable] Writing ZIP with the UI, source, dependencies, Bun and license notices.');
  await pipeline(
    archive.generateNodeStream({
      streamFiles: true,
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      platform: target.platform === 'win32' ? 'DOS' : 'UNIX',
    }),
    createWriteStream(zipPath),
  );
  const checksum = createHash('sha256');
  for await (const chunk of createReadStream(zipPath)) checksum.update(chunk);
  writeFileSync(`${zipPath}.sha256`, `${checksum.digest('hex')}  ${path.basename(zipPath)}\n`);
  console.log(`[portable] Ready: ${zipPath}`);
  return zipPath;
}

if (import.meta.main) {
  const hostPlatform =
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'macos'
        : process.platform;
  const targetName = process.argv[2] ?? `${hostPlatform}-${process.arch}`;
  buildPortable(targetName).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
