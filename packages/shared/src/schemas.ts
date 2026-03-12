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
export const activityType = z.enum(['call', 'email', 'meeting', 'note', 'task']);
export const direction = z.enum(['inbound', 'outbound']);
export const userRole = z.enum(['owner', 'admin', 'member']);

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
  limit,
  cursor,
});

export const activityComplete = z.object({
  id: uuid,
  completed_at: z.string().optional(),
  note: z.string().optional(),
});

// -- Contact log activity (convenience) --

export const contactLogActivity = z.object({
  contact_id: uuid,
  type: activityType,
  subject: z.string().min(1),
  body: z.string().optional(),
  opportunity_id: uuid.optional(),
  due_at: z.string().optional(),
  direction: direction.optional(),
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
});

// -- Use Case schemas --

export const useCaseStage = z.enum(['discovery', 'onboarding', 'active', 'at_risk', 'churned', 'expansion']);

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

export const emailSequenceEnroll = z.object({
  sequence_id: uuid,
  contact_id: uuid,
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

// -- Note schemas --

const noteObjectType = z.enum(['contact', 'account', 'opportunity', 'activity', 'use_case']);
const noteVisibility = z.enum(['internal', 'external']);

export const noteCreate = z.object({
  object_type: noteObjectType,
  object_id: uuid,
  parent_id: uuid.optional(),
  body: z.string().min(1),
  visibility: noteVisibility.default('internal'),
  mentions: z.array(z.string()).default([]),
  pinned: z.boolean().default(false),
});

export const noteUpdate = z.object({
  id: uuid,
  patch: z.object({
    body: z.string().min(1).optional(),
    visibility: noteVisibility.optional(),
    pinned: z.boolean().optional(),
  }),
});

export const noteGet = z.object({ id: uuid });
export const noteDelete = z.object({ id: uuid });

export const noteList = z.object({
  object_type: noteObjectType,
  object_id: uuid,
  visibility: noteVisibility.optional(),
  pinned: z.boolean().optional(),
  limit,
  cursor,
});

// -- Workflow schemas --

const workflowActionType = z.enum([
  'send_notification', 'update_field', 'create_activity',
  'add_tag', 'remove_tag', 'assign_owner', 'create_note', 'webhook',
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
