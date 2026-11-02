import { Hono } from 'hono';
import type { listLibraries } from './libraries';

export interface LibrariesRoutesDependencies {
  listLibraries: typeof listLibraries;
}

export function createLibrariesRoutes({ listLibraries }: LibrariesRoutesDependencies) {
  const routes = new Hono();

  routes.get('/', (c) => c.json(listLibraries()));

  return routes;
}
