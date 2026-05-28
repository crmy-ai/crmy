// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import { validationError, type Activity, type UUID, type PaginatedResponse } from '@crmy/shared';

type ActivityCreateData = Partial<Activity> & { created_by?: UUID };

const activityReferenceTables: Record<NonNullable<Activity['subject_type']>, { table: string; label: string }> = {
  contact: { table: 'contacts', label: 'contact' },
  account: { table: 'accounts', label: 'account' },
  opportunity: { table: 'opportunities', label: 'opportunity' },
  use_case: { table: 'use_cases', label: 'use case' },
};

async function assertActivityReference(
  db: DbPool,
  tenantId: UUID,
  type: NonNullable<Activity['subject_type']>,
  id: UUID,
  field: string,
) {
  const config = activityReferenceTables[type];
  const result = await db.query(
    `SELECT 1 FROM ${config.table} WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id],
  );
  if (result.rowCount === 0) {
    throw validationError(`Selected ${config.label} does not exist`, [{ field, message: `Choose an existing ${config.label}` }]);
  }
}

async function validateActivityReferences(db: DbPool, tenantId: UUID, data: ActivityCreateData) {
  if (data.contact_id) await assertActivityReference(db, tenantId, 'contact', data.contact_id, 'contact_id');
  if (data.account_id) await assertActivityReference(db, tenantId, 'account', data.account_id, 'account_id');
  if (data.opportunity_id) await assertActivityReference(db, tenantId, 'opportunity', data.opportunity_id, 'opportunity_id');
  if (data.use_case_id) await assertActivityReference(db, tenantId, 'use_case', data.use_case_id, 'use_case_id');
  if (data.subject_type && data.subject_id) {
    await assertActivityReference(db, tenantId, data.subject_type, data.subject_id, 'subject_id');
  }
}

function canonicalizeActivitySubject(data: ActivityCreateData): ActivityCreateData {
  const normalized = { ...data };
  const links: Array<{ type: NonNullable<Activity['subject_type']>; id: UUID }> = [];

  if (normalized.contact_id) links.push({ type: 'contact', id: normalized.contact_id });
  if (normalized.account_id) links.push({ type: 'account', id: normalized.account_id });
  if (normalized.opportunity_id) links.push({ type: 'opportunity', id: normalized.opportunity_id });
  if (normalized.use_case_id) links.push({ type: 'use_case', id: normalized.use_case_id });

  if ((!normalized.subject_type || !normalized.subject_id) && links.length > 0) {
    normalized.subject_type ??= links[0].type;
    normalized.subject_id ??= links[0].id;
  }

  if (normalized.subject_type && normalized.subject_id) {
    switch (normalized.subject_type) {
      case 'contact':
        normalized.contact_id ??= normalized.subject_id;
        break;
      case 'account':
        normalized.account_id ??= normalized.subject_id;
        break;
      case 'opportunity':
        normalized.opportunity_id ??= normalized.subject_id;
        break;
      case 'use_case':
        normalized.use_case_id ??= normalized.subject_id;
        break;
    }
  }

  return normalized;
}

export async function createActivity(
  db: DbPool,
  tenantId: UUID,
  data: ActivityCreateData,
): Promise<Activity> {
  const normalized = canonicalizeActivitySubject(data);
  await validateActivityReferences(db, tenantId, normalized);
  const result = await db.query(
    `INSERT INTO activities (tenant_id, type, subject, body, status, direction,
       due_at, contact_id, account_id, opportunity_id, use_case_id, owner_id,
       source_agent, custom_fields, created_by,
       performed_by, subject_type, subject_id, related_type, related_id,
       detail, occurred_at, outcome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
             $16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING *`,
    [
      tenantId,
      normalized.type,
      normalized.subject,
      normalized.body ?? null,
      normalized.status ?? (normalized.due_at ? 'pending' : 'completed'),
      normalized.direction ?? null,
      normalized.due_at ?? null,
      normalized.contact_id ?? null,
      normalized.account_id ?? null,
      normalized.opportunity_id ?? null,
      normalized.use_case_id ?? null,
      normalized.owner_id ?? normalized.created_by ?? null,
      normalized.source_agent ?? null,
      JSON.stringify(normalized.custom_fields ?? {}),
      normalized.created_by ?? null,
      // Context Engine fields
      normalized.performed_by ?? null,
      normalized.subject_type ?? null,
      normalized.subject_id ?? null,
      normalized.related_type ?? null,
      normalized.related_id ?? null,
      JSON.stringify(normalized.detail ?? {}),
      normalized.occurred_at ?? new Date().toISOString(),
      normalized.outcome ?? null,
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
    use_case_id?: UUID;
    type?: string;
    direction?: string;
    subject_type?: string;
    subject_id?: UUID;
    performed_by?: UUID;
    outcome?: string;
    owner_ids?: UUID[];
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
  if (filters.use_case_id) {
    conditions.push(`a.use_case_id = $${idx}`);
    params.push(filters.use_case_id);
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
  if (filters.owner_ids) {
    if (filters.owner_ids.length === 0) {
      conditions.push('FALSE');
    } else {
      conditions.push(`(
        a.owner_id = ANY($${idx}::uuid[])
        OR EXISTS (SELECT 1 FROM contacts c WHERE c.tenant_id = a.tenant_id AND c.id = a.contact_id AND c.owner_id = ANY($${idx}::uuid[]))
        OR EXISTS (SELECT 1 FROM accounts ac WHERE ac.tenant_id = a.tenant_id AND ac.id = a.account_id AND ac.owner_id = ANY($${idx}::uuid[]))
        OR EXISTS (SELECT 1 FROM opportunities o WHERE o.tenant_id = a.tenant_id AND o.id = a.opportunity_id AND o.owner_id = ANY($${idx}::uuid[]))
        OR EXISTS (SELECT 1 FROM use_cases u WHERE u.tenant_id = a.tenant_id AND u.id = a.use_case_id AND u.owner_id = ANY($${idx}::uuid[]))
      )`);
      params.push(filters.owner_ids);
      idx++;
    }
  }
  if (filters.outcome) {
    conditions.push(`a.outcome = $${idx}`);
    params.push(filters.outcome);
    idx++;
  }
  if (filters.direction) {
    conditions.push(`a.direction = $${idx}`);
    params.push(filters.direction);
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
  const allowedFields = [
    'subject', 'body', 'status', 'due_at', 'completed_at', 'custom_fields',
    'direction', 'performed_by', 'subject_type', 'subject_id', 'related_type',
    'related_id', 'detail', 'occurred_at', 'outcome',
    'contact_id', 'account_id', 'opportunity_id', 'use_case_id', 'owner_id',
  ];

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  for (const field of allowedFields) {
    if (field in patch) {
      const value = field === 'custom_fields' || field === 'detail' ? JSON.stringify(patch[field]) : patch[field];
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
  filters: { limit: number; types?: string[]; since?: string },
): Promise<{ activities: Activity[]; total: number }> {
  const conditions: string[] = ['tenant_id = $1', 'subject_type = $2', 'subject_id = $3'];
  const params: unknown[] = [tenantId, subjectType, subjectId];
  let idx = 4;

  if (filters.types && filters.types.length > 0) {
    conditions.push(`type = ANY($${idx})`);
    params.push(filters.types);
    idx++;
  }

  if (filters.since) {
    conditions.push(`COALESCE(occurred_at, created_at) >= $${idx}`);
    params.push(filters.since);
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
