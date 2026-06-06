// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { loadConfigFile, loadAuthState } from './config.js';
import { resolveLocalActor } from './local-actor.js';
import type { ActorContext } from '@crmy/shared';

export interface CliClient {
  call(toolName: string, input: Record<string, unknown>): Promise<string>;
  listTools?(): Promise<Array<{ name: string; tier?: string; description?: string }>>;
  describeTool?(toolName: string): Promise<{
    name: string;
    tier?: string;
    description?: string;
    input_schema?: Record<string, unknown>;
    required?: string[];
    example?: Record<string, unknown>;
  }>;
  close(): Promise<void>;
}

// Map MCP tool names to REST method + path
const TOOL_REST_MAP: Record<string, { method: string; path: (input: Record<string, unknown>) => string; bodyTransform?: (input: Record<string, unknown>) => Record<string, unknown> }> = {
  // Contacts
  contact_create: { method: 'POST', path: () => '/api/v1/contacts' },
  contact_get: { method: 'GET', path: (i) => `/api/v1/contacts/${i.id}` },
  contact_search: { method: 'GET', path: (i) => `/api/v1/contacts?q=${encodeURIComponent((i.query as string) ?? '')}&limit=${i.limit ?? 20}${i.lifecycle_stage ? `&stage=${i.lifecycle_stage}` : ''}${i.cursor ? `&cursor=${i.cursor}` : ''}` },
  contact_update: { method: 'PATCH', path: (i) => `/api/v1/contacts/${i.id}` },
  contact_delete: { method: 'DELETE', path: (i) => `/api/v1/contacts/${i.id}` },
  contact_set_lifecycle: { method: 'PATCH', path: (i) => `/api/v1/contacts/${i.id}` },
  contact_log_activity: { method: 'POST', path: () => '/api/v1/activities' },
  contact_get_timeline: { method: 'GET', path: (i) => `/api/v1/contacts/${i.id}/timeline` },

  // Accounts
  account_create: { method: 'POST', path: () => '/api/v1/accounts' },
  account_get: { method: 'GET', path: (i) => `/api/v1/accounts/${i.id}` },
  account_search: { method: 'GET', path: (i) => `/api/v1/accounts?q=${encodeURIComponent((i.query as string) ?? '')}&limit=${i.limit ?? 20}` },
  account_update: { method: 'PATCH', path: (i) => `/api/v1/accounts/${i.id}` },
  account_delete: { method: 'DELETE', path: (i) => `/api/v1/accounts/${i.id}` },

  // Opportunities
  opportunity_create: { method: 'POST', path: () => '/api/v1/opportunities' },
  opportunity_get: { method: 'GET', path: (i) => `/api/v1/opportunities/${i.id}` },
  opportunity_search: { method: 'GET', path: (i) => `/api/v1/opportunities?q=${encodeURIComponent((i.query as string) ?? '')}&limit=${i.limit ?? 20}${i.stage ? `&stage=${i.stage}` : ''}` },
  opportunity_advance_stage: { method: 'PATCH', path: (i) => `/api/v1/opportunities/${i.id}` },
  opportunity_update: { method: 'PATCH', path: (i) => `/api/v1/opportunities/${i.id}` },
  opportunity_delete: { method: 'DELETE', path: (i) => `/api/v1/opportunities/${i.id}` },

  // Activities
  activity_create: { method: 'POST', path: () => '/api/v1/activities' },
  activity_get: { method: 'GET', path: (i) => `/api/v1/activities/${i.id}` },
  activity_search: { method: 'GET', path: (i) => `/api/v1/activities?limit=${i.limit ?? 20}${i.subject_type ? `&subject_type=${i.subject_type}` : ''}${i.subject_id ? `&subject_id=${i.subject_id}` : ''}${i.type ? `&type=${i.type}` : ''}` },

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
  use_case_summary: { method: 'GET', path: (i) => `/api/v1/analytics/use-cases?group_by=${i.group_by ?? 'stage'}${i.account_id ? `&account_id=${i.account_id}` : ''}` },

  // Analytics
  pipeline_summary: { method: 'GET', path: (i) => `/api/v1/analytics/pipeline${i.owner_id ? `?owner_id=${i.owner_id}` : ''}` },
  pipeline_forecast: { method: 'GET', path: (i) => `/api/v1/analytics/forecast${i.period ? `?period=${i.period}` : ''}` },

  // HITL
  hitl_list_pending: { method: 'GET', path: () => '/api/v1/hitl' },
  hitl_check_status: { method: 'GET', path: (i) => `/api/v1/hitl/${i.id}` },
  hitl_submit_request: { method: 'POST', path: () => '/api/v1/hitl' },
  hitl_resolve: { method: 'POST', path: (i) => `/api/v1/hitl/${i.id ?? i.request_id}/resolve` },

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
  email_draft_preview: { method: 'POST', path: () => '/api/v1/emails/draft-preview' },
  email_draft_save: { method: 'POST', path: () => '/api/v1/emails/drafts' },
  mailbox_connection_list: { method: 'GET', path: () => '/api/v1/mailbox/connections' },
  email_message_search: { method: 'GET', path: (i) => `/api/v1/email-messages?view=${i.view ?? 'customer'}&limit=${i.limit ?? 20}${i.q ? `&q=${encodeURIComponent(i.q as string)}` : ''}${i.include_internal ? '&include_internal=true' : ''}` },
  email_message_get: { method: 'GET', path: (i) => `/api/v1/email-messages/${i.id}` },
  email_message_process: { method: 'POST', path: (i) => `/api/v1/email-messages/${i.id}/process` },
  email_message_ignore: { method: 'POST', path: (i) => `/api/v1/email-messages/${i.id}/ignore` },

  // Custom Fields
  custom_field_create: { method: 'POST', path: () => '/api/v1/custom-fields' },
  custom_field_list: { method: 'GET', path: (i) => `/api/v1/custom-fields?object_type=${i.object_type}` },
  custom_field_delete: { method: 'DELETE', path: (i) => `/api/v1/custom-fields/${i.id}` },

  // Workflows
  workflow_create: { method: 'POST', path: () => '/api/v1/workflows' },
  workflow_get: { method: 'GET', path: (i) => `/api/v1/workflows/${i.id}` },
  workflow_list: { method: 'GET', path: () => '/api/v1/workflows' },
  workflow_update: { method: 'PATCH', path: (i) => `/api/v1/workflows/${i.id}`, bodyTransform: (i) => (i.patch as Record<string, unknown>) ?? i },
  workflow_delete: { method: 'DELETE', path: (i) => `/api/v1/workflows/${i.id}` },
  workflow_run_list: { method: 'GET', path: (i) => `/api/v1/workflows/${i.workflow_id ?? i.id}/runs` },
  workflow_test: { method: 'POST', path: (i) => `/api/v1/workflows/${i.id}/test` },
  workflow_clone: { method: 'POST', path: (i) => `/api/v1/workflows/${i.id}/clone` },
  workflow_trigger: { method: 'POST', path: (i) => `/api/v1/workflows/${i.id}/trigger` },

  // Systems of Record
  sor_system_create: { method: 'POST', path: () => '/api/v1/systems-of-record' },
  sor_system_update: { method: 'PATCH', path: (i) => `/api/v1/systems-of-record/${i.id}` },
  sor_system_delete: { method: 'DELETE', path: (i) => `/api/v1/systems-of-record/${i.id}` },
  sor_system_list: { method: 'GET', path: (i) => `/api/v1/systems-of-record?limit=${i.limit ?? 20}${i.system_type ? `&system_type=${i.system_type}` : ''}${i.status ? `&status=${i.status}` : ''}` },
  sor_system_get: { method: 'GET', path: (i) => `/api/v1/systems-of-record/${i.id}` },
  sor_system_test: { method: 'POST', path: (i) => `/api/v1/systems-of-record/${i.id}/test` },
  sor_discover: { method: 'GET', path: (i) => `/api/v1/systems-of-record/${i.system_id}/discover${i.object_name ? `?object_name=${encodeURIComponent(i.object_name as string)}` : ''}` },
  sor_mapping_list: { method: 'GET', path: (i) => `/api/v1/systems-of-record/mappings/list?limit=${i.limit ?? 20}${i.system_id ? `&system_id=${i.system_id}` : ''}${i.object_type ? `&object_type=${i.object_type}` : ''}` },
  sor_mapping_upsert: { method: 'POST', path: () => '/api/v1/systems-of-record/mappings' },
  sor_mapping_delete: { method: 'DELETE', path: (i) => `/api/v1/systems-of-record/mappings/${i.id}` },
  sor_sync_run: { method: 'POST', path: (i) => `/api/v1/systems-of-record/${i.system_id}/sync` },
  sor_sync_status: { method: 'GET', path: (i) => `/api/v1/systems-of-record/sync-runs/list?limit=${i.limit ?? 20}${i.system_id ? `&system_id=${i.system_id}` : ''}${i.status ? `&status=${i.status}` : ''}` },
  sor_conflict_list: { method: 'GET', path: (i) => `/api/v1/systems-of-record/conflicts/list?limit=${i.limit ?? 20}${i.system_id ? `&system_id=${i.system_id}` : ''}${i.status ? `&status=${i.status}` : ''}` },
  sor_conflict_resolve: { method: 'POST', path: (i) => `/api/v1/systems-of-record/conflicts/${i.id}/resolve` },
  sor_writeback_preview: { method: 'POST', path: () => '/api/v1/systems-of-record/writebacks/preview' },
  sor_writeback_request: { method: 'POST', path: () => '/api/v1/systems-of-record/writebacks' },
  sor_writeback_review: { method: 'POST', path: (i) => `/api/v1/systems-of-record/writebacks/${i.id}/review` },
  sor_writeback_execute: { method: 'POST', path: (i) => `/api/v1/systems-of-record/writebacks/${i.id}/execute` },
  sor_writeback_status: { method: 'GET', path: (i) => `/api/v1/systems-of-record/writebacks/list?limit=${i.limit ?? 20}${i.system_id ? `&system_id=${i.system_id}` : ''}${i.status ? `&status=${i.status}` : ''}` },

  // Events
  event_search: { method: 'GET', path: (i) => `/api/v1/events?${i.object_id ? `object_id=${i.object_id}&` : ''}limit=${i.limit ?? 20}` },

  // Search
  search: { method: 'GET', path: (i) => `/api/v1/search?q=${encodeURIComponent((i.query as string) ?? '')}` },
  crm_search: { method: 'GET', path: (i) => `/api/v1/search?q=${encodeURIComponent((i.query as string) ?? '')}&limit=${i.limit ?? 10}` },
  entity_resolve: { method: 'POST', path: () => '/api/v1/resolve' },
  customer_record_resolve: { method: 'POST', path: () => '/api/v1/subjects/resolve' },

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
  context_list: { method: 'GET', path: (i) => `/api/v1/context?limit=${i.limit ?? 20}${i.subject_type ? `&subject_type=${i.subject_type}` : ''}${i.subject_id ? `&subject_id=${i.subject_id}` : ''}${i.context_type ? `&context_type=${i.context_type}` : ''}${i.memory_status ? `&memory_status=${i.memory_status}` : ''}${i.is_current !== undefined ? `&is_current=${i.is_current}` : ''}${i.cursor ? `&cursor=${i.cursor}` : ''}` },
  context_raw_source_list: { method: 'GET', path: (i) => `/api/v1/context/raw-sources?limit=${i.limit ?? 50}${i.source_type ? `&source_type=${i.source_type}` : ''}${i.status ? `&status=${i.status}` : ''}${i.subject_type ? `&subject_type=${i.subject_type}` : ''}${i.subject_id ? `&subject_id=${i.subject_id}` : ''}${i.cursor ? `&cursor=${i.cursor}` : ''}` },
  context_raw_source_get: { method: 'GET', path: (i) => `/api/v1/context/raw-sources/${i.id}` },
  context_signal_promote: { method: 'POST', path: (i) => `/api/v1/context/${i.id}/promote` },
  context_signal_reject: { method: 'POST', path: (i) => `/api/v1/context/${i.id}/reject` },
  context_signal_group_list: { method: 'GET', path: (i) => `/api/v1/context/signal-groups?limit=${i.limit ?? 20}${i.status ? `&status=${i.status}` : ''}${i.subject_type ? `&subject_type=${i.subject_type}` : ''}${i.subject_id ? `&subject_id=${i.subject_id}` : ''}${i.context_type ? `&context_type=${i.context_type}` : ''}${i.attention_only ? '&attention_only=true' : ''}${i.cursor ? `&cursor=${i.cursor}` : ''}` },
  context_signal_group_get: { method: 'GET', path: (i) => `/api/v1/context/signal-groups/${i.id}` },
  context_signal_group_promote: { method: 'POST', path: (i) => `/api/v1/context/signal-groups/${i.id}/promote` },
  context_signal_group_reject: { method: 'POST', path: (i) => `/api/v1/context/signal-groups/${i.id}/reject` },
  context_signal_handoff: { method: 'POST', path: (i) => `/api/v1/context/signal-groups/${i.id}/handoff` },
  context_supersede: { method: 'POST', path: (i) => `/api/v1/context/${i.id}/supersede` },
  context_search: { method: 'GET', path: (i) => `/api/v1/context/search?q=${encodeURIComponent(i.query as string)}&limit=${i.limit ?? 20}${i.subject_type ? `&subject_type=${i.subject_type}` : ''}${i.subject_id ? `&subject_id=${i.subject_id}` : ''}${i.context_type ? `&context_type=${i.context_type}` : ''}${i.tag ? `&tag=${i.tag}` : ''}${i.current_only === false ? '&current_only=false' : ''}` },
  context_review: { method: 'POST', path: (i) => `/api/v1/context/${i.id}/review` },
  context_stale: { method: 'GET', path: (i) => `/api/v1/context/stale?limit=${i.limit ?? 20}${i.subject_type ? `&subject_type=${i.subject_type}` : ''}${i.subject_id ? `&subject_id=${i.subject_id}` : ''}` },
  context_ingest: { method: 'POST', path: () => '/api/v1/context/ingest' },
  context_ingest_auto: { method: 'POST', path: () => '/api/v1/context/ingest-auto' },
  context_lineage_get: { method: 'GET', path: (i) => `/api/v1/context/lineage?${new URLSearchParams(Object.entries({
    subject_type: i.subject_type,
    subject_id: i.subject_id,
    context_entry_id: i.context_entry_id,
    signal_group_id: i.signal_group_id,
    raw_context_source_id: i.raw_context_source_id,
  }).filter(([, value]) => Boolean(value)) as [string, string][]).toString()}` },
  context_semantic_search: { method: 'GET', path: (i) => `/api/v1/context/semantic-search?q=${encodeURIComponent((i.query as string) ?? '')}&limit=${i.limit ?? 10}${i.subject_type ? `&subject_type=${i.subject_type}` : ''}${i.subject_id ? `&subject_id=${i.subject_id}` : ''}` },
  context_raw_source_reprocess: { method: 'POST', path: (i) => `/api/v1/context/raw-sources/${i.id}/reprocess` },

  // Calendar / Customer Activity
  calendar_connection_list: { method: 'GET', path: () => '/api/v1/calendar/connections' },
  calendar_event_search: { method: 'GET', path: (i) => `/api/v1/calendar-events?limit=${i.limit ?? 20}${i.q ? `&q=${encodeURIComponent(i.q as string)}` : ''}${i.tab ? `&tab=${i.tab}` : ''}${i.classification ? `&classification=${i.classification}` : ''}${i.validation_status ? `&validation_status=${i.validation_status}` : ''}${i.processing_status ? `&processing_status=${i.processing_status}` : ''}${i.include_internal ? '&include_internal=true' : ''}${i.cursor ? `&cursor=${i.cursor}` : ''}` },
  calendar_event_get: { method: 'GET', path: (i) => `/api/v1/calendar-events/${i.id}` },
  calendar_event_process: { method: 'POST', path: (i) => `/api/v1/calendar-events/${i.id}/process` },
  calendar_event_add_context: { method: 'POST', path: (i) => `/api/v1/calendar-events/${i.id}/artifacts` },
  meeting_classification_list: { method: 'GET', path: (i) => `/api/v1/meeting-classifications${i.include_disabled ? '?include_disabled=true' : ''}` },

  // Record Drafts
  record_draft_preview: { method: 'POST', path: () => '/api/v1/agent/extract/record' },

  // Sequences
  sequence_list: { method: 'GET', path: (i) => `/api/v1/sequences?limit=${i.limit ?? 20}${i.is_active !== undefined ? `&is_active=${i.is_active}` : ''}${i.tags ? `&tags=${(i.tags as string[]).join(',')}` : ''}${i.cursor ? `&cursor=${i.cursor}` : ''}` },
  sequence_get: { method: 'GET', path: (i) => `/api/v1/sequences/${i.id}` },
  sequence_update: { method: 'PATCH', path: (i) => `/api/v1/sequences/${i.id}`, bodyTransform: (i) => (i.patch as Record<string, unknown>) ?? i },
  sequence_enrollment_list: { method: 'GET', path: (i) => `/api/v1/sequences/enrollments?limit=${i.limit ?? 50}${i.sequence_id ? `&sequence_id=${i.sequence_id}` : ''}${i.contact_id ? `&contact_id=${i.contact_id}` : ''}${i.status ? `&status=${i.status}` : ''}${i.cursor ? `&cursor=${i.cursor}` : ''}` },
  sequence_enroll: { method: 'POST', path: (i) => i.sequence_id ? `/api/v1/sequences/${i.sequence_id}/enroll` : '/api/v1/sequences/enroll' },
  sequence_unenroll: { method: 'POST', path: (i) => `/api/v1/sequences/${i.sequence_id ?? i.id}/unenroll` },
  sequence_pause: { method: 'PATCH', path: (i) => `/api/v1/sequences/${i.id}`, bodyTransform: () => ({ is_active: false }) },
  sequence_resume: { method: 'PATCH', path: (i) => `/api/v1/sequences/${i.id}`, bodyTransform: () => ({ is_active: true }) },
  sequence_analytics: { method: 'GET', path: (i) => `/api/v1/sequences/${i.sequence_id ?? i.id}/analytics?period_type=${i.period_type ?? 'day'}&limit=${i.limit ?? 30}` },

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
      if (!mapping) return callGenericTool(serverUrl, token, toolName, input);

      const { method, path } = mapping;
      const url = `${serverUrl.replace(/\/$/, '')}${path(input)}`;

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const fetchOpts: RequestInit = { method, headers };
      if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
        // Strip path params from body
        const body = mapping.bodyTransform ? mapping.bodyTransform(input) : { ...input };
        delete body.id;
        delete body.sequence_id;
        delete body.request_id;
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
    async listTools() {
      const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/tools`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const responseBody = await res.text();
      if (!res.ok) {
        let detail = responseBody;
        try {
          detail = JSON.parse(responseBody).detail ?? responseBody;
        } catch {}
        throw new Error(`API error (${res.status}): ${detail}`);
      }
      const parsed = JSON.parse(responseBody) as { data?: Array<{ name: string; tier?: string; description?: string }> };
      return parsed.data ?? [];
    },
    async describeTool(toolName: string) {
      if (!/^[a-z0-9_]+$/.test(toolName)) {
        throw new Error(`Invalid tool name: ${toolName}`);
      }
      const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/tools/${toolName}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const responseBody = await res.text();
      if (!res.ok) {
        let detail = responseBody;
        try {
          detail = JSON.parse(responseBody).detail ?? responseBody;
        } catch {}
        throw new Error(`API error (${res.status}): ${detail}`);
      }
      return JSON.parse(responseBody) as {
        name: string;
        tier?: string;
        description?: string;
        input_schema?: Record<string, unknown>;
        required?: string[];
        example?: Record<string, unknown>;
      };
    },
  };
}

async function callGenericTool(
  serverUrl: string,
  token: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  if (!/^[a-z0-9_]+$/.test(toolName)) {
    throw new Error(`Invalid tool name: ${toolName}`);
  }
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/tools/${toolName}/call`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input ?? {}),
  });
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
}

