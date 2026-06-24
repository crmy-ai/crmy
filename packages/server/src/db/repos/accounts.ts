// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { Account, Contact, Opportunity, UUID, PaginatedResponse } from '@crmy/shared';
import { CrmyError } from '@crmy/shared';
import { addStableDescCursorCondition, encodeStableCursor, exactListTotalsEnabled, pageTotal } from './pagination.js';

interface MutationOptions {
  expectedVersion?: number;
}

export interface AccountDomainConflict {
  domain: string;
  existing_account: {
    id: UUID;
    name: string;
    domain?: string | null;
    owner_id?: UUID | null;
  };
  existing_domain_role: 'primary' | 'additional';
}

function normalizeDomain(value: unknown): string | null {
  const raw = typeof value === 'string' ? value : '';
  const domain = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  return domain || null;
}

function normalizeAdditionalDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const item of value) {
    const domain = normalizeDomain(item);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

export async function getAccountDomainConflicts(
  db: DbPool,
  tenantId: UUID,
  domains: string[],
  excludeAccountId?: UUID,
): Promise<AccountDomainConflict[]> {
  const normalized = [...new Set(domains.map(normalizeDomain).filter((domain): domain is string => Boolean(domain)))];
  if (normalized.length === 0) return [];
  const result = await db.query(
    `WITH input_domains AS (
       SELECT unnest($2::text[]) AS domain
     ),
     matches AS (
       SELECT i.domain, a.id, a.name, a.domain AS account_domain, a.owner_id, 'primary'::text AS role
       FROM input_domains i
       JOIN accounts a ON a.tenant_id = $1 AND lower(a.domain) = i.domain
       WHERE a.merged_into IS NULL AND a.archived_at IS NULL
       UNION ALL
       SELECT i.domain, a.id, a.name, a.domain AS account_domain, a.owner_id,
              CASE WHEN ad.is_primary THEN 'primary' ELSE 'additional' END AS role
       FROM input_domains i
       JOIN account_domains ad ON ad.tenant_id = $1 AND lower(ad.domain) = i.domain
       JOIN accounts a ON a.tenant_id = ad.tenant_id AND a.id = ad.account_id
       WHERE a.merged_into IS NULL AND a.archived_at IS NULL
     )
     SELECT DISTINCT ON (domain, id)
            domain, id, name, account_domain, owner_id, role
     FROM matches
     WHERE ($3::uuid IS NULL OR id <> $3::uuid)
     ORDER BY domain, id, CASE role WHEN 'primary' THEN 0 ELSE 1 END`,
    [tenantId, normalized, excludeAccountId ?? null],
  );
  return result.rows.map(row => ({
    domain: row.domain,
    existing_account: {
      id: row.id,
      name: row.name,
      domain: row.account_domain,
      owner_id: row.owner_id,
    },
    existing_domain_role: row.role === 'primary' ? 'primary' : 'additional',
  }));
}

async function assertNoDomainConflicts(
  db: DbPool,
  tenantId: UUID,
  domains: string[],
  excludeAccountId?: UUID,
): Promise<void> {
  const conflicts = await getAccountDomainConflicts(db, tenantId, domains, excludeAccountId);
  if (conflicts.length === 0) return;
  const first = conflicts[0];
  throw new CrmyError(
    'CONFLICT',
    `Domain ${first.domain} is already associated with ${first.existing_account.name}. Resolve the domain ownership before saving this account.`,
    409,
    {
      domain_conflicts: conflicts,
      resolution_actions: [
        'remove_domain_from_this_account',
        'remove_or_move_domain_from_existing_account',
        'merge_accounts_if_they_are_duplicates',
        'split_account_domains_if_the_domain_belongs_elsewhere',
      ],
    },
  );
}

async function syncAccountDomains(
  db: DbPool,
  tenantId: UUID,
  accountId: UUID,
  primaryDomain?: unknown,
  additionalDomains?: unknown,
): Promise<void> {
  const normalizedPrimary = normalizeDomain(primaryDomain);
  const normalizedAdditional = additionalDomains === undefined
    ? undefined
    : normalizeAdditionalDomains(additionalDomains).filter(domain => domain !== normalizedPrimary);
  await assertNoDomainConflicts(
    db,
    tenantId,
    [normalizedPrimary, ...(normalizedAdditional ?? [])].filter((domain): domain is string => Boolean(domain)),
    accountId,
  );
  if (normalizedPrimary) {
    await db.query(
      `DELETE FROM account_domains
       WHERE tenant_id = $1 AND account_id = $2 AND is_primary = TRUE AND lower(domain) <> $3`,
      [tenantId, accountId, normalizedPrimary],
    );
    const inserted = await db.query(
      `INSERT INTO account_domains (tenant_id, account_id, domain, source, is_primary)
       VALUES ($1,$2,$3,'account.domain',TRUE)
       ON CONFLICT (tenant_id, lower(domain))
       DO UPDATE SET source = EXCLUDED.source, is_primary = TRUE, updated_at = now()
       WHERE account_domains.account_id = EXCLUDED.account_id`,
      [tenantId, accountId, normalizedPrimary],
    );
    if ((inserted.rowCount ?? 0) === 0) {
      await assertNoDomainConflicts(db, tenantId, [normalizedPrimary], accountId);
    }
  }
  if (additionalDomains === undefined) return;
  const domains = normalizedAdditional ?? [];
  await db.query(
    `DELETE FROM account_domains
     WHERE tenant_id = $1 AND account_id = $2 AND is_primary = FALSE`,
    [tenantId, accountId],
  );
  for (const domain of domains) {
    const inserted = await db.query(
      `INSERT INTO account_domains (tenant_id, account_id, domain, source, is_primary)
       VALUES ($1,$2,$3,'manual',FALSE)
       ON CONFLICT (tenant_id, lower(domain))
       DO UPDATE SET source = EXCLUDED.source, is_primary = FALSE, updated_at = now()
       WHERE account_domains.account_id = EXCLUDED.account_id`,
      [tenantId, accountId, domain],
    );
    if ((inserted.rowCount ?? 0) === 0) {
      await assertNoDomainConflicts(db, tenantId, [domain], accountId);
    }
  }
}

async function hydrateAccountDomains(db: DbPool, tenantId: UUID, accounts: Account[]): Promise<Account[]> {
  if (accounts.length === 0) return accounts;
  const ids = accounts.map(account => account.id);
  const result = await db.query(
    `SELECT account_id, array_agg(domain ORDER BY domain) FILTER (WHERE is_primary = FALSE) AS domains
     FROM account_domains
     WHERE tenant_id = $1 AND account_id = ANY($2::uuid[])
     GROUP BY account_id`,
    [tenantId, ids],
  );
  const byAccount = new Map<string, string[]>(result.rows.map(row => [row.account_id as string, (row.domains ?? []) as string[]]));
  return accounts.map(account => ({
    ...account,
    additional_domains: byAccount.get(account.id) ?? [],
  }));
}

async function hydrateAccountDomain(db: DbPool, tenantId: UUID, account: Account | null): Promise<Account | null> {
  if (!account) return null;
  return (await hydrateAccountDomains(db, tenantId, [account]))[0] ?? account;
}

function concurrencyConflict(entity: string, id: UUID, expectedVersion: number): CrmyError {
  return new CrmyError(
    'CONFLICT',
    `${entity} ${id} was modified by another writer; refresh the object and retry with the latest row_version`,
    409,
    { expected_version: expectedVersion },
  );
}

export async function createAccount(
  db: DbPool,
  tenantId: UUID,
  data: Partial<Account> & { created_by?: UUID },
): Promise<Account> {
  const normalizedDomain = normalizeDomain(data.domain);
  await assertNoDomainConflicts(
    db,
    tenantId,
    [normalizedDomain, ...normalizeAdditionalDomains(data.additional_domains ?? [])].filter((domain): domain is string => Boolean(domain)),
  );
  const result = await db.query(
    `INSERT INTO accounts (tenant_id, name, domain, industry, employee_count,
       annual_revenue, currency_code, website, parent_id, owner_id,
       aliases, tags, custom_fields, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      tenantId,
      data.name,
      normalizedDomain,
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
  const account = result.rows[0] as Account;
  await syncAccountDomains(db, tenantId, account.id, normalizedDomain, data.additional_domains ?? []);
  return await hydrateAccountDomain(db, tenantId, account) ?? account;
}

export async function getAccount(db: DbPool, tenantId: UUID, id: UUID): Promise<Account | null> {
  const result = await db.query(
    'SELECT * FROM accounts WHERE id = $1 AND tenant_id = $2 AND merged_into IS NULL AND archived_at IS NULL',
    [id, tenantId],
  );
  return hydrateAccountDomain(db, tenantId, (result.rows[0] as Account | undefined) ?? null);
}

export async function getAccountByDomain(db: DbPool, tenantId: UUID, domain: string): Promise<Account | null> {
  const normalized = normalizeDomain(domain);
  if (!normalized) return null;
  const result = await db.query(
    `SELECT a.*
     FROM accounts a
     LEFT JOIN account_domains ad ON ad.tenant_id = a.tenant_id AND ad.account_id = a.id
     WHERE a.tenant_id = $1
       AND a.merged_into IS NULL
       AND a.archived_at IS NULL
       AND (lower(a.domain) = $2 OR lower(ad.domain) = $2)
     LIMIT 1`,
    [tenantId, normalized],
  );
  return hydrateAccountDomain(db, tenantId, (result.rows[0] as Account | undefined) ?? null);
}

export async function getAccountContacts(db: DbPool, tenantId: UUID, accountId: UUID): Promise<Contact[]> {
  const result = await db.query(
    'SELECT * FROM contacts WHERE account_id = $1 AND tenant_id = $2 AND merged_into IS NULL AND archived_at IS NULL ORDER BY created_at DESC',
    [accountId, tenantId],
  );
  return result.rows as Contact[];
}

export async function getAccountOpenOpps(db: DbPool, tenantId: UUID, accountId: UUID): Promise<Opportunity[]> {
  const result = await db.query(
    `SELECT * FROM opportunities
     WHERE account_id = $1 AND tenant_id = $2
       AND archived_at IS NULL
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
    owner_ids?: UUID[];
    min_revenue?: number;
    tags?: string[];
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<Account>> {
  const conditions: string[] = ['a.tenant_id = $1', 'a.merged_into IS NULL', 'a.archived_at IS NULL'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.query) {
    conditions.push(
      `(a.name ILIKE $${idx} OR a.domain ILIKE $${idx}` +
      ` OR EXISTS (SELECT 1 FROM unnest(a.aliases) _a WHERE _a ILIKE $${idx})` +
      ` OR EXISTS (SELECT 1 FROM account_domains ad WHERE ad.tenant_id = a.tenant_id AND ad.account_id = a.id AND ad.domain ILIKE $${idx}))`,
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
  } else if (filters.owner_ids) {
    if (filters.owner_ids.length === 0) {
      conditions.push('FALSE');
    } else {
      conditions.push(`a.owner_id = ANY($${idx}::uuid[])`);
      params.push(filters.owner_ids);
      idx++;
    }
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
  idx = addStableDescCursorCondition(conditions, params, idx, filters.cursor, 'a.created_at', 'a.id');

  const where = conditions.join(' AND ');

  const exactTotals = exactListTotalsEnabled();
  const countResult = exactTotals
    ? await db.query(`SELECT count(*)::int as total FROM accounts a WHERE ${where}`, params)
    : null;

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT a.* FROM accounts a WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as Account[];
  const hasMore = rows.length > filters.limit;
  const data = await hydrateAccountDomains(db, tenantId, hasMore ? rows.slice(0, filters.limit) : rows);

  return {
    data,
    ...pageTotal(data.length, hasMore, exactTotals ? Number(countResult?.rows[0]?.total ?? 0) : undefined),
    next_cursor: hasMore && data.length > 0
      ? encodeStableCursor({ sort_value: data[data.length - 1].created_at, id: data[data.length - 1].id })
      : undefined,
  };
}

export async function updateAccount(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Record<string, unknown>,
  options: MutationOptions = {},
): Promise<Account | null> {
  const requestedDomain = 'domain' in patch ? normalizeDomain(patch.domain) : undefined;
  const requestedAdditionalDomains = 'additional_domains' in patch ? normalizeAdditionalDomains(patch.additional_domains) : undefined;
  if (requestedDomain !== undefined || requestedAdditionalDomains !== undefined) {
    const current = await getAccount(db, tenantId, id);
    if (!current) return null;
    await assertNoDomainConflicts(
      db,
      tenantId,
      [
        requestedDomain !== undefined ? requestedDomain : current.domain,
        ...(requestedAdditionalDomains ?? current.additional_domains ?? []),
      ].filter((domain): domain is string => Boolean(domain)),
      id,
    );
  }
  const allowedFields = [
    'name', 'domain', 'industry', 'employee_count', 'annual_revenue',
    'currency_code', 'website', 'parent_id', 'owner_id', 'health_score',
    'aliases', 'tags', 'custom_fields',
  ];

  const sets: string[] = ['updated_at = now()', 'row_version = row_version + 1'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;
  let changed = false;

  for (const field of allowedFields) {
    if (field in patch) {
      const value = field === 'custom_fields'
        ? JSON.stringify(patch[field])
        : field === 'domain'
          ? requestedDomain
          : patch[field];
      sets.push(`${field} = $${idx}`);
      params.push(value);
      idx++;
      changed = true;
    }
  }

  const additionalDomainsChanged = 'additional_domains' in patch;
  if (additionalDomainsChanged) changed = true;
  if (!changed && !additionalDomainsChanged) return getAccount(db, tenantId, id);

  let versionClause = '';
  if (options.expectedVersion !== undefined) {
    versionClause = ` AND row_version = $${idx}`;
    params.push(options.expectedVersion);
  }

  const result = await db.query(
    `UPDATE accounts SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL${versionClause} RETURNING *`,
    params,
  );
  if (changed && result.rows.length === 0 && options.expectedVersion !== undefined) {
    throw concurrencyConflict('Account', id, options.expectedVersion);
  }
  const account = changed ? ((result.rows[0] as Account | undefined) ?? null) : await getAccount(db, tenantId, id);
  if (!account) return null;
  if (changed && 'domain' in patch) {
    await syncAccountDomains(db, tenantId, id, patch.domain, undefined);
  }
  if (additionalDomainsChanged) {
    await syncAccountDomains(db, tenantId, id, account.domain, patch.additional_domains);
  }
  return hydrateAccountDomain(db, tenantId, account);
}

export async function getAccountHierarchy(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
): Promise<{ root: Account; children: Account[]; depth: number } | null> {
  // Single recursive CTE: walk from the given account up to the root,
  // tracking depth (hop count). Returns all ancestor rows sorted deepest-first
  // so the last row is the root. Uses a guard on tenant_id to prevent
  // cross-tenant traversal if a parent_id were ever corrupted.
  const ancestorResult = await db.query(
    `WITH RECURSIVE chain AS (
       SELECT *, 0 AS hop
         FROM accounts
        WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL
       UNION ALL
       SELECT a.*, c.hop + 1
         FROM accounts a
         JOIN chain c ON a.id = c.parent_id
        WHERE a.tenant_id = $2 AND a.archived_at IS NULL
     )
     SELECT * FROM chain ORDER BY hop DESC LIMIT 1`,
    [id, tenantId],
  );

  if (ancestorResult.rows.length === 0) return null;

  const rootRow = ancestorResult.rows[0] as Account & { hop: number };
  const depth: number = rootRow.hop;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hop: _hop, ...root } = rootRow;

  // Fetch direct children of the root in the same query
  const childrenResult = await db.query(
    'SELECT * FROM accounts WHERE parent_id = $1 AND tenant_id = $2 AND archived_at IS NULL ORDER BY name',
    [root.id, tenantId],
  );

  return {
    root: root as Account,
    children: childrenResult.rows as Account[],
    depth,
  };
}

export async function deleteAccount(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  options: MutationOptions = {},
): Promise<boolean> {
  const params: unknown[] = [tenantId, id];
  let versionClause = '';
  if (options.expectedVersion !== undefined) {
    versionClause = ' AND row_version = $3';
    params.push(options.expectedVersion);
  }
  const result = await db.query(
    `UPDATE accounts
        SET archived_at = COALESCE(archived_at, now()),
            updated_at = now(),
            row_version = row_version + 1
      WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL${versionClause}`,
    params,
  );
  if ((result.rowCount ?? 0) === 0 && options.expectedVersion !== undefined) {
    throw concurrencyConflict('Account', id, options.expectedVersion);
  }
  return (result.rowCount ?? 0) > 0;
}
