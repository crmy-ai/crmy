// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { PaginatedResponse, UUID } from '@crmy/shared';

export type EmailClassification = 'customer' | 'mixed' | 'internal' | 'automated' | 'unknown';
export type EmailProcessingStatus = 'unprocessed' | 'processing' | 'processed' | 'needs_review' | 'skipped' | 'failed' | 'ignored';
export type MailboxProvider = 'google' | 'microsoft' | 'webhook';
export type MailboxConnectionStatus = 'configuration_required' | 'connected' | 'syncing' | 'error' | 'disconnected';
export type MailboxSendStatus = 'not_authorized' | 'ready' | 'disabled' | 'error';

export interface MailboxConnection {
  id: UUID;
  tenant_id: UUID;
  user_id?: UUID | null;
  provider: MailboxProvider;
  email_address: string;
  display_name?: string | null;
  status: MailboxConnectionStatus;
  scopes: string[];
  sync_cursor?: string | null;
  provider_account_id?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  token_expires_at?: string | null;
  sync_stats?: Record<string, unknown>;
  settings: Record<string, unknown>;
  context_sync_enabled: boolean;
  send_enabled: boolean;
  provider_draft_enabled: boolean;
  send_status: MailboxSendStatus;
  send_last_error?: string | null;
  is_default_sender: boolean;
  last_sync_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailMessage {
  id: UUID;
  tenant_id: UUID;
  mailbox_connection_id?: UUID | null;
  user_id?: UUID | null;
  direction: 'inbound' | 'outbound';
  source: string;
  provider_message_id?: string | null;
  message_id?: string | null;
  thread_id?: string | null;
  in_reply_to?: string | null;
  references_header: string[];
  from_email: string;
  from_name?: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  body_text?: string | null;
  body_html?: string | null;
  snippet?: string | null;
  classification: EmailClassification;
  processing_status: EmailProcessingStatus;
  processing_reason?: string | null;
  contact_id?: UUID | null;
  account_id?: UUID | null;
  opportunity_id?: UUID | null;
  use_case_id?: UUID | null;
  activity_id?: UUID | null;
  raw_context_source_id?: UUID | null;
  email_id?: UUID | null;
  extraction_receipt: Record<string, unknown>;
  metadata: Record<string, unknown>;
  received_at?: string | null;
  sent_at?: string | null;
  ignored_at?: string | null;
  created_at: string;
  updated_at: string;
  contact_name?: string | null;
  account_name?: string | null;
  opportunity_name?: string | null;
  use_case_name?: string | null;
  email_status?: string | null;
  draft_origin?: string | null;
  hitl_request_id?: UUID | null;
  provider_draft_status?: string | null;
  mailbox_email_address?: string | null;
  mailbox_display_name?: string | null;
  reply_to_email_message_id?: UUID | null;
  conversation_root_email_message_id?: UUID | null;
}

export interface EmailSubjectSummary {
  subject_id: UUID;
  total: number;
  inbound: number;
  outbound: number;
  drafts: number;
  pending_approvals: number;
  needs_review: number;
  inbound_needs_review: number;
  outbound_drafts: number;
  outbound_pending_approvals: number;
  outbound_failed: number;
  outbound_rejected: number;
  latest_at?: string | null;
}

export interface EmailMessageInput {
  mailbox_connection_id?: UUID | null;
  user_id?: UUID | null;
  direction: 'inbound' | 'outbound';
  source?: string;
  provider_message_id?: string | null;
  message_id?: string | null;
  thread_id?: string | null;
  in_reply_to?: string | null;
  references_header?: string[];
  from_email: string;
  from_name?: string | null;
  to_emails?: string[];
  cc_emails?: string[];
  subject?: string;
  body_text?: string | null;
  body_html?: string | null;
  snippet?: string | null;
  classification?: EmailClassification;
  processing_status?: EmailProcessingStatus;
  processing_reason?: string | null;
  contact_id?: UUID | null;
  account_id?: UUID | null;
  opportunity_id?: UUID | null;
  use_case_id?: UUID | null;
  activity_id?: UUID | null;
  raw_context_source_id?: UUID | null;
  email_id?: UUID | null;
  reply_to_email_message_id?: UUID | null;
  conversation_root_email_message_id?: UUID | null;
  extraction_receipt?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  received_at?: string | null;
  sent_at?: string | null;
}

export interface EmailMessageFilters {
  q?: string;
  direction?: 'inbound' | 'outbound';
  classification?: EmailClassification;
  classifications?: EmailClassification[];
  processing_status?: EmailProcessingStatus;
  processing_statuses?: EmailProcessingStatus[];
  contact_id?: UUID;
  account_id?: UUID;
  opportunity_id?: UUID;
  use_case_id?: UUID;
  owner_ids?: UUID[];
  include_internal?: boolean;
  limit: number;
  cursor?: string;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function rowToMessage(row: Record<string, unknown>): EmailMessage {
  return row as unknown as EmailMessage;
}

export async function listMailboxConnections(
  db: DbPool,
  tenantId: UUID,
  userId?: UUID | null,
): Promise<MailboxConnection[]> {
  const params: unknown[] = [tenantId];
  const conditions = ['tenant_id = $1'];
  if (userId) {
    params.push(userId);
    conditions.push(`(user_id = $${params.length} OR user_id IS NULL)`);
  }
  const result = await db.query(
    `SELECT * FROM mailbox_connections
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    params,
  );
  return result.rows as MailboxConnection[];
}

export async function getMailboxConnection(db: DbPool, tenantId: UUID, id: UUID): Promise<MailboxConnection | null> {
  const result = await db.query(
    'SELECT * FROM mailbox_connections WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  return (result.rows[0] as MailboxConnection | undefined) ?? null;
}

export async function createPlaceholderConnection(
  db: DbPool,
  tenantId: UUID,
  data: {
    user_id?: UUID | null;
    provider: MailboxProvider;
    email_address: string;
    display_name?: string | null;
    status?: MailboxConnectionStatus;
    last_error?: string | null;
    settings?: Record<string, unknown>;
    context_sync_enabled?: boolean;
    send_enabled?: boolean;
    provider_draft_enabled?: boolean;
    send_status?: MailboxSendStatus;
    send_last_error?: string | null;
    is_default_sender?: boolean;
  },
): Promise<MailboxConnection> {
  const result = await db.query(
    `INSERT INTO mailbox_connections (
       tenant_id, user_id, provider, email_address, display_name, status, last_error, settings,
       context_sync_enabled, send_enabled, provider_draft_enabled, send_status, send_last_error, is_default_sender
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (tenant_id, user_id, provider, email_address)
     DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, mailbox_connections.display_name),
       status = EXCLUDED.status,
       last_error = EXCLUDED.last_error,
       settings = mailbox_connections.settings || EXCLUDED.settings,
       context_sync_enabled = EXCLUDED.context_sync_enabled,
       send_enabled = EXCLUDED.send_enabled,
       provider_draft_enabled = EXCLUDED.provider_draft_enabled,
       send_status = EXCLUDED.send_status,
       send_last_error = EXCLUDED.send_last_error,
       is_default_sender = EXCLUDED.is_default_sender,
       updated_at = now()
     RETURNING *`,
    [
      tenantId,
      data.user_id ?? null,
      data.provider,
      data.email_address,
      data.display_name ?? null,
      data.status ?? 'configuration_required',
      data.last_error ?? null,
      JSON.stringify(data.settings ?? {}),
      data.context_sync_enabled ?? true,
      data.send_enabled ?? false,
      data.provider_draft_enabled ?? false,
      data.send_status ?? (data.send_enabled ? 'ready' : 'not_authorized'),
      data.send_last_error ?? null,
      data.is_default_sender ?? false,
    ],
  );
  return result.rows[0] as MailboxConnection;
}

export async function updateMailboxConnection(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Partial<Pick<MailboxConnection,
    'status' | 'scopes' | 'sync_cursor' | 'provider_account_id' | 'access_token_enc' |
    'refresh_token_enc' | 'token_expires_at' | 'sync_stats' | 'settings' |
    'last_sync_at' | 'last_error' | 'display_name' | 'email_address' |
    'context_sync_enabled' | 'send_enabled' | 'provider_draft_enabled' |
    'send_status' | 'send_last_error' | 'is_default_sender'
  >>,
): Promise<MailboxConnection | null> {
  const sets = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;
  const scalarFields = [
    'status',
    'sync_cursor',
    'provider_account_id',
    'access_token_enc',
    'refresh_token_enc',
    'token_expires_at',
    'last_sync_at',
    'last_error',
    'display_name',
    'email_address',
    'context_sync_enabled',
    'send_enabled',
    'provider_draft_enabled',
    'send_status',
    'send_last_error',
    'is_default_sender',
  ] as const;
  for (const field of scalarFields) {
    if (field in patch) {
      sets.push(`${field} = $${idx++}`);
      params.push(patch[field] ?? null);
    }
  }
  if (patch.scopes !== undefined) {
    sets.push(`scopes = $${idx++}`);
    params.push(patch.scopes);
  }
  if (patch.settings !== undefined) {
    sets.push(`settings = settings || $${idx++}::jsonb`);
    params.push(JSON.stringify(patch.settings));
  }
  if (patch.sync_stats !== undefined) {
    sets.push(`sync_stats = sync_stats || $${idx++}::jsonb`);
    params.push(JSON.stringify(patch.sync_stats));
  }
  const result = await db.query(
    `UPDATE mailbox_connections SET ${sets.join(', ')}
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    params,
  );
  return (result.rows[0] as MailboxConnection | undefined) ?? null;
}

export async function deleteMailboxConnection(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM mailbox_connections WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function enqueueMailboxSyncJob(
  db: DbPool,
  tenantId: UUID,
  connectionId: UUID,
  metadata: Record<string, unknown> = {},
): Promise<{ id: UUID; status: string }> {
  const result = await db.query(
    `INSERT INTO mailbox_sync_jobs (tenant_id, connection_id, metadata)
     VALUES ($1,$2,$3::jsonb)
     RETURNING id, status`,
    [tenantId, connectionId, JSON.stringify(metadata)],
  );
  return result.rows[0] as { id: UUID; status: string };
}

export async function claimMailboxSyncJobs(db: DbPool, limit = 10): Promise<Array<{ id: UUID; tenant_id: UUID; connection_id: UUID }>> {
  const result = await db.query(
    `WITH ready AS (
       SELECT id
       FROM mailbox_sync_jobs
       WHERE status IN ('pending', 'failed') AND run_after <= now()
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE mailbox_sync_jobs j
     SET status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now()
     FROM ready
     WHERE j.id = ready.id
     RETURNING j.id, j.tenant_id, j.connection_id`,
    [limit],
  );
  return result.rows as Array<{ id: UUID; tenant_id: UUID; connection_id: UUID }>;
}

export async function completeMailboxSyncJob(db: DbPool, id: UUID): Promise<void> {
  await db.query(
    `UPDATE mailbox_sync_jobs
     SET status = 'complete', locked_at = NULL, last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function failMailboxSyncJob(db: DbPool, id: UUID, error: string): Promise<void> {
  await db.query(
    `UPDATE mailbox_sync_jobs
     SET status = 'failed',
         locked_at = NULL,
         last_error = $2,
         run_after = now() + make_interval(mins => LEAST(60, GREATEST(1, attempts * 5))),
         updated_at = now()
     WHERE id = $1`,
    [id, error.slice(0, 500)],
  );
}

export async function upsertEmailMessage(
  db: DbPool,
  tenantId: UUID,
  input: EmailMessageInput,
): Promise<EmailMessage> {
  const result = await db.query(
    `INSERT INTO email_messages (
       tenant_id, mailbox_connection_id, user_id, direction, source,
       provider_message_id, message_id, thread_id, in_reply_to, references_header,
       from_email, from_name, to_emails, cc_emails, subject, body_text, body_html,
       snippet, classification, processing_status, processing_reason, contact_id,
       account_id, opportunity_id, use_case_id, activity_id, raw_context_source_id,
       email_id, reply_to_email_message_id, conversation_root_email_message_id,
       extraction_receipt, metadata, received_at, sent_at
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31::jsonb,$32::jsonb,$33,$34
     )
     ON CONFLICT (tenant_id, mailbox_connection_id, provider_message_id)
       WHERE provider_message_id IS NOT NULL
     DO UPDATE SET
       thread_id = COALESCE(EXCLUDED.thread_id, email_messages.thread_id),
       in_reply_to = COALESCE(EXCLUDED.in_reply_to, email_messages.in_reply_to),
       references_header = CASE WHEN cardinality(EXCLUDED.references_header) > 0 THEN EXCLUDED.references_header ELSE email_messages.references_header END,
       from_email = EXCLUDED.from_email,
       from_name = COALESCE(EXCLUDED.from_name, email_messages.from_name),
       to_emails = EXCLUDED.to_emails,
       cc_emails = EXCLUDED.cc_emails,
       subject = EXCLUDED.subject,
       body_text = COALESCE(EXCLUDED.body_text, email_messages.body_text),
       body_html = COALESCE(EXCLUDED.body_html, email_messages.body_html),
       snippet = COALESCE(EXCLUDED.snippet, email_messages.snippet),
       classification = CASE
         WHEN email_messages.processing_status IN ('processed', 'ignored', 'skipped') THEN email_messages.classification
         ELSE EXCLUDED.classification
       END,
       processing_status = CASE
         WHEN email_messages.processing_status IN ('processed', 'ignored', 'skipped') THEN email_messages.processing_status
         ELSE EXCLUDED.processing_status
       END,
       processing_reason = CASE
         WHEN email_messages.processing_status IN ('processed', 'ignored', 'skipped') THEN email_messages.processing_reason
         ELSE EXCLUDED.processing_reason
       END,
       contact_id = COALESCE(EXCLUDED.contact_id, email_messages.contact_id),
       account_id = COALESCE(EXCLUDED.account_id, email_messages.account_id),
       opportunity_id = COALESCE(EXCLUDED.opportunity_id, email_messages.opportunity_id),
       use_case_id = COALESCE(EXCLUDED.use_case_id, email_messages.use_case_id),
       activity_id = COALESCE(EXCLUDED.activity_id, email_messages.activity_id),
       raw_context_source_id = COALESCE(EXCLUDED.raw_context_source_id, email_messages.raw_context_source_id),
       email_id = COALESCE(EXCLUDED.email_id, email_messages.email_id),
       reply_to_email_message_id = COALESCE(EXCLUDED.reply_to_email_message_id, email_messages.reply_to_email_message_id),
       conversation_root_email_message_id = COALESCE(EXCLUDED.conversation_root_email_message_id, email_messages.conversation_root_email_message_id),
       extraction_receipt = email_messages.extraction_receipt || EXCLUDED.extraction_receipt,
       metadata = email_messages.metadata || EXCLUDED.metadata,
       received_at = COALESCE(EXCLUDED.received_at, email_messages.received_at),
       sent_at = COALESCE(EXCLUDED.sent_at, email_messages.sent_at),
       updated_at = now()
     RETURNING *`,
    [
      tenantId,
      input.mailbox_connection_id ?? null,
      input.user_id ?? null,
      input.direction,
      input.source ?? 'manual',
      input.provider_message_id ?? null,
      input.message_id ?? null,
      input.thread_id ?? null,
      input.in_reply_to ?? null,
      input.references_header ?? [],
      input.from_email.toLowerCase(),
      input.from_name ?? null,
      input.to_emails ?? [],
      input.cc_emails ?? [],
      input.subject ?? '(no subject)',
      input.body_text ?? null,
      input.body_html ?? null,
      input.snippet ?? input.body_text?.slice(0, 240) ?? null,
      input.classification ?? 'unknown',
      input.processing_status ?? 'unprocessed',
      input.processing_reason ?? null,
      input.contact_id ?? null,
      input.account_id ?? null,
      input.opportunity_id ?? null,
      input.use_case_id ?? null,
      input.activity_id ?? null,
      input.raw_context_source_id ?? null,
      input.email_id ?? null,
      input.reply_to_email_message_id ?? null,
      input.conversation_root_email_message_id ?? null,
      JSON.stringify(input.extraction_receipt ?? {}),
      JSON.stringify(input.metadata ?? {}),
      input.received_at ?? null,
      input.sent_at ?? null,
    ],
  );
  return result.rows[0] as EmailMessage;
}

export async function listSendEnabledMailboxConnections(
  db: DbPool,
  tenantId: UUID,
  userId: UUID,
): Promise<MailboxConnection[]> {
  const result = await db.query(
    `SELECT * FROM mailbox_connections
     WHERE tenant_id = $1
       AND user_id = $2
       AND send_enabled = true
       AND send_status = 'ready'
       AND status = 'connected'
     ORDER BY is_default_sender DESC, created_at DESC`,
    [tenantId, userId],
  );
  return result.rows as MailboxConnection[];
}

export async function findReplyLink(
  db: DbPool,
  tenantId: UUID,
  input: {
    mailbox_connection_id?: UUID | null;
    thread_id?: string | null;
    in_reply_to?: string | null;
    references_header?: string[];
  },
): Promise<EmailMessage | null> {
  const headerRefs = [input.in_reply_to, ...(input.references_header ?? [])].filter(Boolean) as string[];
  if (input.thread_id) {
    const threadResult = await db.query(
      `SELECT * FROM email_messages
       WHERE tenant_id = $1
         AND direction = 'outbound'
         AND email_id IS NOT NULL
         AND thread_id = $2
         AND ($3::uuid IS NULL OR mailbox_connection_id = $3)
       ORDER BY COALESCE(sent_at, created_at) DESC
       LIMIT 1`,
      [tenantId, input.thread_id, input.mailbox_connection_id ?? null],
    );
    if (threadResult.rows[0]) return rowToMessage(threadResult.rows[0]);
  }
  if (headerRefs.length > 0) {
    const headerResult = await db.query(
      `SELECT em.*
       FROM email_messages em
       LEFT JOIN emails e ON e.id = em.email_id AND e.tenant_id = em.tenant_id
       WHERE em.tenant_id = $1
         AND em.direction = 'outbound'
         AND em.email_id IS NOT NULL
         AND (
           em.message_id = ANY($2::text[])
           OR em.provider_message_id = ANY($2::text[])
           OR e.provider_msg_id = ANY($2::text[])
         )
       ORDER BY COALESCE(em.sent_at, em.created_at) DESC
       LIMIT 1`,
      [tenantId, headerRefs],
    );
    if (headerResult.rows[0]) return rowToMessage(headerResult.rows[0]);
  }
  return null;
}

export async function getEmailMessage(db: DbPool, tenantId: UUID, id: UUID): Promise<EmailMessage | null> {
  const result = await db.query(
    `SELECT em.*,
       NULLIF(trim(concat_ws(' ', c.first_name, c.last_name)), '') AS contact_name,
       a.name AS account_name,
       o.name AS opportunity_name,
       u.name AS use_case_name,
	       e.status AS email_status,
	       e.draft_origin,
	       e.hitl_request_id,
	       e.provider_draft_status,
	       mb.email_address AS mailbox_email_address,
	       mb.display_name AS mailbox_display_name
	     FROM email_messages em
	     LEFT JOIN contacts c ON c.id = em.contact_id AND c.tenant_id = em.tenant_id
	     LEFT JOIN accounts a ON a.id = em.account_id AND a.tenant_id = em.tenant_id
	     LEFT JOIN opportunities o ON o.id = em.opportunity_id AND o.tenant_id = em.tenant_id
	     LEFT JOIN use_cases u ON u.id = em.use_case_id AND u.tenant_id = em.tenant_id
	     LEFT JOIN emails e ON e.id = em.email_id AND e.tenant_id = em.tenant_id
	     LEFT JOIN mailbox_connections mb ON mb.id = em.mailbox_connection_id AND mb.tenant_id = em.tenant_id
	     WHERE em.tenant_id = $1 AND em.id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? rowToMessage(result.rows[0]) : null;
}

export async function listEmailMessages(
  db: DbPool,
  tenantId: UUID,
  filters: EmailMessageFilters,
): Promise<PaginatedResponse<EmailMessage>> {
  const conditions = ['em.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.direction) {
    conditions.push(`em.direction = $${idx++}`);
    params.push(filters.direction);
  }
  if (filters.classification) {
    conditions.push(`em.classification = $${idx++}`);
    params.push(filters.classification);
  } else if (filters.classifications?.length) {
    conditions.push(`em.classification = ANY($${idx++}::text[])`);
    params.push(filters.classifications);
  } else if (!filters.include_internal) {
    conditions.push(`em.classification NOT IN ('internal','automated')`);
  }
  if (filters.processing_status) {
    conditions.push(`em.processing_status = $${idx++}`);
    params.push(filters.processing_status);
  } else if (filters.processing_statuses?.length) {
    conditions.push(`em.processing_status = ANY($${idx++}::text[])`);
    params.push(filters.processing_statuses);
  }
  if (filters.contact_id) {
    conditions.push(`em.contact_id = $${idx++}`);
    params.push(filters.contact_id);
  }
  if (filters.account_id) {
    conditions.push(`(em.account_id = $${idx} OR c.account_id = $${idx})`);
    params.push(filters.account_id);
    idx++;
  }
  if (filters.opportunity_id) {
    conditions.push(`em.opportunity_id = $${idx++}`);
    params.push(filters.opportunity_id);
  }
  if (filters.use_case_id) {
    conditions.push(`em.use_case_id = $${idx++}`);
    params.push(filters.use_case_id);
  }
  if (filters.q) {
    conditions.push(`(
      em.subject ILIKE $${idx}
      OR em.body_text ILIKE $${idx}
      OR em.from_email ILIKE $${idx}
      OR EXISTS (SELECT 1 FROM unnest(em.to_emails) e WHERE e ILIKE $${idx})
      OR a.name ILIKE $${idx}
      OR o.name ILIKE $${idx}
      OR u.name ILIKE $${idx}
      OR c.email ILIKE $${idx}
    )`);
    params.push(`%${filters.q}%`);
    idx++;
  }
  if (filters.owner_ids) {
    if (filters.owner_ids.length === 0) {
      conditions.push('FALSE');
    } else {
      conditions.push(`(
        c.owner_id = ANY($${idx}::uuid[])
        OR a.owner_id = ANY($${idx}::uuid[])
        OR o.owner_id = ANY($${idx}::uuid[])
        OR u.owner_id = ANY($${idx}::uuid[])
        OR em.user_id = ANY($${idx}::uuid[])
      )`);
      params.push(filters.owner_ids);
      idx++;
    }
  }
  if (filters.cursor) {
    conditions.push(`COALESCE(em.received_at, em.sent_at, em.created_at) < $${idx++}`);
    params.push(filters.cursor);
  }

	  const from = `FROM email_messages em
	    LEFT JOIN contacts c ON c.id = em.contact_id AND c.tenant_id = em.tenant_id
	    LEFT JOIN accounts a ON a.id = em.account_id AND a.tenant_id = em.tenant_id
	    LEFT JOIN opportunities o ON o.id = em.opportunity_id AND o.tenant_id = em.tenant_id
	    LEFT JOIN use_cases u ON u.id = em.use_case_id AND u.tenant_id = em.tenant_id
	    LEFT JOIN emails e ON e.id = em.email_id AND e.tenant_id = em.tenant_id
	    LEFT JOIN mailbox_connections mb ON mb.id = em.mailbox_connection_id AND mb.tenant_id = em.tenant_id`;
  const where = conditions.join(' AND ');
  const countResult = await db.query(`SELECT count(*)::int AS total ${from} WHERE ${where}`, params);

  params.push(filters.limit + 1);
  const result = await db.query(
    `SELECT em.*,
       NULLIF(trim(concat_ws(' ', c.first_name, c.last_name)), '') AS contact_name,
       a.name AS account_name,
       o.name AS opportunity_name,
       u.name AS use_case_name,
	       e.status AS email_status,
	       e.draft_origin,
	       e.hitl_request_id,
	       e.provider_draft_status,
	       mb.email_address AS mailbox_email_address,
	       mb.display_name AS mailbox_display_name
     ${from}
     WHERE ${where}
     ORDER BY COALESCE(em.received_at, em.sent_at, em.created_at) DESC
     LIMIT $${idx}`,
    params,
  );
  const rows = result.rows.map(rowToMessage);
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;
  return {
    data,
    total: Number(countResult.rows[0]?.total ?? 0),
    next_cursor: hasMore ? (data[data.length - 1].received_at ?? data[data.length - 1].sent_at ?? data[data.length - 1].created_at) : undefined,
  };
}

export async function summarizeEmailMessagesBySubject(
  db: DbPool,
  tenantId: UUID,
  subjectType: 'contact' | 'account',
  subjectIds: UUID[],
  ownerIds?: UUID[],
): Promise<EmailSubjectSummary[]> {
  const uniqueIds = Array.from(new Set(subjectIds.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const params: unknown[] = [tenantId, uniqueIds];
  let ownerClause = '';
  if (ownerIds) {
    if (ownerIds.length === 0) {
      ownerClause = ' AND FALSE';
    } else {
      params.push(ownerIds);
      ownerClause = ` AND (
        c.owner_id = ANY($${params.length}::uuid[])
        OR a.owner_id = ANY($${params.length}::uuid[])
        OR ca.owner_id = ANY($${params.length}::uuid[])
        OR o.owner_id = ANY($${params.length}::uuid[])
        OR u.owner_id = ANY($${params.length}::uuid[])
        OR em.user_id = ANY($${params.length}::uuid[])
      )`;
    }
  }

  const subjectExpr = subjectType === 'contact' ? 'em.contact_id' : 'COALESCE(em.account_id, c.account_id)';
  const result = await db.query(
    `SELECT
       ${subjectExpr} AS subject_id,
       count(*)::int AS total,
       count(*) FILTER (WHERE em.direction = 'inbound')::int AS inbound,
       count(*) FILTER (WHERE em.direction = 'outbound')::int AS outbound,
       count(*) FILTER (WHERE e.status = 'draft')::int AS drafts,
       count(*) FILTER (WHERE e.status = 'pending_approval')::int AS pending_approvals,
       count(*) FILTER (
         WHERE em.direction = 'inbound'
           AND (
             em.processing_status IN ('needs_review','failed','unprocessed')
             OR em.classification = 'unknown'
           )
       )::int AS inbound_needs_review,
       count(*) FILTER (WHERE em.direction = 'outbound' AND e.status = 'draft')::int AS outbound_drafts,
       count(*) FILTER (WHERE em.direction = 'outbound' AND e.status = 'pending_approval')::int AS outbound_pending_approvals,
       count(*) FILTER (WHERE em.direction = 'outbound' AND e.status = 'failed')::int AS outbound_failed,
       count(*) FILTER (WHERE em.direction = 'outbound' AND e.status = 'rejected')::int AS outbound_rejected,
       max(COALESCE(em.received_at, em.sent_at, em.created_at)) AS latest_at
     FROM email_messages em
     LEFT JOIN contacts c ON c.id = em.contact_id AND c.tenant_id = em.tenant_id
     LEFT JOIN accounts a ON a.id = em.account_id AND a.tenant_id = em.tenant_id
     LEFT JOIN accounts ca ON ca.id = c.account_id AND ca.tenant_id = em.tenant_id
     LEFT JOIN opportunities o ON o.id = em.opportunity_id AND o.tenant_id = em.tenant_id
     LEFT JOIN use_cases u ON u.id = em.use_case_id AND u.tenant_id = em.tenant_id
     LEFT JOIN emails e ON e.id = em.email_id AND e.tenant_id = em.tenant_id
     WHERE em.tenant_id = $1
       AND ${subjectExpr} = ANY($2::uuid[])
       AND em.classification NOT IN ('internal','automated')
       AND em.ignored_at IS NULL
       ${ownerClause}
     GROUP BY ${subjectExpr}`,
    params,
  );

  return result.rows.map(row => ({
    subject_id: row.subject_id as UUID,
    total: Number(row.total ?? 0),
    inbound: Number(row.inbound ?? 0),
    outbound: Number(row.outbound ?? 0),
    drafts: Number(row.drafts ?? 0),
    pending_approvals: Number(row.pending_approvals ?? 0),
    needs_review: Number(row.inbound_needs_review ?? 0),
    inbound_needs_review: Number(row.inbound_needs_review ?? 0),
    outbound_drafts: Number(row.outbound_drafts ?? 0),
    outbound_pending_approvals: Number(row.outbound_pending_approvals ?? 0),
    outbound_failed: Number(row.outbound_failed ?? 0),
    outbound_rejected: Number(row.outbound_rejected ?? 0),
    latest_at: (row.latest_at as string | null | undefined) ?? null,
  }));
}

export async function updateEmailMessage(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: {
    classification?: EmailClassification;
    processing_status?: EmailProcessingStatus;
    processing_reason?: string | null;
    contact_id?: UUID | null;
    account_id?: UUID | null;
    opportunity_id?: UUID | null;
    use_case_id?: UUID | null;
    activity_id?: UUID | null;
    raw_context_source_id?: UUID | null;
    extraction_receipt?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    ignored_at?: string | null;
  },
): Promise<EmailMessage | null> {
  const sets = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;
  const scalarFields = [
    'classification',
    'processing_status',
    'processing_reason',
    'contact_id',
    'account_id',
    'opportunity_id',
    'use_case_id',
    'activity_id',
    'raw_context_source_id',
    'ignored_at',
  ] as const;
  for (const field of scalarFields) {
    if (field in patch) {
      sets.push(`${field} = $${idx++}`);
      params.push(patch[field] ?? null);
    }
  }
  if (patch.extraction_receipt !== undefined) {
    sets.push(`extraction_receipt = extraction_receipt || $${idx++}::jsonb`);
    params.push(JSON.stringify(patch.extraction_receipt));
  }
  if (patch.metadata !== undefined) {
    sets.push(`metadata = metadata || $${idx++}::jsonb`);
    params.push(JSON.stringify(patch.metadata));
  }
  const result = await db.query(
    `UPDATE email_messages SET ${sets.join(', ')}
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    params,
  );
	  return result.rows[0] ? getEmailMessage(db, tenantId, id) : null;
	}

export async function markOutboundEmailMessageDelivered(
  db: DbPool,
  tenantId: UUID,
  emailId: UUID,
  delivery: {
    provider_message_id?: string | null;
    message_id?: string | null;
    thread_id?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<EmailMessage | null> {
  const result = await db.query(
    `UPDATE email_messages
     SET provider_message_id = COALESCE($3, provider_message_id),
         message_id = COALESCE($4, message_id),
         thread_id = COALESCE($5, thread_id),
         sent_at = COALESCE(sent_at, now()),
         processing_status = CASE
           WHEN processing_status IN ('processed', 'ignored') THEN processing_status
           ELSE 'unprocessed'
         END,
         processing_reason = CASE
           WHEN processing_status IN ('processed', 'ignored') THEN processing_reason
           ELSE 'Outbound email delivered; account activity and CRMy-authored context processing is pending.'
         END,
         metadata = metadata || $6::jsonb,
         updated_at = now()
     WHERE tenant_id = $1
       AND email_id = $2
       AND direction = 'outbound'
     RETURNING *`,
    [
      tenantId,
      emailId,
      delivery.provider_message_id ?? null,
      delivery.message_id ?? null,
      delivery.thread_id ?? null,
      JSON.stringify(delivery.metadata ?? {}),
    ],
  );
  return result.rows[0] ? rowToMessage(result.rows[0]) : null;
}

export async function claimDeliveredOutboundEmailMessagesForProcessing(
  db: DbPool,
  limit = 10,
): Promise<EmailMessage[]> {
  const result = await db.query(
    `WITH target AS (
       SELECT em.id
       FROM email_messages em
       LEFT JOIN emails e ON e.id = em.email_id AND e.tenant_id = em.tenant_id
       WHERE em.direction = 'outbound'
         AND em.classification IN ('customer', 'mixed')
         AND em.processing_status = 'unprocessed'
         AND em.ignored_at IS NULL
         AND (em.sent_at IS NOT NULL OR e.status = 'sent')
       ORDER BY COALESCE(em.sent_at, em.created_at) ASC
       LIMIT $1
       FOR UPDATE OF em SKIP LOCKED
     )
     UPDATE email_messages em
     SET processing_status = 'processing',
         processing_reason = 'Processing delivered outbound email as account activity and CRMy-authored context.',
         updated_at = now()
     FROM target
     WHERE em.id = target.id
     RETURNING em.*`,
    [limit],
  );
  return result.rows.map(rowToMessage);
}

export async function summarizeEmailMessages(
  db: DbPool,
  tenantId: UUID,
  ownerIds?: UUID[],
): Promise<{
  total: number;
  customer: number;
  needs_review: number;
  processed: number;
  internal: number;
  inbound_customer: number;
  inbound_needs_review: number;
  inbound_processed: number;
}> {
  const params: unknown[] = [tenantId];
  let ownerClause = '';
  if (ownerIds) {
    if (ownerIds.length === 0) {
      ownerClause = ' AND FALSE';
    } else {
      params.push(ownerIds);
      ownerClause = ` AND (
        c.owner_id = ANY($${params.length}::uuid[])
        OR a.owner_id = ANY($${params.length}::uuid[])
        OR o.owner_id = ANY($${params.length}::uuid[])
        OR u.owner_id = ANY($${params.length}::uuid[])
        OR em.user_id = ANY($${params.length}::uuid[])
      )`;
    }
  }
  const result = await db.query(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE classification IN ('customer','mixed'))::int AS customer,
       count(*) FILTER (WHERE processing_status IN ('needs_review','failed','unprocessed') OR classification = 'unknown')::int AS needs_review,
       count(*) FILTER (WHERE processing_status = 'processed')::int AS processed,
       count(*) FILTER (WHERE classification IN ('internal','automated'))::int AS internal,
       count(*) FILTER (
         WHERE direction = 'inbound'
           AND ignored_at IS NULL
           AND classification IN ('customer','mixed')
       )::int AS inbound_customer,
       count(*) FILTER (
         WHERE direction = 'inbound'
           AND ignored_at IS NULL
           AND (
             processing_status IN ('needs_review','failed','unprocessed')
             OR classification = 'unknown'
           )
       )::int AS inbound_needs_review,
       count(*) FILTER (
         WHERE direction = 'inbound'
           AND ignored_at IS NULL
           AND processing_status = 'processed'
       )::int AS inbound_processed
     FROM email_messages em
     LEFT JOIN contacts c ON c.id = em.contact_id AND c.tenant_id = em.tenant_id
     LEFT JOIN accounts a ON a.id = em.account_id AND a.tenant_id = em.tenant_id
     LEFT JOIN opportunities o ON o.id = em.opportunity_id AND o.tenant_id = em.tenant_id
     LEFT JOIN use_cases u ON u.id = em.use_case_id AND u.tenant_id = em.tenant_id
     WHERE em.tenant_id = $1${ownerClause}`,
    params,
  );
  return {
    total: Number(result.rows[0]?.total ?? 0),
    customer: Number(result.rows[0]?.customer ?? 0),
    needs_review: Number(result.rows[0]?.needs_review ?? 0),
    processed: Number(result.rows[0]?.processed ?? 0),
    internal: Number(result.rows[0]?.internal ?? 0),
    inbound_customer: Number(result.rows[0]?.inbound_customer ?? 0),
    inbound_needs_review: Number(result.rows[0]?.inbound_needs_review ?? 0),
    inbound_processed: Number(result.rows[0]?.inbound_processed ?? 0),
  };
}

export function emailDomain(email: string | undefined | null): string | null {
  const domain = email?.split('@')[1];
  return domain ? normalizeDomain(domain) : null;
}
