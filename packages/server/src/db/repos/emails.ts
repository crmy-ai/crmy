// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID, PaginatedResponse } from '@crmy/shared';
import { addStableDescCursorCondition, encodeStableCursor, exactListTotalsEnabled, pageTotal } from './pagination.js';

export interface EmailRow {
  id: UUID;
  tenant_id: UUID;
  contact_id?: UUID;
  account_id?: UUID;
  opportunity_id?: UUID;
  use_case_id?: UUID;
  to_email: string;
  to_name?: string;
  from_email?: string | null;
  from_name?: string | null;
  sender_type: 'actor_mailbox' | 'tenant_provider' | 'unknown';
  mailbox_connection_id?: UUID | null;
  subject: string;
  body_html?: string;
  body_text: string;
  status: string;
  hitl_request_id?: UUID;
  sent_at?: string;
  provider_msg_id?: string;
  source_agent?: string;
  created_by?: UUID;
  draft_origin?: 'manual' | 'agent_generated';
  draft_target?: 'crmy' | 'provider_draft';
  source_email_message_id?: UUID;
  provider_draft_id?: string;
  provider_draft_status?: 'not_requested' | 'unsupported' | 'pending' | 'created' | 'failed';
  generation_metadata?: Record<string, unknown>;
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

export interface EmailDeliveryJobRow {
  id: UUID;
  tenant_id: UUID;
  email_id: UUID;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  reason: string;
  attempts: number;
  max_attempts: number;
  last_error?: string | null;
  available_at: string;
  locked_at?: string | null;
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
    to_name?: string;
    from_email?: string | null;
    from_name?: string | null;
    sender_type?: 'actor_mailbox' | 'tenant_provider' | 'unknown';
    mailbox_connection_id?: UUID | null;
    subject: string;
    body_html?: string;
    body_text: string;
    status?: string;
    hitl_request_id?: UUID;
    created_by?: UUID;
    draft_origin?: 'manual' | 'agent_generated';
    draft_target?: 'crmy' | 'provider_draft';
    source_email_message_id?: UUID;
    provider_draft_id?: string;
    provider_draft_status?: 'not_requested' | 'unsupported' | 'pending' | 'created' | 'failed';
    generation_metadata?: Record<string, unknown>;
  },
): Promise<EmailRow> {
  const result = await db.query(
    `INSERT INTO emails (tenant_id, contact_id, account_id, opportunity_id, use_case_id,
       to_email, to_name, from_email, from_name, sender_type, mailbox_connection_id,
       subject, body_html, body_text, status, hitl_request_id, created_by,
     draft_origin, draft_target, source_email_message_id, provider_draft_id, provider_draft_status,
     generation_metadata)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
    [
      tenantId,
      data.contact_id ?? null,
      data.account_id ?? null,
      data.opportunity_id ?? null,
      data.use_case_id ?? null,
      data.to_email,
      data.to_name ?? null,
      data.from_email ?? null,
      data.from_name ?? null,
      data.sender_type ?? 'tenant_provider',
      data.mailbox_connection_id ?? null,
      data.subject,
      data.body_html ?? null,
      data.body_text,
      data.status ?? 'draft',
      data.hitl_request_id ?? null,
      data.created_by ?? null,
      data.draft_origin ?? 'manual',
      data.draft_target ?? 'crmy',
      data.source_email_message_id ?? null,
      data.provider_draft_id ?? null,
      data.provider_draft_status ?? 'not_requested',
      JSON.stringify(data.generation_metadata ?? {}),
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
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  status: string,
  metadata?: Record<string, unknown>,
): Promise<EmailRow | null> {
  const extra = [
    status === 'sent' ? ', sent_at = now()' : '',
    metadata ? ', generation_metadata = COALESCE(generation_metadata, \'{}\'::jsonb) || $4::jsonb' : '',
  ].join('');
  const result = await db.query(
    `UPDATE emails SET status = $3, updated_at = now()${extra}
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    metadata ? [id, tenantId, status, JSON.stringify(metadata)] : [id, tenantId, status],
  );
  return (result.rows[0] as EmailRow) ?? null;
}

