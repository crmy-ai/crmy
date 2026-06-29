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
  total_is_estimate: z.boolean().optional(),
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
    grounding_method: S.contextGroundingMethod.optional(),
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

export const MessagingChannelRecord = registry.register(
  'MessagingChannelRecord',
  z.object({
    id: S.uuid,
    name: z.string(),
    provider: z.string(),
    config: z.record(z.unknown()).optional(),
    is_active: z.boolean(),
    is_default: z.boolean().optional(),
    created_at: z.string(),
    updated_at: z.string().optional(),
  }),
);

export const SequenceRecord = registry.register(
  'SequenceRecord',
  z.object({
    id: S.uuid,
    name: z.string(),
    description: z.string().optional(),
    steps: z.array(S.sequenceStep),
    is_active: z.boolean(),
    channel_types: z.array(z.string()).optional(),
    goal_event: z.string().optional(),
    exit_on_reply: z.boolean().optional(),
    ai_persona: z.string().optional(),
    tags: z.array(z.string()).optional(),
    created_at: z.string(),
    updated_at: z.string().optional(),
  }),
);

export const SequenceEnrollmentRecord = registry.register(
  'SequenceEnrollmentRecord',
  z.object({
    id: S.uuid,
    sequence_id: S.uuid,
    contact_id: S.uuid,
    status: z.enum(['active', 'completed', 'paused', 'cancelled']),
    current_step: z.number().int(),
    next_send_at: z.string().nullable().optional(),
    enrolled_by: z.string().optional(),
    objective: z.string().optional(),
    variables: z.record(z.unknown()).optional(),
    created_at: z.string(),
    updated_at: z.string().optional(),
  }),
);

const activeSequenceEnrollment = registry.register('ActiveSequenceEnrollment', z.object({
  enrollment_id: S.uuid,
  sequence_id: S.uuid,
  sequence_name: z.string(),
  current_step: z.number().int(),
  total_steps: z.number().int(),
  status: z.enum(['active', 'paused']),
  next_send_at: z.string().optional(),
  objective: z.string().optional(),
  goal_event: z.string().optional(),
  enrolled_by_actor_id: S.uuid.optional(),
}));

const contradictionWarning = registry.register('ContradictionWarning', z.object({
  entry_a: ContextEntryRecord,
  entry_b: ContextEntryRecord,
  conflict_field: z.string(),
  conflict_evidence: z.string(),
  suggested_action: z.enum(['supersede_older', 'supersede_lower_confidence', 'manual_review']),
  detected_at: z.string(),
}));

const adjacentContext = registry.register('AdjacentContext', z.object({
  subject_type: S.subjectType,
  subject_id: S.uuid,
  context_entries: z.record(z.array(ContextEntryRecord)),
}));

const briefingShape = registry.register('Briefing', z.object({
  subject: z.record(z.unknown()),
  subject_type: S.subjectType,
  related_objects: z.record(z.array(z.record(z.unknown()))),
  activities: z.array(z.record(z.unknown())),
  open_assignments: z.array(AssignmentRecord),
  context_entries: z.record(z.array(ContextEntryRecord)),
  signals: z.record(z.array(ContextEntryRecord)).optional(),
  signal_groups: z.array(z.record(z.unknown())).optional(),
  staleness_warnings: z.array(ContextEntryRecord),
  active_sequences: z.array(activeSequenceEnrollment).optional(),
  contradiction_warnings: z.array(contradictionWarning).optional(),
  adjacent_context: z.array(adjacentContext).optional(),
  token_estimate: z.number().int().optional(),
  truncated: z.boolean().optional(),
  dropped_entries: z.array(z.object({
    context_type: z.string(),
    title: z.string().optional(),
    confidence: z.number().optional(),
  })).optional(),
  context_packing: z.object({
    token_budget_profile: S.tokenBudgetProfile.optional(),
    token_budget: z.number().int().optional(),
    evidence_mode: S.evidenceMode,
    ranking_strategy: z.string(),
  }).optional(),
}));

export const BriefingResponse = registry.register('BriefingResponse', z.object({
  briefing: briefingShape.optional(),
  briefing_text: z.string().optional(),
}).openapi({
  description: 'JSON briefing by default. When format=text is requested, briefing_text is returned instead.',
}));

const genericList = z.object({
  data: z.array(z.record(z.unknown())),
  next_cursor: z.string().nullable().optional(),
  total: z.number().optional(),
  total_is_estimate: z.boolean().optional(),
});
export const GenericList = registry.register('GenericList', genericList);
export const GenericObject = registry.register('GenericObject', z.record(z.unknown()));
export const SuccessResult = registry.register('SuccessResult', z.object({ success: z.boolean() }));

