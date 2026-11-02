import type { Job } from '../../../packages/shared/src';
import {
  parseLibraryOrganization,
  type LibraryOrganization,
} from '../../../packages/shared/src/catalogCollections';
import { isRecord } from '../../../packages/shared/src/types';
import { normalizeWorkspaceId } from '../../../packages/shared/src/workspaceContracts';

export interface JobCatalogContext {
  workspaceId: string;
  batchId: string | null;
  organization?: LibraryOrganization;
}

function readMetadataString(job: Pick<Job, 'sourceSpec'>, key: string) {
  const metadata = job.sourceSpec?.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const candidate = (metadata as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function readLibraryOrganization(job: Pick<Job, 'sourceSpec'>) {
  const metadata = job.sourceSpec?.metadata;
  // Intake validates filing; old or malformed metadata must never fail a finalization.
  try {
    return parseLibraryOrganization(isRecord(metadata) ? metadata.libraryOrganization : null);
  } catch {
    return null;
  }
}

export function resolveJobCatalogContext(
  job: Pick<Job, 'workspaceId' | 'sourceSpec' | 'batchId'>,
): JobCatalogContext {
  const fromColumn =
    typeof job.workspaceId === 'string' && job.workspaceId.trim() ? job.workspaceId.trim() : null;
  const fromMetadata = readMetadataString(job, 'workspaceId');
  const organization = readLibraryOrganization(job);
  return {
    workspaceId: normalizeWorkspaceId(fromColumn ?? fromMetadata),
    batchId:
      (typeof job.batchId === 'string' && job.batchId.trim() ? job.batchId.trim() : null) ??
      readMetadataString(job, 'batchId'),
    ...(organization && { organization }),
  };
}
