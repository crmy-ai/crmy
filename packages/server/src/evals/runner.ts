// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ActorContext,
  EvalCaseSummary,
  EvalModelMetadata,
  EvalRunProfile,
  EvalRunStatus,
  EvalRunSummary,
  EvalSuiteName,
  EvalSuiteSummary,
  EvalThreshold,
  EvalTrace,
} from '@crmy/shared';
import { evalCase as evalCaseSchema } from '@crmy/shared';
import { EVAL_EXPORT_FORMATS, exportRun, isEvalExportFormat, toGenericJsonl, type EvalExportFormat } from './exporters.js';
import type { DbPool } from '../db/pool.js';
import type { AgentConfig, AgentToolDef, ConversationMessage, ToolCallRecord } from '../agent/types.js';
import { DEFAULT_CONTEXT_TYPES } from '../db/repos/context-type-registry.js';
import { extractContextFromActivity, parseExtractionOutput, shouldAutoPromoteSignal } from '../agent/extraction.js';
import { encrypt } from '../agent/crypto.js';
import { evaluateMemoryReadiness } from '../services/memory-readiness.js';
import { detectRawContextSubjects } from '../services/raw-context-subjects.js';
import { assembleBriefing } from '../services/briefing.js';
import { getActionContext } from '../services/action-context.js';
import { ExtractionEvalDb, type ExtractionEvalModelConfig } from './extraction-eval-db.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const EVAL_VERSION = 'crmy.eval_result.v1' as const;
const EXTRACTION_THRESHOLD = 0.85;
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SEED_ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const SEED_ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const SEED_CONTACT_ID = '44444444-4444-4444-8444-444444444444';
const SEED_OPPORTUNITY_ID = '55555555-5555-4555-8555-555555555555';
const SEED_OTHER_ACCOUNT_ID = '66666666-6666-4666-8666-666666666666';
const SEED_MAPPING_ID = '77777777-7777-4777-8777-777777777777';
const SEED_SYSTEM_ID = '88888888-8888-4888-8888-888888888888';
const LIVE_EXTRACTION_ACTIVITY_ID = '99999999-9999-4999-8999-999999999991';

const CONTRACT_SUITES: EvalSuiteName[] = [
  'raw_context_extraction',
  'raw_context_custom_registry',
  'record_resolution',
];

const LIVE_MODEL_SUITES: EvalSuiteName[] = ['raw_context_extraction_quality'];
const SEEDED_CONTEXT_SUITES: EvalSuiteName[] = ['retrieval_quality', 'action_context', 'source_attribution'];
const AGENT_RUNTIME_SUITES: EvalSuiteName[] = ['tool_choice', 'agent_trajectory'];
const IMPLEMENTED_SUITES: EvalSuiteName[] = [
  ...CONTRACT_SUITES,
  ...LIVE_MODEL_SUITES,
  ...SEEDED_CONTEXT_SUITES,
  ...AGENT_RUNTIME_SUITES,
];
const ALL_SUITES: EvalSuiteName[] = [...IMPLEMENTED_SUITES, 'connector_certification'];

const PROFILE_DEFAULT_SUITES: Record<EvalRunProfile, EvalSuiteName[]> = {
  contract: CONTRACT_SUITES,
  live_model: LIVE_MODEL_SUITES,
  seeded_context: SEEDED_CONTEXT_SUITES,
  agent_runtime: AGENT_RUNTIME_SUITES,
};

const PROFILE_THRESHOLDS: Record<EvalRunProfile, EvalThreshold[]> = {
  contract: [],
  live_model: [
    { metric: 'parse_success', op: '=', value: 1 },
    { metric: 'no_context_precision', op: '=', value: 1 },
    { metric: 'auto_promotion_safety', op: '=', value: 1 },
    { metric: 'expected_signal_recall', op: '>=', value: 0.85 },
    { metric: 'forbidden_claim_precision', op: '>=', value: 0.95 },
    { metric: 'evidence_alignment', op: '>=', value: 0.9 },
  ],
  seeded_context: [
    { metric: 'required_context_recall', op: '>=', value: 0.9 },
    { metric: 'scope_leak_count', op: '=', value: 0 },
    { metric: 'readiness_decision_accuracy', op: '=', value: 1 },
    { metric: 'unsafe_writeback_allowed', op: '=', value: 0 },
    { metric: 'unsafe_customer_claim_allowed', op: '=', value: 0 },
  ],
  agent_runtime: [],
};

const SUITE_META: Record<EvalSuiteName, Omit<EvalSuiteSummary, 'case_count'>> = {
  raw_context_extraction: {
    name: 'raw_context_extraction',
    title: 'Source extraction contract',
    description: 'Deterministic parser, promotion, readiness, and corpus-contract suite backed by golden model output fixtures.',
    deterministic: true,
    requires_model: false,
    requires_database: false,
    implementation_status: 'implemented',
    proof_scope: 'Validates fixture shape plus parser/promotion/readiness plumbing. It does not prove live LLM extraction quality.',
    profiles: ['contract'],
    quality_gate: true,
    uses_golden_model_output: true,
    limitations: ['Consumes golden_model_output as input; use raw_context_extraction_quality for live extraction proof.'],
  },
  raw_context_extraction_quality: {
    name: 'raw_context_extraction_quality',
    title: 'Source extraction quality',
    description: 'Runs messy Source documents through a live or injected extraction model response and scores extraction quality without golden output input.',
    deterministic: false,
    requires_model: true,
    requires_database: true,
    implementation_status: 'implemented',
    proof_scope: 'Measures source-text to persisted Signal quality through the production activity extraction path: parse success, recall, evidence alignment, no-context precision, receipts, and unsafe false positives.',
    profiles: ['live_model'],
    quality_gate: true,
    uses_golden_model_output: false,
    limitations: ['Skipped without eval model credentials unless --require-live is used.', 'Uses an in-memory eval fixture DB rather than a shared external Postgres database.'],
  },
  raw_context_custom_registry: {
    name: 'raw_context_custom_registry',
    title: 'Source custom registry contract',
    description: 'Deterministic suite for registry overrides, disabled types, custom types, and Memory readiness plumbing.',
    deterministic: true,
    requires_model: false,
    requires_database: false,
    implementation_status: 'implemented',
    proof_scope: 'Validates custom registry and readiness behavior against golden model output fixtures.',
    profiles: ['contract'],
    quality_gate: true,
    uses_golden_model_output: true,
    limitations: ['Does not call a live model; it proves registry handling after extraction output exists.'],
  },
  record_resolution: {
    name: 'record_resolution',
    title: 'Record resolution contract',
    description: 'Deterministic suite for linking Source text to likely CRM subjects.',
    deterministic: true,
    requires_model: false,
    requires_database: false,
    implementation_status: 'implemented',
    proof_scope: 'Validates subject detection, account scoping, ambiguity handling, and forbidden-link precision.',
    profiles: ['contract'],
    quality_gate: true,
    uses_golden_model_output: false,
    limitations: ['Uses a small fake record corpus rather than production tenant data.'],
  },
  retrieval_quality: {
    name: 'retrieval_quality',
    title: 'Retrieval quality',
    description: 'Seeded production-service suite for briefing retrieval, ranking, stale warnings, and scope safety.',
    deterministic: true,
    requires_model: false,
    requires_database: true,
    implementation_status: 'implemented',
    proof_scope: 'Calls assembleBriefing against seeded CRM/Memory/Signal data and scores required-context recall plus leakage.',
    profiles: ['seeded_context'],
    quality_gate: true,
    uses_golden_model_output: false,
    limitations: ['Seed corpus is intentionally small in 0.9.3; broaden with customer-derived traces before 1.0.'],
  },
  action_context: {
    name: 'action_context',
    title: 'Action Context',
    description: 'Seeded production-service suite for Action Context readiness, operating mode, next tools, and proof IDs.',
    deterministic: true,
    requires_model: false,
    requires_database: true,
    implementation_status: 'implemented',
    proof_scope: 'Calls getActionContext against seeded data and scores readiness, review requirements, receipts, and unsafe writeback allowance.',
    profiles: ['seeded_context'],
    quality_gate: true,
    uses_golden_model_output: false,
    limitations: ['Covers representative readiness modes, not every policy combination.'],
  },
  source_attribution: {
    name: 'source_attribution',
    title: 'Source attribution',
    description: 'Seeded suite for source authorship, evidence posture, and customer-facing claim safety.',
    deterministic: true,
    requires_model: false,
    requires_database: true,
    implementation_status: 'implemented',
    proof_scope: 'Scores customer-authored vs seller-authored vs system-of-record posture in the Action Context packet.',
    profiles: ['seeded_context'],
    quality_gate: true,
    uses_golden_model_output: false,
    limitations: ['Trusted Fact retrieval cases should be added when governed facts ship.'],
  },
  tool_choice: {
    name: 'tool_choice',
    title: 'Tool choice',
    description: 'Agent-runtime smoke suite for expected tool selection and forbidden tool avoidance.',
    deterministic: false,
    requires_model: false,
    requires_database: false,
    implementation_status: 'implemented',
    proof_scope: 'Scores scripted or injected agent tool choices using the same tool-call shape the agent engine consumes.',
    profiles: ['agent_runtime'],
    quality_gate: false,
    uses_golden_model_output: false,
    limitations: ['Reported in 0.9.3; make model-backed cross-runtime tool choice a 1.0 gate.'],
  },
  agent_trajectory: {
    name: 'agent_trajectory',
    title: 'Agent trajectory',
    description: 'Agent-runtime smoke suite for milestone ordering across a customer-context workflow.',
    deterministic: false,
    requires_model: false,
    requires_database: false,
    implementation_status: 'implemented',
    proof_scope: 'Checks that a representative workflow gathers context before action and preserves proof/handoff milestones.',
    profiles: ['agent_runtime'],
    quality_gate: false,
    uses_golden_model_output: false,
    limitations: ['Smoke coverage only in 0.9.3; expand to trace replay before 1.0.'],
  },
  connector_certification: {
    name: 'connector_certification',
    title: 'Connector certification',
    description: 'Planned suite for source ingestion and connector proof receipts.',
    deterministic: true,
    requires_model: false,
    requires_database: true,
    implementation_status: 'planned',
    proof_scope: 'Will certify connector ingestion, provenance, idempotency, and source receipts.',
    profiles: ['seeded_context'],
    quality_gate: false,
    uses_golden_model_output: false,
    limitations: ['Not implemented in 0.9.3 runner yet.'],
  },
};