const contextLineageNode = registry.register('ContextLineageNode', z.object({
  id: z.string(),
  type: z.enum(['record', 'raw_context', 'activity', 'signal', 'signal_group', 'memory', 'retrieval', 'handoff', 'writeback', 'audit']),
  label: z.string(),
  timestamp: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  subject_type: S.subjectType.nullable().optional(),
  subject_id: S.uuid.nullable().optional(),
  object_id: z.string().nullable().optional(),
  stage: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  data: z.record(z.unknown()).optional(),
}));

const contextLineageEdge = registry.register('ContextLineageEdge', z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  relation: z.string(),
  data: z.record(z.unknown()).optional(),
}));

const contextLineageOutcome = registry.register('ContextLineageOutcome', z.object({
  kind: z.enum(['handoff', 'writeback', 'activity', 'action_receipt', 'audit']),
  label: z.string(),
  status: z.string(),
  occurred_at: z.string().optional(),
  object_id: z.string().optional(),
  node_id: z.string(),
  impact: z.enum(['completed', 'pending', 'failed', 'informational']),
  follow_up: z.string().optional(),
}));

export const ContextLineageResponse = registry.register('ContextLineageResponse', z.object({
  lineage: z.object({
    nodes: z.array(contextLineageNode),
    edges: z.array(contextLineageEdge),
    outcomes: z.object({
      recent: z.array(contextLineageOutcome),
      pending: z.array(contextLineageOutcome),
      failed: z.array(contextLineageOutcome),
      completed_count: z.number().int(),
      pending_count: z.number().int(),
      failed_count: z.number().int(),
      recommended_follow_up: z.array(z.string()),
    }).optional(),
    summary: z.object({
      records: z.number().int(),
      raw_context: z.number().int(),
      signals: z.number().int(),
      signal_groups: z.number().int(),
      memory: z.number().int(),
      retrievals: z.number().int().optional(),
      action_receipts: z.number().int().optional(),
      handoffs: z.number().int(),
      writebacks: z.number().int(),
      audit_events: z.number().int(),
    }),
  }),
}));

const actionContextStatus = z.enum(['ready', 'review_needed', 'blocked']);
const actionContextRiskLevel = z.enum(['low', 'medium', 'high']);
const actionContextOperatingMode = z.enum(['inform', 'warn', 'require_review']);
const actionContextProposedActionType = z.enum([
  'customer_outreach',
  'assignment_create',
  'memory_promote',
  'record_update',
  'external_writeback',
  'sequence_step',
  'workflow_action',
  'agent_task',
]);

const actionContextPacketEvidence = registry.register('ActionContextPacketEvidence', z.object({
  source_type: z.string().optional(),
  source_id: z.string().optional(),
  source_ref: z.string().optional(),
  source_label: z.string().optional(),
  observed_at: z.string().optional(),
  snippet: z.string().optional(),
  confidence: z.number().optional(),
}));

const actionContextPacketItem = registry.register('ActionContextPacketItem', z.object({
  kind: z.enum([
    'memory',
    'signal',
    'signal_group',
    'stale_memory',
    'contradiction',
    'assignment',
    'source_authority',
    'policy',
    'permission',
  ]),
  id: z.string().optional(),
  context_type: z.string().optional(),
  title: z.string(),
  summary: z.string(),
  status: z.string().optional(),
  confidence: z.number().optional(),
  evidence_refs: z.array(actionContextPacketEvidence).optional(),
}));

const actionContextSourcePosture = registry.register('ActionContextSourcePosture', z.object({
  summary: z.string(),
  dominant_source: z.enum(['customer_authored', 'seller_authored', 'system_of_record', 'internal', 'mixed', 'unknown']),
  counts: z.object({
    customer_authored: z.number().int(),
    seller_authored: z.number().int(),
    system_of_record: z.number().int(),
    internal: z.number().int(),
    unknown: z.number().int(),
  }),
  customer_authored_claims_present: z.boolean(),
  seller_authored_context_present: z.boolean(),
  weak_or_unknown_sources_present: z.boolean(),
  instructions: z.array(z.string()),
}));

const actionContextRecommendedAction = registry.register('ActionContextRecommendedAction', z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  priority: z.enum(['primary', 'secondary', 'background']),
  can_execute_now: z.boolean(),
  customer_or_system_effect: z.boolean(),
  requires_human_review: z.boolean(),
  next_tool: z.string().optional(),
  reason_refs: z.array(z.string()).optional(),
  proposed_action_type: actionContextProposedActionType.optional(),
}));

