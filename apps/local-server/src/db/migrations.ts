import type { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { getDb } from './connection';
import { ensureDefaultWorkspaceRow } from './workspaces';

/**
 * Tag count of a catalog image. Migration 21 indexes this exact expression, so filters must use
 * this text to reach the index. Changing it needs a new migration that rebuilds the index.
 */
export const CATALOG_TAG_COUNT_SQL =
  "json_array_length(CASE WHEN json_valid(tags) THEN tags ELSE '[]' END)";

function now() {
  return new Date().toISOString();
}

/**
 * The oldest schema this Studio opens. Every release, from v0.1.1 on, creates it. A new database
 * starts here; Studio refuses an older database without changing it.
 */
const BASELINE_SCHEMA_VERSION = 20;
const BASELINE_UPDATE_RELEASE_URL =
  'https://github.com/gvastethecreator/cozy-studio/releases/tag/v0.2.0';

/**
 * Steps 1 to 20 of the earlier migration chain, which the baseline replaces. A new database
 * records them, so its ledger matches an updated database and Studio v0.2.0 can still open it.
 */
const BASELINE_STEP_NAMES = [
  'base-schema',
  'job-library-context',
  'job-finalization-checkpoints',
  'workspace-authority-expand',
  'drop-project-required-coupling',
  'remove-project-contract',
  'remote-execution-identity',
  'atomic-job-batches-and-attempt-history',
  'job-output-context',
  'durable-output-generations',
  'reference-import-receipts',
  'catalog-collections',
  'catalog-organization-presentation',
  'reference-import-stored-digest',
  'drop-orphan-workspace-tags',
  'drop-cross-workspace-collection-members',
  'settle-legacy-size-review-jobs',
  'catalog-organize-history',
  'catalog-smart-collections',
  'catalog-image-dhash',
] as const;

const SCHEMA_MIGRATIONS_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`;

/**
 * The version-20 schema exactly as `sqlite_master` holds it after steps 1 to 20, with the added
 * columns and rebuilt tables of those steps. New and updated databases therefore have the same
 * schema text. Do not reformat or edit it: change the schema with a new migration.
 */
const BASELINE_SCHEMA_SQL = [
  `CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      is_default INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    , kind TEXT NOT NULL DEFAULT 'library')`,
  `CREATE TABLE catalog_images (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id),
      file_path TEXT NOT NULL,
      thumbnail_path TEXT,
      public_url TEXT NOT NULL,
      thumbnail_url TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      aspect_ratio TEXT,
      image_size TEXT,
      width INTEGER,
      height INTEGER,
      mime_type TEXT NOT NULL,
      file_size_bytes INTEGER,
      job_id TEXT REFERENCES jobs(id),
      workspace_id TEXT,
      batch_id TEXT,
      recipe_id TEXT,
      is_favorite INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      tags TEXT DEFAULT '[]',
      generation_config TEXT,
      created_at TEXT NOT NULL
    , dhash TEXT)`,
  `CREATE INDEX idx_catalog_library ON catalog_images(library_id)`,
  `CREATE INDEX idx_catalog_workspace ON catalog_images(workspace_id)`,
  `CREATE INDEX idx_catalog_job ON catalog_images(job_id)`,
  `CREATE INDEX idx_catalog_favorite ON catalog_images(is_favorite)`,
  `CREATE INDEX idx_catalog_deleted ON catalog_images(is_deleted)`,
  `CREATE INDEX idx_catalog_created ON catalog_images(created_at)`,
  `CREATE INDEX idx_catalog_deleted_created_desc ON catalog_images(is_deleted, created_at DESC)`,
  `CREATE INDEX idx_catalog_workspace_key_deleted_created_desc ON catalog_images(COALESCE(workspace_id, 'default'), is_deleted, created_at DESC)`,
  `CREATE INDEX idx_catalog_deleted_workspace_created_cover ON catalog_images(is_deleted, COALESCE(workspace_id, 'default'), created_at DESC, id DESC, library_id, file_size_bytes)`,
  `CREATE TABLE user_style_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      domain TEXT,
      tags_json TEXT NOT NULL,
      supported_tasks_json TEXT NOT NULL,
      visual_dna_json TEXT NOT NULL,
      avoid_rules_json TEXT NOT NULL,
      attributes_json TEXT,
      assets_json TEXT,
      source_json TEXT,
      is_archived INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  `CREATE INDEX idx_user_style_archived_updated ON user_style_presets(is_archived, updated_at DESC)`,
  `CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      library_id TEXT REFERENCES libraries(id),
      filter_json TEXT,
      sort_order TEXT DEFAULT 'newest',
      created_at TEXT NOT NULL
    , updated_at TEXT)`,
  `CREATE TABLE codex_turns (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      codex_thread_id TEXT,
      codex_turn_id TEXT,
      transcript_path TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT REFERENCES jobs(id),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    )`,
  `CREATE TABLE system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      scope TEXT NOT NULL,
      message TEXT NOT NULL,
      job_id TEXT,
      created_at TEXT NOT NULL
    )`,
  `CREATE INDEX idx_job_events_job_id_id ON job_events(job_id, id)`,
  `CREATE INDEX idx_codex_turns_job_updated_desc ON codex_turns(job_id, updated_at DESC)`,
  `CREATE TABLE "jobs" (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      recipe_id TEXT,
      batch_id TEXT,
      aspect_ratio TEXT,
      kind TEXT NOT NULL,
      provider_id TEXT,
      source_spec_json TEXT,
      status TEXT NOT NULL,
      execution_json TEXT,
      library_id TEXT,
      library_root TEXT,
      finalization_state TEXT,
      finalization_source_path TEXT,
      finalization_file_path TEXT,
      finalization_asset_id TEXT,
      finalization_catalog_id TEXT,
      original_prompt TEXT NOT NULL,
      expanded_prompt TEXT,
      final_prompt_used TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    , remote_execution_json TEXT, attempt INTEGER NOT NULL DEFAULT 1, attempt_queued_at TEXT, library_context_json TEXT)`,
  `CREATE INDEX idx_jobs_created_desc ON jobs(created_at DESC)`,
  `CREATE INDEX idx_jobs_workspace_created_desc ON jobs(workspace_id, created_at DESC)`,
  `CREATE INDEX idx_jobs_status_created_desc ON jobs(status, created_at DESC)`,
  `CREATE INDEX idx_jobs_batch_id ON jobs(batch_id)`,
  `CREATE INDEX idx_jobs_recipe_created_desc ON jobs(recipe_id, created_at DESC)`,
  `CREATE INDEX idx_jobs_library_created_desc ON jobs(library_id, created_at DESC)`,
  `CREATE INDEX idx_jobs_finalization_state ON jobs(finalization_state)`,
  `CREATE TABLE "assets" (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      file_path TEXT NOT NULL,
      thumbnail_path TEXT,
      public_url TEXT NOT NULL,
      prompt TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      mime_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    )`,
  `CREATE TABLE "codex_threads" (
      id TEXT PRIMARY KEY,
      codex_thread_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE job_batches (
        id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, workspace_id TEXT NOT NULL,
        requested_count INTEGER NOT NULL CHECK(requested_count > 0), created_at TEXT NOT NULL
      )`,
  `CREATE TABLE job_batch_members (
        batch_id TEXT NOT NULL REFERENCES job_batches(id), job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
        position INTEGER NOT NULL, PRIMARY KEY(batch_id, position)
      )`,
  `CREATE TABLE job_attempts (
        job_id TEXT NOT NULL REFERENCES jobs(id), attempt INTEGER NOT NULL, queued_at TEXT,
        archived_at TEXT NOT NULL, event_end_id INTEGER NOT NULL, job_json TEXT NOT NULL,
        PRIMARY KEY(job_id, attempt)
      )`,
  `CREATE TABLE job_batch_retries (
        request_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES job_batches(id),
        request_hash TEXT NOT NULL, job_ids_json TEXT NOT NULL
      )`,
  `CREATE TABLE output_generations (
        generation_number INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_key TEXT NOT NULL UNIQUE
      )`,
  `CREATE TABLE reference_import_receipts (
        request_id TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        catalog_image_id TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      , stored_sha256 TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX idx_reference_import_receipts_sha256 ON reference_import_receipts(sha256)`,
  `CREATE TABLE catalog_collections (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      , emoji TEXT, last_used_at TEXT, rule_json TEXT)`,
  `CREATE UNIQUE INDEX idx_catalog_collections_workspace_name ON catalog_collections(workspace_id, name COLLATE NOCASE)`,
  `CREATE TABLE catalog_collection_images (
        collection_id TEXT NOT NULL REFERENCES catalog_collections(id) ON DELETE CASCADE,
        image_id TEXT NOT NULL REFERENCES catalog_images(id) ON DELETE CASCADE,
        added_at TEXT NOT NULL,
        PRIMARY KEY (collection_id, image_id)
      )`,
  `CREATE INDEX idx_catalog_collection_images_image ON catalog_collection_images(image_id)`,
  `CREATE TABLE catalog_tags (
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        last_used_at TEXT,
        PRIMARY KEY (workspace_id, name)
      )`,
  `CREATE TABLE catalog_organize_history (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('ui', 'agent')),
        changes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        undone_at TEXT
      )`,
  `CREATE INDEX idx_catalog_organize_history_workspace
        ON catalog_organize_history(workspace_id)`,
];

