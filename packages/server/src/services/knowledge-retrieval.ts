// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Governed Product Knowledge Retrieval — shared backend service.
 *
 * This is the single internal boundary every surface calls (MCP tool, REST,
 * CLI, Workspace Agent, briefing/Action Context enrichment), so product
 * knowledge never depends on local MCP or a particular client.
 *
 * Optional and non-blocking by construction: when nothing is configured it
 * returns a clear `not_configured` result rather than failing, and it never
 * creates Memory or writes to systems of record.
 *
 * Phase 1 (this file) establishes the contract and returns `not_configured`.
 * Phase 2 implements retrieval over `product_knowledge` Context Sources:
 * policy filtering, source grounding, ranking, citations, warnings, and
 * durable retrieval receipts. See docs/governed-product-knowledge-retrieval.md.
 */

import type { DbPool } from '../db/pool.js';
import type {
  ActorContext,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from '@crmy/shared';

const NOT_CONFIGURED_MESSAGE =
  'Product knowledge retrieval is not configured for this workspace. '
  + 'Customer Memory, briefings, and Action Context work without it. '
  + 'Once a product_knowledge source is configured, this returns approved, '
  + 'source-grounded, cited product and competitive claims with a retrieval receipt.';

/**
 * Whether governed product knowledge is configured for a tenant.
 *
 * Phase 1 returns false (no `product_knowledge` sources exist yet). Phase 2
 * checks for configured product-knowledge Context Sources, behind the
 * `CRMY_PRODUCT_KNOWLEDGE` feature flag.
 */
export async function isProductKnowledgeConfigured(_db: DbPool, _tenantId: string): Promise<boolean> {
  return false;
}

/**
 * Retrieve governed product knowledge for a customer action. Returns approved,
 * grounded, cited claims with trust metadata — or a clear non-`available`
 * status. Callers that do not explicitly require product context continue
 * normally on any non-`available` result.
 */
export async function retrieveKnowledge(
  db: DbPool,
  actor: ActorContext,
  _input: KnowledgeRetrievalRequest,
): Promise<KnowledgeRetrievalResult> {
  if (!(await isProductKnowledgeConfigured(db, actor.tenant_id))) {
    return {
      status: 'not_configured',
      claims: [],
      excluded_claims: [],
      warnings: [],
      message: NOT_CONFIGURED_MESSAGE,
    };
  }

  // Phase 2: retrieve from product_knowledge sources, filter by policy, ground
  // and rank claims, attach citations/warnings, and record a retrieval receipt.
  return {
    status: 'no_results',
    claims: [],
    excluded_claims: [],
    warnings: [],
  };
}
