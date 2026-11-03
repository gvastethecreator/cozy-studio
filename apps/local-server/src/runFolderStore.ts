import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveLibraryPathFromRoot } from './library';
import { isPathInside } from './pathContainment';

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

function storedPathApi(value: string) {
  return /^[a-z]:[\\/]|^\\\\|^\/\/[^/]/i.test(value) ? path.win32 : path.posix;
}

/** Rebase owned paths only; output folders outside the original data folder stay captured. */
function createRunPathRebaser(
  libraryDir: string,
  workflow: string,
  storedRunDir: string,
  runDir: string,
) {
  if (!isPathInside(libraryDir, runDir)) {
    throw new Error(
      `Cannot relocate ${workflow} run: its directory escapes the current data folder.`,
    );
  }
  const api = storedPathApi(storedRunDir);
  const workflowDir = api.dirname(storedRunDir);
  const sectionDir = api.dirname(workflowDir);
  const section = api.basename(sectionDir);
  const storedRoot =
    api.basename(workflowDir) !== workflow
      ? null
      : section === 'outputs'
        ? api.dirname(sectionDir)
        : section === 'state' && api.basename(api.dirname(sectionDir)) === '.studio'
          ? api.dirname(api.dirname(sectionDir))
          : null;
  if (!api.isAbsolute(storedRunDir) || !storedRoot) {
    throw new Error(`Cannot relocate ${workflow} run: the stored run directory is invalid.`);
  }

  function relativeInside(root: string, target: string) {
    if (storedPathApi(target) !== api || !api.isAbsolute(target)) return null;
    const relative = api.relative(root, target);
    if (relative === '..' || relative.startsWith(`..${api.sep}`) || api.isAbsolute(relative))
      return null;
    return relative;
  }

  return function rebasePath<T extends string | null | undefined>(value: T): T {
    if (!value) return value;
    const rootRelative = relativeInside(storedRoot, value);
    if (rootRelative === null) return value;
    const runRelative = relativeInside(storedRunDir, value);
    const destination = runRelative === null ? libraryDir : runDir;
    const relative = runRelative ?? rootRelative;
    const rebased = path.join(destination, ...relative.split(api.sep));
    if (!isPathInside(destination, rebased, { allowRoot: true })) {
      throw new Error(`Cannot relocate ${workflow} run: a path escapes the current data folder.`);
    }
    return rebased as T;
  };
}

/** Locate state before legacy outputs; the discovered record owns its next write location. */
export async function readRunRecord<T extends { paths: { runDir: string } }>(
  libraryDir: string,
  workflow: string,
  runId: string,
  fileName: string,
) {
  for (const section of ['state', 'outputs']) {
    const statusPath = resolveLibraryPathFromRoot(libraryDir, section, workflow, runId, fileName);
    const record = await readJson<T>(statusPath);
    if (!record) continue;
    const runDir = path.dirname(statusPath);
    return {
      record,
      runDir,
      statusPath,
      rebasePath: createRunPathRebaser(libraryDir, workflow, record.paths.runDir, runDir),
    };
  }
  return null;
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
