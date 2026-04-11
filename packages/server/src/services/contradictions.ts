// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Contradiction detection service.
 *
 * Finds pairs of current context entries for the same subject that claim
 * conflicting facts. Used in briefings and exposed via MCP tools so agents
 * can surface and resolve contradictions before acting on bad data.
 *
 * Two detection strategies:
 *
 *   1. Heuristic (fast, no LLM cost): compares overlapping keys in
 *      structured_data for differing values. Catches explicit numeric/string
 *      conflicts like { amount: 5000000 } vs { amount: 2000000 }.
 *
 *   2. LLM (slow, agent-configured): passes both entry bodies to the tenant's
 *      configured LLM and asks whether they contradict. Only runs when an
 *      agent is configured AND the heuristic pass found no structural conflict.
 *      Skipped gracefully when no agent is configured.
 */

import type { DbPool } from '../db/pool.js';
import type { UUID, ContextEntry } from '@crmy/shared';
import * as agentRepo from '../db/repos/agent.js';
import { decrypt } from '../agent/crypto.js';

export interface ContradictionWarning {
  entry_a: ContextEntry;
  entry_b: ContextEntry;
  /** Which field or topic is in conflict. */
  conflict_field: string;
  /** Human-readable description of the contradiction. */
  conflict_evidence: string;
  /** What the system recommends doing. */
  suggested_action: 'supersede_older' | 'supersede_lower_confidence' | 'manual_review';
  detected_at: string;
}

/**
 * Detect contradictions among current context entries for a subject.
 *
 * @param contextType - if provided, only check entries of this type.
 *                      If omitted, checks all contradiction-eligible types.
 */
