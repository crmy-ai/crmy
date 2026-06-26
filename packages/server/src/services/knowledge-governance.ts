// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Governed Product Knowledge — Phase 7: governance.
 *
 * Three governance capabilities over claim envelopes, all optional and additive:
 *
 *   1. Admin review flow (`reviewKnowledgeClaim`, `listKnowledgeClaimsForReview`):
 *      approve / reject / deprecate / mark-stale / reactivate a claim, set its
 *      customer-facing eligibility, and assign a review owner. Approving
 *      re-verifies freshness so the Phase 6 sweep restarts the clock.
 *
 *   2. Conflict detection with source-priority resolution
 *      (`detectKnowledgeConflicts`): finds live claims in the same category that
 *      cover the same competitor/scope and may state competing product truth,
 *      and recommends which should win — an authoritative source over a
 *      secondary one, an approved claim over an unapproved one — or manual
 *      review when neither rule decides. Pure classification (`classifyConflict`)
 *      is unit-testable without a database.
 *
 *   3. Stale review assignments (`processKnowledgeReviews`): for claims that have
 *      a review owner and need attention, open a review assignment for that
 *      owner — mirroring the customer-Memory staleness sweep so aging product
 *      truth is actively refreshed rather than silently decaying.
 *
 * See docs/governed-product-knowledge-retrieval.md (Phase 7).
 */

import type { DbPool } from '../db/pool.js';
import type {
  ActorContext,
  KnowledgeApprovalStatus,
  KnowledgeClaimRecord,
  KnowledgeConflict,
  KnowledgeReviewDecision,
  KnowledgeSourcePriority,
} from '@crmy/shared';
import {
  getKnowledgeClaim,
  listClaimsForConflictScan,
  listKnowledgeClaims,
  listKnowledgeClaimsNeedingReviewAssignment,
  listTenantsWithReviewableClaims,
  reviewKnowledgeClaim as reviewKnowledgeClaimRow,
  type KnowledgeClaimRow,
  type ListKnowledgeClaimsOptions,
  type ReviewKnowledgeClaimPatch,
} from '../db/repos/knowledge-claims.js';
import { createAssignment } from '../db/repos/assignments.js';

const PRIORITY_RANK: Record<KnowledgeSourcePriority, number> = {
  authoritative: 3,
  secondary: 2,
  informal: 1,
};

/** Map a full claim row to the admin/governance-facing record. */
export function rowToKnowledgeRecord(row: KnowledgeClaimRow): KnowledgeClaimRecord {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    ...(row.summary ? { summary: row.summary } : {}),
    product_scope: row.product_scope ?? [],
    competitors: row.competitors ?? [],
    grounded: row.grounded,
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
    source_priority: row.source_priority,
    ...(row.source_label ? { source_label: row.source_label } : {}),
    approval_status: row.approval_status,
    approved_for_external_use: row.approved_for_external_use,
    visibility: row.visibility,
    status: row.status,
    ...(row.effective_at ? { effective_at: row.effective_at } : {}),
    ...(row.valid_until ? { valid_until: row.valid_until } : {}),
    ...(row.last_verified_at ? { last_verified_at: row.last_verified_at } : {}),
    ...(row.review_owner_id ? { review_owner_id: row.review_owner_id } : {}),
    updated_at: row.updated_at,
  };
}

export interface ListKnowledgeClaimsInput {
  status?: KnowledgeClaimRow['status'];
  approval_status?: KnowledgeApprovalStatus;
  needs_review?: boolean;
  review_owner_id?: string;
  query?: string;
  limit?: number;
}

/** List claim envelopes for the admin governance/review queue. */
export async function listKnowledgeClaimsForReview(
  db: DbPool,
  actor: ActorContext,
  input: ListKnowledgeClaimsInput,
): Promise<{ claims: KnowledgeClaimRecord[]; count: number }> {
  const options: ListKnowledgeClaimsOptions = {
    status: input.status,
    approvalStatus: input.approval_status,
    reviewOwnerId: input.review_owner_id,
    needsReview: input.needs_review,
    query: input.query,
    limit: input.limit,
  };
  const rows = await listKnowledgeClaims(db, actor.tenant_id, options);
  return { claims: rows.map(rowToKnowledgeRecord), count: rows.length };
}

export interface ReviewKnowledgeClaimInput {
  id: string;
  decision: KnowledgeReviewDecision;
  approved_for_external_use?: boolean;
  review_owner_id?: string;
}

