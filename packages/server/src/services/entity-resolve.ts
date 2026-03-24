// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Identity Resolution Service
 *
 * Resolves a natural-language entity reference (name, alias, abbreviation,
 * email, domain) to a canonical CRM record (Contact or Account).
 *
 * Resolution tiers, in priority order:
 *   1. Exact name match                → HIGH confidence
 *   2. Exact alias match (case-insensitive) → HIGH confidence
 *   3. Email exact match (contacts)    → HIGH confidence
 *   4. Domain exact match (accounts)   → HIGH confidence
 *   5. ILIKE substring on name/alias   → MEDIUM confidence
 *   6. pg_trgm similarity fallback     → LOW confidence
 *
 * Actor affinity:
 *   Each candidate is scored by how many times the requesting actor has
 *   previously interacted with it (activities authored, context entries
 *   written, assignments assigned to/from). Higher affinity breaks ties
 *   and can upgrade MEDIUM→resolved when the actor's working set is small.
 *
 * context_hints:
 *   Optional narrowing signals from the conversation:
 *   - company_name: filters contacts to those linked to a matching account
 *   - email_domain: filters accounts by domain
 *   - title: filters contacts by title ILIKE
 *   - email: matches contact by exact email (shortcut to HIGH confidence)
 */

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';

// ─── Public types ──────────────────────────────────────────────────────────

export type MatchReason =
  | 'exact_name'
  | 'alias_exact'
  | 'email_exact'
  | 'domain_exact'
  | 'name_partial'
  | 'alias_partial'
  | 'fuzzy_name';

export type Confidence = 'high' | 'medium' | 'low';

export interface ResolveCandidate {
  entity_type: 'contact' | 'account';
  id: UUID;
  name: string;                  // display name
  match_reason: MatchReason;
  confidence: Confidence;
  affinity_score: number;        // count of actor interactions with this entity
  // key disambiguating fields shown to the agent / human reviewer
  email?: string;
  title?: string;
  company_name?: string;         // contacts: their company_name field
  account_name?: string;         // contacts: linked account name
  domain?: string;               // accounts: domain
  aliases?: string[];
}

export interface ResolveResult {
  status: 'resolved' | 'ambiguous' | 'not_found';
  resolved?: ResolveCandidate;
  candidates?: ResolveCandidate[];
  suggestion?: string;
}

