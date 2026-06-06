// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type {
  ContextEntry,
  SignalReadiness,
  SignalReadinessNextAction,
  SignalReadinessStatus,
  SignalResolution,
  SubjectType,
} from '@crmy/shared';

export const SIGNAL_READINESS_VERSION = 'crmy.signal_readiness.v1' as const;
export const DEFAULT_SIGNAL_CONFIRMATION_THRESHOLD = 0.85;
const MIN_CONFIRMABLE_SIGNAL_SCORE = 0.7;
const MIN_TYPED_COMPLETENESS = 0.75;

export type ReadableSignalGroupStatus = 'gathering' | 'ready' | 'promoted' | 'blocked' | 'dismissed' | 'conflicting' | 'merged';

export interface ReadableSignalGroup {
  subject_type?: SubjectType;
  subject_id?: string;
  subject_name?: string | null;
  context_type?: string;
  title?: string | null;
  normalized_claim?: string;
  status: ReadableSignalGroupStatus;
  aggregate_confidence: number;
  support_count: number;
  independent_source_count: number;
  conflict_count: number;
  evidence_count: number;
  promoted_context_entry_id?: string | null;
  blocked_reason?: string | null;
  metadata?: Record<string, unknown>;
  members?: Array<{
    relation: 'supports' | 'conflicts' | 'supersedes' | string;
    context_entry?: ContextEntry | null;
  }>;
}

export interface SignalReadinessFacts {
  group_status: ReadableSignalGroupStatus;
  score: number;
  threshold?: number;
  support_count: number;
  independent_source_count: number;
  duplicate_source_count?: number;
  evidence_count: number;
  conflict_count: number;
  model_confidence?: number;
  source_quality?: number;
  source_boost?: number;
  conflict_penalty?: number;
  typed_completeness?: number | null;
  sensitive?: boolean;
  requires_approval?: boolean;
  convergence_blocked?: boolean;
  readiness_blockers?: string[];
  missing_details?: string[];
  promotion_blockers?: string[];
  blocked_reason?: string | null;
}

function clampScore(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, Number(parsed.toFixed(3))));
}

function count(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.map(String)) : [];
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasApprovalLanguage(values: string[]): boolean {
  return values.some(value => {
    const normalized = value.toLowerCase();
    return normalized.includes('approval') || normalized.includes('corroboration');
  });
}

function nextActions(status: SignalReadinessStatus): SignalReadinessNextAction[] {
  if (status === 'ready_to_confirm') return ['confirm_signal', 'dismiss_signal'];
  if (status === 'approval_required') return ['confirm_signal', 'send_to_handoff', 'dismiss_signal'];
  if (status === 'blocked_by_conflict') return ['resolve_conflict', 'send_to_handoff', 'dismiss_signal'];
  if (status === 'needs_more_detail') return ['add_detail', 'send_to_handoff', 'dismiss_signal'];
  if (status === 'needs_more_evidence') return ['add_evidence', 'send_to_handoff', 'dismiss_signal'];
  return [];
}

function factsComponents(facts: SignalReadinessFacts): SignalReadiness['components'] {
  return {
    model_confidence: clampScore(facts.model_confidence, facts.score),
    source_quality: clampScore(facts.source_quality, 0),
    independent_source_count: count(facts.independent_source_count),
    duplicate_source_count: count(facts.duplicate_source_count),
    evidence_count: count(facts.evidence_count),
    conflict_count: count(facts.conflict_count),
    typed_completeness: facts.typed_completeness == null ? null : clampScore(facts.typed_completeness),
    source_boost: clampScore(facts.source_boost),
    conflict_penalty: clampScore(facts.conflict_penalty),
  };
}

