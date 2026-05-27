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
import type { UUID } from '@crmy/shared';
import * as agentRepo from '../db/repos/agent.js';
import * as contextRepo from '../db/repos/context-entries.js';
import * as contextTypeRepo from '../db/repos/context-type-registry.js';
import * as actorRepo from '../db/repos/actors.js';
import * as outboxRepo from '../db/repos/context-outbox.js';
import * as rawContextRepo from '../db/repos/raw-context-sources.js';
import * as customFieldRepo from '../db/repos/custom-fields.js';
import * as signalGroupRepo from '../db/repos/signal-groups.js';
import { decrypt } from './crypto.js';
import { callLLM } from './providers/llm.js';
import { attachSignalToGroup } from '../services/signal-groups.js';
import { embedQuery, ensureEmbeddingBestEffort } from '../services/embedding-service.js';

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
  supports_existing_signal_group_hint?: string;
  contradicts_existing_memory_hint?: string;
  duplicate_of_memory_hint?: string;
  extraction_rationale?: string;
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
  skipped_reasons?: string[];
  unsupported_context_types?: string[];
}

const EMPTY_EXTRACTION_RESULT: ExtractionResult = {
  extracted_count: 0,
  memory_created: 0,
  signals_created: 0,
  skipped: 0,
};

const CONTEXT_TYPE_ALIASES: Record<string, string> = {
  action_item: 'next_step',
  follow_up: 'next_step',
  followup: 'next_step',
  next_action: 'next_step',
  risk: 'deal_risk',
  blocker: 'deal_risk',
  forecast_risk: 'deal_risk',
  stakeholder_role: 'stakeholder',
  buyer_role: 'stakeholder',
  champion: 'stakeholder',
  economic_buyer: 'stakeholder',
  competitor: 'competitive_intel',
  competitive: 'competitive_intel',
  concern: 'objection',
  pain_point: 'objection',
  fact: 'key_fact',
  insight: 'key_fact',
};

interface ExtractionPacketRecordSummary {
  type: string;
  id: string;
  name: string;
  fields: Record<string, unknown>;
  custom_fields?: Record<string, unknown>;
}

interface ExtractionPacketMemorySummary {
  id: string;
  context_type: string;
  title: string;
  body: string;
  confidence?: number | null;
  valid_until?: string | null;
  created_at?: string;
  evidence_count?: number;
}

interface ExtractionPacketSignalSummary extends ExtractionPacketMemorySummary {
  memory_status?: string;
}

interface ContextExtractionPacket {
  objective: string;
  source: {
    activity_id: string;
    activity_type: string;
    source_label: string;
    occurred_at: string;
    actor_id?: string | null;
    source_agent?: string | null;
    channel?: string | null;
  };
  subject: ExtractionPacketRecordSummary;
  related_records: ExtractionPacketRecordSummary[];
  current_memory: ExtractionPacketMemorySummary[];
  open_signals: ExtractionPacketSignalSummary[];
  existing_signal_groups: Array<{
    id: string;
    context_type: string;
    claim: string;
    status: string;
    aggregate_confidence: number;
    evidence_count: number;
    source_count: number;
    conflict_count: number;
  }>;
  custom_field_definitions: Array<{
    object_type: string;
    field_key: string;
    label: string;
    field_type: string;
    required: boolean;
    options?: unknown;
    current_value?: unknown;
  }>;
  extractable_context_types: Array<{
    type_name: string;
    label: string;
    description?: string | null;
    extraction_prompt?: string | null;
    schema?: Record<string, unknown> | null;
  }>;
}

function normalizeTypeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function resolveExtractedContextType(
  value: string,
  extractableTypes: { type_name: string; label: string }[],
): { typeName?: string; normalized: boolean } {
  const supported = new Set(extractableTypes.map(type => type.type_name));
  if (supported.has(value)) return { typeName: value, normalized: false };

  const normalized = normalizeTypeName(value);
  if (supported.has(normalized)) return { typeName: normalized, normalized: true };

  const alias = CONTEXT_TYPE_ALIASES[normalized];
  if (alias && supported.has(alias)) return { typeName: alias, normalized: true };

  const labelMatch = extractableTypes.find(type => normalizeTypeName(type.label) === normalized);
  if (labelMatch) return { typeName: labelMatch.type_name, normalized: true };

  if (supported.has('key_fact')) return { typeName: 'key_fact', normalized: true };
  return { normalized: false };
}

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

