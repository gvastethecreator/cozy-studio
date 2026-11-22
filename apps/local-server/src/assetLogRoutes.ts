import { Hono } from 'hono';
import type { Asset, SystemLog } from '../../../packages/shared/src';
import type { LogFilter } from './db/events';

interface AssetLogRoutesDependencies {
  listAssets: () => Asset[];
  listLogs: (filter: LogFilter) => SystemLog[];
}

const LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error']);

export function createAssetLogRoutes({ listAssets, listLogs }: AssetLogRoutesDependencies) {
  const routes = new Hono();

  routes.get('/assets', (c) => c.json(listAssets()));
  // ?level=error&limit=10 reads the newest errors without the rest of the log.
  routes.get('/logs', (c) => {
    const level = c.req.query('level');
    const limit = c.req.query('limit');
    if (level !== undefined && !LOG_LEVELS.has(level)) {
      return c.json({ error: 'level must be debug, info, warn or error.' }, 400);
    }
    if (limit !== undefined && !/^\d+$/.test(limit)) {
      return c.json({ error: 'limit must be a whole number.' }, 400);
    }
    return c.json(
      listLogs({
        level: level as SystemLog['level'] | undefined,
        limit: limit === undefined ? undefined : Math.min(Math.max(Number(limit), 1), 300),
      }),
    );
  });

  return routes;
}
