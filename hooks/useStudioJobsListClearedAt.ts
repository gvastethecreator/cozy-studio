import { useCallback, useEffect, useRef, useState } from 'react';

import {
  readStudioJobsAttentionClearedAt,
  readStudioJobsListClearedAt,
  subscribeStudioJobsListCleared,
  writeStudioJobsAttentionClearedAt,
  writeStudioJobsListClearedAt,
} from '../lib/studioJobsListClear';

export function useStudioJobsListClearedAt(clearReviewJobsOnStartup?: boolean) {
  const sessionStartedAt = useRef(Date.now());
  const appliedStartupPreference = useRef(false);
  const [clearedAt, setClearedAt] = useState(readStudioJobsListClearedAt);
  const [attentionClearedAt, setAttentionClearedAt] = useState(readStudioJobsAttentionClearedAt);

  useEffect(() => {
    if (clearReviewJobsOnStartup === undefined || appliedStartupPreference.current) return;
    appliedStartupPreference.current = true;
    if (clearReviewJobsOnStartup) {
      writeStudioJobsAttentionClearedAt(sessionStartedAt.current);
      setAttentionClearedAt(sessionStartedAt.current);
    }
  }, [clearReviewJobsOnStartup]);

  useEffect(
    () =>
      subscribeStudioJobsListCleared(() => {
        setClearedAt(readStudioJobsListClearedAt());
        setAttentionClearedAt(readStudioJobsAttentionClearedAt());
      }),
    [],
  );

  const clearListedJobs = useCallback(() => {
    writeStudioJobsListClearedAt(Date.now());
  }, []);

  const clearAttentionJobs = useCallback(() => {
    writeStudioJobsAttentionClearedAt(Date.now());
  }, []);

  const showAttentionJobs = useCallback(() => {
    writeStudioJobsAttentionClearedAt(0);
  }, []);

  return { clearedAt, clearListedJobs, attentionClearedAt, clearAttentionJobs, showAttentionJobs };
}