/**
 * Translate a review decision into a claim patch. Pure: callers verify the
 * resulting status/approval transition without a database.
 *
 *  - approve: mark approved, re-verify freshness (restart the staleness clock),
 *    and revive a stale/conflicting claim back to active.
 *  - reject: retire the claim (approval + lifecycle both rejected).
 *  - deprecate: retire the claim's lifecycle but keep its approval history.
 *  - mark_stale: force it into the review queue.
 *  - reactivate: restore a stale/deprecated claim to active and re-verify.
 */
export function reviewDecisionToPatch(
  decision: KnowledgeReviewDecision,
  current: Pick<KnowledgeClaimRow, 'status'>,
  opts: { approved_for_external_use?: boolean; review_owner_id?: string } = {},
): ReviewKnowledgeClaimPatch {
  const patch: ReviewKnowledgeClaimPatch = {};
  if (opts.review_owner_id !== undefined) patch.review_owner_id = opts.review_owner_id;

  switch (decision) {
    case 'approve':
      patch.approval_status = 'approved';
      patch.touch_verified = true;
      if (current.status === 'stale' || current.status === 'conflicting') patch.status = 'active';
      if (opts.approved_for_external_use !== undefined) patch.approved_for_external_use = opts.approved_for_external_use;
      break;
    case 'reject':
      patch.approval_status = 'rejected';
      patch.status = 'rejected';
      patch.approved_for_external_use = false;
      break;
    case 'deprecate':
      patch.status = 'deprecated';
      patch.approved_for_external_use = false;
      break;
    case 'mark_stale':
      patch.status = 'stale';
      break;
    case 'reactivate':
      patch.status = 'active';
      patch.touch_verified = true;
      break;
  }
  return patch;
}

/** Apply an admin review decision to a claim envelope. Returns the updated record. */
export async function reviewKnowledgeClaim(
  db: DbPool,
  actor: ActorContext,
  input: ReviewKnowledgeClaimInput,
): Promise<KnowledgeClaimRecord | null> {
  const current = await getKnowledgeClaim(db, actor.tenant_id, input.id);
  if (!current) return null;
  const patch = reviewDecisionToPatch(input.decision, current, {
    approved_for_external_use: input.approved_for_external_use,
    review_owner_id: input.review_owner_id,
  });
  const updated = await reviewKnowledgeClaimRow(db, actor.tenant_id, input.id, patch);
  return updated ? rowToKnowledgeRecord(updated) : null;
}

// ── Conflict detection + source-priority resolution ──────────────────────────

type ConflictClaim = Pick<
  KnowledgeClaimRow,
  'id' | 'title' | 'category' | 'competitors' | 'product_scope' | 'source_priority' | 'approval_status'
>;

