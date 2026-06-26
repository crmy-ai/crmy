// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';

// -- Reusable primitives --

export const uuid = z.string().uuid();
export const cursor = z.string().optional();
export const limit = z.number().int().min(1).max(100).default(20);
export const actionContextMetadata = z.record(z.unknown()).optional();
export const lifecycleStage = z.enum(['lead', 'prospect', 'customer', 'churned']);
export const oppStage = z.enum(['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost']);
export const forecastCat = z.enum(['pipeline', 'best_case', 'commit', 'closed']);
export const activityType = z.enum([
  'call', 'email', 'meeting', 'note', 'task', 'demo', 'proposal', 'research', 'handoff', 'status_update',
  'outreach_email', 'outreach_call', 'outreach_linkedin', 'outreach_other',
  'meeting_held', 'meeting_scheduled', 'note_added', 'research_completed', 'stage_change',
]);
export const direction = z.enum(['inbound', 'outbound']);
export const userRole = z.enum(['owner', 'admin', 'manager', 'member']);
export const subjectType = z.enum(['contact', 'account', 'opportunity', 'use_case']);
export const systemOfRecordType = z.enum(['hubspot', 'salesforce', 'databricks', 'snowflake']);
export const externalOrigin = z.enum(['crmy', 'crm_sync', 'warehouse_sync', 'agent', 'workflow', 'sequence']);
export const writebackMode = z.enum(['append_event', 'mapped_upsert', 'stored_procedure']);
export const sourceAuthority = z.enum(['crmy', 'external', 'bidirectional', 'read_only', 'approval_required']);
export const externalObjectType = z.enum(['contact', 'account', 'opportunity', 'activity', 'use_case', 'context_entry']);
export const memoryStatus = z.enum(['signal', 'active', 'rejected', 'superseded']);
export const tokenBudgetProfile = z.enum(['tiny', 'standard', 'deep', 'evidence_heavy']);
export const evidenceMode = z.enum(['summary', 'full', 'none']);
export const signalReadinessStatus = z.enum([
  'ready_to_confirm',
  'needs_more_evidence',
  'needs_more_detail',
  'blocked_by_conflict',
  'approval_required',
  'confirmed',
  'dismissed',
]);
export const signalReadinessNextAction = z.enum([
  'confirm_signal',
  'add_evidence',
  'add_detail',
  'resolve_conflict',
  'send_to_handoff',
  'dismiss_signal',
]);
export const signalReadiness = z.object({
  version: z.literal('crmy.signal_readiness.v1'),
  status: signalReadinessStatus,
  can_confirm: z.boolean(),
  can_auto_confirm: z.boolean(),
  score: z.number(),
  threshold: z.number(),
  reasons: z.array(z.string()),
  blockers: z.array(z.string()),
  next_actions: z.array(signalReadinessNextAction),
  components: z.object({
    model_confidence: z.number(),
    source_quality: z.number(),
    independent_source_count: z.number().int(),
    duplicate_source_count: z.number().int(),
    evidence_count: z.number().int(),
    conflict_count: z.number().int(),
    typed_completeness: z.number().nullable(),
    source_boost: z.number(),
    conflict_penalty: z.number(),
  }),
});
export const signalResolutionTargetType = z.enum([
  'mentioned_person',
  'mentioned_entity',
  'subject_record',
  'signal_detail',
  'evidence',
  'conflict',
  'approval',
]);
export const signalResolutionPrimaryAction = z.enum([
  'add_signal_detail',
  'add_evidence',
  'resolve_conflict',
  'request_approval',
  'confirm_signal',
  'view_only',
]);
export const signalResolution = z.object({
  target_type: signalResolutionTargetType,
  target_label: z.string(),
  subject_label: z.string(),
  subject_type: subjectType,
  subject_id: uuid,
  primary_missing_field: z.string().optional(),
  primary_action: signalResolutionPrimaryAction,
  helper_text: z.string(),
});

// -- Eval harness schemas --

export const evalSuiteName = z.enum([
  'raw_context_extraction',
  'raw_context_extraction_quality',
  'raw_context_custom_registry',
  'record_resolution',
  'retrieval_quality',
  'tool_choice',
  'action_context',
  'source_attribution',
  'agent_trajectory',
  'connector_certification',
]);

export const evalRunStatus = z.enum(['pass', 'fail', 'error', 'skipped']);
export const evalRunProfile = z.enum(['contract', 'live_model', 'seeded_context', 'agent_runtime']);
export const evalSuiteImplementationStatus = z.enum(['implemented', 'planned']);
export const evalThreshold = z.object({
  metric: z.string().min(1),
  op: z.enum(['>=', '<=', '=']),
  value: z.number(),
});
export const evalModelMetadata = z.object({
  provider: z.string().optional(),
  base_url: z.string().optional(),
  model: z.string().optional(),
  live_config_present: z.boolean().optional(),
  caller: z.enum(['env', 'injected', 'none']).optional(),
});

export const evalCaseSummary = z.object({
  id: z.string().min(1),
  suite: evalSuiteName,
  profile: evalRunProfile,
  title: z.string().optional(),
  status: evalRunStatus,
  scores: z.record(z.number()),
  expected: z.record(z.unknown()).optional(),
  observed: z.record(z.unknown()).optional(),
  artifacts: z.array(z.string()).optional(),
  model_metadata: evalModelMetadata.optional(),
  diagnostics: z.object({
    missing_expected_items: z.array(z.string()),
    forbidden_items_found: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
});

export const evalSuiteSummary = z.object({
  name: evalSuiteName,
  title: z.string(),
  description: z.string(),
  deterministic: z.boolean(),
  requires_model: z.boolean(),
  requires_database: z.boolean(),
  case_count: z.number().int().min(0),
  implementation_status: evalSuiteImplementationStatus,
  proof_scope: z.string(),
  profiles: z.array(evalRunProfile),
  quality_gate: z.boolean(),
  uses_golden_model_output: z.boolean(),
  limitations: z.array(z.string()),
});

export const evalRunSummary = z.object({
  version: z.literal('crmy.eval_result.v1'),
  run_id: z.string().min(1),
  profile: evalRunProfile,
  suites: z.array(evalSuiteSummary),
  status: evalRunStatus,
  thresholds: z.array(evalThreshold),
  model_metadata: evalModelMetadata.optional(),
  artifacts: z.array(z.string()),
  totals: z.object({
    cases: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    errored: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  scores: z.record(z.number()),
  results: z.array(evalCaseSummary),
  created_at: z.string(),
});

/** Portable eval-case contract for external/redacted case import (crmy.eval_case.v1). */
export const evalCase = z.object({
  version: z.literal('crmy.eval_case.v1'),
  id: z.string().min(1),
  suite: evalSuiteName,
  title: z.string().optional(),
  redacted: z.boolean().optional(),
  source_type: z.string().optional(),
  source_occurred_at: z.string().optional(),
  document: z.string().optional(),
  subject_hints: z.array(z.string()).optional(),
  expected_signal_types: z.array(z.string()).optional(),
  expected_entries: z.array(z.object({
    context_type: z.string(),
    title_contains: z.string().optional(),
    body_contains: z.string().optional(),
    evidence_contains: z.string().optional(),
    required_structured_fields: z.array(z.string()).optional(),
  })).optional(),
  forbidden_entries: z.array(z.record(z.unknown())).optional(),
  expected_unsupported_types: z.array(z.string()).optional(),
  expected_behavior: z.string().optional(),
  expected_readiness: z.record(z.string()).optional(),
  expected_missing_details: z.record(z.array(z.string())).optional(),
  expected_subject: z.object({ type: z.string(), id: z.string() }).optional(),
  expected_subjects: z.array(z.object({ type: z.string(), id: z.string() })).optional(),
  forbidden_subject_ids: z.array(z.string()).optional(),
  expected_skipped: z.array(z.object({ name: z.string(), reason: z.string() })).optional(),
  expected_account_scope: z.array(z.record(z.unknown())).optional(),
  difficulty: z.string().optional(),
  source_tags: z.array(z.string()).optional(),
  must_not_auto_promote: z.boolean().optional(),
  registry: z.object({
    disabled_types: z.array(z.string()).optional(),
    overrides: z.array(z.object({ type_name: z.string(), json_schema: z.record(z.unknown()).nullable().optional() })).optional(),
    custom_types: z.array(z.object({ type_name: z.string(), is_extractable: z.boolean().optional(), json_schema: z.record(z.unknown()).nullable().optional() })).optional(),
  }).optional(),
  golden_model_output: z.unknown().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const tags = z.array(z.string()).default([]);
const customFields = z.record(z.unknown()).default({});
const idempotencyKey = z.string().max(128).optional();
const expectedVersion = z.number().int().positive().optional()
  .describe('Optional optimistic concurrency guard. Pass the row_version from the last read to prevent overwriting newer state.');

// -- Deduplication controls (shared across create schemas) --

const dedupControls = {
  allow_duplicates: z.boolean().optional().default(false)
    .describe('Skip duplicate check and create unconditionally. Use only after presenting candidates to the user.'),
  if_exists: z.enum(['warn', 'return_existing']).optional().default('warn')
    .describe('warn: return 409 with candidates when a duplicate is found. return_existing: silently return the best-matching existing record instead of creating.'),
};

// -- Contact schemas --

export const contactCreate = z.object({
  first_name: z.string().min(1),
  last_name: z.string().default(''),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
  company_name: z.string().optional(),
  account_id: uuid.optional(),
  owner_id: uuid.optional(),
  lifecycle_stage: lifecycleStage.default('lead'),
  aliases: z.array(z.string()).default([]),
  tags,
  custom_fields: customFields,
  source: z.string().optional(),
  idempotency_key: idempotencyKey,
  ...dedupControls,
});

export const contactUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
  action_context: actionContextMetadata,
  patch: z.object({
    first_name: z.string().min(1).optional(),
    last_name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    company_name: z.string().optional(),
    account_id: uuid.nullable().optional(),
    owner_id: uuid.nullable().optional(),
    lifecycle_stage: lifecycleStage.optional(),
    source: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    custom_fields: z.record(z.unknown()).optional(),
  }),
});

export const contactSearch = z.object({
  query: z.string().optional(),
  lifecycle_stage: lifecycleStage.optional(),
  account_id: uuid.optional(),
  owner_id: uuid.optional(),
  tags: z.array(z.string()).optional(),
  limit,
  cursor,
});

export const contactSetLifecycle = z.object({
  id: uuid,
  lifecycle_stage: lifecycleStage,
  reason: z.string().optional(),
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
});

export const contactGetTimeline = z.object({
  id: uuid,
  limit: limit.default(50),
  types: z.array(activityType).optional(),
});

// -- Account schemas --

export const accountCreate = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  industry: z.string().optional(),
  employee_count: z.number().int().positive().optional(),
  annual_revenue: z.number().optional(),
  currency_code: z.string().length(3).default('USD'),
  website: z.string().url().optional(),
  parent_id: uuid.optional(),
  owner_id: uuid.optional(),
  aliases: z.array(z.string()).default([]),
  additional_domains: z.array(z.string()).default([]),
  tags,
  custom_fields: customFields,
  idempotency_key: idempotencyKey,
  ...dedupControls,
});

export const accountUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
  action_context: actionContextMetadata,
  patch: z.object({
    name: z.string().min(1).optional(),
    domain: z.string().optional(),
    industry: z.string().optional(),
    employee_count: z.number().int().positive().nullable().optional(),
    annual_revenue: z.number().nullable().optional(),
    currency_code: z.string().length(3).optional(),
    website: z.string().url().nullable().optional(),
    parent_id: uuid.nullable().optional(),
    owner_id: uuid.nullable().optional(),
    aliases: z.array(z.string()).optional(),
    additional_domains: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    custom_fields: z.record(z.unknown()).optional(),
  }),
});

