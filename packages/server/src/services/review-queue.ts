// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext, Assignment, ContextEntry, SubjectType, UUID } from '@crmy/shared';
import { validationError } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as assignmentRepo from '../db/repos/assignments.js';
import * as contextRepo from '../db/repos/context-entries.js';
import { emitEvent } from '../events/emitter.js';
import { memoryClaimTier, memoryFreshnessWindowDays } from './memory-trust.js';

export const REVIEW_ASSIGNMENT_TYPES = [
  'stale_context_review',
  'freshness_context_review',
  'signal_review',
  'contradiction_review',
  'knowledge_claim_review',
] as const;

export type ReviewAssignmentType = typeof REVIEW_ASSIGNMENT_TYPES[number];

export const DEFAULT_REVIEW_ASSIGNMENT_CAP_PER_SUBJECT = 5;
const TERMINAL_STATUSES = ['completed', 'declined', 'cancelled'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const single = stringValue(value);
  return single ? [single] : [];
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.flatMap(stringList))).filter(Boolean);
}

function maxPriority(left: Assignment['priority'], right: Assignment['priority']): Assignment['priority'] {
  return priorityRank(right) > priorityRank(left) ? right : left;
}

function priorityRank(priority: Assignment['priority'] | string | undefined): number {
  switch (priority) {
    case 'urgent': return 4;
    case 'high': return 3;
    case 'normal': return 2;
    case 'low': return 1;
    default: return 0;
  }
}

function metadataFor(assignment: Pick<Assignment, 'metadata'>): Record<string, unknown> {
  return isRecord(assignment.metadata) ? assignment.metadata : {};
}

function contextTypeFor(assignment: Pick<Assignment, 'assignment_type' | 'metadata'>): string | undefined {
  const metadata = metadataFor(assignment);
  return stringValue(metadata.context_type)
    ?? stringValue(metadata.review_context_type)
    ?? (assignment.assignment_type === 'contradiction_review' ? 'risk' : undefined);
}

function tierFor(assignment: Pick<Assignment, 'assignment_type' | 'metadata'>): number {
  const metadata = metadataFor(assignment);
  const tier = numberValue(metadata.memory_claim_tier);
  if (tier === 0 || tier === 1 || tier === 2) return tier;
  return memoryClaimTier(contextTypeFor(assignment));
}

function riskScore(assignment: Assignment): number {
  const metadata = metadataFor(assignment);
  const risk = String(metadata.risk_level ?? metadata.review_risk ?? '').toLowerCase();
  if (assignment.assignment_type === 'contradiction_review') return 40;
  if (risk === 'critical') return 35;
  if (risk === 'high') return 25;
  if (risk === 'medium') return 12;
  return 0;
}

function recencyScore(assignment: Assignment, now = new Date()): number {
  const due = stringValue(assignment.due_at);
  if (!due) return 0;
  const parsed = new Date(due);
  if (Number.isNaN(parsed.getTime())) return 0;
  const ageDays = (now.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.min(20, ageDays));
}

function accountValueScore(assignment: Assignment): number {
  const metadata = metadataFor(assignment);
  const raw = numberValue(metadata.account_value_score)
    ?? numberValue(metadata.account_value)
    ?? numberValue(metadata.arr)
    ?? 0;
  if (raw <= 0) return 0;
  if (raw <= 1) return raw * 10;
  return Math.min(10, Math.log10(raw + 1));
}

export function isReviewAssignmentType(type: string | undefined): type is ReviewAssignmentType {
  return REVIEW_ASSIGNMENT_TYPES.includes(type as ReviewAssignmentType);
}

export function reviewAssignmentRankScore(assignment: Assignment, now = new Date()): number {
  const tier = tierFor(assignment);
  return (tier === 2 ? 300 : tier === 1 ? 120 : 40)
    + priorityRank(assignment.priority) * 30
    + riskScore(assignment)
    + recencyScore(assignment, now)
    + accountValueScore(assignment);
}

