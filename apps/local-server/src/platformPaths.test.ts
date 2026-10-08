import { describe, expect, it } from 'vitest';
import { listPlatformPathCandidates, resolvePlatformPath } from './platformPaths';

describe('platformPaths', () => {
  it.each(['darwin', 'linux'] as const)(
    'uses explicit CLI and Codex home paths on %s',
    (platform) => {
      const env = {
        HOME: '/home/Studio User',
        CODEX_HOME: '/data/Codex Profile',
        STUDIO_CODEX_CLI_PATH: '/opt/Codex App/bin/codex',
      };
      expect(listPlatformPathCandidates('codex-binary', env, platform)[0]).toEqual({
        path: env.STUDIO_CODEX_CLI_PATH,
        source: 'STUDIO_CODEX_CLI_PATH',
      });
      expect(listPlatformPathCandidates('codex-binary', env, platform)).toContainEqual({
        path: '/home/Studio User/.bun/bin/codex',
        source: 'Bun global executable shim',
      });
      expect(resolvePlatformPath('codex-skills-dir', env, platform)).toBe(
        '/data/Codex Profile/skills',
      );
      expect(resolvePlatformPath('codex-generated-images', env, platform)).toBe(
        '/data/Codex Profile/generated_images',
      );
      expect(() =>
        resolvePlatformPath('codex-config-dir', { ...env, CODEX_HOME: 'relative' }, platform),
      ).toThrow('CODEX_HOME must be an absolute path');
    },
  );

  it('uses Windows path semantics for redirected Codex homes and rejects drive-relative roots', () => {
    expect(
      resolvePlatformPath('codex-skills-dir', { CODEX_HOME: 'D:\\Studio Profile' }, 'win32'),
    ).toBe('D:\\Studio Profile\\skills');
    expect(() =>
      resolvePlatformPath('codex-config-dir', { CODEX_HOME: '\\Studio' }, 'win32'),
    ).toThrow('CODEX_HOME must be an absolute path');
    expect(
      resolvePlatformPath(
        'codex-config-dir',
        { USERPROFILE: 'D:\\Users\\Studio', CODEX_HOME: ' ' },
        'win32',
      ),
    ).toBe('D:\\Users\\Studio\\.codex');
  });

  it('prefers the OpenAI Codex desktop binary before npm shims on Windows', () => {
    if (process.platform !== 'win32') {
      expect(listPlatformPathCandidates('codex-binary').length).toBeGreaterThan(0);
      return;
    }

    const candidates = listPlatformPathCandidates('codex-binary');
    const openAiIndex = candidates.findIndex((candidate) =>
      candidate.path.includes('Programs\\OpenAI\\Codex\\bin\\codex.exe'),
    );
    const currentDesktopRuntimeIndex = candidates.findIndex(
      (candidate) =>
        candidate.source === 'OpenAI desktop runtime' &&
        candidate.path.includes('AppData\\Local\\OpenAI\\Codex\\bin\\'),
    );
    const npmShimIndex = candidates.findIndex((candidate) =>
      candidate.path.includes('AppData\\Roaming\\npm\\codex.cmd'),
    );

    expect(openAiIndex).toBeGreaterThanOrEqual(0);
    expect(npmShimIndex).toBeGreaterThanOrEqual(0);
    expect(openAiIndex).toBeLessThan(npmShimIndex);
    if (currentDesktopRuntimeIndex >= 0) {
      expect(currentDesktopRuntimeIndex).toBeLessThan(openAiIndex);
    }
  });

  it('prefers stable launchers before npm package internals on Windows', () => {
    if (process.platform !== 'win32') return;

    const candidates = listPlatformPathCandidates('codex-binary');
    const stableLauncherIndexes = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) =>
        ['npm command shim', 'Bun global executable shim', 'PATH executable'].includes(
          candidate.source,
        ),
      )
      .map(({ index }) => index);
    const vendorIndexes = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.source.includes('vendor binary'))
      .map(({ index }) => index);

    expect(stableLauncherIndexes.length).toBeGreaterThan(0);
    expect(vendorIndexes.length).toBeGreaterThan(0);
    expect(Math.max(...stableLauncherIndexes)).toBeLessThan(Math.min(...vendorIndexes));
  });
});