export const accountSearch = z.object({
  query: z.string().optional(),
  industry: z.string().optional(),
  owner_id: uuid.optional(),
  min_revenue: z.number().optional(),
  tags: z.array(z.string()).optional(),
  limit,
  cursor,
});

export const accountSetHealth = z.object({
  id: uuid,
  score: z.number().int().min(0).max(100),
  rationale: z.string().optional(),
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
});

// -- Opportunity schemas --

export const opportunityCreate = z.object({
  name: z.string().min(1),
  account_id: uuid.optional(),
  contact_id: uuid.optional(),
  owner_id: uuid.optional(),
  amount: z.number().optional(),
  currency_code: z.string().length(3).default('USD'),
  close_date: z.string().optional(),
  stage: oppStage.default('prospecting'),
  description: z.string().optional(),
  custom_fields: customFields,
  idempotency_key: idempotencyKey,
  ...dedupControls,
});

export const opportunityUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
  action_context: actionContextMetadata,
  patch: z.object({
    name: z.string().min(1).optional(),
    account_id: uuid.nullable().optional(),
    contact_id: uuid.nullable().optional(),
    owner_id: uuid.nullable().optional(),
    amount: z.number().nullable().optional(),
    currency_code: z.string().length(3).optional(),
    close_date: z.string().nullable().optional(),
    probability: z.number().int().min(0).max(100).nullable().optional(),
    forecast_cat: forecastCat.optional(),
    description: z.string().nullable().optional(),
    custom_fields: z.record(z.unknown()).optional(),
  }),
});

export const opportunitySearch = z.object({
  query: z.string().optional(),
  stage: oppStage.optional(),
  owner_id: uuid.optional(),
  account_id: uuid.optional(),
  forecast_cat: forecastCat.optional(),
  close_date_before: z.string().optional(),
  close_date_after: z.string().optional(),
  limit,
  cursor,
});

export const opportunityAdvanceStage = z.object({
  id: uuid,
  stage: oppStage,
  note: z.string().optional(),
  lost_reason: z.string().optional(),
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
});

export const pipelineSummary = z.object({
  owner_id: uuid.optional(),
  group_by: z.enum(['stage', 'owner', 'forecast_cat']).default('stage'),
});

// -- Activity schemas --

export const activityCreate = z.object({
  type: activityType,
  subject: z.string().min(1),
  body: z.string().optional(),
  contact_id: uuid.optional(),
  account_id: uuid.optional(),
  opportunity_id: uuid.optional(),
  use_case_id: uuid.optional(),
  owner_id: uuid.optional(),
  due_at: z.string().optional(),
  direction: direction.optional(),
  custom_fields: customFields,
  // Context Engine optional fields
  performed_by: uuid.optional(),
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  related_type: subjectType.optional(),
  related_id: uuid.optional(),
  detail: z.record(z.unknown()).optional(),
  occurred_at: z.string().optional(),
  outcome: z.string().optional(),
  idempotency_key: idempotencyKey,
});

export const activityUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  action_context: actionContextMetadata,
  patch: z.object({
    subject: z.string().min(1).optional(),
    body: z.string().nullable().optional(),
    status: z.string().optional(),
    due_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    direction: direction.optional(),
    performed_by: uuid.nullable().optional(),
    subject_type: subjectType.optional(),
    subject_id: uuid.optional(),
    related_type: subjectType.nullable().optional(),
    related_id: uuid.nullable().optional(),
    detail: z.record(z.unknown()).optional(),
    occurred_at: z.string().optional(),
    outcome: z.string().nullable().optional(),
    custom_fields: z.record(z.unknown()).optional(),
  }),
});

export const activitySearch = z.object({
  contact_id: uuid.optional(),
  account_id: uuid.optional(),
  opportunity_id: uuid.optional(),
  use_case_id: uuid.optional(),
  type: activityType.optional(),
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  performed_by: uuid.optional(),
  outcome: z.string().optional(),
  limit,
  cursor,
});

export const activityComplete = z.object({
  id: uuid,
  completed_at: z.string().optional(),
  note: z.string().optional(),
  idempotency_key: idempotencyKey,
});

// -- Compound action schemas --

export const dealAdvance = z.object({
  opportunity_id: uuid,
  stage: oppStage,
  note: z.string().optional(),
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
  context: z.object({
    title: z.string(),
    body: z.string(),
    context_type: z.string().default('insight'),
  }).optional(),
});

export const contactOutreach = z.object({
  contact_id: uuid,
  channel: z.enum(['email', 'call', 'linkedin', 'other']),
  subject: z.string().min(1),
  body: z.string().optional(),
  outcome: z.string().optional(),
  idempotency_key: idempotencyKey,
  context: z.object({
    title: z.string(),
    body: z.string(),
  }).optional(),
});

// -- Analytics schemas --

export const crmSearch = z.object({
  query: z.string().min(1),
  limit: limit.default(10),
});

export const pipelineForecast = z.object({
  period: z.enum(['month', 'quarter', 'year']).default('quarter'),
  owner_id: uuid.optional(),
});

