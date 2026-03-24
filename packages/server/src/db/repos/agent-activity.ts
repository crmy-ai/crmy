// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';

export interface ActivityLogEntry {
  id: string;
  tenant_id: string;
  session_id: string;
  session_label: string | null;
  user_id: string;
  user_name: string | null;
  turn_index: number;
  tool_name: string;
  tool_args: Record<string, unknown>;
  tool_result: unknown;
  is_error: boolean;
  duration_ms: number | null;
  created_at: string;
}

export interface LogActivityInput {
  tenantId: string;
  sessionId: string;
  userId: string;
  turnIndex: number;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult?: unknown;
  isError: boolean;
  durationMs?: number;
}

export interface ListActivityFilters {
  userId?: string;
  toolName?: string;
  isError?: boolean;
  since?: string; // ISO timestamp
  limit?: number;
  cursor?: string; // base64-encoded created_at + id
}

export async function logToolCall(db: DbPool, input: LogActivityInput): Promise<void> {
  await db.query(
    `INSERT INTO agent_activity_log
       (tenant_id, session_id, user_id, turn_index, tool_name, tool_args, tool_result, is_error, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.tenantId,
      input.sessionId,
      input.userId,
      input.turnIndex,
      input.toolName,
      JSON.stringify(input.toolArgs),
      input.toolResult !== undefined ? JSON.stringify(input.toolResult) : null,
      input.isError,
      input.durationMs ?? null,
    ],
  );
}

export async function listActivity(
  db: DbPool,
  tenantId: string,
  filters: ListActivityFilters = {},
): Promise<{ data: ActivityLogEntry[]; total: number; next_cursor?: string }> {
  const limit = Math.min(filters.limit ?? 50, 200);
  const conditions: string[] = ['a.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let pIdx = 2;

  if (filters.userId) {
    conditions.push(`a.user_id = $${pIdx++}`);
    params.push(filters.userId);
  }
  if (filters.toolName) {
    conditions.push(`a.tool_name = $${pIdx++}`);
    params.push(filters.toolName);
  }
  if (filters.isError !== undefined) {
    conditions.push(`a.is_error = $${pIdx++}`);
    params.push(filters.isError);
  }
  if (filters.since) {
    conditions.push(`a.created_at >= $${pIdx++}`);
    params.push(filters.since);
  }
  if (filters.cursor) {
    try {
      const { created_at, id } = JSON.parse(Buffer.from(filters.cursor, 'base64').toString());
      conditions.push(`(a.created_at, a.id) < ($${pIdx++}, $${pIdx++})`);
      params.push(created_at, id);
    } catch { /* ignore bad cursor */ }
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT COUNT(*) FROM agent_activity_log a WHERE ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const rows = await db.query(
    `SELECT
       a.id, a.tenant_id, a.session_id, s.label AS session_label,
       a.user_id, u.name AS user_name,
       a.turn_index, a.tool_name, a.tool_args, a.tool_result,
       a.is_error, a.duration_ms, a.created_at
     FROM agent_activity_log a
     LEFT JOIN agent_sessions s ON s.id = a.session_id
     LEFT JOIN users u ON u.id = a.user_id
     WHERE ${where}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $${pIdx}`,
    [...params, limit + 1],
  );

  const hasMore = rows.rows.length > limit;
  const data: ActivityLogEntry[] = rows.rows.slice(0, limit).map((r) => ({
    ...r,
    tool_args: r.tool_args ?? {},
    tool_result: r.tool_result ?? null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  }));

  let next_cursor: string | undefined;
  if (hasMore && data.length > 0) {
    const last = data[data.length - 1];
    next_cursor = Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString('base64');
  }

  return { data, total, next_cursor };
}

export async function getSessionActivity(
  db: DbPool,
  tenantId: string,
  sessionId: string,
): Promise<ActivityLogEntry[]> {
  const rows = await db.query(
    `SELECT
       a.id, a.tenant_id, a.session_id, s.label AS session_label,
       a.user_id, u.name AS user_name,
       a.turn_index, a.tool_name, a.tool_args, a.tool_result,
       a.is_error, a.duration_ms, a.created_at
     FROM agent_activity_log a
     LEFT JOIN agent_sessions s ON s.id = a.session_id
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.tenant_id = $1 AND a.session_id = $2
     ORDER BY a.created_at ASC, a.id ASC`,
    [tenantId, sessionId],
  );
  return rows.rows.map((r) => ({
    ...r,
    tool_args: r.tool_args ?? {},
    tool_result: r.tool_result ?? null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  }));
}