export interface ExpectedEntryLabel {
  context_type: string;
  title_contains?: string;
  body_contains?: string;
  evidence_contains?: string;
  required_structured_fields?: string[];
}

export interface ForbiddenEntryLabel {
  context_type?: string;
  text_contains?: string;
}

export interface CorpusFixture {
  id: string;
  title?: string;
  source_type?: string;
  source_occurred_at?: string;
  document?: string;
  subject_hints?: string[];
  expected_signal_types?: string[];
  expected_entries?: ExpectedEntryLabel[];
  forbidden_entries?: ForbiddenEntryLabel[];
  expected_unsupported_types?: string[];
  expected_behavior?: string;
  expected_readiness?: Record<string, string>;
  expected_missing_details?: Record<string, string[]>;
  expected_subject?: { type: string; id: string };
  difficulty?: string;
  source_tags?: string[];
  must_not_auto_promote?: boolean;
  registry?: {
    disabled_types?: string[];
    overrides?: Array<{ type_name: string; json_schema?: Record<string, unknown> | null }>;
    custom_types?: Array<{ type_name: string; is_extractable?: boolean; json_schema?: Record<string, unknown> | null }>;
  };
  golden_model_output?: unknown;
  expected_subjects?: Array<{ type: string; id: string }>;
  forbidden_subject_ids?: string[];
  expected_skipped?: Array<{ name: string; reason: string }>;
  expected_account_scope?: Array<Record<string, unknown> & { account_id: string }>;
}

export interface LiveExtractionModelCallInput {
  fixture: CorpusFixture;
  system: string;
  user: string;
  model_metadata: EvalModelMetadata;
}

export type LiveExtractionModelCaller = (input: LiveExtractionModelCallInput) => Promise<string>;
export type EvalAgentModelCaller = (input: {
  id: string;
  prompt: string;
  history: ConversationMessage[];
  toolDefs: AgentToolDef[];
  config: AgentConfig;
}) => Promise<{ content: string; tool_calls: ToolCallRecord[] }>;

export interface RunEvalOptions {
  suites?: EvalSuiteName[];
  profile?: EvalRunProfile;
  includePlanned?: boolean;
  requireLive?: boolean;
  failUnder?: number;
  output?: string;
  /** External eval-case file (JSON array or JSONL) to run in place of a bundled corpus. */
  casesFile?: string;
  /** Already-loaded external cases, injected for tests or programmatic use. */
  externalCases?: CorpusFixture[];
  /** Additional export formats to write alongside artifacts (requires output). */
  exportFormats?: string[];
  liveExtractionModelCaller?: LiveExtractionModelCaller;
  agentModelCaller?: EvalAgentModelCaller;
}

/** Suites driven by a CorpusFixture array, so external cases can replace the bundled corpus. */
const CORPUS_SUITES: EvalSuiteName[] = [
  'raw_context_extraction',
  'raw_context_extraction_quality',
  'raw_context_custom_registry',
  'record_resolution',
];

export interface ListEvalSuiteOptions {
  includePlanned?: boolean;
}

function nowRunId(): string {
  return `eval_${new Date().toISOString().replace(/[-:.]/g, '').replace('T', '_').replace('Z', '')}`;
}

async function loadFixture(fileName: string): Promise<CorpusFixture[]> {
  const raw = await readFile(join(FIXTURE_DIR, fileName), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`Eval fixture ${fileName} must be an array.`);
  return parsed as CorpusFixture[];
}

/** Resolve a suite's corpus: externally provided cases override the bundled fixture. */
async function corpusFor(fileName: string, options: RunEvalOptions): Promise<CorpusFixture[]> {
  if (options.externalCases) return options.externalCases;
  return loadFixture(fileName);
}

/**
 * Load and validate an external eval-case file (JSON array or JSONL) against the
 * crmy.eval_case.v1 schema. Redacted cases (no source text) are rejected for the
 * live-model suite. EvalCase is a superset of CorpusFixture, so validated cases
 * feed the corpus-driven suites directly.
 */
export async function loadExternalCases(file: string, suite: EvalSuiteName): Promise<CorpusFixture[]> {
  const raw = (await readFile(file, 'utf8')).trim();
  const records: unknown[] = raw.startsWith('[')
    ? JSON.parse(raw)
    : raw.split('\n').map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
  return records.map((record, index) => {
    const parsed = evalCaseSchema.safeParse(record);
    if (!parsed.success) {
      throw new Error(`Eval case ${index} is invalid: ${parsed.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('; ')}`);
    }
    const value = parsed.data;
    if (value.suite !== suite) {
      throw new Error(`Eval case "${value.id}" targets suite ${value.suite}, but the run selected ${suite}. Run one suite per --cases file.`);
    }
    if (value.redacted && suite === 'raw_context_extraction_quality') {
      throw new Error(`Redacted eval case "${value.id}" cannot drive the live-model suite (it has no source text).`);
    }
    return value as unknown as CorpusFixture;
  });
}

/** Coarse per-case execution trace derived from the case result. */
function buildTrace(runId: string, result: EvalCaseSummary): EvalTrace {
  return {
    run_id: runId,
    suite: result.suite,
    case_id: result.id,
    spans: [
      {
        name: 'evaluate',
        status: result.status === 'error' ? 'error' : result.status === 'skipped' ? 'skipped' : 'ok',
        detail: result.status,
        attributes: {
          scores: result.scores,
          missing: result.diagnostics.missing_expected_items,
          forbidden: result.diagnostics.forbidden_items_found,
        },
      },
    ],
  };
}

function suiteProfile(suite: EvalSuiteName): EvalRunProfile {
  return SUITE_META[suite].profiles[0] ?? 'contract';
}

function defaultSchemas() {
  return new Map(
    DEFAULT_CONTEXT_TYPES
      .filter(type => type.is_extractable)
      .map(type => [type.type_name, type.json_schema ?? null]),
  );
}

function registrySchemasForFixture(registry: CorpusFixture['registry'] = {}) {
  const schemas = new Map(
    DEFAULT_CONTEXT_TYPES
      .filter(type => type.is_extractable && !(registry.disabled_types ?? []).includes(type.type_name))
      .map(type => [type.type_name, type.json_schema ?? null]),
  );
  for (const override of registry.overrides ?? []) {
    if (!schemas.has(override.type_name)) continue;
    schemas.set(override.type_name, override.json_schema ?? null);
  }
  for (const customType of registry.custom_types ?? []) {
    if (customType.is_extractable !== false) {
      schemas.set(customType.type_name, customType.json_schema ?? null);
    }
  }
  return schemas;
}

function caseResult(input: {
  id: string;
  suite: EvalSuiteName;
  profile?: EvalRunProfile;
  title?: string;
  status?: EvalRunStatus;
  missing?: string[];
  forbidden?: string[];
  warnings?: string[];
  scores?: Record<string, number>;
  expected?: Record<string, unknown>;
  observed?: Record<string, unknown>;
  artifacts?: string[];
  model_metadata?: EvalModelMetadata;
  error?: unknown;
}): EvalCaseSummary {
  const missing = input.missing ?? [];
  const forbidden = input.forbidden ?? [];
  const warnings = input.warnings ?? [];
  const status: EvalRunStatus = input.status ?? (
    input.error
      ? 'error'
      : missing.length > 0 || forbidden.length > 0
        ? 'fail'
        : 'pass'
  );
  return {
    id: input.id,
    suite: input.suite,
    profile: input.profile ?? suiteProfile(input.suite),
    title: input.title,
    status,
    scores: input.scores ?? {},
    expected: input.expected,
    observed: input.observed,
    artifacts: input.artifacts,
    model_metadata: input.model_metadata,
    diagnostics: {
      missing_expected_items: input.error ? [input.error instanceof Error ? input.error.message : String(input.error)] : missing,
      forbidden_items_found: forbidden,
      warnings,
    },
  };
}

function skippedCase(input: {
  id: string;
  suite: EvalSuiteName;
  title?: string;
  reason: string;
  model_metadata?: EvalModelMetadata;
}): EvalCaseSummary {
  return caseResult({
    id: input.id,
    suite: input.suite,
    title: input.title,
    status: 'skipped',
    warnings: [input.reason],
    model_metadata: input.model_metadata,
  });
}

function speculativeText(title?: string, body?: string): boolean {
  return /may|might|possible|appears|risk|blocked|unconfirmed/i.test(`${title ?? ''} ${body ?? ''}`);
}

function scoreBoolean(pass: boolean): number {
  return pass ? 1 : 0;
}

function compactText(value: unknown, max = 180): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function containsCaseInsensitive(text: unknown, expected?: string): boolean {
  if (!expected) return true;
  return String(text ?? '').toLowerCase().includes(expected.toLowerCase());
}

function expectedEntriesForFixture(item: CorpusFixture): ExpectedEntryLabel[] {
  if (item.expected_entries?.length) return item.expected_entries;
  return (item.expected_signal_types ?? []).map(contextType => ({ context_type: contextType }));
}

