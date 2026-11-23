import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

import type { Asset } from '../../../../packages/shared/src';
import { getDb } from './connection';

/** The job's prompt; an asset stores its own prompt only when it differs (migration 24). */
const JOB_PROMPT_SQL =
  "(SELECT COALESCE(NULLIF(jobs.final_prompt_used, ''), jobs.original_prompt) FROM jobs WHERE jobs.id = assets.job_id)";
const SELECT_ASSETS = `SELECT assets.*, COALESCE(NULLIF(assets.prompt, ''), ${JOB_PROMPT_SQL}, '') AS resolved_prompt FROM assets`;

function mapAsset(row: Record<string, unknown>): Asset {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    filePath: String(row.file_path),
    thumbnailPath: typeof row.thumbnail_path === 'string' ? row.thumbnail_path : null,
    publicUrl: String(row.public_url),
    prompt: String(row.resolved_prompt ?? row.prompt),
    width: typeof row.width === 'number' ? row.width : null,
    height: typeof row.height === 'number' ? row.height : null,
    mimeType: String(row.mime_type),
    createdAt: String(row.created_at),
    deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : null,
  };
}

export function addAsset(input: Omit<Asset, 'id' | 'createdAt' | 'deletedAt'>, db?: Database) {
  const asset: Asset = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  getDb(db)
    .query(`
      INSERT INTO assets (id, job_id, file_path, thumbnail_path, public_url, prompt, width, height, mime_type, created_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, CASE WHEN ?6 = (SELECT COALESCE(NULLIF(final_prompt_used, ''), original_prompt) FROM jobs WHERE id = ?2) THEN '' ELSE ?6 END, ?, ?, ?, ?, ?)
    `)
    .run(
      asset.id,
      asset.jobId,
      asset.filePath,
      asset.thumbnailPath,
      asset.publicUrl,
      asset.prompt,
      asset.width ?? null,
      asset.height ?? null,
      asset.mimeType,
      asset.createdAt,
      asset.deletedAt,
    );
  return asset;
}

export function listAssets(db?: Database) {
  return getDb(db)
    .query(`${SELECT_ASSETS} WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`)
    .all()
    .map((row) => mapAsset(row as Record<string, unknown>));
}

export function getAssetByJobId(jobId: string, filePath?: string | null, db?: Database) {
  const row = filePath
    ? getDb(db)
        .query(
          `${SELECT_ASSETS} WHERE job_id = ? AND file_path = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
        )
        .get(jobId, filePath)
    : getDb(db)
        .query(
          `${SELECT_ASSETS} WHERE job_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
        )
        .get(jobId);
  return row ? mapAsset(row as Record<string, unknown>) : null;
}
