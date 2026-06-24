// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type {
  ExternalObjectMapping,
  ExternalSyncConflict,
  ExternalSyncRun,
  ExternalSystem,
  ExternalWritebackRequest,
  PaginatedResponse,
  UUID,
} from '@crmy/shared';
import type { DbPool } from '../pool.js';
import { encryptSecret, redactSecrets } from '../../lib/secrets.js';
import { addStableDescCursorCondition, encodeStableCursor } from './pagination.js';

type Json = Record<string, unknown>;

function safeSystem(row: Record<string, unknown>): ExternalSystem {
  const { encrypted_credentials: encryptedCredentials, ...rest } = row;
  return {
    ...(rest as unknown as ExternalSystem),
    has_credentials: Boolean(encryptedCredentials),
    config: redactSecrets((row.config ?? {}) as Json),
    sync_settings: redactSecrets((row.sync_settings ?? {}) as Json),
    health: redactSecrets((row.health ?? {}) as Json),
  };
}

function pagedResponse<T>(
  rows: T[],
  limit: number,
  cursorFor: (row: T) => unknown,
  idFor: (row: T) => unknown = row => (row as { id?: unknown }).id,
): PaginatedResponse<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = data[data.length - 1];
  const cursorValue = lastRow ? cursorFor(lastRow) : undefined;
  const idValue = lastRow ? idFor(lastRow) : undefined;
  return {
    data,
    total: data.length + (hasMore ? 1 : 0),
    total_is_estimate: true,
    next_cursor: hasMore && typeof cursorValue === 'string'
      ? encodeStableCursor({ sort_value: cursorValue, ...(typeof idValue === 'string' ? { id: idValue } : {}) })
      : undefined,
  };
}

