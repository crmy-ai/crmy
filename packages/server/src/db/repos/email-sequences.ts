// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID, PaginatedResponse } from '@crmy/shared';

export interface EmailSequenceRow {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description?: string;
  steps: unknown[];
  is_active: boolean;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

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
}

// ── Sequence CRUD ──────────────────────────────────────────────────────────

export async function createSequence(
  db: DbPool, tenantId: UUID,
  data: { name: string; description?: string; steps: unknown[]; created_by?: UUID },
): Promise<EmailSequenceRow> {
  const result = await db.query(
    `INSERT INTO email_sequences (tenant_id, name, description, steps, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, data.name, data.description ?? null, JSON.stringify(data.steps), data.created_by ?? null],
  );
  return result.rows[0] as EmailSequenceRow;
}

export async function getSequence(db: DbPool, tenantId: UUID, id: UUID): Promise<EmailSequenceRow | null> {
  const result = await db.query(
    'SELECT * FROM email_sequences WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as EmailSequenceRow) ?? null;
}

export async function updateSequence(
  db: DbPool, tenantId: UUID, id: UUID,
  patch: Record<string, unknown>,
): Promise<EmailSequenceRow | null> {
  const allowedFields: Record<string, string> = {
    name: 'name',
    description: 'description',
    steps: 'steps',
    is_active: 'is_active',
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
    `UPDATE email_sequences SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as EmailSequenceRow) ?? null;
}

export async function deleteSequence(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM email_sequences WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listSequences(
  db: DbPool, tenantId: UUID,
  filters: { is_active?: boolean; limit: number; cursor?: string },
): Promise<PaginatedResponse<EmailSequenceRow>> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.is_active !== undefined) {
    conditions.push(`is_active = $${idx}`);
    params.push(filters.is_active);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');
  const countResult = await db.query(`SELECT count(*)::int as total FROM email_sequences WHERE ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM email_sequences WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as EmailSequenceRow[];
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
  data: { sequence_id: UUID; contact_id: UUID; enrolled_by?: string },
): Promise<SequenceEnrollmentRow> {
  // Calculate first step send time (step 0 delay_days from now)
  const seq = await getSequence(db, tenantId, data.sequence_id);
  if (!seq) throw new Error('Sequence not found');
  if (!seq.is_active) throw new Error('Sequence is not active');

  const steps = seq.steps as { delay_days: number }[];
  const firstDelay = steps[0]?.delay_days ?? 0;
  const nextSendAt = new Date(Date.now() + firstDelay * 86_400_000).toISOString();

  const result = await db.query(
    `INSERT INTO sequence_enrollments (sequence_id, contact_id, tenant_id, enrolled_by, next_send_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.sequence_id, data.contact_id, tenantId, data.enrolled_by ?? null, nextSendAt],
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