const DATABASE_MIGRATIONS = [
  {
    version: 21,
    name: 'catalog-filter-count-indexes',
    migrate(database: Database) {
      // Favorite and unorganized counts otherwise read every full image row of the workspace.
      database.run(`CREATE INDEX idx_catalog_workspace_deleted_favorite
        ON catalog_images(COALESCE(workspace_id, 'default'), is_deleted, is_favorite)`);
      // Workspace last: the grouped count for every workspace seeks this index too.
      database.run(`CREATE INDEX idx_catalog_deleted_tag_count_workspace
        ON catalog_images(is_deleted, ${CATALOG_TAG_COUNT_SQL}, COALESCE(workspace_id, 'default'))`);
    },
  },
  {
    version: 22,
    name: 'workspace-style-scope',
    migrate(database: Database) {
      // JSON list of the style packs, categories and presets linked to the workspace; NULL = none.
      database.run('ALTER TABLE workspaces ADD COLUMN style_scope_json TEXT');
    },
  },
] as const;

export const LATEST_DATABASE_SCHEMA_VERSION =
  DATABASE_MIGRATIONS.at(-1)?.version ?? BASELINE_SCHEMA_VERSION;

function hasStudioTables(database: Database) {
  return Boolean(
    database
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name <> 'schema_migrations'")
      .get(),
  );
}

