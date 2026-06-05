// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type {
  ActionContext,
  ActionContextAllowedAction,
  ActionContextCheckStatus,
  ActionContextGetInput,
  ActionContextPolicySummary,
  ActionContextProposedAction,
  ActionContextReadinessStatus,
  ActionContextRiskLevel,
  ActionContextSourceAuthoritySummary,
  ActorContext,
  Briefing,
  ContextEntry,
  ExternalObjectMapping,
  SignalGroup,
  SubjectType,
  UUID,
} from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import { actorHasScope } from '../auth/scopes.js';
import * as sorRepo from '../db/repos/systems-of-record.js';
import { emitEvent } from '../events/emitter.js';
import { assembleBriefing } from './briefing.js';
import { evaluateActionPolicy } from './action-policy.js';
import { assertSubjectAccess } from './access-control.js';

type WritableSubjectType = 'contact' | 'account' | 'opportunity' | 'use_case';

export interface DeriveActionReadinessInput {
  briefing: Briefing;
  systems: {
    mappings: ActionContextSourceAuthoritySummary[];
    open_conflict_count: number;
    pending_writeback_count: number;
    source_blockers: string[];
  };
  policy?: ActionContextPolicySummary;
  scope_blockers?: string[];
  proposed_action?: ActionContextProposedAction;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function flattenEntryGroups(groups?: Record<string, ContextEntry[]>): ContextEntry[] {
  return Object.values(groups ?? {}).flat();
}

function briefingMemoryEntries(briefing: Briefing): ContextEntry[] {
  return [
    ...flattenEntryGroups(briefing.context_entries),
    ...(briefing.adjacent_context ?? []).flatMap(item => flattenEntryGroups(item.context_entries)),
  ];
}

function briefingSignalEntries(briefing: Briefing): ContextEntry[] {
  return flattenEntryGroups(briefing.signals);
}

function allBriefingEntries(briefing: Briefing): ContextEntry[] {
  return [...briefingMemoryEntries(briefing), ...briefingSignalEntries(briefing)];
}

function actionPolicySummary(policy: ReturnType<typeof evaluateActionPolicy>): ActionContextPolicySummary {
  return {
    decision: policy.decision,
    reasons: policy.reasons,
    required_approval: policy.required_approval,
    required_evidence: policy.required_evidence,
    risk_level: policy.risk_level,
    policy: policy.policy,
  };
}

function writeScopeForSubject(subjectType: SubjectType): string {
  if (subjectType === 'use_case') return 'accounts:write';
  return `${subjectType}s:write`;
}

function readScopeForSubject(subjectType: SubjectType): string {
  if (subjectType === 'use_case') return 'accounts:read';
  return `${subjectType}s:read`;
}

function requiredScopesForAction(actionType: ActionContextProposedAction['action_type'], subjectType: SubjectType): string[] {
  switch (actionType) {
    case 'customer_outreach':
      return [readScopeForSubject(subjectType), 'activities:write'];
    case 'assignment_create':
      return ['assignments:write'];
    case 'memory_promote':
      return ['context:write'];
    case 'record_update':
      return [writeScopeForSubject(subjectType)];
    case 'external_writeback':
      return ['systems:write'];
    default:
      return [];
  }
}

function actionScopeStatus(
  actor: ActorContext,
  actionType: ActionContextProposedAction['action_type'],
  subjectType: SubjectType,
): ActionContextAllowedAction {
  const required_scopes = requiredScopesForAction(actionType, subjectType);
  const missing = required_scopes.filter(scope => !actorHasScope(actor, scope));
  return {
    action_type: actionType,
    status: missing.length > 0 ? 'blocked' : 'allowed',
    required_scopes,
    reasons: missing.length > 0
      ? [`Missing required scope${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`]
      : ['Actor has the required scopes for this action.'],
  };
}

function mapSourceAuthority(mapping: ExternalObjectMapping): ActionContextSourceAuthoritySummary {
  return {
    mapping_id: mapping.id,
    system_id: mapping.system_id,
    object_type: mapping.object_type,
    external_object: mapping.external_object,
    source_authority: mapping.source_authority,
    writable_fields: mapping.writable_fields ?? [],
    writeback_mode: mapping.writeback_mode,
    is_active: mapping.is_active,
  };
}

async function loadSourceAuthority(
  db: DbPool,
  tenantId: UUID,
  subjectType: SubjectType,
  subjectId: UUID,
  proposedAction?: ActionContextProposedAction,
): Promise<{
  mappings: ActionContextSourceAuthoritySummary[];
  open_conflict_count: number;
  pending_writeback_count: number;
  target_mapping?: ActionContextSourceAuthoritySummary;
  source_blockers: string[];
}> {
  const mappingRows = await sorRepo.listMappings(db, tenantId, {
    object_type: subjectType,
    is_active: true,
    limit: 50,
  }).catch(() => ({ data: [] as ExternalObjectMapping[], total: 0 }));

  const mappings = mappingRows.data.map(mapSourceAuthority);
  if (proposedAction?.mapping_id && !mappings.some(mapping => mapping.mapping_id === proposedAction.mapping_id)) {
    const direct = await sorRepo.getMapping(db, tenantId, proposedAction.mapping_id).catch(() => null);
    if (direct?.is_active) mappings.push(mapSourceAuthority(direct));
  }

  const conflicts = await sorRepo.listConflicts(db, tenantId, {
    object_type: subjectType,
    object_id: subjectId,
    status: 'open',
    limit: 50,
  }).catch(() => ({ data: [], total: 0 }));

  const pendingWritebacks = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM external_writeback_requests
     WHERE tenant_id = $1
       AND object_type = $2
       AND object_id = $3
       AND status IN ('pending', 'approval_required', 'approved', 'executing')`,
    [tenantId, subjectType, subjectId],
  ).then(result => Number(result.rows[0]?.count ?? 0)).catch(() => 0);

  const targetMapping = proposedAction?.action_type === 'external_writeback'
    ? mappings.find(mapping =>
      (proposedAction.mapping_id ? mapping.mapping_id === proposedAction.mapping_id : true)
      && (proposedAction.system_id ? mapping.system_id === proposedAction.system_id : true)
      && (proposedAction.external_object ? mapping.external_object === proposedAction.external_object : true)
      && (proposedAction.object_type ? mapping.object_type === proposedAction.object_type : true)
    )
    : undefined;

  const sourceBlockers: string[] = [];
  if (proposedAction?.action_type === 'external_writeback') {
    if (!targetMapping) {
      sourceBlockers.push('No active systems-of-record mapping matches the proposed external writeback.');
    } else {
      const requestedFields = unique([
        ...(proposedAction.field_names ?? []),
        ...Object.keys(proposedAction.payload ?? {}),
      ]);
      const nonWritable = requestedFields.filter(field => !targetMapping.writable_fields.includes(field));
      if (nonWritable.length > 0) {
        sourceBlockers.push(`Target mapping does not allow writes to: ${nonWritable.join(', ')}.`);
      }
    }
  }

  return {
    mappings,
    open_conflict_count: Number(conflicts.total ?? conflicts.data.length),
    pending_writeback_count: pendingWritebacks,
    target_mapping: targetMapping,
    source_blockers: sourceBlockers,
  };
}

function selectedEntries(briefing: Briefing, ids?: UUID[]): ContextEntry[] {
  if (!ids?.length) return [];
  const wanted = new Set(ids);
  return allBriefingEntries(briefing).filter(entry => wanted.has(entry.id));
}

function selectedSignalGroups(briefing: Briefing, ids?: UUID[]): SignalGroup[] {
  if (!ids?.length) return [];
  const wanted = new Set(ids);
  return (briefing.signal_groups ?? []).filter(group => wanted.has(group.id));
}

function policyActionType(actionType: ActionContextProposedAction['action_type']): string {
  if (actionType === 'memory_promote') return 'context.signal_promote';
  if (actionType === 'external_writeback') return 'external.writeback';
  if (actionType === 'record_update') return 'record.update';
  if (actionType === 'assignment_create') return 'assignment.create';
  return 'customer.outreach';
}

function evaluateProposedAction(
  actor: ActorContext,
  briefing: Briefing,
  proposedAction: ActionContextProposedAction | undefined,
  targetMapping?: ActionContextSourceAuthoritySummary,
): ActionContextPolicySummary | undefined {
  if (!proposedAction) return undefined;
  const entries = selectedEntries(briefing, proposedAction.source_context_entry_ids);
  const groups = selectedSignalGroups(briefing, proposedAction.signal_group_ids);
  const groupEvidence = groups
    .filter(group => Number(group.evidence_count ?? 0) > 0)
    .map(group => ({
      source_type: 'signal_group',
      source_id: group.id,
      source_ref: group.claim_key,
      source_label: group.title ?? group.normalized_claim,
      confidence: group.aggregate_confidence,
    }));
  const evidence = [
    ...entries.flatMap(entry => entry.evidence ?? []),
    ...groupEvidence,
  ];
  const confidenceValues = [
    ...entries.map(entry => entry.confidence).filter((value): value is number => typeof value === 'number'),
    ...groups.map(group => group.aggregate_confidence).filter((value): value is number => typeof value === 'number'),
  ];
  const usesSignal = proposedAction.action_type === 'memory_promote'
    || entries.some(entry => entry.memory_status === 'signal')
    || groups.length > 0;
  const fieldNames = unique([
    ...(proposedAction.field_names ?? []),
    ...Object.keys(proposedAction.payload ?? {}),
  ]);

  return actionPolicySummary(evaluateActionPolicy({
    action_type: policyActionType(proposedAction.action_type),
    object_type: proposedAction.object_type ?? briefing.subject_type,
    field_names: fieldNames.length > 0 ? fieldNames : undefined,
    actor,
    confidence: confidenceValues.length > 0 ? Math.max(...confidenceValues) : undefined,
    evidence: evidence.length > 0 ? evidence : undefined,
    memory_status: usesSignal ? 'signal' : undefined,
    source_authority: targetMapping?.source_authority,
    approved: proposedAction.approved,
  }));
}

function check(status: ActionContextReadinessStatus, reasons: string[]): ActionContextCheckStatus {
  return { status, reasons };
}

function maxRisk(...levels: Array<ActionContextRiskLevel | undefined>): ActionContextRiskLevel {
  if (levels.includes('high')) return 'high';
  if (levels.includes('medium')) return 'medium';
  return 'low';
}

export function deriveActionReadiness(input: DeriveActionReadinessInput): Pick<ActionContext, 'readiness' | 'checks' | 'required_handoffs'> {
  const memoryCount = briefingMemoryEntries(input.briefing).length;
  const signalEntries = briefingSignalEntries(input.briefing);
  const signalGroups = input.briefing.signal_groups ?? [];
  const staleCount = input.briefing.staleness_warnings.length;
  const contradictionCount = input.briefing.contradiction_warnings?.length ?? 0;
  const openAssignmentCount = input.briefing.open_assignments.length;
  const unresolvedReadinessStatuses = new Set(['needs_more_evidence', 'needs_more_detail', 'blocked_by_conflict', 'approval_required']);
  const unresolvedSignalGroups = signalGroups.filter(group =>
    group.readiness
      ? unresolvedReadinessStatuses.has(group.readiness.status)
      : ['blocked', 'conflicting'].includes(group.status),
  );
  const conflictingSignalGroups = signalGroups.filter(group =>
    group.readiness?.status === 'blocked_by_conflict' || ['blocked', 'conflicting'].includes(group.status),
  );
  const signalReadinessReasons = unique(unresolvedSignalGroups.flatMap(group => group.readiness?.reasons ?? [
    group.blocked_reason ?? `${group.title ?? group.normalized_claim} needs review before it becomes Memory.`,
  ])).slice(0, 5);

  const blockers = [
    ...(input.scope_blockers ?? []),
    ...input.systems.source_blockers,
  ];
  if (input.policy?.decision === 'blocked' || input.policy?.decision === 'draft_only') {
    blockers.push(...input.policy.reasons);
  }

  const reviewReasons: string[] = [];
  if (memoryCount === 0) reviewReasons.push('No confirmed Memory is loaded for this record.');
  if (staleCount > 0) reviewReasons.push(`${staleCount} confirmed Memory ${staleCount === 1 ? 'entry needs' : 'entries need'} review.`);
  if (contradictionCount > 0) reviewReasons.push(`${contradictionCount} contradiction ${contradictionCount === 1 ? 'was' : 'were'} detected.`);
  if (signalEntries.length > 0) reviewReasons.push(`${signalEntries.length} unconfirmed Signal${signalEntries.length === 1 ? '' : 's'} are present.`);
  if (conflictingSignalGroups.length > 0) reviewReasons.push(`${conflictingSignalGroups.length} Signal group${conflictingSignalGroups.length === 1 ? '' : 's'} need review.`);
  if (unresolvedSignalGroups.length > 0) reviewReasons.push(`${unresolvedSignalGroups.length} Signal readiness ${unresolvedSignalGroups.length === 1 ? 'check needs' : 'checks need'} review.`);
  if (openAssignmentCount > 0) reviewReasons.push(`${openAssignmentCount} open assignment${openAssignmentCount === 1 ? '' : 's'} are attached to this record.`);
  if (input.systems.open_conflict_count > 0) reviewReasons.push(`${input.systems.open_conflict_count} open source conflict${input.systems.open_conflict_count === 1 ? '' : 's'} need resolution.`);
  if (input.systems.pending_writeback_count > 0) reviewReasons.push(`${input.systems.pending_writeback_count} pending writeback${input.systems.pending_writeback_count === 1 ? '' : 's'} exist for this record.`);
  if (input.policy?.decision === 'approval_required') reviewReasons.push(...input.policy.reasons);

  const status: ActionContextReadinessStatus = blockers.length > 0
    ? 'blocked'
    : reviewReasons.length > 0
    ? 'review_needed'
    : 'ready';
  const riskLevel = maxRisk(
    blockers.length > 0 || contradictionCount > 0 || input.systems.source_blockers.length > 0 ? 'high' : undefined,
    unresolvedSignalGroups.some(group => group.readiness?.status === 'blocked_by_conflict') ? 'high' : undefined,
    input.policy?.risk_level,
    reviewReasons.length > 0 || unresolvedSignalGroups.length > 0 ? 'medium' : undefined,
  );

  const required_handoffs: ActionContext['required_handoffs'] = [
    ...input.briefing.open_assignments.map(assignment => ({
      type: 'assignment' as const,
      id: assignment.id,
      status: assignment.status,
      title: assignment.title,
    })),
    ...unresolvedSignalGroups.map(group => ({
      type: 'signal_review' as const,
      id: group.id,
      status: group.readiness?.status ?? group.status,
      title: group.title ?? group.normalized_claim,
    })),
    ...(input.systems.open_conflict_count > 0 ? [{
      type: 'source_conflict' as const,
      status: 'open',
      title: `${input.systems.open_conflict_count} source conflict${input.systems.open_conflict_count === 1 ? '' : 's'} need resolution`,
    }] : []),
    ...(input.policy?.decision === 'approval_required' ? [{
      type: 'policy_approval' as const,
      status: input.policy.decision,
      title: input.policy.reasons.join(' '),
    }] : []),
  ];

  const reasons = status === 'ready'
    ? ['Confirmed Memory, Signals, assignments, source authority, and policy checks are ready for action.']
    : unique([...blockers, ...reviewReasons]);

  return {
    readiness: {
      status,
      risk_level: riskLevel,
      reasons,
      blockers: unique(blockers),
      review_required: status !== 'ready',
    },
    checks: {
      memory: {
        ...check(memoryCount === 0 || staleCount > 0 || contradictionCount > 0 ? 'review_needed' : 'ready', [
          memoryCount === 0 ? 'No confirmed Memory is loaded.' : staleCount > 0 ? `${staleCount} confirmed Memory entries need review.` : 'Confirmed Memory is current.',
          contradictionCount > 0 ? `${contradictionCount} contradictions detected.` : 'No contradictions detected.',
        ]),
        confirmed_count: memoryCount,
        stale_count: staleCount,
        contradiction_count: contradictionCount,
      },
      signals: {
        ...check(signalEntries.length > 0 || unresolvedSignalGroups.length > 0 ? 'review_needed' : 'ready', [
          signalEntries.length > 0 ? `${signalEntries.length} unconfirmed Signals available.` : 'No unconfirmed Signals in this briefing.',
          unresolvedSignalGroups.length > 0 ? `${unresolvedSignalGroups.length} Signal readiness checks need review.` : 'Signal readiness checks are clear.',
          ...signalReadinessReasons,
        ]),
        signal_count: signalEntries.length,
        signal_group_count: signalGroups.length,
        conflicting_count: conflictingSignalGroups.length,
        unresolved_readiness_count: unresolvedSignalGroups.length,
        readiness_reasons: signalReadinessReasons,
      },
      assignments: {
        ...check(openAssignmentCount > 0 ? 'review_needed' : 'ready', [
          openAssignmentCount > 0 ? `${openAssignmentCount} open assignments found.` : 'No open assignments attached.',
        ]),
        open_count: openAssignmentCount,
      },
      permissions: {
        ...check((input.scope_blockers ?? []).length > 0 ? 'blocked' : 'ready', [
          (input.scope_blockers ?? []).length > 0 ? (input.scope_blockers ?? []).join(' ') : 'Actor can read this subject and request Action Context.',
        ]),
        actor_id: '',
        actor_type: 'system',
      },
      systems_of_record: {
        ...check(input.systems.source_blockers.length > 0 ? 'blocked' : input.systems.open_conflict_count > 0 ? 'review_needed' : 'ready', [
          input.systems.source_blockers.length > 0 ? input.systems.source_blockers.join(' ') : 'Systems-of-record constraints are summarized.',
        ]),
        mappings: input.systems.mappings,
        open_conflict_count: input.systems.open_conflict_count,
        pending_writeback_count: input.systems.pending_writeback_count,
      },
      ...(input.policy ? { policy: input.policy } : {}),
    },
    required_handoffs,
  };
}

function patchActorPermissionCheck<T extends Pick<ActionContext, 'checks'>>(context: T, actor: ActorContext): T {
  context.checks.permissions.actor_id = actor.actor_id;
  context.checks.permissions.actor_type = actor.actor_type;
  return context;
}

export async function getActionContext(
  db: DbPool,
  actor: ActorContext,
  input: ActionContextGetInput,
): Promise<ActionContext> {
  await assertSubjectAccess(db, actor, input.subject_type, input.subject_id);

  const briefing = await assembleBriefing(db, actor.tenant_id, input.subject_type, input.subject_id, {
    since: input.since,
    context_types: input.context_types,
    include_stale: input.include_stale,
    context_radius: input.context_radius,
    token_budget: input.token_budget,
  });

  const systems = await loadSourceAuthority(db, actor.tenant_id, input.subject_type, input.subject_id, input.proposed_action);
  const proposedScopeBlockers = input.proposed_action
    ? actionScopeStatus(actor, input.proposed_action.action_type, input.subject_type).reasons
        .filter((reason: string) => reason.startsWith('Missing'))
    : [];
  const policy = evaluateProposedAction(actor, briefing, input.proposed_action, systems.target_mapping);
  const derived = patchActorPermissionCheck(deriveActionReadiness({
    briefing,
    systems,
    policy,
    scope_blockers: proposedScopeBlockers,
    proposed_action: input.proposed_action,
  }), actor);

  const baseActions: ActionContextProposedAction['action_type'][] = [
    'customer_outreach',
    'assignment_create',
    'memory_promote',
    'record_update',
    'external_writeback',
  ];
  const allowedActions = baseActions.map(actionType => {
    const action = actionScopeStatus(actor, actionType, input.subject_type);
    if (actionType === 'external_writeback' && systems.mappings.length === 0) {
      return {
        ...action,
        status: 'blocked' as const,
        reasons: [...action.reasons, 'No active systems-of-record mapping is configured for this subject type.'],
      };
    }
    if (input.proposed_action?.action_type === actionType && policy) {
      return {
        ...action,
        status: policy.decision === 'approval_required' ? 'approval_required' : policy.decision === 'allowed' ? action.status : 'blocked',
        reasons: unique([...action.reasons, ...policy.reasons]),
        policy,
      };
    }
    return action;
  });

  const usedContextEntryIds = unique(allBriefingEntries(briefing).map(entry => entry.id));
  const usedSignalGroupIds = unique((briefing.signal_groups ?? []).map(group => group.id));
  const expectedReceipts = [
    ...(input.emit_retrieval_event !== false ? ['action_context.retrieved'] : []),
    ...(input.proposed_action?.action_type === 'external_writeback' ? ['external_writeback_request'] : []),
    ...(input.proposed_action?.action_type === 'assignment_create' ? ['assignment'] : []),
    ...(input.proposed_action?.action_type === 'customer_outreach' ? ['activity'] : []),
    'audit_event',
  ];

  const actionContext: ActionContext = {
    subject_type: input.subject_type,
    subject_id: input.subject_id,
    generated_at: new Date().toISOString(),
    briefing,
    readiness: derived.readiness,
    checks: derived.checks,
    allowed_actions: allowedActions,
    required_handoffs: derived.required_handoffs,
    proof: {
      used_context_entry_ids: usedContextEntryIds,
      used_signal_group_ids: usedSignalGroupIds,
      expected_receipts: unique(expectedReceipts),
    },
  };

  if (input.emit_retrieval_event !== false) {
    const retrievalEventId = await emitEvent(db, {
      tenantId: actor.tenant_id,
      eventType: 'action_context.retrieved',
      actorId: actor.actor_id,
      actorType: actor.actor_type,
      objectType: input.subject_type,
      objectId: input.subject_id,
      afterData: {
        readiness_status: actionContext.readiness.status,
        risk_level: actionContext.readiness.risk_level,
        stale_count: actionContext.checks.memory.stale_count,
        contradiction_count: actionContext.checks.memory.contradiction_count,
        signal_count: actionContext.checks.signals.signal_count,
        signal_group_count: actionContext.checks.signals.signal_group_count,
        unresolved_signal_readiness_count: actionContext.checks.signals.unresolved_readiness_count ?? 0,
        open_conflict_count: actionContext.checks.systems_of_record.open_conflict_count,
        proposed_action_type: input.proposed_action?.action_type,
      },
      metadata: {
        origin: 'action_context',
        context_radius: input.context_radius ?? 'direct',
        token_budget: input.token_budget,
        proposed_action_type: input.proposed_action?.action_type,
        used_context_entry_ids: usedContextEntryIds,
        used_signal_group_ids: usedSignalGroupIds,
        stale_count: actionContext.checks.memory.stale_count,
        contradiction_count: actionContext.checks.memory.contradiction_count,
        unresolved_signal_readiness_count: actionContext.checks.signals.unresolved_readiness_count ?? 0,
        readiness_status: actionContext.readiness.status,
        risk_level: actionContext.readiness.risk_level,
      },
    });
    actionContext.proof.retrieval_event_id = retrievalEventId;
  }

  return actionContext;
}
