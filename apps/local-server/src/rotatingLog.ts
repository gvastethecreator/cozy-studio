import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

export interface RotatingLogOptions {
  maxBytes?: number;
  maxHistoryFiles?: number;
  now?: () => Date;
}

export const DEFAULT_ROTATING_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_ROTATING_LOG_HISTORY_FILES = 20;

function readPositiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function resolveRotatingLogOptions(options: RotatingLogOptions = {}) {
  return {
    maxBytes:
      options.maxBytes ??
      readPositiveIntegerEnv('STUDIO_LOG_MAX_BYTES', DEFAULT_ROTATING_LOG_MAX_BYTES),
    maxHistoryFiles:
      options.maxHistoryFiles ??
      readPositiveIntegerEnv('STUDIO_LOG_HISTORY_FILES', DEFAULT_ROTATING_LOG_HISTORY_FILES),
    now: options.now ?? (() => new Date()),
  };
}

function createHistoryFilePath(filePath: string, now: Date) {
  const directory = path.dirname(filePath);
  const historyDirectory = path.join(directory, 'history');
  const logPathParts = path.parse(filePath);
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(
    historyDirectory,
    `${logPathParts.name}.${timestamp}${logPathParts.ext || '.log'}`,
  );
}

function pruneHistory(filePath: string, maxHistoryFiles: number) {
  if (maxHistoryFiles <= 0) return;

  const directory = path.dirname(filePath);
  const historyDirectory = path.join(directory, 'history');
  if (!existsSync(historyDirectory)) return;

  const logPathParts = path.parse(filePath);
  const historyFiles = readdirSync(historyDirectory)
    .flatMap((name) => {
      if (!name.startsWith(`${logPathParts.name}.`)) return [];
      const fullPath = path.join(historyDirectory, name);
      return [
        {
          path: fullPath,
          mtimeMs: statSync(fullPath).mtimeMs,
        },
      ];
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of historyFiles.slice(maxHistoryFiles)) {
    rmSync(file.path, { force: true });
  }
}

function rotateLog(filePath: string, resolved: ReturnType<typeof resolveRotatingLogOptions>) {
  if (!existsSync(filePath)) return;
  const historyPath = createHistoryFilePath(filePath, resolved.now());
  mkdirSync(path.dirname(historyPath), { recursive: true });
  renameSync(filePath, historyPath);
  pruneHistory(filePath, resolved.maxHistoryFiles);
}

/**
 * One open handle per log file, with its size counted here. On Windows, appendFileSync opens and
 * closes the file for every line, about 20 ms each, and every log line blocked the event loop.
 */
const openLogs = new Map<string, { fd: number; size: number }>();

function openLog(filePath: string) {
  const open = openLogs.get(filePath);
  if (open) return open;
  mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = openSync(filePath, 'a');
  const opened = { fd, size: fstatSync(fd).size };
  openLogs.set(filePath, opened);
  return opened;
}

function closeLog(filePath: string) {
  const open = openLogs.get(filePath);
  if (!open) return;
  openLogs.delete(filePath);
  try {
    closeSync(open.fd);
  } catch {
    // The handle is gone already; the next line opens the file again.
  }
}

/** Closes every open log file. Call it before deleting the logs folder. */
export function closeRotatingLogs() {
  for (const filePath of openLogs.keys()) closeLog(filePath);
}

export function appendRotatingLog(
  filePath: string,
  text: string,
  options: RotatingLogOptions = {},
) {
  const resolved = resolveRotatingLogOptions(options);
  let open = openLog(filePath);
  if (open.size >= resolved.maxBytes) {
    closeLog(filePath);
    rotateLog(filePath, resolved);
    open = openLog(filePath);
  }
  const bytes = Buffer.from(text, 'utf8');
  try {
    writeSync(open.fd, bytes);
  } catch (error) {
    closeLog(filePath);
    throw error;
  }
  open.size += bytes.length;
}
