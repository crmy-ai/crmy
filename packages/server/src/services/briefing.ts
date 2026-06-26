// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type {
  ActionContextProposedActionType,
  Briefing,
  ContextEvidence,
  EvidenceMode,
  UUID,
  SubjectType,
  ContextEntry,
  AdjacentContext,
  ActiveSequenceEnrollment,
  TokenBudgetProfile,
  ProductContext,
  ActorContext,
} from '@crmy/shared';
import { isProductKnowledgeConfigured, getProductContextForSubject } from './knowledge-retrieval.js';
import * as contactRepo from '../db/repos/contacts.js';
import * as accountRepo from '../db/repos/accounts.js';
import * as oppRepo from '../db/repos/opportunities.js';
import * as ucRepo from '../db/repos/use-cases.js';
import * as activityRepo from '../db/repos/activities.js';
import * as assignmentRepo from '../db/repos/assignments.js';
import * as contextRepo from '../db/repos/context-entries.js';
import * as signalGroupRepo from '../db/repos/signal-groups.js';
import { withSignalReadiness } from './signal-readiness.js';
import * as contextTypeRepo from '../db/repos/context-type-registry.js';
import { detectContradictions } from './contradictions.js';

/** Parse a duration string like "7d", "24h", "30m" into an ISO timestamp. */
function parseSince(since?: string): string | undefined {
  if (!since) return undefined;
  if (since.includes('T') || since.includes('-')) return since;
  const match = since.match(/^(\d+)([dhm])$/);
  if (!match) return since;
  const [, num, unit] = match;
  const ms = parseInt(num, 10) * (unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000);
  return new Date(Date.now() - ms).toISOString();
}

/** Context types that signal what product knowledge would help a draft for this subject. */
const PRODUCT_QUERY_TYPES = new Set([
  'objection', 'competitive_intel', 'deal_risk', 'buying_process',
  'success_criteria', 'pain_point', 'next_step', 'use_case_fit',
]);

function subjectDisplayName(subject: Record<string, unknown>): string {
  if (typeof subject.name === 'string' && subject.name) return subject.name;
  const first = typeof subject.first_name === 'string' ? subject.first_name : '';
  const last = typeof subject.last_name === 'string' ? subject.last_name : '';
  return `${first} ${last}`.trim();
}

/** Derive a product-knowledge query from the subject and its most relevant context. */
function buildProductQuery(subject: Record<string, unknown>, entries: ContextEntry[]): string {
  const name = subjectDisplayName(subject);
  const parts = entries
    .filter(entry => PRODUCT_QUERY_TYPES.has(entry.context_type))
    .slice(0, 8)
    .map(entry => `${entry.title ?? ''} ${entry.body}`.trim())
    .filter(Boolean);
  const text = [name, ...parts].filter(Boolean).join('. ').slice(0, 600);
  return text || name || 'product overview';
}

/** Rough token estimate: ~4 chars per token, plus per-entry overhead. */
function estimateTokens(entry: ContextEntry): number {
  return Math.ceil(((entry.title?.length ?? 0) + entry.body.length + 80) / 4);
}

/**
 * Compute a priority score for a context entry.
 *
 * score = effective_confidence × priority_weight
 *
 * effective_confidence applies a half-life decay to the stored confidence
 * value. If no confidence is stored, 0.7 is assumed. If the context type
 * has no half-life configured, confidence is treated as constant.
 */
function computePriorityScore(
  entry: ContextEntry,
  weights: Map<string, { priority_weight: number; confidence_half_life_days: number | null }>,
  now: Date,
  actionType?: ActionContextProposedActionType,
): number {
  const w = weights.get(entry.context_type) ?? { priority_weight: 1.0, confidence_half_life_days: null };
  const ageDays = (now.getTime() - new Date(entry.created_at).getTime()) / 86400000;
  const baseConf = entry.confidence ?? 0.7;
  const decayFactor = w.confidence_half_life_days != null
    ? Math.pow(0.5, ageDays / w.confidence_half_life_days)
    : 1.0;
  const evidenceBoost = Math.min((entry.evidence?.length ?? 0) * 0.04, 0.16);
  return baseConf * decayFactor * w.priority_weight * actionTypeBoost(entry.context_type, actionType) * (1 + evidenceBoost);
}

/**
 * Apply token budgeting: sort entries by priority score and pack within budget.
 * When budget is tight, truncate the body of the last entry that partially fits
 * rather than dropping it entirely.
 */
