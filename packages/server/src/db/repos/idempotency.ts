// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import type { DbPool } from '../pool.js';
import type { UUID } from '@crmy/shared';
import { CrmyError } from '@crmy/shared';

const STALE_IN_PROGRESS_MS = 10 * 60 * 1000;

export interface IdempotencyInput {
  tenantId: UUID;
  actorId: string;
  operation: string;
  key?: string;
  request: unknown;
}

interface IdempotencyRow {
  request_hash: string;
  status: 'in_progress' | 'completed' | 'failed';
  response: unknown;
  error: string | null;
  updated_at: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function hashRequest(request: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(request)).digest('hex');
}

async function claim(
  db: DbPool,
  input: Required<IdempotencyInput>,
): Promise<{ replay?: unknown }> {
  const requestHash = hashRequest(input.request);
  const inserted = await db.query(
    `INSERT INTO idempotency_keys
       (tenant_id, actor_id, operation, idempotency_key, request_hash, status)
     VALUES ($1, $2, $3, $4, $5, 'in_progress')
     ON CONFLICT DO NOTHING
     RETURNING request_hash, status, response, error, updated_at`,
    [input.tenantId, input.actorId, input.operation, input.key, requestHash],
  );

  if (inserted.rows.length > 0) return {};

  const existing = await db.query<IdempotencyRow>(
    `SELECT request_hash, status, response, error, updated_at
     FROM idempotency_keys
     WHERE tenant_id = $1 AND actor_id = $2 AND operation = $3 AND idempotency_key = $4`,
    [input.tenantId, input.actorId, input.operation, input.key],
  );
  const row = existing.rows[0];
  if (!row) return {};

  if (row.request_hash !== requestHash) {
    throw new CrmyError(
      'CONFLICT',
      `Idempotency key '${input.key}' was already used with a different request payload`,
      409,
    );
  }

  if (row.status === 'completed') {
    return { replay: row.response };
  }

  const updatedAt = new Date(row.updated_at).getTime();
  const isStale = Number.isFinite(updatedAt) && Date.now() - updatedAt > STALE_IN_PROGRESS_MS;
  if (row.status === 'in_progress' && !isStale) {
    throw new CrmyError(
      'CONFLICT',
      `Idempotency key '${input.key}' is already in progress for '${input.operation}'`,
      409,
    );
  }

  await db.query(
    `UPDATE idempotency_keys
     SET status = 'in_progress', error = NULL, updated_at = now()
     WHERE tenant_id = $1 AND actor_id = $2 AND operation = $3 AND idempotency_key = $4`,
    [input.tenantId, input.actorId, input.operation, input.key],
  );

  return {};
}

async function complete(
  db: DbPool,
  input: Required<IdempotencyInput>,
  response: unknown,
): Promise<void> {
  await db.query(
    `UPDATE idempotency_keys
     SET status = 'completed', response = $5, error = NULL, updated_at = now()
     WHERE tenant_id = $1 AND actor_id = $2 AND operation = $3 AND idempotency_key = $4`,
    [input.tenantId, input.actorId, input.operation, input.key, JSON.stringify(response)],
  );
}

async function fail(
  db: DbPool,
  input: Required<IdempotencyInput>,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.query(
    `UPDATE idempotency_keys
     SET status = 'failed', error = $5, updated_at = now()
     WHERE tenant_id = $1 AND actor_id = $2 AND operation = $3 AND idempotency_key = $4`,
    [input.tenantId, input.actorId, input.operation, input.key, message],
  );
}

export async function runIdempotent<T>(
  db: DbPool,
  input: IdempotencyInput,
  fn: () => Promise<T>,
): Promise<T> {
  if (!input.key) return fn();

  const required: Required<IdempotencyInput> = {
    ...input,
    key: input.key,
  };

  const claimed = await claim(db, required);
  if ('replay' in claimed) return claimed.replay as T;

  try {
    const response = await fn();
    await complete(db, required, response);
    return response;
  } catch (err) {
    await fail(db, required, err).catch(() => {});
    throw err;
  }
}