export const accountHealthReport = z.object({
  account_id: uuid,
});

// -- HITL schemas --

export const hitlSubmit = z.object({
  action_type: z.string().min(1),
  action_summary: z.string().min(1),
  action_payload: z.unknown(),
  auto_approve_after_seconds: z.number().int().min(0).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional()
    .describe('Request urgency — affects notification format and SLA. Default: normal'),
  sla_minutes: z.number().int().min(1).optional()
    .describe('Minutes before SLA breach triggers escalation. Default: 1440 (24h)'),
  escalate_to_id: z.string().uuid().optional()
    .describe('Actor ID to escalate to if SLA breaches. Defaults to most senior active human.'),
  handoff_snapshot_id: uuid.optional()
    .describe('Agent handoff snapshot ID captured with agent_capture_handoff before submitting this review.'),
  idempotency_key: idempotencyKey,
});

export const hitlCheckStatus = z.object({
  request_id: uuid,
});

export const hitlListPending = z.object({
  limit: limit.default(20),
});

export const hitlResolve = z.object({
  request_id: uuid,
  decision: z.enum(['approved', 'rejected']),
  note: z.string().optional(),
  idempotency_key: idempotencyKey,
});

// -- Meta schemas --

export const schemaGet = z.object({
  object_type: z.enum(['contact', 'account', 'opportunity', 'activity', 'use_case']),
});

export const tenantGetStats = z.object({});

export const guideSearch = z.object({
  query: z.string().min(1).describe('Search query — a topic, feature name, or question about CRMy (e.g. "context engine", "how do assignments work", "webhooks")'),
  section: z.string().optional().describe('Optional exact section name to retrieve (e.g. "Contacts", "Briefings", "HITL (Human-in-the-Loop)")'),
});

// -- Systems-of-record schemas --

const credentialEnvelope = z.record(z.unknown()).optional()
  .describe('Plain credentials accepted on create/update only. Responses always redact credentials.');

export const sorSystemCreate = z.object({
  name: z.string().min(1),
  system_type: systemOfRecordType,
  auth_type: z.string().min(1),
  credentials: credentialEnvelope,
  config: z.record(z.unknown()).default({}),
  sync_settings: z.record(z.unknown()).default({}),
  idempotency_key: idempotencyKey,
});

export const sorSystemUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  patch: z.object({
    name: z.string().min(1).optional(),
    auth_type: z.string().min(1).optional(),
    credentials: credentialEnvelope,
    config: z.record(z.unknown()).optional(),
    sync_settings: z.record(z.unknown()).optional(),
    status: z.enum(['disconnected', 'connected', 'error', 'paused']).optional(),
    last_error: z.string().nullable().optional(),
  }),
});

export const sorSystemGet = z.object({ id: uuid });
export const sorSystemDelete = z.object({ id: uuid, idempotency_key: idempotencyKey });
export const sorSystemList = z.object({
  system_type: systemOfRecordType.optional(),
  status: z.enum(['disconnected', 'connected', 'error', 'paused']).optional(),
  limit,
  cursor,
});

export const sorSystemTest = z.object({ id: uuid });
export const sorDiscover = z.object({
  system_id: uuid,
  object_name: z.string().optional(),
});

export const sorMappingUpsert = z.object({
  id: uuid.optional(),
  system_id: uuid.describe('System connection that owns this mapping.'),
  object_type: externalObjectType.describe('CRMy typed object that external records sync into. contact/account/opportunity/activity sync directly; use_case and context_entry mappings create reviewable conflicts until their typed adapters are available.'),
  external_object: z.string().min(1)
    .describe('External CRM object, warehouse table, view, or approved stored procedure target.'),
  external_id_field: z.string().min(1).default('id')
    .describe('External field used as the stable source record identifier.'),
  watermark_field: z.string().optional()
    .describe('Optional external updated-at or cursor field for incremental sync.'),
  field_mapping: z.record(z.string()).default({})
    .describe('Map CRMy field names to external field names. Example: {"email":"properties.email"}.'),
  readable_fields: z.array(z.string()).default([])
    .describe('External fields allowed to be read during sync. Empty means the adapter default is used.'),
  writable_fields: z.array(z.string()).default([])
    .describe('External fields allowed for governed writeback. Empty means read-only writeback policy.'),
  source_authority: sourceAuthority.default('external')
    .describe('Conflict policy for this mapping. External can update CRMy directly; CRMy/read-only/approval-required create conflicts instead of overwriting; bidirectional updates only when CRMy has not diverged from the last synced value.'),
  writeback_mode: writebackMode.optional()
    .describe('Approved external write mode. Warehouses only allow append_event, mapped_upsert, or stored_procedure.'),
  writeback_config: z.record(z.unknown()).default({})
    .describe('Admin-defined writeback settings such as sql_template, table name, procedure name, or parameter_order.'),
  allow_source_loop: z.boolean().default(false)
    .describe('Allow sync-originated events to write back to the same source. Disabled by default to prevent loops.'),
  is_active: z.boolean().default(true)
    .describe('Disable to pause this mapping without deleting sync history.'),
  idempotency_key: idempotencyKey,
});

export const sorMappingList = z.object({
  system_id: uuid.optional(),
  object_type: externalObjectType.optional(),
  is_active: z.boolean().optional(),
  limit,
  cursor,
});

export const sorMappingDelete = z.object({
  id: uuid.describe('Mapping id to delete.'),
  idempotency_key: idempotencyKey,
});

export const sorSyncRun = z.object({
  system_id: uuid,
  mapping_id: uuid.optional(),
  mode: z.enum(['test', 'full', 'incremental', 'replay']).default('incremental'),
  replay_of_run_id: uuid.optional(),
  idempotency_key: idempotencyKey,
});

export const sorSyncStatus = z.object({
  system_id: uuid.optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']).optional(),
  limit,
  cursor,
});

export const sorConflictList = z.object({
  system_id: uuid.optional(),
  status: z.enum(['open', 'resolved_local', 'resolved_external', 'ignored']).optional(),
  object_type: z.string().optional(),
  object_id: uuid.optional(),
  limit,
  cursor,
});

export const sorConflictResolve = z.object({
  id: uuid,
  resolution: z.enum(['resolved_local', 'resolved_external', 'ignored']),
  note: z.string().optional(),
  idempotency_key: idempotencyKey,
});

export const sorWritebackPreview = z.object({
  system_id: uuid,
  mapping_id: uuid.optional(),
  object_type: z.string().min(1),
  object_id: uuid.optional(),
  external_object: z.string().min(1),
  external_record_id: z.string().optional(),
  operation: z.enum(['create', 'update', 'upsert', 'append_event', 'stored_procedure']),
  writeback_mode: writebackMode,
  payload: z.record(z.unknown()),
});

export const sorWritebackRequest = sorWritebackPreview.extend({
  require_approval: z.boolean().default(true),
  idempotency_key: z.string().trim().min(1).max(128).describe('Required stable operation key. Reuse the same key when retrying the same external writeback request.'),
});

export const sorWritebackExecute = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
});

export const sorWritebackReview = z.object({
  id: uuid,
  decision: z.enum(['approved', 'rejected']),
  note: z.string().optional(),
  idempotency_key: idempotencyKey,
});

export const sorWritebackStatus = z.object({
  system_id: uuid.optional(),
  status: z.enum(['pending', 'approval_required', 'approved', 'executing', 'completed', 'failed', 'rejected', 'cancelled']).optional(),
  limit,
  cursor,
});

// -- Auth schemas --

export const authRegister = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(12),
  tenant_name: z.string().trim().min(1),
});

export const authLogin = z.object({
  email: z.string().trim().email(),
  password: z.string(),
  tenant_slug: z.string().trim().min(1).max(80).optional(),
});

export const apiKeyCreate = z.object({
  label: z.string().min(1),
  scopes: z.array(z.string()).default(['read', 'write']),
  expires_at: z.string().optional(),
  actor_id: uuid.optional(),
});

// -- Use Case schemas --

export const useCaseStage = z.enum(['discovery', 'poc', 'production', 'scaling', 'sunset']);

export const useCaseCreate = z.object({
  account_id: uuid,
  name: z.string().min(1),
  stage: useCaseStage.default('discovery'),
  description: z.string().optional(),
  opportunity_id: uuid.optional(),
  owner_id: uuid.optional(),
  unit_label: z.string().optional(),
  consumption_unit: z.string().optional(),
  consumption_capacity: z.number().int().optional(),
  attributed_arr: z.number().int().optional(),
  currency_code: z.string().length(3).default('USD'),
  expansion_potential: z.number().int().optional(),
  started_at: z.string().optional(),
  target_prod_date: z.string().optional(),
  sunset_date: z.string().optional(),
  tags,
  custom_fields: customFields,
  idempotency_key: idempotencyKey,
});

