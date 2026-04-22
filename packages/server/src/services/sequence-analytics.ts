// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';

export interface SequenceAnalyticsRow {
  sequence_id: UUID;
  period_start: string;
  period_type: string;
  enrolled_count: number;
  completed_count: number;
  exited_count: number;
  emails_sent: number;
  emails_opened: number;
  emails_clicked: number;
  replies_count: number;
  tasks_created: number;
}

export interface SequenceStepMetrics {
  step_index: number;
  step_type: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  approval_pending: number;
}

export interface SequenceAnalyticsSummary {
  sequence_id: UUID;
  total_enrolled: number;
  total_completed: number;
  total_exited: number;
  total_active: number;
  total_paused: number;
  emails_sent: number;
  emails_opened: number;
  emails_clicked: number;
  replies_count: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  completion_rate: number;
  step_metrics: SequenceStepMetrics[];
  rollup: SequenceAnalyticsRow[];
}

/** Called from the 60-second background tick — refreshes today's rollup row for all sequences */
export async function refreshSequenceAnalytics(db: DbPool): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Get all distinct sequence IDs that had activity today
    const activeSeqs = await db.query(
      `SELECT DISTINCT se.sequence_id, se.tenant_id
       FROM sequence_enrollments se
       WHERE se.updated_at >= $1::date`,
      [today],
    );

    for (const row of activeSeqs.rows) {
      await upsertDailyRollup(db, row.tenant_id, row.sequence_id, today);
    }
  } catch (err) {
    console.error('[sequence-analytics] refresh error:', err);
  }
}