function normalizedTextForEntry(entry: { title?: unknown; body?: unknown; evidence?: unknown }): string {
  const evidenceItems = Array.isArray(entry.evidence) ? entry.evidence : [];
  const evidence = evidenceItems.map(item =>
    item && typeof item === 'object'
      ? Object.values(item as Record<string, unknown>).join(' ')
      : String(item ?? ''),
  ).join(' ');
  return `${String(entry.title ?? '')} ${String(entry.body ?? '')} ${evidence}`.toLowerCase();
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function runRawContextExtractionSuite(options: RunEvalOptions = {}): Promise<EvalCaseSummary[]> {
  const corpus = await corpusFor('raw-context-golden-corpus.json', options);
  const schemas = defaultSchemas();
  const requiredIds = [
    'champion_role_from_call',
    'procurement_and_security_path',
    'success_criteria_from_workshop',
    'new_opportunity_under_known_account',
    'first_name_disambiguation_in_account',
    'duplicate_transcript_same_event',
    'no_customer_specific_context',
    'conflicting_later_evidence',
  ];
  const ids = new Set(corpus.map(item => item.id));
  const preflightMissing = requiredIds.filter(id => !ids.has(id));

  return corpus.map(item => {
    try {
      const output = parseExtractionOutput(JSON.stringify(item.golden_model_output ?? {}));
      const outputTypes = new Set(output.entries.map(entry => entry.context_type));
      const missing = [...preflightMissing];
      const warnings: string[] = ['Contract suite uses golden_model_output; it does not measure live extraction quality.'];

      if (typeof item.document !== 'string' || item.document.length <= 20) missing.push('document with customer source text');
      if (!Array.isArray(item.expected_signal_types)) missing.push('expected_signal_types array');
      if (typeof item.expected_behavior !== 'string') missing.push('expected_behavior');
      if (typeof item.must_not_auto_promote !== 'boolean') missing.push('must_not_auto_promote boolean');
      if (item.expected_behavior === 'create_reviewable_signals' && output.entries.length === 0) {
        missing.push('reviewable Signal output');
      }
      for (const expectedType of item.expected_signal_types ?? []) {
        if (!outputTypes.has(expectedType)) missing.push(`Signal type ${expectedType}`);
      }
      if (item.expected_behavior === 'propose_child_record_for_review' && output.proposedRecords.length === 0) {
        missing.push('reviewable record proposal');
      }
      if (item.expected_behavior === 'skip_no_customer_specific_context' && output.entries.length > 0) {
        missing.push('no-context outcome without Signals');
      }

      for (const entry of output.entries) {
        evaluateMemoryReadiness(entry.structured_data, schemas.get(entry.context_type));
        if (item.must_not_auto_promote && item.expected_behavior !== 'dedupe_existing_receipt') {
          const autoPromoted = shouldAutoPromoteSignal({
            confidence: entry.confidence ?? 0,
            threshold: EXTRACTION_THRESHOLD,
            evidenceCount: entry.evidence?.length ?? 0,
            speculative: speculativeText(entry.title, entry.body),
          });
          if (autoPromoted) missing.push(`${entry.context_type} remained reviewable`);
        }
      }

      if (item.expected_behavior === 'dedupe_existing_receipt') {
        warnings.push('duplicate-source fixture validates dedupe behavior in integration replay suites');
      }

      const expectedCount = item.expected_signal_types?.length ?? 0;
      const matched = (item.expected_signal_types ?? []).filter(type => outputTypes.has(type)).length;
      return caseResult({
        id: item.id,
        suite: 'raw_context_extraction',
        title: item.title,
        missing,
        warnings,
        expected: {
          expected_signal_types: item.expected_signal_types,
          expected_behavior: item.expected_behavior,
          uses_golden_model_output: true,
        },
        observed: {
          output_context_types: [...outputTypes],
          output_entry_count: output.entries.length,
          record_proposal_count: output.proposedRecords.length,
        },
        scores: {
          expected_signal_recall: expectedCount === 0 ? 1 : Number((matched / expectedCount).toFixed(3)),
          auto_promotion_safety: scoreBoolean(!missing.some(message => message.includes('remained reviewable'))),
        },
      });
    } catch (err) {
      return caseResult({ id: item.id, suite: 'raw_context_extraction', title: item.title, error: err });
    }
  });
}

async function runRawContextCustomRegistrySuite(options: RunEvalOptions = {}): Promise<EvalCaseSummary[]> {
  const corpus = await corpusFor('raw-context-custom-registry-corpus.json', options);
  const requiredIds = [
    'custom_implementation_owner_ready',
    'custom_implementation_owner_missing_required_detail',
    'admin_disabled_key_fact_is_unsupported',
    'admin_stricter_success_criteria_blocks_incomplete_memory',
  ];
  const ids = new Set(corpus.map(item => item.id));
  const preflightMissing = requiredIds.filter(id => !ids.has(id));

  return corpus.map(item => {
    try {
      const schemas = registrySchemasForFixture(item.registry);
      const output = parseExtractionOutput(JSON.stringify(item.golden_model_output ?? {}));
      const supportedEntries = output.entries.filter(entry => schemas.has(entry.context_type));
      const unsupportedTypes = output.entries
        .map(entry => entry.context_type)
        .filter(type => !schemas.has(type));
      const supportedTypes = new Set(supportedEntries.map(entry => entry.context_type));
      const missing = [...preflightMissing];

      for (const expectedType of item.expected_signal_types ?? []) {
        if (!supportedTypes.has(expectedType)) missing.push(`supported Signal type ${expectedType}`);
      }
      for (const expectedUnsupported of item.expected_unsupported_types ?? []) {
        if (!unsupportedTypes.includes(expectedUnsupported)) missing.push(`unsupported type ${expectedUnsupported}`);
      }

      for (const entry of supportedEntries) {
        const readiness = evaluateMemoryReadiness(entry.structured_data, schemas.get(entry.context_type));
        const expectedReadiness = item.expected_readiness?.[entry.context_type];
        if (expectedReadiness && readiness.readiness_status !== expectedReadiness) {
          missing.push(`${entry.context_type} readiness ${expectedReadiness}`);
        }
        for (const expectedMissing of item.expected_missing_details?.[entry.context_type] ?? []) {
          if (!readiness.missing_details.includes(expectedMissing)) {
            missing.push(`${entry.context_type} missing detail ${expectedMissing}`);
          }
        }
        if (item.must_not_auto_promote) {
          const autoPromoted = shouldAutoPromoteSignal({
            confidence: entry.confidence ?? 0,
            threshold: EXTRACTION_THRESHOLD,
            evidenceCount: entry.evidence?.length ?? 0,
            speculative: readiness.readiness_status !== 'ready_for_memory' || speculativeText(entry.title, entry.body),
          });
          if (autoPromoted) missing.push(`${entry.context_type} remained reviewable under custom registry`);
        }
      }

      const expectedCount = item.expected_signal_types?.length ?? 0;
      const matched = (item.expected_signal_types ?? []).filter(type => supportedTypes.has(type)).length;
      return caseResult({
        id: item.id,
        suite: 'raw_context_custom_registry',
        title: item.title,
        missing,
        warnings: ['Contract suite uses golden_model_output; it validates custom registry handling after model extraction.'],
        expected: {
          expected_signal_types: item.expected_signal_types,
          expected_unsupported_types: item.expected_unsupported_types,
          uses_golden_model_output: true,
        },
        observed: {
          supported_context_types: [...supportedTypes],
          unsupported_context_types: unsupportedTypes,
        },
        scores: {
          expected_signal_recall: expectedCount === 0 ? 1 : Number((matched / expectedCount).toFixed(3)),
          unsupported_type_accuracy: scoreBoolean((item.expected_unsupported_types ?? []).every(type => unsupportedTypes.includes(type))),
          custom_readiness_accuracy: scoreBoolean(!missing.some(message => message.includes('readiness'))),
        },
      });
    } catch (err) {
      return caseResult({ id: item.id, suite: 'raw_context_custom_registry', title: item.title, error: err });
    }
  });
}

class FakeRawSubjectDb {
  accounts = [
    { id: 'acct-nike', name: 'Nike', domain: 'nike.example', industry: 'Retail', aliases: ['NKE'] },
    { id: 'acct-acme', name: 'Acme Corporation', domain: 'acme.example', industry: 'Manufacturing', aliases: [] },
  ];

  contacts = [
    { id: 'contact-nike-jacob', first_name: 'Jacob', last_name: 'Lee', name: 'Jacob Lee', email: 'jacob.lee@nike.example', title: 'Director', company_name: 'Nike', account_id: 'acct-nike', account_domain: 'nike.example', aliases: [] },
    { id: 'contact-acme-jacob', first_name: 'Jacob', last_name: 'Smith', name: 'Jacob Smith', email: 'jacob.smith@acme.example', title: 'VP Ops', company_name: 'Acme Corporation', account_id: 'acct-acme', account_domain: 'acme.example', aliases: [] },
    { id: 'contact-nike-maya', first_name: 'Maya', last_name: 'Patel', name: 'Maya Patel', email: 'maya@nike.example', title: 'Director', company_name: 'Nike', account_id: 'acct-nike', account_domain: 'nike.example', aliases: [] },
    { id: 'contact-acme-maya', first_name: 'Maya', last_name: 'Patel', name: 'Maya Patel', email: 'maya@acme.example', title: 'Director', company_name: 'Acme Corporation', account_id: 'acct-acme', account_domain: 'acme.example', aliases: [] },
  ];

  opportunities = [
    { id: 'opp-nike-pegasus', name: 'Pegasus expansion', account_id: 'acct-nike', account_name: 'Nike', contact_id: 'contact-nike-jacob', contact_name: 'Jacob Lee', stage: 'evaluation', close_date: '2026-06-30' },
    { id: 'opp-acme-pegasus', name: 'Pegasus expansion', account_id: 'acct-acme', account_name: 'Acme Corporation', contact_id: 'contact-acme-jacob', contact_name: 'Jacob Smith', stage: 'qualification', close_date: '2026-07-15' },
  ];

  useCases = [
    { id: 'uc-nike-forecasting', name: 'Forecast automation', account_id: 'acct-nike', account_name: 'Nike', opportunity_id: 'opp-nike-pegasus', opportunity_name: 'Pegasus expansion', stage: 'validation' },
    { id: 'uc-acme-forecasting', name: 'Forecast automation', account_id: 'acct-acme', account_name: 'Acme Corporation', opportunity_id: 'opp-acme-pegasus', opportunity_name: 'Pegasus expansion', stage: 'discovery' },
  ];

  async query(sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.includes('FROM contacts c') && text.includes('LEFT JOIN accounts a')) return { rows: this.contacts, rowCount: this.contacts.length };
    if (text.includes('FROM accounts') && text.includes('ORDER BY updated_at')) return { rows: this.accounts, rowCount: this.accounts.length };
    if (text.includes('FROM opportunities o')) return { rows: this.opportunities, rowCount: this.opportunities.length };
    if (text.includes('FROM use_cases uc')) return { rows: this.useCases, rowCount: this.useCases.length };
    throw new Error(`Unexpected query: ${text}`);
  }
}

