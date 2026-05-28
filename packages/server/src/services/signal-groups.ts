// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ContextEntry, ContextEvidence, UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as contextRepo from '../db/repos/context-entries.js';
import * as signalGroupRepo from '../db/repos/signal-groups.js';
import { checkContextConvergence } from './context-convergence.js';
import { evaluateActionPolicy } from './action-policy.js';
import { emitEvent } from '../events/emitter.js';
import * as outboxRepo from '../db/repos/context-outbox.js';

const SENSITIVE_CONTEXT_TYPES = new Set([
  'stakeholder',
  'stakeholder_role',
  'stakeholder_map',
  'risk',
  'deal_risk',
  'forecast',
  'forecast_risk',
  'commitment',
  'next_step',
  'methodology_gap',
  'buyer_role',
  'approval',
]);

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'is', 'it', 'may', 'might', 'of', 'on', 'or', 'that', 'the', 'this', 'to',
  'was', 'with', 'will', 'would',
]);

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

function sourceKey(entry: ContextEntry): string {
  const evidence = evidenceItems(entry)[0] ?? {};
  const type = String(evidence.source_type ?? entry.source ?? 'unknown');
  const ref = String(evidence.source_id ?? evidence.source_ref ?? evidence.source_url ?? entry.source_ref ?? entry.id);
  const speaker = evidence.speaker ? `:${String(evidence.speaker).toLowerCase()}` : '';
  return `${type}:${ref}${speaker}`;
}

function sourceWeight(entry: ContextEntry): number {
  const evidence = evidenceItems(entry)[0] ?? {};
  const type = String(evidence.source_type ?? entry.source ?? '').toLowerCase();
  if (['email', 'inbound_email', 'crm_sync', 'warehouse_sync', 'activity', 'transcript'].includes(type)) return 1.0;
  if (['support', 'product_usage', 'slack', 'mcp'].includes(type)) return 0.9;
  if (['research', 'external_research'].includes(type)) return 0.75;
  return 0.85;
}

function looksConflicting(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const negation = /\b(no|not|never|blocked|unresolved|denied|declined|lost|against|without)\b/;
  const positive = /\b(yes|approved|resolved|confirmed|accepted|won|supports|with)\b/;
  return (negation.test(left) && positive.test(right)) || (positive.test(left) && negation.test(right));
}

function aggregateConfidence(entries: ContextEntry[], independentSources: number, conflictCount: number): number {
  const weighted = entries.map(entry => (entry.confidence ?? 0.5) * sourceWeight(entry));
  const base = weighted.length > 0 ? Math.max(...weighted) : 0;
  const supportBoost = Math.min(0.16, Math.max(0, entries.length - 1) * 0.04);
  const sourceBoost = Math.min(0.12, Math.max(0, independentSources - 1) * 0.06);
  const conflictPenalty = Math.min(0.35, conflictCount * 0.18);
  return Math.max(0, Math.min(0.98, Number((base + supportBoost + sourceBoost - conflictPenalty).toFixed(3))));
}

function groupStatus(input: {
  confidence: number;
  threshold: number;
  supportCount: number;
  independentSourceCount: number;
  conflictCount: number;
  sensitive: boolean;
  convergenceBlocked: boolean;
}): { status: signalGroupRepo.SignalGroupStatus; blockedReason?: string } {
  if (input.conflictCount > 0) return { status: 'conflicting', blockedReason: 'Conflicting evidence needs review.' };
  if (input.convergenceBlocked) return { status: 'blocked', blockedReason: 'Similar or conflicting Memory already exists.' };
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
  if (!group) throw new Error('Signal Group not found');
  const supporting = group.members
    .filter(member => member.relation === 'supports')
    .map(member => member.context_entry)
    .filter(Boolean) as ContextEntry[];
  const conflictCount = group.members.filter(member => member.relation === 'conflicts').length;
  const independentSources = new Set(supporting.map(sourceKey)).size;
  const evidenceCount = supporting.reduce((sum, entry) => sum + evidenceItems(entry).length, 0);
  const confidence = aggregateConfidence(supporting, independentSources, conflictCount);
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
      suggested_action: (convergence as { suggested_action?: string }).suggested_action,
    },
  });
  const refreshed = await signalGroupRepo.getSignalGroup(db, tenantId, group.id);
  if (!refreshed) throw new Error('Signal Group not found after update');
  return refreshed;
}

async function promoteReadyGroup(
  db: DbPool,
  tenantId: UUID | string,
  group: signalGroupRepo.SignalGroupWithMembers,
  actorId: UUID | string,
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
    actor: {
      tenant_id: tenantId as UUID,
      actor_id: actorId as UUID,
      actor_type: 'agent',
      role: 'admin',
      scopes: ['context:write'],
    },
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
  const candidates = await signalGroupRepo.listCandidateGroups(db, tenantId, {
    subject_type: entry.subject_type,
    subject_id: entry.subject_id,
    context_type: entry.context_type,
  });
  let best = candidates
    .map(group => ({ group, score: jaccard(entryWords, words(group.normalized_claim)) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 0.42) {
    best = {
      score: 1,
      group: await signalGroupRepo.upsertSignalGroup(db, tenantId, {
        subject_type: entry.subject_type,
        subject_id: entry.subject_id,
        context_type: entry.context_type,
        claim_key: claimKey(entry),
        title: entry.title ?? entry.body.slice(0, 90),
        normalized_claim: normalized,
        metadata: { created_from_signal_id: entry.id },
      }),
    };
  }

  const relation: signalGroupRepo.SignalGroupRelation = looksConflicting(normalized, best.group.normalized_claim)
    ? 'conflicts'
    : 'supports';
  await signalGroupRepo.addSignalGroupMember(db, tenantId, {
    signal_group_id: best.group.id,
    context_entry_id: entry.id,
    relation,
    similarity_score: best.score,
    evidence_weight: sourceWeight(entry),
    source_key: sourceKey(entry),
  });

  const signalGroup = await recomputeGroup(db, tenantId, best.group.id, options.threshold);
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
): Promise<{ signal_group: signalGroupRepo.SignalGroupWithMembers; context_entry: ContextEntry | null }> {
  const group = await recomputeGroup(db, tenantId, groupId, 0);
  const forced = { ...group, status: 'ready' as const };
  const promoted = await promoteReadyGroup(db, tenantId, forced, actorId);
  const refreshed = await signalGroupRepo.getSignalGroup(db, tenantId, groupId);
  if (!refreshed) throw new Error('Signal Group not found');
  return { signal_group: refreshed, context_entry: promoted };
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
  await Promise.all(group.members
    .filter(member => member.relation === 'supports' && member.context_entry?.memory_status === 'signal')
    .map(member => contextRepo.rejectSignal(db, tenantId as UUID, member.context_entry_id as UUID, actorId as UUID, reason)));
  return signalGroupRepo.getSignalGroup(db, tenantId, groupId);
}
