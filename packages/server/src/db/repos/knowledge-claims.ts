// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';

export interface KnowledgeClaimRow {
  id: string;
  tenant_id: string;
  category: string;
  title: string;
  body: string;
  summary: string | null;
  product_scope: string[];
  competitors: string[];
  personas: string[];
  industries: string[];
  source_ref: string | null;
  source_url: string | null;
  source_label: string | null;
  source_version: string | null;
  grounded: boolean;
  confidence: number | null;
  source_priority: 'authoritative' | 'secondary' | 'informal';
  approval_status: 'approved' | 'pending' | 'unapproved' | 'rejected';
  approved_for_external_use: boolean;
  visibility: 'external' | 'internal';
  status: 'active' | 'stale' | 'deprecated' | 'conflicting' | 'rejected';
  effective_at: string | null;
  valid_until: string | null;
  last_verified_at: string | null;
  review_owner_id: string | null;
  external_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  /** Lexical relevance score, present when a text query was supplied. */
  rank?: number;
}

export type KnowledgeType = 'company' | 'product' | 'competitor';

const KNOWLEDGE_TYPES = new Set<KnowledgeType>(['company', 'product', 'competitor']);
const COMPETITOR_CATEGORY_RE = /(^|[_\W])(competitive|competitor|battlecard|objection)([_\W]|$)/i;
const COMPANY_CATEGORY_RE = /(^|[_\W])(company|positioning|about|brand|overview|mission|values)([_\W]|$)/i;
const COMPETITOR_CATEGORY_SQL_RE = '(^|[_[:space:]-])(competitive|competitor|battlecard|objection)([_[:space:]-]|$)';
const COMPANY_CATEGORY_SQL_RE = '(^|[_[:space:]-])(company|positioning|about|brand|overview|mission|values)([_[:space:]-]|$)';

export function inferKnowledgeType(row: Pick<KnowledgeClaimRow, 'category' | 'competitors' | 'metadata'>): KnowledgeType {
  const explicit = typeof row.metadata?.knowledge_type === 'string' ? row.metadata.knowledge_type : undefined;
  if (explicit && KNOWLEDGE_TYPES.has(explicit as KnowledgeType)) return explicit as KnowledgeType;
  if ((row.competitors ?? []).length > 0 || COMPETITOR_CATEGORY_RE.test(row.category)) return 'competitor';
  if (COMPANY_CATEGORY_RE.test(row.category)) return 'company';
  return 'product';
}

/** Count of usable (non-rejected) claims — drives `not_configured` vs configured. */
export async function countKnowledgeClaims(db: DbPool, tenantId: string): Promise<number> {
  const result = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM knowledge_claims WHERE tenant_id = $1 AND status <> 'rejected'`,
    [tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export interface SearchKnowledgeClaimsOptions {
  query?: string;
  limit?: number;
  productScope?: string[];
  competitor?: string;
}

/**
 * Fetch candidate claims for retrieval. SQL handles tenant scope, rejected
 * filtering, lexical match, and structured scope narrowing; policy/grounding/
 * ranking decisions are applied by the pure service core over these candidates.
 */
export async function searchKnowledgeClaims(
  db: DbPool,
  tenantId: string,
  options: SearchKnowledgeClaimsOptions,
): Promise<KnowledgeClaimRow[]> {
  const params: unknown[] = [tenantId];
  const where: string[] = ['tenant_id = $1', "status <> 'rejected'"];
  let rankSelect = '0 AS rank';
  let orderBy = 'updated_at DESC';

  const query = options.query?.trim();
  if (query) {
    params.push(query);
    const idx = params.length;
    where.push(`search_vector @@ plainto_tsquery('english', $${idx})`);
    rankSelect = `ts_rank(search_vector, plainto_tsquery('english', $${idx})) AS rank`;
    orderBy = 'rank DESC, updated_at DESC';
  }
  if (options.productScope?.length) {
    params.push(options.productScope);
    // Unscoped claims always match; scoped claims must overlap the requested scope.
    where.push(`(product_scope = '{}' OR product_scope && $${params.length}::text[])`);
  }
  if (options.competitor) {
    params.push(options.competitor);
    where.push(`(competitors = '{}' OR $${params.length} = ANY(competitors))`);
  }

  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  params.push(limit);
  const sql = `SELECT *, ${rankSelect} FROM knowledge_claims WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${params.length}`;
  const result = await db.query<KnowledgeClaimRow>(sql, params);
  return result.rows;
}

export interface UpsertKnowledgeClaimInput {
  external_key?: string;
  knowledge_type?: KnowledgeType;
  category: string;
  title: string;
  body: string;
  summary?: string;
  product_scope?: string[];
  competitors?: string[];
  personas?: string[];
  industries?: string[];
  source_ref?: string;
  source_url?: string;
  source_label?: string;
  source_version?: string;
  grounded: boolean;
  confidence?: number;
  source_priority?: 'authoritative' | 'secondary' | 'informal';
  approval_status?: 'approved' | 'pending' | 'unapproved' | 'rejected';
  approved_for_external_use?: boolean;
  visibility?: 'external' | 'internal';
  status?: 'active' | 'stale' | 'deprecated' | 'conflicting' | 'rejected';
  effective_at?: string;
  valid_until?: string;
  metadata?: Record<string, unknown>;
}

/** Fetch a single Trusted Fact by id (tenant-scoped). */
export async function getKnowledgeClaim(
  db: DbPool,
  tenantId: string,
  id: string,
): Promise<KnowledgeClaimRow | null> {
  const result = await db.query<KnowledgeClaimRow>(
    `SELECT * FROM knowledge_claims WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ?? null;
}

