// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { Contact, UUID, PaginatedResponse } from '@crmy/shared';
import { CrmyError } from '@crmy/shared';

interface MutationOptions {
  expectedVersion?: number;
}

function concurrencyConflict(entity: string, id: UUID, expectedVersion: number): CrmyError {
  return new CrmyError(
    'CONFLICT',
    `${entity} ${id} was modified by another writer; refresh the object and retry with the latest row_version`,
    409,
    { expected_version: expectedVersion },
  );
}

export async function createContact(
  db: DbPool,
  tenantId: UUID,
  data: Partial<Contact> & { created_by?: UUID },
): Promise<Contact> {
  const result = await db.query(
    `INSERT INTO contacts (tenant_id, first_name, last_name, email, phone,
       title, company_name, account_id, owner_id, lifecycle_stage,
       source, aliases, tags, custom_fields, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      tenantId,
      data.first_name ?? '',
      data.last_name ?? '',
      data.email ?? null,
      data.phone ?? null,
      data.title ?? null,
      data.company_name ?? null,
      data.account_id ?? null,
      data.owner_id ?? data.created_by ?? null,
      data.lifecycle_stage ?? 'lead',
      data.source ?? null,
      data.aliases ?? [],
      data.tags ?? [],
      JSON.stringify(data.custom_fields ?? {}),
      data.created_by ?? null,
    ],
  );
  return result.rows[0] as Contact;
}

export async function getContact(db: DbPool, tenantId: UUID, id: UUID): Promise<Contact | null> {
  const result = await db.query(
    `SELECT c.*, a.name AS account_name
     FROM contacts c
     LEFT JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
     WHERE c.id = $1 AND c.tenant_id = $2 AND c.merged_into IS NULL AND c.archived_at IS NULL`,
    [id, tenantId],
  );
  return (result.rows[0] as Contact) ?? null;
}

export async function getContactByEmail(db: DbPool, tenantId: UUID, email: string): Promise<Contact | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const result = await db.query(
    `SELECT * FROM contacts
     WHERE tenant_id = $1 AND lower(email) = $2 AND merged_into IS NULL AND archived_at IS NULL
     LIMIT 1`,
    [tenantId, normalized],
  );
  return (result.rows[0] as Contact) ?? null;
}

export async function searchContacts(
  db: DbPool,
  tenantId: UUID,
  filters: {
    query?: string;
    lifecycle_stage?: string;
    account_id?: UUID;
    owner_id?: UUID;
    owner_ids?: UUID[];
    tags?: string[];
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<Contact>> {
  const conditions: string[] = ['c.tenant_id = $1', 'c.merged_into IS NULL', 'c.archived_at IS NULL'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.query) {
    conditions.push(
      `(c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx} OR c.email ILIKE $${idx} OR c.company_name ILIKE $${idx} OR a.name ILIKE $${idx}` +
      ` OR EXISTS (SELECT 1 FROM unnest(c.aliases) _a WHERE _a ILIKE $${idx}))`,
    );
    params.push(`%${filters.query}%`);
    idx++;
  }
  if (filters.lifecycle_stage) {
    conditions.push(`c.lifecycle_stage = $${idx}`);
    params.push(filters.lifecycle_stage);
    idx++;
  }
  if (filters.account_id) {
    conditions.push(`c.account_id = $${idx}`);
    params.push(filters.account_id);
    idx++;
  }
  if (filters.owner_id) {
    conditions.push(`c.owner_id = $${idx}`);
    params.push(filters.owner_id);
    idx++;
  } else if (filters.owner_ids) {
    if (filters.owner_ids.length === 0) {
      conditions.push('FALSE');
    } else {
      conditions.push(`c.owner_id = ANY($${idx}::uuid[])`);
      params.push(filters.owner_ids);
      idx++;
    }
  }
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(`c.tags && $${idx}`);
    params.push(filters.tags);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`c.created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int as total
     FROM contacts c
     LEFT JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
     WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT c.*, a.name AS account_name
     FROM contacts c
     LEFT JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
     WHERE ${where}
     ORDER BY c.created_at DESC
     LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as Contact[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

export async function updateContact(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Record<string, unknown>,
  options: MutationOptions = {},
): Promise<Contact | null> {
  const allowedFields = [
    'first_name', 'last_name', 'email', 'phone', 'title', 'company_name',
    'account_id', 'owner_id', 'lifecycle_stage', 'source', 'aliases', 'tags', 'custom_fields',
  ];

  const sets: string[] = ['updated_at = now()', 'row_version = row_version + 1'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;
  let changed = false;

  for (const field of allowedFields) {
    if (field in patch) {
      const value = field === 'custom_fields' ? JSON.stringify(patch[field]) : patch[field];
      sets.push(`${field} = $${idx}`);
      params.push(value);
      idx++;
      changed = true;
    }
  }

  if (!changed) return getContact(db, tenantId, id);

  let versionClause = '';
  if (options.expectedVersion !== undefined) {
    versionClause = ` AND row_version = $${idx}`;
    params.push(options.expectedVersion);
  }

  const result = await db.query(
    `UPDATE contacts SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL${versionClause} RETURNING *`,
    params,
  );
  if (result.rows.length === 0 && options.expectedVersion !== undefined) {
    throw concurrencyConflict('Contact', id, options.expectedVersion);
  }
  return result.rows[0] ? getContact(db, tenantId, id) : null;
}

export async function deleteContact(
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
    `UPDATE contacts
        SET archived_at = COALESCE(archived_at, now()),
            updated_at = now(),
            row_version = row_version + 1
      WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL${versionClause}`,
    params,
  );
  if ((result.rowCount ?? 0) === 0 && options.expectedVersion !== undefined) {
    throw concurrencyConflict('Contact', id, options.expectedVersion);
  }
  return (result.rowCount ?? 0) > 0;
}
