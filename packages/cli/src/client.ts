// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { loadConfigFile, loadAuthState } from './config.js';

export interface CliClient {
  call(toolName: string, input: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

// Map MCP tool names to REST method + path
const TOOL_REST_MAP: Record<string, { method: string; path: (input: Record<string, unknown>) => string; bodyTransform?: (input: Record<string, unknown>) => Record<string, unknown> }> = {
  // Contacts
  contact_create: { method: 'POST', path: () => '/api/v1/contacts' },
  contact_get: { method: 'GET', path: (i) => `/api/v1/contacts/${i.id}` },
  contact_search: { method: 'GET', path: (i) => `/api/v1/contacts?q=${encodeURIComponent((i.query as string) ?? '')}&limit=${i.limit ?? 20}${i.lifecycle_stage ? `&stage=${i.lifecycle_stage}` : ''}${i.cursor ? `&cursor=${i.cursor}` : ''}` },
  contact_update: { method: 'PATCH', path: (i) => `/api/v1/contacts/${i.id}` },
  contact_set_lifecycle: { method: 'PATCH', path: (i) => `/api/v1/contacts/${i.id}` },
  contact_log_activity: { method: 'POST', path: () => '/api/v1/activities' },
  contact_get_timeline: { method: 'GET', path: (i) => `/api/v1/contacts/${i.id}/timeline` },

  // Accounts
  account_create: { method: 'POST', path: () => '/api/v1/accounts' },
  account_get: { method: 'GET', path: (i) => `/api/v1/accounts/${i.id}` },
  account_search: { method: 'GET', path: (i) => `/api/v1/accounts?q=${encodeURIComponent((i.query as string) ?? '')}&limit=${i.limit ?? 20}` },
  account_update: { method: 'PATCH', path: (i) => `/api/v1/accounts/${i.id}` },

  // Opportunities
  opportunity_create: { method: 'POST', path: () => '/api/v1/opportunities' },
  opportunity_get: { method: 'GET', path: (i) => `/api/v1/opportunities/${i.id}` },
  opportunity_search: { method: 'GET', path: (i) => `/api/v1/opportunities?q=${encodeURIComponent((i.query as string) ?? '')}&limit=${i.limit ?? 20}${i.stage ? `&stage=${i.stage}` : ''}` },
  opportunity_advance_stage: { method: 'PATCH', path: (i) => `/api/v1/opportunities/${i.id}` },
  opportunity_update: { method: 'PATCH', path: (i) => `/api/v1/opportunities/${i.id}` },

  // Activities
  activity_create: { method: 'POST', path: () => '/api/v1/activities' },
  activity_get: { method: 'GET', path: (i) => `/api/v1/activities?limit=${i.limit ?? 20}` },
  activity_search: { method: 'GET', path: (i) => `/api/v1/activities?limit=${i.limit ?? 20}` },

  // Use Cases
  use_case_create: { method: 'POST', path: () => '/api/v1/use-cases' },
  use_case_get: { method: 'GET', path: (i) => `/api/v1/use-cases/${i.id}` },
  use_case_search: { method: 'GET', path: (i) => `/api/v1/use-cases?q=${encodeURIComponent((i.query as string) ?? '')}&limit=${i.limit ?? 20}${i.stage ? `&stage=${i.stage}` : ''}${i.account_id ? `&account_id=${i.account_id}` : ''}` },
  use_case_update: { method: 'PATCH', path: (i) => `/api/v1/use-cases/${i.id}` },
  use_case_delete: { method: 'DELETE', path: (i) => `/api/v1/use-cases/${i.id}` },
  use_case_advance_stage: { method: 'POST', path: (i) => `/api/v1/use-cases/${i.id}/stage` },
  use_case_update_consumption: { method: 'POST', path: (i) => `/api/v1/use-cases/${i.id}/consumption` },
  use_case_set_health: { method: 'POST', path: (i) => `/api/v1/use-cases/${i.id}/health` },
  use_case_link_contact: { method: 'POST', path: (i) => `/api/v1/use-cases/${i.use_case_id ?? i.id}/contacts` },
  use_case_unlink_contact: { method: 'DELETE', path: (i) => `/api/v1/use-cases/${i.use_case_id ?? i.id}/contacts/${i.contact_id}` },
  use_case_list_contacts: { method: 'GET', path: (i) => `/api/v1/use-cases/${i.use_case_id ?? i.id}/contacts` },
  use_case_get_timeline: { method: 'GET', path: (i) => `/api/v1/use-cases/${i.id}/timeline` },
  use_case_summary: { method: 'GET', path: (i) => `/api/v1/analytics/use-cases?group_by=${i.group_by ?? 'stage'}` },

  // Analytics
  pipeline_summary: { method: 'GET', path: (i) => `/api/v1/analytics/pipeline${i.owner_id ? `?owner_id=${i.owner_id}` : ''}` },
  pipeline_forecast: { method: 'GET', path: (i) => `/api/v1/analytics/forecast${i.period ? `?period=${i.period}` : ''}` },

  // HITL
  hitl_list_pending: { method: 'GET', path: () => '/api/v1/hitl' },
  hitl_check_status: { method: 'GET', path: (i) => `/api/v1/hitl/${i.id}` },
  hitl_submit_request: { method: 'POST', path: () => '/api/v1/hitl' },
  hitl_resolve: { method: 'POST', path: (i) => `/api/v1/hitl/${i.id}/resolve` },

  // Webhooks
  webhook_create: { method: 'POST', path: () => '/api/v1/webhooks' },
  webhook_list: { method: 'GET', path: () => '/api/v1/webhooks' },
  webhook_get: { method: 'GET', path: (i) => `/api/v1/webhooks/${i.id}` },
  webhook_update: { method: 'PATCH', path: (i) => `/api/v1/webhooks/${i.id}` },
  webhook_delete: { method: 'DELETE', path: (i) => `/api/v1/webhooks/${i.id}` },
  webhook_list_deliveries: { method: 'GET', path: (i) => `/api/v1/webhooks/${i.endpoint_id ?? i.id}/deliveries` },

  // Emails
  email_create: { method: 'POST', path: () => '/api/v1/emails' },
  email_get: { method: 'GET', path: (i) => `/api/v1/emails/${i.id}` },
  email_search: { method: 'GET', path: (i) => `/api/v1/emails?limit=${i.limit ?? 20}` },

  // Custom Fields
  custom_field_create: { method: 'POST', path: () => '/api/v1/custom-fields' },
  custom_field_list: { method: 'GET', path: (i) => `/api/v1/custom-fields?object_type=${i.object_type}` },
  custom_field_delete: { method: 'DELETE', path: (i) => `/api/v1/custom-fields/${i.id}` },

  // Notes
  note_create: { method: 'POST', path: () => '/api/v1/notes' },
  note_get: { method: 'GET', path: (i) => `/api/v1/notes/${i.id}` },
  note_list: { method: 'GET', path: (i) => `/api/v1/notes?object_type=${i.object_type}&object_id=${i.object_id}` },
  note_delete: { method: 'DELETE', path: (i) => `/api/v1/notes/${i.id}` },

  // Workflows
  workflow_create: { method: 'POST', path: () => '/api/v1/workflows' },
  workflow_get: { method: 'GET', path: (i) => `/api/v1/workflows/${i.id}` },
  workflow_list: { method: 'GET', path: () => '/api/v1/workflows' },
  workflow_delete: { method: 'DELETE', path: (i) => `/api/v1/workflows/${i.id}` },
  workflow_run_list: { method: 'GET', path: (i) => `/api/v1/workflows/${i.workflow_id ?? i.id}/runs` },

  // Events
  event_search: { method: 'GET', path: (i) => `/api/v1/events?${i.object_id ? `object_id=${i.object_id}&` : ''}limit=${i.limit ?? 20}` },

  // Search
  search: { method: 'GET', path: (i) => `/api/v1/search?q=${encodeURIComponent((i.query as string) ?? '')}` },

  // Meta
  schema_get: { method: 'GET', path: () => '/health' },
  tenant_get_stats: { method: 'GET', path: () => '/health' },

  // Actors
  actor_register: { method: 'POST', path: () => '/api/v1/actors' },
  actor_get: { method: 'GET', path: (i) => `/api/v1/actors/${i.id}` },
  actor_list: { method: 'GET', path: (i) => `/api/v1/actors?limit=${i.limit ?? 20}${i.actor_type ? `&actor_type=${i.actor_type}` : ''}${i.query ? `&q=${encodeURIComponent(i.query as string)}` : ''}` },
  actor_update: { method: 'PATCH', path: (i) => `/api/v1/actors/${i.id}` },
  actor_whoami: { method: 'GET', path: () => '/api/v1/actors/whoami' },

  // Assignments
  assignment_create: { method: 'POST', path: () => '/api/v1/assignments' },
  assignment_get: { method: 'GET', path: (i) => `/api/v1/assignments/${i.id}` },
  assignment_list: { method: 'GET', path: (i) => `/api/v1/assignments?limit=${i.limit ?? 20}${i.assigned_to ? `&assigned_to=${i.assigned_to}` : ''}${i.assigned_by ? `&assigned_by=${i.assigned_by}` : ''}${i.status ? `&status=${i.status}` : ''}` },
  assignment_update: { method: 'PATCH', path: (i) => `/api/v1/assignments/${i.id}` },
  assignment_accept: { method: 'POST', path: (i) => `/api/v1/assignments/${i.id}/accept` },
  assignment_complete: { method: 'POST', path: (i) => `/api/v1/assignments/${i.id}/complete` },
  assignment_decline: { method: 'POST', path: (i) => `/api/v1/assignments/${i.id}/decline` },

  // Context Entries
  context_add: { method: 'POST', path: () => '/api/v1/context' },
  context_get: { method: 'GET', path: (i) => `/api/v1/context/${i.id}` },
  context_list: { method: 'GET', path: (i) => `/api/v1/context?limit=${i.limit ?? 20}${i.subject_type ? `&subject_type=${i.subject_type}` : ''}${i.subject_id ? `&subject_id=${i.subject_id}` : ''}${i.context_type ? `&context_type=${i.context_type}` : ''}` },
  context_supersede: { method: 'POST', path: (i) => `/api/v1/context/${i.id}/supersede` },
  context_search: { method: 'GET', path: (i) => `/api/v1/context/search?q=${encodeURIComponent(i.query as string)}&limit=${i.limit ?? 20}${i.subject_type ? `&subject_type=${i.subject_type}` : ''}${i.context_type ? `&context_type=${i.context_type}` : ''}${i.tag ? `&tag=${i.tag}` : ''}${i.current_only === false ? '&current_only=false' : ''}` },
  context_review: { method: 'POST', path: (i) => `/api/v1/context/${i.id}/review` },
  context_stale: { method: 'GET', path: (i) => `/api/v1/context/stale?limit=${i.limit ?? 20}${i.subject_type ? `&subject_type=${i.subject_type}` : ''}${i.subject_id ? `&subject_id=${i.subject_id}` : ''}` },

  // Activity Type Registry
  activity_type_list: { method: 'GET', path: (i) => `/api/v1/activity-types${i.category ? `?category=${i.category}` : ''}` },
  activity_type_add: { method: 'POST', path: () => '/api/v1/activity-types' },
  activity_type_remove: { method: 'DELETE', path: (i) => `/api/v1/activity-types/${i.type_name}` },

  // Context Type Registry
  context_type_list: { method: 'GET', path: () => '/api/v1/context-types' },
  context_type_add: { method: 'POST', path: () => '/api/v1/context-types' },
  context_type_remove: { method: 'DELETE', path: (i) => `/api/v1/context-types/${i.type_name}` },

  // Briefing
  briefing_get: { method: 'GET', path: (i) => `/api/v1/briefing/${i.subject_type}/${i.subject_id}?format=${i.format ?? 'json'}${i.since ? `&since=${i.since}` : ''}${i.include_stale ? '&include_stale=true' : ''}${i.context_types ? `&context_types=${(i.context_types as string[]).join(',')}` : ''}` },

  // Assignment: Start, Block, Cancel
  assignment_start: { method: 'POST', path: (i) => `/api/v1/assignments/${i.id}/start` },
  assignment_block: { method: 'POST', path: (i) => `/api/v1/assignments/${i.id}/block` },
  assignment_cancel: { method: 'POST', path: (i) => `/api/v1/assignments/${i.id}/cancel` },

  // Activity Timeline (enhanced)
  activity_get_timeline: { method: 'GET', path: (i) => `/api/v1/activities?subject_type=${i.subject_type}&subject_id=${i.subject_id}&limit=${i.limit ?? 50}` },
};

/**
 * Create an HTTP-based client that calls the CRMy REST API.
 */
function createHttpClient(serverUrl: string, token: string): CliClient {
  return {
    async call(toolName: string, input: Record<string, unknown>): Promise<string> {
      const mapping = TOOL_REST_MAP[toolName];
      if (!mapping) {
        throw new Error(`Unknown tool: ${toolName} (no REST mapping)`);
      }

      const { method, path } = mapping;
      const url = `${serverUrl.replace(/\/$/, '')}${path(input)}`;

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const fetchOpts: RequestInit = { method, headers };
      if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
        // Strip path params from body
        const body = { ...input };
        delete body.id;
        fetchOpts.body = JSON.stringify(body);
      }

      const res = await fetch(url, fetchOpts);

      if (res.status === 401) {
        throw new Error('Authentication expired. Run `crmy login` to re-authenticate.');
      }

      const responseBody = await res.text();
      if (!res.ok) {
        let detail = responseBody;
        try {
          detail = JSON.parse(responseBody).detail ?? responseBody;
        } catch {}
        throw new Error(`API error (${res.status}): ${detail}`);
      }

      return responseBody;
    },
    async close() {
      // No cleanup needed for HTTP client
    },
  };
}

/**
 * Create a direct database client using MCP tools.
 */
async function createDbClient(databaseUrl: string, apiKey?: string): Promise<CliClient> {
  process.env.CRMY_IMPORTED = '1';

  const { initPool, closePool, getAllTools } = await import('@crmy/server');
  const db = await initPool(databaseUrl);

  let actor = {
    tenant_id: '',
    actor_id: 'cli-user',
    actor_type: 'user' as const,
    role: 'owner' as const,
  };

  if (apiKey) {
    const crypto = await import('node:crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const result = await db.query(
      `SELECT ak.tenant_id, ak.user_id, u.role
       FROM api_keys ak LEFT JOIN users u ON ak.user_id = u.id
       WHERE ak.key_hash = $1`,
      [keyHash],
    );
    if (result.rows.length > 0) {
      actor.tenant_id = result.rows[0].tenant_id;
      actor.actor_id = result.rows[0].user_id ?? 'cli-user';
      actor.role = result.rows[0].role ?? 'owner';
    }
  }

  if (!actor.tenant_id) {
    const tenantResult = await db.query("SELECT id FROM tenants WHERE slug = 'default' LIMIT 1");
    if (tenantResult.rows.length > 0) {
      actor.tenant_id = tenantResult.rows[0].id;
    }
  }

  const tools = getAllTools(db);

  return {
    async call(toolName: string, input: Record<string, unknown>): Promise<string> {
      const tool = tools.find(t => t.name === toolName);
      if (!tool) throw new Error(`Unknown tool: ${toolName}`);
      const result = await tool.handler(input, actor);
      return JSON.stringify(result, null, 2);
    },
    async close() {
      await closePool();
    },
  };
}

/**
 * Get a CLI client. Priority:
 * 1. Direct DB (if DATABASE_URL or .crmy.json database.url is set)
 * 2. HTTP client (if authenticated via `crmy login`)
 */
export async function getClient(): Promise<CliClient> {
  const config = loadConfigFile();
  const databaseUrl = process.env.DATABASE_URL ?? config.database?.url;

  // Prefer direct DB connection when available
  if (databaseUrl) {
    const apiKey = process.env.CRMY_API_KEY ?? config.apiKey;
    return createDbClient(databaseUrl, apiKey);
  }

  // Fall back to HTTP client if authenticated
  const auth = loadAuthState();
  if (auth) {
    return createHttpClient(auth.serverUrl, auth.token);
  }

  // Also check for server URL + API key (headless mode)
  const serverUrl = process.env.CRMY_SERVER_URL ?? config.serverUrl;
  const apiKey = process.env.CRMY_API_KEY ?? config.apiKey;
  if (serverUrl && apiKey) {
    return createHttpClient(serverUrl, apiKey);
  }

  console.error('Not connected. Run `crmy auth setup` and `crmy login`, or `crmy init` for local mode.');
  process.exit(1);
}