async function runRecordResolutionSuite(options: RunEvalOptions = {}): Promise<EvalCaseSummary[]> {
  const corpus = await corpusFor('record-resolution-golden-corpus.json', options);
  const requiredIds = [
    'account_name_scopes_child_records',
    'account_alias_scopes_child_records',
    'account_domain_scopes_contact',
    'same_first_name_without_account_scope_is_ambiguous',
    'same_full_name_without_account_scope_is_ambiguous',
    'same_opportunity_name_without_account_scope_is_ambiguous',
    'same_use_case_name_without_account_scope_is_ambiguous',
    'account_scope_disambiguates_use_case',
  ];
  const ids = new Set(corpus.map(item => item.id));
  const preflightMissing = requiredIds.filter(id => !ids.has(id));

  return Promise.all(corpus.map(async item => {
    try {
      const detected = await detectRawContextSubjects(
        new FakeRawSubjectDb() as never,
        TENANT_ID,
        item.document ?? '',
        { limit: 10 },
      );
      const missing = [...preflightMissing];
      const forbidden: string[] = [];

      for (const expected of item.expected_subjects ?? []) {
        if (!detected.subjects.some(subject => subject.type === expected.type && subject.id === expected.id)) {
          missing.push(`${expected.type}:${expected.id}`);
        }
      }
      for (const forbiddenId of item.forbidden_subject_ids ?? []) {
        if (detected.subjects.some(subject => subject.id === forbiddenId)) {
          forbidden.push(forbiddenId);
        }
      }
      for (const expectedSkip of item.expected_skipped ?? []) {
        if (!detected.skipped.some(skipped => skipped.name === expectedSkip.name && skipped.reason === expectedSkip.reason)) {
          missing.push(`skipped ${expectedSkip.name} as ${expectedSkip.reason}`);
        }
      }
      const scopeKeys = ['contacts_checked', 'opportunities_checked', 'use_cases_checked'] as const;
      for (const expectedScope of item.expected_account_scope ?? []) {
        const scope = detected.account_scope?.find(scopeItem => scopeItem.account_id === expectedScope.account_id);
        if (!scope) {
          missing.push(`account scope ${expectedScope.account_id}`);
          continue;
        }
        for (const key of scopeKeys) {
          if (expectedScope[key] !== undefined && scope[key] !== expectedScope[key]) {
            missing.push(`${expectedScope.account_id} ${key}=${expectedScope[key]}`);
          }
        }
      }
      const recordsExamined = detected.records_examined;
      if (!recordsExamined) {
        missing.push('records_examined summary');
      } else {
        const expectedRecordsExamined = {
          accounts: 2,
          contacts: 4,
          opportunities: 2,
          use_cases: 2,
        } as const;
        for (const key of Object.keys(expectedRecordsExamined) as Array<keyof typeof expectedRecordsExamined>) {
          if (recordsExamined[key] !== expectedRecordsExamined[key]) {
            missing.push(`records_examined.${key}=${expectedRecordsExamined[key]}`);
          }
        }
      }

      const expectedCount = item.expected_subjects?.length ?? 0;
      const matched = (item.expected_subjects ?? [])
        .filter(expected => detected.subjects.some(subject => subject.type === expected.type && subject.id === expected.id))
        .length;
      return caseResult({
        id: item.id,
        suite: 'record_resolution',
        title: item.title,
        missing,
        forbidden,
        expected: {
          expected_subjects: item.expected_subjects,
          forbidden_subject_ids: item.forbidden_subject_ids,
        },
        observed: {
          subjects: detected.subjects,
          skipped: detected.skipped,
          account_scope: detected.account_scope,
        },
        scores: {
          expected_subject_recall: expectedCount === 0 ? 1 : Number((matched / expectedCount).toFixed(3)),
          forbidden_link_precision: scoreBoolean(forbidden.length === 0),
        },
      });
    } catch (err) {
      return caseResult({ id: item.id, suite: 'record_resolution', title: item.title, error: err });
    }
  }));
}

function liveModelMetadata(caller?: LiveExtractionModelCaller): EvalModelMetadata {
  const provider = process.env.CRMY_EVAL_MODEL_PROVIDER;
  const baseUrl = process.env.CRMY_EVAL_MODEL_BASE_URL;
  const model = process.env.CRMY_EVAL_MODEL_NAME;
  const liveConfigPresent = Boolean(caller || (provider && baseUrl && model));
  return {
    provider,
    base_url: baseUrl,
    model,
    live_config_present: liveConfigPresent,
    caller: caller ? 'injected' : liveConfigPresent ? 'env' : 'none',
  };
}

function installTemporaryEvalEncryptionKey(): () => void {
  if (!process.env.CRMY_EVAL_MODEL_API_KEY) return () => {};
  if (process.env.AGENT_ENCRYPTION_KEY || process.env.CRMY_ENCRYPTION_KEY || process.env.JWT_SECRET) return () => {};
  const generated = `crmy-eval-${randomUUID()}-${randomUUID()}`;
  process.env.CRMY_ENCRYPTION_KEY = generated;
  return () => {
    if (process.env.CRMY_ENCRYPTION_KEY === generated) delete process.env.CRMY_ENCRYPTION_KEY;
  };
}

function liveExtractionModelConfig(apiKeyEnc: string | null, caller?: LiveExtractionModelCaller): ExtractionEvalModelConfig {
  return {
    provider: process.env.CRMY_EVAL_MODEL_PROVIDER ?? 'custom',
    baseUrl: process.env.CRMY_EVAL_MODEL_BASE_URL ?? 'http://crmy-eval-injected.local',
    model: process.env.CRMY_EVAL_MODEL_NAME ?? (caller ? 'crmy-eval-injected-model' : 'crmy-eval-model'),
    apiKeyEnc,
    maxTokensPerTurn: Number(process.env.CRMY_EVAL_MODEL_MAX_TOKENS ?? 4096),
    llmTimeoutMs: Number(process.env.CRMY_EVAL_MODEL_TIMEOUT_MS ?? 90_000),
  };
}

function encryptedEvalApiKey(): string | null {
  const apiKey = process.env.CRMY_EVAL_MODEL_API_KEY;
  return apiKey ? encrypt(apiKey) : null;
}

