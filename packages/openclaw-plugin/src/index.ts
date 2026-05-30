// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0
//
// CRMy plugin for OpenClaw — single-tool design.
//
// Context overhead is the primary concern in OpenClaw plugins. Registering
// dozens of individual tools with full schemas floods the model's context window.
// Instead we expose ONE tool (`crmy`) with an action enum + generic params
// object. SKILL.md teaches OpenClaw the valid actions and expected param
// shapes — keeping the tool-definition tokens to an absolute minimum while
// preserving the current CRMy customer-context workflow.

import { resolveConfig, CrmyClient } from './client.js';

// ─── OpenClaw plugin API types (minimal) ─────────────────────────────────────

interface ToolInput {
  type: 'object';
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required?: string[];
}

interface ToolDef {
  id: string;
  name: string;
  description: string;
  input: ToolInput;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

interface OpenClawApi {
  registerTool(tool: ToolDef): void;
  config?: { serverUrl?: string; apiKey?: string };
  logger?: { info(msg: string): void; error(msg: string): void };
}

// ─── Route table ─────────────────────────────────────────────────────────────

type Params = Record<string, unknown>;

type RouteHandler = (client: CrmyClient, params: Params) => Promise<unknown>;

const ROUTES: Record<string, RouteHandler> = {
  // Global search and identity
  'search': async (c, p) =>
    c.get('/search', { q: str(p.q), limit: num(p.limit, 10) }),
  'actor.whoami': async (c) =>
    c.get('/actors/whoami'),
  'actor.list': async (c, p) =>
    c.get('/actors', {
      q: str(p.q),
      actor_type: str(p.actor_type),
      is_active: bool(p.is_active),
      limit: num(p.limit, 20),
      cursor: str(p.cursor),
    }),
  'actor.register': async (c, p) =>
    c.post('/actors', p),

  // Contacts
  'contact.search': async (c, p) =>
    c.get('/contacts', {
      q: str(p.q),
      stage: str(p.stage ?? p.lifecycle_stage),
      account_id: str(p.account_id),
      owner_id: str(p.owner_id),
      limit: num(p.limit, 20),
      cursor: str(p.cursor),
    }),
  'contact.get': async (c, p) =>
    c.get(`/contacts/${req(p.id, 'id')}`),
  'contact.create': async (c, p) =>
    c.post('/contacts', p),
  'contact.update': async (c, { id, ...rest }) =>
    c.patch(`/contacts/${req(id, 'id')}`, rest),
  'contact.set_stage': async (c, { id, ...rest }) =>
    c.patch(`/contacts/${req(id, 'id')}`, rest),
  'contact.timeline': async (c, p) =>
    c.get(`/contacts/${req(p.id, 'id')}/timeline`, { limit: num(p.limit, 50) }),

  // Accounts
  'account.search': async (c, p) =>
    c.get('/accounts', {
      q: str(p.q),
      industry: str(p.industry),
      owner_id: str(p.owner_id),
      limit: num(p.limit, 20),
      cursor: str(p.cursor),
    }),
  'account.get': async (c, p) =>
    c.get(`/accounts/${req(p.id, 'id')}`),
  'account.create': async (c, p) =>
    c.post('/accounts', p),
  'account.update': async (c, { id, ...rest }) =>
    c.patch(`/accounts/${req(id, 'id')}`, rest),

  // Opportunities
  'opportunity.search': async (c, p) =>
    c.get('/opportunities', {
      q: str(p.q),
      stage: str(p.stage),
      account_id: str(p.account_id),
      owner_id: str(p.owner_id),
      limit: num(p.limit, 20),
      cursor: str(p.cursor),
    }),
  'opportunity.get': async (c, p) =>
    c.get(`/opportunities/${req(p.id, 'id')}`),
  'opportunity.create': async (c, p) =>
    c.post('/opportunities', p),
  'opportunity.update': async (c, { id, ...rest }) =>
    c.patch(`/opportunities/${req(id, 'id')}`, rest),
  'opportunity.advance': async (c, { id, ...rest }) =>
    c.patch(`/opportunities/${req(id, 'id')}`, rest),

  // Use cases
  'use_case.search': async (c, p) =>
    c.get('/use-cases', {
      q: str(p.q),
      account_id: str(p.account_id),
      opportunity_id: str(p.opportunity_id),
      stage: str(p.stage),
      owner_id: str(p.owner_id),
      limit: num(p.limit, 20),
      cursor: str(p.cursor),
    }),
  'use_case.get': async (c, p) =>
    c.get(`/use-cases/${req(p.id, 'id')}`),
  'use_case.create': async (c, p) =>
    c.post('/use-cases', p),
  'use_case.update': async (c, { id, ...rest }) =>
    c.patch(`/use-cases/${req(id, 'id')}`, rest),

  // Briefings and context engine
  'briefing.get': async (c, p) =>
    c.get(`/briefing/${req(p.subject_type, 'subject_type')}/${req(p.subject_id, 'subject_id')}`, {
      since: str(p.since),
      context_types: Array.isArray(p.context_types) ? p.context_types.join(',') : str(p.context_types),
      include_stale: bool(p.include_stale),
      context_radius: str(p.context_radius),
      token_budget: num(p.token_budget),
      format: str(p.format) ?? 'json',
    }),
  'context.list': async (c, p) =>
    c.get('/context', {
      subject_type: str(p.subject_type),
      subject_id: str(p.subject_id),
      context_type: str(p.context_type),
      memory_status: str(p.memory_status),
      q: str(p.q),
      is_current: bool(p.is_current),
      limit: num(p.limit, 20),
      cursor: str(p.cursor),
    }),
  'context.signal_groups': async (c, p) =>
    c.get('/context/signal-groups', {
      subject_type: str(p.subject_type),
      subject_id: str(p.subject_id),
      context_type: str(p.context_type),
      status: str(p.status),
      attention_only: bool(p.attention_only),
      limit: num(p.limit, 20),
      cursor: str(p.cursor),
    }),
  'context.signal_group.get': async (c, p) =>
    c.get(`/context/signal-groups/${req(p.id, 'id')}`),
  'context.get': async (c, p) =>
    c.get(`/context/${req(p.id, 'id')}`),
  'context.add': async (c, p) =>
    c.post('/context', p),
  'context.supersede': async (c, { id, ...rest }) =>
    c.post(`/context/${req(id, 'id')}/supersede`, rest),
  'context.search': async (c, p) =>
    c.get('/context/search', {
      q: str(p.q ?? p.query),
      subject_type: str(p.subject_type),
      subject_id: str(p.subject_id),
      context_type: str(p.context_type),
      tag: str(p.tag),
      current_only: bool(p.current_only),
      limit: num(p.limit, 20),
    }),
  'context.semantic_search': async (c, p) =>
    c.get('/context/semantic-search', {
      q: str(p.q ?? p.query),
      subject_type: str(p.subject_type),
      subject_id: str(p.subject_id),
      context_type: str(p.context_type),
      tag: str(p.tag),
      current_only: bool(p.current_only),
      limit: num(p.limit, 20),
    }),
  'context.stale': async (c, p) =>
    c.get('/context/stale', {
      subject_type: str(p.subject_type),
      subject_id: str(p.subject_id),
      limit: num(p.limit, 20),
    }),
  'context.review_batch': async (c, p) =>
    c.post('/context/review-batch', p),
  'context.consolidate': async (c, p) =>
    c.post('/context/consolidate', p),
  'context.contradictions': async (c, p) =>
    c.get('/context/contradictions', {
      subject_type: str(p.subject_type),
      subject_id: str(p.subject_id),
      context_type: str(p.context_type),
    }),
  'context.contradictions_assign': async (c, p) =>
    c.post('/context/contradictions/assign', p),
  'context.contradictions_resolve': async (c, p) =>
    c.post('/context/contradictions/resolve', p),

  // Activities, assignments, HITL
  'activity.search': async (c, p) =>
    c.get('/activities', {
      contact_id: str(p.contact_id),
      account_id: str(p.account_id),
      opportunity_id: str(p.opportunity_id),
      subject_type: str(p.subject_type),
      subject_id: str(p.subject_id),
      type: str(p.type),
      outcome: str(p.outcome),
      limit: num(p.limit, 20),
      cursor: str(p.cursor),
    }),
  'activity.get': async (c, p) =>
    c.get(`/activities/${req(p.id, 'id')}`),
  'activity.create': async (c, p) =>
    c.post('/activities', p),
  'activity.update': async (c, { id, ...rest }) =>
    c.patch(`/activities/${req(id, 'id')}`, rest),
  'assignment.list': async (c, p) =>
    c.get('/assignments', {
      assigned_to: str(p.assigned_to),
      assigned_by: str(p.assigned_by),
      status: str(p.status),
      priority: str(p.priority),
      subject_type: str(p.subject_type),
      subject_id: str(p.subject_id),
      limit: num(p.limit, 20),
      cursor: str(p.cursor),
    }),
  'assignment.get': async (c, p) =>
    c.get(`/assignments/${req(p.id, 'id')}`),
  'assignment.create': async (c, p) =>
    c.post('/assignments', p),
  'assignment.update': async (c, { id, ...rest }) =>
    c.patch(`/assignments/${req(id, 'id')}`, rest),
  'assignment.start': async (c, p) =>
    c.post(`/assignments/${req(p.id, 'id')}/start`, {}),
  'assignment.complete': async (c, { id, ...rest }) =>
    c.post(`/assignments/${req(id, 'id')}/complete`, rest),
  'assignment.block': async (c, { id, ...rest }) =>
    c.post(`/assignments/${req(id, 'id')}/block`, rest),
  'assignment.cancel': async (c, { id, ...rest }) =>
    c.post(`/assignments/${req(id, 'id')}/cancel`, rest),
  'hitl.list': async (c, p) =>
    c.get('/hitl', { limit: num(p.limit, 20) }),
  'hitl.submit': async (c, p) =>
    c.post('/hitl', p),
  'hitl.status': async (c, p) =>
    c.get(`/hitl/${req(p.id ?? p.request_id, 'id')}`),
  'hitl.resolve': async (c, { id, request_id, ...rest }) =>
    c.post(`/hitl/${req(id ?? request_id, 'id')}/resolve`, rest),

  // Analytics
  'pipeline.summary': async (c, p) =>
    c.get('/analytics/pipeline', { group_by: str(p.group_by) ?? 'stage', owner_id: str(p.owner_id) }),
  'pipeline.forecast': async (c) =>
    c.get('/analytics/forecast'),
  'audit.events': async (c, p) =>
    c.get('/events', {
      object_type: str(p.object_type),
      object_id: str(p.object_id),
      event_type: str(p.event_type),
      actor_id: str(p.actor_id),
      limit: num(p.limit, 50),
      cursor: str(p.cursor),
    }),
  'ops.status': async (c) =>
    c.get('/ops/status'),
  'ops.data_quality': async (c, p) =>
    c.get('/ops/data-quality', {
      status: str(p.status),
      severity: str(p.severity),
      limit: num(p.limit, 50),
    }),
};

const VALID_ACTIONS = Object.keys(ROUTES) as string[];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return v != null && v !== '' ? String(v) : undefined;
}