export async function updateEmailDraft(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  data: { to_email?: string; to_name?: string | null; subject?: string; body_text?: string; body_html?: string | null },
): Promise<EmailRow | null> {
  const result = await db.query(
    `UPDATE emails
     SET to_email = COALESCE($3, to_email),
         to_name = COALESCE($4, to_name),
         subject = COALESCE($5, subject),
         body_text = COALESCE($6, body_text),
         body_html = COALESCE($7, body_html),
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND status IN ('draft', 'failed', 'rejected')
     RETURNING *`,
    [
      id,
      tenantId,
      data.to_email ?? null,
      data.to_name ?? null,
      data.subject ?? null,
      data.body_text ?? null,
      data.body_html ?? null,
    ],
  );
  return (result.rows[0] as EmailRow) ?? null;
}

export async function setEmailApprovalRequest(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  hitlRequestId: UUID,
): Promise<EmailRow | null> {
  const result = await db.query(
    `UPDATE emails
     SET status = 'pending_approval',
         hitl_request_id = $3,
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND status IN ('draft', 'failed', 'rejected')
     RETURNING *`,
    [id, tenantId, hitlRequestId],
  );
  return (result.rows[0] as EmailRow) ?? null;
}

export async function claimEmailForDelivery(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  deliveryAttempt: Record<string, unknown>,
): Promise<EmailRow | null> {
  const result = await db.query(
    `UPDATE emails
     SET status = 'sending',
         generation_metadata = COALESCE(generation_metadata, '{}'::jsonb) || $3::jsonb,
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND status IN ('draft', 'approved', 'queued_for_delivery', 'failed', 'delivery_uncertain')
     RETURNING *`,
    [id, tenantId, JSON.stringify({ delivery_attempt: deliveryAttempt })],
  );
  return (result.rows[0] as EmailRow) ?? null;
}

export async function getEmailByHitlRequestId(
  db: DbPool, tenantId: UUID, hitlRequestId: UUID,
): Promise<EmailRow | null> {
  const result = await db.query(
    'SELECT * FROM emails WHERE hitl_request_id = $1 AND tenant_id = $2',
    [hitlRequestId, tenantId],
  );
  return (result.rows[0] as EmailRow) ?? null;
}

export async function mergeEmailGenerationMetadata(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  metadata: Record<string, unknown>,
): Promise<EmailRow | null> {
  const result = await db.query(
    `UPDATE emails
     SET generation_metadata = COALESCE(generation_metadata, '{}'::jsonb) || $3::jsonb,
         updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [id, tenantId, JSON.stringify(metadata)],
  );
  return (result.rows[0] as EmailRow) ?? null;
}

export async function updateProviderDraftStatus(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  data: { provider_draft_status: 'not_requested' | 'unsupported' | 'pending' | 'created' | 'failed'; provider_draft_id?: string | null; metadata?: Record<string, unknown> },
): Promise<EmailRow | null> {
  const result = await db.query(
    `UPDATE emails
     SET provider_draft_status = $3,
         provider_draft_id = COALESCE($4, provider_draft_id),
         generation_metadata = COALESCE(generation_metadata, '{}'::jsonb) || $5::jsonb,
         updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [id, tenantId, data.provider_draft_status, data.provider_draft_id ?? null, JSON.stringify(data.metadata ?? {})],
  );
  return (result.rows[0] as EmailRow | undefined) ?? null;
}