function intersect(a: string[], b: string[]): string[] {
  const set = new Set(a.map(s => s.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of b) {
    const key = value.toLowerCase();
    if (set.has(key) && !seen.has(key)) { seen.add(key); out.push(value); }
  }
  return out;
}

/**
 * Whether two same-category claims cover enough common ground to compete, and on
 * what basis. Overlapping competitors are the strongest signal, then overlapping
 * product scope; two broadly-scoped claims (both unscoped) in the same category
 * also compete. Pure.
 */
export function conflictBasis(
  a: ConflictClaim,
  b: ConflictClaim,
): { basis: KnowledgeConflict['basis']; shared: string[] } | null {
  if (a.category !== b.category) return null;
  const sharedCompetitors = intersect(a.competitors ?? [], b.competitors ?? []);
  if (sharedCompetitors.length > 0) return { basis: 'competitor', shared: sharedCompetitors };
  const sharedScope = intersect(a.product_scope ?? [], b.product_scope ?? []);
  if (sharedScope.length > 0) return { basis: 'product_scope', shared: sharedScope };
  const aBroad = (a.competitors ?? []).length === 0 && (a.product_scope ?? []).length === 0;
  const bBroad = (b.competitors ?? []).length === 0 && (b.product_scope ?? []).length === 0;
  if (aBroad && bBroad) return { basis: 'category', shared: [a.category] };
  return null;
}

/**
 * Resolve a competing pair by source priority then approval state. Pure.
 * Returns the recommended action and, when resolvable, the id of the claim that
 * should yield (the "loser").
 */
export function classifyConflict(
  a: ConflictClaim,
  b: ConflictClaim,
): { suggested_action: KnowledgeConflict['suggested_action']; loser_id?: string; detail: string } {
  const rankA = PRIORITY_RANK[a.source_priority];
  const rankB = PRIORITY_RANK[b.source_priority];
  if (rankA !== rankB) {
    const winner = rankA > rankB ? a : b;
    const loser = rankA > rankB ? b : a;
    return {
      suggested_action: 'prefer_authoritative',
      loser_id: loser.id,
      detail: `Prefer "${winner.title}" (${winner.source_priority}) over "${loser.title}" (${loser.source_priority}).`,
    };
  }
  const aApproved = a.approval_status === 'approved';
  const bApproved = b.approval_status === 'approved';
  if (aApproved !== bApproved) {
    const winner = aApproved ? a : b;
    const loser = aApproved ? b : a;
    return {
      suggested_action: 'prefer_approved',
      loser_id: loser.id,
      detail: `Prefer approved claim "${winner.title}" over "${loser.title}" (${loser.approval_status}).`,
    };
  }
  return {
    suggested_action: 'manual_review',
    detail: `"${a.title}" and "${b.title}" have equal priority and approval — needs manual review.`,
  };
}

export interface DetectKnowledgeConflictsInput {
  category?: string;
  competitor?: string;
  apply?: boolean;
  limit?: number;
}

/**
 * Detect competing product claims for a tenant. With `apply`, the lower-priority
 * (or unapproved) claim of each *resolvable* conflict is marked `conflicting` so
 * it stops flowing into customer-facing retrieval until reviewed.
 */
export async function detectKnowledgeConflicts(
  db: DbPool,
  actor: ActorContext,
  input: DetectKnowledgeConflictsInput,
): Promise<{ conflicts: KnowledgeConflict[]; applied: number }> {
  const rows = await listClaimsForConflictScan(db, actor.tenant_id, {
    category: input.category,
    competitor: input.competitor,
    limit: input.limit,
  });

  // Group by category so we only compare claims that could compete.
  const byCategory = new Map<string, ConflictClaim[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }

  const conflicts: KnowledgeConflict[] = [];
  const losersToFlag = new Set<string>();
  for (const group of byCategory.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const basis = conflictBasis(a, b);
        if (!basis) continue;
        const verdict = classifyConflict(a, b);
        conflicts.push({
          claim_a: { id: a.id, title: a.title, source_priority: a.source_priority, approval_status: a.approval_status },
          claim_b: { id: b.id, title: b.title, source_priority: b.source_priority, approval_status: b.approval_status },
          category: a.category,
          basis: basis.basis,
          shared: basis.shared,
          suggested_action: verdict.suggested_action,
          detail: verdict.detail,
        });
        if (verdict.loser_id) losersToFlag.add(verdict.loser_id);
      }
    }
  }

  let applied = 0;
  if (input.apply) {
    for (const loserId of losersToFlag) {
      const updated = await reviewKnowledgeClaimRow(db, actor.tenant_id, loserId, { status: 'conflicting' });
      if (updated) applied++;
    }
  }

  return { conflicts, applied };
}

// ── Stale review assignments (mirrors services/staleness.ts) ─────────────────

function reviewReason(claim: { status: string; approval_status: string }): string {
  if (claim.status === 'stale') return 'reached its freshness window and needs re-verification';
  if (claim.status === 'conflicting') return 'was flagged as conflicting with another product claim';
  if (claim.approval_status === 'pending') return 'is pending approval before customer-facing use';
  return 'needs review before customer-facing use';
}

/** Open review assignments for one tenant's owned claims needing attention. */
export async function processKnowledgeReviewsForTenant(
  db: DbPool,
  tenantId: string,
  limit = 20,
): Promise<number> {
  const claims = await listKnowledgeClaimsNeedingReviewAssignment(db, tenantId, limit);
  let created = 0;
  for (const claim of claims) {
    await createAssignment(db, tenantId, {
      title: `Review product claim: ${claim.category}`,
      description: `The product knowledge claim "${claim.title}" ${reviewReason(claim)}.`,
      assignment_type: 'knowledge_claim_review',
      assigned_by: claim.created_by ?? claim.review_owner_id,
      assigned_to: claim.review_owner_id,
      priority: claim.status === 'conflicting' ? 'high' : 'normal',
      metadata: { knowledge_claim_id: claim.id, category: claim.category, claim_status: claim.status },
    });
    created++;
  }
  return created;
}

/**
 * Background sweep: open review assignments for owned product claims that are
 * stale, conflicting, or pending approval. Best-effort and non-blocking.
 */
export async function processKnowledgeReviews(db: DbPool, limit = 20): Promise<void> {
  let tenants: string[];
  try {
    tenants = await listTenantsWithReviewableClaims(db);
  } catch {
    return;
  }
  for (const tenantId of tenants) {
    try {
      await processKnowledgeReviewsForTenant(db, tenantId, limit);
    } catch (err) {
      console.error(`[knowledge-governance] tenant ${tenantId} review sweep failed:`, err instanceof Error ? err.message : err);
    }
  }
}