export const useCaseUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
  action_context: actionContextMetadata,
  patch: z.object({
    name: z.string().min(1).optional(),
    stage: useCaseStage.optional(),
    description: z.string().nullable().optional(),
    opportunity_id: uuid.nullable().optional(),
    owner_id: uuid.nullable().optional(),
    unit_label: z.string().nullable().optional(),
    consumption_unit: z.string().nullable().optional(),
    consumption_capacity: z.number().int().nullable().optional(),
    attributed_arr: z.number().int().nullable().optional(),
    currency_code: z.string().length(3).optional(),
    expansion_potential: z.number().int().nullable().optional(),
    started_at: z.string().nullable().optional(),
    target_prod_date: z.string().nullable().optional(),
    sunset_date: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    custom_fields: z.record(z.unknown()).optional(),
  }),
});

export const useCaseSearch = z.object({
  account_id: uuid.optional(),
  stage: useCaseStage.optional(),
  owner_id: uuid.optional(),
  product_line: z.string().optional(),
  tags: z.array(z.string()).optional(),
  query: z.string().optional(),
  limit,
  cursor,
});

export const useCaseGet = z.object({ id: uuid });
export const useCaseDelete = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
});

export const useCaseAdvanceStage = z.object({
  id: uuid,
  stage: useCaseStage,
  note: z.string().optional(),
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
});

export const useCaseUpdateConsumption = z.object({
  id: uuid,
  consumption_current: z.number().int(),
  note: z.string().optional(),
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
});

export const useCaseSetHealth = z.object({
  id: uuid,
  score: z.number().int().min(0).max(100),
  rationale: z.string().optional(),
  idempotency_key: idempotencyKey,
  expected_version: expectedVersion,
});

export const useCaseLinkContact = z.object({
  use_case_id: uuid,
  contact_id: uuid,
  role: z.string().default('stakeholder'),
  idempotency_key: idempotencyKey,
});

export const useCaseUnlinkContact = z.object({
  use_case_id: uuid,
  contact_id: uuid,
  idempotency_key: idempotencyKey,
});

export const useCaseListContacts = z.object({
  use_case_id: uuid,
});

export const useCaseGetTimeline = z.object({
  id: uuid,
  limit: limit.default(50),
  types: z.array(activityType).optional(),
});

export const useCaseSummary = z.object({
  account_id: uuid.optional(),
  group_by: z.enum(['stage', 'product_line', 'owner']).default('stage'),
});

// -- Webhook schemas --

export const webhookCreate = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  description: z.string().optional(),
  idempotency_key: idempotencyKey,
});

export const webhookUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  patch: z.object({
    url: z.string().url().optional(),
    events: z.array(z.string()).optional(),
    active: z.boolean().optional(),
    description: z.string().nullable().optional(),
  }),
});

export const webhookDelete = z.object({ id: uuid, idempotency_key: idempotencyKey });
export const webhookGet = z.object({ id: uuid });
export const webhookRevealSecret = z.object({ id: uuid });
export const webhookRotateSecret = z.object({ id: uuid, idempotency_key: idempotencyKey });

export const webhookList = z.object({
  active: z.boolean().optional(),
  limit,
  cursor,
});

export const webhookListDeliveries = z.object({
  endpoint_id: uuid.optional(),
  status: z.enum(['pending', 'success', 'failed']).optional(),
  limit,
  cursor,
});

// -- Email schemas --

export const emailCreate = z.object({
  contact_id: uuid.optional(),
  account_id: uuid.optional(),
  opportunity_id: uuid.optional(),
  use_case_id: uuid.optional(),
  subject: z.string().min(1),
  body_html: z.string().optional(),
  body_text: z.string().optional(),
  to_address: z.string().email(),
  require_approval: z.boolean().default(true),
  idempotency_key: idempotencyKey,
});

export const emailGet = z.object({ id: uuid });

export const emailSearch = z.object({
  contact_id: uuid.optional(),
  account_id: uuid.optional(),
  opportunity_id: uuid.optional(),
  use_case_id: uuid.optional(),
  q: z.string().optional(),
  status: z.enum(['draft', 'pending_approval', 'approved', 'queued_for_delivery', 'sending', 'sent', 'failed', 'rejected', 'delivery_uncertain']).optional(),
  limit,
  cursor,
});

export const emailProviderSet = z.object({
  provider: z.string().min(1),
  config: z.record(z.unknown()),
  from_name: z.string().min(1),
  from_email: z.string().email(),
  idempotency_key: idempotencyKey,
});

export const emailProviderGet = z.object({});

// ── Sequence step discriminated union ─────────────────────────────────────────

const seqStepEmail = z.object({
  type: z.literal('email').optional(),
  delay_days: z.number().int().min(0).default(0),
  delay_hours: z.number().int().min(0).default(0).optional(),
  subject: z.string().min(1),
  body_text: z.string().optional(),
  body_html: z.string().optional(),
  require_approval: z.boolean().optional(),
  ai_generate: z.boolean().optional(),
  ai_prompt: z.string().optional(),
});

const seqStepNotification = z.object({
  type: z.literal('notification'),
  delay_days: z.number().int().min(0).default(0),
  channel_id: uuid.optional(),
  message: z.string().min(1),
});

const seqStepTask = z.object({
  type: z.literal('task'),
  delay_days: z.number().int().min(0).default(0),
  title: z.string().min(1),
  description: z.string().optional(),
  assign_to: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal').optional(),
});

const seqStepWebhook = z.object({
  type: z.literal('webhook'),
  delay_days: z.number().int().min(0).default(0),
  url: z.string().url(),
  method: z.enum(['POST', 'GET']).default('POST').optional(),
  headers: z.record(z.string()).optional(),
  body_template: z.string().optional(),
});

const seqStepWait = z.object({
  type: z.literal('wait'),
  delay_days: z.number().int().min(0).default(0),
  condition: z.object({
    event: z.string(),
    timeout_days: z.number().int().min(1),
    timeout_branch: z.number().int().min(0).optional(),
  }).optional(),
});

const seqStepBranch = z.object({
  type: z.literal('branch'),
  delay_days: z.number().int().min(0).default(0).optional(),
  conditions: z.array(z.object({
    trigger: z.enum(['replied', 'opened', 'clicked', 'goal_met', 'custom_event']),
    event: z.string().optional(),
    jump_to_step: z.number().int().min(0).optional(),
    exit: z.boolean().optional(),
  })).min(1),
});

const seqStepAiAction = z.object({
  type: z.literal('ai_action'),
  delay_days: z.number().int().min(0).default(0),
  prompt: z.string().min(1),
  tool_names: z.array(z.string()).optional(),
  require_approval: z.boolean().optional(),
});

export const sequenceStep = z.union([
  seqStepEmail,
  seqStepNotification,
  seqStepTask,
  seqStepWebhook,
  seqStepWait,
  seqStepBranch,
  seqStepAiAction,
]);

// ── Sequence CRUD schemas ──────────────────────────────────────────────────────

export const sequenceCreate = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(sequenceStep).min(1),
  channel_types: z.array(z.string()).optional(),
  goal_event: z.string().optional(),
  exit_on_reply: z.boolean().optional(),
  ai_persona: z.string().optional(),
  tags: z.array(z.string()).optional(),
  idempotency_key: idempotencyKey,
});

export const sequenceGet = z.object({ id: uuid });
export const sequenceDelete = z.object({ id: uuid, idempotency_key: idempotencyKey });

export const sequenceUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  patch: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    steps: z.array(sequenceStep).min(1).optional(),
    is_active: z.boolean().optional(),
    channel_types: z.array(z.string()).optional(),
    goal_event: z.string().optional(),
    exit_on_reply: z.boolean().optional(),
    ai_persona: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
});

export const sequenceList = z.object({
  is_active: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  limit,
  cursor,
});

export const sequenceEnroll = z.object({
  sequence_id: uuid,
  contact_id: uuid,
  variables: z.record(z.unknown()).optional(),
  start_at_step: z.number().int().min(0).optional(),
  /** What the enrolling actor is trying to achieve — visible in briefings and the sandbox view. */
  objective: z.string().max(500).optional(),
  idempotency_key: idempotencyKey,
});