export function rankReviewAssignments(assignments: Assignment[], now = new Date()): Assignment[] {
  return [...assignments].sort((left, right) => {
    const byScore = reviewAssignmentRankScore(right, now) - reviewAssignmentRankScore(left, now);
    if (byScore !== 0) return byScore;
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
}

function reviewMetadata(input: {
  base?: Record<string, unknown>;
  reviewKey: string;
  reasons?: string[];
  contextEntryId?: UUID | string;
  contextType?: string;
  subjectType?: SubjectType | string | null;
  subjectId?: UUID | string | null;
  knowledgeClaimId?: UUID | string;
  contradictionKey?: string;
}): Record<string, unknown> {
  const metadata = { ...(input.base ?? {}) };
  metadata.review_key = input.reviewKey;
  metadata.review_reasons = uniqueStrings([metadata.review_reasons, input.reasons ?? []]);
  if (input.contextEntryId) {
    metadata.review_context_entry_id = input.contextEntryId;
    metadata.context_entry_id = metadata.context_entry_id ?? input.contextEntryId;
  }
  if (input.contextType) {
    metadata.context_type = input.contextType;
    metadata.memory_claim_tier = memoryClaimTier(input.contextType);
  }
  if (input.subjectType) metadata.review_subject_type = input.subjectType;
  if (input.subjectId) metadata.review_subject_id = input.subjectId;
  if (input.knowledgeClaimId) metadata.knowledge_claim_id = input.knowledgeClaimId;
  if (input.contradictionKey) metadata.contradiction_key = input.contradictionKey;
  return metadata;
}

function mergedReviewMetadata(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing, ...incoming };
  merged.review_reasons = uniqueStrings([existing.review_reasons, incoming.review_reasons]);
  merged.review_keys = uniqueStrings([existing.review_keys, existing.review_key, incoming.review_keys, incoming.review_key]);
  merged.review_context_entry_ids = uniqueStrings([
    existing.review_context_entry_ids,
    existing.review_context_entry_id,
    existing.stale_context_entry_id,
    existing.signal_context_entry_id,
    incoming.review_context_entry_ids,
    incoming.review_context_entry_id,
    incoming.stale_context_entry_id,
    incoming.signal_context_entry_id,
  ]);
  merged.consolidated_review_count = Number(existing.consolidated_review_count ?? 0) + 1;
  merged.last_consolidated_at = new Date().toISOString();
  return merged;
}

async function findOpenReviewAssignment(
  db: DbPool,
  tenantId: UUID | string,
  input: {
    reviewKey: string;
    contextEntryId?: UUID | string;
    knowledgeClaimId?: UUID | string;
    contradictionKey?: string;
  },
): Promise<Assignment | null> {
  const result = await db.query(
    `SELECT *
     FROM assignments
     WHERE tenant_id = $1
       AND status <> ALL($2::text[])
       AND (
         metadata->>'review_key' = $3
         OR metadata->>'review_keys' = $3
         OR ($4::text IS NOT NULL AND (
           context = $4
           OR metadata->>'review_context_entry_id' = $4
           OR metadata->>'context_entry_id' = $4
           OR metadata->>'stale_context_entry_id' = $4
           OR metadata->>'signal_context_entry_id' = $4
           OR metadata->>'promoted_context_entry_id' = $4
         ))
         OR ($5::text IS NOT NULL AND metadata->>'knowledge_claim_id' = $5)
         OR ($6::text IS NOT NULL AND metadata->>'contradiction_key' = $6)
       )
     ORDER BY
       CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC,
       created_at ASC
     LIMIT 1`,
    [
      tenantId,
      TERMINAL_STATUSES,
      input.reviewKey,
      input.contextEntryId ?? null,
      input.knowledgeClaimId ?? null,
      input.contradictionKey ?? null,
    ],
  );
  return (result.rows[0] as Assignment | undefined) ?? null;
}

async function findSubjectReviewAssignmentForCap(
  db: DbPool,
  tenantId: UUID | string,
  subjectType: string,
  subjectId: UUID | string,
  cap: number,
): Promise<{ assignment: Assignment; count: number } | null> {
  const result = await db.query(
    `SELECT a.*, count(*) OVER()::int AS review_count
     FROM assignments a
     WHERE a.tenant_id = $1
       AND a.subject_type = $2
       AND a.subject_id = $3
       AND a.status <> ALL($4::text[])
       AND (
         a.assignment_type = ANY($5::text[])
         OR a.metadata ? 'review_key'
       )
     ORDER BY
       CASE a.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC,
       a.created_at ASC
     LIMIT 1`,
    [tenantId, subjectType, subjectId, TERMINAL_STATUSES, REVIEW_ASSIGNMENT_TYPES],
  );
  const row = result.rows[0] as (Assignment & { review_count?: number }) | undefined;
  if (!row || Number(row.review_count ?? 0) < cap) return null;
  const { review_count: count, ...assignment } = row;
  return { assignment: assignment as Assignment, count: Number(count ?? cap) };
}

export async function createOrConsolidateReviewAssignment(
  db: DbPool,
  tenantId: UUID | string,
  data: Partial<Assignment> & { assigned_by: UUID },
  options: {
    reviewKey: string;
    reasons?: string[];
    contextEntryId?: UUID | string;
    contextType?: string;
    knowledgeClaimId?: UUID | string;
    contradictionKey?: string;
    capPerSubject?: number;
  },
): Promise<{ assignment: Assignment; created: boolean; consolidated: boolean; capped: boolean }> {
  const metadata = reviewMetadata({
    base: data.metadata as Record<string, unknown> | undefined,
    reviewKey: options.reviewKey,
    reasons: options.reasons,
    contextEntryId: options.contextEntryId,
    contextType: options.contextType,
    subjectType: data.subject_type,
    subjectId: data.subject_id,
    knowledgeClaimId: options.knowledgeClaimId,
    contradictionKey: options.contradictionKey,
  });

  const existing = await findOpenReviewAssignment(db, tenantId, {
    reviewKey: options.reviewKey,
    contextEntryId: options.contextEntryId,
    knowledgeClaimId: options.knowledgeClaimId,
    contradictionKey: options.contradictionKey,
  });
  if (existing) {
    const updated = await assignmentRepo.updateAssignment(db, tenantId as UUID, existing.id, {
      priority: maxPriority(existing.priority, data.priority ?? existing.priority),
      metadata: mergedReviewMetadata(metadataFor(existing), metadata),
    });
    return { assignment: updated ?? existing, created: false, consolidated: true, capped: false };
  }

  const cap = options.capPerSubject ?? DEFAULT_REVIEW_ASSIGNMENT_CAP_PER_SUBJECT;
  if (data.subject_type && data.subject_id) {
    const capped = await findSubjectReviewAssignmentForCap(db, tenantId, data.subject_type, data.subject_id, cap);
    if (capped) {
      const updated = await assignmentRepo.updateAssignment(db, tenantId as UUID, capped.assignment.id, {
        metadata: {
          ...mergedReviewMetadata(metadataFor(capped.assignment), metadata),
          review_cap_per_subject: cap,
          open_review_count_at_consolidation: capped.count,
        },
      });
      return {
        assignment: updated ?? capped.assignment,
        created: false,
        consolidated: true,
        capped: true,
      };
    }
  }

  const assignment = await assignmentRepo.createAssignment(db, tenantId as UUID, {
    ...data,
    metadata,
  });
  return { assignment, created: true, consolidated: false, capped: false };
}

export async function completeOpenReviewAssignmentsForContextEntry(
  db: DbPool,
  tenantId: UUID | string,
  contextEntryId: UUID | string,
  input: {
    actorId: UUID | string;
    actorType?: ActorContext['actor_type'];
    reason: string;
    signalGroupId?: UUID | string;
    regroundingSignalId?: UUID | string;
    completedByActivityId?: UUID | string;
  },
): Promise<Assignment[]> {
  const metadata = {
    auto_resolved: true,
    auto_resolved_reason: input.reason,
    auto_resolved_at: new Date().toISOString(),
    ...(input.signalGroupId ? { signal_group_id: input.signalGroupId } : {}),
    ...(input.regroundingSignalId ? { regrounding_signal_id: input.regroundingSignalId } : {}),
  };
  const result = await db.query(
    `UPDATE assignments
     SET status = 'completed',
         completed_at = now(),
         completed_by_activity_id = COALESCE($5::uuid, completed_by_activity_id),
         metadata = metadata || $3::jsonb,
         updated_at = now()
     WHERE tenant_id = $1
       AND status <> ALL($4::text[])
       AND (
         context = $2
         OR metadata->>'review_context_entry_id' = $2
         OR metadata->>'context_entry_id' = $2
         OR metadata->>'stale_context_entry_id' = $2
         OR metadata->>'signal_context_entry_id' = $2
         OR metadata->>'promoted_context_entry_id' = $2
         OR metadata->>'entry_a_id' = $2
         OR metadata->>'entry_b_id' = $2
         OR metadata->'review_context_entry_ids' ? $2
       )
     RETURNING *`,
    [
      tenantId,
      contextEntryId,
      JSON.stringify(metadata),
      TERMINAL_STATUSES,
      input.completedByActivityId ?? null,
    ],
  );
  const assignments = result.rows as Assignment[];
  for (const assignment of assignments) {
    await emitEvent(db, {
      tenantId: tenantId as UUID,
      eventType: 'assignment.completed',
      actorId: input.actorId as UUID,
      actorType: input.actorType ?? 'agent',
      objectType: 'assignment',
      objectId: assignment.id,
      afterData: { status: 'completed' },
      metadata,
    });
  }
  return assignments;
}

export async function searchRankedReviewQueue(
  db: DbPool,
  tenantId: UUID | string,
  filters: {
    assigned_to?: UUID | string;
    subject_type?: string;
    subject_id?: UUID | string;
    limit?: number;
  } = {},
): Promise<{ assignments: Assignment[]; total: number }> {
  const conditions = [
    'tenant_id = $1',
    'status <> ALL($2::text[])',
    `(assignment_type = ANY($3::text[]) OR metadata ? 'review_key')`,
  ];
  const params: unknown[] = [tenantId, TERMINAL_STATUSES, REVIEW_ASSIGNMENT_TYPES];
  let idx = 4;

  if (filters.assigned_to) {
    conditions.push(`assigned_to = $${idx}`);
    params.push(filters.assigned_to);
    idx++;
  }
  if (filters.subject_type) {
    conditions.push(`subject_type = $${idx}`);
    params.push(filters.subject_type);
    idx++;
  }
  if (filters.subject_id) {
    conditions.push(`subject_id = $${idx}`);
    params.push(filters.subject_id);
    idx++;
  }

  params.push(Math.min(Math.max(filters.limit ?? 20, 1), 100) * 5);
  const result = await db.query(
    `SELECT *
     FROM assignments
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    params,
  );
  const ranked = rankReviewAssignments(result.rows as Assignment[]);
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  return { assignments: ranked.slice(0, limit), total: ranked.length };
}

export async function expireLowValueReviewAssignments(
  db: DbPool,
  tenantId: UUID | string,
  olderThanDays = 30,
): Promise<number> {
  const result = await db.query(
    `UPDATE assignments
     SET status = 'cancelled',
         metadata = metadata || $4::jsonb,
         updated_at = now()
     WHERE tenant_id = $1
       AND status <> ALL($2::text[])
       AND assignment_type = ANY($3::text[])
       AND (
         priority = 'low'
         OR metadata->>'review_value' = 'low'
         OR metadata->>'low_value_review' = 'true'
       )
       AND created_at < now() - ($5 * INTERVAL '1 day')
     RETURNING *`,
    [
      tenantId,
      TERMINAL_STATUSES,
      REVIEW_ASSIGNMENT_TYPES,
      JSON.stringify({
        auto_expired: true,
        auto_expired_reason: 'low_value_review_aged_out',
        auto_expired_at: new Date().toISOString(),
      }),
      Math.max(1, Math.floor(Number(olderThanDays))),
    ],
  );
  const assignments = result.rows as Assignment[];
  for (const assignment of assignments) {
    await emitEvent(db, {
      tenantId: tenantId as UUID,
      eventType: 'assignment.cancelled',
      actorType: 'system',
      objectType: 'assignment',
      objectId: assignment.id,
      afterData: { status: 'cancelled' },
      metadata: {
        auto_expired: true,
        reason: 'low_value_review_aged_out',
      },
    });
  }
  return assignments.length;
}

function evidenceItems(entry: ContextEntry): Array<Record<string, unknown>> {
  return Array.isArray(entry.evidence) ? entry.evidence as Array<Record<string, unknown>> : [];
}

function hasGroundedEvidence(entry: ContextEntry): boolean {
  return evidenceItems(entry).some(item => {
    return Boolean(stringValue(item.snippet) ?? stringValue(item.source_ref) ?? stringValue(item.source));
  });
}

export function agentReviewResolutionPolicy(input: {
  assignment: Pick<Assignment, 'assignment_type' | 'metadata'>;
  entry: ContextEntry;
  openConflictCount?: number;
}): { allowed: boolean; reason?: string } {
  if (!isReviewAssignmentType(input.assignment.assignment_type)) {
    return { allowed: false, reason: 'Only review assignments can be resolved through this tool.' };
  }
  if (input.assignment.assignment_type === 'contradiction_review') {
    return { allowed: false, reason: 'Contradiction reviews need explicit human or contradiction-resolution handling.' };
  }
  if (memoryClaimTier(input.entry.context_type) === 2) {
    return { allowed: false, reason: 'Tier-2 Memory reviews remain human-only.' };
  }
  if ((input.openConflictCount ?? 0) > 0) {
    return { allowed: false, reason: 'This Memory has an unresolved conflict review.' };
  }
  if (!hasGroundedEvidence(input.entry)) {
    return { allowed: false, reason: 'A low-risk agent review still needs grounded evidence.' };
  }
  return { allowed: true };
}

async function countOpenConflictsForContextEntry(
  db: DbPool,
  tenantId: UUID | string,
  entryId: UUID | string,
): Promise<number> {
  const result = await db.query(
    `SELECT count(*)::int AS count
     FROM assignments
     WHERE tenant_id = $1
       AND assignment_type = 'contradiction_review'
       AND status <> ALL($2::text[])
       AND (
         metadata->>'entry_a_id' = $3
         OR metadata->>'entry_b_id' = $3
         OR metadata->'review_context_entry_ids' ? $3
       )`,
    [tenantId, TERMINAL_STATUSES, entryId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

function contextEntryIdForReviewAssignment(assignment: Assignment): UUID | null {
  const metadata = metadataFor(assignment);
  return (stringValue(metadata.review_context_entry_id)
    ?? stringValue(metadata.context_entry_id)
    ?? stringValue(metadata.stale_context_entry_id)
    ?? stringValue(metadata.signal_context_entry_id)
    ?? stringValue(assignment.context)
    ?? null) as UUID | null;
}

export async function resolveLowRiskReviewAssignment(
  db: DbPool,
  tenantId: UUID | string,
  assignment: Assignment,
  actor: ActorContext,
  extendDays?: number,
): Promise<{ assignment: Assignment; context_entry: ContextEntry }> {
  const contextEntryId = contextEntryIdForReviewAssignment(assignment);
  if (!contextEntryId) {
    throw validationError('This review assignment is not linked to a Memory entry.');
  }
  const entry = await contextRepo.getContextEntry(db, tenantId as UUID, contextEntryId);
  if (!entry) throw validationError('The linked Memory entry was not found.');
  const openConflictCount = await countOpenConflictsForContextEntry(db, tenantId, contextEntryId);
  const policy = agentReviewResolutionPolicy({ assignment, entry, openConflictCount });
  if (!policy.allowed) throw validationError(policy.reason ?? 'This review assignment cannot be resolved automatically.');

  const reviewed = await contextRepo.reviewContextEntry(
    db,
    tenantId as UUID,
    contextEntryId,
    extendDays ?? memoryFreshnessWindowDays(entry.context_type),
  );
  if (!reviewed) throw validationError('The linked Memory entry could not be marked reviewed.');

  const completed = await assignmentRepo.completeAssignment(db, tenantId as UUID, assignment.id);
  if (!completed) throw validationError('The review assignment could not be completed from its current status.');

  await emitEvent(db, {
    tenantId: tenantId as UUID,
    eventType: 'assignment.completed',
    actorId: actor.actor_id,
    actorType: actor.actor_type,
    objectType: 'assignment',
    objectId: completed.id,
    beforeData: { status: assignment.status },
    afterData: { status: 'completed' },
    metadata: {
      agent_resolved_review: true,
      context_entry_id: reviewed.id,
      memory_claim_tier: memoryClaimTier(reviewed.context_type),
    },
  });

  return { assignment: completed, context_entry: reviewed };
}
