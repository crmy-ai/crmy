// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID, PaginatedResponse } from '@crmy/shared';
import crypto from 'node:crypto';
import { addStableDescCursorCondition, encodeStableCursor } from './pagination.js';

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

export interface WebhookEventRow {
  event_id: number;
  tenant_id: UUID;
  event_type: string;
  actor_id?: string | null;
  actor_type: string;
  object_type: string;
  object_id?: UUID | null;
  after_data?: unknown;
  metadata?: Record<string, unknown> | null;
}

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

export async function createWebhook(
  db: DbPool,
  tenantId: UUID,
  data: { url: string; events: string[]; description?: string; created_by?: UUID },
): Promise<WebhookEndpointRow> {
  const secret = generateWebhookSecret();
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

export async function rotateWebhookSecret(db: DbPool, tenantId: UUID, id: UUID): Promise<WebhookEndpointRow | null> {
  const secret = generateWebhookSecret();
  const result = await db.query(
    `UPDATE webhook_endpoints
     SET secret = $3, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenantId, id, secret],
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
  idx = addStableDescCursorCondition(conditions, params, idx, filters.cursor, 'created_at', 'id');

  const where = conditions.join(' AND ');
  const countResult = await db.query(`SELECT count(*)::int as total FROM webhook_endpoints WHERE ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM webhook_endpoints WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as WebhookEndpointRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore && data.length > 0
      ? encodeStableCursor({ sort_value: data[data.length - 1].created_at, id: data[data.length - 1].id })
      : undefined,
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
): Promise<{ delivery: WebhookDeliveryRow; created: boolean }> {
  const result = await db.query(
    `INSERT INTO webhook_deliveries (endpoint_id, event_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [data.endpoint_id, data.event_id ?? null, data.event_type, JSON.stringify(data.payload)],
  );
  if (result.rows[0]) {
    return { delivery: result.rows[0] as WebhookDeliveryRow, created: true };
  }
  const existing = await db.query(
    `SELECT * FROM webhook_deliveries
     WHERE endpoint_id = $1 AND event_id = $2
     LIMIT 1`,
    [data.endpoint_id, data.event_id ?? null],
  );
  return { delivery: existing.rows[0] as WebhookDeliveryRow, created: false };
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
  idx = addStableDescCursorCondition(conditions, params, idx, filters.cursor, 'created_at', 'id');

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await db.query(`SELECT count(*)::int as total FROM webhook_deliveries ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM webhook_deliveries ${where} ORDER BY created_at DESC, id DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as WebhookDeliveryRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore && data.length > 0
      ? encodeStableCursor({ sort_value: data[data.length - 1].created_at, id: data[data.length - 1].id })
      : undefined,
  };
}

export async function getPendingRetries(db: DbPool, limit: number): Promise<WebhookDeliveryRow[]> {
  const result = await db.query(
    `SELECT * FROM webhook_deliveries
     WHERE status = 'pending'
        OR (status = 'retrying' AND next_retry_at <= now())
     ORDER BY COALESCE(next_retry_at, created_at), id
     LIMIT $1`,
    [limit],
  );
  return result.rows as WebhookDeliveryRow[];
}

export async function listWebhookBacklogEvents(db: DbPool, limit: number): Promise<WebhookEventRow[]> {
  const result = await db.query(
    `SELECT DISTINCT
       e.id AS event_id,
       e.tenant_id,
       e.event_type,
       e.actor_id,
       e.actor_type,
       e.object_type,
       e.object_id,
       e.after_data,
       e.metadata
     FROM events e
     JOIN webhook_endpoints we
       ON we.tenant_id = e.tenant_id
      AND we.is_active = true
      AND e.event_type = ANY(we.event_types)
     LEFT JOIN webhook_deliveries wd
       ON wd.endpoint_id = we.id
      AND wd.event_id = e.id
     WHERE wd.id IS NULL
     ORDER BY e.id ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows as WebhookEventRow[];
}
