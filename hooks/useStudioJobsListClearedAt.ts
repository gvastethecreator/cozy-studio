import { useCallback, useEffect, useRef, useState } from 'react';

import {
  readStudioJobsAttentionClearedAt,
  readStudioJobsListClearedAt,
  subscribeStudioJobsListCleared,
  writeStudioJobsAttentionClearedAt,
  writeStudioJobsListClearedAt,
} from '../lib/studioJobsListClear';

export function useStudioJobsListClearedAt(clearReviewJobsOnStartup?: boolean) {
  const [sessionStartedAt] = useState(Date.now);
  const appliedStartupPreference = useRef(false);
  const [clearedAt, setClearedAt] = useState(readStudioJobsListClearedAt);
  const [attentionClearedAt, setAttentionClearedAt] = useState(readStudioJobsAttentionClearedAt);

  useEffect(
    () =>
      subscribeStudioJobsListCleared(() => {
        setClearedAt(readStudioJobsListClearedAt());
        setAttentionClearedAt(readStudioJobsAttentionClearedAt());
      }),
    [],
  );
  useEffect(() => {
    if (clearReviewJobsOnStartup === undefined || appliedStartupPreference.current) return;
    appliedStartupPreference.current = true;
    if (clearReviewJobsOnStartup) {
      writeStudioJobsAttentionClearedAt(
        Math.max(sessionStartedAt, readStudioJobsAttentionClearedAt()),
      );
    }
  }, [clearReviewJobsOnStartup, sessionStartedAt]);

  const clearListedJobs = useCallback(() => {
    const at = Date.now();
    writeStudioJobsListClearedAt(at);
    writeStudioJobsAttentionClearedAt(at);
  }, []);

  const showAllHistory = useCallback(() => {
    writeStudioJobsListClearedAt(0);
    writeStudioJobsAttentionClearedAt(0);
  }, []);

  return {
    clearedAt,
    clearListedJobs,
    attentionClearedAt,
    showAllHistory,
  };
}