function readAppliedVersions(database: Database) {
  const hasLedger = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!hasLedger) return new Set<number>();
  const rows = database.query('SELECT version FROM schema_migrations').all() as Array<{
    version: number;
  }>;
  return new Set(rows.map((row) => row.version));
}

/** The newest migration applied to the database, or null before the first. */
export function readSchemaVersion(database: Database) {
  const versions = [...readAppliedVersions(database)];
  return versions.length ? Math.max(...versions) : null;
}

/** Stops before any write when the database predates the baseline. A new database passes. */
function assertSupportedSchema(database: Database, appliedVersions: Set<number>) {
  if (appliedVersions.has(BASELINE_SCHEMA_VERSION)) return;
  if (appliedVersions.size === 0 && !hasStudioTables(database)) return;
  const found = appliedVersions.size
    ? `schema version ${Math.max(...appliedVersions)}`
    : 'no schema version';
  const file = database.filename && database.filename !== ':memory:' ? ` ${database.filename}` : '';
  throw new Error(
    `Studio cannot open the database${file}: it has ${found}, and this Studio opens schema ` +
      `version ${BASELINE_SCHEMA_VERSION} and later. The database is unchanged. To keep its data, ` +
      `open it once in Studio v0.2.0 (the release ZIP at ${BASELINE_UPDATE_RELEASE_URL}), which ` +
      'updates it to a supported version. Then open it in this Studio.',
  );
}