interface TokenBudgetResult {
  entries: ContextEntry[];
  tokenEstimate: number;
  truncated: boolean;
  /** Summary of entries that didn't fit — helps agents know what was omitted. */
  dropped_entries?: Array<{ context_type: string; title?: string; confidence?: number }>;
}

function applyTokenBudget(
  entries: ContextEntry[],
  weights: Map<string, { priority_weight: number; confidence_half_life_days: number | null }>,
  tokenBudget: number,
  actionType?: ActionContextProposedActionType,
): TokenBudgetResult {
  const now = new Date();
  const scored = entries.map(e => ({ entry: e, score: computePriorityScore(e, weights, now, actionType) }));
  scored.sort((a, b) => b.score - a.score);

  const packed: ContextEntry[] = [];
  const dropped: Array<{ context_type: string; title?: string; confidence?: number }> = [];
  let used = 0;
  let truncated = false;
  let budgetExhausted = false;

  for (const { entry } of scored) {
    if (budgetExhausted) {
      dropped.push({ context_type: entry.context_type, title: entry.title, confidence: entry.confidence ?? undefined });
      continue;
    }
    const cost = estimateTokens(entry);
    if (used + cost <= tokenBudget) {
      packed.push(entry);
      used += cost;
    } else {
      // Try to fit a truncated version of this entry
      const remaining = tokenBudget - used;
      const bodyBudgetChars = remaining * 4 - (entry.title?.length ?? 0) - 80;
      if (bodyBudgetChars >= 100) {
        packed.push({
          ...entry,
          body: entry.body.slice(0, bodyBudgetChars) + '… [truncated]',
        });
        used += Math.ceil((bodyBudgetChars + (entry.title?.length ?? 0) + 80) / 4);
        truncated = true;
      } else {
        dropped.push({ context_type: entry.context_type, title: entry.title, confidence: entry.confidence ?? undefined });
        truncated = true;
      }
      budgetExhausted = true;
    }
  }

  return {
    entries: packed,
    tokenEstimate: used,
    truncated,
    ...(dropped.length > 0 ? { dropped_entries: dropped } : {}),
  };
}

const TOKEN_BUDGET_PROFILES: Record<TokenBudgetProfile, number> = {
  tiny: 900,
  standard: 2200,
  deep: 6000,
  evidence_heavy: 4000,
};

export function defaultTokenBudgetProfileForAction(actionType?: ActionContextProposedActionType): TokenBudgetProfile | undefined {
  switch (actionType) {
    case 'assignment_create':
    case 'agent_task':
      return 'tiny';
    case 'memory_promote':
    case 'external_writeback':
      return 'evidence_heavy';
    case 'customer_outreach':
    case 'sequence_step':
    case 'workflow_action':
    case 'record_update':
      return 'standard';
    default:
      return undefined;
  }
}

function actionTypeBoost(contextType: string, actionType?: ActionContextProposedActionType): number {
  const type = contextType.toLowerCase();
  const outreach = new Set(['next_step', 'commitment', 'objection', 'preference', 'stakeholder', 'relationship_map', 'success_criteria', 'buying_process', 'deal_risk', 'competitive_intel']);
  const writeback = new Set(['decision', 'key_fact', 'commitment', 'forecast_signal', 'deal_risk', 'buying_process', 'success_criteria']);
  const memory = new Set(['commitment', 'decision', 'deal_risk', 'objection', 'next_step', 'success_criteria', 'buying_process', 'forecast_signal']);

  switch (actionType) {
    case 'customer_outreach':
    case 'sequence_step':
      return outreach.has(type) ? 1.25 : type === 'agent_reasoning' ? 0.75 : 1.0;
    case 'external_writeback':
    case 'record_update':
    case 'workflow_action':
      return writeback.has(type) ? 1.25 : type === 'agent_reasoning' ? 0.75 : 1.0;
    case 'memory_promote':
      return memory.has(type) ? 1.3 : 1.0;
    case 'assignment_create':
    case 'agent_task':
      return ['next_step', 'deal_risk', 'commitment'].includes(type) ? 1.2 : 1.0;
    default:
      return 1.0;
  }
}

