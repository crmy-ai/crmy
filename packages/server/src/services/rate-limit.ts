// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { NextFunction, Request, Response } from 'express';
import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import crypto from 'node:crypto';

const DEFAULT_LIMIT = Number(process.env.CRMY_ACTOR_RATE_LIMIT_MAX ?? 600);
const DEFAULT_WINDOW_SECONDS = Math.max(1, Math.floor(Number(process.env.CRMY_ACTOR_RATE_LIMIT_WINDOW_MS ?? 60_000) / 1000));
const DEFAULT_RETENTION_HOURS = Math.max(1, Number(process.env.CRMY_RATE_LIMIT_BUCKET_RETENTION_HOURS ?? 24));

function actorKey(actor: ActorContext): string {
  return `${actor.actor_type}:${actor.actor_id}`;
}

function routeKey(req: Request): string {
  const base = req.baseUrl || '';
  const path = req.route?.path ? String(req.route.path) : req.path;
  return `${req.method} ${base}${path}`.replace(/\/+/g, '/').replace(/^([A-Z]+) /, '$1 ');
}

function identityHash(bucketKey: string, identity: string): string {
  const secret = process.env.CRMY_RATE_LIMIT_HASH_SECRET
    ?? process.env.CRMY_ENCRYPTION_KEY
    ?? process.env.JWT_SECRET
    ?? 'crmy-local-rate-limit';
  return crypto
    .createHmac('sha256', secret)
    .update(`${bucketKey}:${identity.trim().toLowerCase()}`)
    .digest('hex');
}

function rateLimitExceeded(resetAt?: string): Error & { status?: number; resetAt?: string } {
  const err = new Error('Rate limit exceeded') as Error & { status?: number; resetAt?: string };
  err.status = 429;
  err.resetAt = resetAt;
  return err;
}

export async function enforceUnauthenticatedRateLimit(
  db: Pick<DbPool, 'query'>,
  bucketKey: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  if (!Number.isFinite(limit) || limit <= 0) return;
  const normalizedWindowSeconds = Math.max(1, Math.floor(windowSeconds));
  const result = await db.query(
    `WITH bucket AS (
       SELECT to_timestamp(floor(extract(epoch FROM now()) / $3::int) * $3::int) AS window_start
     ), upsert AS (
       INSERT INTO auth_rate_limit_buckets (bucket_key, identity_hash, window_start, count)
       SELECT $1, $2, window_start, 1 FROM bucket
       ON CONFLICT (bucket_key, identity_hash, window_start)
       DO UPDATE SET count = auth_rate_limit_buckets.count + 1, updated_at = now()
       RETURNING count, window_start
     )
     SELECT count,
            window_start + ($3::text || ' seconds')::interval AS reset_at
       FROM upsert`,
    [bucketKey, identityHash(bucketKey, identity || 'unknown'), normalizedWindowSeconds],
  );

  const row = result.rows[0] as { count?: number; reset_at?: string } | undefined;
  if (Number(row?.count ?? 0) > limit) {
    throw rateLimitExceeded(row?.reset_at);
  }
}

export async function enforceActorRateLimit(
  db: Pick<DbPool, 'query'>,
  actor: ActorContext,
  key: string,
  limit = DEFAULT_LIMIT,
  windowSeconds = DEFAULT_WINDOW_SECONDS,
): Promise<void> {
  if (!Number.isFinite(limit) || limit <= 0) return;

  const result = await db.query(
    `WITH bucket AS (
       SELECT to_timestamp(floor(extract(epoch FROM now()) / $4::int) * $4::int) AS window_start
     ), upsert AS (
       INSERT INTO actor_rate_limit_buckets (tenant_id, actor_id, route_key, window_start, count)
       SELECT $1, $2, $3, window_start, 1 FROM bucket
       ON CONFLICT (tenant_id, actor_id, route_key, window_start)
       DO UPDATE SET count = actor_rate_limit_buckets.count + 1, updated_at = now()
       RETURNING count, window_start
     )
     SELECT count,
            window_start + ($4::text || ' seconds')::interval AS reset_at
       FROM upsert`,
    [actor.tenant_id, actorKey(actor), key, windowSeconds],
  );

  const row = result.rows[0] as { count?: number; reset_at?: string } | undefined;
  if (Number(row?.count ?? 0) > limit) {
    throw rateLimitExceeded(row?.reset_at);
  }
}

export async function purgeRateLimitBuckets(
  db: Pick<DbPool, 'query'>,
  retentionHours = DEFAULT_RETENTION_HOURS,
): Promise<{ auth_deleted: number; actor_deleted: number }> {
  const hours = Math.max(1, Math.floor(retentionHours));
  const authResult = await db.query(
    `DELETE FROM auth_rate_limit_buckets
     WHERE updated_at < now() - ($1::text || ' hours')::interval`,
    [hours],
  );
  const actorResult = await db.query(
    `DELETE FROM actor_rate_limit_buckets
     WHERE updated_at < now() - ($1::text || ' hours')::interval`,
    [hours],
  );
  return {
    auth_deleted: authResult.rowCount ?? 0,
    actor_deleted: actorResult.rowCount ?? 0,
  };
}

export function actorRateLimitMiddleware(db: DbPool) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.actor) {
        next();
        return;
      }
      await enforceActorRateLimit(db, req.actor, routeKey(req));
      next();
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status?: number }).status === 429) {
        const resetAt = (err as { resetAt?: string }).resetAt;
        if (resetAt) res.setHeader('Retry-After', Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000)));
        res.status(429).json({
          type: 'https://crmy.ai/errors/rate_limited',
          title: 'Too Many Requests',
          status: 429,
          detail: 'Too many requests. Wait briefly and try again.',
        });
        return;
      }
      next(err);
    }
  };
}
