// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID, PaginatedResponse } from '@crmy/shared';

export interface EmailRow {
  id: UUID;
  tenant_id: UUID;
  contact_id?: UUID;
  account_id?: UUID;
  opportunity_id?: UUID;
  use_case_id?: UUID;
  to_email: string;
  to_name?: string;
  subject: string;
  body_html?: string;
  body_text: string;
  status: string;
  hitl_request_id?: UUID;
  sent_at?: string;
  provider_msg_id?: string;
  source_agent?: string;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface EmailProviderRow {
  id: UUID;
  tenant_id: UUID;
  provider: string;
  config: Record<string, unknown>;
  from_name: string;
  from_email: string;
  created_at: string;
  updated_at: string;
}

export async function getProvider(db: DbPool, tenantId: UUID): Promise<EmailProviderRow | null> {
  const result = await db.query(
    'SELECT * FROM email_providers WHERE tenant_id = $1',
    [tenantId],
  );
  return (result.rows[0] as EmailProviderRow) ?? null;
}

export async function upsertProvider(
  db: DbPool, tenantId: UUID,
  data: { provider: string; config: Record<string, unknown>; from_name: string; from_email: string },
): Promise<EmailProviderRow> {
  const result = await db.query(
    `INSERT INTO email_providers (tenant_id, provider, config, from_name, from_email)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id) DO UPDATE SET
       provider = $2, config = $3, from_name = $4, from_email = $5, updated_at = now()
     RETURNING *`,
    [tenantId, data.provider, JSON.stringify(data.config), data.from_name, data.from_email],
  );
  return result.rows[0] as EmailProviderRow;
}

export async function createEmail(
  db: DbPool, tenantId: UUID,
  data: {
    contact_id?: UUID;
    account_id?: UUID;
    opportunity_id?: UUID;
    use_case_id?: UUID;
    to_email: string;
    subject: string;
    body_html?: string;
    body_text: string;
    status?: string;
    hitl_request_id?: UUID;
    created_by?: UUID;
  },
): Promise<EmailRow> {
  const result = await db.query(
    `INSERT INTO emails (tenant_id, contact_id, account_id, opportunity_id, use_case_id,
       to_email, subject, body_html, body_text, status, hitl_request_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      tenantId,
      data.contact_id ?? null,
      data.account_id ?? null,
      data.opportunity_id ?? null,
      data.use_case_id ?? null,
      data.to_email,
      data.subject,
      data.body_html ?? null,
      data.body_text,
      data.status ?? 'draft',
      data.hitl_request_id ?? null,
      data.created_by ?? null,
    ],
  );
  return result.rows[0] as EmailRow;
}

export async function getEmail(db: DbPool, tenantId: UUID, id: UUID): Promise<EmailRow | null> {
  const result = await db.query(
    'SELECT * FROM emails WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as EmailRow) ?? null;
}

export async function updateEmailStatus(
  db: DbPool, tenantId: UUID, id: UUID, status: string,
): Promise<EmailRow | null> {
  const extra = status === 'sent' ? ', sent_at = now()' : '';
  const result = await db.query(
    `UPDATE emails SET status = $3, updated_at = now()${extra}
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId, status],
  );
  return (result.rows[0] as EmailRow) ?? null;
}

export async function searchEmails(
  db: DbPool, tenantId: UUID,
  filters: { contact_id?: UUID; status?: string; limit: number; cursor?: string },
): Promise<PaginatedResponse<EmailRow>> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.contact_id) {
    conditions.push(`contact_id = $${idx}`);
    params.push(filters.contact_id);
    idx++;
  }
  if (filters.status) {
    conditions.push(`status = $${idx}`);
    params.push(filters.status);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');
  const countResult = await db.query(`SELECT count(*)::int as total FROM emails WHERE ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM emails WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as EmailRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}
