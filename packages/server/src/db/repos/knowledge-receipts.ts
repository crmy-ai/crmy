// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { KnowledgeExcludedClaim } from '@crmy/shared';

export interface InsertKnowledgeReceiptInput {
  actor_id: string | null;
  query: string;
  audience: string;
  policy: string;
  filters: Record<string, unknown>;
  returned_claim_ids: string[];
  excluded: KnowledgeExcludedClaim[];
  warnings: string[];
  subject_type?: string | null;
  subject_id?: string | null;
  proposed_action?: string | null;
}

export interface KnowledgeReceiptRow {
  id: string;
  policy: string;
  retrieved_at: string;
}

/** Record durable proof of a retrieval: query, policy, returned + excluded claims, warnings. */
export async function insertKnowledgeReceipt(
  db: DbPool,
  tenantId: string,
  input: InsertKnowledgeReceiptInput,
): Promise<KnowledgeReceiptRow> {
  const result = await db.query<KnowledgeReceiptRow>(
    `INSERT INTO knowledge_retrieval_receipts (
       tenant_id, actor_id, query, audience, policy, filters,
       returned_claim_ids, excluded, warnings, subject_type, subject_id, proposed_action
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, policy, retrieved_at`,
    [
      tenantId,
      input.actor_id,
      input.query,
      input.audience,
      input.policy,
      JSON.stringify(input.filters),
      input.returned_claim_ids,
      JSON.stringify(input.excluded),
      JSON.stringify(input.warnings),
      input.subject_type ?? null,
      input.subject_id ?? null,
      input.proposed_action ?? null,
    ],
  );
  return result.rows[0];
}

export async function getKnowledgeReceipt(db: DbPool, tenantId: string, id: string): Promise<Record<string, unknown> | null> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM knowledge_retrieval_receipts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ?? null;
}
