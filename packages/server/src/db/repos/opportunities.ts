// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { Opportunity, Activity, UUID, PaginatedResponse } from '@crmy/shared';

export async function createOpportunity(
  db: DbPool,
  tenantId: UUID,
  data: Partial<Opportunity> & { created_by?: UUID },
): Promise<Opportunity> {
  const result = await db.query(
    `INSERT INTO opportunities (tenant_id, name, account_id, contact_id, owner_id,
       stage, amount, currency_code, close_date, probability,
       forecast_cat, description, custom_fields, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      tenantId,
      data.name,
      data.account_id ?? null,
      data.contact_id ?? null,
      data.owner_id ?? data.created_by ?? null,
      data.stage ?? 'prospecting',
      data.amount ?? null,
      data.currency_code ?? 'USD',
      data.close_date ?? null,
      data.probability ?? null,
      data.forecast_cat ?? 'pipeline',
      data.description ?? null,
      JSON.stringify(data.custom_fields ?? {}),
      data.created_by ?? null,
    ],
  );
  return result.rows[0] as Opportunity;
}

export async function getOpportunity(db: DbPool, tenantId: UUID, id: UUID): Promise<Opportunity | null> {
  const result = await db.query(
    'SELECT * FROM opportunities WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as Opportunity) ?? null;
}

export async function getOpportunityActivities(db: DbPool, tenantId: UUID, oppId: UUID): Promise<Activity[]> {
  const result = await db.query(
    'SELECT * FROM activities WHERE opportunity_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 50',
    [oppId, tenantId],
  );
  return result.rows as Activity[];
}

export async function searchOpportunities(
  db: DbPool,
  tenantId: UUID,
  filters: {
    query?: string;
    stage?: string;
    owner_id?: UUID;
    account_id?: UUID;
    contact_id?: UUID;
    forecast_cat?: string;
    close_date_before?: string;
    close_date_after?: string;
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<Opportunity>> {
  const conditions: string[] = ['o.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.query) {
    conditions.push(`o.name ILIKE $${idx}`);
    params.push(`%${filters.query}%`);
    idx++;
  }
  if (filters.stage) {
    conditions.push(`o.stage = $${idx}`);
    params.push(filters.stage);
    idx++;
  }
  if (filters.owner_id) {
    conditions.push(`o.owner_id = $${idx}`);
    params.push(filters.owner_id);
    idx++;
  }
  if (filters.account_id) {
    conditions.push(`o.account_id = $${idx}`);
    params.push(filters.account_id);
    idx++;
  }
  if (filters.contact_id) {
    conditions.push(`o.contact_id = $${idx}`);
    params.push(filters.contact_id);
    idx++;
  }
  if (filters.forecast_cat) {
    conditions.push(`o.forecast_cat = $${idx}`);
    params.push(filters.forecast_cat);
    idx++;
  }
  if (filters.close_date_before) {
    conditions.push(`o.close_date <= $${idx}`);
    params.push(filters.close_date_before);
    idx++;
  }
  if (filters.close_date_after) {
    conditions.push(`o.close_date >= $${idx}`);
    params.push(filters.close_date_after);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`o.created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int as total FROM opportunities o WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT o.* FROM opportunities o WHERE ${where} ORDER BY o.created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as Opportunity[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

export async function updateOpportunity(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Record<string, unknown>,
): Promise<Opportunity | null> {
  const allowedFields = [
    'name', 'account_id', 'contact_id', 'owner_id', 'stage', 'amount',
    'currency_code', 'close_date', 'probability', 'forecast_cat',
    'description', 'lost_reason', 'custom_fields',
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

  if (sets.length === 1) return getOpportunity(db, tenantId, id);

  const result = await db.query(
    `UPDATE opportunities SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as Opportunity) ?? null;
}

export async function getPipelineSummary(
  db: DbPool,
  tenantId: UUID,
  filters: { owner_id?: UUID; group_by: string },
): Promise<{ total_value: number; count: number; by_stage: { stage: string; value: number; count: number }[] }> {
  const conditions: string[] = [
    'tenant_id = $1',
    "stage NOT IN ('closed_won', 'closed_lost')",
  ];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.owner_id) {
    conditions.push(`owner_id = $${idx}`);
    params.push(filters.owner_id);
    idx++;
  }

  const where = conditions.join(' AND ');
  const groupCol = filters.group_by === 'owner' ? 'owner_id' : filters.group_by === 'forecast_cat' ? 'forecast_cat' : 'stage';

  const result = await db.query(
    `SELECT ${groupCol} as stage, COALESCE(SUM(amount), 0)::bigint as value, count(*)::int as count
     FROM opportunities WHERE ${where}
     GROUP BY ${groupCol}
     ORDER BY value DESC`,
    params,
  );

  const totals = await db.query(
    `SELECT COALESCE(SUM(amount), 0)::bigint as total_value, count(*)::int as count
     FROM opportunities WHERE ${where}`,
    params,
  );

  return {
    total_value: Number(totals.rows[0].total_value),
    count: totals.rows[0].count,
    by_stage: result.rows.map(r => ({
      stage: r.stage ?? 'unassigned',
      value: Number(r.value),
      count: r.count,
    })),
  };
}

export async function getPipelineForecast(
  db: DbPool,
  tenantId: UUID,
  filters: { period: string; owner_id?: UUID },
): Promise<{
  committed: number;
  best_case: number;
  pipeline: number;
  win_rate: number;
  avg_deal_size: number;
  avg_cycle_days: number;
}> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.owner_id) {
    conditions.push(`owner_id = $${idx}`);
    params.push(filters.owner_id);
    idx++;
  }

  // Date filter based on period
  let dateFilter: string;
  if (filters.period === 'month') {
    dateFilter = `close_date <= (CURRENT_DATE + interval '1 month')`;
  } else if (filters.period === 'year') {
    dateFilter = `close_date <= (CURRENT_DATE + interval '1 year')`;
  } else {
    dateFilter = `close_date <= (CURRENT_DATE + interval '3 months')`;
  }

  const where = conditions.join(' AND ');

  // Forecast by category
  const forecast = await db.query(
    `SELECT forecast_cat, COALESCE(SUM(amount), 0)::bigint as value
     FROM opportunities
     WHERE ${where} AND stage NOT IN ('closed_won', 'closed_lost') AND ${dateFilter}
     GROUP BY forecast_cat`,
    params,
  );

  const cats: Record<string, number> = {};
  for (const row of forecast.rows) {
    cats[row.forecast_cat] = Number(row.value);
  }

  // Win rate + avg deal size
  const stats = await db.query(
    `SELECT
       count(*) FILTER (WHERE stage = 'closed_won')::int as won,
       count(*) FILTER (WHERE stage IN ('closed_won', 'closed_lost'))::int as closed,
       COALESCE(AVG(amount) FILTER (WHERE stage = 'closed_won'), 0)::bigint as avg_deal,
       COALESCE(AVG(EXTRACT(epoch FROM (updated_at - created_at)) / 86400) FILTER (WHERE stage = 'closed_won'), 0)::int as avg_cycle
     FROM opportunities WHERE ${where}`,
    params,
  );

  const won = stats.rows[0].won ?? 0;
  const closed = stats.rows[0].closed ?? 0;

  return {
    committed: cats.commit ?? 0,
    best_case: cats.best_case ?? 0,
    pipeline: cats.pipeline ?? 0,
    win_rate: closed > 0 ? Math.round((won / closed) * 100) : 0,
    avg_deal_size: Number(stats.rows[0].avg_deal ?? 0),
    avg_cycle_days: stats.rows[0].avg_cycle ?? 0,
  };
}

export async function deleteOpportunity(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM opportunities WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  return (result.rowCount ?? 0) > 0;
}