/** Fetch one claim by source dedupe key. */
export async function getKnowledgeClaimByExternalKey(
  db: DbPool,
  tenantId: string,
  externalKey: string,
): Promise<KnowledgeClaimRow | null> {
  const result = await db.query<KnowledgeClaimRow>(
    `SELECT * FROM knowledge_claims WHERE tenant_id = $1 AND external_key = $2`,
    [tenantId, externalKey],
  );
  return result.rows[0] ?? null;
}

export interface ListKnowledgeClaimsOptions {
  knowledgeType?: KnowledgeType;
  status?: string;
  approvalStatus?: string;
  reviewOwnerId?: string;
  /** Review queue shortcut: stale OR conflicting OR pending/unapproved. */
  needsReview?: boolean;
  query?: string;
  limit?: number;
}

/** List Trusted Facts for the admin governance/review queue. */
export async function listKnowledgeClaims(
  db: DbPool,
  tenantId: string,
  options: ListKnowledgeClaimsOptions,
): Promise<KnowledgeClaimRow[]> {
  const params: unknown[] = [tenantId];
  const where: string[] = ['tenant_id = $1'];
  let rankSelect = '0 AS rank';
  let orderBy = 'updated_at DESC';

  if (options.status) { params.push(options.status); where.push(`status = $${params.length}`); }
  if (options.approvalStatus) { params.push(options.approvalStatus); where.push(`approval_status = $${params.length}`); }
  if (options.reviewOwnerId) { params.push(options.reviewOwnerId); where.push(`review_owner_id = $${params.length}`); }
  if (options.knowledgeType) {
    params.push(options.knowledgeType);
    const idx = params.length;
    where.push(`(
      metadata->>'knowledge_type' = $${idx}
      OR (
        NOT (metadata ? 'knowledge_type')
        AND CASE
          WHEN cardinality(competitors) > 0 OR category ~* '${COMPETITOR_CATEGORY_SQL_RE}' THEN 'competitor'
          WHEN category ~* '${COMPANY_CATEGORY_SQL_RE}' THEN 'company'
          ELSE 'product'
        END = $${idx}
      )
    )`);
  }
  if (options.needsReview) {
    where.push(`(status IN ('stale', 'conflicting') OR approval_status IN ('pending', 'unapproved'))`);
  }
  const query = options.query?.trim();
  if (query) {
    params.push(query);
    const idx = params.length;
    where.push(`search_vector @@ plainto_tsquery('english', $${idx})`);
    rankSelect = `ts_rank(search_vector, plainto_tsquery('english', $${idx})) AS rank`;
    orderBy = 'rank DESC, updated_at DESC';
  }

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  params.push(limit);
  const sql = `SELECT *, ${rankSelect} FROM knowledge_claims WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${params.length}`;
  const result = await db.query<KnowledgeClaimRow>(sql, params);
  return result.rows;
}

