// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

export type UUID = string;

export interface Tenant {
  id: UUID;
  slug: string;
  name: string;
  plan: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: UUID;
  tenant_id: UUID;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'manager' | 'member';
  manager_id?: UUID;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: UUID;
  tenant_id: UUID;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  title?: string;
  company_name?: string;
  account_name?: string;
  account_id?: UUID;
  owner_id?: UUID;
  lifecycle_stage: 'lead' | 'prospect' | 'customer' | 'churned';
  source?: string;
  aliases: string[];
  tags: string[];
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  row_version: number;
}

export interface Account {
  id: UUID;
  tenant_id: UUID;
  name: string;
  domain?: string;
  industry?: string;
  employee_count?: number;
  annual_revenue?: number;
  currency_code: string;
  website?: string;
  parent_id?: UUID;
  owner_id?: UUID;
  health_score?: number;
  aliases: string[];
  additional_domains?: string[];
  tags: string[];
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  row_version: number;
}

export interface Opportunity {
  id: UUID;
  tenant_id: UUID;
  name: string;
  account_id?: UUID;
  contact_id?: UUID;
  owner_id?: UUID;
  stage: 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
  amount?: number;
  currency_code: string;
  close_date?: string;
  probability?: number;
  forecast_cat: 'pipeline' | 'best_case' | 'commit' | 'closed';
  description?: string;
  lost_reason?: string;
  account_name?: string;
  contact_name?: string;
  contact_email?: string;
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  row_version: number;
}

export interface Activity {
  id: UUID;
  tenant_id: UUID;
  type: 'call' | 'email' | 'meeting' | 'note' | 'task' | 'demo' | 'proposal' | 'research' | 'handoff' | 'status_update'
      | 'outreach_email' | 'outreach_call' | 'outreach_linkedin' | 'outreach_other'
      | 'meeting_held' | 'meeting_scheduled' | 'note_added' | 'research_completed'
      | 'stage_change';
  subject: string;
  body?: string;
  status: string;
  direction?: string;
  due_at?: string;
  completed_at?: string;
  contact_id?: UUID;
  account_id?: UUID;
  opportunity_id?: UUID;
  owner_id?: UUID;
  source_agent?: string;
  use_case_id?: UUID;
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
  // Context Engine fields (v0.4)
  performed_by?: UUID;
  subject_type?: 'contact' | 'account' | 'opportunity' | 'use_case';
  subject_id?: UUID;
  related_type?: 'contact' | 'account' | 'opportunity' | 'use_case';
  related_id?: UUID;
  detail?: Record<string, unknown>;
  occurred_at?: string;
  outcome?: string;
}

export interface HITLRequest {
  id: UUID;
  tenant_id: UUID;
  agent_id: string;
  session_id?: string;
  action_type: string;
  action_summary: string;
  action_payload: unknown;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved';
  reviewer_id?: UUID;
  review_note?: string;
  auto_approve_after?: string;
  expires_at: string;
  created_at: string;
  resolved_at?: string;
  /** Priority level — affects notification urgency and SLA. */
  priority: 'low' | 'normal' | 'high' | 'urgent';
  /** Minutes before SLA breach triggers escalation. Default 1440 (24h). */
  sla_minutes: number;
  /** Actor to escalate to if SLA breaches. If null, escalates to most senior human. */
  escalate_to_id?: UUID;
  /** When the submission notification was sent to the channel. */
  notified_at?: string;
  /** When SLA escalation assignment was created. */
  escalated_at?: string;
  /** Agent handoff snapshot captured before this request was created. */
  handoff_snapshot_id?: UUID;
}

export interface CrmyEvent {
  id: number;
  tenant_id: UUID;
  event_type: string;
  actor_id?: string;
  actor_type: 'user' | 'agent' | 'system';
  object_type: string;
  object_id?: UUID;
  before_data?: unknown;
  after_data?: unknown;
  metadata: Record<string, unknown>;
  created_at: string;
  /** Resolved from actors join — display name of the actor */
  actor_display_name?: string;
  /** Resolved from actors join — model string for agent actors (e.g. "claude-sonnet-4-20250514") */
  actor_agent_model?: string;
  /** Resolved from actors join — stable agent identifier (e.g. "outreach-v1") */
  actor_agent_identifier?: string;
}

export interface ApiKey {
  id: UUID;
  tenant_id: UUID;
  user_id?: UUID;
  actor_id?: UUID;
  label: string;
  scopes: string[];
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  next_cursor?: string;
  total: number;
  total_is_estimate?: boolean;
}

export interface ActorContext {
  tenant_id: UUID;
  actor_id: string;
  actor_type: 'user' | 'agent' | 'system';
  role: 'owner' | 'admin' | 'manager' | 'member';
  scopes?: string[];
}

export interface OperationResult<T> {
  data: T;
  event_id: number;
}

// -- Systems-of-record overlay --

export type SystemOfRecordType = 'hubspot' | 'salesforce' | 'databricks' | 'snowflake';
export type ExternalOrigin = 'crmy' | 'crm_sync' | 'warehouse_sync' | 'agent' | 'workflow' | 'sequence';
export type WritebackMode = 'append_event' | 'mapped_upsert' | 'stored_procedure';
export type SourceAuthority = 'crmy' | 'external' | 'bidirectional' | 'read_only' | 'approval_required';

export interface ExternalEventMetadata {
  origin: ExternalOrigin;
  system_id?: UUID;
  system_type?: SystemOfRecordType;
  external_record_id?: string;
  sync_run_id?: UUID;
  changed_fields?: string[];
  confidence?: number;
  conflict_state?: 'none' | 'open' | 'resolved' | 'unknown';
}

