// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { knowledgeRetrieve, knowledgeClaimUpsert, knowledgeClaimList, knowledgeClaimReview, knowledgeConflictsDetect } from '@crmy/shared';
import type { ActorContext, KnowledgeRetrievalRequest } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ToolDef } from '../server.js';
import { retrieveKnowledge, upsertProductKnowledgeClaim, type UpsertProductKnowledgeClaimInput } from '../../services/knowledge-retrieval.js';
import {
  detectKnowledgeConflicts,
  listKnowledgeClaimsForReview,
  reviewKnowledgeClaim,
  type DetectKnowledgeConflictsInput,
  type ListKnowledgeClaimsInput,
  type ReviewKnowledgeClaimInput,
} from '../../services/knowledge-governance.js';

export function knowledgeTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'knowledge_retrieve',
      tier: 'core',
      description:
        'Retrieve governed product, solution, pricing, implementation, security, and competitive knowledge for a customer action. '
        + 'Returns approved, source-grounded, cited claims with trust metadata and a retrieval receipt — or a clear not_configured / no_results status. '
        + 'Optional and non-blocking: it never creates Memory or writes to systems of record. '
        + 'Use it before customer-facing drafting to ground product claims; never invent pricing, capabilities, roadmap, security posture, or competitive claims.',
      inputSchema: knowledgeRetrieve,
      handler: async (input, actor: ActorContext) => {
        return retrieveKnowledge(db, actor, input as KnowledgeRetrievalRequest);
      },
    },
    {
      name: 'knowledge_claim_upsert',
      tier: 'admin',
      description:
        'Admin/governance tool to create or update a product knowledge claim envelope (capability, proof point, pricing, implementation, security, or competitive response). '
        + 'Provide source_text to prove the claim is grounded in its source — customer-facing eligibility requires grounding plus approval, external-use, external visibility, and freshness. '
        + 'Re-upserts by external_key update in place. This authors governed product truth; it does not touch customer Memory.',
      inputSchema: knowledgeClaimUpsert,
      handler: async (input, actor: ActorContext) => {
        return upsertProductKnowledgeClaim(db, actor, input as UpsertProductKnowledgeClaimInput);
      },
    },
    {
      name: 'knowledge_claim_list',
      tier: 'admin',
      description:
        'Admin/governance tool to list product knowledge claim envelopes for the review queue. '
        + 'Filter by status, approval, review owner, or full-text query; pass needs_review to surface stale, conflicting, or pending-approval claims. '
        + 'Returns full governance fields (status, approval, freshness, owner) that customer-facing retrieval intentionally hides.',
      inputSchema: knowledgeClaimList,
      handler: async (input, actor: ActorContext) => {
        return listKnowledgeClaimsForReview(db, actor, input as ListKnowledgeClaimsInput);
      },
    },
    {
      name: 'knowledge_claim_review',
      tier: 'admin',
      description:
        'Admin/governance tool to apply a review decision to a product knowledge claim: approve (re-verifies freshness and revives stale claims), reject, deprecate, mark_stale, or reactivate. '
        + 'Optionally set customer-facing eligibility (approved_for_external_use) or assign a review owner. This governs product truth; it never touches customer Memory.',
      inputSchema: knowledgeClaimReview,
      handler: async (input, actor: ActorContext) => {
        const result = await reviewKnowledgeClaim(db, actor, input as ReviewKnowledgeClaimInput);
        return result ?? { error: 'not_found', message: 'No claim with that id in this workspace.' };
      },
    },
    {
      name: 'knowledge_conflicts_detect',
      tier: 'admin',
      description:
        'Admin/governance tool to detect competing product claims in the same category that may state inconsistent truth. '
        + 'Recommends source-priority resolution (prefer authoritative over secondary, approved over unapproved) or manual review. '
        + 'Pass apply=true to mark the lower-priority claim of each resolvable conflict as conflicting so it stops flowing into customer-facing retrieval.',
      inputSchema: knowledgeConflictsDetect,
      handler: async (input, actor: ActorContext) => {
        return detectKnowledgeConflicts(db, actor, input as DetectKnowledgeConflictsInput);
      },
    },
  ];
}