function effectiveTokenBudget(input?: { token_budget?: number; token_budget_profile?: TokenBudgetProfile; proposed_action_type?: ActionContextProposedActionType }) {
  const profile = input?.token_budget_profile ?? defaultTokenBudgetProfileForAction(input?.proposed_action_type);
  return {
    profile,
    budget: input?.token_budget ?? (profile ? TOKEN_BUDGET_PROFILES[profile] : undefined),
  };
}

function compactEvidence(evidence: ContextEvidence, mode: EvidenceMode): ContextEvidence | null {
  if (mode === 'full') return evidence;
  if (mode === 'none') return null;
  const snippet = typeof evidence.snippet === 'string'
    ? evidence.snippet.replace(/\s+/g, ' ').slice(0, 220)
    : undefined;
  return {
    source_type: evidence.source_type,
    source_id: evidence.source_id,
    source_ref: evidence.source_ref,
    source_label: evidence.source_label,
    observed_at: evidence.observed_at,
    speaker: evidence.speaker,
    confidence: evidence.confidence,
    snippet,
    customer_authored: evidence.customer_authored,
    source_authorship: evidence.source_authorship,
    evidence_weight: evidence.evidence_weight,
    evidence_role: evidence.evidence_role,
    context_origin: evidence.context_origin,
  };
}

function applyEvidenceModeToEntry(entry: ContextEntry, mode: EvidenceMode): ContextEntry {
  if (mode === 'full') return entry;
  return {
    ...entry,
    evidence: (entry.evidence ?? [])
      .map(evidence => compactEvidence(evidence, mode))
      .filter((evidence): evidence is ContextEvidence => Boolean(evidence)),
  };
}

function applyEvidenceModeToEntries(entries: ContextEntry[], mode: EvidenceMode): ContextEntry[] {
  return mode === 'full' ? entries : entries.map(entry => applyEvidenceModeToEntry(entry, mode));
}

/** Group context entries by context_type. */
function groupByType(entries: ContextEntry[]): Record<string, ContextEntry[]> {
  const grouped: Record<string, ContextEntry[]> = {};
  for (const e of entries) {
    if (!grouped[e.context_type]) grouped[e.context_type] = [];
    grouped[e.context_type].push(e);
  }
  return grouped;
}

function groupAdjacentContext(entries: ContextEntry[]): AdjacentContext[] | undefined {
  if (entries.length === 0) return undefined;
  const bySubject = new Map<string, ContextEntry[]>();
  for (const entry of entries) {
    const key = `${entry.subject_type}:${entry.subject_id}`;
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key)!.push(entry);
  }

  return Array.from(bySubject.values()).map(subjectEntries => {
    const first = subjectEntries[0];
    return {
      subject_type: first.subject_type,
      subject_id: first.subject_id,
      context_entries: groupByType(subjectEntries),
    };
  });
}

function summarizeEvidence(entry: ContextEntry): string | undefined {
  const evidence = entry.evidence ?? [];
  if (evidence.length === 0) return undefined;
  const first = evidence[0];
  const source = first.source_label ?? first.source_type ?? first.source_ref ?? 'source';
  const speaker = first.speaker ? `${first.speaker}: ` : '';
  const snippet = first.snippet
    ? String(first.snippet).replace(/\s+/g, ' ').slice(0, 180)
    : undefined;
  const confidence = first.confidence != null ? `, ${Math.round(Number(first.confidence) * 100)}% support` : '';
  return snippet
    ? `Evidence: ${source}${confidence} — "${speaker}${snippet}"`
    : `Evidence: ${source}${confidence}`;
}

/** Map plural related-object keys to SubjectType values. */
const PLURAL_TO_SUBJECT: Record<string, SubjectType> = {
  accounts: 'account',
  contacts: 'contact',
  opportunities: 'opportunity',
  use_cases: 'use_case',
};

/**
 * Resolve the set of adjacent subjects from the already-fetched related_objects map.
 * For account_wide radius, also fetch all contacts + opportunities under the account.
 */