function req(v: unknown, field: string): string {
  const value = str(v);
  if (!value) throw new Error(`Missing required CRMy parameter: ${field}`);
  return encodeURIComponent(value);
}

function num(v: unknown, fallback?: number): number | undefined {
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

// ─── Plugin entry ─────────────────────────────────────────────────────────────

export default (api: OpenClawApi) => {
  const cfg    = resolveConfig(api.config);
  const client = new CrmyClient(cfg);

  api.registerTool({
    id: 'crmy',
    name: 'CRMy',

    // Keep the top-level description short — OpenClaw loads it for every turn.
    // Detail lives in SKILL.md which is loaded only when this tool is active.
    description:
      'Interact with CRMy customer context, typed revenue objects, handoffs, and audit-safe operations. ' +
      'Specify an action and optional params. See SKILL.md for param shapes and workflow guidance.',

    input: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'CRMy action to perform (see SKILL.md for the full list).',
          enum: VALID_ACTIONS,
        },
        params: {
          type: 'object',
          description:
            'Parameters for the chosen action. Shape varies by action — see SKILL.md. ' +
            'All fields are optional except where noted (e.g. id for updates, name for creates).',
        },
      },
      required: ['action'],
    },

    handler: async (input) => {
      const action = str(input.action);
      if (!action || !ROUTES[action]) {
        throw new Error(
          `Unknown CRMy action "${action}". Valid actions: ${VALID_ACTIONS.join(', ')}`
        );
      }

      const params = (input.params ?? {}) as Params;
      api.logger?.info(`[crmy] action=${action}`);

      return ROUTES[action](client, params);
    },
  });
};