export async function createSystem(
  db: DbPool,
  tenantId: UUID,
  data: {
    name: string;
    system_type: string;
    auth_type: string;
    credentials?: Json;
    config?: Json;
    sync_settings?: Json;
    created_by?: UUID;
  },
): Promise<ExternalSystem> {
  const result = await db.query(
    `INSERT INTO external_systems
       (tenant_id, name, system_type, auth_type, encrypted_credentials, config, sync_settings, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      tenantId,
      data.name,
      data.system_type,
      data.auth_type,
      data.credentials ? JSON.stringify(encryptSecret(data.credentials)) : null,
      JSON.stringify(data.config ?? {}),
      JSON.stringify(data.sync_settings ?? {}),
      data.created_by ?? null,
    ],
  );
  return safeSystem(result.rows[0]);
}

export async function updateSystem(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: {
    name?: string;
    auth_type?: string;
    credentials?: Json;
    config?: Json;
    sync_settings?: Json;
    status?: string;
    health?: Json;
    last_error?: string | null;
    last_sync_at?: string | null;
  },
): Promise<ExternalSystem | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  const fieldMap: Record<string, string> = {
    name: 'name',
    auth_type: 'auth_type',
    config: 'config',
    sync_settings: 'sync_settings',
    status: 'status',
    health: 'health',
    last_error: 'last_error',
    last_sync_at: 'last_sync_at',
  };

  for (const [key, column] of Object.entries(fieldMap)) {
    if (key in patch) {
      const value = key === 'config' || key === 'sync_settings' || key === 'health'
        ? JSON.stringify(patch[key as keyof typeof patch] ?? {})
        : patch[key as keyof typeof patch];
      sets.push(`${column} = $${idx}`);
      params.push(value);
      idx++;
    }
  }

  if (patch.credentials !== undefined) {
    sets.push(`encrypted_credentials = $${idx}`);
    params.push(JSON.stringify(encryptSecret(patch.credentials)));
    idx++;
  }

  const result = await db.query(
    `UPDATE external_systems SET ${sets.join(', ')}
     WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return result.rows[0] ? safeSystem(result.rows[0]) : null;
}

export async function deleteSystem(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query('DELETE FROM external_systems WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  return (result.rowCount ?? 0) > 0;
}

export async function getSystem(db: DbPool, tenantId: UUID, id: UUID): Promise<ExternalSystem | null> {
  const result = await db.query('SELECT * FROM external_systems WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  return result.rows[0] ? safeSystem(result.rows[0]) : null;
}

export async function getSystemWithCredentials(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
): Promise<(ExternalSystem & { encrypted_credentials?: unknown }) | null> {
  const result = await db.query('SELECT * FROM external_systems WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  return (result.rows[0] as ExternalSystem & { encrypted_credentials?: unknown }) ?? null;
}

export async function listSystems(
  db: DbPool,
  tenantId: UUID,
  filters: { system_type?: string; status?: string; limit: number; cursor?: string },
): Promise<PaginatedResponse<ExternalSystem>> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;
  if (filters.system_type) { conditions.push(`system_type = $${idx}`); params.push(filters.system_type); idx++; }
  if (filters.status) { conditions.push(`status = $${idx}`); params.push(filters.status); idx++; }
  idx = addStableDescCursorCondition(conditions, params, idx, filters.cursor, 'created_at', 'id');
  const where = conditions.join(' AND ');
  params.push(filters.limit + 1);
  const result = await db.query(
    `SELECT * FROM external_systems WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${idx}`,
    params,
  );
  const rows = result.rows.map(safeSystem);
  return pagedResponse(rows, filters.limit, row => row.created_at);
}

export async function upsertMapping(
  db: DbPool,
  tenantId: UUID,
  data: Partial<ExternalObjectMapping> & {
    system_id: UUID;
    object_type: ExternalObjectMapping['object_type'];
    external_object: string;
  },
): Promise<ExternalObjectMapping> {
  if (data.id) {
    const result = await db.query(
      `UPDATE external_object_mappings SET
         external_id_field=$3, watermark_field=$4, field_mapping=$5, readable_fields=$6,
         writable_fields=$7, source_authority=$8, writeback_mode=$9, writeback_config=$10,
         allow_source_loop=$11, is_active=$12, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [
        tenantId, data.id, data.external_id_field ?? 'id', data.watermark_field ?? null,
        JSON.stringify(data.field_mapping ?? {}), data.readable_fields ?? [], data.writable_fields ?? [],
        data.source_authority ?? 'external', data.writeback_mode ?? null, JSON.stringify(data.writeback_config ?? {}),
        data.allow_source_loop ?? false, data.is_active ?? true,
      ],
    );
    return result.rows[0] as ExternalObjectMapping;
  }

  const result = await db.query(
    `INSERT INTO external_object_mappings
       (tenant_id, system_id, object_type, external_object, external_id_field, watermark_field,
        field_mapping, readable_fields, writable_fields, source_authority, writeback_mode,
        writeback_config, allow_source_loop, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (tenant_id, system_id, object_type, external_object)
     DO UPDATE SET
       external_id_field=EXCLUDED.external_id_field, watermark_field=EXCLUDED.watermark_field,
       field_mapping=EXCLUDED.field_mapping, readable_fields=EXCLUDED.readable_fields,
       writable_fields=EXCLUDED.writable_fields, source_authority=EXCLUDED.source_authority,
       writeback_mode=EXCLUDED.writeback_mode, writeback_config=EXCLUDED.writeback_config,
       allow_source_loop=EXCLUDED.allow_source_loop, is_active=EXCLUDED.is_active, updated_at=now()
     RETURNING *`,
    [
      tenantId, data.system_id, data.object_type, data.external_object,
      data.external_id_field ?? 'id', data.watermark_field ?? null,
      JSON.stringify(data.field_mapping ?? {}), data.readable_fields ?? [], data.writable_fields ?? [],
      data.source_authority ?? 'external', data.writeback_mode ?? null, JSON.stringify(data.writeback_config ?? {}),
      data.allow_source_loop ?? false, data.is_active ?? true,
    ],
  );
  return result.rows[0] as ExternalObjectMapping;
}

export async function getMapping(db: DbPool, tenantId: UUID, id: UUID): Promise<ExternalObjectMapping | null> {
  const result = await db.query('SELECT * FROM external_object_mappings WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  return (result.rows[0] as ExternalObjectMapping) ?? null;
}

export async function deleteMapping(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query('DELETE FROM external_object_mappings WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  return (result.rowCount ?? 0) > 0;
}

export async function listMappings(
  db: DbPool,
  tenantId: UUID,
  filters: { system_id?: UUID; object_type?: string; is_active?: boolean; limit: number; cursor?: string },
): Promise<PaginatedResponse<ExternalObjectMapping>> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;
  if (filters.system_id) { conditions.push(`system_id = $${idx}`); params.push(filters.system_id); idx++; }
  if (filters.object_type) { conditions.push(`object_type = $${idx}`); params.push(filters.object_type); idx++; }
  if (filters.is_active !== undefined) { conditions.push(`is_active = $${idx}`); params.push(filters.is_active); idx++; }
  idx = addStableDescCursorCondition(conditions, params, idx, filters.cursor, 'created_at', 'id');
  const where = conditions.join(' AND ');
  params.push(filters.limit + 1);
  const result = await db.query(
    `SELECT * FROM external_object_mappings WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${idx}`,
    params,
  );
  const rows = result.rows as ExternalObjectMapping[];
  return pagedResponse(rows, filters.limit, row => row.created_at);
}

export async function updateMappingCheckpoint(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  checkpoint: { sync_cursor?: string | null; sync_watermark?: string | null; last_sync_run_id?: UUID | null },
): Promise<ExternalObjectMapping | null> {
  const result = await db.query(
    `UPDATE external_object_mappings
     SET sync_cursor = $3,
         sync_watermark = COALESCE($4, sync_watermark),
         last_sync_run_id = $5,
         last_sync_at = now(),
         updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [
      tenantId,
      id,
      checkpoint.sync_cursor ?? null,
      checkpoint.sync_watermark ?? null,
      checkpoint.last_sync_run_id ?? null,
    ],
  );
  return (result.rows[0] as ExternalObjectMapping) ?? null;
}

export async function createSyncRun(
  db: DbPool,
  tenantId: UUID,
  data: Partial<ExternalSyncRun> & { system_id: UUID; mode: ExternalSyncRun['mode'] },
): Promise<ExternalSyncRun> {
  const result = await db.query(
    `INSERT INTO external_sync_runs
       (tenant_id, system_id, mapping_id, mode, cursor_value, watermark_value, replay_of_run_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      tenantId, data.system_id, data.mapping_id ?? null, data.mode,
      data.cursor_value ?? null, data.watermark_value ?? null, data.replay_of_run_id ?? null,
      JSON.stringify(data.metadata ?? {}),
    ],
  );
  return result.rows[0] as ExternalSyncRun;
}

export async function updateSyncRun(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Partial<ExternalSyncRun>,
): Promise<ExternalSyncRun | null> {
  const fields = [
    'status', 'cursor_value', 'watermark_value', 'records_seen', 'records_created',
    'records_updated', 'records_skipped', 'conflicts_created', 'error', 'metadata',
  ];
  const sets: string[] = [];
  const params: unknown[] = [tenantId, id];
  let idx = 3;
  for (const field of fields) {
    if (field in patch) {
      sets.push(`${field} = $${idx}`);
      params.push(field === 'metadata' ? JSON.stringify(patch.metadata ?? {}) : (patch as Record<string, unknown>)[field]);
      idx++;
    }
  }
  if (patch.status === 'completed' || patch.status === 'failed' || patch.status === 'cancelled') {
    sets.push('completed_at = now()');
  }
  if (sets.length === 0) return null;
  const result = await db.query(
    `UPDATE external_sync_runs SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as ExternalSyncRun) ?? null;
}

export async function listSyncRuns(
  db: DbPool,
  tenantId: UUID,
  filters: { system_id?: UUID; status?: string; limit: number; cursor?: string },
): Promise<PaginatedResponse<ExternalSyncRun>> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;
  if (filters.system_id) { conditions.push(`system_id = $${idx}`); params.push(filters.system_id); idx++; }
  if (filters.status) { conditions.push(`status = $${idx}`); params.push(filters.status); idx++; }
  idx = addStableDescCursorCondition(conditions, params, idx, filters.cursor, 'started_at', 'id');
  const where = conditions.join(' AND ');
  params.push(filters.limit + 1);
  const result = await db.query(`SELECT * FROM external_sync_runs WHERE ${where} ORDER BY started_at DESC, id DESC LIMIT $${idx}`, params);
  const rows = result.rows as ExternalSyncRun[];
  return pagedResponse(rows, filters.limit, row => row.started_at);
}

export async function upsertRecordRef(
  db: DbPool,
  tenantId: UUID,
  data: {
    system_id: UUID; mapping_id?: UUID; object_type: string; object_id: UUID;
    external_object: string; external_record_id: string; external_updated_at?: string;
    source_hash?: string; last_sync_run_id?: UUID; metadata?: Json;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO external_record_refs
       (tenant_id, system_id, mapping_id, object_type, object_id, external_object, external_record_id,
        external_updated_at, source_hash, last_sync_run_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tenant_id, system_id, external_object, external_record_id)
     DO UPDATE SET object_type=EXCLUDED.object_type, object_id=EXCLUDED.object_id,
       mapping_id=EXCLUDED.mapping_id, external_updated_at=EXCLUDED.external_updated_at,
       source_hash=EXCLUDED.source_hash, last_sync_run_id=EXCLUDED.last_sync_run_id,
       metadata=EXCLUDED.metadata, last_seen_at=now(), updated_at=now()`,
    [
      tenantId, data.system_id, data.mapping_id ?? null, data.object_type, data.object_id,
      data.external_object, data.external_record_id, data.external_updated_at ?? null,
      data.source_hash ?? null, data.last_sync_run_id ?? null, JSON.stringify(data.metadata ?? {}),
    ],
  );
}

export async function findRecordRef(
  db: DbPool,
  tenantId: UUID,
  systemId: UUID,
  externalObject: string,
  externalRecordId: string,
): Promise<{ object_type: string; object_id: UUID; source_hash?: string | null; metadata?: Json } | null> {
  const result = await db.query(
    `SELECT object_type, object_id, source_hash, metadata FROM external_record_refs
     WHERE tenant_id = $1 AND system_id = $2 AND external_object = $3 AND external_record_id = $4`,
    [tenantId, systemId, externalObject, externalRecordId],
  );
  return (result.rows[0] as { object_type: string; object_id: UUID; source_hash?: string | null; metadata?: Json }) ?? null;
}

export async function findRecordRefForObject(
  db: DbPool,
  tenantId: UUID,
  systemId: UUID,
  objectType: string,
  objectId: UUID,
  externalObject: string,
): Promise<{ external_record_id: string; object_type: string; object_id: UUID } | null> {
  const result = await db.query(
    `SELECT external_record_id, object_type, object_id FROM external_record_refs
     WHERE tenant_id = $1 AND system_id = $2 AND object_type = $3 AND object_id = $4 AND external_object = $5`,
    [tenantId, systemId, objectType, objectId, externalObject],
  );
  return (result.rows[0] as { external_record_id: string; object_type: string; object_id: UUID }) ?? null;
}

export async function createConflict(
  db: DbPool,
  tenantId: UUID,
  data: Partial<ExternalSyncConflict> & {
    system_id: UUID; object_type: string; external_object: string; external_record_id: string; field_name: string;
  },
): Promise<ExternalSyncConflict> {
  const result = await db.query(
    `INSERT INTO external_sync_conflicts
       (tenant_id, system_id, mapping_id, sync_run_id, object_type, object_id, external_object,
        external_record_id, field_name, local_value, external_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      tenantId, data.system_id, data.mapping_id ?? null, data.sync_run_id ?? null, data.object_type,
      data.object_id ?? null, data.external_object, data.external_record_id, data.field_name,
      JSON.stringify(data.local_value ?? null), JSON.stringify(data.external_value ?? null),
    ],
  );
  return result.rows[0] as ExternalSyncConflict;
}

export async function listConflicts(
  db: DbPool,
  tenantId: UUID,
  filters: { system_id?: UUID; status?: string; object_type?: string; object_id?: UUID; limit: number; cursor?: string },
): Promise<PaginatedResponse<ExternalSyncConflict>> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;
  if (filters.system_id) { conditions.push(`system_id = $${idx}`); params.push(filters.system_id); idx++; }
  if (filters.status) { conditions.push(`status = $${idx}`); params.push(filters.status); idx++; }
  if (filters.object_type) { conditions.push(`object_type = $${idx}`); params.push(filters.object_type); idx++; }
  if (filters.object_id) { conditions.push(`object_id = $${idx}`); params.push(filters.object_id); idx++; }
  idx = addStableDescCursorCondition(conditions, params, idx, filters.cursor, 'created_at', 'id');
  const where = conditions.join(' AND ');
  params.push(filters.limit + 1);
  const result = await db.query(`SELECT * FROM external_sync_conflicts WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${idx}`, params);
  const rows = result.rows as ExternalSyncConflict[];
  return pagedResponse(rows, filters.limit, row => row.created_at);
}

export async function getConflict(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
): Promise<ExternalSyncConflict | null> {
  const result = await db.query(
    'SELECT * FROM external_sync_conflicts WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  return (result.rows[0] as ExternalSyncConflict) ?? null;
}

export async function resolveConflict(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  resolution: ExternalSyncConflict['status'],
  note: string | undefined,
  actorId: string,
): Promise<ExternalSyncConflict | null> {
  const result = await db.query(
    `UPDATE external_sync_conflicts
     SET status=$3, resolution_note=$4, resolved_by=$5, resolved_at=now()
     WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenantId, id, resolution, note ?? null, actorId],
  );
  return (result.rows[0] as ExternalSyncConflict) ?? null;
}

export async function replaceRecordRefExternalId(
  db: DbPool,
  tenantId: UUID,
  data: {
    system_id: UUID;
    object_type: string;
    object_id: UUID;
    external_object: string;
    external_record_id: string;
    metadata?: Json;
  },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE external_record_refs
     SET external_record_id = $6,
         metadata = COALESCE($7, metadata),
         last_seen_at = now(),
         updated_at = now()
     WHERE tenant_id = $1
       AND system_id = $2
       AND object_type = $3
       AND object_id = $4
       AND external_object = $5`,
    [
      tenantId,
      data.system_id,
      data.object_type,
      data.object_id,
      data.external_object,
      data.external_record_id,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createWriteback(
  db: DbPool,
  tenantId: UUID,
  data: Partial<ExternalWritebackRequest> & {
    system_id: UUID; object_type: string; external_object: string; operation: ExternalWritebackRequest['operation'];
    writeback_mode: ExternalWritebackRequest['writeback_mode']; payload: Json;
  },
): Promise<ExternalWritebackRequest> {
  const result = await db.query(
    `INSERT INTO external_writeback_requests
       (tenant_id, system_id, mapping_id, object_type, object_id, external_object, external_record_id,
        operation, writeback_mode, preview, payload, policy_result, status, hitl_request_id,
        idempotency_key, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      tenantId, data.system_id, data.mapping_id ?? null, data.object_type, data.object_id ?? null,
      data.external_object, data.external_record_id ?? null, data.operation, data.writeback_mode,
      JSON.stringify(data.preview ?? {}), JSON.stringify(data.payload ?? {}),
      JSON.stringify(data.policy_result ?? {}), data.status ?? 'pending', data.hitl_request_id ?? null,
      data.idempotency_key ?? null, data.requested_by ?? null,
    ],
  );
  return result.rows[0] as ExternalWritebackRequest;
}

export async function getWriteback(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
): Promise<ExternalWritebackRequest | null> {
  const result = await db.query(
    'SELECT * FROM external_writeback_requests WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  return (result.rows[0] as ExternalWritebackRequest) ?? null;
}

export async function getWritebackByHitlRequestId(
  db: DbPool,
  tenantId: UUID,
  hitlRequestId: UUID,
): Promise<ExternalWritebackRequest | null> {
  const result = await db.query(
    'SELECT * FROM external_writeback_requests WHERE tenant_id = $1 AND hitl_request_id = $2',
    [tenantId, hitlRequestId],
  );
  return (result.rows[0] as ExternalWritebackRequest) ?? null;
}

export async function getWritebackByIdempotencyKey(
  db: DbPool,
  tenantId: UUID,
  systemId: UUID,
  idempotencyKey: string,
): Promise<ExternalWritebackRequest | null> {
  const result = await db.query(
    'SELECT * FROM external_writeback_requests WHERE tenant_id = $1 AND system_id = $2 AND idempotency_key = $3',
    [tenantId, systemId, idempotencyKey],
  );
  return (result.rows[0] as ExternalWritebackRequest) ?? null;
}

export async function updateWriteback(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Partial<ExternalWritebackRequest>,
): Promise<ExternalWritebackRequest | null> {
  const fields = ['status', 'policy_result', 'execution_result', 'hitl_request_id', 'external_record_id'];
  const sets: string[] = ['updated_at=now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;
  for (const field of fields) {
    if (field in patch) {
      sets.push(`${field} = $${idx}`);
      params.push(field.endsWith('result') ? JSON.stringify((patch as Record<string, unknown>)[field] ?? {}) : (patch as Record<string, unknown>)[field]);
      idx++;
    }
  }
  if (patch.status === 'completed' || patch.status === 'failed') sets.push('executed_at=now()');
  const result = await db.query(
    `UPDATE external_writeback_requests SET ${sets.join(', ')} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    params,
  );
  return (result.rows[0] as ExternalWritebackRequest) ?? null;
}

export async function claimWritebackForExecution(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  executionResult: Json,
): Promise<ExternalWritebackRequest | null> {
  const result = await db.query(
    `UPDATE external_writeback_requests
     SET status = 'executing',
         execution_result = $3::jsonb,
         updated_at = now()
     WHERE tenant_id = $1
       AND id = $2
       AND status = 'approved'
     RETURNING *`,
    [tenantId, id, JSON.stringify(executionResult)],
  );
  return (result.rows[0] as ExternalWritebackRequest) ?? null;
}

export async function listWritebacks(
  db: DbPool,
  tenantId: UUID,
  filters: { system_id?: UUID; status?: string; limit: number; cursor?: string },
): Promise<PaginatedResponse<ExternalWritebackRequest>> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;
  if (filters.system_id) { conditions.push(`system_id = $${idx}`); params.push(filters.system_id); idx++; }
  if (filters.status) { conditions.push(`status = $${idx}`); params.push(filters.status); idx++; }
  idx = addStableDescCursorCondition(conditions, params, idx, filters.cursor, 'created_at', 'id');
  const where = conditions.join(' AND ');
  params.push(filters.limit + 1);
  const result = await db.query(`SELECT * FROM external_writeback_requests WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${idx}`, params);
  const rows = result.rows as ExternalWritebackRequest[];
  return pagedResponse(rows, filters.limit, row => row.created_at);
}
