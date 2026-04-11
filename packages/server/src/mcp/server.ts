// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ZodRawShape, ZodObject } from 'zod';

const _require = createRequire(import.meta.url);
function getServerVersion(): string {
  try {
    const pkg = _require(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return '0.5.9';
  }
}
import type { ActorContext } from '@crmy/shared';
import { CrmyError } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import { enforceToolScopes } from '../auth/scopes.js';
import { registerResources } from './resources.js';
import { contactTools } from './tools/contacts.js';
import { accountTools } from './tools/accounts.js';
import { opportunityTools } from './tools/opportunities.js';
import { activityTools } from './tools/activities.js';
import { analyticsTools } from './tools/analytics.js';
import { hitlTools } from './tools/hitl.js';
import { metaTools } from './tools/meta.js';
import { useCaseTools } from './tools/use-cases.js';
import { webhookTools } from './tools/webhooks.js';
import { emailTools } from './tools/email.js';
import { customFieldTools } from './tools/custom-fields.js';
import { workflowTools } from './tools/workflows.js';
import { actorTools } from './tools/actors.js';
import { assignmentTools } from './tools/assignments.js';
import { contextEntryTools } from './tools/context-entries.js';
import { registryTools } from './tools/registries.js';
import { entityResolveTools } from './tools/entity-resolve.js';
import { guideTools } from './tools/guide.js';
import { messagingTools } from './tools/messaging.js';
import { emailSequenceTools } from './tools/email-sequences.js';
import { compoundTools } from './tools/compound.js';
import { agentHandoffTools } from './tools/agent-handoff.js';

export interface ToolDef {
  name: string;
  /** Determines which actors see this tool at connection time.
   *  core     — all actors (agents, users, system)
   *  extended — users + agents with 'extended' or 'write' scope
   *  analytics — users + agents with 'analytics' or 'read' scope
   *  admin    — actors with role 'admin' or 'owner' only
   */
  tier: 'core' | 'extended' | 'analytics' | 'admin';
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any, actor: ActorContext) => Promise<unknown>;
}

export function getAllTools(db: DbPool): ToolDef[] {
  // Order signals importance to the LLM scanning the tool list.
  // High-frequency agent tools first, infrastructure tools last.
  return [
    // 0. Compound actions — highest priority, replace multi-step sequences
    ...compoundTools(db),        // deal_advance, contact_outreach
    // 1. Briefing + context (most important agent tools)
    ...contextEntryTools(db),    // briefing_get, context_add/get/list/search/supersede, context_stale
    // 2. Actor identity
    ...actorTools(db),           // actor_whoami, actor_register, actor_expertise
    // 3. Activities
    ...activityTools(db),        // activity_create, activity_get_timeline
    // 4. Assignments
    ...assignmentTools(db),      // assignment_create, assignment_list, assignment_update
    // 5. HITL + handoff
    ...hitlTools(db),            // hitl_submit_request, hitl_check_status
    ...agentHandoffTools(db),    // agent_capture_handoff, agent_resume_handoff
    // 6. Core CRM entities
    ...contactTools(db),
    ...accountTools(db),
    ...opportunityTools(db),
    // 7. Analytics
    ...analyticsTools(db),
    // 8. Remaining tools
    ...useCaseTools(db),
    ...emailTools(db),
    ...emailSequenceTools(db),
    ...entityResolveTools(db),
    ...registryTools(db),
    ...webhookTools(db),
    ...workflowTools(db),
    ...customFieldTools(db),
    ...metaTools(db),
    // 9. Messaging channels
    ...messagingTools(db),
    // 10. User guide — always available, no DB needed
    ...guideTools(),
  ];
}

/**
 * Filter the full tool list to only those visible for a given actor.
 * Called at server construction time so each MCP session only registers
 * the tools the actor is allowed to use.
 */
export function getToolsForActor(db: DbPool, actor: ActorContext): ToolDef[] {
  const all = getAllTools(db);
  const isAdmin = actor.role === 'admin' || actor.role === 'owner';
  // No scopes = JWT user (full access); scopes array present = agent API key
  const hasExtended = !actor.scopes
    || actor.scopes.includes('extended')
    || actor.scopes.includes('write');
  const hasAnalytics = !actor.scopes
    || actor.scopes.includes('analytics')
    || actor.scopes.includes('read');

  return all.filter(t => {
    if (t.tier === 'core') return true;
    if (t.tier === 'extended') return hasExtended || isAdmin;
    if (t.tier === 'analytics') return hasAnalytics || isAdmin;
    if (t.tier === 'admin') return isAdmin;
    return false;
  });
}

export function createMcpServer(db: DbPool, actor: ActorContext, getActor: () => ActorContext): McpServer {
  const server = new McpServer({
    name: 'CRMy',
    version: getServerVersion(),
  });

  // Filter tools at connection time based on actor tier — agents see ~20 core tools;
  // extended/analytics/admin tools are added only for actors that need them.
  const tools = getToolsForActor(db, actor);

  registerResources(server, db, getActor);

  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape,
      async (input) => {
        try {
          const actor = getActor();
          enforceToolScopes(tool.name, actor);
          const result = await tool.handler(input, actor);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          if (err instanceof CrmyError) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(err.toJSON()) }],
              isError: true,
            };
          }
          const message = err instanceof Error ? err.message : 'Internal error';
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}
