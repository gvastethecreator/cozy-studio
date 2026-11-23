import { vacuumStorageDatabase } from './storageVacuum';

declare const self: Worker;

self.onmessage = async (event: MessageEvent<{ dbPath: string }>) => {
  try {
    self.postMessage({ ok: true, checkpoint: await vacuumStorageDatabase(event.data.dbPath) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