async function resolveRadiusSubjects(
  db: DbPool,
  tenantId: UUID,
  subjectType: SubjectType,
  subjectId: UUID,
  related: Record<string, unknown[]>,
  radius: 'adjacent' | 'account_wide',
): Promise<Array<{ subject_type: SubjectType; subject_id: UUID }>> {
  const seen = new Set<string>();
  const subjects: Array<{ subject_type: SubjectType; subject_id: UUID }> = [];

  const add = (st: SubjectType, sid: UUID) => {
    const key = `${st}:${sid}`;
    if (!seen.has(key) && sid !== subjectId) {
      seen.add(key);
      subjects.push({ subject_type: st, subject_id: sid });
    }
  };

  // Always add direct related objects
  for (const [pluralKey, items] of Object.entries(related)) {
    const st = PLURAL_TO_SUBJECT[pluralKey];
    if (!st) continue;
    for (const item of items as Array<{ id: UUID }>) {
      add(st, item.id);
    }
  }

  if (radius === 'account_wide') {
    // Resolve the account for this entity
    let accountId: UUID | null = null;
    if (subjectType === 'account') {
      accountId = subjectId;
    } else {
      const accts = (related.accounts ?? []) as Array<{ id: UUID }>;
      accountId = accts[0]?.id ?? null;
    }

    if (accountId) {
      // Single UNION ALL query instead of two separate repo calls (avoids N+1).
      // Caps to 50 contacts + 20 opportunities to keep briefing manageable.
      const accountRows = await db.query<{ subject_type: string; subject_id: UUID }>(
	        `(SELECT 'contact'     AS subject_type, id AS subject_id
	          FROM contacts      WHERE tenant_id = $1 AND account_id = $2 AND archived_at IS NULL LIMIT 50)
	         UNION ALL
	         (SELECT 'opportunity' AS subject_type, id AS subject_id
	          FROM opportunities  WHERE tenant_id = $1 AND account_id = $2 AND archived_at IS NULL LIMIT 20)`,
        [tenantId, accountId],
      );
      for (const row of accountRows.rows) {
        add(row.subject_type as SubjectType, row.subject_id);
      }
    }
  }

  return subjects;
}

/**
 * Assemble a unified briefing for any CRM object.
 */
