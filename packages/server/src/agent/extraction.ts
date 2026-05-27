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
 *   - memory_status = 'signal' until reviewed/promoted into confirmed memory
 */

import type { DbPool } from '../db/pool.js';
import * as agentRepo from '../db/repos/agent.js';
import * as contextRepo from '../db/repos/context-entries.js';
import * as contextTypeRepo from '../db/repos/context-type-registry.js';
import * as actorRepo from '../db/repos/actors.js';
import * as outboxRepo from '../db/repos/context-outbox.js';
import * as rawContextRepo from '../db/repos/raw-context-sources.js';
import { decrypt } from './crypto.js';
import { callLLM } from './providers/llm.js';
import { attachSignalToGroup } from '../services/signal-groups.js';

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
  performed_by: string | null;
  direction: string | null;
  source_agent: string | null;
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
  evidence?: EvidenceItem[];
}

interface EvidenceItem {
  source_type: string;
  source_id?: string;
  source_ref?: string;
  source_url?: string;
  source_label?: string;
  speaker?: string;
  snippet?: string;
  observed_at?: string;
  captured_at?: string;
  confidence?: number;
  rationale?: string;
  verified_at?: string;
  verified_by?: string;
  [key: string]: unknown;
}

export interface ExtractionResult {
  extracted_count: number;
  memory_created: number;
  signals_created: number;
  skipped: number;
}

const EMPTY_EXTRACTION_RESULT: ExtractionResult = {
  extracted_count: 0,
  memory_created: 0,
  signals_created: 0,
  skipped: 0,
};

export function shouldAutoPromoteSignal(input: {
  confidence?: number;
  threshold: number;
  evidenceCount: number;
  speculative?: boolean;
}): boolean {
  return input.evidenceCount > 0 && !input.speculative && (input.confidence ?? 0) >= input.threshold;
}

function looksSpeculative(entry: ExtractedEntry, evidence: EvidenceItem[]): boolean {
  const text = [
    entry.title,
    entry.body,
    ...evidence.map(item => item.rationale),
  ].filter(Boolean).join(' ').toLowerCase();
  return /\b(may|might|could|appears|seems|possibly|probably|likely|unclear|unknown|not sure|inferred|speculative)\b/.test(text);
}

function normalizeEvidenceItem(
  item: Record<string, unknown>,
  activity: ActivityRow,
  entry: ExtractedEntry,
): EvidenceItem {
  const observedAt = activity.occurred_at ?? activity.created_at;
  const sourceType = typeof item.source_type === 'string' && item.source_type.trim()
    ? item.source_type.trim()
    : 'activity';
  const snippet = typeof item.snippet === 'string' && item.snippet.trim()
    ? item.snippet.trim().slice(0, 5000)
    : undefined;
  return {
    ...item,
    source_type: sourceType,
    source_id: typeof item.source_id === 'string' ? item.source_id : activity.id,
    source_ref: typeof item.source_ref === 'string' ? item.source_ref : activity.id,
    source_label: typeof item.source_label === 'string' ? item.source_label : activity.subject,
    observed_at: observedAt,
    captured_at: new Date().toISOString(),
    confidence: entry.confidence ?? null,
    ...(typeof item.speaker === 'string' ? { speaker: item.speaker } : {}),
    ...(snippet ? { snippet } : {}),
    ...(typeof item.rationale === 'string' ? { rationale: item.rationale.slice(0, 2000) } : {}),
  } as EvidenceItem;
}

function buildEvidence(activity: ActivityRow, entry: ExtractedEntry): EvidenceItem[] {
  if (Array.isArray(entry.evidence) && entry.evidence.length > 0) {
    return entry.evidence
      .filter(item => item && typeof item === 'object')
      .map(item => normalizeEvidenceItem(item as Record<string, unknown>, activity, entry))
      .filter(item => Boolean(item.source_id || item.source_ref || item.source_url || item.snippet));
  }

  const observedAt = activity.occurred_at ?? activity.created_at;
  const snippetSource = activity.body || entry.body || activity.subject;
  return [normalizeEvidenceItem({
    source_type: 'activity',
    source_id: activity.id,
    source_ref: activity.id,
    source_label: activity.subject,
    observed_at: observedAt,
    snippet: snippetSource.slice(0, 1000),
    rationale: 'Extracted from the source activity.',
  }, activity, entry)];
}

