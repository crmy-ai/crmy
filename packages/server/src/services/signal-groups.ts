// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext, ContextEntry, ContextEvidence, UUID } from '@crmy/shared';
import { validationError } from '@crmy/shared';
import { createHash } from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import * as contextRepo from '../db/repos/context-entries.js';
import * as signalGroupRepo from '../db/repos/signal-groups.js';
import * as hitlRepo from '../db/repos/hitl.js';
import * as actorRepo from '../db/repos/actors.js';
import * as contextTypeRepo from '../db/repos/context-type-registry.js';
import { checkContextConvergence } from './context-convergence.js';
import { evaluateActionPolicy } from './action-policy.js';
import { evaluateMemoryReadiness } from './memory-readiness.js';
import { emitEvent } from '../events/emitter.js';
import * as outboxRepo from '../db/repos/context-outbox.js';
import * as agentRepo from '../db/repos/agent.js';
import { callLLM } from '../agent/providers/llm.js';
import { ensureEmbeddingBestEffort } from './embedding-service.js';
import { retrieveSignalGroupCandidates } from './context-candidate-retriever.js';
import { deriveSignalReadiness, signalReadinessForGroup } from './signal-readiness.js';

const SENSITIVE_CONTEXT_TYPES = new Set([
  'stakeholder',
  'stakeholder_role',
  'stakeholder_map',
  'risk',
  'deal_risk',
  'forecast',
  'forecast_risk',
  'forecast_signal',
  'commitment',
  'next_step',
  'methodology_gap',
  'buying_process',
  'success_criteria',
  'buyer_role',
  'approval',
]);

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'is', 'it', 'may', 'might', 'of', 'on', 'or', 'that', 'the', 'this', 'to',
  'was', 'with', 'will', 'would',
]);

const STRUCTURED_READINESS_KEYS = new Set([
  'readiness_blockers',
  'missing_details',
  'extraction_completeness',
  'validation_warnings',
]);

const GTM_CONCEPTS: Record<string, string[]> = {
  budget: ['budget', 'finance', 'financial', 'approval', 'approved', 'procurement', 'commercial', 'business case', 'roi', 'cost', 'pricing'],
  security: ['security', 'compliance', 'data residency', 'residency', 'privacy', 'legal', 'risk review', 'vendor review', 'infosec'],
  process: ['procurement', 'legal', 'approval path', 'buying process', 'decision process', 'security review', 'vendor review'],
  next_step: ['next step', 'follow up', 'workshop', 'demo', 'meeting', 'schedule', 'send', 'review', 'pilot', 'trial'],
  stakeholder: ['champion', 'economic buyer', 'buyer', 'sponsor', 'decision maker', 'influencer', 'stakeholder', 'approver'],
  competitor: ['competitor', 'competitive', 'vendor', 'alternative', 'evaluating', 'shortlist'],
  value: ['value', 'outcome', 'success criteria', 'criteria', 'reduce', 'save', 'manual', 'efficiency', 'productivity', 'business impact'],
  timing: ['timeline', 'date', 'deadline', 'quarter', 'q1', 'q2', 'q3', 'q4', 'next week', 'next month', 'forecast', 'close date', 'slip'],
};

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let intersection = 0;
  for (const token of sa) if (sb.has(token)) intersection++;
  const union = new Set([...sa, ...sb]).size;
  return union ? intersection / union : 0;
}

function gtmConcepts(text: string): Set<string> {
  const normalized = text.toLowerCase();
  const concepts = new Set<string>();
  for (const [concept, terms] of Object.entries(GTM_CONCEPTS)) {
    if (terms.some(term => normalized.includes(term))) concepts.add(concept);
  }
  return concepts;
}

function semanticClaimScore(a: string, b: string): number {
  const left = gtmConcepts(a);
  const right = gtmConcepts(b);
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const concept of left) if (right.has(concept)) overlap++;
  if (overlap === 0) return 0;
  const union = new Set([...left, ...right]).size;
  return Math.min(0.72, 0.28 + (overlap / union) * 0.44);
}

function normalizeClaim(entry: ContextEntry): string {
  return [entry.title, entry.body].filter(Boolean).join(' ').trim();
}

function claimKey(entry: ContextEntry): string {
  const tokens = words(normalizeClaim(entry)).slice(0, 16);
  return tokens.length > 0 ? tokens.join('-').slice(0, 180) : entry.id;
}

function evidenceItems(entry: ContextEntry): Array<Record<string, unknown>> {
  return Array.isArray(entry.evidence) ? entry.evidence as Array<Record<string, unknown>> : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function normalizeEventOccurrence(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 16);
  }
  return raw.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
}

