/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useIndexedDBStorage from './useIndexedDBStorage';
import { get, set } from '../utils/idb';
import { useScopedGenerationDraft } from './useScopedGenerationDraft';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import type { ImageGenerationConfig } from '../types';

vi.mock('../utils/idb', () => ({ get: vi.fn(), set: vi.fn() }));

describe('draft persistence recovery', () => {
  it('does not replace a recovered value with new edits without explicit recovery semantics', async () => {
    vi.mocked(get)
      .mockRejectedValueOnce(new Error('read blocked'))
      .mockResolvedValue('old saved draft');
    vi.mocked(set).mockReset().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useIndexedDBStorage('draft', ''));
    await waitFor(() => expect(result.current[3].error).toContain('could not be read'));
    act(() => result.current[1]('new edit'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(set).not.toHaveBeenCalled();
    await act(async () => result.current[3].retry());
    expect(result.current[0]).toBe('new edit');
    expect(result.current[3].error).toContain('Keep a copy');
    expect(set).not.toHaveBeenCalled();
    unmount();
  });

  it('rehydrates every saved scope while retaining a newly edited scope through failed save and retry', async () => {
    const saved = {
      'workspace-a:studio': { ...DEFAULT_GENERATION_CONFIG, prompt: 'saved A' },
      'workspace-b:remaster': { ...DEFAULT_GENERATION_CONFIG, prompt: 'saved B' },
    };
    let reads = 0;
    let writes = 0;
    vi.mocked(get)
      .mockReset()
      .mockImplementation(async (key) => {
        if (key !== 'generation-drafts') return undefined;
        if (++reads === 1) throw new Error('read blocked');
        return saved;
      });
    vi.mocked(set)
      .mockReset()
      .mockImplementation(async (key) => {
        if (key === 'generation-drafts' && ++writes === 1) throw new Error('quota');
      });
    const prepare = (config: ImageGenerationConfig) => config;
    const { result, unmount } = renderHook(() =>
      useScopedGenerationDraft('workspace-c:studio', prepare),
    );
    await waitFor(() => expect(result.current[4].error).toContain('could not be read'));
    act(() => result.current[1]((config) => ({ ...config, prompt: 'new C' })));
    await act(async () => result.current[4].retry());
    expect(result.current[4].error).toContain('could not be saved');
    expect(result.current[0].prompt).toBe('new C');
    await act(async () => result.current[4].retry());
    expect(set).toHaveBeenLastCalledWith(
      'generation-drafts',
      expect.objectContaining({
        ...saved,
        'workspace-c:studio': expect.objectContaining({ prompt: 'new C' }),
      }),
    );
    expect(result.current[4].error).toBeNull();
    unmount();
  });
});
