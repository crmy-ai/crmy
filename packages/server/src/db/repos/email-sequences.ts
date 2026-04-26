// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID, PaginatedResponse } from '@crmy/shared';

/** Post-migration: sequences table (was email_sequences) */
export interface SequenceRow {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description?: string;
  steps: unknown[];
  is_active: boolean;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
  // v2 columns (added by 038_sequences_v2)
  channel_types?: string[];
  goal_event?: string;
  goal_object_type?: string;
  exit_on_reply?: boolean;
  ai_persona?: string;
  tags?: string[];
  // v3 columns (added by 039_sequences_actor_activity)
  owner_actor_id?: UUID;
  // v4 columns (added by 041_sequence_rate_limits)
  max_active_enrollments?: number;
  exit_on_unsubscribe?: boolean;
}

/** Backward-compat alias */
export type EmailSequenceRow = SequenceRow;

export interface SequenceEnrollmentRow {
  id: UUID;
  sequence_id: UUID;
  contact_id: UUID;
  tenant_id: UUID;
  current_step: number;
  status: string;
  next_send_at?: string;
  enrolled_by?: string;
  created_at: string;
  updated_at: string;
  // v2 columns
  variables?: Record<string, unknown>;
  paused_at?: string;
  goal_met_at?: string;
  exit_reason?: string;
  // v3 columns (added by 039_sequences_actor_activity)
  enrolled_by_actor_id?: UUID;
  objective?: string;
}

export interface StepExecutionRow {
  id: UUID;
  enrollment_id: UUID;
  tenant_id: UUID;
  step_index: number;
  step_type: string;
  status: string;
  executed_at?: string;
  email_id?: UUID;
  error?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── Sequence CRUD ──────────────────────────────────────────────────────────

export async function createSequence(
  db: DbPool, tenantId: UUID,
  data: {
    name: string; description?: string; steps: unknown[]; created_by?: UUID;
    channel_types?: string[]; goal_event?: string; exit_on_reply?: boolean;
    ai_persona?: string; tags?: string[]; owner_actor_id?: UUID;
  },
): Promise<SequenceRow> {
  const result = await db.query(
    `INSERT INTO sequences (tenant_id, name, description, steps, created_by,
       channel_types, goal_event, exit_on_reply, ai_persona, tags, owner_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      tenantId, data.name, data.description ?? null,
      JSON.stringify(data.steps), data.created_by ?? null,
      data.channel_types ?? ['email'],
      data.goal_event ?? null,
      data.exit_on_reply ?? true,
      data.ai_persona ?? null,
      data.tags ?? [],
      data.owner_actor_id ?? null,
    ],
  );
  return result.rows[0] as SequenceRow;
}

export async function getSequence(db: DbPool, tenantId: UUID, id: UUID): Promise<SequenceRow | null> {
  const result = await db.query(
    'SELECT * FROM sequences WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as SequenceRow) ?? null;
}

export async function updateSequence(
  db: DbPool, tenantId: UUID, id: UUID,
  patch: Record<string, unknown>,
): Promise<SequenceRow | null> {
  const allowedFields: Record<string, string> = {
    name: 'name',
    description: 'description',
    steps: 'steps',
    is_active: 'is_active',
    channel_types: 'channel_types',
    goal_event: 'goal_event',
    exit_on_reply: 'exit_on_reply',
    ai_persona: 'ai_persona',
    tags: 'tags',
    owner_actor_id: 'owner_actor_id',
    max_active_enrollments: 'max_active_enrollments',
    exit_on_unsubscribe: 'exit_on_unsubscribe',
  };

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  for (const [key, col] of Object.entries(allowedFields)) {
    if (key in patch) {
      sets.push(`${col} = $${idx}`);
      params.push(key === 'steps' ? JSON.stringify(patch[key]) : patch[key]);
      idx++;
    }
  }

  if (sets.length === 1) return getSequence(db, tenantId, id);

  const result = await db.query(
    `UPDATE sequences SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as SequenceRow) ?? null;
}

export async function deleteSequence(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  // Cancel all active enrollments first
  await db.query(
    `UPDATE sequence_enrollments SET status = 'cancelled', exit_reason = 'sequence_deleted', updated_at = now()
     WHERE sequence_id = $1 AND tenant_id = $2 AND status IN ('active','paused')`,
    [id, tenantId],
  );
  const result = await db.query(
    'DELETE FROM sequences WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listSequences(
  db: DbPool, tenantId: UUID,
  filters: { is_active?: boolean; limit: number; cursor?: string; tags?: string[] },
): Promise<PaginatedResponse<SequenceRow>> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.is_active !== undefined) {
    conditions.push(`is_active = $${idx}`);
    params.push(filters.is_active);
    idx++;
  }
  if (filters.tags?.length) {
    conditions.push(`tags && $${idx}`);
    params.push(filters.tags);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');
  const countResult = await db.query(`SELECT count(*)::int as total FROM sequences WHERE ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM sequences WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as SequenceRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

// ── Enrollment CRUD ────────────────────────────────────────────────────────

export async function enrollContact(
  db: DbPool, tenantId: UUID,
  data: {
    sequence_id: UUID; contact_id: UUID; enrolled_by?: string;
    enrolled_by_actor_id?: UUID; objective?: string;
    variables?: Record<string, unknown>; start_at_step?: number;
  },
): Promise<SequenceEnrollmentRow> {
  const seq = await getSequence(db, tenantId, data.sequence_id);
  if (!seq) throw new Error('Sequence not found');
  if (!seq.is_active) throw new Error('Sequence is not active');

  // Pre-INSERT duplicate guard — avoids relying on error-string parsing
  const dupCheck = await db.query(
    `SELECT id FROM sequence_enrollments
     WHERE sequence_id = $1 AND contact_id = $2 AND tenant_id = $3
       AND status IN ('active','paused') LIMIT 1`,
    [data.sequence_id, data.contact_id, tenantId],
  );
  if (dupCheck.rows.length > 0) {
    throw Object.assign(new Error('Contact is already actively enrolled in this sequence'), { code: 'DUPLICATE_ENROLLMENT' });
  }

  // Enrollment cap check
  const seqWithCap = seq as SequenceRow & { max_active_enrollments?: number };
  if (seqWithCap.max_active_enrollments) {
    const capCheck = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM sequence_enrollments
       WHERE sequence_id = $1 AND tenant_id = $2 AND status IN ('active','paused')`,
      [data.sequence_id, tenantId],
    );
    if ((capCheck.rows[0]?.cnt ?? 0) >= seqWithCap.max_active_enrollments) {
      throw Object.assign(
        new Error(`Sequence enrollment limit reached (max ${seqWithCap.max_active_enrollments})`),
        { code: 'ENROLLMENT_LIMIT_REACHED' },
      );
    }
  }

