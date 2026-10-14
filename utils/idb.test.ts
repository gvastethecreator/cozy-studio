/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('IndexedDB write acknowledgement', () => {
  it('waits for transaction commit and rejects an abort after a successful put request', async () => {
    const request = { onsuccess: null as (() => void) | null, onerror: null, error: null };
    const transaction = {
      objectStore: () => ({ put: vi.fn(() => request) }),
      oncomplete: null as (() => void) | null,
      onabort: null as (() => void) | null,
      onerror: null,
      error: null as Error | null,
    };
    const open = {
      result: { transaction: () => transaction },
      onsuccess: null as (() => void) | null,
    };
    vi.stubGlobal('indexedDB', { open: vi.fn(() => open) });
    vi.resetModules();
    const { set } = await import('./idb');
    const saved = vi.fn();
    const write = set('draft', 'latest');
    void write.then(saved, () => {});
    open.onsuccess?.();
    await Promise.resolve();
    request.onsuccess?.();
    await Promise.resolve();
    expect(saved).not.toHaveBeenCalled();
    const failed = expect(write).rejects.toThrow('late abort');
    transaction.error = new Error('late abort');
    transaction.onabort?.();
    await failed;
    expect(saved).not.toHaveBeenCalled();
    const committed = set('draft', 'retry');
    await Promise.resolve();
    transaction.oncomplete?.();
    await expect(committed).resolves.toBeUndefined();
  });
});
