// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { schemaGet, tenantGetStats } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as searchRepo from '../../db/repos/search.js';
import * as customFieldRepo from '../../db/repos/custom-fields.js';
import { getAuditTrail } from '../../services/audit.js';
import { getDataQualityReport, repairDataQualityFinding } from '../../services/data-quality.js';
import { recoverOperationalJob } from '../../services/operational-recovery.js';
import { getAutomationSchedulerHealth } from '../../services/scheduler-health.js';
import {
  applyRetentionPolicy,
  deleteSubjectForPrivacy,
  exportSubjectData,
  redactSubjectPii,
} from '../../services/privacy-governance.js';
import type { ToolDef } from '../server.js';
import { runToolOperation } from '../tool-operation.js';

const opsStatusGet = z.object({
  include_samples: z.boolean().optional().default(true),
  sample_limit: z.number().int().min(1).max(20).optional().default(5),
});

const opsJobRecover = z.object({
  queue_name: z.enum([
    'context_outbox',
    'raw_context_sources',
    'agent_turns',
    'context_embedding_jobs',
    'mailbox_sync_jobs',
    'calendar_sync_jobs',
    'webhook_deliveries',
    'message_deliveries',
    'bulk_jobs',
    'workflow_runs',
    'sequence_step_executions',
  ]),
  job_id: z.string().uuid(),
  action: z.enum(['retry', 'park', 'mark_failed']),
  reason: z.string().max(1000).optional(),
  idempotency_key: z.string().max(128).optional(),
});

const opsDataQualityGet = z.object({
  sample_limit: z.number().int().min(1).max(100).optional().default(10),
  include_clean: z.boolean().optional().default(true),
});

const opsDataQualityRepair = z.object({
  check_name: z.enum([
    'activities_missing_canonical_subject',
    'current_context_missing_search_index',
    'stuck_context_outbox_processing',
    'stale_raw_context_sources_processing',
    'stuck_raw_context_extraction_attempts_running',
    'failed_raw_context_sources_retryable',
    'stuck_agent_turns_running',
  ]),
  dry_run: z.boolean().optional().default(true),
  limit: z.number().int().min(1).max(1000).optional().default(100),
  idempotency_key: z.string().max(128).optional(),
});

const opsAuditGet = z.object({
  object_type: z.string().optional(),
  object_id: z.string().uuid().optional(),
  actor_id: z.string().optional(),
  event_type: z.string().optional(),
  since: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});

const privacySubjectType = z.enum(['contact', 'account', 'opportunity', 'use_case']);

const opsPrivacyExport = z.object({
  subject_type: privacySubjectType,
  subject_id: z.string().uuid(),
});

const opsPiiRedact = z.object({
  subject_type: z.enum(['contact', 'account']),
  subject_id: z.string().uuid(),
  reason: z.string().min(1).max(1000),
  dry_run: z.boolean().optional().default(true),
  idempotency_key: z.string().max(128).optional(),
});

const opsPrivacyDelete = z.object({
  subject_type: privacySubjectType,
  subject_id: z.string().uuid(),
  reason: z.string().min(1).max(1000),
  dry_run: z.boolean().optional().default(true),
  idempotency_key: z.string().max(128).optional(),
});

const opsRetentionApply = z.object({
  older_than_days: z.number().int().min(1),
  targets: z.array(z.enum(['events', 'ops_recovery_log', 'context_outbox_complete', 'idempotency_keys'])).min(1),
  dry_run: z.boolean().optional().default(true),
  idempotency_key: z.string().max(128).optional(),
});

