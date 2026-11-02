import { describe, expect, it, vi } from 'vitest';
import { STUDIO_RESET_CONFIRMATION } from '../../../packages/shared/src';
import { createStudioControlRoutes } from './studioControlRoutes';

describe('studioControlRoutes', () => {
  it('resets only with the confirm token and passes the worker seam', async () => {
    const worker = {
      resetWorkerState: vi.fn(async () => {}),
    };
    const resetStudioData = vi.fn(async () => ({
      ok: true,
      resetAt: '2026-05-29T00:00:00.000Z',
      libraryDir: 'D:/library',
      defaultWorkspaceId: 'default',
    }));

    const routes = createStudioControlRoutes({ resetStudioData, worker });

    for (const body of [undefined, '{"confirm":"purge-trash"}']) {
      const rejected = await routes.request('/reset', { method: 'POST', body });
      expect(rejected.status, String(body)).toBe(400);
      await expect(rejected.json()).resolves.toMatchObject({ code: 'confirmation_required' });
    }
    expect(resetStudioData).not.toHaveBeenCalled();

    const response = await routes.request('/reset', {
      method: 'POST',
      body: JSON.stringify({ confirm: STUDIO_RESET_CONFIRMATION }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ ok: true, defaultWorkspaceId: 'default' }),
    );
    expect(resetStudioData).toHaveBeenCalledWith(worker);
  });
});