function sourceIdentityType(value: unknown): string {
  const type = String(value ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (type.includes('email')) return 'email';
  if (type.includes('crm')) return 'crm';
  if (type.includes('warehouse')) return 'warehouse';
  if (type.includes('support')) return 'support';
  if (type.includes('product')) return 'product_usage';
  if ([
    'activity',
    'add_context',
    'mcp',
    'manual',
    'raw_context',
    'call',
    'call_transcript',
    'meeting',
    'meeting_notes',
    'note',
    'notes',
    'transcript',
  ].includes(type)) {
    return 'raw_context_event';
  }
  return type || 'unknown';
}

function sourceKeyFromEvidence(evidence: Record<string, unknown>, fallback: ContextEntry): string {
  const type = sourceIdentityType(evidence.source_type ?? fallback.source ?? 'unknown');
  const speaker = evidence.speaker ? `:${String(evidence.speaker).toLowerCase()}` : '';
  const contentHash = stringValue(evidence.source_content_hash)
    ?? stringValue(evidence.document_hash)
    ?? stringValue(evidence.raw_context_document_hash);
  const explicitOccurrence = evidence.source_event_at_provided === true || evidence.source_occurred_at_provided === true
    ? normalizeEventOccurrence(evidence.source_event_at ?? evidence.source_occurred_at ?? evidence.observed_at)
    : null;
  if (explicitOccurrence) {
    return `${type}:event:${explicitOccurrence}${speaker}`;
  }
  if (contentHash) {
    return `${type}:content:${contentHash}@event_unknown${speaker}`;
  }

  const stableSourceRef = stringValue(evidence.raw_context_source_ref)
    ?? stringValue(evidence.source_id)
    ?? stringValue(evidence.source_ref)
    ?? stringValue(evidence.source_url)
    ?? stringValue(fallback.source_ref);
  if (stableSourceRef) return `${type}:${stableSourceRef}${speaker}`;

  const snippet = stringValue(evidence.snippet) ?? fallback.body ?? normalizeClaim(fallback);
  return `${type}:snippet:${shortHash(snippet)}${speaker}`;
}

function sourceKey(entry: ContextEntry): string {
  const evidence = evidenceItems(entry)[0] ?? {};
  return sourceKeyFromEvidence(evidence, entry);
}

function sourceWeight(entry: ContextEntry): number {
  const evidence = evidenceItems(entry)[0] ?? {};
  const type = sourceIdentityType(evidence.source_type ?? entry.source ?? '');
  if (['email', 'crm', 'warehouse'].includes(type)) return 1.0;
  if (['support', 'product_usage', 'slack', 'mcp', 'add_context', 'manual', 'raw_context', 'raw_context_event'].includes(type)) return 0.9;
  if (['research', 'external_research'].includes(type)) return 0.75;
  return 0.85;
}

function sourceTrustLabel(weight: number): string {
  if (weight >= 0.98) return 'High';
  if (weight >= 0.85) return 'Medium';
  return 'Lower';
}

function looksConflicting(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const negation = /\b(no|not|never|blocked|unresolved|denied|declined|lost|against|without)\b/;
  const positive = /\b(yes|approved|resolved|confirmed|accepted|won|supports|with)\b/;
  return (negation.test(left) && positive.test(right)) || (positive.test(left) && negation.test(right));
}

type RelationDecision = {
  relation: signalGroupRepo.SignalGroupRelation | 'unrelated';
  confidence: number;
  rationale?: string;
  method: 'deterministic' | 'llm';
};

function deterministicRelation(newClaim: string, existingClaim: string, score: number): RelationDecision {
  return {
    relation: looksConflicting(newClaim, existingClaim) ? 'conflicts' : 'supports',
    confidence: Math.max(0.55, Math.min(0.95, score)),
    rationale: score >= 0.42
      ? 'Matched by claim similarity and GTM concept overlap.'
      : 'Matched by nearby GTM concepts; no local model verifier was available.',
    method: 'deterministic',
  };
}

async function hasVerifierModel(db: DbPool, tenantId: UUID | string): Promise<boolean> {
  try {
    const config = await agentRepo.getConfig(db, String(tenantId));
    return Boolean(config?.enabled && config.model && config.base_url);
  } catch {
    return false;
  }
}

function parseRelationDecision(raw: string): RelationDecision | null {
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const relation = String(parsed.relation ?? '').toLowerCase();
    if (!['supports', 'conflicts', 'unrelated'].includes(relation)) return null;
    return {
      relation: relation as RelationDecision['relation'],
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5))),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 500) : undefined,
      method: 'llm',
    };
  } catch {
    return null;
  }
}

async function verifySignalRelation(
  db: DbPool,
  tenantId: UUID | string,
  input: {
    contextType: string;
    newClaim: string;
    existingClaim: string;
    similarityScore: number;
  },
): Promise<RelationDecision | null> {
  if (!(await hasVerifierModel(db, tenantId))) return null;
  try {
    const response = await callLLM(db, String(tenantId), {
      maxTokens: 250,
      system: [
        'You are CRMy Signal relation verifier.',
        'Classify whether a new inferred GTM Signal supports, conflicts with, or is unrelated to an existing Signal.',
        'Use supports when both claims express the same operational meaning or one adds evidence for the other.',
        'Use conflicts when both claims are about the same subject/context but cannot both be true.',
        'Use unrelated when they are merely about the same account but different claims.',
        'Return valid JSON only: {"relation":"supports|conflicts|unrelated","confidence":0.0,"rationale":"short reason"}',
      ].join('\n'),
      user: JSON.stringify({
        context_type: input.contextType,
        similarity_score: input.similarityScore,
        new_signal_claim: input.newClaim,
        existing_signal_claim: input.existingClaim,
      }),
    });
    return parseRelationDecision(response);
  } catch (err) {
    console.warn(`[signals] relation verifier fallback: ${(err as Error).message}`);
    return null;
  }
}