async function upsertDailyRollup(
  db: DbPool, tenantId: UUID, sequenceId: UUID, date: string,
): Promise<void> {
  // Compute live metrics for today
  const metrics = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE se.created_at::date = $3) AS enrolled_today,
       COUNT(*) FILTER (WHERE se.status = 'completed' AND se.updated_at::date = $3) AS completed_today,
       COUNT(*) FILTER (WHERE se.status = 'cancelled' AND se.updated_at::date = $3) AS exited_today,
       COUNT(*) FILTER (WHERE sse.step_type = 'email' AND sse.status = 'sent' AND sse.executed_at::date = $3) AS emails_sent,
       COUNT(*) FILTER (WHERE sse.step_type = 'task' AND sse.status = 'sent' AND sse.executed_at::date = $3) AS tasks_created
     FROM sequence_enrollments se
     LEFT JOIN sequence_step_executions sse ON sse.enrollment_id = se.id
     WHERE se.sequence_id = $1 AND se.tenant_id = $2`,
    [sequenceId, tenantId, date],
  );

  const m = metrics.rows[0];

  await db.query(
    `INSERT INTO sequence_analytics_rollup
       (sequence_id, tenant_id, period_start, period_type,
        enrolled_count, completed_count, exited_count, emails_sent, tasks_created)
     VALUES ($1, $2, $3, 'day', $4, $5, $6, $7, $8)
     ON CONFLICT (sequence_id, period_start, period_type)
     DO UPDATE SET
       enrolled_count  = EXCLUDED.enrolled_count,
       completed_count = EXCLUDED.completed_count,
       exited_count    = EXCLUDED.exited_count,
       emails_sent     = EXCLUDED.emails_sent,
       tasks_created   = EXCLUDED.tasks_created`,
    [
      sequenceId, tenantId, date,
      parseInt(m.enrolled_today ?? '0', 10),
      parseInt(m.completed_today ?? '0', 10),
      parseInt(m.exited_today ?? '0', 10),
      parseInt(m.emails_sent ?? '0', 10),
      parseInt(m.tasks_created ?? '0', 10),
    ],
  );
}

/** Full analytics summary for a sequence — called by MCP tool and REST endpoint */
export async function getSequenceAnalytics(
  db: DbPool,
  tenantId: UUID,
  sequenceId: UUID,
  periodType: 'day' | 'week' | 'month' = 'day',
  limit = 30,
): Promise<SequenceAnalyticsSummary> {
  // Live enrollment counts
  const enrollCounts = await db.query(
    `SELECT status, count(*)::int AS cnt
     FROM sequence_enrollments
     WHERE sequence_id = $1 AND tenant_id = $2
     GROUP BY status`,
    [sequenceId, tenantId],
  );
  const byStatus: Record<string, number> = {};
  for (const r of enrollCounts.rows) byStatus[r.status] = r.cnt;

  const totalEnrolled  = Object.values(byStatus).reduce((s, v) => s + v, 0);
  const totalCompleted = byStatus['completed'] ?? 0;
  const totalExited    = byStatus['cancelled'] ?? 0;
  const totalActive    = byStatus['active'] ?? 0;
  const totalPaused    = byStatus['paused'] ?? 0;

  // Step-level execution metrics (live, not from rollup)
  const stepMetricsResult = await db.query(
    `SELECT
       sse.step_index,
       sse.step_type,
       count(*)::int                                        AS total,
       count(*) FILTER (WHERE sse.status = 'sent')::int    AS sent,
       count(*) FILTER (WHERE sse.status = 'failed')::int  AS failed,
       count(*) FILTER (WHERE sse.status = 'skipped')::int AS skipped,
       count(*) FILTER (WHERE sse.status = 'approval_pending')::int AS approval_pending
     FROM sequence_step_executions sse
     JOIN sequence_enrollments se ON se.id = sse.enrollment_id
     WHERE se.sequence_id = $1 AND sse.tenant_id = $2
     GROUP BY sse.step_index, sse.step_type
     ORDER BY sse.step_index`,
    [sequenceId, tenantId],
  );

  // Email open/click/reply counts from email records linked via step executions
  const emailStats = await db.query(
    `SELECT
       count(*) FILTER (WHERE e.opened_at IS NOT NULL)::int  AS opened,
       count(*) FILTER (WHERE e.clicked_at IS NOT NULL)::int AS clicked
     FROM sequence_step_executions sse
     JOIN sequence_enrollments se ON se.id = sse.enrollment_id
     JOIN emails e ON e.id = sse.email_id
     WHERE se.sequence_id = $1 AND sse.tenant_id = $2 AND sse.step_type = 'email'`,
    [sequenceId, tenantId],
  );

  const repliesResult = await db.query(
    `SELECT count(*)::int AS cnt
     FROM sequence_enrollments
     WHERE sequence_id = $1 AND tenant_id = $2 AND exit_reason = 'replied'`,
    [sequenceId, tenantId],
  );

  const emailsSent   = stepMetricsResult.rows
    .filter((r: any) => r.step_type === 'email')
    .reduce((s: number, r: any) => s + r.sent, 0);
  const emailsOpened  = parseInt(emailStats.rows[0]?.opened ?? '0', 10);
  const emailsClicked = parseInt(emailStats.rows[0]?.clicked ?? '0', 10);
  const repliesCount  = parseInt(repliesResult.rows[0]?.cnt ?? '0', 10);

  // Historical rollup
  const rollupResult = await db.query(
    `SELECT * FROM sequence_analytics_rollup
     WHERE sequence_id = $1 AND tenant_id = $2 AND period_type = $3
     ORDER BY period_start DESC LIMIT $4`,
    [sequenceId, tenantId, periodType, limit],
  );

  return {
    sequence_id: sequenceId,
    total_enrolled: totalEnrolled,
    total_completed: totalCompleted,
    total_exited: totalExited,
    total_active: totalActive,
    total_paused: totalPaused,
    emails_sent: emailsSent,
    emails_opened: emailsOpened,
    emails_clicked: emailsClicked,
    replies_count: repliesCount,
    open_rate:        emailsSent > 0 ? Math.round((emailsOpened  / emailsSent) * 100) : 0,
    click_rate:       emailsSent > 0 ? Math.round((emailsClicked / emailsSent) * 100) : 0,
    reply_rate:       emailsSent > 0 ? Math.round((repliesCount  / emailsSent) * 100) : 0,
    completion_rate:  totalEnrolled > 0 ? Math.round((totalCompleted / totalEnrolled) * 100) : 0,
    step_metrics:     stepMetricsResult.rows as SequenceStepMetrics[],
    rollup:           rollupResult.rows as SequenceAnalyticsRow[],
  };
}
