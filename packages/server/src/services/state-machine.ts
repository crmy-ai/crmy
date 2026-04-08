// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * State Pattern Manager — Phase 2
 *
 * Single authoritative module for validating stage transitions on Opportunities
 * and UseCases. Each call performs two checks in order:
 *
 *   1. Structural validity — is the requested (from→to) pair a legal move?
 *      Terminal states, unknown stage names, and no-ops are rejected here.
 *
 *   2. Prerequisite checks — do the required activities or context entries
 *      already exist for this record? Only applies to the specific transitions
 *      defined in OPPORTUNITY_PREREQS / USE_CASE_PREREQS.
 *
 * Assignment transitions are already guarded by SQL WHERE-clause predicates in
 * their dedicated repo functions (acceptAssignment, startAssignment, etc.).
 * The MCP tool layer adds a pre-flight status check that surfaces a clear
 * validation error instead of the misleading notFound that was thrown before.
 *
 * Integration seam: the validateXxxTransition functions are called from the
 * MCP tool handlers immediately after fetching the current record and before
 * committing the DB update. If validation fails the tool throws validationError
 * and the DB is never touched.
 */

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';

// ─── Opportunity stage ordering ───────────────────────────────────────────────

const OPPORTUNITY_PROGRESSION = [
  'prospecting', 'qualification', 'proposal', 'poc', 'negotiation',
] as const;
type OppProgressStage = typeof OPPORTUNITY_PROGRESSION[number];

const OPPORTUNITY_TERMINAL = new Set<string>(['closed_won', 'closed_lost']);
const OPPORTUNITY_VALID = new Set<string>([...OPPORTUNITY_PROGRESSION, 'closed_won', 'closed_lost']);

// ─── UseCase stage ordering ───────────────────────────────────────────────────

const USE_CASE_PROGRESSION = ['discovery', 'poc', 'production', 'scaling'] as const;
type UCProgressStage = typeof USE_CASE_PROGRESSION[number];

const USE_CASE_TERMINAL = new Set<string>(['sunset']);
const USE_CASE_VALID = new Set<string>([...USE_CASE_PROGRESSION, 'sunset']);

// ─── Prerequisite types ───────────────────────────────────────────────────────

interface ActivityPrereq {
  kind: 'activity';
  /** Activity types that satisfy this prerequisite (any one is sufficient). */
  types: string[];
  description: string;
}

interface ContextPrereq {
  kind: 'context';
  context_type: string;
  subject_type: string;
  description: string;
}

type Prereq = ActivityPrereq | ContextPrereq;

// ─── Prerequisite definitions ─────────────────────────────────────────────────
//
// Keys are "fromStage->toStage". Only transitions that have prerequisites appear
// here; all others require no evidence and are allowed by default (subject to
// the structural checks above).

const OPPORTUNITY_PREREQS: Record<string, Prereq[]> = {
  'prospecting->qualification': [
    {
      kind: 'activity',
      types: ['meeting', 'call', 'meeting_held', 'meeting_scheduled', 'outreach_call'],
      description: 'a qualifying meeting or discovery call',
    },
  ],
  'qualification->proposal': [
    {
      kind: 'activity',
      types: ['meeting', 'meeting_held'],
      description: 'a meeting before sending a proposal',
    },
  ],
};

const USE_CASE_PREREQS: Record<string, Prereq[]> = {
  'discovery->poc': [
    {
      kind: 'context',
      context_type: 'research',
      subject_type: 'use_case',
      description: 'a research context entry documenting the proposed proof-of-concept',
    },
  ],
};

// ─── Prerequisite DB checks ───────────────────────────────────────────────────

async function checkActivity(
  db: DbPool,
  tenantId: UUID,
  subjectType: string,
  subjectId: UUID,
  prereq: ActivityPrereq,
): Promise<string | null> {
  // Activities link to CRM objects via both a direct FK column AND the
  // polymorphic subject_type/subject_id pair — check both so nothing is missed.
  const fkCol = subjectType === 'opportunity' ? 'opportunity_id'
    : subjectType === 'use_case' ? 'use_case_id'
    : null;

  const query = fkCol
    ? `SELECT 1 FROM activities
       WHERE tenant_id = $1
         AND (${fkCol} = $2 OR (subject_type = $3 AND subject_id = $2))
         AND type = ANY($4::text[])
       LIMIT 1`
    : `SELECT 1 FROM activities
       WHERE tenant_id = $1 AND subject_type = $3 AND subject_id = $2
         AND type = ANY($4::text[])
       LIMIT 1`;

  const result = await db.query(query, [tenantId, subjectId, subjectType, prereq.types]);
  return result.rows.length > 0
    ? null
    : `Missing prerequisite: requires ${prereq.description}`;
}

