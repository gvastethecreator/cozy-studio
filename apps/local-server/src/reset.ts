import { existsSync, rmSync } from 'node:fs';
import { getSubscriptionAuthController } from './auth/controller';
import { getGoogleCredentialsStore } from './auth/googleCredentials';
import { getSettings } from './config';
import { stopAppServer } from './codex/processSupervisor';
import { migrateDb } from './db/migrations';
import { closeDb } from './db/connection';
import { ensureDefaultWorkspace } from './db/workspaces';
import { LIBRARY_FOLDERS, ensureLibrary, resolveLibraryPath } from './library';
import { ensureDefaultLibrary } from './libraries';
import { log } from './logger';
import { closeRotatingLogs } from './rotatingLog';

const LIBRARY_RESET_TARGETS = ['library.sqlite', ...LIBRARY_FOLDERS] as const;

export async function resetStudioData(worker: { resetWorkerState(): Promise<void> }) {
  await worker.resetWorkerState();
  await stopAppServer();
  await Promise.all([
    getSubscriptionAuthController().logout('codex'),
    getSubscriptionAuthController().logout('xai'),
    getSubscriptionAuthController().logout('google'),
  ]);
  try {
    getGoogleCredentialsStore().clear('all');
  } catch {
    // Best effort: preserve reset completion if credentials store is absent or unwritable.
  }
  closeDb();
  closeRotatingLogs();

  for (const target of LIBRARY_RESET_TARGETS) {
    const targetPath = resolveLibraryPath(target);
    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true, force: true });
    }
  }

  ensureLibrary();
  migrateDb();
  ensureDefaultLibrary();
  const defaultWorkspace = ensureDefaultWorkspace();
  const settings = getSettings();
  const defaultWorkspaceId = defaultWorkspace?.id ?? 'default';

  log(
    'warn',
    'reset',
    `Studio reset complete. Library recreated at ${settings.libraryDir}. Default workspace: ${defaultWorkspaceId}`,
  );

  return {
    ok: true,
    resetAt: new Date().toISOString(),
    libraryDir: settings.libraryDir,
    defaultWorkspaceId,
  };
}
