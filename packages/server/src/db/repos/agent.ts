// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type {
  AgentAttachmentMode,
  AgentEvent,
  AgentSession,
  AgentSessionAttachment,
  AgentTurn,
  AgentTurnEventRow,
} from '../../agent/types.js';
import type { AgentConfig } from '../../agent/types.js';

// ── Config ──────────────────────────────────────────────────────────────────

function normalizeConfig(row: AgentConfig | undefined): AgentConfig | null {
  if (!row) return null;
  return {
    ...row,
    llm_timeout_ms: row.llm_timeout_ms ?? 60_000,
    signal_source_quality: row.signal_source_quality ?? { high: 1.0, medium: 0.9, lower: 0.75, fallback: 0.85 },
  };
}

export async function getConfig(db: DbPool, tenantId: string): Promise<AgentConfig | null> {
  const { rows } = await db.query('SELECT * FROM agent_configs WHERE tenant_id = $1', [tenantId]);
  return normalizeConfig(rows[0]);
}

export async function upsertConfig(
  db: DbPool,
  tenantId: string,
  data: Partial<Omit<AgentConfig, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>,
): Promise<AgentConfig> {
  const fields = Object.keys(data);
  if (fields.length === 0) {
    const existing = await getConfig(db, tenantId);
    if (existing) return existing;
    // Create default
    const { rows } = await db.query(
      'INSERT INTO agent_configs (tenant_id) VALUES ($1) RETURNING *',
      [tenantId],
    );
    return normalizeConfig(rows[0])!;
  }

  const setClauses = fields.map((f, i) => `${f} = $${i + 2}`);
  setClauses.push('updated_at = now()');
  const values = fields.map(f => (data as Record<string, unknown>)[f]);

  const { rows } = await db.query(
    `INSERT INTO agent_configs (tenant_id, ${fields.join(', ')})
     VALUES ($1, ${fields.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (tenant_id) DO UPDATE SET ${setClauses.join(', ')}
     RETURNING *`,
    [tenantId, ...values],
  );
  return normalizeConfig(rows[0])!;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function listSessions(
  db: DbPool,
  tenantId: string,
  userId: string,
  limit = 20,
): Promise<Omit<AgentSession, 'messages'>[]> {
  const { rows } = await db.query(
    `SELECT s.id, s.tenant_id, s.user_id, s.label, s.context_type, s.context_id, s.context_name,
            s.token_count, s.created_at, s.updated_at,
            to_jsonb(t.*) AS active_turn
     FROM agent_sessions s
     LEFT JOIN LATERAL (
       SELECT id, tenant_id, session_id, user_id, status, input_message, context_detail,
              error_message, final_label, worker_id, lease_expires_at, heartbeat_at, attempt_count,
              started_at, completed_at, cancelled_at,
              created_at, updated_at
       FROM agent_turns
       WHERE session_id = s.id
         AND status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT 1
     ) t ON true
     WHERE s.tenant_id = $1 AND s.user_id = $2
     ORDER BY s.updated_at DESC
     LIMIT $3`,
    [tenantId, userId, limit],
  );
  return rows;
}

export async function getSession(
  db: DbPool,
  tenantId: string,
  sessionId: string,
): Promise<AgentSession | null> {
  const { rows } = await db.query(
    `SELECT s.*,
            to_jsonb(t.*) AS active_turn,
            COALESCE(a.attachments, '[]'::jsonb) AS attachments
     FROM agent_sessions s
     LEFT JOIN LATERAL (
       SELECT id, tenant_id, session_id, user_id, status, input_message, context_detail,
              error_message, final_label, worker_id, lease_expires_at, heartbeat_at, attempt_count,
              started_at, completed_at, cancelled_at,
              created_at, updated_at
       FROM agent_turns
       WHERE session_id = s.id
         AND status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT 1
     ) t ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(to_jsonb(att.*) ORDER BY att.created_at DESC) AS attachments
       FROM (
         SELECT id, tenant_id, session_id, user_id, filename, format, mode, status,
                NULL::text AS extracted_text,
                text_excerpt, truncated, raw_context_result, raw_context_source_id,
                consumed_turn_id, consumed_at, error_message, metadata, created_at, updated_at
         FROM agent_session_attachments
         WHERE tenant_id = s.tenant_id AND session_id = s.id
         ORDER BY created_at DESC
         LIMIT 20
       ) att
     ) a ON true
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [sessionId, tenantId],
  );
  return rows[0] ?? null;
}

export async function getLatestSessionForContext(
  db: DbPool,
  tenantId: string,
  userId: string,
  contextType: string,
  contextId: string,
): Promise<AgentSession | null> {
  const { rows } = await db.query(
    `SELECT *
     FROM agent_sessions
     WHERE tenant_id = $1
       AND user_id = $2
       AND context_type = $3
       AND context_id = $4
     ORDER BY updated_at DESC
     LIMIT 1`,
    [tenantId, userId, contextType, contextId],
  );
  return rows[0] ?? null;
}

export async function createSession(
  db: DbPool,
  tenantId: string,
  userId: string,
  data: { context_type?: string; context_id?: string; context_name?: string },
): Promise<AgentSession> {
  const { rows } = await db.query(
    `INSERT INTO agent_sessions (tenant_id, user_id, context_type, context_id, context_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tenantId, userId, data.context_type ?? null, data.context_id ?? null, data.context_name ?? null],
  );
  return rows[0];
}

export async function updateSession(
  db: DbPool,
  tenantId: string,
  sessionId: string,
  data: { messages?: unknown; label?: string; token_count?: number },
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [tenantId, sessionId];
  let idx = 3;

  if (data.messages !== undefined) {
    fields.push(`messages = $${idx++}`);
    values.push(JSON.stringify(data.messages));
  }
  if (data.label !== undefined) {
    fields.push(`label = $${idx++}`);
    values.push(data.label);
  }
  if (data.token_count !== undefined) {
    fields.push(`token_count = $${idx++}`);
    values.push(data.token_count);
  }
  fields.push('updated_at = now()');

  if (fields.length <= 1) return; // only updated_at, no real changes

  await db.query(
    `UPDATE agent_sessions SET ${fields.join(', ')} WHERE id = $2 AND tenant_id = $1`,
    values,
  );
}

export async function deleteSession(db: DbPool, tenantId: string, sessionId: string): Promise<void> {
  await db.query('DELETE FROM agent_sessions WHERE id = $1 AND tenant_id = $2', [sessionId, tenantId]);
}

export async function deleteAllSessions(db: DbPool, tenantId: string): Promise<number> {
  const { rowCount } = await db.query('DELETE FROM agent_sessions WHERE tenant_id = $1', [tenantId]);
  return rowCount ?? 0;
}

// ── Durable turns ───────────────────────────────────────────────────────────

export async function createTurn(
  db: DbPool,
  tenantId: string,
  userId: string,
  sessionId: string,
  data: { input_message: string; context_detail?: string | null },
): Promise<AgentTurn> {
  const { rows } = await db.query(
    `INSERT INTO agent_turns (tenant_id, session_id, user_id, input_message, context_detail)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tenantId, sessionId, userId, data.input_message, data.context_detail ?? null],
  );
  return rows[0];
}

export async function getTurn(db: DbPool, tenantId: string, turnId: string): Promise<AgentTurn | null> {
  const { rows } = await db.query(
    'SELECT * FROM agent_turns WHERE tenant_id = $1 AND id = $2',
    [tenantId, turnId],
  );
  return rows[0] ?? null;
}

export async function getTurnForSession(
  db: DbPool,
  tenantId: string,
  sessionId: string,
  turnId: string,
): Promise<AgentTurn | null> {
  const { rows } = await db.query(
    'SELECT * FROM agent_turns WHERE tenant_id = $1 AND session_id = $2 AND id = $3',
    [tenantId, sessionId, turnId],
  );
  return rows[0] ?? null;
}

export async function getActiveTurnForSession(db: DbPool, tenantId: string, sessionId: string): Promise<AgentTurn | null> {
  const { rows } = await db.query(
    `SELECT *
     FROM agent_turns
     WHERE tenant_id = $1 AND session_id = $2 AND status IN ('queued', 'running')
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, sessionId],
  );
  return rows[0] ?? null;
}