export interface ExternalSystem {
  id: UUID;
  tenant_id: UUID;
  name: string;
  system_type: SystemOfRecordType;
  auth_type: string;
  status: 'disconnected' | 'connected' | 'error' | 'paused';
  config: Record<string, unknown>;
  sync_settings: Record<string, unknown>;
  health: Record<string, unknown>;
  has_credentials?: boolean;
  last_sync_at?: string;
  last_error?: string;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface ExternalObjectMapping {
  id: UUID;
  tenant_id: UUID;
  system_id: UUID;
  object_type: 'contact' | 'account' | 'opportunity' | 'activity' | 'use_case' | 'context_entry';
  external_object: string;
  external_id_field: string;
  watermark_field?: string;
  field_mapping: Record<string, string>;
  readable_fields: string[];
  writable_fields: string[];
  source_authority: SourceAuthority;
  writeback_mode?: WritebackMode;
  writeback_config: Record<string, unknown>;
  allow_source_loop: boolean;
  is_active: boolean;
  sync_cursor?: string;
  sync_watermark?: string;
  last_sync_at?: string;
  last_sync_run_id?: UUID;
  created_at: string;
  updated_at: string;
}

export interface ExternalSyncRun {
  id: UUID;
  tenant_id: UUID;
  system_id: UUID;
  mapping_id?: UUID;
  mode: 'test' | 'full' | 'incremental' | 'replay' | 'writeback';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  cursor_value?: string;
  watermark_value?: string;
  records_seen: number;
  records_created: number;
  records_updated: number;
  records_skipped: number;
  conflicts_created: number;
  error?: string;
  replay_of_run_id?: UUID;
  metadata: Record<string, unknown>;
  started_at: string;
  completed_at?: string;
}

export interface ExternalSyncConflict {
  id: UUID;
  tenant_id: UUID;
  system_id: UUID;
  mapping_id?: UUID;
  sync_run_id?: UUID;
  object_type: string;
  object_id?: UUID;
  external_object: string;
  external_record_id: string;
  field_name: string;
  local_value?: unknown;
  external_value?: unknown;
  status: 'open' | 'resolved_local' | 'resolved_external' | 'ignored';
  resolution_note?: string;
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
}

export interface ExternalWritebackRequest {
  id: UUID;
  tenant_id: UUID;
  system_id: UUID;
  mapping_id?: UUID;
  object_type: string;
  object_id?: UUID;
  external_object: string;
  external_record_id?: string;
  operation: 'create' | 'update' | 'upsert' | 'append_event' | 'stored_procedure';
  writeback_mode: WritebackMode;
  preview: Record<string, unknown>;
  payload: Record<string, unknown>;
  policy_result: Record<string, unknown>;
  status: 'pending' | 'approval_required' | 'approved' | 'executing' | 'completed' | 'failed' | 'rejected' | 'cancelled';
  hitl_request_id?: UUID;
  idempotency_key?: string;
  execution_result: Record<string, unknown>;
  requested_by?: string;
  executed_at?: string;
  created_at: string;
  updated_at: string;
}

// -- v0.2 types --

export type UseCaseStage =
  | 'discovery'
  | 'poc'
  | 'production'
  | 'scaling'
  | 'sunset';

export interface UseCase {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description?: string;
  account_id: UUID;
  opportunity_id?: UUID;
  owner_id?: UUID;
  stage: UseCaseStage;
  unit_label?: string;
  consumption_current?: number;
  consumption_capacity?: number;
  consumption_unit?: string;
  attributed_arr?: number;
  currency_code: string;
  expansion_potential?: number;
  health_score?: number;
  health_note?: string;
  account_name?: string;
  opportunity_name?: string;
  started_at?: string;
  target_prod_date?: string;
  sunset_date?: string;
  tags: string[];
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  row_version: number;
}

export interface UseCaseContact {
  use_case_id: UUID;
  contact_id: UUID;
  role?: string;
  added_at: string;
}

export interface WebhookEndpoint {
  id: UUID;
  tenant_id: UUID;
  url: string;
  secret?: string;
  has_secret?: boolean;
  secret_masked?: string | null;
  events: string[];
  active: boolean;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: UUID;
  endpoint_id: UUID;
  event_id: number;
  event_type: string;
  payload: unknown;
  status: 'pending' | 'success' | 'failed';
  http_status?: number;
  attempt: number;
  max_attempts: number;
  next_retry_at?: string;
  response_body?: string;
  created_at: string;
  completed_at?: string;
}

export interface EmailProvider {
  id: UUID;
  tenant_id: UUID;
  name: string;
  provider_type: 'smtp' | 'sendgrid' | 'ses';
  config: Record<string, unknown>;
  from_address: string;
  from_name?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Email {
  id: UUID;
  tenant_id: UUID;
  provider_id?: UUID;
  contact_id?: UUID;
  account_id?: UUID;
  opportunity_id?: UUID;
  use_case_id?: UUID;
	  subject: string;
	  body_html?: string;
	  body_text?: string;
	  from_address: string;
	  from_email?: string | null;
	  from_name?: string | null;
	  sender_type?: 'actor_mailbox' | 'tenant_provider' | 'unknown';
	  mailbox_connection_id?: UUID | null;
	  to_address: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'queued_for_delivery' | 'sending' | 'sent' | 'failed' | 'rejected' | 'delivery_uncertain';
  hitl_request_id?: UUID;
  sent_at?: string;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface EmailSequence {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description?: string;
  steps: EmailSequenceStep[];
  active: boolean;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface EmailSequenceStep {
  delay_days: number;
  subject: string;
  body_html?: string;
  body_text?: string;
}

export interface SequenceEnrollment {
  id: UUID;
  sequence_id: UUID;
  contact_id: UUID;
  current_step: number;
  status: 'active' | 'completed' | 'paused' | 'cancelled';
  next_send_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CustomFieldDefinition {
  id: UUID;
  tenant_id: UUID;
  object_type: 'contact' | 'account' | 'opportunity' | 'activity' | 'use_case';
  field_name: string;
  field_type: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multi_select';
  label: string;
  description?: string;
  required: boolean;
  options?: string[];
  default_value?: unknown;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BulkJob {
  id: UUID;
  tenant_id: UUID;
  operation: 'import' | 'export' | 'update' | 'delete';
  object_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total_rows: number;
  processed_rows: number;
  error_rows: number;
  errors?: Record<string, unknown>[];
  file_url?: string;
  created_by?: UUID;
  created_at: string;
  completed_at?: string;
}

// -- v0.3 types --

export interface Note {
  id: UUID;
  tenant_id: UUID;
  object_type: string;
  object_id: UUID;
  parent_id?: UUID;
  body: string;
  visibility: 'internal' | 'external';
  mentions: string[];
  pinned: boolean;
  author_id?: UUID;
  author_type: 'user' | 'agent' | 'system';
  created_at: string;
  updated_at: string;
}

export type WorkflowActionType =
  | 'send_notification'
  | 'send_email'
  | 'update_field'
  | 'create_activity'
  | 'add_tag'
  | 'remove_tag'
  | 'assign_owner'
  | 'create_context_entry'
  | 'enroll_in_sequence'
  | 'hitl_checkpoint'
  | 'request_external_writeback'
  | 'run_system_sync'
  | 'create_sync_conflict_review'
  | 'create_context_from_external_change'
  | 'webhook'
  | 'wait';

export interface WorkflowAction {
  type: WorkflowActionType;
  config: Record<string, unknown>;
}

export interface WorkflowFilterCondition {
  op: 'eq' | 'neq' | 'contains' | 'starts_with' | 'gt' | 'lt' | 'exists' | 'not_exists';
  value?: unknown;
}

export interface ActionLog {
  index: number;
  type: string;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
  duration_ms: number;
  started_at: string;
  resolved_config?: Record<string, unknown>;
}

export interface Workflow {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description?: string;
  trigger_event: string;
  trigger_filter: Record<string, unknown>;
  actions: WorkflowAction[];
  is_active: boolean;
  run_count: number;
  last_run_at?: string;
  max_runs_per_hour?: number;
  error_count: number;
  last_error_at?: string;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: UUID;
  workflow_id: UUID;
  event_id?: number;
  status: 'running' | 'completed' | 'failed';
  actions_run: number;
  actions_total: number;
  error?: string;
  duration_ms?: number;
  action_logs: ActionLog[];
  started_at: string;
  completed_at?: string;
}

// -- v0.4 Context Engine types --

export type SubjectType = 'contact' | 'account' | 'opportunity' | 'use_case';

export interface Actor {
  id: UUID;
  tenant_id: UUID;
  actor_type: 'human' | 'agent';
  display_name: string;
  email?: string;
  phone?: string;
  user_id?: UUID;
  role?: string;
  agent_identifier?: string;
  agent_model?: string;
  scopes: string[];
  metadata: Record<string, unknown>;
  is_active: boolean;
  availability_status?: 'available' | 'busy' | 'offline';
  registration_source?: 'admin' | 'self_registered' | 'migration';
  registration_status?: 'approved' | 'pending_review' | 'rejected';
  created_at: string;
  updated_at: string;
}

export const AVAILABLE_SCOPES = [
  'read',
  'write',
  'contacts:read',
  'contacts:write',
  'accounts:read',
  'accounts:write',
  'use_cases:read',
  'use_cases:write',
  'opportunities:read',
  'opportunities:write',
  'activities:read',
  'activities:write',
  'assignments:create',
  'assignments:update',
  'assignments:read',
  'assignments:write',
  'context:read',
  'context:write',
  'hitl:read',
  'hitl:write',
  'hitl:admin',
  'systems:read',
  'systems:write',
  'systems:admin',
  'api_keys:admin',
  'email_provider:admin',
  'workflows:read',
  'workflows:write',
  'webhooks:read',
  'webhooks:write',
  'messaging:read',
  'messaging:write',
  'ops:read',
  'ops:write',
  'privacy:read',
  'privacy:write',
] as const;

export type Scope = typeof AVAILABLE_SCOPES[number];

export interface ContactChannel {
  channel_type: 'email' | 'phone' | 'slack' | 'teams' | 'discord' | 'whatsapp' | string;
  handle: string;
  verified?: boolean;
  primary?: boolean;
}

export type AssignmentStatus =
  | 'pending'
  | 'accepted'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'declined'
  | 'cancelled';

export type AssignmentPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Assignment {
  id: UUID;
  tenant_id: UUID;
  title: string;
  description?: string;
  assignment_type: string;
  assigned_by: UUID;
  assigned_to: UUID;
  subject_type: SubjectType;
  subject_id: UUID;
  status: AssignmentStatus;
  priority: AssignmentPriority;
  due_at?: string;
  accepted_at?: string;
  completed_at?: string;
  completed_by_activity_id?: UUID;
  context?: string;
  metadata: Record<string, unknown>;
  /** Agent handoff snapshot captured before this assignment was created. */
  handoff_snapshot_id?: UUID;
  created_at: string;
  updated_at: string;
}

export interface ContextEntry {
  id: UUID;
  tenant_id: UUID;
  subject_type: SubjectType;
  subject_id: UUID;
  context_type: string;
  authored_by: UUID;
  title?: string;
  body: string;
  structured_data: Record<string, unknown>;
  tags: string[];
  confidence?: number;
  /** signal = inferred/unconfirmed; active = confirmed memory. */
  memory_status?: 'signal' | 'active' | 'rejected' | 'superseded';
  evidence?: ContextEvidence[];
  is_current: boolean;
  supersedes_id?: UUID;
  source?: string;
  source_ref?: string;
  source_activity_id?: UUID;
  grounding_method?: 'lexical' | 'corroborated' | 'human_reviewed';
  valid_until?: string;
  reviewed_at?: string;
  promoted_at?: string;
  promoted_by?: UUID;
  rejected_at?: string;
  rejected_by?: UUID;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface SignalGroupMember {
  id: UUID;
  tenant_id: UUID;
  signal_group_id: UUID;
  context_entry_id: UUID;
  relation: 'supports' | 'conflicts' | 'supersedes';
  similarity_score: number;
  evidence_weight: number;
  source_key?: string;
  created_at: string;
  context_entry?: ContextEntry;
}

export type SignalReadinessStatus =
  | 'ready_to_confirm'
  | 'needs_more_evidence'
  | 'needs_more_detail'
  | 'blocked_by_conflict'
  | 'approval_required'
  | 'confirmed'
  | 'dismissed';

export type SignalReadinessNextAction =
  | 'confirm_signal'
  | 'add_evidence'
  | 'add_detail'
  | 'resolve_conflict'
  | 'send_to_handoff'
  | 'dismiss_signal';

export interface SignalReadiness {
  version: 'crmy.signal_readiness.v1';
  status: SignalReadinessStatus;
  can_confirm: boolean;
  can_auto_confirm: boolean;
  score: number;
  threshold: number;
  reasons: string[];
  blockers: string[];
  next_actions: SignalReadinessNextAction[];
  components: {
    model_confidence: number;
    source_quality: number;
    independent_source_count: number;
    duplicate_source_count: number;
    evidence_count: number;
    conflict_count: number;
    typed_completeness: number | null;
    source_boost: number;
    conflict_penalty: number;
  };
}

export type SignalResolutionTargetType =
  | 'mentioned_person'
  | 'mentioned_entity'
  | 'subject_record'
  | 'signal_detail'
  | 'evidence'
  | 'conflict'
  | 'approval';

export type SignalResolutionPrimaryAction =
  | 'add_signal_detail'
  | 'add_evidence'
  | 'resolve_conflict'
  | 'request_approval'
  | 'confirm_signal'
  | 'view_only';

export interface SignalResolution {
  target_type: SignalResolutionTargetType;
  target_label: string;
  subject_label: string;
  subject_type: SubjectType;
  subject_id: UUID;
  primary_missing_field?: string;
  primary_action: SignalResolutionPrimaryAction;
  helper_text: string;
}

export interface SignalGroup {
  id: UUID;
  tenant_id: UUID;
  subject_type: SubjectType;
  subject_id: UUID;
  context_type: string;
  claim_key: string;
  title?: string | null;
  normalized_claim: string;
  status: 'gathering' | 'ready' | 'promoted' | 'blocked' | 'dismissed' | 'conflicting' | 'merged';
  aggregate_confidence: number;
  support_count: number;
  independent_source_count: number;
  conflict_count: number;
  evidence_count: number;
  latest_signal_id?: UUID | null;
  promoted_context_entry_id?: UUID | null;
  blocked_reason?: string | null;
  metadata: Record<string, unknown>;
  subject_name?: string | null;
  dismissed_at?: string | null;
  dismissed_by?: UUID | null;
  merged_into_signal_group_id?: UUID | null;
  merged_at?: string | null;
  readiness?: SignalReadiness;
  resolution?: SignalResolution;
  created_at: string;
  updated_at: string;
  members?: SignalGroupMember[];
}

export type EmbeddingJobStatus = 'pending' | 'processing' | 'complete' | 'failed';

export type ContextLineageNodeType =
  | 'record'
  | 'raw_context'
  | 'activity'
  | 'signal'
  | 'signal_group'
  | 'memory'
  | 'retrieval'
  | 'handoff'
  | 'writeback'
  | 'audit';

export interface ContextLineageNode {
  id: string;
  type: ContextLineageNodeType;
  label: string;
  timestamp?: string | null;
  status?: string | null;
  subject_type?: SubjectType | null;
  subject_id?: UUID | null;
  object_id?: UUID | string | null;
  stage?: string | null;
  display_order?: number | null;
  description?: string | null;
  data?: Record<string, unknown>;
}

export interface ContextLineageEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  data?: Record<string, unknown>;
}

export interface ContextLineageOutcome {
  kind: 'handoff' | 'writeback' | 'activity' | 'action_receipt' | 'audit';
  label: string;
  status: string;
  occurred_at?: string;
  object_id?: string;
  node_id: string;
  impact: 'completed' | 'pending' | 'failed' | 'informational';
  follow_up?: string;
}

export interface ContextLineage {
  nodes: ContextLineageNode[];
  edges: ContextLineageEdge[];
  outcomes?: {
    recent: ContextLineageOutcome[];
    pending: ContextLineageOutcome[];
    failed: ContextLineageOutcome[];
    completed_count: number;
    pending_count: number;
    failed_count: number;
    recommended_follow_up: string[];
  };
  summary: {
    records: number;
    raw_context: number;
    signals: number;
    signal_groups: number;
    memory: number;
    retrievals?: number;
    action_receipts?: number;
    handoffs: number;
    writebacks: number;
    audit_events: number;
  };
}

export interface ContextEvidence {
  source_type: string;
  source_id?: string;
  source_ref?: string;
  source_url?: string;
  source_label?: string;
  speaker?: string;
  snippet?: string;
  observed_at?: string;
  captured_at?: string;
  confidence?: number;
  rationale?: string;
  verified_at?: string;
  verified_by?: UUID;
  [key: string]: unknown;
}

export interface RawContextSource {
  id: UUID;
  tenant_id: UUID;
  source_type: string;
  source_ref: string;
  source_label?: string;
  subject_type?: SubjectType;
  subject_id?: UUID;
  actor_id?: UUID;
  status: 'pending' | 'processing' | 'processed' | 'needs_review' | 'failed' | 'skipped';
  stage: string;
  raw_excerpt?: string;
  detected_subjects: Array<Record<string, unknown>>;
  signals_created: number;
  memory_created: number;
  skipped: number;
  failure_reason?: string;
  metadata: Record<string, unknown>;
  processed_at?: string;
  created_at: string;
  updated_at: string;
}

// -- v0.4/v0.5 Registry types --

export interface ActivityTypeRegistryEntry {
  type_name: string;
  tenant_id: UUID;
  label: string;
  description?: string;
  category: 'outreach' | 'meeting' | 'proposal' | 'contract' | 'internal' | 'lifecycle' | 'handoff';
  is_default: boolean;
  created_at: string;
}

export interface ContextTypeRegistryEntry {
  type_name: string;
  tenant_id: UUID;
  label: string;
  description?: string;
  is_default: boolean;
  /** Multiplier applied to effective_confidence when ranking entries in briefings. */
  priority_weight: number;
  /** Half-life in days for confidence decay. null = no decay. */
  confidence_half_life_days: number | null;
  /** Default review window in days for undated Current Memory of this type. */
  default_freshness_days: number;
  /** Promotion risk tier: 0 = informational, 1 = operational, 2 = high-impact. */
  claim_tier: 0 | 1 | 2;
  /** Whether this type is checked for contradictions with other entries of the same type. */
  is_contradiction_eligible?: boolean;
  created_at: string;
}

/**
 * A pair of context entries that appear to claim conflicting facts about
 * the same subject. Surfaced in briefings and via context_detect_contradictions.
 */
export interface ContradictionWarning {
  entry_a: ContextEntry;
  entry_b: ContextEntry;
  /** Which field or topic is in conflict (e.g. "budget", "champion", "next_step"). */
  conflict_field: string;
  /** Human-readable explanation of the contradiction. */
  conflict_evidence: string;
  /** Recommended resolution action. */
  suggested_action: 'supersede_older' | 'supersede_lower_confidence' | 'manual_review';
  detected_at: string;
}

// -- Governor limits --

export interface GovernorLimit {
  tenant_id: UUID;
  limit_name: string;
  limit_value: number;
}

export const GOVERNOR_DEFAULTS: Record<string, Record<string, number>> = {
  solo_agent: {
    actors_max: 3,
    activities_per_day: 500,
    assignments_active: 50,
    context_entries_max: 1000,
    context_body_max_chars: 10000,
  },
  pro_agent: {
    actors_max: 15,
    activities_per_day: 5000,
    assignments_active: 500,
    context_entries_max: 10000,
    context_body_max_chars: 50000,
  },
  team: {
    actors_max: 50,
    activities_per_day: 25000,
    assignments_active: 2500,
    context_entries_max: 50000,
    context_body_max_chars: 50000,
  },
};

// -- Briefing types --

/**
 * Catch-up diff for a CRM subject — what changed since a given timestamp.
 * Used by the context_diff tool to give agents a quick "what's new" summary
 * without re-reading all context entries.
 */
export interface ContextDiff {
  subject_type: SubjectType;
  subject_id: UUID;
  since: string;
  /** Context entries created for the first time in this window. */
  new_entries: ContextEntry[];
  /** Entries that were replaced (superseded) in this window. The old entry is returned. */
  superseded_entries: ContextEntry[];
  /** Entries whose valid_until fell within this window (freshly stale). */
  newly_stale: ContextEntry[];
  /** Entries that were explicitly reviewed/confirmed in this window. */
  resolved_entries: ContextEntry[];
}

/**
 * Result row for actor expertise queries.
 */
export interface ActorExpertiseSubject {
  subject_type: SubjectType;
  subject_id: UUID;
  entry_count: number;
  last_authored_at: string;
  context_types: string[];
}

export interface ActorExpertiseResult {
  actor_id: UUID;
  total_entries: number;
  subjects: ActorExpertiseSubject[];
  top_context_types: Array<{ context_type: string; count: number }>;
}

export interface SubjectExpertResult {
  subject_type: SubjectType;
  subject_id: UUID;
  experts: Array<{
    actor_id: UUID;
    entry_count: number;
    last_authored_at: string;
  }>;
}

export interface AdjacentContext {
  subject_type: SubjectType;
  subject_id: UUID;
  context_entries: Record<string, ContextEntry[]>;
}

export interface ActiveSequenceEnrollment {
  enrollment_id: UUID;
  sequence_id: UUID;
  sequence_name: string;
  current_step: number;
  total_steps: number;
  status: 'active' | 'paused';
  next_send_at?: string;
  objective?: string;
  goal_event?: string;
  enrolled_by_actor_id?: UUID;
}

export type TokenBudgetProfile = 'tiny' | 'standard' | 'deep' | 'evidence_heavy';
export type EvidenceMode = 'summary' | 'full' | 'none';

export interface ContextPackingMetadata {
  token_budget_profile?: TokenBudgetProfile;
  token_budget?: number;
  evidence_mode: EvidenceMode;
  ranking_strategy: string;
}

export interface Briefing {
  subject: Record<string, unknown>;
  subject_type: SubjectType;
  related_objects: Record<string, unknown[]>;
  activities: Activity[];
  open_assignments: Assignment[];
  context_entries: Record<string, ContextEntry[]>;
  /** Inferred, unconfirmed signals. Agents may cite these as uncertain, but should not act on them without promotion or approval. */
  signals?: Record<string, ContextEntry[]>;
  /** Grouped inferred claims with aggregated evidence support. */
  signal_groups?: SignalGroup[];
  staleness_warnings: ContextEntry[];
  /** Active sequence enrollments for this contact (shows agents what campaigns are running). */
  active_sequences?: ActiveSequenceEnrollment[];
  /** Pairs of current entries that appear to state conflicting facts. */
  contradiction_warnings?: ContradictionWarning[];
  /** Context from related entities (populated when context_radius !== 'direct'). */
  adjacent_context?: AdjacentContext[];
  /** Estimated token count for this briefing (populated when token_budget or token_budget_profile is set). */
  token_estimate?: number;
  /** True if context entries were truncated to fit within the effective token budget. */
  truncated?: boolean;
  /** Entries omitted because token_budget was exhausted. */
  dropped_entries?: Array<{ context_type: string; title?: string; confidence?: number }>;
  /** Explains budget preset, effective budget, evidence detail, and ranking strategy used for this briefing. */
  context_packing?: ContextPackingMetadata;
  /**
   * Optional Trusted Facts relevant to this subject. Present only
   * when Trusted Facts are configured (default) or explicitly requested.
   * A sibling to customer Memory — never mixed into it, and never blocks the briefing.
   */
  knowledge?: KnowledgeContext;
}

export type ActionContextProposedActionType =
  | 'customer_outreach'
  | 'assignment_create'
  | 'memory_promote'
  | 'record_update'
  | 'external_writeback'
  | 'sequence_step'
  | 'workflow_action'
  | 'agent_task';

export interface ActionContextProposedAction {
  action_type: ActionContextProposedActionType;
  object_type?: SubjectType | ExternalObjectMapping['object_type'];
  field_names?: string[];
  source_context_entry_ids?: UUID[];
  signal_group_ids?: UUID[];
  system_id?: UUID;
  mapping_id?: UUID;
  external_object?: string;
  payload?: Record<string, unknown>;
  approved?: boolean;
}

export interface ActionContextGetInput {
  subject_type: SubjectType;
  subject_id: UUID;
  since?: string;
  context_types?: string[];
  include_stale?: boolean;
  context_radius?: 'direct' | 'adjacent' | 'account_wide';
  token_budget?: number;
  token_budget_profile?: TokenBudgetProfile;
  evidence_mode?: EvidenceMode;
  emit_retrieval_event?: boolean;
  proposed_action?: ActionContextProposedAction;
  include_knowledge?: boolean;
}

export type ActionContextReadinessStatus = 'ready' | 'review_needed' | 'blocked';
export type ActionContextRiskLevel = 'low' | 'medium' | 'high';
export type ActionContextOperatingMode = 'inform' | 'warn' | 'require_review';

export interface ActionContextPolicySummary {
  decision: 'allowed' | 'approval_required' | 'blocked' | 'draft_only';
  reasons: string[];
  required_approval?: boolean;
  required_evidence?: boolean;
  risk_level: ActionContextRiskLevel;
  policy: string;
}

export interface ActionContextCheckStatus {
  status: ActionContextReadinessStatus;
  reasons: string[];
}

export interface ActionContextSourceAuthoritySummary {
  mapping_id: UUID;
  system_id: UUID;
  object_type: string;
  external_object: string;
  source_authority: SourceAuthority;
  writable_fields: string[];
  writeback_mode?: WritebackMode;
  is_active: boolean;
}

export interface ActionContextAllowedAction {
  action_type: ActionContextProposedActionType;
  status: 'allowed' | 'approval_required' | 'blocked';
  required_scopes: string[];
  reasons: string[];
  policy?: ActionContextPolicySummary;
}

export interface ActionContextPacketEvidence {
  source_type?: string;
  source_id?: string;
  source_ref?: string;
  source_label?: string;
  observed_at?: string;
  snippet?: string;
  confidence?: number;
}

export interface ActionContextPacketItem {
  kind:
    | 'memory'
    | 'signal'
    | 'signal_group'
    | 'stale_memory'
    | 'contradiction'
    | 'assignment'
    | 'source_authority'
    | 'policy'
    | 'permission';
  id?: UUID | string;
  context_type?: string;
  title: string;
  summary: string;
  status?: string;
  confidence?: number;
  evidence_refs?: ActionContextPacketEvidence[];
}

export interface ActionContextRecommendedAction {
  id: string;
  label: string;
  description: string;
  priority: 'primary' | 'secondary' | 'background';
  can_execute_now: boolean;
  customer_or_system_effect: boolean;
  requires_human_review: boolean;
  next_tool?: string;
  reason_refs?: string[];
  proposed_action_type?: ActionContextProposedActionType;
}

export interface ActionContextSourcePosture {
  summary: string;
  dominant_source: 'customer_authored' | 'seller_authored' | 'system_of_record' | 'internal' | 'mixed' | 'unknown';
  counts: {
    customer_authored: number;
    seller_authored: number;
    system_of_record: number;
    internal: number;
    unknown: number;
  };
  customer_authored_claims_present: boolean;
  seller_authored_context_present: boolean;
  weak_or_unknown_sources_present: boolean;
  instructions: string[];
}

export const ACTION_CONTEXT_PACKET_VERSION = 'crmy.action_context.v1' as const;

export interface ActionContextActionPacket {
  version: typeof ACTION_CONTEXT_PACKET_VERSION;
  action_type?: ActionContextProposedActionType;
  objective: string;
  status: ActionContextReadinessStatus;
  risk_level: ActionContextRiskLevel;
  operating_mode: ActionContextOperatingMode;
  can_execute: boolean;
  agent_instructions: string[];
  use_as_truth: ActionContextPacketItem[];
  use_with_caution: ActionContextPacketItem[];
  do_not_use_as_truth: ActionContextPacketItem[];
  evidence_to_cite: ActionContextPacketItem[];
  source_posture: ActionContextSourcePosture;
  recommended_actions: ActionContextRecommendedAction[];
  action_boundaries: {
    allowed: string[];
    warnings: string[];
    blocked: string[];
    required_review: string[];
  };
  human_unblock?: {
    required: boolean;
    question: string;
    reasons: string[];
    handoff_type?: 'assignment' | 'signal_review' | 'policy_approval' | 'source_conflict';
  };
  next_tools: string[];
}

export interface ActionContext {
  contract_version: typeof ACTION_CONTEXT_PACKET_VERSION;
  subject_type: SubjectType;
  subject_id: UUID;
  generated_at: string;
  operating_mode: ActionContextOperatingMode;
  guidance: {
    summary: string;
    can_execute: boolean;
    warning_reasons: string[];
    review_reasons: string[];
    recommended_next_steps: string[];
  };
  /** Compact agent-facing packet: trusted facts, caveats, action boundaries, human unblockers, and next tools. */
  action_packet: ActionContextActionPacket;
  briefing: Briefing;
  readiness: {
    status: ActionContextReadinessStatus;
    risk_level: ActionContextRiskLevel;
    reasons: string[];
    blockers: string[];
    review_required: boolean;
  };
  checks: {
    memory: ActionContextCheckStatus & {
      confirmed_count: number;
      stale_count: number;
      contradiction_count: number;
    };
    signals: ActionContextCheckStatus & {
      signal_count: number;
      signal_group_count: number;
      conflicting_count: number;
      unresolved_readiness_count?: number;
      readiness_reasons?: string[];
    };
    assignments: ActionContextCheckStatus & {
      open_count: number;
    };
    permissions: ActionContextCheckStatus & {
      actor_id: string;
      actor_type: ActorContext['actor_type'];
    };
    systems_of_record: ActionContextCheckStatus & {
      mappings: ActionContextSourceAuthoritySummary[];
      open_conflict_count: number;
      pending_writeback_count: number;
    };
    knowledge?: ActionContextCheckStatus & {
      approved_claim_count: number;
      excluded_count: number;
      ungrounded_excluded_count: number;
      internal_only_excluded_count: number;
      stale_excluded_count: number;
      conflicting_excluded_count: number;
      retrieval_receipt_id?: string;
    };
    policy?: ActionContextPolicySummary;
  };
  allowed_actions: ActionContextAllowedAction[];
  policy?: ActionContextPolicySummary;
  source_posture: ActionContextSourcePosture;
  human_unblock?: ActionContextActionPacket['human_unblock'];
  next_tools: string[];
  context_packing: ContextPackingMetadata;
  required_handoffs: Array<{
    type: 'assignment' | 'signal_review' | 'policy_approval' | 'source_conflict';
    id?: UUID | string;
    status?: string;
    title: string;
  }>;
  proof: {
    retrieval_event_id?: number;
    used_context_entry_ids: UUID[];
    used_signal_group_ids: UUID[];
    /** Trusted Fact IDs surfaced for this action. */
    used_knowledge_snippet_ids?: UUID[];
    /** Receipts proving what Trusted Facts were retrieved (Phase 3). */
    knowledge_retrieval_receipt_ids?: string[];
    expected_receipts: string[];
  };
}

export interface MessagingChannel {
  id: UUID;
  tenant_id: UUID;
  name: string;
  provider: string;
  config: Record<string, unknown>;
  is_active: boolean;
  is_default: boolean;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export type MessageDeliveryStatus = 'pending' | 'delivered' | 'retrying' | 'failed';

export interface MessageDelivery {
  id: UUID;
  tenant_id: UUID;
  channel_id: UUID;
  recipient?: string;
  subject?: string;
  body: string;
  status: MessageDeliveryStatus;
  provider_msg_id?: string;
  response_status?: number;
  response_body?: string;
  attempt_count: number;
  max_attempts: number;
  next_retry_at?: string;
  delivered_at?: string;
  error?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// -- Eval harness contracts --

export type EvalSuiteName =
  | 'raw_context_extraction'
  | 'raw_context_extraction_quality'
  | 'raw_context_custom_registry'
  | 'record_resolution'
  | 'retrieval_quality'
  | 'tool_choice'
  | 'action_context'
  | 'source_attribution'
  | 'agent_trajectory'
  | 'connector_certification';

export type EvalRunStatus = 'pass' | 'fail' | 'error' | 'skipped';
export type EvalRunProfile = 'contract' | 'live_model' | 'seeded_context' | 'agent_runtime';
export type EvalSuiteImplementationStatus = 'implemented' | 'planned';

export interface EvalThreshold {
  metric: string;
  op: '>=' | '<=' | '=';
  value: number;
}

export interface EvalModelMetadata {
  provider?: string;
  base_url?: string;
  model?: string;
  live_config_present?: boolean;
  caller?: 'env' | 'injected' | 'none';
}

/** One span in an eval execution trace (e.g. extraction, readiness, promotion). */
export interface EvalSpan {
  name: string;
  status: 'ok' | 'error' | 'skipped';
  duration_ms?: number;
  detail?: string;
  attributes?: Record<string, unknown>;
}

/** Source-to-score execution trace for a single eval case. */
export interface EvalTrace {
  run_id: string;
  suite: EvalSuiteName;
  case_id: string;
  spans: EvalSpan[];
}

export interface EvalCaseSummary {
  id: string;
  suite: EvalSuiteName;
  profile: EvalRunProfile;
  title?: string;
  status: EvalRunStatus;
  scores: Record<string, number>;
  expected?: Record<string, unknown>;
  observed?: Record<string, unknown>;
  artifacts?: string[];
  model_metadata?: EvalModelMetadata;
  trace?: EvalTrace;
  diagnostics: {
    missing_expected_items: string[];
    forbidden_items_found: string[];
    warnings: string[];
  };
}

/**
 * Stable, portable eval-case contract (`crmy.eval_case.v1`). A superset of the
 * internal corpus fixtures so cases can be authored, exported, and re-imported
 * across datasets, models, and tenants — including from production failures.
 * `redacted` cases omit raw source text and are valid only for golden-output /
 * deterministic suites (they cannot drive live-model extraction).
 */
export interface EvalCase {
  version: 'crmy.eval_case.v1';
  id: string;
  suite: EvalSuiteName;
  title?: string;
  redacted?: boolean;
  source_type?: string;
  source_occurred_at?: string;
  document?: string;
  subject_hints?: string[];
  expected_signal_types?: string[];
  expected_entries?: Array<{
    context_type: string;
    title_contains?: string;
    body_contains?: string;
    evidence_contains?: string;
    required_structured_fields?: string[];
  }>;
  forbidden_entries?: Array<Record<string, unknown>>;
  expected_unsupported_types?: string[];
  expected_behavior?: string;
  expected_readiness?: Record<string, string>;
  expected_missing_details?: Record<string, string[]>;
  expected_subject?: { type: string; id: string };
  expected_subjects?: Array<{ type: string; id: string }>;
  forbidden_subject_ids?: string[];
  expected_skipped?: Array<{ name: string; reason: string }>;
  expected_account_scope?: Array<Record<string, unknown> & { account_id: string }>;
  difficulty?: string;
  source_tags?: string[];
  must_not_auto_promote?: boolean;
  registry?: {
    disabled_types?: string[];
    overrides?: Array<{ type_name: string; json_schema?: Record<string, unknown> | null }>;
    custom_types?: Array<{ type_name: string; is_extractable?: boolean; json_schema?: Record<string, unknown> | null }>;
  };
  golden_model_output?: unknown;
  metadata?: Record<string, unknown>;
}

export interface EvalSuiteSummary {
  name: EvalSuiteName;
  title: string;
  description: string;
  deterministic: boolean;
  requires_model: boolean;
  requires_database: boolean;
  case_count: number;
  implementation_status: EvalSuiteImplementationStatus;
  proof_scope: string;
  profiles: EvalRunProfile[];
  quality_gate: boolean;
  uses_golden_model_output: boolean;
  limitations: string[];
}

export interface EvalRunSummary {
  version: 'crmy.eval_result.v1';
  run_id: string;
  profile: EvalRunProfile;
  suites: EvalSuiteSummary[];
  status: EvalRunStatus;
  thresholds: EvalThreshold[];
  model_metadata?: EvalModelMetadata;
  artifacts: string[];
  totals: {
    cases: number;
    passed: number;
    failed: number;
    errored: number;
    skipped: number;
  };
  scores: Record<string, number>;
  results: EvalCaseSummary[];
  created_at: string;
}

// -- Governed Knowledge Retrieval (optional, non-blocking) --
// Trusted Facts are a governed sibling namespace to customer Memory. Retrieval
// returns approved, grounded, cited facts with trust metadata, or a clear
// not_configured/no_results status. It never creates Memory or writes to systems
// of record. See docs/governed-product-knowledge-retrieval.md.

export type KnowledgeRetrievalStatus = 'available' | 'no_results' | 'degraded' | 'not_configured';
export type KnowledgeAudience = 'customer_facing' | 'internal';
export type KnowledgeType = 'company' | 'product' | 'competitor';
export type KnowledgeApprovalStatus = 'approved' | 'pending' | 'unapproved' | 'rejected';
export type KnowledgeVisibility = 'external' | 'internal';
export type KnowledgeSourcePriority = 'authoritative' | 'secondary' | 'informal';
export type KnowledgeSourceConnectionStatus = 'configured' | 'syncing' | 'error' | 'disabled';
export type KnowledgeSourceConnectionProvider = 'mcp';
export type KnowledgeSourceConnectionTransport = 'streamable_http';
export type KnowledgeSourceConnectionAuthType = 'none' | 'bearer_token';

export interface KnowledgeCitation {
  source_label: string;
  source_url?: string;
  source_ref?: string;
}

export interface KnowledgeClaim {
  id: string;
  knowledge_type: KnowledgeType;
  category: string;
  title: string;
  body: string;
  confidence?: number;
  /** True only when the claim text is grounded in its cited source (reuses the grounding gate). */
  grounded: boolean;
  approval_status: KnowledgeApprovalStatus;
  approved_for_external_use: boolean;
  visibility: KnowledgeVisibility;
  effective_at?: string;
  valid_until?: string;
  source_priority?: KnowledgeSourcePriority;
  citations: KnowledgeCitation[];
}

export interface KnowledgeExcludedClaim {
  id: string;
  reason: string;
}

export interface KnowledgeRetrievalReceipt {
  id: string;
  policy: string;
  retrieved_at: string;
}

export interface KnowledgeRetrievalRequest {
  query: string;
  subject_type?: SubjectType;
  subject_id?: UUID;
  audience?: KnowledgeAudience;
  proposed_action?: string;
  product_scope?: string[];
  competitor?: string;
  persona?: string;
  industry?: string;
  require_approved?: boolean;
  include_stale?: boolean;
  limit?: number;
}

export interface KnowledgeRetrievalResult {
  status: KnowledgeRetrievalStatus;
  claims: KnowledgeClaim[];
  excluded_claims: KnowledgeExcludedClaim[];
  warnings: string[];
  retrieval_receipt?: KnowledgeRetrievalReceipt;
  /** Human/agent-readable explanation, especially for not_configured / degraded states. */
  message?: string;
}

/**
 * Product knowledge packaged for a briefing or Action Context — a sibling to
 * customer Memory. Claims are pre-categorized for convenience; `avoid_claims`
 * are the excluded ones (e.g. ungrounded, internal-only, stale) so a drafting
 * agent knows what NOT to assert.
 */
export interface KnowledgeContext {
  status: KnowledgeRetrievalStatus;
  relevant_claims: KnowledgeClaim[];
  proof_points: KnowledgeClaim[];
  implementation_caveats: KnowledgeClaim[];
  competitive_context: KnowledgeClaim[];
  avoid_claims: KnowledgeExcludedClaim[];
  warnings: string[];
  citations: KnowledgeCitation[];
  retrieval_receipt_id?: string;
}

// -- Governance (Phases 6-7): freshness, claim review, and conflict detection --
// The retrieval-facing KnowledgeClaim hides internal governance fields so they
// never leak into customer-facing packets. Governance surfaces (admin review,
// freshness sweep, conflict detection) need the full envelope, below.

export type KnowledgeClaimStatus = 'active' | 'stale' | 'deprecated' | 'conflicting' | 'rejected';

/**
 * A claim envelope as surfaced to admin/governance surfaces — the full record,
 * including the governance fields (status, approval, freshness, owner) that the
 * customer-facing KnowledgeClaim intentionally omits.
 */
export interface KnowledgeClaimRecord {
  id: string;
  knowledge_type: KnowledgeType;
  category: string;
  title: string;
  body: string;
  summary?: string;
  product_scope: string[];
  competitors: string[];
  grounded: boolean;
  confidence?: number;
  source_priority: KnowledgeSourcePriority;
  source_ref?: string;
  source_url?: string;
  source_label?: string;
  source_version?: string;
  approval_status: KnowledgeApprovalStatus;
  approved_for_external_use: boolean;
  visibility: KnowledgeVisibility;
  status: KnowledgeClaimStatus;
  effective_at?: string;
  valid_until?: string;
  last_verified_at?: string;
  review_owner_id?: string;
  external_key?: string;
  updated_at: string;
}

/**
 * Outbound setup for importing Trusted Facts from a compatible
 * MCP source. This is separate from API keys used by clients to access CRMy.
 */
export interface KnowledgeSourceConnection {
  id: UUID;
  name: string;
  provider: KnowledgeSourceConnectionProvider;
  transport: KnowledgeSourceConnectionTransport;
  auth_type: KnowledgeSourceConnectionAuthType;
  status: KnowledgeSourceConnectionStatus;
  config: Record<string, unknown>;
  sync_stats: Record<string, unknown>;
  has_credentials: boolean;
  last_test_at?: string | null;
  last_sync_at?: string | null;
  last_error?: string | null;
  created_by?: UUID | null;
  created_at: string;
  updated_at: string;
}

/** An admin review decision applied to a single claim envelope. */
export type KnowledgeReviewDecision = 'approve' | 'reject' | 'deprecate' | 'mark_stale' | 'reactivate';

/**
 * Two competing Trusted Facts that may state inconsistent customer-facing guidance.
 * `suggested_action` encodes source-priority resolution: an authoritative claim
 * should win over a secondary/informal one; an approved claim over an unapproved.
 */
export interface KnowledgeConflict {
  claim_a: KnowledgeConflictParty;
  claim_b: KnowledgeConflictParty;
  category: string;
  /** What made the pair candidates: a shared competitor, product scope, or just the category. */
  basis: 'competitor' | 'product_scope' | 'category';
  shared: string[];
  suggested_action: 'prefer_authoritative' | 'prefer_approved' | 'manual_review';
  detail: string;
}

export interface KnowledgeConflictParty {
  id: string;
  title: string;
  source_priority: KnowledgeSourcePriority;
  approval_status: KnowledgeApprovalStatus;
}