export interface ReviewKnowledgeClaimPatch {
  status?: 'active' | 'stale' | 'deprecated' | 'conflicting' | 'rejected';
  approval_status?: 'approved' | 'pending' | 'unapproved' | 'rejected';
  approved_for_external_use?: boolean;
  visibility?: 'external' | 'internal';
  review_owner_id?: string | null;
  /** When true, set last_verified_at = now() (used on approve). */
  touch_verified?: boolean;
}

/** Apply a governance review patch to a Trusted Fact. Returns the updated row. */
export async function reviewKnowledgeClaim(
  db: DbPool,
  tenantId: string,
  id: string,
  patch: ReviewKnowledgeClaimPatch,
): Promise<KnowledgeClaimRow | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  const add = (col: string, value: unknown) => { params.push(value); sets.push(`${col} = $${params.length}`); };

  if (patch.status !== undefined) add('status', patch.status);
  if (patch.approval_status !== undefined) add('approval_status', patch.approval_status);
  if (patch.approved_for_external_use !== undefined) add('approved_for_external_use', patch.approved_for_external_use);
  if (patch.visibility !== undefined) add('visibility', patch.visibility);
  if (patch.review_owner_id !== undefined) add('review_owner_id', patch.review_owner_id);
  if (patch.touch_verified) sets.push('last_verified_at = now()');

  const result = await db.query<KnowledgeClaimRow>(
    `UPDATE knowledge_claims SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

export interface FreshnessCandidateRow {
  id: string;
  category: string;
  effective_at: string | null;
  valid_until: string | null;
  last_verified_at: string | null;
}

/** Tenants with at least one active claim — drives the per-tenant freshness sweep. */
export async function listTenantsWithActiveClaims(db: DbPool, limit = 100): Promise<string[]> {
  const result = await db.query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM knowledge_claims WHERE status = 'active' LIMIT $1`,
    [limit],
  );
  return result.rows.map(r => r.tenant_id);
}

/** Active claims to evaluate for freshness (minimal columns). */
export async function listActiveClaimsForFreshness(
  db: DbPool,
  tenantId: string,
  limit = 500,
): Promise<FreshnessCandidateRow[]> {
  const result = await db.query<FreshnessCandidateRow>(
    `SELECT id, category, effective_at, valid_until, last_verified_at
     FROM knowledge_claims WHERE tenant_id = $1 AND status = 'active' LIMIT $2`,
    [tenantId, limit],
  );
  return result.rows;
}

export interface ReviewableClaimRow {
  id: string;
  category: string;
  title: string;
  status: string;
  approval_status: string;
  review_owner_id: string;
  created_by: string | null;
  valid_until: string | null;
}

/** Tenants that have owned claims needing review — drives the review-assignment sweep. */
export async function listTenantsWithReviewableClaims(db: DbPool, limit = 50): Promise<string[]> {
  const result = await db.query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM knowledge_claims
     WHERE review_owner_id IS NOT NULL
       AND (status IN ('stale', 'conflicting') OR approval_status IN ('pending', 'unapproved'))
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(r => r.tenant_id);
}

/**
 * Owned claims that need review (stale/conflicting/pending) and do not already
 * have an open review assignment. The NOT EXISTS dedupes against assignments
 * tagged with the claim id, mirroring the customer-Memory staleness sweep.
 */
export async function listKnowledgeClaimsNeedingReviewAssignment(
  db: DbPool,
  tenantId: string,
  limit = 20,
): Promise<ReviewableClaimRow[]> {
  const result = await db.query<ReviewableClaimRow>(
    `SELECT kc.id, kc.category, kc.title, kc.status, kc.approval_status,
            kc.review_owner_id, kc.created_by, kc.valid_until
     FROM knowledge_claims kc
     WHERE kc.tenant_id = $1
       AND kc.review_owner_id IS NOT NULL
       AND (kc.status IN ('stale', 'conflicting') OR kc.approval_status IN ('pending', 'unapproved'))
       AND NOT EXISTS (
         SELECT 1 FROM assignments a
         WHERE a.tenant_id = kc.tenant_id
           AND a.status NOT IN ('completed', 'declined', 'cancelled')
           AND a.metadata->>'knowledge_claim_id' = kc.id::text
       )
     ORDER BY kc.updated_at ASC
     LIMIT $2`,
    [tenantId, limit],
  );
  return result.rows;
}

