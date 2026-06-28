// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { CrmyError, type ActorContext, type UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';

export type RecoverableQueue =
  | 'context_outbox'
  | 'sources'
  | 'agent_turns'
  | 'context_embedding_jobs'
  | 'mailbox_sync_jobs'
  | 'email_delivery_jobs'
  | 'calendar_sync_jobs'
  | 'webhook_deliveries'
  | 'message_deliveries'
  | 'bulk_jobs'
  | 'workflow_runs'
  | 'sequence_step_executions';

export type RecoveryAction = 'retry' | 'park' | 'mark_failed';

interface RecoverySpec {
  selectSql: string;
  updateSql: Record<RecoveryAction, string | null>;
  newStatus: Record<RecoveryAction, string>;
}

export interface RecoveryResult {
  queue_name: RecoverableQueue;
  job_id: UUID;
  action: RecoveryAction;
  previous_status: string | null;
  new_status: string;
  recovered: boolean;
}

const SPECS: Record<RecoverableQueue, RecoverySpec> = {
  context_outbox: {
    selectSql: 'SELECT id, status FROM context_outbox WHERE tenant_id = $1 AND id = $2',
    updateSql: {
      retry: `
        UPDATE context_outbox
        SET status = 'pending', attempt_count = 0, last_error = null, processed_at = null
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      park: `
        UPDATE context_outbox
        SET status = 'parked', last_error = COALESCE($3, last_error)
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      mark_failed: `
        UPDATE context_outbox
        SET status = 'failed', last_error = COALESCE($3, last_error)
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
    },
    newStatus: { retry: 'pending', park: 'parked', mark_failed: 'failed' },
  },
  sources: {
    selectSql: 'SELECT id, status FROM raw_context_sources WHERE tenant_id = $1 AND id = $2',
    updateSql: {
      retry: `
        UPDATE raw_context_sources
        SET status = 'pending',
            stage = 'retrying',
            locked_at = NULL,
            next_retry_at = now(),
            last_error = NULL,
            failure_reason = NULL,
            failure_code = NULL,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      park: `
        UPDATE raw_context_sources
        SET status = 'needs_review',
            locked_at = NULL,
            last_error = COALESCE($3, last_error),
            failure_reason = COALESCE($3, failure_reason),
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      mark_failed: `
        UPDATE raw_context_sources
        SET status = 'failed',
            locked_at = NULL,
            last_error = COALESCE($3, last_error),
            failure_reason = COALESCE($3, failure_reason),
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
    },
    newStatus: { retry: 'pending', park: 'needs_review', mark_failed: 'failed' },
  },
  agent_turns: {
    selectSql: 'SELECT id, status FROM agent_turns WHERE tenant_id = $1 AND id = $2',
    updateSql: {
      retry: `
        UPDATE agent_turns
        SET status = 'queued',
            worker_id = NULL,
            lease_expires_at = NULL,
            heartbeat_at = NULL,
            started_at = NULL,
            completed_at = NULL,
            cancelled_at = NULL,
            error_message = NULL,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status IN ('failed', 'cancelled', 'running')
        RETURNING id, status
      `,
      park: null,
      mark_failed: `
        UPDATE agent_turns
        SET status = 'failed',
            completed_at = COALESCE(completed_at, now()),
            lease_expires_at = NULL,
            error_message = COALESCE($3, error_message),
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
    },
    newStatus: { retry: 'queued', park: 'running', mark_failed: 'failed' },
  },
  context_embedding_jobs: {
    selectSql: 'SELECT id, status FROM context_embedding_jobs WHERE tenant_id = $1 AND id = $2',
    updateSql: {
      retry: `
        UPDATE context_embedding_jobs
        SET status = 'pending',
            locked_at = NULL,
            last_error = NULL,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      park: null,
      mark_failed: `
        UPDATE context_embedding_jobs
        SET status = 'failed',
            locked_at = NULL,
            last_error = COALESCE($3, last_error),
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
    },
    newStatus: { retry: 'pending', park: 'failed', mark_failed: 'failed' },
  },
  mailbox_sync_jobs: {
    selectSql: 'SELECT id, status FROM mailbox_sync_jobs WHERE tenant_id = $1 AND id = $2',
    updateSql: {
      retry: `
        UPDATE mailbox_sync_jobs
        SET status = 'pending',
            run_after = now(),
            locked_at = NULL,
            last_error = NULL,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      park: null,
      mark_failed: `
        UPDATE mailbox_sync_jobs
        SET status = 'failed',
            locked_at = NULL,
            last_error = COALESCE($3, last_error),
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
    },
    newStatus: { retry: 'pending', park: 'failed', mark_failed: 'failed' },
  },
  email_delivery_jobs: {
    selectSql: 'SELECT id, status FROM email_delivery_jobs WHERE tenant_id = $1 AND id = $2',
    updateSql: {
      retry: `
        UPDATE email_delivery_jobs
        SET status = 'pending',
            available_at = now(),
            locked_at = NULL,
            last_error = NULL,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      park: null,
      mark_failed: `
        UPDATE email_delivery_jobs
        SET status = 'failed',
            locked_at = NULL,
            last_error = COALESCE($3, last_error),
            available_at = 'infinity'::timestamptz,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
    },
    newStatus: { retry: 'pending', park: 'failed', mark_failed: 'failed' },
  },
  calendar_sync_jobs: {
    selectSql: 'SELECT id, status FROM calendar_sync_jobs WHERE tenant_id = $1 AND id = $2',
    updateSql: {
      retry: `
        UPDATE calendar_sync_jobs
        SET status = 'pending',
            run_after = now(),
            locked_at = NULL,
            last_error = NULL,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      park: null,
      mark_failed: `
        UPDATE calendar_sync_jobs
        SET status = 'failed',
            locked_at = NULL,
            last_error = COALESCE($3, last_error),
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
    },
    newStatus: { retry: 'pending', park: 'failed', mark_failed: 'failed' },
  },
  webhook_deliveries: {
    selectSql: `
      SELECT wd.id, wd.status
      FROM webhook_deliveries wd
      JOIN webhook_endpoints we ON we.id = wd.endpoint_id
      WHERE we.tenant_id = $1 AND wd.id = $2
    `,
    updateSql: {
      retry: `
        UPDATE webhook_deliveries wd
        SET status = 'retrying', next_retry_at = now()
        FROM webhook_endpoints we
        WHERE we.id = wd.endpoint_id AND we.tenant_id = $1 AND wd.id = $2
        RETURNING wd.id, wd.status
      `,
      park: `
        UPDATE webhook_deliveries wd
        SET status = 'parked', response_body = COALESCE($3, response_body)
        FROM webhook_endpoints we
        WHERE we.id = wd.endpoint_id AND we.tenant_id = $1 AND wd.id = $2
        RETURNING wd.id, wd.status
      `,
      mark_failed: `
        UPDATE webhook_deliveries wd
        SET status = 'failed', response_body = COALESCE($3, response_body)
        FROM webhook_endpoints we
        WHERE we.id = wd.endpoint_id AND we.tenant_id = $1 AND wd.id = $2
        RETURNING wd.id, wd.status
      `,
    },
    newStatus: { retry: 'retrying', park: 'parked', mark_failed: 'failed' },
  },
  message_deliveries: {
    selectSql: 'SELECT id, status FROM message_deliveries WHERE tenant_id = $1 AND id = $2',
    updateSql: {
      retry: `
        UPDATE message_deliveries
        SET status = 'retrying', next_retry_at = now(), error = null
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      park: `
        UPDATE message_deliveries
        SET status = 'parked', error = COALESCE($3, error)
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      mark_failed: `
        UPDATE message_deliveries
        SET status = 'failed', error = COALESCE($3, error)
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
    },
    newStatus: { retry: 'retrying', park: 'parked', mark_failed: 'failed' },
  },
  bulk_jobs: {
    selectSql: 'SELECT id, status FROM bulk_jobs WHERE tenant_id = $1 AND id = $2',
    updateSql: {
      retry: `
        UPDATE bulk_jobs
        SET status = 'queued', completed_at = null, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      park: `
        UPDATE bulk_jobs
        SET status = 'parked', updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      mark_failed: `
        UPDATE bulk_jobs
        SET status = 'failed', completed_at = COALESCE(completed_at, now()), updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
    },
    newStatus: { retry: 'queued', park: 'parked', mark_failed: 'failed' },
  },
  workflow_runs: {
    selectSql: `
      SELECT wr.id, wr.status
      FROM workflow_runs wr
      JOIN workflows w ON w.id = wr.workflow_id
      WHERE w.tenant_id = $1 AND wr.id = $2
    `,
    updateSql: {
      retry: null,
      park: `
        UPDATE workflow_runs wr
        SET status = 'parked', error = COALESCE($3, error), completed_at = COALESCE(completed_at, now())
        FROM workflows w
        WHERE w.id = wr.workflow_id AND w.tenant_id = $1 AND wr.id = $2
        RETURNING wr.id, wr.status
      `,
      mark_failed: `
        UPDATE workflow_runs wr
        SET status = 'failed', error = COALESCE($3, error), completed_at = COALESCE(completed_at, now())
        FROM workflows w
        WHERE w.id = wr.workflow_id AND w.tenant_id = $1 AND wr.id = $2
        RETURNING wr.id, wr.status
      `,
    },
    newStatus: { retry: 'running', park: 'parked', mark_failed: 'failed' },
  },
  sequence_step_executions: {
    selectSql: 'SELECT id, status FROM sequence_step_executions WHERE tenant_id = $1 AND id = $2',
    updateSql: {
      retry: `
        UPDATE sequence_step_executions
        SET status = 'pending', error = null, executed_at = null
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      park: `
        UPDATE sequence_step_executions
        SET status = 'parked', error = COALESCE($3, error)
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
      mark_failed: `
        UPDATE sequence_step_executions
        SET status = 'failed', error = COALESCE($3, error)
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, status
      `,
    },
    newStatus: { retry: 'pending', park: 'parked', mark_failed: 'failed' },
  },
};

export async function recoverOperationalJob(
  db: DbPool,
  actor: ActorContext,
  queueName: RecoverableQueue,
  jobId: UUID,
  action: RecoveryAction,
  reason?: string,
): Promise<RecoveryResult> {
  const spec = SPECS[queueName];
  if (!spec) {
    throw new CrmyError('VALIDATION_ERROR', `Unsupported queue '${queueName}'`, 422);
  }

  const updateSql = spec.updateSql[action];
  if (!updateSql) {
    throw new CrmyError('VALIDATION_ERROR', `Action '${action}' is not supported for ${queueName}`, 422);
  }

  const before = await db.query<{ status: string }>(spec.selectSql, [actor.tenant_id, jobId]);
  if (before.rows.length === 0) {
    throw new CrmyError('NOT_FOUND', `${queueName} job ${jobId} not found`, 404);
  }

  const previousStatus = before.rows[0]?.status ?? null;
  const params = action === 'retry'
    ? [actor.tenant_id, jobId]
    : [actor.tenant_id, jobId, reason ?? null];
  const updated = await db.query<{ status: string }>(updateSql, params);
  if (updated.rows.length === 0) {
    throw new CrmyError('NOT_FOUND', `${queueName} job ${jobId} not found`, 404);
  }

  const newStatus = updated.rows[0]?.status ?? spec.newStatus[action];
  await db.query(
    `INSERT INTO ops_recovery_log
       (tenant_id, queue_name, job_id, action, previous_status, new_status, reason, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [actor.tenant_id, queueName, jobId, action, previousStatus, newStatus, reason ?? null, actor.actor_id],
  );

  return {
    queue_name: queueName,
    job_id: jobId,
    action,
    previous_status: previousStatus,
    new_status: newStatus,
    recovered: true,
  };
}