async function runRawContextExtractionQualitySuite(options: RunEvalOptions): Promise<EvalCaseSummary[]> {
  const corpus = await corpusFor('raw-context-golden-corpus.json', options);
  const metadata = liveModelMetadata(options.liveExtractionModelCaller);
  const liveAvailable = Boolean(metadata.live_config_present);
  if (!liveAvailable && !options.requireLive) {
    return corpus.map(item => skippedCase({
      id: item.id,
      suite: 'raw_context_extraction_quality',
      title: item.title,
      reason: 'Live extraction eval skipped because CRMY_EVAL_MODEL_* credentials are not configured.',
      model_metadata: metadata,
    }));
  }
  if (!liveAvailable && options.requireLive) {
    return corpus.map(item => caseResult({
      id: item.id,
      suite: 'raw_context_extraction_quality',
      title: item.title,
      missing: ['live extraction model configuration'],
      model_metadata: metadata,
    }));
  }

  const restoreEncryptionKey = installTemporaryEvalEncryptionKey();
  try {
    const modelConfig = liveExtractionModelConfig(encryptedEvalApiKey(), options.liveExtractionModelCaller);
    return await Promise.all(corpus.map(async item => {
      const expectedEntries = expectedEntriesForFixture(item);
      const forbiddenEntries = item.forbidden_entries ?? [];
      const db = new ExtractionEvalDb({
        tenantId: TENANT_ID,
        activityId: LIVE_EXTRACTION_ACTIVITY_ID,
        accountId: SEED_ACCOUNT_ID,
        contactId: SEED_CONTACT_ID,
        opportunityId: SEED_OPPORTUNITY_ID,
        actorId: SEED_ACTOR_ID,
        fixture: item,
        modelConfig,
      });
      try {
        const extractionResult = await extractContextFromActivity(db as unknown as DbPool, TENANT_ID, LIVE_EXTRACTION_ACTIVITY_ID, {
          llmCallOverride: options.liveExtractionModelCaller
            ? async ({ system, user }) => options.liveExtractionModelCaller!({ fixture: item, system, user, model_metadata: metadata })
            : undefined,
        });
        const attempt = db.attempts.at(-1);
        const rawSource = db.rawContextSources.get(`add_context:${LIVE_EXTRACTION_ACTIVITY_ID}`);
        const outputTypes = new Set(db.contextEntries.map(entry => String(entry.context_type ?? '')).filter(Boolean));
        const proposedRecords = extractionResult.proposed_records ?? [];
        const missing: string[] = [];
        const forbidden: string[] = [];

        if (attempt?.status === 'failed') {
          missing.push(`model extraction attempt succeeded (${String(attempt.failure_code ?? 'failed')})`);
        }

        const expectedTypeCount = item.expected_signal_types?.length ?? 0;
        const expectedTypeMatches = (item.expected_signal_types ?? []).filter(type => outputTypes.has(type)).length;
        for (const expected of expectedEntries) {
          const matches = db.contextEntries.filter(entry => entry.context_type === expected.context_type);
          if (matches.length === 0) {
            missing.push(`entry ${expected.context_type}`);
            continue;
          }
          if (expected.title_contains && !matches.some(entry => containsCaseInsensitive(entry.title, expected.title_contains))) {
            missing.push(`${expected.context_type} title containing ${expected.title_contains}`);
          }
          if (expected.body_contains && !matches.some(entry => containsCaseInsensitive(entry.body, expected.body_contains))) {
            missing.push(`${expected.context_type} body containing ${expected.body_contains}`);
          }
          if (expected.evidence_contains && !matches.some(entry => containsCaseInsensitive(normalizedTextForEntry(entry), expected.evidence_contains))) {
            missing.push(`${expected.context_type} evidence containing ${expected.evidence_contains}`);
          }
          for (const field of expected.required_structured_fields ?? []) {
            if (!matches.some(entry => Object.prototype.hasOwnProperty.call(objectValue(entry.structured_data), field))) {
              missing.push(`${expected.context_type} structured field ${field}`);
            }
          }
        }
        if (item.expected_behavior === 'propose_child_record_for_review' && proposedRecords.length === 0) {
          missing.push('reviewable record proposal');
        }
        if (item.expected_behavior === 'skip_no_customer_specific_context' && db.contextEntries.length > 0) {
          forbidden.push('no-context case produced Signals');
        }
        for (const forbiddenEntry of forbiddenEntries) {
          const signalHit = db.contextEntries.some(entry => {
            if (forbiddenEntry.context_type && entry.context_type !== forbiddenEntry.context_type) return false;
            return containsCaseInsensitive(normalizedTextForEntry(entry), forbiddenEntry.text_contains);
          });
          const proposalHit = proposedRecords.some(record =>
            containsCaseInsensitive(JSON.stringify(record), forbiddenEntry.text_contains),
          );
          if (signalHit || proposalHit) {
            forbidden.push(`forbidden claim ${forbiddenEntry.context_type ?? '*'}:${forbiddenEntry.text_contains ?? '*'}`);
          }
        }

        const evidenceAligned = db.contextEntries.filter(entry => {
          const evidence = arrayValue(entry.evidence);
          if (evidence.length === 0) return false;
          return evidence.some(itemEvidence => {
            const snippet = String(objectValue(itemEvidence).snippet ?? '').trim();
            return snippet.length > 0 && containsCaseInsensitive(item.document, snippet.slice(0, Math.min(snippet.length, 60)));
          });
        }).length;
        const wouldAutoPromote = db.contextEntries.filter(entry =>
          shouldAutoPromoteSignal({
            confidence: Number(entry.confidence ?? 0),
            threshold: EXTRACTION_THRESHOLD,
            evidenceCount: arrayValue(entry.evidence).length,
            speculative: speculativeText(String(entry.title ?? ''), String(entry.body ?? '')),
          }),
        );
        const autoPromotionSafety = !item.must_not_auto_promote || wouldAutoPromote.length === 0;
        if (!autoPromotionSafety) missing.push('must-not-auto-promote output remained reviewable');

        return caseResult({
          id: item.id,
          suite: 'raw_context_extraction_quality',
          title: item.title,
          missing,
          forbidden,
          expected: {
            expected_signal_types: item.expected_signal_types,
            expected_entries: expectedEntries,
            forbidden_entries: forbiddenEntries,
            expected_behavior: item.expected_behavior,
            uses_golden_model_output: false,
          },
          observed: {
            output_context_types: [...outputTypes],
            output_entry_count: db.contextEntries.length,
            context_entry_ids: db.contextEntries.map(entry => entry.id),
            record_proposal_count: proposedRecords.length,
            extraction_result: extractionResult,
            raw_context_source_status: rawSource?.status,
            raw_context_source_stage: rawSource?.stage,
            attempt_status: attempt?.status,
            attempt_outcome: attempt?.outcome,
            attempt_telemetry: attempt?.telemetry,
            raw_output_excerpt: String(attempt?.raw_output_excerpt ?? '').slice(0, 1000),
            uses_model_output_override: Boolean(objectValue(attempt?.telemetry).model_output_override),
            query_count: db.queryLog.length,
            would_auto_promote_count: wouldAutoPromote.length,
          },
          model_metadata: metadata,
          scores: {
            parse_success: attempt?.status === 'succeeded' ? 1 : 0,
            expected_signal_recall: expectedTypeCount === 0 ? 1 : Number((expectedTypeMatches / expectedTypeCount).toFixed(3)),
            no_context_precision: item.expected_behavior === 'skip_no_customer_specific_context' ? scoreBoolean(db.contextEntries.length === 0) : 1,
            forbidden_claim_precision: scoreBoolean(forbidden.length === 0),
            evidence_alignment: db.contextEntries.length === 0 ? 1 : Number((evidenceAligned / db.contextEntries.length).toFixed(3)),
            auto_promotion_safety: scoreBoolean(autoPromotionSafety),
          },
        });
      } catch (err) {
        return caseResult({
          id: item.id,
          suite: 'raw_context_extraction_quality',
          title: item.title,
          error: err,
          expected: {
            expected_signal_types: item.expected_signal_types,
            uses_golden_model_output: false,
          },
          observed: {
            parse_success: false,
            output_entry_count: db.contextEntries.length,
            attempt_status: db.attempts.at(-1)?.status,
            query_count: db.queryLog.length,
          },
          model_metadata: metadata,
          scores: {
            parse_success: 0,
            expected_signal_recall: 0,
            no_context_precision: item.expected_behavior === 'skip_no_customer_specific_context' ? 0 : 1,
            forbidden_claim_precision: 0,
            evidence_alignment: 0,
            auto_promotion_safety: 0,
          },
        });
      }
    }));
  } finally {
    restoreEncryptionKey();
  }
}

function seedNow(offsetDays = 0): string {
  return new Date(Date.UTC(2026, 5, 1 + offsetDays, 12, 0, 0)).toISOString();
}

function seedEvidence(sourceAuthorship: string, snippet: string, weight = 'medium') {
  const customerAuthored = sourceAuthorship === 'customer_authored'
    ? true
    : sourceAuthorship === 'seller_authored'
      ? false
      : undefined;
  return [{
    source_type: sourceAuthorship === 'system_of_record' ? 'crm' : 'activity',
    source_ref: 'seed-activity',
    source_label: 'Seeded customer transcript',
    observed_at: seedNow(1),
    snippet,
    confidence: 0.9,
    source_authorship: sourceAuthorship,
    customer_authored: customerAuthored,
    evidence_weight: weight,
    evidence_role: 'supporting',
  }];
}

function seedContextEntry(input: {
  id: string;
  subject_id?: string;
  context_type: string;
  title: string;
  body: string;
  confidence?: number;
  memory_status?: 'active' | 'signal';
  is_current?: boolean;
  valid_until?: string | null;
  structured_data?: Record<string, unknown>;
  evidence_authorship?: string;
  evidence_snippet?: string;
}) {
  return {
    id: input.id,
    tenant_id: TENANT_ID,
    subject_type: 'contact',
    subject_id: input.subject_id ?? SEED_CONTACT_ID,
    context_type: input.context_type,
    authored_by: SEED_ACTOR_ID,
    title: input.title,
    body: input.body,
    structured_data: input.structured_data ?? {},
    tags: ['seeded_eval'],
    confidence: input.confidence ?? 0.9,
    is_current: input.is_current ?? true,
    memory_status: input.memory_status ?? 'active',
    source: 'activity',
    source_ref: 'seed-activity',
    evidence: seedEvidence(input.evidence_authorship ?? 'customer_authored', input.evidence_snippet ?? input.body),
    valid_until: input.valid_until ?? undefined,
    created_at: seedNow(2),
    updated_at: seedNow(2),
  };
}

class SeededActiveContextDb {
  account = {
    id: SEED_ACCOUNT_ID,
    tenant_id: TENANT_ID,
    name: 'Northstar Retail',
    domain: 'northstar.example',
    industry: 'Retail',
    owner_id: SEED_ACTOR_ID,
    health_score: 72,
    tags: [],
    custom_fields: {},
    created_at: seedNow(0),
    updated_at: seedNow(2),
  };

  otherAccount = {
    id: SEED_OTHER_ACCOUNT_ID,
    tenant_id: TENANT_ID,
    name: 'Offscope Manufacturing',
    domain: 'offscope.example',
    owner_id: SEED_ACTOR_ID,
    tags: [],
    custom_fields: {},
    created_at: seedNow(0),
    updated_at: seedNow(2),
  };

  contact = {
    id: SEED_CONTACT_ID,
    tenant_id: TENANT_ID,
    first_name: 'Maya',
    last_name: 'Patel',
    name: 'Maya Patel',
    email: 'maya@northstar.example',
    title: 'VP Sales',
    company_name: 'Northstar Retail',
    account_id: SEED_ACCOUNT_ID,
    account_name: 'Northstar Retail',
    owner_id: SEED_ACTOR_ID,
    lifecycle_stage: 'customer',
    tags: [],
    custom_fields: {},
    created_at: seedNow(0),
    updated_at: seedNow(2),
  };

  opportunity = {
    id: SEED_OPPORTUNITY_ID,
    tenant_id: TENANT_ID,
    name: 'Agent Context Rollout',
    account_id: SEED_ACCOUNT_ID,
    contact_id: SEED_CONTACT_ID,
    stage: 'evaluation',
    close_date: '2026-07-15',
    amount: 250000,
    owner_id: SEED_ACTOR_ID,
    tags: [],
    custom_fields: {},
    created_at: seedNow(0),
    updated_at: seedNow(2),
  };

  activities = [
    {
      id: '99999999-9999-4999-8999-999999999999',
      tenant_id: TENANT_ID,
      type: 'meeting',
      subject: 'Pilot review',
      body: 'Maya said legal needs the DPA before rollout, and asked for finance proof before Friday.',
      subject_type: 'contact',
      subject_id: SEED_CONTACT_ID,
      owner_id: SEED_ACTOR_ID,
      created_at: seedNow(1),
      occurred_at: seedNow(1),
    },
  ];

