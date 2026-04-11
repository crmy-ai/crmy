// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID } from '@crmy/shared';

export interface HandoffSnapshot {
  id: UUID;
  tenant_id: UUID;
  session_id?: string;
  actor_id?: UUID;
  subject_type?: string;
  subject_id?: UUID;
  reasoning: string;
  key_findings: Array<{ finding: string; confidence?: number; entry_id?: UUID }>;
  tools_called: Array<{ tool_name: string; args_summary?: string; result_summary?: string }>;
  confidence?: number;
  handoff_type: 'hitl' | 'assignment' | 'pause';
  reference_id?: UUID;
  created_at: string;
  resumed_at?: string;
}

export async function createSnapshot(
  db: DbPool,
  tenantId: UUID,
  data: Omit<HandoffSnapshot, 'id' | 'tenant_id' | 'created_at' | 'resumed_at'>,
): Promise<HandoffSnapshot> {
  const result = await db.query(
    `INSERT INTO agent_handoff_snapshots
       (tenant_id, session_id, actor_id, subject_type, subject_id,
        reasoning, key_findings, tools_called, confidence, handoff_type, reference_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      tenantId,
      data.session_id ?? null,
      data.actor_id ?? null,
      data.subject_type ?? null,
      data.subject_id ?? null,
      data.reasoning,
      JSON.stringify(data.key_findings),
      JSON.stringify(data.tools_called),
      data.confidence ?? null,
      data.handoff_type,
      data.reference_id ?? null,
    ],
  );
  return result.rows[0] as HandoffSnapshot;
}

export async function getSnapshot(db: DbPool, tenantId: UUID, id: UUID): Promise<HandoffSnapshot | null> {
  const result = await db.query(
    'SELECT * FROM agent_handoff_snapshots WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as HandoffSnapshot) ?? null;
}

export async function markResumed(db: DbPool, id: UUID): Promise<void> {
  await db.query(
    'UPDATE agent_handoff_snapshots SET resumed_at = now() WHERE id = $1',
    [id],
  );
}

export async function linkToHitlRequest(db: DbPool, snapshotId: UUID, hitlRequestId: UUID): Promise<void> {
  await db.query(
    'UPDATE hitl_requests SET handoff_snapshot_id = $1 WHERE id = $2',
    [snapshotId, hitlRequestId],
  );
}

export async function linkToAssignment(db: DbPool, snapshotId: UUID, assignmentId: UUID): Promise<void> {
  await db.query(
    'UPDATE assignments SET handoff_snapshot_id = $1 WHERE id = $2',
    [snapshotId, assignmentId],
  );
}
