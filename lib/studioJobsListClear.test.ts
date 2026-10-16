/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStudioJobsListClearedAt } from '../hooks/useStudioJobsListClearedAt';

import {
  STUDIO_JOBS_ATTENTION_CLEARED_AT_KEY,
  STUDIO_JOBS_LIST_CLEARED_AT_KEY,
  isStudioJobVisibleAfterAttentionClear,
  isStudioJobVisibleAfterListClear,
  readStudioJobsAttentionClearedAt,
  readStudioJobsListClearedAt,
  writeStudioJobsAttentionClearedAt,
  writeStudioJobsListClearedAt,
} from './studioJobsListClear';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.removeItem(STUDIO_JOBS_LIST_CLEARED_AT_KEY);
  window.localStorage.removeItem(STUDIO_JOBS_ATTENTION_CLEARED_AT_KEY);
});

describe('studioJobsListClear', () => {
  it('applies the initial startup preference once, after settings arrive, without clearing current-session jobs', () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean | undefined }) => useStudioJobsListClearedAt(enabled),
      { initialProps: { enabled: undefined as boolean | undefined } },
    );
    expect(result.current.attentionClearedAt).toBe(0);
    rerender({ enabled: true });
    const cutoff = result.current.attentionClearedAt;
    expect(cutoff).toBeGreaterThan(0);
    expect(
      isStudioJobVisibleAfterAttentionClear(
        'needs_review',
        new Date(cutoff + 1).toISOString(),
        cutoff,
      ),
    ).toBe(true);
    act(() => result.current.showAllHistory());
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(readStudioJobsAttentionClearedAt()).toBe(0);
  });

  it('keeps a manual clear when startup settings arrive later', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean | undefined }) => useStudioJobsListClearedAt(enabled),
      { initialProps: { enabled: undefined as boolean | undefined } },
    );
    now.mockReturnValue(3000);
    act(() => result.current.clearListedJobs());
    rerender({ enabled: true });
    expect(result.current.clearedAt).toBe(3000);
    expect(result.current.attentionClearedAt).toBe(3000);
    expect(
      isStudioJobVisibleAfterAttentionClear(
        'needs_review',
        new Date(2000).toISOString(),
        result.current.attentionClearedAt,
      ),
    ).toBe(false);
  });
  it('hides jobs last updated at or before the clear time', () => {
    expect(isStudioJobVisibleAfterListClear('2026-07-18T00:00:00.000Z', 0)).toBe(true);
    const clearedAt = Date.parse('2026-07-18T12:00:00.000Z');
    expect(isStudioJobVisibleAfterListClear('2026-07-18T00:00:00.000Z', clearedAt)).toBe(false);
    expect(isStudioJobVisibleAfterListClear('2026-07-18T12:00:00.000Z', clearedAt)).toBe(false);
    expect(isStudioJobVisibleAfterListClear('2026-07-18T12:00:01.000Z', clearedAt)).toBe(true);
  });

  it('synchronizes local and cross-tab clears and restores both history filters', () => {
    const { result } = renderHook(() => useStudioJobsListClearedAt());
    act(() => {
      writeStudioJobsListClearedAt(1_700_000_000_000);
      writeStudioJobsAttentionClearedAt(1_700_000_000_000);
    });
    expect(readStudioJobsListClearedAt()).toBe(1_700_000_000_000);
    act(() => result.current.showAllHistory());
    expect(result.current.clearedAt).toBe(0);
    expect(result.current.attentionClearedAt).toBe(0);
    act(() => {
      window.localStorage.setItem(STUDIO_JOBS_LIST_CLEARED_AT_KEY, '1700000000001');
      window.localStorage.setItem(STUDIO_JOBS_ATTENTION_CLEARED_AT_KEY, '1700000000001');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: STUDIO_JOBS_ATTENTION_CLEARED_AT_KEY,
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current.clearedAt).toBe(1_700_000_000_001);
    expect(result.current.attentionClearedAt).toBe(1_700_000_000_001);
  });

  it('hides only previously failed or review jobs, not later failures or completed work', () => {
    const cutoff = Date.parse('2026-07-18T12:00:00.000Z');
    writeStudioJobsAttentionClearedAt(cutoff);
    expect(readStudioJobsAttentionClearedAt()).toBe(cutoff);
    expect(
      isStudioJobVisibleAfterAttentionClear('failed', '2026-07-18T11:00:00.000Z', cutoff),
    ).toBe(false);
    expect(
      isStudioJobVisibleAfterAttentionClear('needs_review', '2026-07-18T11:00:00.000Z', cutoff),
    ).toBe(false);
    expect(
      isStudioJobVisibleAfterAttentionClear('failed', '2026-07-18T12:00:01.000Z', cutoff),
    ).toBe(true);
    expect(
      isStudioJobVisibleAfterAttentionClear('completed', '2026-07-18T11:00:00.000Z', cutoff),
    ).toBe(true);
    expect(
      isStudioJobVisibleAfterAttentionClear('running', '2026-07-18T11:00:00.000Z', cutoff),
    ).toBe(true);
  });
});