export async function updateEmailDelivery(
  db: DbPool, tenantId: UUID, id: UUID,
  data: { status: string; provider_msg_id?: string; error?: string },
): Promise<EmailRow | null> {
  const sets = ['status = $3', 'updated_at = now()'];
  const params: unknown[] = [id, tenantId, data.status];
  let idx = 4;

  if (data.status === 'sent') sets.push('sent_at = now()');
  if (data.provider_msg_id) {
    sets.push(`provider_msg_id = $${idx}`);
    params.push(data.provider_msg_id);
    idx++;
  }

  const result = await db.query(
    `UPDATE emails SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as EmailRow) ?? null;
}

export async function enqueueEmailDeliveryJob(
  db: DbPool,
  tenantId: UUID,
  emailId: UUID,
  data: { reason?: string; max_attempts?: number } = {},
): Promise<EmailDeliveryJobRow> {
  const result = await db.query(
    `INSERT INTO email_delivery_jobs (tenant_id, email_id, status, reason, max_attempts)
     VALUES ($1, $2, 'pending', $3, $4)
     ON CONFLICT (tenant_id, email_id)
       WHERE status IN ('pending', 'processing')
     DO UPDATE SET
       reason = EXCLUDED.reason,
       available_at = now(),
       updated_at = now()
     RETURNING *`,
    [tenantId, emailId, data.reason ?? 'email_delivery_requested', data.max_attempts ?? 5],
  );
  await db.query(
    `UPDATE emails
     SET status = 'queued_for_delivery',
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2
       AND status IN ('draft', 'approved', 'failed', 'delivery_uncertain')`,
    [tenantId, emailId],
  );
  return result.rows[0] as EmailDeliveryJobRow;
}

export async function claimEmailDeliveryJobs(db: DbPool, limit = 5): Promise<EmailDeliveryJobRow[]> {
  const result = await db.query(
    `WITH target AS (
       SELECT id
       FROM email_delivery_jobs
       WHERE status IN ('pending', 'failed')
         AND attempts < max_attempts
         AND available_at <= now()
       ORDER BY available_at ASC, created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE email_delivery_jobs j
     SET status = 'processing',
         attempts = attempts + 1,
         locked_at = now(),
         updated_at = now()
     FROM target
     WHERE j.id = target.id
     RETURNING j.*`,
    [limit],
  );
  return result.rows as EmailDeliveryJobRow[];
}

export async function completeEmailDeliveryJob(db: DbPool, jobId: UUID): Promise<void> {
  await db.query(
    `UPDATE email_delivery_jobs
     SET status = 'succeeded',
         last_error = NULL,
         updated_at = now()
     WHERE id = $1`,
    [jobId],
  );
}

export async function failEmailDeliveryJob(db: DbPool, jobId: UUID, error: string, retryable = true): Promise<void> {
  await db.query(
    `UPDATE email_delivery_jobs
     SET status = 'failed',
         last_error = $2,
         available_at = CASE
           WHEN $3::boolean THEN now() + (LEAST(900, GREATEST(30, attempts * attempts * 30))::text || ' seconds')::interval
           ELSE 'infinity'::timestamptz
         END,
         updated_at = now()
     WHERE id = $1`,
    [jobId, error, retryable],
  );
}

export async function recoverStaleEmailDeliveryState(db: DbPool, olderThanMinutes = 15, limit = 25): Promise<number> {
  const result = await db.query(
    `WITH stale_jobs AS (
       UPDATE email_delivery_jobs
       SET status = 'failed',
           last_error = 'Delivery worker stopped while processing. Sender state is uncertain; review before retrying.',
           available_at = 'infinity'::timestamptz,
           updated_at = now()
       WHERE id IN (
         SELECT id
         FROM email_delivery_jobs
         WHERE status = 'processing'
           AND locked_at < now() - ($1::text || ' minutes')::interval
         ORDER BY locked_at ASC
         LIMIT $2
       )
       RETURNING email_id, tenant_id
     )
     UPDATE emails e
     SET status = 'delivery_uncertain',
         generation_metadata = COALESCE(e.generation_metadata, '{}'::jsonb) || jsonb_build_object(
           'delivery_uncertain',
           jsonb_build_object(
             'reason', 'Worker stopped after delivery claim. Provider may or may not have sent the email.',
             'detected_at', now()
           )
         ),
         updated_at = now()
     FROM stale_jobs sj
     WHERE e.id = sj.email_id
       AND e.tenant_id = sj.tenant_id
       AND e.status = 'sending'
     RETURNING e.id`,
    [olderThanMinutes, limit],
  );
  return result.rowCount ?? 0;
}

export async function searchEmails(
  db: DbPool, tenantId: UUID,
  filters: {
    contact_id?: UUID;
    account_id?: UUID;
    opportunity_id?: UUID;
    use_case_id?: UUID;
    q?: string;
    status?: string;
    owner_ids?: UUID[];
    created_by?: UUID;
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<EmailRow>> {
  const conditions: string[] = ['e.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.contact_id) {
    conditions.push(`e.contact_id = $${idx}`);
    params.push(filters.contact_id);
    idx++;
  }
  if (filters.account_id) {
    conditions.push(`(e.account_id = $${idx} OR c.account_id = $${idx})`);
    params.push(filters.account_id);
    idx++;
  }
  if (filters.opportunity_id) {
    conditions.push(`e.opportunity_id = $${idx}`);
    params.push(filters.opportunity_id);
    idx++;
  }
  if (filters.use_case_id) {
    conditions.push(`e.use_case_id = $${idx}`);
    params.push(filters.use_case_id);
    idx++;
  }
  if (filters.status) {
    conditions.push(`e.status = $${idx}`);
    params.push(filters.status);
    idx++;
  }
  if (filters.created_by) {
    conditions.push(`e.created_by = $${idx}`);
    params.push(filters.created_by);
    idx++;
  }
  if (filters.owner_ids) {
    if (filters.owner_ids.length === 0) {
      conditions.push('FALSE');
    } else {
      conditions.push(`(
        e.created_by = ANY($${idx}::uuid[])
        OR c.owner_id = ANY($${idx}::uuid[])
        OR a.owner_id = ANY($${idx}::uuid[])
        OR o.owner_id = ANY($${idx}::uuid[])
        OR uc.owner_id = ANY($${idx}::uuid[])
      )`);
      params.push(filters.owner_ids);
      idx++;
    }
  }
  if (filters.q?.trim()) {
    conditions.push(`(
      e.subject ILIKE $${idx}
      OR e.body_text ILIKE $${idx}
      OR e.to_email ILIKE $${idx}
      OR e.from_email ILIKE $${idx}
      OR c.email ILIKE $${idx}
      OR a.name ILIKE $${idx}
    )`);
    params.push(`%${filters.q.trim()}%`);
    idx++;
  }
  idx = addStableDescCursorCondition(conditions, params, idx, filters.cursor, 'e.created_at', 'e.id');

  const where = conditions.join(' AND ');
  const from = `FROM emails e
    LEFT JOIN contacts c ON c.id = e.contact_id AND c.tenant_id = e.tenant_id
    LEFT JOIN accounts a ON a.id = COALESCE(e.account_id, c.account_id) AND a.tenant_id = e.tenant_id
    LEFT JOIN opportunities o ON o.id = e.opportunity_id AND o.tenant_id = e.tenant_id
    LEFT JOIN use_cases uc ON uc.id = e.use_case_id AND uc.tenant_id = e.tenant_id`;
  const exactTotals = exactListTotalsEnabled();
  const countResult = exactTotals
    ? await db.query(`SELECT count(*)::int as total ${from} WHERE ${where}`, params)
    : null;

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT e.* ${from} WHERE ${where} ORDER BY e.created_at DESC, e.id DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as EmailRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    ...pageTotal(data.length, hasMore, exactTotals ? Number(countResult?.rows[0]?.total ?? 0) : undefined),
    next_cursor: hasMore && data.length > 0
      ? encodeStableCursor({ sort_value: data[data.length - 1].created_at, id: data[data.length - 1].id })
      : undefined,
  };
}
