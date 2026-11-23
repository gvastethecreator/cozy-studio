import { readStorageAuditReport, type StorageAuditPaths } from './storageAudit';

declare const self: Worker;

self.onmessage = async (event: MessageEvent<StorageAuditPaths>) => {
  try {
    self.postMessage({ ok: true, report: await readStorageAuditReport(event.data) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
