// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type {
  ContextEntry,
  SignalReadiness,
  SignalReadinessNextAction,
  SignalReadinessStatus,
} from '@crmy/shared';

export const SIGNAL_READINESS_VERSION = 'crmy.signal_readiness.v1' as const;
export const DEFAULT_SIGNAL_CONFIRMATION_THRESHOLD = 0.85;
const MIN_CONFIRMABLE_SIGNAL_SCORE = 0.7;
const MIN_TYPED_COMPLETENESS = 0.75;

export type ReadableSignalGroupStatus = 'gathering' | 'ready' | 'promoted' | 'blocked' | 'dismissed' | 'conflicting' | 'merged';

export interface ReadableSignalGroup {
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

export function withSignalReadiness<T extends ReadableSignalGroup>(group: T): T & { readiness: SignalReadiness } {
  return {
    ...group,
    readiness: signalReadinessForGroup(group),
  };
}
