// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { UUID } from '@crmy/shared';
import type { DbPool } from '../pool.js';

export type EmbeddingJobStatus = 'pending' | 'processing' | 'complete' | 'failed';
export type EmbeddingEntityType = 'context_entry' | 'signal_group';

export interface ContextEmbeddingJob {
  id: UUID;
  tenant_id: UUID;
  entity_type: EmbeddingEntityType;
  entity_id: UUID;
  text_hash: string;
  provider?: string | null;
  model?: string | null;
  dimensions?: number | null;
  status: EmbeddingJobStatus;
  attempt_count: number;
  last_error?: string | null;
  locked_at?: string | null;
  processed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export async function enqueueEmbeddingJob(
  db: DbPool,
  input: {
    tenantId: UUID | string;
    entityType: EmbeddingEntityType;
    entityId: UUID | string;
    textHash: string;
    provider?: string | null;
    model?: string | null;
    dimensions?: number | null;
  },
): Promise<ContextEmbeddingJob> {
  const result = await db.query(
    `INSERT INTO context_embedding_jobs (
       tenant_id, entity_type, entity_id, text_hash, provider, model, dimensions, status
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
     ON CONFLICT (tenant_id, entity_type, entity_id, text_hash)
     DO UPDATE SET
       provider = COALESCE(EXCLUDED.provider, context_embedding_jobs.provider),
       model = COALESCE(EXCLUDED.model, context_embedding_jobs.model),
       dimensions = COALESCE(EXCLUDED.dimensions, context_embedding_jobs.dimensions),
       status = CASE
         WHEN context_embedding_jobs.status = 'complete' THEN 'complete'
         ELSE 'pending'
       END,
       last_error = CASE
         WHEN context_embedding_jobs.status = 'complete' THEN context_embedding_jobs.last_error
         ELSE NULL
       END,
       updated_at = now()
     RETURNING *`,
    [
      input.tenantId,
      input.entityType,
      input.entityId,
      input.textHash,
      input.provider ?? null,
      input.model ?? null,
      input.dimensions ?? null,
    ],
  );
  return result.rows[0] as ContextEmbeddingJob;
}

export async function claimPendingEmbeddingJobs(
  db: DbPool,
  batchSize: number,
): Promise<ContextEmbeddingJob[]> {
  const result = await db.query(
    `WITH to_claim AS (
       SELECT id
       FROM context_embedding_jobs
       WHERE status = 'pending'
          OR (status = 'failed' AND attempt_count < 5)
          OR (status = 'processing' AND locked_at < now() - interval '15 minutes' AND attempt_count < 5)
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE context_embedding_jobs j
        SET status = 'processing',
            attempt_count = attempt_count + 1,
            locked_at = now(),
            updated_at = now()
     FROM to_claim
     WHERE j.id = to_claim.id
     RETURNING j.*`,
    [batchSize],
  );
  return result.rows as ContextEmbeddingJob[];
}

export async function markEmbeddingJobComplete(db: DbPool, id: UUID | string): Promise<void> {
  await db.query(
    `UPDATE context_embedding_jobs
        SET status = 'complete',
            processed_at = now(),
            last_error = NULL,
            updated_at = now()
      WHERE id = $1`,
    [id],
  );
}

export async function markEmbeddingJobFailed(
  db: DbPool,
  id: UUID | string,
  error: string,
): Promise<void> {
  await db.query(
    `UPDATE context_embedding_jobs
        SET status = 'failed',
            last_error = $2,
            updated_at = now()
      WHERE id = $1`,
    [id, error.slice(0, 1000)],
  );
}

export async function countEmbeddingJobs(
  db: DbPool,
  tenantId: UUID | string,
): Promise<{ pending: number; failed: number; processing: number }> {
  const result = await db.query(
    `SELECT
       count(*) FILTER (WHERE status = 'pending')::int AS pending,
       count(*) FILTER (WHERE status = 'failed')::int AS failed,
       count(*) FILTER (WHERE status = 'processing')::int AS processing
     FROM context_embedding_jobs
     WHERE tenant_id = $1`,
    [tenantId],
  );
  return {
    pending: Number(result.rows[0]?.pending ?? 0),
    failed: Number(result.rows[0]?.failed ?? 0),
    processing: Number(result.rows[0]?.processing ?? 0),
  };
}