  const startStep = data.start_at_step ?? 0;
  const steps = seq.steps as { delay_days?: number; delay_hours?: number }[];
  const firstStep = steps[startStep];
  const delayMs = ((firstStep?.delay_days ?? 0) * 86_400_000) + ((firstStep?.delay_hours ?? 0) * 3_600_000);
  const nextSendAt = new Date(Date.now() + delayMs).toISOString();

  const result = await db.query(
    `INSERT INTO sequence_enrollments
       (sequence_id, contact_id, tenant_id, enrolled_by, enrolled_by_actor_id, objective,
        next_send_at, current_step, variables)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      data.sequence_id, data.contact_id, tenantId,
      data.enrolled_by ?? null,
      data.enrolled_by_actor_id ?? null,
      data.objective ?? null,
      nextSendAt, startStep,
      JSON.stringify(data.variables ?? {}),
    ],
  );
  return result.rows[0] as SequenceEnrollmentRow;
}

export async function getEnrollment(db: DbPool, tenantId: UUID, id: UUID): Promise<SequenceEnrollmentRow | null> {
  const result = await db.query(
    'SELECT * FROM sequence_enrollments WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as SequenceEnrollmentRow) ?? null;
}

export async function unenrollContact(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    `UPDATE sequence_enrollments SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status = 'active' RETURNING id`,
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listEnrollments(
  db: DbPool, tenantId: UUID,
  filters: { sequence_id?: UUID; contact_id?: UUID; status?: string; limit: number; cursor?: string },
): Promise<PaginatedResponse<SequenceEnrollmentRow>> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.sequence_id) {
    conditions.push(`sequence_id = $${idx}`);
    params.push(filters.sequence_id);
    idx++;
  }
  if (filters.contact_id) {
    conditions.push(`contact_id = $${idx}`);
    params.push(filters.contact_id);
    idx++;
  }
  if (filters.status) {
    conditions.push(`status = $${idx}`);
    params.push(filters.status);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');
  const countResult = await db.query(`SELECT count(*)::int as total FROM sequence_enrollments WHERE ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM sequence_enrollments WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as SequenceEnrollmentRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

/** Get enrollments due for their next step send. */
export async function getDueEnrollments(db: DbPool, limit: number): Promise<(SequenceEnrollmentRow & { tenant_id: UUID })[]> {
  const result = await db.query(
    `SELECT * FROM sequence_enrollments
     WHERE status = 'active' AND next_send_at <= now()
     ORDER BY next_send_at LIMIT $1`,
    [limit],
  );
  return result.rows as (SequenceEnrollmentRow & { tenant_id: UUID })[];
}

/** Advance enrollment to next step or mark as completed. */
export async function advanceEnrollment(
  db: DbPool, id: UUID, totalSteps: number, nextDelayDays?: number,
): Promise<void> {
  const result = await db.query('SELECT current_step FROM sequence_enrollments WHERE id = $1', [id]);
  if (!result.rows[0]) return;

  const currentStep = result.rows[0].current_step as number;
  const nextStep = currentStep + 1;

  if (nextStep >= totalSteps) {
    await db.query(
      `UPDATE sequence_enrollments SET status = 'completed', current_step = $2, next_send_at = NULL, updated_at = now() WHERE id = $1`,
      [id, nextStep],
    );
  } else {
    const nextSendAt = new Date(Date.now() + (nextDelayDays ?? 0) * 86_400_000).toISOString();
    await db.query(
      `UPDATE sequence_enrollments SET current_step = $2, next_send_at = $3, updated_at = now() WHERE id = $1`,
      [id, nextStep, nextSendAt],
    );
  }
}

// ── New repo functions (Phase 2+) ──────────────────────────────────────────────

export async function pauseEnrollment(db: DbPool, id: UUID): Promise<boolean> {
  const result = await db.query(
    `UPDATE sequence_enrollments
     SET status = 'paused', paused_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'active' RETURNING id`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function resumeEnrollment(db: DbPool, id: UUID): Promise<boolean> {
  const result = await db.query(
    `UPDATE sequence_enrollments
     SET status = 'active', paused_at = NULL, updated_at = now()
     WHERE id = $1 AND status = 'paused' RETURNING id`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function cancelEnrollment(db: DbPool, id: UUID, exitReason: string): Promise<void> {
  await db.query(
    `UPDATE sequence_enrollments
     SET status = 'cancelled', exit_reason = $2, next_send_at = NULL, updated_at = now()
     WHERE id = $1`,
    [id, exitReason],
  );
}

export async function completeEnrollment(db: DbPool, id: UUID, exitReason: string): Promise<void> {
  await db.query(
    `UPDATE sequence_enrollments
     SET status = 'completed', exit_reason = $2, next_send_at = NULL, updated_at = now()
     WHERE id = $1`,
    [id, exitReason],
  );
}

export async function setCurrentStep(db: DbPool, id: UUID, stepIndex: number, nextSendAt: string): Promise<void> {
  await db.query(
    `UPDATE sequence_enrollments
     SET current_step = $2, next_send_at = $3, updated_at = now()
     WHERE id = $1`,
    [id, stepIndex, nextSendAt],
  );
}

export async function advanceToStep(db: DbPool, tenantId: UUID, id: UUID, stepIndex: number): Promise<SequenceEnrollmentRow | null> {
  const enrollment = await getEnrollment(db, tenantId, id);
  if (!enrollment) return null;
  const seq = await getSequence(db, tenantId, enrollment.sequence_id);
  if (!seq) return null;
  const steps = seq.steps as { delay_days?: number }[];
  const targetStep = Math.min(stepIndex, steps.length - 1);
  const nextSendAt = new Date().toISOString(); // immediate
  await db.query(
    `UPDATE sequence_enrollments
     SET current_step = $2, next_send_at = $3, status = 'active', updated_at = now()
     WHERE id = $1`,
    [id, targetStep, nextSendAt],
  );
  return getEnrollment(db, tenantId, id);
}

export async function logStepExecution(
  db: DbPool,
  data: {
    enrollment_id: UUID;
    tenant_id: UUID;
    step_index: number;
    step_type: string;
    status: string;
    email_id?: UUID;
    error?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<StepExecutionRow> {
  const result = await db.query(
    `INSERT INTO sequence_step_executions
       (enrollment_id, tenant_id, step_index, step_type, status, executed_at, email_id, error, metadata)
     VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8) RETURNING *`,
    [
      data.enrollment_id, data.tenant_id, data.step_index, data.step_type,
      data.status, data.email_id ?? null, data.error ?? null,
      JSON.stringify(data.metadata ?? {}),
    ],
  );
  return result.rows[0] as StepExecutionRow;
}

export async function getStepExecutions(db: DbPool, enrollmentId: UUID): Promise<StepExecutionRow[]> {
  const result = await db.query(
    'SELECT * FROM sequence_step_executions WHERE enrollment_id = $1 ORDER BY step_index, created_at',
    [enrollmentId],
  );
  return result.rows as StepExecutionRow[];
}

export async function getEnrollmentWithStepLog(
  db: DbPool, tenantId: UUID, id: UUID,
): Promise<(SequenceEnrollmentRow & { step_log: StepExecutionRow[] }) | null> {
  const enrollment = await getEnrollment(db, tenantId, id);
  if (!enrollment) return null;
  const stepLog = await getStepExecutions(db, id);
  return { ...enrollment, step_log: stepLog };
}

export async function getActiveEnrollmentsForContact(
  db: DbPool, tenantId: UUID, contactId: UUID,
): Promise<SequenceEnrollmentRow[]> {
  const result = await db.query(
    `SELECT se.*, seq.goal_event, seq.exit_on_reply
     FROM sequence_enrollments se
     JOIN sequences seq ON seq.id = se.sequence_id
     WHERE se.tenant_id = $1 AND se.contact_id = $2 AND se.status IN ('active','paused')`,
    [tenantId, contactId],
  );
  return result.rows as SequenceEnrollmentRow[];
}