export async function assembleBriefing(
  db: DbPool,
  tenantId: UUID,
  subjectType: SubjectType,
  subjectId: UUID,
  options?: {
    since?: string;
    context_types?: string[];
    include_stale?: boolean;
    context_radius?: 'direct' | 'adjacent' | 'account_wide';
    token_budget?: number;
    token_budget_profile?: TokenBudgetProfile;
    evidence_mode?: EvidenceMode;
    proposed_action_type?: ActionContextProposedActionType;
    /** Include governed product knowledge. Defaults to true when product knowledge is configured. */
    include_product_context?: boolean;
    /** Actor attributed on the product-knowledge retrieval receipt. */
    actor_id?: string;
  },
): Promise<Briefing> {
  const sinceDate = parseSince(options?.since);
  const radius = options?.context_radius ?? 'direct';
  const evidenceMode = options?.evidence_mode ?? 'summary';
  const tokenBudget = effectiveTokenBudget(options);

  // 1. Fetch type weights for scoring (priority 4)
  const typeWeights = await contextTypeRepo.getTypeWeightsMap(db, tenantId);

  // 2. Subject record
  const subject = await getSubjectRecord(db, tenantId, subjectType, subjectId);

  // 3. Related objects
  const related_objects = await getRelatedObjects(db, tenantId, subjectType, subjectId, subject);

  // 4. Activity timeline — pass sinceDate to SQL to avoid fetching and
  //    discarding rows in JavaScript.
  const timelineResult = await activityRepo.getSubjectTimeline(
    db, tenantId, subjectType, subjectId,
    { limit: 10, since: sinceDate ?? undefined },
  );
  const activities = timelineResult.activities;

  // 5. Open assignments
  const assignmentResult = await assignmentRepo.searchAssignments(db, tenantId, {
    subject_type: subjectType,
    subject_id: subjectId,
    limit: 100,
  });
  const open_assignments = assignmentResult.data.filter(
    a => !['completed', 'declined', 'cancelled'].includes(a.status),
  );

  // 6. Subject's own context entries
  const rawContext = await contextRepo.getContextForSubject(db, tenantId, subjectType, subjectId, {
    current_only: !options?.include_stale,
    memory_status: 'active',
    limit: 200,
  });
  const rawSignals = await contextRepo.getContextForSubject(db, tenantId, subjectType, subjectId, {
    current_only: true,
    memory_status: 'signal',
    limit: 50,
  });
  const signalGroups = await signalGroupRepo.listSignalGroups(db, tenantId, {
    subject_type: subjectType,
    subject_id: subjectId,
    attention_only: false,
    limit: 20,
  });
  const signalGroupsWithReadiness = signalGroups.data.map(group => withSignalReadiness(group));

  // Filter by requested context types
  const ownEntries = options?.context_types?.length
    ? rawContext.filter(e => options.context_types!.includes(e.context_type))
    : rawContext;
  const ownSignals = options?.context_types?.length
    ? rawSignals.filter(e => options.context_types!.includes(e.context_type))
    : rawSignals;

  // 7. Adjacent / account-wide context (priority 2)
  let adjacentEntries: ContextEntry[] = [];
  let adjacent_context: AdjacentContext[] | undefined;
  if (radius !== 'direct') {
    const radiusSubjects = await resolveRadiusSubjects(
      db, tenantId, subjectType, subjectId, related_objects, radius,
    );
    if (radiusSubjects.length > 0) {
      const allAdjacent = await contextRepo.getContextForSubjectList(
        db, tenantId, radiusSubjects, { current_only: !options?.include_stale, memory_status: 'active', limit: 500 },
      );
      // Filter by context_types if specified
      const filtered = options?.context_types?.length
        ? allAdjacent.filter(e => options.context_types!.includes(e.context_type))
        : allAdjacent;
      adjacentEntries = filtered;
    }
  }

  // 8. Token budgeting + priority ranking (priority 1)
  let tokenEstimate: number | undefined;
  let truncated: boolean | undefined;
  let droppedEntries: Array<{ context_type: string; title?: string; confidence?: number }> | undefined;
  let context_entries: Record<string, ContextEntry[]>;

  if (tokenBudget.budget) {
    const budgetedEntries = [...ownEntries, ...adjacentEntries];
    const result = applyTokenBudget(budgetedEntries, typeWeights, tokenBudget.budget, options?.proposed_action_type);
    tokenEstimate = result.tokenEstimate;
    truncated = result.truncated;
    droppedEntries = result.dropped_entries;
    const selectedOwnEntries = result.entries.filter(
      entry => entry.subject_type === subjectType && entry.subject_id === subjectId,
    );
    const selectedAdjacentEntries = result.entries.filter(
      entry => !(entry.subject_type === subjectType && entry.subject_id === subjectId),
    );
    context_entries = groupByType(applyEvidenceModeToEntries(selectedOwnEntries, evidenceMode));
    adjacent_context = groupAdjacentContext(applyEvidenceModeToEntries(selectedAdjacentEntries, evidenceMode));
  } else {
    context_entries = groupByType(applyEvidenceModeToEntries(ownEntries, evidenceMode));
    adjacent_context = groupAdjacentContext(applyEvidenceModeToEntries(adjacentEntries, evidenceMode));
  }

  // 9. Staleness warnings
  const staleness_warnings = applyEvidenceModeToEntries(await contextRepo.listStaleEntries(db, tenantId, {
    subject_type: subjectType,
    subject_id: subjectId,
    limit: 50,
  }), evidenceMode);

  // 10. Contradiction warnings (direct radius only — skip on adjacent to avoid N+1)
  let contradiction_warnings: import('@crmy/shared').ContradictionWarning[] | undefined;
  if (!options?.context_radius || options.context_radius === 'direct') {
    try {
      contradiction_warnings = await detectContradictions(db, tenantId, subjectType, subjectId);
    } catch {
      // Detection is best-effort — never fail a briefing because of it
    }
  }

  // 11. Active sequence enrollments (contacts only)
  let active_sequences: ActiveSequenceEnrollment[] | undefined;
  if (subjectType === 'contact') {
    try {
      const enrollmentRows = await db.query<{
        id: UUID; sequence_id: UUID; sequence_name: string; current_step: number;
        total_steps: number; status: string; next_send_at: string | null;
        objective: string | null; goal_event: string | null; enrolled_by_actor_id: UUID | null;
      }>(
        `SELECT se.id, se.sequence_id, s.name AS sequence_name,
                se.current_step, jsonb_array_length(s.steps) AS total_steps,
                se.status, se.next_send_at, se.objective, s.goal_event,
                se.enrolled_by_actor_id
         FROM sequence_enrollments se
         JOIN sequences s ON s.id = se.sequence_id
         WHERE se.contact_id = $1 AND se.tenant_id = $2
           AND se.status IN ('active','paused')
         ORDER BY se.created_at DESC
         LIMIT 10`,
        [subjectId, tenantId],
      );
      if (enrollmentRows.rows.length > 0) {
        active_sequences = enrollmentRows.rows.map(r => ({
          enrollment_id: r.id,
          sequence_id: r.sequence_id,
          sequence_name: r.sequence_name,
          current_step: r.current_step,
          total_steps: r.total_steps,
          status: r.status as 'active' | 'paused',
          next_send_at: r.next_send_at ?? undefined,
          objective: r.objective ?? undefined,
          goal_event: r.goal_event ?? undefined,
          enrolled_by_actor_id: r.enrolled_by_actor_id ?? undefined,
        }));
      }
    } catch {
      // Non-fatal — sequence enrollment data is supplementary
    }
  }

  // 12. Product context (optional, governed). Defaults on when product knowledge
  //     is configured; strictly additive and never fails the briefing.
  let product_context: ProductContext | undefined;
  const wantProductContext = options?.include_product_context ?? await isProductKnowledgeConfigured(db, tenantId);
  if (wantProductContext) {
    try {
      const pcActor: ActorContext = {
        tenant_id: tenantId,
        actor_id: options?.actor_id ?? 'briefing',
        actor_type: 'agent',
        role: 'member',
      };
      product_context = await getProductContextForSubject(db, pcActor, {
        query: buildProductQuery(subject as Record<string, unknown>, [...ownEntries, ...ownSignals]),
        subject_type: subjectType,
        subject_id: subjectId,
        audience: 'customer_facing',
        ...(options?.proposed_action_type ? { proposed_action: options.proposed_action_type } : {}),
        limit: 6,
      });
    } catch {
      product_context = {
        status: 'degraded', relevant_claims: [], proof_points: [], implementation_caveats: [],
        competitive_context: [], avoid_claims: [], warnings: ['Product context temporarily unavailable.'], citations: [],
      };
    }
  }

  return {
    subject: subject as Record<string, unknown>,
    subject_type: subjectType,
    related_objects,
    activities,
    open_assignments,
    context_entries,
    ...(signalGroupsWithReadiness.length > 0 ? { signal_groups: signalGroupsWithReadiness } : {}),
    ...(ownSignals.length > 0 ? { signals: groupByType(applyEvidenceModeToEntries(ownSignals, evidenceMode)) } : {}),
    staleness_warnings,
    ...(active_sequences?.length ? { active_sequences } : {}),
    ...(contradiction_warnings?.length ? { contradiction_warnings } : {}),
    ...(adjacent_context ? { adjacent_context } : {}),
    ...(tokenEstimate !== undefined ? { token_estimate: tokenEstimate } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(droppedEntries?.length ? { dropped_entries: droppedEntries } : {}),
    ...(product_context ? { product_context } : {}),
    context_packing: {
      ...(tokenBudget.profile ? { token_budget_profile: tokenBudget.profile } : {}),
      ...(tokenBudget.budget ? { token_budget: tokenBudget.budget } : {}),
      evidence_mode: evidenceMode,
      ranking_strategy: options?.proposed_action_type
        ? `confidence_decay_type_priority_evidence_boost_action_${options.proposed_action_type}`
        : 'confidence_decay_type_priority_evidence_boost',
    },
  };
}

async function getSubjectRecord(
  db: DbPool,
  tenantId: UUID,
  subjectType: SubjectType,
  subjectId: UUID,
): Promise<Record<string, unknown>> {
  switch (subjectType) {
    case 'contact': {
      const r = await contactRepo.getContact(db, tenantId, subjectId);
      if (!r) throw new Error(`Contact ${subjectId} not found`);
      return r as unknown as Record<string, unknown>;
    }
    case 'account': {
      const r = await accountRepo.getAccount(db, tenantId, subjectId);
      if (!r) throw new Error(`Account ${subjectId} not found`);
      return r as unknown as Record<string, unknown>;
    }
    case 'opportunity': {
      const r = await oppRepo.getOpportunity(db, tenantId, subjectId);
      if (!r) throw new Error(`Opportunity ${subjectId} not found`);
      return r as unknown as Record<string, unknown>;
    }
    case 'use_case': {
      const r = await ucRepo.getUseCase(db, tenantId, subjectId);
      if (!r) throw new Error(`Use Case ${subjectId} not found`);
      return r as unknown as Record<string, unknown>;
    }
    default:
      throw new Error(`Unknown subject type: ${subjectType}`);
  }
}

async function getRelatedObjects(
  db: DbPool,
  tenantId: UUID,
  subjectType: SubjectType,
  subjectId: UUID,
  subject: Record<string, unknown>,
): Promise<Record<string, unknown[]>> {
  const related: Record<string, unknown[]> = {};

  switch (subjectType) {
    case 'contact': {
      if (subject.account_id) {
        const account = await accountRepo.getAccount(db, tenantId, subject.account_id as UUID);
        if (account) related.accounts = [account];
        const opps = await oppRepo.searchOpportunities(db, tenantId, {
          account_id: subject.account_id as UUID,
          limit: 10,
        });
        if (opps.data.length) related.opportunities = opps.data;
      }
      break;
    }
    case 'account': {
      const contacts = await contactRepo.searchContacts(db, tenantId, {
        account_id: subjectId,
        limit: 20,
      });
      if (contacts.data.length) related.contacts = contacts.data;
      const opps = await oppRepo.searchOpportunities(db, tenantId, {
        account_id: subjectId,
        limit: 10,
      });
      if (opps.data.length) related.opportunities = opps.data;
      break;
    }
    case 'opportunity': {
      if (subject.account_id) {
        const account = await accountRepo.getAccount(db, tenantId, subject.account_id as UUID);
        if (account) related.accounts = [account];
      }
      if (subject.contact_id) {
        const contact = await contactRepo.getContact(db, tenantId, subject.contact_id as UUID);
        if (contact) related.contacts = [contact];
      }
	      const ucResult = await db.query(
	        `SELECT * FROM use_cases WHERE tenant_id = $1 AND opportunity_id = $2 AND archived_at IS NULL LIMIT 10`,
        [tenantId, subjectId],
      );
      if (ucResult.rows.length) related.use_cases = ucResult.rows;
      break;
    }
    case 'use_case': {
      if (subject.opportunity_id) {
        const opp = await oppRepo.getOpportunity(db, tenantId, subject.opportunity_id as UUID);
        if (opp) related.opportunities = [opp];
      }
      const ucContacts = await ucRepo.listContacts(db, subjectId);
      if (ucContacts.length) related.contacts = ucContacts;
      break;
    }
  }

  return related;
}

/**
 * Format a briefing as human-readable text.
 */
export function formatBriefingText(briefing: Briefing): string {
  const lines: string[] = [];

  const name = (briefing.subject as Record<string, unknown>).name
    ?? `${(briefing.subject as Record<string, unknown>).first_name} ${(briefing.subject as Record<string, unknown>).last_name}`;
  lines.push(`=== BRIEFING: ${name} (${briefing.subject_type}) ===`);
  if (briefing.token_estimate) {
    lines.push(`[~${briefing.token_estimate} tokens${briefing.truncated ? ', truncated to fit budget' : ''}]`);
  }
  lines.push('');

  if (briefing.staleness_warnings.length > 0) {
    lines.push(`⚠ ${briefing.staleness_warnings.length} stale context entries need review`);
    for (const w of briefing.staleness_warnings) {
      lines.push(`  - ${w.context_type}: ${w.title ?? w.body.slice(0, 60)}... (expired ${w.valid_until})`);
    }
    lines.push('');
  }

  if (Object.keys(briefing.related_objects).length > 0) {
    lines.push('--- Related Objects ---');
    for (const [type, items] of Object.entries(briefing.related_objects)) {
      for (const item of items as Record<string, unknown>[]) {
        const itemName = item.name ?? `${item.first_name} ${item.last_name}`;
        lines.push(`  ${type}: ${itemName} (${(item.id as string).slice(0, 8)})`);
      }
    }
    lines.push('');
  }

  if (briefing.active_sequences?.length) {
    lines.push('--- Active Sequences ---');
    for (const s of briefing.active_sequences) {
      const stepInfo = `Step ${s.current_step + 1}/${s.total_steps}`;
      const nextInfo = s.next_send_at ? ` · Next: ${s.next_send_at.slice(0, 10)}` : '';
      const objectiveInfo = s.objective ? ` · Objective: "${s.objective}"` : '';
      const statusBadge = s.status === 'paused' ? ' [PAUSED]' : '';
      lines.push(`  ${s.sequence_name}${statusBadge} — ${stepInfo}${nextInfo}${objectiveInfo}`);
    }
    lines.push('');
  }

  if (briefing.activities.length > 0) {
    lines.push('--- Recent Activities ---');
    for (const a of briefing.activities) {
      const ts = a.occurred_at ?? a.created_at;
      lines.push(`  [${ts}] ${a.type}: ${a.subject}${a.outcome ? ` → ${a.outcome}` : ''}`);
    }
    lines.push('');
  }

  if (briefing.open_assignments.length > 0) {
    lines.push('--- Open Assignments ---');
    for (const a of briefing.open_assignments) {
      lines.push(`  [${a.priority}] ${a.title} (${a.status})${a.due_at ? ` due: ${a.due_at}` : ''}`);
    }
    lines.push('');
  }

  if (Object.keys(briefing.context_entries).length > 0) {
    lines.push('--- Memory ---');
    for (const [type, entries] of Object.entries(briefing.context_entries)) {
      lines.push(`  [${type}]`);
      for (const e of entries) {
        const conf = e.confidence != null ? ` (${Math.round(e.confidence * 100)}%)` : '';
        const title = e.title ? `${e.title}: ` : '';
        const body = e.body.length > 500 ? e.body.slice(0, 500) + '...' : e.body;
        lines.push(`    ${title}${body}${conf}`);
        const evidence = summarizeEvidence(e);
        if (evidence) lines.push(`      ${evidence}`);
      }
    }
    lines.push('');
  }

  if (briefing.signals && Object.keys(briefing.signals).length > 0) {
    lines.push('--- Signals (unconfirmed) ---');
    lines.push('  Treat these as evidence-backed Signals, not Current Memory.');
    for (const [type, entries] of Object.entries(briefing.signals)) {
      lines.push(`  [${type}]`);
      for (const e of entries) {
        const conf = e.confidence != null ? ` (${Math.round(e.confidence * 100)}%)` : '';
        const title = e.title ? `${e.title}: ` : '';
        const body = e.body.length > 300 ? e.body.slice(0, 300) + '...' : e.body;
        lines.push(`    ${title}${body}${conf}`);
        const evidence = summarizeEvidence(e);
        if (evidence) lines.push(`      ${evidence}`);
      }
    }
    lines.push('');
  }

  if (briefing.signal_groups?.length) {
    lines.push('--- Signals with Combined Evidence ---');
    lines.push('  These are inferred claims where CRMy has combined supporting or conflicting evidence. Do not use unpromoted Signals for writeback or forecast changes without approval.');
    for (const group of briefing.signal_groups) {
      const conf = `${Math.round(group.aggregate_confidence * 100)}%`;
      const title = group.title ?? group.normalized_claim.slice(0, 80);
      const status = group.status.replace(/_/g, ' ');
      lines.push(`  [${status}] ${title} (${conf}, ${group.support_count} signals, ${group.independent_source_count} sources)`);
      if (group.blocked_reason) lines.push(`      ${group.blocked_reason}`);
    }
    lines.push('');
  }

  if (briefing.adjacent_context?.length) {
    lines.push('--- Context from Related Entities ---');
    for (const adj of briefing.adjacent_context) {
      lines.push(`  [${adj.subject_type}: ${adj.subject_id.slice(0, 8)}]`);
      for (const [type, entries] of Object.entries(adj.context_entries)) {
        lines.push(`    [${type}]`);
        for (const e of entries) {
          const conf = e.confidence != null ? ` (${Math.round(e.confidence * 100)}%)` : '';
          const title = e.title ? `${e.title}: ` : '';
          const body = e.body.length > 300 ? e.body.slice(0, 300) + '...' : e.body;
          lines.push(`      ${title}${body}${conf}`);
          const evidence = summarizeEvidence(e);
          if (evidence) lines.push(`        ${evidence}`);
        }
      }
    }
    lines.push('');
  }

  if (briefing.product_context && briefing.product_context.status === 'available') {
    const pc = briefing.product_context;
    lines.push('--- Knowledge Claims (governed, approved + grounded) ---');
    lines.push('  Use these approved, cited claims to ground customer-facing statements. Do not assert anything not listed here.');
    for (const claim of pc.relevant_claims) {
      const cite = claim.citations[0];
      const citeText = cite ? ` [${cite.source_label}]` : '';
      lines.push(`  • [${claim.knowledge_type}/${claim.category}] ${claim.title}: ${claim.body.slice(0, 240)}${citeText}`);
    }
    if (pc.avoid_claims.length > 0) {
      lines.push(`  ⚠ ${pc.avoid_claims.length} claim(s) excluded (not customer-safe); do not use them.`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
