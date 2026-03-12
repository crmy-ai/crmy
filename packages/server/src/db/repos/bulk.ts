// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID, PaginatedResponse } from '@crmy/shared';

export interface BulkJobRow {
  id: UUID;
  tenant_id: UUID;
  operation: string;
  object_type: string;
  status: string;
  total_rows?: number;
  processed: number;
  succeeded: number;
  failed: number;
  input_url?: string;
  output_url?: string;
  error_log: unknown[];
  hitl_request_id?: UUID;
  started_at?: string;
  completed_at?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function createBulkJob(
  db: DbPool, tenantId: UUID,
  data: { operation: string; object_type: string; total_rows?: number; created_by: string },
): Promise<BulkJobRow> {
  const result = await db.query(
    `INSERT INTO bulk_jobs (tenant_id, operation, object_type, total_rows, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, data.operation, data.object_type, data.total_rows ?? null, data.created_by],
  );
  return result.rows[0] as BulkJobRow;
}

export async function getBulkJob(db: DbPool, tenantId: UUID, id: UUID): Promise<BulkJobRow | null> {
  const result = await db.query(
    'SELECT * FROM bulk_jobs WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as BulkJobRow) ?? null;
}

export async function updateBulkJob(
  db: DbPool, id: UUID,
  data: { status?: string; processed?: number; succeeded?: number; failed?: number; error_log?: unknown[]; completed_at?: string },
): Promise<void> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [id];
  let idx = 2;

  if (data.status) {
    sets.push(`status = $${idx}`);
    params.push(data.status);
    idx++;
  }
  if (data.processed !== undefined) {
    sets.push(`processed = $${idx}`);
    params.push(data.processed);
    idx++;
  }
  if (data.succeeded !== undefined) {
    sets.push(`succeeded = $${idx}`);
    params.push(data.succeeded);
    idx++;
  }
  if (data.failed !== undefined) {
    sets.push(`failed = $${idx}`);
    params.push(data.failed);
    idx++;
  }
  if (data.error_log) {
    sets.push(`error_log = $${idx}`);
    params.push(JSON.stringify(data.error_log));
    idx++;
  }
  if (data.completed_at) {
    sets.push(`completed_at = $${idx}`);
    params.push(data.completed_at);
    idx++;
  }
  if (data.status === 'processing') {
    sets.push('started_at = COALESCE(started_at, now())');
  }

  await db.query(`UPDATE bulk_jobs SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function listBulkJobs(
  db: DbPool, tenantId: UUID,
  filters: { status?: string; limit: number; cursor?: string },
): Promise<PaginatedResponse<BulkJobRow>> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

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
  const countResult = await db.query(`SELECT count(*)::int as total FROM bulk_jobs WHERE ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM bulk_jobs WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as BulkJobRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}
