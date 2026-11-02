import { describe, expect, it, vi } from 'vitest';
import { createRuntimeDoctorCache } from './runtimeDoctorCache';

function createDeferredProbe() {
  const pending: Array<(report: string) => void> = [];
  const probe = vi.fn(() => new Promise<string>((resolve) => pending.push(resolve)));
  return { probe, resolveNext: (report: string) => pending.shift()?.(report) };
}

describe('createRuntimeDoctorCache', () => {
  it('answers reads without waiting while one probe runs at a time', async () => {
    const { probe, resolveNext } = createDeferredProbe();
    const cache = createRuntimeDoctorCache({ maxAgeMs: 0, probe, checking: () => 'checking' });

    expect(cache.read()).toBe('checking');
    const firstLoad = cache.load();
    expect(probe).toHaveBeenCalledTimes(1);
    resolveNext('first');
    await expect(firstLoad).resolves.toBe('first');

    // With maxAgeMs 0 the report is already expired: reads keep it while one probe replaces it.
    expect(cache.read()).toBe('first');
    expect(cache.read()).toBe('first');
    await expect(cache.load()).resolves.toBe('first');
    expect(probe).toHaveBeenCalledTimes(2);

    resolveNext('second');
    await expect(cache.refresh()).resolves.toBe('second');
    expect(cache.read()).toBe('second');
  });

  it('keeps a fresh report and the last report after a failed probe', async () => {
    const probe = vi.fn().mockResolvedValueOnce('ready').mockRejectedValue(new Error('CLI gone'));
    const fresh = createRuntimeDoctorCache({ maxAgeMs: 60_000, probe, checking: () => 'checking' });

    await expect(fresh.load()).resolves.toBe('ready');
    expect(fresh.read()).toBe('ready');
    expect(probe).toHaveBeenCalledTimes(1);

    await expect(fresh.refresh()).rejects.toThrow('CLI gone');
    expect(fresh.read()).toBe('ready');
  });
});