function confidenceComponents(entries: ContextEntry[], independentSources: number, conflictCount: number) {
  const weights = entries.map(sourceWeight);
  const weighted = entries.map((entry, index) => (entry.confidence ?? 0.5) * weights[index]);
  const base = weighted.length > 0 ? Math.max(...weighted) : 0;
  const strongestSourceWeight = weights.length > 0 ? Math.max(...weights) : 0;
  const uniqueSupportCount = Math.min(entries.length, independentSources);
  const supportBoost = Math.min(0.08, Math.max(0, uniqueSupportCount - 1) * 0.04);
  const sourceBoost = Math.min(0.12, Math.max(0, independentSources - 1) * 0.06);
  const conflictPenalty = Math.min(0.35, conflictCount * 0.18);
  const score = Math.max(0, Math.min(0.98, Number((base + supportBoost + sourceBoost - conflictPenalty).toFixed(3))));
  return {
    score,
    strongest_evidence_confidence: entries.length > 0 ? Math.max(...entries.map(entry => entry.confidence ?? 0.5)) : 0,
    strongest_source_weight: strongestSourceWeight,
    source_trust_label: sourceTrustLabel(strongestSourceWeight),
    base: Number(base.toFixed(3)),
    support_boost: supportBoost,
    source_boost: sourceBoost,
    conflict_penalty: conflictPenalty,
    duplicate_source_count: Math.max(0, entries.length - independentSources),
  };
}

function aggregateConfidence(entries: ContextEntry[], independentSources: number, conflictCount: number): number {
  return confidenceComponents(entries, independentSources, conflictCount).score;
}

async function resolveCustomerScope(
  db: DbPool,
  tenantId: UUID | string,
  subjectType: string,
  subjectId: UUID | string,
): Promise<{ account_id?: string; account_name?: string }> {
  const result = await db.query(
    `SELECT scope.account_id, a.name AS account_name
     FROM (
       SELECT CASE
         WHEN $2 = 'account' THEN $3::uuid
         WHEN $2 = 'contact' THEN (SELECT account_id FROM contacts WHERE tenant_id = $1 AND id = $3)
         WHEN $2 = 'opportunity' THEN (SELECT account_id FROM opportunities WHERE tenant_id = $1 AND id = $3)
         WHEN $2 = 'use_case' THEN (SELECT account_id FROM use_cases WHERE tenant_id = $1 AND id = $3)
       END AS account_id
     ) scope
     LEFT JOIN accounts a ON a.tenant_id = $1 AND a.id = scope.account_id`,
    [tenantId, subjectType, subjectId],
  );
  const row = result.rows[0] as { account_id?: string | null; account_name?: string | null } | undefined;
  return {
    account_id: row?.account_id ?? undefined,
    account_name: row?.account_name ?? undefined,
  };
}

function groupStatus(input: {
  confidence: number;
  threshold: number;
  supportCount: number;
  independentSourceCount: number;
  conflictCount: number;
  sensitive: boolean;
  convergenceBlocked: boolean;
  readinessBlocked: boolean;
}): { status: signalGroupRepo.SignalGroupStatus; blockedReason?: string } {
  if (input.conflictCount > 0) return { status: 'conflicting', blockedReason: 'Conflicting evidence needs review.' };
  if (input.convergenceBlocked) return { status: 'blocked', blockedReason: 'Similar or conflicting Memory already exists.' };
  if (input.readinessBlocked) return { status: 'blocked', blockedReason: 'Needs more detail before agents can rely on it as Memory.' };
  if (input.confidence < input.threshold) return { status: 'gathering', blockedReason: 'Waiting for stronger evidence.' };
  if (input.sensitive && input.independentSourceCount < 2) {
    return { status: 'blocked', blockedReason: 'Sensitive context needs corroboration or approval before becoming Memory.' };
  }
  return { status: 'ready' };
}

