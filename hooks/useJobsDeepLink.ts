import { useCallback, useEffect, useState } from 'react';
import { getStudioJobBatch, getStudioJobDetail } from '../services/studio-api/jobs';
import type { ToastMessage } from './useToasts';
import { useLatestRef } from './useLatestRef';

/** What a link asks the Jobs panel to show. */
export type QueueLink = { kind: 'review' } | { kind: 'batch'; batchId: string };

type JobsLink = QueueLink | { kind: 'job'; jobId: string };

const JOBS_LINK_PARAMS = ['job', 'batch', 'jobs'] as const;

function readJobsLink(search: string): JobsLink | null {
  const params = new URLSearchParams(search);
  const jobId = params.get('job');
  if (jobId) return { kind: 'job', jobId };
  const batchId = params.get('batch');
  if (batchId) return { kind: 'batch', batchId };
  return params.get('jobs') === 'review' ? { kind: 'review' } : null;
}

interface UseJobsDeepLinkOptions {
  isQueueOpen: boolean;
  openQueue: () => void;
  inspectJob: (jobId: string) => void;
  addToast: (message: string, type?: ToastMessage['type']) => void;
}

/**
 * Opens what a startup link names: `?job=<id>` in the job inspector, `?batch=<id>` as a batch card
 * in the Jobs panel and `?jobs=review` as the panel's Review list. The link leaves the URL once it
 * is read, so a reload shows the Library. An id Studio does not know leaves the Library open.
 */
export function useJobsDeepLink({
  isQueueOpen,
  openQueue,
  inspectJob,
  addToast,
}: UseJobsDeepLinkOptions) {
  const [link] = useState(() => readJobsLink(window.location.search));
  const [queueLink, setQueueLink] = useState<QueueLink | null>(null);
  const actions = useLatestRef({ openQueue, inspectJob, addToast });

  useEffect(() => {
    if (!link) return;
    const url = new URL(window.location.href);
    for (const param of JOBS_LINK_PARAMS) url.searchParams.delete(param);
    window.history.replaceState(window.history.state, '', url);
    if (link.kind === 'review') {
      setQueueLink(link);
      actions.current.openQueue();
      return;
    }
    let cancelled = false;
    const found =
      link.kind === 'job' ? getStudioJobDetail(link.jobId) : getStudioJobBatch(link.batchId);
    found.then(
      () => {
        if (cancelled) return;
        if (link.kind === 'job') {
          actions.current.inspectJob(link.jobId);
          return;
        }
        setQueueLink(link);
        actions.current.openQueue();
      },
      () => {
        if (cancelled) return;
        actions.current.addToast(
          `Could not open the ${link.kind} from the link. It may have been removed. Showing the Library.`,
          'warning',
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [link, actions]);

  useEffect(() => {
    if (!isQueueOpen) setQueueLink(null);
  }, [isQueueOpen]);

  const clearQueueLink = useCallback(() => setQueueLink(null), []);
  return { queueLink, clearQueueLink };
}
