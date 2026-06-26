// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { PaginatedResponse, UUID } from '@crmy/shared';
import type { DbPool } from '../pool.js';
import { addStableDescCursorCondition, encodeStableCursor } from './pagination.js';

export type ContextSourceProvider = 's3' | 'local_folder';
export type ContextSourceConnectionStatus = 'configured' | 'syncing' | 'error' | 'disabled';
export type ContextSourceArtifactType = 'transcript' | 'notes' | 'summary' | 'recording' | 'other';
export type ContextSourceMatchStatus = 'unmatched' | 'matched' | 'ambiguous' | 'needs_review' | 'ignored';
export type ContextSourceProcessingStatus = 'discovered' | 'queued' | 'processing' | 'processed' | 'needs_review' | 'failed' | 'ignored';

export interface ContextSourceConnection {
  id: UUID;
  tenant_id: UUID;
  name: string;
  provider: ContextSourceProvider;
  status: ContextSourceConnectionStatus;
  config: Record<string, unknown>;
  credentials_enc?: Record<string, unknown> | null;
  sync_cursor?: string | null;
  sync_stats: Record<string, unknown>;
  last_sync_at?: string | null;
  last_error?: string | null;
  created_by?: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface ContextSourceObject {
  id: UUID;
  tenant_id: UUID;
  connection_id?: UUID | null;
  object_key: string;
  object_version?: string | null;
  content_hash: string;
  size_bytes: number;
  modified_at?: string | null;
  source_label?: string | null;
  artifact_type: ContextSourceArtifactType;
  match_status: ContextSourceMatchStatus;
  processing_status: ContextSourceProcessingStatus;
  match_reason?: string | null;
  candidates: Array<Record<string, unknown>>;
  sidecar_metadata: Record<string, unknown>;
  text_excerpt?: string | null;
  contact_id?: UUID | null;
  account_id?: UUID | null;
  opportunity_id?: UUID | null;
  use_case_id?: UUID | null;
  calendar_event_id?: UUID | null;
  activity_id?: UUID | null;
  meeting_artifact_id?: UUID | null;
  raw_context_source_id?: UUID | null;
  hitl_request_id?: UUID | null;
  failure_code?: string | null;
  failure_reason?: string | null;
  extraction_receipt: Record<string, unknown>;
  metadata: Record<string, unknown>;
  ignored_at?: string | null;
  processed_at?: string | null;
  created_at: string;
  updated_at: string;
  connection_name?: string | null;
  connection_provider?: ContextSourceProvider | null;
  account_name?: string | null;
  contact_name?: string | null;
  opportunity_name?: string | null;
  use_case_name?: string | null;
  calendar_title?: string | null;
}

export interface SourceObjectFilters {
  connection_id?: UUID;
  match_status?: ContextSourceMatchStatus | 'all';
  processing_status?: ContextSourceProcessingStatus | 'all';
  q?: string;
  account_id?: UUID;
  contact_id?: UUID;
  opportunity_id?: UUID;
  use_case_id?: UUID;
  calendar_event_id?: UUID;
  owner_ids?: UUID[];
  limit: number;
  cursor?: string;
}

export async function createConnection(
  db: DbPool,
  tenantId: UUID,
  input: {
    name: string;
    provider: ContextSourceProvider;
    config: Record<string, unknown>;
    credentials_enc?: Record<string, unknown> | null;
    created_by?: UUID | null;
  },
): Promise<ContextSourceConnection> {
  const result = await db.query(
    `INSERT INTO context_source_connections (
       tenant_id, name, provider, config, credentials_enc, created_by
     )
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)
     RETURNING *`,
    [
      tenantId,
      input.name,
      input.provider,
      JSON.stringify(input.config ?? {}),
      input.credentials_enc ? JSON.stringify(input.credentials_enc) : null,
      input.created_by ?? null,
    ],
  );
  return result.rows[0] as ContextSourceConnection;
}

export async function listConnections(db: DbPool, tenantId: UUID): Promise<ContextSourceConnection[]> {
  const result = await db.query(
    `SELECT c.*, c.credentials_enc IS NOT NULL AS has_credentials
     FROM context_source_connections c
     WHERE tenant_id = $1
     ORDER BY updated_at DESC`,
    [tenantId],
  );
  return result.rows.map(row => {
    const { credentials_enc: _credentials, ...safe } = row;
    return safe as ContextSourceConnection;
  });
}

export async function getConnection(db: DbPool, tenantId: UUID, id: UUID, includeCredentials = false): Promise<ContextSourceConnection | null> {
  const result = await db.query(
    `SELECT *
     FROM context_source_connections
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (!includeCredentials) delete row.credentials_enc;
  return row as ContextSourceConnection;
}

export async function updateConnection(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Partial<Pick<ContextSourceConnection, 'name' | 'status' | 'sync_cursor' | 'last_error' | 'sync_stats'>> & {
    config?: Record<string, unknown>;
    credentials_enc?: Record<string, unknown> | null;
    last_sync_at?: string | null;
  },
): Promise<ContextSourceConnection | null> {
  const sets = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;
  for (const field of ['name', 'status', 'sync_cursor', 'last_error', 'last_sync_at'] as const) {
    if (field in patch) {
      sets.push(`${field} = $${idx++}`);
      params.push(patch[field] ?? null);
    }
  }
  if (patch.config !== undefined) {
    sets.push(`config = config || $${idx++}::jsonb`);
    params.push(JSON.stringify(patch.config));
  }
  if (patch.sync_stats !== undefined) {
    sets.push(`sync_stats = sync_stats || $${idx++}::jsonb`);
    params.push(JSON.stringify(patch.sync_stats));
  }
  if ('credentials_enc' in patch) {
    sets.push(`credentials_enc = $${idx++}::jsonb`);
    params.push(patch.credentials_enc ? JSON.stringify(patch.credentials_enc) : null);
  }
  const result = await db.query(
    `UPDATE context_source_connections
     SET ${sets.join(', ')}
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    params,
  );
  return (result.rows[0] as ContextSourceConnection | undefined) ?? null;
}

export async function deleteConnection(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM context_source_connections WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function enqueueSyncJob(
  db: DbPool,
  tenantId: UUID,
  connectionId: UUID,
  metadata: Record<string, unknown> = {},
): Promise<{ id: UUID; status: string }> {
  const existing = await db.query(
    `SELECT id, status
     FROM context_source_sync_jobs
     WHERE tenant_id = $1
       AND connection_id = $2
       AND job_type = 'sync'
       AND status IN ('pending', 'processing', 'failed')
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, connectionId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0] as { id: UUID; status: string };
    if (row.status === 'failed') {
      const revived = await db.query(
        `UPDATE context_source_sync_jobs
         SET status = 'pending',
             run_after = now(),
             locked_at = NULL,
             last_error = NULL,
             metadata = metadata || $2::jsonb,
             updated_at = now()
         WHERE id = $1
         RETURNING id, status`,
        [row.id, JSON.stringify(metadata)],
      );
      return revived.rows[0] as { id: UUID; status: string };
    }
    return row;
  }

  const result = await db.query(
    `INSERT INTO context_source_sync_jobs (tenant_id, connection_id, metadata)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id, status`,
    [tenantId, connectionId, JSON.stringify(metadata)],
  );
  if (result.rows[0]) return result.rows[0] as { id: UUID; status: string };
  const fallback = await db.query(
    `SELECT id, status
     FROM context_source_sync_jobs
     WHERE tenant_id = $1
       AND connection_id = $2
       AND job_type = 'sync'
       AND status IN ('pending', 'processing', 'failed')
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, connectionId],
  );
  return fallback.rows[0] as { id: UUID; status: string };
}

export async function claimSyncJobs(db: DbPool, limit = 5): Promise<Array<{ id: UUID; tenant_id: UUID; connection_id: UUID; metadata: Record<string, unknown> }>> {
  const result = await db.query(
    `WITH ready AS (
       SELECT id
       FROM context_source_sync_jobs
       WHERE status IN ('pending', 'failed') AND run_after <= now()
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE context_source_sync_jobs j
     SET status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now()
     FROM ready
     WHERE j.id = ready.id
     RETURNING j.id, j.tenant_id, j.connection_id, j.metadata`,
    [limit],
  );
  return result.rows as Array<{ id: UUID; tenant_id: UUID; connection_id: UUID; metadata: Record<string, unknown> }>;
}

export async function completeSyncJob(db: DbPool, id: UUID): Promise<void> {
  await db.query(
    `UPDATE context_source_sync_jobs
     SET status = 'complete', locked_at = NULL, last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function failSyncJob(db: DbPool, id: UUID, error: string): Promise<void> {
  await db.query(
    `UPDATE context_source_sync_jobs
     SET status = 'failed',
         locked_at = NULL,
         last_error = $2,
         run_after = now() + make_interval(mins => LEAST(60, GREATEST(1, attempts * 5))),
         updated_at = now()
     WHERE id = $1`,
    [id, error.slice(0, 500)],
  );
}

export async function enqueueProcessingJob(
  db: DbPool,
  tenantId: UUID,
  sourceObjectId: UUID,
  metadata: Record<string, unknown> = {},
): Promise<{ id: UUID; status: string }> {
  const existing = await db.query(
    `SELECT id, status
     FROM context_source_processing_jobs
     WHERE tenant_id = $1
       AND source_object_id = $2
       AND status IN ('pending', 'processing', 'failed')
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, sourceObjectId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0] as { id: UUID; status: string };
    if (row.status === 'failed') {
      const revived = await db.query(
        `UPDATE context_source_processing_jobs
         SET status = 'pending',
             run_after = now(),
             locked_at = NULL,
             last_error = NULL,
             metadata = metadata || $2::jsonb,
             updated_at = now()
         WHERE id = $1
         RETURNING id, status`,
        [row.id, JSON.stringify(metadata)],
      );
      return revived.rows[0] as { id: UUID; status: string };
    }
    return row;
  }

