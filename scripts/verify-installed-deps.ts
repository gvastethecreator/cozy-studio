// `bun install` keeps packages that bun.lock no longer lists, so a stale node_modules can hide a
// CI failure. Report top-level packages that bun.lock does not pin. Report only (owner decision).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const nodeModules = path.join(root, 'node_modules');
try {
  const lock = Bun.JSONC.parse(readFileSync(path.join(root, 'bun.lock'), 'utf8')) as {
    packages: Record<string, [string, ...unknown[]]>;
  };

  const installed = readdirSync(nodeModules)
    .filter((entry) => !entry.startsWith('.'))
    .flatMap((entry) =>
      entry.startsWith('@')
        ? readdirSync(path.join(nodeModules, entry)).map((child) => `${entry}/${child}`)
        : [entry],
    );

  const extraneous = installed.flatMap((name) => {
    const manifest = path.join(nodeModules, name, 'package.json');
    if (!existsSync(manifest)) return [`${name}: no package.json`];
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string; version: string };
    const pinned = lock.packages[name]?.[0];
    const have = `${pkg.name}@${pkg.version}`;
    return pinned === have ? [] : [`${name}: installed ${have}, bun.lock ${pinned ?? 'none'}`];
  });

  if (extraneous.length === 0) {
    console.log(`node_modules matches bun.lock (${installed.length} top-level packages).`);
  } else {
    console.warn(`node_modules has ${extraneous.length} package(s) that bun.lock does not pin:`);
    for (const line of extraneous) console.warn(`  ${line}`);
    console.warn('Local results can differ from CI. Fix: rm -rf node_modules && bun install');
  }
} catch (error) {
  // Report only: a missing or unreadable install must not fail the gate.
  console.warn(
    `Could not compare node_modules with bun.lock: ${error instanceof Error ? error.message : String(error)}`,
  );
}
