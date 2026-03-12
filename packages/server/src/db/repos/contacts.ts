// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { Contact, UUID, PaginatedResponse } from '@crmy/shared';

export async function createContact(
  db: DbPool,
  tenantId: UUID,
  data: Partial<Contact> & { created_by?: UUID },
): Promise<Contact> {
  const result = await db.query(
    `INSERT INTO contacts (tenant_id, first_name, last_name, email, phone,
       title, company_name, account_id, owner_id, lifecycle_stage,
       source, tags, custom_fields, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
      data.tags ?? [],
      JSON.stringify(data.custom_fields ?? {}),
      data.created_by ?? null,
    ],
  );
  return result.rows[0] as Contact;
}

export async function getContact(db: DbPool, tenantId: UUID, id: UUID): Promise<Contact | null> {
  const result = await db.query(
    'SELECT * FROM contacts WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
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
    tags?: string[];
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<Contact>> {
  const conditions: string[] = ['c.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.query) {
    conditions.push(
      `(c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx} OR c.email ILIKE $${idx} OR c.company_name ILIKE $${idx})`,
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
    `SELECT count(*)::int as total FROM contacts c WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT c.* FROM contacts c WHERE ${where} ORDER BY c.created_at DESC LIMIT $${idx}`,
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
): Promise<Contact | null> {
  const allowedFields = [
    'first_name', 'last_name', 'email', 'phone', 'title', 'company_name',
    'account_id', 'owner_id', 'lifecycle_stage', 'source', 'tags', 'custom_fields',
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

  if (sets.length === 1) return getContact(db, tenantId, id);

  const result = await db.query(
    `UPDATE contacts SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as Contact) ?? null;
}

export async function deleteContact(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM contacts WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  return (result.rowCount ?? 0) > 0;
}
