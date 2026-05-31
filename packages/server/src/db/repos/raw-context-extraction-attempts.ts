// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { UUID } from '@crmy/shared';
import type { DbPool } from '../pool.js';

export interface RawContextExtractionAttempt {
  id: UUID;
  tenant_id: UUID;
  raw_context_source_id?: UUID | null;
  activity_id?: UUID | null;
  attempt_number: number;
  status: 'running' | 'succeeded' | 'failed';
  outcome?: string | null;
  stage: string;
  model?: string | null;
  response_format?: string | null;
  timeout_ms?: number | null;
  prompt_version: string;
  input_summary: Record<string, unknown>;
  telemetry: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  raw_output_excerpt?: string | null;
  repaired_output_excerpt?: string | null;
  failure_code?: string | null;
  failure_reason?: string | null;
  latency_ms?: number | null;
  started_at: string;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export async function startExtractionAttempt(
  db: DbPool,
  tenantId: UUID | string,
  input: {
    raw_context_source_id?: UUID | string | null;
    activity_id?: UUID | string | null;
    stage?: string;
    model?: string | null;
    response_format?: string | null;
    timeout_ms?: number | null;
    prompt_version?: string;
    input_summary?: Record<string, unknown>;
  },
): Promise<RawContextExtractionAttempt> {
  const result = await db.query(
    `INSERT INTO raw_context_extraction_attempts (
       tenant_id, raw_context_source_id, activity_id, attempt_number,
       status, stage, model, response_format, timeout_ms, prompt_version,
       input_summary
     )
     VALUES (
       $1, $2, $3,
       COALESCE((
         SELECT max(attempt_number) + 1
         FROM raw_context_extraction_attempts
         WHERE tenant_id = $1
           AND raw_context_source_id IS NOT DISTINCT FROM $2::uuid
       ), 1),
       'running', $4, $5, $6, $7, $8, $9
     )
     RETURNING *`,
    [
      tenantId,
      input.raw_context_source_id ?? null,
      input.activity_id ?? null,
      input.stage ?? 'extract_signals',
      input.model ?? null,
      input.response_format ?? 'json_object',
      input.timeout_ms ?? null,
      input.prompt_version ?? 'context_extraction_v1',
      JSON.stringify(input.input_summary ?? {}),
    ],
  );
  return result.rows[0] as RawContextExtractionAttempt;
}

export async function finishExtractionAttempt(
  db: DbPool,
  tenantId: UUID | string,
  id: UUID | string,
  patch: {
    status: 'succeeded' | 'failed';
    outcome?: string | null;
    telemetry?: Record<string, unknown>;
    output_summary?: Record<string, unknown>;
    raw_output_excerpt?: string | null;
    repaired_output_excerpt?: string | null;
    failure_code?: string | null;
    failure_reason?: string | null;
    latency_ms?: number | null;
  },
): Promise<RawContextExtractionAttempt | null> {
  const result = await db.query(
    `UPDATE raw_context_extraction_attempts
     SET status = $3,
         outcome = COALESCE($4, outcome),
         telemetry = telemetry || COALESCE($5::jsonb, '{}'::jsonb),
         output_summary = output_summary || COALESCE($6::jsonb, '{}'::jsonb),
         raw_output_excerpt = COALESCE($7, raw_output_excerpt),
         repaired_output_excerpt = COALESCE($8, repaired_output_excerpt),
         failure_code = COALESCE($9, failure_code),
         failure_reason = COALESCE($10, failure_reason),
         latency_ms = COALESCE($11, latency_ms),
         completed_at = now(),
         updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [
      tenantId,
      id,
      patch.status,
      patch.outcome ?? null,
      JSON.stringify(patch.telemetry ?? {}),
      JSON.stringify(patch.output_summary ?? {}),
      patch.raw_output_excerpt ?? null,
      patch.repaired_output_excerpt ?? null,
      patch.failure_code ?? null,
      patch.failure_reason ?? null,
      patch.latency_ms ?? null,
    ],
  );
  return (result.rows[0] as RawContextExtractionAttempt | undefined) ?? null;
}
