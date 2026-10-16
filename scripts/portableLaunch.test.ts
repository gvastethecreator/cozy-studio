import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ONBOARDING_BUN_INSTALL_URL,
  ONBOARDING_CODEX_INSTALL_URL,
  PORTABLE_STUDIO_LIBRARY_FOLDER_NAME,
} from '../packages/shared/src';
import {
  missingBunMessage,
  missingCodexCliMessage,
  parseListeningUrl,
  PORTABLE_LOGIN_DISCLAIMER,
  portableServerArgv,
  portableStudioUrl,
  resolvePortableLibraryDir,
} from './portableLaunch';
import { runPortableStart } from './portable-start';
import { buildPortable } from './build-portable';

const repoRoot = path.resolve(import.meta.dirname, '..');
const windowsLauncher = path.join(repoRoot, 'scripts', 'Cozy Studio.bat');
const macLauncher = path.join(repoRoot, 'scripts', 'Cozy Studio.command');
const unixLauncher = path.join(repoRoot, 'scripts', 'portable-launch.sh');
const portableNote = path.join(repoRoot, 'PORTABLE.txt');

describe('portable launchers', () => {
  it('rejects an unsupported build target before downloading or creating an artifact', async () => {
    await expect(buildPortable('../foreign-target')).rejects.toThrow('Unknown portable target');
  });
  it('uses Codex Studio Library beside the unpack root when portable and env is unset', () => {
    expect(
      resolvePortableLibraryDir({
        studioLibraryDir: undefined,
        portable: true,
        unpackRoot: 'D:/unzipped/cozy-studio',
        homeDefault: 'C:/Users/a/Codex Studio',
      }),
    ).toBe(path.join('D:/unzipped/cozy-studio', PORTABLE_STUDIO_LIBRARY_FOLDER_NAME));
    expect(
      resolvePortableLibraryDir({
        studioLibraryDir: 'E:/custom-library',
        portable: true,
        unpackRoot: 'D:/unzipped/cozy-studio',
        homeDefault: 'C:/Users/a/Codex Studio',
      }),
    ).toBe('E:/custom-library');
    expect(
      resolvePortableLibraryDir({
        studioLibraryDir: undefined,
        portable: false,
        unpackRoot: 'D:/unzipped/cozy-studio',
        homeDefault: 'C:/Users/a/Codex Studio',
      }),
    ).toBe('C:/Users/a/Codex Studio');
  });

  it('starts local-server in production mode and opens the browser', async () => {
    let opened = '';
    const env: NodeJS.ProcessEnv = { STUDIO_PORTABLE: '1' };
    const started = await runPortableStart({
      env,
      cwd: 'D:/unzipped/cozy-studio',
      distReady: () => true,
      waitMs: async () => undefined,
      forwardOutput: () => undefined,
      openBrowser: (url) => {
        opened = url;
      },
      spawnServer: (_argv, options) => {
        expect(_argv).toEqual(portableServerArgv());
        expect(options.env.STUDIO_LIBRARY_DIR).toBe(
          path.join('D:/unzipped/cozy-studio', PORTABLE_STUDIO_LIBRARY_FOLDER_NAME),
        );
        return {
          stdout: {
            on(_event: string, callback: (chunk: string) => void) {
              callback('Codex Studio local-server listening on http://127.0.0.1:17229\n');
            },
          },
          stderr: { on() {} },
          exitCode: null,
          once() {},
        } as never;
      },
    });

    expect(started.url).toBe('http://127.0.0.1:17229');
    expect(opened).toBe('http://127.0.0.1:17229');
    expect(parseListeningUrl('ready on http://127.0.0.1:17223 today')).toBe(
      portableStudioUrl(17223),
    );
  });

  it('refuses to start when the production UI dist is missing', async () => {
    await expect(
      runPortableStart({
        env: { STUDIO_PORTABLE: '1' },
        cwd: 'D:/unzipped/cozy-studio',
        distReady: () => false,
        spawnServer: () => {
          throw new Error('should not spawn');
        },
      }),
    ).rejects.toThrow(/bun run build/);
  });

  it('keeps missing-runtime copy and the ChatGPT login disclaimer in both launchers', () => {
    const bat = readFileSync(windowsLauncher, 'utf8');
    const command = readFileSync(unixLauncher, 'utf8');
    expect(readFileSync(macLauncher, 'utf8')).toContain('portable-launch.sh');
    const note = readFileSync(portableNote, 'utf8');
    for (const source of [bat, command]) {
      expect(source).toContain(ONBOARDING_BUN_INSTALL_URL);
      expect(source).not.toContain(ONBOARDING_CODEX_INSTALL_URL);
      expect(source).not.toMatch(/needs Codex CLI/i);
      expect(source).toContain('does not bundle ChatGPT login');
      expect(source).toContain('STUDIO_PORTABLE=1');
      expect(source).toContain('scripts/portable-start.ts');
      expect(source).toMatch(/STUDIO_PORTABLE_NONINTERACTIVE/);
      expect(source).not.toMatch(/electron/i);
    }
    expect(note).toMatch(/Linux/i);
    expect(note).toContain('scripts/Cozy Studio.command');
    expect(note).toContain('does not bundle ChatGPT login');
    expect(missingBunMessage()).toContain(ONBOARDING_BUN_INSTALL_URL);
    expect(missingCodexCliMessage()).toContain(ONBOARDING_CODEX_INSTALL_URL);
    expect(PORTABLE_LOGIN_DISCLAIMER).toMatch(/does not bundle ChatGPT login/);
    expect(PORTABLE_LOGIN_DISCLAIMER).not.toMatch(/codex login/i);
  });

  it('does not open a browser when the server never reports a listening URL', async () => {
    let opened = false;
    let clock = 0;
    const kill = () => undefined;
    await expect(
      runPortableStart({
        env: { STUDIO_PORTABLE: '1' },
        cwd: 'D:/unzipped/cozy-studio',
        distReady: () => true,
        now: () => clock,
        listenDeadlineMs: 30_000,
        waitMs: async () => {
          clock += 30_000;
        },
        openBrowser: () => {
          opened = true;
        },
        spawnServer: () =>
          ({
            stdout: { on() {} },
            stderr: { on() {} },
            exitCode: null,
            kill,
            once() {},
          }) as never,
      }),
    ).rejects.toThrow(/listening URL/);
    expect(opened).toBe(false);
  });

  it('resolves the UI beside the launcher even when invoked from another working directory', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(path.parse(repoRoot).root);
    try {
      await expect(
        runPortableStart({
          env: { STUDIO_PORTABLE: '1' },
          distReady: (dir) => {
            expect(dir).toBe(path.join(repoRoot, 'dist'));
            return false;
          },
        }),
      ).rejects.toThrow('Build the UI first');
    } finally {
      cwd.mockRestore();
    }
  });

  it('preserves bootstrap Library paths when launched outside the app directory', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cozy-portable-config-'));
    const library = path.join(root, 'Existing Library');
    writeFileSync(path.join(root, '.env.local'), `STUDIO_LIBRARY_DIR=${library}\n`);
    vi.stubEnv('STUDIO_LIBRARY_DIR', undefined);
    vi.stubEnv('STUDIO_PORTABLE', '1');
    try {
      const started = await runPortableStart({
        cwd: root,
        distReady: () => true,
        forwardOutput: () => undefined,
        openBrowser: () => undefined,
        spawnServer: (_argv, options) => {
          expect(options.env.STUDIO_LIBRARY_DIR).toBe(library);
          return {
            once() {},
            stdout: {
              on: (_event: string, receive: (chunk: string) => void) =>
                receive('http://127.0.0.1:17229'),
            },
            stderr: { on() {} },
            exitCode: null,
          } as never;
        },
      });
      expect(started.libraryDir).toBe(library);
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a server spawn error without waiting for the listening deadline', async () => {
    const error = Object.assign(new Error('Bun executable unavailable'), { code: 'ENOENT' });
    const waitMs = vi.fn();
    await expect(
      runPortableStart({
        env: { STUDIO_PORTABLE: '1' },
        distReady: () => true,
        waitMs,
        spawnServer: () =>
          ({
            once: (_event: string, callback: (error: Error) => void) => callback(error),
            stdout: { on() {} },
            stderr: { on() {} },
            exitCode: null,
          }) as never,
      }),
    ).rejects.toThrow(error);
    expect(waitMs).not.toHaveBeenCalled();
  });
});

