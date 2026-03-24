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
  role: 'owner' | 'admin' | 'member';
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
  tags: string[];
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
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
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: UUID;
  tenant_id: UUID;
  type: 'call' | 'email' | 'meeting' | 'note' | 'task';
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
}

export interface ActorContext {
  tenant_id: UUID;
  actor_id: string;
  actor_type: 'user' | 'agent' | 'system';
  role: 'owner' | 'admin' | 'member';
  scopes?: string[];
}

export interface OperationResult<T> {
  data: T;
  event_id: number;
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
  started_at?: string;
  target_prod_date?: string;
  sunset_date?: string;
  tags: string[];
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
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
  secret: string;
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
  to_address: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'sending' | 'sent' | 'failed' | 'rejected';
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
  | 'update_field'
  | 'create_activity'
  | 'add_tag'
  | 'remove_tag'
  | 'assign_owner'
  | 'create_note'
  | 'webhook';

export interface WorkflowAction {
  type: WorkflowActionType;
  config: Record<string, unknown>;
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
  'opportunities:read',
  'opportunities:write',
  'activities:read',
  'activities:write',
  'assignments:create',
  'assignments:update',
  'context:read',
  'context:write',
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
  is_current: boolean;
  supersedes_id?: UUID;
  source?: string;
  source_ref?: string;
  source_activity_id?: UUID;
  valid_until?: string;
  reviewed_at?: string;
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
  created_at: string;
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

export interface Briefing {
  subject: Record<string, unknown>;
  subject_type: SubjectType;
  related_objects: Record<string, unknown[]>;
  activities: Activity[];
  open_assignments: Assignment[];
  context_entries: Record<string, ContextEntry[]>;
  staleness_warnings: ContextEntry[];
}
