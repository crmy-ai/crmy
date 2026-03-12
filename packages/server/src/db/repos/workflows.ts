// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID, PaginatedResponse } from '@crmy/shared';

export interface WorkflowRow {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description?: string;
  trigger_event: string;
  trigger_filter: Record<string, unknown>;
  actions: unknown[];
  is_active: boolean;
  run_count: number;
  last_run_at?: string;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunRow {
  id: UUID;
  workflow_id: UUID;
  event_id?: number;
  status: string;
  actions_run: number;
  actions_total: number;
  error?: string;
  started_at: string;
  completed_at?: string;
}

export async function createWorkflow(
  db: DbPool, tenantId: UUID,
  data: {
    name: string; description?: string; trigger_event: string;
    trigger_filter?: Record<string, unknown>; actions: unknown[];
    is_active?: boolean; created_by?: UUID;
  },
): Promise<WorkflowRow> {
  const result = await db.query(
    `INSERT INTO workflows (tenant_id, name, description, trigger_event,
       trigger_filter, actions, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      tenantId, data.name, data.description ?? null, data.trigger_event,
      JSON.stringify(data.trigger_filter ?? {}), JSON.stringify(data.actions),
      data.is_active ?? true, data.created_by ?? null,
    ],
  );
  return result.rows[0] as WorkflowRow;
}

export async function getWorkflow(db: DbPool, tenantId: UUID, id: UUID): Promise<WorkflowRow | null> {
  const result = await db.query(
    'SELECT * FROM workflows WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as WorkflowRow) ?? null;
}

export async function updateWorkflow(
  db: DbPool, tenantId: UUID, id: UUID,
  patch: Record<string, unknown>,
): Promise<WorkflowRow | null> {
  const fieldMap: Record<string, string> = {
    name: 'name', description: 'description', trigger_event: 'trigger_event',
    is_active: 'is_active',
  };
  const jsonFields: Record<string, string> = {
    trigger_filter: 'trigger_filter', actions: 'actions',
  };

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in patch) {
      sets.push(`${col} = $${idx}`);
      params.push(patch[key]);
      idx++;
    }
  }
  for (const [key, col] of Object.entries(jsonFields)) {
    if (key in patch) {
      sets.push(`${col} = $${idx}`);
      params.push(JSON.stringify(patch[key]));
      idx++;
    }
  }

  if (sets.length === 1) return getWorkflow(db, tenantId, id);

  const result = await db.query(
    `UPDATE workflows SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as WorkflowRow) ?? null;
}

export async function deleteWorkflow(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM workflows WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listWorkflows(
  db: DbPool, tenantId: UUID,
  filters: { trigger_event?: string; is_active?: boolean; limit: number; cursor?: string },
): Promise<PaginatedResponse<WorkflowRow>> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.trigger_event) {
    conditions.push(`trigger_event = $${idx}`);
    params.push(filters.trigger_event);
    idx++;
  }
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
  const countResult = await db.query(`SELECT count(*)::int as total FROM workflows WHERE ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM workflows WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as WorkflowRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

export async function getActiveWorkflowsForEvent(
  db: DbPool, tenantId: UUID, eventType: string,
): Promise<WorkflowRow[]> {
  const result = await db.query(
    `SELECT * FROM workflows
     WHERE tenant_id = $1 AND trigger_event = $2 AND is_active = true`,
    [tenantId, eventType],
  );
  return result.rows as WorkflowRow[];
}

export async function createRun(
  db: DbPool, data: { workflow_id: UUID; event_id?: number; actions_total: number },
): Promise<WorkflowRunRow> {
  const result = await db.query(
    `INSERT INTO workflow_runs (workflow_id, event_id, actions_total)
     VALUES ($1, $2, $3) RETURNING *`,
    [data.workflow_id, data.event_id ?? null, data.actions_total],
  );
  return result.rows[0] as WorkflowRunRow;
}

export async function updateRun(
  db: DbPool, id: UUID,
  data: { status?: string; actions_run?: number; error?: string },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  let idx = 2;

  if (data.status) {
    sets.push(`status = $${idx}`);
    params.push(data.status);
    idx++;
    if (data.status === 'completed' || data.status === 'failed') {
      sets.push('completed_at = now()');
    }
  }
  if (data.actions_run !== undefined) {
    sets.push(`actions_run = $${idx}`);
    params.push(data.actions_run);
    idx++;
  }
  if (data.error) {
    sets.push(`error = $${idx}`);
    params.push(data.error);
    idx++;
  }

  if (sets.length === 0) return;
  await db.query(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function incrementRunCount(db: DbPool, workflowId: UUID): Promise<void> {
  await db.query(
    'UPDATE workflows SET run_count = run_count + 1, last_run_at = now() WHERE id = $1',
    [workflowId],
  );
}

export async function listRuns(
  db: DbPool, workflowId: UUID,
  filters: { status?: string; limit: number; cursor?: string },
): Promise<PaginatedResponse<WorkflowRunRow>> {
  const conditions: string[] = ['workflow_id = $1'];
  const params: unknown[] = [workflowId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`status = $${idx}`);
    params.push(filters.status);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`started_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');
  const countResult = await db.query(`SELECT count(*)::int as total FROM workflow_runs WHERE ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM workflow_runs WHERE ${where} ORDER BY started_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as WorkflowRunRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].started_at : undefined,
  };
}
