import { useCallback } from 'react';
import type { StudioCatalogView } from '../lib/studioCatalogView';
import {
  exportLegacyWorkspaceSnapshot as exportLegacyWorkspaceSnapshotPayload,
  buildWorkspaceExportImages,
} from '../lib/studioWorkspaceExport';
import { downloadMultipleImagesAsZip, exportToJson } from '../utils/fileUtils';
import { formatErrorMessage } from '../utils/runtimeLogger';

interface UseVaultTransferProps {
  catalogView?: StudioCatalogView;
  addToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  log: (message: string) => void;
}

export interface VaultTransferController {
  exportLegacyWorkspaceSnapshot: () => void;
  downloadAndClearWorkspace: () => Promise<boolean>;
}

/**
 * Concentrate vault export and archive-download flows behind one hook so
 * AppContent only coordinates UI state, not file I/O choreography.
 */
export function useVaultTransfer({
  catalogView,
  addToast,
  log,
}: UseVaultTransferProps): VaultTransferController {
  const exportLegacyWorkspaceSnapshot = useCallback(() => {
    exportToJson(
      exportLegacyWorkspaceSnapshotPayload({ catalogView }),
      `workspace-snapshot-${Date.now()}.json`,
    );
  }, [catalogView]);

  const downloadAndClearWorkspace = useCallback(async () => {
    try {
      const images = buildWorkspaceExportImages({ catalogView });

      if (images.length > 0) {
        const result = await downloadMultipleImagesAsZip(
          images,
          `workspace-export-${Date.now()}.zip`,
        );
        if (result.failedImages.length) {
          addToast(
            `Workspace export incomplete: ${result.exported} of ${result.requested} images downloaded.`,
            'warning',
          );
          return false;
        }
      } else {
        addToast('There are no loaded images to download.', 'info');
        return false;
      }

      addToast('Workspace archive downloaded', 'success');
      return true;
    } catch (error) {
      log(`Failed to download workspace: ${formatErrorMessage(error)}`);
      addToast('Failed to download the workspace archive', 'error');
      return false;
    }
  }, [addToast, catalogView, log]);

  return {
    exportLegacyWorkspaceSnapshot,
    downloadAndClearWorkspace,
  };
}
