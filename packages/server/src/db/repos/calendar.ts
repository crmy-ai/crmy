// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { PaginatedResponse, UUID } from '@crmy/shared';
import { addStableDescCursorCondition, encodeStableCursor, exactListTotalsEnabled, pageTotal } from './pagination.js';

export type CalendarProvider = 'google' | 'microsoft';
export type CalendarConnectionStatus = 'configuration_required' | 'connected' | 'syncing' | 'error' | 'disconnected';
export type CalendarEventStatus = 'scheduled' | 'held' | 'cancelled' | 'ignored';
export type MeetingValidationStatus = 'ready' | 'missing_context' | 'needs_record_link' | 'needs_review' | 'skipped_internal' | 'failed';
export type MeetingProcessingStatus = 'unprocessed' | 'processing' | 'processed' | 'needs_review' | 'skipped' | 'failed' | 'ignored';
export type MeetingArtifactType = 'transcript' | 'notes' | 'summary' | 'recording' | 'other';

export interface MeetingClassification {
  id: UUID;
  tenant_id: UUID;
  type_name: string;
  label: string;
  description?: string | null;
  mapped_activity_type: string;
  matching_hints: string[];
  is_customer_facing: boolean;
  required_record_types: string[];
  required_artifact_types: MeetingArtifactType[];
  auto_process_raw_context: boolean;
  is_default: boolean;
  is_enabled: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface CalendarConnection {
  id: UUID;
  tenant_id: UUID;
  user_id?: UUID | null;
  provider: CalendarProvider;
  email_address: string;
  display_name?: string | null;
  status: CalendarConnectionStatus;
  scopes: string[];
  sync_cursor?: string | null;
  provider_account_id?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  token_expires_at?: string | null;
  sync_stats?: Record<string, unknown>;
  settings: Record<string, unknown>;
  last_sync_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: UUID;
  tenant_id: UUID;
  calendar_connection_id?: UUID | null;
  user_id?: UUID | null;
  provider: string;
  provider_event_id?: string | null;
  i_cal_uid?: string | null;
  title: string;
  description?: string | null;
  organizer_email?: string | null;
  organizer_name?: string | null;
  attendee_emails: string[];
  attendee_names: string[];
  meeting_url?: string | null;
  location?: string | null;
  starts_at: string;
  ends_at?: string | null;
  status: CalendarEventStatus;
  classification: string;
  classification_confidence: number;
  classification_reason?: string | null;
  validation_status: MeetingValidationStatus;
  validation_blockers: string[];
  processing_status: MeetingProcessingStatus;
  processing_reason?: string | null;
  contact_id?: UUID | null;
  account_id?: UUID | null;
  opportunity_id?: UUID | null;
  use_case_id?: UUID | null;
  activity_id?: UUID | null;
  raw_context_source_id?: UUID | null;
  extraction_receipt: Record<string, unknown>;
  metadata: Record<string, unknown>;
  ignored_at?: string | null;
  created_at: string;
  updated_at: string;
  contact_name?: string | null;
  account_name?: string | null;
  opportunity_name?: string | null;
  use_case_name?: string | null;
  artifact_count?: number;
  transcript_count?: number;
  notes_count?: number;
}

export interface MeetingArtifact {
  id: UUID;
  tenant_id: UUID;
  calendar_event_id?: UUID | null;
  activity_id?: UUID | null;
  email_message_id?: UUID | null;
  raw_context_source_id?: UUID | null;
  artifact_type: MeetingArtifactType;
  source: string;
  source_label?: string | null;
  text_content?: string | null;
  text_excerpt?: string | null;
  processing_status: MeetingProcessingStatus;
  processing_reason?: string | null;
  extraction_receipt: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by?: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventFilters {
  q?: string;
  tab?: 'meetings' | 'needs_context' | 'calls_notes' | 'all';
  classification?: string;
  validation_status?: MeetingValidationStatus;
  processing_status?: MeetingProcessingStatus;
  contact_id?: UUID;
  account_id?: UUID;
  opportunity_id?: UUID;
  use_case_id?: UUID;
  owner_ids?: UUID[];
  include_internal?: boolean;
  limit: number;
  cursor?: string;
}

function rowToCalendarEvent(row: Record<string, unknown>): CalendarEvent {
  return row as unknown as CalendarEvent;
}

export async function listMeetingClassifications(db: DbPool, tenantId: UUID, includeDisabled = false): Promise<MeetingClassification[]> {
  const result = await db.query(
    `SELECT * FROM meeting_classification_registry
     WHERE tenant_id = $1 ${includeDisabled ? '' : 'AND is_enabled = TRUE'}
     ORDER BY display_order ASC, label ASC`,
    [tenantId],
  );
  return result.rows as MeetingClassification[];
}

export async function upsertMeetingClassification(
  db: DbPool,
  tenantId: UUID,
  data: Partial<MeetingClassification> & { type_name: string; label: string },
): Promise<MeetingClassification> {
  const result = await db.query(
    `INSERT INTO meeting_classification_registry (
       tenant_id, type_name, label, description, mapped_activity_type, matching_hints,
       is_customer_facing, required_record_types, required_artifact_types,
       auto_process_raw_context, is_enabled, display_order
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (tenant_id, type_name)
     DO UPDATE SET
       label = EXCLUDED.label,
       description = EXCLUDED.description,
       mapped_activity_type = EXCLUDED.mapped_activity_type,
       matching_hints = EXCLUDED.matching_hints,
       is_customer_facing = EXCLUDED.is_customer_facing,
       required_record_types = EXCLUDED.required_record_types,
       required_artifact_types = EXCLUDED.required_artifact_types,
       auto_process_raw_context = EXCLUDED.auto_process_raw_context,
       is_enabled = EXCLUDED.is_enabled,
       display_order = EXCLUDED.display_order,
       updated_at = now()
     RETURNING *`,
    [
      tenantId,
      data.type_name,
      data.label,
      data.description ?? null,
      data.mapped_activity_type ?? 'meeting_held',
      data.matching_hints ?? [],
      data.is_customer_facing ?? true,
      data.required_record_types ?? ['account'],
      data.required_artifact_types ?? ['notes'],
      data.auto_process_raw_context ?? true,
      data.is_enabled ?? true,
      data.display_order ?? 100,
    ],
  );
  return result.rows[0] as MeetingClassification;
}

export async function deleteMeetingClassification(db: DbPool, tenantId: UUID, typeName: string): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM meeting_classification_registry
     WHERE tenant_id = $1 AND type_name = $2 AND is_default = FALSE`,
    [tenantId, typeName],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listCalendarConnections(
  db: DbPool,
  tenantId: UUID,
  userId?: UUID | null,
): Promise<CalendarConnection[]> {
  const params: unknown[] = [tenantId];
  const conditions = ['tenant_id = $1'];
  if (userId) {
    params.push(userId);
    conditions.push(`(user_id = $${params.length} OR user_id IS NULL)`);
  }
  const result = await db.query(
    `SELECT * FROM calendar_connections
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    params,
  );
  return result.rows as CalendarConnection[];
}

