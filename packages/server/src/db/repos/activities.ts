// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { Activity, UUID, PaginatedResponse } from '@crmy/shared';

export async function createActivity(
  db: DbPool,
  tenantId: UUID,
  data: Partial<Activity> & { created_by?: UUID },
): Promise<Activity> {
  const result = await db.query(
    `INSERT INTO activities (tenant_id, type, subject, body, status, direction,
       due_at, contact_id, account_id, opportunity_id, owner_id,
       source_agent, custom_fields, created_by,
       performed_by, subject_type, subject_id, related_type, related_id,
       detail, occurred_at, outcome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             $15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING *`,
    [
      tenantId,
      data.type,
      data.subject,
      data.body ?? null,
      data.status ?? (data.due_at ? 'pending' : 'completed'),
      data.direction ?? null,
      data.due_at ?? null,
      data.contact_id ?? null,
      data.account_id ?? null,
      data.opportunity_id ?? null,
      data.owner_id ?? data.created_by ?? null,
      data.source_agent ?? null,
      JSON.stringify(data.custom_fields ?? {}),
      data.created_by ?? null,
      // Context Engine fields
      data.performed_by ?? null,
      data.subject_type ?? null,
      data.subject_id ?? null,
      data.related_type ?? null,
      data.related_id ?? null,
      JSON.stringify(data.detail ?? {}),
      data.occurred_at ?? new Date().toISOString(),
      data.outcome ?? null,
    ],
  );
  return result.rows[0] as Activity;
}

export async function getActivity(db: DbPool, tenantId: UUID, id: UUID): Promise<Activity | null> {
  const result = await db.query(
    'SELECT * FROM activities WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as Activity) ?? null;
}

export async function searchActivities(
  db: DbPool,
  tenantId: UUID,
  filters: {
    contact_id?: UUID;
    account_id?: UUID;
    opportunity_id?: UUID;
    type?: string;
    subject_type?: string;
    subject_id?: UUID;
    performed_by?: UUID;
    outcome?: string;
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<Activity>> {
  const conditions: string[] = ['a.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.contact_id) {
    conditions.push(`a.contact_id = $${idx}`);
    params.push(filters.contact_id);
    idx++;
  }
  if (filters.account_id) {
    conditions.push(`a.account_id = $${idx}`);
    params.push(filters.account_id);
    idx++;
  }
  if (filters.opportunity_id) {
    conditions.push(`a.opportunity_id = $${idx}`);
    params.push(filters.opportunity_id);
    idx++;
  }
  if (filters.type) {
    conditions.push(`a.type = $${idx}`);
    params.push(filters.type);
    idx++;
  }
  if (filters.subject_type) {
    conditions.push(`a.subject_type = $${idx}`);
    params.push(filters.subject_type);
    idx++;
  }
  if (filters.subject_id) {
    conditions.push(`a.subject_id = $${idx}`);
    params.push(filters.subject_id);
    idx++;
  }
  if (filters.performed_by) {
    conditions.push(`a.performed_by = $${idx}`);
    params.push(filters.performed_by);
    idx++;
  }
  if (filters.outcome) {
    conditions.push(`a.outcome = $${idx}`);
    params.push(filters.outcome);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`a.created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int as total FROM activities a WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT a.* FROM activities a WHERE ${where} ORDER BY a.created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as Activity[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

export async function updateActivity(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Record<string, unknown>,
): Promise<Activity | null> {
  const allowedFields = ['subject', 'body', 'status', 'due_at', 'completed_at', 'custom_fields'];

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  for (const field of allowedFields) {
    if (field in patch) {
      const value = field === 'custom_fields' ? JSON.stringify(patch[field]) : patch[field];
      sets.push(`${field} = $${idx}`);
      params.push(value);
      idx++;
    }
  }

  if (sets.length === 1) return getActivity(db, tenantId, id);

  const result = await db.query(
    `UPDATE activities SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as Activity) ?? null;
}

export async function completeActivity(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  completedAt?: string,
): Promise<Activity | null> {
  const result = await db.query(
    `UPDATE activities
     SET status = 'completed', completed_at = $3, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenantId, id, completedAt ?? new Date().toISOString()],
  );
  return (result.rows[0] as Activity) ?? null;
}

/**
 * Generic timeline for any CRM object via polymorphic subject_type + subject_id.
 */
export async function getSubjectTimeline(
  db: DbPool,
  tenantId: UUID,
  subjectType: string,
  subjectId: UUID,
  filters: { limit: number; types?: string[] },
): Promise<{ activities: Activity[]; total: number }> {
  const conditions: string[] = ['tenant_id = $1', 'subject_type = $2', 'subject_id = $3'];
  const params: unknown[] = [tenantId, subjectType, subjectId];
  let idx = 4;

  if (filters.types && filters.types.length > 0) {
    conditions.push(`type = ANY($${idx})`);
    params.push(filters.types);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int as total FROM activities WHERE ${where}`,
    params,
  );

  params.push(filters.limit);
  const dataResult = await db.query(
    `SELECT * FROM activities WHERE ${where} ORDER BY COALESCE(occurred_at, created_at) DESC LIMIT $${idx}`,
    params,
  );

  return {
    activities: dataResult.rows as Activity[],
    total: countResult.rows[0].total,
  };
}

export async function getContactTimeline(
  db: DbPool,
  tenantId: UUID,
  contactId: UUID,
  filters: { limit: number; types?: string[] },
): Promise<{ activities: Activity[]; total: number }> {
  const conditions: string[] = ['tenant_id = $1', 'contact_id = $2'];
  const params: unknown[] = [tenantId, contactId];
  let idx = 3;

  if (filters.types && filters.types.length > 0) {
    conditions.push(`type = ANY($${idx})`);
    params.push(filters.types);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int as total FROM activities WHERE ${where}`,
    params,
  );

  params.push(filters.limit);
  const dataResult = await db.query(
    `SELECT * FROM activities WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  return {
    activities: dataResult.rows as Activity[],
    total: countResult.rows[0].total,
  };
}
