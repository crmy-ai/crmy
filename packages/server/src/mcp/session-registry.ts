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

export interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  actor: ActorContext;
}

export const mcpSessions = new Map<string, McpSession>();

export function registerMcpSession(
  sessionId: string,
  server: McpServer,
  transport: StreamableHTTPServerTransport,
  actor: ActorContext,
): void {
  mcpSessions.set(sessionId, { server, transport, actor });
}

export function removeMcpSession(sessionId: string): void {
  mcpSessions.delete(sessionId);
}

// Push resource-updated notification to all live sessions in the same tenant
function notifyResourceUpdated(tenantId: string, objectType: string, objectId?: string): void {
  if (!objectId || !RESOURCE_OBJECT_TYPES.has(objectType)) return;
  const uri = toResourceUri(objectType, objectId);
  for (const [, session] of mcpSessions) {
    if (session.actor.tenant_id === tenantId) {
      // sendResourceUpdated is fire-and-forget; ignore if session already closed
      session.server.sendResourceUpdated(uri).catch(() => {});
    }
  }
}

// Subscribe to the in-process event bus once on module load
eventBus.on('crmy:event', (data) => {
  if (data.objectId) {
    notifyResourceUpdated(data.tenantId, data.objectType, data.objectId);
  }
});
