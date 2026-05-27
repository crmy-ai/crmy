// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ContextEntry, UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';

export type ContextWriteAction =
  | 'use_existing'
  | 'supersede_existing'
  | 'manual_review'
  | 'add_new';

export interface ContextConvergenceCandidate {
  entry: ContextEntry;
  score: number;
  reasons: string[];
  suggested_action: ContextWriteAction;
}

export interface ContextConvergenceResult {
  suggested_action: ContextWriteAction;
  should_block: boolean;
  candidates: ContextConvergenceCandidate[];
}

interface IncomingContext {
  subject_type: string;
  subject_id: UUID;
  context_type: string;
  title?: string;
  body: string;
  structured_data?: Record<string, unknown>;
}

function normalize(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(' ')
      .filter(token => token.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function primitiveValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function structuredSignals(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
): { score: number; reasons: string[]; conflict: boolean } {
  const reasons: string[] = [];
  let score = 0;
  let conflict = false;

  for (const key of Object.keys(incoming)) {
    if (!(key in existing)) continue;
    const incomingValue = primitiveValue(incoming[key]);
    const existingValue = primitiveValue(existing[key]);
    if (incomingValue == null || existingValue == null) continue;

    if (typeof incomingValue === 'number' && typeof existingValue === 'number') {
      const larger = Math.max(Math.abs(incomingValue), Math.abs(existingValue));
      const differs = larger > 0 && Math.abs(incomingValue - existingValue) / larger > 0.1;
      if (differs) {
        conflict = true;
        score = Math.max(score, 90);
        reasons.push(`structured_data.${key} conflicts`);
      } else {
        score = Math.max(score, 80);
        reasons.push(`structured_data.${key} matches`);
      }
      continue;
    }

    const left = String(incomingValue).trim().toLowerCase();
    const right = String(existingValue).trim().toLowerCase();
    if (left === right) {
      score = Math.max(score, 80);
      reasons.push(`structured_data.${key} matches`);
    } else if (left.length <= 200 && right.length <= 200) {
      conflict = true;
      score = Math.max(score, 90);
      reasons.push(`structured_data.${key} conflicts`);
    }
  }

  return { score, reasons, conflict };
}

function scoreCandidate(incoming: IncomingContext, existing: ContextEntry): ContextConvergenceCandidate | null {
  const reasons: string[] = [];
  let score = 0;
  let hasConflict = false;

  const incomingTitle = normalize(incoming.title);
  const existingTitle = normalize(existing.title);
  const incomingBody = normalize(incoming.body);
  const existingBody = normalize(existing.body);

  if (incomingBody && incomingBody === existingBody) {
    score = 100;
    reasons.push('body is an exact match');
  } else {
    const bodySimilarity = jaccard(tokens(incoming.body), tokens(existing.body));
    if (bodySimilarity >= 0.65) {
      score = Math.max(score, Math.round(bodySimilarity * 85));
      reasons.push(`body is ${Math.round(bodySimilarity * 100)}% similar`);
    }
  }

  if (incomingTitle && incomingTitle === existingTitle) {
    score = Math.max(score, 75);
    reasons.push('title matches an existing current entry');
  }

  const structured = structuredSignals(incoming.structured_data ?? {}, existing.structured_data ?? {});
  score = Math.max(score, structured.score);
  reasons.push(...structured.reasons);
  hasConflict = structured.conflict;

  if (score < 50) return null;

  const suggested_action: ContextWriteAction = hasConflict
    ? 'manual_review'
    : score >= 95
      ? 'use_existing'
      : 'supersede_existing';

  return {
    entry: existing,
    score,
    reasons,
    suggested_action,
  };
}

export async function checkContextConvergence(
  db: DbPool,
  tenantId: UUID,
  incoming: IncomingContext,
): Promise<ContextConvergenceResult> {
  const result = await db.query(
    `SELECT *
     FROM context_entries
     WHERE tenant_id = $1
       AND subject_type = $2
       AND subject_id = $3
       AND context_type = $4
       AND is_current = true
       AND memory_status = 'active'
     ORDER BY created_at DESC
     LIMIT 25`,
    [tenantId, incoming.subject_type, incoming.subject_id, incoming.context_type],
  );

  const candidates = (result.rows as ContextEntry[])
    .map(entry => scoreCandidate(incoming, entry))
    .filter((candidate): candidate is ContextConvergenceCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const top = candidates[0];
  if (!top) {
    return { suggested_action: 'add_new', should_block: false, candidates: [] };
  }

  return {
    suggested_action: top.suggested_action,
    should_block: top.score >= 70 || top.suggested_action === 'manual_review',
    candidates,
  };
}
