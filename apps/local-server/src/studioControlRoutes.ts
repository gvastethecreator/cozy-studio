import { Hono } from 'hono';
import { STUDIO_RESET_CONFIRMATION } from '../../../packages/shared/src';
import type { resetStudioData } from './reset';

interface StudioControlRoutesDependencies {
  resetStudioData: typeof resetStudioData;
  worker: { resetWorkerState(): Promise<void> };
}

export function createStudioControlRoutes({
  resetStudioData,
  worker,
}: StudioControlRoutesDependencies) {
  const routes = new Hono();

  routes.post('/reset', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body?.confirm !== STUDIO_RESET_CONFIRMATION) {
      return c.json(
        {
          error: `Send {"confirm":"${STUDIO_RESET_CONFIRMATION}"} to reset Studio. This deletes the Library database and folders and signs out providers.`,
          code: 'confirmation_required',
        },
        400,
      );
    }
    return c.json(await resetStudioData(worker));
  });

  return routes;
}
