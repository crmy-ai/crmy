// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * MCP session registry.
 *
 * Maintains live McpServer+transport pairs keyed by MCP session ID for the
 * current process. The durable mcp_sessions catalog records ownership,
 * identity, expiry, and recovery state across processes; live transports and
 * sockets intentionally remain process-local.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import { eventBus } from '../events/bus.js';
import { expireMcpSessionRecord } from '../db/repos/mcp-sessions.js';

// Subset of object types that map 1-1 to MCP resource URIs
const RESOURCE_OBJECT_TYPES = new Set(['contact', 'account', 'opportunity', 'use_case', 'context_entry']);

function toResourceUri(objectType: string, objectId: string): string {
  return `crmy://${objectType}/${objectId}`;
}

// Sessions older than SESSION_TTL_MS with no recent activity are evicted.
// This prevents unbounded memory growth from orphaned sessions (e.g. clients
// that disconnect without sending a DELETE /mcp or triggering transport.onclose).
export const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  actor: ActorContext;
  /** Epoch ms when this session was last used (registered or touched). */
  lastUsedAt: number;
}

export const mcpSessions = new Map<string, McpSession>();

function scopeKey(actor: ActorContext): string {
  if (!actor.scopes) return '<jwt-user-full-access>';
  return [...new Set(actor.scopes)].sort().join('\n');
}

export function isSameMcpActor(a: ActorContext, b: ActorContext): boolean {
  return a.tenant_id === b.tenant_id
    && a.actor_id === b.actor_id
    && a.actor_type === b.actor_type
    && a.role === b.role
    && scopeKey(a) === scopeKey(b);
}

export function registerMcpSession(
  sessionId: string,
  server: McpServer,
  transport: StreamableHTTPServerTransport,
  actor: ActorContext,
): void {
  mcpSessions.set(sessionId, { server, transport, actor, lastUsedAt: Date.now() });
}

/** Update the lastUsedAt timestamp for a session (call on each request). */
export function touchMcpSession(sessionId: string): void {
  const session = mcpSessions.get(sessionId);
  if (session) session.lastUsedAt = Date.now();
}

/** Remove sessions that have been idle longer than SESSION_TTL_MS. */
export async function evictStaleMcpSessions(db?: DbPool): Promise<void> {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sid, session] of mcpSessions) {
    if (session.lastUsedAt < cutoff) {
      mcpSessions.delete(sid);
      if (db) {
        await expireMcpSessionRecord(db, sid, 'idle_timeout').catch(() => {});
      }
      // Best-effort close; ignore errors if already closed
      session.transport.close?.().catch(() => {});
    }
  }
}

export function removeMcpSession(sessionId: string): void {
  mcpSessions.delete(sessionId);
}

// Push resource-list-changed notification to all live sessions in the same tenant.
// The MCP SDK exposes sendResourceListChanged() (RFC-compliant "resources/listChanged"
// notification); per-URI sendResourceUpdated() is not part of the current SDK surface.
// Clients that subscribe to resource updates will re-fetch the resource list.
function notifyResourceUpdated(tenantId: string, objectType: string, objectId?: string): void {
  if (!objectId || !RESOURCE_OBJECT_TYPES.has(objectType)) return;
  for (const [, session] of mcpSessions) {
    if (session.actor.tenant_id === tenantId) {
      // Fire-and-forget; ignore errors from already-closed sessions
      try {
        session.server.sendResourceListChanged();
      } catch {
        // session closed
      }
    }
  }
}

export async function startMcpResourceNotificationListener(db: DbPool): Promise<() => Promise<void>> {
  const client = await db.connect();
  let stopped = false;
  const onNotification = (message: { channel: string; payload?: string }) => {
    if (stopped || message.channel !== 'crmy_mcp_resource_events' || !message.payload) return;
    try {
      const payload = JSON.parse(message.payload) as {
        tenantId?: string;
        objectType?: string;
        objectId?: string;
      };
      if (payload.tenantId && payload.objectType) {
        notifyResourceUpdated(payload.tenantId, payload.objectType, payload.objectId);
      }
    } catch {
      // Ignore malformed cross-instance notifications. The events table remains
      // the durable source of truth and clients can recover by refetching.
    }
  };
  const onError = (err: Error) => {
    if (!stopped) console.warn('[mcp] resource notification listener error:', err.message);
  };

  client.on('notification', onNotification);
  client.on('error', onError);
  await client.query('LISTEN crmy_mcp_resource_events');

  return async () => {
    stopped = true;
    client.off('notification', onNotification);
    client.off('error', onError);
    await client.query('UNLISTEN crmy_mcp_resource_events').catch(() => {});
    client.release();
  };
}

// Subscribe to the in-process event bus once on module load
eventBus.on('crmy:event', (data) => {
  if (data.objectId) {
    notifyResourceUpdated(data.tenantId, data.objectType, data.objectId);
  }
});