export const sequenceEnrollmentContext = z.object({
  enrollment_id: uuid,
});

export const sequenceUnenroll = z.object({ id: uuid, idempotency_key: idempotencyKey });
export const sequencePause = z.object({ id: uuid, idempotency_key: idempotencyKey });
export const sequenceResume = z.object({ id: uuid, idempotency_key: idempotencyKey });

export const sequenceAdvance = z.object({
  id: uuid,
  skip_to_step: z.number().int().min(0).optional(),
  reason: z.string().optional(),
  idempotency_key: idempotencyKey,
});

export const sequenceEnrollmentGet = z.object({ id: uuid });

export const sequenceEnrollmentList = z.object({
  sequence_id: uuid.optional(),
  contact_id: uuid.optional(),
  status: z.enum(['active', 'completed', 'paused', 'cancelled']).optional(),
  limit,
  cursor,
});

export const sequenceDraftStep = z.object({
  enrollment_id: uuid,
  step_index: z.number().int().min(0),
  instructions: z.string().optional(),
});

export const sequenceAnalytics = z.object({
  sequence_id: uuid,
  period_type: z.enum(['day', 'week', 'month']).optional(),
  limit: z.number().int().min(1).max(90).default(30).optional(),
});

// -- Custom field schemas --

export const customFieldCreate = z.object({
  object_type: z.enum(['contact', 'account', 'opportunity', 'activity', 'use_case']),
  field_name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  field_type: z.enum(['text', 'number', 'boolean', 'date', 'select', 'multi_select']),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  default_value: z.unknown().optional(),
  idempotency_key: idempotencyKey,
});

export const customFieldUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  patch: z.object({
    label: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    default_value: z.unknown().optional(),
    sort_order: z.number().int().optional(),
  }),
});

export const customFieldDelete = z.object({ id: uuid, idempotency_key: idempotencyKey });

export const customFieldList = z.object({
  object_type: z.enum(['contact', 'account', 'opportunity', 'activity', 'use_case']),
});

// -- Bulk schemas --

export const bulkImport = z.object({
  object_type: z.enum(['contact', 'account', 'opportunity', 'activity', 'use_case']),
  records: z.array(z.record(z.unknown())).min(1).max(10000),
});

export const bulkExport = z.object({
  object_type: z.enum(['contact', 'account', 'opportunity', 'activity', 'use_case']),
  filters: z.record(z.unknown()).default({}),
});

export const bulkJobGet = z.object({ id: uuid });

export const bulkJobList = z.object({
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  limit,
  cursor,
});

// Note: the notes table has been removed. Use context_add with context_type='note' instead.
// contextEntryCreate supports parent_id, visibility, mentions, and pinned for full note functionality.

// -- Workflow schemas --

const workflowBool = z.preprocess(
  value => value === 'true' ? true : value === 'false' ? false : value,
  z.boolean(),
);
const workflowNumber = z.preprocess(
  value => typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  z.number(),
);

// Typed per-action-type schemas via discriminated union
const wfActionSendNotification = z.object({
  type: z.literal('send_notification'),
  config: z.object({
    message: z.string().optional().describe('Notification message body. Required unless ai_generate is true.'),
    channel_id: z.string().uuid().optional().describe('Messaging channel UUID (uses tenant default if omitted)'),
    recipient: z.string().optional().describe('Recipient identifier (e.g. @user or #channel)'),
    subject: z.string().optional().describe('Optional subject/title'),
    ai_generate: workflowBool.optional(),
    ai_prompt: z.string().optional(),
  }),
});

const wfActionSendEmail = z.object({
  type: z.literal('send_email'),
  config: z.object({
    to_address: z.string().min(1).describe('Recipient email address. Supports {{variables}}.'),
    subject: z.string().min(1).describe('Email subject line. Supports {{variables}}.'),
    body_text: z.string().optional().describe('Plain-text email body. Supports {{variables}}. Required unless ai_generate is true.'),
    body_html: z.string().optional().describe('Optional HTML email body. Supports {{variables}}.'),
    require_approval: workflowBool.default(true).describe('If true, creates a HITL request before sending'),
    ai_generate: workflowBool.optional(),
    ai_prompt: z.string().optional(),
    contact_id: z.string().optional(),
    account_id: z.string().optional(),
    opportunity_id: z.string().optional(),
  }),
});

const wfActionUpdateField = z.object({
  type: z.literal('update_field'),
  config: z.object({
    object_type: z.enum(['contact', 'account', 'opportunity']).optional().describe('Entity type to update (defaults to triggered entity type)'),
    object_id: z.string().optional().describe('Entity UUID or variable (defaults to triggered entity ID)'),
    field: z.string().min(1).describe('Field name to update, e.g. lifecycle_stage'),
    value: z.unknown().describe('New field value'),
  }),
});

const wfActionCreateActivity = z.object({
  type: z.literal('create_activity'),
  config: z.object({
    type: z.string().min(1).describe('Activity type, e.g. task, call, note'),
    subject: z.string().min(1).describe('Activity subject. Supports {{variables}}.'),
    body: z.string().optional().describe('Activity body/notes. Supports {{variables}}.'),
    contact_id: z.string().optional(),
    account_id: z.string().optional(),
  }),
});

const wfActionAddTag = z.object({
  type: z.literal('add_tag'),
  config: z.object({
    tag: z.string().min(1).describe('Tag to add, e.g. hot-lead'),
    object_type: z.enum(['contact', 'account', 'opportunity']).optional(),
    object_id: z.string().optional(),
  }),
});

const wfActionRemoveTag = z.object({
  type: z.literal('remove_tag'),
  config: z.object({
    tag: z.string().min(1).describe('Tag to remove'),
    object_type: z.enum(['contact', 'account', 'opportunity']).optional(),
    object_id: z.string().optional(),
  }),
});

const wfActionAssignOwner = z.object({
  type: z.literal('assign_owner'),
  config: z.object({
    owner_id: z.string().min(1).describe('UUID of the actor to assign as owner. Supports {{variables}}.'),
    object_type: z.enum(['contact', 'account', 'opportunity']).optional(),
    object_id: z.string().optional(),
  }),
});

const wfActionCreateContextEntry = z.object({
  type: z.literal('create_context_entry'),
  config: z.object({
    body: z.string().min(1).describe('Context entry body. Supports {{variables}}.'),
    context_type: z.string().default('note').describe('Context type, e.g. note, insight'),
    object_type: z.string().optional(),
    object_id: z.string().optional(),
    visibility: z.enum(['internal', 'shared']).default('internal').optional(),
  }),
});

const wfActionWebhook = z.object({
  type: z.literal('webhook'),
  config: z.object({
    url: z.string().url().describe('HTTPS endpoint to POST to when this action fires'),
    secret: z.string().optional().describe('Optional shared secret for HMAC verification'),
  }),
});

const wfActionWait = z.object({
  type: z.literal('wait'),
  config: z.object({
    seconds: workflowNumber.pipe(z.number().int().min(1).max(300)).describe('Delay in seconds (max 300)'),
  }),
});

const wfActionEnrollInSequence = z.object({
  type: z.literal('enroll_in_sequence'),
  config: z.object({
    sequence_id: z.string().min(1).describe('UUID of the sequence to enroll the contact into'),
    contact_id:  z.string().optional().describe('Contact UUID override; auto-resolved from event subject if omitted'),
    objective:   z.string().max(500).optional().describe('Optional goal text for this enrollment'),
  }),
});

const wfActionHitlCheckpoint = z.object({
  type: z.literal('hitl_checkpoint'),
  config: z.object({
    title:        z.string().min(1).describe('Review request title shown to the human reviewer. Supports {{variables}}.'),
    instructions: z.string().optional().describe('Optional instructions for the reviewer — what to check or decide'),
    priority:     z.enum(['normal', 'high', 'urgent']).default('normal').optional(),
  }),
});

