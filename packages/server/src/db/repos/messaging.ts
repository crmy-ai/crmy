// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID, PaginatedResponse } from '@crmy/shared';

// ── Row types ───────────────────────────────────────────────────────────────

export interface MessagingChannelRow {
  id: UUID;
  tenant_id: UUID;
  name: string;
  provider: string;
  config: Record<string, unknown>;
  is_active: boolean;
  is_default: boolean;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface MessageDeliveryRow {
  id: UUID;
  tenant_id: UUID;
  channel_id: UUID;
  recipient?: string;
  subject?: string;
  body: string;
  status: string;
  provider_msg_id?: string;
  response_status?: number;
  response_body?: string;
  attempt_count: number;
  max_attempts: number;
  next_retry_at?: string;
  delivered_at?: string;
  error?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── Channel CRUD ────────────────────────────────────────────────────────────

export async function getDefaultChannel(db: DbPool, tenantId: UUID): Promise<MessagingChannelRow | null> {
  const result = await db.query(
    'SELECT * FROM messaging_channels WHERE tenant_id = $1 AND is_default = true AND is_active = true',
    [tenantId],
  );
  return (result.rows[0] as MessagingChannelRow) ?? null;
}

export async function createChannel(
  db: DbPool,
  tenantId: UUID,
  data: { name: string; provider: string; config: Record<string, unknown>; is_active?: boolean; is_default?: boolean; created_by?: UUID },
): Promise<MessagingChannelRow> {
  // If setting as default, clear any existing default for this tenant first
  if (data.is_default) {
    await db.query(
      'UPDATE messaging_channels SET is_default = false WHERE tenant_id = $1 AND is_default = true',
      [tenantId],
    );
  }

  const result = await db.query(
    `INSERT INTO messaging_channels (tenant_id, name, provider, config, is_active, is_default, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [tenantId, data.name, data.provider, JSON.stringify(data.config), data.is_active ?? true, data.is_default ?? false, data.created_by ?? null],
  );
  return result.rows[0] as MessagingChannelRow;
}

export async function getChannel(db: DbPool, tenantId: UUID, id: UUID): Promise<MessagingChannelRow | null> {
  const result = await db.query(
    'SELECT * FROM messaging_channels WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as MessagingChannelRow) ?? null;
}

export async function updateChannel(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Record<string, unknown>,
): Promise<MessagingChannelRow | null> {
  const allowedFields: Record<string, string> = {
    name: 'name',
    config: 'config',
    is_active: 'is_active',
    is_default: 'is_default',
  };

  // If setting as default, clear any existing default for this tenant first
  if (patch.is_default === true) {
    await db.query(
      'UPDATE messaging_channels SET is_default = false WHERE tenant_id = $1 AND is_default = true AND id != $2',
      [tenantId, id],
    );
  }

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  for (const [key, col] of Object.entries(allowedFields)) {
    if (key in patch) {
      sets.push(`${col} = $${idx}`);
      params.push(key === 'config' ? JSON.stringify(patch[key]) : patch[key]);
      idx++;
    }
  }

  if (sets.length === 1) return getChannel(db, tenantId, id);

  const result = await db.query(
    `UPDATE messaging_channels SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as MessagingChannelRow) ?? null;
}

export async function deleteChannel(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM messaging_channels WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listChannels(
  db: DbPool,
  tenantId: UUID,
  filters: { provider?: string; is_active?: boolean; limit: number; cursor?: string },
): Promise<PaginatedResponse<MessagingChannelRow>> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.provider) {
    conditions.push(`provider = $${idx}`);
    params.push(filters.provider);
    idx++;
  }
  if (filters.is_active !== undefined) {
    conditions.push(`is_active = $${idx}`);
    params.push(filters.is_active);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');
  const countResult = await db.query(
    `SELECT count(*)::int as total FROM messaging_channels WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM messaging_channels WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as MessagingChannelRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

// ── Delivery tracking ───────────────────────────────────────────────────────

export async function createDelivery(
  db: DbPool,
  tenantId: UUID,
  data: {
    channel_id: UUID;
    recipient?: string;
    subject?: string;
    body: string;
    metadata?: Record<string, unknown>;
  },
): Promise<MessageDeliveryRow> {
  const result = await db.query(
    `INSERT INTO message_deliveries (tenant_id, channel_id, recipient, subject, body, metadata)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      tenantId,
      data.channel_id,
      data.recipient ?? null,
      data.subject ?? null,
      data.body,
      JSON.stringify(data.metadata ?? {}),
    ],
  );
  return result.rows[0] as MessageDeliveryRow;
}

export async function updateDeliveryStatus(
  db: DbPool,
  id: UUID,
  data: {
    status: string;
    provider_msg_id?: string;
    response_status?: number;
    response_body?: string;
    error?: string;
    next_retry_at?: string;
  },
): Promise<void> {
  const sets = ['status = $2', 'attempt_count = attempt_count + 1'];
  const params: unknown[] = [id, data.status];
  let idx = 3;

  if (data.provider_msg_id !== undefined) {
    sets.push(`provider_msg_id = $${idx}`);
    params.push(data.provider_msg_id);
    idx++;
  }
  if (data.response_status !== undefined) {
    sets.push(`response_status = $${idx}`);
    params.push(data.response_status);
    idx++;
  }
  if (data.response_body !== undefined) {
    sets.push(`response_body = $${idx}`);
    params.push(data.response_body);
    idx++;
  }
  if (data.error !== undefined) {
    sets.push(`error = $${idx}`);
    params.push(data.error);
    idx++;
  }
  if (data.status === 'delivered') {
    sets.push('delivered_at = now()');
  }
  if (data.next_retry_at) {
    sets.push(`next_retry_at = $${idx}`);
    params.push(data.next_retry_at);
    idx++;
  }

  await db.query(`UPDATE message_deliveries SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function getDelivery(db: DbPool, tenantId: UUID, id: UUID): Promise<MessageDeliveryRow | null> {
  const result = await db.query(
    'SELECT * FROM message_deliveries WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as MessageDeliveryRow) ?? null;
}

export async function listDeliveries(
  db: DbPool,
  tenantId: UUID,
  filters: { channel_id?: UUID; status?: string; limit: number; cursor?: string },
): Promise<PaginatedResponse<MessageDeliveryRow>> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.channel_id) {
    conditions.push(`channel_id = $${idx}`);
    params.push(filters.channel_id);
    idx++;
  }
  if (filters.status) {
    conditions.push(`status = $${idx}`);
    params.push(filters.status);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');
  const countResult = await db.query(
    `SELECT count(*)::int as total FROM message_deliveries WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM message_deliveries WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as MessageDeliveryRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

export async function getPendingRetries(db: DbPool, limit: number): Promise<(MessageDeliveryRow & { tenant_id: UUID })[]> {
  const result = await db.query(
    `SELECT * FROM message_deliveries
     WHERE status = 'retrying' AND next_retry_at <= now()
     ORDER BY next_retry_at LIMIT $1`,
    [limit],
  );
  return result.rows as (MessageDeliveryRow & { tenant_id: UUID })[];
}
