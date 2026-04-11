// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Lead and deal health scoring engine.
 *
 * Scores are integer values 0–100 stored on contacts (lead_score) and
 * opportunities (deal_health_score). They are recomputed whenever an
 * activity or context entry is created/updated for the subject, and on a
 * background refresh cycle for stale scores.
 *
 * Lead score formula (0–100):
 *   30 pts — activity recency (within 7d=30, 30d=20, 90d=10, else 0)
 *   20 pts — activity volume (# activities in last 90d × 2, capped at 20)
 *   20 pts — context health (# high-confidence non-stale entries, capped at 20)
 *   15 pts — lifecycle stage (champion=15, active=10, prospect=5, lead=3)
 *   15 pts — engagement quality (calls/meetings ×3 weight vs emails ×1, capped at 15)
 *
 * Deal health score formula (0–100):
 *   25 pts — stage progression (by pipeline index)
 *   20 pts — activity recency (same as lead)
 *   20 pts — context completeness (has commitment + stakeholder + next_step entries)
 *   15 pts — close date proximity (< 30 days = 15, < 90 days = 8, else 0)
 *   20 pts — risk penalty (–5 per deal_risk entry, floored at 0)
 */

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';

// ── Shared helpers ────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function daysSince(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const ms = Date.now() - new Date(isoDate).getTime();
  return ms / 86_400_000;
}

async function getLastActivityDate(db: DbPool, tenantId: UUID, contactId: UUID): Promise<string | null> {
  const result = await db.query(
    `SELECT occurred_at FROM activities
     WHERE tenant_id = $1 AND contact_id = $2 AND status = 'completed'
     ORDER BY occurred_at DESC LIMIT 1`,
    [tenantId, contactId],
  );
  return result.rows[0]?.occurred_at ?? null;
}

async function getActivityCount90d(db: DbPool, tenantId: UUID, contactId: UUID): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) as cnt FROM activities
     WHERE tenant_id = $1 AND contact_id = $2 AND status = 'completed'
       AND occurred_at > now() - interval '90 days'`,
    [tenantId, contactId],
  );
  return parseInt(result.rows[0]?.cnt ?? '0', 10);
}

// ── Lead scoring ─────────────────────────────────────────────────────────────

interface LeadScoreBreakdown {
  recency: number;
  volume: number;
  context_health: number;
  lifecycle: number;
  engagement: number;
  total: number;
}

export async function computeLeadScore(
  db: DbPool,
  tenantId: UUID,
  contactId: UUID,
): Promise<{ score: number; breakdown: LeadScoreBreakdown }> {
  // 1. Activity recency (0–30)
  const lastActDate = await getLastActivityDate(db, tenantId, contactId);
  const daysSinceActivity = daysSince(lastActDate);
  let recency = 0;
  if (daysSinceActivity !== null) {
    if (daysSinceActivity <= 7) recency = 30;
    else if (daysSinceActivity <= 30) recency = 20;
    else if (daysSinceActivity <= 90) recency = 10;
  }

  // 2. Activity volume 90d (0–20)
  const actCount = await getActivityCount90d(db, tenantId, contactId);
  const volume = clamp(actCount * 2, 0, 20);

  // 3. Context health (0–20): high-confidence non-stale entries
  const ctxResult = await db.query(
    `SELECT COUNT(*) as cnt FROM context_entries
     WHERE tenant_id = $1 AND subject_type = 'contact' AND subject_id = $2
       AND is_current = true AND (confidence IS NULL OR confidence >= 0.7)
       AND (valid_until IS NULL OR valid_until > now())`,
    [tenantId, contactId],
  );
  const ctxCount = parseInt(ctxResult.rows[0]?.cnt ?? '0', 10);
  const context_health = clamp(ctxCount, 0, 20);

  // 4. Lifecycle stage (0–15)
  const contactResult = await db.query(
    'SELECT lifecycle_stage FROM contacts WHERE id = $1 AND tenant_id = $2',
    [contactId, tenantId],
  );
  const stage = contactResult.rows[0]?.lifecycle_stage ?? 'lead';
  const stageScore: Record<string, number> = {
    champion: 15, active: 10, prospect: 5, lead: 3, customer: 12, churned: 0,
  };
  const lifecycle = stageScore[stage] ?? 3;

  // 5. Engagement quality (0–15): calls/meetings weighted 3×, emails 1×
  const engResult = await db.query(
    `SELECT type, COUNT(*) as cnt FROM activities
     WHERE tenant_id = $1 AND contact_id = $2 AND status = 'completed'
       AND occurred_at > now() - interval '90 days'
     GROUP BY type`,
    [tenantId, contactId],
  );
  let engWeighted = 0;
  let engTotal = 0;
  for (const row of engResult.rows as { type: string; cnt: string }[]) {
    const cnt = parseInt(row.cnt, 10);
    const weight = (row.type === 'call' || row.type === 'meeting' || row.type === 'demo') ? 3 : 1;
    engWeighted += cnt * weight;
    engTotal += cnt;
  }
  const engagement = engTotal > 0 ? clamp(Math.round((engWeighted / Math.max(engTotal, 1)) * 5), 0, 15) : 0;

  const total = recency + volume + context_health + lifecycle + engagement;
  return { score: clamp(total, 0, 100), breakdown: { recency, volume, context_health, lifecycle, engagement, total } };
}

// ── Deal health scoring ───────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  'prospecting', 'qualification', 'discovery', 'proposal', 'poc', 'negotiation',
  'closed_won', 'closed_lost',
];

interface DealScoreBreakdown {
  stage_progression: number;
  activity_recency: number;
  context_completeness: number;
  close_date_proximity: number;
  risk_penalty: number;
  total: number;
}

export async function computeDealHealthScore(
  db: DbPool,
  tenantId: UUID,
  opportunityId: UUID,
): Promise<{ score: number; breakdown: DealScoreBreakdown; risk_factors: string[] }> {
  const oppResult = await db.query(
    'SELECT stage, close_date, account_id FROM opportunities WHERE id = $1 AND tenant_id = $2',
    [opportunityId, tenantId],
  );
  if (oppResult.rows.length === 0) return { score: 0, breakdown: { stage_progression: 0, activity_recency: 0, context_completeness: 0, close_date_proximity: 0, risk_penalty: 0, total: 0 }, risk_factors: [] };

  const opp = oppResult.rows[0] as { stage: string; close_date: string | null; account_id: UUID };

  // 1. Stage progression (0–25)
  const stageIdx = PIPELINE_STAGES.indexOf((opp.stage ?? '').toLowerCase());
  const stage_progression = stageIdx >= 0
    ? clamp(Math.round((stageIdx / (PIPELINE_STAGES.length - 2)) * 25), 0, 25)
    : 0;

  // 2. Activity recency (0–20) — most recent activity across opp or its account's contacts
  const lastOppActResult = await db.query(
    `SELECT occurred_at FROM activities
     WHERE tenant_id = $1 AND opportunity_id = $2 AND status = 'completed'
     ORDER BY occurred_at DESC LIMIT 1`,
    [tenantId, opportunityId],
  );
  const days = daysSince(lastOppActResult.rows[0]?.occurred_at);
  let activity_recency = 0;
  if (days !== null) {
    if (days <= 7) activity_recency = 20;
    else if (days <= 30) activity_recency = 14;
    else if (days <= 90) activity_recency = 7;
  }

  // 3. Context completeness (0–20): has commitment + stakeholder + next_step
  const ctxResult = await db.query(
    `SELECT DISTINCT context_type FROM context_entries
     WHERE tenant_id = $1 AND subject_type = 'opportunity' AND subject_id = $2
       AND is_current = true AND context_type IN ('commitment','stakeholder','next_step')`,
    [tenantId, opportunityId],
  );
  const foundTypes = new Set((ctxResult.rows as { context_type: string }[]).map(r => r.context_type));
  const context_completeness = foundTypes.size * 7; // 7 pts each, max 21 → clamp to 20

  // 4. Close date proximity (0–15)
  const closeDays = daysSince(opp.close_date) ?? Infinity; // negative = in the future
  let close_date_proximity = 0;
  if (opp.close_date) {
    const daysUntilClose = (new Date(opp.close_date).getTime() - Date.now()) / 86_400_000;
    if (daysUntilClose >= 0 && daysUntilClose <= 30) close_date_proximity = 15;
    else if (daysUntilClose > 0 && daysUntilClose <= 90) close_date_proximity = 8;
  }
  // suppress unused warning
  void closeDays;

  // 5. Risk penalty (deal_risk entries reduce score, −5 each, floor 0)
  const riskResult = await db.query(
    `SELECT id, body FROM context_entries
     WHERE tenant_id = $1 AND subject_type = 'opportunity' AND subject_id = $2
       AND is_current = true AND context_type = 'deal_risk'`,
    [tenantId, opportunityId],
  );
  const riskCount = riskResult.rows.length;
  const risk_penalty = clamp(riskCount * 5, 0, 25);
  const risk_factors = (riskResult.rows as { body: string }[]).map(r => r.body.slice(0, 100));

  const raw = stage_progression + activity_recency + clamp(context_completeness, 0, 20) + close_date_proximity - risk_penalty;
  const total = clamp(raw, 0, 100);

  return {
    score: total,
    breakdown: {
      stage_progression,
      activity_recency,
      context_completeness: clamp(context_completeness, 0, 20),
      close_date_proximity,
      risk_penalty: -risk_penalty,
      total,
    },
    risk_factors,
  };
}

// ── Background refresh ────────────────────────────────────────────────────────

const REFRESH_WINDOW_MINUTES = 5;
const REFRESH_BATCH = 50;

/**
 * Recompute scores for contacts/opportunities that have had activity or context
 * updated in the last REFRESH_WINDOW_MINUTES. Called from the 60s background worker.
 */
export async function refreshStaleScores(db: DbPool): Promise<void> {
  // Contacts with recent activity or context
  const contactsResult = await db.query(
    `SELECT DISTINCT contact_id as id, tenant_id FROM activities
     WHERE contact_id IS NOT NULL
       AND occurred_at > now() - interval '${REFRESH_WINDOW_MINUTES} minutes'
     UNION
     SELECT DISTINCT subject_id as id, tenant_id FROM context_entries
     WHERE subject_type = 'contact'
       AND updated_at > now() - interval '${REFRESH_WINDOW_MINUTES} minutes'
     LIMIT $1`,
    [REFRESH_BATCH],
  );

  for (const row of contactsResult.rows as { id: UUID; tenant_id: UUID }[]) {
    try {
      const { score } = await computeLeadScore(db, row.tenant_id, row.id);
      await db.query(
        'UPDATE contacts SET lead_score = $1, lead_score_updated_at = now() WHERE id = $2 AND tenant_id = $3',
        [score, row.id, row.tenant_id],
      );
    } catch { /* best-effort */ }
  }

  // Opportunities with recent activity or context
  const oppsResult = await db.query(
    `SELECT DISTINCT opportunity_id as id, tenant_id FROM activities
     WHERE opportunity_id IS NOT NULL
       AND occurred_at > now() - interval '${REFRESH_WINDOW_MINUTES} minutes'
     UNION
     SELECT DISTINCT subject_id as id, tenant_id FROM context_entries
     WHERE subject_type = 'opportunity'
       AND updated_at > now() - interval '${REFRESH_WINDOW_MINUTES} minutes'
     LIMIT $1`,
    [REFRESH_BATCH],
  );

  for (const row of oppsResult.rows as { id: UUID; tenant_id: UUID }[]) {
    try {
      const { score } = await computeDealHealthScore(db, row.tenant_id, row.id);
      await db.query(
        'UPDATE opportunities SET deal_health_score = $1, deal_health_score_updated_at = now() WHERE id = $2 AND tenant_id = $3',
        [score, row.id, row.tenant_id],
      );
    } catch { /* best-effort */ }
  }
}
