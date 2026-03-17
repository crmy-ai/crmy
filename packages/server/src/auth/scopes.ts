// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext } from '@crmy/shared';
import { permissionDenied } from '@crmy/shared';

/**
 * Map each tool/operation to the scope(s) it requires.
 * A tool can require one or more scopes; the actor must have ALL listed scopes.
 * General 'read' or 'write' scopes act as wildcards for their category.
 */
const TOOL_SCOPES: Record<string, string[]> = {
  // ── Contacts ──
  contact_get: ['contacts:read'],
  contact_search: ['contacts:read'],
  contact_create: ['contacts:write'],
  contact_update: ['contacts:write'],
  contact_delete: ['contacts:write'],
  contact_set_lifecycle: ['contacts:write'],
  contact_get_timeline: ['contacts:read'],
  contact_log_activity: ['contacts:write', 'activities:write'],

  // ── Accounts ──
  account_get: ['accounts:read'],
  account_search: ['accounts:read'],
  account_create: ['accounts:write'],
  account_update: ['accounts:write'],
  account_delete: ['accounts:write'],

  // ── Opportunities ──
  opportunity_get: ['opportunities:read'],
  opportunity_search: ['opportunities:read'],
  opportunity_create: ['opportunities:write'],
  opportunity_update: ['opportunities:write'],
  opportunity_advance_stage: ['opportunities:write'],
  opportunity_delete: ['opportunities:write'],

  // ── Activities ──
  activity_get: ['activities:read'],
  activity_search: ['activities:read'],
  activity_create: ['activities:write'],
  activity_update: ['activities:write'],
  activity_complete: ['activities:write'],

  // ── Assignments ──
  assignment_get: ['assignments:create'],
  assignment_list: ['assignments:create'],
  assignment_create: ['assignments:create'],
  assignment_update: ['assignments:update'],
  assignment_accept: ['assignments:update'],
  assignment_complete: ['assignments:update'],
  assignment_decline: ['assignments:update'],
  assignment_start: ['assignments:update'],
  assignment_block: ['assignments:update'],
  assignment_cancel: ['assignments:update'],

  // ── Context ──
  context_get: ['context:read'],
  context_search: ['context:read'],
  context_list: ['context:read'],
  context_stale: ['context:read'],
  context_add: ['context:write'],
  context_supersede: ['context:write'],
  context_review: ['context:write'],
  briefing_get: ['context:read'],

  // ── Use Cases ──
  use_case_get: ['accounts:read'],
  use_case_search: ['accounts:read'],
  use_case_create: ['accounts:write'],
  use_case_update: ['accounts:write'],
  use_case_delete: ['accounts:write'],
  use_case_update_consumption: ['accounts:write'],
  use_case_set_health: ['accounts:write'],
  use_case_link_contact: ['accounts:write', 'contacts:read'],
  use_case_unlink_contact: ['accounts:write'],

  // ── Notes ──
  note_create: ['activities:write'],
  note_update: ['activities:write'],
  note_delete: ['activities:write'],
  note_get: ['activities:read'],
  note_search: ['activities:read'],

  // ── Emails ──
  email_create: ['activities:write'],
  email_get: ['activities:read'],
  email_search: ['activities:read'],

  // ── Webhooks ──
  webhook_create: ['write'],
  webhook_update: ['write'],
  webhook_delete: ['write'],
  webhook_get: ['read'],
  webhook_list: ['read'],

  // ── Custom Fields ──
  custom_field_create: ['write'],
  custom_field_update: ['write'],
  custom_field_delete: ['write'],
  custom_field_list: ['read'],

  // ── Workflows ──
  workflow_create: ['write'],
  workflow_update: ['write'],
  workflow_delete: ['write'],
  workflow_get: ['read'],
  workflow_list: ['read'],
  workflow_runs: ['read'],

  // ── Registries ──
  activity_type_list: ['read'],
  activity_type_add: ['write'],
  activity_type_remove: ['write'],
  context_type_list: ['read'],
  context_type_add: ['write'],
  context_type_remove: ['write'],

  // ── Actors ──
  actor_register: ['write'],
  actor_get: ['read'],
  actor_update: ['write'],
  actor_list: ['read'],
  actor_whoami: [],  // always allowed

  // ── HITL ──
  hitl_create: ['write'],
  hitl_get: ['read'],
  hitl_list: ['read'],
  hitl_resolve: ['write'],

  // ── Analytics/Meta ──
  analytics_pipeline: ['read'],
  analytics_activity_summary: ['read'],
  crm_schema: [],  // always allowed
  search: ['read'],
};

/**
 * Check if an actor has the required scope. General 'read' grants all *:read,
 * and general 'write' grants all *:write.
 */
function actorHasScope(actor: ActorContext, requiredScope: string): boolean {
  const scopes = actor.scopes;
  // No scopes defined = JWT user (full access)
  if (!scopes) return true;

  // Direct match
  if (scopes.includes(requiredScope)) return true;

  // General wildcard: 'read' covers any ':read', 'write' covers any ':write'
  if (requiredScope.endsWith(':read') && scopes.includes('read')) return true;
  if (requiredScope.endsWith(':write') && scopes.includes('write')) return true;

  return false;
}

/**
 * Enforce that the current actor has the scopes required for a given tool.
 * Throws CrmyError (403) if any required scope is missing.
 */
export function enforceToolScopes(toolName: string, actor: ActorContext): void {
  const required = TOOL_SCOPES[toolName];
  // Unknown tool or empty requirements = allow
  if (!required || required.length === 0) return;

  for (const scope of required) {
    if (!actorHasScope(actor, scope)) {
      throw permissionDenied(
        `Scope '${scope}' is required for '${toolName}'. Your scopes: [${(actor.scopes ?? []).join(', ')}]`,
      );
    }
  }
}

/**
 * Check scope for REST routes that don't map to a named tool.
 * `requiredScopes` are the scopes needed; actor must have ALL of them.
 */
export function requireScopes(actor: ActorContext, ...requiredScopes: string[]): void {
  for (const scope of requiredScopes) {
    if (!actorHasScope(actor, scope)) {
      throw permissionDenied(
        `Scope '${scope}' is required. Your scopes: [${(actor.scopes ?? []).join(', ')}]`,
      );
    }
  }
}