export interface ResolveInput {
  query: string;
  entity_type?: 'contact' | 'account' | 'any';
  context_hints?: {
    company_name?: string;
    email_domain?: string;
    title?: string;
    email?: string;
  };
  actor_id?: UUID;
  limit?: number;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
const REASON_CONFIDENCE: Record<MatchReason, Confidence> = {
  exact_name:   'high',
  alias_exact:  'high',
  email_exact:  'high',
  domain_exact: 'high',
  name_partial: 'medium',
  alias_partial:'medium',
  fuzzy_name:   'low',
};

/** Fetch affinity scores for a set of entity IDs for a given actor. */
async function getAffinityScores(
  db: DbPool,
  actorId: UUID,
  entityIds: UUID[],
): Promise<Map<UUID, number>> {
  if (entityIds.length === 0) return new Map();
  const result = await db.query<{ id: UUID; score: number }>(
    `WITH ids AS (SELECT unnest($1::uuid[]) AS id)
     SELECT
       i.id,
       (
         COALESCE((SELECT COUNT(*)::int FROM activities
                   WHERE performed_by = $2 AND subject_id = i.id), 0) +
         COALESCE((SELECT COUNT(*)::int FROM context_entries
                   WHERE authored_by = $2 AND subject_id = i.id), 0) +
         COALESCE((SELECT COUNT(*)::int FROM assignments
                   WHERE (assigned_to = $2 OR assigned_by = $2) AND subject_id = i.id), 0)
       ) AS score
     FROM ids i`,
    [entityIds, actorId],
  );
  return new Map(result.rows.map((r) => [r.id, Number(r.score)]));
}

// ─── Contact resolution ───────────────────────────────────────────────────

async function resolveContacts(
  db: DbPool,
  tenantId: UUID,
  query: string,
  hints: ResolveInput['context_hints'],
  actorId: UUID | undefined,
  limit: number,
): Promise<ResolveCandidate[]> {
  const q = query.trim();
  const qLower = q.toLowerCase();
  const pattern = `%${q}%`;
  const candidates = new Map<UUID, ResolveCandidate>();

  // ── 1. Exact email match (if query looks like an email) ─────────────────
  if (hints?.email || q.includes('@')) {
    const emailVal = hints?.email ?? q;
    const r = await db.query<{
      id: UUID; first_name: string; last_name: string; email?: string;
      title?: string; company_name?: string; account_id?: UUID; aliases: string[];
    }>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.title, c.company_name, c.account_id, c.aliases
       FROM contacts c
       WHERE c.tenant_id = $1 AND LOWER(c.email) = LOWER($2)
       LIMIT $3`,
      [tenantId, emailVal, limit],
    );
    for (const row of r.rows) {
      candidates.set(row.id, {
        entity_type: 'contact',
        id: row.id,
        name: `${row.first_name} ${row.last_name}`.trim(),
        match_reason: 'email_exact',
        confidence: 'high',
        affinity_score: 0,
        email: row.email,
        title: row.title ?? undefined,
        company_name: row.company_name ?? undefined,
        aliases: row.aliases,
      });
    }
  }

  // ── 2. Exact full-name match ──────────────────────────────────────────────
  {
    const parts = q.split(/\s+/);
    const firstName = parts[0] ?? '';
    const lastName = parts.slice(1).join(' ');
    const r = await db.query<{
      id: UUID; first_name: string; last_name: string; email?: string;
      title?: string; company_name?: string; account_id?: UUID; aliases: string[];
    }>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.title, c.company_name, c.account_id, c.aliases
       FROM contacts c
       WHERE c.tenant_id = $1
         AND LOWER(c.first_name) = LOWER($2)
         AND ($3 = '' OR LOWER(c.last_name) = LOWER($3))
       LIMIT $4`,
      [tenantId, firstName, lastName, limit],
    );
    for (const row of r.rows) {
      if (!candidates.has(row.id)) {
        candidates.set(row.id, {
          entity_type: 'contact',
          id: row.id,
          name: `${row.first_name} ${row.last_name}`.trim(),
          match_reason: 'exact_name',
          confidence: 'high',
          affinity_score: 0,
          email: row.email,
          title: row.title ?? undefined,
          company_name: row.company_name ?? undefined,
          aliases: row.aliases,
        });
      }
    }
  }

