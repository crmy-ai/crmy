// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';

let lastSuccessfulTickAt: string | null = null;
let lastTickError: string | null = null;

export function markBackgroundTickSuccess(): void {
  lastSuccessfulTickAt = new Date().toISOString();
  lastTickError = null;
}

export function markBackgroundTickFailure(err: unknown): void {
  lastTickError = err instanceof Error ? err.message : String(err);
}

export async function getAutomationSchedulerHealth(db: DbPool, tenantId: UUID): Promise<{
  last_successful_tick_at: string | null;
  last_tick_error: string | null;
  due_sequence_backlog: number;
  workflow_catchup_backlog: number;
  recent_failed_workflow_runs: number;
  recent_failed_sequence_steps: number;
}> {
  const [dueSeq, workflowBacklog, failedWorkflows, failedSequenceSteps] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS count
       FROM sequence_enrollments
       WHERE tenant_id = $1
         AND status = 'active'
         AND next_send_at <= now()`,
      [tenantId],
    ),
    db.query(
      `SELECT count(*)::int AS count
       FROM events e
       JOIN workflows w
         ON w.tenant_id = e.tenant_id
        AND w.trigger_event = e.event_type
        AND w.is_active = true
        AND e.created_at >= w.created_at
       LEFT JOIN workflow_runs wr
         ON wr.workflow_id = w.id
        AND wr.event_id = e.id
       WHERE e.tenant_id = $1
         AND wr.id IS NULL
         AND e.event_type NOT LIKE 'workflow.%'
         AND COALESCE(e.metadata->>'origin', '') <> 'workflow'
         AND COALESCE(e.metadata->>'sync_mode', '') <> 'replay'`,
      [tenantId],
    ),
    db.query(
      `SELECT count(*)::int AS count
       FROM workflow_runs wr
       JOIN workflows w ON w.id = wr.workflow_id
       WHERE w.tenant_id = $1
         AND wr.status = 'failed'
         AND wr.started_at > now() - interval '24 hours'`,
      [tenantId],
    ),
    db.query(
      `SELECT count(*)::int AS count
       FROM sequence_step_executions
       WHERE tenant_id = $1
         AND status = 'failed'
         AND created_at > now() - interval '24 hours'`,
      [tenantId],
    ),
  ]);

  return {
    last_successful_tick_at: lastSuccessfulTickAt,
    last_tick_error: lastTickError,
    due_sequence_backlog: Number(dueSeq.rows[0]?.count ?? 0),
    workflow_catchup_backlog: Number(workflowBacklog.rows[0]?.count ?? 0),
    recent_failed_workflow_runs: Number(failedWorkflows.rows[0]?.count ?? 0),
    recent_failed_sequence_steps: Number(failedSequenceSteps.rows[0]?.count ?? 0),
  };
}
