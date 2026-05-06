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
  | 'stuck_context_outbox_processing';

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
    checkName !== 'stuck_context_outbox_processing'
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