  // ── 3. Exact alias match ──────────────────────────────────────────────────
  {
    const r = await db.query<{
      id: UUID; first_name: string; last_name: string; email?: string;
      title?: string; company_name?: string; account_id?: UUID; aliases: string[];
    }>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.title, c.company_name, c.account_id, c.aliases
       FROM contacts c
       WHERE c.tenant_id = $1
         AND EXISTS (SELECT 1 FROM unnest(c.aliases) _a WHERE LOWER(_a) = $2)
       LIMIT $3`,
      [tenantId, qLower, limit],
    );
    for (const row of r.rows) {
      if (!candidates.has(row.id)) {
        candidates.set(row.id, {
          entity_type: 'contact',
          id: row.id,
          name: `${row.first_name} ${row.last_name}`.trim(),
          match_reason: 'alias_exact',
          confidence: 'high',
          affinity_score: 0,
          email: row.email,
          title: row.title ?? undefined,
          company_name: row.company_name ?? undefined,
          aliases: row.aliases,
        });
      }
    }
  }

  // ── 4. ILIKE substring on name + alias ────────────────────────────────────
  if (candidates.size < limit) {
    const accountFilter = hints?.company_name
      ? `AND c.account_id IN (
           SELECT id FROM accounts
           WHERE tenant_id = $1 AND (name ILIKE $4
             OR EXISTS (SELECT 1 FROM unnest(aliases) _a WHERE _a ILIKE $4))
         )`
      : '';
    const titleFilter = hints?.title ? ` AND c.title ILIKE $${hints.company_name ? 5 : 4}` : '';
    const extraParams: unknown[] = [];
    if (hints?.company_name) extraParams.push(`%${hints.company_name}%`);
    if (hints?.title) extraParams.push(`%${hints.title}%`);

    const r = await db.query<{
      id: UUID; first_name: string; last_name: string; email?: string;
      title?: string; company_name?: string; account_id?: UUID; aliases: string[];
    }>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.title, c.company_name, c.account_id, c.aliases
       FROM contacts c
       WHERE c.tenant_id = $1
         AND (c.first_name ILIKE $2 OR c.last_name ILIKE $2 OR c.email ILIKE $2
              OR c.company_name ILIKE $2
              OR EXISTS (SELECT 1 FROM unnest(c.aliases) _a WHERE _a ILIKE $2))
         ${accountFilter}${titleFilter}
       LIMIT $3`,
      [tenantId, pattern, limit, ...extraParams],
    );
    for (const row of r.rows) {
      if (!candidates.has(row.id)) {
        // Determine whether this is a partial alias or name match
        const isAliasMatch = (row.aliases ?? []).some((a) =>
          a.toLowerCase().includes(qLower),
        );
        candidates.set(row.id, {
          entity_type: 'contact',
          id: row.id,
          name: `${row.first_name} ${row.last_name}`.trim(),
          match_reason: isAliasMatch ? 'alias_partial' : 'name_partial',
          confidence: 'medium',
          affinity_score: 0,
          email: row.email,
          title: row.title ?? undefined,
          company_name: row.company_name ?? undefined,
          aliases: row.aliases,
        });
      }
    }
  }

  // ── 5. pg_trgm fuzzy fallback (only when nothing found yet) ──────────────
  if (candidates.size === 0) {
    try {
      const r = await db.query<{
        id: UUID; first_name: string; last_name: string; email?: string;
        title?: string; company_name?: string; account_id?: UUID; aliases: string[];
        sml: number;
      }>(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.title, c.company_name, c.account_id, c.aliases,
                similarity(c.first_name || ' ' || c.last_name, $2) AS sml
         FROM contacts c
         WHERE c.tenant_id = $1
           AND similarity(c.first_name || ' ' || c.last_name, $2) > 0.2
         ORDER BY sml DESC
         LIMIT $3`,
        [tenantId, q, limit],
      );
      for (const row of r.rows) {
        if (!candidates.has(row.id)) {
          candidates.set(row.id, {
            entity_type: 'contact',
            id: row.id,
            name: `${row.first_name} ${row.last_name}`.trim(),
            match_reason: 'fuzzy_name',
            confidence: 'low',
            affinity_score: 0,
            email: row.email,
            title: row.title ?? undefined,
            company_name: row.company_name ?? undefined,
            aliases: row.aliases,
          });
        }
      }
    } catch {
      // pg_trgm not yet available — silently skip
    }
  }

  // ── Enrich with linked account names ─────────────────────────────────────
  const accountIds = [...candidates.values()]
    .map((c) => c as ResolveCandidate & { _account_id?: UUID })
    .filter((c) => (c as { account_id?: UUID }).account_id)
    .map((c) => (c as unknown as { account_id: UUID }).account_id);

  if (accountIds.length > 0) {
    const acctResult = await db.query<{ id: UUID; name: string }>(
      `SELECT id, name FROM accounts WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [accountIds, tenantId],
    );
    const acctMap = new Map(acctResult.rows.map((a) => [a.id, a.name]));
    for (const [, candidate] of candidates) {
      const row = candidate as unknown as { account_id?: UUID };
      if (row.account_id) {
        candidate.account_name = acctMap.get(row.account_id);
      }
    }
  }

  return [...candidates.values()];
}

// ─── Account resolution ───────────────────────────────────────────────────