export async function claimTurn(
  db: DbPool,
  tenantId: string,
  turnId: string,
  workerId: string,
  leaseMs: number,
): Promise<AgentTurn | null> {
  const { rows } = await db.query(
    `UPDATE agent_turns
     SET status = 'running',
         started_at = COALESCE(started_at, now()),
         worker_id = $3,
         lease_expires_at = now() + ($4::int || ' milliseconds')::interval,
         heartbeat_at = now(),
         attempt_count = attempt_count + 1,
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2
       AND (
         status = 'queued'
         OR (
           status = 'running'
           AND (
             worker_id = $3
             OR lease_expires_at IS NULL
             OR lease_expires_at < now()
           )
         )
       )
     RETURNING *`,
    [tenantId, turnId, workerId, leaseMs],
  );
  return rows[0] ?? null;
}

export async function claimPendingTurns(db: DbPool, limit = 5, workerId = 'agent-worker', leaseMs = 120_000): Promise<AgentTurn[]> {
  const staleMinutes = Number(process.env.AGENT_TURN_STALE_MINUTES ?? 10);
  const { rows } = await db.query(
    `WITH claim AS (
       SELECT id
       FROM agent_turns
       WHERE status = 'queued'
          OR (
            status = 'running'
            AND (
              lease_expires_at < now()
              OR (
                lease_expires_at IS NULL
                AND updated_at < now() - ($4::int || ' minutes')::interval
              )
            )
          )
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE agent_turns t
     SET status = 'running',
         started_at = COALESCE(t.started_at, now()),
         worker_id = $2,
         lease_expires_at = now() + ($3::int || ' milliseconds')::interval,
         heartbeat_at = now(),
         attempt_count = attempt_count + 1,
         updated_at = now()
     FROM claim
     WHERE t.id = claim.id
     RETURNING t.*`,
    [limit, workerId, leaseMs, staleMinutes],
  );
  return rows;
}

