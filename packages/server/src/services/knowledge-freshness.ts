// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Governed Product Knowledge — Phase 6: source freshness & deprecation handling.
 *
 * Product/competitive truth changes fast, so a claim that was approved months
 * ago should not silently keep flowing into customer-facing drafts. This sweep
 * makes staleness *durable*: it flips `active` claims to `stale` once they pass
 * an explicit `valid_until`, or once they age past a category-specific freshness
 * window since they were last verified. Stale claims are then excluded from
 * customer-facing retrieval (see `selectClaims`) and picked up by the governance
 * review queue (see `knowledge-governance.ts`).
 *
 * Pure core (`computeStaleClaimIds`, `freshnessWindowDays`) is the single source
 * of truth for the windows and is fully unit-testable without a database. The
 * sweep itself is optional and non-blocking: it only ever demotes `active` →
 * `stale`, never deletes, and a failure degrades silently in the worker.
 *
 * See docs/governed-product-knowledge-retrieval.md (Freshness And Reliability).
 */

import type { DbPool } from '../db/pool.js';
import {
  listActiveClaimsForFreshness,
  listTenantsWithActiveClaims,
  markKnowledgeClaimsStale,
  type FreshnessCandidateRow,
} from '../db/repos/knowledge-claims.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Default freshness windows (days since last verification) by claim category,
 * matched by keyword so free-form categories like `competitive_response` or
 * `proof_point` resolve sensibly. Mirrors the doc's "Volatile categories"
 * table. Used only when a claim has no explicit `valid_until`.
 */
const FRESHNESS_WINDOW_RULES: ReadonlyArray<{ pattern: RegExp; days: number }> = [
  { pattern: /pric|packag|discount/i, days: 21 },
  { pattern: /roadmap/i, days: 21 },
  { pattern: /competit/i, days: 45 },
  { pattern: /secur|complian|privacy|certif/i, days: 60 },
  { pattern: /implement|onboard|integrat|deploy/i, days: 90 },
  { pattern: /proof|case[_ -]?study|reference|testimonial/i, days: 120 },
];

/** Conservative default for stable capability claims and anything unmatched. */
export const DEFAULT_FRESHNESS_WINDOW_DAYS = 120;

/** Freshness window (in days) for a claim category. Pure. */
export function freshnessWindowDays(category: string): number {
  for (const rule of FRESHNESS_WINDOW_RULES) {
    if (rule.pattern.test(category)) return rule.days;
  }
  return DEFAULT_FRESHNESS_WINDOW_DAYS;
}

/**
 * Decide which active claims should be demoted to `stale`. Pure and deterministic.
 *
 * A claim is stale when either:
 *  - it has an explicit `valid_until` in the past, or
 *  - it has no `valid_until` but was last verified longer ago than its
 *    category's freshness window (claims never verified are not auto-staled —
 *    they are governed at authoring time and via the review queue instead).
 */
export function computeStaleClaimIds(rows: FreshnessCandidateRow[], now: Date = new Date()): string[] {
  const nowMs = now.getTime();
  const stale: string[] = [];
  for (const row of rows) {
    if (row.valid_until != null) {
      if (new Date(row.valid_until).getTime() < nowMs) stale.push(row.id);
      continue;
    }
    if (row.last_verified_at != null) {
      const ageDays = (nowMs - new Date(row.last_verified_at).getTime()) / DAY_MS;
      if (ageDays > freshnessWindowDays(row.category)) stale.push(row.id);
    }
  }
  return stale;
}

/** Sweep one tenant's active claims, demoting expired/aged ones to stale. */
export async function sweepTenantKnowledgeFreshness(
  db: DbPool,
  tenantId: string,
  limit = 500,
): Promise<number> {
  const rows = await listActiveClaimsForFreshness(db, tenantId, limit);
  const staleIds = computeStaleClaimIds(rows, new Date());
  if (staleIds.length === 0) return 0;
  return markKnowledgeClaimsStale(db, tenantId, staleIds);
}

/**
 * Background sweep across all tenants with active product claims. Returns the
 * number of claims demoted to stale. Best-effort: a per-tenant failure is logged
 * and does not stop the sweep (product knowledge is optional and non-blocking).
 */
export async function sweepKnowledgeFreshness(db: DbPool): Promise<number> {
  let tenants: string[];
  try {
    tenants = await listTenantsWithActiveClaims(db);
  } catch {
    // Table missing / product knowledge never configured — nothing to sweep.
    return 0;
  }
  let marked = 0;
  for (const tenantId of tenants) {
    try {
      marked += await sweepTenantKnowledgeFreshness(db, tenantId);
    } catch (err) {
      console.error(`[knowledge-freshness] tenant ${tenantId} sweep failed:`, err instanceof Error ? err.message : err);
    }
  }
  return marked;
}