const actionContextActionPacket = registry.register('ActionContextActionPacket', z.object({
  version: z.literal('crmy.action_context.v1'),
  action_type: actionContextProposedActionType.optional(),
  objective: z.string(),
  status: actionContextStatus,
  risk_level: actionContextRiskLevel,
  operating_mode: actionContextOperatingMode,
  can_execute: z.boolean(),
  agent_instructions: z.array(z.string()),
  use_as_truth: z.array(actionContextPacketItem),
  use_with_caution: z.array(actionContextPacketItem),
  do_not_use_as_truth: z.array(actionContextPacketItem),
  evidence_to_cite: z.array(actionContextPacketItem),
  source_posture: actionContextSourcePosture,
  recommended_actions: z.array(actionContextRecommendedAction),
  action_boundaries: z.object({
    allowed: z.array(z.string()),
    warnings: z.array(z.string()),
    blocked: z.array(z.string()),
    required_review: z.array(z.string()),
  }),
  human_unblock: z.object({
    required: z.boolean(),
    question: z.string(),
    reasons: z.array(z.string()),
    handoff_type: z.enum(['assignment', 'signal_review', 'policy_approval', 'source_conflict']).optional(),
  }).optional(),
  next_tools: z.array(z.string()),
}));

const actionContextShape = z.object({
  subject_type: S.subjectType,
  subject_id: S.uuid,
  generated_at: z.string(),
  operating_mode: actionContextOperatingMode,
  guidance: z.object({
    summary: z.string(),
    can_execute: z.boolean(),
    warning_reasons: z.array(z.string()),
    review_reasons: z.array(z.string()),
    recommended_next_steps: z.array(z.string()),
  }),
  action_packet: actionContextActionPacket,
  briefing: z.record(z.unknown()).openapi({ description: 'Briefing payload for the same subject.' }),
  readiness: z.object({
    status: actionContextStatus,
    risk_level: actionContextRiskLevel,
    reasons: z.array(z.string()),
    blockers: z.array(z.string()),
    review_required: z.boolean(),
  }),
  checks: z.record(z.unknown()),
  allowed_actions: z.array(z.record(z.unknown())),
  required_handoffs: z.array(z.record(z.unknown())),
  proof: z.record(z.unknown()),
});

export const ActionContextResponse = registry.register('ActionContextResponse', z.object({
  action_context: actionContextShape,
}));

export const ActionContextHumanUnblockResponse = registry.register('ActionContextHumanUnblockResponse', z.object({
  created_type: z.enum(['approval', 'assignment']),
  request_id: S.uuid.optional(),
  assignment_id: S.uuid.optional(),
  assignment: z.record(z.unknown()).optional(),
  status: z.string().optional(),
  snapshot_id: S.uuid,
  event_id: S.uuid,
  action_packet: actionContextActionPacket,
  mutation: z.record(z.unknown()),
}));

const oauthReadinessItemShape = z.object({
      kind: z.enum(['mailbox', 'calendar']),
      provider: z.enum(['google', 'microsoft']),
      label: z.string(),
      configured: z.boolean(),
      ready: z.boolean(),
      can_start_oauth: z.boolean(),
      setup_status: z.enum(['ready', 'tenant_app_incomplete', 'managed_app_unavailable', 'self_hosted_env_missing']),
      setup_blockers: z.array(z.string()),
      admin_action: z.string(),
      user_action: z.string(),
      redirect_uri: z.string(),
      callback_path: z.string(),
      accepted_env_vars: z.object({
        client_id: z.array(z.string()),
        client_secret: z.array(z.string()),
        redirect_uri: z.array(z.string()),
      }),
      configured_env_vars: z.array(z.string()),
      missing_env_vars: z.array(z.string()),
      scopes: z.object({
        context: z.array(z.string()),
        send: z.array(z.string()).optional(),
        drafts: z.array(z.string()).optional(),
      }),
      app_source: z.enum(['tenant_owned', 'crmy_managed', 'self_hosted_env', 'missing']),
      tenant_owned_configured: z.boolean(),
      crmy_managed_available: z.boolean(),
      self_hosted_env_configured: z.boolean(),
      hosted_managed_enabled: z.boolean(),
});

export const OAuthReadinessResponse = registry.register(
  'OAuthReadinessResponse',
  z.object({
    data: z.array(oauthReadinessItemShape),
    summary: z.record(z.number()),
  }),
);

export const OAuthConnectionStartResponse = registry.register(
  'OAuthConnectionStartResponse',
  z.object({
    connection: z.record(z.unknown()),
    auth_url: z.string().nullable(),
    oauth_ready: z.boolean(),
    setup_check: oauthReadinessItemShape,
    status: z.enum(['oauth_required', 'configuration_required']),
    message: z.string(),
  }),
);

