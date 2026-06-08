// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as signalGroupRepo from '../db/repos/signal-groups.js';
import { embedQuery } from './embedding-service.js';

export type RetrievedSignalGroup =
  signalGroupRepo.SignalGroup & {
    retrieval_method?: 'vector' | 'scope';
    vector_similarity?: number;
  };

function timestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function retrieveSignalGroupCandidates(
  db: DbPool,
  tenantId: UUID | string,
  input: {
    subject_type: string;
    subject_id: string;
    context_type: string;
    claim_text: string;
    limit?: number;
  },
): Promise<RetrievedSignalGroup[]> {
  const scoped = await signalGroupRepo.listCandidateGroups(db, tenantId, {
    subject_type: input.subject_type,
    subject_id: input.subject_id,
    context_type: input.context_type,
  });

  const byId = new Map<string, RetrievedSignalGroup>(
    scoped.map(group => [String(group.id), { ...group, retrieval_method: 'scope' as const }]),
  );

  try {
    const embedded = await embedQuery(input.claim_text);
    if (embedded) {
      const vectorMatches = await signalGroupRepo.semanticCandidateGroups(db, tenantId, {
        subject_type: input.subject_type,
        subject_id: input.subject_id,
        context_type: input.context_type,
        embedding: embedded.embedding,
        limit: input.limit ?? 25,
      });
      for (const group of vectorMatches) {
        const existing = byId.get(String(group.id));
        byId.set(String(group.id), {
          ...(existing ?? group),
          retrieval_method: 'vector',
          vector_similarity: Number(group.vector_similarity ?? 0),
        });
      }
    }
  } catch (err) {
    console.warn(`[candidate-retrieval] vector candidates unavailable: ${(err as Error).message}`);
  }

  return [...byId.values()]
    .sort((a, b) => (b.vector_similarity ?? 0) - (a.vector_similarity ?? 0) || timestampMs(b.updated_at) - timestampMs(a.updated_at))
    .slice(0, input.limit ?? 50);
}
