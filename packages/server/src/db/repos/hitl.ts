// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { HITLRequest, UUID } from '@crmy/shared';

export async function createHITLRequest(
  db: DbPool,
  tenantId: UUID,
  data: {
    agent_id: string;
    session_id?: string;
    action_type: string;
    action_summary: string;
    action_payload: unknown;
    auto_approve_after_seconds?: number;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    sla_minutes?: number;
    escalate_to_id?: UUID;
    handoff_snapshot_id?: UUID;
  },
): Promise<HITLRequest> {
  // Evaluate auto-approval rules before inserting
  const { evaluateApprovalRules } = await import('../../hitl/rules-engine.js');
  const ruleResult = await evaluateApprovalRules(db, tenantId, {
    action_type: data.action_type,
    action_payload: data.action_payload,
  });
  if (ruleResult.matched) {
    // Short-circuit: insert with decision already applied
    const result = await db.query(
      `INSERT INTO hitl_requests (tenant_id, agent_id, session_id,
         action_type, action_summary, action_payload,
         auto_approve_after, priority, sla_minutes, escalate_to_id,
         handoff_snapshot_id, status, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11, now())
       RETURNING *`,
      [
        tenantId,
        data.agent_id,
        data.session_id ?? null,
        data.action_type,
        data.action_summary,
        JSON.stringify(data.action_payload),
        data.priority ?? 'normal',
        data.sla_minutes ?? 1440,
        data.escalate_to_id ?? null,
        data.handoff_snapshot_id ?? null,
        ruleResult.decision === 'approved' ? 'auto_approved' : 'rejected',
      ],
    );
    return result.rows[0] as HITLRequest;
  }

  const autoApproveAfter = data.auto_approve_after_seconds
    ? new Date(Date.now() + data.auto_approve_after_seconds * 1000).toISOString()
    : null;

  const result = await db.query(
    `INSERT INTO hitl_requests (tenant_id, agent_id, session_id,
       action_type, action_summary, action_payload,
       auto_approve_after, priority, sla_minutes, escalate_to_id, handoff_snapshot_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      tenantId,
      data.agent_id,
      data.session_id ?? null,
      data.action_type,
      data.action_summary,
      JSON.stringify(data.action_payload),
      autoApproveAfter,
      data.priority ?? 'normal',
      data.sla_minutes ?? 1440,
      data.escalate_to_id ?? null,
      data.handoff_snapshot_id ?? null,
    ],
  );
  return result.rows[0] as HITLRequest;
}

/**
 * Find pending HITL requests that have breached their SLA and not yet been escalated.
 */
export async function findSlaBreachedRequests(db: DbPool): Promise<HITLRequest[]> {
  const result = await db.query(
    `SELECT * FROM hitl_requests
     WHERE status = 'pending'
       AND escalated_at IS NULL
       AND created_at + (sla_minutes * interval '1 minute') < now()
     ORDER BY created_at ASC
     LIMIT 50`,
  );
  return result.rows as HITLRequest[];
}

/**
 * Mark a HITL request as escalated and set escalated_at timestamp.
 */
export async function markHitlEscalated(db: DbPool, id: UUID): Promise<void> {
  await db.query(
    `UPDATE hitl_requests SET escalated_at = now() WHERE id = $1`,
    [id],
  );
}

/**
 * Mark a HITL request as notified (submission notification sent).
 */
export async function markHitlNotified(db: DbPool, id: UUID): Promise<void> {
  await db.query(
    `UPDATE hitl_requests SET notified_at = now() WHERE id = $1`,
    [id],
  );
}

export async function getHITLRequest(db: DbPool, tenantId: UUID, id: UUID): Promise<HITLRequest | null> {
  const result = await db.query(
    'SELECT * FROM hitl_requests WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as HITLRequest) ?? null;
}

export async function getHITLRequestBySnapshot(db: DbPool, tenantId: UUID, snapshotId: UUID): Promise<HITLRequest | null> {
  const result = await db.query(
    'SELECT * FROM hitl_requests WHERE handoff_snapshot_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1',
    [snapshotId, tenantId],
  );
  return (result.rows[0] as HITLRequest) ?? null;
}

export async function findPendingHITLByPayload(
  db: DbPool,
  tenantId: UUID,
  actionType: string,
  payload: Record<string, unknown>,
): Promise<HITLRequest | null> {
  const result = await db.query(
    `SELECT *
     FROM hitl_requests
     WHERE tenant_id = $1
       AND action_type = $2
       AND status = 'pending'
       AND action_payload @> $3::jsonb
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, actionType, JSON.stringify(payload)],
  );
  return (result.rows[0] as HITLRequest | undefined) ?? null;
}

