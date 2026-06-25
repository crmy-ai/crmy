// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Governed Product Knowledge Retrieval — shared backend service.
 *
 * The single internal boundary every surface calls (MCP tool, REST, CLI,
 * Workspace Agent, briefing/Action Context enrichment), so product knowledge
 * never depends on local MCP or a particular client.
 *
 * Architecture: a pure decision core (`selectClaims`: policy → grounding →
 * rank → pack) over candidate rows fetched by a thin repo. The pure core is
 * deterministic and unit-testable without a database. Optional and non-blocking:
 * any non-`available` status is a normal return, never an error, and it never
 * creates Memory or writes to systems of record.
 *
 * See docs/governed-product-knowledge-retrieval.md.
 */

import type { DbPool } from '../db/pool.js';
import type {
  ActorContext,
  KnowledgeAudience,
  KnowledgeClaim,
  KnowledgeExcludedClaim,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from '@crmy/shared';
import { isSnippetGrounded } from '../agent/extraction-grounding.js';
import {
  countKnowledgeClaims,
  searchKnowledgeClaims,
  upsertKnowledgeClaim,
  type KnowledgeClaimRow,
  type UpsertKnowledgeClaimInput,
} from '../db/repos/knowledge-claims.js';
import { insertKnowledgeReceipt } from '../db/repos/knowledge-receipts.js';

const NOT_CONFIGURED_MESSAGE =
  'Product knowledge retrieval is not configured for this workspace. '
  + 'Customer Memory, briefings, and Action Context work without it. '
  + 'Configure approved product/competitive claims to enable grounded, cited retrieval.';

const PRIORITY_WEIGHT: Record<KnowledgeClaimRow['source_priority'], number> = {
  authoritative: 3,
  secondary: 2,
  informal: 1,
};

/** Whether product knowledge is configured for a tenant (any usable claim exists). */
export async function isProductKnowledgeConfigured(db: DbPool, tenantId: string): Promise<boolean> {
  return (await countKnowledgeClaims(db, tenantId)) > 0;
}

function policyName(audience: KnowledgeAudience): string {
  return audience === 'customer_facing' ? 'customer_facing_approved_grounded' : 'internal_all_labeled';
}

function rowToClaim(row: KnowledgeClaimRow): KnowledgeClaim {
  const citations = (row.source_label || row.source_url || row.source_ref)
    ? [{
        source_label: row.source_label ?? row.source_ref ?? 'source',
        ...(row.source_url ? { source_url: row.source_url } : {}),
        ...(row.source_ref ? { source_ref: row.source_ref } : {}),
      }]
    : [];
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
    grounded: row.grounded,
    approval_status: row.approval_status,
    approved_for_external_use: row.approved_for_external_use,
    visibility: row.visibility,
    ...(row.effective_at ? { effective_at: row.effective_at } : {}),
    ...(row.valid_until ? { valid_until: row.valid_until } : {}),
    source_priority: row.source_priority,
    citations,
  };
}

/**
 * Pure decision core: apply audience policy, exclude or warn, rank, and pack.
 * Customer-facing requires approved + external-safe + grounded + fresh; internal
 * includes risky claims but labels them with warnings. No I/O — fully testable.
 */
