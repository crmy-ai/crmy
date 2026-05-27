// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ContextEntry, PaginatedResponse, SubjectType, UUID } from '@crmy/shared';
import type { DbPool } from '../pool.js';

export type SignalGroupStatus = 'gathering' | 'ready' | 'promoted' | 'blocked' | 'dismissed' | 'conflicting' | 'merged';
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
  subject_name?: string | null;
  dismissed_at?: string | null;
  dismissed_by?: UUID | null;
  merged_into_signal_group_id?: UUID | null;
  merged_at?: string | null;
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
       AND context_type = $4
       AND status NOT IN ('dismissed', 'merged')
       AND merged_into_signal_group_id IS NULL
       AND (
         (subject_type = $2 AND subject_id = $3)
         OR (
           $2 = 'contact'
           AND subject_type = 'account'
           AND subject_id = (
             SELECT account_id FROM contacts
             WHERE tenant_id = $1 AND id = $3 AND account_id IS NOT NULL
           )
         )
         OR (
           $2 = 'account'
           AND subject_type = 'contact'
           AND subject_id IN (
             SELECT id FROM contacts
             WHERE tenant_id = $1 AND account_id = $3
           )
         )
         OR (
           $2 = 'account'
           AND subject_type = 'opportunity'
           AND subject_id IN (
             SELECT id FROM opportunities
             WHERE tenant_id = $1 AND account_id = $3
           )
         )
         OR (
           $2 = 'account'
           AND subject_type = 'use_case'
           AND subject_id IN (
             SELECT id FROM use_cases
             WHERE tenant_id = $1 AND account_id = $3
           )
         )
         OR (
           $2 IN ('opportunity', 'use_case')
           AND subject_type = 'account'
           AND subject_id = COALESCE(
             (SELECT account_id FROM opportunities WHERE tenant_id = $1 AND id = $3),
             (SELECT account_id FROM use_cases WHERE tenant_id = $1 AND id = $3)
           )
         )
       )
     ORDER BY updated_at DESC
     LIMIT 50`,
    [tenantId, input.subject_type, input.subject_id, input.context_type],
  );
  return result.rows as SignalGroup[];
}

export async function semanticCandidateGroups(
  db: DbPool,
  tenantId: UUID | string,
  input: {
    subject_type: string;
    subject_id: string;
    context_type: string;
    embedding: number[];
    limit?: number;
  },
): Promise<Array<SignalGroup & { vector_similarity: number }>> {
  const result = await db.query(
    `SELECT sg.*,
       1 - (sg.embedding <=> $5::vector) AS vector_similarity
     FROM signal_groups sg
     WHERE sg.tenant_id = $1
       AND sg.context_type = $4
       AND sg.status NOT IN ('dismissed', 'merged')
       AND sg.merged_into_signal_group_id IS NULL
       AND sg.embedding IS NOT NULL
       AND (
         (sg.subject_type = $2 AND sg.subject_id = $3)
         OR (
           $2 = 'contact'
           AND sg.subject_type = 'account'
           AND sg.subject_id = (
             SELECT account_id FROM contacts
             WHERE tenant_id = $1 AND id = $3 AND account_id IS NOT NULL
           )
         )
         OR (
           $2 = 'account'
           AND sg.subject_type = 'contact'
           AND sg.subject_id IN (
             SELECT id FROM contacts
             WHERE tenant_id = $1 AND account_id = $3
           )
         )
         OR (
           $2 = 'account'
           AND sg.subject_type = 'opportunity'
           AND sg.subject_id IN (
             SELECT id FROM opportunities
             WHERE tenant_id = $1 AND account_id = $3
           )
         )
         OR (
           $2 = 'account'
           AND sg.subject_type = 'use_case'
           AND sg.subject_id IN (
             SELECT id FROM use_cases
             WHERE tenant_id = $1 AND account_id = $3
           )
         )
         OR (
           $2 IN ('opportunity', 'use_case')
           AND sg.subject_type = 'account'
           AND sg.subject_id = COALESCE(
             (SELECT account_id FROM opportunities WHERE tenant_id = $1 AND id = $3),
             (SELECT account_id FROM use_cases WHERE tenant_id = $1 AND id = $3)
           )
         )
       )
     ORDER BY sg.embedding <=> $5::vector
     LIMIT $6`,
    [
      tenantId,
      input.subject_type,
      input.subject_id,
      input.context_type,
      `[${input.embedding.join(',')}]`,
      input.limit ?? 25,
    ],
  );
  return result.rows as Array<SignalGroup & { vector_similarity: number }>;
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
    `SELECT sg.*,
       CASE sg.subject_type
         WHEN 'contact'     THEN (SELECT COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), email) FROM contacts WHERE id = sg.subject_id AND tenant_id = sg.tenant_id)
         WHEN 'account'     THEN (SELECT name FROM accounts WHERE id = sg.subject_id AND tenant_id = sg.tenant_id)
         WHEN 'opportunity' THEN (SELECT name FROM opportunities WHERE id = sg.subject_id AND tenant_id = sg.tenant_id)
         WHEN 'use_case'    THEN (SELECT name FROM use_cases WHERE id = sg.subject_id AND tenant_id = sg.tenant_id)
       END AS subject_name
     FROM signal_groups sg WHERE sg.tenant_id = $1 AND sg.id = $2`,
    [tenantId, id],
  );
  const group = groupResult.rows[0] as SignalGroup | undefined;
  if (!group) return null;
  const memberResult = await db.query(
    `SELECT sgm.*,
       to_jsonb(ce.*) || jsonb_build_object(
         'subject_name',
         CASE ce.subject_type
           WHEN 'contact'     THEN (SELECT COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), email) FROM contacts WHERE id = ce.subject_id AND tenant_id = ce.tenant_id)
           WHEN 'account'     THEN (SELECT name FROM accounts WHERE id = ce.subject_id AND tenant_id = ce.tenant_id)
           WHEN 'opportunity' THEN (SELECT name FROM opportunities WHERE id = ce.subject_id AND tenant_id = ce.tenant_id)
           WHEN 'use_case'    THEN (SELECT name FROM use_cases WHERE id = ce.subject_id AND tenant_id = ce.tenant_id)
         END
       ) AS context_entry
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