function rawSourceTypeForActivity(activity: ActivityRow): string {
  const subject = String(activity.subject ?? '').toLowerCase();
  if (activity.source_agent === 'context_ingest' || subject.includes('ingested document') || subject.includes('auto-ingested')) {
    return 'add_context';
  }
  if (activity.type === 'email' && activity.direction === 'inbound') return 'inbound_email';
  if (activity.type === 'email') return 'outbound_email';
  return 'activity';
}

function rawExcerpt(activity: ActivityRow): string | null {
  const text = buildActivityContent(activity).trim();
  if (!text) return null;
  return text.slice(0, 1000);
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

  // auto_extract_context defaults to true when the column is absent (pre-migration)
  const autoExtract = config?.auto_extract_context !== false;
  if (!autoExtract) {
    await markExtractionStatus(db, activityId, 'skipped', 'auto_extract_context disabled');
    return;
  }

  if (!config?.enabled || !config.model || !config.base_url) {
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
): Promise<ExtractionResult> {
  // Load activity
  const actResult = await db.query(
    `SELECT id, tenant_id, type, subject, body, outcome, occurred_at, created_at,
            subject_type, subject_id, created_by, performed_by, direction, source_agent, detail
     FROM activities
     WHERE id = $1 AND tenant_id = $2`,
    [activityId, tenantId],
  );
  const activity = actResult.rows[0] as ActivityRow | undefined;
  if (!activity) {
    await markExtractionStatus(db, activityId, 'skipped', 'Activity not found');
    return { ...EMPTY_EXTRACTION_RESULT, skipped: 1 };
  }

  const rawSourceType = rawSourceTypeForActivity(activity);
  await rawContextRepo.upsertRawContextSource(db, tenantId, {
    source_type: rawSourceType,
    source_ref: activity.id,
    source_label: activity.subject,
    subject_type: activity.subject_type ?? undefined,
    subject_id: activity.subject_id ?? undefined,
    actor_id: activity.performed_by ?? undefined,
    status: 'processing',
    stage: 'resolve_subject',
    raw_excerpt: rawExcerpt(activity),
    metadata: {
      activity_type: activity.type,
      direction: activity.direction,
      occurred_at: activity.occurred_at ?? activity.created_at,
    },
  });

  // Reject activities without an explicit CRM subject — falling back to
  // activity.id as subject_id would create orphaned context entries that
  // cannot be associated with any contact, account, opportunity, or use case.
  if (!activity.subject_type || !activity.subject_id) {
    await markExtractionStatus(db, activityId, 'skipped', 'Activity has no subject_type or subject_id — cannot create context entries');
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'skipped',
      stage: 'resolve_subject',
      skipped: 1,
      failure_reason: 'No linked customer record. Resolve the subject before extraction.',
    });
    return { ...EMPTY_EXTRACTION_RESULT, skipped: 1 };
  }

  // Skip activities without meaningful text
  const content = buildActivityContent(activity);
  if (!content.trim()) {
    await markExtractionStatus(db, activityId, 'skipped', 'No text content');
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'skipped',
      stage: 'normalize',
      skipped: 1,
      failure_reason: 'No text content to process.',
    });
    return { ...EMPTY_EXTRACTION_RESULT, skipped: 1 };
  }

  // Skip non-extractable activity types
  if (!EXTRACTABLE_ACTIVITY_TYPES.has(activity.type)) {
    await markExtractionStatus(db, activityId, 'skipped', `Activity type '${activity.type}' not extractable`);
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'skipped',
      stage: 'classify',
      skipped: 1,
      failure_reason: `Activity type '${activity.type}' is not configured for extraction.`,
    });
    return { ...EMPTY_EXTRACTION_RESULT, skipped: 1 };
  }

  // Load agent config
  const config = await agentRepo.getConfig(db, tenantId);
  // api_key_enc may legitimately be null for providers that don't require a key (Ollama, custom).
  // callLLM handles keyless providers correctly — only gate on enabled flag.
  if (!config?.enabled) {
    await markExtractionStatus(db, activityId, 'pending', 'Agent not enabled');
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'pending',
      stage: 'extract_signals',
      failure_reason: 'Workspace Agent is not enabled yet.',
    });
    return EMPTY_EXTRACTION_RESULT;
  }
  // Still need a model and base_url to proceed
  if (!config.model || !config.base_url) {
    await markExtractionStatus(db, activityId, 'pending', 'Agent not fully configured (missing model or base_url)');
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'pending',
      stage: 'extract_signals',
      failure_reason: 'Workspace Agent needs a model and base URL before extraction can run.',
    });
    return EMPTY_EXTRACTION_RESULT;
  }

  // Load extractable context types
  const extractableTypes = await contextTypeRepo.getExtractableTypes(db, tenantId);
  if (extractableTypes.length === 0) {
    await markExtractionStatus(db, activityId, 'skipped', 'No extractable context types defined');
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'skipped',
      stage: 'classify',
      skipped: 1,
      failure_reason: 'No extractable context types are configured.',
    });
    return { ...EMPTY_EXTRACTION_RESULT, skipped: 1 };
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
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'processing',
      stage: 'extract_signals',
    });
    entries = await callExtractionLLM(db, tenantId, activity, content, extractableTypes, config.max_tokens_per_turn);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'LLM call failed';
    await markExtractionStatus(db, activityId, 'error', msg);
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'failed',
      stage: 'extract_signals',
      skipped: 1,
      failure_reason: msg,
    });
    console.error(`[extraction] Activity ${activityId}: ${msg}`);
    return { ...EMPTY_EXTRACTION_RESULT, skipped: 1 };
  }

  if (entries.length === 0) {
    await markExtractionStatus(db, activityId, 'done');
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'processed',
      stage: 'extract_signals',
      metadata: { extracted_count: 0 },
    });
    return EMPTY_EXTRACTION_RESULT;
  }

  // Write context entries
  const outcome: ExtractionResult = { ...EMPTY_EXTRACTION_RESULT };
  const autoPromoteSignals = config.auto_promote_signals !== false;
  const autoPromoteThreshold = Number(config.signal_auto_promote_threshold ?? 0.85);
  for (const entry of entries) {
    // Skip if context_type doesn't exist in registry
    const typeExists = extractableTypes.find(t => t.type_name === entry.context_type);
    if (!typeExists) { outcome.skipped++; continue; }

    try {
      const evidence = buildEvidence(activity, entry);
      const created = await contextRepo.createContextEntry(db, tenantId, {
        subject_type: activity.subject_type as 'contact' | 'account' | 'opportunity' | 'use_case',
        subject_id: activity.subject_id,
        context_type: entry.context_type,
        authored_by: extractorActor.id,
        title: entry.title,
        body: entry.body,
        structured_data: entry.structured_data ?? {},
        confidence: entry.confidence ?? undefined,
        memory_status: 'signal',
        evidence,
        tags: entry.tags ?? ['extracted', activity.type],
        source: 'extraction',
        source_ref: activityId,
        source_activity_id: activityId,
        valid_until: entry.valid_until ?? undefined,
        is_current: true,
      });

      // Enqueue for search indexing — fire-and-forget.
      outboxRepo.insertJob(db, tenantId, 'context_entry', created.id, created as unknown as Record<string, unknown>)
        .catch((err: unknown) => console.warn(`[outbox] extraction enqueue ${created.id}: ${(err as Error).message}`));

      outcome.extracted_count++;
      outcome.signals_created++;

      const eligibleForGroupingPromotion = autoPromoteSignals && shouldAutoPromoteSignal({
        confidence: Math.max(entry.confidence ?? 0, 1),
        threshold: 1,
        evidenceCount: evidence.length,
        speculative: looksSpeculative(entry, evidence),
      });
      const groupResult = await attachSignalToGroup(db, tenantId, created, {
        threshold: autoPromoteThreshold,
        autoPromote: eligibleForGroupingPromotion,
        actorId: extractorActor.id,
      });
      if (groupResult.promoted_context_entry) {
        outcome.memory_created++;
        outcome.signals_created--;
      }
    } catch (err) {
      console.error(`[extraction] Failed to write context entry for activity ${activityId}:`, err);
      outcome.skipped++;
    }
  }

  await markExtractionStatus(db, activityId, 'done');
  await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
    status: outcome.skipped > 0 && outcome.extracted_count === 0
      ? 'skipped'
      : outcome.signals_created > 0
        ? 'needs_review'
        : 'processed',
    stage: 'promote_or_review',
    signals_created: outcome.signals_created,
    memory_created: outcome.memory_created,
    skipped: outcome.skipped,
    metadata: { extracted_count: outcome.extracted_count },
  });
  return outcome;
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

  if (result.rows.length === 0) return;

  // Process concurrently — extraction is LLM I/O bound, so parallel calls
  // reduce total latency from O(n × latency) to O(max_latency).
  // allSettled ensures one failure doesn't abort the rest of the batch.
  const outcomes = await Promise.allSettled(
    (result.rows as { tenant_id: string; id: string }[]).map(row =>
      extractContextFromActivity(db, row.tenant_id, row.id),
    ),
  );

  const failed = outcomes.filter(o => o.status === 'rejected');
  if (failed.length > 0) {
    console.error(
      `[extraction] ${failed.length}/${outcomes.length} activities failed:`,
      failed.map(f => (f as PromiseRejectedResult).reason?.message ?? f),
    );
  }
}