async function recomputeGroup(
  db: DbPool,
  tenantId: UUID | string,
  groupId: UUID | string,
  threshold: number,
): Promise<signalGroupRepo.SignalGroupWithMembers> {
  const group = await signalGroupRepo.getSignalGroup(db, tenantId, groupId);
  if (!group) throw new Error('Signal not found');
  const supporting = group.members
    .filter(member => member.relation === 'supports')
    .map(member => member.context_entry)
    .filter(Boolean) as ContextEntry[];
  const conflictCount = group.members.filter(member => member.relation === 'conflicts').length;
  const sourceKeys = supporting.map(sourceKey);
  const independentSources = new Set(sourceKeys).size;
  const duplicateSourceCount = Math.max(0, supporting.length - independentSources);
  const evidenceCount = supporting.reduce((sum, entry) => sum + evidenceItems(entry).length, 0);
  const confidence = aggregateConfidence(supporting, independentSources, conflictCount);
  const readinessBlockers = supporting.flatMap(entry => {
    const data = entry.structured_data ?? {};
    return Array.isArray(data.readiness_blockers) ? data.readiness_blockers.map(String) : [];
  });
  const missingDetails = Array.from(new Set(supporting.flatMap(entry => {
    const data = entry.structured_data ?? {};
    return Array.isArray(data.missing_details) ? data.missing_details.map(String) : [];
  })));
  const typedCompletenessValues = supporting
    .map(entry => Number((entry.structured_data ?? {}).extraction_completeness))
    .filter(value => Number.isFinite(value));
  const typedCompleteness = typedCompletenessValues.length > 0
    ? Math.max(0, Math.min(1, Math.min(...typedCompletenessValues)))
    : null;
  const latest = supporting[0] ?? null;
  const convergence = latest
    ? await checkContextConvergence(db, tenantId as UUID, {
      subject_type: latest.subject_type,
      subject_id: latest.subject_id,
      context_type: latest.context_type,
      title: latest.title,
      body: latest.body,
      structured_data: latest.structured_data,
    })
    : { should_block: false };
  const sensitive = SENSITIVE_CONTEXT_TYPES.has(group.context_type);
  const state = groupStatus({
    confidence,
    threshold,
    supportCount: supporting.length,
    independentSourceCount: independentSources,
    conflictCount,
    sensitive,
    convergenceBlocked: Boolean(convergence.should_block),
    readinessBlocked: readinessBlockers.length > 0,
  });
  const components = confidenceComponents(supporting, independentSources, conflictCount);
  const promotionBlockers = [
    ...(conflictCount > 0 ? ['Conflicting evidence needs review.'] : []),
    ...(Boolean(convergence.should_block) ? ['Similar or conflicting Memory already exists.'] : []),
    ...Array.from(new Set(readinessBlockers)),
    ...(confidence < threshold ? [`Readiness score is ${Math.round(confidence * 100)}%, below the ${Math.round(threshold * 100)}% confirmation threshold.`] : []),
    ...(sensitive && independentSources < 2 ? ['Sensitive context needs corroboration or approval before becoming Memory.'] : []),
  ];
  const readiness = deriveSignalReadiness({
    group_status: state.status,
    score: confidence,
    threshold,
    support_count: supporting.length,
    independent_source_count: independentSources,
    duplicate_source_count: duplicateSourceCount,
    evidence_count: evidenceCount,
    conflict_count: conflictCount,
    model_confidence: components.strongest_evidence_confidence,
    source_quality: components.strongest_source_weight,
    source_boost: components.source_boost,
    conflict_penalty: components.conflict_penalty,
    typed_completeness: typedCompleteness,
    sensitive,
    requires_approval: sensitive && independentSources < 2,
    convergence_blocked: Boolean(convergence.should_block),
    readiness_blockers: readinessBlockers,
    missing_details: missingDetails,
    promotion_blockers: promotionBlockers,
    blocked_reason: state.blockedReason,
  });
  await signalGroupRepo.updateSignalGroupState(db, tenantId, group.id, {
    status: state.status,
    aggregate_confidence: confidence,
    support_count: supporting.length,
    independent_source_count: independentSources,
    conflict_count: conflictCount,
    evidence_count: evidenceCount,
    latest_signal_id: latest?.id ?? null,
    blocked_reason: state.blockedReason,
    metadata: {
      sensitive,
      threshold,
      trust_score: confidence,
      confidence_components: components,
      readiness,
      readiness_blockers: Array.from(new Set(readinessBlockers)),
      promotion_blockers: promotionBlockers,
      missing_details: missingDetails,
      typed_completeness: typedCompleteness,
      duplicate_source_count: duplicateSourceCount,
      repeated_context_note: duplicateSourceCount > 0
        ? `${duplicateSourceCount} repeated ${duplicateSourceCount === 1 ? 'Signal uses' : 'Signals use'} the same source identity and did not increase independent corroboration.`
        : undefined,
      promotion_reason: promotionBlockers.length === 0
        ? 'This Signal has enough evidence, source independence, and confidence to become confirmed Memory.'
        : 'This Signal needs review or more support before confirmation.',
      requires_corroboration: sensitive && independentSources < 2,
      can_promote_manually: conflictCount === 0 && !Boolean(convergence.should_block),
      suggested_action: (convergence as { suggested_action?: string }).suggested_action,
    },
  });
  const refreshed = await signalGroupRepo.getSignalGroup(db, tenantId, group.id);
  if (!refreshed) throw new Error('Signal not found after update');
  return refreshed;
}

