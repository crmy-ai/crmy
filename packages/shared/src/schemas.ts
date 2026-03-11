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
  object_type: z.enum(['contact', 'account', 'opportunity', 'activity']),
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
