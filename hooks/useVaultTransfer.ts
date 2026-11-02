import { useCallback } from 'react';
import type { StudioCatalogView } from '../lib/studioCatalogView';
import { exportLegacyWorkspaceSnapshot as exportLegacyWorkspaceSnapshotPayload } from '../lib/studioWorkspaceExport';
import { exportToJson } from '../utils/fileUtils';

interface UseVaultTransferProps {
  catalogView?: StudioCatalogView;
}

export interface VaultTransferController {
  exportLegacyWorkspaceSnapshot: () => void;
}

/**
 * Export the loaded catalog as the legacy metadata-only snapshot.
 */
export function useVaultTransfer({ catalogView }: UseVaultTransferProps): VaultTransferController {
  const exportLegacyWorkspaceSnapshot = useCallback(() => {
    exportToJson(
      exportLegacyWorkspaceSnapshotPayload({ catalogView }),
      `workspace-snapshot-${Date.now()}.json`,
    );
  }, [catalogView]);

  return {
    exportLegacyWorkspaceSnapshot,
  };
}