export function selectClaims(
  candidates: KnowledgeClaimRow[],
  input: KnowledgeRetrievalRequest,
  now: Date = new Date(),
): { claims: KnowledgeClaim[]; excluded: KnowledgeExcludedClaim[]; warnings: string[] } {
  const audience: KnowledgeAudience = input.audience ?? 'customer_facing';
  const customerFacing = audience === 'customer_facing';
  const requireApproved = input.require_approved ?? customerFacing;
  const includeStale = input.include_stale ?? false;

  const excluded: KnowledgeExcludedClaim[] = [];
  const warnings: string[] = [];
  const included: KnowledgeClaimRow[] = [];

  for (const row of candidates) {
    const expired = row.valid_until != null && new Date(row.valid_until).getTime() < now.getTime();
    const notYetEffective = row.effective_at != null && new Date(row.effective_at).getTime() > now.getTime();
    const isStale = row.status === 'stale' || expired;

    // Hard exclusions for any audience: deprecated and not-yet-effective claims
    // are never surfaced.
    if (row.status === 'deprecated') { excluded.push({ id: row.id, reason: 'deprecated' }); continue; }
    if (notYetEffective) { excluded.push({ id: row.id, reason: 'not_yet_effective' }); continue; }

    if (customerFacing) {
      // Strict policy: approved + external-safe + grounded + fresh + external visibility.
      const reasons: string[] = [];
      if (isStale) reasons.push('stale');
      if (row.status === 'conflicting') reasons.push('conflicting');
      if (row.visibility !== 'external') reasons.push('internal_only');
      if (requireApproved && row.approval_status !== 'approved') reasons.push('unapproved');
      if (!row.approved_for_external_use) reasons.push('not_external_safe');
      if (!row.grounded) reasons.push('ungrounded');
      if (reasons.length > 0) { excluded.push({ id: row.id, reason: reasons[0] }); continue; }
      included.push(row);
    } else {
      // Internal audience: include risky claims, but label them clearly. Stale
      // claims are excluded unless include_stale was requested.
      if (isStale && !includeStale) { excluded.push({ id: row.id, reason: 'stale' }); continue; }
      const labels: string[] = [];
      if (row.approval_status !== 'approved') labels.push('unapproved');
      if (!row.grounded) labels.push('ungrounded');
      if (isStale) labels.push('stale');
      if (row.status === 'conflicting') labels.push('conflicting');
      included.push(row);
      if (labels.length > 0) {
        warnings.push(`Claim "${row.title}" included for internal use despite: ${labels.join(', ')}.`);
      }
    }
  }

  included.sort((a, b) => {
    const priorityDelta = PRIORITY_WEIGHT[b.source_priority] - PRIORITY_WEIGHT[a.source_priority];
    if (priorityDelta !== 0) return priorityDelta;
    const rankDelta = (b.rank ?? 0) - (a.rank ?? 0);
    if (rankDelta !== 0) return rankDelta;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  const limit = input.limit ?? 8;
  const claims = included.slice(0, limit).map(rowToClaim);
  return { claims, excluded, warnings };
}

/**
 * Retrieve governed product knowledge for a customer action. Returns approved,
 * grounded, cited claims with trust metadata — or a clear non-`available`
 * status. Records a retrieval receipt for proof/lineage.
 */
export async function retrieveKnowledge(
  db: DbPool,
  actor: ActorContext,
  input: KnowledgeRetrievalRequest,
): Promise<KnowledgeRetrievalResult> {
  if (!(await isProductKnowledgeConfigured(db, actor.tenant_id))) {
    return { status: 'not_configured', claims: [], excluded_claims: [], warnings: [], message: NOT_CONFIGURED_MESSAGE };
  }

  const audience: KnowledgeAudience = input.audience ?? 'customer_facing';
  try {
    const candidates = await searchKnowledgeClaims(db, actor.tenant_id, {
      query: input.query,
      limit: (input.limit ?? 8) * 3,
      productScope: input.product_scope,
      competitor: input.competitor,
    });

    const { claims, excluded, warnings } = selectClaims(candidates, input, new Date());

    const receipt = await insertKnowledgeReceipt(db, actor.tenant_id, {
      actor_id: actor.actor_id,
      query: input.query,
      audience,
      policy: policyName(audience),
      filters: {
        product_scope: input.product_scope ?? null,
        competitor: input.competitor ?? null,
        persona: input.persona ?? null,
        industry: input.industry ?? null,
        require_approved: input.require_approved ?? null,
        include_stale: input.include_stale ?? false,
      },
      returned_claim_ids: claims.map(claim => claim.id),
      excluded,
      warnings,
      subject_type: input.subject_type ?? null,
      subject_id: input.subject_id ?? null,
      proposed_action: input.proposed_action ?? null,
    });

    return {
      status: claims.length > 0 ? 'available' : 'no_results',
      claims,
      excluded_claims: excluded,
      warnings,
      retrieval_receipt: { id: receipt.id, policy: receipt.policy, retrieved_at: receipt.retrieved_at },
    };
  } catch (err) {
    // Degraded, not failed: callers that do not require product context continue.
    return {
      status: 'degraded',
      claims: [],
      excluded_claims: [],
      warnings: [`Product knowledge retrieval is temporarily degraded: ${err instanceof Error ? err.message : 'unknown error'}`],
      message: 'Product knowledge retrieval is temporarily unavailable. Proceeding without it.',
    };
  }
}

export interface UpsertProductKnowledgeClaimInput extends Omit<UpsertKnowledgeClaimInput, 'grounded'> {
  /** Source text the claim is drawn from; when present, grounding is verified against it. */
  source_text?: string;
  /** Explicit grounding flag, used only when no source_text is supplied. */
  grounded?: boolean;
}

/**
 * Admin/governance write path for a claim envelope. When `source_text` is
 * supplied, grounding is verified against it (reusing the auto-promotion
 * grounding gate) so customer-facing eligibility cannot be self-asserted.
 */
export async function upsertProductKnowledgeClaim(
  db: DbPool,
  actor: ActorContext,
  input: UpsertProductKnowledgeClaimInput,
): Promise<KnowledgeClaim> {
  const { source_text, grounded: explicitGrounded, ...rest } = input;
  const grounded = source_text
    ? isSnippetGrounded(input.body, source_text) || (input.summary ? isSnippetGrounded(input.summary, source_text) : false)
    : Boolean(explicitGrounded);

  const row = await upsertKnowledgeClaim(db, actor.tenant_id, actor.actor_id ?? null, { ...rest, grounded });
  return rowToClaim(row);
}