describe('Unix portable launchers', () => {
  it('starts from another directory using bundled Bun for the macOS launcher', () => {
    const bash =
      process.platform === 'win32'
        ? path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
        : '/bin/bash';
    const root = mkdtempSync(path.join(tmpdir(), 'cozy unix portable '));
    try {
      mkdirSync(path.join(root, 'runtime'));
      mkdirSync(path.join(root, 'scripts'));
      const bundledBun = path.join(root, 'runtime', 'bun');
      writeFileSync(
        bundledBun,
        '#!/bin/bash\nprintf "PROBE|%s|%s|%s|%s\\n" "$STUDIO_PORTABLE" "$PWD" "$(command -v bun)" "$*"\n',
      );
      for (const source of [unixLauncher, macLauncher]) {
        writeFileSync(
          path.join(root, 'scripts', path.basename(source)),
          readFileSync(source, 'utf8').replaceAll('\r\n', '\n'),
        );
      }
      for (const launcherName of ['Cozy Studio.command']) {
        const result = spawnSync(
          bash,
          [
            '--noprofile',
            '--norc',
            '-c',
            'chmod +x "$1"; exec /bin/bash "$2"',
            'portable-test',
            bundledBun,
            path.join(root, 'scripts', launcherName),
          ],
          {
            cwd: tmpdir(),
            encoding: 'utf8',
            timeout: 20_000,
            env: { ...process.env, PATH: '/usr/bin:/bin', STUDIO_PORTABLE_NONINTERACTIVE: '1' },
          },
        );
        expect(result.status, result.stderr).toBe(0);
        const probe = result.stdout
          .split('\n')
          .find((line) => line.startsWith('PROBE|'))!
          .split('|');
        expect(probe[1]).toBe('1');
        expect(probe[2]).toContain(path.basename(root));
        expect(probe[3]).toBe(`${probe[2]}/runtime/bun`);
        expect(probe[4]).toBe('run scripts/portable-start.ts');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Windows portable dry-run', () => {
  it('prefers bundled Bun and passes its PATH to child commands, including without global Bun', () => {
    if (process.platform !== 'win32') return;
    const root = mkdtempSync(path.join(tmpdir(), 'cozy portable runtime '));
    try {
      const runtimeDir = path.join(root, 'runtime');
      const scriptDir = path.join(root, 'scripts');
      mkdirSync(runtimeDir);
      mkdirSync(scriptDir);
      const discovery = spawnSync('bun', ['--print', 'process.execPath'], { encoding: 'utf8' });
      expect(discovery.status).toBe(0);
      const bundledBun = path.join(runtimeDir, 'bun.exe');
      copyFileSync(discovery.stdout.trim(), bundledBun);
      const launcher = path.join(scriptDir, 'Cozy Studio.bat');
      copyFileSync(windowsLauncher, launcher);
      writeFileSync(
        path.join(scriptDir, 'portable-start.ts'),
        [
          'const child = Bun.spawnSync(["bun", "--print", "process.execPath"]);',
          'console.log(JSON.stringify({',
          'runtime: process.execPath, cwd: process.cwd(),',
          'childRuntime: child.stdout.toString().trim(), portable: process.env.STUDIO_PORTABLE',
          '}));',
        ].join('\n'),
      );
      for (const initialPath of [process.env.PATH, 'C:\\Windows\\System32']) {
        const result = spawnSync('cmd.exe', ['/c', `"${launcher}"`], {
          cwd: tmpdir(),
          encoding: 'utf8',
          timeout: 20_000,
          windowsVerbatimArguments: true,
          env: { ...process.env, PATH: initialPath, STUDIO_PORTABLE_NONINTERACTIVE: '1' },
        });
        expect(result.status, result.stderr).toBe(0);
        const output = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
        expect(output.runtime.toLowerCase()).toBe(bundledBun.toLowerCase());
        expect(output.cwd).toBe(root);
        expect(output.childRuntime.toLowerCase()).toBe(bundledBun.toLowerCase());
        expect(output.portable).toBe('1');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prints a readable Bun message and pauses when bun is missing from PATH', () => {
    if (process.platform !== 'win32') return;
    const result = spawnSync('cmd.exe', ['/c', `"${windowsLauncher}"`], {
      cwd: repoRoot,
      encoding: 'utf8',
      input: '\n',
      timeout: 20_000,
      windowsVerbatimArguments: true,
      env: {
        ...process.env,
        PATH: 'C:\\Windows\\System32',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        STUDIO_PORTABLE_NONINTERACTIVE: '1',
      },
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    expect(result.status).not.toBe(0);
    expect(output).toMatch(/needs Bun/i);
    expect(output).toContain(ONBOARDING_BUN_INSTALL_URL);
    expect(output).toMatch(/does not bundle ChatGPT login/i);
  });
});
