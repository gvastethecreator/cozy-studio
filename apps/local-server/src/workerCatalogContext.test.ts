import { describe, expect, it } from 'vitest';

import { createGenerationTaskSpec, type Job } from '../../../packages/shared/src';
import { resolveJobCatalogContext } from './workerCatalogContext';

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: overrides.id ?? 'job-1',
    // Empty column simulates pre-backfill rows so metadata dual-read can be tested.
    workspaceId: overrides.workspaceId ?? '',
    kind: overrides.kind ?? 'image_generate',
    providerId: overrides.providerId ?? null,
    sourceSpec: overrides.sourceSpec ?? null,
    status: overrides.status ?? 'queued',
    execution: overrides.execution ?? null,
    originalPrompt: overrides.originalPrompt ?? 'prompt',
    expandedPrompt: overrides.expandedPrompt ?? null,
    finalPromptUsed: overrides.finalPromptUsed ?? 'prompt',
    error: overrides.error ?? null,
    createdAt: overrides.createdAt ?? '2026-05-25T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-25T00:00:00.000Z',
    completedAt: overrides.completedAt ?? null,
  };
}

describe('resolveJobCatalogContext', () => {
  it('prefers workspace and batch metadata from the Generation Task Spec', () => {
    const sourceSpec = createGenerationTaskSpec({
      id: 'spec-1',
      task: 'image_generate',
      prompt: 'prompt',
      metadata: {
        workspaceId: 'concepts',
        batchId: 'batch-9',
        libraryOrganization: { tags: ['#Cover', 'cover'], collection: ' Covers ' },
      },
    });

    expect(resolveJobCatalogContext(job({ sourceSpec }))).toEqual({
      workspaceId: 'concepts',
      batchId: 'batch-9',
      organization: { tags: ['cover'], collection: 'Covers' },
    });
  });

  it('falls back to the default workspace and no filing when metadata is absent or malformed', () => {
    const sourceSpec = createGenerationTaskSpec({
      id: 'spec-1',
      task: 'image_generate',
      prompt: 'prompt',
      metadata: {
        workspaceId: '   ',
        batchId: 42,
        libraryOrganization: { tags: 'cover' },
      },
    });

    expect(resolveJobCatalogContext(job({ sourceSpec }))).toEqual({
      workspaceId: 'default',
      batchId: null,
    });
  });
});
