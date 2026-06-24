// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { knowledgeRetrieve, knowledgeClaimUpsert } from '@crmy/shared';
import type { ActorContext, KnowledgeRetrievalRequest } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ToolDef } from '../server.js';
import { retrieveKnowledge, upsertProductKnowledgeClaim, type UpsertProductKnowledgeClaimInput } from '../../services/knowledge-retrieval.js';

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
  ];
}