/** Folder beside the database file that holds the copies made before a migration. */
const PRE_MIGRATION_BACKUP_DIR = path.join('state', 'pre-migration');
const PRE_MIGRATION_BACKUP_LIMIT = 3;

/**
 * Copies an existing file database before pending migrations change it. VACUUM INTO writes one
 * consistent file that includes committed WAL pages. In-memory and new databases are skipped.
 * Studio never restores a copy by itself: a restore replaces the Library and needs the user.
 */
function writePreMigrationBackup(database: Database, fromVersion: number) {
  const databasePath = database.filename;
  if (!databasePath || databasePath === ':memory:') return;

  const backupDir = path.join(path.dirname(databasePath), PRE_MIGRATION_BACKUP_DIR);
  const baseName = path.parse(databasePath).name;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Timestamp first, so name order is time order for the retention below.
  const backupPath = path.join(backupDir, `${baseName}-${stamp}-schema-v${fromVersion}.sqlite`);
  try {
    mkdirSync(backupDir, { recursive: true });
    database.query('VACUUM INTO ?').run(backupPath);
  } catch (error) {
    try {
      if (existsSync(backupPath)) rmSync(backupPath, { force: true });
    } catch {
      // A locked partial copy must not hide the backup error below.
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Studio did not update the database from schema v${fromVersion} to v${LATEST_DATABASE_SCHEMA_VERSION}: ` +
        `the backup copy ${backupPath} failed (${reason}). The database is unchanged. ` +
        'Free disk space or fix access to that folder, then start Studio again.',
      { cause: error },
    );
  }

  const backups = readdirSync(backupDir)
    .filter((name) => name.startsWith(`${baseName}-`) && /-schema-v\d+\.sqlite$/.test(name))
    .sort();
  for (const name of backups.slice(0, -PRE_MIGRATION_BACKUP_LIMIT)) {
    try {
      rmSync(path.join(backupDir, name), { force: true });
    } catch {
      // A locked old copy only uses disk space; the next migrating start removes it.
    }
  }
}

export function migrateDatabase(database: Database) {
  const appliedVersions = readAppliedVersions(database);
  assertSupportedSchema(database, appliedVersions);
  const needsBaseline = !appliedVersions.has(BASELINE_SCHEMA_VERSION);
  const pending = DATABASE_MIGRATIONS.filter(
    (migration) => !appliedVersions.has(migration.version),
  );
  if (!needsBaseline && pending.length === 0) return;
  // A new database has nothing to protect; an existing one is at the baseline or later here.
  if (!needsBaseline) writePreMigrationBackup(database, Math.max(...appliedVersions));

  database.transaction(() => {
    if (needsBaseline) {
      database.run(SCHEMA_MIGRATIONS_SQL);
      for (const sql of BASELINE_SCHEMA_SQL) database.run(sql);
      ensureDefaultWorkspaceRow(database);
    }
    const record = database.query(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    );
    if (needsBaseline) {
      BASELINE_STEP_NAMES.forEach((name, index) => record.run(index + 1, name, now()));
    }
    for (const migration of pending) {
      migration.migrate(database);
      record.run(migration.version, migration.name, now());
    }
  })();
}

export function migrateDb(db?: Database) {
  migrateDatabase(getDb(db));
}
