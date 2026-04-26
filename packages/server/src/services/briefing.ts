// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { Briefing, UUID, SubjectType, ContextEntry, AdjacentContext, ActiveSequenceEnrollment } from '@crmy/shared';
import * as contactRepo from '../db/repos/contacts.js';
import * as accountRepo from '../db/repos/accounts.js';
import * as oppRepo from '../db/repos/opportunities.js';
import * as ucRepo from '../db/repos/use-cases.js';
import * as activityRepo from '../db/repos/activities.js';
import * as assignmentRepo from '../db/repos/assignments.js';
import * as contextRepo from '../db/repos/context-entries.js';
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
): number {
  const w = weights.get(entry.context_type) ?? { priority_weight: 1.0, confidence_half_life_days: null };
  const ageDays = (now.getTime() - new Date(entry.created_at).getTime()) / 86400000;
  const baseConf = entry.confidence ?? 0.7;
  const decayFactor = w.confidence_half_life_days != null
    ? Math.pow(0.5, ageDays / w.confidence_half_life_days)
    : 1.0;
  return baseConf * decayFactor * w.priority_weight;
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
): TokenBudgetResult {
  const now = new Date();
  const scored = entries.map(e => ({ entry: e, score: computePriorityScore(e, weights, now) }));
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

/** Group context entries by context_type. */
function groupByType(entries: ContextEntry[]): Record<string, ContextEntry[]> {
  const grouped: Record<string, ContextEntry[]> = {};
  for (const e of entries) {
    if (!grouped[e.context_type]) grouped[e.context_type] = [];
    grouped[e.context_type].push(e);
  }
  return grouped;
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
          FROM contacts      WHERE tenant_id = $1 AND account_id = $2 LIMIT 50)
         UNION ALL
         (SELECT 'opportunity' AS subject_type, id AS subject_id
          FROM opportunities  WHERE tenant_id = $1 AND account_id = $2 LIMIT 20)`,
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
  },
): Promise<Briefing> {
  const sinceDate = parseSince(options?.since);
  const radius = options?.context_radius ?? 'direct';

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
    limit: 200,
  });

  // Filter by requested context types
  const ownEntries = options?.context_types?.length
    ? rawContext.filter(e => options.context_types!.includes(e.context_type))
    : rawContext;

  // 7. Adjacent / account-wide context (priority 2)
  let adjacent_context: AdjacentContext[] | undefined;
  if (radius !== 'direct') {
    const radiusSubjects = await resolveRadiusSubjects(
      db, tenantId, subjectType, subjectId, related_objects, radius,
    );
    if (radiusSubjects.length > 0) {
      const allAdjacent = await contextRepo.getContextForSubjectList(
        db, tenantId, radiusSubjects, { current_only: !options?.include_stale, limit: 500 },
      );
      // Filter by context_types if specified
      const filtered = options?.context_types?.length
        ? allAdjacent.filter(e => options.context_types!.includes(e.context_type))
        : allAdjacent;

      // Group by origin subject
      const bySubject = new Map<string, ContextEntry[]>();
      for (const entry of filtered) {
        const key = `${entry.subject_type}:${entry.subject_id}`;
        if (!bySubject.has(key)) bySubject.set(key, []);
        bySubject.get(key)!.push(entry);
      }

      adjacent_context = [];
      for (const [, entries] of bySubject) {
        const first = entries[0];
        adjacent_context.push({
          subject_type: first.subject_type,
          subject_id: first.subject_id,
          context_entries: groupByType(entries),
        });
      }
    }
  }

  // 8. Token budgeting + priority ranking (priority 1)
  let tokenEstimate: number | undefined;
  let truncated: boolean | undefined;
  let droppedEntries: Array<{ context_type: string; title?: string; confidence?: number }> | undefined;
  let context_entries: Record<string, ContextEntry[]>;

  if (options?.token_budget) {
    const result = applyTokenBudget(ownEntries, typeWeights, options.token_budget);
    tokenEstimate = result.tokenEstimate;
    truncated = result.truncated;
    droppedEntries = result.dropped_entries;
    context_entries = groupByType(result.entries);
  } else {
    context_entries = groupByType(ownEntries);
  }

  // 9. Staleness warnings
  const staleness_warnings = await contextRepo.listStaleEntries(db, tenantId, {
    subject_type: subjectType,
    subject_id: subjectId,
    limit: 50,
  });

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

  return {
    subject: subject as Record<string, unknown>,
    subject_type: subjectType,
    related_objects,
    activities,
    open_assignments,
    context_entries,
    staleness_warnings,
    ...(active_sequences?.length ? { active_sequences } : {}),
    ...(contradiction_warnings?.length ? { contradiction_warnings } : {}),
    ...(adjacent_context ? { adjacent_context } : {}),
    ...(tokenEstimate !== undefined ? { token_estimate: tokenEstimate } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(droppedEntries?.length ? { dropped_entries: droppedEntries } : {}),
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
        `SELECT * FROM use_cases WHERE tenant_id = $1 AND opportunity_id = $2 LIMIT 10`,
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
    lines.push('--- Context ---');
    for (const [type, entries] of Object.entries(briefing.context_entries)) {
      lines.push(`  [${type}]`);
      for (const e of entries) {
        const conf = e.confidence != null ? ` (${Math.round(e.confidence * 100)}%)` : '';
        const title = e.title ? `${e.title}: ` : '';
        const body = e.body.length > 500 ? e.body.slice(0, 500) + '...' : e.body;
        lines.push(`    ${title}${body}${conf}`);
      }
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
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
