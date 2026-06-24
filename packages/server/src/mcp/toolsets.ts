// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * MCP tool working sets ("toolsets").
 *
 * The full CRMy catalog is large (~250 tools). Registering every allowed tool
 * on every MCP session hurts tool-selection accuracy and wastes context.
 * A toolset narrows the *registered* working set for a single session to the
 * tools a given job needs.
 *
 * Key properties:
 *
 * - **Per session, never per key.** A toolset is chosen when a session is
 *   created (HTTP `?toolset=` / `X-CRMy-Toolset`, CLI `--toolset` /
 *   `CRMY_MCP_TOOLSET`). The same agent API key can open a `customer_outreach`
 *   session and a `systems_writeback` session and get the right working set for
 *   each. Roles/jobs are not baked into the credential.
 * - **Narrowing only — never widening.** A toolset can only remove tools from
 *   the actor's already scope-filtered list. It can never grant access. The
 *   call-time `enforceToolScopes` check remains the hard security boundary, so
 *   toolsets are purely a context/usability optimization.
 * - **`tool_guide` stays the runtime router.** An agent unsure which job it is
 *   doing calls `tool_guide`, which maps the task to a recommended toolset and
 *   tells it how to focus a session on that set.
 */

/** Special toolset name meaning "register every tool the actor is allowed to use". */
export const FULL_TOOLSET = 'full';

/**
 * Navigation and universal pre-action tools included in every named toolset.
 * These let an agent always orient, resolve a record, brief, check Action
 * Context, and discover other toolsets via `tool_guide` — regardless of which
 * focused toolset a session selected.
 */
export const CORE_TOOLS: readonly string[] = [
  'tool_guide',
  'guide_search',
  'actor_whoami',
  'customer_record_resolve',
  'briefing_get',
  'action_context_get',
  'context_find',
];

export interface ToolsetDefinition {
  description: string;
  /** Tools registered in addition to CORE_TOOLS. */
  tools: readonly string[];
}

/**
 * Named focused toolsets. Each is intersected with CORE_TOOLS and with the
 * actor's scope-filtered tools at registration time.
 *
 * These mirror the workflows surfaced by `tool_guide`, so an agent that asks
 * the guide which tools to use can request the matching toolset for its
 * session.
 */
export const TOOLSET_DEFINITIONS: Record<string, ToolsetDefinition> = {
  standard: {
    description:
      'Common customer-reasoning loop: resolve a record, brief, ingest Raw Context, review Signals, draft outreach/records, and check outcomes. Sensible lean default for most agents.',
    tools: [
      'action_context_request_human_unblock',
      'context_get',
      'context_ingest_auto',
      'context_signal_group_list',
      'context_signal_group_get',
      'context_lineage_get',
      'record_draft_preview',
      'email_draft_preview',
      'activity_create',
      'activity_get',
      'activity_search',
      'assignment_create',
      'assignment_list',
      'contact_search',
      'contact_get',
      'account_search',
      'account_get',
      'opportunity_search',
      'opportunity_get',
      'contact_outreach',
      'deal_advance',
      'hitl_submit_request',
      'hitl_check_status',
    ],
  },
  record_lookup: {
    description: 'Resolve and read customer records account-first across accounts, contacts, opportunities, and use cases.',
    tools: [
      'entity_resolve',
      'account_search',
      'account_get',
      'contact_search',
      'contact_get',
      'opportunity_search',
      'opportunity_get',
      'use_case_search',
    ],
  },
  ingest: {
    description: 'Send transcripts, emails, notes, and research through Raw Context ingestion and inspect processing receipts.',
    tools: [
      'context_ingest_auto',
      'context_ingest',
      'context_raw_source_get',
      'context_raw_source_list',
      'context_signal_group_list',
    ],
  },
  signal_review: {
    description: 'Inspect unconfirmed evidence-backed Signals and decide on details, handoff, rejection, or confirmation.',
    tools: [
      'context_get',
      'context_signal_group_list',
      'context_signal_group_get',
      'context_signal_group_complete_details',
      'context_signal_handoff',
      'context_signal_group_reject',
      'context_signal_group_promote',
    ],
  },
  memory_promotion: {
    description: 'Turn reviewed or policy-approved Signals into Current Memory.',
    tools: [
      'context_get',
      'context_signal_group_list',
      'context_signal_group_get',
      'context_signal_group_promote',
      'context_add',
      'context_supersede',
    ],
  },
  customer_outreach: {
    description: 'Prepare customer communication from confirmed context, visible warnings, and policy checks.',
    tools: [
      'action_context_request_human_unblock',
      'contact_search',
      'contact_get',
      'email_draft_preview',
      'email_draft_save',
      'activity_create',
      'contact_outreach',
      'message_send',
    ],
  },
  record_update: {
    description: 'Preview and apply governed record changes to CRM objects.',
    tools: [
      'record_draft_preview',
      'contact_get',
      'account_get',
      'opportunity_get',
      'contact_create',
      'contact_update',
      'account_create',
      'account_update',
      'opportunity_create',
      'opportunity_update',
    ],
  },
  systems_writeback: {
    description: 'Governed external system writes: mappings, previews, requests, review, and execution.',
    tools: [
      'sor_mapping_list',
      'sor_writeback_preview',
      'sor_writeback_request',
      'sor_writeback_review',
      'sor_writeback_execute',
      'sor_writeback_status',
      'sor_conflict_list',
    ],
  },
  ops: {
    description: 'Operator-only durability and data-quality workflows: status, data quality, job recovery, and audit.',
    tools: [
      'ops_status_get',
      'ops_data_quality_get',
      'ops_data_quality_repair',
      'ops_job_recover',
      'ops_audit_get',
    ],
  },
};