export const TenantOAuthAppRecord = registry.register(
  'TenantOAuthAppRecord',
  z.object({
    id: S.uuid,
    tenant_id: S.uuid,
    provider: z.enum(['google', 'microsoft']),
    enabled: z.boolean(),
    client_id: z.string(),
    has_client_secret: z.boolean(),
    microsoft_tenant_id: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
);

const oauthReadyShape = z.object({
  google: z.boolean(),
  microsoft: z.boolean(),
});

export const MailboxConnectionListResponse = registry.register(
  'MailboxConnectionListResponse',
  genericList.extend({
    summary: z.record(z.unknown()).optional(),
    oauth_ready: oauthReadyShape,
  }),
);

export const CalendarConnectionListResponse = registry.register(
  'CalendarConnectionListResponse',
  genericList.extend({
    summary: z.record(z.unknown()).optional(),
    oauth_ready: oauthReadyShape,
  }),
);

export const ActorConnectionSummary = registry.register(
  'ActorConnectionSummary',
  z.object({
    data: z.array(z.object({
      actor_id: S.uuid,
      actor_name: z.string(),
      actor_type: z.enum(['human', 'agent']),
      is_active: z.boolean(),
      user_id: S.uuid.nullable().optional(),
      user_email: z.string().nullable().optional(),
      user_name: z.string().nullable().optional(),
      mailbox_connections: z.array(z.record(z.unknown())),
      calendar_connections: z.array(z.record(z.unknown())),
      mailbox_count: z.number().int(),
      calendar_count: z.number().int(),
      sender_count: z.number().int(),
      ready_sender_count: z.number().int(),
      connected_mailbox_count: z.number().int(),
      connected_calendar_count: z.number().int(),
      email_processed_count: z.number().int().optional(),
      calendar_processed_count: z.number().int().optional(),
      source_count: z.number().int().optional(),
      signal_count: z.number().int().optional(),
      memory_count: z.number().int().optional(),
    })),
    total: z.number().int(),
  }),
);

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
  AssignmentReviewQueue: registry.register('AssignmentReviewQueue', z.object({
    assigned_to: S.uuid.optional(),
    mine: z.boolean().optional(),
    subject_type: S.subjectType.optional(),
    subject_id: S.uuid.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })),
  AssignmentReviewResolve: registry.register('AssignmentReviewResolve', z.object({
    extend_days: z.number().int().min(1).max(730).optional(),
  })),
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
  SignalReadiness: registry.register('SignalReadiness', S.signalReadiness),
  SignalResolution: registry.register('SignalResolution', S.signalResolution),
  ContextSignalGroupCompleteDetails: registry.register('ContextSignalGroupCompleteDetails', S.contextSignalGroupCompleteDetails.omit({ id: true })),
  ContextSignalGroupHandoff: registry.register('ContextSignalGroupHandoff', S.contextSignalGroupHandoff.omit({ id: true })),

  // Briefing
  BriefingGet: registry.register('BriefingGet', S.briefingGet.omit({ subject_type: true, subject_id: true })),
  ActionContextGet: registry.register('ActionContextGet', S.actionContextGet),
  ActionContextHumanUnblock: registry.register('ActionContextHumanUnblock', S.actionContextHumanUnblock),

  // Webhooks
  WebhookCreate: registry.register('WebhookCreate', S.webhookCreate),
  WebhookUpdate: registry.register('WebhookUpdate', S.webhookUpdate.shape.patch),
  WebhookRotateSecret: registry.register('WebhookRotateSecret', S.webhookRotateSecret.omit({ id: true })),
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

  // Messaging
  MessagingChannelCreate: registry.register('MessagingChannelCreate', S.messagingChannelCreate),
  MessagingChannelUpdate: registry.register('MessagingChannelUpdate', S.messagingChannelUpdate.shape.patch),
  MessagingChannelList: registry.register('MessagingChannelList', S.messagingChannelList),

  // Sequences
  SequenceCreate: registry.register('SequenceCreate', S.sequenceCreate),
  SequenceUpdate: registry.register('SequenceUpdate', S.sequenceUpdate.shape.patch),
  SequenceList: registry.register('SequenceList', S.sequenceList),
  SequenceEnroll: registry.register('SequenceEnroll', S.sequenceEnroll.omit({ sequence_id: true })),
  SequenceEnrollmentList: registry.register('SequenceEnrollmentList', S.sequenceEnrollmentList),
  SequenceAnalytics: registry.register('SequenceAnalytics', S.sequenceAnalytics.omit({ sequence_id: true })),

  // Registries
  ActivityTypeAdd: registry.register('ActivityTypeAdd', S.activityTypeRegistryAdd),
  ContextTypeAdd: registry.register('ContextTypeAdd', S.contextTypeRegistryAdd),
};
