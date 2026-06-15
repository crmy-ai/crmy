// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../pool.js';

export type McpTransportState = 'active' | 'closed' | 'expired';

export interface DurableMcpSession {
  id: string;
  tenant_id: string;
  actor_id: string;
  actor_type: ActorContext['actor_type'];
  actor_role: ActorContext['role'];
  scope_hash: string;
  actor_identity_hash: string;
  owning_instance_id: string;
  transport_state: McpTransportState;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  closed_at?: string | null;
  close_reason?: string | null;
  metadata: Record<string, unknown>;
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function actorScopeFingerprint(actor: ActorContext): string {
  if (!actor.scopes) return hash('<jwt-user-full-access>');
  return hash([...new Set(actor.scopes)].sort().join('\n'));
}

export function actorIdentityFingerprint(actor: ActorContext): string {
  return hash([
    actor.tenant_id,
    actor.actor_id,
    actor.actor_type,
    actor.role,
    actorScopeFingerprint(actor),
  ].join('\n'));
}

export function durableSessionMatchesActor(session: DurableMcpSession, actor: ActorContext): boolean {
  return session.tenant_id === actor.tenant_id
    && session.actor_id === actor.actor_id
    && session.actor_type === actor.actor_type
    && session.actor_role === actor.role
    && session.scope_hash === actorScopeFingerprint(actor)
    && session.actor_identity_hash === actorIdentityFingerprint(actor);
}

export function isDurableSessionUsable(session: DurableMcpSession, now = new Date()): boolean {
  return session.transport_state === 'active'
    && !session.closed_at
    && new Date(session.expires_at).getTime() > now.getTime();
}

export async function upsertMcpSession(
  db: DbPool,
  input: {
    sessionId: string;
    actor: ActorContext;
    owningInstanceId: string;
    ttlMs: number;
    metadata?: Record<string, unknown>;
  },
): Promise<DurableMcpSession> {
  const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();
  const result = await db.query(
    `INSERT INTO mcp_sessions (
       id, tenant_id, actor_id, actor_type, actor_role, scope_hash,
       actor_identity_hash, owning_instance_id, transport_state, expires_at, metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10::jsonb)
     ON CONFLICT (id)
     DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       actor_id = EXCLUDED.actor_id,
       actor_type = EXCLUDED.actor_type,
       actor_role = EXCLUDED.actor_role,
       scope_hash = EXCLUDED.scope_hash,
       actor_identity_hash = EXCLUDED.actor_identity_hash,
       owning_instance_id = EXCLUDED.owning_instance_id,
       transport_state = 'active',
       last_seen_at = now(),
       expires_at = EXCLUDED.expires_at,
       closed_at = NULL,
       close_reason = NULL,
       metadata = mcp_sessions.metadata || EXCLUDED.metadata
     RETURNING *`,
    [
      input.sessionId,
      input.actor.tenant_id,
      input.actor.actor_id,
      input.actor.actor_type,
      input.actor.role,
      actorScopeFingerprint(input.actor),
      actorIdentityFingerprint(input.actor),
      input.owningInstanceId,
      expiresAt,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0] as DurableMcpSession;
}

export async function getMcpSession(db: DbPool, sessionId: string): Promise<DurableMcpSession | null> {
  const result = await db.query('SELECT * FROM mcp_sessions WHERE id = $1', [sessionId]);
  return (result.rows[0] as DurableMcpSession | undefined) ?? null;
}

export async function touchMcpSessionRecord(
  db: DbPool,
  sessionId: string,
  ttlMs: number,
  owningInstanceId?: string,
): Promise<DurableMcpSession | null> {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const result = await db.query(
    `UPDATE mcp_sessions
     SET last_seen_at = now(),
         expires_at = $2,
         owning_instance_id = COALESCE($3, owning_instance_id),
         metadata = metadata || jsonb_build_object('last_touched_by_instance_id', COALESCE($3, owning_instance_id))
     WHERE id = $1
       AND transport_state = 'active'
       AND closed_at IS NULL
     RETURNING *`,
    [sessionId, expiresAt, owningInstanceId ?? null],
  );
  return (result.rows[0] as DurableMcpSession | undefined) ?? null;
}

export async function closeMcpSessionRecord(
  db: DbPool,
  sessionId: string,
  reason: string,
): Promise<void> {
  await db.query(
    `UPDATE mcp_sessions
     SET transport_state = 'closed',
         closed_at = COALESCE(closed_at, now()),
         close_reason = COALESCE(close_reason, $2),
         metadata = metadata || jsonb_build_object('closed_reason', $2)
     WHERE id = $1`,
    [sessionId, reason],
  );
}

export async function expireMcpSessionRecord(
  db: DbPool,
  sessionId: string,
  reason: string,
): Promise<void> {
  await db.query(
    `UPDATE mcp_sessions
     SET transport_state = 'expired',
         closed_at = COALESCE(closed_at, now()),
         close_reason = COALESCE(close_reason, $2),
         metadata = metadata || jsonb_build_object('expired_reason', $2)
     WHERE id = $1
       AND transport_state = 'active'`,
    [sessionId, reason],
  );
}

export async function expireMcpSessionsForInstance(
  db: DbPool,
  owningInstanceId: string,
  reason: string,
): Promise<number> {
  const result = await db.query(
    `UPDATE mcp_sessions
     SET transport_state = 'expired',
         closed_at = COALESCE(closed_at, now()),
         close_reason = COALESCE(close_reason, $2),
         metadata = metadata || jsonb_build_object('expired_reason', $2)
     WHERE owning_instance_id = $1
       AND transport_state = 'active'
       AND closed_at IS NULL`,
    [owningInstanceId, reason],
  );
  return result.rowCount ?? 0;
}

export async function expireTimedOutMcpSessions(db: DbPool): Promise<number> {
  const result = await db.query(
    `UPDATE mcp_sessions
     SET transport_state = 'expired',
         closed_at = COALESCE(closed_at, now()),
         close_reason = COALESCE(close_reason, 'ttl_expired'),
         metadata = metadata || jsonb_build_object('expired_reason', 'ttl_expired')
     WHERE transport_state = 'active'
       AND closed_at IS NULL
       AND expires_at <= now()`,
  );
  return result.rowCount ?? 0;
}

export async function heartbeatMcpInstance(
  db: DbPool,
  instanceId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO mcp_instance_heartbeats (instance_id, metadata)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (instance_id)
     DO UPDATE SET
       last_seen_at = now(),
       metadata = mcp_instance_heartbeats.metadata || EXCLUDED.metadata`,
    [instanceId, JSON.stringify(metadata ?? {})],
  );
}

export async function expireSessionsOwnedByStaleInstances(
  db: DbPool,
  staleAfterMs: number,
): Promise<number> {
  const staleBefore = new Date(Date.now() - staleAfterMs).toISOString();
  const result = await db.query(
    `UPDATE mcp_sessions s
     SET transport_state = 'expired',
         closed_at = COALESCE(s.closed_at, now()),
         close_reason = COALESCE(s.close_reason, 'owning_instance_stale'),
         metadata = s.metadata || jsonb_build_object('expired_reason', 'owning_instance_stale')
     WHERE s.transport_state = 'active'
       AND s.closed_at IS NULL
       AND EXISTS (
         SELECT 1
         FROM mcp_instance_heartbeats h
         WHERE h.instance_id = s.owning_instance_id
           AND h.last_seen_at < $1
       )`,
    [staleBefore],
  );
  return result.rowCount ?? 0;
}
