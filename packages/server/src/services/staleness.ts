// SPDX-License-Identifier: Apache-2.0

/**
 * Memory Health service — automatically creates assignments for Memory that needs review.
 *
 * When Current Memory's valid_until has passed, it means the information may be
 * outdated and needs human or agent verification. This service finds those entries,
 * identifies the actor most knowledgeable about the subject, and creates a review
 * assignment so aging Memory gets actively refreshed rather than silently decaying.
 *
 * Deduplication: uses metadata.stale_context_entry_id to avoid creating duplicate
 * assignments for the same entry.
 */

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';
import * as contextRepo from '../db/repos/context-entries.js';
import { shouldMarkMemoryDueForReview } from './memory-trust.js';
import { createOrConsolidateReviewAssignment, expireLowValueReviewAssignments } from './review-queue.js';

interface StaleEntryRow {
  id: UUID;
  tenant_id: UUID;
  subject_type: string;
  subject_id: UUID;
  context_type: string;
  authored_by: UUID;
  title: string | null;
  body: string;
  valid_until: string;
  claim_tier: number | null;
}

export function computeMemoryIdsDueForReview(
  rows: contextRepo.MemoryFreshnessCandidateRow[],
  now = new Date(),
): UUID[] {
  return rows
    .filter(row => shouldMarkMemoryDueForReview(row, now))
    .map(row => row.id);
}

/**
 * Find the actor who has authored the most context entries for this subject.
 * Falls back to the entry's own authored_by if no other actor has contributed.
 */
async function findBestReviewActor(
  db: DbPool,
  tenantId: UUID,
  subjectType: string,
  subjectId: UUID,
  fallbackActorId: UUID,
): Promise<UUID> {
  const result = await db.query(
    `SELECT authored_by, count(*) as cnt
     FROM context_entries
     WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 AND is_current = true
     GROUP BY authored_by
     ORDER BY cnt DESC, max(created_at) DESC
     LIMIT 1`,
    [tenantId, subjectType, subjectId],
  );
  return (result.rows[0]?.authored_by as UUID) ?? fallbackActorId;
}

/**
 * Check whether the entry was reviewed within the last 24 hours.
 */
async function recentlyReviewed(
  db: DbPool,
  tenantId: UUID,
  entryId: UUID,
): Promise<boolean> {
  const reviewedResult = await db.query(
    `SELECT id FROM context_entries
     WHERE id = $1 AND tenant_id = $2
       AND reviewed_at > now() - interval '24 hours'
     LIMIT 1`,
    [entryId, tenantId],
  );
  return reviewedResult.rows.length > 0;
}

/**
 * Process a single tenant's stale entries, creating assignments as needed.
 * Returns the number of assignments created.
 */
export async function processStaleEntriesForTenant(
  db: DbPool,
  tenantId: UUID,
  limit = 20,
): Promise<number> {
  await expireLowValueReviewAssignments(db, tenantId);
  const freshnessRows = await contextRepo.listActiveMemoryForFreshness(db, tenantId, Math.max(100, limit * 10));
  const dueIds = computeMemoryIdsDueForReview(freshnessRows);
  if (dueIds.length > 0) {
    await contextRepo.markMemoryReviewDue(db, tenantId, dueIds);
  }

  const result = await db.query(
    `SELECT c.id, c.tenant_id, c.subject_type, c.subject_id, c.context_type,
            c.authored_by, c.title, c.body, c.valid_until, ctr.claim_tier
     FROM context_entries c
     LEFT JOIN context_type_registry ctr
       ON ctr.tenant_id = c.tenant_id
      AND ctr.type_name = c.context_type
     WHERE c.tenant_id = $1
       AND c.valid_until < now()
       AND c.is_current = true
       AND c.memory_status = 'active'
     ORDER BY c.valid_until ASC
     LIMIT $2`,
    [tenantId, limit],
  );

  const entries = result.rows as StaleEntryRow[];
  let created = 0;

  for (const entry of entries) {
    if (await recentlyReviewed(db, tenantId, entry.id)) continue;

    const assignTo = await findBestReviewActor(
      db, tenantId, entry.subject_type, entry.subject_id, entry.authored_by,
    );

    const snippet = entry.title ?? entry.body.slice(0, 120);
    const expired = new Date(entry.valid_until).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });

    const result = await createOrConsolidateReviewAssignment(db, tenantId, {
      title: `Review Memory: ${entry.context_type}`,
      description: `This ${entry.context_type} Memory reached its review date on ${expired}.\n\n"${snippet}${snippet.length >= 120 ? '...' : ''}"`,
      assignment_type: 'stale_context_review',
      assigned_by: entry.authored_by,
      assigned_to: assignTo,
      subject_type: entry.subject_type as 'contact' | 'account' | 'opportunity' | 'use_case',
      subject_id: entry.subject_id,
      priority: 'normal',
      context: entry.id, // context entry ID stored here so assignee can retrieve it
      metadata: { stale_context_entry_id: entry.id, context_type: entry.context_type },
    }, {
      reviewKey: `context:${entry.id}`,
      reasons: ['stale_memory'],
      contextEntryId: entry.id,
      contextType: entry.context_type,
      claimTier: entry.claim_tier,
    });

    if (result.created) created++;
  }

  return created;
}

/**
 * Background worker: process Memory entries that need review across all tenants.
 * Called from the 60s interval worker in index.ts.
 */
export async function processStaleEntries(db: DbPool, limit = 10): Promise<void> {
  const tenantsResult = await db.query(
    `SELECT DISTINCT c.tenant_id
     FROM context_entries c
     LEFT JOIN context_type_registry ctr
       ON ctr.tenant_id = c.tenant_id
      AND ctr.type_name = c.context_type
     WHERE c.is_current = true
       AND c.memory_status = 'active'
       AND (
         c.valid_until < now()
         OR (
           c.valid_until IS NULL
           AND COALESCE(c.reviewed_at, c.promoted_at, c.updated_at, c.created_at)
             < now() - (COALESCE(ctr.default_freshness_days, 120) * interval '1 day')
         )
       )
     LIMIT 50`,
  );

  for (const row of tenantsResult.rows as { tenant_id: UUID }[]) {
    try {
      await processStaleEntriesForTenant(db, row.tenant_id, limit);
    } catch (err) {
      console.error(`[staleness] Failed to process tenant ${row.tenant_id}:`, err);
    }
  }
}