async function checkContext(
  db: DbPool,
  tenantId: UUID,
  subjectId: UUID,
  prereq: ContextPrereq,
): Promise<string | null> {
  const result = await db.query(
    `SELECT 1 FROM context_entries
     WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
       AND context_type = $4 AND is_current = true
     LIMIT 1`,
    [tenantId, prereq.subject_type, subjectId, prereq.context_type],
  );
  return result.rows.length > 0
    ? null
    : `Missing prerequisite: requires ${prereq.description}`;
}

async function runPrereqs(
  db: DbPool,
  tenantId: UUID,
  subjectType: string,
  subjectId: UUID,
  prereqs: Prereq[],
): Promise<string[]> {
  const blockers: string[] = [];
  for (const prereq of prereqs) {
    const blocker = prereq.kind === 'activity'
      ? await checkActivity(db, tenantId, subjectType, subjectId, prereq)
      : await checkContext(db, tenantId, subjectId, prereq);
    if (blocker) blockers.push(blocker);
  }
  return blockers;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface TransitionResult {
  allowed: boolean;
  /** Human-readable reasons why this transition is blocked, if any. */
  blockers: string[];
}

/**
 * Validate an opportunity stage transition.
 * Call this before committing the update in the opportunity_advance_stage handler.
 */
export async function validateOpportunityTransition(
  db: DbPool,
  tenantId: UUID,
  opportunityId: UUID,
  fromStage: string,
  toStage: string,
): Promise<TransitionResult> {
  if (!OPPORTUNITY_VALID.has(toStage)) {
    return { allowed: false, blockers: [`'${toStage}' is not a recognised opportunity stage`] };
  }

  if (OPPORTUNITY_TERMINAL.has(fromStage)) {
    return {
      allowed: false,
      blockers: [`Opportunity is already ${fromStage} — no further stage changes are permitted`],
    };
  }

  if (fromStage === toStage) {
    return { allowed: false, blockers: [`Opportunity is already in stage '${fromStage}'`] };
  }

  // Closing moves (→ closed_won / closed_lost) bypass all activity prerequisites.
  if (OPPORTUNITY_TERMINAL.has(toStage)) {
    return { allowed: true, blockers: [] };
  }

  const blockers = await runPrereqs(
    db, tenantId, 'opportunity', opportunityId,
    OPPORTUNITY_PREREQS[`${fromStage}->${toStage}`] ?? [],
  );
  return { allowed: blockers.length === 0, blockers };
}

/**
 * Validate a use case stage transition.
 * Call this before committing the update in the use_case_advance_stage handler.
 */
export async function validateUseCaseTransition(
  db: DbPool,
  tenantId: UUID,
  useCaseId: UUID,
  fromStage: string,
  toStage: string,
): Promise<TransitionResult> {
  if (!USE_CASE_VALID.has(toStage)) {
    return { allowed: false, blockers: [`'${toStage}' is not a recognised use case stage`] };
  }

  if (USE_CASE_TERMINAL.has(fromStage)) {
    return {
      allowed: false,
      blockers: [`Use case is already '${fromStage}' and cannot be advanced`],
    };
  }

  if (fromStage === toStage) {
    return { allowed: false, blockers: [`Use case is already in stage '${fromStage}'`] };
  }

  // Sunsetting never requires evidence.
  if (toStage === 'sunset') {
    return { allowed: true, blockers: [] };
  }

  const blockers = await runPrereqs(
    db, tenantId, 'use_case', useCaseId,
    USE_CASE_PREREQS[`${fromStage}->${toStage}`] ?? [],
  );
  return { allowed: blockers.length === 0, blockers };
}

// ─── Assignment status helpers ────────────────────────────────────────────────

/** Human-readable valid source statuses for each assignment action. */
export const ASSIGNMENT_VALID_FROM: Record<string, string[]> = {
  accept:   ['pending'],
  start:    ['accepted'],
  block:    ['accepted', 'in_progress'],
  complete: ['pending', 'accepted', 'in_progress'],
  decline:  ['pending', 'accepted'],
  cancel:   ['pending', 'accepted', 'in_progress', 'blocked'],
};

/**
 * Return a blocker message if `currentStatus` is not a valid source for `action`,
 * or null if the transition is allowed.
 */
export function validateAssignmentAction(
  action: string,
  currentStatus: string,
): string | null {
  const validFrom = ASSIGNMENT_VALID_FROM[action];
  if (!validFrom) return null; // unknown action — let the DB decide
  if (validFrom.includes(currentStatus)) return null;
  return `Cannot ${action} an assignment that is currently '${currentStatus}'. Must be: ${validFrom.join(' or ')}`;
}