export async function detectContradictions(
  db: DbPool,
  tenantId: UUID,
  subjectType: string,
  subjectId: UUID,
  contextType?: string,
): Promise<ContradictionWarning[]> {
  // Fetch candidate pairs: two current entries, same type, same subject
  // Only for is_contradiction_eligible types
  const pairsResult = await db.query<{
    a_id: UUID; a_title: string | null; a_body: string; a_confidence: number | null;
    a_structured_data: Record<string, unknown>; a_context_type: string;
    a_created_at: string; a_updated_at: string; a_authored_by: UUID;
    a_tags: string[]; a_is_current: boolean; a_supersedes_id: UUID | null;
    a_source: string | null; a_source_ref: string | null; a_source_activity_id: UUID | null;
    a_valid_until: string | null; a_reviewed_at: string | null;
    b_id: UUID; b_title: string | null; b_body: string; b_confidence: number | null;
    b_structured_data: Record<string, unknown>; b_created_at: string;
    b_updated_at: string; b_authored_by: UUID;
    b_tags: string[]; b_is_current: boolean; b_supersedes_id: UUID | null;
    b_source: string | null; b_source_ref: string | null; b_source_activity_id: UUID | null;
    b_valid_until: string | null; b_reviewed_at: string | null;
  }>(
    `SELECT
       c1.id AS a_id, c1.title AS a_title, c1.body AS a_body,
       c1.confidence AS a_confidence, c1.structured_data AS a_structured_data,
       c1.context_type AS a_context_type,
       c1.created_at AS a_created_at, c1.updated_at AS a_updated_at,
       c1.authored_by AS a_authored_by, c1.tags AS a_tags,
       c1.is_current AS a_is_current, c1.supersedes_id AS a_supersedes_id,
       c1.source AS a_source, c1.source_ref AS a_source_ref,
       c1.source_activity_id AS a_source_activity_id,
       c1.valid_until AS a_valid_until, c1.reviewed_at AS a_reviewed_at,
       c2.id AS b_id, c2.title AS b_title, c2.body AS b_body,
       c2.confidence AS b_confidence, c2.structured_data AS b_structured_data,
       c2.created_at AS b_created_at, c2.updated_at AS b_updated_at,
       c2.authored_by AS b_authored_by, c2.tags AS b_tags,
       c2.is_current AS b_is_current, c2.supersedes_id AS b_supersedes_id,
       c2.source AS b_source, c2.source_ref AS b_source_ref,
       c2.source_activity_id AS b_source_activity_id,
       c2.valid_until AS b_valid_until, c2.reviewed_at AS b_reviewed_at
     FROM context_entries c1
     JOIN context_entries c2 ON (
       c1.tenant_id = c2.tenant_id
       AND c1.subject_type = c2.subject_type
       AND c1.subject_id = c2.subject_id
       AND c1.context_type = c2.context_type
       AND c1.id < c2.id
     )
     JOIN context_type_registry ctr ON (
       ctr.tenant_id = c1.tenant_id
       AND ctr.type_name = c1.context_type
       AND ctr.is_contradiction_eligible = TRUE
     )
     WHERE c1.tenant_id = $1
       AND c1.subject_type = $2
       AND c1.subject_id = $3
       AND c1.is_current = TRUE
       AND c2.is_current = TRUE
       AND ($4::text IS NULL OR c1.context_type = $4)
     ORDER BY c1.context_type, c1.created_at DESC
     LIMIT 40`,
    [tenantId, subjectType, subjectId, contextType ?? null],
  );

  if (pairsResult.rows.length === 0) return [];

  // Rebuild full ContextEntry objects from flat columns
  const warnings: ContradictionWarning[] = [];

  // Load agent config once (for LLM slow path)
  const agentConfig = await agentRepo.getConfig(db, tenantId);
  const canUseLLM = !!(agentConfig?.enabled && agentConfig.api_key_enc);

  for (const row of pairsResult.rows) {
    const entryA: ContextEntry = {
      id: row.a_id, tenant_id: tenantId,
      subject_type: subjectType as ContextEntry['subject_type'],
      subject_id: subjectId,
      context_type: row.a_context_type,
      authored_by: row.a_authored_by,
      title: row.a_title ?? undefined,
      body: row.a_body,
      structured_data: row.a_structured_data ?? {},
      tags: row.a_tags ?? [],
      confidence: row.a_confidence ?? undefined,
      is_current: row.a_is_current,
      supersedes_id: row.a_supersedes_id ?? undefined,
      source: row.a_source ?? undefined,
      source_ref: row.a_source_ref ?? undefined,
      source_activity_id: row.a_source_activity_id ?? undefined,
      valid_until: row.a_valid_until ?? undefined,
      reviewed_at: row.a_reviewed_at ?? undefined,
      created_at: row.a_created_at,
      updated_at: row.a_updated_at,
    };
    const entryB: ContextEntry = {
      id: row.b_id, tenant_id: tenantId,
      subject_type: subjectType as ContextEntry['subject_type'],
      subject_id: subjectId,
      context_type: row.a_context_type,
      authored_by: row.b_authored_by,
      title: row.b_title ?? undefined,
      body: row.b_body,
      structured_data: row.b_structured_data ?? {},
      tags: row.b_tags ?? [],
      confidence: row.b_confidence ?? undefined,
      is_current: row.b_is_current,
      supersedes_id: row.b_supersedes_id ?? undefined,
      source: row.b_source ?? undefined,
      source_ref: row.b_source_ref ?? undefined,
      source_activity_id: row.b_source_activity_id ?? undefined,
      valid_until: row.b_valid_until ?? undefined,
      reviewed_at: row.b_reviewed_at ?? undefined,
      created_at: row.b_created_at,
      updated_at: row.b_updated_at,
    };

    // --- Fast path: structured_data key overlap with differing values ---
    const structuralConflict = detectStructuralConflict(entryA, entryB);
    if (structuralConflict) {
      warnings.push({
        entry_a: entryA,
        entry_b: entryB,
        conflict_field: structuralConflict.field,
        conflict_evidence: structuralConflict.evidence,
        suggested_action: suggestAction(entryA, entryB),
        detected_at: new Date().toISOString(),
      });
      continue;
    }

    // --- Slow path: LLM body comparison ---
    if (!canUseLLM) continue;

    try {
      const apiKey = decrypt(agentConfig!.api_key_enc!).trim();
      const result = await callContradictionLLM(
        entryA, entryB,
        agentConfig!.provider, agentConfig!.base_url, agentConfig!.model, apiKey,
      );
      if (result.contradicts) {
        warnings.push({
          entry_a: entryA,
          entry_b: entryB,
          conflict_field: result.field,
          conflict_evidence: result.evidence,
          suggested_action: suggestAction(entryA, entryB),
          detected_at: new Date().toISOString(),
        });
      }
    } catch {
      // LLM call failed — skip this pair silently (detection is best-effort)
    }
  }

  return warnings;
}

// ── Structural conflict detection ────────────────────────────────────────────