/** True for `full` or any defined toolset name (case-insensitive). */
export function isValidToolset(name: string | undefined | null): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  return normalized === FULL_TOOLSET
    || Object.prototype.hasOwnProperty.call(TOOLSET_DEFINITIONS, normalized);
}

/**
 * Resolve the effective toolset name for a session.
 *
 * Precedence:
 *   1. an explicit, valid `requested` toolset (per-connection selection);
 *   2. a valid `CRMY_MCP_DEFAULT_TOOLSET` operator default;
 *   3. a lean `standard` set for autonomous agents, `full` for humans/admins.
 *
 * Invalid values fall through rather than throwing, so a typo cannot break a
 * connection — it just lands on the default.
 */
export function resolveToolsetName(
  requested?: string | null,
  actorType?: 'user' | 'agent' | 'system',
  envDefault?: string | null,
): string {
  const req = requested?.trim().toLowerCase();
  if (req && isValidToolset(req)) return req;
  const env = envDefault?.trim().toLowerCase();
  if (env && isValidToolset(env)) return env;
  return actorType === 'agent' ? 'standard' : FULL_TOOLSET;
}

/**
 * The set of tool names a toolset registers, or `null` when the toolset does
 * not narrow (i.e. `full` or an unknown name → register everything allowed).
 */
export function toolNamesForToolset(name: string): Set<string> | null {
  const normalized = name.trim().toLowerCase();
  if (normalized === FULL_TOOLSET) return null;
  const def = TOOLSET_DEFINITIONS[normalized];
  if (!def) return null;
  return new Set([...CORE_TOOLS, ...def.tools]);
}

/**
 * Narrow an already scope-filtered tool list to the named toolset. Selection
 * can only remove tools, never add them, so it is always safe.
 */
export function selectToolset<T extends { name: string }>(tools: T[], name: string): T[] {
  const allowed = toolNamesForToolset(name);
  if (!allowed) return tools;
  return tools.filter(tool => allowed.has(tool.name));
}

/** Human-readable catalog of selectable toolsets, surfaced by `tool_guide`. */
export function listToolsets(): Array<{ name: string; description: string }> {
  return [
    {
      name: FULL_TOOLSET,
      description: 'Every tool your credentials allow. Best for humans and admins; large for autonomous agents.',
    },
    ...Object.entries(TOOLSET_DEFINITIONS).map(([name, def]) => ({ name, description: def.description })),
  ];
}
