import { Hono } from 'hono';
import type { CodexRuntimeDoctorReport } from '../../../packages/shared/src';
import type { GrokRuntimeDoctorReport } from './grokRuntimeDoctor';
import {
  loadAntigravityRuntimeDoctor,
  type AntigravityRuntimeDoctorReport,
} from './antigravityRuntimeDoctor';
import { readGenerationProviderRuntimePreflights } from './providers/runtimeConfig';
import { readProviderCapabilities } from './providerCapabilities';
import type { readEditableStudioSettings } from './studioSettingsStore';

type MaybePromise<T> = T | Promise<T>;

interface ProviderRoutesDependencies {
  readSettings: () => ReturnType<typeof readEditableStudioSettings>;
  readCodexRuntimeDoctor: () => CodexRuntimeDoctorReport;
  /** Provider status waits for each CLI's first probe, so it never reports a checking state. */
  loadGrokRuntimeDoctor: () => MaybePromise<GrokRuntimeDoctorReport>;
  loadAntigravityRuntimeDoctor?: () => MaybePromise<AntigravityRuntimeDoctorReport>;
}

export function createProviderRoutes({
  readSettings,
  readCodexRuntimeDoctor: readCodexRuntimeDoctorFn,
  loadGrokRuntimeDoctor: loadGrokRuntimeDoctorFn,
  loadAntigravityRuntimeDoctor: loadAntigravityRuntimeDoctorFn = loadAntigravityRuntimeDoctor,
}: ProviderRoutesDependencies) {
  const routes = new Hono();

  const readRuntimes = async () => {
    const [grokRuntime, antigravityRuntime] = await Promise.all([
      loadGrokRuntimeDoctorFn(),
      loadAntigravityRuntimeDoctorFn(),
    ]);
    return { codexRuntime: readCodexRuntimeDoctorFn(), grokRuntime, antigravityRuntime };
  };

  routes.get('/', async (c) => {
    const { codexRuntime, grokRuntime, antigravityRuntime } = await readRuntimes();
    const preflights = readGenerationProviderRuntimePreflights(
      process.env,
      codexRuntime,
      grokRuntime,
      antigravityRuntime,
    );
    return c.json(
      readProviderCapabilities(
        readSettings(),
        process.env,
        codexRuntime,
        grokRuntime,
        undefined,
        antigravityRuntime,
        preflights,
      ),
    );
  });

  routes.get('/preflight', async (c) => {
    const { codexRuntime, grokRuntime, antigravityRuntime } = await readRuntimes();
    return c.json({
      providers: readGenerationProviderRuntimePreflights(
        process.env,
        codexRuntime,
        grokRuntime,
        antigravityRuntime,
      ),
    });
  });

  return routes;
}
