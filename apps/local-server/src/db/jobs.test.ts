import { DatabaseSync } from 'node:sqlite';
import type { Database } from 'bun:sqlite';
import { describe, expect, it, vi } from 'vitest';

import { getJobStatus, listJobSummariesFromDb, mapJobRow } from './jobs';

describe('getJobStatus', () => {
  it('returns result notices so a completed size mismatch is visible without review', () => {
    const sqlite = new DatabaseSync(':memory:');
    const db = { query: (sql: string) => sqlite.prepare(sql) } as unknown as Database;
    sqlite.exec(`
      CREATE TABLE jobs (id TEXT, status TEXT, error TEXT, updated_at TEXT);
      CREATE TABLE job_events (id INTEGER PRIMARY KEY, job_id TEXT, type TEXT, message TEXT);
      INSERT INTO jobs VALUES ('job-1', 'completed', NULL, '2026-11-02T00:00:00.000Z');
      INSERT INTO job_events (job_id, type, message) VALUES
        ('job-1', 'asset.created', 'Asset imported.'),
        ('job-1', 'asset.dimensions.info', 'Requested image size 1024x1024; provider returned 1024x1536. Original dimensions preserved.'),
        ('job-2', 'asset.dimensions.info', 'Another job.');
    `);

    expect(getJobStatus('job-1', db)).toEqual({
      id: 'job-1',
      status: 'completed',
      error: null,
      updatedAt: '2026-11-02T00:00:00.000Z',
      notices: [
        'Requested image size 1024x1024; provider returned 1024x1536. Original dimensions preserved.',
      ],
    });
    expect(getJobStatus('missing', db)).toBeNull();
  });
});

describe('listJobSummariesFromDb', () => {
  it('uses projected columns without reading the Generation Task Spec', () => {
    const query = vi.fn((sql: string) => {
      expect(sql).not.toContain('source_spec_json');
      if (sql.includes('GROUP BY status'))
        return { all: () => [{ status: 'completed', count: 1 }] };
      if (sql.includes('COUNT(*)')) return { get: () => ({ count: 0 }) };
      if (sql.includes('SELECT DISTINCT') || !sql.includes("'completed', 'failed', 'cancelled'"))
        return { all: () => [] };
      return {
        all: () => [
          {
            id: 'job-1',
            workspace_id: 'workspace-1',
            recipe_id: 'styles',
            batch_id: 'batch-1',
            aspect_ratio: '2:3',
            kind: 'image_generate',
            provider_id: 'codex',
            status: 'completed',
            execution_json: null,
            prompt_preview: 'final prompt',
            error: null,
            created_at: '2026-08-08T00:00:00.000Z',
            updated_at: '2026-08-08T00:00:01.000Z',
            completed_at: '2026-08-08T00:00:01.000Z',
          },
        ],
      };
    });

    const summaries = listJobSummariesFromDb({
      query,
      transaction: (read: () => unknown) => read,
    } as never);

    expect(summaries.history).toEqual([
      expect.objectContaining({
        id: 'job-1',
        workspaceId: 'workspace-1',
        recipeId: 'styles',
        batchId: 'batch-1',
        aspectRatio: '2:3',
        promptPreview: 'final prompt',
      }),
    ]);
  });
});

describe('mapJobRow', () => {
  it('keeps the output folder and naming captured when the job was created', () => {
    const job = mapJobRow({
      id: 'job-1',
      kind: 'image_generate',
      status: 'queued',
      original_prompt: 'owl',
      final_prompt_used: 'owl',
      created_at: '2026-09-28T00:00:00.000Z',
      updated_at: '2026-09-28T00:00:00.000Z',
      library_id: 'library-1',
      library_root: 'D:/library',
      library_context_json: JSON.stringify({
        libraryId: 'stale',
        rootPath: 'D:/stale',
        output: { libraryId: 'pictures', rootPath: 'C:/Users/a/Pictures/Cozy Studio' },
        outputOrganization: { subfolderTokens: [], fileNameTemplate: '{date}_{style}_{prompt}' },
      }),
    });

    expect(job.libraryContext).toEqual({
      libraryId: 'library-1',
      rootPath: 'D:/library',
      output: { libraryId: 'pictures', rootPath: 'C:/Users/a/Pictures/Cozy Studio' },
      outputOrganization: { subfolderTokens: [], fileNameTemplate: '{date}_{style}_{prompt}' },
    });
  });
});