async function promoteReadyGroup(
  db: DbPool,
  tenantId: UUID | string,
  group: signalGroupRepo.SignalGroupWithMembers,
  actorId: UUID | string,
  policyActor?: ActorContext,
  approved = false,
): Promise<ContextEntry | null> {
  if (group.status !== 'ready') return null;
  const supporting = group.members
    .filter(member => member.relation === 'supports')
    .map(member => member.context_entry)
    .filter(Boolean) as ContextEntry[];
  const candidate = supporting
    .filter(entry => entry.memory_status === 'signal')
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  if (!candidate) return null;

  const evidence = supporting.flatMap(entry => evidenceItems(entry));
  const policy = evaluateActionPolicy({
    action_type: 'context.signal_promote',
    object_type: candidate.subject_type,
    actor: policyActor ?? {
      tenant_id: tenantId as UUID,
      actor_id: actorId as UUID,
      actor_type: 'agent',
      role: 'admin',
      scopes: ['context:write'],
    },
    approved,
    confidence: group.aggregate_confidence,
    evidence: evidence as ContextEvidence[],
    memory_status: 'signal',
  });
  if (policy.decision === 'blocked' || policy.decision === 'approval_required') return null;

  const promoted = await contextRepo.promoteSignal(db, tenantId as UUID, candidate.id, actorId as UUID, {
    confidence: group.aggregate_confidence,
    evidence,
    structured_data: {
      ...candidate.structured_data,
      signal_group_id: group.id,
      signal_group_support_count: group.support_count,
      signal_group_independent_sources: group.independent_source_count,
    },
    tags: Array.from(new Set([...(candidate.tags ?? []), 'signal-group'])),
  });
  if (!promoted) return null;
  await signalGroupRepo.markGroupPromoted(db, tenantId, group.id, promoted.id);
  await signalGroupRepo.updateSignalGroupMetadata(db, tenantId, group.id, {
    readiness: signalReadinessForGroup({
      ...group,
      status: 'promoted',
      promoted_context_entry_id: promoted.id,
      blocked_reason: null,
    }),
  });
  await signalGroupRepo.markSupportSignalsSupersededExcept(db, tenantId, group.id, promoted.id);
  await emitEvent(db, {
    tenantId: tenantId as UUID,
    eventType: 'context.signal_group_promoted',
    actorId: actorId as UUID,
    actorType: 'agent',
    objectType: 'context_entry',
    objectId: promoted.id,
    afterData: promoted,
    metadata: {
      signal_group_id: group.id,
      aggregate_confidence: group.aggregate_confidence,
      support_count: group.support_count,
      independent_source_count: group.independent_source_count,
    },
  });
  outboxRepo.insertJob(db, tenantId as UUID, 'context_entry', promoted.id, promoted as unknown as Record<string, unknown>)
    .catch((err: unknown) => console.warn(`[outbox] signal group promote ${promoted.id}: ${(err as Error).message}`));
  await ensureEmbeddingBestEffort(db, tenantId, 'context_entry', promoted.id, promoted.body);
  return promoted;
}

export async function attachSignalToGroup(
  db: DbPool,
  tenantId: UUID | string,
  entry: ContextEntry,
  options: {
    threshold: number;
    autoPromote: boolean;
    actorId: UUID | string;
  },
): Promise<{
  signal_group: signalGroupRepo.SignalGroupWithMembers;
  promoted_context_entry?: ContextEntry;
}> {
  const normalized = normalizeClaim(entry);
  const entryWords = words(normalized);
  const customerScope = await resolveCustomerScope(db, tenantId, entry.subject_type, entry.subject_id);
  const candidates = await retrieveSignalGroupCandidates(db, tenantId, {
    subject_type: entry.subject_type,
    subject_id: entry.subject_id,
    context_type: entry.context_type,
    claim_text: normalized,
  });
  const scoredCandidates = candidates
    .map(group => {
      const lexical = jaccard(entryWords, words(group.normalized_claim));
      const semantic = semanticClaimScore(normalized, group.normalized_claim);
      const vector = Number((group as { vector_similarity?: number }).vector_similarity ?? 0);
      return {
        group,
        score: Math.max(lexical, semantic, vector),
        lexical,
        semantic,
        vector,
      };
    })
    .sort((a, b) => b.score - a.score);
  let best: (typeof scoredCandidates)[number] | undefined;
  let relationDecision: RelationDecision | null = null;

  for (const candidate of scoredCandidates.slice(0, 3)) {
    if (candidate.score < 0.18) continue;
    const verified = await verifySignalRelation(db, tenantId, {
      contextType: entry.context_type,
      newClaim: normalized,
      existingClaim: candidate.group.normalized_claim,
      similarityScore: candidate.score,
    });
    if (verified?.relation === 'unrelated' && verified.confidence >= 0.65) {
      continue;
    }
    if ((verified?.relation === 'supports' || verified?.relation === 'conflicts') && verified.confidence >= 0.62) {
      best = candidate;
      relationDecision = verified;
      break;
    }
    if (!relationDecision && candidate.score >= 0.42) {
      best = candidate;
      relationDecision = deterministicRelation(normalized, candidate.group.normalized_claim, candidate.score);
      break;
    }
  }

  if (!best || !relationDecision) {
    best = {
      score: 1,
      lexical: 1,
      semantic: 1,
      vector: 0,
      group: await signalGroupRepo.upsertSignalGroup(db, tenantId, {
        subject_type: entry.subject_type,
        subject_id: entry.subject_id,
        context_type: entry.context_type,
        claim_key: claimKey(entry),
        title: entry.title ?? entry.body.slice(0, 90),
        normalized_claim: normalized,
        metadata: {
          created_from_signal_id: entry.id,
          grouping_method: 'new_group',
          customer_scope: customerScope,
        },
      }),
    };
    relationDecision = deterministicRelation(normalized, best.group.normalized_claim, best.score);
  }

  const selected = best;
  const relation = relationDecision?.relation === 'conflicts' ? 'conflicts' : 'supports';
  await signalGroupRepo.addSignalGroupMember(db, tenantId, {
    signal_group_id: selected.group.id,
    context_entry_id: entry.id,
    relation,
    similarity_score: relationDecision?.method === 'llm'
      ? Math.max(selected.score, relationDecision.confidence)
      : selected.score,
    evidence_weight: sourceWeight(entry),
    source_key: sourceKey(entry),
  });
  await signalGroupRepo.updateSignalGroupMetadata(db, tenantId, selected.group.id, {
    last_grouping: {
      signal_id: entry.id,
      method: relationDecision?.method ?? 'deterministic',
      relation,
      relation_confidence: relationDecision?.confidence ?? selected.score,
      similarity_score: selected.score,
      lexical_score: selected.lexical,
      semantic_score: selected.semantic,
      vector_similarity: selected.vector,
      rationale: relationDecision?.rationale,
      customer_scope: customerScope,
      decided_at: new Date().toISOString(),
    },
  });

  const signalGroup = await recomputeGroup(db, tenantId, selected.group.id, options.threshold);
  await ensureEmbeddingBestEffort(
    db,
    tenantId,
    'signal_group',
    signalGroup.id,
    [signalGroup.context_type, signalGroup.title ?? '', signalGroup.normalized_claim, signalGroup.subject_name ?? ''].filter(Boolean).join('\n'),
  );
  const promoted = options.autoPromote
    ? await promoteReadyGroup(db, tenantId, signalGroup, options.actorId)
    : null;
  const refreshed = await signalGroupRepo.getSignalGroup(db, tenantId, signalGroup.id);
  return {
    signal_group: refreshed ?? signalGroup,
    promoted_context_entry: promoted ?? undefined,
  };
}

