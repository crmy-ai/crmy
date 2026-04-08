// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import * as S from '@crmy/shared';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// -- Shared response schemas --

export const ProblemDetail = registry.register(
  'ProblemDetail',
  z.object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
  }).openapi({ description: 'RFC 7807 problem detail' }),
);

const paginatedBase = z.object({
  next_cursor: z.string().nullable().optional(),
  total: z.number().int().optional(),
});

export const PaginatedContacts = registry.register(
  'PaginatedContacts',
  paginatedBase.extend({ data: z.array(z.object({
    id: S.uuid,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    company_name: z.string().optional(),
    account_id: S.uuid.optional(),
    lifecycle_stage: S.lifecycleStage,
    tags: z.array(z.string()),
    created_at: z.string(),
  })) }),
);

export const ContactRecord = registry.register(
  'ContactRecord',
  z.object({
    id: S.uuid,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    company_name: z.string().optional(),
    account_id: S.uuid.optional(),
    lifecycle_stage: S.lifecycleStage,
    tags: z.array(z.string()),
    custom_fields: z.record(z.unknown()),
    created_at: z.string(),
    updated_at: z.string(),
  }),
);

export const AccountRecord = registry.register(
  'AccountRecord',
  z.object({
    id: S.uuid,
    name: z.string(),
    domain: z.string().optional(),
    industry: z.string().optional(),
    employee_count: z.number().optional(),
    annual_revenue: z.number().optional(),
    health_score: z.number().optional(),
    tags: z.array(z.string()),
    created_at: z.string(),
  }),
);

export const OpportunityRecord = registry.register(
  'OpportunityRecord',
  z.object({
    id: S.uuid,
    name: z.string(),
    account_id: S.uuid.optional(),
    contact_id: S.uuid.optional(),
    amount: z.number().optional(),
    currency_code: z.string(),
    stage: S.oppStage,
    probability: z.number().optional(),
    forecast_cat: S.forecastCat.optional(),
    close_date: z.string().optional(),
    created_at: z.string(),
  }),
);

export const UseCaseRecord = registry.register(
  'UseCaseRecord',
  z.object({
    id: S.uuid,
    account_id: S.uuid,
    name: z.string(),
    stage: S.useCaseStage,
    consumption_current: z.number().optional(),
    consumption_capacity: z.number().optional(),
    attributed_arr: z.number().optional(),
    health_score: z.number().optional(),
    tags: z.array(z.string()),
    created_at: z.string(),
  }),
);

export const ContextEntryRecord = registry.register(
  'ContextEntryRecord',
  z.object({
    id: S.uuid,
    subject_type: S.subjectType,
    subject_id: S.uuid,
    context_type: z.string(),
    title: z.string().optional(),
    body: z.string(),
    confidence: z.number().optional(),
    tags: z.array(z.string()),
    is_current: z.boolean(),
    valid_until: z.string().optional(),
    created_at: z.string(),
  }),
);

export const AssignmentRecord = registry.register(
  'AssignmentRecord',
  z.object({
    id: S.uuid,
    title: z.string(),
    assignment_type: z.string(),
    assigned_to: S.uuid,
    status: S.assignmentStatus,
    priority: S.assignmentPriority,
    subject_type: S.subjectType.optional(),
    subject_id: S.uuid.optional(),
    due_at: z.string().optional(),
    created_at: z.string(),
  }),
);

export const ActorRecord = registry.register(
  'ActorRecord',
  z.object({
    id: S.uuid,
    actor_type: S.actorType,
    display_name: z.string(),
    agent_identifier: z.string().optional(),
    agent_model: z.string().optional(),
    scopes: z.array(z.string()),
    is_active: z.boolean(),
    created_at: z.string(),
  }),
);

const genericList = z.object({ data: z.array(z.record(z.unknown())), next_cursor: z.string().nullable().optional(), total: z.number().optional() });
export const GenericList = registry.register('GenericList', genericList);
export const GenericObject = registry.register('GenericObject', z.record(z.unknown()));
export const SuccessResult = registry.register('SuccessResult', z.object({ success: z.boolean() }));

// -- Request schemas --