const wfActionRequestExternalWriteback = z.object({
  type: z.literal('request_external_writeback'),
  config: z.object({
    system_id: z.string().min(1).describe('System of record UUID'),
    mapping_id: z.string().optional().describe('Optional external object mapping UUID'),
    object_type: z.string().min(1).describe('CRMy object type, e.g. contact or opportunity'),
    object_id: z.string().optional().describe('Optional CRMy object UUID or variable; defaults to the event subject when omitted'),
    external_object: z.string().min(1).describe('External object, table, or endpoint name'),
    external_record_id: z.string().optional().describe('Optional external record identifier'),
    operation: z.enum(['create', 'update', 'upsert', 'append_event', 'stored_procedure']).default('upsert').optional(),
    writeback_mode: z.enum(['append_event', 'mapped_upsert', 'stored_procedure']).default('mapped_upsert').optional(),
    payload: z.union([z.record(z.unknown()), z.string().min(1)]).describe('JSON object or templated JSON string'),
    require_approval: workflowBool.optional(),
    allow_source_loop: workflowBool.optional(),
    idempotency_key: z.string().optional(),
  }),
});

const wfActionRunSystemSync = z.object({
  type: z.literal('run_system_sync'),
  config: z.object({
    system_id: z.string().min(1).describe('System of record UUID'),
    mapping_id: z.string().optional().describe('Optional mapping UUID'),
    mode: z.enum(['test', 'full', 'incremental', 'replay']).default('incremental').optional(),
  }),
});

const wfActionCreateSyncConflictReview = z.object({
  type: z.literal('create_sync_conflict_review'),
  config: z.object({
    title: z.string().min(1).describe('Review title shown in Handoffs'),
    instructions: z.string().optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal').optional(),
  }),
});

const wfActionCreateContextFromExternalChange = z.object({
  type: z.literal('create_context_from_external_change'),
  config: z.object({
    subject_type: z.string().optional(),
    subject_id: z.string().optional(),
    context_type: z.string().default('note').optional(),
    body: z.string().min(1).describe('Context body. Supports {{variables}}.'),
  }),
});

// Discriminated union covering all action types
export const workflowAction = z.discriminatedUnion('type', [
  wfActionSendNotification,
  wfActionSendEmail,
  wfActionUpdateField,
  wfActionCreateActivity,
  wfActionAddTag,
  wfActionRemoveTag,
  wfActionAssignOwner,
  wfActionWebhook,
  wfActionWait,
  wfActionEnrollInSequence,
  wfActionHitlCheckpoint,
  wfActionRequestExternalWriteback,
  wfActionRunSystemSync,
  wfActionCreateSyncConflictReview,
  wfActionCreateContextFromExternalChange,
  // create_context_entry uses z.union so needs separate handling
]).or(wfActionCreateContextEntry);

const workflowFilterCondition = z.object({
  op: z.enum(['eq', 'neq', 'contains', 'starts_with', 'gt', 'lt', 'exists', 'not_exists']),
  value: z.unknown().optional(),
});

export const workflowCreate = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger_event: z.string().min(1),
  trigger_filter: z.record(workflowFilterCondition).default({}),
  actions: z.array(workflowAction).min(1).max(20),
  is_active: z.boolean().default(true),
  max_runs_per_hour: z.number().int().min(1).max(1000).optional().describe('Rate limit: maximum workflow runs allowed per hour'),
  idempotency_key: idempotencyKey,
});

export const workflowUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  patch: z.object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    trigger_event: z.string().min(1).optional(),
    trigger_filter: z.record(workflowFilterCondition).optional(),
    actions: z.array(workflowAction).min(1).max(20).optional(),
    is_active: z.boolean().optional(),
    max_runs_per_hour: z.number().int().min(1).max(1000).nullable().optional(),
  }),
});

export const workflowGet = z.object({ id: uuid });
export const workflowDelete = z.object({ id: uuid, idempotency_key: idempotencyKey });

export const workflowList = z.object({
  trigger_event: z.string().optional(),
  is_active: z.boolean().optional(),
  limit,
  cursor,
});

export const workflowRunList = z.object({
  workflow_id: uuid,
  status: z.enum(['running', 'completed', 'failed']).optional(),
  limit,
  cursor,
});

// -- Messaging channel schemas --

export const messagingChannelCreate = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  config: z.record(z.unknown()),
  is_active: z.boolean().default(true),
  is_default: z.boolean().default(false),
  idempotency_key: idempotencyKey,
});

export const messagingChannelUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  patch: z.object({
    name: z.string().min(1).optional(),
    config: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
    is_default: z.boolean().optional(),
  }),
});

export const messagingChannelGet = z.object({ id: uuid });
export const messagingChannelDelete = z.object({ id: uuid, idempotency_key: idempotencyKey });

export const messagingChannelList = z.object({
  provider: z.string().optional(),
  is_active: z.boolean().optional(),
  limit,
  cursor,
});

export const messageSend = z.object({
  channel_id: uuid,
  recipient: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
  idempotency_key: idempotencyKey,
});

export const messageDeliveryGet = z.object({ id: uuid });

export const messageDeliverySearch = z.object({
  channel_id: uuid.optional(),
  status: z.enum(['pending', 'delivered', 'retrying', 'failed']).optional(),
  limit,
  cursor,
});

// -- v0.4/v0.5 Context Engine schemas --

export const actorType = z.enum(['human', 'agent']);
export const assignmentStatus = z.enum([
  'pending', 'accepted', 'in_progress', 'blocked',
  'completed', 'declined', 'cancelled',
]);
export const assignmentPriority = z.enum(['low', 'normal', 'high', 'urgent']);
export const activityTypeCategory = z.enum([
  'outreach', 'meeting', 'proposal', 'contract',
  'internal', 'lifecycle', 'handoff',
]);

// -- Activity Type Registry schemas --

export const activityTypeRegistryAdd = z.object({
  type_name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(200),
  description: z.string().optional(),
  category: activityTypeCategory,
  idempotency_key: idempotencyKey,
});

export const activityTypeRegistryRemove = z.object({
  type_name: z.string().min(1),
  idempotency_key: idempotencyKey,
});

export const activityTypeRegistryList = z.object({
  category: activityTypeCategory.optional(),
});

// -- Context Type Registry schemas --

export const contextTypeRegistryAdd = z.object({
  type_name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(200),
  description: z.string().optional(),
  idempotency_key: idempotencyKey,
});

export const contextTypeRegistryRemove = z.object({
  type_name: z.string().min(1),
  idempotency_key: idempotencyKey,
});

export const contextTypeRegistryList = z.object({});

// -- Briefing schema --

export const briefingGet = z.object({
  subject_type: subjectType,
  subject_id: uuid,
  since: z.string().optional(),
  context_types: z.array(z.string()).optional(),
  include_stale: z.boolean().default(false),
  format: z.enum(['json', 'text']).default('json'),
  /**
   * How far to reach into the CRM entity graph when pulling context:
   *   'direct'       — only the subject's own context (default)
   *   'adjacent'     — subject + directly related entities (e.g. account + opportunities for a contact)
   *   'account_wide' — subject + all entities under the same account hierarchy
   */
  context_radius: z.enum(['direct', 'adjacent', 'account_wide']).default('direct'),
  /**
   * Maximum tokens to budget for context entries.
   * When set, entries are ranked by priority score (confidence × recency × type weight)
   * and packed within the budget. The response includes token_estimate and truncated flag.
   * Estimated at ~4 chars/token (body + title + overhead per entry).
   */
  token_budget: z.number().int().min(100).optional(),
  token_budget_profile: tokenBudgetProfile.optional()
    .describe('Named token budget preset. Explicit token_budget wins when both are supplied.'),
  evidence_mode: evidenceMode.default('summary')
    .describe('summary returns compact evidence references; full returns complete evidence payloads; none omits evidence arrays from context entries.'),
  include_product_context: z.boolean().optional()
    .describe('Include governed product knowledge relevant to this subject. Defaults to true when product knowledge is configured; never blocks the briefing.'),
});

export const actionContextProposedAction = z.object({
  action_type: z.enum([
    'customer_outreach',
    'assignment_create',
    'memory_promote',
    'record_update',
    'external_writeback',
    'sequence_step',
    'workflow_action',
    'agent_task',
  ]),
  object_type: externalObjectType.or(subjectType).optional(),
  field_names: z.array(z.string().min(1)).optional(),
  source_context_entry_ids: z.array(uuid).optional(),
  signal_group_ids: z.array(uuid).optional(),
  system_id: uuid.optional(),
  mapping_id: uuid.optional(),
  external_object: z.string().min(1).optional(),
  payload: z.record(z.unknown()).optional(),
  approved: z.boolean().optional(),
});

