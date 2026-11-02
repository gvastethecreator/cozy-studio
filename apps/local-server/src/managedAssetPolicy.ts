import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { GenerationTaskSpec, JobLibraryContext } from '../../../packages/shared/src';
import { isPathInside } from './pathContainment';

const MANAGED_ASSET_ROOTS = [['outputs'], ['.studio', 'references'], ['.studio', 'masks']] as const;

function canonicalPath(filePath: string) {
  return existsSync(filePath) ? realpathSync(filePath) : path.resolve(filePath);
}

export function isManagedGenerationAssetPath(filePath: string, libraryContext: JobLibraryContext) {
  for (const registered of libraryContext.sourceRoots ?? []) {
    const root = canonicalPath(registered.rootPath);
    const candidate = canonicalPath(filePath);
    if (
      registered.outputOnly
        ? isPathInside(root, candidate)
        : MANAGED_ASSET_ROOTS.some((segments) =>
            isPathInside(canonicalPath(path.join(root, ...segments)), candidate),
          )
    )
      return true;
  }
  const libraryRoot = canonicalPath(libraryContext.rootPath);
  const candidate = canonicalPath(filePath);
  if (!isPathInside(libraryRoot, candidate)) return false;

  return MANAGED_ASSET_ROOTS.some((segments) => {
    const managedRoot = canonicalPath(path.join(libraryRoot, ...segments));
    return isPathInside(managedRoot, candidate);
  });
}

export function validateManagedGenerationAssets(
  sourceSpec: GenerationTaskSpec | null,
  libraryContext: JobLibraryContext,
) {
  if (!sourceSpec) return [];

  return sourceSpec.assets.flatMap((asset, index) => {
    const localPath = asset.localPath?.trim();
    if (!localPath || isManagedGenerationAssetPath(localPath, libraryContext)) return [];
    return [
      {
        code: 'unmanaged_asset_path',
        field: `sourceSpec.assets.${index}.localPath`,
        message: `Generation asset "${asset.name}" must resolve inside the selected Studio Library outputs, references, or masks.`,
      },
    ];
  });
}