function truncateText(value: unknown, max = 800): unknown {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function compactJsonObject(value: unknown, maxStringLength = 500): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== null && item !== undefined && item !== '')
      .slice(0, 30)
      .map(([key, item]) => [key, truncateText(item, maxStringLength)]),
  );
}

function recordSummary(type: string, row: Record<string, unknown>): ExtractionPacketRecordSummary {
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  const name = String(row.name ?? fullName ?? row.subject ?? row.email ?? row.id);
  const fields = { ...row };
  delete fields.tenant_id;
  delete fields.created_by;
  delete fields.created_at;
  delete fields.updated_at;
  const customFields = compactJsonObject(fields.custom_fields);
  delete fields.custom_fields;
  return {
    type,
    id: String(row.id),
    name,
    fields: compactJsonObject(fields, 400),
    ...(Object.keys(customFields).length > 0 ? { custom_fields: customFields } : {}),
  };
}

function memorySummary(entry: Record<string, unknown>): ExtractionPacketMemorySummary {
  const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
  return {
    id: String(entry.id),
    context_type: String(entry.context_type),
    title: String(entry.title ?? ''),
    body: String(truncateText(entry.body, 600) ?? ''),
    confidence: typeof entry.confidence === 'number' ? entry.confidence : null,
    valid_until: typeof entry.valid_until === 'string' ? entry.valid_until : null,
    created_at: typeof entry.created_at === 'string' ? entry.created_at : undefined,
    evidence_count: evidence.length,
  };
}

async function semanticContextCandidates(
  db: DbPool,
  tenantId: string,
  activity: ActivityRow,
  memoryStatus: 'active' | 'signal',
): Promise<Array<Record<string, unknown>>> {
  if (!supportedSubjectType(activity.subject_type) || !activity.subject_id || !activity.body?.trim()) return [];
  try {
    const embedded = await embedQuery(activity.body.slice(0, 4000));
    if (!embedded) return [];
    const entries = await contextRepo.semanticSearch(db, tenantId as UUID, embedded.embedding, {
      subject_type: activity.subject_type,
      subject_id: activity.subject_id as UUID,
      memory_status: memoryStatus,
      current_only: true,
      limit: 8,
    });
    return entries as unknown as Array<Record<string, unknown>>;
  } catch (err) {
    console.warn(`[extraction] semantic packet candidates unavailable: ${(err as Error).message}`);
    return [];
  }
}

