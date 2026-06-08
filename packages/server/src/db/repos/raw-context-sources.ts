// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { PaginatedResponse, SubjectType, UUID } from '@crmy/shared';

export interface RawContextSource {
  id: UUID;
  tenant_id: UUID;
  source_type: string;
  source_ref: string;
  source_label?: string;
  subject_type?: SubjectType;
  subject_id?: UUID;
  actor_id?: UUID;
  status: 'pending' | 'processing' | 'processed' | 'needs_review' | 'failed' | 'skipped';
  stage: string;
  raw_excerpt?: string;
  detected_subjects: Array<Record<string, unknown>>;
  signals_created: number;
  memory_created: number;
  skipped: number;
  failure_reason?: string;
  failure_code?: string;
  attempt_count: number;
  locked_at?: string;
  next_retry_at?: string;
  last_error?: string;
  metadata: Record<string, unknown>;
  processed_at?: string;
  created_at: string;
  updated_at: string;
}

export type RawContextSourceStatus = RawContextSource['status'];

export interface RawContextSourceInput {
  source_type: string;
  source_ref: string;
  source_label?: string | null;
  subject_type?: SubjectType | string | null;
  subject_id?: UUID | string | null;
  actor_id?: UUID | string | null;
  status?: RawContextSourceStatus;
  stage?: string;
  raw_excerpt?: string | null;
  detected_subjects?: Array<Record<string, unknown>>;
  signals_created?: number;
  memory_created?: number;
  skipped?: number;
  failure_reason?: string | null;
  failure_code?: string | null;
  attempt_count?: number;
  locked_at?: string | null;
  next_retry_at?: string | null;
  last_error?: string | null;
  metadata?: Record<string, unknown>;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function normalizeActorId(
  db: DbPool,
  tenantId: UUID | string,
  actorId?: UUID | string | null,
): Promise<UUID | string | null> {
  if (!actorId) return null;
  if (!isUuid(String(actorId))) return null;
  const result = await db.query(
    `SELECT id
     FROM (
       SELECT id, 0 AS priority FROM actors WHERE tenant_id = $1 AND id = $2
       UNION ALL
       SELECT id, 1 AS priority FROM actors WHERE tenant_id = $1 AND user_id = $2
     ) matched_actor
     ORDER BY priority
     LIMIT 1`,
    [tenantId, actorId],
  );
  return result.rows[0]?.id ?? null;
}

export async function upsertRawContextSource(
  db: DbPool,
  tenantId: UUID | string,
  input: RawContextSourceInput,
): Promise<RawContextSource> {
  const actorId = await normalizeActorId(db, tenantId, input.actor_id);
  const result = await db.query(
    `INSERT INTO raw_context_sources (
       tenant_id, source_type, source_ref, source_label, subject_type, subject_id,
       actor_id, status, stage, raw_excerpt, detected_subjects, signals_created,
       memory_created, skipped, failure_reason, failure_code, attempt_count,
       locked_at, next_retry_at, last_error, metadata, processed_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
       CASE WHEN $8 IN ('processed', 'needs_review', 'failed', 'skipped') THEN now() ELSE NULL END
     )
     ON CONFLICT (tenant_id, source_type, source_ref)
     DO UPDATE SET
       source_label = COALESCE(EXCLUDED.source_label, raw_context_sources.source_label),
       subject_type = COALESCE(EXCLUDED.subject_type, raw_context_sources.subject_type),
       subject_id = COALESCE(EXCLUDED.subject_id, raw_context_sources.subject_id),
       actor_id = COALESCE(EXCLUDED.actor_id, raw_context_sources.actor_id),
       status = EXCLUDED.status,
       stage = EXCLUDED.stage,
       raw_excerpt = COALESCE(EXCLUDED.raw_excerpt, raw_context_sources.raw_excerpt),
       detected_subjects = CASE
         WHEN jsonb_array_length(EXCLUDED.detected_subjects) > 0 THEN EXCLUDED.detected_subjects
         ELSE raw_context_sources.detected_subjects
       END,
       signals_created = EXCLUDED.signals_created,
       memory_created = EXCLUDED.memory_created,
       skipped = EXCLUDED.skipped,
       failure_reason = EXCLUDED.failure_reason,
       failure_code = COALESCE(EXCLUDED.failure_code, raw_context_sources.failure_code),
       attempt_count = CASE
         WHEN EXCLUDED.status = 'processing' AND raw_context_sources.status <> 'processing'
           THEN raw_context_sources.attempt_count + 1
         ELSE GREATEST(raw_context_sources.attempt_count, EXCLUDED.attempt_count)
       END,
       locked_at = CASE
         WHEN EXCLUDED.status = 'processing' THEN COALESCE(EXCLUDED.locked_at, now())
         WHEN EXCLUDED.status IN ('processed', 'needs_review', 'failed', 'skipped') THEN NULL
         ELSE COALESCE(EXCLUDED.locked_at, raw_context_sources.locked_at)
       END,
       next_retry_at = COALESCE(EXCLUDED.next_retry_at, raw_context_sources.next_retry_at),
       last_error = CASE
         WHEN EXCLUDED.status IN ('processed', 'needs_review', 'skipped') THEN NULL
         ELSE COALESCE(EXCLUDED.last_error, raw_context_sources.last_error)
       END,
       metadata = raw_context_sources.metadata || EXCLUDED.metadata,
       processed_at = COALESCE(EXCLUDED.processed_at, raw_context_sources.processed_at),
       updated_at = now()
     RETURNING *`,
    [
      tenantId,
      input.source_type,
      input.source_ref,
      input.source_label ?? null,
      input.subject_type ?? null,
      input.subject_id ?? null,
      actorId,
      input.status ?? 'pending',
      input.stage ?? 'received',
      input.raw_excerpt ?? null,
      JSON.stringify(input.detected_subjects ?? []),
      input.signals_created ?? 0,
      input.memory_created ?? 0,
      input.skipped ?? 0,
      input.failure_reason ?? null,
      input.failure_code ?? null,
      input.attempt_count ?? (input.status === 'processing' ? 1 : 0),
      input.locked_at ?? (input.status === 'processing' ? new Date().toISOString() : null),
      input.next_retry_at ?? null,
      input.last_error ?? input.failure_reason ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0] as RawContextSource;
}

export async function updateRawContextSource(
  db: DbPool,
  tenantId: UUID | string,
  sourceType: string,
  sourceRef: string,
  patch: Partial<RawContextSourceInput>,
): Promise<RawContextSource | null> {
  const actorId = await normalizeActorId(db, tenantId, patch.actor_id);
  const result = await db.query(
    `UPDATE raw_context_sources
     SET status = COALESCE($4, status),
         stage = COALESCE($5, stage),
         source_label = COALESCE($6, source_label),
         subject_type = COALESCE($7, subject_type),
         subject_id = COALESCE($8, subject_id),
         actor_id = COALESCE($9, actor_id),
         raw_excerpt = COALESCE($10, raw_excerpt),
         detected_subjects = COALESCE($11::jsonb, detected_subjects),
         signals_created = COALESCE($12, signals_created),
         memory_created = COALESCE($13, memory_created),
         skipped = COALESCE($14, skipped),
         failure_reason = $15,
         failure_code = COALESCE($16, failure_code),
         attempt_count = CASE
           WHEN $4 = 'processing' AND status <> 'processing' THEN attempt_count + 1
           ELSE COALESCE($17, attempt_count)
         END,
         locked_at = CASE
           WHEN $4 = 'processing' THEN COALESCE($18, now())
           WHEN $4 IN ('processed', 'needs_review', 'failed', 'skipped') THEN NULL
           ELSE COALESCE($18, locked_at)
         END,
         next_retry_at = COALESCE($19, next_retry_at),
         last_error = CASE
           WHEN $4 IN ('processed', 'needs_review', 'skipped') THEN NULL
           ELSE COALESCE($20, last_error)
         END,
         metadata = metadata || COALESCE($21::jsonb, '{}'::jsonb),
         processed_at = CASE
           WHEN COALESCE($4, status) IN ('processed', 'needs_review', 'failed', 'skipped') THEN COALESCE(processed_at, now())
           ELSE processed_at
         END,
         updated_at = now()
     WHERE tenant_id = $1 AND source_type = $2 AND source_ref = $3
     RETURNING *`,
    [
      tenantId,
      sourceType,
      sourceRef,
      patch.status ?? null,
      patch.stage ?? null,
      patch.source_label ?? null,
      patch.subject_type ?? null,
      patch.subject_id ?? null,
      actorId,
      patch.raw_excerpt ?? null,
      patch.detected_subjects ? JSON.stringify(patch.detected_subjects) : null,
      patch.signals_created ?? null,
      patch.memory_created ?? null,
      patch.skipped ?? null,
      patch.failure_reason ?? null,
      patch.failure_code ?? (typeof patch.metadata?.failure_code === 'string' ? patch.metadata.failure_code : null),
      patch.attempt_count ?? null,
      patch.locked_at ?? null,
      patch.next_retry_at ?? null,
      patch.last_error ?? patch.failure_reason ?? null,
      patch.metadata ? JSON.stringify(patch.metadata) : null,
    ],
  );
  return (result.rows[0] as RawContextSource | undefined) ?? null;
}

export async function getRawContextSource(
  db: DbPool,
  tenantId: UUID | string,
  id: UUID | string,
): Promise<RawContextSource | null> {
  const result = await db.query(
    `SELECT * FROM raw_context_sources WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return (result.rows[0] as RawContextSource | undefined) ?? null;
}

export async function getRawContextSourceByRef(
  db: DbPool,
  tenantId: UUID | string,
  sourceType: string,
  sourceRef: string,
): Promise<RawContextSource | null> {
  const result = await db.query(
    `SELECT * FROM raw_context_sources WHERE tenant_id = $1 AND source_type = $2 AND source_ref = $3`,
    [tenantId, sourceType, sourceRef],
  );
  return (result.rows[0] as RawContextSource | undefined) ?? null;
}

export async function claimPendingRawContextSources(
  db: DbPool,
  limit = 10,
): Promise<RawContextSource[]> {
  const result = await db.query(
    `WITH target AS (
       SELECT id
       FROM raw_context_sources
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= now())
       ORDER BY COALESCE(next_retry_at, updated_at), updated_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE raw_context_sources r
     SET status = 'processing',
         stage = 'worker_claimed',
         locked_at = now(),
         attempt_count = attempt_count + 1,
         last_error = NULL,
         updated_at = now()
     FROM target
     WHERE r.id = target.id
     RETURNING r.*`,
    [limit],
  );
  return result.rows as RawContextSource[];
}

export async function listRawContextSources(
  db: DbPool,
  tenantId: UUID | string,
  filters: {
    source_type?: string;
    status?: RawContextSourceStatus;
    subject_type?: string;
    subject_id?: string;
    query?: string;
    owner_ids?: string[];
    actor_ids?: string[];
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<RawContextSource>> {
  const conditions = ['r.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.source_type) {
    conditions.push(`r.source_type = $${idx++}`);
    params.push(filters.source_type);
  }
  if (filters.status) {
    conditions.push(`r.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.subject_type) {
    conditions.push(`r.subject_type = $${idx++}`);
    params.push(filters.subject_type);
  }
  if (filters.subject_id) {
    conditions.push(`r.subject_id = $${idx++}`);
    params.push(filters.subject_id);
  }
  if (filters.query?.trim()) {
    const textQuery = filters.query.trim();
    conditions.push(`(
      to_tsvector('english', coalesce(r.source_label, '') || ' ' || coalesce(r.source_ref, '') || ' ' || coalesce(r.source_type, '') || ' ' || coalesce(r.raw_excerpt, '')) @@ plainto_tsquery('english', $${idx})
      OR r.source_label ILIKE $${idx + 1}
      OR r.source_ref ILIKE $${idx + 1}
      OR r.source_type ILIKE $${idx + 1}
      OR r.raw_excerpt ILIKE $${idx + 1}
    )`);
    params.push(textQuery, `%${textQuery}%`);
    idx += 2;
  }
  if (filters.cursor) {
    conditions.push(`r.created_at < $${idx++}`);
    params.push(filters.cursor);
  }
  if (filters.owner_ids) {
    const actorIds = filters.actor_ids ?? [];
    if (filters.owner_ids.length === 0) {
      if (actorIds.length === 0) {
        conditions.push('FALSE');
      } else {
        conditions.push(`(r.subject_id IS NULL AND r.actor_id = ANY($${idx}::uuid[]))`);
        params.push(actorIds);
        idx++;
      }
    } else {
      conditions.push(`(
        (r.subject_id IS NULL AND ${actorIds.length > 0 ? `r.actor_id = ANY($${idx + 1}::uuid[])` : 'FALSE'})
	        OR EXISTS (SELECT 1 FROM accounts a WHERE a.tenant_id = r.tenant_id AND r.subject_type = 'account' AND a.id = r.subject_id AND a.owner_id = ANY($${idx}::uuid[]) AND a.archived_at IS NULL)
	        OR EXISTS (SELECT 1 FROM contacts c WHERE c.tenant_id = r.tenant_id AND r.subject_type = 'contact' AND c.id = r.subject_id AND c.owner_id = ANY($${idx}::uuid[]) AND c.archived_at IS NULL)
	        OR EXISTS (SELECT 1 FROM opportunities o WHERE o.tenant_id = r.tenant_id AND r.subject_type = 'opportunity' AND o.id = r.subject_id AND o.owner_id = ANY($${idx}::uuid[]) AND o.archived_at IS NULL)
	        OR EXISTS (SELECT 1 FROM use_cases uc WHERE uc.tenant_id = r.tenant_id AND r.subject_type = 'use_case' AND uc.id = r.subject_id AND uc.owner_id = ANY($${idx}::uuid[]) AND uc.archived_at IS NULL)
      )`);
      params.push(filters.owner_ids);
      if (actorIds.length > 0) params.push(actorIds);
      idx++;
      if (actorIds.length > 0) idx++;
    }
  }

  const where = conditions.join(' AND ');
  const count = await db.query(`SELECT count(*)::int AS total FROM raw_context_sources r WHERE ${where}`, params);
  params.push(filters.limit + 1);
  const rows = await db.query(
    `SELECT r.* FROM raw_context_sources r WHERE ${where} ORDER BY r.created_at DESC LIMIT $${idx}`,
    params,
  );
  const data = rows.rows as RawContextSource[];
  const hasMore = data.length > filters.limit;
  const page = hasMore ? data.slice(0, filters.limit) : data;
  return {
    data: page,
    next_cursor: hasMore ? page[page.length - 1]?.created_at : undefined,
    total: count.rows[0]?.total ?? 0,
  };
}