export const actionContextGet = z.object({
  subject_type: subjectType,
  subject_id: uuid,
  since: z.string().optional(),
  context_types: z.array(z.string()).optional(),
  include_stale: z.boolean().default(false),
  context_radius: z.enum(['direct', 'adjacent', 'account_wide']).default('direct'),
  token_budget: z.number().int().min(100).optional(),
  token_budget_profile: tokenBudgetProfile.optional()
    .describe('Named token budget preset. If omitted, CRMy infers one from proposed_action when useful. Explicit token_budget wins.'),
  evidence_mode: evidenceMode.default('summary')
    .describe('summary returns compact evidence references; full returns complete evidence payloads; none omits evidence arrays from context entries.'),
  emit_retrieval_event: z.boolean().default(true),
  proposed_action: actionContextProposedAction.optional(),
  include_product_context: z.boolean().optional()
    .describe('Include governed product knowledge in the assembled briefing. Defaults to true when product knowledge is configured.'),
});

export const actionContextHumanUnblock = z.object({
  subject_type: subjectType,
  subject_id: uuid,
  proposed_action: actionContextProposedAction.optional(),
  request_type: z.enum(['auto', 'approval', 'assignment']).default('auto')
    .describe('auto chooses approval for policy/signal review and assignment when an assignee is provided.'),
  title: z.string().min(1).max(240).optional()
    .describe('Human-facing title. Defaults to the Action Context unblock question.'),
  question: z.string().min(1).max(1000).optional()
    .describe('The smallest decision or correction needed from the human.'),
  assignee_id: uuid.optional()
    .describe('Human or agent actor to assign when request_type is assignment.'),
  reviewer_id: uuid.optional()
    .describe('Human actor to notify/escalate when request_type is approval.'),
  priority: assignmentPriority.default('normal'),
  due_at: z.string().optional(),
  sla_minutes: z.number().int().min(1).optional(),
  reasoning: z.string().min(1).max(4000).optional()
    .describe('Agent summary of what it found and why it stopped. Defaults to Action Context guidance.'),
  tools_called: z.array(z.object({
    tool_name: z.string().min(1),
    args_summary: z.string().optional(),
    result_summary: z.string().optional(),
  })).default([]),
  idempotency_key: idempotencyKey,
});

// -- Context search (full-text) schema --

export const contextSearch = z.object({
  query: z.string().min(1),
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  context_type: z.string().optional(),
  tag: z.string().optional(),
  current_only: z.boolean().default(true),
  memory_status: memoryStatus.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  /**
   * Partial JSONB match against structured_data (PostgreSQL @> operator).
   * Example: { "status": "open" } matches all entries where structured_data contains status=open.
   * Combine with context_type to query e.g. all open objections, high-severity deal risks, etc.
   */
  structured_data_filter: z.record(z.unknown()).optional(),
});

// -- Context semantic search schema --

export const contextSemanticSearch = z.object({
  query: z.string().min(1)
    .describe('Natural language query — embedded and compared by cosine similarity. Use paraphrases, concepts, or descriptions rather than exact keywords.'),
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  context_type: z.string().optional(),
  tag: z.string().optional(),
  current_only: z.boolean().default(true),
  memory_status: memoryStatus.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  structured_data_filter: z.record(z.unknown()).optional(),
});

// -- Context embed backfill schema (admin) --

export const contextEmbedBackfill = z.object({
  batch_size: z.number().int().min(1).max(100).default(50)
    .describe('Number of entries to embed per call. Loop calls until pending reaches 0.'),
  subject_type: subjectType.optional()
    .describe('Optional: limit backfill to entries for a specific entity type.'),
  dry_run: z.boolean().default(false)
    .describe('If true, count pending entries without embedding them.'),
  idempotency_key: idempotencyKey,
});

export const contextLineageGet = z.object({
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  context_entry_id: uuid.optional(),
  signal_group_id: uuid.optional(),
  raw_context_source_id: uuid.optional(),
});

// -- Context review schema --

export const contextReview = z.object({
  id: uuid,
  extend_days: z.number().int().min(1).max(3650).optional()
    .describe('Extend valid_until by this many days from now. If omitted, uses the type\'s half_life_days or defaults to 30.'),
  idempotency_key: idempotencyKey,
});

// -- Context stale list schema --

export const contextStaleList = z.object({
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// -- Actor schemas --

export const actorCreate = z.object({
  actor_type: actorType,
  display_name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  user_id: uuid.optional(),
  role: z.string().optional(),
  agent_identifier: z.string().optional(),
  agent_model: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
  idempotency_key: idempotencyKey,
});

export const actorUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  patch: z.object({
    display_name: z.string().min(1).optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    agent_identifier: z.string().nullable().optional(),
    agent_model: z.string().nullable().optional(),
    scopes: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
  }),
});

export const actorGet = z.object({ id: uuid });

export const actorSearch = z.object({
  actor_type: actorType.optional(),
  query: z.string().optional(),
  is_active: z.boolean().optional(),
  limit,
  cursor,
});

// -- Assignment schemas --

export const assignmentCreate = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assignment_type: z.string().min(1),
  assigned_to: uuid,
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  priority: assignmentPriority.default('normal'),
  due_at: z.string().optional(),
  context: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
  action_context: actionContextMetadata,
  idempotency_key: idempotencyKey,
});