export async function getCalendarConnection(db: DbPool, tenantId: UUID, id: UUID): Promise<CalendarConnection | null> {
  const result = await db.query(
    'SELECT * FROM calendar_connections WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  return (result.rows[0] as CalendarConnection | undefined) ?? null;
}

export async function createPlaceholderCalendarConnection(
  db: DbPool,
  tenantId: UUID,
  data: {
    user_id?: UUID | null;
    provider: CalendarProvider;
    email_address: string;
    display_name?: string | null;
    status?: CalendarConnectionStatus;
    last_error?: string | null;
    settings?: Record<string, unknown>;
  },
): Promise<CalendarConnection> {
  const result = await db.query(
    `INSERT INTO calendar_connections (
       tenant_id, user_id, provider, email_address, display_name, status, last_error, settings
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (tenant_id, user_id, provider, email_address)
     DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, calendar_connections.display_name),
       status = EXCLUDED.status,
       last_error = EXCLUDED.last_error,
       settings = calendar_connections.settings || EXCLUDED.settings,
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
    ],
  );
  return result.rows[0] as CalendarConnection;
}

export async function updateCalendarConnection(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Partial<Pick<CalendarConnection,
    'status' | 'scopes' | 'sync_cursor' | 'provider_account_id' | 'access_token_enc' |
    'refresh_token_enc' | 'token_expires_at' | 'sync_stats' | 'settings' |
    'last_sync_at' | 'last_error' | 'display_name' | 'email_address'
  >>,
): Promise<CalendarConnection | null> {
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
    `UPDATE calendar_connections SET ${sets.join(', ')}
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    params,
  );
  return (result.rows[0] as CalendarConnection | undefined) ?? null;
}

export async function deleteCalendarConnection(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM calendar_connections WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function enqueueCalendarSyncJob(
  db: DbPool,
  tenantId: UUID,
  connectionId: UUID,
  metadata: Record<string, unknown> = {},
): Promise<{ id: UUID; status: string }> {
  const result = await db.query(
    `INSERT INTO calendar_sync_jobs (tenant_id, connection_id, metadata)
     VALUES ($1,$2,$3::jsonb)
     RETURNING id, status`,
    [tenantId, connectionId, JSON.stringify(metadata)],
  );
  return result.rows[0] as { id: UUID; status: string };
}

export async function claimCalendarSyncJobs(db: DbPool, limit = 10): Promise<Array<{ id: UUID; tenant_id: UUID; connection_id: UUID }>> {
  const result = await db.query(
    `WITH ready AS (
       SELECT id
       FROM calendar_sync_jobs
       WHERE status IN ('pending', 'failed') AND run_after <= now()
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE calendar_sync_jobs j
     SET status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now()
     FROM ready
     WHERE j.id = ready.id
     RETURNING j.id, j.tenant_id, j.connection_id`,
    [limit],
  );
  return result.rows as Array<{ id: UUID; tenant_id: UUID; connection_id: UUID }>;
}

export async function completeCalendarSyncJob(db: DbPool, id: UUID): Promise<void> {
  await db.query(
    `UPDATE calendar_sync_jobs
     SET status = 'complete', locked_at = NULL, last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function failCalendarSyncJob(db: DbPool, id: UUID, error: string): Promise<void> {
  await db.query(
    `UPDATE calendar_sync_jobs
     SET status = 'failed',
         locked_at = NULL,
         last_error = $2,
         run_after = now() + make_interval(mins => LEAST(60, GREATEST(1, attempts * 5))),
         updated_at = now()
     WHERE id = $1`,
    [id, error.slice(0, 500)],
  );
}

export async function upsertCalendarEvent(
  db: DbPool,
  tenantId: UUID,
  input: Partial<CalendarEvent> & { title: string; starts_at: string },
): Promise<CalendarEvent> {
  const result = await db.query(
    `INSERT INTO calendar_events (
       tenant_id, calendar_connection_id, user_id, provider, provider_event_id, i_cal_uid,
       title, description, organizer_email, organizer_name, attendee_emails, attendee_names,
       meeting_url, location, starts_at, ends_at, status, classification,
       classification_confidence, classification_reason, validation_status, validation_blockers,
       processing_status, processing_reason, contact_id, account_id, opportunity_id, use_case_id,
       activity_id, raw_context_source_id, extraction_receipt, metadata, ignored_at
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31::jsonb,$32::jsonb,$33
     )
     ON CONFLICT (tenant_id, calendar_connection_id, provider_event_id)
       WHERE provider_event_id IS NOT NULL
     DO UPDATE SET
       title = EXCLUDED.title,
       description = COALESCE(EXCLUDED.description, calendar_events.description),
       organizer_email = COALESCE(EXCLUDED.organizer_email, calendar_events.organizer_email),
       organizer_name = COALESCE(EXCLUDED.organizer_name, calendar_events.organizer_name),
       attendee_emails = EXCLUDED.attendee_emails,
       attendee_names = EXCLUDED.attendee_names,
       meeting_url = COALESCE(EXCLUDED.meeting_url, calendar_events.meeting_url),
       location = COALESCE(EXCLUDED.location, calendar_events.location),
       starts_at = EXCLUDED.starts_at,
       ends_at = COALESCE(EXCLUDED.ends_at, calendar_events.ends_at),
       status = EXCLUDED.status,
       classification = EXCLUDED.classification,
       classification_confidence = EXCLUDED.classification_confidence,
       classification_reason = EXCLUDED.classification_reason,
       validation_status = EXCLUDED.validation_status,
       validation_blockers = EXCLUDED.validation_blockers,
       processing_status = EXCLUDED.processing_status,
       processing_reason = EXCLUDED.processing_reason,
       contact_id = COALESCE(EXCLUDED.contact_id, calendar_events.contact_id),
       account_id = COALESCE(EXCLUDED.account_id, calendar_events.account_id),
       opportunity_id = COALESCE(EXCLUDED.opportunity_id, calendar_events.opportunity_id),
       use_case_id = COALESCE(EXCLUDED.use_case_id, calendar_events.use_case_id),
       activity_id = COALESCE(EXCLUDED.activity_id, calendar_events.activity_id),
       raw_context_source_id = COALESCE(EXCLUDED.raw_context_source_id, calendar_events.raw_context_source_id),
       extraction_receipt = calendar_events.extraction_receipt || EXCLUDED.extraction_receipt,
       metadata = calendar_events.metadata || EXCLUDED.metadata,
       ignored_at = COALESCE(EXCLUDED.ignored_at, calendar_events.ignored_at),
       updated_at = now()
     RETURNING *`,
    [
      tenantId,
      input.calendar_connection_id ?? null,
      input.user_id ?? null,
      input.provider ?? 'manual',
      input.provider_event_id ?? null,
      input.i_cal_uid ?? null,
      input.title,
      input.description ?? null,
      input.organizer_email ?? null,
      input.organizer_name ?? null,
      input.attendee_emails ?? [],
      input.attendee_names ?? [],
      input.meeting_url ?? null,
      input.location ?? null,
      input.starts_at,
      input.ends_at ?? null,
      input.status ?? 'scheduled',
      input.classification ?? 'unknown',
      input.classification_confidence ?? 0.5,
      input.classification_reason ?? null,
      input.validation_status ?? 'needs_review',
      input.validation_blockers ?? [],
      input.processing_status ?? 'unprocessed',
      input.processing_reason ?? null,
      input.contact_id ?? null,
      input.account_id ?? null,
      input.opportunity_id ?? null,
      input.use_case_id ?? null,
      input.activity_id ?? null,
      input.raw_context_source_id ?? null,
      JSON.stringify(input.extraction_receipt ?? {}),
      JSON.stringify(input.metadata ?? {}),
      input.ignored_at ?? null,
    ],
  );
  return rowToCalendarEvent(result.rows[0]);
}

export async function getCalendarEvent(db: DbPool, tenantId: UUID, id: UUID): Promise<CalendarEvent | null> {
  const result = await db.query(
    `SELECT ce.*,
       NULLIF(trim(concat_ws(' ', c.first_name, c.last_name)), '') AS contact_name,
       a.name AS account_name,
       o.name AS opportunity_name,
       u.name AS use_case_name,
       COALESCE(artifacts.artifact_count, 0)::int AS artifact_count,
       COALESCE(artifacts.transcript_count, 0)::int AS transcript_count,
       COALESCE(artifacts.notes_count, 0)::int AS notes_count
     FROM calendar_events ce
     LEFT JOIN contacts c ON c.id = ce.contact_id AND c.tenant_id = ce.tenant_id
     LEFT JOIN accounts a ON a.id = ce.account_id AND a.tenant_id = ce.tenant_id
     LEFT JOIN opportunities o ON o.id = ce.opportunity_id AND o.tenant_id = ce.tenant_id
     LEFT JOIN use_cases u ON u.id = ce.use_case_id AND u.tenant_id = ce.tenant_id
     LEFT JOIN LATERAL (
       SELECT
         count(*) AS artifact_count,
         count(*) FILTER (WHERE artifact_type = 'transcript') AS transcript_count,
         count(*) FILTER (WHERE artifact_type IN ('notes','summary')) AS notes_count
       FROM meeting_artifacts ma
       WHERE ma.tenant_id = ce.tenant_id AND ma.calendar_event_id = ce.id
     ) artifacts ON TRUE
     WHERE ce.tenant_id = $1 AND ce.id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? rowToCalendarEvent(result.rows[0]) : null;
}

export async function listCalendarEvents(
  db: DbPool,
  tenantId: UUID,
  filters: CalendarEventFilters,
): Promise<PaginatedResponse<CalendarEvent>> {
  const conditions = ['ce.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.tab === 'meetings') {
    conditions.push(`ce.status <> 'ignored'`);
    conditions.push(`ce.validation_status <> 'skipped_internal'`);
  } else if (filters.tab === 'needs_context') {
    conditions.push(`ce.validation_status IN ('missing_context','needs_record_link','needs_review','failed')`);
    conditions.push(`ce.status <> 'ignored'`);
  }
  if (!filters.include_internal) {
    conditions.push(`ce.validation_status <> 'skipped_internal'`);
  }
  if (filters.classification) {
    conditions.push(`ce.classification = $${idx++}`);
    params.push(filters.classification);
  }
  if (filters.validation_status) {
    conditions.push(`ce.validation_status = $${idx++}`);
    params.push(filters.validation_status);
  }
  if (filters.processing_status) {
    conditions.push(`ce.processing_status = $${idx++}`);
    params.push(filters.processing_status);
  }
  if (filters.contact_id) {
    conditions.push(`ce.contact_id = $${idx++}`);
    params.push(filters.contact_id);
  }
  if (filters.account_id) {
    conditions.push(`ce.account_id = $${idx++}`);
    params.push(filters.account_id);
  }
  if (filters.opportunity_id) {
    conditions.push(`ce.opportunity_id = $${idx++}`);
    params.push(filters.opportunity_id);
  }
  if (filters.use_case_id) {
    conditions.push(`ce.use_case_id = $${idx++}`);
    params.push(filters.use_case_id);
  }
  if (filters.q) {
    conditions.push(`(
      ce.title ILIKE $${idx}
      OR ce.description ILIKE $${idx}
      OR ce.organizer_email ILIKE $${idx}
      OR EXISTS (SELECT 1 FROM unnest(ce.attendee_emails) e WHERE e ILIKE $${idx})
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
        OR ce.user_id = ANY($${idx}::uuid[])
      )`);
      params.push(filters.owner_ids);
      idx++;
    }
  }
  idx = addStableDescCursorCondition(conditions, params, idx, filters.cursor, 'ce.starts_at', 'ce.id');

  const from = `FROM calendar_events ce
    LEFT JOIN contacts c ON c.id = ce.contact_id AND c.tenant_id = ce.tenant_id
    LEFT JOIN accounts a ON a.id = ce.account_id AND a.tenant_id = ce.tenant_id
    LEFT JOIN opportunities o ON o.id = ce.opportunity_id AND o.tenant_id = ce.tenant_id
    LEFT JOIN use_cases u ON u.id = ce.use_case_id AND u.tenant_id = ce.tenant_id
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS artifact_count,
        count(*) FILTER (WHERE artifact_type = 'transcript') AS transcript_count,
        count(*) FILTER (WHERE artifact_type IN ('notes','summary')) AS notes_count
      FROM meeting_artifacts ma
      WHERE ma.tenant_id = ce.tenant_id AND ma.calendar_event_id = ce.id
    ) artifacts ON TRUE`;
  const where = conditions.join(' AND ');
  const exactTotals = exactListTotalsEnabled();
  const countResult = exactTotals
    ? await db.query(`SELECT count(*)::int AS total ${from} WHERE ${where}`, params)
    : null;

  params.push(filters.limit + 1);
  const result = await db.query(
    `SELECT ce.*,
       NULLIF(trim(concat_ws(' ', c.first_name, c.last_name)), '') AS contact_name,
       a.name AS account_name,
       o.name AS opportunity_name,
       u.name AS use_case_name,
       COALESCE(artifacts.artifact_count, 0)::int AS artifact_count,
       COALESCE(artifacts.transcript_count, 0)::int AS transcript_count,
       COALESCE(artifacts.notes_count, 0)::int AS notes_count
     ${from}
     WHERE ${where}
     ORDER BY ce.starts_at DESC, ce.id DESC
     LIMIT $${idx}`,
    params,
  );
  const rows = result.rows.map(rowToCalendarEvent);
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;
  return {
    data,
    ...pageTotal(data.length, hasMore, exactTotals ? Number(countResult?.rows[0]?.total ?? 0) : undefined),
    next_cursor: hasMore && data.length > 0
      ? encodeStableCursor({ sort_value: data[data.length - 1].starts_at, id: data[data.length - 1].id })
      : undefined,
  };
}

export async function updateCalendarEvent(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Partial<Pick<CalendarEvent,
    'classification' | 'classification_confidence' | 'classification_reason' |
    'validation_status' | 'validation_blockers' | 'processing_status' | 'processing_reason' |
    'contact_id' | 'account_id' | 'opportunity_id' | 'use_case_id' |
    'activity_id' | 'raw_context_source_id' | 'extraction_receipt' | 'metadata' | 'ignored_at' | 'status'
  >>,
): Promise<CalendarEvent | null> {
  const sets = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;
  const scalarFields = [
    'classification',
    'classification_confidence',
    'classification_reason',
    'validation_status',
    'processing_status',
    'processing_reason',
    'contact_id',
    'account_id',
    'opportunity_id',
    'use_case_id',
    'activity_id',
    'raw_context_source_id',
    'ignored_at',
    'status',
  ] as const;
  for (const field of scalarFields) {
    if (field in patch) {
      sets.push(`${field} = $${idx++}`);
      params.push(patch[field] ?? null);
    }
  }
  if (patch.validation_blockers !== undefined) {
    sets.push(`validation_blockers = $${idx++}`);
    params.push(patch.validation_blockers);
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
    `UPDATE calendar_events SET ${sets.join(', ')}
     WHERE tenant_id = $1 AND id = $2
     RETURNING id`,
    params,
  );
  return result.rows[0] ? getCalendarEvent(db, tenantId, id) : null;
}

export async function createMeetingArtifact(
  db: DbPool,
  tenantId: UUID,
  input: Partial<MeetingArtifact> & { calendar_event_id: UUID; artifact_type: MeetingArtifactType },
): Promise<MeetingArtifact> {
  const result = await db.query(
    `INSERT INTO meeting_artifacts (
       tenant_id, calendar_event_id, activity_id, email_message_id, raw_context_source_id,
       artifact_type, source, source_label, text_content, text_excerpt,
       processing_status, processing_reason, extraction_receipt, metadata, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15)
     RETURNING *`,
    [
      tenantId,
      input.calendar_event_id,
      input.activity_id ?? null,
      input.email_message_id ?? null,
      input.raw_context_source_id ?? null,
      input.artifact_type,
      input.source ?? 'manual',
      input.source_label ?? null,
      input.text_content ?? null,
      input.text_excerpt ?? input.text_content?.slice(0, 500) ?? null,
      input.processing_status ?? 'unprocessed',
      input.processing_reason ?? null,
      JSON.stringify(input.extraction_receipt ?? {}),
      JSON.stringify(input.metadata ?? {}),
      input.created_by ?? null,
    ],
  );
  return result.rows[0] as MeetingArtifact;
}

export async function listMeetingArtifacts(db: DbPool, tenantId: UUID, calendarEventId: UUID): Promise<MeetingArtifact[]> {
  const result = await db.query(
    `SELECT * FROM meeting_artifacts
     WHERE tenant_id = $1 AND calendar_event_id = $2
     ORDER BY created_at DESC`,
    [tenantId, calendarEventId],
  );
  return result.rows as MeetingArtifact[];
}

export async function updateMeetingArtifact(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Partial<Pick<MeetingArtifact, 'activity_id' | 'raw_context_source_id' | 'processing_status' | 'processing_reason' | 'extraction_receipt' | 'metadata'>>,
): Promise<MeetingArtifact | null> {
  const sets = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;
  const scalarFields = ['activity_id', 'raw_context_source_id', 'processing_status', 'processing_reason'] as const;
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
    `UPDATE meeting_artifacts SET ${sets.join(', ')}
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    params,
  );
  return (result.rows[0] as MeetingArtifact) ?? null;
}

export async function summarizeCalendarEvents(
  db: DbPool,
  tenantId: UUID,
  ownerIds?: UUID[],
): Promise<{ total: number; meetings: number; needs_context: number; processed: number; internal: number }> {
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
        OR ce.user_id = ANY($${params.length}::uuid[])
      )`;
    }
  }
  const result = await db.query(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE ce.validation_status <> 'skipped_internal' AND ce.status <> 'ignored')::int AS meetings,
       count(*) FILTER (WHERE ce.validation_status IN ('missing_context','needs_record_link','needs_review','failed'))::int AS needs_context,
       count(*) FILTER (WHERE ce.processing_status = 'processed')::int AS processed,
       count(*) FILTER (WHERE ce.validation_status = 'skipped_internal')::int AS internal
     FROM calendar_events ce
     LEFT JOIN contacts c ON c.id = ce.contact_id AND c.tenant_id = ce.tenant_id
     LEFT JOIN accounts a ON a.id = ce.account_id AND a.tenant_id = ce.tenant_id
     LEFT JOIN opportunities o ON o.id = ce.opportunity_id AND o.tenant_id = ce.tenant_id
     LEFT JOIN use_cases u ON u.id = ce.use_case_id AND u.tenant_id = ce.tenant_id
     WHERE ce.tenant_id = $1${ownerClause}`,
    params,
  );
  return {
    total: Number(result.rows[0]?.total ?? 0),
    meetings: Number(result.rows[0]?.meetings ?? 0),
    needs_context: Number(result.rows[0]?.needs_context ?? 0),
    processed: Number(result.rows[0]?.processed ?? 0),
    internal: Number(result.rows[0]?.internal ?? 0),
  };
}
