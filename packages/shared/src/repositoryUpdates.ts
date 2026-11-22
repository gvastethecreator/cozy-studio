export const STUDIO_RESTART_EXIT_CODE = 75;
export type RepositoryUpdateChannel = 'commits' | 'releases';

export interface RepositoryUpdateStatus {
  source: 'git' | 'release';
  channel: RepositoryUpdateChannel;
  currentVersion: string | null;
  latestVersion: string | null;
  instanceId: string;
  phase: 'idle' | 'checking' | 'updating' | 'restarting' | 'error';
  checkedAt: string | null;
  currentCommit: string | null;
  latestCommit: string | null;
  behind: number;
  /** The newest commits an update would apply, newest first, at most 20. Empty for releases. */
  commits: Array<{ commit: string; title: string }>;
  canUpdate: boolean;
  /**
   * True when queued or running jobs are the only reason canUpdate is false. Applying with
   * force: true then goes ahead: the restart requeues running jobs and keeps queued ones.
   */
  canForceUpdate: boolean;
  canRestart: boolean;
  blocker: string | null;
  error: string | null;
}
