// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { CrmyEvent, UUID, PaginatedResponse } from '@crmy/shared';

export async function searchEvents(
  db: DbPool,
  tenantId: UUID,
  filters: {
    object_type?: string;
    object_id?: UUID;
    event_type?: string;
    actor_id?: string;
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<CrmyEvent>> {
  const conditions: string[] = ['e.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.object_type) {
    conditions.push(`e.object_type = $${idx}`);
    params.push(filters.object_type);
    idx++;
  }
  if (filters.object_id) {
    conditions.push(`e.object_id = $${idx}`);
    params.push(filters.object_id);
    idx++;
  }
  if (filters.event_type) {
    conditions.push(`e.event_type = $${idx}`);
    params.push(filters.event_type);
    idx++;
  }
  if (filters.actor_id) {
    conditions.push(`e.actor_id = $${idx}`);
    params.push(filters.actor_id);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`e.id < $${idx}`);
    params.push(parseInt(filters.cursor, 10));
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int as total FROM events e WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT e.*,
            a.display_name      AS actor_display_name,
            a.agent_model       AS actor_agent_model,
            a.agent_identifier  AS actor_agent_identifier
     FROM events e
     LEFT JOIN actors a
       ON a.id::text = e.actor_id
      AND a.tenant_id = e.tenant_id
     WHERE ${where}
     ORDER BY e.id DESC
     LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as CrmyEvent[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? String(data[data.length - 1].id) : undefined,
  };
}
