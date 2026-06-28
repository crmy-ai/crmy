// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext, UUID } from '@crmy/shared';
import { permissionDenied, validationError } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import { emitEvent } from '../events/emitter.js';

export interface DataQualityCheck {
  name: string;
  severity: 'info' | 'warning' | 'critical';
  count: number;
  sample: Record<string, unknown>[];
  error?: string;
}

interface CheckSpec {
  name: string;
  severity: DataQualityCheck['severity'];
  sql: string;
}

export type RepairableDataQualityCheck =
  | 'activities_missing_canonical_subject'
  | 'current_context_missing_search_index'
  | 'stuck_context_outbox_processing'
  | 'stale_sources_processing'
  | 'stuck_source_extraction_attempts_running'
  | 'failed_sources_retryable'
  | 'stuck_agent_turns_running';

export interface DataQualityRepairResult {
  check_name: RepairableDataQualityCheck;
  dry_run: boolean;
  action: string;
  repaired_count: number;
  event_id?: number;
}

const CHECKS: CheckSpec[] = [
  {
    name: 'invalid_contact_lifecycle_stage',
    severity: 'critical',
    sql: `
      SELECT id, lifecycle_stage
      FROM contacts
      WHERE tenant_id = $1
        AND lifecycle_stage NOT IN ('lead', 'prospect', 'customer', 'churned')
      ORDER BY updated_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'invalid_opportunity_stage',
    severity: 'critical',
    sql: `
      SELECT id, stage
      FROM opportunities
      WHERE tenant_id = $1
        AND stage NOT IN ('prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost')
      ORDER BY updated_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'invalid_opportunity_forecast_category',
    severity: 'critical',
    sql: `
      SELECT id, forecast_cat
      FROM opportunities
      WHERE tenant_id = $1
        AND forecast_cat NOT IN ('pipeline', 'best_case', 'commit', 'closed')
      ORDER BY updated_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'activities_missing_canonical_subject',
    severity: 'warning',
    sql: `
      SELECT id, type, contact_id, account_id, opportunity_id, use_case_id
      FROM activities
      WHERE tenant_id = $1
        AND (subject_type IS NULL OR subject_id IS NULL)
        AND (contact_id IS NOT NULL OR account_id IS NOT NULL OR opportunity_id IS NOT NULL OR use_case_id IS NOT NULL)
      ORDER BY created_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'context_entries_missing_author_actor',
    severity: 'critical',
    sql: `
      SELECT c.id, c.authored_by, c.subject_type, c.subject_id
      FROM context_entries c
      LEFT JOIN actors a ON a.id = c.authored_by AND a.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND a.id IS NULL
      ORDER BY c.created_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'activities_missing_performer_actor',
    severity: 'warning',
    sql: `
      SELECT act.id, act.performed_by, act.subject_type, act.subject_id
      FROM activities act
      LEFT JOIN actors a ON a.id = act.performed_by AND a.tenant_id = act.tenant_id
      WHERE act.tenant_id = $1 AND act.performed_by IS NOT NULL AND a.id IS NULL
      ORDER BY act.created_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'open_assignments_missing_assignee',
    severity: 'critical',
    sql: `
      SELECT assn.id, assn.assigned_to, assn.status
      FROM assignments assn
      LEFT JOIN actors a ON a.id = assn.assigned_to AND a.tenant_id = assn.tenant_id
      WHERE assn.tenant_id = $1
        AND assn.status NOT IN ('completed', 'declined', 'cancelled')
        AND a.id IS NULL
      ORDER BY assn.created_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'current_context_missing_search_index',
    severity: 'warning',
    sql: `
      SELECT c.id, c.subject_type, c.subject_id, c.context_type
      FROM context_entries c
      LEFT JOIN search_index si ON si.tenant_id = c.tenant_id
        AND si.entity_type = 'context_entry'
        AND si.entity_id = c.id
      WHERE c.tenant_id = $1
        AND c.is_current = true
        AND si.id IS NULL
      ORDER BY c.created_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'stuck_context_outbox_processing',
    severity: 'warning',
    sql: `
      SELECT id, entity_type, entity_id, status, attempt_count, created_at
      FROM context_outbox
      WHERE tenant_id = $1
        AND status = 'processing'
        AND created_at < now() - interval '15 minutes'
      ORDER BY created_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'stale_sources_processing',
    severity: 'warning',
    sql: `
      SELECT id, source_type, source_ref, stage, attempt_count, failure_code, updated_at
      FROM raw_context_sources
      WHERE tenant_id = $1
        AND status = 'processing'
        AND updated_at < now() - interval '15 minutes'
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'failed_sources_retryable',
    severity: 'warning',
    sql: `
      SELECT id, source_type, source_ref, stage, attempt_count, failure_code, failure_reason, updated_at
      FROM raw_context_sources
      WHERE tenant_id = $1
        AND status = 'failed'
        AND COALESCE(attempt_count, 0) < 3
        AND (
          failure_code IS NULL
          OR failure_code IN ('model_timeout', 'model_output_invalid', 'model_failed', 'write_failed', 'processing_timeout')
        )
      ORDER BY updated_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'failed_source_extraction_attempts',
    severity: 'warning',
    sql: `
      SELECT id, raw_context_source_id, activity_id, attempt_number, outcome, failure_code, failure_reason, started_at
      FROM raw_context_extraction_attempts
      WHERE tenant_id = $1
        AND status = 'failed'
        AND started_at > now() - interval '7 days'
      ORDER BY started_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'stuck_source_extraction_attempts_running',
    severity: 'warning',
    sql: `
      SELECT id, raw_context_source_id, activity_id, attempt_number, stage, timeout_ms, started_at
      FROM raw_context_extraction_attempts
      WHERE tenant_id = $1
        AND status = 'running'
        AND started_at < now() - interval '15 minutes'
      ORDER BY started_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'stuck_agent_turns_running',
    severity: 'warning',
    sql: `
      SELECT id, session_id, status, started_at, updated_at, error_message
      FROM agent_turns
      WHERE tenant_id = $1
        AND status = 'running'
        AND updated_at < now() - interval '20 minutes'
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'stuck_external_writebacks_executing',
    severity: 'warning',
    sql: `
      SELECT id, system_id, object_type, object_id, external_object, external_record_id,
             status, execution_result->'provider_call' AS provider_call, updated_at
      FROM external_writeback_requests
      WHERE tenant_id = $1
        AND status = 'executing'
        AND updated_at < now() - interval '15 minutes'
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'stuck_emails_sending',
    severity: 'warning',
    sql: `
      SELECT id, to_email, subject, status,
             generation_metadata->'delivery_attempt' AS delivery_attempt,
             updated_at
      FROM emails
      WHERE tenant_id = $1
        AND status = 'sending'
        AND updated_at < now() - interval '15 minutes'
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'stale_mailbox_sync_jobs',
    severity: 'warning',
    sql: `
      SELECT id, connection_id, status, attempts, last_error, updated_at
      FROM mailbox_sync_jobs
      WHERE tenant_id = $1
        AND (
          (status = 'processing' AND updated_at < now() - interval '15 minutes')
          OR (status = 'failed' AND attempts < 5)
        )
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'stale_calendar_sync_jobs',
    severity: 'warning',
    sql: `
      SELECT id, connection_id, status, attempts, last_error, updated_at
      FROM calendar_sync_jobs
      WHERE tenant_id = $1
        AND (
          (status = 'processing' AND updated_at < now() - interval '15 minutes')
          OR (status = 'failed' AND attempts < 5)
        )
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'stale_context_source_sync_jobs',
    severity: 'warning',
    sql: `
      SELECT id, connection_id, status, attempts, last_error, updated_at
      FROM context_source_sync_jobs
      WHERE tenant_id = $1
        AND (
          (status = 'processing' AND updated_at < now() - interval '15 minutes')
          OR (status = 'failed' AND attempts < 5)
        )
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'stale_context_source_processing_jobs',
    severity: 'warning',
    sql: `
      SELECT id, source_object_id, status, attempts, last_error, updated_at
      FROM context_source_processing_jobs
      WHERE tenant_id = $1
        AND (
          (status = 'processing' AND updated_at < now() - interval '15 minutes')
          OR (status = 'failed' AND attempts < 5)
        )
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'failed_context_source_objects',
    severity: 'warning',
    sql: `
      SELECT id, object_key, match_status, processing_status, failure_code, failure_reason, updated_at
      FROM context_source_objects
      WHERE tenant_id = $1
        AND processing_status = 'failed'
      ORDER BY updated_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'context_source_objects_need_review',
    severity: 'info',
    sql: `
      SELECT id, object_key, match_status, processing_status, match_reason, failure_reason, updated_at
      FROM context_source_objects
      WHERE tenant_id = $1
        AND match_status IN ('needs_review', 'ambiguous')
        AND processing_status <> 'ignored'
      ORDER BY updated_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'customer_calendar_events_missing_link',
    severity: 'info',
    sql: `
      SELECT id, subject, starts_at, classification, validation_status
      FROM calendar_events
      WHERE tenant_id = $1
        AND ignored_at IS NULL
        AND classification NOT IN ('internal', 'unknown')
        AND account_id IS NULL
        AND contact_id IS NULL
        AND opportunity_id IS NULL
        AND use_case_id IS NULL
      ORDER BY starts_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'failed_context_embedding_jobs',
    severity: 'warning',
    sql: `
      SELECT id, entity_type, entity_id, attempt_count, last_error, updated_at
      FROM context_embedding_jobs
      WHERE tenant_id = $1
        AND status = 'failed'
      ORDER BY updated_at DESC
      LIMIT $2
    `,
  },
  {
    name: 'current_context_missing_embedding',
    severity: 'info',
    sql: `
      SELECT c.id, c.subject_type, c.subject_id, c.context_type
      FROM context_entries c
      WHERE c.tenant_id = $1
        AND c.is_current = true
        AND EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'vector'
        )
        AND (to_jsonb(c)->'embedding') IS NULL
      ORDER BY c.created_at DESC
      LIMIT $2
    `,
  },
];

async function runCheck(db: DbPool, tenantId: UUID, spec: CheckSpec, sampleLimit: number): Promise<DataQualityCheck> {
  try {
    const result = await db.query<Record<string, unknown>>(spec.sql, [tenantId, sampleLimit]);
    return {
      name: spec.name,
      severity: spec.severity,
      count: result.rows.length,
      sample: result.rows,
    };
  } catch (err) {
    return {
      name: spec.name,
      severity: spec.severity,
      count: 0,
      sample: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getDataQualityReport(
  db: DbPool,
  tenantId: UUID,
  sampleLimit = 10,
): Promise<{ generated_at: string; checks: DataQualityCheck[]; summary: Record<string, number> }> {
  const checks = await Promise.all(
    CHECKS.map(spec => runCheck(db, tenantId, spec, sampleLimit)),
  );
  const summary = checks.reduce<Record<string, number>>((acc, check) => {
    acc.total_findings += check.count;
    acc[check.severity] += check.count;
    if (check.error) acc.errors += 1;
    return acc;
  }, { total_findings: 0, critical: 0, warning: 0, info: 0, errors: 0 });

  return {
    generated_at: new Date().toISOString(),
    checks,
    summary,
  };
}

function assertAdmin(actor: ActorContext): void {
  if (actor.role !== 'admin' && actor.role !== 'owner') {
    throw permissionDenied('Only admins and owners can repair data-quality findings');
  }
}

function ensureRepairable(checkName: string): asserts checkName is RepairableDataQualityCheck {
  if (
    checkName !== 'activities_missing_canonical_subject' &&
    checkName !== 'current_context_missing_search_index' &&
    checkName !== 'stuck_context_outbox_processing' &&
    checkName !== 'stale_sources_processing' &&
    checkName !== 'stuck_source_extraction_attempts_running' &&
    checkName !== 'failed_sources_retryable' &&
    checkName !== 'stuck_agent_turns_running'
  ) {
    throw validationError(`Data-quality check "${checkName}" is not safely auto-repairable`);
  }
}

async function countRows(db: DbPool, sql: string, params: unknown[]): Promise<number> {
  const result = await db.query<{ count: number | string }>(sql, params);
  return Number(result.rows[0]?.count ?? 0);
}

const REPAIR_ACTIONS: Record<RepairableDataQualityCheck, {
  action: string;
  countSql: string;
  repairSql: string;
}> = {
  activities_missing_canonical_subject: {
    action: 'Backfill activities.subject_type and activities.subject_id from existing contact/account/opportunity/use_case links.',
    countSql: `
      SELECT count(*)::int AS count
      FROM activities
      WHERE tenant_id = $1
        AND (subject_type IS NULL OR subject_id IS NULL)
        AND (contact_id IS NOT NULL OR account_id IS NOT NULL OR opportunity_id IS NOT NULL OR use_case_id IS NOT NULL)
    `,
    repairSql: `
      WITH target AS (
        SELECT id,
               CASE
                 WHEN contact_id IS NOT NULL THEN 'contact'
                 WHEN account_id IS NOT NULL THEN 'account'
                 WHEN opportunity_id IS NOT NULL THEN 'opportunity'
                 WHEN use_case_id IS NOT NULL THEN 'use_case'
               END AS next_subject_type,
               CASE
                 WHEN contact_id IS NOT NULL THEN contact_id
                 WHEN account_id IS NOT NULL THEN account_id
                 WHEN opportunity_id IS NOT NULL THEN opportunity_id
                 WHEN use_case_id IS NOT NULL THEN use_case_id
               END AS next_subject_id
        FROM activities
        WHERE tenant_id = $1
          AND (subject_type IS NULL OR subject_id IS NULL)
          AND (contact_id IS NOT NULL OR account_id IS NOT NULL OR opportunity_id IS NOT NULL OR use_case_id IS NOT NULL)
        ORDER BY created_at DESC
        LIMIT $2
      )
      UPDATE activities a
      SET subject_type = target.next_subject_type,
          subject_id = target.next_subject_id,
          updated_at = now()
      FROM target
      WHERE a.id = target.id
    `,
  },
  current_context_missing_search_index: {
    action: 'Enqueue missing current context entries for search-index backfill without writing synthetic index rows.',
    countSql: `
      SELECT count(*)::int AS count
      FROM context_entries c
      LEFT JOIN search_index si ON si.tenant_id = c.tenant_id
        AND si.entity_type = 'context_entry'
        AND si.entity_id = c.id
      WHERE c.tenant_id = $1
        AND c.is_current = true
        AND si.id IS NULL
    `,
    repairSql: `
      WITH target AS (
        SELECT c.id,
               c.tenant_id,
               jsonb_build_object(
                 'subject_type', c.subject_type,
                 'subject_id', c.subject_id,
                 'context_type', c.context_type,
                 'repair_reason', 'current_context_missing_search_index'
               ) AS payload
        FROM context_entries c
        LEFT JOIN search_index si ON si.tenant_id = c.tenant_id
          AND si.entity_type = 'context_entry'
          AND si.entity_id = c.id
        WHERE c.tenant_id = $1
          AND c.is_current = true
          AND si.id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM context_outbox co
            WHERE co.tenant_id = c.tenant_id
              AND co.entity_type = 'context_entry'
              AND co.entity_id = c.id
              AND co.status IN ('pending', 'processing')
          )
        ORDER BY c.created_at DESC
        LIMIT $2
      )
      INSERT INTO context_outbox (tenant_id, entity_type, entity_id, payload, status)
      SELECT tenant_id, 'context_entry', id, payload, 'pending'
      FROM target
    `,
  },
  stuck_context_outbox_processing: {
    action: 'Return context outbox jobs stuck in processing for more than 15 minutes to pending for worker pickup.',
    countSql: `
      SELECT count(*)::int AS count
      FROM context_outbox
      WHERE tenant_id = $1
        AND status = 'processing'
        AND created_at < now() - interval '15 minutes'
    `,
    repairSql: `
      WITH target AS (
        SELECT id
        FROM context_outbox
        WHERE tenant_id = $1
          AND status = 'processing'
          AND created_at < now() - interval '15 minutes'
        ORDER BY created_at ASC
        LIMIT $2
      )
      UPDATE context_outbox co
      SET status = 'pending'
      FROM target
      WHERE co.id = target.id
    `,
  },
  stale_sources_processing: {
    action: 'Return stale Source processing receipts to pending and requeue the linked activity extraction when possible.',
    countSql: `
      SELECT count(*)::int AS count
      FROM raw_context_sources
      WHERE tenant_id = $1
        AND status = 'processing'
        AND updated_at < now() - interval '15 minutes'
    `,
    repairSql: `
      WITH target AS (
        SELECT id, source_ref
        FROM raw_context_sources
        WHERE tenant_id = $1
          AND status = 'processing'
          AND updated_at < now() - interval '15 minutes'
        ORDER BY updated_at ASC
        LIMIT $2
      ),
      activity_reset AS (
        UPDATE activities a
        SET extraction_status = 'pending',
            extraction_error = NULL,
            updated_at = now()
        FROM target
        WHERE a.tenant_id = $1
          AND a.id::text = target.source_ref
        RETURNING a.id
      )
      UPDATE raw_context_sources r
      SET status = 'pending',
          stage = 'retrying',
          locked_at = NULL,
          next_retry_at = now(),
          failure_code = COALESCE(failure_code, 'processing_timeout'),
          last_error = COALESCE(last_error, 'Processing was interrupted and queued for retry.'),
          failure_reason = COALESCE(failure_reason, 'Processing was interrupted and queued for retry.'),
          updated_at = now()
      FROM target
      WHERE r.id = target.id
    `,
  },
  failed_sources_retryable: {
    action: 'Return retryable Source failures to pending so the shared extraction path can replay them.',
    countSql: `
      SELECT count(*)::int AS count
      FROM raw_context_sources
      WHERE tenant_id = $1
        AND status = 'failed'
        AND COALESCE(attempt_count, 0) < 3
        AND (
          failure_code IS NULL
          OR failure_code IN ('model_timeout', 'model_output_invalid', 'model_failed', 'write_failed', 'processing_timeout')
        )
    `,
    repairSql: `
      WITH target AS (
        SELECT id
        FROM raw_context_sources
        WHERE tenant_id = $1
          AND status = 'failed'
          AND COALESCE(attempt_count, 0) < 3
          AND (
            failure_code IS NULL
            OR failure_code IN ('model_timeout', 'model_output_invalid', 'model_failed', 'write_failed', 'processing_timeout')
          )
        ORDER BY updated_at ASC
        LIMIT $2
      )
      UPDATE raw_context_sources r
      SET status = 'pending',
          stage = 'retrying',
          locked_at = NULL,
          next_retry_at = now(),
          last_error = NULL,
          failure_reason = NULL,
          failure_code = NULL,
          updated_at = now()
      FROM target
      WHERE r.id = target.id
    `,
  },
  stuck_source_extraction_attempts_running: {
    action: 'Mark stale Source extraction attempts failed and requeue the linked activity/source for retry.',
    countSql: `
      SELECT count(*)::int AS count
      FROM raw_context_extraction_attempts
      WHERE tenant_id = $1
        AND status = 'running'
        AND started_at < now() - interval '15 minutes'
    `,
    repairSql: `
      WITH target AS (
        SELECT id, raw_context_source_id, activity_id, started_at
        FROM raw_context_extraction_attempts
        WHERE tenant_id = $1
          AND status = 'running'
          AND started_at < now() - interval '15 minutes'
        ORDER BY started_at ASC
        LIMIT $2
      ),
      source_reset AS (
        UPDATE raw_context_sources r
        SET status = 'pending',
            stage = 'retrying',
            locked_at = NULL,
            next_retry_at = now(),
            failure_code = COALESCE(failure_code, 'processing_timeout'),
            last_error = COALESCE(last_error, 'Extraction was interrupted and queued for retry.'),
            failure_reason = COALESCE(failure_reason, 'Extraction was interrupted and queued for retry.'),
            updated_at = now()
        FROM target
        WHERE r.tenant_id = $1
          AND r.id = target.raw_context_source_id
        RETURNING r.id
      ),
      activity_reset AS (
        UPDATE activities a
        SET extraction_status = 'pending',
            extraction_error = NULL,
            updated_at = now()
        FROM target
        WHERE a.tenant_id = $1
          AND a.id = target.activity_id
        RETURNING a.id
      )
      UPDATE raw_context_extraction_attempts ea
      SET status = 'failed',
          outcome = COALESCE(outcome, 'processing_timeout'),
          failure_code = COALESCE(failure_code, 'processing_timeout'),
          failure_reason = COALESCE(failure_reason, 'Extraction was interrupted and marked failed by recovery.'),
          latency_ms = COALESCE(latency_ms, GREATEST(0, (EXTRACT(EPOCH FROM (now() - target.started_at)) * 1000)::int)),
          completed_at = COALESCE(completed_at, now()),
          updated_at = now()
      FROM target
      WHERE ea.id = target.id
    `,
  },
  stuck_agent_turns_running: {
    action: 'Mark agent turns with expired leases as failed so the user can retry without a locked session.',
    countSql: `
      SELECT count(*)::int AS count
      FROM agent_turns
      WHERE tenant_id = $1
        AND status = 'running'
        AND (
          lease_expires_at < now()
          OR (lease_expires_at IS NULL AND updated_at < now() - interval '20 minutes')
        )
    `,
    repairSql: `
      WITH target AS (
        SELECT id
        FROM agent_turns
        WHERE tenant_id = $1
          AND status = 'running'
          AND (
            lease_expires_at < now()
            OR (lease_expires_at IS NULL AND updated_at < now() - interval '20 minutes')
          )
        ORDER BY updated_at ASC
        LIMIT $2
      )
      UPDATE agent_turns t
      SET status = 'failed',
          worker_id = NULL,
          lease_expires_at = NULL,
          error_message = COALESCE(error_message, 'Agent turn was interrupted and marked failed by recovery.'),
          completed_at = COALESCE(completed_at, now()),
          updated_at = now()
      FROM target
      WHERE t.id = target.id
    `,
  },
};

export async function repairDataQualityFinding(
  db: DbPool,
  actor: ActorContext,
  checkName: string,
  options: { dry_run?: boolean; limit?: number } = {},
): Promise<DataQualityRepairResult> {
  assertAdmin(actor);
  ensureRepairable(checkName);

  const dryRun = options.dry_run ?? true;
  const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
  const spec = REPAIR_ACTIONS[checkName];

  const repairedCount = dryRun
    ? await countRows(db, spec.countSql, [actor.tenant_id])
    : (await db.query(spec.repairSql, [actor.tenant_id, limit])).rowCount ?? 0;

  const result: DataQualityRepairResult = {
    check_name: checkName,
    dry_run: dryRun,
    action: spec.action,
    repaired_count: repairedCount,
  };

  if (!dryRun) {
    result.event_id = await emitEvent(db, {
      tenantId: actor.tenant_id,
      eventType: 'ops.data_quality_repaired',
      actorId: actor.actor_id,
      actorType: actor.actor_type,
      objectType: 'data_quality',
      afterData: result,
      metadata: { check_name: checkName, limit },
    });
  }

  return result;
}
