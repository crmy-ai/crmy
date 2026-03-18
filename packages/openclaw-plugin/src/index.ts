// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0
//
// CRMy plugin for OpenClaw — single-tool design.
//
// Context overhead is the primary concern in OpenClaw plugins. Registering
// 12 individual tools with full schemas floods the model's context window.
// Instead we expose ONE tool (`crmy`) with an action enum + generic params
// object. SKILL.md teaches OpenClaw the valid actions and expected param
// shapes — keeping the tool-definition tokens to an absolute minimum while
// preserving full CRMy functionality.

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
  // Global cross-entity search
  'search': async (c, p) =>
    c.get('/search', { q: str(p.q), limit: num(p.limit, 10) }),

  // Contacts
  'contact.search': async (c, p) =>
    c.get('/contacts', { q: str(p.q), stage: str(p.stage), limit: num(p.limit, 20) }),

  'contact.create': async (c, p) =>
    c.post('/contacts', p),

  'contact.update': async (c, { id, ...rest }) =>
    c.patch(`/contacts/${str(id)}`, rest),

  'contact.set_stage': async (c, { id, ...rest }) =>
    c.patch(`/contacts/${str(id)}`, rest),

  'contact.log_activity': async (c, p) =>
    c.post('/activities', p),

  // Accounts
  'account.search': async (c, p) =>
    c.get('/accounts', { q: str(p.q), industry: str(p.industry), limit: num(p.limit, 20) }),

  'account.create': async (c, p) =>
    c.post('/accounts', p),

  // Opportunities
  'opportunity.search': async (c, p) =>
    c.get('/opportunities', {
      q: str(p.q),
      stage: str(p.stage),
      account_id: str(p.account_id),
      limit: num(p.limit, 20),
    }),

  'opportunity.create': async (c, p) =>
    c.post('/opportunities', p),

  'opportunity.advance': async (c, { id, ...rest }) =>
    c.patch(`/opportunities/${str(id)}`, rest),

  // Analytics
  'pipeline.summary': async (c, p) =>
    c.get('/analytics/pipeline', { group_by: str(p.group_by) ?? 'stage' }),
};

const VALID_ACTIONS = Object.keys(ROUTES) as string[];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return v != null && v !== '' ? String(v) : undefined;
}

function num(v: unknown, fallback?: number): number | undefined {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

// ─── Plugin entry ─────────────────────────────────────────────────────────────

export default (api: OpenClawApi) => {
  const cfg    = resolveConfig(api.config);
  const client = new CrmyClient(cfg);

  api.registerTool({
    id: 'crmy',
    name: 'CRMy CRM',

    // Keep the top-level description short — OpenClaw loads it for every turn.
    // Detail lives in SKILL.md which is loaded only when this tool is active.
    description:
      'Interact with the CRMy CRM. Specify an action and optional params. ' +
      'Valid actions: ' + VALID_ACTIONS.join(', ') + '. ' +
      'See SKILL.md for param shapes and workflow guidance.',

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
