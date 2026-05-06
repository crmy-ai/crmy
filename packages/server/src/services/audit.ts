// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';

export interface AuditEvent {
  id: number;
  event_type: string;
  actor_id?: string;
  actor_type: string;
  object_type: string;
  object_id?: UUID;
  before_data?: unknown;
  after_data?: unknown;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function getAuditTrail(
  db: DbPool,
  tenantId: UUID,
  filters: {
    object_type?: string;
    object_id?: UUID;
    actor_id?: string;
    event_type?: string;
    since?: string;
    limit?: number;
  },
): Promise<AuditEvent[]> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.object_type) {
    conditions.push(`object_type = $${idx}`);
    params.push(filters.object_type);
    idx++;
  }
  if (filters.object_id) {
    conditions.push(`object_id = $${idx}`);
    params.push(filters.object_id);
    idx++;
  }
  if (filters.actor_id) {
    conditions.push(`actor_id = $${idx}`);
    params.push(filters.actor_id);
    idx++;
  }
  if (filters.event_type) {
    conditions.push(`event_type = $${idx}`);
    params.push(filters.event_type);
    idx++;
  }
  if (filters.since) {
    conditions.push(`created_at >= $${idx}`);
    params.push(filters.since);
    idx++;
  }

  const limit = filters.limit ?? 50;
  params.push(limit);

  const result = await db.query<AuditEvent>(
    `SELECT id, event_type, actor_id, actor_type, object_type, object_id,
            before_data, after_data, metadata, created_at
     FROM events
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    params,
  );
  return result.rows;
}