const FIELD_SCHEMAS: Record<string, { name: string; type: string; required: boolean }[]> = {
  contact: [
    { name: 'first_name', type: 'string', required: true },
    { name: 'last_name', type: 'string', required: false },
    { name: 'email', type: 'string', required: false },
    { name: 'phone', type: 'string', required: false },
    { name: 'title', type: 'string', required: false },
    { name: 'company_name', type: 'string', required: false },
    { name: 'account_id', type: 'uuid', required: false },
    { name: 'owner_id', type: 'uuid', required: false },
    { name: 'lifecycle_stage', type: 'enum(lead,prospect,customer,churned)', required: true },
    { name: 'source', type: 'string', required: false },
    { name: 'tags', type: 'string[]', required: false },
    { name: 'custom_fields', type: 'json', required: false },
  ],
  account: [
    { name: 'name', type: 'string', required: true },
    { name: 'domain', type: 'string', required: false },
    { name: 'industry', type: 'string', required: false },
    { name: 'employee_count', type: 'integer', required: false },
    { name: 'annual_revenue', type: 'integer', required: false },
    { name: 'currency_code', type: 'string', required: false },
    { name: 'website', type: 'url', required: false },
    { name: 'parent_id', type: 'uuid', required: false },
    { name: 'owner_id', type: 'uuid', required: false },
    { name: 'health_score', type: 'integer(0-100)', required: false },
    { name: 'tags', type: 'string[]', required: false },
    { name: 'custom_fields', type: 'json', required: false },
  ],
  opportunity: [
    { name: 'name', type: 'string', required: true },
    { name: 'account_id', type: 'uuid', required: false },
    { name: 'contact_id', type: 'uuid', required: false },
    { name: 'owner_id', type: 'uuid', required: false },
    { name: 'stage', type: 'enum(prospecting,qualification,proposal,negotiation,closed_won,closed_lost)', required: true },
    { name: 'amount', type: 'integer', required: false },
    { name: 'currency_code', type: 'string', required: false },
    { name: 'close_date', type: 'date', required: false },
    { name: 'probability', type: 'integer(0-100)', required: false },
    { name: 'forecast_cat', type: 'enum(pipeline,best_case,commit,closed)', required: true },
    { name: 'description', type: 'string', required: false },
    { name: 'custom_fields', type: 'json', required: false },
  ],
  activity: [
    { name: 'type', type: 'enum(call,email,meeting,note,task)', required: true },
    { name: 'subject', type: 'string', required: true },
    { name: 'body', type: 'string', required: false },
    { name: 'status', type: 'string', required: false },
    { name: 'direction', type: 'enum(inbound,outbound)', required: false },
    { name: 'due_at', type: 'datetime', required: false },
    { name: 'completed_at', type: 'datetime', required: false },
    { name: 'contact_id', type: 'uuid', required: false },
    { name: 'account_id', type: 'uuid', required: false },
    { name: 'opportunity_id', type: 'uuid', required: false },
    { name: 'custom_fields', type: 'json', required: false },
  ],
  use_case: [
    { name: 'name', type: 'string', required: true },
    { name: 'description', type: 'string', required: false },
    { name: 'account_id', type: 'uuid', required: true },
    { name: 'opportunity_id', type: 'uuid', required: false },
    { name: 'owner_id', type: 'uuid', required: false },
    { name: 'stage', type: 'enum(discovery,validation,pilot,production,expansion,closed)', required: true },
    { name: 'unit_label', type: 'string', required: false },
    { name: 'consumption_current', type: 'integer', required: false },
    { name: 'consumption_capacity', type: 'integer', required: false },
    { name: 'consumption_unit', type: 'string', required: false },
    { name: 'attributed_arr', type: 'integer', required: false },
    { name: 'currency_code', type: 'string', required: false },
    { name: 'expansion_potential', type: 'integer', required: false },
    { name: 'health_score', type: 'integer(0-100)', required: false },
    { name: 'health_note', type: 'string', required: false },
    { name: 'target_prod_date', type: 'date', required: false },
    { name: 'tags', type: 'string[]', required: false },
    { name: 'custom_fields', type: 'json', required: false },
  ],
};

interface StatusCountRow {
  status: string;
  count: number;
  oldest_created_at: Date | string | null;
}

interface QueueStatus {
  name: string;
  available: boolean;
  counts_by_status: Record<string, number>;
  oldest_pending_at: string | null;
  recent_failures: Record<string, unknown>[];
  error?: string;
}

