/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRepositoryUpdateNotifications } from './useRepositoryUpdateNotifications';

const api = vi.hoisted(() => ({ check: vi.fn(), status: vi.fn() }));
vi.mock('../services/studio-api/updates', () => ({
  checkRepositoryUpdates: api.check,
  getRepositoryUpdateStatus: api.status,
  readPendingStudioRestart: () => null,
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const checked = (behind: number, latestCommit: string) => ({
  phase: 'idle',
  checkedAt: '2026-11-01T00:00:00.000Z',
  behind,
  latestCommit,
  error: null,
});

it('shows the startup check once it lands, even with hourly checks off', async () => {
  vi.useFakeTimers();
  api.status
    .mockResolvedValueOnce({
      phase: 'checking',
      checkedAt: null,
      behind: 0,
      latestCommit: null,
      error: null,
    })
    .mockResolvedValue(checked(2, 'first'));
  const addToast = vi.fn();
  renderHook(() => useRepositoryUpdateNotifications(false, addToast));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(addToast).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(addToast).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60 * 1000);
  });
  expect(api.status).toHaveBeenCalledTimes(2);
  expect(api.check).not.toHaveBeenCalled();
});

it('adds hourly checks when enabled and notifies once per remote commit', async () => {
  vi.useFakeTimers();
  api.status.mockResolvedValue(checked(2, 'first'));
  api.check.mockResolvedValue(checked(2, 'first'));
  const addToast = vi.fn();
  const { rerender } = renderHook(
    ({ enabled }) => useRepositoryUpdateNotifications(enabled, addToast),
    { initialProps: { enabled: true } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(addToast).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  });
  expect(api.check).toHaveBeenCalledTimes(1);
  expect(addToast).toHaveBeenCalledTimes(1);
  api.check.mockResolvedValue(checked(3, 'second'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  });
  expect(addToast).toHaveBeenCalledTimes(2);
  rerender({ enabled: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  });
  expect(api.check).toHaveBeenCalledTimes(2);
});
