// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Deduplication scoring service.
 *
 * Runs targeted DB queries for each available signal, accumulates per-record
 * scores, and returns ranked candidates. Used by contact_create, account_create,
 * and opportunity_create to prevent duplicate records across all creation paths.
 */

import type { DbPool } from '../db/pool.js';
import type { DuplicateCandidate } from '@crmy/shared';

export type DuplicateConfidence = 'definitive' | 'high' | 'medium' | 'low';

export interface DuplicateCheckResult {
  confidence: DuplicateConfidence;
  topScore: number;
  candidates: DuplicateCandidate[];
}

// ── Internal accumulator ──────────────────────────────────────────────────────

interface Accumulator {
  score: number;
  reasons: string[];
  name: string;
}

function accumulate(
  map: Map<string, Accumulator>,
  id: string,
  name: string,
  score: number,
  reason: string,
): void {
  const existing = map.get(id);
  if (existing) {
    // Take the highest individual signal score; append unique reasons
    if (score > existing.score) existing.score = score;
    if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
  } else {
    map.set(id, { score, reasons: [reason], name });
  }
}

function buildResult(map: Map<string, Accumulator>): DuplicateCheckResult {
  const sorted = [...map.entries()]
    .map(([id, acc]) => ({ id, name: acc.name, score: acc.score, reasons: acc.reasons }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const topScore = sorted[0]?.score ?? 0;
  const confidence: DuplicateConfidence =
    topScore >= 90 ? 'definitive' :
    topScore >= 70 ? 'high' :
    topScore >= 50 ? 'medium' : 'low';

  return { confidence, topScore, candidates: sorted };
}

/** Normalise a phone string to digits only (min 7 digits to be meaningful). */
function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

/** Extract bare domain from a URL or domain string. */
function normalizeDomain(raw: string): string {
  try {
    // If it looks like a URL, parse it; otherwise treat as plain domain
    const withProtocol = raw.startsWith('http') ? raw : `https://${raw}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return raw.toLowerCase().replace(/^www\./, '').replace(/\/$/, '');
  }
}

// ── Contact duplicate check ───────────────────────────────────────────────────

export interface ContactDedupInput {
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company_name?: string;
  account_id?: string;
  exclude_id?: string; // skip this record (for update paths)
}

export async function checkContactDuplicate(
  db: DbPool,
  tenantId: string,
  input: ContactDedupInput,
): Promise<DuplicateCheckResult> {
  const scores = new Map<string, Accumulator>();
  const excl = input.exclude_id ?? '00000000-0000-0000-0000-000000000000';
  const fullName = `${input.first_name} ${input.last_name ?? ''}`.trim();

  // ── Email exact match (score 100 — definitive) ──
  if (input.email) {
    const { rows } = await db.query(
      `SELECT id, first_name || ' ' || last_name AS name
       FROM contacts
       WHERE tenant_id=$1 AND lower(email)=lower($2) AND id!=$3 AND merged_into IS NULL
       LIMIT 5`,
      [tenantId, input.email, excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 100, 'email match');
  }

  // ── Phone exact match (score 85 — high) ──
  if (input.phone) {
    const digits = normalizePhone(input.phone);
    if (digits) {
      const { rows } = await db.query(
        `SELECT id, first_name || ' ' || last_name AS name
         FROM contacts
         WHERE tenant_id=$1 AND regexp_replace(COALESCE(phone,''), '\\D', '', 'g')=$2 AND id!=$3 AND merged_into IS NULL
         LIMIT 5`,
        [tenantId, digits, excl],
      );
      for (const r of rows) accumulate(scores, r.id, r.name, 85, 'phone match');
    }
  }

  // ── Name + account_id exact (score 85 — high) ──
  if (input.account_id) {
    const { rows } = await db.query(
      `SELECT id, first_name || ' ' || last_name AS name
       FROM contacts
       WHERE tenant_id=$1 AND account_id=$2
         AND lower(first_name || ' ' || last_name)=lower($3)
         AND id!=$4 AND merged_into IS NULL
       LIMIT 5`,
      [tenantId, input.account_id, fullName, excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 85, 'same name at same account');
  }

  // ── Name + company_name exact (score 80 — high) ──
  if (input.company_name) {
    const { rows } = await db.query(
      `SELECT id, first_name || ' ' || last_name AS name
       FROM contacts
       WHERE tenant_id=$1
         AND lower(company_name)=lower($2)
         AND lower(first_name || ' ' || last_name)=lower($3)
         AND id!=$4 AND merged_into IS NULL
       LIMIT 5`,
      [tenantId, input.company_name, fullName, excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 80, 'same name at same company');
  }

  // ── Alias contains incoming email (score 85) ──
  if (input.email) {
    const { rows } = await db.query(
      `SELECT id, first_name || ' ' || last_name AS name
       FROM contacts
       WHERE tenant_id=$1 AND $2=ANY(aliases) AND id!=$3 AND merged_into IS NULL
       LIMIT 5`,
      [tenantId, input.email.toLowerCase(), excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 85, 'email in aliases');
  }

  // ── Alias contains incoming name (score 80) ──
  if (fullName) {
    const { rows } = await db.query(
      `SELECT id, first_name || ' ' || last_name AS name
       FROM contacts
       WHERE tenant_id=$1 AND lower($2)=ANY(aliases) AND id!=$3 AND merged_into IS NULL
       LIMIT 5`,
      [tenantId, fullName.toLowerCase(), excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 80, 'name in aliases');
  }

  // ── Name exact, no company context (score 60 — medium) ──
  if (!input.account_id && !input.company_name) {
    const { rows } = await db.query(
      `SELECT id, first_name || ' ' || last_name AS name
       FROM contacts
       WHERE tenant_id=$1
         AND lower(first_name || ' ' || last_name)=lower($2)
         AND id!=$3 AND merged_into IS NULL
       LIMIT 5`,
      [tenantId, fullName, excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 60, 'exact name match');
  }

  // ── Fuzzy name similarity > 0.80 via pg_trgm (max score 65) ──
  const { rows: fuzzy } = await db.query(
    `SELECT id, first_name || ' ' || last_name AS name,
            similarity(lower(first_name || ' ' || last_name), lower($2)) AS sim
     FROM contacts
     WHERE tenant_id=$1
       AND similarity(lower(first_name || ' ' || last_name), lower($2)) > 0.80
       AND id!=$3 AND merged_into IS NULL
     ORDER BY sim DESC
     LIMIT 5`,
    [tenantId, fullName, excl],
  );
  for (const r of fuzzy) {
    const sc = Math.round(r.sim * 65);
    accumulate(scores, r.id, r.name, sc, `similar name (${Math.round(r.sim * 100)}%)`);
  }

  return buildResult(scores);
}

// ── Account duplicate check ───────────────────────────────────────────────────

export interface AccountDedupInput {
  name: string;
  domain?: string;
  website?: string;
  exclude_id?: string;
}

export async function checkAccountDuplicate(
  db: DbPool,
  tenantId: string,
  input: AccountDedupInput,
): Promise<DuplicateCheckResult> {
  const scores = new Map<string, Accumulator>();
  const excl = input.exclude_id ?? '00000000-0000-0000-0000-000000000000';

  // Resolve the canonical domain from either domain or website
  const resolvedDomain = input.domain
    ? normalizeDomain(input.domain)
    : input.website
    ? normalizeDomain(input.website)
    : null;

  // ── Domain exact match (score 100 — definitive) ──
  if (resolvedDomain) {
    const { rows } = await db.query(
      `SELECT id, name FROM accounts
       WHERE tenant_id=$1 AND lower(domain)=$2 AND id!=$3 AND merged_into IS NULL
       LIMIT 5`,
      [tenantId, resolvedDomain, excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 100, 'domain match');

    // Also check if website domain of existing accounts matches
    const { rows: webRows } = await db.query(
      `SELECT id, name FROM accounts
       WHERE tenant_id=$1
         AND lower(regexp_replace(website, '^https?://(www\\.)?', '')) LIKE $2
         AND domain IS NULL
         AND id!=$3 AND merged_into IS NULL
       LIMIT 5`,
      [tenantId, `${resolvedDomain}%`, excl],
    );
    for (const r of webRows) accumulate(scores, r.id, r.name, 85, 'website domain match');
  }

  // ── Name exact match, case-insensitive (score 90 — definitive) ──
  {
    const { rows } = await db.query(
      `SELECT id, name FROM accounts
       WHERE tenant_id=$1 AND lower(name)=lower($2) AND id!=$3 AND merged_into IS NULL
       LIMIT 5`,
      [tenantId, input.name, excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 90, 'exact name match');
  }

  // ── Alias contains incoming name or domain (score 85) ──
  const aliasChecks = [input.name.toLowerCase(), ...(resolvedDomain ? [resolvedDomain] : [])];
  for (const alias of aliasChecks) {
    const { rows } = await db.query(
      `SELECT id, name FROM accounts
       WHERE tenant_id=$1 AND lower($2)=ANY(aliases) AND id!=$3 AND merged_into IS NULL
       LIMIT 5`,
      [tenantId, alias, excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 85, 'name in aliases');
  }

  // ── Fuzzy name similarity > 0.75 via pg_trgm (max score 70) ──
  const { rows: fuzzy } = await db.query(
    `SELECT id, name, similarity(lower(name), lower($2)) AS sim
     FROM accounts
     WHERE tenant_id=$1
       AND similarity(lower(name), lower($2)) > 0.75
       AND id!=$3 AND merged_into IS NULL
     ORDER BY sim DESC
     LIMIT 5`,
    [tenantId, input.name, excl],
  );
  for (const r of fuzzy) {
    const sc = Math.round(r.sim * 70);
    accumulate(scores, r.id, r.name, sc, `similar name (${Math.round(r.sim * 100)}%)`);
  }

  return buildResult(scores);
}

// ── Opportunity duplicate check ───────────────────────────────────────────────

export interface OpportunityDedupInput {
  name: string;
  account_id?: string;
  amount?: number;
  close_date?: string;
  exclude_id?: string;
}

export async function checkOpportunityDuplicate(
  db: DbPool,
  tenantId: string,
  input: OpportunityDedupInput,
): Promise<DuplicateCheckResult> {
  const scores = new Map<string, Accumulator>();
  const excl = input.exclude_id ?? '00000000-0000-0000-0000-000000000000';

  if (!input.account_id) {
    // Without an account, only a near-identical name triggers a warning
    const { rows } = await db.query(
      `SELECT id, name FROM opportunities
       WHERE tenant_id=$1 AND lower(name)=lower($2) AND id!=$3
       LIMIT 5`,
      [tenantId, input.name, excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 70, 'exact name match');
    return buildResult(scores);
  }

  // ── account_id + name exact (score 90 — definitive) ──
  {
    const { rows } = await db.query(
      `SELECT id, name FROM opportunities
       WHERE tenant_id=$1 AND account_id=$2 AND lower(name)=lower($3) AND id!=$4
       LIMIT 5`,
      [tenantId, input.account_id, input.name, excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 90, 'same name on same account');
  }

  // ── account_id + amount + close_date exact (score 85) ──
  if (input.amount !== undefined && input.close_date) {
    const { rows } = await db.query(
      `SELECT id, name FROM opportunities
       WHERE tenant_id=$1 AND account_id=$2 AND amount=$3 AND close_date=$4 AND id!=$5
       LIMIT 5`,
      [tenantId, input.account_id, input.amount, input.close_date, excl],
    );
    for (const r of rows) accumulate(scores, r.id, r.name, 85, 'same amount and close date on same account');
  }

  // ── account_id + fuzzy name > 0.80 (max score 70) ──
  const { rows: fuzzy } = await db.query(
    `SELECT id, name, similarity(lower(name), lower($3)) AS sim
     FROM opportunities
     WHERE tenant_id=$1 AND account_id=$2
       AND similarity(lower(name), lower($3)) > 0.80
       AND id!=$4
     ORDER BY sim DESC
     LIMIT 5`,
    [tenantId, input.account_id, input.name, excl],
  );
  for (const r of fuzzy) {
    const sc = Math.round(r.sim * 70);
    accumulate(scores, r.id, r.name, sc, `similar name (${Math.round(r.sim * 100)}%)`);
  }

  return buildResult(scores);
}
