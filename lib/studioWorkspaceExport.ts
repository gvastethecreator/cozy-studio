import type { StudioCatalogView } from './studioCatalogView';
import { buildLegacyWorkspaceSnapshotFromCatalog } from './studioLegacyWorkspaceSnapshotExport';
import type { LegacyWorkspaceSnapshot } from './studioLegacyWorkspaceSnapshotTypes';

interface WorkspaceExportInput {
  catalogView?: StudioCatalogView;
}

export function exportLegacyWorkspaceSnapshot({
  catalogView,
}: WorkspaceExportInput): LegacyWorkspaceSnapshot {
  if (!catalogView) return [];
  return buildLegacyWorkspaceSnapshotFromCatalog(catalogView);
}
