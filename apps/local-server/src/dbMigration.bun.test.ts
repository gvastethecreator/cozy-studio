import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createJob,
  getJob,
  getJobStatus,
  listJobSummaries,
  listRecoverableJobs,
  updateJobFinalization,
  updateJobRemoteExecution,
  updateJobStatus,
  updateJobFinalPrompt,
  listJobAttempts,
  markReviewJobFailed,
  readJobsSummaryFromDb,
  requeueJob,
} from './db/jobs';
import { listJobEvents } from './db/events';
import { getOutputGeneration } from './db/outputGenerations';
import { createJobBatchRoutes } from './jobBatchRoutes';
import { createPersistentJobIntake } from './persistentJobIntake';
import {
  createJobBatch,
  getJobBatch,
  getJobBatchSummary,
  findAcceptedJobBatch,
  retryFailedJobBatch,
} from './db/jobBatches';
import type { Job, RetryJobBatchResponse } from '../../../packages/shared/src';
import { addAsset, getAssetByJobId } from './db/assets';
import { LATEST_DATABASE_SCHEMA_VERSION, migrateDatabase } from './db/migrations';
import { createGenerationTaskSpec } from '../../../packages/shared/src/generationContracts';

/** A migrated database with one queued job and the asset, catalog, turn and event rows of it. */
function createSeededDatabase() {
  const database = new Database(':memory:');
  database.run('PRAGMA foreign_keys = ON');
  migrateDatabase(database);
  database
    .query(
      `INSERT INTO jobs (
        id, workspace_id, kind, status, original_prompt, final_prompt_used, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'job-sentinel',
      'default',
      'image_generate',
      'queued',
      'sentinel prompt',
      'sentinel prompt',
      '2026-01-01',
      '2026-01-01',
    );
  database
    .query('INSERT INTO libraries (id, name, path, is_default, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('library-sentinel', 'Sentinel Library', 'D:/library', 1, '2026-01-01');
  database
    .query(
      `INSERT INTO assets (
        id, job_id, file_path, thumbnail_path, public_url, prompt,
        width, height, mime_type, created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'asset-sentinel',
      'job-sentinel',
      'D:/library/outputs/sentinel.png',
      null,
      '/library/library-sentinel/outputs/sentinel.png',
      'sentinel prompt',
      1024,
      1024,
      'image/png',
      '2026-01-01',
      null,
    );
  database
    .query(
      `INSERT INTO catalog_images (
        id, library_id, file_path, public_url, mime_type, job_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'catalog-sentinel',
      'library-sentinel',
      'D:/library/outputs/sentinel.png',
      '/library/library-sentinel/outputs/sentinel.png',
      'image/png',
      'job-sentinel',
      '2026-01-01',
    );
  database
    .query(
      `INSERT INTO codex_turns (
        id, job_id, codex_thread_id, codex_turn_id, transcript_path, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'turn-sentinel',
      'job-sentinel',
      'thread-sentinel',
      'turn-runtime-sentinel',
      null,
      'completed',
      '2026-01-01',
      '2026-01-01',
    );
  database
    .query(
      'INSERT INTO job_events (job_id, type, message, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run('job-sentinel', 'created', 'Sentinel event', null, '2026-01-01');
  return database;
}

function readColumnNames(database: Database) {
  return (database.query('PRAGMA table_info(jobs)').all() as Array<{ name: string }>).map(
    (column) => column.name,
  );
}

function inspectOutputGenerations() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'studio-output-generations-'));
  const databasePath = path.join(root, 'library.sqlite');
  let sequenceDb = new Database(databasePath);
  try {
    migrateDatabase(sequenceDb);
    const jobs = Array.from({ length: 10 }, (_, index) =>
      createJob({ id: `sequence-${index + 1}`, kind: 'image_generate', prompt: 'owl' }, sequenceDb),
    );
    const ninth = jobs[8]!;
    const tenth = jobs[9]!;
    // Completion order and retries must not change admission order.
    updateJobStatus(tenth.id, 'completed', null, sequenceDb);
    updateJobStatus(ninth.id, 'failed', 'retry fixture', sequenceDb);
    requeueJob(ninth.id, sequenceDb);
    if (getOutputGeneration(`job:${tenth.id}`, sequenceDb) !== 10) return false;
    if (getOutputGeneration(`job:${ninth.id}`, sequenceDb) !== 9) return false;
    sequenceDb.close();
    sequenceDb = new Database(databasePath);
    migrateDatabase(sequenceDb);
    if (getOutputGeneration(`job:${ninth.id}`, sequenceDb) !== 9) return false;

    const atlasNumber = getOutputGeneration('workflow:atlas-sequence', sequenceDb);
    if (atlasNumber !== 11 || getOutputGeneration('workflow:atlas-sequence', sequenceDb) !== 11) {
      return false;
    }
    return getOutputGeneration('workflow:animation-sequence', sequenceDb) === 12;
  } finally {
    sequenceDb.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function inspectPreMigrationBackup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'studio-pre-migration-'));
  const backupDir = path.join(root, 'state', 'pre-migration');
  const latest = LATEST_DATABASE_SCHEMA_VERSION;
  const latestApplied = (db: Database) =>
    (db.query('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number })
      .version;
  const listBackups = () => readdirSync(backupDir).sort();
  const db = new Database(path.join(root, 'studio.sqlite'));
  let failingDb: Database | null = null;
  try {
    db.run('PRAGMA journal_mode = WAL');
    migrateDatabase(db);
    // A new database has nothing to protect.
    if (existsSync(backupDir)) return false;

    createJob({ id: 'backup-sentinel', kind: 'image_generate', prompt: 'owl' }, db);
    mkdirSync(backupDir, { recursive: true });
    for (const day of ['01', '02', '03']) {
      writeFileSync(
        path.join(backupDir, `studio-2026-01-${day}T00-00-00-000Z-schema-v1.sqlite`),
        '',
      );
    }
    writeFileSync(path.join(backupDir, 'notes.txt'), 'kept');
    // The newest migration only rewrites repeated prompts, so removing its ledger row runs it again.
    db.query('DELETE FROM schema_migrations WHERE version = ?').run(latest);
    migrateDatabase(db);
    const backups = listBackups();
    const newest = backups.filter((name) => name !== 'notes.txt').at(-1) ?? '';
    // The sentinel job is still in the WAL; VACUUM INTO must include it.
    const copy = new Database(path.join(backupDir, newest), { readonly: true });
    const copyVersion = latestApplied(copy);
    const copyHasSentinel = Boolean(getJob('backup-sentinel', copy));
    copy.close();
    migrateDatabase(db);

    // A failed backup stops the migration and leaves the database unchanged.
    const failingRoot = path.join(root, 'failing');
    mkdirSync(failingRoot);
    failingDb = new Database(path.join(failingRoot, 'studio.sqlite'));
    migrateDatabase(failingDb);
    writeFileSync(path.join(failingRoot, 'state'), 'not a folder');
    failingDb.query('DELETE FROM schema_migrations WHERE version = ?').run(latest);
    let failure = '';
    try {
      migrateDatabase(failingDb);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    return (
      /^studio-\d{4}-\d{2}-\d{2}T[\d-]+Z-schema-v\d+\.sqlite$/.test(newest) &&
      newest.endsWith(`-schema-v${latest - 1}.sqlite`) &&
      copyVersion === latest - 1 &&
      copyHasSentinel &&
      latestApplied(db) === latest &&
      // Retention keeps the newest 3 copies, ignores other files, and an up-to-date start adds none.
      JSON.stringify(listBackups()) ===
        JSON.stringify([
          'notes.txt',
          'studio-2026-01-02T00-00-00-000Z-schema-v1.sqlite',
          'studio-2026-01-03T00-00-00-000Z-schema-v1.sqlite',
          newest,
        ]) &&
      failure.includes(`Studio did not update the database from schema v${latest - 1}`) &&
      failure.includes('The database is unchanged.') &&
      latestApplied(failingDb) === latest - 1
    );
  } finally {
    db.close();
    failingDb?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function inspectJobHistory() {
  const historyDb = createSeededDatabase();
  try {
    migrateDatabase(historyDb);
    historyDb.query("UPDATE jobs SET workspace_id = 'history-a', status = 'running'").run();
    const insert = historyDb.query(`INSERT INTO jobs (id, workspace_id, kind, provider_id, status,
      original_prompt, final_prompt_used, created_at, updated_at)
      VALUES (?, ?, 'image_generate', 'codex', ?, 'prompt', 'prompt', ?, ?)`);
    const timestamp = '2026-09-05T12:00:00.000Z';
    for (let index = 0; index < 103; index += 1) {
      const status = index === 0 ? 'failed' : index === 1 ? 'cancelled' : 'completed';
      insert.run(
        `history-${String(index).padStart(3, '0')}`,
        'history-a',
        status,
        timestamp,
        timestamp,
      );
    }
    insert.run('other-review', 'history-b', 'needs_review', timestamp, timestamp);
    const first = listJobSummaries({ workspaceId: 'history-a', limit: 20 }, historyDb);
    // A terminal event while older pages are being read must not move the cursor or duplicate rows.
    historyDb
      .query("UPDATE jobs SET status = 'completed', updated_at = ? WHERE id = 'job-sentinel'")
      .run(timestamp);
    const ids = first.history.map((job) => job.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = listJobSummaries({ workspaceId: 'history-a', limit: 20, cursor }, historyDb);
      ids.push(...page.history.map((job) => job.id));
      cursor = page.nextCursor;
    }
    const failed = listJobSummaries({ workspaceId: 'history-a', status: 'failed' }, historyDb);
    const cancelled = listJobSummaries(
      { workspaceId: 'history-a', status: 'cancelled' },
      historyDb,
    );
    let rejectsInvalidCursor = false;
    try {
      listJobSummaries({ cursor: 'invalid' }, historyDb);
    } catch {
      rejectsInvalidCursor = true;
    }
    return (
      first.open.some((job) => job.id === 'job-sentinel') &&
      first.history.length === 20 &&
      first.counts.open === 1 &&
      first.counts.history === 103 &&
      first.globalOpenCount === 2 &&
      ids.length === 104 &&
      new Set(ids).size === 104 &&
      ids.includes('job-sentinel') &&
      failed.history[0]?.id === 'history-000' &&
      failed.counts.history === 1 &&
      failed.counts.open === 0 &&
      cancelled.history[0]?.id === 'history-001' &&
      cancelled.counts.history === 1 &&
      failed.workspaces.some((workspace) => workspace.id === 'history-b') &&
      rejectsInvalidCursor
    );
  } finally {
    historyDb.close();
  }
}

function inspectJobsSummary() {
  const summaryDb = createSeededDatabase();
  try {
    migrateDatabase(summaryDb);
    summaryDb.query("UPDATE jobs SET status = 'completed'").run();
    summaryDb
      .query("INSERT OR REPLACE INTO workspaces (id, name, created_at) VALUES ('ws-a', 'Alpha', ?)")
      .run('2026-11-20T00:00:00.000Z');
    const insert = summaryDb.query(`INSERT INTO jobs (id, workspace_id, batch_id, kind, provider_id,
      status, original_prompt, final_prompt_used, error, created_at, updated_at)
      VALUES (?, 'ws-a', ?, 'image_generate', 'chatgpt', ?, ?, '', ?, ?, ?)`);
    const at = Date.parse('2026-11-20T12:00:00.000Z');
    const ago = (minutes: number) => new Date(at - minutes * 60_000).toISOString();
    for (const [id, batchId, status, minutes, error] of [
      ['a-1', 'batch-a', 'running', 1, null],
      ['a-2', 'batch-a', 'queued', 2, null],
      ['a-3', 'batch-a', 'completed', 3, null],
      ['solo', null, 'queued', 5, null],
      ['stuck', null, 'running', 45, null],
      ['f-1', 'batch-f', 'failed', 30, 'Quota reached'],
      ['f-2', 'batch-f', 'failed', 40, 'Older error'],
      ['f-old', 'batch-old', 'failed', 25 * 60, 'Yesterday'],
      ['r-1', 'batch-r', 'needs_review', 60, null],
      ['r-2', 'batch-r', 'needs_review', 61, null],
    ] as const)
      insert.run(id, batchId, status, `prompt ${id}`, error, ago(minutes), ago(minutes));
    const queries: string[] = [];
    const recording = new Proxy(summaryDb, {
      get(target, key) {
        if (key === 'query')
          return (sql: string) => {
            queries.push(sql);
            return target.query(sql);
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const summary = readJobsSummaryFromDb(recording, at);
    // No summary query may walk the whole job table, which holds every finished job.
    const tableScans = queries.flatMap((sql) =>
      (summaryDb.query(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>)
        .map(({ detail }) => detail)
        .filter((detail) => detail.startsWith('SCAN jobs')),
    );
    const active = listJobSummaries({ status: 'active' }, summaryDb);
    const running = listJobSummaries({ status: 'running' }, summaryDb);
    return (
      queries.length === 5 &&
      tableScans.length === 0 &&
      JSON.stringify(summary.counts) ===
        JSON.stringify({ queued: 2, running: 2, needs_review: 2 }) &&
      summary.reviewGroups === 1 &&
      JSON.stringify(summary.longRunning) ===
        JSON.stringify({ count: 1, jobId: 'stuck', since: ago(45) }) &&
      summary.active.map(({ batchId, jobId }) => `${batchId}:${jobId}`).join() ===
        'batch-a:a-1,null:solo,null:stuck' &&
      summary.active[0]?.counts.completed === 1 &&
      summary.active[0]?.workspaceName === 'Alpha' &&
      summary.recentFailures.length === 1 &&
      summary.recentFailures[0]?.failed === 2 &&
      summary.recentFailures[0]?.error === 'Quota reached' &&
      active.open.length === 6 &&
      active.history.length === 0 &&
      running.open.map(({ id }) => id).join() === 'a-1,stuck' &&
      running.history.length === 0
    );
  } finally {
    summaryDb.close();
  }
}

async function inspectJobBatches() {
  const batchDb = createSeededDatabase();
  try {
    migrateDatabase(batchDb);
    let sequence = 0;
    const dispatched: Job[] = [];
    const dispatchedCount = () => dispatched.length;
    const store = {
      createJobBatch: (id: string, hash: string, items: Parameters<typeof createJobBatch>[2]) =>
        createJobBatch(id, hash, items, batchDb),
      getJobBatch: (id: string) => getJobBatch(id, batchDb),
      getJobBatchSummary: (id: string) => getJobBatchSummary(id, batchDb),
      findAcceptedJobBatch: (id: string, hash: string) => findAcceptedJobBatch(id, hash, batchDb),
      retryFailedJobBatch: (
        id: string,
        request: Parameters<typeof retryFailedJobBatch>[1],
        hash: string,
      ) => retryFailedJobBatch(id, request, hash, batchDb),
    };
    const intake = createPersistentJobIntake({
      createJobId: () => `batch-job-${++sequence}`,
      createJob: (input) => createJob(input, batchDb),
      updateJobFinalPrompt: (id, prompt) => updateJobFinalPrompt(id, prompt, batchDb),
      processReferences: async (_id, prompt) => ({ augmentedPrompt: prompt, persistedRefs: [] }),
      hydrateSourceSpecAssetPaths: (spec) => spec,
      readLibraryDir: () => 'X:/isolated-fixture',

      resolveProviderExecutionBlocker: () => null,
      isReferenceProcessingError: (_error): _error is never => false,
      publishEvent: (type, payload) => ({ type, payload, createdAt: new Date().toISOString() }),
      logJobCreated: () => {},
      enqueueJob: (job) => {
        const batch = store.getJobBatch(job.batchId!);
        if (!batch || batch.jobs.length !== batch.requestedCount)
          throw new Error('Dispatch observed an incomplete batch.');
        dispatched.push(job);
      },
    });
    let cancelDuringPreflight: string | null = null;
    const routes = createJobBatchRoutes({
      store,
      intake,
      resolveProviderExecutionBlocker: async () => {
        if (cancelDuringPreflight)
          updateJobStatus(cancelDuringPreflight, 'cancelled', null, batchDb);
        return null;
      },
    });
    const post = (path: string, body: unknown) =>
      routes.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const item = { kind: 'dry_run', prompt: 'draw', workspaceId: 'batch-workspace' };
    const count = () => (batchDb.query('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
    const before = count();
    const invalid = await post('/', {
      requestId: 'batch-invalid',
      items: [item, { ...item, prompt: '' }],
    });
    if (invalid.status !== 400 || count() !== before || dispatched.length)
      throw new Error('Invalid batch left accepted work.');
    const request = { requestId: 'batch-atomic', items: [item, item] };
    const [left, right] = await Promise.all([post('/', request), post('/', request)]);
    const accepted = store.getJobBatch(request.requestId)!;
    if (
      ![200, 201].includes(left.status) ||
      ![200, 201].includes(right.status) ||
      count() !== before + 2 ||
      dispatchedCount() !== 2 ||
      accepted.requestedCount !== 2
    )
      throw new Error('Concurrent delivery duplicated or lost batch members.');
    const conflict = await post('/', {
      ...request,
      items: [{ ...item, prompt: 'different' }, item],
    });
    if (conflict.status !== 409 || count() !== before + 2)
      throw new Error('Request identity accepted a different payload.');
    const [success, failure] = accepted.jobs;
    updateJobStatus(success.id, 'completed', null, batchDb);
    updateJobStatus(failure.id, 'failed', 'provider rejected request', batchDb);
    const keptAsset = addAsset(
      {
        jobId: success.id,
        filePath: 'outputs/kept.webp',
        thumbnailPath: null,
        publicUrl: '/kept.webp',
        prompt: 'draw',
        width: null,
        height: null,
        mimeType: 'image/webp',
      },
      batchDb,
    );
    const partial = store.getJobBatchSummary(request.requestId)!;
    if (
      partial.status !== 'partial' ||
      partial.counts.completed !== 1 ||
      partial.counts.failed !== 1 ||
      partial.retryable.length !== 1
    )
      throw new Error('Partial counts lost backend truth.');
    const retry = { requestId: 'retry-atomic', items: partial.retryable };
    const retries = await Promise.all([
      post('/batch-atomic/retry', retry),
      post('/batch-atomic/retry', retry),
    ]);
    const queuedJobIds = await Promise.all(
      retries.map(
        async (response) => ((await response.json()) as RetryJobBatchResponse).queuedJobIds,
      ),
    );
    if (
      retries.some((response) => response.status !== 200) ||
      queuedJobIds.flat().length !== 1 ||
      dispatchedCount() !== 3 ||
      getJob(failure.id, batchDb)?.attempt !== 2
    )
      throw new Error('Repeated retry duplicated dispatch.');
    const archived = listJobAttempts(failure.id, batchDb);
    if (
      archived.length !== 1 ||
      archived[0].job.error !== 'provider rejected request' ||
      archived[0].job.status !== 'failed'
    )
      throw new Error('Retry erased prior attempt evidence.');
    updateJobStatus(failure.id, 'failed', 'second failure', batchDb);
    await post('/batch-atomic/retry', retry);
    await post('/batch-atomic/retry', { ...retry, requestId: 'retry-stale-view' });
    if (dispatchedCount() !== 3 || getJob(failure.id, batchDb)?.status !== 'failed')
      throw new Error('Stale retry dispatched a later attempt.');
    cancelDuringPreflight = failure.id;
    await post('/batch-atomic/retry', {
      requestId: 'retry-cancel-race',
      items: [{ jobId: failure.id, attempt: 2 }],
    });
    cancelDuringPreflight = null;
    updateJobStatus(failure.id, 'needs_review', null, batchDb);
    await post('/batch-atomic/retry', {
      requestId: 'retry-uncertain',
      items: [{ jobId: failure.id, attempt: 2 }],
    });
    if (
      dispatchedCount() !== 3 ||
      getJob(success.id, batchDb)?.status !== 'completed' ||
      !batchDb.query('SELECT id FROM assets WHERE id = ?').get(keptAsset.id)
    )
      throw new Error('Retry lost success or dispatched an ineligible item.');
    if (store.getJobBatchSummary('batch-1'))
      throw new Error('Migration invented historical batch membership.');
    return true;
  } finally {
    batchDb.close();
  }
}

/** A database from before the baseline (schema 19 or older) is refused before any write. */
function inspectPreBaselineRefusal() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'studio-pre-baseline-'));
  const databasePath = path.join(root, 'studio.sqlite');
  let db = new Database(databasePath);
  try {
    migrateDatabase(db);
    createJob({ id: 'old-sentinel', kind: 'image_generate', prompt: 'owl' }, db);
    db.run('DELETE FROM schema_migrations WHERE version >= 20');
    db.close();
    const bytesBefore = readFileSync(databasePath);
    db = new Database(databasePath);
    let failure = '';
    try {
      migrateDatabase(db);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    db.close();
    return (
      failure.includes('it has schema version 19') &&
      failure.includes('The database is unchanged.') &&
      failure.includes('Studio v0.2.0') &&
      readFileSync(databasePath).equals(bytesBefore) &&
      !existsSync(path.join(root, 'state'))
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

describe('database migrations', () => {
  it('builds the schema idempotently and atomically and keeps job, batch and backup behavior', async () => {
    const database = createSeededDatabase();
    try {
      migrateDatabase(database);
      const migrationRows = database
        .query('SELECT version, name FROM schema_migrations ORDER BY version')
        .all() as Array<{ version: number; name: string }>;
      const indexes = database.query("PRAGMA index_list('jobs')").all() as Array<{ name: string }>;
      const requiredColumns = [
        'provider_id',
        'source_spec_json',
        'execution_json',
        'library_id',
        'library_root',
        'library_context_json',
        'finalization_state',
        'finalization_source_path',
        'finalization_file_path',
        'finalization_asset_id',
        'finalization_catalog_id',
        'workspace_id',
        'recipe_id',
        'batch_id',
        'aspect_ratio',
      ];
      const columns = readColumnNames(database);
      database
        .query(
          `UPDATE jobs
       SET provider_id = ?,
           source_spec_json = ?,
           workspace_id = ?,
           recipe_id = ?,
           batch_id = ?,
           aspect_ratio = ?
       WHERE id = ?`,
        )
        .run(
          'codex',
          JSON.stringify({
            recipeId: 'styles',
            output: { aspectRatio: '2:3' },
            metadata: { workspaceId: 'workspace-summary', batchId: 'batch-1' },
          }),
          'workspace-summary',
          'styles',
          'batch-1',
          '2:3',
          'job-sentinel',
        );
      const summaryPage = listJobSummaries({}, database);
      const summary = [...summaryPage.open, ...summaryPage.history].find(
        (job) => job.id === 'job-sentinel',
      );
      const createdJob = createJob(
        {
          id: 'job-workspace-only',
          workspaceId: 'workspace-created',
          kind: 'image_generate',
          providerId: 'codex',
          sourceSpec: createGenerationTaskSpec({
            id: 'spec-workspace-only',
            task: 'image_generate',
            providerId: 'codex',
            prompt: 'workspace-only prompt',
          }),
          prompt: 'workspace-only prompt',
          execution: {
            model: 'gpt-5.5',
            reasoningEffort: 'provider_default',
            providerOptions: {
              codex: {
                transport: 'subscription_http',
                image: { model: 'gpt-image-2', size: '1536x864', quality: 'medium' },
              },
            },
          },
        },
        database,
      );
      updateJobRemoteExecution(
        createdJob.id,
        { providerId: 'codex', phase: 'submitting', startedAt: 2000 },
        database,
      );
      const createdJobRow = database
        .query('SELECT workspace_id, source_spec_json FROM jobs WHERE id = ?')
        .get(createdJob.id) as { workspace_id: string; source_spec_json: string | null } | null;
      const asset = addAsset(
        {
          jobId: 'job-sentinel',
          filePath: 'D:/library/outputs/result.png',
          thumbnailPath: null,
          publicUrl: '/library/library-1/outputs/result.png',
          prompt: 'sentinel prompt',
          width: null,
          height: null,
          mimeType: 'image/png',
        },
        database,
      );
      const recoverableJobs = listRecoverableJobs(database);
      const checkpoint = updateJobFinalization(
        'job-sentinel',
        {
          state: 'asset_recorded',
          sourcePath: 'D:/provider/result.png',
          filePath: asset.filePath,
          assetId: asset.id,
          catalogId: null,
        },
        database,
      );
      // A new database is built in one transaction: a failure in the last step leaves no schema.
      const rollbackDatabase = new Database(':memory:');
      rollbackDatabase.run(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
      rollbackDatabase.run(`
    CREATE TRIGGER reject_last_migration
    BEFORE INSERT ON schema_migrations
    WHEN NEW.version = ${LATEST_DATABASE_SCHEMA_VERSION}
    BEGIN
      SELECT RAISE(ABORT, 'forced migration failure');
    END
  `);
      let migrationFailed = false;
      try {
        migrateDatabase(rollbackDatabase);
      } catch {
        migrationFailed = true;
      }
      const rolledBackMigrationCount = (
        rollbackDatabase.query('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
          count: number;
        }
      ).count;
      const rollbackTables = rollbackDatabase
        .query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      rollbackDatabase.close();
      const columnSet = new Set(columns);

      expect({
        idempotent:
          migrationRows.length === LATEST_DATABASE_SCHEMA_VERSION &&
          migrationRows.at(-1)?.version === LATEST_DATABASE_SCHEMA_VERSION &&
          requiredColumns.every((column) => columnSet.has(column)),
        workspaceOnlyJob:
          createdJob.workspaceId === 'workspace-created' &&
          createdJobRow?.workspace_id === 'workspace-created' &&
          JSON.parse(createdJobRow?.source_spec_json ?? '{}').metadata?.workspaceId ===
            'workspace-created',
        indexesPresent:
          indexes.some((index) => index.name === 'idx_jobs_library_created_desc') &&
          indexes.some((index) => index.name === 'idx_jobs_finalization_state'),
        transactionRolledBack:
          migrationFailed &&
          rolledBackMigrationCount === 0 &&
          rollbackTables.map(({ name }) => name).join() === 'schema_migrations',
        preBaselineRefused: inspectPreBaselineRefusal(),
        recoverableCheckpoint:
          checkpoint?.finalization?.state === 'asset_recorded' &&
          checkpoint.finalization.assetId === asset.id &&
          recoverableJobs.some(
            (job) =>
              job.id === 'job-sentinel' &&
              job.finalization?.state === 'catalog_recorded' &&
              job.finalization.assetId === 'asset-sentinel' &&
              job.finalization.catalogId === 'catalog-sentinel',
          ),
        summaryProjection:
          summary?.workspaceId === 'workspace-summary' &&
          summary.recipeId === 'styles' &&
          summary.batchId === 'batch-1' &&
          summary.aspectRatio === '2:3' &&
          summary.promptPreview === 'sentinel prompt' &&
          !summary.workspaceId?.includes('{'),
        schemaVersion: LATEST_DATABASE_SCHEMA_VERSION,
        completeJobHistory: inspectJobHistory(),
        jobsSummary: inspectJobsSummary(),
        atomicBatchRecovery: await inspectJobBatches(),
        durableOutputGenerations: inspectOutputGenerations(),
        preMigrationBackup: inspectPreMigrationBackup(),
        executionPolicyPreserved:
          getJob('job-workspace-only', database)?.execution?.providerOptions?.codex?.image?.size ===
            '1536x864' &&
          getJob('job-workspace-only', database)?.remoteExecution?.providerId === 'codex',
      }).toEqual({
        idempotent: true,
        workspaceOnlyJob: true,
        indexesPresent: true,
        transactionRolledBack: true,
        preBaselineRefused: true,
        recoverableCheckpoint: true,
        summaryProjection: true,
        schemaVersion: 24,
        completeJobHistory: true,
        jobsSummary: true,
        executionPolicyPreserved: true,
        atomicBatchRecovery: true,
        durableOutputGenerations: true,
        preMigrationBackup: true,
      });
    } finally {
      database.close();
    }
  });
});

describe('store-job-prompts-once migration', () => {
  it('stores a repeated prompt once and reads the same prompts back', () => {
    const database = createSeededDatabase();
    try {
      database
        .query(
          `INSERT INTO jobs (
            id, workspace_id, kind, status, original_prompt, final_prompt_used, created_at, updated_at
          ) VALUES (?, 'default', 'image_generate', 'completed', 'owl', 'owl, at dusk', ?, ?)`,
        )
        .run('job-rewritten', '2026-01-02', '2026-01-02');
      // The seeded rows repeat each prompt, as every database before migration 24 does.
      database.query('DELETE FROM schema_migrations WHERE version = 24').run();
      migrateDatabase(database);
      const stored = database
        .query('SELECT id, final_prompt_used AS final FROM jobs ORDER BY id')
        .all();
      const storedAsset = database
        .query("SELECT prompt FROM assets WHERE id = 'asset-sentinel'")
        .get();
      const readBack = {
        sentinel: getJob('job-sentinel', database)?.finalPromptUsed,
        rewritten: getJob('job-rewritten', database)?.finalPromptUsed,
        asset: getAssetByJobId('job-sentinel', null, database)?.prompt,
      };
      updateJobFinalPrompt('job-rewritten', 'owl', database);
      const rewrittenBack = database
        .query("SELECT final_prompt_used AS final FROM jobs WHERE id = 'job-rewritten'")
        .get();
      expect({
        stored,
        storedAsset,
        readBack,
        rewrittenBack,
        reread: getJob('job-rewritten', database)?.finalPromptUsed,
      }).toEqual({
        stored: [
          { id: 'job-rewritten', final: 'owl, at dusk' },
          { id: 'job-sentinel', final: '' },
        ],
        storedAsset: { prompt: '' },
        readBack: {
          sentinel: 'sentinel prompt',
          rewritten: 'owl, at dusk',
          asset: 'sentinel prompt',
        },
        rewrittenBack: { final: '' },
        reread: 'owl',
      });
    } finally {
      database.close();
    }
  });
});

describe('mark a Review job as failed', () => {
  it('fails a non-resumable Review job with its submission and leaves a resumable one alone', () => {
    const database = new Database(':memory:');
    try {
      migrateDatabase(database);
      createJob(
        { id: 'http-review', kind: 'image_generate', providerId: 'chatgpt', prompt: 'owl' },
        database,
      );
      createJob(
        { id: 'comfy-review', kind: 'image_generate', providerId: 'comfy', prompt: 'owl' },
        database,
      );
      const comfyCheckpoint = {
        providerId: 'comfy' as const,
        runtimeIdentity: 'runtime-a-hash',
        promptId: 'prompt-1',
        phase: 'accepted' as const,
        startedAt: 1000,
      };
      updateJobRemoteExecution(
        'http-review',
        { providerId: 'chatgpt', phase: 'submitting', startedAt: 1000 },
        database,
      );
      updateJobRemoteExecution('comfy-review', comfyCheckpoint, database);
      updateJobStatus('http-review', 'needs_review', 'ChatGPT HTTP returned 520.', database);
      updateJobStatus('comfy-review', 'needs_review', null, database);

      const marked = markReviewJobFailed('http-review', database);
      expect(marked).toMatchObject({
        status: 'failed',
        error: 'Marked as failed after review. ChatGPT HTTP returned 520.',
        remoteExecution: { providerId: 'chatgpt', phase: 'failed', startedAt: 1000 },
      });
      expect(listJobEvents('http-review', database).at(-1)).toMatchObject({ type: 'job.failed' });
      // The normal Retry then sends a new submission instead of stopping at the recorded one.
      expect(requeueJob('http-review', database)?.remoteExecution ?? null).toBeNull();

      expect(markReviewJobFailed('comfy-review', database)).toBeNull();
      expect(getJob('comfy-review', database)).toMatchObject({
        status: 'needs_review',
        error: null,
        remoteExecution: comfyCheckpoint,
      });
    } finally {
      database.close();
    }
  });
});
