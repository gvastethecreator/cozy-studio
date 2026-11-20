import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CatalogImage } from './catalog';

/** The Output Folder and workspace slugs while workspace is the first folder level. */
export interface WorkspaceFolderLayout {
  libraryId: string;
  rootPath: string;
  slugs: Map<string, string>;
}

export interface WorkspaceFoldersResult {
  matchedCount: number;
  movedCount: number;
  failed: { id: string; message: string }[];
}

/**
 * Where an Output Folder image belongs: `<root>/<workspace slug>/<rest>`. A first folder named
 * after any workspace is replaced, so a moved image leaves its old workspace folder. Returns null
 * for images outside the Output Folder.
 */
export function workspaceFolderTarget(image: CatalogImage, layout: WorkspaceFolderLayout) {
  if (image.isDeleted || image.libraryId !== layout.libraryId) return null;
  const relative = path.relative(layout.rootPath, image.filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const parts = relative.split(/[\\/]/);
  const known = new Set([...layout.slugs.values()].map((slug) => slug.toLowerCase()));
  const rest = parts.length > 1 && known.has(parts[0]!.toLowerCase()) ? parts.slice(1) : parts;
  const slug = layout.slugs.get(image.workspaceId ?? 'default') ?? 'default';
  const target = path.join(layout.rootPath, slug, ...rest);
  if (target.toLowerCase() === image.filePath.toLowerCase()) return null;
  const parsed = path.parse(target);
  let candidate = target;
  for (let index = 2; existsSync(candidate); index += 1)
    candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
  return candidate;
}

export function moveImageToWorkspaceFolder(
  image: CatalogImage,
  layout: WorkspaceFolderLayout | null,
  moveFile: (id: string, targetPath: string) => CatalogImage | null,
) {
  const target = layout && existsSync(image.filePath) && workspaceFolderTarget(image, layout);
  return target ? (moveFile(image.id, target) ?? image) : image;
}

/** Moves every live Output Folder image into its workspace folder, yielding between chunks. */
export async function applyWorkspaceFolders(
  layout: WorkspaceFolderLayout,
  images: CatalogImage[],
  moveFile: (id: string, targetPath: string) => CatalogImage | null,
): Promise<WorkspaceFoldersResult> {
  const result: WorkspaceFoldersResult = {
    matchedCount: 0,
    movedCount: 0,
    failed: [],
  };
  for (const [index, image] of images.entries()) {
    if (index % 200 === 199) await new Promise((resolve) => setImmediate(resolve));
    const target = workspaceFolderTarget(image, layout);
    if (!target) continue;
    result.matchedCount += 1;
    try {
      if (!existsSync(image.filePath)) throw new Error('The file is missing.');
      moveFile(image.id, target);
      result.movedCount += 1;
    } catch (error) {
      result.failed.push({
        id: image.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