export function deriveSignalReadiness(facts: SignalReadinessFacts): SignalReadiness {
  const score = clampScore(facts.score);
  const threshold = clampScore(facts.threshold, DEFAULT_SIGNAL_CONFIRMATION_THRESHOLD);
  const supportCount = count(facts.support_count);
  const independentSourceCount = count(facts.independent_source_count);
  const evidenceCount = count(facts.evidence_count);
  const conflictCount = count(facts.conflict_count);
  const readinessBlockers = unique(facts.readiness_blockers ?? []);
  const missingDetails = unique(facts.missing_details ?? []);
  const promotionBlockers = unique(facts.promotion_blockers ?? []);
  const blockers = unique([
    ...readinessBlockers,
    ...(facts.blocked_reason ? [facts.blocked_reason] : []),
  ]);
  const typedCompleteness = facts.typed_completeness == null ? null : clampScore(facts.typed_completeness);
  const lowTypedCompleteness = typedCompleteness != null && typedCompleteness < MIN_TYPED_COMPLETENESS;
  const approvalRequired = Boolean(facts.requires_approval)
    || hasApprovalLanguage(promotionBlockers)
    || (facts.group_status === 'blocked' && Boolean(facts.sensitive) && independentSourceCount < 2);

  let status: SignalReadinessStatus;
  let reasons: string[] = [];
  let statusBlockers = blockers;

  if (facts.group_status === 'promoted') {
    status = 'confirmed';
    reasons = ['This Signal already became confirmed Memory.'];
    statusBlockers = [];
  } else if (facts.group_status === 'dismissed') {
    status = 'dismissed';
    reasons = ['This Signal was dismissed and will not become Memory.'];
    statusBlockers = [];
  } else if (conflictCount > 0 || facts.group_status === 'conflicting') {
    status = 'blocked_by_conflict';
    reasons = [`${conflictCount || 1} conflicting evidence ${conflictCount === 1 ? 'item needs' : 'items need'} review before this can become Memory.`];
    statusBlockers = unique([...statusBlockers, 'Conflicting evidence needs review.']);
  } else if (readinessBlockers.length > 0 || missingDetails.length > 0 || lowTypedCompleteness) {
    status = 'needs_more_detail';
    reasons = [
      missingDetails.length > 0
        ? `Missing typed detail: ${missingDetails.slice(0, 3).join(', ')}.`
        : lowTypedCompleteness
          ? `Typed detail is ${Math.round((typedCompleteness ?? 0) * 100)}%, below the ${Math.round(MIN_TYPED_COMPLETENESS * 100)}% readiness floor.`
          : 'Typed Memory readiness checks found missing details.',
    ];
    const missingDetailBlockers = missingDetails
      .filter(detail => !statusBlockers.some(blocker => blocker.toLowerCase().includes(detail.toLowerCase())))
      .map(detail => `Missing ${detail}.`);
    statusBlockers = unique([
      ...statusBlockers,
      ...readinessBlockers,
      ...missingDetailBlockers,
    ]);
  } else if (approvalRequired) {
    status = 'approval_required';
    reasons = facts.sensitive && independentSourceCount < 2
      ? ['This sensitive Signal needs human confirmation or another independent source before it becomes Memory.']
      : ['This Signal needs human approval before it becomes confirmed Memory.'];
    statusBlockers = unique([
      ...statusBlockers,
      ...promotionBlockers.filter(blocker => blocker.toLowerCase().includes('approval') || blocker.toLowerCase().includes('corroboration')),
    ]);
  } else if (supportCount < 1 || evidenceCount < 1 || score < threshold || score < MIN_CONFIRMABLE_SIGNAL_SCORE || independentSourceCount < 1) {
    status = 'needs_more_evidence';
    const evidenceReasons = [
      ...(supportCount < 1 ? ['No supporting Signals are attached yet.'] : []),
      ...(evidenceCount < 1 ? ['No source evidence is attached yet.'] : []),
      ...(independentSourceCount < 1 ? ['No independent source identity is available yet.'] : []),
      ...(score < threshold ? [`Readiness score is ${Math.round(score * 100)}%, below the ${Math.round(threshold * 100)}% confirmation threshold.`] : []),
    ];
    reasons = evidenceReasons.length > 0 ? evidenceReasons : ['More source evidence is needed before this can become Memory.'];
    statusBlockers = unique([...statusBlockers, ...reasons]);
  } else {
    status = 'ready_to_confirm';
    reasons = ['This Signal has enough evidence, source quality, typed detail, and no conflicts to become confirmed Memory.'];
    statusBlockers = [];
  }

  return {
    version: SIGNAL_READINESS_VERSION,
    status,
    can_confirm: status === 'ready_to_confirm' || status === 'approval_required',
    can_auto_confirm: status === 'ready_to_confirm' && facts.group_status === 'ready' && score >= threshold,
    score,
    threshold,
    reasons: unique(reasons),
    blockers: unique(statusBlockers),
    next_actions: nextActions(status),
    components: factsComponents({
      ...facts,
      score,
      threshold,
      support_count: supportCount,
      independent_source_count: independentSourceCount,
      evidence_count: evidenceCount,
      conflict_count: conflictCount,
      typed_completeness: typedCompleteness,
    }),
  };
}

function entryStructuredData(entry?: ContextEntry): Record<string, unknown> {
  return metadataRecord(entry?.structured_data);
}

function typedCompletenessFromEntries(entries: ContextEntry[]): number | null {
  const values = entries
    .map(entry => metadataNumber(entryStructuredData(entry), 'extraction_completeness'))
    .filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return null;
  return clampScore(Math.min(...values));
}

function readinessBlockersFromEntries(entries: ContextEntry[]): string[] {
  return unique(entries.flatMap(entry => stringArray(entryStructuredData(entry).readiness_blockers)));
}

