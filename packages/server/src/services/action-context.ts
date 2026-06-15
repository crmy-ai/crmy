// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type {
  ActionContext,
  ActionContextAllowedAction,
  ActionContextActionPacket,
  ActionContextCheckStatus,
  ActionContextGetInput,
  ActionContextPacketEvidence,
  ActionContextPacketItem,
  ActionContextOperatingMode,
  ActionContextPolicySummary,
  ActionContextProposedAction,
  ActionContextRecommendedAction,
  ActionContextSourcePosture,
  ContextEvidence,
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

interface ActionContextGuidanceInput {
  operating_mode: ActionContextOperatingMode;
  blockers: string[];
  review_reasons: string[];
  proposed_action?: ActionContextProposedAction;
  policy?: ActionContextPolicySummary;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function metadataStringArray(metadata: unknown, key: string): string[] {
  const record = metadataRecord(metadata);
  const value = record?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function nestedMetadataNumber(metadata: unknown, keys: string[]): number | null {
  let current: unknown = metadata;
  for (const key of keys) {
    const record = metadataRecord(current);
    if (!record) return null;
    current = record[key];
  }
  const numeric = typeof current === 'number' ? current : typeof current === 'string' ? Number(current) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
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
    case 'sequence_step':
      return [readScopeForSubject(subjectType), 'activities:write'];
    case 'workflow_action':
      return [readScopeForSubject(subjectType)];
    case 'agent_task':
      return [readScopeForSubject(subjectType), 'context:read'];
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
  if (actionType === 'sequence_step') return 'sequence.step';
  if (actionType === 'workflow_action') return 'workflow.action';
  if (actionType === 'agent_task') return 'agent.task';
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

function requiresExecutionReview(input: Pick<ActionContextGuidanceInput, 'blockers' | 'policy'>): boolean {
  if (input.blockers.length > 0) return true;
  return input.policy?.decision === 'approval_required'
    || input.policy?.decision === 'blocked'
    || input.policy?.decision === 'draft_only';
}

function deriveOperatingMode(input: Pick<ActionContextGuidanceInput, 'blockers' | 'review_reasons' | 'policy'>): ActionContextOperatingMode {
  if (requiresExecutionReview(input)) return 'require_review';
  if (input.review_reasons.length > 0) return 'warn';
  return 'inform';
}

function proposedActionLabel(action?: ActionContextProposedAction): string {
  if (!action) return 'this work';
  switch (action.action_type) {
    case 'customer_outreach':
      return 'customer outreach';
    case 'assignment_create':
      return 'assignment creation';
    case 'memory_promote':
      return 'Memory confirmation';
    case 'record_update':
      return 'record update';
    case 'external_writeback':
      return 'external writeback';
    default:
      return 'this work';
  }
}

function compactText(value: string | undefined | null, max = 240): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function entryTitle(entry: ContextEntry): string {
  return entry.title || entry.context_type.replace(/_/g, ' ');
}

function evidenceRefs(entry: ContextEntry, limit = 2): ActionContextPacketEvidence[] {
  return (entry.evidence ?? []).slice(0, limit).map(evidence => ({
    source_type: typeof evidence.source_type === 'string' ? evidence.source_type : undefined,
    source_id: typeof evidence.source_id === 'string' ? evidence.source_id : undefined,
    source_ref: typeof evidence.source_ref === 'string' ? evidence.source_ref : undefined,
    source_label: typeof evidence.source_label === 'string' ? evidence.source_label : undefined,
    observed_at: typeof evidence.observed_at === 'string' ? evidence.observed_at : undefined,
    snippet: compactText(typeof evidence.snippet === 'string' ? evidence.snippet : undefined, 180) || undefined,
    confidence: typeof evidence.confidence === 'number' ? evidence.confidence : undefined,
  }));
}

type SourcePostureKind = keyof ActionContextSourcePosture['counts'];

function evidenceString(evidence: ContextEvidence, key: string): string {
  const value = evidence[key];
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function classifyEvidencePosture(evidence: ContextEvidence): SourcePostureKind {
  const sourceType = String(evidence.source_type ?? '').toLowerCase();
  const authorship = evidenceString(evidence, 'source_authorship');
  const origin = evidenceString(evidence, 'context_origin');
  const role = evidenceString(evidence, 'evidence_role');
  const weight = evidenceString(evidence, 'evidence_weight');
  const customerAuthored = evidence.customer_authored;

  if (customerAuthored === false || authorship === 'crmy' || origin.includes('crmy_outbound') || weight.includes('self_authored')) {
    return 'seller_authored';
  }
  if (
    customerAuthored === true
    || authorship.includes('customer')
    || role === 'customer_source'
    || sourceType.includes('inbound_email')
    || sourceType.includes('customer_email')
  ) {
    return 'customer_authored';
  }
  if (
    sourceType.includes('crm')
    || sourceType.includes('warehouse')
    || sourceType.includes('hubspot')
    || sourceType.includes('salesforce')
    || sourceType.includes('system')
  ) {
    return 'system_of_record';
  }
  if (
    sourceType.includes('activity')
    || sourceType.includes('meeting')
    || sourceType.includes('calendar')
    || sourceType.includes('note')
    || sourceType.includes('mcp')
    || sourceType.includes('api')
    || sourceType.includes('add_context')
    || sourceType.includes('workflow')
    || sourceType.includes('sequence')
  ) {
    return 'internal';
  }
  return 'unknown';
}

function sourcePostureSummary(dominant: ActionContextSourcePosture['dominant_source'], counts: ActionContextSourcePosture['counts']): string {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return 'No cited source evidence is attached to this packet.';
  if (dominant === 'mixed') return 'This packet uses a mixed source posture; distinguish customer evidence, internal context, and CRMy-authored actions before acting.';
  switch (dominant) {
    case 'customer_authored':
      return 'Customer-authored evidence is the strongest source posture in this packet.';
    case 'seller_authored':
      return 'CRMy/seller-authored context is prominent; use it for our actions and commitments, not as customer-authored truth.';
    case 'system_of_record':
      return 'System-of-record data is the strongest source posture in this packet; respect source authority and writeback policy.';
    case 'internal':
      return 'Internal activity or note context is the strongest source posture in this packet; caveat customer claims unless backed by customer evidence.';
    default:
      return 'Some source evidence is weak or unknown; caveat claims before acting.';
  }
}

function buildSourcePosture(entries: ContextEntry[], groups: SignalGroup[]): ActionContextSourcePosture {
  const counts: ActionContextSourcePosture['counts'] = {
    customer_authored: 0,
    seller_authored: 0,
    system_of_record: 0,
    internal: 0,
    unknown: 0,
  };
  for (const evidence of [
    ...entries.flatMap(entry => entry.evidence ?? []),
    ...groups.flatMap(group => (group.members ?? []).flatMap(member => member.context_entry?.evidence ?? [])),
  ]) {
    counts[classifyEvidencePosture(evidence)]++;
  }

  const nonZero = Object.entries(counts).filter(([, count]) => count > 0) as Array<[SourcePostureKind, number]>;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const dominant = nonZero.length === 0
    ? 'unknown'
    : nonZero.length > 1
      ? 'mixed'
      : nonZero[0][0];
  const instructions = [
    counts.customer_authored > 0
      ? 'Customer-authored evidence can support customer claims when current, specific, and non-conflicting.'
      : undefined,
    counts.seller_authored > 0
      ? 'Treat CRMy/seller-authored context as our words, asks, actions, or commitments; do not convert it into customer intent or agreement.'
      : undefined,
    counts.system_of_record > 0
      ? 'Respect system-of-record source authority, writable-field policy, and writeback approval rules before changing external systems.'
      : undefined,
    counts.internal > 0
      ? 'Use internal notes, meetings, and agent-added context as operational context; cite uncertainty when they are not direct customer evidence.'
      : undefined,
    counts.unknown > 0
      ? 'Caveat weak or unknown sources and gather stronger evidence before high-impact customer or record actions.'
      : undefined,
  ].filter((item): item is string => Boolean(item));

  return {
    summary: sourcePostureSummary(dominant, counts),
    dominant_source: dominant,
    counts,
    customer_authored_claims_present: counts.customer_authored > 0,
    seller_authored_context_present: counts.seller_authored > 0,
    weak_or_unknown_sources_present: total === 0 || counts.unknown > 0,
    instructions,
  };
}

function entryPacketItem(kind: ActionContextPacketItem['kind'], entry: ContextEntry, status?: string): ActionContextPacketItem {
  return {
    kind,
    id: entry.id,
    context_type: entry.context_type,
    title: entryTitle(entry),
    summary: compactText(entry.body),
    status: status ?? entry.memory_status,
    confidence: entry.confidence,
    evidence_refs: evidenceRefs(entry),
  };
}

function signalGroupPacketItem(group: SignalGroup): ActionContextPacketItem {
  return {
    kind: 'signal_group',
    id: group.id,
    context_type: group.context_type,
    title: group.title ?? group.normalized_claim,
    summary: group.normalized_claim,
    status: group.readiness?.status ?? group.status,
    confidence: group.aggregate_confidence,
    evidence_refs: (group.members ?? [])
      .flatMap(member => member.context_entry ? evidenceRefs(member.context_entry, 1) : [])
      .slice(0, 3),
  };
}

function actionSpecificInstruction(action?: ActionContextProposedAction): string {
  switch (action?.action_type) {
    case 'customer_outreach':
      return 'Draft or recommend customer outreach only from confirmed Memory; cite uncertain Signals as caveats and do not imply review-required claims are settled.';
    case 'external_writeback':
      return 'Do not execute writeback unless source authority, writable fields, policy, and approval checks are clear.';
    case 'record_update':
      return 'Preview record changes first and include Action Context proof with the write.';
    case 'memory_promote':
      return 'Confirm only Signals that have sufficient evidence, complete typed details, and no unresolved conflict.';
    case 'assignment_create':
      return 'Create a focused assignment with the smallest human decision needed to unblock progress.';
    case 'sequence_step':
      return 'Keep automated sequence execution inside sender, approval, and customer-context boundaries.';
    case 'workflow_action':
      return 'Run workflow actions only when the resolved customer record, policy, and source-authority checks match the trigger payload.';
    case 'agent_task':
      return 'Use this packet as the task boundary and ask for review before changing customer-facing or system-of-record state.';
    default:
      return 'Use this packet to decide whether to proceed, warn, or ask a human before acting.';
  }
}

function nextToolsForAction(action?: ActionContextProposedAction, mode?: ActionContextOperatingMode): string[] {
  const reviewTools = mode === 'require_review' ? ['action_context_request_human_unblock', 'hitl_submit_request', 'assignment_create'] : [];
  switch (action?.action_type) {
    case 'customer_outreach':
      return unique(['briefing_get', 'email_draft_preview', 'email_draft_save', ...reviewTools]);
    case 'external_writeback':
      return unique(['sor_writeback_preview', 'sor_writeback_request', ...reviewTools]);
    case 'record_update':
      return unique(['record_draft_preview', ...reviewTools]);
    case 'memory_promote':
      return unique(['context_signal_group_get', 'context_signal_group_complete_details', 'context_signal_group_promote', ...reviewTools]);
    case 'assignment_create':
      return unique(['assignment_create', 'briefing_get']);
    case 'sequence_step':
      return unique(['sequence_draft_step', 'email_draft_preview', ...reviewTools]);
    case 'workflow_action':
      return unique(['workflow_test', 'workflow_trigger', ...reviewTools]);
    case 'agent_task':
      return unique(['briefing_get', 'context_find', ...reviewTools]);
    default:
      return unique(['briefing_get', 'context_find', ...reviewTools]);
  }
}

function primaryToolForAction(action?: ActionContextProposedAction): string | undefined {
  switch (action?.action_type) {
    case 'customer_outreach':
      return 'email_draft_preview';
    case 'external_writeback':
      return 'sor_writeback_preview';
    case 'record_update':
      return 'record_draft_preview';
    case 'memory_promote':
      return 'context_signal_group_get';
    case 'assignment_create':
      return 'assignment_create';
    case 'sequence_step':
      return 'email_draft_preview';
    case 'workflow_action':
      return 'workflow_test';
    case 'agent_task':
      return 'briefing_get';
    default:
      return undefined;
  }
}

function actionLabelForPlan(action?: ActionContextProposedAction): string {
  switch (action?.action_type) {
    case 'customer_outreach':
      return 'Prepare customer outreach';
    case 'external_writeback':
      return 'Preview system-of-record writeback';
    case 'record_update':
      return 'Preview record update';
    case 'memory_promote':
      return 'Review Signal for Memory';
    case 'assignment_create':
      return 'Create focused assignment';
    case 'sequence_step':
      return 'Prepare sequence step';
    case 'workflow_action':
      return 'Test workflow action';
    case 'agent_task':
      return 'Continue agent task';
    default:
      return 'Continue with customer context';
  }
}

function buildRecommendedActions(
  context: Pick<ActionContext, 'operating_mode' | 'guidance' | 'readiness' | 'required_handoffs'>,
  proposedAction?: ActionContextProposedAction,
): ActionContextRecommendedAction[] {
  const reasons = unique([
    ...context.readiness.blockers,
    ...context.guidance.review_reasons,
    ...context.guidance.warning_reasons,
  ]).slice(0, 6);
  const proposedActionType = proposedAction?.action_type;

  if (context.operating_mode === 'require_review') {
    return [
      {
        id: 'request_human_unblock',
        label: 'Request human unblock',
        description: context.required_handoffs[0]?.title
          ? `Create a tracked review for "${context.required_handoffs[0].title}" before execution.`
          : `Create a tracked approval or assignment before executing ${proposedActionLabel(proposedAction)}.`,
        priority: 'primary',
        can_execute_now: true,
        customer_or_system_effect: false,
        requires_human_review: false,
        next_tool: 'action_context_request_human_unblock',
        reason_refs: reasons,
        proposed_action_type: proposedActionType,
      },
      {
        id: 'prepare_draft_only',
        label: 'Prepare draft only',
        description: 'Draft or preview the work using confirmed Memory, but do not send, write back, or update records until review clears.',
        priority: 'secondary',
        can_execute_now: true,
        customer_or_system_effect: false,
        requires_human_review: false,
        next_tool: primaryToolForAction(proposedAction) ?? 'briefing_get',
        reason_refs: context.guidance.review_reasons.slice(0, 4),
        proposed_action_type: proposedActionType,
      },
    ];
  }

  if (context.operating_mode === 'warn') {
    return [
      {
        id: 'proceed_with_caveats',
        label: actionLabelForPlan(proposedAction),
        description: 'Proceed if appropriate, making stale, inferred, conflicting, or low-confidence context visible in the work.',
        priority: 'primary',
        can_execute_now: true,
        customer_or_system_effect: Boolean(proposedAction),
        requires_human_review: false,
        next_tool: primaryToolForAction(proposedAction) ?? 'briefing_get',
        reason_refs: context.guidance.warning_reasons.slice(0, 6),
        proposed_action_type: proposedActionType,
      },
      {
        id: 'gather_more_evidence',
        label: 'Gather more evidence',
        description: 'Use search or briefing tools to strengthen uncertain context before committing to a customer-facing or system-changing action.',
        priority: 'secondary',
        can_execute_now: true,
        customer_or_system_effect: false,
        requires_human_review: false,
        next_tool: 'context_find',
        reason_refs: context.guidance.warning_reasons.slice(0, 4),
        proposed_action_type: proposedActionType,
      },
    ];
  }

  return [
    {
      id: 'proceed',
      label: actionLabelForPlan(proposedAction),
      description: proposedAction
        ? `Proceed with ${proposedActionLabel(proposedAction)} using confirmed Memory and cited evidence.`
        : 'Use the briefing and Action Context packet to continue the customer workflow.',
      priority: 'primary',
      can_execute_now: true,
      customer_or_system_effect: Boolean(proposedAction),
      requires_human_review: false,
      next_tool: primaryToolForAction(proposedAction) ?? 'briefing_get',
      reason_refs: context.guidance.recommended_next_steps.slice(0, 4),
      proposed_action_type: proposedActionType,
    },
  ];
}

function buildHumanUnblock(
  context: Pick<ActionContext, 'readiness' | 'required_handoffs' | 'guidance'>,
  action?: ActionContextProposedAction,
): ActionContextActionPacket['human_unblock'] {
  if (!context.readiness.review_required && context.required_handoffs.length === 0) return undefined;
  const first = context.required_handoffs[0];
  const reasons = unique([...context.readiness.blockers, ...context.guidance.review_reasons]).slice(0, 6);
  const actionLabel = proposedActionLabel(action);
  const question = first
    ? `Can we resolve "${first.title}" so the agent can continue with ${actionLabel}?`
    : `Can a human approve or correct the blocking context so the agent can continue with ${actionLabel}?`;
  return {
    required: true,
    question,
    reasons,
    handoff_type: first?.type,
  };
}

function buildActionPacket(
  context: Pick<ActionContext, 'operating_mode' | 'guidance' | 'briefing' | 'readiness' | 'checks' | 'required_handoffs' | 'allowed_actions' | 'proof'>,
  proposedAction?: ActionContextProposedAction,
): ActionContextActionPacket {
  const memory = briefingMemoryEntries(context.briefing)
    .filter(entry => (entry.memory_status ?? 'active') === 'active' && entry.is_current !== false);
  const staleIds = new Set(context.briefing.staleness_warnings.map(entry => entry.id));
  const staleMemory = context.briefing.staleness_warnings;
  const signalEntries = briefingSignalEntries(context.briefing);
  const unresolvedGroups = (context.briefing.signal_groups ?? []).filter(group =>
    group.readiness
      ? !['ready_to_confirm', 'confirmed'].includes(group.readiness.status)
      : ['blocked', 'conflicting', 'gathering'].includes(group.status),
  );
  const readySignalGroups = (context.briefing.signal_groups ?? []).filter(group =>
    group.readiness?.status === 'ready_to_confirm' || group.status === 'ready',
  );
  const contradictionItems: ActionContextPacketItem[] = (context.briefing.contradiction_warnings ?? []).slice(0, 5).map((warning, index) => ({
    kind: 'contradiction' as const,
    id: `contradiction:${index}`,
    title: 'Contradictory customer context',
    summary: compactText(JSON.stringify(warning), 260),
    status: 'needs_review',
  }));
  const assignmentItems: ActionContextPacketItem[] = context.briefing.open_assignments.slice(0, 5).map(assignment => ({
    kind: 'assignment' as const,
    id: assignment.id,
    title: assignment.title,
    summary: compactText(assignment.description ?? assignment.context ?? 'Open assignment attached to this record.'),
    status: assignment.status,
  }));
  const sourceAuthorityItems: ActionContextPacketItem[] = context.checks.systems_of_record.mappings.slice(0, 5).map(mapping => ({
    kind: 'source_authority' as const,
    id: mapping.mapping_id,
    title: `${mapping.object_type} -> ${mapping.external_object}`,
    summary: `Authority: ${mapping.source_authority}; writable fields: ${mapping.writable_fields.length > 0 ? mapping.writable_fields.join(', ') : 'none'}.`,
    status: mapping.is_active ? 'active' : 'inactive',
  }));
  const policyItem: ActionContextPacketItem[] = context.checks.policy ? [{
    kind: 'policy' as const,
    title: `Policy: ${context.checks.policy.policy}`,
    summary: context.checks.policy.reasons.join(' ') || `Decision: ${context.checks.policy.decision}.`,
    status: context.checks.policy.decision,
  }] : [];
  const permissionItems: ActionContextPacketItem[] = context.checks.permissions.status === 'blocked' ? [{
    kind: 'permission' as const,
    title: 'Permission boundary',
    summary: context.checks.permissions.reasons.join(' '),
    status: 'blocked',
  }] : [];

  const useAsTruth = memory
    .filter(entry => !staleIds.has(entry.id))
    .slice(0, 8)
    .map(entry => entryPacketItem('memory', entry, 'confirmed'));
  const cautionItems = [
    ...signalEntries.slice(0, 5).map(entry => entryPacketItem('signal', entry, 'unconfirmed')),
    ...readySignalGroups.slice(0, 5).map(signalGroupPacketItem),
    ...sourceAuthorityItems,
  ].slice(0, 12);
  const doNotUseAsTruth = [
    ...staleMemory.slice(0, 5).map(entry => entryPacketItem('stale_memory', entry, 'stale')),
    ...unresolvedGroups.slice(0, 5).map(signalGroupPacketItem),
    ...contradictionItems,
    ...assignmentItems,
    ...policyItem,
    ...permissionItems,
  ].slice(0, 14);
  const evidenceToCite = [
    ...useAsTruth.filter(item => (item.evidence_refs?.length ?? 0) > 0),
    ...cautionItems.filter(item => (item.evidence_refs?.length ?? 0) > 0),
  ].slice(0, 8);
  const sourcePosture = buildSourcePosture(
    [...memory, ...signalEntries, ...staleMemory],
    context.briefing.signal_groups ?? [],
  );
  const allowed = context.allowed_actions
    .filter(action => action.status === 'allowed')
    .map(action => `${action.action_type}: ${action.reasons.join(' ')}`);
  const approvalRequired = context.allowed_actions
    .filter(action => action.status === 'approval_required')
    .map(action => `${action.action_type}: ${action.reasons.join(' ')}`);
  const blocked = unique([
    ...context.readiness.blockers,
    ...context.allowed_actions.filter(action => action.status === 'blocked').map(action => `${action.action_type}: ${action.reasons.join(' ')}`),
  ]);

  return {
    action_type: proposedAction?.action_type,
    objective: proposedActionLabel(proposedAction),
    status: context.readiness.status,
    risk_level: context.readiness.risk_level,
    operating_mode: context.operating_mode,
    can_execute: context.guidance.can_execute,
    agent_instructions: unique([
      actionSpecificInstruction(proposedAction),
      context.guidance.summary,
      ...context.guidance.recommended_next_steps,
    ]),
    use_as_truth: useAsTruth,
    use_with_caution: cautionItems,
    do_not_use_as_truth: doNotUseAsTruth,
    evidence_to_cite: evidenceToCite,
    source_posture: sourcePosture,
    recommended_actions: buildRecommendedActions(context, proposedAction),
    action_boundaries: {
      allowed: allowed.slice(0, 8),
      warnings: context.guidance.warning_reasons,
      blocked,
      required_review: unique([...context.guidance.review_reasons, ...approvalRequired]).slice(0, 10),
    },
    human_unblock: buildHumanUnblock(context, proposedAction),
    next_tools: nextToolsForAction(proposedAction, context.operating_mode),
  };
}

function buildActionGuidance(input: ActionContextGuidanceInput): ActionContext['guidance'] {
  const actionLabel = proposedActionLabel(input.proposed_action);
  if (input.operating_mode === 'require_review') {
    const reviewReasons = unique([
      ...input.blockers,
      ...(input.policy?.decision === 'approval_required' ? input.policy.reasons : []),
      ...(input.policy?.decision === 'blocked' ? input.policy.reasons : []),
      ...(input.policy?.decision === 'draft_only' ? input.policy.reasons : []),
    ]);
    return {
      summary: `Stop before executing ${actionLabel}; CRMy requires review or cannot allow this action yet.`,
      can_execute: false,
      warning_reasons: input.review_reasons,
      review_reasons: reviewReasons,
      recommended_next_steps: [
        'Route the action to Handoff or resolve the policy/scope blocker before execution.',
        'Use confirmed Memory and evidence links when explaining why review is required.',
        'Do not write to customer records or systems of record until the review condition is cleared.',
      ],
    };
  }

  if (input.operating_mode === 'warn') {
    return {
      summary: `Proceed with ${actionLabel} if appropriate, but make the warnings visible to the user or agent.`,
      can_execute: true,
      warning_reasons: input.review_reasons,
      review_reasons: [],
      recommended_next_steps: [
        'Use confirmed Memory as the source of truth.',
        'Treat unconfirmed Signals, stale Memory, conflicts, and pending work as caveats.',
        'Route to Handoff only if the warning will affect an external customer action, operational record, or system-of-record write.',
      ],
    };
  }

  return {
    summary: `Proceed with ${actionLabel}; Action Context is informational for this request.`,
    can_execute: true,
    warning_reasons: [],
    review_reasons: [],
    recommended_next_steps: [
      'Use the briefing, proof links, and source authority summary to complete the work.',
      'Keep any resulting customer or system-impacting write on the normal governed path.',
    ],
  };
}

export function deriveActionReadiness(input: DeriveActionReadinessInput): Pick<ActionContext, 'operating_mode' | 'guidance' | 'readiness' | 'checks' | 'required_handoffs'> {
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
  const operatingMode = deriveOperatingMode({ blockers, review_reasons: reviewReasons, policy: input.policy });
  const guidance = buildActionGuidance({
    operating_mode: operatingMode,
    blockers,
    review_reasons: reviewReasons,
    proposed_action: input.proposed_action,
    policy: input.policy,
  });
  const riskLevel = maxRisk(
    blockers.length > 0 || contradictionCount > 0 || input.systems.source_blockers.length > 0 ? 'high' : undefined,
    unresolvedSignalGroups.some(group => group.readiness?.status === 'blocked_by_conflict') ? 'high' : undefined,
    input.policy?.risk_level,
    reviewReasons.length > 0 || unresolvedSignalGroups.length > 0 ? 'medium' : undefined,
  );

  const proposedSignalGroupIds = new Set(input.proposed_action?.signal_group_ids ?? []);
  const signalGroupsRequiringReview = operatingMode === 'require_review'
    ? unresolvedSignalGroups.filter(group => {
      if (input.proposed_action?.action_type === 'memory_promote') {
        return proposedSignalGroupIds.size === 0 || proposedSignalGroupIds.has(group.id);
      }
      return proposedSignalGroupIds.has(group.id);
    })
    : [];
  const required_handoffs: ActionContext['required_handoffs'] = [
    ...(operatingMode === 'require_review' ? input.briefing.open_assignments.map(assignment => ({
      type: 'assignment' as const,
      id: assignment.id,
      status: assignment.status,
      title: assignment.title,
    })) : []),
    ...signalGroupsRequiringReview.map(group => ({
      type: 'signal_review' as const,
      id: group.id,
      status: group.readiness?.status ?? group.status,
      title: group.title ?? group.normalized_claim,
    })),
    ...(operatingMode === 'require_review' && input.systems.open_conflict_count > 0 ? [{
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
      review_required: operatingMode === 'require_review',
    },
    operating_mode: operatingMode,
    guidance,
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
    token_budget_profile: input.token_budget_profile,
    evidence_mode: input.evidence_mode,
    proposed_action_type: input.proposed_action?.action_type,
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
    'sequence_step',
    'workflow_action',
    'agent_task',
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
    ...(input.proposed_action?.action_type === 'sequence_step' ? ['sequence_step_execution', 'activity'] : []),
    ...(input.proposed_action?.action_type === 'workflow_action' ? ['workflow_action_log'] : []),
    ...(input.proposed_action?.action_type === 'agent_task' ? ['agent_turn'] : []),
    'audit_event',
  ];

  const actionContext: ActionContext = {
    subject_type: input.subject_type,
    subject_id: input.subject_id,
    generated_at: new Date().toISOString(),
    operating_mode: derived.operating_mode,
    guidance: derived.guidance,
    action_packet: buildActionPacket({
      operating_mode: derived.operating_mode,
      guidance: derived.guidance,
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
    }, input.proposed_action),
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
        operating_mode: actionContext.operating_mode,
        review_required: actionContext.readiness.review_required,
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
        operating_mode: actionContext.operating_mode,
        review_required: actionContext.readiness.review_required,
        risk_level: actionContext.readiness.risk_level,
      },
    });
    actionContext.proof.retrieval_event_id = retrievalEventId;
  }

  return actionContext;
}

export async function verifiedActionContextMetadataForReceipt(
  db: DbPool,
  actor: ActorContext,
  subjectType: SubjectType,
  subjectId: UUID | string,
  submitted: unknown,
): Promise<Record<string, unknown> | undefined> {
  const submittedRecord = metadataRecord(submitted);
  if (!submittedRecord) return undefined;
  const retrievalEventId = nestedMetadataNumber(submittedRecord, ['proof', 'retrieval_event_id']);
  if (retrievalEventId === null) return undefined;

  const result = await db.query(
    `SELECT id, after_data, metadata
     FROM events
     WHERE tenant_id = $1
       AND id = $2
       AND event_type = 'action_context.retrieved'
       AND actor_id = $3
       AND object_type = $4
       AND object_id = $5::uuid
     LIMIT 1`,
    [actor.tenant_id, retrievalEventId, actor.actor_id, subjectType, subjectId],
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const event = result.rows[0];
  if (!event) return undefined;

  const afterData = metadataRecord(event.after_data);
  const eventMetadata = metadataRecord(event.metadata);
  return {
    subject_type: subjectType,
    subject_id: subjectId,
    operating_mode: eventMetadata?.operating_mode ?? afterData?.operating_mode,
    readiness_status: eventMetadata?.readiness_status ?? afterData?.readiness_status,
    risk_level: eventMetadata?.risk_level ?? afterData?.risk_level,
    review_required: eventMetadata?.review_required ?? afterData?.review_required,
    proposed_action_type: eventMetadata?.proposed_action_type ?? afterData?.proposed_action_type,
    proof: {
      retrieval_event_id: retrievalEventId,
      used_context_entry_ids: metadataStringArray(eventMetadata, 'used_context_entry_ids'),
      used_signal_group_ids: metadataStringArray(eventMetadata, 'used_signal_group_ids'),
      expected_receipts: metadataStringArray(eventMetadata, 'expected_receipts'),
    },
    verified: true,
  };
}