async function resolveAccounts(
  db: DbPool,
  tenantId: UUID,
  query: string,
  hints: ResolveInput['context_hints'],
  _actorId: UUID | undefined,
  limit: number,
): Promise<ResolveCandidate[]> {
  const q = query.trim();
  const qLower = q.toLowerCase();
  const pattern = `%${q}%`;
  const candidates = new Map<UUID, ResolveCandidate>();

  // ── 1. Domain exact match (if query looks like a domain) ──────────────────
  const domainQuery = hints?.email_domain ?? (q.includes('.') && !q.includes(' ') ? q : null);
  if (domainQuery) {
    const r = await db.query<{ id: UUID; name: string; domain?: string; aliases: string[] }>(
      `SELECT id, name, domain, aliases FROM accounts
       WHERE tenant_id = $1 AND LOWER(domain) = LOWER($2)
       LIMIT $3`,
      [tenantId, domainQuery, limit],
    );
    for (const row of r.rows) {
      candidates.set(row.id, {
        entity_type: 'account',
        id: row.id,
        name: row.name,
        match_reason: 'domain_exact',
        confidence: 'high',
        affinity_score: 0,
        domain: row.domain,
        aliases: row.aliases,
      });
    }
  }

  // ── 2. Exact name match ───────────────────────────────────────────────────
  {
    const r = await db.query<{ id: UUID; name: string; domain?: string; aliases: string[] }>(
      `SELECT id, name, domain, aliases FROM accounts
       WHERE tenant_id = $1 AND LOWER(name) = $2
       LIMIT $3`,
      [tenantId, qLower, limit],
    );
    for (const row of r.rows) {
      if (!candidates.has(row.id)) {
        candidates.set(row.id, {
          entity_type: 'account',
          id: row.id,
          name: row.name,
          match_reason: 'exact_name',
          confidence: 'high',
          affinity_score: 0,
          domain: row.domain,
          aliases: row.aliases,
        });
      }
    }
  }

  // ── 3. Exact alias match ──────────────────────────────────────────────────
  {
    const r = await db.query<{ id: UUID; name: string; domain?: string; aliases: string[] }>(
      `SELECT id, name, domain, aliases FROM accounts
       WHERE tenant_id = $1
         AND EXISTS (SELECT 1 FROM unnest(aliases) _a WHERE LOWER(_a) = $2)
       LIMIT $3`,
      [tenantId, qLower, limit],
    );
    for (const row of r.rows) {
      if (!candidates.has(row.id)) {
        candidates.set(row.id, {
          entity_type: 'account',
          id: row.id,
          name: row.name,
          match_reason: 'alias_exact',
          confidence: 'high',
          affinity_score: 0,
          domain: row.domain,
          aliases: row.aliases,
        });
      }
    }
  }

  // ── 4. ILIKE substring on name + alias ────────────────────────────────────
  if (candidates.size < limit) {
    const r = await db.query<{ id: UUID; name: string; domain?: string; aliases: string[] }>(
      `SELECT id, name, domain, aliases FROM accounts
       WHERE tenant_id = $1
         AND (name ILIKE $2 OR domain ILIKE $2
              OR EXISTS (SELECT 1 FROM unnest(aliases) _a WHERE _a ILIKE $2))
       LIMIT $3`,
      [tenantId, pattern, limit],
    );
    for (const row of r.rows) {
      if (!candidates.has(row.id)) {
        const isAliasMatch = (row.aliases ?? []).some((a) =>
          a.toLowerCase().includes(qLower),
        );
        candidates.set(row.id, {
          entity_type: 'account',
          id: row.id,
          name: row.name,
          match_reason: isAliasMatch ? 'alias_partial' : 'name_partial',
          confidence: 'medium',
          affinity_score: 0,
          domain: row.domain,
          aliases: row.aliases,
        });
      }
    }
  }

  // ── 5. pg_trgm fuzzy fallback ─────────────────────────────────────────────
  if (candidates.size === 0) {
    try {
      const r = await db.query<{
        id: UUID; name: string; domain?: string; aliases: string[]; sml: number;
      }>(
        `SELECT id, name, domain, aliases, similarity(name, $2) AS sml
         FROM accounts
         WHERE tenant_id = $1 AND similarity(name, $2) > 0.2
         ORDER BY sml DESC
         LIMIT $3`,
        [tenantId, q, limit],
      );
      for (const row of r.rows) {
        if (!candidates.has(row.id)) {
          candidates.set(row.id, {
            entity_type: 'account',
            id: row.id,
            name: row.name,
            match_reason: 'fuzzy_name',
            confidence: 'low',
            affinity_score: 0,
            domain: row.domain,
            aliases: row.aliases,
          });
        }
      }
    } catch {
      // pg_trgm not yet available — silently skip
    }
  }

  return [...candidates.values()];
}

// ─── Scoring & ranking ─────────────────────────────────────────────────────

