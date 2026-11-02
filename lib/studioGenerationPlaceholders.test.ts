import { describe, expect, it } from 'vitest';

import { createGenerationTaskSpec, type Job } from '../packages/shared/src';
import { toShellActivityJob } from './shellActivityJob';
import { buildStudioGenerationPlaceholders } from './studioGenerationPlaceholders';

describe('buildStudioGenerationPlaceholders', () => {
  it('projects active generation jobs into grid placeholders', () => {
    const sourceSpec = createGenerationTaskSpec({
      id: 'spec-batch-1-1-1',
      task: 'image_generate',
      providerId: 'codex',
      prompt: 'Server prompt',
      output: { aspectRatio: '2:3' },
      metadata: { workspaceId: 'default' },
    });
    const runningJob: Job = {
      id: 'studio-1',
      workspaceId: 'default',
      kind: 'image_generate',
      providerId: 'codex',
      sourceSpec,
      status: 'running',
      execution: null,
      originalPrompt: 'Server prompt',
      expandedPrompt: null,
      finalPromptUsed: 'Server prompt',
      error: null,
      createdAt: '2026-06-22T10:00:00.000Z',
      updatedAt: '2026-06-22T10:00:01.000Z',
      completedAt: null,
    };

    expect(
      buildStudioGenerationPlaceholders({
        activeWorkspaceId: 'default',
        fallbackAspectRatio: '1:1',
        studioJobs: [
          toShellActivityJob(runningJob, 'backend_event'),
          toShellActivityJob({ ...runningJob, id: 'done-1', status: 'completed' }, 'backend_event'),
          toShellActivityJob(
            { ...runningJob, id: 'review-1', status: 'needs_review' },
            'backend_event',
          ),
        ],
      }),
    ).toEqual([
      {
        id: 'server-studio-1',
        status: 'running',
        aspectRatio: '2:3',
        prompt: 'Server prompt',
        createdAt: Date.parse('2026-06-22T10:00:00.000Z'),
      },
    ]);
  });
});
