// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { knowledgeRetrieve } from '@crmy/shared';
import type { ActorContext, KnowledgeRetrievalRequest } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ToolDef } from '../server.js';
import { retrieveKnowledge } from '../../services/knowledge-retrieval.js';

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
  ];
}
