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
  },
): Promise<HITLRequest> {
  const autoApproveAfter = data.auto_approve_after_seconds
    ? new Date(Date.now() + data.auto_approve_after_seconds * 1000).toISOString()
    : null;

  const result = await db.query(
    `INSERT INTO hitl_requests (tenant_id, agent_id, session_id,
       action_type, action_summary, action_payload,
       auto_approve_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      tenantId,
      data.agent_id,
      data.session_id ?? null,
      data.action_type,
      data.action_summary,
      JSON.stringify(data.action_payload),
      autoApproveAfter,
    ],
  );
  return result.rows[0] as HITLRequest;
}

export async function getHITLRequest(db: DbPool, tenantId: UUID, id: UUID): Promise<HITLRequest | null> {
  const result = await db.query(
    'SELECT * FROM hitl_requests WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as HITLRequest) ?? null;
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