function detectStructuralConflict(
  a: ContextEntry,
  b: ContextEntry,
): { field: string; evidence: string } | null {
  const sdA = a.structured_data ?? {};
  const sdB = b.structured_data ?? {};

  // Compare overlapping keys where both values are non-null primitives
  for (const key of Object.keys(sdA)) {
    if (!(key in sdB)) continue;
    const vA = sdA[key];
    const vB = sdB[key];
    if (vA == null || vB == null) continue;
    // Skip arrays and objects — too complex for simple comparison
    if (typeof vA === 'object' || typeof vB === 'object') continue;

    // Numeric comparison: flag if values differ by more than 10%
    if (typeof vA === 'number' && typeof vB === 'number') {
      const larger = Math.max(Math.abs(vA), Math.abs(vB));
      if (larger > 0 && Math.abs(vA - vB) / larger > 0.1) {
        const aLabel = a.title ?? a.context_type;
        const bLabel = b.title ?? b.context_type;
        return {
          field: key,
          evidence: `"${aLabel}" has ${key}=${formatValue(vA)}, but "${bLabel}" has ${key}=${formatValue(vB)}`,
        };
      }
    }

    // String comparison: flag if values differ (case-insensitive, trimmed)
    if (typeof vA === 'string' && typeof vB === 'string') {
      if (vA.trim().toLowerCase() !== vB.trim().toLowerCase()) {
        // Only flag short strings (long text is narrative, not scalar)
        if (vA.length <= 200 && vB.length <= 200) {
          const aLabel = a.title ?? a.context_type;
          const bLabel = b.title ?? b.context_type;
          return {
            field: key,
            evidence: `"${aLabel}" has ${key}="${vA}", but "${bLabel}" has ${key}="${vB}"`,
          };
        }
      }
    }

    // Boolean comparison
    if (typeof vA === 'boolean' && typeof vB === 'boolean' && vA !== vB) {
      const aLabel = a.title ?? a.context_type;
      const bLabel = b.title ?? b.context_type;
      return {
        field: key,
        evidence: `"${aLabel}" has ${key}=${vA}, but "${bLabel}" has ${key}=${vB}`,
      };
    }
  }

  return null;
}

function formatValue(v: unknown): string {
  if (typeof v === 'number') {
    // Format large numbers with commas
    if (Math.abs(v as number) >= 1000) return (v as number).toLocaleString('en-US');
  }
  return String(v);
}

// ── Suggestion logic ─────────────────────────────────────────────────────────

function suggestAction(a: ContextEntry, b: ContextEntry): ContradictionWarning['suggested_action'] {
  const confA = a.confidence ?? 0.5;
  const confB = b.confidence ?? 0.5;
  const confDiff = Math.abs(confA - confB);

  if (confDiff >= 0.2) return 'supersede_lower_confidence';

  // Prefer more recent entry
  const dateA = new Date(a.created_at).getTime();
  const dateB = new Date(b.created_at).getTime();
  if (Math.abs(dateA - dateB) > 7 * 24 * 60 * 60 * 1000) return 'supersede_older';

  return 'manual_review';
}

// ── LLM contradiction check ──────────────────────────────────────────────────

async function callContradictionLLM(
  entryA: ContextEntry,
  entryB: ContextEntry,
  provider: string,
  baseUrl: string,
  model: string,
  apiKey: string,
): Promise<{ contradicts: boolean; field: string; evidence: string }> {
  const systemPrompt = `You are a CRM knowledge consistency checker. Given two context entries about the same CRM record, determine if they state contradictory facts.

Respond ONLY with valid JSON in this exact format:
{"contradicts": true|false, "field": "name of the conflicting field or topic", "evidence": "one sentence explaining what conflicts"}

If they do not contradict (e.g., they describe different aspects, are complementary, or one supersedes the other in time), respond with:
{"contradicts": false, "field": "", "evidence": ""}`;

  const userPrompt = `Context type: ${entryA.context_type}

Entry A (created ${entryA.created_at}, confidence ${entryA.confidence ?? 'unknown'}):
Title: ${entryA.title ?? '(none)'}
Body: ${entryA.body.slice(0, 800)}

Entry B (created ${entryB.created_at}, confidence ${entryB.confidence ?? 'unknown'}):
Title: ${entryB.title ?? '(none)'}
Body: ${entryB.body.slice(0, 800)}

Do these entries state contradictory facts about the same topic?`;

  let responseText: string;
  if (provider === 'anthropic') {
    responseText = await callAnthropicSync(systemPrompt, userPrompt, model, baseUrl, apiKey);
  } else {
    responseText = await callOpenAICompatSync(systemPrompt, userPrompt, model, baseUrl, apiKey);
  }

  try {
    const parsed = JSON.parse(responseText.trim()) as { contradicts: boolean; field: string; evidence: string };
    return {
      contradicts: Boolean(parsed.contradicts),
      field: parsed.field ?? 'unknown',
      evidence: parsed.evidence ?? '',
    };
  } catch {
    return { contradicts: false, field: '', evidence: '' };
  }
}

async function callAnthropicSync(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  baseUrl: string,
  apiKey: string,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content.find(b => b.type === 'text')?.text ?? '';
}

async function callOpenAICompatSync(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  baseUrl: string,
  apiKey: string,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI-compat API ${res.status}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? '';
}
