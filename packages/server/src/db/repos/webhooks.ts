// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID, PaginatedResponse } from '@crmy/shared';
import crypto from 'node:crypto';

export interface WebhookEndpointRow {
  id: UUID;
  tenant_id: UUID;
  url: string;
  secret: string;
  event_types: string[];
  is_active: boolean;
  description?: string;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface WebhookDeliveryRow {
  id: UUID;
  endpoint_id: UUID;
  event_id?: number;
  event_type: string;
  payload: unknown;
  status: string;
  response_status?: number;
  response_body?: string;
  attempt_count: number;
  next_retry_at?: string;
  delivered_at?: string;
  created_at: string;
}

export async function createWebhook(
  db: DbPool,
  tenantId: UUID,
  data: { url: string; events: string[]; description?: string; created_by?: UUID },
): Promise<WebhookEndpointRow> {
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const result = await db.query(
    `INSERT INTO webhook_endpoints (tenant_id, url, secret, event_types, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tenantId, data.url, secret, data.events, data.description ?? null, data.created_by ?? null],
  );
  return result.rows[0] as WebhookEndpointRow;
}

export async function getWebhook(db: DbPool, tenantId: UUID, id: UUID): Promise<WebhookEndpointRow | null> {
  const result = await db.query(
    'SELECT * FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as WebhookEndpointRow) ?? null;
}

export async function updateWebhook(
  db: DbPool, tenantId: UUID, id: UUID,
  patch: Record<string, unknown>,
): Promise<WebhookEndpointRow | null> {
  const allowedFields: Record<string, string> = {
    url: 'url',
    events: 'event_types',
    active: 'is_active',
    description: 'description',
  };

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  for (const [key, col] of Object.entries(allowedFields)) {
    if (key in patch) {
      sets.push(`${col} = $${idx}`);
      params.push(patch[key]);
      idx++;
    }
  }

  if (sets.length === 1) return getWebhook(db, tenantId, id);

  const result = await db.query(
    `UPDATE webhook_endpoints SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as WebhookEndpointRow) ?? null;
}

export async function deleteWebhook(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listWebhooks(
  db: DbPool, tenantId: UUID,
  filters: { active?: boolean; limit: number; cursor?: string },
): Promise<PaginatedResponse<WebhookEndpointRow>> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.active !== undefined) {
    conditions.push(`is_active = $${idx}`);
    params.push(filters.active);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');
  const countResult = await db.query(`SELECT count(*)::int as total FROM webhook_endpoints WHERE ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM webhook_endpoints WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as WebhookEndpointRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

export async function getActiveWebhooksForEvent(
  db: DbPool, tenantId: UUID, eventType: string,
): Promise<WebhookEndpointRow[]> {
  const result = await db.query(
    `SELECT * FROM webhook_endpoints
     WHERE tenant_id = $1 AND is_active = true AND $2 = ANY(event_types)`,
    [tenantId, eventType],
  );
  return result.rows as WebhookEndpointRow[];
}

export async function createDelivery(
  db: DbPool,
  data: { endpoint_id: UUID; event_id?: number; event_type: string; payload: unknown },
): Promise<WebhookDeliveryRow> {
  const result = await db.query(
    `INSERT INTO webhook_deliveries (endpoint_id, event_id, event_type, payload)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.endpoint_id, data.event_id ?? null, data.event_type, JSON.stringify(data.payload)],
  );
  return result.rows[0] as WebhookDeliveryRow;
}

export async function updateDeliveryStatus(
  db: DbPool, id: UUID,
  data: { status: string; response_status?: number; response_body?: string; next_retry_at?: string },
): Promise<void> {
  const sets = ['status = $2', 'attempt_count = attempt_count + 1'];
  const params: unknown[] = [id, data.status];
  let idx = 3;

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
  if (data.status === 'delivered') {
    sets.push('delivered_at = now()');
  }
  if (data.next_retry_at) {
    sets.push(`next_retry_at = $${idx}`);
    params.push(data.next_retry_at);
    idx++;
  }

  await db.query(`UPDATE webhook_deliveries SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function listDeliveries(
  db: DbPool,
  filters: { endpoint_id?: UUID; status?: string; limit: number; cursor?: string },
): Promise<PaginatedResponse<WebhookDeliveryRow>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.endpoint_id) {
    conditions.push(`endpoint_id = $${idx}`);
    params.push(filters.endpoint_id);
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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await db.query(`SELECT count(*)::int as total FROM webhook_deliveries ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM webhook_deliveries ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as WebhookDeliveryRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

export async function getPendingRetries(db: DbPool, limit: number): Promise<WebhookDeliveryRow[]> {
  const result = await db.query(
    `SELECT * FROM webhook_deliveries
     WHERE status = 'retrying' AND next_retry_at <= now()
     ORDER BY next_retry_at LIMIT $1`,
    [limit],
  );
  return result.rows as WebhookDeliveryRow[];
}
