import { useEffect, useState } from 'react';

import { isInstalledStylePack } from '../../lib/installedStylePacks';
import {
  isPresetInWorkspaceStyleScope,
  workspaceStyleRefKey,
  type WorkspaceStyleRef,
} from '../../packages/shared/src/workspaceContracts';
import { loadStylePresetCatalogSearchIndex } from './stylePresetCatalogSearchData';

/** How many installed styles the workspace scope holds; null while unknown. */
export function useWorkspaceStyleCount(scope: readonly WorkspaceStyleRef[]) {
  const [count, setCount] = useState<number | null>(null);
  const scopeKey = scope.map(workspaceStyleRefKey).join('|');
  useEffect(() => {
    const packIds = [...new Set(scope.map((ref) => ref.packId))].filter(isInstalledStylePack);
    if (packIds.length === 0) {
      setCount(0);
      return;
    }
    let cancelled = false;
    loadStylePresetCatalogSearchIndex(packIds).then(
      (index) => {
        if (cancelled) return;
        setCount(
          index.presets.filter((preset) =>
            isPresetInWorkspaceStyleScope(scope, {
              packId: preset.packId,
              presetId: preset.id,
              category: preset.categoryName,
            }),
          ).length,
        );
      },
      () => {
        if (!cancelled) setCount(null);
      },
    );
    return () => {
      cancelled = true;
    };
    // scopeKey stands for the scope's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  return count;
}
