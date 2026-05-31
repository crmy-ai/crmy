// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { UUID } from '@crmy/shared';
import type { DbPool } from '../pool.js';

export interface RawContextSourcePayload {
  id: UUID;
  tenant_id: UUID;
  raw_context_source_id: UUID;
  document_hash: string;
  document_text: string;
  source_label?: string | null;
  source_occurred_at?: string | null;
  subjects: Array<Record<string, unknown>>;
  proposed_records: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function upsertRawContextSourcePayload(
  db: DbPool,
  tenantId: UUID | string,
  input: {
    raw_context_source_id: UUID | string;
    document_hash: string;
    document_text: string;
    source_label?: string | null;
    source_occurred_at?: string | null;
    subjects?: Array<Record<string, unknown>>;
    proposed_records?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  },
): Promise<RawContextSourcePayload> {
  const result = await db.query(
    `INSERT INTO raw_context_source_payloads (
       tenant_id, raw_context_source_id, document_hash, document_text,
       source_label, source_occurred_at, subjects, proposed_records, metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id, raw_context_source_id)
     DO UPDATE SET
       document_hash = EXCLUDED.document_hash,
       document_text = EXCLUDED.document_text,
       source_label = COALESCE(EXCLUDED.source_label, raw_context_source_payloads.source_label),
       source_occurred_at = COALESCE(EXCLUDED.source_occurred_at, raw_context_source_payloads.source_occurred_at),
       subjects = EXCLUDED.subjects,
       proposed_records = EXCLUDED.proposed_records,
       metadata = raw_context_source_payloads.metadata || EXCLUDED.metadata,
       updated_at = now()
     RETURNING *`,
    [
      tenantId,
      input.raw_context_source_id,
      input.document_hash,
      input.document_text,
      input.source_label ?? null,
      input.source_occurred_at ?? null,
      JSON.stringify(input.subjects ?? []),
      JSON.stringify(input.proposed_records ?? []),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0] as RawContextSourcePayload;
}

export async function getRawContextSourcePayload(
  db: DbPool,
  tenantId: UUID | string,
  rawContextSourceId: UUID | string,
): Promise<RawContextSourcePayload | null> {
  const result = await db.query(
    `SELECT *
     FROM raw_context_source_payloads
     WHERE tenant_id = $1 AND raw_context_source_id = $2`,
    [tenantId, rawContextSourceId],
  );
  return (result.rows[0] as RawContextSourcePayload | undefined) ?? null;
}
