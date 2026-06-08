// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ConnectorAdapter } from './adapters.js';
import { adapterError, assertWriteMode, checkpointWatermark, connectorFetch, connectorHttpError, readJsonResponse, requireString, safeIdentifier } from './adapters.js';

const TOKEN_REFRESH_WINDOW_MS = 2 * 60 * 1000;

type SalesforceCursor = {
  next_url?: string;
  watermark?: string;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function baseUrl(credentials: Record<string, unknown>): string {
  return requireString(credentials.instance_url, 'Salesforce instance_url').replace(/\/$/, '');
}

function accessToken(credentials: Record<string, unknown>): string {
  return requireString(credentials.access_token, 'Salesforce access_token');
}

function tokenUrl(credentials: Record<string, unknown>): string {
  const explicit = optionalString(credentials.token_url);
  if (explicit) return explicit;
  const loginUrl = optionalString(credentials.login_url) ?? 'https://login.salesforce.com';
  return `${loginUrl.replace(/\/$/, '')}/services/oauth2/token`;
}

function tokenExpiresSoon(credentials: Record<string, unknown>): boolean {
  const raw = optionalString(credentials.token_expires_at);
  if (!raw) return false;
  const expiresAt = new Date(raw).getTime();
  return Number.isFinite(expiresAt) && expiresAt - Date.now() <= TOKEN_REFRESH_WINDOW_MS;
}

function parseSalesforceCursor(cursor?: string): SalesforceCursor {
  if (!cursor) return {};
  try {
    const parsed = JSON.parse(cursor) as Record<string, unknown>;
    return {
      next_url: optionalString(parsed.next_url),
      watermark: optionalString(parsed.watermark),
    };
  } catch {
    return { watermark: cursor };
  }
}

function soqlDateTimeLiteral(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('Salesforce LastModifiedDate watermark must be an ISO date-time string.');
  }
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export async function refreshSalesforceOAuthCredentials(
  credentials: Record<string, unknown>,
  options: { force?: boolean } = {},
): Promise<{ credentials: Record<string, unknown>; refreshed: boolean }> {
  const refreshToken = optionalString(credentials.refresh_token);
  if (!refreshToken) return { credentials, refreshed: false };
  const hasAccessToken = Boolean(optionalString(credentials.access_token));
  if (hasAccessToken && !options.force && !tokenExpiresSoon(credentials)) {
    return { credentials, refreshed: false };
  }

  const clientId = requireString(credentials.client_id, 'Salesforce OAuth Client ID');
  const clientSecret = requireString(credentials.client_secret, 'Salesforce OAuth Client Secret');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await connectorFetch(tokenUrl(credentials), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const response = await readJsonResponse(res);
  if (!res.ok) {
    const message = typeof response === 'object' && response && 'error_description' in response
      ? String((response as { error_description?: unknown }).error_description)
      : `Salesforce token refresh failed with HTTP ${res.status}`;
    throw new Error(`Salesforce OAuth token refresh failed: ${message}. Reconnect Salesforce from Systems of Record if this keeps happening.`);
  }

  const payload = response as Record<string, unknown>;
  const access = optionalString(payload.access_token);
  if (!access) throw new Error('Salesforce token refresh succeeded but did not return an access token.');
  const expiresIn = Number(payload.expires_in ?? payload.expiresIn ?? 0);
  const nextCredentials: Record<string, unknown> = {
    ...credentials,
    access_token: access,
    token_type: payload.token_type ?? payload.tokenType ?? credentials.token_type ?? 'Bearer',
    instance_url: optionalString(payload.instance_url) ?? optionalString(credentials.instance_url),
    issued_at: payload.issued_at ?? credentials.issued_at,
    signature: payload.signature ?? credentials.signature,
    scope: payload.scope ?? credentials.scope,
  };
  if (expiresIn > 0) {
    nextCredentials.token_expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
  }
  return { credentials: nextCredentials, refreshed: true };
}

async function sfFetch(credentials: Record<string, unknown>, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await connectorFetch(`${baseUrl(credentials)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken(credentials)}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const body = await readJsonResponse(res);
  if (!res.ok) throw connectorHttpError('Salesforce', res.status, body);
  return body;
}

export const salesforceAdapter: ConnectorAdapter = {
  type: 'salesforce',
  async validateConfig(ctx) {
    const errors: string[] = [];
    if (!ctx.credentials.instance_url) errors.push('Salesforce instance_url is required.');
    if (!ctx.credentials.access_token && !ctx.credentials.refresh_token) {
      errors.push('Salesforce access_token is required, or provide refresh_token with client_id and client_secret so CRMy can refresh OAuth credentials.');
    }
    if (ctx.credentials.refresh_token && (!ctx.credentials.client_id || !ctx.credentials.client_secret)) {
      errors.push('Salesforce refresh_token requires client_id and client_secret.');
    }
    return { valid: errors.length === 0, errors };
  },
  async testConnection(ctx) {
    await sfFetch(ctx.credentials, '/services/data/v60.0/limits');
    return { ok: true, message: 'Salesforce connection succeeded.' };
  },
  async discoverObjects(ctx) {
    const body = await sfFetch(ctx.credentials, '/services/data/v60.0/sobjects');
    const sobjects = ((body as { sobjects?: Array<Record<string, unknown>> }).sobjects ?? []);
    return sobjects
      .filter(o => ['Account', 'Contact', 'Opportunity', 'Task', 'Event', 'Note'].includes(String(o.name)))
      .map(o => ({ name: String(o.name), label: String(o.label ?? o.name), supports_write: Boolean(o.createable || o.updateable) }));
  },
  async discoverFields(ctx, objectName) {
    const safeObjectName = safeIdentifier(objectName, 'Salesforce object name');
    const body = await sfFetch(ctx.credentials, `/services/data/v60.0/sobjects/${encodeURIComponent(safeObjectName)}/describe`);
    return ((body as { fields?: Array<Record<string, unknown>> }).fields ?? []).map(field => ({
      name: String(field.name),
      label: String(field.label ?? field.name),
      type: field.type ? String(field.type) : undefined,
      writable: Boolean(field.createable || field.updateable),
    }));
  },
  async pullChanges(ctx, mapping, cursor) {
    const checkpoint = parseSalesforceCursor(cursor);
    const watermark = checkpoint.watermark ?? checkpointWatermark(cursor);
    const body = checkpoint.next_url
      ? await sfFetch(ctx.credentials, checkpoint.next_url)
      : await (async () => {
        const objectName = safeIdentifier(mapping.external_object, 'Salesforce mapped object');
        const fields = Array.from(new Set(['Id', 'LastModifiedDate', ...Object.values(mapping.field_mapping ?? {}), ...(mapping.readable_fields ?? [])]))
          .map(field => safeIdentifier(field, 'Salesforce mapped field'));
        const where = watermark ? ` WHERE LastModifiedDate > ${soqlDateTimeLiteral(watermark)}` : '';
        const soql = `SELECT ${fields.join(', ')} FROM ${objectName}${where} ORDER BY LastModifiedDate ASC LIMIT 200`;
        return sfFetch(ctx.credentials, `/services/data/v60.0/query?q=${encodeURIComponent(soql)}`);
      })();
    const rows = (body as { records?: Array<Record<string, unknown>> }).records ?? [];
    const records = rows.map(row => ({
      external_object: mapping.external_object,
      external_record_id: String(row.Id),
      external_updated_at: row.LastModifiedDate ? String(row.LastModifiedDate) : undefined,
      fields: row,
      raw: row,
    }));
    const nextUrl = optionalString((body as { nextRecordsUrl?: unknown }).nextRecordsUrl);
    return {
      records,
      next_cursor: nextUrl ? JSON.stringify({ next_url: nextUrl, watermark }) : undefined,
      watermark: records.at(-1)?.external_updated_at,
    };
  },
  async previewWrite(_ctx, mapping, input) {
    assertWriteMode(mapping, input.writeback_mode);
    const writable = new Set(mapping.writable_fields ?? []);
    const blocked = Object.keys(input.payload).filter(field => writable.size > 0 && !writable.has(field));
    return {
      allowed: blocked.length === 0,
      requires_approval: true,
      diff: { external_record_id: input.external_record_id, payload: input.payload },
      warnings: blocked.map(field => `Field ${field} is not writable for this mapping.`),
      mode: input.writeback_mode,
    };
  },
  async executeWrite(ctx, mapping, input) {
    assertWriteMode(mapping, input.writeback_mode);
    if (input.writeback_mode === 'stored_procedure') throw new Error('Stored procedure writeback is not supported for Salesforce.');
    if (input.external_record_id && (input.operation === 'update' || input.operation === 'upsert')) {
      await sfFetch(ctx.credentials, `/services/data/v60.0/sobjects/${mapping.external_object}/${input.external_record_id}`, {
        method: 'PATCH',
        body: JSON.stringify(input.payload),
      });
      return { ok: true, external_record_id: input.external_record_id, result: { updated: true } };
    }
    const body = await sfFetch(ctx.credentials, `/services/data/v60.0/sobjects/${mapping.external_object}`, {
      method: 'POST',
      body: JSON.stringify(input.payload),
    });
    return { ok: true, external_record_id: String((body as { id?: unknown }).id ?? ''), result: { response: body } };
  },
  normalizeError: adapterError,
};
