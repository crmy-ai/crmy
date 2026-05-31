// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext, UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as rawContextRepo from '../db/repos/raw-context-sources.js';
import { enforceToolScopes } from '../auth/scopes.js';
import { getAllTools } from '../mcp/server.js';

interface WorkerResult {
  claimed: number;
  succeeded: number;
  failed: number;
}

type ActorRow = {
  id: UUID;
  actor_type: string;
  user_id?: UUID | null;
  role?: string | null;
  user_role?: string | null;
  scopes?: unknown;
  is_active?: boolean | null;
};

function normalizeRole(value?: string | null): ActorContext['role'] {
  if (value === 'owner' || value === 'admin' || value === 'manager' || value === 'member') return value;
  return 'member';
}

function normalizeScopes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(item => String(item)).filter(Boolean);
}

async function actorForRawContextSource(
  db: DbPool,
  source: rawContextRepo.RawContextSource,
): Promise<ActorContext> {
  if (!source.actor_id) {
    throw new Error('Raw Context source has no actor. Link an owner or reprocess from the app.');
  }

  const result = await db.query(
    `SELECT a.id, a.actor_type, a.user_id, a.role, a.scopes, a.is_active, u.role AS user_role
     FROM actors a
     LEFT JOIN users u ON u.tenant_id = a.tenant_id AND u.id = a.user_id
     WHERE a.tenant_id = $1 AND a.id = $2
     LIMIT 1`,
    [source.tenant_id, source.actor_id],
  );
  const actor = result.rows[0] as ActorRow | undefined;
  if (!actor) {
    throw new Error('Raw Context source actor no longer exists. Reprocess from a visible record.');
  }
  if (actor.is_active === false) {
    throw new Error('Raw Context source actor is inactive. Reprocess from an active user or agent.');
  }

  if (actor.actor_type === 'human') {
    return {
      tenant_id: source.tenant_id,
      actor_id: actor.user_id ?? actor.id,
      actor_type: 'user',
      role: normalizeRole(actor.role ?? actor.user_role),
      scopes: actor.user_id ? undefined : normalizeScopes(actor.scopes),
    };
  }

  return {
    tenant_id: source.tenant_id,
    actor_id: actor.id,
    actor_type: actor.actor_type === 'agent' ? 'agent' : 'system',
    role: normalizeRole(actor.role),
    scopes: normalizeScopes(actor.scopes) ?? ['context:read', 'context:write'],
  };
}

async function markWorkerFailure(
  db: DbPool,
  source: rawContextRepo.RawContextSource,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await rawContextRepo.updateRawContextSource(db, source.tenant_id, source.source_type, source.source_ref, {
    status: 'failed',
    stage: 'worker_reprocess',
    locked_at: null,
    next_retry_at: null,
    failure_code: 'worker_reprocess_failed',
    failure_reason: message,
    last_error: message,
  });
}

export async function processPendingRawContextSources(
  db: DbPool,
  limit = Number(process.env.RAW_CONTEXT_WORKER_BATCH_SIZE ?? 5),
): Promise<WorkerResult> {
  const sources = await rawContextRepo.claimPendingRawContextSources(db, Math.max(1, Math.min(limit, 25)));
  if (sources.length === 0) return { claimed: 0, succeeded: 0, failed: 0 };

  const tool = getAllTools(db).find(candidate => candidate.name === 'context_raw_source_reprocess');
  if (!tool) throw new Error('context_raw_source_reprocess tool is not registered');

  let succeeded = 0;
  let failed = 0;

  for (const source of sources) {
    try {
      const actor = await actorForRawContextSource(db, source);
      enforceToolScopes(tool.name, actor);
      await tool.handler({ id: source.id }, actor);
      succeeded++;
    } catch (err) {
      failed++;
      await markWorkerFailure(db, source, err);
      console.error(`[raw-context] Worker failed to reprocess ${source.id}:`, err);
    }
  }

  if (succeeded > 0 || failed > 0) {
    console.log(`[raw-context] Worker batch complete - ${succeeded} succeeded, ${failed} failed out of ${sources.length}.`);
  }

  return { claimed: sources.length, succeeded, failed };
}
