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
  canRestart: boolean;
  blocker: string | null;
  error: string | null;
}
