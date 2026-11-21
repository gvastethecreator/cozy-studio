import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  STUDIO_SERVER_DISCOVERY_FILE,
  readStudioServerDiscovery,
  removeStudioServerDiscovery,
  writeStudioServerDiscovery,
} from './serverDiscovery';

describe('server discovery file', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('names the bound port while this process runs and only this process removes it', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'studio-discovery-'));
    roots.push(root);
    const entry = {
      port: 17224,
      pid: process.pid,
      startedAt: '2026-11-20T12:00:00.000Z',
      version: '0.2.0',
    };
    writeStudioServerDiscovery(root, entry);
    expect(JSON.parse(readFileSync(path.join(root, STUDIO_SERVER_DISCOVERY_FILE), 'utf8'))).toEqual(
      entry,
    );
    expect(readStudioServerDiscovery(root)).toEqual(entry);

    removeStudioServerDiscovery(root, process.pid + 1);
    expect(readStudioServerDiscovery(root)).toEqual(entry);
    removeStudioServerDiscovery(root);
    expect(readStudioServerDiscovery(root)).toBeNull();

    // A file left by a process that ended does not count.
    writeStudioServerDiscovery(root, { ...entry, pid: 2 ** 22 + 1 });
    expect(readStudioServerDiscovery(root)).toBeNull();
  });
});
