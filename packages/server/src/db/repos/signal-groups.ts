// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ContextEntry, PaginatedResponse, SubjectType, UUID } from '@crmy/shared';
import type { DbPool } from '../pool.js';

export type SignalGroupStatus = 'gathering' | 'ready' | 'promoted' | 'blocked' | 'dismissed' | 'conflicting';
export type SignalGroupRelation = 'supports' | 'conflicts' | 'supersedes';

export interface SignalGroup {
  id: UUID;
  tenant_id: UUID;
  subject_type: SubjectType;
  subject_id: UUID;
  context_type: string;
  claim_key: string;
  title?: string | null;
  normalized_claim: string;
  status: SignalGroupStatus;
  aggregate_confidence: number;
  support_count: number;
  independent_source_count: number;
  conflict_count: number;
  evidence_count: number;
  latest_signal_id?: UUID | null;
  promoted_context_entry_id?: UUID | null;
  blocked_reason?: string | null;
  metadata: Record<string, unknown>;
  dismissed_at?: string | null;
  dismissed_by?: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface SignalGroupMember {
  id: UUID;
  tenant_id: UUID;
  signal_group_id: UUID;
  context_entry_id: UUID;
  relation: SignalGroupRelation;
  similarity_score: number;
  evidence_weight: number;
  source_key?: string | null;
  created_at: string;
  context_entry?: ContextEntry;
}

export interface SignalGroupWithMembers extends SignalGroup {
  members: SignalGroupMember[];
}

export async function listCandidateGroups(
  db: DbPool,
  tenantId: UUID | string,
  input: { subject_type: string; subject_id: string; context_type: string },
): Promise<SignalGroup[]> {
  const result = await db.query(
    `SELECT * FROM signal_groups
     WHERE tenant_id = $1
       AND subject_type = $2
       AND subject_id = $3
       AND context_type = $4
       AND status <> 'dismissed'
     ORDER BY updated_at DESC
     LIMIT 50`,
    [tenantId, input.subject_type, input.subject_id, input.context_type],
  );
  return result.rows as SignalGroup[];
}

export async function upsertSignalGroup(
  db: DbPool,
  tenantId: UUID | string,
  input: {
    subject_type: string;
    subject_id: string;
    context_type: string;
    claim_key: string;
    title?: string | null;
    normalized_claim: string;
    metadata?: Record<string, unknown>;
  },
): Promise<SignalGroup> {
  const result = await db.query(
    `INSERT INTO signal_groups (
       tenant_id, subject_type, subject_id, context_type, claim_key,
       title, normalized_claim, metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, subject_type, subject_id, context_type, claim_key)
     DO UPDATE SET
       title = COALESCE(EXCLUDED.title, signal_groups.title),
       normalized_claim = EXCLUDED.normalized_claim,
       metadata = signal_groups.metadata || EXCLUDED.metadata,
       updated_at = now()
     RETURNING *`,
    [
      tenantId,
      input.subject_type,
      input.subject_id,
      input.context_type,
      input.claim_key,
      input.title ?? null,
      input.normalized_claim,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0] as SignalGroup;
}

export async function addSignalGroupMember(
  db: DbPool,
  tenantId: UUID | string,
  input: {
    signal_group_id: string;
    context_entry_id: string;
    relation: SignalGroupRelation;
    similarity_score: number;
    evidence_weight: number;
    source_key?: string | null;
  },
): Promise<SignalGroupMember> {
  const result = await db.query(
    `INSERT INTO signal_group_members (
       tenant_id, signal_group_id, context_entry_id, relation,
       similarity_score, evidence_weight, source_key
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, signal_group_id, context_entry_id)
     DO UPDATE SET
       relation = EXCLUDED.relation,
       similarity_score = GREATEST(signal_group_members.similarity_score, EXCLUDED.similarity_score),
       evidence_weight = GREATEST(signal_group_members.evidence_weight, EXCLUDED.evidence_weight),
       source_key = COALESCE(EXCLUDED.source_key, signal_group_members.source_key)
     RETURNING *`,
    [
      tenantId,
      input.signal_group_id,
      input.context_entry_id,
      input.relation,
      input.similarity_score,
      input.evidence_weight,
      input.source_key ?? null,
    ],
  );
  return result.rows[0] as SignalGroupMember;
}

export async function getSignalGroup(
  db: DbPool,
  tenantId: UUID | string,
  id: UUID | string,
): Promise<SignalGroupWithMembers | null> {
  const groupResult = await db.query(
    `SELECT * FROM signal_groups WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const group = groupResult.rows[0] as SignalGroup | undefined;
  if (!group) return null;
  const memberResult = await db.query(
    `SELECT sgm.*, to_jsonb(ce.*) AS context_entry
     FROM signal_group_members sgm
     JOIN context_entries ce ON ce.id = sgm.context_entry_id AND ce.tenant_id = sgm.tenant_id
     WHERE sgm.tenant_id = $1 AND sgm.signal_group_id = $2
     ORDER BY
       CASE sgm.relation WHEN 'conflicts' THEN 0 WHEN 'supports' THEN 1 ELSE 2 END,
       sgm.created_at DESC`,
    [tenantId, id],
  );
  return {
    ...group,
    members: memberResult.rows as SignalGroupMember[],
  };
}

export async function listSignalGroups(
  db: DbPool,
  tenantId: UUID | string,
  filters: {
    status?: SignalGroupStatus;
    subject_type?: string;
    subject_id?: string;
    context_type?: string;
    attention_only?: boolean;
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<SignalGroup>> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.subject_type) {
    conditions.push(`subject_type = $${idx++}`);
    params.push(filters.subject_type);
  }
  if (filters.subject_id) {
    conditions.push(`subject_id = $${idx++}`);
    params.push(filters.subject_id);
  }
  if (filters.context_type) {
    conditions.push(`context_type = $${idx++}`);
    params.push(filters.context_type);
  }
  if (filters.attention_only) {
    conditions.push(`status IN ('ready', 'blocked', 'conflicting')`);
  }
  if (filters.cursor) {
    conditions.push(`updated_at < $${idx++}`);
    params.push(filters.cursor);
  }

  const where = conditions.join(' AND ');
  const count = await db.query(`SELECT count(*)::int AS total FROM signal_groups WHERE ${where}`, params);
  params.push(filters.limit + 1);
  const rows = await db.query(
    `SELECT * FROM signal_groups
     WHERE ${where}
     ORDER BY
       CASE status WHEN 'conflicting' THEN 0 WHEN 'blocked' THEN 1 WHEN 'ready' THEN 2 WHEN 'gathering' THEN 3 ELSE 4 END,
       updated_at DESC
     LIMIT $${idx}`,
    params,
  );
  const data = rows.rows as SignalGroup[];
  const hasMore = data.length > filters.limit;
  const page = hasMore ? data.slice(0, filters.limit) : data;
  return {
    data: page,
    next_cursor: hasMore ? page[page.length - 1]?.updated_at : undefined,
    total: count.rows[0]?.total ?? 0,
  };
}

export async function updateSignalGroupState(
  db: DbPool,
  tenantId: UUID | string,
  id: UUID | string,
  patch: {
    status: SignalGroupStatus;
    aggregate_confidence: number;
    support_count: number;
    independent_source_count: number;
    conflict_count: number;
    evidence_count: number;
    latest_signal_id?: string | null;
    blocked_reason?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<SignalGroup | null> {
  const result = await db.query(
    `UPDATE signal_groups
     SET status = $3,
         aggregate_confidence = $4,
         support_count = $5,
         independent_source_count = $6,
         conflict_count = $7,
         evidence_count = $8,
         latest_signal_id = COALESCE($9, latest_signal_id),
         blocked_reason = $10,
         metadata = metadata || COALESCE($11::jsonb, '{}'::jsonb),
         updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [
      tenantId,
      id,
      patch.status,
      patch.aggregate_confidence,
      patch.support_count,
      patch.independent_source_count,
      patch.conflict_count,
      patch.evidence_count,
      patch.latest_signal_id ?? null,
      patch.blocked_reason ?? null,
      patch.metadata ? JSON.stringify(patch.metadata) : null,
    ],
  );
  return (result.rows[0] as SignalGroup | undefined) ?? null;
}

export async function markGroupPromoted(
  db: DbPool,
  tenantId: UUID | string,
  id: UUID | string,
  promotedContextEntryId: UUID | string,
): Promise<SignalGroup | null> {
  const result = await db.query(
    `UPDATE signal_groups
     SET status = 'promoted',
         promoted_context_entry_id = $3,
         blocked_reason = NULL,
         updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenantId, id, promotedContextEntryId],
  );
  return (result.rows[0] as SignalGroup | undefined) ?? null;
}

export async function dismissSignalGroup(
  db: DbPool,
  tenantId: UUID | string,
  id: UUID | string,
  actorId: UUID | string,
  reason?: string,
): Promise<SignalGroup | null> {
  const result = await db.query(
    `UPDATE signal_groups
     SET status = 'dismissed',
         dismissed_at = now(),
         dismissed_by = $3,
         blocked_reason = $4,
         updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenantId, id, actorId, reason ?? null],
  );
  return (result.rows[0] as SignalGroup | undefined) ?? null;
}

export async function markSupportSignalsSupersededExcept(
  db: DbPool,
  tenantId: UUID | string,
  groupId: UUID | string,
  promotedEntryId: UUID | string,
): Promise<number> {
  const result = await db.query(
    `UPDATE context_entries ce
     SET memory_status = 'superseded',
         is_current = false,
         updated_at = now()
     FROM signal_group_members sgm
     WHERE sgm.tenant_id = $1
       AND sgm.signal_group_id = $2
       AND sgm.context_entry_id = ce.id
       AND sgm.relation = 'supports'
       AND ce.id <> $3
       AND ce.memory_status = 'signal'`,
    [tenantId, groupId, promotedEntryId],
  );
  return result.rowCount ?? 0;
}