export async function listPendingHITL(
  db: DbPool,
  tenantId: UUID,
  limit: number,
): Promise<HITLRequest[]> {
  const result = await db.query(
    `SELECT * FROM hitl_requests
     WHERE tenant_id = $1 AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, limit],
  );
  return result.rows as HITLRequest[];
}

export async function listHITLRequests(
  db: DbPool,
  tenantId: UUID,
  options: {
    status?: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved' | 'all';
    limit: number;
  },
): Promise<HITLRequest[]> {
  const params: unknown[] = [tenantId];
  const conditions = ['tenant_id = $1'];
  if (options.status && options.status !== 'all') {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }
  params.push(options.limit);
  const result = await db.query(
    `SELECT *
     FROM hitl_requests
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows as HITLRequest[];
}

const HITL_PAYLOAD_TYPE_SQL = `COALESCE(
  h.action_payload->>'subject_type',
  h.action_payload->>'_subject_type',
  h.action_payload->>'object_type',
  h.action_payload->>'target_object_type'
)`;

const HITL_PAYLOAD_ID_SQL = `COALESCE(
  h.action_payload->>'subject_id',
  h.action_payload->>'_subject_id',
  h.action_payload->>'object_id',
  h.action_payload->>'target_object_id'
)`;

const UUID_REGEX = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

function safeUuidCast(sql: string): string {
  return `CASE WHEN ${sql} ~* '${UUID_REGEX}' THEN (${sql})::uuid ELSE NULL END`;
}

function ownedSubjectExists(table: string, type: string, ownerParam: number): string {
  return `EXISTS (
    SELECT 1 FROM ${table} o
    WHERE o.tenant_id = h.tenant_id
      AND o.owner_id = ANY($${ownerParam}::uuid[])
      AND ${HITL_PAYLOAD_TYPE_SQL} = '${type}'
      AND o.id = ${safeUuidCast(HITL_PAYLOAD_ID_SQL)}
  )`;
}

function ownedSessionSubjectExists(table: string, type: string, ownerParam: number): string {
  return `EXISTS (
    SELECT 1
    FROM agent_sessions s
    JOIN ${table} o
      ON o.tenant_id = s.tenant_id
     AND o.id = s.context_id
     AND o.owner_id = ANY($${ownerParam}::uuid[])
    WHERE s.tenant_id = h.tenant_id
      AND s.id::text = h.session_id
      AND s.context_type = '${type}'
  )`;
}

function ownedLinkedArtifactExists(table: string, payloadKey: string, ownerParam: number): string {
  return `EXISTS (
    SELECT 1
    FROM ${table} linked
    LEFT JOIN accounts a
      ON a.tenant_id = linked.tenant_id
     AND linked.subject_type = 'account'
     AND a.id = linked.subject_id
    LEFT JOIN contacts c
      ON c.tenant_id = linked.tenant_id
     AND linked.subject_type = 'contact'
     AND c.id = linked.subject_id
    LEFT JOIN opportunities o
      ON o.tenant_id = linked.tenant_id
     AND linked.subject_type = 'opportunity'
     AND o.id = linked.subject_id
    LEFT JOIN use_cases u
      ON u.tenant_id = linked.tenant_id
     AND linked.subject_type = 'use_case'
     AND u.id = linked.subject_id
    WHERE linked.tenant_id = h.tenant_id
      AND linked.id = ${safeUuidCast(`h.action_payload->>'${payloadKey}'`)}
      AND COALESCE(a.owner_id, c.owner_id, o.owner_id, u.owner_id) = ANY($${ownerParam}::uuid[])
  )`;
}

export async function listVisibleHITLRequests(
  db: DbPool,
  tenantId: UUID,
  options: {
    status?: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved' | 'all';
    limit: number;
    actorId: string;
    visibleOwnerIds: UUID[];
  },
): Promise<HITLRequest[]> {
  const params: unknown[] = [tenantId];
  const conditions = ['h.tenant_id = $1'];
  if (options.status && options.status !== 'all') {
    params.push(options.status);
    conditions.push(`h.status = $${params.length}`);
  }
  params.push(options.actorId);
  const actorParam = params.length;
  params.push(options.visibleOwnerIds);
  const ownerParam = params.length;
  params.push(options.limit);
  const limitParam = params.length;

  const ownerPredicates = options.visibleOwnerIds.length > 0
    ? [
        ownedSubjectExists('accounts', 'account', ownerParam),
        ownedSubjectExists('contacts', 'contact', ownerParam),
        ownedSubjectExists('opportunities', 'opportunity', ownerParam),
        ownedSubjectExists('use_cases', 'use_case', ownerParam),
        ownedSessionSubjectExists('accounts', 'account', ownerParam),
        ownedSessionSubjectExists('contacts', 'contact', ownerParam),
        ownedSessionSubjectExists('opportunities', 'opportunity', ownerParam),
        ownedSessionSubjectExists('use_cases', 'use_case', ownerParam),
        ownedLinkedArtifactExists('signal_groups', 'signal_group_id', ownerParam),
        ownedLinkedArtifactExists('context_entries', 'context_entry_id', ownerParam),
        ownedLinkedArtifactExists('raw_context_sources', 'raw_context_source_id', ownerParam),
      ]
    : [];

  const visibility = [
    `h.agent_id = $${actorParam}`,
    `h.reviewer_id::text = $${actorParam}`,
    `h.escalate_to_id::text = $${actorParam}`,
    `EXISTS (
      SELECT 1 FROM agent_sessions s
      WHERE s.tenant_id = h.tenant_id
        AND s.id::text = h.session_id
        AND s.user_id::text = $${actorParam}
    )`,
    ...ownerPredicates,
  ].join('\n      OR ');

  const result = await db.query(
    `SELECT h.*
     FROM hitl_requests h
     WHERE ${conditions.join(' AND ')}
       AND (${visibility})
     ORDER BY h.created_at DESC
     LIMIT $${limitParam}`,
    params,
  );
  return result.rows as HITLRequest[];
}

export async function updatePendingHITLRequest(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: {
    action_summary?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    sla_minutes?: number | null;
    escalate_to_id?: UUID | null;
  },
): Promise<HITLRequest | null> {
  const result = await db.query(
    `UPDATE hitl_requests
     SET action_summary = COALESCE($3, action_summary),
         priority = COALESCE($4, priority),
         sla_minutes = CASE WHEN $6 THEN $5 ELSE sla_minutes END,
         escalate_to_id = CASE WHEN $8 THEN $7 ELSE escalate_to_id END
     WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
     RETURNING *`,
    [
      id,
      tenantId,
      patch.action_summary ?? null,
      patch.priority ?? null,
      patch.sla_minutes ?? null,
      patch.sla_minutes !== undefined,
      patch.escalate_to_id ?? null,
      patch.escalate_to_id !== undefined,
    ],
  );
  return (result.rows[0] as HITLRequest | undefined) ?? null;
}

export async function mergeHITLActionPayload(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  payload: Record<string, unknown>,
): Promise<HITLRequest | null> {
  const result = await db.query(
    `UPDATE hitl_requests
     SET action_payload = COALESCE(action_payload, '{}'::jsonb) || $3::jsonb
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [id, tenantId, JSON.stringify(payload)],
  );
  return (result.rows[0] as HITLRequest | undefined) ?? null;
}

export async function resolveHITLRequest(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  decision: 'approved' | 'rejected',
  reviewerId?: UUID,
  note?: string,
): Promise<HITLRequest | null> {
  const result = await db.query(
    `UPDATE hitl_requests
     SET status = $3, reviewer_id = $4, review_note = $5, resolved_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
     RETURNING *`,
    [id, tenantId, decision, reviewerId ?? null, note ?? null],
  );
  return (result.rows[0] as HITLRequest) ?? null;
}

export async function autoApproveExpired(db: DbPool): Promise<HITLRequest[]> {
  const result = await db.query(
    `UPDATE hitl_requests
     SET status = 'auto_approved', resolved_at = now()
     WHERE status = 'pending' AND auto_approve_after IS NOT NULL AND auto_approve_after <= now()
     RETURNING *`,
  );
  return result.rows as HITLRequest[];
}

export async function expireOldRequests(db: DbPool): Promise<number> {
  const result = await db.query(
    `UPDATE hitl_requests
     SET status = 'expired', resolved_at = now()
     WHERE status = 'pending' AND expires_at <= now()`,
  );
  return result.rowCount ?? 0;
}

// ─── Approval Rules CRUD ─────────────────────────────────────────────────────

export interface ApprovalRule {
  id: UUID;
  tenant_id: UUID;
  name: string;
  action_type: string | null;
  condition: unknown;
  decision: 'approved' | 'rejected';
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function listApprovalRules(db: DbPool, tenantId: UUID): Promise<ApprovalRule[]> {
  const result = await db.query(
    `SELECT * FROM hitl_approval_rules WHERE tenant_id = $1 ORDER BY priority DESC, created_at ASC`,
    [tenantId],
  );
  return result.rows as ApprovalRule[];
}

export async function createApprovalRule(
  db: DbPool,
  tenantId: UUID,
  data: {
    name: string;
    action_type?: string | null;
    condition?: unknown;
    decision: 'approved' | 'rejected';
    priority?: number;
    is_active?: boolean;
  },
): Promise<ApprovalRule> {
  const result = await db.query(
    `INSERT INTO hitl_approval_rules (tenant_id, name, action_type, condition, decision, priority, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      tenantId,
      data.name,
      data.action_type ?? null,
      JSON.stringify(data.condition ?? {}),
      data.decision,
      data.priority ?? 0,
      data.is_active ?? true,
    ],
  );
  return result.rows[0] as ApprovalRule;
}

export async function updateApprovalRule(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  data: Partial<{
    name: string;
    action_type: string | null;
    condition: unknown;
    decision: 'approved' | 'rejected';
    priority: number;
    is_active: boolean;
  }>,
): Promise<ApprovalRule | null> {
  const sets: string[] = [];
  const vals: unknown[] = [id, tenantId];
  let idx = 3;

  if (data.name !== undefined)        { sets.push(`name = $${idx++}`);        vals.push(data.name); }
  if (data.action_type !== undefined) { sets.push(`action_type = $${idx++}`); vals.push(data.action_type); }
  if (data.condition !== undefined)   { sets.push(`condition = $${idx++}`);   vals.push(JSON.stringify(data.condition)); }
  if (data.decision !== undefined)    { sets.push(`decision = $${idx++}`);    vals.push(data.decision); }
  if (data.priority !== undefined)    { sets.push(`priority = $${idx++}`);    vals.push(data.priority); }
  if (data.is_active !== undefined)   { sets.push(`is_active = $${idx++}`);   vals.push(data.is_active); }

  if (sets.length === 0) return null;
  sets.push(`updated_at = now()`);

  const result = await db.query(
    `UPDATE hitl_approval_rules SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    vals,
  );
  return (result.rows[0] as ApprovalRule) ?? null;
}

export async function deleteApprovalRule(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM hitl_approval_rules WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}