export interface ConflictScanOptions {
  category?: string;
  competitor?: string;
  limit?: number;
}

/**
 * Claims eligible for conflict scanning: live envelopes (not deprecated/rejected)
 * that could be presented to a customer, optionally narrowed by category/competitor.
 */
export async function listClaimsForConflictScan(
  db: DbPool,
  tenantId: string,
  options: ConflictScanOptions,
): Promise<KnowledgeClaimRow[]> {
  const params: unknown[] = [tenantId];
  const where: string[] = ['tenant_id = $1', `status NOT IN ('deprecated', 'rejected')`];
  if (options.category) { params.push(options.category); where.push(`category = $${params.length}`); }
  if (options.competitor) { params.push(options.competitor); where.push(`$${params.length} = ANY(competitors)`); }
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  params.push(limit);
  const result = await db.query<KnowledgeClaimRow>(
    `SELECT * FROM knowledge_claims WHERE ${where.join(' AND ')} ORDER BY category, updated_at DESC LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}

/** Flip the given active claims to 'stale'. Returns the number actually updated. */
export async function markKnowledgeClaimsStale(
  db: DbPool,
  tenantId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.query(
    `UPDATE knowledge_claims SET status = 'stale', updated_at = now()
     WHERE tenant_id = $1 AND status = 'active' AND id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  return result.rowCount ?? 0;
}

/** Insert or (by external_key) update a Trusted Fact. Used by admins and, later, source adapters. */
export async function upsertKnowledgeClaim(
  db: DbPool,
  tenantId: string,
  actorId: string | null,
  input: UpsertKnowledgeClaimInput,
): Promise<KnowledgeClaimRow> {
  const result = await db.query<KnowledgeClaimRow>(
    `INSERT INTO knowledge_claims (
       tenant_id, external_key, category, title, body, summary,
       product_scope, competitors, personas, industries,
       source_ref, source_url, source_label, source_version,
       grounded, confidence, source_priority,
       approval_status, approved_for_external_use, visibility, status,
       effective_at, valid_until, metadata, created_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10,
       $11, $12, $13, $14,
       $15, $16, COALESCE($17, 'secondary'),
       COALESCE($18, 'pending'), COALESCE($19, false), COALESCE($20, 'internal'), COALESCE($21, 'active'),
       $22, $23, $24, $25
     )
     ON CONFLICT (tenant_id, external_key) DO UPDATE SET
       category = EXCLUDED.category,
       title = EXCLUDED.title,
       body = EXCLUDED.body,
       summary = EXCLUDED.summary,
       product_scope = EXCLUDED.product_scope,
       competitors = EXCLUDED.competitors,
       personas = EXCLUDED.personas,
       industries = EXCLUDED.industries,
       source_ref = EXCLUDED.source_ref,
       source_url = EXCLUDED.source_url,
       source_label = EXCLUDED.source_label,
       source_version = EXCLUDED.source_version,
       grounded = EXCLUDED.grounded,
       confidence = EXCLUDED.confidence,
       source_priority = EXCLUDED.source_priority,
       approval_status = EXCLUDED.approval_status,
       approved_for_external_use = EXCLUDED.approved_for_external_use,
       visibility = EXCLUDED.visibility,
       status = EXCLUDED.status,
       effective_at = EXCLUDED.effective_at,
       valid_until = EXCLUDED.valid_until,
       metadata = knowledge_claims.metadata || EXCLUDED.metadata,
       updated_at = now()
     RETURNING *`,
    [
      tenantId, input.external_key ?? null, input.category, input.title, input.body, input.summary ?? null,
      input.product_scope ?? [], input.competitors ?? [], input.personas ?? [], input.industries ?? [],
      input.source_ref ?? null, input.source_url ?? null, input.source_label ?? null, input.source_version ?? null,
      input.grounded, input.confidence ?? null, input.source_priority ?? null,
      input.approval_status ?? null, input.approved_for_external_use ?? null, input.visibility ?? null, input.status ?? null,
      input.effective_at ?? null, input.valid_until ?? null,
      {
        ...(input.metadata ?? {}),
        ...(input.knowledge_type ? { knowledge_type: input.knowledge_type } : {}),
      },
      actorId,
    ],
  );
  return result.rows[0];
}
