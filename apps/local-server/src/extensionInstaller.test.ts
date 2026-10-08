import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installExtensionArchive } from './extensionInstaller';

const fault = vi.hoisted(() => ({ swap: false, stageCleanup: false, previousCleanup: false }));
vi.mock('node:fs/promises', async (original) => {
  const fs = (await original()) as typeof import('node:fs/promises');
  const { existsSync: exists } = await import('node:fs');
  return {
    ...fs,
    rename: async (from: string, to: string) => {
      if (fault.swap && from.includes('.stage-')) throw new Error('swap denied');
      return fs.rename(from, to);
    },
    rm: async (target: string, options: Parameters<typeof fs.rm>[1]) => {
      if (fault.stageCleanup && target.includes('.stage-') && exists(target))
        throw new Error('staging cleanup denied');
      if (fault.previousCleanup && target.includes('.previous-') && exists(target))
        throw new Error('previous cleanup denied');
      return fs.rm(target, options);
    },
  };
});

const manifest = (version: string) => ({
  schemaVersion: 1,
  id: 'cozy.pack-14',
  kind: 'style-pack',
  version,
  studio: '>=0.1.0',
  title: 'Mythic Noir',
  files: {
    pack: 'pack.json',
    runtime: 'runtime.json',
    search: 'search.json',
    thumbnails: 'thumbnails.json',
  },
  stylePack: { id: 'pack_14', name: 'Mythic Noir', description: 'Myths.', presetCount: 197 },
  assets: [],
});

async function release(version: string, extra?: (zip: JSZip) => void) {
  const zip = new JSZip();
  zip.file('extension.json', JSON.stringify(manifest(version)));
  zip.file('pack.json', JSON.stringify({ version }));
  extra?.(zip);
  const archive = await zip.generateAsync({ type: 'uint8array' });
  const entry = {
    id: 'cozy.pack-14',
    version,
    title: 'Mythic Noir',
    tag: `cozy.pack-14-v${version}`,
    archive: `cozy.pack-14-${version}.zip`,
    sha256: createHash('sha256').update(archive).digest('hex'),
    bytes: archive.byteLength,
  };
  return { archive, entry };
}

let installDir = '';
afterEach(() => {
  Object.assign(fault, { swap: false, stageCleanup: false, previousCleanup: false });
  vi.restoreAllMocks();
  return rm(installDir, { recursive: true, force: true });
});

describe('installExtensionArchive', () => {
  it('installs a verified release and replaces the previous version', async () => {
    installDir = await mkdtemp(path.join(tmpdir(), 'cozy-install-'));
    await installExtensionArchive({ ...(await release('1.0.0')), installDir });
    await installExtensionArchive({ ...(await release('1.1.0')), installDir });
    const pack = await readFile(path.join(installDir, 'cozy.pack-14', 'pack.json'), 'utf8');
    expect(JSON.parse(pack)).toEqual({ version: '1.1.0' });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fault.previousCleanup = true;
    await installExtensionArchive({ ...(await release('1.2.0')), installDir });
    expect(warning).toHaveBeenCalledWith(
      '[extensions:install] Previous folder cleanup failed',
      expect.any(Error),
    );
    fault.previousCleanup = false;
    await installExtensionArchive({ ...(await release('1.3.0')), installDir });
    expect(
      JSON.parse(await readFile(path.join(installDir, 'cozy.pack-14', 'pack.json'), 'utf8')),
    ).toEqual({ version: '1.3.0' });
  });

  it('serializes concurrent replacements and continues after a failed install', async () => {
    installDir = await mkdtemp(path.join(tmpdir(), 'cozy-install-'));
    await installExtensionArchive({ ...(await release('1.0.0')), installDir });
    const releases = await Promise.all([
      release('1.1.0'),
      release('1.2.0', (zip) => zip.file('../outside.txt', 'x')),
      release('1.3.0'),
    ]);
    const results = await Promise.allSettled(
      releases.map((item) => installExtensionArchive({ ...item, installDir })),
    );
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(results[1]).toMatchObject({ reason: { message: expect.stringContaining('escapes') } });

    const root = path.join(installDir, 'cozy.pack-14');
    const installed = JSON.parse(await readFile(path.join(root, 'extension.json'), 'utf8'));
    expect(['1.1.0', '1.3.0']).toContain(installed.version);
    expect(JSON.parse(await readFile(path.join(root, 'pack.json'), 'utf8'))).toEqual({
      version: installed.version,
    });
    expect(existsSync(path.join(installDir, 'outside.txt'))).toBe(false);

    await installExtensionArchive({ ...(await release('1.4.0')), installDir });
    expect(JSON.parse(await readFile(path.join(root, 'pack.json'), 'utf8'))).toEqual({
      version: '1.4.0',
    });
  });

  it('keeps the installed version when a release is tampered with or escapes its folder', async () => {
    installDir = await mkdtemp(path.join(tmpdir(), 'cozy-install-'));
    await installExtensionArchive({ ...(await release('1.0.0')), installDir });

    const tampered = await release('1.1.0');
    await expect(
      installExtensionArchive({
        ...tampered,
        entry: { ...tampered.entry, sha256: '0'.repeat(64) },
        installDir,
      }),
    ).rejects.toThrow('sha256 mismatch');

    const escaping = await release('1.2.0', (zip) => zip.file('../outside.txt', 'x'));
    await expect(installExtensionArchive({ ...escaping, installDir })).rejects.toThrow('escapes');
    await expect(
      installExtensionArchive({
        ...(await release('1.3.0')),
        installDir,
        validateInstalled: async () => {
          throw new Error('post-swap validation failed');
        },
      }),
    ).rejects.toThrow('post-swap validation failed');
    Object.assign(fault, { swap: true, stageCleanup: true });
    await expect(
      installExtensionArchive({ ...(await release('1.4.0')), installDir }),
    ).rejects.toThrow('staging cleanup denied');
    Object.assign(fault, { swap: false, stageCleanup: false });

    const pack = await readFile(path.join(installDir, 'cozy.pack-14', 'pack.json'), 'utf8');
    expect(JSON.parse(pack)).toEqual({ version: '1.0.0' });
    expect(existsSync(path.join(installDir, 'outside.txt'))).toBe(false);
  });
});