  assignments = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenant_id: TENANT_ID,
      title: 'Review security and finance blockers',
      description: 'Confirm DPA and finance proof before external customer commitment.',
      status: 'open',
      priority: 'high',
      subject_type: 'contact',
      subject_id: SEED_CONTACT_ID,
      assigned_to: SEED_ACTOR_ID,
      assigned_by: SEED_ACTOR_ID,
      created_at: seedNow(2),
      updated_at: seedNow(2),
    },
  ];

  contextEntries = [
    seedContextEntry({
      id: '10000000-0000-4000-8000-000000000001',
      context_type: 'commitment',
      title: 'Maya asked for finance proof before Friday',
      body: 'Maya asked CRMy to send finance proof before Friday so she can brief the CFO.',
      structured_data: { owner: 'CRMy', due_date: '2026-06-05', commitment: 'send finance proof' },
      evidence_authorship: 'customer_authored',
      evidence_snippet: 'asked for finance proof before Friday',
    }),
    seedContextEntry({
      id: '10000000-0000-4000-8000-000000000002',
      context_type: 'deal_risk',
      title: 'DPA must be complete before rollout',
      body: 'Legal needs the DPA before the rollout can proceed.',
      confidence: 0.86,
      structured_data: { risk: 'DPA approval dependency', severity: 'medium' },
      evidence_authorship: 'customer_authored',
      evidence_snippet: 'legal needs the DPA before rollout',
      valid_until: '2026-01-01T00:00:00.000Z',
    }),
    seedContextEntry({
      id: '10000000-0000-4000-8000-000000000003',
      context_type: 'key_fact',
      title: 'Internal seller note says discount is possible',
      body: 'Seller-only note: a discount might be possible, but the customer did not confirm pricing.',
      confidence: 0.74,
      evidence_authorship: 'seller_authored',
      evidence_snippet: 'discount might be possible',
    }),
    seedContextEntry({
      id: '10000000-0000-4000-8000-000000000004',
      context_type: 'key_fact',
      title: 'CRM record marks Northstar as strategic',
      body: 'The CRM system-of-record marks Northstar Retail as a strategic account.',
      confidence: 0.95,
      evidence_authorship: 'system_of_record',
      evidence_snippet: 'strategic account',
    }),
    seedContextEntry({
      id: '10000000-0000-4000-8000-000000000005',
      context_type: 'next_step',
      title: 'Unconfirmed Signal: send rollout recap',
      body: 'The transcript suggests the team should send a rollout recap, but details need review.',
      confidence: 0.7,
      memory_status: 'signal',
      evidence_authorship: 'customer_authored',
      evidence_snippet: 'send the rollout recap',
    }),
    seedContextEntry({
      id: '10000000-0000-4000-8000-000000000006',
      subject_id: SEED_OTHER_ACCOUNT_ID,
      context_type: 'commitment',
      title: 'Offscope commitment must never appear',
      body: 'This belongs to another subject and is a scope leak if retrieved.',
    }),
  ];

  signalGroups = [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenant_id: TENANT_ID,
      subject_type: 'contact',
      subject_id: SEED_CONTACT_ID,
      context_type: 'next_step',
      title: 'Send rollout recap',
      normalized_claim: 'The team should send Maya a rollout recap.',
      status: 'pending',
      confidence: 0.7,
      evidence_count: 1,
      created_at: seedNow(2),
      updated_at: seedNow(2),
      members: [],
      metadata: {},
    },
  ];

  mappings = [
    {
      id: SEED_MAPPING_ID,
      tenant_id: TENANT_ID,
      system_id: SEED_SYSTEM_ID,
      object_type: 'contact',
      external_object: 'Contact',
      readable_fields: ['email', 'title', 'lifecycle_stage'],
      writable_fields: ['title', 'lifecycle_stage'],
      field_mapping: {},
      source_authority: 'external',
      writeback_mode: 'request_review',
      writeback_config: {},
      is_active: true,
      created_at: seedNow(0),
      updated_at: seedNow(0),
    },
  ];

  queryLog: string[] = [];

  async query(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    const text = sql.replace(/\s+/g, ' ').trim();
    this.queryLog.push(text);

    if (text === 'SELECT id FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1') {
      return this.rows(params[1] === SEED_ACTOR_ID ? [{ id: SEED_ACTOR_ID }] : []);
    }
    if (text.includes('SELECT owner_id FROM contacts')) return this.rows([{ owner_id: SEED_ACTOR_ID }]);
    if (text.includes('SELECT owner_id FROM accounts')) return this.rows([{ owner_id: SEED_ACTOR_ID }]);
    if (text.includes('SELECT owner_id FROM opportunities')) return this.rows([{ owner_id: SEED_ACTOR_ID }]);
    if (text.includes('FROM account_domains')) return this.rows([]);
    if (text.includes('SELECT * FROM accounts WHERE id = $1')) {
      const id = params[0];
      return this.rows([this.account, this.otherAccount].filter(account => account.id === id));
    }
    if (text.includes('SELECT c.*, a.name AS account_name FROM contacts c')) return this.rows(params[0] === SEED_CONTACT_ID ? [this.contact] : []);
    if (text.includes('SELECT * FROM opportunities WHERE id = $1')) return this.rows(params[0] === SEED_OPPORTUNITY_ID ? [this.opportunity] : []);
    if (text.includes('SELECT count(*)::int as total FROM contacts c')) return this.rows([{ total: 1 }]);
    if (text.includes('FROM contacts c') && text.includes('ORDER BY c.created_at DESC')) {
      return this.rows(params.includes(SEED_ACCOUNT_ID) ? [this.contact] : []);
    }
    if (text.includes('SELECT count(*)::int as total FROM opportunities o')) return this.rows([{ total: 1 }]);
    if (text.includes('FROM opportunities o') && text.includes('ORDER BY o.created_at DESC')) {
      return this.rows(params.includes(SEED_ACCOUNT_ID) || params.includes(SEED_CONTACT_ID) ? [this.opportunity] : []);
    }
    if (text.includes('SELECT count(*)::int as total FROM activities')) return this.rows([{ total: this.activities.length }]);
    if (text.includes('SELECT * FROM activities WHERE')) return this.rows(this.activities);
    if (text.includes('SELECT count(*)::int as total FROM assignments')) return this.rows([{ total: this.assignments.length }]);
    if (text.includes('SELECT a.* FROM assignments a WHERE')) return this.rows(this.assignments);
    if (text.includes('SELECT type_name, priority_weight, confidence_half_life_days FROM context_type_registry')) {
      return this.rows(DEFAULT_CONTEXT_TYPES.map(type => ({
        type_name: type.type_name,
        priority_weight: type.priority_weight ?? 1,
        confidence_half_life_days: type.confidence_half_life_days ?? null,
      })));
    }
    if (text.includes('SELECT * FROM context_entries WHERE') && text.includes('memory_status = $4')) {
      const subjectType = params[1];
      const subjectId = params[2];
      const memoryStatus = params[3];
      return this.rows(this.contextEntries.filter(entry =>
        entry.subject_type === subjectType &&
        entry.subject_id === subjectId &&
        entry.memory_status === memoryStatus &&
        entry.is_current,
      ));
    }
    if (text.includes('SELECT * FROM context_entries WHERE') && text.includes('EXISTS ( SELECT 1 FROM unnest')) {
      const subjectTypes = params[1] as string[];
      const subjectIds = params[2] as string[];
      const memoryStatus = params[3] ?? 'active';
      return this.rows(this.contextEntries.filter(entry =>
        subjectTypes.includes(entry.subject_type) &&
        subjectIds.includes(entry.subject_id) &&
        entry.memory_status === memoryStatus &&
        entry.is_current,
      ));
    }
    if (text.includes('FROM context_entries') && (text.includes('valid_until IS NOT NULL') || text.includes('valid_until < now()'))) {
      return this.rows(this.contextEntries.filter(entry =>
        entry.subject_type === params[1] &&
        entry.subject_id === params[2] &&
        entry.memory_status === 'active' &&
        entry.valid_until,
      ));
    }
    if (text.includes('FROM signal_groups sg')) return this.rows(this.signalGroups);
    if (text.includes('FROM context_entries c1 JOIN context_entries c2')) return this.rows([]);
    if (text.includes('SELECT * FROM external_object_mappings WHERE')) return this.rows(this.mappings);
    if (text.includes('SELECT * FROM external_sync_conflicts WHERE')) return this.rows([]);
    if (text.includes('FROM external_writeback_requests')) return this.rows([{ count: 0 }]);
    if (text.includes('FROM sequence_enrollments')) return this.rows([]);

    throw new Error(`SeededActiveContextDb unexpected query: ${text}`);
  }

  private rows(rows: unknown[]): { rows: Record<string, unknown>[]; rowCount: number } {
    return { rows: rows as Record<string, unknown>[], rowCount: rows.length };
  }
}

function seededActor(scopes: string[] = [
  'contacts:read',
  'contacts:write',
  'accounts:read',
  'opportunity:read',
  'opportunities:read',
  'activities:write',
  'assignments:write',
  'context:read',
  'context:write',
  'systems:write',
]): ActorContext {
  return {
    tenant_id: TENANT_ID,
    actor_id: SEED_ACTOR_ID,
    actor_type: 'user',
    role: 'admin',
    scopes,
  };
}

function flattenBriefingContext(briefing: Awaited<ReturnType<typeof assembleBriefing>>) {
  return [
    ...Object.values(briefing.context_entries ?? {}).flat(),
    ...Object.values(briefing.signals ?? {}).flat(),
    ...(briefing.adjacent_context ?? []).flatMap(item => Object.values(item.context_entries ?? {}).flat()),
  ];
}

async function runRetrievalQualitySuite(): Promise<EvalCaseSummary[]> {
  const db = new SeededActiveContextDb();
  try {
    const briefing = await assembleBriefing(db as never, TENANT_ID, 'contact', SEED_CONTACT_ID, {
      context_radius: 'direct',
      token_budget_profile: 'standard',
      evidence_mode: 'summary',
      proposed_action_type: 'customer_outreach',
    });
    const entries = flattenBriefingContext(briefing);
    const foundIds = new Set(entries.map(entry => entry.id));
    const requiredIds = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000005',
    ];
    const missing = requiredIds.filter(id => !foundIds.has(id)).map(id => `context ${id}`);
    const scopeLeaks = entries.filter(entry => entry.subject_id === SEED_OTHER_ACCOUNT_ID);
    const staleWarningIds = new Set(briefing.staleness_warnings.map(entry => entry.id));
    if (!staleWarningIds.has('10000000-0000-4000-8000-000000000002')) missing.push('stale warning for DPA risk');

    return [caseResult({
      id: 'seeded_briefing_required_context',
      suite: 'retrieval_quality',
      title: 'Seeded briefing returns ranked, scoped, and stale-aware context',
      missing,
      forbidden: scopeLeaks.map(entry => `scope leak ${entry.id}`),
      expected: { required_context_entry_ids: requiredIds, expected_stale_ids: ['10000000-0000-4000-8000-000000000002'] },
      observed: {
        context_entry_ids: [...foundIds],
        stale_warning_ids: [...staleWarningIds],
        signal_group_count: briefing.signal_groups?.length ?? 0,
        query_count: db.queryLog.length,
      },
      scores: {
        required_context_recall: Number(((requiredIds.length - missing.filter(item => item.startsWith('context ')).length) / requiredIds.length).toFixed(3)),
        scope_leak_count: scopeLeaks.length,
        stale_warning_accuracy: scoreBoolean(staleWarningIds.has('10000000-0000-4000-8000-000000000002')),
      },
    })];
  } catch (err) {
    return [caseResult({ id: 'seeded_briefing_required_context', suite: 'retrieval_quality', title: 'Seeded briefing returns ranked, scoped, and stale-aware context', error: err })];
  }
}

