import { realpathSync } from 'node:fs';
import path from 'node:path';

function comparable(value: string) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

/** Resolves symlinks and junctions. A missing tail stays under the real path of its deepest existing parent. */
function realPathOf(filePath: string) {
  const missing: string[] = [];
  let current = path.resolve(filePath);
  for (;;) {
    try {
      return path.join(realpathSync(current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...missing);
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isInsideResolved(root: string, target: string, allowRoot: boolean) {
  const relative = path.relative(comparable(root), comparable(target));
  if (relative === '') return allowRoot;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Path containment for trust boundaries. By default `target` is inside `root` only when it is
 * inside both as written (after `..` segments resolve) and after symlinks and junctions resolve.
 * So `..` escapes, symlink escapes and sibling prefixes (`/lib` and `/library`) are outside.
 * Windows compares case-insensitively. The root itself counts only with `allowRoot`.
 *
 * A check that blocks a path when it is inside (for example a folder that must not overlap the
 * Studio Library) passes `eitherView`: then a path inside in either view counts as inside.
 */
export function isPathInside(
  root: string,
  target: string,
  { allowRoot = false, eitherView = false }: { allowRoot?: boolean; eitherView?: boolean } = {},
) {
  const written = isInsideResolved(path.resolve(root), path.resolve(target), allowRoot);
  if (written === eitherView) return written;
  return isInsideResolved(realPathOf(root), realPathOf(target), allowRoot);
}
