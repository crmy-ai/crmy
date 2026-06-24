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
}

/** Insert or (by external_key) update a claim envelope. Used by admins and, later, source adapters. */
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
       effective_at, valid_until, created_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10,
       $11, $12, $13, $14,
       $15, $16, COALESCE($17, 'secondary'),
       COALESCE($18, 'pending'), COALESCE($19, false), COALESCE($20, 'internal'), COALESCE($21, 'active'),
       $22, $23, $24
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
       updated_at = now()
     RETURNING *`,
    [
      tenantId, input.external_key ?? null, input.category, input.title, input.body, input.summary ?? null,
      input.product_scope ?? [], input.competitors ?? [], input.personas ?? [], input.industries ?? [],
      input.source_ref ?? null, input.source_url ?? null, input.source_label ?? null, input.source_version ?? null,
      input.grounded, input.confidence ?? null, input.source_priority ?? null,
      input.approval_status ?? null, input.approved_for_external_use ?? null, input.visibility ?? null, input.status ?? null,
      input.effective_at ?? null, input.valid_until ?? null, actorId,
    ],
  );
  return result.rows[0];
}