export async function heartbeatTurn(
  db: DbPool,
  tenantId: string,
  turnId: string,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE agent_turns
     SET heartbeat_at = now(),
         lease_expires_at = now() + ($4::int || ' milliseconds')::interval,
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2
       AND worker_id = $3
       AND status = 'running'`,
    [tenantId, turnId, workerId, leaseMs],
  );
  return (rowCount ?? 0) > 0;
}

export async function completeTurn(
  db: DbPool,
  tenantId: string,
  turnId: string,
  data: { final_label?: string | null; worker_id?: string },
): Promise<AgentTurn | null> {
  const { rows } = await db.query(
    `UPDATE agent_turns
     SET status = 'succeeded',
         completed_at = now(),
         final_label = $3,
         lease_expires_at = NULL,
         heartbeat_at = now(),
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2
       AND status = 'running'
       AND ($4::text IS NULL OR worker_id = $4)
     RETURNING *`,
    [tenantId, turnId, data.final_label ?? null, data.worker_id ?? null],
  );
  return rows[0] ?? null;
}

export async function failTurn(
  db: DbPool,
  tenantId: string,
  turnId: string,
  errorMessage: string,
  workerId?: string,
): Promise<AgentTurn | null> {
  const { rows } = await db.query(
    `UPDATE agent_turns
     SET status = 'failed',
         completed_at = now(),
         error_message = $3,
         lease_expires_at = NULL,
         heartbeat_at = now(),
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2
       AND status <> 'cancelled'
       AND ($4::text IS NULL OR worker_id = $4)
     RETURNING *`,
    [tenantId, turnId, errorMessage, workerId ?? null],
  );
  return rows[0] ?? null;
}

export async function cancelTurn(db: DbPool, tenantId: string, turnId: string): Promise<AgentTurn | null> {
  const { rows } = await db.query(
    `UPDATE agent_turns
     SET status = 'cancelled',
         cancelled_at = now(),
         completed_at = now(),
         lease_expires_at = NULL,
         updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status IN ('queued', 'running')
     RETURNING *`,
    [tenantId, turnId],
  );
  return rows[0] ?? null;
}

export async function appendTurnEvent(
  db: DbPool,
  tenantId: string,
  turnId: string,
  event: AgentEvent,
): Promise<AgentTurnEventRow> {
  const { rows } = await db.query(
    `WITH next_idx AS (
       SELECT COALESCE(MAX(event_index), 0) + 1 AS n
       FROM agent_turn_events
       WHERE turn_id = $2
     )
     INSERT INTO agent_turn_events (tenant_id, turn_id, event_index, event_type, payload)
     SELECT $1, $2, n, $3, $4::jsonb
     FROM next_idx
     RETURNING *`,
    [tenantId, turnId, event.type, JSON.stringify(event)],
  );
  await db.query(
    'UPDATE agent_turns SET updated_at = now() WHERE tenant_id = $1 AND id = $2',
    [tenantId, turnId],
  );
  return rows[0];
}

export async function listTurnEventsAfter(
  db: DbPool,
  tenantId: string,
  turnId: string,
  afterIndex = 0,
): Promise<AgentTurnEventRow[]> {
  const { rows } = await db.query(
    `SELECT *
     FROM agent_turn_events
     WHERE tenant_id = $1 AND turn_id = $2 AND event_index > $3
     ORDER BY event_index ASC`,
    [tenantId, turnId, afterIndex],
  );
  return rows;
}

// ── Session attachments ────────────────────────────────────────────────────

export async function createAttachment(
  db: DbPool,
  tenantId: string,
  userId: string,
  sessionId: string,
  data: {
    filename: string;
    format?: string | null;
    mode: AgentAttachmentMode;
    status?: AgentSessionAttachment['status'];
    extracted_text?: string | null;
    text_excerpt?: string | null;
    truncated?: boolean;
    raw_context_result?: unknown;
    raw_context_source_id?: string | null;
    error_message?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<AgentSessionAttachment> {
  const { rows } = await db.query(
    `INSERT INTO agent_session_attachments
       (tenant_id, session_id, user_id, filename, format, mode, status,
        extracted_text, text_excerpt, truncated, raw_context_result,
        raw_context_source_id, error_message, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb)
     RETURNING *`,
    [
      tenantId,
      sessionId,
      userId,
      data.filename,
      data.format ?? null,
      data.mode,
      data.status ?? 'ready',
      data.extracted_text ?? null,
      data.text_excerpt ?? null,
      data.truncated ?? false,
      data.raw_context_result === undefined ? null : JSON.stringify(data.raw_context_result),
      data.raw_context_source_id ?? null,
      data.error_message ?? null,
      JSON.stringify(data.metadata ?? {}),
    ],
  );
  return rows[0];
}

export async function updateAttachment(
  db: DbPool,
  tenantId: string,
  attachmentId: string,
  data: Partial<Pick<AgentSessionAttachment, 'status' | 'error_message' | 'raw_context_result' | 'raw_context_source_id' | 'metadata'>>,
): Promise<AgentSessionAttachment | null> {
  const fields: string[] = [];
  const values: unknown[] = [tenantId, attachmentId];
  let idx = 3;
  if (data.status !== undefined) {
    fields.push(`status = $${idx++}`);
    values.push(data.status);
  }
  if (data.error_message !== undefined) {
    fields.push(`error_message = $${idx++}`);
    values.push(data.error_message);
  }
  if (data.raw_context_result !== undefined) {
    fields.push(`raw_context_result = $${idx++}::jsonb`);
    values.push(JSON.stringify(data.raw_context_result));
  }
  if (data.raw_context_source_id !== undefined) {
    fields.push(`raw_context_source_id = $${idx++}`);
    values.push(data.raw_context_source_id);
  }
  if (data.metadata !== undefined) {
    fields.push(`metadata = $${idx++}::jsonb`);
    values.push(JSON.stringify(data.metadata));
  }
  fields.push('updated_at = now()');
  const { rows } = await db.query(
    `UPDATE agent_session_attachments
     SET ${fields.join(', ')}
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

export async function listSessionAttachments(
  db: DbPool,
  tenantId: string,
  sessionId: string,
  includeText = false,
): Promise<AgentSessionAttachment[]> {
  const textSelect = includeText ? 'extracted_text' : 'NULL::text AS extracted_text';
  const { rows } = await db.query(
    `SELECT id, tenant_id, session_id, user_id, filename, format, mode, status,
            ${textSelect}, text_excerpt, truncated, raw_context_result, raw_context_source_id,
            consumed_turn_id, consumed_at, error_message, metadata, created_at, updated_at
     FROM agent_session_attachments
     WHERE tenant_id = $1 AND session_id = $2
     ORDER BY created_at DESC`,
    [tenantId, sessionId],
  );
  return rows;
}

export async function listPendingActiveContextAttachments(
  db: DbPool,
  tenantId: string,
  sessionId: string,
): Promise<AgentSessionAttachment[]> {
  const { rows } = await db.query(
    `SELECT *
     FROM agent_session_attachments
     WHERE tenant_id = $1
       AND session_id = $2
       AND mode = 'active_context'
       AND status = 'ready'
       AND consumed_at IS NULL
     ORDER BY created_at ASC
     LIMIT 10`,
    [tenantId, sessionId],
  );
  return rows;
}

export async function markAttachmentsConsumed(
  db: DbPool,
  tenantId: string,
  sessionId: string,
  attachmentIds: string[],
  turnId: string,
): Promise<void> {
  if (attachmentIds.length === 0) return;
  await db.query(
    `UPDATE agent_session_attachments
     SET status = 'consumed', consumed_turn_id = $4, consumed_at = now(), updated_at = now()
     WHERE tenant_id = $1 AND session_id = $2 AND id = ANY($3::uuid[])`,
    [tenantId, sessionId, attachmentIds, turnId],
  );
}

export async function deleteAttachment(db: DbPool, tenantId: string, sessionId: string, attachmentId: string): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM agent_session_attachments
     WHERE tenant_id = $1 AND session_id = $2 AND id = $3 AND consumed_at IS NULL`,
    [tenantId, sessionId, attachmentId],
  );
  return rowCount ?? 0;
}

export async function cleanExpiredSessions(db: DbPool): Promise<number> {
  // Join with agent_configs to respect per-tenant retention
  const { rowCount } = await db.query(
    `DELETE FROM agent_sessions s
     USING agent_configs c
     WHERE s.tenant_id = c.tenant_id
       AND c.history_retention_days > 0
       AND s.created_at < now() - (c.history_retention_days || ' days')::interval`,
  );
  return rowCount ?? 0;
}
