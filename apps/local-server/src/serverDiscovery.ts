import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A running Studio names its API port here, in the Studio data folder, because the server moves to
 * the next free port when the configured one is taken. Clients outside Studio read it.
 */
export const STUDIO_SERVER_DISCOVERY_FILE = 'server.json';

export interface StudioServerDiscovery {
  port: number;
  pid: number;
  startedAt: string;
  version: string;
}

const discoveryFile = (dataRoot: string) => path.join(dataRoot, STUDIO_SERVER_DISCOVERY_FILE);

function parseDiscovery(file: string): StudioServerDiscovery | null {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<StudioServerDiscovery>;
    return Number.isInteger(value.port) && Number.isInteger(value.pid)
      ? (value as StudioServerDiscovery)
      : null;
  } catch {
    return null;
  }
}

export function writeStudioServerDiscovery(dataRoot: string, discovery: StudioServerDiscovery) {
  mkdirSync(dataRoot, { recursive: true });
  const file = discoveryFile(dataRoot);
  const temporary = `${file}.${discovery.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(discovery, null, 2)}\n`);
  renameSync(temporary, file);
}

/** Removes the file only while it names this process, so a second Studio keeps its entry. */
export function removeStudioServerDiscovery(dataRoot: string, pid = process.pid) {
  const file = discoveryFile(dataRoot);
  if (parseDiscovery(file)?.pid === pid) rmSync(file, { force: true });
}

/** The running Studio's entry, or null when there is none or its process has ended. */
export function readStudioServerDiscovery(dataRoot: string): StudioServerDiscovery | null {
  const discovery = parseDiscovery(discoveryFile(dataRoot));
  if (!discovery) return null;
  try {
    process.kill(discovery.pid, 0);
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') return null;
  }
  return discovery;
}