export async function promoteSignalGroup(
  db: DbPool,
  tenantId: UUID | string,
  groupId: UUID | string,
  actorId: UUID | string,
  actor?: ActorContext,
): Promise<{ signal_group: signalGroupRepo.SignalGroupWithMembers; context_entry: ContextEntry | null }> {
  const current = await signalGroupRepo.getSignalGroup(db, tenantId, groupId);
  const threshold = typeof current?.metadata?.threshold === 'number' ? current.metadata.threshold : 0.85;
  const group = await recomputeGroup(db, tenantId, groupId, threshold);
  if (group.status === 'conflicting') {
    throw validationError('This Signal has conflicting evidence. Send it to Handoff before promoting it to Memory.');
  }
  if (group.status === 'blocked') {
    const blockers = Array.isArray(group.metadata?.promotion_blockers)
      ? group.metadata.promotion_blockers.map(String)
      : group.blocked_reason
        ? [group.blocked_reason]
        : [];
    const unresolvedBlockers = blockers.filter(blocker => !blocker.toLowerCase().includes('needs corroboration or approval'));
    if (actor?.actor_type !== 'user' || unresolvedBlockers.length > 0) {
      throw validationError(group.blocked_reason ?? 'This Signal needs approval before becoming Memory.');
    }
  }
  if (group.status === 'promoted' || group.status === 'dismissed') {
    throw validationError(`This Signal is already ${group.status}.`);
  }
  const forced = { ...group, status: 'ready' as const };
  const promoted = await promoteReadyGroup(db, tenantId, forced, actorId, actor, actor?.actor_type === 'user');
  const refreshed = await signalGroupRepo.getSignalGroup(db, tenantId, groupId);
  if (!refreshed) throw new Error('Signal not found');
  return { signal_group: refreshed, context_entry: promoted };
}

export async function regroupSignalAfterEmbedding(
  db: DbPool,
  tenantId: UUID | string,
  contextEntryId: UUID | string,
): Promise<{ regrouped: boolean; target_group_id?: UUID | string }> {
  const entry = await contextRepo.getContextEntry(db, tenantId as UUID, contextEntryId as UUID);
  if (!entry || entry.memory_status !== 'signal') return { regrouped: false };
  const existingGroups = await signalGroupRepo.listGroupsForContextEntry(db, tenantId, entry.id);
  const currentGroup = existingGroups[0];
  const normalized = normalizeClaim(entry);
  const candidates = await retrieveSignalGroupCandidates(db, tenantId, {
    subject_type: entry.subject_type,
    subject_id: entry.subject_id,
    context_type: entry.context_type,
    claim_text: normalized,
    limit: 10,
  });
  const best = candidates
    .filter(group => group.id !== currentGroup?.id)
    .filter(group => (group.vector_similarity ?? 0) >= 0.72)
    .sort((a, b) => (b.vector_similarity ?? 0) - (a.vector_similarity ?? 0))[0];
  if (!best || !currentGroup) return { regrouped: false };

  await signalGroupRepo.addSignalGroupMember(db, tenantId, {
    signal_group_id: best.id,
    context_entry_id: entry.id,
    relation: 'supports',
    similarity_score: best.vector_similarity ?? 0.72,
    evidence_weight: sourceWeight(entry),
    source_key: sourceKey(entry),
  });
  await recomputeGroup(db, tenantId, best.id, Number(best.metadata?.threshold ?? 0.85));

  if (!currentGroup.promoted_context_entry_id && ['gathering', 'ready', 'blocked', 'conflicting'].includes(currentGroup.status)) {
    await signalGroupRepo.moveSignalGroupMembers(db, tenantId, currentGroup.id, best.id);
    await signalGroupRepo.markSignalGroupMerged(db, tenantId, currentGroup.id, best.id);
    await recomputeGroup(db, tenantId, best.id, Number(best.metadata?.threshold ?? 0.85));
    await emitEvent(db, {
      tenantId: tenantId as UUID,
      eventType: 'context.signal_group_merged',
      actorId: 'system',
      actorType: 'system',
      objectType: 'context_entry',
      objectId: entry.id,
      metadata: {
        source_signal_group_id: currentGroup.id,
        target_signal_group_id: best.id,
        vector_similarity: best.vector_similarity,
      },
    });
  }

  return { regrouped: true, target_group_id: best.id };
}