function mergeEntries<T extends { id?: unknown }>(primary: T[], candidates: T[], limit: number): T[] {
  const seen = new Set(primary.map(entry => String(entry.id ?? '')));
  const merged = [...primary];
  for (const candidate of candidates) {
    const id = String(candidate.id ?? '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push(candidate);
    if (merged.length >= limit) break;
  }
  return merged.slice(0, limit);
}

function supportedSubjectType(value: string | null): value is 'contact' | 'account' | 'opportunity' | 'use_case' {
  return value === 'contact' || value === 'account' || value === 'opportunity' || value === 'use_case';
}

async function loadSubjectSummary(
  db: DbPool,
  tenantId: string,
  subjectType: string,
  subjectId: string,
): Promise<ExtractionPacketRecordSummary | null> {
  const queries: Record<string, string> = {
    contact: `
      SELECT c.*, a.name AS account_name, a.domain AS account_domain
      FROM contacts c
      LEFT JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.id = $2
    `,
    account: `SELECT * FROM accounts WHERE tenant_id = $1 AND id = $2`,
    opportunity: `
      SELECT o.*, a.name AS account_name, c.first_name || ' ' || c.last_name AS contact_name, c.email AS contact_email
      FROM opportunities o
      LEFT JOIN accounts a ON a.id = o.account_id AND a.tenant_id = o.tenant_id
      LEFT JOIN contacts c ON c.id = o.contact_id AND c.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1 AND o.id = $2
    `,
    use_case: `
      SELECT uc.*, a.name AS account_name, o.name AS opportunity_name
      FROM use_cases uc
      LEFT JOIN accounts a ON a.id = uc.account_id AND a.tenant_id = uc.tenant_id
      LEFT JOIN opportunities o ON o.id = uc.opportunity_id AND o.tenant_id = uc.tenant_id
      WHERE uc.tenant_id = $1 AND uc.id = $2
    `,
  };
  const sql = queries[subjectType];
  if (!sql) return null;
  const result = await db.query(sql, [tenantId, subjectId]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? recordSummary(subjectType, row) : null;
}

async function loadRelatedRecords(
  db: DbPool,
  tenantId: string,
  subjectType: string,
  subjectId: string,
): Promise<ExtractionPacketRecordSummary[]> {
  const related: ExtractionPacketRecordSummary[] = [];
  const pushRows = (type: string, rows: Record<string, unknown>[]) => {
    related.push(...rows.slice(0, 8).map(row => recordSummary(type, row)));
  };

  if (subjectType === 'contact') {
    const account = await db.query(
      `SELECT a.* FROM accounts a
       JOIN contacts c ON c.account_id = a.id AND c.tenant_id = a.tenant_id
       WHERE c.tenant_id = $1 AND c.id = $2`,
      [tenantId, subjectId],
    );
    pushRows('account', account.rows as Record<string, unknown>[]);
    const opps = await db.query(
      `SELECT o.*, a.name AS account_name
       FROM opportunities o
       LEFT JOIN accounts a ON a.id = o.account_id AND a.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1 AND (o.contact_id = $2 OR o.account_id IN (
         SELECT account_id FROM contacts WHERE tenant_id = $1 AND id = $2 AND account_id IS NOT NULL
       ))
       ORDER BY o.updated_at DESC
       LIMIT 8`,
      [tenantId, subjectId],
    );
    pushRows('opportunity', opps.rows as Record<string, unknown>[]);
  } else if (subjectType === 'account') {
    const contacts = await db.query(
      `SELECT * FROM contacts WHERE tenant_id = $1 AND account_id = $2 ORDER BY updated_at DESC LIMIT 8`,
      [tenantId, subjectId],
    );
    pushRows('contact', contacts.rows as Record<string, unknown>[]);
    const opps = await db.query(
      `SELECT * FROM opportunities WHERE tenant_id = $1 AND account_id = $2 ORDER BY updated_at DESC LIMIT 8`,
      [tenantId, subjectId],
    );
    pushRows('opportunity', opps.rows as Record<string, unknown>[]);
    const useCases = await db.query(
      `SELECT * FROM use_cases WHERE tenant_id = $1 AND account_id = $2 ORDER BY updated_at DESC LIMIT 8`,
      [tenantId, subjectId],
    );
    pushRows('use_case', useCases.rows as Record<string, unknown>[]);
  } else if (subjectType === 'opportunity') {
    const rows = await db.query(
      `SELECT 'account' AS relation_type, to_jsonb(a.*) AS record
       FROM opportunities o
       JOIN accounts a ON a.id = o.account_id AND a.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1 AND o.id = $2
       UNION ALL
       SELECT 'contact' AS relation_type, to_jsonb(c.*) AS record
       FROM opportunities o
       JOIN contacts c ON c.id = o.contact_id AND c.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1 AND o.id = $2`,
      [tenantId, subjectId],
    );
    for (const row of rows.rows as { relation_type: string; record: Record<string, unknown> }[]) {
      related.push(recordSummary(row.relation_type, row.record));
    }
    const useCases = await db.query(
      `SELECT * FROM use_cases WHERE tenant_id = $1 AND opportunity_id = $2 ORDER BY updated_at DESC LIMIT 8`,
      [tenantId, subjectId],
    );
    pushRows('use_case', useCases.rows as Record<string, unknown>[]);
  } else if (subjectType === 'use_case') {
    const rows = await db.query(
      `SELECT 'account' AS relation_type, to_jsonb(a.*) AS record
       FROM use_cases uc
       JOIN accounts a ON a.id = uc.account_id AND a.tenant_id = uc.tenant_id
       WHERE uc.tenant_id = $1 AND uc.id = $2
       UNION ALL
       SELECT 'opportunity' AS relation_type, to_jsonb(o.*) AS record
       FROM use_cases uc
       JOIN opportunities o ON o.id = uc.opportunity_id AND o.tenant_id = uc.tenant_id
       WHERE uc.tenant_id = $1 AND uc.id = $2`,
      [tenantId, subjectId],
    );
    for (const row of rows.rows as { relation_type: string; record: Record<string, unknown> }[]) {
      related.push(recordSummary(row.relation_type, row.record));
    }
  }

  const seen = new Set<string>();
  return related.filter(record => {
    const key = `${record.type}:${record.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return key !== `${subjectType}:${subjectId}`;
  }).slice(0, 16);
}

async function buildContextExtractionPacket(
  db: DbPool,
  tenantId: string,
  activity: ActivityRow,
  extractableTypes: { type_name: string; label: string; description?: string | null; extraction_prompt: string | null; json_schema: Record<string, unknown> | null }[],
): Promise<ContextExtractionPacket | null> {
  if (!supportedSubjectType(activity.subject_type) || !activity.subject_id) return null;
  const subject = await loadSubjectSummary(db, tenantId, activity.subject_type, activity.subject_id);
  if (!subject) return null;

  const [relatedRecords, currentMemory, openSignals, signalGroups, customFields] = await Promise.all([
    loadRelatedRecords(db, tenantId, activity.subject_type, activity.subject_id),
    contextRepo.getContextForSubject(db, tenantId, activity.subject_type, activity.subject_id, {
      memory_status: 'active',
      current_only: true,
      limit: 12,
    }),
    contextRepo.getContextForSubject(db, tenantId, activity.subject_type, activity.subject_id, {
      memory_status: 'signal',
      current_only: true,
      limit: 12,
    }),
    signalGroupRepo.listSignalGroups(db, tenantId, {
      subject_type: activity.subject_type,
      subject_id: activity.subject_id,
      limit: 10,
    }),
    customFieldRepo.listCustomFields(db, tenantId, activity.subject_type),
  ]);
  const [semanticMemory, semanticSignals] = await Promise.all([
    semanticContextCandidates(db, tenantId, activity, 'active'),
    semanticContextCandidates(db, tenantId, activity, 'signal'),
  ]);
  const memoryForPacket = mergeEntries(
    currentMemory as unknown as Array<Record<string, unknown>>,
    semanticMemory,
    12,
  );
  const signalsForPacket = mergeEntries(
    openSignals as unknown as Array<Record<string, unknown>>,
    semanticSignals,
    12,
  );

  const currentValues = subject.custom_fields ?? {};
  return {
    objective: 'Turn messy Raw Context into evidence-backed Signals. CRMy will group Signals, promote trustworthy Signals to Memory, and enforce policy before any action or system-of-record writeback.',
    source: {
      activity_id: activity.id,
      activity_type: activity.type,
      source_label: activity.subject,
      occurred_at: activity.occurred_at ?? activity.created_at,
      actor_id: activity.performed_by ?? activity.created_by,
      source_agent: activity.source_agent,
      channel: activity.direction,
    },
    subject,
    related_records: relatedRecords,
    current_memory: memoryForPacket.map(entry => memorySummary(entry)),
    open_signals: signalsForPacket.map(entry => ({
      ...memorySummary(entry as unknown as Record<string, unknown>),
      memory_status: 'signal',
    })),
    existing_signal_groups: signalGroups.data.map(group => ({
      id: group.id,
      context_type: group.context_type,
      claim: group.title ?? group.normalized_claim,
      status: group.status,
      aggregate_confidence: Number(group.aggregate_confidence ?? 0),
      evidence_count: Number(group.evidence_count ?? 0),
      source_count: Number(group.independent_source_count ?? 0),
      conflict_count: Number(group.conflict_count ?? 0),
    })),
    custom_field_definitions: customFields.map(field => ({
      object_type: field.object_type,
      field_key: field.field_key,
      label: field.label,
      field_type: field.field_type,
      required: field.is_required,
      options: field.options,
      current_value: truncateText(currentValues[field.field_key], 400),
    })),
    extractable_context_types: extractableTypes.map(type => ({
      type_name: type.type_name,
      label: type.label,
      description: type.description,
      extraction_prompt: type.extraction_prompt,
      schema: type.json_schema,
    })),
  };
}

function summarizeExtractionPacket(packet: ContextExtractionPacket | null): Record<string, unknown> {
  if (!packet) return { available: false };
  return {
    available: true,
    subject: { type: packet.subject.type, id: packet.subject.id, name: packet.subject.name },
    related_record_count: packet.related_records.length,
    current_memory_count: packet.current_memory.length,
    open_signal_count: packet.open_signals.length,
    signal_group_count: packet.existing_signal_groups.length,
    custom_field_count: packet.custom_field_definitions.length,
    context_type_count: packet.extractable_context_types.length,
  };
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
      metadata: { failure_code: 'no_linked_subject' },
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
      metadata: { failure_code: 'no_text_content' },
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
      metadata: { failure_code: 'unsupported_activity_type', activity_type: activity.type },
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
      metadata: { failure_code: 'agent_not_enabled' },
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
      metadata: { failure_code: 'agent_config_incomplete' },
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
      metadata: { failure_code: 'no_extractable_context_types' },
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
  const extractionPacket = await buildContextExtractionPacket(db, tenantId, activity, extractableTypes);

  // Build and call the LLM
  let entries: ExtractedEntry[];
  try {
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'processing',
      stage: 'extract_signals',
      metadata: { extraction_packet: summarizeExtractionPacket(extractionPacket) },
    });
    entries = await callExtractionLLM(db, tenantId, activity, content, extractableTypes, config.max_tokens_per_turn, extractionPacket);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'LLM call failed';
    await markExtractionStatus(db, activityId, 'error', msg);
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'failed',
      stage: 'extract_signals',
      skipped: 1,
      failure_reason: msg,
      metadata: {
        failure_code: 'model_failed',
        extraction_packet: summarizeExtractionPacket(extractionPacket),
      },
    });
    console.error(`[extraction] Activity ${activityId}: ${msg}`);
    return { ...EMPTY_EXTRACTION_RESULT, skipped: 1 };
  }

  if (entries.length === 0) {
    await markExtractionStatus(db, activityId, 'done');
    await rawContextRepo.updateRawContextSource(db, tenantId, rawSourceType, activity.id, {
      status: 'processed',
      stage: 'extract_signals',
      failure_reason: 'No customer-specific Signals were found. Try adding source text with a decision, next step, risk, stakeholder, objection, commitment, or customer fact.',
      metadata: {
        extracted_count: 0,
        failure_code: 'model_returned_empty',
        extraction_packet: summarizeExtractionPacket(extractionPacket),
      },
    });
    return EMPTY_EXTRACTION_RESULT;
  }

  // Write context entries
  const outcome: ExtractionResult = { ...EMPTY_EXTRACTION_RESULT };
  const autoPromoteSignals = config.auto_promote_signals !== false;
  const autoPromoteThreshold = Number(config.signal_auto_promote_threshold ?? 0.85);
  for (const entry of entries) {
    try {
      const resolvedType = resolveExtractedContextType(entry.context_type, extractableTypes);
      if (!resolvedType.typeName) {
        outcome.skipped++;
        outcome.unsupported_context_types = Array.from(new Set([...(outcome.unsupported_context_types ?? []), entry.context_type]));
        outcome.skipped_reasons = [...(outcome.skipped_reasons ?? []), `Unsupported context type: ${entry.context_type}`];
        continue;
      }
      const normalizedEntry = {
        ...entry,
        context_type: resolvedType.typeName,
        tags: [
          ...(entry.tags ?? []),
          ...(resolvedType.normalized ? [`normalized-type:${normalizeTypeName(entry.context_type)}`] : []),
          ...(entry.supports_existing_signal_group_hint ? ['supports-existing-signal'] : []),
          ...(entry.contradicts_existing_memory_hint ? ['contradicts-memory'] : []),
          ...(entry.duplicate_of_memory_hint ? ['possible-duplicate'] : []),
        ],
        structured_data: {
          ...(entry.structured_data ?? {}),
          ...(resolvedType.normalized ? { original_context_type: entry.context_type } : {}),
          ...(entry.supports_existing_signal_group_hint ? { supports_existing_signal_group_hint: entry.supports_existing_signal_group_hint } : {}),
          ...(entry.contradicts_existing_memory_hint ? { contradicts_existing_memory_hint: entry.contradicts_existing_memory_hint } : {}),
          ...(entry.duplicate_of_memory_hint ? { duplicate_of_memory_hint: entry.duplicate_of_memory_hint } : {}),
          ...(entry.extraction_rationale ? { extraction_rationale: entry.extraction_rationale } : {}),
        },
      };
      const evidence = buildEvidence(activity, normalizedEntry);
      const created = await contextRepo.createContextEntry(db, tenantId, {
        subject_type: activity.subject_type as 'contact' | 'account' | 'opportunity' | 'use_case',
        subject_id: activity.subject_id,
        context_type: normalizedEntry.context_type,
        authored_by: extractorActor.id,
        title: normalizedEntry.title,
        body: normalizedEntry.body,
        structured_data: normalizedEntry.structured_data ?? {},
        confidence: normalizedEntry.confidence ?? undefined,
        memory_status: 'signal',
        evidence,
        tags: normalizedEntry.tags && normalizedEntry.tags.length > 0
          ? Array.from(new Set(['extracted', activity.type, ...normalizedEntry.tags]))
          : ['extracted', activity.type],
        source: 'extraction',
        source_ref: activityId,
        source_activity_id: activityId,
        valid_until: normalizedEntry.valid_until ?? undefined,
        is_current: true,
      });

      // Enqueue for search indexing — fire-and-forget.
      outboxRepo.insertJob(db, tenantId, 'context_entry', created.id, created as unknown as Record<string, unknown>)
        .catch((err: unknown) => console.warn(`[outbox] extraction enqueue ${created.id}: ${(err as Error).message}`));
      await ensureEmbeddingBestEffort(db, tenantId, 'context_entry', created.id, created.body);

      outcome.extracted_count++;
      outcome.signals_created++;

      const eligibleForGroupingPromotion = autoPromoteSignals && shouldAutoPromoteSignal({
        confidence: Math.max(normalizedEntry.confidence ?? 0, 1),
        threshold: 1,
        evidenceCount: evidence.length,
        speculative: looksSpeculative(normalizedEntry, evidence),
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
      outcome.skipped_reasons = [
        ...(outcome.skipped_reasons ?? []),
        err instanceof Error ? err.message : 'Failed to write extracted Signal.',
      ];
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
    failure_reason: outcome.extracted_count === 0 && outcome.skipped_reasons?.length
      ? outcome.skipped_reasons.slice(0, 3).join('; ')
      : null,
    metadata: {
      extracted_count: outcome.extracted_count,
      extraction_packet: summarizeExtractionPacket(extractionPacket),
      ...(outcome.skipped_reasons?.length ? { skipped_reasons: outcome.skipped_reasons.slice(0, 10) } : {}),
      ...(outcome.unsupported_context_types?.length ? { unsupported_context_types: outcome.unsupported_context_types } : {}),
      ...(outcome.unsupported_context_types?.length ? { failure_code: 'unsupported_type_normalized' } : {}),
      ...(outcome.extracted_count === 0 && outcome.skipped > 0 ? { failure_code: 'write_failed' } : {}),
    },
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
  extractionPacket: ContextExtractionPacket | null,
): Promise<ExtractedEntry[]> {
  const systemPrompt = buildSystemPrompt(extractableTypes);
  const userPrompt = buildUserPrompt(activity, content, extractionPacket);

  const responseText = await callLLM(db, tenantId, {
    system: systemPrompt,
    user: userPrompt,
    maxTokens: Math.min(maxTokens, 2000),
  });

  const primaryEntries = parseExtractionResponse(responseText);
  if (primaryEntries.length > 0) return primaryEntries;

  const recoveryText = await callLLM(db, tenantId, {
    system: buildRecoverySystemPrompt(extractableTypes),
    user: userPrompt,
    maxTokens: Math.min(maxTokens, 1200),
  });
  return parseExtractionResponse(recoveryText);
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

  return `You are the CRMy Raw Context extraction model.

Your job is to transform messy customer Raw Context into evidence-backed Signals that CRMy can group, review, and possibly promote to Memory. You do not call tools. CRMy already resolved the subject record, assembled related records, loaded current Memory, loaded open Signals, and provided custom field definitions in the extraction packet.

Signals are unconfirmed inferred context. Memory is confirmed operational context that agents, workflows, handoffs, and system-of-record writebacks may rely on after CRMy policy allows it.

Return a JSON object with a single key "context_entries" containing an array of signals. Each signal:
- context_type: must be one of the supported types below
- title: concise title (required, ≤ 80 chars)
- body: the claim being made, written as a concise but complete operational statement (required)
- confidence: 0.0–1.0 — how clearly stated this information is (0.9+ = explicitly stated, 0.5–0.8 = inferred, <0.5 = speculative)
- structured_data: object with type-specific fields (see schemas below)
- evidence: array of evidence objects supporting this claim. Each item should include source_type, snippet, observed_at, speaker if known, confidence, and rationale. Use an exact short quote or source excerpt when possible.
- valid_until: ISO date string if this information will become stale (use for next_step, commitment, deal_risk)
- tags: array of relevant string tags (optional)
- supports_existing_signal_group_hint: signal group id or claim when the Raw Context supports an existing open Signal (optional)
- contradicts_existing_memory_hint: memory id or title when the Raw Context contradicts existing Memory (optional)
- duplicate_of_memory_hint: memory id or title when the Raw Context only repeats existing Memory (optional)
- extraction_rationale: short explanation of why this is useful GTM context (optional)

Rules:
1. Only extract information clearly present in the activity — never hallucinate or speculate
2. Set confidence below 0.7 if you're inferring rather than reading directly
3. Treat extracted items as signals. Do not imply that they are confirmed memory.
4. Prefer useful GTM claims: stakeholders, economic buyers, champions, risks, blockers, commitments, next steps, objections, competitive intel, methodology gaps, product/customer facts, timing, and customer intent
5. Avoid duplicating current Memory. Extract a repeated claim only if this source updates it, contradicts it, increases evidence quality, or provides materially new evidence.
6. Strengthen or contradict existing open Signals when the new source supports or conflicts with them. Use the advisory hint fields when helpful.
7. Create one entry per distinct piece of information (e.g. one entry per stakeholder, one per competitor)
8. Every extracted signal must include evidence. Prefer verbatim snippets and include speaker/source timing when the text provides it.
9. If nothing customer-specific and operationally useful is found, return {"context_entries": []}
10. Return valid JSON only — no markdown code fences, no commentary

Supported context types:
${typeDescriptions}`;
}

function buildRecoverySystemPrompt(
  types: { type_name: string; label: string; description?: string | null; extraction_prompt: string | null; json_schema: Record<string, unknown> | null }[],
): string {
  const supported = types.map(type => `${type.type_name}: ${type.label}`).join('\n');
  const hasKeyFact = types.some(type => type.type_name === 'key_fact');
  return `You are the CRMy Raw Context extraction model. Your previous extraction found no Signals.

Review the same extraction packet and Raw Context again. If it contains any customer-specific information that could help a sales or customer-success agent later, extract it as evidence-backed Signals. Do not produce generic summaries.

Use the most specific supported context_type. If none fits${hasKeyFact ? ', use key_fact' : ''}. Do not create generic summaries of the whole document. Do not extract the mere fact that a contact or company was mentioned.

Return valid JSON only:
{"context_entries":[{"context_type":"key_fact","title":"...","body":"...","confidence":0.7,"structured_data":{},"evidence":[{"source_type":"activity","snippet":"exact short excerpt","confidence":0.7,"rationale":"why this supports the claim"}],"tags":["extracted"]}]}

If there is truly no useful customer context beyond names, return {"context_entries":[]}.

Supported context types:
${supported}`;
}

function buildUserPrompt(activity: ActivityRow, content: string, extractionPacket: ContextExtractionPacket | null): string {
  const date = activity.occurred_at ?? activity.created_at;
  const lines = [
    'Objective: Create evidence-backed Signals from this Raw Context. CRMy will handle grouping, promotion to Memory, policy, and audit after extraction.',
    `Activity Type: ${activity.type}`,
    `Subject: ${activity.subject}`,
    `Date: ${date}`,
  ];
  if (activity.subject_type && activity.subject_id) {
    lines.push(`CRM Object: ${activity.subject_type} (${activity.subject_id})`);
  }
  if (activity.outcome) lines.push(`Outcome: ${activity.outcome}`);
  if (extractionPacket) {
    lines.push(
      '',
      'Context Extraction Packet:',
      JSON.stringify(extractionPacket, null, 2),
    );
  }
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
