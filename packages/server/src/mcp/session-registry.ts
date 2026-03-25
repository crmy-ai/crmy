// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory MCP session registry.
 *
 * Maintains live McpServer+transport pairs keyed by MCP session ID so that
 * subsequent HTTP requests from the same client reuse the same session and
 * so that the server can push resource-updated notifications.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ActorContext } from '@crmy/shared';
import { eventBus } from '../events/bus.js';

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
export function evictStaleMcpSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sid, session] of mcpSessions) {
    if (session.lastUsedAt < cutoff) {
      mcpSessions.delete(sid);
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

// Subscribe to the in-process event bus once on module load
eventBus.on('crmy:event', (data) => {
  if (data.objectId) {
    notifyResourceUpdated(data.tenantId, data.objectType, data.objectId);
  }
});
