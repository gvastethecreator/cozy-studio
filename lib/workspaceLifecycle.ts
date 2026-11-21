export const DEFAULT_WORKSPACE_ID = 'default';

/** Window event that opens the header workspace switcher, e.g. from an empty workspace. */
export const OPEN_WORKSPACE_SWITCHER = 'studio:open-workspace-switcher';

export function isDefaultWorkspace(workspaceId: string) {
  return workspaceId === DEFAULT_WORKSPACE_ID;
}

export interface RunWorkspaceSwitchLifecycleArgs {
  workspaceId: string;
  currentView: 'studio' | 'recipes';
  setActiveWorkspace: (workspaceId: string) => void;
  onViewChange: (view: 'studio' | 'recipes') => void;
}

/**
 * Workspace lifecycle invariant: workspace switch always keeps Studio view as
 * the stable landing surface.
 */
export function runWorkspaceSwitchLifecycle({
  workspaceId,
  currentView,
  setActiveWorkspace,
  onViewChange,
}: RunWorkspaceSwitchLifecycleArgs) {
  setActiveWorkspace(workspaceId);
  if (currentView !== 'studio') {
    onViewChange('studio');
  }
}

export interface RunWorkspaceDeleteLifecycleArgs {
  workspaceId: string;
  clearWorkspace: (workspaceId: string) => void | Promise<void>;
  deleteWorkspace: (workspaceId: string) => void | Promise<void>;
}

/**
 * Workspace lifecycle invariant: catalog cleanup happens before workspace
 * removal so imported/derived workspaces cannot be reintroduced by stale data.
 */
export async function runWorkspaceDeleteLifecycle({
  workspaceId,
  clearWorkspace,
  deleteWorkspace,
}: RunWorkspaceDeleteLifecycleArgs) {
  await clearWorkspace(workspaceId);
  await deleteWorkspace(workspaceId);
}