function sortCandidates(candidates: ResolveCandidate[]): ResolveCandidate[] {
  return [...candidates].sort((a, b) => {
    // Primary: confidence rank
    const confDiff = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (confDiff !== 0) return confDiff;
    // Secondary: affinity with the requesting actor
    return b.affinity_score - a.affinity_score;
  });
}

/**
 * An actor is considered to "know" an entity if they have a non-zero affinity
 * AND the entity is the only high-affinity match — good enough to auto-resolve
 * a medium-confidence match when the actor's working set is small.
 */
function canAutoResolveWithAffinity(candidates: ResolveCandidate[]): boolean {
  const mediums = candidates.filter((c) => c.confidence === 'medium');
  if (mediums.length !== 1) return false;
  const [top] = mediums;
  return top.affinity_score > 0 && mediums.every((c) => c.affinity_score <= top.affinity_score);
}

// ─── Main export ──────────────────────────────────────────────────────────

export async function entityResolve(
  db: DbPool,
  tenantId: UUID,
  input: ResolveInput,
): Promise<ResolveResult> {
  const {
    query,
    entity_type = 'any',
    context_hints,
    actor_id,
    limit: inputLimit = 5,
  } = input;

  if (!query.trim()) {
    return { status: 'not_found', suggestion: 'Provide a non-empty query.' };
  }

  const limit = Math.min(Math.max(inputLimit, 1), 20);

  // ── Gather candidates ─────────────────────────────────────────────────────
  const [contactCandidates, accountCandidates] = await Promise.all([
    entity_type !== 'account'
      ? resolveContacts(db, tenantId, query, context_hints, actor_id, limit)
      : Promise.resolve([]),
    entity_type !== 'contact'
      ? resolveAccounts(db, tenantId, query, context_hints, actor_id, limit)
      : Promise.resolve([]),
  ]);

  let all = [...contactCandidates, ...accountCandidates];

  // ── Actor affinity enrichment ─────────────────────────────────────────────
  if (actor_id && all.length > 0) {
    const ids = all.map((c) => c.id);
    const scores = await getAffinityScores(db, actor_id, ids);
    all = all.map((c) => ({ ...c, affinity_score: scores.get(c.id) ?? 0 }));
  }

  const sorted = sortCandidates(all);

  if (sorted.length === 0) {
    return {
      status: 'not_found',
      suggestion: `No ${entity_type === 'any' ? 'contact or account' : entity_type} found for "${query}". ` +
        `Consider adding an alias to the record or checking the spelling.`,
    };
  }

  // ── Single high-confidence result → resolved ──────────────────────────────
  const highConf = sorted.filter((c) => c.confidence === 'high');
  if (highConf.length === 1) {
    return { status: 'resolved', resolved: highConf[0] };
  }

  // ── Multiple high-confidence results with one having strong affinity → resolved
  if (highConf.length > 1) {
    const topAffinity = highConf[0];
    const secondAffinity = highConf[1];
    if (topAffinity.affinity_score > 0 && topAffinity.affinity_score > secondAffinity.affinity_score) {
      return { status: 'resolved', resolved: topAffinity };
    }
    return {
      status: 'ambiguous',
      candidates: highConf.slice(0, limit),
      suggestion: `Found ${highConf.length} high-confidence matches. Use context_hints (company, email, title) to narrow down, or trigger an Approval request.`,
    };
  }

  // ── Single medium-confidence result with non-zero affinity → resolved ─────
  if (canAutoResolveWithAffinity(sorted)) {
    return { status: 'resolved', resolved: sorted[0] };
  }

  // ── Multiple results → ambiguous ──────────────────────────────────────────
  const topConf = sorted[0].confidence;
  const sameLevel = sorted.filter((c) => c.confidence === topConf);

  if (sameLevel.length === 1) {
    return { status: 'resolved', resolved: sameLevel[0] };
  }

  return {
    status: 'ambiguous',
    candidates: sorted.slice(0, limit),
    suggestion: sorted[0].confidence === 'medium'
      ? `Found ${sorted.length} possible matches. Provide a context_hint (company_name, email, title) or create an Approval request to let a human choose.`
      : `Found ${sorted.length} weak matches. Try a more specific query or add aliases to the correct record.`,
  };
}
