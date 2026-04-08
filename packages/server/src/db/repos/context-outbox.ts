// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID } from '@crmy/shared';

export interface OutboxJob {
  id: UUID;
  tenant_id: UUID;
  entity_type: string;
  entity_id: UUID;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

/**
 * Enqueue a new indexing job. Call this immediately after a successful
 * context_entry write, passing the full entity payload so the worker
 * can forward it to the search indexer without re-fetching.
 */
export async function insertJob(
  db: DbPool,
  tenantId: UUID,
  entityType: string,
  entityId: UUID,
  payload: Record<string, unknown>,
): Promise<OutboxJob> {
  const result = await db.query(
    `INSERT INTO context_outbox (tenant_id, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [tenantId, entityType, entityId, JSON.stringify(payload)],
  );
  return result.rows[0] as OutboxJob;
}

/**
 * Atomically claim a batch of pending (or retryable failed) jobs by flipping
 * their status to 'processing' and incrementing attempt_count. Uses a CTE with
 * FOR UPDATE SKIP LOCKED so concurrent worker instances never double-claim.
 */
export async function claimPendingJobs(db: DbPool, batchSize: number): Promise<OutboxJob[]> {
  const result = await db.query(
    `WITH to_claim AS (
       SELECT id FROM context_outbox
       WHERE status = 'pending'
          OR (status = 'failed' AND attempt_count < 5)
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE context_outbox
        SET status = 'processing',
            attempt_count = attempt_count + 1
     FROM to_claim
     WHERE context_outbox.id = to_claim.id
     RETURNING context_outbox.*`,
    [batchSize],
  );
  return result.rows as OutboxJob[];
}

/**
 * Mark a job as successfully processed.
 */
export async function markComplete(db: DbPool, id: UUID): Promise<void> {
  await db.query(
    `UPDATE context_outbox
        SET status = 'complete',
            processed_at = now(),
            last_error = null
      WHERE id = $1`,
    [id],
  );
}

/**
 * Mark a job as failed. If attempt_count is still below 5 the job will be
 * reclaimed on the next worker cycle; otherwise it stays failed permanently
 * and must be investigated manually.
 */
export async function markFailed(db: DbPool, id: UUID, error: string): Promise<void> {
  await db.query(
    `UPDATE context_outbox
        SET status = 'failed',
            last_error = $2
      WHERE id = $1`,
    [id, error.slice(0, 1000)],
  );
}
