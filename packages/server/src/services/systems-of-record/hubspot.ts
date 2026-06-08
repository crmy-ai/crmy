// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ConnectorAdapter, ConnectorContext, ExternalRecord, WritePreview } from './adapters.js';
import { adapterError, assertWriteMode, connectorFetch, readJsonResponse, requireString } from './adapters.js';
import type { ExternalObjectMapping } from '@crmy/shared';

const HUBSPOT_BASE = 'https://api.hubapi.com';
const HUBSPOT_TOKEN_URL = `${HUBSPOT_BASE}/oauth/v3/token`;
const TOKEN_REFRESH_WINDOW_MS = 2 * 60 * 1000;
const MAX_FETCH_ATTEMPTS = 3;

class HubSpotConnectorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HubSpotConnectorError';
  }
}

function token(ctx: ConnectorContext): string {
  return requireString(ctx.credentials.access_token ?? ctx.credentials.token ?? ctx.credentials.private_app_token, 'HubSpot access token');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function codeFrom(value: unknown): string | undefined {
  const raw = optionalString(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.searchParams.get('code')?.trim() || raw;
  } catch {
    return raw;
  }
}

function redirectUriFrom(credentials: Record<string, unknown>): string | undefined {
  const explicit = optionalString(credentials.redirect_uri);
  if (explicit) return explicit;
  const installUrl = optionalString(credentials.sample_install_url);
  if (!installUrl) return undefined;
  try {
    const parsed = new URL(installUrl);
    return parsed.searchParams.get('redirect_uri')?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function exchangeHubSpotOAuthCredentials(credentials: Record<string, unknown>): Promise<Record<string, unknown>> {
  const code = codeFrom(credentials.authorization_code ?? credentials.completed_redirect_url ?? credentials.authorization_code_or_redirect_url);
  if (!code && (optionalString(credentials.access_token) || optionalString(credentials.private_app_token) || optionalString(credentials.token))) {
    return credentials;
  }
  if (!code) return credentials;

  const clientId = requireString(credentials.client_id, 'HubSpot OAuth Client ID');
  const clientSecret = requireString(credentials.client_secret, 'HubSpot OAuth Client Secret');
  const redirectUri = requireString(redirectUriFrom(credentials), 'HubSpot OAuth redirect URI');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await connectorFetch(HUBSPOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const response = await readJsonResponse(res);
  if (!res.ok) {
    const message = typeof response === 'object' && response && 'message' in response
      ? String((response as { message?: unknown }).message)
      : `HubSpot token exchange failed with HTTP ${res.status}`;
    throw new Error(message);
  }

  const payload = response as Record<string, unknown>;
  const accessToken = optionalString(payload.access_token ?? payload.accessToken);
  if (!accessToken) throw new Error('HubSpot token exchange succeeded but did not return an access token.');
  const refreshToken = optionalString(payload.refresh_token ?? payload.refreshToken);
  const expiresIn = Number(payload.expires_in ?? payload.expiresIn ?? 0);

  const nextCredentials: Record<string, unknown> = {
    ...credentials,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: payload.token_type ?? payload.tokenType ?? 'bearer',
    hub_id: payload.hub_id ?? payload.hubId,
    scopes: payload.scopes,
  };
  if (expiresIn > 0) {
    nextCredentials.token_expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
  }
  delete nextCredentials.authorization_code;
  delete nextCredentials.completed_redirect_url;
  delete nextCredentials.authorization_code_or_redirect_url;
  return nextCredentials;
}

function tokenExpiresSoon(credentials: Record<string, unknown>): boolean {
  const raw = optionalString(credentials.token_expires_at);
  if (!raw) return false;
  const expiresAt = new Date(raw).getTime();
  return Number.isFinite(expiresAt) && expiresAt - Date.now() <= TOKEN_REFRESH_WINDOW_MS;
}

export async function refreshHubSpotOAuthCredentials(
  credentials: Record<string, unknown>,
  options: { force?: boolean } = {},
): Promise<{ credentials: Record<string, unknown>; refreshed: boolean }> {
  const refreshToken = optionalString(credentials.refresh_token);
  if (!refreshToken || (!options.force && !tokenExpiresSoon(credentials))) {
    return { credentials, refreshed: false };
  }

  const clientId = optionalString(credentials.client_id);
  const clientSecret = optionalString(credentials.client_secret);
  if (!clientId || !clientSecret) return { credentials, refreshed: false };
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await connectorFetch(HUBSPOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const response = await readJsonResponse(res);
  if (!res.ok) {
    const message = responseMessage(response, `HubSpot token refresh failed with HTTP ${res.status}`);
    throw new HubSpotConnectorError(
      `HubSpot OAuth token refresh failed: ${message}. Reinstall the HubSpot app from Systems of Record if this keeps happening.`,
      res.status,
      res.status >= 500 || res.status === 429,
    );
  }

  const payload = response as Record<string, unknown>;
  const accessToken = optionalString(payload.access_token ?? payload.accessToken);
  if (!accessToken) throw new Error('HubSpot token refresh succeeded but did not return an access token.');
  const expiresIn = Number(payload.expires_in ?? payload.expiresIn ?? 0);
  const nextCredentials: Record<string, unknown> = {
    ...credentials,
    access_token: accessToken,
    refresh_token: optionalString(payload.refresh_token ?? payload.refreshToken) ?? refreshToken,
    token_type: payload.token_type ?? payload.tokenType ?? credentials.token_type ?? 'bearer',
    scopes: payload.scopes ?? credentials.scopes,
  };
  if (expiresIn > 0) {
    nextCredentials.token_expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
  }
  return { credentials: nextCredentials, refreshed: true };
}

function responseMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body) {
    const record = body as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (typeof record.error_description === 'string' && record.error_description.trim()) return record.error_description;
    if (typeof record.error === 'string' && record.error.trim()) return record.error;
  }
  return fallback;
}

function retryDelayMs(attempt: number, res: Response): number {
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5000);
  }
  return Math.min(500 * 2 ** attempt, 5000);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function hubspotFetch(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await connectorFetch(`${HUBSPOT_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token(ctx)}`,
          'Content-Type': 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
      });
      const body = await readJsonResponse(res);
      if (res.ok) return body;

      const retryable = res.status === 429 || res.status >= 500;
      const message = responseMessage(body, `HubSpot returned HTTP ${res.status}`);
      if (retryable && attempt < MAX_FETCH_ATTEMPTS - 1) {
        await sleep(retryDelayMs(attempt, res));
        continue;
      }
      throw new HubSpotConnectorError(
        actionableHubSpotMessage(res.status, message),
        res.status,
        retryable,
        typeof body === 'object' && body ? body as Record<string, unknown> : undefined,
      );
    } catch (err) {
      lastError = err;
      if (err instanceof HubSpotConnectorError) throw err;
      if (attempt < MAX_FETCH_ATTEMPTS - 1) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('HubSpot request failed.');
}

function actionableHubSpotMessage(status: number, message: string): string {
  if (status === 401) return `${message}. HubSpot rejected the access token. CRMy will refresh OAuth tokens automatically when possible; reinstall the app if this continues.`;
  if (status === 403) return `${message}. The HubSpot app is missing a required scope for this object or action. Add the scope in HubSpot, reinstall the app, then test again.`;
  if (status === 429) return `${message}. HubSpot rate limited the request. CRMy retried automatically; wait a moment and rerun sync if needed.`;
  if (status >= 500) return `${message}. HubSpot had a temporary server issue. CRMy retried automatically.`;
  return message;
}

const OBJECTS = [
  { name: 'contacts', label: 'Contacts', supports_write: true },
  { name: 'companies', label: 'Companies', supports_write: true },
  { name: 'deals', label: 'Deals', supports_write: true },
  { name: 'notes', label: 'Notes', supports_write: true },
  { name: 'calls', label: 'Calls', supports_write: true },
];

function defaultProperties(objectName: string): string[] {
  switch (objectName) {
    case 'contacts':
      return ['firstname', 'lastname', 'email', 'phone', 'jobtitle', 'company', 'lifecyclestage', 'hs_lastmodifieddate'];
    case 'companies':
      return ['name', 'domain', 'industry', 'numberofemployees', 'annualrevenue', 'website', 'hs_lastmodifieddate'];
    case 'deals':
      return ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline', 'dealtype', 'hs_lastmodifieddate'];
    default:
      return ['hs_timestamp', 'hs_note_body', 'hs_call_title', 'hs_call_body', 'hs_lastmodifieddate'];
  }
}

function defaultAssociations(objectName: string): string[] {
  switch (objectName) {
    case 'contacts':
      return ['companies'];
    case 'deals':
      return ['companies', 'contacts'];
    case 'notes':
    case 'calls':
      return ['companies', 'contacts', 'deals'];
    default:
      return [];
  }
}

function normalizeAssociations(item: Record<string, unknown>): Record<string, string[]> {
  const raw = item.associations;
  if (!raw || typeof raw !== 'object') return {};
  const normalized: Record<string, string[]> = {};
  for (const [objectName, value] of Object.entries(raw as Record<string, unknown>)) {
    const results = value && typeof value === 'object' && Array.isArray((value as { results?: unknown }).results)
      ? (value as { results: Array<Record<string, unknown>> }).results
      : [];
    const ids = results
      .map(result => typeof result.id === 'string' || typeof result.id === 'number' ? String(result.id) : '')
      .filter(Boolean);
    if (ids.length) normalized[objectName] = ids;
  }
  return normalized;
}

function normalizeRecord(objectName: string, item: Record<string, unknown>): ExternalRecord {
  const properties = (item.properties ?? {}) as Record<string, unknown>;
  return {
    external_object: objectName,
    external_record_id: String(item.id),
    external_updated_at: String(item.updatedAt ?? properties.hs_lastmodifieddate ?? ''),
    fields: { id: String(item.id), ...properties },
    associations: normalizeAssociations(item),
    raw: item,
  };
}

function parseHubSpotCursor(cursor?: string): { after?: string; watermark?: string; search?: boolean } {
  if (!cursor) return {};
  try {
    const parsed = JSON.parse(cursor) as { after?: unknown; watermark?: unknown; search?: unknown };
    return {
      after: optionalString(parsed.after),
      watermark: optionalString(parsed.watermark),
      search: Boolean(parsed.search || parsed.watermark),
    };
  } catch {
    return { after: cursor };
  }
}

export const hubspotAdapter: ConnectorAdapter = {
  type: 'hubspot',

  async validateConfig(ctx) {
    const errors: string[] = [];
    if (!ctx.credentials.access_token && !ctx.credentials.token && !ctx.credentials.private_app_token) {
      if (
        ctx.system.auth_type === 'oauth_app'
        || ctx.credentials.app_id
        || ctx.credentials.client_id
        || ctx.credentials.client_secret
      ) {
        errors.push('HubSpot OAuth install is not complete. Open the install button on this connection, approve access in HubSpot, and return to CRMy. If the browser does not finish automatically, edit the connection and paste the redirected URL.');
      } else {
        errors.push('HubSpot access is not configured. Use OAuth app credentials, then install the app from this connection.');
      }
    }
    if (ctx.credentials.access_token && ctx.system.auth_type === 'oauth_app' && !ctx.credentials.refresh_token) {
      errors.push('HubSpot OAuth is missing a refresh token. Reinstall the HubSpot app so CRMy can keep the connection active after access tokens expire.');
    }
    if (ctx.credentials.refresh_token && ctx.system.auth_type === 'oauth_app' && (!ctx.credentials.client_id || !ctx.credentials.client_secret)) {
      errors.push('HubSpot OAuth is missing the Client ID or Client Secret needed for token refresh. Edit the connection, re-enter both values, and save.');
    }
    return { valid: errors.length === 0, errors };
  },

  async testConnection(ctx) {
    await hubspotFetch(ctx, '/crm/v3/objects/contacts?limit=1&properties=email');
    return {
      ok: true,
      message: 'HubSpot connection verified. CRMy can read CRM contacts.',
      details: {
        auth_type: ctx.system.auth_type,
        hub_id: ctx.credentials.hub_id,
        token_expires_at: ctx.credentials.token_expires_at,
        scopes: Array.isArray(ctx.credentials.scopes) ? ctx.credentials.scopes : undefined,
      },
    };
  },

  async discoverObjects() {
    return OBJECTS;
  },

  async discoverFields(ctx, objectName) {
    const body = await hubspotFetch(ctx, `/crm/v3/properties/${encodeURIComponent(objectName)}`);
    const results = Array.isArray((body as { results?: unknown[] }).results)
      ? (body as { results: Array<Record<string, unknown>> }).results
      : [];
    return results.map(field => ({
      name: String(field.name),
      label: String(field.label ?? field.name),
      type: field.type ? String(field.type) : undefined,
      writable: field.modificationMetadata && typeof field.modificationMetadata === 'object'
        ? Boolean((field.modificationMetadata as { readOnlyValue?: boolean }).readOnlyValue === false)
        : true,
    }));
  },

  async pullChanges(ctx, mapping, cursor) {
    const props = Array.from(new Set([
      ...defaultProperties(mapping.external_object),
      ...Object.values(mapping.field_mapping ?? {}),
      ...(mapping.readable_fields ?? []),
    ])).filter(Boolean);
    const assoc = defaultAssociations(mapping.external_object);
    const checkpoint = parseHubSpotCursor(cursor);
    let body: unknown;

    if (checkpoint.search && checkpoint.watermark && mapping.watermark_field) {
      body = await hubspotFetch(ctx, `/crm/v3/objects/${encodeURIComponent(mapping.external_object)}/search`, {
        method: 'POST',
        body: JSON.stringify({
          limit: 100,
          after: checkpoint.after,
          properties: props,
          associations: assoc,
          sorts: [{ propertyName: mapping.watermark_field, direction: 'ASCENDING' }],
          filterGroups: [{
            filters: [{
              propertyName: mapping.watermark_field,
              operator: 'GT',
              value: checkpoint.watermark,
            }],
          }],
        }),
      });
    } else {
      const after = checkpoint.after ? `&after=${encodeURIComponent(checkpoint.after)}` : '';
      const properties = props.length ? `&properties=${encodeURIComponent(props.join(','))}` : '';
      const associations = assoc.length ? `&associations=${encodeURIComponent(assoc.join(','))}` : '';
      body = await hubspotFetch(ctx, `/crm/v3/objects/${encodeURIComponent(mapping.external_object)}?limit=100${after}${properties}${associations}&archived=false`);
    }

    const rawResults = (body as { results?: Array<Record<string, unknown>> }).results ?? [];
    const paging = (body as { paging?: { next?: { after?: string } } }).paging;
    const records = rawResults.map(item => normalizeRecord(mapping.external_object, item));
    const nextCursor = paging?.next?.after
      ? JSON.stringify({ after: paging.next.after, watermark: checkpoint.watermark, search: checkpoint.search })
      : undefined;
    return {
      records,
      next_cursor: nextCursor,
      watermark: records.at(-1)?.external_updated_at,
    };
  },

  async previewWrite(_ctx, mapping: ExternalObjectMapping, input): Promise<WritePreview> {
    assertWriteMode(mapping, input.writeback_mode);
    const writable = new Set(mapping.writable_fields ?? []);
    const blockedFields = Object.keys(input.payload ?? {}).filter(field => writable.size > 0 && !writable.has(field));
    return {
      allowed: blockedFields.length === 0,
      requires_approval: mapping.source_authority === 'approval_required' || mapping.source_authority === 'external',
      diff: { external_record_id: input.external_record_id, payload: input.payload },
      warnings: blockedFields.map(field => `Field ${field} is not writable for this mapping.`),
      mode: input.writeback_mode,
    };
  },

  async executeWrite(ctx, mapping, input) {
    assertWriteMode(mapping, input.writeback_mode);
    const properties = input.payload;
    let body: unknown;

    if (input.writeback_mode === 'append_event') {
      body = await hubspotFetch(ctx, `/crm/v3/objects/${encodeURIComponent(mapping.external_object)}`, {
        method: 'POST',
        body: JSON.stringify({ properties }),
      });
    } else if (input.external_record_id && (input.operation === 'update' || input.operation === 'upsert')) {
      body = await hubspotFetch(ctx, `/crm/v3/objects/${encodeURIComponent(mapping.external_object)}/${encodeURIComponent(input.external_record_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      });
    } else {
      body = await hubspotFetch(ctx, `/crm/v3/objects/${encodeURIComponent(mapping.external_object)}`, {
        method: 'POST',
        body: JSON.stringify({ properties }),
      });
    }

    const externalId = typeof body === 'object' && body && 'id' in body ? String((body as { id: unknown }).id) : input.external_record_id;
    return { ok: true, external_record_id: externalId, result: { response: body } };
  },

  normalizeError(error) {
    if (error instanceof HubSpotConnectorError) {
      return { message: error.message, retryable: error.retryable, details: error.details };
    }
    return adapterError(error);
  },
};
