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
  contact_get_timeline: ['contacts:read'],
  contact_create: ['contacts:write'],
  contact_update: ['contacts:write'],
  contact_delete: ['contacts:write'],
  contact_set_lifecycle: ['contacts:write'],
  contact_get_opportunities: ['contacts:read', 'opportunities:read'],
  contact_score: ['contacts:write'],
  contact_merge: ['contacts:write'],
  // Compound action tools
  deal_advance: ['opportunities:write', 'activities:write'],
  contact_outreach: ['contacts:read', 'activities:write'],

  // ── Accounts ──
  account_get: ['accounts:read'],
  account_search: ['accounts:read'],
  account_get_hierarchy: ['accounts:read'],
  account_health_report: ['accounts:read'],
  account_create: ['accounts:write'],
  account_update: ['accounts:write'],
  account_delete: ['accounts:write'],
  account_set_health_score: ['accounts:write'],
  account_merge: ['accounts:write'],

  // ── Opportunities ──
  opportunity_get: ['opportunities:read'],
  opportunity_search: ['opportunities:read'],
  opportunity_create: ['opportunities:write'],
  opportunity_update: ['opportunities:write'],
  opportunity_advance_stage: ['opportunities:write'],
  opportunity_delete: ['opportunities:write'],
  opportunity_health_score: ['opportunities:write'],

  // ── Activities ──
  activity_get: ['activities:read'],
  activity_search: ['activities:read'],
  activity_get_timeline: ['activities:read'],
  activity_create: ['activities:write'],
  activity_update: ['activities:write'],
  activity_complete: ['activities:write'],

  // ── Assignments ──
  assignment_get: ['assignments:read'],
  assignment_list: ['assignments:read'],
  assignment_create: ['assignments:write'],
  assignment_update: ['assignments:write'],
  assignment_accept: ['assignments:write'],
  assignment_complete: ['assignments:write'],
  assignment_decline: ['assignments:write'],
  assignment_start: ['assignments:write'],
  assignment_block: ['assignments:write'],
  assignment_cancel: ['assignments:write'],

  // ── Context ──
  context_get: ['context:read'],
  context_search: ['context:read'],
  context_list: ['context:read'],
  context_stale: ['context:read'],
  context_diff: ['context:read'],
  briefing_get: ['context:read'],
  context_add: ['context:write'],
  context_supersede: ['context:write'],
  context_review: ['context:write'],
  context_extract: ['context:write'],
  context_ingest: ['context:write'],
  context_stale_assign: ['context:write'],
  context_ingest_auto: ['context:write'],
  context_bulk_mark_stale: ['context:write'],
  context_embed_backfill: ['context:write'],
  context_semantic_search: ['context:read'],
  context_detect_contradictions: ['context:read'],
  context_contradiction_assign: ['context:read', 'assignments:write'],
  context_resolve_contradiction: ['context:write'],
  context_consolidate: ['context:write'],
  context_review_batch: ['context:write'],

  // ── Use Cases ──
  use_case_get: ['accounts:read'],
  use_case_search: ['accounts:read'],
  use_case_list_contacts: ['accounts:read'],
  use_case_get_timeline: ['accounts:read'],
  use_case_summary: ['accounts:read'],
  use_case_create: ['accounts:write'],
  use_case_update: ['accounts:write'],
  use_case_delete: ['accounts:write'],
  use_case_advance_stage: ['accounts:write'],
  use_case_update_consumption: ['accounts:write'],
  use_case_set_health: ['accounts:write'],
  use_case_link_contact: ['accounts:write', 'contacts:read'],
  use_case_unlink_contact: ['accounts:write'],

  // ── Emails ──
  email_get: ['activities:read'],
  email_search: ['activities:read'],
  email_create: ['activities:write'],
  email_ingest: ['activities:write', 'context:write'],
  email_provider_set: ['write'],
  email_provider_get: ['read'],
  email_sequence_create: ['activities:write'],
  email_sequence_get: ['activities:read'],
  email_sequence_update: ['activities:write'],
  email_sequence_delete: ['activities:write'],
  email_sequence_list: ['activities:read'],
  email_sequence_enroll: ['activities:write'],
  email_sequence_unenroll: ['activities:write'],
  email_sequence_enrollment_list: ['activities:read'],
  sequence_create: ['activities:write'],
  sequence_get: ['activities:read'],
  sequence_update: ['activities:write'],
  sequence_delete: ['activities:write'],
  sequence_list: ['activities:read'],
  sequence_enroll: ['activities:write'],
  sequence_unenroll: ['activities:write'],
  sequence_pause: ['activities:write'],
  sequence_resume: ['activities:write'],
  sequence_advance: ['activities:write'],
  sequence_enrollment_get: ['activities:read'],
  sequence_enrollment_context: ['activities:read', 'context:read'],
  sequence_enrollment_list: ['activities:read'],
  sequence_draft_step: ['activities:write'],
  sequence_analytics: ['activities:read'],
  sequence_clone: ['activities:write'],

  // ── Webhooks ──
  webhook_get: ['read'],
  webhook_list: ['read'],
  webhook_list_deliveries: ['read'],
  webhook_create: ['write'],
  webhook_update: ['write'],
  webhook_delete: ['write'],

  // ── Custom Fields ──
  custom_field_list: ['read'],
  custom_field_create: ['write'],
  custom_field_update: ['write'],
  custom_field_delete: ['write'],

  // ── Workflows ──
  workflow_get: ['read'],
  workflow_list: ['read'],
  workflow_run_list: ['read'],
  workflow_create: ['write'],
  workflow_update: ['write'],
  workflow_delete: ['write'],
  workflow_test: ['read'],
  workflow_clone: ['write'],
  workflow_trigger: ['write'],
  workflow_run_replay: ['write'],
  workflow_template_list: ['read'],

  // ── Registries ──
  activity_type_list: ['read'],
  context_type_list: ['read'],
  activity_type_add: ['write'],
  activity_type_remove: ['write'],
  context_type_add: ['write'],
  context_type_remove: ['write'],

  // ── Actors ──
  actor_get: ['read'],
  actor_list: ['read'],
  actor_expertise: ['read'],
  actor_register: ['write'],
  actor_update: ['write'],
  agent_register_specialization: ['write'],
  agent_find_specialist: ['read'],
  agent_set_availability: ['write'],
  actor_whoami: [],  // always allowed

  // ── HITL ──
  hitl_check_status: ['read'],
  hitl_list_pending: ['read'],
  hitl_submit_request: ['write'],
  hitl_resolve: ['write'],
  hitl_rule_create: ['write'],
  hitl_rule_list: ['read'],
  hitl_rule_delete: ['write'],

  // ── Agent handoff ──
  agent_capture_handoff: ['write'],
  agent_resume_handoff: ['read', 'write'],

  // ── Analytics / Meta ──
  pipeline_summary: ['opportunities:read'],
  pipeline_forecast: ['opportunities:read'],
  crm_search: ['read'],
  tenant_get_stats: ['read'],
  ops_status_get: ['read'],
  ops_job_recover: ['write'],
  ops_data_quality_get: ['read'],
  ops_data_quality_repair: ['write'],
  ops_audit_get: ['read'],
  ops_privacy_export: ['read'],
  ops_pii_redact: ['write'],
  ops_privacy_delete: ['write'],
  ops_retention_apply: ['write'],
  entity_resolve: [],  // always allowed
  schema_get: [],      // always allowed
  guide_search: [],    // always allowed

  // ── Messaging ──
  message_channel_create: ['write'],
  message_channel_update: ['write'],
  message_channel_get: ['read'],
  message_channel_delete: ['write'],
  message_channel_list: ['read'],
  message_send: ['write'],
  message_delivery_get: ['read'],
  message_delivery_search: ['read'],
};

/**
 * Check if an actor has the required scope. General 'read' grants all *:read,
 * and general 'write' grants all *:write.
 */
function actorHasScope(actor: ActorContext, requiredScope: string): boolean {
  const scopes = actor.scopes;
  // No scopes defined = verified JWT user (full access). Constructed actors,
  // anonymous actors, and API-key actors must carry explicit scopes.
  if (!scopes) {
    return actor.actor_type === 'user'
      && Boolean(actor.tenant_id)
      && Boolean(actor.actor_id)
      && actor.actor_id !== 'anonymous';
  }

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
