// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';

// -- Reusable primitives --

export const uuid = z.string().uuid();
export const cursor = z.string().optional();
export const limit = z.number().int().min(1).max(100).default(20);
export const lifecycleStage = z.enum(['lead', 'prospect', 'customer', 'churned']);
export const oppStage = z.enum(['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost']);
export const forecastCat = z.enum(['pipeline', 'best_case', 'commit', 'closed']);
export const activityType = z.enum(['call', 'email', 'meeting', 'note', 'task', 'demo', 'proposal', 'research', 'handoff', 'status_update']);
export const direction = z.enum(['inbound', 'outbound']);
export const userRole = z.enum(['owner', 'admin', 'member']);
export const subjectType = z.enum(['contact', 'account', 'opportunity', 'use_case']);

const tags = z.array(z.string()).default([]);
const customFields = z.record(z.unknown()).default({});

// -- Contact schemas --

export const contactCreate = z.object({
  first_name: z.string().min(1),
  last_name: z.string().default(''),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
  company_name: z.string().optional(),
  account_id: uuid.optional(),
  lifecycle_stage: lifecycleStage.default('lead'),
  aliases: z.array(z.string()).default([]),
  tags,
  custom_fields: customFields,
  source: z.string().optional(),
});

export const contactUpdate = z.object({
  id: uuid,
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
  aliases: z.array(z.string()).default([]),
  tags,
  custom_fields: customFields,
});

export const accountUpdate = z.object({
  id: uuid,
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
});

// -- Opportunity schemas --

export const opportunityCreate = z.object({
  name: z.string().min(1),
  account_id: uuid.optional(),
  contact_id: uuid.optional(),
  amount: z.number().optional(),
  currency_code: z.string().length(3).default('USD'),
  close_date: z.string().optional(),
  stage: oppStage.default('prospecting'),
  description: z.string().optional(),
  custom_fields: customFields,
});

export const opportunityUpdate = z.object({
  id: uuid,
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
});

export const activityUpdate = z.object({
  id: uuid,
  patch: z.object({
    subject: z.string().min(1).optional(),
    body: z.string().nullable().optional(),
    status: z.string().optional(),
    due_at: z.string().nullable().optional(),
    custom_fields: z.record(z.unknown()).optional(),
  }),
});

export const activitySearch = z.object({
  contact_id: uuid.optional(),
  account_id: uuid.optional(),
  opportunity_id: uuid.optional(),
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
});

// -- Compound action schemas --

export const dealAdvance = z.object({
  opportunity_id: uuid,
  stage: oppStage,
  note: z.string().optional(),
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

// -- Auth schemas --

export const authRegister = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  tenant_name: z.string().min(1),
});

export const authLogin = z.object({
  email: z.string().email(),
  password: z.string(),
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
});

export const useCaseUpdate = z.object({
  id: uuid,
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
export const useCaseDelete = z.object({ id: uuid });

export const useCaseAdvanceStage = z.object({
  id: uuid,
  stage: useCaseStage,
  note: z.string().optional(),
});

export const useCaseUpdateConsumption = z.object({
  id: uuid,
  consumption_current: z.number().int(),
  note: z.string().optional(),
});

export const useCaseSetHealth = z.object({
  id: uuid,
  score: z.number().int().min(0).max(100),
  rationale: z.string().optional(),
});

export const useCaseLinkContact = z.object({
  use_case_id: uuid,
  contact_id: uuid,
  role: z.string().default('stakeholder'),
});

export const useCaseUnlinkContact = z.object({
  use_case_id: uuid,
  contact_id: uuid,
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
});

export const webhookUpdate = z.object({
  id: uuid,
  patch: z.object({
    url: z.string().url().optional(),
    events: z.array(z.string()).optional(),
    active: z.boolean().optional(),
    description: z.string().nullable().optional(),
  }),
});

export const webhookDelete = z.object({ id: uuid });
export const webhookGet = z.object({ id: uuid });

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
});

export const emailGet = z.object({ id: uuid });

export const emailSearch = z.object({
  contact_id: uuid.optional(),
  status: z.enum(['draft', 'pending_approval', 'approved', 'sending', 'sent', 'failed', 'rejected']).optional(),
  limit,
  cursor,
});

export const emailProviderSet = z.object({
  provider: z.string().min(1),
  config: z.record(z.unknown()),
  from_name: z.string().min(1),
  from_email: z.string().email(),
});

export const emailProviderGet = z.object({});

export const emailSequenceCreate = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(z.object({
    delay_days: z.number().int().min(0),
    subject: z.string().min(1),
    body_html: z.string().optional(),
    body_text: z.string().optional(),
  })).min(1),
});

export const emailSequenceGet = z.object({ id: uuid });
export const emailSequenceDelete = z.object({ id: uuid });

