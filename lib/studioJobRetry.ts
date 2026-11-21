import type { Job } from '../packages/shared/src';
import { canResumeStudioJob } from '../packages/shared/src/jobRecovery';

export { canResumeStudioJob };

const RETRYABLE_JOB_STATUSES = new Set<Job['status']>(['failed', 'cancelled']);

export function canRetryStudioJob(
  job: Pick<Job, 'status' | 'providerId' | 'execution' | 'batchId'>,
) {
  return (
    RETRYABLE_JOB_STATUSES.has(job.status) &&
    !(job.batchId && job.status === 'cancelled') &&
    (job.providerId !== 'codex' || Boolean(job.execution?.providerOptions?.codex)) &&
    (job.providerId !== 'chatgpt' || Boolean(job.execution?.providerOptions?.chatgpt))
  );
}

/** Review jobs Studio cannot resume; the user may mark them failed to get the normal Retry. */
export function canMarkStudioJobFailed(job: Pick<Job, 'status' | 'remoteExecution'>) {
  return job.status === 'needs_review' && !canResumeStudioJob(job);
}

export const REVIEW_FALLBACK_REASON =
  'The provider did not return a confirmed, usable image result.';

/**
 * A job error as the user reads it. Older jobs stored a proxy's HTML error page in `error`;
 * the page is cut and named instead of shown.
 */
export function readableJobError(job: Pick<Job, 'status' | 'error'>) {
  const error = job.error?.trim();
  if (!error) return job.status === 'needs_review' ? REVIEW_FALLBACK_REASON : null;
  const page = error.search(/<!doctype html|<html/i);
  if (page < 0) return error;
  return `${error.slice(0, page).trim()} The service returned an error page. This is usually temporary.`.trim();
}