/**
 * Create a direct database client using MCP tools.
 */
async function createDbClient(
  databaseUrl: string,
  apiKey?: string,
  tenantSlugOrId?: string,
): Promise<CliClient> {
  process.env.CRMY_IMPORTED = '1';

  const { initPool, closePool, describeTool, getToolsForActor, normalizeToolInput } = await import('@crmy/server');
  const db = await initPool(databaseUrl);

  let actor: ActorContext | null = null;

  if (apiKey) {
    const crypto = await import('node:crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const result = await db.query(
      `SELECT ak.tenant_id, ak.user_id, ak.scopes,
              a.id as resolved_actor_id, a.actor_type as resolved_actor_type,
              a.role as actor_role, a.scopes as actor_scopes, a.is_active as actor_is_active,
              u.role as user_role
       FROM api_keys ak
       LEFT JOIN users u ON ak.user_id = u.id
       LEFT JOIN actors a ON ak.actor_id = a.id
       WHERE ak.key_hash = $1`,
      [keyHash],
    );
    if (result.rows.length > 0) {
      const row = result.rows[0];
      if (row.resolved_actor_id && row.actor_is_active === false) {
        throw new Error('Actor is deactivated.');
      }
      const keyScopes = Array.isArray(row.scopes) ? row.scopes : [];
      const actorScopes = Array.isArray(row.actor_scopes) ? row.actor_scopes : null;
      actor = {
        tenant_id: row.tenant_id,
        actor_id: row.resolved_actor_id ?? row.user_id ?? 'cli-user',
        actor_type: row.resolved_actor_type === 'human' ? 'user' : row.user_id ? 'user' : 'agent',
        role: row.actor_role ?? row.user_role ?? 'member',
        scopes: actorScopes ? keyScopes.filter((scope: string) => actorScopes.includes(scope)) : keyScopes,
      };
    } else {
      throw new Error('Invalid CRMY_API_KEY.');
    }
  } else {
    actor = await resolveLocalActor(db, tenantSlugOrId);
  }

  if (!actor?.tenant_id || !actor.actor_id) {
    throw new Error('Could not resolve a local CRMy actor. Run `crmy init` or set a valid CRMY_API_KEY.');
  }
  const tools = getToolsForActor(db, actor);

  return {
    async call(toolName: string, input: Record<string, unknown>): Promise<string> {
      const tool = tools.find(t => t.name === toolName);
      if (!tool) throw new Error(`Unknown tool: ${toolName}`);
      const result = await tool.handler(normalizeToolInput(input), actor);
      return JSON.stringify(result, null, 2);
    },
    async listTools() {
      return tools.map(tool => ({
        name: tool.name,
        tier: tool.tier,
        description: tool.description,
      }));
    },
    async describeTool(toolName: string) {
      const tool = tools.find(t => t.name === toolName);
      if (!tool) throw new Error(`Unknown tool: ${toolName}`);
      return describeTool(tool);
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
export async function getClient(configPath?: string): Promise<CliClient> {
  const config = loadConfigFile(configPath);
  const databaseUrl = process.env.DATABASE_URL ?? config.database?.url;

  // Prefer direct DB connection when available
  if (databaseUrl) {
    const apiKey = process.env.CRMY_API_KEY ?? config.apiKey;
    return createDbClient(databaseUrl, apiKey, config.tenantId);
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