export const emailSequenceUpdate = z.object({
  id: uuid,
  patch: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    steps: z.array(z.object({
      delay_days: z.number().int().min(0),
      subject: z.string().min(1),
      body_html: z.string().optional(),
      body_text: z.string().optional(),
    })).min(1).optional(),
    is_active: z.boolean().optional(),
  }),
});

export const emailSequenceList = z.object({
  is_active: z.boolean().optional(),
  limit,
  cursor,
});

export const emailSequenceEnroll = z.object({
  sequence_id: uuid,
  contact_id: uuid,
});

export const emailSequenceUnenroll = z.object({ id: uuid });

export const emailSequenceEnrollmentList = z.object({
  sequence_id: uuid.optional(),
  contact_id: uuid.optional(),
  status: z.enum(['active', 'completed', 'paused', 'cancelled']).optional(),
  limit,
  cursor,
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
});

export const customFieldUpdate = z.object({
  id: uuid,
  patch: z.object({
    label: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    default_value: z.unknown().optional(),
    sort_order: z.number().int().optional(),
  }),
});

export const customFieldDelete = z.object({ id: uuid });

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

const workflowActionType = z.enum([
  'send_notification', 'send_email', 'update_field', 'create_activity',
  'add_tag', 'remove_tag', 'assign_owner', 'create_context_entry', 'webhook',
  // 'create_note' kept for backward compat with stored workflows; engine aliases to create_context_entry
  'create_note',
]);

const workflowActionSchema = z.object({
  type: workflowActionType,
  config: z.record(z.unknown()),
});

export const workflowCreate = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger_event: z.string().min(1),
  trigger_filter: z.record(z.unknown()).default({}),
  actions: z.array(workflowActionSchema).min(1),
  is_active: z.boolean().default(true),
});

export const workflowUpdate = z.object({
  id: uuid,
  patch: z.object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    trigger_event: z.string().min(1).optional(),
    trigger_filter: z.record(z.unknown()).optional(),
    actions: z.array(workflowActionSchema).optional(),
    is_active: z.boolean().optional(),
  }),
});

export const workflowGet = z.object({ id: uuid });
export const workflowDelete = z.object({ id: uuid });

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
});

export const messagingChannelUpdate = z.object({
  id: uuid,
  patch: z.object({
    name: z.string().min(1).optional(),
    config: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
    is_default: z.boolean().optional(),
  }),
});

export const messagingChannelGet = z.object({ id: uuid });
export const messagingChannelDelete = z.object({ id: uuid });

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
});

export const activityTypeRegistryRemove = z.object({
  type_name: z.string().min(1),
});

export const activityTypeRegistryList = z.object({
  category: activityTypeCategory.optional(),
});

// -- Context Type Registry schemas --

export const contextTypeRegistryAdd = z.object({
  type_name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(200),
  description: z.string().optional(),
});

export const contextTypeRegistryRemove = z.object({
  type_name: z.string().min(1),
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
});

// -- Context search (full-text) schema --

export const contextSearch = z.object({
  query: z.string().min(1),
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  context_type: z.string().optional(),
  tag: z.string().optional(),
  current_only: z.boolean().default(true),
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
});

// -- Context review schema --

export const contextReview = z.object({
  id: uuid,
  extend_days: z.number().int().min(1).max(3650).optional()
    .describe('Extend valid_until by this many days from now. If omitted, uses the type\'s half_life_days or defaults to 30.'),
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
});

export const actorUpdate = z.object({
  id: uuid,
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
});

export const assignmentUpdate = z.object({
  id: uuid,
  patch: z.object({
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    priority: assignmentPriority.optional(),
    due_at: z.string().nullable().optional(),
    status: assignmentStatus.optional(),
    context: z.string().nullable().optional(),
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

export const assignmentAccept = z.object({ id: uuid });

export const assignmentComplete = z.object({
  id: uuid,
  completed_by_activity_id: uuid.optional(),
});

export const assignmentDecline = z.object({
  id: uuid,
  reason: z.string().optional(),
});

export const assignmentStart = z.object({ id: uuid });

export const assignmentBlock = z.object({
  id: uuid,
  reason: z.string().optional(),
});

export const assignmentCancel = z.object({
  id: uuid,
  reason: z.string().optional(),
});

// -- Context Entry schemas --

const contextTag = z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*$/);

export const contextEntryCreate = z.object({
  subject_type: subjectType,
  subject_id: uuid,
  context_type: z.string().min(1),
  title: z.string().optional(),
  body: z.string().min(1).max(50000),
  structured_data: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).optional(),
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
});

export const contextEntryGet = z.object({ id: uuid });

export const contextEntrySearch = z.object({
  subject_type: subjectType.optional(),
  subject_id: uuid.optional(),
  context_type: z.string().optional(),
  authored_by: uuid.optional(),
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
});