  const result = await db.query(
    `INSERT INTO context_source_processing_jobs (tenant_id, source_object_id, metadata)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id, status`,
    [tenantId, sourceObjectId, JSON.stringify(metadata)],
  );
  if (result.rows[0]) return result.rows[0] as { id: UUID; status: string };
  const fallback = await db.query(
    `SELECT id, status
     FROM context_source_processing_jobs
     WHERE tenant_id = $1
       AND source_object_id = $2
       AND status IN ('pending', 'processing', 'failed')
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, sourceObjectId],
  );
  return fallback.rows[0] as { id: UUID; status: string };
}

export async function claimProcessingJobs(db: DbPool, limit = 5): Promise<Array<{ id: UUID; tenant_id: UUID; source_object_id: UUID; metadata: Record<string, unknown> }>> {
  const result = await db.query(
    `WITH ready AS (
       SELECT id
       FROM context_source_processing_jobs
       WHERE status IN ('pending', 'failed') AND run_after <= now()
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE context_source_processing_jobs j
     SET status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now()
     FROM ready
     WHERE j.id = ready.id
     RETURNING j.id, j.tenant_id, j.source_object_id, j.metadata`,
    [limit],
  );
  return result.rows as Array<{ id: UUID; tenant_id: UUID; source_object_id: UUID; metadata: Record<string, unknown> }>;
}

export async function completeProcessingJob(db: DbPool, id: UUID): Promise<void> {
  await db.query(
    `UPDATE context_source_processing_jobs
     SET status = 'complete', locked_at = NULL, last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function failProcessingJob(db: DbPool, id: UUID, error: string): Promise<void> {
  await db.query(
    `UPDATE context_source_processing_jobs
     SET status = 'failed',
         locked_at = NULL,
         last_error = $2,
         run_after = now() + make_interval(mins => LEAST(120, GREATEST(5, attempts * 10))),
         updated_at = now()
     WHERE id = $1`,
    [id, error.slice(0, 500)],
  );
}

export async function upsertSourceObject(
  db: DbPool,
  tenantId: UUID,
  input: Partial<ContextSourceObject> & {
    connection_id: UUID;
    object_key: string;
    content_hash: string;
  },
): Promise<ContextSourceObject> {
  const result = await db.query(
    `INSERT INTO context_source_objects (
       tenant_id, connection_id, object_key, object_version, content_hash, size_bytes,
       modified_at, source_label, artifact_type, match_status, processing_status,
       match_reason, candidates, sidecar_metadata, text_excerpt,
       contact_id, account_id, opportunity_id, use_case_id,
       calendar_event_id, activity_id, meeting_artifact_id, raw_context_source_id,
       hitl_request_id, failure_code, failure_reason, extraction_receipt, metadata,
       ignored_at, processed_at
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,
       $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,$28::jsonb,$29,$30
     )
     ON CONFLICT (tenant_id, connection_id, object_key, content_hash)
     DO UPDATE SET
       object_version = COALESCE(EXCLUDED.object_version, context_source_objects.object_version),
       size_bytes = EXCLUDED.size_bytes,
       modified_at = COALESCE(EXCLUDED.modified_at, context_source_objects.modified_at),
       source_label = COALESCE(EXCLUDED.source_label, context_source_objects.source_label),
       artifact_type = EXCLUDED.artifact_type,
       match_status = EXCLUDED.match_status,
       processing_status = EXCLUDED.processing_status,
       match_reason = COALESCE(EXCLUDED.match_reason, context_source_objects.match_reason),
       candidates = CASE WHEN jsonb_array_length(EXCLUDED.candidates) > 0 THEN EXCLUDED.candidates ELSE context_source_objects.candidates END,
       sidecar_metadata = context_source_objects.sidecar_metadata || EXCLUDED.sidecar_metadata,
       text_excerpt = COALESCE(EXCLUDED.text_excerpt, context_source_objects.text_excerpt),
       contact_id = COALESCE(EXCLUDED.contact_id, context_source_objects.contact_id),
       account_id = COALESCE(EXCLUDED.account_id, context_source_objects.account_id),
       opportunity_id = COALESCE(EXCLUDED.opportunity_id, context_source_objects.opportunity_id),
       use_case_id = COALESCE(EXCLUDED.use_case_id, context_source_objects.use_case_id),
       calendar_event_id = COALESCE(EXCLUDED.calendar_event_id, context_source_objects.calendar_event_id),
       activity_id = COALESCE(EXCLUDED.activity_id, context_source_objects.activity_id),
       meeting_artifact_id = COALESCE(EXCLUDED.meeting_artifact_id, context_source_objects.meeting_artifact_id),
       raw_context_source_id = COALESCE(EXCLUDED.raw_context_source_id, context_source_objects.raw_context_source_id),
       hitl_request_id = COALESCE(EXCLUDED.hitl_request_id, context_source_objects.hitl_request_id),
       failure_code = COALESCE(EXCLUDED.failure_code, context_source_objects.failure_code),
       failure_reason = COALESCE(EXCLUDED.failure_reason, context_source_objects.failure_reason),
       metadata = context_source_objects.metadata || EXCLUDED.metadata,
       updated_at = now()
     RETURNING *`,
    [
      tenantId,
      input.connection_id,
      input.object_key,
      input.object_version ?? null,
      input.content_hash,
      input.size_bytes ?? 0,
      input.modified_at ?? null,
      input.source_label ?? null,
      input.artifact_type ?? 'transcript',
      input.match_status ?? 'unmatched',
      input.processing_status ?? 'discovered',
      input.match_reason ?? null,
      JSON.stringify(input.candidates ?? []),
      JSON.stringify(input.sidecar_metadata ?? {}),
      input.text_excerpt ?? null,
      input.contact_id ?? null,
      input.account_id ?? null,
      input.opportunity_id ?? null,
      input.use_case_id ?? null,
      input.calendar_event_id ?? null,
      input.activity_id ?? null,
      input.meeting_artifact_id ?? null,
      input.raw_context_source_id ?? null,
      input.hitl_request_id ?? null,
      input.failure_code ?? null,
      input.failure_reason ?? null,
      JSON.stringify(input.extraction_receipt ?? {}),
      JSON.stringify(input.metadata ?? {}),
      input.ignored_at ?? null,
      input.processed_at ?? null,
    ],
  );
  return result.rows[0] as ContextSourceObject;
}

export async function getSourceObject(db: DbPool, tenantId: UUID, id: UUID): Promise<ContextSourceObject | null> {
  const result = await db.query(
    `SELECT o.*, c.name AS connection_name, c.provider AS connection_provider,
            a.name AS account_name, ct.name AS contact_name, opp.name AS opportunity_name,
            uc.name AS use_case_name, ce.title AS calendar_title
     FROM context_source_objects o
     LEFT JOIN context_source_connections c ON c.id = o.connection_id AND c.tenant_id = o.tenant_id
     LEFT JOIN accounts a ON a.id = o.account_id AND a.tenant_id = o.tenant_id
     LEFT JOIN contacts ct ON ct.id = o.contact_id AND ct.tenant_id = o.tenant_id
     LEFT JOIN opportunities opp ON opp.id = o.opportunity_id AND opp.tenant_id = o.tenant_id
     LEFT JOIN use_cases uc ON uc.id = o.use_case_id AND uc.tenant_id = o.tenant_id
     LEFT JOIN calendar_events ce ON ce.id = o.calendar_event_id AND ce.tenant_id = o.tenant_id
     WHERE o.tenant_id = $1 AND o.id = $2`,
    [tenantId, id],
  );
  return (result.rows[0] as ContextSourceObject | undefined) ?? null;
}

export async function findSourceObjectByActualHash(
  db: DbPool,
  tenantId: UUID,
  connectionId: UUID,
  contentHash: string,
  excludeId?: UUID,
): Promise<ContextSourceObject | null> {
  const result = await db.query(
    `SELECT o.*, c.name AS connection_name, c.provider AS connection_provider,
            a.name AS account_name, ct.name AS contact_name, opp.name AS opportunity_name,
            uc.name AS use_case_name, ce.title AS calendar_title
     FROM context_source_objects o
     LEFT JOIN context_source_connections c ON c.id = o.connection_id AND c.tenant_id = o.tenant_id
     LEFT JOIN accounts a ON a.id = o.account_id AND a.tenant_id = o.tenant_id
     LEFT JOIN contacts ct ON ct.id = o.contact_id AND ct.tenant_id = o.tenant_id
     LEFT JOIN opportunities opp ON opp.id = o.opportunity_id AND opp.tenant_id = o.tenant_id
     LEFT JOIN use_cases uc ON uc.id = o.use_case_id AND uc.tenant_id = o.tenant_id
     LEFT JOIN calendar_events ce ON ce.id = o.calendar_event_id AND ce.tenant_id = o.tenant_id
     WHERE o.tenant_id = $1
       AND o.connection_id = $2
       AND o.metadata->>'actual_content_hash' = $3
       AND ($4::uuid IS NULL OR o.id <> $4)
       AND o.processing_status IN ('processed', 'needs_review', 'queued', 'processing')
     ORDER BY
       CASE o.processing_status WHEN 'processed' THEN 0 WHEN 'needs_review' THEN 1 ELSE 2 END,
       o.updated_at DESC
     LIMIT 1`,
    [tenantId, connectionId, contentHash, excludeId ?? null],
  );
  return (result.rows[0] as ContextSourceObject | undefined) ?? null;
}

export async function listSourceObjects(
  db: DbPool,
  tenantId: UUID,
  filters: SourceObjectFilters,
): Promise<PaginatedResponse<ContextSourceObject>> {
  const conditions = ['o.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;
  if (filters.connection_id) {
    conditions.push(`o.connection_id = $${idx++}`);
    params.push(filters.connection_id);
  }
  if (filters.match_status && filters.match_status !== 'all') {
    conditions.push(`o.match_status = $${idx++}`);
    params.push(filters.match_status);
  }
  if (filters.processing_status && filters.processing_status !== 'all') {
    conditions.push(`o.processing_status = $${idx++}`);
    params.push(filters.processing_status);
  }
  for (const [field, value] of [
    ['account_id', filters.account_id],
    ['contact_id', filters.contact_id],
    ['opportunity_id', filters.opportunity_id],
    ['use_case_id', filters.use_case_id],
    ['calendar_event_id', filters.calendar_event_id],
  ] as const) {
    if (value) {
      conditions.push(`o.${field} = $${idx++}`);
      params.push(value);
    }
  }
  if (filters.q?.trim()) {
    conditions.push(`(o.object_key ILIKE $${idx} OR o.source_label ILIKE $${idx} OR o.text_excerpt ILIKE $${idx})`);
    params.push(`%${filters.q.trim()}%`);
    idx++;
  }
  if (filters.owner_ids) {
    if (filters.owner_ids.length === 0) {
      conditions.push('FALSE');
    } else {
      conditions.push(`(
        EXISTS (SELECT 1 FROM accounts a WHERE a.tenant_id = o.tenant_id AND a.id = o.account_id AND a.owner_id = ANY($${idx}::uuid[]))
        OR EXISTS (SELECT 1 FROM contacts c WHERE c.tenant_id = o.tenant_id AND c.id = o.contact_id AND c.owner_id = ANY($${idx}::uuid[]))
        OR EXISTS (SELECT 1 FROM opportunities opp WHERE opp.tenant_id = o.tenant_id AND opp.id = o.opportunity_id AND opp.owner_id = ANY($${idx}::uuid[]))
        OR EXISTS (SELECT 1 FROM use_cases uc WHERE uc.tenant_id = o.tenant_id AND uc.id = o.use_case_id AND uc.owner_id = ANY($${idx}::uuid[]))
        OR EXISTS (
          SELECT 1 FROM calendar_events ce
          WHERE ce.tenant_id = o.tenant_id AND ce.id = o.calendar_event_id AND ce.user_id = ANY($${idx}::uuid[])
        )
      )`);
      params.push(filters.owner_ids);
      idx++;
    }
  }
  idx = addStableDescCursorCondition(conditions, params, idx, filters.cursor, 'o.updated_at', 'o.id');
  params.push(filters.limit + 1);
  const result = await db.query(
    `SELECT o.*, c.name AS connection_name, c.provider AS connection_provider,
            a.name AS account_name, ct.name AS contact_name, opp.name AS opportunity_name,
            uc.name AS use_case_name, ce.title AS calendar_title
     FROM context_source_objects o
     LEFT JOIN context_source_connections c ON c.id = o.connection_id AND c.tenant_id = o.tenant_id
     LEFT JOIN accounts a ON a.id = o.account_id AND a.tenant_id = o.tenant_id
     LEFT JOIN contacts ct ON ct.id = o.contact_id AND ct.tenant_id = o.tenant_id
     LEFT JOIN opportunities opp ON opp.id = o.opportunity_id AND opp.tenant_id = o.tenant_id
     LEFT JOIN use_cases uc ON uc.id = o.use_case_id AND uc.tenant_id = o.tenant_id
     LEFT JOIN calendar_events ce ON ce.id = o.calendar_event_id AND ce.tenant_id = o.tenant_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY o.updated_at DESC, o.id DESC
     LIMIT $${idx}`,
    params,
  );
  const rows = result.rows as ContextSourceObject[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;
  return {
    data,
    total: data.length + (hasMore ? 1 : 0),
    next_cursor: hasMore && data.length ? encodeStableCursor({ sort_value: data[data.length - 1].updated_at, id: data[data.length - 1].id }) : undefined,
  };
}

export async function updateSourceObject(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Partial<Pick<ContextSourceObject,
    'match_status' | 'processing_status' | 'match_reason' | 'text_excerpt' |
    'contact_id' | 'account_id' | 'opportunity_id' | 'use_case_id' |
    'calendar_event_id' | 'activity_id' | 'meeting_artifact_id' | 'raw_context_source_id' |
    'hitl_request_id' | 'failure_code' | 'failure_reason' | 'ignored_at' | 'processed_at'
  >> & {
    candidates?: Array<Record<string, unknown>>;
    sidecar_metadata?: Record<string, unknown>;
    extraction_receipt?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<ContextSourceObject | null> {
  const sets = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;
  for (const field of [
    'match_status',
    'processing_status',
    'match_reason',
    'text_excerpt',
    'contact_id',
    'account_id',
    'opportunity_id',
    'use_case_id',
    'calendar_event_id',
    'activity_id',
    'meeting_artifact_id',
    'raw_context_source_id',
    'hitl_request_id',
    'failure_code',
    'failure_reason',
    'ignored_at',
    'processed_at',
  ] as const) {
    if (field in patch) {
      sets.push(`${field} = $${idx++}`);
      params.push(patch[field] ?? null);
    }
  }
  if (patch.candidates !== undefined) {
    sets.push(`candidates = $${idx++}::jsonb`);
    params.push(JSON.stringify(patch.candidates));
  }
  if (patch.sidecar_metadata !== undefined) {
    sets.push(`sidecar_metadata = sidecar_metadata || $${idx++}::jsonb`);
    params.push(JSON.stringify(patch.sidecar_metadata));
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
    `UPDATE context_source_objects
     SET ${sets.join(', ')}
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    params,
  );
  return (result.rows[0] as ContextSourceObject | undefined) ?? null;
}
