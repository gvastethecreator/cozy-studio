import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveLibraryPathFromRoot } from './library';

/** Run folder helpers shared by the Sprite Atlas and Animation Sequence workflows. */

export function safeSegment(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

export async function fileExists(filePath: string | null | undefined) {
  if (!filePath) return false;
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Writes a temp file and renames it, so a reader never sees a partial JSON file. */
export async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/** Reads a run record from `state/<workflow>/<runId>`, then from the legacy `outputs` folder. */
export async function readRunRecord<T>(
  libraryDir: string,
  workflow: string,
  runId: string,
  fileName: string,
) {
  return (
    (await readJson<T>(
      resolveLibraryPathFromRoot(libraryDir, 'state', workflow, runId, fileName),
    )) ?? readJson<T>(resolveLibraryPathFromRoot(libraryDir, 'outputs', workflow, runId, fileName))
  );
}

/** Every stored run of a workflow, newest first. */
export async function listRunRecords<T extends { updatedAt: string }>(
  libraryDir: string,
  workflow: string,
  getRun: (runId: string) => Promise<T | null>,
) {
  const groups = await Promise.all(
    ['state', 'outputs'].map((section) =>
      readdir(resolveLibraryPathFromRoot(libraryDir, section, workflow), {
        withFileTypes: true,
      }).catch(() => []),
    ),
  );
  const ids = new Set(
    groups.flatMap((entries) =>
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    ),
  );
  const runs = await Promise.all([...ids].map((runId) => getRun(runId)));
  return runs
    .flatMap((run) => (run ? [run] : []))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Returns a lock that serializes every read-modify-write of one run record. */
export function createRunLock() {
  const locks = new Map<string, Promise<unknown>>();
  return function withRunLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const key = safeSegment(runId);
    const result = (locks.get(key) ?? Promise.resolve()).then(work);
    const tail = result.catch(() => undefined);
    locks.set(key, tail);
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return result;
  };
}