interface QueueSpec {
  name: string;
  countSql: string;
  failureSql: string;
  pendingStatuses: string[];
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function countsByStatus(rows: StatusCountRow[]): Record<string, number> {
  return Object.fromEntries(rows.map(row => [row.status, Number(row.count)]));
}

function oldestPending(rows: StatusCountRow[], pendingStatuses: string[]): string | null {
  const pendingTimes = rows
    .filter(row => pendingStatuses.includes(row.status) && row.oldest_created_at)
    .map(row => new Date(row.oldest_created_at as string | Date).getTime())
    .filter(Number.isFinite);

  if (pendingTimes.length === 0) return null;
  return new Date(Math.min(...pendingTimes)).toISOString();
}

async function getQueueStatus(
  db: DbPool,
  actor: ActorContext,
  spec: QueueSpec,
  sampleLimit: number,
  includeSamples: boolean
): Promise<QueueStatus> {
  try {
    const countsResult = await db.query<StatusCountRow>(spec.countSql, [actor.tenant_id]);
    const failuresResult = includeSamples
      ? await db.query<Record<string, unknown>>(spec.failureSql, [actor.tenant_id, sampleLimit])
      : { rows: [] };

    return {
      name: spec.name,
      available: true,
      counts_by_status: countsByStatus(countsResult.rows),
      oldest_pending_at: oldestPending(countsResult.rows, spec.pendingStatuses),
      recent_failures: failuresResult.rows,
    };
  } catch (err) {
    return {
      name: spec.name,
      available: false,
      counts_by_status: {},
      oldest_pending_at: null,
      recent_failures: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const QUEUE_SPECS: QueueSpec[] = [
  {
    name: 'context_outbox',
    pendingStatuses: ['pending', 'processing', 'failed'],
    countSql: `
      SELECT status, count(*)::int AS count, min(created_at) AS oldest_created_at
      FROM context_outbox
      WHERE tenant_id = $1
      GROUP BY status
    `,
    failureSql: `
      SELECT id, entity_type, entity_id, status, attempt_count, last_error, created_at, processed_at
      FROM context_outbox
      WHERE tenant_id = $1 AND status IN ('failed', 'processing', 'parked')
      ORDER BY created_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'context_embedding_jobs',
    pendingStatuses: ['pending', 'processing', 'failed'],
    countSql: `
      SELECT status, count(*)::int AS count, min(created_at) AS oldest_created_at
      FROM context_embedding_jobs
      WHERE tenant_id = $1
      GROUP BY status
    `,
    failureSql: `
      SELECT id, entity_type, entity_id, status, attempt_count, last_error, created_at, processed_at
      FROM context_embedding_jobs
      WHERE tenant_id = $1 AND status IN ('failed', 'processing')
      ORDER BY created_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'raw_context_sources',
    pendingStatuses: ['pending', 'processing', 'failed'],
    countSql: `
      SELECT status, count(*)::int AS count, min(created_at) AS oldest_created_at
      FROM raw_context_sources
      WHERE tenant_id = $1
      GROUP BY status
    `,
    failureSql: `
      SELECT id, source_type, source_ref, status, stage, attempt_count,
             failure_code, failure_reason, updated_at
      FROM raw_context_sources
      WHERE tenant_id = $1 AND status IN ('failed', 'processing')
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'agent_turns',
    pendingStatuses: ['queued', 'running'],
    countSql: `
      SELECT status, count(*)::int AS count, min(created_at) AS oldest_created_at
      FROM agent_turns
      WHERE tenant_id = $1
      GROUP BY status
    `,
    failureSql: `
      SELECT id, session_id, status, error_message, started_at, updated_at
      FROM agent_turns
      WHERE tenant_id = $1 AND status IN ('failed', 'running')
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'mailbox_sync_jobs',
    pendingStatuses: ['pending', 'processing', 'failed'],
    countSql: `
      SELECT status, count(*)::int AS count, min(created_at) AS oldest_created_at
      FROM mailbox_sync_jobs
      WHERE tenant_id = $1
      GROUP BY status
    `,
    failureSql: `
      SELECT id, connection_id, status, attempts, last_error, run_after, updated_at
      FROM mailbox_sync_jobs
      WHERE tenant_id = $1 AND status IN ('failed', 'processing')
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'calendar_sync_jobs',
    pendingStatuses: ['pending', 'processing', 'failed'],
    countSql: `
      SELECT status, count(*)::int AS count, min(created_at) AS oldest_created_at
      FROM calendar_sync_jobs
      WHERE tenant_id = $1
      GROUP BY status
    `,
    failureSql: `
      SELECT id, connection_id, status, attempts, last_error, run_after, updated_at
      FROM calendar_sync_jobs
      WHERE tenant_id = $1 AND status IN ('failed', 'processing')
      ORDER BY updated_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'workflow_runs',
    pendingStatuses: ['running'],
    countSql: `
      SELECT wr.status, count(*)::int AS count, min(wr.started_at) AS oldest_created_at
      FROM workflow_runs wr
      JOIN workflows w ON w.id = wr.workflow_id
      WHERE w.tenant_id = $1
      GROUP BY wr.status
    `,
    failureSql: `
      SELECT wr.id, wr.workflow_id, w.name AS workflow_name, wr.status, wr.error, wr.started_at, wr.completed_at
      FROM workflow_runs wr
      JOIN workflows w ON w.id = wr.workflow_id
      WHERE w.tenant_id = $1 AND wr.status IN ('failed', 'running', 'parked')
      ORDER BY wr.started_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'webhook_deliveries',
    pendingStatuses: ['pending', 'retrying'],
    countSql: `
      SELECT wd.status, count(*)::int AS count, min(wd.created_at) AS oldest_created_at
      FROM webhook_deliveries wd
      JOIN webhook_endpoints we ON we.id = wd.endpoint_id
      WHERE we.tenant_id = $1
      GROUP BY wd.status
    `,
    failureSql: `
      SELECT wd.id, wd.endpoint_id, wd.event_type, wd.status, wd.response_status,
             wd.attempt_count, wd.next_retry_at, wd.created_at
      FROM webhook_deliveries wd
      JOIN webhook_endpoints we ON we.id = wd.endpoint_id
      WHERE we.tenant_id = $1 AND wd.status IN ('failed', 'retrying', 'parked')
      ORDER BY wd.created_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'message_deliveries',
    pendingStatuses: ['pending', 'retrying'],
    countSql: `
      SELECT status, count(*)::int AS count, min(created_at) AS oldest_created_at
      FROM message_deliveries
      WHERE tenant_id = $1
      GROUP BY status
    `,
    failureSql: `
      SELECT id, channel_id, recipient, status, response_status, attempt_count,
             max_attempts, next_retry_at, error, created_at
      FROM message_deliveries
      WHERE tenant_id = $1 AND status IN ('failed', 'retrying', 'parked')
      ORDER BY created_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'bulk_jobs',
    pendingStatuses: ['queued', 'running'],
    countSql: `
      SELECT status, count(*)::int AS count, min(created_at) AS oldest_created_at
      FROM bulk_jobs
      WHERE tenant_id = $1
      GROUP BY status
    `,
    failureSql: `
      SELECT id, operation, object_type, status, total_rows, processed, succeeded,
             failed, started_at, completed_at, created_at
      FROM bulk_jobs
      WHERE tenant_id = $1 AND status IN ('failed', 'queued', 'running', 'parked')
      ORDER BY created_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'hitl_requests',
    pendingStatuses: ['pending'],
    countSql: `
      SELECT status, count(*)::int AS count, min(created_at) AS oldest_created_at
      FROM hitl_requests
      WHERE tenant_id = $1
      GROUP BY status
    `,
    failureSql: `
      SELECT id, agent_id, action_type, status, priority, expires_at,
             escalated_at, created_at
      FROM hitl_requests
      WHERE tenant_id = $1 AND status = 'pending'
      ORDER BY expires_at ASC
      LIMIT $2
    `,
  },
  {
    name: 'sequence_step_executions',
    pendingStatuses: ['pending', 'approval_pending'],
    countSql: `
      SELECT status, count(*)::int AS count, min(created_at) AS oldest_created_at
      FROM sequence_step_executions
      WHERE tenant_id = $1
      GROUP BY status
    `,
    failureSql: `
      SELECT id, enrollment_id, step_index, step_type, status, executed_at, error, created_at
      FROM sequence_step_executions
      WHERE tenant_id = $1 AND status IN ('failed', 'pending', 'approval_pending', 'parked')
      ORDER BY created_at ASC
      LIMIT $2
    `,
  },
];

export function metaTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'schema_get',
      tier: 'admin',
      description: 'Get the full schema for a typed revenue object including standard fields and any custom fields defined by the tenant. Agents should call this on first connect to understand the data model — it returns field names, types, required constraints, and available options for enum fields. Pass object_type as "contact", "account", "opportunity", "activity", or "use_case".',
      inputSchema: schemaGet,
      handler: async (input: z.infer<typeof schemaGet>, actor: ActorContext) => {
        const customFields = await customFieldRepo.listCustomFields(db, actor.tenant_id, input.object_type);
        const customFieldsSchema = Object.fromEntries(customFields.map(field => [
          field.field_key,
          {
            label: field.label,
            type: field.field_type,
            required: field.is_required,
            filterable: field.is_filterable,
            options: field.options ?? null,
          },
        ]));
        return {
          standard_fields: FIELD_SCHEMAS[input.object_type] ?? [],
          custom_fields_schema: customFieldsSchema,
          custom_fields: customFields.map(field => ({
            field_key: field.field_key,
            label: field.label,
            field_type: field.field_type,
            required: field.is_required,
            filterable: field.is_filterable,
            options: field.options ?? null,
          })),
        };
      },
    },
    {
      name: 'tenant_get_stats',
      tier: 'analytics',
      description: 'Get high-level statistics for the current tenant including total counts of contacts, accounts, opportunities, activities, and pipeline value. Useful for quick health checks and dashboard summaries.',
      inputSchema: tenantGetStats,
      handler: async (_input: z.infer<typeof tenantGetStats>, actor: ActorContext) => {
        return searchRepo.getTenantStats(db, actor.tenant_id);
      },
    },
    {
      name: 'ops_status_get',
      tier: 'admin',
      description: 'Get operator-visible durability status for the current tenant. Returns counts, oldest pending work, and recent failure samples across durable queues and async jobs such as context indexing, workflows, webhooks, messaging, bulk jobs, HITL requests, and sequence steps. Use this before or after agent runs to detect stuck context assembly, delivery failures, or work that needs human/operator attention.',
      inputSchema: opsStatusGet,
      handler: async (input: z.infer<typeof opsStatusGet>, actor: ActorContext) => {
        const queues = await Promise.all(
          QUEUE_SPECS.map(spec =>
            getQueueStatus(db, actor, spec, input.sample_limit, input.include_samples)
          )
        );
        const attentionRequired = queues.filter(queue => {
          if (!queue.available) return true;
          if (Object.keys(queue.counts_by_status).length === 0) return false;
          const failureCount =
            (queue.counts_by_status.failed ?? 0) +
            (queue.counts_by_status.retrying ?? 0) +
            (queue.counts_by_status.parked ?? 0);
          return failureCount > 0 || Boolean(queue.oldest_pending_at);
        });

        return {
          generated_at: new Date().toISOString(),
          tenant_id: actor.tenant_id,
          scheduler_health: await getAutomationSchedulerHealth(db, actor.tenant_id),
          queues,
          attention_required: attentionRequired.map(queue => ({
            name: queue.name,
            counts_by_status: queue.counts_by_status,
            oldest_pending_at: queue.oldest_pending_at,
            recent_failures: queue.recent_failures,
            error: queue.error,
          })),
        };
      },
    },
    {
      name: 'ops_job_recover',
      tier: 'admin',
      description: 'Retry, park, or mark failed a durable async job for the current tenant, and write an audit record to ops_recovery_log. Use retry to return recoverable jobs to worker pickup, park to stop noisy jobs from being retried while preserving them for inspection, and mark_failed to terminate stuck running/pending work with an operator reason. workflow_runs can be parked or marked failed, but cannot be retried from this tool because replaying workflow side effects requires a new workflow event.',
      inputSchema: opsJobRecover,
      handler: async (input: z.infer<typeof opsJobRecover>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'ops_job_recover', input, async () => {
          const result = await recoverOperationalJob(
            db,
            actor,
            input.queue_name,
            input.job_id,
            input.action,
            input.reason,
          );

          return {
            ...result,
            recovered_at: new Date().toISOString(),
          };
        });
      },
    },
    {
      name: 'ops_data_quality_get',
      tier: 'admin',
      description: 'Run tenant-scoped data-quality checks for invalid lifecycle/stage values, missing canonical activity subjects, orphaned actor links, missing search-index rows for current context, stuck context indexing work, stale Raw Context processing receipts, and stuck Raw Context extraction attempts. Use this before enterprise rollout, after migrations, and during incident triage to catch data drift that would make agents reason over stale or malformed customer state.',
      inputSchema: opsDataQualityGet,
      handler: async (input: z.infer<typeof opsDataQualityGet>, actor: ActorContext) => {
        const report = await getDataQualityReport(db, actor.tenant_id, input.sample_limit);
        return {
          ...report,
          checks: input.include_clean ? report.checks : report.checks.filter(check => check.count > 0 || check.error),
        };
      },
    },
    {
      name: 'ops_data_quality_repair',
      tier: 'admin',
      description: 'Repair safe tenant-scoped data-quality findings. Supports dry-run-first canonical activity subject backfill, current-context search-index backfill enqueueing, retrying stuck context outbox jobs, requeueing stale or retryable Raw Context processing receipts, and failing/requeueing stuck Raw Context extraction attempts. Higher-risk findings remain report-only and require operator review. Admin/owner only.',
      inputSchema: opsDataQualityRepair,
      handler: async (input: z.infer<typeof opsDataQualityRepair>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'ops_data_quality_repair', input, async () => {
          return repairDataQualityFinding(db, actor, input.check_name, {
            dry_run: input.dry_run,
            limit: input.limit,
          });
        });
      },
    },
    {
      name: 'ops_audit_get',
      tier: 'admin',
      description: 'Retrieve tenant-scoped audit events from the append-only event log. Filter by object, actor, event type, or since timestamp to answer who changed what, from what, to what, and when. Use this for enterprise audit review, incident triage, and change-history inspection.',
      inputSchema: opsAuditGet,
      handler: async (input: z.infer<typeof opsAuditGet>, actor: ActorContext) => {
        const events = await getAuditTrail(db, actor.tenant_id, input);
        return {
          audit_events: events,
          total: events.length,
        };
      },
    },
    {
      name: 'ops_privacy_export',
      tier: 'admin',
      description: 'Export all tenant-scoped data directly attached to a CRM subject for privacy, legal, or customer data access workflows. Returns the subject, activities, context entries, assignments, and audit events. Admin/owner only.',
      inputSchema: opsPrivacyExport,
      handler: async (input: z.infer<typeof opsPrivacyExport>, actor: ActorContext) => {
        return exportSubjectData(db, actor, input.subject_type, input.subject_id);
      },
    },
    {
      name: 'ops_pii_redact',
      tier: 'admin',
      description: 'Redact direct PII fields from a contact or account. Defaults to dry_run=true so operators can preview affected fields before applying. Contact redaction clears name/email/phone/title/source/custom fields; account redaction clears domain/website/custom fields. Admin/owner only.',
      inputSchema: opsPiiRedact,
      handler: async (input: z.infer<typeof opsPiiRedact>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'ops_pii_redact', input, async () => {
          return redactSubjectPii(db, actor, input.subject_type, input.subject_id, input.reason, input.dry_run);
        });
      },
    },
    {
      name: 'ops_privacy_delete',
      tier: 'admin',
      description: 'Delete a CRM subject for privacy compliance after export/review. Defaults to dry_run=true and reports affected linked rows before deletion. Admin/owner only.',
      inputSchema: opsPrivacyDelete,
      handler: async (input: z.infer<typeof opsPrivacyDelete>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'ops_privacy_delete', input, async () => {
          return deleteSubjectForPrivacy(db, actor, input.subject_type, input.subject_id, input.reason, input.dry_run);
        });
      },
    },
    {
      name: 'ops_retention_apply',
      tier: 'admin',
      description: 'Apply tenant retention cleanup to audit events, recovery logs, completed context outbox jobs, and idempotency keys older than a configured age. Defaults to dry_run=true so operators can preview counts before deleting. Admin/owner only.',
      inputSchema: opsRetentionApply,
      handler: async (input: z.infer<typeof opsRetentionApply>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'ops_retention_apply', input, async () => {
          return applyRetentionPolicy(db, actor, input);
        });
      },
    },
  ];
}
