// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { Account, Contact, Opportunity, UUID, PaginatedResponse } from '@crmy/shared';

export async function createAccount(
  db: DbPool,
  tenantId: UUID,
  data: Partial<Account> & { created_by?: UUID },
): Promise<Account> {
  const result = await db.query(
    `INSERT INTO accounts (tenant_id, name, domain, industry, employee_count,
       annual_revenue, currency_code, website, parent_id, owner_id,
       aliases, tags, custom_fields, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      tenantId,
      data.name,
      data.domain ?? null,
      data.industry ?? null,
      data.employee_count ?? null,
      data.annual_revenue ?? null,
      data.currency_code ?? 'USD',
      data.website ?? null,
      data.parent_id ?? null,
      data.owner_id ?? data.created_by ?? null,
      data.aliases ?? [],
      data.tags ?? [],
      JSON.stringify(data.custom_fields ?? {}),
      data.created_by ?? null,
    ],
  );
  return result.rows[0] as Account;
}

export async function getAccount(db: DbPool, tenantId: UUID, id: UUID): Promise<Account | null> {
  const result = await db.query(
    'SELECT * FROM accounts WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as Account) ?? null;
}

export async function getAccountContacts(db: DbPool, tenantId: UUID, accountId: UUID): Promise<Contact[]> {
  const result = await db.query(
    'SELECT * FROM contacts WHERE account_id = $1 AND tenant_id = $2 ORDER BY created_at DESC',
    [accountId, tenantId],
  );
  return result.rows as Contact[];
}

export async function getAccountOpenOpps(db: DbPool, tenantId: UUID, accountId: UUID): Promise<Opportunity[]> {
  const result = await db.query(
    `SELECT * FROM opportunities
     WHERE account_id = $1 AND tenant_id = $2
       AND stage NOT IN ('closed_won', 'closed_lost')
     ORDER BY close_date ASC NULLS LAST`,
    [accountId, tenantId],
  );
  return result.rows as Opportunity[];
}

export async function searchAccounts(
  db: DbPool,
  tenantId: UUID,
  filters: {
    query?: string;
    industry?: string;
    owner_id?: UUID;
    min_revenue?: number;
    tags?: string[];
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<Account>> {
  const conditions: string[] = ['a.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.query) {
    conditions.push(
      `(a.name ILIKE $${idx} OR a.domain ILIKE $${idx}` +
      ` OR EXISTS (SELECT 1 FROM unnest(a.aliases) _a WHERE _a ILIKE $${idx}))`,
    );
    params.push(`%${filters.query}%`);
    idx++;
  }
  if (filters.industry) {
    conditions.push(`a.industry = $${idx}`);
    params.push(filters.industry);
    idx++;
  }
  if (filters.owner_id) {
    conditions.push(`a.owner_id = $${idx}`);
    params.push(filters.owner_id);
    idx++;
  }
  if (filters.min_revenue != null) {
    conditions.push(`a.annual_revenue >= $${idx}`);
    params.push(filters.min_revenue);
    idx++;
  }
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(`a.tags && $${idx}`);
    params.push(filters.tags);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`a.created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int as total FROM accounts a WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT a.* FROM accounts a WHERE ${where} ORDER BY a.created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as Account[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

export async function updateAccount(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Record<string, unknown>,
): Promise<Account | null> {
  const allowedFields = [
    'name', 'domain', 'industry', 'employee_count', 'annual_revenue',
    'currency_code', 'website', 'parent_id', 'owner_id', 'health_score',
    'aliases', 'tags', 'custom_fields',
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

  if (sets.length === 1) return getAccount(db, tenantId, id);

  const result = await db.query(
    `UPDATE accounts SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as Account) ?? null;
}

export async function getAccountHierarchy(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
): Promise<{ root: Account; children: Account[]; depth: number } | null> {
  // Find root by traversing parents
  const account = await getAccount(db, tenantId, id);
  if (!account) return null;

  let root = account;
  let depth = 0;
  while (root.parent_id) {
    const parent = await getAccount(db, tenantId, root.parent_id);
    if (!parent) break;
    root = parent;
    depth++;
  }

  // Find all children of root
  const childrenResult = await db.query(
    'SELECT * FROM accounts WHERE parent_id = $1 AND tenant_id = $2 ORDER BY name',
    [root.id, tenantId],
  );

  return {
    root,
    children: childrenResult.rows as Account[],
    depth,
  };
}

export async function deleteAccount(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM accounts WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  return (result.rowCount ?? 0) > 0;
}