export const Req = {
  // Auth
  AuthRegister: registry.register('AuthRegister', S.authRegister),
  AuthLogin: registry.register('AuthLogin', S.authLogin),
  ApiKeyCreate: registry.register('ApiKeyCreate', S.apiKeyCreate),

  // Contacts
  ContactCreate: registry.register('ContactCreate', S.contactCreate),
  ContactUpdate: registry.register('ContactUpdate', S.contactUpdate.shape.patch),
  ContactSearch: registry.register('ContactSearch', S.contactSearch),
  ContactSetLifecycle: registry.register('ContactSetLifecycle', S.contactSetLifecycle.omit({ id: true })),

  // Accounts
  AccountCreate: registry.register('AccountCreate', S.accountCreate),
  AccountUpdate: registry.register('AccountUpdate', S.accountUpdate.shape.patch),
  AccountSearch: registry.register('AccountSearch', S.accountSearch),
  AccountSetHealth: registry.register('AccountSetHealth', S.accountSetHealth.omit({ id: true })),

  // Opportunities
  OpportunityCreate: registry.register('OpportunityCreate', S.opportunityCreate),
  OpportunityUpdate: registry.register('OpportunityUpdate', S.opportunityUpdate.shape.patch),
  OpportunitySearch: registry.register('OpportunitySearch', S.opportunitySearch),
  OpportunityAdvanceStage: registry.register('OpportunityAdvanceStage', S.opportunityAdvanceStage.omit({ id: true })),

  // Activities
  ActivityCreate: registry.register('ActivityCreate', S.activityCreate),
  ActivityUpdate: registry.register('ActivityUpdate', S.activityUpdate.shape.patch),
  ActivitySearch: registry.register('ActivitySearch', S.activitySearch),
  ActivityComplete: registry.register('ActivityComplete', S.activityComplete.omit({ id: true })),

  // Use Cases
  UseCaseCreate: registry.register('UseCaseCreate', S.useCaseCreate),
  UseCaseUpdate: registry.register('UseCaseUpdate', S.useCaseUpdate.shape.patch),
  UseCaseSearch: registry.register('UseCaseSearch', S.useCaseSearch),
  UseCaseUpdateConsumption: registry.register('UseCaseUpdateConsumption', S.useCaseUpdateConsumption.omit({ id: true })),
  UseCaseSetHealth: registry.register('UseCaseSetHealth', S.useCaseSetHealth.omit({ id: true })),
  UseCaseLinkContact: registry.register('UseCaseLinkContact', S.useCaseLinkContact.omit({ use_case_id: true })),

  // HITL
  HitlSubmit: registry.register('HitlSubmit', S.hitlSubmit),
  HitlResolve: registry.register('HitlResolve', S.hitlResolve.omit({ request_id: true })),

  // Actors
  ActorCreate: registry.register('ActorCreate', S.actorCreate),
  ActorUpdate: registry.register('ActorUpdate', S.actorUpdate.shape.patch),
  ActorSearch: registry.register('ActorSearch', S.actorSearch),

  // Assignments
  AssignmentCreate: registry.register('AssignmentCreate', S.assignmentCreate),
  AssignmentUpdate: registry.register('AssignmentUpdate', S.assignmentUpdate.shape.patch),
  AssignmentSearch: registry.register('AssignmentSearch', S.assignmentSearch),
  AssignmentDecline: registry.register('AssignmentDecline', z.object({ reason: z.string().optional() })),
  AssignmentBlock: registry.register('AssignmentBlock', z.object({ reason: z.string().optional() })),
  AssignmentCancel: registry.register('AssignmentCancel', z.object({ reason: z.string().optional() })),
  AssignmentComplete: registry.register('AssignmentComplete', S.assignmentComplete.omit({ id: true })),

  // Context Entries
  ContextEntryCreate: registry.register('ContextEntryCreate', S.contextEntryCreate),
  ContextEntrySupersede: registry.register('ContextEntrySupersede', S.contextEntrySupersede.omit({ id: true })),
  ContextSearch: registry.register('ContextSearch', S.contextSearch),
  ContextEntrySearch: registry.register('ContextEntrySearch', S.contextEntrySearch),
  ContextStaleList: registry.register('ContextStaleList', S.contextStaleList),

  // Briefing
  BriefingGet: registry.register('BriefingGet', S.briefingGet.omit({ subject_type: true, subject_id: true })),

  // Webhooks
  WebhookCreate: registry.register('WebhookCreate', S.webhookCreate),
  WebhookUpdate: registry.register('WebhookUpdate', S.webhookUpdate.shape.patch),
  WebhookList: registry.register('WebhookList', S.webhookList),
  WebhookListDeliveries: registry.register('WebhookListDeliveries', S.webhookListDeliveries),

  // Emails
  EmailCreate: registry.register('EmailCreate', S.emailCreate),
  EmailSearch: registry.register('EmailSearch', S.emailSearch),

  // Custom Fields
  CustomFieldCreate: registry.register('CustomFieldCreate', S.customFieldCreate),
  CustomFieldUpdate: registry.register('CustomFieldUpdate', S.customFieldUpdate.shape.patch),

  // Workflows
  WorkflowCreate: registry.register('WorkflowCreate', S.workflowCreate),
  WorkflowUpdate: registry.register('WorkflowUpdate', S.workflowUpdate.shape.patch),
  WorkflowList: registry.register('WorkflowList', S.workflowList),
  WorkflowRunList: registry.register('WorkflowRunList', S.workflowRunList),

  // Registries
  ActivityTypeAdd: registry.register('ActivityTypeAdd', S.activityTypeRegistryAdd),
  ContextTypeAdd: registry.register('ContextTypeAdd', S.contextTypeRegistryAdd),
};