function missingDetailsFromEntries(entries: ContextEntry[]): string[] {
  return unique(entries.flatMap(entry => stringArray(entryStructuredData(entry).missing_details)));
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalizeFieldKey(value: string): string {
  return value
    .replace(/\.$/, '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function possessive(label: string): string {
  return label.endsWith('s') ? `${label}'` : `${label}'s`;
}

function subjectTypeLabel(subjectType?: SubjectType): string {
  if (subjectType === 'use_case') return 'use case';
  return subjectType ?? 'record';
}

function groupSubjectLabel(group: ReadableSignalGroup): string {
  if (group.subject_name) return group.subject_name;
  const type = group.subject_type === 'use_case' ? 'Use Case' : humanizeKey(group.subject_type ?? 'Record');
  return group.subject_id ? `${type} ${group.subject_id.slice(0, 8)}` : type;
}

function firstSupportingEntry(group: ReadableSignalGroup): ContextEntry | undefined {
  const supportingEntries = (group.members ?? [])
    .filter(member => member.relation === 'supports')
    .map(member => member.context_entry)
    .filter(Boolean) as ContextEntry[];
  const latestId = (group as { latest_signal_id?: string | null }).latest_signal_id;
  return (latestId ? supportingEntries.find(entry => entry.id === latestId) : undefined) ?? supportingEntries[0];
}

function missingDetailsForResolution(group: ReadableSignalGroup, readiness: SignalReadiness): string[] {
  const facts = signalReadinessFactsForGroup(group);
  const fromReasons = readiness.reasons.flatMap(reason => {
    const match = reason.match(/Missing typed detail:\s*(.+?)\.?$/i);
    return match?.[1] ? match[1].split(',').map(value => value.trim()) : [];
  });
  const fromBlockers = readiness.blockers.flatMap(blocker => {
    const match = blocker.match(/^Missing\s+(.+?)\.?$/i);
    return match?.[1] ? [match[1]] : [];
  });
  return unique([
    ...(facts.missing_details ?? []),
    ...fromReasons,
    ...fromBlockers,
  ]);
}

function primaryActionForReadiness(readiness: SignalReadiness): SignalResolution['primary_action'] {
  if (readiness.status === 'confirmed' || readiness.status === 'dismissed') return 'view_only';
  if (readiness.status === 'ready_to_confirm') return 'confirm_signal';
  if (readiness.status === 'needs_more_detail') return 'add_signal_detail';
  if (readiness.status === 'needs_more_evidence') return 'add_evidence';
  if (readiness.status === 'blocked_by_conflict') return 'resolve_conflict';
  if (readiness.status === 'approval_required') return readiness.can_confirm ? 'confirm_signal' : 'request_approval';
  return 'view_only';
}

function targetForGroup(
  group: ReadableSignalGroup,
  readiness: SignalReadiness,
): Pick<SignalResolution, 'target_type' | 'target_label' | 'primary_missing_field'> {
  const entry = firstSupportingEntry(group);
  const structured = entryStructuredData(entry);
  const subjectLabel = groupSubjectLabel(group);
  const missingField = missingDetailsForResolution(group, readiness)[0];
  const primaryMissingField = missingField ? normalizeFieldKey(missingField) : undefined;
  const personName = typeof structured.person_name === 'string' && structured.person_name.trim()
    ? structured.person_name.trim()
    : undefined;
  const entityName = typeof structured.entity_name === 'string' && structured.entity_name.trim()
    ? structured.entity_name.trim()
    : typeof structured.company_name === 'string' && structured.company_name.trim()
      ? structured.company_name.trim()
      : undefined;

  if (readiness.status === 'needs_more_evidence') {
    return { target_type: 'evidence', target_label: subjectLabel, primary_missing_field: primaryMissingField };
  }
  if (readiness.status === 'blocked_by_conflict') {
    return { target_type: 'conflict', target_label: subjectLabel, primary_missing_field: primaryMissingField };
  }
  if (readiness.status === 'approval_required') {
    return { target_type: 'approval', target_label: subjectLabel, primary_missing_field: primaryMissingField };
  }
  if (personName) {
    return { target_type: 'mentioned_person', target_label: personName, primary_missing_field: primaryMissingField };
  }
  if (entityName) {
    return { target_type: 'mentioned_entity', target_label: entityName, primary_missing_field: primaryMissingField };
  }
  if (readiness.status === 'needs_more_detail' && primaryMissingField) {
    return { target_type: 'signal_detail', target_label: subjectLabel, primary_missing_field: primaryMissingField };
  }
  return { target_type: 'subject_record', target_label: subjectLabel, primary_missing_field: primaryMissingField };
}

function helperTextForResolution(
  group: ReadableSignalGroup,
  readiness: SignalReadiness,
  target: Pick<SignalResolution, 'target_type' | 'target_label' | 'primary_missing_field'>,
): string {
  const fieldLabel = target.primary_missing_field ? humanizeKey(target.primary_missing_field).toLowerCase() : 'detail';
  const recordType = subjectTypeLabel(group.subject_type);
  if (readiness.status === 'needs_more_detail' && target.target_type === 'mentioned_person') {
    return `Add ${possessive(target.target_label)} ${fieldLabel} in this Signal. This does not edit the ${recordType} record.`;
  }
  if (readiness.status === 'needs_more_detail') {
    return `Add the missing Signal detail before confirming this as Memory.`;
  }
  if (readiness.status === 'needs_more_evidence') {
    return 'Add source evidence before confirming this Signal as Memory.';
  }
  if (readiness.status === 'blocked_by_conflict') {
    return 'Resolve conflicting evidence before confirming this Signal as Memory.';
  }
  if (readiness.status === 'approval_required') {
    return readiness.can_confirm
      ? 'Confirm this Signal if the evidence is enough, or request approval from someone else.'
      : 'Request approval before this Signal becomes confirmed Memory.';
  }
  if (readiness.status === 'ready_to_confirm') {
    return 'This Signal can be confirmed as Memory.';
  }
  return readiness.status === 'confirmed'
    ? 'This Signal already became confirmed Memory.'
    : 'This Signal is view-only.';
}

export function deriveSignalResolution(
  group: ReadableSignalGroup,
  readiness: SignalReadiness = signalReadinessForGroup(group),
): SignalResolution {
  const subjectLabel = groupSubjectLabel(group);
  const target = targetForGroup(group, readiness);
  return {
    target_type: target.target_type,
    target_label: target.target_label,
    subject_label: subjectLabel,
    subject_type: group.subject_type ?? 'account',
    subject_id: group.subject_id ?? '',
    ...(target.primary_missing_field ? { primary_missing_field: target.primary_missing_field } : {}),
    primary_action: primaryActionForReadiness(readiness),
    helper_text: helperTextForResolution(group, readiness, target),
  };
}

export function signalReadinessFactsForGroup(group: ReadableSignalGroup): SignalReadinessFacts {
  const metadata = metadataRecord(group.metadata);
  const cached = metadataRecord(metadata.readiness) as Partial<SignalReadiness>;
  const components = metadataRecord(metadata.confidence_components);
  const supportingEntries = (group.members ?? [])
    .filter(member => member.relation === 'supports')
    .map(member => member.context_entry)
    .filter(Boolean) as ContextEntry[];
  const duplicateSourceCount = metadataNumber(metadata, 'duplicate_source_count')
    ?? metadataNumber(components, 'duplicate_source_count')
    ?? cached.components?.duplicate_source_count
    ?? Math.max(0, count(group.support_count) - count(group.independent_source_count));

  return {
    group_status: group.status,
    score: group.aggregate_confidence ?? metadataNumber(metadata, 'trust_score') ?? cached.score ?? 0,
    threshold: metadataNumber(metadata, 'threshold') ?? cached.threshold ?? DEFAULT_SIGNAL_CONFIRMATION_THRESHOLD,
    support_count: group.support_count,
    independent_source_count: group.independent_source_count,
    duplicate_source_count: duplicateSourceCount,
    evidence_count: group.evidence_count,
    conflict_count: group.conflict_count,
    model_confidence: metadataNumber(components, 'strongest_evidence_confidence') ?? cached.components?.model_confidence,
    source_quality: metadataNumber(components, 'strongest_source_weight') ?? cached.components?.source_quality,
    source_boost: metadataNumber(components, 'source_boost') ?? cached.components?.source_boost,
    conflict_penalty: metadataNumber(components, 'conflict_penalty') ?? cached.components?.conflict_penalty,
    typed_completeness: metadataNumber(metadata, 'typed_completeness') ?? cached.components?.typed_completeness ?? typedCompletenessFromEntries(supportingEntries),
    sensitive: Boolean(metadata.sensitive),
    requires_approval: Boolean(metadata.requires_corroboration),
    convergence_blocked: Boolean(metadata.suggested_action),
    readiness_blockers: [
      ...stringArray(metadata.readiness_blockers),
      ...readinessBlockersFromEntries(supportingEntries),
    ],
    missing_details: [
      ...stringArray(metadata.missing_details),
      ...missingDetailsFromEntries(supportingEntries),
    ],
    promotion_blockers: stringArray(metadata.promotion_blockers),
    blocked_reason: group.blocked_reason,
  };
}

export function signalReadinessForGroup(group: ReadableSignalGroup): SignalReadiness {
  return deriveSignalReadiness(signalReadinessFactsForGroup(group));
}

export function withSignalReadiness<T extends ReadableSignalGroup>(group: T): T & { readiness: SignalReadiness; resolution: SignalResolution } {
  const readiness = signalReadinessForGroup(group);
  return {
    ...group,
    readiness,
    resolution: deriveSignalResolution(group, readiness),
  };
}
