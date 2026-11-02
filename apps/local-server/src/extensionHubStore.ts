import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite, resolveSubscriptionAuthFilePath } from './auth/store';
import type { ExtensionHub } from './extensionSources';

/**
 * The private hub the user unlocked in Settings > Extensions. Its password is a Provider Secret, so
 * it lives in a private file next to Studio's sign-in tokens, never in SQLite-backed Settings.
 */
export interface ExtensionHubStore {
  read(): ExtensionHub | null;
  save(hub: ExtensionHub): void;
  clear(): void;
}

export function resolveExtensionHubFilePath() {
  return path.join(path.dirname(resolveSubscriptionAuthFilePath()), 'extension-hub.json');
}

export function createExtensionHubStore(
  filePath = resolveExtensionHubFilePath(),
): ExtensionHubStore {
  return {
    read() {
      if (!existsSync(filePath)) return null;
      try {
        const value = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<ExtensionHub>;
        return typeof value.url === 'string' && typeof value.password === 'string'
          ? { url: value.url, password: value.password }
          : null;
      } catch {
        return null;
      }
    },
    save(hub) {
      atomicWrite(filePath, `${JSON.stringify(hub)}\n`);
    },
    clear() {
      rmSync(filePath, { force: true });
    },
  };
}
