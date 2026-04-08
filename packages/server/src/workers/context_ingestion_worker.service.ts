// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import * as outboxRepo from '../db/repos/context-outbox.js';
import { indexDocument, type IndexableEntityType } from '../search/SearchIndexerService.js';

/**
 * Context Outbox Worker
 *
 * Drains the context_outbox table in batches. For each claimed job it calls
 * processJob(), which is the Phase 3 integration seam: once SearchIndexerService
 * is implemented, replace the placeholder block below with a real indexer call.
 *
 * Retry policy: jobs are retried up to 5 times (enforced by claimPendingJobs).
 * On the 5th failure the job stays in the 'failed' state for manual inspection.
 */

const BATCH_SIZE = 100;

/**
 * Claim and process one batch of pending/retryable outbox jobs.
 * Called from the 60s background interval in index.ts.
 */
export async function processNextBatch(db: DbPool): Promise<void> {
  const jobs = await outboxRepo.claimPendingJobs(db, BATCH_SIZE);

  if (jobs.length === 0) return;

  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await processJob(db, job.entity_type, job.entity_id, job.payload);
      await outboxRepo.markComplete(db, job.id);
      succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await outboxRepo.markFailed(db, job.id, message);
      failed++;
      console.error(`[outbox] Job ${job.id} (${job.entity_type}:${job.entity_id}) failed (attempt ${job.attempt_count}): ${message}`);
    }
  }

  console.log(`[outbox] Batch complete — ${succeeded} succeeded, ${failed} failed out of ${jobs.length} jobs.`);
}

/**
 * Process a single outbox job by forwarding its payload to the unified search
 * indexer. The payload was captured at write time so no re-fetch is needed.
 */
async function processJob(
  db: DbPool,
  entityType: string,
  _entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // Only entity types the indexer understands are forwarded.
  // Others (e.g. future entity types) are silently acknowledged.
  const known = new Set<string>([
    'contact', 'account', 'opportunity', 'use_case', 'activity', 'context_entry',
  ]);
  if (known.has(entityType)) {
    await indexDocument(db, entityType as IndexableEntityType, payload);
  }
}
