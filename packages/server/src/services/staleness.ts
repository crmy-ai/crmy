// SPDX-License-Identifier: Apache-2.0

/**
 * Staleness service — automatically creates assignments for stale context entries.
 *
 * When a context entry's valid_until has passed, it means the information may be
 * outdated and needs human or agent verification. This service finds those entries,
 * identifies the actor most knowledgeable about the subject, and creates a review
 * assignment so the stale memory gets actively refreshed rather than silently decaying.
 *
 * Deduplication: uses metadata.stale_context_entry_id to avoid creating duplicate
 * assignments for the same entry.
 */

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';
import * as assignmentRepo from '../db/repos/assignments.js';

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
 * Check whether an open stale-review assignment already exists for this context entry.
 */
async function staleAssignmentExists(
  db: DbPool,
  tenantId: UUID,
  entryId: UUID,
): Promise<boolean> {
  const result = await db.query(
    `SELECT id FROM assignments
     WHERE tenant_id = $1
       AND status NOT IN ('completed', 'declined', 'cancelled')
       AND metadata->>'stale_context_entry_id' = $2
     LIMIT 1`,
    [tenantId, entryId],
  );
  return result.rows.length > 0;
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
  const result = await db.query(
    `SELECT id, tenant_id, subject_type, subject_id, context_type,
            authored_by, title, body, valid_until
     FROM context_entries
     WHERE tenant_id = $1
       AND valid_until < now()
       AND is_current = true
     ORDER BY valid_until ASC
     LIMIT $2`,
    [tenantId, limit],
  );

  const entries = result.rows as StaleEntryRow[];
  let created = 0;

  for (const entry of entries) {
    // Skip if an open assignment already exists for this entry
    if (await staleAssignmentExists(db, tenantId, entry.id)) continue;

    const assignTo = await findBestReviewActor(
      db, tenantId, entry.subject_type, entry.subject_id, entry.authored_by,
    );

    const snippet = entry.title ?? entry.body.slice(0, 120);
    const expired = new Date(entry.valid_until).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });

    await assignmentRepo.createAssignment(db, tenantId, {
      title: `Review stale context: ${entry.context_type}`,
      description: `This ${entry.context_type} entry expired on ${expired} and needs review.\n\n"${snippet}${snippet.length >= 120 ? '...' : ''}"`,
      assignment_type: 'stale_context_review',
      assigned_by: entry.authored_by,
      assigned_to: assignTo,
      subject_type: entry.subject_type as 'contact' | 'account' | 'opportunity' | 'use_case',
      subject_id: entry.subject_id,
      priority: 'normal',
      context: entry.id, // context entry ID stored here so assignee can retrieve it
      metadata: { stale_context_entry_id: entry.id, context_type: entry.context_type },
    });

    created++;
  }

  return created;
}

/**
 * Background worker: process stale context entries across all tenants.
 * Called from the 60s interval worker in index.ts.
 */
export async function processStaleEntries(db: DbPool, limit = 10): Promise<void> {
  const tenantsResult = await db.query(
    `SELECT DISTINCT tenant_id FROM context_entries
     WHERE valid_until < now() AND is_current = true
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