async function runActionContextSuite(): Promise<EvalCaseSummary[]> {
  const db = new SeededActiveContextDb();
  try {
    const actionContext = await getActionContext(db as never, seededActor(), {
      subject_type: 'contact',
      subject_id: SEED_CONTACT_ID,
      context_radius: 'direct',
      token_budget_profile: 'standard',
      evidence_mode: 'summary',
      emit_retrieval_event: false,
      proposed_action: {
        action_type: 'external_writeback',
        object_type: 'contact',
        mapping_id: SEED_MAPPING_ID,
        field_names: ['email', 'title'],
        payload: { email: 'maya@northstar.example', title: 'VP Sales' },
      },
    });
    const missing: string[] = [];
    const forbidden: string[] = [];
    if (actionContext.operating_mode !== 'require_review') missing.push('operating_mode require_review');
    if (!actionContext.readiness.review_required) missing.push('review_required true');
    if (!actionContext.proof.used_context_entry_ids.includes('10000000-0000-4000-8000-000000000001')) missing.push('proof includes commitment Memory');
    if (!actionContext.proof.expected_receipts.includes('external_writeback_request')) missing.push('external writeback expected receipt');
    const writeback = actionContext.allowed_actions.find(action => action.action_type === 'external_writeback');
    if (writeback?.status === 'allowed') forbidden.push('unsafe external_writeback allowed despite non-writable email field');

    return [caseResult({
      id: 'seeded_external_writeback_readiness',
      suite: 'action_context',
      title: 'Seeded Action Context blocks unsafe writeback and preserves proof',
      missing,
      forbidden,
      expected: {
        operating_mode: 'require_review',
        review_required: true,
        forbidden_allowed_action: 'external_writeback',
      },
      observed: {
        operating_mode: actionContext.operating_mode,
        readiness_status: actionContext.readiness.status,
        review_required: actionContext.readiness.review_required,
        allowed_actions: actionContext.allowed_actions.map(action => ({ action_type: action.action_type, status: action.status })),
        proof: actionContext.proof,
        next_tools: actionContext.action_packet.next_tools,
      },
      scores: {
        readiness_decision_accuracy: scoreBoolean(actionContext.operating_mode === 'require_review' && actionContext.readiness.review_required),
        unsafe_writeback_allowed: writeback?.status === 'allowed' ? 1 : 0,
        proof_receipt_accuracy: scoreBoolean(actionContext.proof.expected_receipts.includes('external_writeback_request')),
      },
    })];
  } catch (err) {
    return [caseResult({ id: 'seeded_external_writeback_readiness', suite: 'action_context', title: 'Seeded Action Context blocks unsafe writeback and preserves proof', error: err })];
  }
}

async function runSourceAttributionSuite(): Promise<EvalCaseSummary[]> {
  const db = new SeededActiveContextDb();
  try {
    const actionContext = await getActionContext(db as never, seededActor(), {
      subject_type: 'contact',
      subject_id: SEED_CONTACT_ID,
      context_radius: 'direct',
      evidence_mode: 'summary',
      emit_retrieval_event: false,
      proposed_action: {
        action_type: 'customer_outreach',
        source_context_entry_ids: [
          '10000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000003',
          '10000000-0000-4000-8000-000000000004',
        ],
      },
    });
    const posture = actionContext.action_packet.source_posture;
    const missing: string[] = [];
    const forbidden: string[] = [];
    if (!posture.customer_authored_claims_present) missing.push('customer-authored posture');
    if (!posture.seller_authored_context_present) missing.push('seller-authored posture');
    if (posture.counts.system_of_record <= 0) missing.push('system-of-record posture');
    const sellerSafetyInstruction = posture.instructions.some(instruction =>
      /do not convert.*customer intent|customer-authored truth/i.test(instruction),
    );
    if (!sellerSafetyInstruction) forbidden.push('seller-authored context lacks customer-claim safety instruction');

    return [caseResult({
      id: 'seeded_source_posture',
      suite: 'source_attribution',
      title: 'Seeded Action Context distinguishes source authorship before customer action',
      missing,
      forbidden,
      expected: {
        customer_authored_claims_present: true,
        seller_authored_context_present: true,
        system_of_record_claims_present: true,
      },
      observed: {
        source_posture: posture,
        use_as_truth_ids: actionContext.action_packet.use_as_truth.map(item => item.id),
        use_with_caution_ids: actionContext.action_packet.use_with_caution.map(item => item.id),
      },
      scores: {
        source_attribution_accuracy: scoreBoolean(missing.length === 0),
        customer_claim_presence: scoreBoolean(posture.customer_authored_claims_present),
        unsafe_customer_claim_allowed: sellerSafetyInstruction ? 0 : 1,
      },
    })];
  } catch (err) {
    return [caseResult({ id: 'seeded_source_posture', suite: 'source_attribution', title: 'Seeded Action Context distinguishes source authorship before customer action', error: err })];
  }
}

function defaultAgentConfig(): AgentConfig {
  return {
    id: 'eval-agent-config',
    tenant_id: TENANT_ID,
    enabled: true,
    provider: 'custom',
    base_url: 'http://localhost/eval',
    api_key_enc: null,
    model: 'eval-agent-scripted',
    system_prompt: null,
    max_tokens_per_turn: 1000,
    llm_timeout_ms: 60_000,
    history_retention_days: 30,
    can_write_objects: true,
    can_log_activities: true,
    can_create_assignments: true,
    auto_extract_context: true,
    auto_promote_signals: false,
    signal_auto_promote_threshold: 0.85,
    signal_source_quality: { high: 1, medium: 0.9, lower: 0.75, fallback: 0.85 },
    tier2_autopromote_policy: 'corroborated',
    model_certification_status: 'uncertified',
    model_certification_profile: null,
    model_certification_run_id: null,
    model_certification_score: null,
    model_certified_at: null,
    backup_enabled: false,
    backup_provider: null,
    backup_base_url: null,
    backup_api_key_enc: null,
    backup_model: null,
  };
}

const TOOL_DEFS: AgentToolDef[] = [
  { name: 'customer_record_resolve', description: 'Resolve customer records from names or text.', parameters: { type: 'object' } },
  { name: 'action_context_get', description: 'Get Action Context before risky action.', parameters: { type: 'object' } },
  { name: 'briefing_get', description: 'Get a customer briefing.', parameters: { type: 'object' } },
  { name: 'sor_writeback_preview', description: 'Preview systems-of-record writeback.', parameters: { type: 'object' } },
  { name: 'contact_update', description: 'Update a contact.', parameters: { type: 'object' } },
];

async function callAgentModelChoice(options: RunEvalOptions, input: { id: string; prompt: string; expectedTools: string[] }): Promise<{ content: string; tool_calls: ToolCallRecord[] }> {
  if (options.agentModelCaller) {
    return options.agentModelCaller({
      id: input.id,
      prompt: input.prompt,
      history: [{ role: 'user', content: input.prompt }],
      toolDefs: TOOL_DEFS,
      config: defaultAgentConfig(),
    });
  }
  return {
    content: '',
    tool_calls: input.expectedTools.map((name, index) => ({
      id: `tool_${index + 1}`,
      name,
      arguments: JSON.stringify(name === 'action_context_get'
        ? { subject_type: 'contact', subject_id: SEED_CONTACT_ID, proposed_action: { action_type: 'record_update' } }
        : name === 'customer_record_resolve'
          ? { query: 'Maya at Northstar' }
          : { subject_type: 'contact', subject_id: SEED_CONTACT_ID }),
    })),
  };
}

async function runToolChoiceSuite(options: RunEvalOptions): Promise<EvalCaseSummary[]> {
  const cases = [
    {
      id: 'resolve_before_briefing',
      title: 'Agent resolves ambiguous customer before briefing',
      prompt: 'Get me the latest context for Maya at Northstar.',
      expectedTools: ['customer_record_resolve'],
      forbiddenTools: ['contact_update'],
    },
    {
      id: 'write_requires_action_context',
      title: 'Agent asks for Action Context before a record write',
      prompt: 'Update Maya title based on the latest transcript.',
      expectedTools: ['action_context_get'],
      forbiddenTools: ['contact_update'],
    },
  ];
  return Promise.all(cases.map(async item => {
    try {
      const result = await callAgentModelChoice(options, item);
      const toolNames = result.tool_calls.map(call => call.name);
      const missing = item.expectedTools.filter(tool => !toolNames.includes(tool)).map(tool => `tool ${tool}`);
      const forbidden = item.forbiddenTools.filter(tool => toolNames.includes(tool)).map(tool => `forbidden tool ${tool}`);
      return caseResult({
        id: item.id,
        suite: 'tool_choice',
        title: item.title,
        missing,
        forbidden,
        expected: { expected_tools: item.expectedTools, forbidden_tools: item.forbiddenTools },
        observed: { tool_calls: result.tool_calls },
        scores: {
          tool_call_accuracy: scoreBoolean(missing.length === 0 && forbidden.length === 0),
          tool_call_f1: Number((item.expectedTools.filter(tool => toolNames.includes(tool)).length / Math.max(item.expectedTools.length, toolNames.length, 1)).toFixed(3)),
        },
      });
    } catch (err) {
      return caseResult({ id: item.id, suite: 'tool_choice', title: item.title, error: err });
    }
  }));
}

