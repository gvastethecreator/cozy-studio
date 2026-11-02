import type { JobStatus } from '../packages/shared/src';
import type { ShellActivityJob as StudioJob } from './shellActivityJob';
import type { AspectRatio, StudioGenerationPlaceholder } from '../types';

const ACTIVE_SERVER_JOB_STATUSES = new Set<JobStatus>(['queued', 'running']);

function createdAtMs(value: string | number) {
  return typeof value === 'number' ? value : Date.parse(value) || Date.now();
}

export function buildStudioGenerationPlaceholders({
  studioJobs,
  activeWorkspaceId,
  fallbackAspectRatio,
}: {
  studioJobs: StudioJob[];
  activeWorkspaceId: string;
  fallbackAspectRatio: AspectRatio;
}): StudioGenerationPlaceholder[] {
  const activeServerJobs = studioJobs.filter((job) => ACTIVE_SERVER_JOB_STATUSES.has(job.status));

  return activeServerJobs
    .flatMap((job) => {
      if (job.workspaceId && job.workspaceId !== activeWorkspaceId) return [];
      return [
        {
          id: `server-${job.id}`,
          status: job.status,
          aspectRatio: job.aspectRatio ?? fallbackAspectRatio,
          prompt: job.promptPreview || 'Generating image',
          createdAt: createdAtMs(job.createdAt),
        },
      ];
    })
    .toSorted((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
}
