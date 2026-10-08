import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveStudioDataRoot } from './config';
import {
  EXTENSION_LAYERS,
  EXTENSION_MANIFEST_FILE,
  parseExtensionManifest,
  type ExtensionManifest,
} from '../../../packages/shared/src/extensions';

/** One extension found in an Extension Source folder (ADR 0011). */
export interface InstalledExtension {
  manifest: ExtensionManifest;
  root: string;
  source: string;
  /** Optional layers present on disk, such as `cards`. */
  layers: string[];
}

export interface ExtensionListing {
  extensions: InstalledExtension[];
  /** Folders that looked like extensions but failed validation, with their issues. */
  invalid: { folder: string; issues: string[] }[];
}

export interface ExtensionStore {
  /** Cached listing; pass refresh after installing or removing an extension. */
  list(options?: { refresh?: boolean }): Promise<ExtensionListing>;
  /** Reads a file inside an extension; null when the extension or file does not exist. */
  readFile(extensionId: string, relativePath: string): Promise<Buffer | null>;
}

const DEFAULT_BUILT_IN_SOURCE = path.join('.local', 'extensions', 'builtin');

/** Folder that receives extensions installed from remote sources. */
export function resolveExtensionInstallDir(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
) {
  return env.STUDIO_EXTENSION_INSTALL_DIR
    ? path.resolve(cwd, env.STUDIO_EXTENSION_INSTALL_DIR)
    : path.join(resolveStudioDataRoot(env), 'Extensions');
}

/**
 * Local Extension Sources, in priority order: the install folder first, so an installed version
 * replaces a built-in one, then `STUDIO_EXTENSION_SOURCES` (path-delimited) or the built-in folder.
 */
export function resolveExtensionSources(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
) {
  const configured = env.STUDIO_EXTENSION_SOURCES?.split(path.delimiter).filter(Boolean);
  const sources = [
    resolveExtensionInstallDir(env, cwd),
    ...(configured?.length ? configured : [DEFAULT_BUILT_IN_SOURCE]).map((source) =>
      path.resolve(cwd, source),
    ),
  ];
  return [...new Set(sources)];
}

function insideRoot(root: string, relativePath: string) {
  const resolved = path.resolve(root, relativePath);
  return resolved.startsWith(`${path.resolve(root)}${path.sep}`) ? resolved : null;
}

export function createExtensionStore(sources: string[]): ExtensionStore {
  async function scan(): Promise<ExtensionListing> {
    const extensions: InstalledExtension[] = [];
    const invalid: ExtensionListing['invalid'] = [];
    const seen = new Set<string>();
    const manifests = await Promise.all(
      sources.map(async (source) => {
        if (!existsSync(source)) return [];
        const entries = await readdir(source, { withFileTypes: true });
        return Promise.all(
          entries
            .filter(
              (entry) =>
                entry.isDirectory() &&
                !entry.name.includes('.stage-') &&
                !entry.name.includes('.previous-'),
            )
            .map(async (entry) => {
              const root = path.join(source, entry.name);
              const manifestPath = path.join(root, EXTENSION_MANIFEST_FILE);
              if (!existsSync(manifestPath)) return null;
              try {
                const raw: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
                return { root, source, parsed: parseExtensionManifest(raw) };
              } catch {
                return {
                  root,
                  source,
                  parsed: { ok: false as const, issues: ['extension.json is not valid JSON'] },
                };
              }
            }),
        );
      }),
    );
    // Promise.all preserves input order: earlier sources still win duplicate ids.
    for (const entries of manifests) {
      for (const entry of entries) {
        if (!entry) continue;
        const { root, source, parsed } = entry;
        if (!parsed.ok) {
          invalid.push({ folder: root, issues: parsed.issues });
          continue;
        }
        if (seen.has(parsed.manifest.id)) continue;
        seen.add(parsed.manifest.id);
        const layers = EXTENSION_LAYERS.filter((layer) => existsSync(path.join(root, layer)));
        extensions.push({ manifest: parsed.manifest, root, source, layers });
      }
    }
    extensions.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
    return { extensions, invalid };
  }

  let cached: Promise<ExtensionListing> | null = null;
  function list(options: { refresh?: boolean } = {}) {
    if (!cached || options.refresh) cached = scan();
    return cached;
  }

  return {
    list,
    async readFile(extensionId, relativePath) {
      const extension = (await list()).extensions.find((item) => item.manifest.id === extensionId);
      if (!extension) return null;
      const filePath = insideRoot(extension.root, relativePath);
      if (!filePath || !existsSync(filePath) || !(await stat(filePath)).isFile()) return null;
      return readFile(filePath);
    },
  };
}