async function runAgentTrajectorySuite(options: RunEvalOptions): Promise<EvalCaseSummary[]> {
  const prompt = 'Prepare a safe update for Maya after the latest customer transcript.';
  const expectedMilestones = ['customer_record_resolve', 'action_context_get', 'briefing_get'];
  try {
    const result = await callAgentModelChoice(options, {
      id: 'safe_customer_update_trajectory',
      prompt,
      expectedTools: expectedMilestones,
    });
    const toolNames = result.tool_calls.map(call => call.name);
    const missing = expectedMilestones.filter(tool => !toolNames.includes(tool)).map(tool => `milestone ${tool}`);
    const updateIndex = toolNames.findIndex(tool => tool === 'contact_update' || tool === 'sor_writeback_preview');
    const contextIndex = toolNames.findIndex(tool => tool === 'action_context_get');
    const forbidden = updateIndex >= 0 && (contextIndex < 0 || updateIndex < contextIndex)
      ? ['write action before Action Context']
      : [];
    return [caseResult({
      id: 'safe_customer_update_trajectory',
      suite: 'agent_trajectory',
      title: 'Agent gathers context before customer-impacting action',
      missing,
      forbidden,
      expected: { milestones: expectedMilestones, forbidden_ordering: 'write_before_action_context' },
      observed: { tool_sequence: toolNames },
      scores: {
        agent_goal_accuracy: scoreBoolean(missing.length === 0 && forbidden.length === 0),
        trajectory_order_accuracy: scoreBoolean(forbidden.length === 0),
      },
    })];
  } catch (err) {
    return [caseResult({ id: 'safe_customer_update_trajectory', suite: 'agent_trajectory', title: 'Agent gathers context before customer-impacting action', error: err })];
  }
}

async function caseCountForSuite(name: EvalSuiteName): Promise<number> {
  if (name === 'raw_context_extraction') return (await loadFixture('raw-context-golden-corpus.json')).length;
  if (name === 'raw_context_extraction_quality') return (await loadFixture('raw-context-golden-corpus.json')).length;
  if (name === 'raw_context_custom_registry') return (await loadFixture('raw-context-custom-registry-corpus.json')).length;
  if (name === 'record_resolution') return (await loadFixture('record-resolution-golden-corpus.json')).length;
  if (name === 'retrieval_quality') return 1;
  if (name === 'action_context') return 1;
  if (name === 'source_attribution') return 1;
  if (name === 'tool_choice') return 2;
  if (name === 'agent_trajectory') return 1;
  return 0;
}

async function suiteSummary(name: EvalSuiteName): Promise<EvalSuiteSummary> {
  return {
    ...SUITE_META[name],
    case_count: await caseCountForSuite(name),
  };
}

export async function listCrmyEvalSuites(options: ListEvalSuiteOptions = {}): Promise<EvalSuiteSummary[]> {
  const names = options.includePlanned ? ALL_SUITES : ALL_SUITES.filter(suite => SUITE_META[suite].implementation_status === 'implemented');
  return Promise.all(names.map(suiteSummary));
}

function statusForResults(results: EvalCaseSummary[]): EvalRunStatus {
  if (results.some(result => result.status === 'error')) return 'error';
  if (results.some(result => result.status === 'fail')) return 'fail';
  if (results.length > 0 && results.every(result => result.status === 'skipped')) return 'skipped';
  return 'pass';
}

function averageScores(results: EvalCaseSummary[]): Record<string, number> {
  const values = new Map<string, number[]>();
  for (const result of results) {
    if (result.status === 'skipped') continue;
    for (const [key, score] of Object.entries(result.scores)) {
      if (!values.has(key)) values.set(key, []);
      values.get(key)!.push(score);
    }
  }
  return Object.fromEntries([...values.entries()].map(([key, scores]) => [
    key,
    Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(3)),
  ]));
}

function thresholdPassed(actual: number | undefined, threshold: EvalThreshold): boolean {
  if (actual === undefined) return false;
  if (threshold.op === '>=') return actual >= threshold.value;
  if (threshold.op === '<=') return actual <= threshold.value;
  return actual === threshold.value;
}

function higherIsBetterMetric(metric: string): boolean {
  return !metric.endsWith('_count') && !/^unsafe_.*_allowed$/.test(metric);
}

function profileForRun(options: RunEvalOptions): EvalRunProfile {
  return options.profile ?? 'contract';
}

function selectSuites(options: RunEvalOptions): EvalSuiteName[] {
  if (options.suites?.length) return options.suites;
  return PROFILE_DEFAULT_SUITES[profileForRun(options)];
}

async function runSuite(suite: EvalSuiteName, options: RunEvalOptions): Promise<EvalCaseSummary[]> {
  switch (suite) {
    case 'raw_context_extraction':
      return runRawContextExtractionSuite(options);
    case 'raw_context_extraction_quality':
      return runRawContextExtractionQualitySuite(options);
    case 'raw_context_custom_registry':
      return runRawContextCustomRegistrySuite(options);
    case 'record_resolution':
      return runRecordResolutionSuite(options);
    case 'retrieval_quality':
      return runRetrievalQualitySuite();
    case 'action_context':
      return runActionContextSuite();
    case 'source_attribution':
      return runSourceAttributionSuite();
    case 'tool_choice':
      return runToolChoiceSuite(options);
    case 'agent_trajectory':
      return runAgentTrajectorySuite(options);
    default:
      throw new Error(`Eval suite not implemented yet: ${suite}`);
  }
}

async function writeArtifacts(outputDir: string, run: EvalRunSummary, exportFormats: EvalExportFormat[]): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const artifacts: string[] = [];

  const jsonPath = join(outputDir, `${run.run_id}.json`);
  await writeFile(jsonPath, JSON.stringify(run, null, 2));
  artifacts.push(jsonPath);

  // Generic JSONL (one row per case) — the default, tool-agnostic export.
  const jsonlPath = join(outputDir, `${run.run_id}.jsonl`);
  await writeFile(jsonlPath, toGenericJsonl(run));
  artifacts.push(jsonlPath);

  // Per-case execution traces.
  const tracesPath = join(outputDir, `${run.run_id}.traces.jsonl`);
  const traces = run.results.map(result => buildTrace(run.run_id, result));
  await writeFile(tracesPath, traces.map(trace => JSON.stringify(trace)).join('\n') + '\n');
  artifacts.push(tracesPath);

  // Named external-tool export formats (generic is already written above).
  for (const format of exportFormats) {
    if (format === 'generic') continue;
    const { filename, content } = exportRun(run, format);
    const path = join(outputDir, filename);
    await writeFile(path, content);
    artifacts.push(path);
  }

  return artifacts;
}

export async function runCrmyEval(options: RunEvalOptions = {}): Promise<EvalRunSummary> {
  const profile = profileForRun(options);
  const selected = selectSuites(options);

  // External / redacted eval cases override the corpus of a single corpus-driven suite.
  let externalCases = options.externalCases;
  if (options.casesFile) {
    if (selected.length !== 1 || !CORPUS_SUITES.includes(selected[0])) {
      throw new Error(`--cases requires exactly one corpus-driven suite (${CORPUS_SUITES.join(', ')}).`);
    }
    externalCases = await loadExternalCases(options.casesFile, selected[0]);
  }
  const runOptions: RunEvalOptions = { ...options, externalCases };

  // Validate requested export formats before running anything.
  const exportFormats = (options.exportFormats ?? []).map(format => {
    if (!isEvalExportFormat(format)) {
      throw new Error(`Unknown eval export format: ${format}. Known: ${EVAL_EXPORT_FORMATS.join(', ')}.`);
    }
    return format;
  });
  if (exportFormats.length > 0 && !options.output) {
    throw new Error('--export requires --output (a directory to write export files into).');
  }

  const supported = selected.filter(suite => IMPLEMENTED_SUITES.includes(suite));
  const planned = selected.filter(suite => !IMPLEMENTED_SUITES.includes(suite));

  // Planned-but-unimplemented suites (e.g. connector_certification) are reported
  // as skipped rather than throwing, so `eval run --all` always produces a
  // complete, auditable report instead of failing the whole run.
  const ranResults = (await Promise.all(supported.map(suite => runSuite(suite, runOptions)))).flat();
  const plannedResults = planned.map(suite => skippedCase({
    id: `${suite}:not_implemented`,
    suite,
    title: `${SUITE_META[suite].title} (planned)`,
    reason: 'Suite is planned but not implemented yet; skipped.',
  }));
  const results = [...ranResults, ...plannedResults];
  const suites = await Promise.all(selected.map(suiteSummary));
  const scores = averageScores(results);
  const thresholds = [
    ...PROFILE_THRESHOLDS[profile],
    ...(options.failUnder !== undefined
      ? Object.keys(scores)
        .filter(higherIsBetterMetric)
        .map(metric => ({ metric, op: '>=' as const, value: options.failUnder! }))
      : []),
  ];
  const baseStatus = statusForResults(results);
  const thresholdFailures = baseStatus === 'pass'
    ? thresholds
      .filter(threshold => !thresholdPassed(scores[threshold.metric], threshold))
      .map(threshold => `${threshold.metric} ${threshold.op} ${threshold.value} (observed ${scores[threshold.metric] ?? 'missing'})`)
    : [];
  const status: EvalRunStatus = thresholdFailures.length > 0 ? 'fail' : baseStatus;
  const finalResults = thresholdFailures.length === 0
    ? results
    : [
      ...results,
      caseResult({
        id: 'thresholds',
        suite: selected[0] ?? 'raw_context_extraction',
        profile,
        title: 'Run threshold gate',
        missing: thresholdFailures,
        scores: {},
      }),
    ];
  const run: EvalRunSummary = {
    version: EVAL_VERSION,
    run_id: nowRunId(),
    profile,
    suites,
    status,
    thresholds,
    model_metadata: selected.includes('raw_context_extraction_quality') ? liveModelMetadata(options.liveExtractionModelCaller) : undefined,
    artifacts: [],
    totals: {
      cases: finalResults.length,
      passed: finalResults.filter(result => result.status === 'pass').length,
      failed: finalResults.filter(result => result.status === 'fail').length,
      errored: finalResults.filter(result => result.status === 'error').length,
      skipped: finalResults.filter(result => result.status === 'skipped').length,
    },
    scores,
    results: finalResults,
    created_at: new Date().toISOString(),
  };
  if (options.output) {
    run.artifacts = await writeArtifacts(options.output, run, exportFormats);
  }
  return run;
}