export async function dismissSignalGroup(
  db: DbPool,
  tenantId: UUID | string,
  groupId: UUID | string,
  actorId: UUID | string,
  reason?: string,
): Promise<signalGroupRepo.SignalGroupWithMembers | null> {
  await signalGroupRepo.dismissSignalGroup(db, tenantId, groupId, actorId, reason);
  const group = await signalGroupRepo.getSignalGroup(db, tenantId, groupId);
  if (!group) return null;
  const results = await Promise.allSettled(group.members
    .filter(member => member.relation === 'supports' && member.context_entry?.memory_status === 'signal')
    .map(member => contextRepo.rejectSignal(db, tenantId as UUID, member.context_entry_id as UUID, actorId as UUID, reason)));
  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length > 0) {
    console.warn('[signal-groups] Failed to reject one or more dismissed signal entries', {
      group_id: groupId,
      failed_count: failed.length,
    });
  }
  await signalGroupRepo.updateSignalGroupMetadata(db, tenantId, groupId, {
    readiness: signalReadinessForGroup({
      ...group,
      status: 'dismissed',
    }),
  });
  return signalGroupRepo.getSignalGroup(db, tenantId, groupId);
}

function detailDataOnly(data: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!STRUCTURED_READINESS_KEYS.has(key)) cleaned[key] = value;
  }
  return cleaned;
}

function supportingSignalEntry(group: signalGroupRepo.SignalGroupWithMembers): ContextEntry | null {
  const supporting = group.members
    .filter(member => member.relation === 'supports')
    .map(member => member.context_entry)
    .filter((entry): entry is ContextEntry => Boolean(entry && entry.memory_status === 'signal' && entry.is_current !== false));
  if (group.latest_signal_id) {
    const latest = supporting.find(entry => entry.id === group.latest_signal_id);
    if (latest) return latest;
  }
  return supporting[0] ?? null;
}

export async function completeSignalGroupDetails(
  db: DbPool,
  tenantId: UUID | string,
  groupId: UUID | string,
  actor: ActorContext,
  structuredDataPatch: Record<string, unknown>,
): Promise<{
  signal_group: signalGroupRepo.SignalGroupWithMembers;
  context_entry: ContextEntry;
  validation_warnings: string[];
  event_id: number;
}> {
  if (!structuredDataPatch || typeof structuredDataPatch !== 'object' || Array.isArray(structuredDataPatch)) {
    throw validationError('structured_data_patch must be an object.');
  }
  const group = await signalGroupRepo.getSignalGroup(db, tenantId, groupId);
  if (!group) throw validationError('Signal not found.');
  if (['promoted', 'dismissed', 'merged'].includes(group.status) || group.promoted_context_entry_id || group.merged_into_signal_group_id) {
    throw validationError('This Signal group is already resolved and cannot be edited.');
  }
  const entry = supportingSignalEntry(group);
  if (!entry) {
    throw validationError('This Signal has no current supporting Signal entry to update.');
  }

  const schema = await contextTypeRepo.getContextTypeSchema(db, tenantId as UUID, group.context_type);
  const existingDetails = detailDataOnly(entry.structured_data ?? {});
  const patchedDetails = {
    ...existingDetails,
    ...structuredDataPatch,
  };
  const memoryReadiness = evaluateMemoryReadiness(patchedDetails, schema);
  const nextStructuredData = {
    ...memoryReadiness.normalized_structured_data,
    readiness_blockers: memoryReadiness.readiness_blockers,
    missing_details: memoryReadiness.missing_details,
    extraction_completeness: memoryReadiness.extraction_completeness,
    validation_warnings: memoryReadiness.validation_warnings,
  };
  const updatedEntry = await contextRepo.updateSignalStructuredData(
    db,
    tenantId as UUID,
    entry.id as UUID,
    nextStructuredData,
  );
  if (!updatedEntry) {
    throw validationError('This Signal entry is no longer editable.');
  }

  outboxRepo.insertJob(db, tenantId as UUID, 'context_entry', updatedEntry.id, updatedEntry as unknown as Record<string, unknown>)
    .catch((err: unknown) => console.warn(`[outbox] signal detail completion enqueue ${updatedEntry.id}: ${(err as Error).message}`));

  const refreshedGroup = await recomputeGroup(db, tenantId, group.id, Number(group.metadata?.threshold ?? 0.85));
  const eventId = await emitEvent(db, {
    tenantId: tenantId as UUID,
    eventType: 'context.signal_group_details_completed',
    actorId: actor.actor_id,
    actorType: actor.actor_type,
    objectType: 'signal_group',
    objectId: group.id as UUID,
    metadata: {
      signal_group_id: group.id,
      context_entry_id: updatedEntry.id,
      subject_type: group.subject_type,
      subject_id: group.subject_id,
      patched_fields: Object.keys(structuredDataPatch),
      remaining_missing_details: memoryReadiness.missing_details,
      validation_warning_count: memoryReadiness.validation_warnings.length,
      readiness_status: signalReadinessForGroup(refreshedGroup).status,
    },
  });

  return {
    signal_group: refreshedGroup,
    context_entry: updatedEntry,
    validation_warnings: memoryReadiness.validation_warnings,
    event_id: eventId,
  };
}

