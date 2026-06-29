// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z, type ZodRawShape, type ZodObject, type ZodTypeAny } from 'zod';

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
import { actorHasScope, enforceToolScopes, getToolScopeRequirements } from '../auth/scopes.js';
import { resolveToolsetName, selectToolset } from './toolsets.js';
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
import { calendarTools } from './tools/calendar.js';
import { contextSourceDropTools } from './tools/context-source-drops.js';
import { knowledgeTools } from './tools/knowledge.js';
import { customFieldTools } from './tools/custom-fields.js';
import { workflowTools } from './tools/workflows.js';
import { actorTools } from './tools/actors.js';
import { assignmentTools } from './tools/assignments.js';
import { contextEntryTools } from './tools/context-entries.js';
import { actionContextTools } from './tools/action-context.js';
import { registryTools } from './tools/registries.js';
import { entityResolveTools } from './tools/entity-resolve.js';
import { subjectGraphTools } from './tools/subject-graph.js';
import { guideTools } from './tools/guide.js';
import { messagingTools } from './tools/messaging.js';
import { emailSequenceTools } from './tools/email-sequences.js';
import { compoundTools } from './tools/compound.js';
import { agentHandoffTools } from './tools/agent-handoff.js';
import { systemsOfRecordTools } from './tools/systems-of-record.js';
import { recordDraftTools } from './tools/record-drafts.js';
import type { ToolUxMetadata } from './tool-ux.js';

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
  ux?: ToolUxMetadata;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any, actor: ActorContext) => Promise<unknown>;
}

function normalizeProductType(value: unknown): unknown {
  if (value === 'use-case' || value === 'useCase') return 'use_case';
  return value;
}

export function normalizeToolInput<T = unknown>(input: T): T {
  if (Array.isArray(input)) return input.map(item => normalizeToolInput(item)) as T;
  if (!input || typeof input !== 'object') return input;

  return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([key, value]) => {
    if (key === 'subject_type' || key === 'object_type' || key === 'record_type') {
      return [key, normalizeProductType(value)];
    }
    return [key, normalizeToolInput(value)];
  })) as T;
}

function toolInputShapeWithProductAliases(shape: ZodRawShape): ZodRawShape {
  return Object.fromEntries(Object.entries(shape).map(([key, schema]) => {
    if (key === 'subject_type' || key === 'object_type' || key === 'record_type') {
      return [key, z.preprocess(normalizeProductType, schema as ZodTypeAny)];
    }
    return [key, schema];
  }));
}

export function getAllTools(db: DbPool): ToolDef[] {
  // Order signals importance to the LLM scanning the tool list.
  // High-frequency agent tools first, infrastructure tools last.
  return [
    // 0. Tool routing guide — keep this first so large MCP clients see the map before the catalog.
    ...guideTools(),
    // 0. Compound actions — highest priority, replace multi-step sequences
    ...compoundTools(db),        // deal_advance, contact_outreach
    // 1. Briefing + context (most important agent tools)
    ...actionContextTools(db),   // action_context_get
    ...contextEntryTools(db),    // briefing_get, context_add/get/list/search/supersede, context_stale
    ...recordDraftTools(db),     // record_draft_preview
    // 2. Actor identity
    ...actorTools(db),           // actor_whoami, actor_register, actor_expertise
    // 3. Activities
    ...activityTools(db),        // activity_create, activity_get, activity_search, activity_get_timeline, activity_complete, activity_update
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
    ...calendarTools(db),
    ...contextSourceDropTools(db),
    ...knowledgeTools(db),       // knowledge_retrieve (optional Trusted Facts)
    ...emailSequenceTools(db),
    ...subjectGraphTools(db),
    ...entityResolveTools(db),
    ...registryTools(db),
    ...webhookTools(db),
    ...workflowTools(db),
    ...systemsOfRecordTools(db),
    ...customFieldTools(db),
    ...metaTools(db),
    // 9. Messaging channels
    ...messagingTools(db),
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
  const hasExtended = actorHasScope(actor, 'extended') || actorHasScope(actor, 'write');
  const hasAnalytics = actorHasScope(actor, 'analytics') || actorHasScope(actor, 'read');

  return all.filter(t => {
    const requiredScopes = getToolScopeRequirements(t.name);
    const scopeVisible = requiredScopes.every(scope => actorHasScope(actor, scope));
    if (!scopeVisible) return false;
    if (isWritebackExecutionTool(t.name) && !hasAnyObjectWriteScope(actor)) return false;

    if (t.tier === 'core') return true;
    if (t.tier === 'extended') return hasExtended || isAdmin;
    if (t.tier === 'analytics') return hasAnalytics || isAdmin;
    if (t.tier === 'admin') return isAdmin;
    return false;
  });
}

function isWritebackExecutionTool(toolName: string): boolean {
  return [
    'sor_writeback_preview',
    'sor_writeback_request',
    'sor_writeback_review',
    'sor_writeback_execute',
  ].includes(toolName);
}

function hasAnyObjectWriteScope(actor: ActorContext): boolean {
  return [
    'contacts:write',
    'accounts:write',
    'opportunities:write',
    'activities:write',
    'use_cases:write',
    'context:write',
    'write',
    '*',
  ].some(scope => actorHasScope(actor, scope));
}

export function createMcpServer(
  db: DbPool,
  actor: ActorContext,
  getActor: () => ActorContext,
  options?: { toolset?: string | null },
): McpServer {
  const server = new McpServer({
    name: 'CRMy',
    version: getServerVersion(),
  });

  // Two-stage tool filtering at connection time:
  //   1. getToolsForActor — the hard scope/tier boundary (what the actor MAY use).
  //   2. selectToolset — a per-session working set that narrows further to the
  //      job at hand (resolve/brief/outreach/writeback/ops/...). Selection can
  //      only remove tools, never add them, so it is purely a context optimization;
  //      call-time enforceToolScopes still guards every handler.
  // The toolset is chosen per connection (not baked into the API key), so one
  // key can open differently-focused sessions for different jobs. All sessions
  // default to the lean Core Profile "standard" set; "full" is explicit opt-in.
  const allowedTools = getToolsForActor(db, actor);
  const toolsetName = resolveToolsetName(
    options?.toolset,
    actor.actor_type,
    process.env.CRMY_MCP_DEFAULT_TOOLSET,
  );
  const tools = selectToolset(allowedTools, toolsetName);

  registerResources(server, db, getActor);

  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      toolInputShapeWithProductAliases(tool.inputSchema.shape),
      async (input) => {
        try {
          const actor = getActor();
          enforceToolScopes(tool.name, actor);
          const result = await tool.handler(normalizeToolInput(input), actor);
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