// ── LLM caller ────────────────────────────────────────────────────────────────

async function callExtractionLLM(
  db: DbPool,
  tenantId: string,
  activity: ActivityRow,
  content: string,
  extractableTypes: { type_name: string; label: string; description?: string | null; extraction_prompt: string | null; json_schema: Record<string, unknown> | null }[],
  maxTokens: number,
): Promise<ExtractedEntry[]> {
  const systemPrompt = buildSystemPrompt(extractableTypes);
  const userPrompt = buildUserPrompt(activity, content);

  const responseText = await callLLM(db, tenantId, {
    system: systemPrompt,
    user: userPrompt,
    maxTokens: Math.min(maxTokens, 2000),
  });

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

  return `You are a CRMy signal extraction agent. Extract structured signals from customer observations.

Signals are inferred, evidence-backed context. They are not confirmed operational memory until reviewed or promoted.

Return a JSON object with a single key "context_entries" containing an array of signals. Each signal:
- context_type: must be one of the supported types below
- title: concise title (required, ≤ 80 chars)
- body: the claim being made, written as a concise but complete operational statement (required)
- confidence: 0.0–1.0 — how clearly stated this information is (0.9+ = explicitly stated, 0.5–0.8 = inferred, <0.5 = speculative)
- structured_data: object with type-specific fields (see schemas below)
- evidence: array of evidence objects supporting this claim. Each item should include source_type, snippet, observed_at, speaker if known, confidence, and rationale. Use an exact short quote or source excerpt when possible.
- valid_until: ISO date string if this information will become stale (use for next_step, commitment, deal_risk)
- tags: array of relevant string tags (optional)

Rules:
1. Only extract information clearly present in the activity — never hallucinate or speculate
2. Set confidence below 0.7 if you're inferring rather than reading directly
3. Treat extracted items as signals. Do not imply that they are confirmed memory.
4. If nothing extractable is found, return {"context_entries": []}
5. Create one entry per distinct piece of information (e.g. one entry per stakeholder, one per competitor)
6. Every extracted signal must include evidence. Prefer verbatim snippets and include speaker/source timing when the text provides it.
7. Return valid JSON only — no markdown code fences, no commentary

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
    if (!match) throw new Error('Extraction response was not valid JSON.');
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new Error('Extraction response contained malformed JSON.');
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Extraction response was empty or invalid.');
  }
  const entries = (parsed as Record<string, unknown>).context_entries;
  if (!Array.isArray(entries)) {
    throw new Error('Extraction response must include a context_entries array.');
  }

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
