// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Memory consolidation service.
 *
 * Takes N current context entries of the same type for the same subject and
 * synthesises them into a single authoritative entry via the tenant's LLM.
 * All source entries are superseded (marked is_current = false) and the new
 * consolidated entry references them via structured_data.source_entry_ids.
 *
 * If no agent is configured, falls back to a simple concatenation strategy
 * so the tool is never a no-op.
 */

import type { DbPool } from '../db/pool.js';
import type { UUID, ContextEntry } from '@crmy/shared';
import * as contextRepo from '../db/repos/context-entries.js';
import * as agentRepo from '../db/repos/agent.js';
import { decrypt } from '../agent/crypto.js';
// Note: decrypt() is synchronous in this codebase

// ── LLM helpers (reuse pattern from contradictions.ts) ──────────────────────

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
      max_tokens: 1024,
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
      max_tokens: 1024,
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

// ── Synthesis ────────────────────────────────────────────────────────────────

interface SynthesisResult {
  body: string;
  confidence: number;
}

async function synthesiseFallback(entries: ContextEntry[]): Promise<SynthesisResult> {
  // Simple concatenation: join bodies in chronological order, pick highest confidence
  const sorted = [...entries].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const body = sorted.map((e, i) => `[${i + 1}] ${e.body.trim()}`).join('\n\n');
  const confidence = Math.max(...entries.map((e) => e.confidence ?? 0.5));
  return { body, confidence };
}

async function synthesiseWithLLM(
  entries: ContextEntry[],
  provider: string,
  baseUrl: string,
  model: string,
  apiKey: string,
): Promise<SynthesisResult> {
  const systemPrompt = `You are a CRM knowledge synthesiser. Given multiple context entries of the same type about the same record, produce a single authoritative consolidation.

Rules:
- Prefer the most recent and highest-confidence information when there is conflict
- Preserve specific facts, numbers, names, and dates
- Remove redundancy but keep all unique insights
- Output valid JSON: {"body": "consolidated text", "confidence": 0.0-1.0}

The confidence should reflect how well the sources agree (1.0 = fully consistent, 0.5 = some conflict).`;

  const sorted = [...entries].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const userPrompt = `Context type: ${entries[0].context_type}
Number of entries to consolidate: ${entries.length}

${sorted.map((e, i) => `Entry ${i + 1} (created ${e.created_at}, confidence ${e.confidence ?? 'unknown'}):
Title: ${e.title ?? '(none)'}
Body: ${e.body.slice(0, 1200)}`).join('\n\n---\n\n')}

Synthesise these into one authoritative entry. Output JSON only.`;

  let responseText: string;
  try {
    if (provider === 'anthropic') {
      responseText = await callAnthropicSync(systemPrompt, userPrompt, model, baseUrl, apiKey);
    } else {
      responseText = await callOpenAICompatSync(systemPrompt, userPrompt, model, baseUrl, apiKey);
    }
    // Extract JSON from potential markdown fences
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const parsed = JSON.parse(jsonMatch[0]) as { body?: string; confidence?: number };
    return {
      body: parsed.body ?? await synthesiseFallback(entries).then(r => r.body),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
    };
  } catch {
    return synthesiseFallback(entries);
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

export interface ConsolidationResult {
  consolidated_entry: ContextEntry;
  superseded_count: number;
  source_entry_ids: UUID[];
}

/**
 * Consolidate multiple current context entries of the same type for the same
 * subject into a single synthesised entry.
 *
 * @param entryIds  IDs to consolidate. Must all be is_current=true and share
 *                  the same subject + context_type. If omitted, all current
 *                  entries of contextType for the subject are used (capped at
 *                  maxEntries).
 */
export async function consolidateContextEntries(
  db: DbPool,
  tenantId: UUID,
  actorId: UUID,
  subjectType: string,
  subjectId: UUID,
  contextType: string,
  entryIds?: UUID[],
  maxEntries = 10,
): Promise<ConsolidationResult> {
  // 1. Fetch entries to consolidate
  let entries: ContextEntry[];
  if (entryIds && entryIds.length > 0) {
    const results = await Promise.all(
      entryIds.map((id) => contextRepo.getContextEntry(db, tenantId, id)),
    );
    entries = results.filter((e): e is ContextEntry => e !== null && e.is_current);
    if (entries.length < 2) throw new Error('Need at least 2 current entries to consolidate');
  } else {
    entries = await contextRepo.getContextForSubject(db, tenantId, subjectType, subjectId, {
      context_type: contextType,
      current_only: true,
      limit: maxEntries,
    });
    if (entries.length < 2) throw new Error('Need at least 2 current entries to consolidate');
  }

  const sourceIds = entries.map((e) => e.id);

  // 2. Synthesise — try LLM, fall back to concatenation
  let synthesis: SynthesisResult;
  try {
    const config = await agentRepo.getConfig(db, tenantId);
    if (config?.enabled && config.api_key_enc) {
      const apiKey = decrypt(config.api_key_enc).trim();
      synthesis = await synthesiseWithLLM(
        entries,
        config.provider,
        config.base_url,
        config.model,
        apiKey,
      );
    } else {
      synthesis = await synthesiseFallback(entries);
    }
  } catch {
    synthesis = await synthesiseFallback(entries);
  }

  // 3. Mark all source entries as not current
  for (const entry of entries) {
    await db.query(
      'UPDATE context_entries SET is_current = false, updated_at = now() WHERE id = $1 AND tenant_id = $2',
      [entry.id, tenantId],
    );
  }

  // 4. Create the consolidated entry
  const firstEntry = entries[0];
  const consolidated = await contextRepo.createContextEntry(db, tenantId, {
    subject_type: firstEntry.subject_type,
    subject_id: firstEntry.subject_id,
    context_type: contextType,
    authored_by: actorId,
    title: `Consolidated: ${contextType} (${entries.length} entries)`,
    body: synthesis.body,
    confidence: synthesis.confidence,
    tags: [...new Set(entries.flatMap((e) => e.tags ?? []))],
    source: 'consolidation',
    structured_data: { source_entry_ids: sourceIds },
  });

  return {
    consolidated_entry: consolidated,
    superseded_count: entries.length,
    source_entry_ids: sourceIds,
  };
}
