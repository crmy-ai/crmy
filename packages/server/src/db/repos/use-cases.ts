// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UseCase, UseCaseContact, Activity, UUID, PaginatedResponse } from '@crmy/shared';

export async function createUseCase(
  db: DbPool,
  tenantId: UUID,
  data: Partial<UseCase> & { created_by?: UUID },
): Promise<UseCase> {
  const result = await db.query(
    `INSERT INTO use_cases (tenant_id, name, description, account_id, opportunity_id,
       owner_id, stage, unit_label, consumption_unit, consumption_capacity,
       attributed_arr, currency_code, expansion_potential,
       started_at, target_prod_date, sunset_date,
       tags, custom_fields, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      tenantId,
      data.name,
      data.description ?? null,
      data.account_id,
      data.opportunity_id ?? null,
      data.owner_id ?? data.created_by ?? null,
      data.stage ?? 'discovery',
      data.unit_label ?? null,
      data.consumption_unit ?? null,
      data.consumption_capacity ?? null,
      data.attributed_arr ?? null,
      data.currency_code ?? 'USD',
      data.expansion_potential ?? null,
      data.started_at ?? null,
      data.target_prod_date ?? null,
      data.sunset_date ?? null,
      data.tags ?? [],
      JSON.stringify(data.custom_fields ?? {}),
      data.created_by ?? null,
    ],
  );
  return result.rows[0] as UseCase;
}

export async function getUseCase(db: DbPool, tenantId: UUID, id: UUID): Promise<UseCase | null> {
  const result = await db.query(
    'SELECT * FROM use_cases WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as UseCase) ?? null;
}

export async function updateUseCase(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Record<string, unknown>,
): Promise<UseCase | null> {
  const allowedFields = [
    'name', 'description', 'opportunity_id', 'owner_id', 'stage',
    'unit_label', 'consumption_current', 'consumption_capacity', 'consumption_unit',
    'attributed_arr', 'currency_code', 'expansion_potential',
    'health_score', 'health_note',
    'started_at', 'target_prod_date', 'sunset_date',
    'tags', 'custom_fields',
  ];

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

  if (sets.length === 1) return getUseCase(db, tenantId, id);

  const result = await db.query(
    `UPDATE use_cases SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as UseCase) ?? null;
}

export async function deleteUseCase(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM use_cases WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function searchUseCases(
  db: DbPool,
  tenantId: UUID,
  filters: {
    account_id?: UUID;
    stage?: string;
    owner_id?: UUID;
    product_line?: string;
    tags?: string[];
    query?: string;
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<UseCase>> {
  const conditions: string[] = ['u.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.account_id) {
    conditions.push(`u.account_id = $${idx}`);
    params.push(filters.account_id);
    idx++;
  }
  if (filters.stage) {
    conditions.push(`u.stage = $${idx}`);
    params.push(filters.stage);
    idx++;
  }
  if (filters.owner_id) {
    conditions.push(`u.owner_id = $${idx}`);
    params.push(filters.owner_id);
    idx++;
  }
  if (filters.product_line) {
    conditions.push(`u.unit_label = $${idx}`);
    params.push(filters.product_line);
    idx++;
  }
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(`u.tags && $${idx}`);
    params.push(filters.tags);
    idx++;
  }
  if (filters.query) {
    conditions.push(`(u.name ILIKE $${idx} OR u.description ILIKE $${idx})`);
    params.push(`%${filters.query}%`);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`u.created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int as total FROM use_cases u WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT u.* FROM use_cases u WHERE ${where} ORDER BY u.created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as UseCase[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

export async function linkContact(
  db: DbPool,
  useCaseId: UUID,
  contactId: UUID,
  role?: string,
): Promise<UseCaseContact> {
  const result = await db.query(
    `INSERT INTO use_case_contacts (use_case_id, contact_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (use_case_id, contact_id) DO UPDATE SET role = $3
     RETURNING *`,
    [useCaseId, contactId, role ?? null],
  );
  return result.rows[0] as UseCaseContact;
}

export async function unlinkContact(
  db: DbPool,
  useCaseId: UUID,
  contactId: UUID,
): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM use_case_contacts WHERE use_case_id = $1 AND contact_id = $2',
    [useCaseId, contactId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listContacts(
  db: DbPool,
  useCaseId: UUID,
): Promise<(UseCaseContact & { first_name: string; last_name: string; email?: string })[]> {
  const result = await db.query(
    `SELECT ucc.*, c.first_name, c.last_name, c.email
     FROM use_case_contacts ucc
     JOIN contacts c ON c.id = ucc.contact_id
     WHERE ucc.use_case_id = $1
     ORDER BY ucc.added_at`,
    [useCaseId],
  );
  return result.rows as (UseCaseContact & { first_name: string; last_name: string; email?: string })[];
}

export async function getUseCaseTimeline(
  db: DbPool,
  tenantId: UUID,
  useCaseId: UUID,
  filters: { limit: number; types?: string[] },
): Promise<Activity[]> {
  const conditions = ['a.tenant_id = $1', 'a.use_case_id = $2'];
  const params: unknown[] = [tenantId, useCaseId];
  let idx = 3;

  if (filters.types && filters.types.length > 0) {
    conditions.push(`a.type = ANY($${idx})`);
    params.push(filters.types);
    idx++;
  }

  params.push(filters.limit);
  const result = await db.query(
    `SELECT a.* FROM activities a WHERE ${conditions.join(' AND ')}
     ORDER BY a.created_at DESC LIMIT $${idx}`,
    params,
  );
  return result.rows as Activity[];
}

export async function getUseCaseSummary(
  db: DbPool,
  tenantId: UUID,
  filters: { account_id?: UUID; group_by: string },
): Promise<{ group: string; count: number; total_arr: number }[]> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.account_id) {
    conditions.push(`account_id = $${idx}`);
    params.push(filters.account_id);
    idx++;
  }

  const groupCol = filters.group_by === 'owner' ? 'owner_id' :
    filters.group_by === 'product_line' ? 'unit_label' : 'stage';

  const where = conditions.join(' AND ');
  const result = await db.query(
    `SELECT COALESCE(${groupCol}::text, 'unassigned') as "group",
            count(*)::int as count,
            COALESCE(sum(attributed_arr), 0)::bigint as total_arr
     FROM use_cases WHERE ${where}
     GROUP BY ${groupCol}
     ORDER BY count DESC`,
    params,
  );
  return result.rows as { group: string; count: number; total_arr: number }[];
}

export async function getAccountUseCases(
  db: DbPool,
  tenantId: UUID,
  accountId: UUID,
): Promise<UseCase[]> {
  const result = await db.query(
    'SELECT * FROM use_cases WHERE account_id = $1 AND tenant_id = $2 ORDER BY created_at DESC',
    [accountId, tenantId],
  );
  return result.rows as UseCase[];
}