export async function listGroupsForContextEntry(
  db: DbPool,
  tenantId: UUID | string,
  contextEntryId: UUID | string,
): Promise<SignalGroup[]> {
  const result = await db.query(
    `SELECT sg.*
     FROM signal_groups sg
     JOIN signal_group_members sgm ON sgm.signal_group_id = sg.id AND sgm.tenant_id = sg.tenant_id
     WHERE sg.tenant_id = $1
       AND sgm.context_entry_id = $2
       AND sg.status <> 'merged'
     ORDER BY sg.updated_at DESC`,
    [tenantId, contextEntryId],
  );
  return result.rows as SignalGroup[];
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
  } else {
    conditions.push(`status <> 'merged'`);
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
    `SELECT sg.*,
       CASE sg.subject_type
         WHEN 'contact'     THEN (SELECT COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), email) FROM contacts WHERE id = sg.subject_id AND tenant_id = sg.tenant_id)
         WHEN 'account'     THEN (SELECT name FROM accounts WHERE id = sg.subject_id AND tenant_id = sg.tenant_id)
         WHEN 'opportunity' THEN (SELECT name FROM opportunities WHERE id = sg.subject_id AND tenant_id = sg.tenant_id)
         WHEN 'use_case'    THEN (SELECT name FROM use_cases WHERE id = sg.subject_id AND tenant_id = sg.tenant_id)
       END AS subject_name
     FROM signal_groups sg
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

export async function updateSignalGroupEmbedding(
  db: DbPool,
  tenantId: UUID | string,
  id: UUID | string,
  embedding: number[],
): Promise<void> {
  await db.query(
    `UPDATE signal_groups SET embedding = $3::vector WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, `[${embedding.join(',')}]`],
  );
}

export async function markSignalGroupMerged(
  db: DbPool,
  tenantId: UUID | string,
  sourceGroupId: UUID | string,
  targetGroupId: UUID | string,
): Promise<SignalGroup | null> {
  const result = await db.query(
    `UPDATE signal_groups
     SET status = 'merged',
         merged_into_signal_group_id = $3,
         merged_at = now(),
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2
       AND status IN ('gathering', 'ready', 'blocked', 'conflicting')
       AND promoted_context_entry_id IS NULL
     RETURNING *`,
    [tenantId, sourceGroupId, targetGroupId],
  );
  return (result.rows[0] as SignalGroup | undefined) ?? null;
}

export async function moveSignalGroupMembers(
  db: DbPool,
  tenantId: UUID | string,
  sourceGroupId: UUID | string,
  targetGroupId: UUID | string,
): Promise<number> {
  const result = await db.query(
    `UPDATE signal_group_members
     SET signal_group_id = $3
     WHERE tenant_id = $1
       AND signal_group_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM signal_group_members existing
         WHERE existing.tenant_id = signal_group_members.tenant_id
           AND existing.signal_group_id = $3
           AND existing.context_entry_id = signal_group_members.context_entry_id
       )`,
    [tenantId, sourceGroupId, targetGroupId],
  );
  return result.rowCount ?? 0;
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

export async function updateSignalGroupMetadata(
  db: DbPool,
  tenantId: UUID | string,
  id: UUID | string,
  metadata: Record<string, unknown>,
): Promise<SignalGroup | null> {
  const result = await db.query(
    `UPDATE signal_groups
     SET metadata = metadata || $3::jsonb,
         updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenantId, id, JSON.stringify(metadata)],
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
