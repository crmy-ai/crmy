// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID } from '@crmy/shared';

export interface CustomFieldRow {
  id: UUID;
  tenant_id: UUID;
  object_type: string;
  field_key: string;
  label: string;
  field_type: string;
  options?: unknown;
  is_required: boolean;
  is_filterable: boolean;
  sort_order: number;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export async function createCustomField(
  db: DbPool,
  tenantId: UUID,
  data: {
    object_type: string;
    field_name: string;
    field_type: string;
    label: string;
    description?: string;
    required?: boolean;
    options?: string[];
    created_by?: UUID;
  },
): Promise<CustomFieldRow> {
  const result = await db.query(
    `INSERT INTO custom_field_definitions
       (tenant_id, object_type, field_key, label, field_type, options, is_required, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      tenantId,
      data.object_type,
      data.field_name,
      data.label,
      data.field_type,
      data.options ? JSON.stringify(data.options) : null,
      data.required ?? false,
      data.created_by ?? null,
    ],
  );
  return result.rows[0] as CustomFieldRow;
}

export async function getCustomField(db: DbPool, tenantId: UUID, id: UUID): Promise<CustomFieldRow | null> {
  const result = await db.query(
    'SELECT * FROM custom_field_definitions WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as CustomFieldRow) ?? null;
}

export async function updateCustomField(
  db: DbPool, tenantId: UUID, id: UUID,
  patch: Record<string, unknown>,
): Promise<CustomFieldRow | null> {
  const fieldMap: Record<string, string> = {
    label: 'label',
    required: 'is_required',
    options: 'options',
    sort_order: 'sort_order',
  };

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in patch) {
      const value = key === 'options' ? JSON.stringify(patch[key]) : patch[key];
      sets.push(`${col} = $${idx}`);
      params.push(value);
      idx++;
    }
  }

  if (sets.length === 1) return getCustomField(db, tenantId, id);

  const result = await db.query(
    `UPDATE custom_field_definitions SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as CustomFieldRow) ?? null;
}

export async function deleteCustomField(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM custom_field_definitions WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listCustomFields(
  db: DbPool, tenantId: UUID, objectType: string,
): Promise<CustomFieldRow[]> {
  const result = await db.query(
    `SELECT * FROM custom_field_definitions
     WHERE tenant_id = $1 AND object_type = $2
     ORDER BY sort_order, created_at`,
    [tenantId, objectType],
  );
  return result.rows as CustomFieldRow[];
}