export async function createSignalGroupHandoff(
  db: DbPool,
  tenantId: UUID | string,
  groupId: UUID | string,
  actorId: UUID | string,
  actor?: ActorContext,
  options?: {
    assigneeActorId?: string;
    reason?: string;
    note?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
  },
): Promise<{ signal_group: signalGroupRepo.SignalGroupWithMembers; hitl_request: unknown; reused_existing: boolean }> {
  const group = await signalGroupRepo.getSignalGroup(db, tenantId, groupId);
  if (!group) throw validationError('Signal not found.');
  if (options?.assigneeActorId) {
    const assignee = await actorRepo.getActor(db, tenantId as UUID, options.assigneeActorId as UUID);
    if (!assignee || !assignee.is_active) {
      throw validationError('Choose an active reviewer for this handoff.');
    }
  }

  const supporting = group.members
    .filter(member => member.relation === 'supports')
    .map(member => member.context_entry)
    .filter(Boolean) as ContextEntry[];
  const conflicts = group.members
    .filter(member => member.relation === 'conflicts')
    .map(member => member.context_entry)
    .filter(Boolean) as ContextEntry[];
  const evidence = [...supporting, ...conflicts].flatMap(entry => evidenceItems(entry));
  const metadata = group.metadata ?? {};
  const blockers = Array.isArray(metadata.promotion_blockers)
    ? metadata.promotion_blockers
    : group.blocked_reason
      ? [group.blocked_reason]
      : [];
  const subjectLabel = group.subject_name ?? `${group.subject_type} ${String(group.subject_id).slice(0, 8)}`;
  const existing = await hitlRepo.findPendingHITLByPayload(db, tenantId as UUID, 'context.signal_review', {
    signal_group_id: group.id,
  });
  if (existing) {
    const updated = (options?.assigneeActorId || options?.priority)
      ? await hitlRepo.updatePendingHITLRequest(db, tenantId as UUID, existing.id as UUID, {
        priority: options?.priority,
        escalate_to_id: options?.assigneeActorId as UUID | undefined,
      })
      : null;
    return { signal_group: group, hitl_request: updated ?? existing, reused_existing: true };
  }
  const hitl = await hitlRepo.createHITLRequest(db, tenantId as UUID, {
    agent_id: actor?.actor_id ?? String(actorId),
    action_type: 'context.signal_review',
    action_summary: `Review Signal for ${subjectLabel}: ${group.title ?? group.normalized_claim}`,
    action_payload: {
      signal_group_id: group.id,
      requested_decisions: ['promote_to_memory', 'dismiss', 'needs_more_context'],
      claim: group.normalized_claim,
      title: group.title,
      subject_type: group.subject_type,
      subject_id: group.subject_id,
      subject_name: group.subject_name,
      readiness_score: group.aggregate_confidence,
      status: group.status,
      promotion_blockers: blockers,
      reason: options?.reason,
      note: options?.note,
      evidence_count: group.evidence_count,
      independent_source_count: group.independent_source_count,
      conflict_count: group.conflict_count,
      evidence: evidence.slice(0, 12),
    },
    priority: options?.priority ?? (group.status === 'conflicting' ? 'high' : 'normal'),
    sla_minutes: 1440,
    escalate_to_id: options?.assigneeActorId as UUID | undefined,
  });
  await emitEvent(db, {
    tenantId: tenantId as UUID,
    eventType: 'hitl.submitted',
    actorId: actor?.actor_id ?? String(actorId),
    actorType: actor?.actor_type ?? 'agent',
    objectType: 'hitl_request',
    objectId: hitl.id as UUID,
    afterData: hitl,
    metadata: {
      signal_group_id: group.id,
      subject_type: group.subject_type,
      subject_id: group.subject_id,
      readiness_score: group.aggregate_confidence,
      assignee_actor_id: options?.assigneeActorId ?? null,
    },
  });
  await emitEvent(db, {
    tenantId: tenantId as UUID,
    eventType: 'context.signal_handoff_requested',
    actorId: actor?.actor_id ?? String(actorId),
    actorType: actor?.actor_type ?? 'agent',
    objectType: 'hitl_request',
    objectId: hitl.id as UUID,
    afterData: hitl,
    metadata: {
      signal_group_id: group.id,
      subject_type: group.subject_type,
      subject_id: group.subject_id,
      readiness_score: group.aggregate_confidence,
      assignee_actor_id: options?.assigneeActorId ?? null,
      reason: options?.reason,
    },
  });
  return { signal_group: group, hitl_request: hitl, reused_existing: false };
}

export const __testSignalGrouping = {
  semanticClaimScore,
  parseRelationDecision,
  deterministicRelation,
  sourceKey,
  confidenceComponents,
};
