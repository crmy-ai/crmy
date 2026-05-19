// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ConnectorAdapter, ConnectorContext } from './adapters.js';
import { adapterError, assertWriteMode, checkpointWatermark, connectorHttpError, readJsonResponse, requireString, safeIdentifier, safeQualifiedIdentifier, writebackParameters } from './adapters.js';

function host(credentials: Record<string, unknown>): string {
  return requireString(credentials.host, 'Databricks host').replace(/\/$/, '');
}

function token(credentials: Record<string, unknown>): string {
  return requireString(credentials.token ?? credentials.pat, 'Databricks token');
}

function warehouseId(credentials: Record<string, unknown>, config: Record<string, unknown>): string {
  return requireString(config.warehouse_id ?? credentials.warehouse_id, 'Databricks SQL warehouse_id');
}

async function statement(ctx: ConnectorContext, sql: string, parameters: unknown[] = []): Promise<unknown> {
  const res = await fetch(`${host(ctx.credentials)}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token(ctx.credentials)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      warehouse_id: warehouseId(ctx.credentials, ctx.system.config),
      statement: sql,
      parameters: parameters.map((value, index) => ({ name: `p${index + 1}`, value })),
      wait_timeout: '30s',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    }),
  });
  const body = await readJsonResponse(res);
  if (!res.ok) throw connectorHttpError('Databricks', res.status, body);
  return body;
}

function rowsFromStatement(body: unknown): Record<string, unknown>[] {
  const manifest = (body as { manifest?: { schema?: { columns?: Array<{ name: string }> } } }).manifest;
  const columns = manifest?.schema?.columns?.map(col => col.name) ?? [];
  const rows = (body as { result?: { data_array?: unknown[][] } }).result?.data_array ?? [];
  return rows.map(row => Object.fromEntries(row.map((value, idx) => [columns[idx] ?? `col_${idx}`, value])));
}

export const databricksAdapter: ConnectorAdapter = {
  type: 'databricks',
  async validateConfig(ctx) {
    const errors: string[] = [];
    if (!ctx.credentials.host) errors.push('Databricks host is required.');
    if (!ctx.credentials.token && !ctx.credentials.pat) errors.push('Databricks token is required.');
    if (!ctx.system.config?.warehouse_id && !ctx.credentials.warehouse_id) errors.push('Databricks warehouse_id is required.');
    return { valid: errors.length === 0, errors };
  },
  async testConnection(ctx) {
    await statement(ctx, 'SELECT 1 AS ok');
    return { ok: true, message: 'Databricks SQL connection succeeded.' };
  },
  async discoverObjects(ctx) {
    const body = await statement(ctx, 'SHOW TABLES');
    return rowsFromStatement(body).map(row => {
      const name = String(row.tableName ?? row.table_name ?? row.name ?? '');
      return { name, label: name, supports_write: true };
    }).filter(item => item.name);
  },
  async discoverFields(ctx, objectName) {
    const body = await statement(ctx, `DESCRIBE TABLE ${safeQualifiedIdentifier(objectName, 'Databricks table')}`);
    return rowsFromStatement(body).map(row => ({
      name: String(row.col_name ?? row.column_name ?? row.name ?? ''),
      label: String(row.col_name ?? row.column_name ?? row.name ?? ''),
      type: row.data_type ? String(row.data_type) : undefined,
      writable: true,
    })).filter(field => field.name && !field.name.startsWith('#'));
  },
  async pullChanges(ctx, mapping, cursor) {
    const fields = Array.from(new Set([mapping.external_id_field, mapping.watermark_field, ...Object.values(mapping.field_mapping ?? {}), ...(mapping.readable_fields ?? [])].filter(Boolean)))
      .map(field => safeIdentifier(field, 'Databricks mapped field'));
    const table = safeQualifiedIdentifier(mapping.external_object, 'Databricks mapped table');
    const watermarkField = mapping.watermark_field ? safeIdentifier(mapping.watermark_field, 'Databricks watermark field') : undefined;
    const idField = safeIdentifier(mapping.external_id_field, 'Databricks external ID field');
    const watermark = checkpointWatermark(cursor);
    const where = watermark && watermarkField ? ` WHERE ${watermarkField} > :p1` : '';
    const sql = `SELECT ${fields.join(', ')} FROM ${table}${where} ORDER BY ${watermarkField ?? idField} ASC LIMIT 200`;
    const body = await statement(ctx, sql, watermark && watermarkField ? [watermark] : []);
    const rows = rowsFromStatement(body);
    const records = rows.map(row => ({
      external_object: mapping.external_object,
      external_record_id: String(row[mapping.external_id_field]),
      external_updated_at: mapping.watermark_field ? String(row[mapping.watermark_field] ?? '') : undefined,
      fields: row,
      raw: row,
    }));
    return { records, watermark: records.at(-1)?.external_updated_at };
  },
  async previewWrite(_ctx, mapping, input) {
    assertWriteMode(mapping, input.writeback_mode);
    const writable = new Set(mapping.writable_fields ?? []);
    const blockedFields = Object.keys(input.payload).filter(field => writable.size > 0 && !writable.has(field));
    const template = mapping.writeback_config?.sql_template;
    const missingTemplate = typeof template !== 'string' || !template.trim();
    const validMode = ['append_event', 'mapped_upsert', 'stored_procedure'].includes(input.writeback_mode);
    return {
      allowed: validMode && blockedFields.length === 0 && !missingTemplate,
      requires_approval: true,
      diff: { external_record_id: input.external_record_id, payload: input.payload },
      warnings: [
        ...blockedFields.map(field => `Field ${field} is not writable for this mapping.`),
        ...(missingTemplate ? ['Databricks writeback requires an admin-defined sql_template in mapping.writeback_config.'] : []),
      ],
      mode: input.writeback_mode,
    };
  },
  async executeWrite(ctx, mapping, input) {
    assertWriteMode(mapping, input.writeback_mode);
    const config = mapping.writeback_config ?? {};
    const template = config.sql_template;
    if (typeof template !== 'string' || !template.trim()) {
      throw new Error('Databricks writeback requires an admin-defined sql_template in mapping.writeback_config.');
    }
    const body = await statement(ctx, template, writebackParameters(config, input.payload));
    return { ok: true, external_record_id: input.external_record_id, result: { response: body } };
  },
  normalizeError: adapterError,
};