export const assignmentUpdate = z.object({
  id: uuid,
  idempotency_key: idempotencyKey,
  action_context: actionContextMetadata,
  patch: z.object({
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    assignment_type: z.string().min(1).optional(),
    assigned_to: uuid.optional(),
    priority: assignmentPriority.optional(),
    due_at: z.string().nullable().optional(),
    status: assignmentStatus.optional(),
    context: z.string().nullable().optional(),
    subject_type: subjectType.nullable().optional(),
    subject_id: uuid.nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

export const assignmentGet = z.object({ id: uuid });

export const assignmentSearch = z.object({
  assigned_to: uuid.optional(),
  assigned_by: uuid.optional(),
  status: assignmentStatus.optional(),
  priority: assignmentPriority.optional(),
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  limit,
  cursor,
});

export const assignmentAccept = z.object({ id: uuid, idempotency_key: idempotencyKey });

export const assignmentComplete = z.object({
  id: uuid,
  completed_by_activity_id: uuid.optional(),
  idempotency_key: idempotencyKey,
});

export const assignmentDecline = z.object({
  id: uuid,
  reason: z.string().optional(),
  idempotency_key: idempotencyKey,
});

export const assignmentStart = z.object({ id: uuid, idempotency_key: idempotencyKey });

export const assignmentBlock = z.object({
  id: uuid,
  reason: z.string().optional(),
  idempotency_key: idempotencyKey,
});

export const assignmentCancel = z.object({
  id: uuid,
  reason: z.string().optional(),
  idempotency_key: idempotencyKey,
});

// -- Context Entry schemas --

const contextTag = z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*$/);

export const contextEvidence = z.object({
  source_type: z.string().min(1).default('raw_context')
    .describe('Where the evidence came from, such as activity, email, transcript, mcp, context_api, crm_sync, warehouse_sync, support, product_usage, slack, or research.'),
  source_id: z.string().optional()
    .describe('CRMy record ID for the source when available.'),
  source_ref: z.string().optional()
    .describe('External or human-readable source reference.'),
  source_url: z.string().optional()
    .describe('URL or deep link to the source system when available.'),
  source_label: z.string().optional()
    .describe('Human-readable source label, such as the meeting title or email subject.'),
  speaker: z.string().optional()
    .describe('Speaker or author for quoted evidence when known.'),
  snippet: z.string().max(5000).optional()
    .describe('Short quote or excerpt supporting the claim.'),
  observed_at: z.string().optional()
    .describe('When the source event happened.'),
  captured_at: z.string().optional()
    .describe('When CRMy captured or processed the source.'),
  confidence: z.number().min(0).max(1).optional()
    .describe('How strongly this evidence supports the claim.'),
  rationale: z.string().max(2000).optional()
    .describe('Why this evidence supports the claim.'),
  verified_at: z.string().optional()
    .describe('When a human or policy last verified this evidence.'),
  verified_by: uuid.optional()
    .describe('Actor who verified this evidence.'),
}).passthrough().refine(
  item => Boolean(item.source_id || item.source_ref || item.source_url || item.snippet),
  { message: 'Evidence must include at least a source ID, source reference, source URL, or snippet.' },
);

export const contextEntryCreate = z.object({
  subject_type: subjectType,
  subject_id: uuid,
  context_type: z.string().min(1),
  title: z.string().optional(),
  body: z.string().min(1).max(50000),
  structured_data: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).optional(),
  memory_status: memoryStatus.optional().default('active'),
  evidence: z.array(contextEvidence).optional().default([]),
  tags: z.array(contextTag).max(20).default([]),
  source: z.string().optional(),
  source_ref: z.string().optional(),
  source_activity_id: uuid.optional(),
  valid_until: z.string().optional(),
  // Note-style fields (used when context_type = 'note')
  parent_id: uuid.optional(),
  visibility: z.enum(['internal', 'external']).default('internal'),
  mentions: z.array(z.string()).default([]),
  pinned: z.boolean().default(false),
  allow_similar: z.boolean().optional().default(false)
    .describe('Bypass context convergence warnings and create a separate current entry even when similar or conflicting current context exists. Prefer context_supersede unless the new entry is intentionally distinct.'),
  idempotency_key: idempotencyKey,
});

export const contextEntryGet = z.object({ id: uuid });

export const contextEntrySearch = z.object({
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  context_type: z.string().optional(),
  authored_by: uuid.optional(),
  memory_status: memoryStatus.optional(),
  is_current: z.boolean().optional(),
  query: z.string().optional(),
  /** Partial JSONB match against structured_data. Example: { "severity": "critical" } */
  structured_data_filter: z.record(z.unknown()).optional(),
  // Note-style filters
  visibility: z.enum(['internal', 'external']).optional(),
  pinned: z.boolean().optional(),
  limit,
  cursor,
});

export const contextEntrySupersede = z.object({
  id: uuid,
  body: z.string().min(1).max(50000),
  title: z.string().optional(),
  structured_data: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  tags: z.array(contextTag).max(20).optional(),
  idempotency_key: idempotencyKey,
});

export const contextSignalPromote = z.object({
  id: uuid,
  body: z.string().min(1).max(50000).optional(),
  title: z.string().optional(),
  structured_data: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  tags: z.array(contextTag).max(20).optional(),
  idempotency_key: idempotencyKey,
});

export const contextSignalGroupCompleteDetails = z.object({
  id: uuid,
  structured_data_patch: z.record(z.unknown()),
  idempotency_key: idempotencyKey,
});

export const contextSignalGroupHandoff = z.object({
  id: uuid,
  assignee_actor_id: uuid.optional(),
  reason: z.string().max(1000).optional(),
  note: z.string().max(5000).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  idempotency_key: idempotencyKey,
});

export const contextSignalReject = z.object({
  id: uuid,
  reason: z.string().max(1000).optional(),
  idempotency_key: idempotencyKey,
});

export const activityGetTimeline = z.object({
  subject_type: subjectType,
  subject_id: uuid,
  limit: limit.default(50),
  types: z.array(activityType).optional(),
});

// -- Priority 5-8 schemas --

/** context_diff — catch-up briefing showing what changed since a given timestamp */
export const contextDiff = z.object({
  subject_type: subjectType,
  subject_id: uuid,
  /** Relative ("7d", "24h", "30m") or ISO timestamp */
  since: z.string(),
  limit: z.number().int().min(1).max(100).default(50)
    .describe('Maximum entries to return per diff bucket. If more changes exist, the response marks that bucket as truncated.'),
});

/**
 * actor_expertise — query actor knowledge contributions.
 * Provide actor_id to see what subjects an actor knows about.
 * Provide subject_type + subject_id to see which actors know most about a subject.
 * At least one must be provided.
 */
export const actorExpertise = z.object({
  actor_id: uuid.optional(),
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

/**
 * context_ingest — ingest a raw document (transcript, email, notes) and auto-extract context.
 * Creates an activity from the document and runs the full extraction pipeline.
 * Returns all context entries that were extracted.
 */
export const contextIngest = z.object({
  subject_type: subjectType,
  subject_id: uuid,
  document: z.string().min(1).max(100000),
  /** Short description of the document (appears as the activity subject) */
  source_label: z.string().optional(),
  idempotency_key: idempotencyKey,
});

/** Governed product knowledge retrieval request (optional, non-blocking). */
export const knowledgeRetrieve = z.object({
  query: z.string().min(1).describe('What product/competitive context the agent needs for this customer action.'),
  subject_type: subjectType.optional().describe('Optional customer subject to tailor relevance.'),
  subject_id: uuid.optional(),
  audience: z.enum(['customer_facing', 'internal']).optional().default('customer_facing')
    .describe('customer_facing applies the strict approved+grounded+fresh policy; internal allows labeled warnings.'),
  proposed_action: z.string().optional().describe('e.g. customer_outreach — used for policy and proof linkage.'),
  product_scope: z.array(z.string()).optional().describe('Product/edition scopes to match, e.g. ["mcp","self-hosted"].'),
  competitor: z.string().optional(),
  persona: z.string().optional(),
  industry: z.string().optional(),
  require_approved: z.boolean().optional(),
  include_stale: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(50).optional().default(8),
});

/** Admin/governance write path for a product knowledge claim envelope. */
export const knowledgeClaimUpsert = z.object({
  idempotency_key: idempotencyKey,
  external_key: z.string().max(256).optional().describe('Stable dedupe key from the source; re-upserts update in place.'),
  knowledge_type: z.enum(['company', 'product', 'competitor']).optional()
    .describe('High-level claim facet used by the Knowledge workspace. Defaults from category/scope when omitted.'),
  category: z.string().min(1).describe('e.g. capability, proof_point, pricing, implementation, security, competitive_response.'),
  title: z.string().min(1),
  body: z.string().min(1),
  summary: z.string().optional(),
  product_scope: z.array(z.string()).optional(),
  competitors: z.array(z.string()).optional(),
  personas: z.array(z.string()).optional(),
  industries: z.array(z.string()).optional(),
  source_ref: z.string().optional(),
  source_url: z.string().optional(),
  source_label: z.string().optional(),
  source_version: z.string().optional(),
  /** Source text the claim is drawn from. When provided, CRMy verifies the claim is grounded in it. */
  source_text: z.string().max(200000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  source_priority: z.enum(['authoritative', 'secondary', 'informal']).optional(),
  approval_status: z.enum(['approved', 'pending', 'unapproved', 'rejected']).optional(),
  approved_for_external_use: z.boolean().optional(),
  visibility: z.enum(['external', 'internal']).optional(),
  status: z.enum(['active', 'stale', 'deprecated', 'conflicting', 'rejected']).optional(),
  effective_at: z.string().optional(),
  valid_until: z.string().optional(),
});

/** Governance: list claim envelopes for the admin review queue (Phase 7). */
export const knowledgeClaimList = z.object({
  knowledge_type: z.enum(['company', 'product', 'competitor']).optional()
    .describe('Filter by high-level Knowledge workspace facet. Legacy claims are inferred from category and competitor scope.'),
  status: z.enum(['active', 'stale', 'deprecated', 'conflicting', 'rejected']).optional()
    .describe('Filter by lifecycle status.'),
  approval_status: z.enum(['approved', 'pending', 'unapproved', 'rejected']).optional(),
  needs_review: z.boolean().optional()
    .describe('Shortcut for the review queue: claims that are stale, conflicting, or pending approval.'),
  review_owner_id: uuid.optional().describe('Filter to claims owned by a specific review owner.'),
  query: z.string().optional().describe('Full-text filter over title/body/summary.'),
  limit: z.number().int().min(1).max(100).optional().default(25),
});

/** Governance: apply an admin review decision to a claim envelope (Phase 7). */
export const knowledgeClaimReview = z.object({
  id: uuid,
  decision: z.enum(['approve', 'reject', 'deprecate', 'mark_stale', 'reactivate'])
    .describe('approve marks approved + re-verifies freshness; reject/deprecate retire it; mark_stale forces review; reactivate restores a stale/deprecated claim.'),
  approved_for_external_use: z.boolean().optional()
    .describe('Set customer-facing eligibility. Only honored with an approve decision.'),
  review_owner_id: uuid.optional().describe('Assign or transfer the review owner.'),
  idempotency_key: idempotencyKey,
});

/** Governance: detect competing product claims with source-priority resolution (Phase 7). */
export const knowledgeConflictsDetect = z.object({
  idempotency_key: idempotencyKey,
  category: z.string().optional().describe('Limit detection to a single claim category.'),
  competitor: z.string().optional().describe('Limit detection to claims about one competitor.'),
  apply: z.boolean().optional().default(false)
    .describe('When true, mark the lower-priority claim of each resolvable conflict as status=conflicting.'),
  limit: z.number().int().min(1).max(100).optional().default(50),
});
