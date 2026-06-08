// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ConnectorAdapter, ConnectorContext } from './adapters.js';
import { adapterError, assertWriteMode, checkpointWatermark, connectorFetch, connectorHttpError, readJsonResponse, requireString, safeIdentifier, safeQualifiedIdentifier, writebackParameters } from './adapters.js';

function accountUrl(credentials: Record<string, unknown>): string {
  return requireString(credentials.account_url ?? credentials.host, 'Snowflake account_url').replace(/\/$/, '');
}

function token(credentials: Record<string, unknown>): string {
  return requireString(credentials.token ?? credentials.access_token, 'Snowflake SQL API token');
}

async function sql(ctx: ConnectorContext, statement: string, bindings: unknown[] = []): Promise<unknown> {
  const res = await connectorFetch(`${accountUrl(ctx.credentials)}/api/v2/statements`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token(ctx.credentials)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      statement,
      timeout: 30,
      database: ctx.system.config.database,
      schema: ctx.system.config.schema,
      warehouse: ctx.system.config.warehouse,
      role: ctx.system.config.role,
      bindings: Object.fromEntries(bindings.map((value, index) => [`p${index + 1}`, { type: 'TEXT', value }])),
    }),
  });
  const body = await readJsonResponse(res);
  if (!res.ok) throw connectorHttpError('Snowflake', res.status, body);
  return body;
}

function rowsFromSql(body: unknown): Record<string, unknown>[] {
  const meta = (body as { resultSetMetaData?: { rowType?: Array<{ name: string }> } }).resultSetMetaData;
  const columns = meta?.rowType?.map(col => col.name) ?? [];
  const data = (body as { data?: unknown[][] }).data ?? [];
  return data.map(row => Object.fromEntries(row.map((value, idx) => [columns[idx] ?? `col_${idx}`, value])));
}

export const snowflakeAdapter: ConnectorAdapter = {
  type: 'snowflake',
  async validateConfig(ctx) {
    const errors: string[] = [];
    if (!ctx.credentials.account_url && !ctx.credentials.host) errors.push('Snowflake account_url is required.');
    if (!ctx.credentials.token && !ctx.credentials.access_token) errors.push('Snowflake SQL API token is required.');
    if (!ctx.system.config.warehouse) errors.push('Snowflake warehouse is required.');
    return { valid: errors.length === 0, errors };
  },
  async testConnection(ctx) {
    await sql(ctx, 'SELECT 1 AS OK');
    return { ok: true, message: 'Snowflake SQL API connection succeeded.' };
  },
  async discoverObjects(ctx) {
    const body = await sql(ctx, 'SHOW TABLES');
    return rowsFromSql(body).map(row => {
      const name = String(row.name ?? row.NAME ?? '');
      return { name, label: name, supports_write: true };
    }).filter(item => item.name);
  },
  async discoverFields(ctx, objectName) {
    const body = await sql(ctx, `DESCRIBE TABLE ${safeQualifiedIdentifier(objectName, 'Snowflake table')}`);
    return rowsFromSql(body).map(row => ({
      name: String(row.name ?? row.NAME ?? ''),
      label: String(row.name ?? row.NAME ?? ''),
      type: row.type ? String(row.type) : row.TYPE ? String(row.TYPE) : undefined,
      writable: true,
    })).filter(field => field.name);
  },
  async pullChanges(ctx, mapping, cursor) {
    const fields = Array.from(new Set([mapping.external_id_field, mapping.watermark_field, ...Object.values(mapping.field_mapping ?? {}), ...(mapping.readable_fields ?? [])].filter(Boolean)))
      .map(field => safeIdentifier(field, 'Snowflake mapped field'));
    const table = safeQualifiedIdentifier(mapping.external_object, 'Snowflake mapped table');
    const watermarkField = mapping.watermark_field ? safeIdentifier(mapping.watermark_field, 'Snowflake watermark field') : undefined;
    const idField = safeIdentifier(mapping.external_id_field, 'Snowflake external ID field');
    const watermark = checkpointWatermark(cursor);
    const where = watermark && watermarkField ? ` WHERE ${watermarkField} > ?` : '';
    const query = `SELECT ${fields.join(', ')} FROM ${table}${where} ORDER BY ${watermarkField ?? idField} ASC LIMIT 200`;
    const body = await sql(ctx, query, watermark && watermarkField ? [watermark] : []);
    const rows = rowsFromSql(body);
    const records = rows.map(row => ({
      external_object: mapping.external_object,
      external_record_id: String(row[mapping.external_id_field] ?? row[mapping.external_id_field.toUpperCase()] ?? ''),
      external_updated_at: mapping.watermark_field ? String(row[mapping.watermark_field] ?? row[mapping.watermark_field.toUpperCase()] ?? '') : undefined,
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
        ...(missingTemplate ? ['Snowflake writeback requires an admin-defined sql_template in mapping.writeback_config.'] : []),
      ],
      mode: input.writeback_mode,
    };
  },
  async executeWrite(ctx, mapping, input) {
    assertWriteMode(mapping, input.writeback_mode);
    const template = mapping.writeback_config?.sql_template;
    if (typeof template !== 'string' || !template.trim()) {
      throw new Error('Snowflake writeback requires an admin-defined sql_template in mapping.writeback_config.');
    }
    const body = await sql(ctx, template, writebackParameters(mapping.writeback_config ?? {}, input.payload));
    return { ok: true, external_record_id: input.external_record_id, result: { response: body } };
  },
  normalizeError: adapterError,
};
