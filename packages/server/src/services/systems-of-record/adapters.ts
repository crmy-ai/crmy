// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ExternalObjectMapping, ExternalSystem, SystemOfRecordType, WritebackMode } from '@crmy/shared';

const CONNECTOR_FETCH_TIMEOUT_MS = Number(process.env.CONNECTOR_FETCH_TIMEOUT_MS ?? 30_000);

export interface ExternalRecord {
  external_object: string;
  external_record_id: string;
  external_updated_at?: string;
  fields: Record<string, unknown>;
  associations?: Record<string, string[]>;
  raw?: unknown;
}

export interface ConnectorContext {
  system: ExternalSystem;
  credentials: Record<string, unknown>;
}

export interface WritePreview {
  allowed: boolean;
  requires_approval: boolean;
  diff: Record<string, unknown>;
  warnings: string[];
  mode: WritebackMode;
}

export interface ConnectorAdapter {
  type: SystemOfRecordType;
  validateConfig(ctx: ConnectorContext): Promise<{ valid: boolean; errors: string[] }>;
  testConnection(ctx: ConnectorContext): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }>;
  discoverObjects(ctx: ConnectorContext): Promise<Array<{ name: string; label: string; supports_write: boolean }>>;
  discoverFields(ctx: ConnectorContext, objectName: string): Promise<Array<{ name: string; label: string; type?: string; writable?: boolean }>>;
  pullChanges(ctx: ConnectorContext, mapping: ExternalObjectMapping, cursor?: string): Promise<{ records: ExternalRecord[]; next_cursor?: string; watermark?: string }>;
  previewWrite(ctx: ConnectorContext, mapping: ExternalObjectMapping, input: {
    operation: string;
    writeback_mode: WritebackMode;
    external_record_id?: string;
    payload: Record<string, unknown>;
  }): Promise<WritePreview>;
  executeWrite(ctx: ConnectorContext, mapping: ExternalObjectMapping, input: {
    operation: string;
    writeback_mode: WritebackMode;
    external_record_id?: string;
    payload: Record<string, unknown>;
  }): Promise<{ ok: boolean; external_record_id?: string; result: Record<string, unknown> }>;
  normalizeError(error: unknown): { message: string; retryable: boolean; details?: Record<string, unknown> };
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

export function adapterError(error: unknown): { message: string; retryable: boolean; details?: Record<string, unknown> } {
  if (error instanceof Error) return { message: error.message, retryable: false };
  return { message: String(error), retryable: false };
}

export async function readJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export async function connectorFetch(url: string, init: RequestInit = {}, timeoutMs = CONNECTOR_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Connector HTTP request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function redactConnectorMessage(value: string): string {
  return value
    .replace(/(access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?app[_-]?token|authorization)\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .slice(0, 500);
}

export function connectorResponseMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['message', 'error_description', 'errorMessage', 'error', 'detail', 'text']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return redactConnectorMessage(value.trim());
    }
  }
  if (typeof body === 'string' && body.trim()) return redactConnectorMessage(body.trim());
  return fallback;
}

export function connectorHttpError(service: string, status: number, body: unknown): Error {
  const message = connectorResponseMessage(body, `${service} returned HTTP ${status}`);
  const retry = status === 429 || status >= 500
    ? 'This may be temporary; wait a moment and retry the operation.'
    : status === 401
      ? 'Reconnect the system or refresh its credentials, then test the connection again.'
      : status === 403
        ? 'Check scopes, permissions, warehouse access, or object-level grants, then test again.'
        : 'Review the connection settings and mapped fields, then try again.';
  return new Error(`${service} returned HTTP ${status}: ${message}. ${retry}`);
}

export function assertWriteMode(mapping: ExternalObjectMapping, mode: WritebackMode): void {
  if (!mapping.writeback_mode || mapping.writeback_mode !== mode) {
    throw new Error(`Writeback mode ${mode} is not enabled for this mapping`);
  }
}

export function checkpointWatermark(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(cursor) as { watermark?: unknown };
    return typeof parsed.watermark === 'string' && parsed.watermark.trim() ? parsed.watermark.trim() : cursor;
  } catch {
    return cursor;
  }
}

function assertIdentifierSegment(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) {
    throw new Error(`${label} must be a safe identifier using only letters, numbers, underscores, or dollar signs, and cannot start with a number.`);
  }
  return value;
}

export function safeIdentifier(value: unknown, label: string): string {
  return assertIdentifierSegment(requireString(value, label), label);
}

export function safeQualifiedIdentifier(value: unknown, label: string): string {
  const raw = requireString(value, label);
  const parts = raw.split('.');
  if (parts.some(part => !part)) {
    throw new Error(`${label} must be a dot-qualified identifier like schema.table, without empty segments.`);
  }
  return parts.map((part, index) => assertIdentifierSegment(part, `${label} segment ${index + 1}`)).join('.');
}

export function writebackParameters(config: Record<string, unknown>, payload: Record<string, unknown>): unknown[] {
  const order = Array.isArray(config.parameter_order)
    ? config.parameter_order.map(String).filter(Boolean)
    : [];
  if (order.length === 0) return Object.values(payload);
  const missing = order.filter(field => !(field in payload));
  if (missing.length > 0) {
    throw new Error(`Writeback payload is missing required parameter_order field(s): ${missing.join(', ')}.`);
  }
  return order.map(field => payload[field]);
}
