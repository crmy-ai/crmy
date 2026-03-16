// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { Assignment, UUID, PaginatedResponse } from '@crmy/shared';

export async function createAssignment(
  db: DbPool,
  tenantId: UUID,
  data: Partial<Assignment> & { assigned_by: UUID },
): Promise<Assignment> {
  const result = await db.query(
    `INSERT INTO assignments (tenant_id, title, description, assignment_type,
       assigned_by, assigned_to, subject_type, subject_id,
       priority, due_at, context, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      tenantId,
      data.title,
      data.description ?? null,
      data.assignment_type,
      data.assigned_by,
      data.assigned_to,
      data.subject_type,
      data.subject_id,
      data.priority ?? 'normal',
      data.due_at ?? null,
      data.context ?? null,
      JSON.stringify(data.metadata ?? {}),
    ],
  );
  return result.rows[0] as Assignment;
}

export async function getAssignment(db: DbPool, tenantId: UUID, id: UUID): Promise<Assignment | null> {
  const result = await db.query(
    'SELECT * FROM assignments WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as Assignment) ?? null;
}

export async function updateAssignment(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Record<string, unknown>,
): Promise<Assignment | null> {
  const allowedFields = [
    'title', 'description', 'priority', 'due_at', 'status',
    'context', 'metadata', 'accepted_at', 'completed_at',
    'completed_by_activity_id',
  ];

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  for (const field of allowedFields) {
    if (field in patch) {
      const value = field === 'metadata' ? JSON.stringify(patch[field]) : patch[field];
      sets.push(`${field} = $${idx}`);
      params.push(value);
      idx++;
    }
  }

  if (sets.length === 1) return getAssignment(db, tenantId, id);

  const result = await db.query(
    `UPDATE assignments SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as Assignment) ?? null;
}

export async function acceptAssignment(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
): Promise<Assignment | null> {
  const result = await db.query(
    `UPDATE assignments
     SET status = 'accepted', accepted_at = now(), updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
     RETURNING *`,
    [tenantId, id],
  );
  return (result.rows[0] as Assignment) ?? null;
}

export async function completeAssignment(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  completedByActivityId?: UUID,
): Promise<Assignment | null> {
  const result = await db.query(
    `UPDATE assignments
     SET status = 'completed', completed_at = now(),
         completed_by_activity_id = $3, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
       AND status IN ('pending', 'accepted', 'in_progress')
     RETURNING *`,
    [tenantId, id, completedByActivityId ?? null],
  );
  return (result.rows[0] as Assignment) ?? null;
}

export async function declineAssignment(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
): Promise<Assignment | null> {
  const result = await db.query(
    `UPDATE assignments
     SET status = 'declined', updated_at = now()
     WHERE tenant_id = $1 AND id = $2
       AND status IN ('pending', 'accepted')
     RETURNING *`,
    [tenantId, id],
  );
  return (result.rows[0] as Assignment) ?? null;
}

export async function startAssignment(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
): Promise<Assignment | null> {
  const result = await db.query(
    `UPDATE assignments
     SET status = 'in_progress', updated_at = now()
     WHERE tenant_id = $1 AND id = $2
       AND status = 'accepted'
     RETURNING *`,
    [tenantId, id],
  );
  return (result.rows[0] as Assignment) ?? null;
}

export async function blockAssignment(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
): Promise<Assignment | null> {
  const result = await db.query(
    `UPDATE assignments
     SET status = 'blocked', updated_at = now()
     WHERE tenant_id = $1 AND id = $2
       AND status IN ('accepted', 'in_progress')
     RETURNING *`,
    [tenantId, id],
  );
  return (result.rows[0] as Assignment) ?? null;
}

export async function cancelAssignment(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
): Promise<Assignment | null> {
  const result = await db.query(
    `UPDATE assignments
     SET status = 'cancelled', updated_at = now()
     WHERE tenant_id = $1 AND id = $2
       AND status NOT IN ('completed', 'declined', 'cancelled')
     RETURNING *`,
    [tenantId, id],
  );
  return (result.rows[0] as Assignment) ?? null;
}

export async function searchAssignments(
  db: DbPool,
  tenantId: UUID,
  filters: {
    assigned_to?: UUID;
    assigned_by?: UUID;
    status?: string;
    priority?: string;
    subject_type?: string;
    subject_id?: UUID;
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<Assignment>> {
  const conditions: string[] = ['a.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.assigned_to) {
    conditions.push(`a.assigned_to = $${idx}`);
    params.push(filters.assigned_to);
    idx++;
  }
  if (filters.assigned_by) {
    conditions.push(`a.assigned_by = $${idx}`);
    params.push(filters.assigned_by);
    idx++;
  }
  if (filters.status) {
    conditions.push(`a.status = $${idx}`);
    params.push(filters.status);
    idx++;
  }
  if (filters.priority) {
    conditions.push(`a.priority = $${idx}`);
    params.push(filters.priority);
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
  if (filters.cursor) {
    conditions.push(`a.created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int as total FROM assignments a WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT a.* FROM assignments a WHERE ${where} ORDER BY a.created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as Assignment[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}
