// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { AgentConfig, AgentSession } from '../../agent/types.js';

// ── Config ──────────────────────────────────────────────────────────────────

export async function getConfig(db: DbPool, tenantId: string): Promise<AgentConfig | null> {
  const { rows } = await db.query('SELECT * FROM agent_configs WHERE tenant_id = $1', [tenantId]);
  return rows[0] ?? null;
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
    return rows[0];
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
  return rows[0];
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function listSessions(
  db: DbPool,
  tenantId: string,
  userId: string,
  limit = 20,
): Promise<Omit<AgentSession, 'messages'>[]> {
  const { rows } = await db.query(
    `SELECT id, tenant_id, user_id, label, context_type, context_id, context_name,
            token_count, created_at, updated_at
     FROM agent_sessions
     WHERE tenant_id = $1 AND user_id = $2
     ORDER BY updated_at DESC
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
    'SELECT * FROM agent_sessions WHERE id = $1 AND tenant_id = $2',
    [sessionId, tenantId],
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
