// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Activity-to-Context extraction pipeline.
 *
 * When an activity (call, email, meeting, note) is created or updated,
 * this service calls the tenant's configured LLM to extract structured
 * context entries from the activity's free-text content.
 *
 * Each extracted entry is written with:
 *   - source = 'extraction'
 *   - source_ref = activity.id
 *   - source_activity_id = activity.id
 *   - authored_by = the tenant's 'crmy-extraction' agent actor (created on demand)
 */

import type { DbPool } from '../db/pool.js';
import * as agentRepo from '../db/repos/agent.js';
import * as contextRepo from '../db/repos/context-entries.js';
import * as contextTypeRepo from '../db/repos/context-type-registry.js';
import * as actorRepo from '../db/repos/actors.js';
import { decrypt } from './crypto.js';

// Activity types worth extracting from (those with text content)
const EXTRACTABLE_ACTIVITY_TYPES = new Set([
  'call', 'email', 'meeting', 'note',
  'outreach_email', 'outreach_call', 'meeting_held', 'meeting_scheduled',
  'note_added', 'research_completed',
]);

interface ActivityRow {
  id: string;
  tenant_id: string;
  type: string;
  subject: string;
  body: string | null;
  outcome: string | null;
  occurred_at: string | null;
  created_at: string;
  subject_type: string | null;
  subject_id: string | null;
  created_by: string | null;
  detail: Record<string, unknown> | null;
}

interface ExtractedEntry {
  context_type: string;
  title: string;
  body: string;
  confidence?: number;
  structured_data?: Record<string, unknown>;
  valid_until?: string;
  tags?: string[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mark an activity for extraction. Used by activity tool handlers (fire-and-forget).
 * If the agent is configured and enabled, runs extraction immediately.
 * Otherwise marks as 'pending' for the background worker.
 */
export async function triggerExtraction(
  db: DbPool,
  tenantId: string,
  activityId: string,
): Promise<void> {
  const config = await agentRepo.getConfig(db, tenantId);

  if (!config?.enabled || !config.api_key_enc) {
    // Mark pending — background worker will pick it up once agent is configured
    await markExtractionStatus(db, activityId, 'pending');
    return;
  }

  // Run immediately (but don't await in the caller — this is fire-and-forget)
  await extractContextFromActivity(db, tenantId, activityId);
}

/**
 * Run extraction on a specific activity. Returns the number of context entries created.
 * Idempotent: re-running will create new context entries (superseding is handled by the caller).
 */
export async function extractContextFromActivity(
  db: DbPool,
  tenantId: string,
  activityId: string,
): Promise<number> {
  // Load activity
  const actResult = await db.query(
    `SELECT id, tenant_id, type, subject, body, outcome, occurred_at, created_at,
            subject_type, subject_id, created_by, detail
     FROM activities
     WHERE id = $1 AND tenant_id = $2`,
    [activityId, tenantId],
  );
  const activity = actResult.rows[0] as ActivityRow | undefined;
  if (!activity) {
    await markExtractionStatus(db, activityId, 'skipped', 'Activity not found');
    return 0;
  }

  // Skip activities without meaningful text
  const content = buildActivityContent(activity);
  if (!content.trim()) {
    await markExtractionStatus(db, activityId, 'skipped', 'No text content');
    return 0;
  }

  // Skip non-extractable activity types
  if (!EXTRACTABLE_ACTIVITY_TYPES.has(activity.type)) {
    await markExtractionStatus(db, activityId, 'skipped', `Activity type '${activity.type}' not extractable`);
    return 0;
  }

  // Load agent config
  const config = await agentRepo.getConfig(db, tenantId);
  if (!config?.enabled || !config.api_key_enc) {
    await markExtractionStatus(db, activityId, 'pending', 'Agent not configured');
    return 0;
  }

  // Load extractable context types
  const extractableTypes = await contextTypeRepo.getExtractableTypes(db, tenantId);
  if (extractableTypes.length === 0) {
    await markExtractionStatus(db, activityId, 'skipped', 'No extractable context types defined');
    return 0;
  }

  // Ensure the extraction agent actor exists for this tenant
  const extractorActor = await actorRepo.ensureActor(db, tenantId, {
    actor_type: 'agent',
    display_name: 'CRMy Extraction',
    agent_identifier: 'crmy-extraction',
    agent_model: config.model,
    metadata: { purpose: 'context_extraction' },
  });

  // Build and call the LLM
  let entries: ExtractedEntry[];
  try {
    const apiKey = decrypt(config.api_key_enc);
    entries = await callExtractionLLM(activity, content, extractableTypes, config.provider, config.base_url, config.model, apiKey, config.max_tokens_per_turn);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'LLM call failed';
    await markExtractionStatus(db, activityId, 'error', msg);
    console.error(`[extraction] Activity ${activityId}: ${msg}`);
    return 0;
  }

  if (entries.length === 0) {
    await markExtractionStatus(db, activityId, 'done');
    return 0;
  }

  // Write context entries
  let written = 0;
  for (const entry of entries) {
    // Skip if context_type doesn't exist in registry
    const typeExists = extractableTypes.find(t => t.type_name === entry.context_type);
    if (!typeExists) continue;

    try {
      await contextRepo.createContextEntry(db, tenantId, {
        subject_type: (activity.subject_type ?? 'contact') as 'contact' | 'account' | 'opportunity' | 'use_case',
        subject_id: activity.subject_id ?? activity.id, // fallback to activity id if no subject
        context_type: entry.context_type,
        authored_by: extractorActor.id,
        title: entry.title,
        body: entry.body,
        structured_data: entry.structured_data ?? {},
        confidence: entry.confidence ?? undefined,
        tags: entry.tags ?? ['extracted', activity.type],
        source: 'extraction',
        source_ref: activityId,
        source_activity_id: activityId,
        valid_until: entry.valid_until ?? undefined,
        is_current: true,
      });
      written++;
    } catch (err) {
      console.error(`[extraction] Failed to write context entry for activity ${activityId}:`, err);
    }
  }

  await markExtractionStatus(db, activityId, 'done');
  return written;
}

/**
 * Background worker: process activities with extraction_status = 'pending'.
 * Called from the 60s interval worker in index.ts.
 */
export async function processPendingExtractions(db: DbPool, limit = 20): Promise<void> {
  const result = await db.query(
    `SELECT DISTINCT tenant_id, id, created_at
     FROM activities
     WHERE extraction_status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit],
  );

  for (const row of result.rows as { tenant_id: string; id: string }[]) {
    try {
      await extractContextFromActivity(db, row.tenant_id, row.id);
    } catch (err) {
      console.error(`[extraction] Background extraction failed for ${row.id}:`, err);
    }
  }
}

// ── LLM caller ────────────────────────────────────────────────────────────────

async function callExtractionLLM(
  activity: ActivityRow,
  content: string,
  extractableTypes: { type_name: string; label: string; description?: string | null; extraction_prompt: string | null; json_schema: Record<string, unknown> | null }[],
  provider: string,
  baseUrl: string,
  model: string,
  apiKey: string,
  maxTokens: number,
): Promise<ExtractedEntry[]> {
  const systemPrompt = buildSystemPrompt(extractableTypes);
  const userPrompt = buildUserPrompt(activity, content);

  // Cap extraction at a reasonable token budget (don't burn the full max_tokens_per_turn)
  const extractionMaxTokens = Math.min(maxTokens, 2000);

  let responseText: string;

  if (provider === 'anthropic') {
    responseText = await callAnthropicSync(systemPrompt, userPrompt, model, baseUrl, apiKey, extractionMaxTokens);
  } else {
    responseText = await callOpenAICompatSync(systemPrompt, userPrompt, model, baseUrl, apiKey, extractionMaxTokens);
  }

  return parseExtractionResponse(responseText);
}

function buildSystemPrompt(
  types: { type_name: string; label: string; description?: string | null; extraction_prompt: string | null; json_schema: Record<string, unknown> | null }[],
): string {
  const typeDescriptions = types.map(t => {
    const lines = [`**${t.type_name}** (${t.label}): ${t.description ?? ''}`];
    if (t.extraction_prompt) lines.push(`  When to extract: ${t.extraction_prompt}`);
    if (t.json_schema) {
      const schema = t.json_schema as { properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] };
      if (schema.properties) {
        const fields = Object.entries(schema.properties).map(([key, def]) => {
          const req = schema.required?.includes(key) ? ' (required)' : ' (optional)';
          const desc = def.description ? ` — ${def.description}` : '';
          const enums = def.enum ? ` [${def.enum.join(' | ')}]` : '';
          return `    - ${key}${req}${desc}${enums}`;
        });
        lines.push('  structured_data fields:');
        lines.push(...fields);
      }
    }
    return lines.join('\n');
  }).join('\n\n');

  return `You are a CRM knowledge extraction agent. Extract structured context entries from CRM activity content.

Return a JSON object with a single key "context_entries" containing an array of entries. Each entry:
- context_type: must be one of the supported types below
- title: concise title (required, ≤ 80 chars)
- body: full description with all relevant detail (required)
- confidence: 0.0–1.0 — how clearly stated this information is (0.9+ = explicitly stated, 0.5–0.8 = inferred, <0.5 = speculative)
- structured_data: object with type-specific fields (see schemas below)
- valid_until: ISO date string if this information will become stale (use for next_step, commitment, deal_risk)
- tags: array of relevant string tags (optional)

Rules:
1. Only extract information clearly present in the activity — never hallucinate or speculate
2. Set confidence below 0.7 if you're inferring rather than reading directly
3. If nothing extractable is found, return {"context_entries": []}
4. Create one entry per distinct piece of information (e.g. one entry per stakeholder, one per competitor)
5. Return valid JSON only — no markdown code fences, no commentary

Supported context types:
${typeDescriptions}`;
}

function buildUserPrompt(activity: ActivityRow, content: string): string {
  const date = activity.occurred_at ?? activity.created_at;
  const lines = [
    `Activity Type: ${activity.type}`,
    `Subject: ${activity.subject}`,
    `Date: ${date}`,
  ];
  if (activity.subject_type && activity.subject_id) {
    lines.push(`CRM Object: ${activity.subject_type} (${activity.subject_id})`);
  }
  if (activity.outcome) lines.push(`Outcome: ${activity.outcome}`);
  lines.push('', 'Content:', content);
  return lines.join('\n');
}

function buildActivityContent(activity: ActivityRow): string {
  const parts: string[] = [];
  if (activity.body) parts.push(activity.body);
  if (activity.detail && Object.keys(activity.detail).length > 0) {
    const relevant = Object.entries(activity.detail)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    if (relevant.length > 0) parts.push(relevant.join('\n'));
  }
  return parts.join('\n\n');
}

// ── Sync (non-streaming) LLM calls ───────────────────────────────────────────

async function callAnthropicSync(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  baseUrl: string,
  apiKey: string,
  maxTokens: number,
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
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json() as { content: { type: string; text: string }[] };
  return data.content?.find(c => c.type === 'text')?.text ?? '';
}

async function callOpenAICompatSync(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  baseUrl: string,
  apiKey: string,
  maxTokens: number,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' }, // supported by OpenAI/OpenRouter
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

// ── Response parser ───────────────────────────────────────────────────────────

function parseExtractionResponse(raw: string): ExtractedEntry[] {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try extracting JSON from the response if it's wrapped in text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  if (!parsed || typeof parsed !== 'object') return [];
  const entries = (parsed as Record<string, unknown>).context_entries;
  if (!Array.isArray(entries)) return [];

  return entries.filter((e): e is ExtractedEntry => (
    e !== null &&
    typeof e === 'object' &&
    typeof (e as ExtractedEntry).context_type === 'string' &&
    typeof (e as ExtractedEntry).title === 'string' &&
    typeof (e as ExtractedEntry).body === 'string'
  ));
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function markExtractionStatus(
  db: DbPool,
  activityId: string,
  status: 'pending' | 'done' | 'skipped' | 'error',
  error?: string,
): Promise<void> {
  await db.query(
    `UPDATE activities SET extraction_status = $1, extraction_error = $2 WHERE id = $3`,
    [status, error ?? null, activityId],
  );
}
