// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkContextConvergence } from '../dist/services/context-convergence.js';
import { createContradictionReviewAssignments } from '../dist/services/context-review-assignments.js';
import { getDataQualityReport, repairDataQualityFinding } from '../dist/services/data-quality.js';
import { applyRetentionPolicy, redactSubjectPii } from '../dist/services/privacy-governance.js';
import { enforceToolScopes } from '../dist/auth/scopes.js';
import { recoverOperationalJob } from '../dist/services/operational-recovery.js';
import { getAllTools, getToolsForActor } from '../dist/mcp/server.js';
import { runIdempotent } from '../dist/db/repos/idempotency.js';
import { searchContextEntries } from '../dist/db/repos/context-entries.js';
import { claimPendingRawContextSources, listRawContextSources } from '../dist/db/repos/raw-context-sources.js';
import { DEFAULT_CONTEXT_TYPES } from '../dist/db/repos/context-type-registry.js';
import { withTransaction } from '../dist/db/transaction.js';
import { encryptSecret, decryptSecret, redactSecrets } from '../dist/lib/secrets.js';
import { extractContextFromActivity, parseExtractionOutput, parseExtractionResponse, shouldAutoPromoteSignal } from '../dist/agent/extraction.js';
import { detectRawContextSubjects } from '../dist/services/raw-context-subjects.js';
import { entityResolve } from '../dist/services/entity-resolve.js';
import { hubspotAdapter } from '../dist/services/systems-of-record/hubspot.js';
import { salesforceAdapter } from '../dist/services/systems-of-record/salesforce.js';
import { databricksAdapter } from '../dist/services/systems-of-record/databricks.js';
import { snowflakeAdapter } from '../dist/services/systems-of-record/snowflake.js';
import { connectorHttpError, writebackParameters } from '../dist/services/systems-of-record/adapters.js';
import { buildConnectorContext, executeExternalWriteback, previewExternalWriteback, requestExternalWriteback, reviewExternalWriteback } from '../dist/services/systems-of-record/index.js';
import { evaluateActionPolicy } from '../dist/services/action-policy.js';
import { deriveActionReadiness } from '../dist/services/action-context.js';
import { deriveSignalReadiness } from '../dist/services/signal-readiness.js';
import { resolveSequenceGoalContactId } from '../dist/services/sequence-executor.js';
import { createWorkflowEngine, dryRunWorkflowDefinition, matchesFilter } from '../dist/workflows/engine.js';
import { buildVariableContext, interpolate } from '../dist/workflows/variables.js';
import { __testSignalGrouping } from '../dist/services/signal-groups.js';
import { evaluateMemoryReadiness } from '../dist/services/memory-readiness.js';
import { buildAgentScopes } from '../dist/agent/engine.js';
import { previewRecordDraft } from '../dist/services/record-drafts.js';

const baseInput = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  actorId: 'actor-1',
  operation: 'unit_test',
  key: 'retry-key',
  request: { a: 1, b: 2 },
};

class FakeIdempotencyDb {
  rows = new Map();

  key(params) {
    return `${params[0]}:${params[1]}:${params[2]}:${params[3]}`;
  }

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.startsWith('INSERT INTO idempotency_keys')) {
      const key = this.key(params);
      if (this.rows.has(key)) return { rows: [], rowCount: 0 };
      const row = {
        request_hash: params[4],
        status: 'in_progress',
        response: null,
        error: null,
        updated_at: new Date().toISOString(),
      };
      this.rows.set(key, row);
      return { rows: [row], rowCount: 1 };
    }

    if (text.startsWith('SELECT request_hash, status, response')) {
      return { rows: [this.rows.get(this.key(params))].filter(Boolean), rowCount: this.rows.has(this.key(params)) ? 1 : 0 };
    }

    if (text.includes("SET status = 'completed'")) {
      const row = this.rows.get(this.key(params));
      row.status = 'completed';
      row.response = JSON.parse(params[4]);
      row.error = null;
      return { rows: [], rowCount: 1 };
    }

    if (text.includes("SET status = 'failed'")) {
      const row = this.rows.get(this.key(params));
      row.status = 'failed';
      row.error = params[4];
      return { rows: [], rowCount: 1 };
    }

    if (text.includes("SET status = 'in_progress'")) {
      const row = this.rows.get(this.key(params));
      row.status = 'in_progress';
      row.error = null;
      row.updated_at = new Date().toISOString();
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${text}`);
  }
}

test('runIdempotent replays a completed response without rerunning the operation', async () => {
  const db = new FakeIdempotencyDb();
  let calls = 0;

  const first = await runIdempotent(db, baseInput, async () => {
    calls++;
    return { ok: true, value: 42 };
  });
  const second = await runIdempotent(db, baseInput, async () => {
    calls++;
    return { ok: false };
  });

  assert.deepEqual(first, { ok: true, value: 42 });
  assert.deepEqual(second, { ok: true, value: 42 });
  assert.equal(calls, 1);
});

test('runIdempotent rejects reused keys with different payloads', async () => {
  const db = new FakeIdempotencyDb();
  await runIdempotent(db, baseInput, async () => ({ ok: true }));

  await assert.rejects(
    () => runIdempotent(db, { ...baseInput, request: { a: 99 } }, async () => ({ ok: false })),
    (err) => err?.code === 'CONFLICT' && err?.status === 409,
  );
});

test('runIdempotent marks failed operations and allows a retry with the same payload', async () => {
  const db = new FakeIdempotencyDb();

  await assert.rejects(
    () => runIdempotent(db, baseInput, async () => {
      throw new Error('boom');
    }),
    /boom/,
  );

  const retry = await runIdempotent(db, baseInput, async () => ({ recovered: true }));
  assert.deepEqual(retry, { recovered: true });
});

class FakeTransactionClient {
  statements = [];
  released = false;

  async query(sql) {
    this.statements.push(sql);
    return { rows: [], rowCount: 0 };
  }

  release() {
    this.released = true;
  }
}

test('withTransaction commits and releases on success', async () => {
  const client = new FakeTransactionClient();
  const db = { connect: async () => client };

  const result = await withTransaction(db, async (tx) => {
    await tx.query('UPDATE example SET value = 1');
    return 'done';
  });

  assert.equal(result, 'done');
  assert.deepEqual(client.statements, ['BEGIN', 'UPDATE example SET value = 1', 'COMMIT']);
  assert.equal(client.released, true);
});

test('withTransaction rolls back and releases on failure', async () => {
  const client = new FakeTransactionClient();
  const db = { connect: async () => client };

  await assert.rejects(
    () => withTransaction(db, async () => {
      throw new Error('nope');
    }),
    /nope/,
  );

  assert.deepEqual(client.statements, ['BEGIN', 'ROLLBACK']);
  assert.equal(client.released, true);
});

class FakeContextDb {
  constructor(rows) {
    this.rows = rows;
    this.queries = [];
  }

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    this.queries.push(text);
    if (text.startsWith('SELECT * FROM context_entries')) {
      const [tenantId, subjectType, subjectId, contextType] = params;
      return {
        rows: this.rows.filter(row =>
          row.tenant_id === tenantId &&
          row.subject_type === subjectType &&
          row.subject_id === subjectId &&
          row.context_type === contextType &&
          row.is_current === true
        ),
        rowCount: this.rows.length,
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

const contextBase = {
  id: '22222222-2222-4222-8222-222222222222',
  tenant_id: baseInput.tenantId,
  subject_type: 'contact',
  subject_id: '33333333-3333-4333-8333-333333333333',
  context_type: 'preference',
  authored_by: '44444444-4444-4444-8444-444444444444',
  title: 'Buying preference',
  body: 'Buyer prefers email follow-up on Tuesday mornings.',
  structured_data: { channel: 'email', weekday: 'tuesday' },
  tags: [],
  confidence: 0.9,
  is_current: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

test('context convergence suggests using an exact existing entry', async () => {
  const db = new FakeContextDb([contextBase]);
  const result = await checkContextConvergence(db, baseInput.tenantId, {
    subject_type: contextBase.subject_type,
    subject_id: contextBase.subject_id,
    context_type: contextBase.context_type,
    title: contextBase.title,
    body: contextBase.body,
    structured_data: contextBase.structured_data,
  });

  assert.equal(result.should_block, true);
  assert.equal(result.suggested_action, 'use_existing');
  assert.equal(result.candidates[0].score, 100);
  assert.match(db.queries[0], /memory_status = 'active'/);
});

test('context convergence sends structured conflicts to manual review', async () => {
  const db = new FakeContextDb([contextBase]);
  const result = await checkContextConvergence(db, baseInput.tenantId, {
    subject_type: contextBase.subject_type,
    subject_id: contextBase.subject_id,
    context_type: contextBase.context_type,
    title: 'Buying preference',
    body: 'Buyer prefers phone calls.',
    structured_data: { channel: 'phone', weekday: 'tuesday' },
  });

  assert.equal(result.should_block, true);
  assert.equal(result.suggested_action, 'manual_review');
  assert.equal(result.candidates[0].reasons.includes('structured_data.channel conflicts'), true);
});

test('context convergence allows clearly distinct context', async () => {
  const db = new FakeContextDb([contextBase]);
  const result = await checkContextConvergence(db, baseInput.tenantId, {
    subject_type: contextBase.subject_type,
    subject_id: contextBase.subject_id,
    context_type: contextBase.context_type,
    title: 'Procurement process',
    body: 'Legal review starts after procurement approves the supplier packet.',
    structured_data: { process: 'legal_review' },
  });

  assert.equal(result.should_block, false);
  assert.equal(result.suggested_action, 'add_new');
  assert.deepEqual(result.candidates, []);
});

class FakeContextSearchDb {
  constructor() {
    this.queries = [];
    this.params = [];
  }

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    this.queries.push(text);
    this.params.push([...params]);
    if (text.startsWith('SELECT count(*)::int')) {
      return { rows: [{ total: 0 }], rowCount: 1 };
    }
    if (text.startsWith('SELECT c.*')) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

test('context search defaults to confirmed Memory and only includes Signals when requested', async () => {
  const activeDb = new FakeContextSearchDb();
  await searchContextEntries(activeDb, baseInput.tenantId, { limit: 20 });
  assert.match(activeDb.queries[0], /c\.memory_status = 'active'/);
  assert.deepEqual(activeDb.params[0], [baseInput.tenantId]);

  const signalDb = new FakeContextSearchDb();
  await searchContextEntries(signalDb, baseInput.tenantId, { memory_status: 'signal', limit: 20 });
  assert.match(signalDb.queries[0], /c\.memory_status = \$2/);
  assert.deepEqual(signalDb.params[0], [baseInput.tenantId, 'signal']);
});

test('signal auto-promotion requires evidence and configured confidence threshold', () => {
  assert.equal(shouldAutoPromoteSignal({ confidence: 0.85, threshold: 0.85, evidenceCount: 1 }), true);
  assert.equal(shouldAutoPromoteSignal({ confidence: 0.84, threshold: 0.85, evidenceCount: 1 }), false);
  assert.equal(shouldAutoPromoteSignal({ confidence: 0.95, threshold: 0.85, evidenceCount: 0 }), false);
  assert.equal(shouldAutoPromoteSignal({ threshold: 0.85, evidenceCount: 1 }), false);
  assert.equal(shouldAutoPromoteSignal({ confidence: 0.95, threshold: 0.85, evidenceCount: 1, speculative: true }), false);
});

test('signal grouping does not let repeated context masquerade as independent corroboration', () => {
  const repeatedA = {
    id: 'signal-a',
    source: 'extraction',
    source_ref: 'activity-a',
    title: 'Maya is the champion',
    body: 'Maya is the champion for the evaluation.',
    confidence: 0.84,
    evidence: [{
      source_type: 'call_transcript',
      source_content_hash: 'first-transcript-hash',
      source_event_at: '2026-05-30T18:00:00.000Z',
      source_event_at_provided: true,
      snippet: 'Maya will champion this internally.',
    }],
  };
  const repeatedB = {
    ...repeatedA,
    id: 'signal-b',
    source_ref: 'activity-b',
    evidence: [{
      source_type: 'meeting_notes',
      source_content_hash: 'lightly-reworded-transcript-hash',
      source_event_at: '2026-05-30T18:00:00.000Z',
      source_event_at_provided: true,
      snippet: 'Maya is going to champion this evaluation internally.',
    }],
  };

  assert.equal(__testSignalGrouping.sourceKey(repeatedA), __testSignalGrouping.sourceKey(repeatedB));
  const repeated = __testSignalGrouping.confidenceComponents([repeatedA, repeatedB], 1, 0);
  assert.equal(repeated.duplicate_source_count, 1);
  assert.equal(repeated.support_boost, 0);
  assert.equal(repeated.source_boost, 0);
  assert.equal(repeated.score, 0.756);

  const laterEvent = {
    ...repeatedB,
    evidence: [{
      source_type: 'call_transcript',
      source_content_hash: 'later-follow-up-hash',
      source_event_at: '2026-05-30T18:20:00.000Z',
      source_event_at_provided: true,
      snippet: 'Maya will champion this internally.',
    }],
  };
  assert.notEqual(__testSignalGrouping.sourceKey(repeatedA), __testSignalGrouping.sourceKey(laterEvent));
  const corroborated = __testSignalGrouping.confidenceComponents([repeatedA, laterEvent], 2, 0);
  assert.equal(corroborated.duplicate_source_count, 0);
  assert.equal(corroborated.support_boost, 0.04);
  assert.equal(corroborated.source_boost, 0.06);
  assert.equal(corroborated.score, 0.856);
});

test('signal readiness marks complete, corroborated Signals ready to confirm', () => {
  const readiness = deriveSignalReadiness({
    group_status: 'ready',
    score: 0.91,
    threshold: 0.85,
    support_count: 2,
    independent_source_count: 2,
    evidence_count: 2,
    conflict_count: 0,
    model_confidence: 0.9,
    source_quality: 1,
    source_boost: 0.06,
    conflict_penalty: 0,
    typed_completeness: 1,
  });

  assert.equal(readiness.status, 'ready_to_confirm');
  assert.equal(readiness.can_confirm, true);
  assert.equal(readiness.can_auto_confirm, true);
  assert.equal(readiness.components.independent_source_count, 2);
});

test('signal readiness explains evidence, detail, conflict, approval, and terminal states', () => {
  const lowEvidence = deriveSignalReadiness({
    group_status: 'gathering',
    score: 0.62,
    threshold: 0.85,
    support_count: 1,
    independent_source_count: 1,
    evidence_count: 1,
    conflict_count: 0,
    duplicate_source_count: 1,
  });
  assert.equal(lowEvidence.status, 'needs_more_evidence');
  assert.equal(lowEvidence.can_confirm, false);
  assert.equal(lowEvidence.components.duplicate_source_count, 1);

  const missingDetail = deriveSignalReadiness({
    group_status: 'blocked',
    score: 0.9,
    threshold: 0.85,
    support_count: 1,
    independent_source_count: 1,
    evidence_count: 1,
    conflict_count: 0,
    typed_completeness: 0.6,
    missing_details: ['Role'],
  });
  assert.equal(missingDetail.status, 'needs_more_detail');
  assert.match(missingDetail.blockers.join(' '), /Role/);

  const conflict = deriveSignalReadiness({
    group_status: 'conflicting',
    score: 0.9,
    threshold: 0.85,
    support_count: 2,
    independent_source_count: 2,
    evidence_count: 2,
    conflict_count: 1,
  });
  assert.equal(conflict.status, 'blocked_by_conflict');
  assert.equal(conflict.next_actions.includes('resolve_conflict'), true);

  const approval = deriveSignalReadiness({
    group_status: 'blocked',
    score: 0.9,
    threshold: 0.85,
    support_count: 1,
    independent_source_count: 1,
    evidence_count: 1,
    conflict_count: 0,
    sensitive: true,
    requires_approval: true,
    promotion_blockers: ['Sensitive context needs corroboration or approval before becoming Memory.'],
  });
  assert.equal(approval.status, 'approval_required');
  assert.equal(approval.can_confirm, true);

  assert.equal(deriveSignalReadiness({
    group_status: 'promoted',
    score: 0.91,
    support_count: 1,
    independent_source_count: 1,
    evidence_count: 1,
    conflict_count: 0,
  }).status, 'confirmed');
  assert.equal(deriveSignalReadiness({
    group_status: 'dismissed',
    score: 0.91,
    support_count: 1,
    independent_source_count: 1,
    evidence_count: 1,
    conflict_count: 0,
  }).status, 'dismissed');
});

class FakeSignalGroupReadinessDb {
  group = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenant_id: baseInput.tenantId,
    subject_type: 'contact',
    subject_id: '33333333-3333-4333-8333-333333333333',
    context_type: 'stakeholder',
    claim_key: 'maya-champion',
    title: 'Maya may be champion',
    normalized_claim: 'Maya may be the champion.',
    status: 'gathering',
    aggregate_confidence: 0.62,
    support_count: 1,
    independent_source_count: 1,
    conflict_count: 0,
    evidence_count: 1,
    latest_signal_id: null,
    promoted_context_entry_id: null,
    blocked_reason: null,
    metadata: {
      threshold: 0.85,
      confidence_components: {
        strongest_evidence_confidence: 0.74,
        strongest_source_weight: 0.9,
        source_boost: 0,
        conflict_penalty: 0,
        duplicate_source_count: 0,
      },
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT count(*)::int AS total FROM signal_groups')) {
      return { rows: [{ total: 1 }], rowCount: 1 };
    }
    if (text.startsWith('SELECT sg.*, CASE sg.subject_type') && text.includes('FROM signal_groups sg WHERE')) {
      if (text.includes('sg.id = $2') && params[1] !== this.group.id) return { rows: [], rowCount: 0 };
      return { rows: [{ ...this.group, subject_name: 'Ada Lovelace' }], rowCount: 1 };
    }
    if (text.startsWith('SELECT sgm.*, to_jsonb(ce.*)')) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected Signal readiness query: ${text}`);
  }
}

test('Signal group MCP list and get include readiness', async () => {
  const db = new FakeSignalGroupReadinessDb();
  const actor = {
    tenant_id: baseInput.tenantId,
    actor_id: 'admin-actor',
    actor_type: 'user',
    role: 'admin',
    scopes: ['context:read', 'context:write'],
  };
  const tools = getAllTools(db);
  const listTool = tools.find(candidate => candidate.name === 'context_signal_group_list');
  const getTool = tools.find(candidate => candidate.name === 'context_signal_group_get');
  assert.ok(listTool);
  assert.ok(getTool);

  const listed = await listTool.handler({ attention_only: false, limit: 20 }, actor);
  assert.equal(listed.signal_groups[0].readiness.status, 'needs_more_evidence');
  assert.match(listed.signal_groups[0].readiness.reasons.join(' '), /below the 85% confirmation threshold/);

  const detailed = await getTool.handler({ id: db.group.id }, actor);
  assert.equal(detailed.signal_group.readiness.status, 'needs_more_evidence');
  assert.equal(detailed.signal_group.readiness.components.source_quality, 0.9);
});

class FakeSignalGroupCompletionDb {
  entry = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    tenant_id: baseInput.tenantId,
    subject_type: 'account',
    subject_id: '33333333-3333-4333-8333-333333333333',
    context_type: 'implementation_owner',
    title: 'Implementation owner identified',
    body: 'Ada owns the implementation.',
    structured_data: {
      readiness_blockers: ['Needs owner before agents can rely on this as Memory.'],
      missing_details: ['Owner'],
      extraction_completeness: 0,
    },
    confidence: 0.9,
    memory_status: 'signal',
    evidence: [{ source_type: 'meeting_notes', source_ref: 'kickoff', snippet: 'Ada owns implementation.' }],
    tags: [],
    is_current: true,
    source: 'raw_context',
    source_ref: 'kickoff',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  group = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    tenant_id: baseInput.tenantId,
    subject_type: 'account',
    subject_id: '33333333-3333-4333-8333-333333333333',
    context_type: 'implementation_owner',
    claim_key: 'implementation-owner',
    title: 'Implementation owner identified',
    normalized_claim: 'Ada owns implementation.',
    status: 'blocked',
    aggregate_confidence: 0.9,
    support_count: 1,
    independent_source_count: 1,
    conflict_count: 0,
    evidence_count: 1,
    latest_signal_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    promoted_context_entry_id: null,
    blocked_reason: 'Needs more detail before agents can rely on it as Memory.',
    metadata: {
      threshold: 0.7,
      readiness_blockers: ['Needs owner before agents can rely on this as Memory.'],
      missing_details: ['Owner'],
      typed_completeness: 0,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  events = [];

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT sg.*, CASE sg.subject_type') && text.includes('FROM signal_groups sg WHERE sg.tenant_id = $1 AND sg.id = $2')) {
      if (params[1] !== this.group.id) return { rows: [], rowCount: 0 };
      return { rows: [{ ...this.group, subject_name: 'Acme Corp' }], rowCount: 1 };
    }
    if (text.startsWith('SELECT sgm.*, to_jsonb(ce.*)')) {
      return {
        rows: [{
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          tenant_id: baseInput.tenantId,
          signal_group_id: this.group.id,
          context_entry_id: this.entry.id,
          relation: 'supports',
          similarity_score: 1,
          evidence_weight: 0.9,
          source_key: 'meeting:kickoff',
          created_at: new Date().toISOString(),
          context_entry: { ...this.entry, subject_name: 'Acme Corp' },
        }],
        rowCount: 1,
      };
    }
    if (text.startsWith('SELECT json_schema FROM context_type_registry')) {
      return {
        rows: [{
          json_schema: {
            type: 'object',
            properties: { owner: { type: 'string' } },
            required: ['owner'],
          },
        }],
        rowCount: 1,
      };
    }
    if (text.startsWith('UPDATE context_entries SET structured_data = $3::jsonb')) {
      this.entry = {
        ...this.entry,
        structured_data: JSON.parse(params[2]),
        updated_at: new Date().toISOString(),
      };
      return { rows: [this.entry], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO context_outbox')) {
      return { rows: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }], rowCount: 1 };
    }
    if (text.startsWith('SELECT * FROM context_entries WHERE tenant_id = $1')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith('UPDATE signal_groups SET status = $3')) {
      this.group = {
        ...this.group,
        status: params[2],
        aggregate_confidence: params[3],
        support_count: params[4],
        independent_source_count: params[5],
        conflict_count: params[6],
        evidence_count: params[7],
        latest_signal_id: params[8] ?? this.group.latest_signal_id,
        blocked_reason: params[9],
        metadata: {
          ...this.group.metadata,
          ...(params[10] ? JSON.parse(params[10]) : {}),
        },
        updated_at: new Date().toISOString(),
      };
      return { rows: [this.group], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO events')) {
      const row = { id: this.events.length + 1, metadata: JSON.parse(params[8]) };
      this.events.push(row);
      return { rows: [row], rowCount: 1 };
    }
    throw new Error(`Unexpected Signal completion query: ${text}`);
  }
}

test('Signal group detail completion patches Signal structured data and recomputes readiness', async () => {
  const db = new FakeSignalGroupCompletionDb();
  const actor = {
    tenant_id: baseInput.tenantId,
    actor_id: 'admin-actor',
    actor_type: 'user',
    role: 'admin',
    scopes: ['context:read', 'context:write'],
  };
  const tool = getAllTools(db).find(candidate => candidate.name === 'context_signal_group_complete_details');
  assert.ok(tool);

  const result = await tool.handler({
    id: db.group.id,
    structured_data_patch: { owner: 'Ada Lovelace' },
  }, actor);

  assert.equal(result.context_entry.structured_data.owner, 'Ada Lovelace');
  assert.deepEqual(result.context_entry.structured_data.missing_details, []);
  assert.equal(result.signal_group.readiness.status, 'ready_to_confirm');
  assert.equal(result.mutation.side_effects.includes('signal_group:details_completed'), true);
  assert.equal(db.events[0].metadata.readiness_status, 'ready_to_confirm');
});

test('memory readiness keeps incomplete typed Signals reviewable without dropping details', () => {
  const readiness = evaluateMemoryReadiness({
    person_name: 'Maya Patel',
    influence: 'Champion',
    observed_note: 'She is pushing the evaluation internally.',
  }, {
    type: 'object',
    properties: {
      person_name: { type: 'string' },
      role: { type: 'string' },
      influence: { type: 'string', enum: ['decision_maker', 'influencer', 'champion'] },
    },
    required: ['person_name', 'role', 'influence'],
  });

  assert.equal(readiness.readiness_status, 'needs_more_detail');
  assert.deepEqual(readiness.missing_details, ['Role']);
  assert.equal(readiness.normalized_structured_data.influence, 'champion');
  assert.deepEqual(readiness.normalized_structured_data.unmapped_details, {
    observed_note: 'She is pushing the evaluation internally.',
  });
  assert.equal(readiness.extraction_completeness, 0.67);
});

test('extraction parser recovers common local-model JSON formatting issues', () => {
  const fenced = `Here is the JSON:\n\`\`\`json\n{\n  "context_entries": [\n    {\n      "context_type": "next_step",\n      "title": "Workshop follow-up",\n      "body": "Maya asked for a follow-up workshop.",\n      "confidence": 0.9,\n      "structured_data": {},\n      "evidence": [{ "source_type": "add_context", "snippet": "Maya asked for a follow-up workshop.", }],\n    },\n  ],\n}\n\`\`\``;
  const entries = parseExtractionResponse(fenced);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].context_type, 'next_step');

  const arrayOnly = `[
    {
      "context_type": "deal_risk",
      "title": "Budget risk",
      "body": "Finance approval is still pending
before the deal can move forward.",
      "confidence": 0.76
    }
  ]`;
  const arrayEntries = parseExtractionResponse(arrayOnly);
  assert.equal(arrayEntries.length, 1);
  assert.equal(arrayEntries[0].title, 'Budget risk');

  const signalsEnvelope = parseExtractionResponse('{"signals":[{"context_type":"stakeholder","title":"Maya sponsor","body":"Maya may sponsor the evaluation."}]}');
  assert.equal(signalsEnvelope.length, 1);

  const proposalEnvelope = parseExtractionOutput(`{
    "context_entries": [],
    "record_proposals": [{
      "record_type": "opportunity",
      "name": "Acme workshop evaluation",
      "confidence": 0.82,
      "reason": "The source says Acme is ready for a demo and workshop.",
      "fields": { "account_name": "Acme Corporation", "stage": "qualification" }
    }]
  }`);
  assert.equal(proposalEnvelope.entries.length, 0);
  assert.equal(proposalEnvelope.proposedRecords.length, 1);
  assert.equal(proposalEnvelope.proposedRecords[0].record_type, 'opportunity');
});

function registrySchemasForFixture(registry = {}) {
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

test('Raw Context golden corpus covers core GTM extraction scenarios', async () => {
  const corpusPath = new URL('./fixtures/raw-context-golden-corpus.json', import.meta.url);
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
  assert.ok(Array.isArray(corpus));
  assert.ok(corpus.length >= 8);
  const schemas = new Map(
    DEFAULT_CONTEXT_TYPES
      .filter(type => type.is_extractable)
      .map(type => [type.type_name, type.json_schema ?? null]),
  );

  const ids = new Set(corpus.map(item => item.id));
  for (const required of [
    'champion_role_from_call',
    'procurement_and_security_path',
    'success_criteria_from_workshop',
    'new_opportunity_under_known_account',
    'first_name_disambiguation_in_account',
    'duplicate_transcript_same_event',
    'no_customer_specific_context',
    'conflicting_later_evidence',
  ]) {
    assert.ok(ids.has(required), `missing fixture ${required}`);
  }

  for (const item of corpus) {
    assert.equal(typeof item.document, 'string');
    assert.ok(item.document.length > 20);
    assert.ok(Array.isArray(item.expected_signal_types));
    assert.equal(typeof item.expected_behavior, 'string');
    assert.equal(typeof item.must_not_auto_promote, 'boolean');
    const output = parseExtractionOutput(JSON.stringify(item.golden_model_output ?? {}));
    const outputTypes = new Set(output.entries.map(entry => entry.context_type));
    if (item.expected_behavior === 'create_reviewable_signals') {
      assert.ok(output.entries.length > 0, `${item.id} should emit reviewable Signals`);
    }
    for (const expectedType of item.expected_signal_types) {
      assert.ok(outputTypes.has(expectedType), `${item.id} missing expected ${expectedType} Signal`);
    }
    const readinessResults = output.entries.map(entry => ({
      context_type: entry.context_type,
      readiness: evaluateMemoryReadiness(entry.structured_data, schemas.get(entry.context_type)),
    }));
    assert.equal(readinessResults.length, output.entries.length);
    if (item.expected_behavior === 'propose_child_record_for_review') {
      assert.ok(output.proposedRecords.length > 0, `${item.id} should propose a reviewed record`);
    }
    if (item.expected_behavior === 'skip_no_customer_specific_context') {
      assert.equal(output.entries.length, 0, `${item.id} should not emit Signals`);
    }
    if (item.must_not_auto_promote && item.expected_behavior !== 'dedupe_existing_receipt') {
      for (const entry of output.entries) {
        assert.equal(
          shouldAutoPromoteSignal({
            confidence: entry.confidence ?? 0,
            threshold: 0.85,
            evidenceCount: entry.evidence?.length ?? 0,
            speculative: /may|might|possible|appears|risk|blocked|unconfirmed/i.test(`${entry.title} ${entry.body}`),
          }),
          false,
          `${item.id}:${entry.context_type} should remain reviewable`,
        );
      }
    }
  }

  const duplicate = corpus.find(item => item.id === 'duplicate_transcript_same_event');
  assert.equal(duplicate.must_not_auto_promote, true);
  assert.equal(duplicate.expected_behavior, 'dedupe_existing_receipt');
});

test('Raw Context custom registry corpus respects tenant Memory vocabulary', async () => {
  const corpusPath = new URL('./fixtures/raw-context-custom-registry-corpus.json', import.meta.url);
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
  assert.ok(Array.isArray(corpus));
  assert.ok(corpus.length >= 4);

  const ids = new Set(corpus.map(item => item.id));
  for (const required of [
    'custom_implementation_owner_ready',
    'custom_implementation_owner_missing_required_detail',
    'admin_disabled_key_fact_is_unsupported',
    'admin_stricter_success_criteria_blocks_incomplete_memory',
  ]) {
    assert.ok(ids.has(required), `missing custom-registry fixture ${required}`);
  }

  for (const item of corpus) {
    const schemas = registrySchemasForFixture(item.registry);
    const output = parseExtractionOutput(JSON.stringify(item.golden_model_output ?? {}));
    const supportedEntries = output.entries.filter(entry => schemas.has(entry.context_type));
    const unsupportedTypes = output.entries
      .map(entry => entry.context_type)
      .filter(type => !schemas.has(type));
    const supportedTypes = new Set(supportedEntries.map(entry => entry.context_type));

    for (const expectedType of item.expected_signal_types ?? []) {
      assert.ok(supportedTypes.has(expectedType), `${item.id} missing supported ${expectedType} Signal`);
    }
    for (const expectedUnsupported of item.expected_unsupported_types ?? []) {
      assert.ok(unsupportedTypes.includes(expectedUnsupported), `${item.id} should treat ${expectedUnsupported} as unsupported`);
    }

    for (const entry of supportedEntries) {
      const readiness = evaluateMemoryReadiness(entry.structured_data, schemas.get(entry.context_type));
      const expectedReadiness = item.expected_readiness?.[entry.context_type];
      if (expectedReadiness) {
        assert.equal(readiness.readiness_status, expectedReadiness, `${item.id}:${entry.context_type} readiness`);
      }
      const expectedMissing = item.expected_missing_details?.[entry.context_type] ?? [];
      for (const missing of expectedMissing) {
        assert.ok(readiness.missing_details.includes(missing), `${item.id}:${entry.context_type} should miss ${missing}`);
      }
      if (item.must_not_auto_promote) {
        assert.equal(
          shouldAutoPromoteSignal({
            confidence: entry.confidence ?? 0,
            threshold: 0.85,
            evidenceCount: entry.evidence?.length ?? 0,
            speculative: readiness.readiness_status !== 'ready_for_memory'
              || /may|might|possible|appears|risk|blocked|unconfirmed/i.test(`${entry.title} ${entry.body}`),
          }),
          false,
          `${item.id}:${entry.context_type} should remain reviewable under custom registry`,
        );
      }
    }
  }
});

const extractionTenantId = '11111111-1111-4111-8111-111111111111';
const extractionActivityId = '22222222-2222-4222-8222-222222222222';
const extractionAccountId = '33333333-3333-4333-8333-333333333333';
const extractionContactId = '44444444-4444-4444-8444-444444444444';
const extractionOpportunityId = '55555555-5555-4555-8555-555555555555';
const extractionActorId = '66666666-6666-4666-8666-666666666666';

class FakeExtractionDb {
  contextEntries = [];
  signalGroups = [];
  signalGroupMembers = [];
  rawContextSources = new Map();
  attempts = [];
  activities = new Map();

  constructor(fixture) {
    this.fixture = fixture;
    this.activity = {
      id: extractionActivityId,
      tenant_id: extractionTenantId,
      type: 'meeting',
      subject: fixture.title,
      body: fixture.document,
      outcome: null,
      occurred_at: fixture.source_occurred_at,
      created_at: fixture.source_occurred_at,
      subject_type: 'opportunity',
      subject_id: extractionOpportunityId,
      created_by: extractionActorId,
      performed_by: extractionActorId,
      direction: null,
      source_agent: 'context_ingest',
      detail: {
        source_document_hash: `corpus-${fixture.id}`,
        raw_context_source_ref: `corpus:${fixture.id}`,
        source_occurred_at: fixture.source_occurred_at,
        source_occurred_at_provided: true,
      },
      extraction_status: null,
      extraction_error: null,
    };
    this.activities.set(this.activity.id, this.activity);
  }

  parseJson(value, fallback) {
    if (typeof value !== 'string') return value ?? fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  now() {
    return '2026-05-30T18:00:00.000Z';
  }

  rawKey(sourceType, sourceRef) {
    return `${sourceType}:${sourceRef}`;
  }

  contextTypeRows() {
    return DEFAULT_CONTEXT_TYPES
      .filter(type => type.is_extractable)
      .map(type => ({
        ...type,
        tenant_id: extractionTenantId,
        is_default: true,
        created_at: this.now(),
        updated_at: this.now(),
      }));
  }

  accountRow() {
    return {
      id: extractionAccountId,
      tenant_id: extractionTenantId,
      name: 'Northstar',
      domain: 'northstar.example',
      industry: 'SaaS',
      owner_id: extractionActorId,
      created_at: this.now(),
      updated_at: this.now(),
    };
  }

  contactRow() {
    return {
      id: extractionContactId,
      tenant_id: extractionTenantId,
      first_name: 'Maya',
      last_name: 'Patel',
      email: 'maya@northstar.example',
      title: 'VP Sales',
      account_id: extractionAccountId,
      owner_id: extractionActorId,
      created_at: this.now(),
      updated_at: this.now(),
    };
  }

  opportunityRow() {
    return {
      id: extractionOpportunityId,
      tenant_id: extractionTenantId,
      name: 'Agent Context Rollout',
      account_id: extractionAccountId,
      contact_id: extractionContactId,
      stage: 'evaluation',
      amount: 125000,
      forecast_category: 'pipeline',
      owner_id: extractionActorId,
      account_name: 'Northstar',
      contact_name: 'Maya Patel',
      contact_email: 'maya@northstar.example',
      created_at: this.now(),
      updated_at: this.now(),
    };
  }

  rawSourceFromParams(params) {
    const key = this.rawKey(params[1], params[2]);
    const existing = this.rawContextSources.get(key);
    const row = {
      id: existing?.id ?? '77777777-7777-4777-8777-777777777777',
      tenant_id: params[0],
      source_type: params[1],
      source_ref: params[2],
      source_label: params[3],
      subject_type: params[4],
      subject_id: params[5],
      actor_id: extractionActorId,
      status: params[7],
      stage: params[8],
      raw_excerpt: params[9],
      detected_subjects: this.parseJson(params[10], []),
      signals_created: params[11] ?? 0,
      memory_created: params[12] ?? 0,
      skipped: params[13] ?? 0,
      failure_reason: params[14],
      failure_code: params[15],
      attempt_count: params[16] ?? 0,
      locked_at: params[17],
      next_retry_at: params[18],
      last_error: params[19],
      metadata: this.parseJson(params[20], {}),
      processed_at: ['processed', 'needs_review', 'failed', 'skipped'].includes(params[7]) ? this.now() : null,
      created_at: existing?.created_at ?? this.now(),
      updated_at: this.now(),
    };
    this.rawContextSources.set(key, row);
    return row;
  }

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.startsWith('SELECT id FROM ( SELECT id, 0 AS priority FROM actors')) {
      return { rows: [{ id: extractionActorId }], rowCount: 1 };
    }
    if (text === 'SELECT * FROM agent_configs WHERE tenant_id = $1') {
      return {
        rows: [{
          enabled: true,
          provider: 'custom',
          model: 'corpus-model',
          base_url: 'http://corpus.local',
          api_key_enc: null,
          max_tokens_per_turn: 4096,
          auto_extract_context: true,
          auto_promote_signals: false,
          signal_auto_promote_threshold: 0.85,
        }],
        rowCount: 1,
      };
    }
    if (text.startsWith('SELECT id, tenant_id, type, subject, body')) {
      const row = this.activities.get(params[0]);
      return { rows: row && row.tenant_id === params[1] ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith('UPDATE activities SET extraction_status')) {
      const row = this.activities.get(params[2]);
      if (row) {
        row.extraction_status = params[0];
        row.extraction_error = params[1];
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith('INSERT INTO raw_context_sources')) {
      const row = this.rawSourceFromParams(params);
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('SELECT * FROM raw_context_sources WHERE tenant_id = $1 AND source_type = $2 AND source_ref = $3')) {
      const row = this.rawContextSources.get(this.rawKey(params[1], params[2]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith('UPDATE raw_context_sources')) {
      const key = this.rawKey(params[1], params[2]);
      const row = this.rawContextSources.get(key);
      if (!row) return { rows: [], rowCount: 0 };
      row.status = params[3] ?? row.status;
      row.stage = params[4] ?? row.stage;
      row.source_label = params[5] ?? row.source_label;
      row.subject_type = params[6] ?? row.subject_type;
      row.subject_id = params[7] ?? row.subject_id;
      row.actor_id = extractionActorId;
      row.raw_excerpt = params[9] ?? row.raw_excerpt;
      row.detected_subjects = params[10] ? this.parseJson(params[10], row.detected_subjects) : row.detected_subjects;
      row.signals_created = params[11] ?? row.signals_created;
      row.memory_created = params[12] ?? row.memory_created;
      row.skipped = params[13] ?? row.skipped;
      row.failure_reason = params[14];
      row.failure_code = params[15] ?? row.failure_code;
      row.metadata = { ...row.metadata, ...this.parseJson(params[20], {}) };
      row.processed_at = ['processed', 'needs_review', 'failed', 'skipped'].includes(row.status) ? this.now() : row.processed_at;
      row.updated_at = this.now();
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO context_type_registry')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM context_type_registry')) {
      return { rows: this.contextTypeRows(), rowCount: this.contextTypeRows().length };
    }
    if (text === 'SELECT * FROM actors WHERE tenant_id = $1 AND agent_identifier = $2') {
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith('INSERT INTO actors')) {
      return {
        rows: [{
          id: extractionActorId,
          tenant_id: params[0],
          actor_type: params[1],
          display_name: params[2],
          agent_identifier: params[7],
          agent_model: params[8],
          metadata: this.parseJson(params[10], {}),
          created_at: this.now(),
          updated_at: this.now(),
        }],
        rowCount: 1,
      };
    }
    if (text.includes('FROM custom_field_definitions')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM opportunities o LEFT JOIN accounts')) {
      return { rows: [this.opportunityRow()], rowCount: 1 };
    }
    if (text.startsWith('SELECT * FROM opportunities WHERE tenant_id = $1 AND id = $2')) {
      return { rows: [this.opportunityRow()], rowCount: 1 };
    }
    if (text.startsWith('SELECT * FROM accounts WHERE tenant_id = $1 AND id = $2')) {
      return { rows: [this.accountRow()], rowCount: 1 };
    }
    if (text.includes('FROM contacts c LEFT JOIN accounts')) {
      return { rows: [this.contactRow()], rowCount: 1 };
    }
    if (text.startsWith('SELECT * FROM contacts WHERE tenant_id = $1 AND id = $2')) {
      return { rows: [this.contactRow()], rowCount: 1 };
    }
    if (text.includes("SELECT 'account' AS relation_type, to_jsonb(a.*) AS record FROM opportunities")) {
      return {
        rows: [
          { relation_type: 'account', record: this.accountRow() },
          { relation_type: 'contact', record: this.contactRow() },
        ],
        rowCount: 2,
      };
    }
    if (text.startsWith('SELECT * FROM use_cases WHERE tenant_id = $1 AND opportunity_id = $2')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith('SELECT * FROM context_entries WHERE')) {
      const memoryStatus = text.includes("memory_status = 'active'") ? 'active' : params.includes('signal') ? 'signal' : undefined;
      const rows = this.contextEntries.filter(entry =>
        entry.tenant_id === params[0]
          && (!params[1] || entry.subject_type === params[1])
          && (!params[2] || entry.subject_id === params[2])
          && (!memoryStatus || entry.memory_status === memoryStatus)
      );
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith('SELECT count(*)::int AS total FROM signal_groups')) {
      return { rows: [{ total: 0 }], rowCount: 1 };
    }
    if (text.startsWith('SELECT sg.*, CASE sg.subject_type') && text.includes('FROM signal_groups sg WHERE')) {
      if (text.includes('sg.id = $2')) {
        const group = this.signalGroups.find(item => item.id === params[1]);
        return { rows: group ? [{ ...group, subject_name: 'Agent Context Rollout' }] : [], rowCount: group ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith('SELECT sgm.*, to_jsonb(ce.*)')) {
      const rows = this.signalGroupMembers
        .filter(member => member.signal_group_id === params[1])
        .map(member => ({
          ...member,
          context_entry: this.contextEntries.find(entry => entry.id === member.context_entry_id),
        }));
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith('WITH subject_scope AS') && text.includes('SELECT sg.* FROM signal_groups')) {
      const rows = this.signalGroups.filter(group =>
        group.context_type === params[3]
          && group.status !== 'dismissed'
          && group.status !== 'merged'
          && (group.subject_type === params[1] && group.subject_id === params[2])
      );
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith('SELECT scope.account_id, a.name AS account_name')) {
      return { rows: [{ account_id: extractionAccountId, account_name: 'Northstar' }], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO context_entries')) {
      const row = {
        id: `88888888-8888-4888-8888-${String(this.contextEntries.length + 1).padStart(12, '0')}`.slice(0, 36),
        tenant_id: params[0],
        subject_type: params[1],
        subject_id: params[2],
        context_type: params[3],
        authored_by: params[4],
        title: params[5],
        body: params[6],
        structured_data: this.parseJson(params[7], {}),
        confidence: params[8],
        memory_status: params[9],
        evidence: this.parseJson(params[10], []),
        tags: this.parseJson(params[11], []),
        source: params[12],
        source_ref: params[13],
        source_activity_id: params[14],
        valid_until: params[15],
        is_current: true,
        created_at: this.now(),
        updated_at: this.now(),
      };
      this.contextEntries.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO context_outbox')) {
      return { rows: [{ id: `outbox-${this.contextEntries.length}`, tenant_id: params[0], entity_type: params[1], entity_id: params[2], payload: this.parseJson(params[3], {}) }], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO raw_context_extraction_attempts')) {
      const row = {
        id: `99999999-9999-4999-8999-${String(this.attempts.length + 1).padStart(12, '0')}`.slice(0, 36),
        tenant_id: params[0],
        raw_context_source_id: params[1],
        activity_id: params[2],
        attempt_number: this.attempts.length + 1,
        status: 'running',
        stage: params[3],
        model: params[4],
        response_format: params[5],
        timeout_ms: params[6],
        prompt_version: params[7],
        input_summary: this.parseJson(params[8], {}),
        telemetry: {},
        output_summary: {},
        created_at: this.now(),
        updated_at: this.now(),
      };
      this.attempts.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('UPDATE raw_context_extraction_attempts')) {
      const row = this.attempts.find(item => item.id === params[1]);
      if (!row) return { rows: [], rowCount: 0 };
      row.status = params[2];
      row.outcome = params[3] ?? row.outcome;
      row.telemetry = { ...row.telemetry, ...this.parseJson(params[4], {}) };
      row.output_summary = { ...row.output_summary, ...this.parseJson(params[5], {}) };
      row.raw_output_excerpt = params[6] ?? row.raw_output_excerpt;
      row.repaired_output_excerpt = params[7] ?? row.repaired_output_excerpt;
      row.failure_code = params[8] ?? row.failure_code;
      row.failure_reason = params[9] ?? row.failure_reason;
      row.latency_ms = params[10] ?? row.latency_ms;
      row.completed_at = this.now();
      row.updated_at = this.now();
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO signal_groups')) {
      let row = this.signalGroups.find(group =>
        group.tenant_id === params[0]
          && group.subject_type === params[1]
          && group.subject_id === params[2]
          && group.context_type === params[3]
          && group.claim_key === params[4]
      );
      if (!row) {
        row = {
          id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(this.signalGroups.length + 1).padStart(12, '0')}`.slice(0, 36),
          tenant_id: params[0],
          subject_type: params[1],
          subject_id: params[2],
          context_type: params[3],
          claim_key: params[4],
          title: params[5],
          normalized_claim: params[6],
          status: 'gathering',
          aggregate_confidence: 0,
          support_count: 0,
          independent_source_count: 0,
          conflict_count: 0,
          evidence_count: 0,
          latest_signal_id: null,
          promoted_context_entry_id: null,
          blocked_reason: null,
          metadata: this.parseJson(params[7], {}),
          created_at: this.now(),
          updated_at: this.now(),
        };
        this.signalGroups.push(row);
      }
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO signal_group_members')) {
      const row = {
        id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(this.signalGroupMembers.length + 1).padStart(12, '0')}`.slice(0, 36),
        tenant_id: params[0],
        signal_group_id: params[1],
        context_entry_id: params[2],
        relation: params[3],
        similarity_score: params[4],
        evidence_weight: params[5],
        source_key: params[6],
        created_at: this.now(),
      };
      this.signalGroupMembers.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('UPDATE signal_groups SET status = $3')) {
      const row = this.signalGroups.find(group => group.id === params[1]);
      if (!row) return { rows: [], rowCount: 0 };
      row.status = params[2];
      row.aggregate_confidence = params[3];
      row.support_count = params[4];
      row.independent_source_count = params[5];
      row.conflict_count = params[6];
      row.evidence_count = params[7];
      row.latest_signal_id = params[8] ?? row.latest_signal_id;
      row.blocked_reason = params[9];
      row.metadata = { ...row.metadata, ...this.parseJson(params[10], {}) };
      row.updated_at = this.now();
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('UPDATE signal_groups SET metadata = metadata')) {
      const row = this.signalGroups.find(group => group.id === params[1]);
      if (!row) return { rows: [], rowCount: 0 };
      row.metadata = { ...row.metadata, ...this.parseJson(params[2], {}) };
      row.updated_at = this.now();
      return { rows: [row], rowCount: 1 };
    }

    throw new Error(`Unexpected extraction query: ${text}`);
  }
}

test('Raw Context corpus can replay through extraction write and grouping pipeline without a live model', async () => {
  const corpusPath = new URL('./fixtures/raw-context-golden-corpus.json', import.meta.url);
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
  const fixture = corpus.find(item => item.id === 'procurement_and_security_path');
  assert.ok(fixture);
  const db = new FakeExtractionDb(fixture);

  const result = await extractContextFromActivity(db, extractionTenantId, extractionActivityId, {
    modelOutputOverride: fixture.golden_model_output,
  });

  assert.equal(result.extracted_count, fixture.golden_model_output.context_entries.length);
  assert.equal(result.signals_created, fixture.golden_model_output.context_entries.length);
  assert.equal(result.memory_created, 0);
  assert.equal(db.contextEntries.length, fixture.golden_model_output.context_entries.length);
  assert.equal(db.signalGroups.length, fixture.golden_model_output.context_entries.length);
  assert.equal(db.signalGroupMembers.length, fixture.golden_model_output.context_entries.length);
  assert.ok(db.contextEntries.every(entry => entry.structured_data.readiness_status));
  assert.ok(db.contextEntries.every(entry => entry.evidence[0]?.source_content_hash === `corpus-${fixture.id}`));
  assert.ok(db.contextEntries.every(entry => entry.evidence[0]?.source_event_at_provided === true));
  const rawSource = db.rawContextSources.get(`add_context:${extractionActivityId}`);
  assert.equal(rawSource.status, 'needs_review');
  assert.equal(rawSource.signals_created, fixture.golden_model_output.context_entries.length);
  assert.equal(db.attempts[0].status, 'succeeded');
  assert.equal(db.attempts[0].telemetry.model_output_override, true);
  assert.equal(db.attempts[0].output_summary.context_entries, fixture.golden_model_output.context_entries.length);
  assert.ok(db.attempts[0].input_summary.extraction_packet.matched_subject_count > 0);
});

test('Raw Context corpus replay records a clean no-context receipt without creating Signals', async () => {
  const corpusPath = new URL('./fixtures/raw-context-golden-corpus.json', import.meta.url);
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
  const fixture = corpus.find(item => item.id === 'no_customer_specific_context');
  assert.ok(fixture);
  const db = new FakeExtractionDb(fixture);

  const result = await extractContextFromActivity(db, extractionTenantId, extractionActivityId, {
    modelOutputOverride: fixture.golden_model_output,
    targetSubjects: [
      { type: 'opportunity', id: extractionOpportunityId, name: 'Agent Context Rollout' },
    ],
  });

  assert.equal(result.extracted_count, 0);
  assert.equal(result.signals_created, 0);
  assert.equal(result.memory_created, 0);
  assert.equal(db.contextEntries.length, 0);
  assert.equal(db.signalGroups.length, 0);
  const rawSource = db.rawContextSources.get(`add_context:${extractionActivityId}`);
  assert.equal(rawSource.status, 'processed');
  assert.equal(rawSource.metadata.failure_code, 'model_returned_empty');
  assert.equal(db.attempts[0].status, 'succeeded');
  assert.equal(db.attempts[0].outcome, 'no_customer_specific_signals');
  assert.equal(db.attempts[0].telemetry.model_output_override, true);
});

class FakeContextIngestProposalDb {
  rawContextSources = new Map();
  payloads = [];
  hitlRequests = [];
  contextEntries = [];

  parseJson(value, fallback) {
    if (typeof value !== 'string') return value ?? fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  now() {
    return '2026-05-30T18:00:00.000Z';
  }

  rawKey(sourceType, sourceRef) {
    return `${sourceType}:${sourceRef}`;
  }

  rawSourceFromParams(params) {
    const key = this.rawKey(params[1], params[2]);
    const existing = this.rawContextSources.get(key);
    const row = {
      id: existing?.id ?? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      tenant_id: params[0],
      source_type: params[1],
      source_ref: params[2],
      source_label: params[3],
      subject_type: params[4],
      subject_id: params[5],
      actor_id: extractionActorId,
      status: params[7],
      stage: params[8],
      raw_excerpt: params[9],
      detected_subjects: this.parseJson(params[10], []),
      signals_created: params[11] ?? 0,
      memory_created: params[12] ?? 0,
      skipped: params[13] ?? 0,
      failure_reason: params[14],
      failure_code: params[15],
      attempt_count: params[16] ?? 0,
      locked_at: params[17],
      next_retry_at: params[18],
      last_error: params[19],
      metadata: this.parseJson(params[20], {}),
      processed_at: ['processed', 'needs_review', 'failed', 'skipped'].includes(params[7]) ? this.now() : null,
      created_at: existing?.created_at ?? this.now(),
      updated_at: this.now(),
    };
    this.rawContextSources.set(key, row);
    return row;
  }

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text === 'SELECT * FROM actors WHERE id = $1 AND tenant_id = $2') {
      return {
        rows: [{
          id: extractionActorId,
          tenant_id: params[1],
          actor_type: 'agent',
          display_name: 'Test Agent',
          agent_identifier: 'test-agent',
          role: 'admin',
          scopes: ['context:read', 'context:write'],
          created_at: this.now(),
          updated_at: this.now(),
        }],
        rowCount: 1,
      };
    }
    if (text.startsWith('SELECT id FROM ( SELECT id, 0 AS priority FROM actors')) {
      return { rows: [{ id: extractionActorId }], rowCount: 1 };
    }
    if (text.startsWith('SELECT * FROM raw_context_sources WHERE tenant_id = $1 AND source_type = $2 AND source_ref = $3')) {
      const row = this.rawContextSources.get(this.rawKey(params[1], params[2]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith('INSERT INTO raw_context_sources')) {
      const row = this.rawSourceFromParams(params);
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO raw_context_source_payloads')) {
      const row = {
        id: `dddddddd-dddd-4ddd-8ddd-${String(this.payloads.length + 1).padStart(12, '0')}`.slice(0, 36),
        tenant_id: params[0],
        raw_context_source_id: params[1],
        document_hash: params[2],
        document_text: params[3],
        source_label: params[4],
        source_occurred_at: params[5],
        subjects: this.parseJson(params[6], []),
        proposed_records: this.parseJson(params[7], []),
        metadata: this.parseJson(params[8], {}),
        created_at: this.now(),
        updated_at: this.now(),
      };
      this.payloads.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('SELECT id, name, action_type, condition, decision, priority FROM hitl_approval_rules')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith('SELECT * FROM hitl_requests WHERE tenant_id = $1 AND action_type = $2')) {
      const payload = this.parseJson(params[2], {});
      const existing = this.hitlRequests.find(request =>
        request.tenant_id === params[0]
          && request.action_type === params[1]
          && request.status === 'pending'
          && request.action_payload?.dedupe_key === payload.dedupe_key
      );
      return { rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 };
    }
    if (text.startsWith('INSERT INTO hitl_requests')) {
      const row = {
        id: `eeeeeeee-eeee-4eee-8eee-${String(this.hitlRequests.length + 1).padStart(12, '0')}`.slice(0, 36),
        tenant_id: params[0],
        agent_id: params[1],
        session_id: params[2],
        action_type: params[3],
        action_summary: params[4],
        action_payload: this.parseJson(params[5], {}),
        auto_approve_after: params[6],
        priority: params[7],
        sla_minutes: params[8],
        escalate_to_id: params[9],
        handoff_snapshot_id: params[10],
        status: 'pending',
        created_at: this.now(),
        updated_at: this.now(),
      };
      this.hitlRequests.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('UPDATE raw_context_sources')) {
      const key = this.rawKey(params[1], params[2]);
      const row = this.rawContextSources.get(key);
      if (!row) return { rows: [], rowCount: 0 };
      row.status = params[3] ?? row.status;
      row.stage = params[4] ?? row.stage;
      row.source_label = params[5] ?? row.source_label;
      row.subject_type = params[6] ?? row.subject_type;
      row.subject_id = params[7] ?? row.subject_id;
      row.actor_id = extractionActorId;
      row.raw_excerpt = params[9] ?? row.raw_excerpt;
      row.detected_subjects = params[10] ? this.parseJson(params[10], row.detected_subjects) : row.detected_subjects;
      row.signals_created = params[11] ?? row.signals_created;
      row.memory_created = params[12] ?? row.memory_created;
      row.skipped = params[13] ?? row.skipped;
      row.failure_reason = params[14];
      row.failure_code = params[15] ?? row.failure_code;
      row.metadata = { ...row.metadata, ...this.parseJson(params[20], {}) };
      row.processed_at = ['processed', 'needs_review', 'failed', 'skipped'].includes(row.status) ? this.now() : row.processed_at;
      row.updated_at = this.now();
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('SELECT subject_type, subject_id, memory_status')) {
      return { rows: [], rowCount: 0 };
    }

    throw new Error(`Unexpected context_ingest_auto query: ${text}`);
  }
}

test('context_ingest_auto routes proposed records to a deduped Handoff and reuses duplicate receipts', async () => {
  const db = new FakeContextIngestProposalDb();
  const tool = getAllTools(db).find(candidate => candidate.name === 'context_ingest_auto');
  assert.ok(tool);
  const actor = {
    tenant_id: extractionTenantId,
    actor_id: extractionActorId,
    actor_type: 'agent',
    role: 'admin',
    scopes: ['context:read', 'context:write'],
  };
  const input = {
    document: 'Nike wants to explore a separate customer success rollout for EMEA after the US pilot stabilizes.',
    source_label: 'Nike expansion note',
    source_occurred_at: '2026-05-16T19:00:00.000Z',
    confidence_threshold: 0.6,
    proposed_records: [{
      record_type: 'opportunity',
      name: 'Nike EMEA customer success rollout',
      confidence: 0.82,
      reason: 'The source names a separate EMEA rollout under Nike.',
      fields: { account_name: 'Nike', account_id: extractionAccountId, stage: 'qualification' },
    }],
  };

  const first = await tool.handler(input, actor);
  assert.equal(first.entries_created, 0);
  assert.equal(first.skipped, 0);
  assert.equal(first.proposed_records.length, 1);
  assert.equal(first.handoff_requests.length, 1);
  assert.equal(first.raw_context_source.status, 'needs_review');
  assert.equal(first.raw_context_source.metadata.failure_code, 'needs_record_review');
  assert.equal(db.hitlRequests.length, 1);
  assert.equal(db.hitlRequests[0].action_type, 'record.create.review');
  assert.equal(db.hitlRequests[0].action_payload.dedupe_key, 'opportunity:Nike EMEA customer success rollout'.toLowerCase());
  assert.equal(db.payloads[0].proposed_records.length, 1);

  const second = await tool.handler(input, actor);
  assert.equal(second.duplicate_of_raw_context_source_id, first.raw_context_source.id);
  assert.equal(second.message, 'This Raw Context source was already processed. Returning the existing receipt instead of extracting it again.');
  assert.equal(second.entries_created, 0);
  assert.equal(second.raw_context_source.status, 'needs_review');
  assert.equal(db.hitlRequests.length, 1);
});

test('context_ingest_auto duplicate source receipts do not create more Signals or corroboration', async () => {
  const db = new FakeContextIngestProposalDb();
  const tool = getAllTools(db).find(candidate => candidate.name === 'context_ingest_auto');
  assert.ok(tool);
  const actor = {
    tenant_id: extractionTenantId,
    actor_id: extractionActorId,
    actor_type: 'agent',
    role: 'admin',
    scopes: ['context:read', 'context:write'],
  };
  const input = {
    document: 'Maya said she will sponsor the evaluation with the VP of Sales.',
    source_label: 'Repeated champion note',
    source_occurred_at: '2026-05-12T17:00:00.000Z',
    confidence_threshold: 0.6,
    subjects: [{ type: 'opportunity', id: extractionOpportunityId, name: 'Agent Context Rollout' }],
  };
  const sourceRef = `auto:${createHash('sha256').update(JSON.stringify({
    document_hash: createHash('sha256').update(input.document).digest('hex'),
    actor_id: actor.actor_id,
    actor_type: actor.actor_type,
    source_type: 'mcp',
    source_occurred_at: new Date(input.source_occurred_at).toISOString(),
    subjects: input.subjects.map(subject => `${subject.type}:${subject.id}`).sort(),
  })).digest('hex').slice(0, 32)}`;
  db.rawContextSources.set(`mcp:${sourceRef}`, {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    tenant_id: extractionTenantId,
    source_type: 'mcp',
    source_ref: sourceRef,
    source_label: input.source_label,
    subject_type: 'opportunity',
    subject_id: extractionOpportunityId,
    actor_id: extractionActorId,
    status: 'needs_review',
    stage: 'promote_or_review',
    detected_subjects: [{
      subject_type: 'opportunity',
      subject_id: extractionOpportunityId,
      name: 'Agent Context Rollout',
      confidence: 'high',
      entries_created: 1,
      memory_created: 0,
      signals_created: 1,
    }],
    signals_created: 1,
    memory_created: 0,
    skipped: 0,
    metadata: { source_document_hash: 'existing-hash' },
    created_at: '2026-05-30T18:00:00.000Z',
    updated_at: '2026-05-30T18:00:00.000Z',
  });

  const result = await tool.handler(input, actor);
  assert.equal(result.duplicate_of_raw_context_source_id, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
  assert.equal(result.entries_created, 1);
  assert.equal(result.signals_created, 1);
  assert.equal(result.memory_created, 0);
  assert.equal(result.mutation.side_effects.includes('context_extraction:deduped'), true);
  assert.equal(db.contextEntries.length, 0);
  assert.equal(db.hitlRequests.length, 0);
});

test('Raw Context source list does not leak no-subject peer receipts to scoped users', async () => {
  const db = {
    queries: [],
    params: [],
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      this.queries.push(text);
      this.params.push(params);
      if (text.startsWith('SELECT count(*)::int AS total')) return { rows: [{ total: 0 }], rowCount: 1 };
      if (text.startsWith('SELECT r.* FROM raw_context_sources')) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await listRawContextSources(db, extractionTenantId, {
    owner_ids: ['99999999-9999-4999-8999-999999999901'],
    actor_ids: [extractionActorId],
    limit: 20,
  });

  assert.match(db.queries[0], /r\.subject_id IS NULL AND r\.actor_id = ANY\(\$3::uuid\[\]\)/);
  assert.doesNotMatch(db.queries[0], /r\.subject_id IS NULL\s+OR/);
  assert.deepEqual(db.params[0], [
    extractionTenantId,
    ['99999999-9999-4999-8999-999999999901'],
    [extractionActorId],
    21,
  ]);
});

test('Raw Context source list still returns own no-subject receipts when no owned records are visible', async () => {
  const db = {
    queries: [],
    params: [],
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      this.queries.push(text);
      this.params.push(params);
      if (text.startsWith('SELECT count(*)::int AS total')) return { rows: [{ total: 0 }], rowCount: 1 };
      if (text.startsWith('SELECT r.* FROM raw_context_sources')) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await listRawContextSources(db, extractionTenantId, {
    owner_ids: [],
    actor_ids: [extractionActorId],
    limit: 20,
  });

  assert.match(db.queries[0], /r\.subject_id IS NULL AND r\.actor_id = ANY\(\$2::uuid\[\]\)/);
  assert.doesNotMatch(db.queries[0], /\bFALSE\b/);
  assert.deepEqual(db.params[0], [
    extractionTenantId,
    [extractionActorId],
    21,
  ]);
});

class FakeEntityResolveDb {
  contacts = [
    { id: 'contact-nike-jacob', first_name: 'Jacob', last_name: '', name: 'Jacob', email: 'jacob@nike.example', title: 'Director', company_name: 'Nike', account_id: 'acct-nike', account_name: 'Nike', aliases: [] },
    { id: 'contact-acme-jacob', first_name: 'Jacob', last_name: '', name: 'Jacob', email: 'jacob@acme.example', title: 'Director', company_name: 'Acme', account_id: 'acct-acme', account_name: 'Acme', aliases: [] },
  ];

  accounts = [
    { id: 'acct-nike', name: 'Nike', domain: 'nike.example', aliases: ['NKE'], merged_into: null },
    { id: 'acct-acme', name: 'Acme', domain: 'acme.example', aliases: [], merged_into: null },
    { id: 'acct-merged', name: 'MergedCo', domain: 'merged.example', aliases: [], merged_into: 'acct-nike' },
  ];

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('WITH ids AS')) return { rows: [], rowCount: 0 };
    if (text.includes('FROM contacts c')) {
      let rows = this.contacts;
      if (text.includes('LOWER(c.email)')) {
        rows = rows.filter(row => row.email.toLowerCase() === String(params[1]).toLowerCase());
      } else if (text.includes('LOWER(c.first_name)')) {
        rows = rows.filter(row => row.first_name.toLowerCase() === String(params[1]).toLowerCase());
        const last = String(params[2] ?? '');
        if (last) rows = rows.filter(row => row.last_name.toLowerCase() === last.toLowerCase());
      } else if (text.includes('LOWER(_a) =')) {
        rows = rows.filter(row => row.aliases.some(alias => alias.toLowerCase() === String(params[1]).toLowerCase()));
      } else if (text.includes('ILIKE')) {
        const q = String(params[1] ?? '').replace(/%/g, '').toLowerCase();
        rows = rows.filter(row => [row.first_name, row.last_name, row.email, row.company_name, ...row.aliases].some(value => String(value ?? '').toLowerCase().includes(q)));
      }
      if (text.includes('a.name ILIKE') || text.includes('c.company_name ILIKE')) {
        const hint = params.find(value => typeof value === 'string' && value.includes('%Nike%'));
        if (hint) rows = rows.filter(row => row.account_name === 'Nike' || row.company_name === 'Nike');
      }
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith('SELECT id, name FROM accounts WHERE id = ANY')) {
      return { rows: this.accounts.filter(row => params[0].includes(row.id)), rowCount: 0 };
    }
    if (text.includes('FROM accounts')) {
      let rows = this.accounts;
      if (text.includes('merged_into IS NULL')) rows = rows.filter(row => !row.merged_into);
      if (text.includes('similarity(')) {
        rows = [];
      } else if (text.includes('LOWER(domain)')) {
        rows = rows.filter(row => row.domain.toLowerCase() === String(params[1]).toLowerCase());
      } else if (text.includes('LOWER(name)')) {
        rows = rows.filter(row => row.name.toLowerCase() === String(params[1]).toLowerCase());
      } else if (text.includes('LOWER(_a) =')) {
        rows = rows.filter(row => row.aliases.some(alias => alias.toLowerCase() === String(params[1]).toLowerCase()));
      } else if (text.includes('ILIKE')) {
        const q = String(params[1] ?? '').replace(/%/g, '').toLowerCase();
        rows = rows.filter(row => [row.name, row.domain, ...row.aliases].some(value => String(value ?? '').toLowerCase().includes(q)));
      }
      return { rows, rowCount: rows.length };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

test('entityResolve applies company hints to exact contact-name ambiguity', async () => {
  const result = await entityResolve(new FakeEntityResolveDb(), extractionTenantId, {
    query: 'Jacob',
    entity_type: 'contact',
    context_hints: { company_name: 'Nike' },
    limit: 5,
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.resolved.id, 'contact-nike-jacob');
  assert.equal(result.resolved.account_name, 'Nike');
});

test('entityResolve does not resolve merged account records', async () => {
  const result = await entityResolve(new FakeEntityResolveDb(), extractionTenantId, {
    query: 'MergedCo',
    entity_type: 'account',
    limit: 5,
  });

  assert.equal(result.status, 'not_found');
});

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

  async query(sql) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.includes('FROM contacts c') && text.includes('LEFT JOIN accounts a')) return { rows: this.contacts, rowCount: this.contacts.length };
    if (text.includes('FROM accounts') && text.includes('ORDER BY updated_at')) return { rows: this.accounts, rowCount: this.accounts.length };
    if (text.includes('FROM opportunities o')) return { rows: this.opportunities, rowCount: this.opportunities.length };
    if (text.includes('FROM use_cases uc')) return { rows: this.useCases, rowCount: this.useCases.length };
    throw new Error(`Unexpected query: ${text}`);
  }
}

class FakeAmbiguousAccountChildDb extends FakeRawSubjectDb {
  constructor() {
    super();
    this.contacts = [
      ...this.contacts,
      { id: 'contact-nike-maya-duplicate', first_name: 'Maya', last_name: 'Patel', name: 'Maya Patel', email: 'maya.dup@nike.example', title: 'Program Manager', company_name: 'Nike', account_id: 'acct-nike', account_domain: 'nike.example', aliases: [] },
    ];
    this.opportunities = [
      ...this.opportunities,
      { id: 'opp-nike-pegasus-duplicate', name: 'Pegasus expansion', account_id: 'acct-nike', account_name: 'Nike', contact_id: 'contact-nike-maya', contact_name: 'Maya Patel', stage: 'proposal', close_date: '2026-08-15' },
    ];
    this.useCases = [
      ...this.useCases,
      { id: 'uc-nike-forecasting-duplicate', name: 'Forecast automation', account_id: 'acct-nike', account_name: 'Nike', opportunity_id: 'opp-nike-pegasus-duplicate', opportunity_name: 'Pegasus expansion', stage: 'planning' },
    ];
  }
}

class FakeRawSubjectModelDb extends FakeRawSubjectDb {
  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text === 'SELECT * FROM agent_configs WHERE tenant_id = $1') {
      return {
        rows: [{
          tenant_id: params[0],
          enabled: true,
          provider: 'custom',
          model: 'resolution-corpus-model',
          base_url: 'http://resolution-corpus.local',
          api_key_enc: null,
        }],
        rowCount: 1,
      };
    }
    return super.query(sql, params);
  }
}

class FakeAmbiguousAccountChildModelDb extends FakeAmbiguousAccountChildDb {
  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text === 'SELECT * FROM agent_configs WHERE tenant_id = $1') {
      return {
        rows: [{
          tenant_id: params[0],
          enabled: true,
          provider: 'custom',
          model: 'resolution-corpus-model',
          base_url: 'http://resolution-corpus.local',
          api_key_enc: null,
        }],
        rowCount: 1,
      };
    }
    return super.query(sql, params);
  }
}

async function withMockSubjectDetectionLLM(candidates, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({ candidates }),
        },
      }],
    }),
    text: async () => JSON.stringify({ candidates }),
  });
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('Record resolution golden corpus covers account-scoped and ambiguous GTM references', async () => {
  const corpusPath = new URL('./fixtures/record-resolution-golden-corpus.json', import.meta.url);
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
  assert.ok(Array.isArray(corpus));
  assert.ok(corpus.length >= 8);

  const ids = new Set(corpus.map(item => item.id));
  for (const required of [
    'account_name_scopes_child_records',
    'account_alias_scopes_child_records',
    'account_domain_scopes_contact',
    'same_first_name_without_account_scope_is_ambiguous',
    'same_full_name_without_account_scope_is_ambiguous',
    'same_opportunity_name_without_account_scope_is_ambiguous',
    'same_use_case_name_without_account_scope_is_ambiguous',
    'account_scope_disambiguates_use_case',
  ]) {
    assert.ok(ids.has(required), `missing record resolution fixture ${required}`);
  }

  for (const fixture of corpus) {
    const detected = await detectRawContextSubjects(
      new FakeRawSubjectDb(),
      baseInput.tenantId,
      fixture.document,
      { limit: 10 },
    );
    for (const expected of fixture.expected_subjects ?? []) {
      assert.ok(
        detected.subjects.some(subject => subject.type === expected.type && subject.id === expected.id),
        `${fixture.id} should resolve ${expected.type}:${expected.id}`,
      );
    }
    for (const forbiddenId of fixture.forbidden_subject_ids ?? []) {
      assert.equal(
        detected.subjects.some(subject => subject.id === forbiddenId),
        false,
        `${fixture.id} should not resolve ${forbiddenId}`,
      );
    }
    for (const expectedSkip of fixture.expected_skipped ?? []) {
      assert.ok(
        detected.skipped.some(item => item.name === expectedSkip.name && item.reason === expectedSkip.reason),
        `${fixture.id} should skip ${expectedSkip.name} as ${expectedSkip.reason}`,
      );
    }
    for (const expectedScope of fixture.expected_account_scope ?? []) {
      const scope = detected.account_scope?.find(item => item.account_id === expectedScope.account_id);
      assert.ok(scope, `${fixture.id} should include account scope ${expectedScope.account_id}`);
      for (const key of ['contacts_checked', 'opportunities_checked', 'use_cases_checked']) {
        if (expectedScope[key] !== undefined) {
          assert.equal(scope[key], expectedScope[key], `${fixture.id} ${key}`);
        }
      }
    }
    assert.equal(detected.records_examined.accounts, 2, `${fixture.id} should report accounts examined`);
    assert.equal(detected.records_examined.contacts, 4, `${fixture.id} should report contacts examined`);
    assert.equal(detected.records_examined.opportunities, 2, `${fixture.id} should report opportunities examined`);
    assert.equal(detected.records_examined.use_cases, 2, `${fixture.id} should report use cases examined`);
  }
});

test('Raw Context model candidates do not over-link ambiguous child records', async () => {
  await withMockSubjectDetectionLLM([{
    name: 'Pegasus expansion',
    entity_type: 'opportunity',
    account_name: 'Nike',
    confidence: 0.9,
    rationale: 'The model believes the source references the Nike Pegasus expansion.',
  }], async () => {
    const detected = await detectRawContextSubjects(
      new FakeAmbiguousAccountChildModelDb(),
      baseInput.tenantId,
      'The customer said the project needs a refreshed security plan.',
      { limit: 10 },
    );

    assert.equal(detected.subjects.some(subject => subject.id === 'opp-nike-pegasus'), false);
    assert.equal(detected.subjects.some(subject => subject.id === 'opp-nike-pegasus-duplicate'), false);
    const skipped = detected.skipped.find(item => item.name === 'Pegasus expansion');
    assert.equal(skipped.reason, 'ambiguous_within_account_scope');
    assert.equal(skipped.candidate_count, 2);
    assert.equal(skipped.candidate_records.length, 2);
  });
});

test('Raw Context account-only matches can propose model-detected new child records', async () => {
  await withMockSubjectDetectionLLM([{
    name: 'Nike EMEA customer success rollout',
    entity_type: 'opportunity',
    account_name: 'Nike',
    stage: 'qualification',
    confidence: 0.82,
    rationale: 'The source describes a new rollout under Nike that is not in the scoped directory.',
  }], async () => {
    const detected = await detectRawContextSubjects(
      new FakeRawSubjectModelDb(),
      baseInput.tenantId,
      'Nike is discussing a new EMEA customer success rollout for next quarter.',
      { limit: 10 },
    );

    assert.ok(detected.subjects.some(subject => subject.type === 'account' && subject.id === 'acct-nike'));
    assert.equal(detected.subjects.some(subject => subject.type === 'opportunity' && subject.name === 'Nike EMEA customer success rollout'), false);
    assert.equal(detected.proposed_records.length, 1);
    assert.equal(detected.proposed_records[0].record_type, 'opportunity');
    assert.equal(detected.proposed_records[0].fields.account_id, 'acct-nike');
    assert.equal(detected.proposed_records[0].fields.account_name, 'Nike');
    assert.match(detected.resolution_summary, /possible new record needs review/);
  });
});

test('customer_record_resolve exposes the account-first subject graph to MCP callers', async () => {
  const tool = getAllTools(new FakeRawSubjectDb()).find(candidate => candidate.name === 'customer_record_resolve');
  assert.ok(tool);
  const result = await tool.handler({
    text: 'We are working with Nike on the Pegasus expansion. Jacob can join the workshop next week.',
    subject_type: 'opportunity',
  }, {
    tenant_id: baseInput.tenantId,
    actor_id: 'admin-user',
    actor_type: 'user',
    role: 'admin',
    scopes: ['context:read'],
  });

  assert.equal(result.resolver, 'subject_graph');
  assert.equal(result.subject_type, 'opportunity');
  assert.ok(result.subjects.some(subject => subject.type === 'account' && subject.id === 'acct-nike'));
  assert.ok(result.subjects.some(subject => subject.type === 'opportunity' && subject.id === 'opp-nike-pegasus'));
  assert.equal(result.subjects.some(subject => subject.type === 'contact'), false);
  assert.equal(result.account_scope[0].account_id, 'acct-nike');
});

test('customer_record_resolve requires context read scope for scoped agent actors', () => {
  const visible = getToolsForActor(new FakeRawSubjectDb(), {
    tenant_id: baseInput.tenantId,
    actor_id: 'limited-agent',
    actor_type: 'agent',
    role: 'member',
    scopes: ['contacts:read'],
  });

  assert.equal(visible.some(tool => tool.name === 'customer_record_resolve'), false);
});

test('Raw Context ingest surfaces use the shared Subject Graph resolver', async () => {
  const contextToolsSource = await readFile(new URL('../src/mcp/tools/context-entries.ts', import.meta.url), 'utf8');
  const restRouterSource = await readFile(new URL('../src/rest/router.ts', import.meta.url), 'utf8');
  assert.match(contextToolsSource, /resolveSubjectGraph/);
  assert.doesNotMatch(contextToolsSource, /detectRawContextSubjects/);
  assert.match(restRouterSource, /resolveSubjectGraph/);
  assert.doesNotMatch(restRouterSource, /detectRawContextSubjects/);
});

test('agent guidance exposes one primary customer resolver path', async () => {
  const engineSource = await readFile(new URL('../src/agent/engine.ts', import.meta.url), 'utf8');
  const subjectGraphSource = await readFile(new URL('../src/mcp/tools/subject-graph.ts', import.meta.url), 'utf8');
  const accountToolsSource = await readFile(new URL('../src/mcp/tools/accounts.ts', import.meta.url), 'utf8');
  const contactToolsSource = await readFile(new URL('../src/mcp/tools/contacts.ts', import.meta.url), 'utf8');

  assert.match(engineSource, /Use customer_record_resolve as the primary customer-record resolver/);
  assert.match(subjectGraphSource, /For messy transcripts, emails, notes, or research that should become Signals and Memory, call context_ingest_auto instead/);
  assert.match(accountToolsSource, /use customer_record_resolve to check if the customer already exists/);
  assert.match(contactToolsSource, /use customer_record_resolve with the contact name, email, and account context/);
  assert.doesNotMatch(accountToolsSource, /prefer using entity_resolve/);
  assert.doesNotMatch(contactToolsSource, /prefer using entity_resolve/);
});

test('Customer Email and Activity enrich association through Subject Graph', async () => {
  const emailSource = await readFile(new URL('../src/services/customer-email.ts', import.meta.url), 'utf8');
  const activitySource = await readFile(new URL('../src/services/customer-activity.ts', import.meta.url), 'utf8');

  for (const source of [emailSource, activitySource]) {
    assert.match(source, /resolveSubjectGraphForSource/);
    assert.match(source, /association_resolution_summary/);
    assert.match(source, /association_ambiguity_count/);
    assert.doesNotMatch(source, /function pickScopedOpportunity/);
    assert.doesNotMatch(source, /function pickScopedUseCase/);
  }
});

test('Raw Context subject detection does not over-link duplicate contacts inside one account scope', async () => {
  const detected = await detectRawContextSubjects(
    new FakeAmbiguousAccountChildDb(),
    baseInput.tenantId,
    'Nike said Maya Patel should join the security review.',
    { limit: 10 },
  );

  assert.ok(detected.subjects.some(subject => subject.type === 'account' && subject.id === 'acct-nike'));
  assert.equal(detected.subjects.some(subject => subject.id === 'contact-nike-maya'), false);
  assert.equal(detected.subjects.some(subject => subject.id === 'contact-nike-maya-duplicate'), false);
  assert.ok(detected.skipped.some(item => item.name === 'Maya Patel' && item.reason === 'ambiguous_within_account_scope'));
});

test('Raw Context subject detection does not over-link duplicate opportunities inside one account scope', async () => {
  const detected = await detectRawContextSubjects(
    new FakeAmbiguousAccountChildDb(),
    baseInput.tenantId,
    'Nike wants the Pegasus expansion security plan updated.',
    { limit: 10 },
  );

  assert.ok(detected.subjects.some(subject => subject.type === 'account' && subject.id === 'acct-nike'));
  assert.equal(detected.subjects.some(subject => subject.id === 'opp-nike-pegasus'), false);
  assert.equal(detected.subjects.some(subject => subject.id === 'opp-nike-pegasus-duplicate'), false);
  assert.ok(detected.skipped.some(item => item.name === 'Pegasus expansion' && item.reason === 'ambiguous_within_account_scope'));
});

test('Raw Context subject detection does not over-link duplicate use cases inside one account scope', async () => {
  const detected = await detectRawContextSubjects(
    new FakeAmbiguousAccountChildDb(),
    baseInput.tenantId,
    'Nike wants the Forecast automation use case reviewed before the workshop.',
    { limit: 10 },
  );

  assert.ok(detected.subjects.some(subject => subject.type === 'account' && subject.id === 'acct-nike'));
  assert.equal(detected.subjects.some(subject => subject.id === 'uc-nike-forecasting'), false);
  assert.equal(detected.subjects.some(subject => subject.id === 'uc-nike-forecasting-duplicate'), false);
  assert.ok(detected.skipped.some(item => item.name === 'Forecast automation' && item.reason === 'ambiguous_within_account_scope'));
});

test('Raw Context subject detection narrows child records to the matched account', async () => {
  const detected = await detectRawContextSubjects(
    new FakeRawSubjectDb(),
    baseInput.tenantId,
    'We are working with Nike on the Pegasus expansion. Jacob can join the workshop next week.',
    { limit: 10 },
  );

  assert.ok(detected.subjects.some(subject => subject.type === 'account' && subject.id === 'acct-nike'));
  assert.ok(detected.subjects.some(subject => subject.type === 'opportunity' && subject.id === 'opp-nike-pegasus'));
  assert.ok(detected.subjects.some(subject => subject.type === 'contact' && subject.id === 'contact-nike-jacob'));
  assert.equal(detected.subjects.some(subject => subject.id === 'opp-acme-pegasus'), false);
  assert.equal(detected.subjects.some(subject => subject.id === 'contact-acme-jacob'), false);
  assert.equal(detected.account_scope[0].opportunities_checked, 1);
  assert.match(detected.resolution_summary, /Matched Nike/);
});

test('Raw Context subject detection uses account aliases to scope child matches', async () => {
  const detected = await detectRawContextSubjects(
    new FakeRawSubjectDb(),
    baseInput.tenantId,
    'NKE wants to expand the Pegasus expansion next quarter.',
    { limit: 10 },
  );

  assert.ok(detected.subjects.some(subject => subject.type === 'account' && subject.id === 'acct-nike'));
  assert.ok(detected.subjects.some(subject => subject.type === 'opportunity' && subject.id === 'opp-nike-pegasus'));
  assert.equal(detected.subjects.some(subject => subject.id === 'opp-acme-pegasus'), false);
});

test('Raw Context subject detection does not over-link same-named contacts without account scope', async () => {
  const detected = await detectRawContextSubjects(
    new FakeRawSubjectDb(),
    baseInput.tenantId,
    'Maya Patel said the rollout needs a security review.',
    { limit: 10 },
  );

  assert.equal(detected.subjects.some(subject => subject.id === 'contact-nike-maya'), false);
  assert.equal(detected.subjects.some(subject => subject.id === 'contact-acme-maya'), false);
  assert.ok(detected.skipped.some(item => item.reason === 'ambiguous_without_account_scope'));
});

test('Raw Context subject detection does not over-link same-named opportunities without account scope', async () => {
  const detected = await detectRawContextSubjects(
    new FakeRawSubjectDb(),
    baseInput.tenantId,
    'The Pegasus expansion needs an updated security plan.',
    { limit: 10 },
  );

  assert.equal(detected.subjects.some(subject => subject.id === 'opp-nike-pegasus'), false);
  assert.equal(detected.subjects.some(subject => subject.id === 'opp-acme-pegasus'), false);
  assert.ok(detected.skipped.some(item => item.name === 'Pegasus expansion' && item.reason === 'ambiguous_without_account_scope'));
});

test('Raw Context subject detection scopes use cases under the matched account', async () => {
  const detected = await detectRawContextSubjects(
    new FakeRawSubjectDb(),
    baseInput.tenantId,
    'Nike wants the Forecast automation use case reviewed before the next workshop.',
    { limit: 10 },
  );

  assert.ok(detected.subjects.some(subject => subject.type === 'use_case' && subject.id === 'uc-nike-forecasting'));
  assert.equal(detected.subjects.some(subject => subject.id === 'uc-acme-forecasting'), false);
  assert.equal(detected.account_scope[0].use_cases_checked, 1);
});

test('Signal grouping recognizes semantically related GTM claims beyond token overlap', () => {
  const score = __testSignalGrouping.semanticClaimScore(
    'Finance wants proof that the agent workflow reduces manual CRM updates.',
    'Budget approval is unresolved until the business case shows ROI.',
  );
  assert.ok(score >= 0.42, `expected finance/budget claims to be groupable, got ${score}`);
});

test('Signal relation verifier JSON parser accepts support/conflict decisions', () => {
  const decision = __testSignalGrouping.parseRelationDecision('{"relation":"conflicts","confidence":0.82,"rationale":"One says security is approved and the other says security is blocked."}');
  assert.deepEqual(decision, {
    relation: 'conflicts',
    confidence: 0.82,
    rationale: 'One says security is approved and the other says security is blocked.',
    method: 'llm',
  });
});

class FakeRecoveryDb {
  row = { id: '55555555-5555-4555-8555-555555555555', status: 'failed' };
  recoveryLog = [];

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.startsWith('SELECT id, status FROM context_outbox')) {
      return params[1] === this.row.id ? { rows: [this.row], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (text.startsWith('UPDATE context_outbox') && text.includes("status = 'pending'")) {
      this.row = { ...this.row, status: 'pending' };
      return { rows: [this.row], rowCount: 1 };
    }

    if (text.startsWith('INSERT INTO ops_recovery_log')) {
      this.recoveryLog.push(params);
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${text}`);
  }
}

const recoveryActor = {
  tenant_id: baseInput.tenantId,
  actor_id: 'recovery-actor',
  actor_type: 'user',
  role: 'admin',
};

const memberActor = {
  tenant_id: baseInput.tenantId,
  actor_id: 'member-actor',
  actor_type: 'user',
  role: 'member',
  scopes: ['read', 'write', 'extended', 'analytics'],
};

class FakeAgentConfigDb {
  constructor(configPatch = {}) {
    this.config = {
      id: 'agent-config-1',
      tenant_id: baseInput.tenantId,
      enabled: true,
      provider: 'openai_compatible',
      base_url: 'http://localhost:11434/v1',
      model: 'local-tool-model',
      max_tokens_per_turn: 1200,
      can_write_objects: true,
      can_log_activities: true,
      can_create_assignments: true,
      ...configPatch,
    };
  }

  async query(sql) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT * FROM agent_configs')) {
      return { rows: [this.config], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

test('recoverOperationalJob retries context outbox jobs and records an audit entry', async () => {
  const db = new FakeRecoveryDb();
  const result = await recoverOperationalJob(
    db,
    recoveryActor,
    'context_outbox',
    db.row.id,
    'retry',
    'operator retry after fixing search index',
  );

  assert.deepEqual(result, {
    queue_name: 'context_outbox',
    job_id: db.row.id,
    action: 'retry',
    previous_status: 'failed',
    new_status: 'pending',
    recovered: true,
  });
  assert.equal(db.recoveryLog.length, 1);
  assert.equal(db.recoveryLog[0][3], 'retry');
  assert.equal(db.recoveryLog[0][4], 'failed');
  assert.equal(db.recoveryLog[0][5], 'pending');
});

test('recoverOperationalJob rejects unsupported workflow retries', async () => {
  const db = new FakeRecoveryDb();
  await assert.rejects(
    () => recoverOperationalJob(db, recoveryActor, 'workflow_runs', db.row.id, 'retry'),
    err => err?.code === 'VALIDATION_ERROR' && err?.status === 422,
  );
});

class FakeRawContextRecoveryDb {
  row = { id: '66666666-6666-4666-8666-666666666666', status: 'processing' };
  recoveryLog = [];

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT id, status FROM raw_context_sources')) {
      return params[1] === this.row.id ? { rows: [this.row], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (text.startsWith('UPDATE raw_context_sources') && text.includes("status = 'pending'")) {
      this.row = { ...this.row, status: 'pending' };
      return { rows: [this.row], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO ops_recovery_log')) {
      this.recoveryLog.push(params);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

test('recoverOperationalJob can retry stale Raw Context receipts', async () => {
  const db = new FakeRawContextRecoveryDb();
  const result = await recoverOperationalJob(
    db,
    recoveryActor,
    'raw_context_sources',
    db.row.id,
    'retry',
    'retry interrupted extraction',
  );

  assert.equal(result.queue_name, 'raw_context_sources');
  assert.equal(result.previous_status, 'processing');
  assert.equal(result.new_status, 'pending');
  assert.equal(db.recoveryLog.length, 1);
});

test('claimPendingRawContextSources leases only pending retryable receipts', async () => {
  const claimedRows = [{
    id: '77777777-7777-4777-8777-777777777777',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    source_type: 'add_context',
    source_ref: 'auto:test',
    status: 'processing',
    stage: 'worker_claimed',
    attempt_count: 2,
    detected_subjects: [],
    signals_created: 0,
    memory_created: 0,
    skipped: 0,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }];
  const db = {
    async query(sql, params) {
      const text = sql.replace(/\s+/g, ' ').trim();
      assert.match(text, /FOR UPDATE SKIP LOCKED/);
      assert.match(text, /status = 'pending'/);
      assert.equal(params[0], 5);
      return { rows: claimedRows, rowCount: claimedRows.length };
    },
  };

  const claimed = await claimPendingRawContextSources(db, 5);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].stage, 'worker_claimed');
});

class FakeContradictionAssignmentDb {
  assignments = [];
  existingKeys = new Set();

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('FROM context_entries c1 JOIN context_entries c2')) {
      return {
        rows: [{
          a_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          a_title: 'Budget note A',
          a_body: 'Budget is 100000.',
          a_confidence: 0.7,
          a_structured_data: { budget: 100000 },
          a_context_type: 'decision',
          a_created_at: '2026-01-01T00:00:00.000Z',
          a_updated_at: '2026-01-01T00:00:00.000Z',
          a_authored_by: '11111111-1111-4111-8111-111111111111',
          a_tags: [],
          a_is_current: true,
          a_supersedes_id: null,
          a_source: null,
          a_source_ref: null,
          a_source_activity_id: null,
          a_valid_until: null,
          a_reviewed_at: null,
          b_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          b_title: 'Budget note B',
          b_body: 'Budget is 250000.',
          b_confidence: 0.9,
          b_structured_data: { budget: 250000 },
          b_created_at: '2026-01-02T00:00:00.000Z',
          b_updated_at: '2026-01-02T00:00:00.000Z',
          b_authored_by: '22222222-2222-4222-8222-222222222222',
          b_tags: [],
          b_is_current: true,
          b_supersedes_id: null,
          b_source: null,
          b_source_ref: null,
          b_source_activity_id: null,
          b_valid_until: null,
          b_reviewed_at: null,
        }],
        rowCount: 1,
      };
    }

    if (text.startsWith('SELECT id FROM assignments')) {
      return this.existingKeys.has(params[1])
        ? { rows: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (text.startsWith('INSERT INTO assignments')) {
      const assignment = {
        id: `dddddddd-dddd-4ddd-8ddd-${String(this.assignments.length + 1).padStart(12, '0')}`,
        tenant_id: params[0],
        title: params[1],
        description: params[2],
        assignment_type: params[3],
        assigned_by: params[4],
        assigned_to: params[5],
        subject_type: params[6],
        subject_id: params[7],
        priority: params[8],
        due_at: params[9],
        context: params[10],
        metadata: JSON.parse(params[11]),
        status: 'pending',
      };
      this.assignments.push(assignment);
      this.existingKeys.add(assignment.metadata.contradiction_key);
      return { rows: [assignment], rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${text}`);
  }
}

test('createContradictionReviewAssignments creates one deduped review assignment', async () => {
  const db = new FakeContradictionAssignmentDb();
  const result = await createContradictionReviewAssignments(
    db,
    baseInput.tenantId,
    recoveryActor.actor_id,
    {
      subject_type: 'opportunity',
      subject_id: '99999999-9999-4999-8999-999999999999',
      context_type: 'decision',
    },
  );

  assert.equal(result.assignments.length, 1);
  assert.equal(result.skipped_existing, 0);
  assert.equal(result.assignments[0].assignment_type, 'contradiction_review');
  assert.equal(result.assignments[0].assigned_to, '22222222-2222-4222-8222-222222222222');
  assert.equal(result.assignments[0].metadata.conflict_field, 'budget');

  const replay = await createContradictionReviewAssignments(
    db,
    baseInput.tenantId,
    recoveryActor.actor_id,
    {
      subject_type: 'opportunity',
      subject_id: '99999999-9999-4999-8999-999999999999',
      context_type: 'decision',
    },
  );
  assert.equal(replay.assignments.length, 0);
  assert.equal(replay.skipped_existing, 1);
});

class FakeDataQualityDb {
  async query(sql) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.includes('invalid_contact_lifecycle_stage')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('lifecycle_stage NOT IN')) {
      return { rows: [{ id: 'bad-contact', lifecycle_stage: 'stuck' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

test('getDataQualityReport summarizes data drift findings', async () => {
  const report = await getDataQualityReport(new FakeDataQualityDb(), baseInput.tenantId, 10);

  assert.equal(report.summary.total_findings, 1);
  assert.equal(report.summary.critical, 1);
  assert.equal(report.summary.warning, 0);
  assert.equal(report.checks.find(check => check.name === 'invalid_contact_lifecycle_stage')?.count, 1);
});

test('sensitive admin tools are hidden from non-admin actors', () => {
  const memberTools = getToolsForActor({}, memberActor).map(tool => tool.name);
  const adminTools = getToolsForActor({}, recoveryActor).map(tool => tool.name);
  const systemsOnlyTools = getToolsForActor({}, { ...memberActor, scopes: ['systems:write', 'extended'] }).map(tool => tool.name);
  const systemsContactTools = getToolsForActor({}, { ...memberActor, scopes: ['systems:write', 'contacts:write', 'extended'] }).map(tool => tool.name);

  assert.equal(memberTools.includes('ops_pii_redact'), false);
  assert.equal(memberTools.includes('ops_data_quality_repair'), false);
  assert.equal(memberTools.includes('workflow_run_replay'), false);
  assert.equal(memberTools.includes('sor_system_create'), false);
  assert.equal(memberTools.includes('sor_sync_run'), false);
  assert.equal(systemsOnlyTools.includes('sor_sync_run'), true);
  assert.equal(systemsOnlyTools.includes('sor_writeback_request'), false);
  assert.equal(systemsContactTools.includes('sor_writeback_request'), true);
  assert.equal(adminTools.includes('ops_pii_redact'), true);
  assert.equal(adminTools.includes('ops_data_quality_repair'), true);
  assert.equal(adminTools.includes('workflow_run_replay'), true);
  assert.equal(adminTools.includes('sor_system_create'), true);
});

test('MCP manifests keep scoped agents focused and expose the router first', async () => {
  const readOnlyTools = getToolsForActor({}, {
    ...memberActor,
    scopes: ['context:read', 'accounts:read', 'contacts:read', 'opportunities:read', 'activities:read'],
  });
  const postMeetingTools = getToolsForActor({}, {
    ...memberActor,
    scopes: [
      'context:read',
      'context:write',
      'accounts:read',
      'contacts:read',
      'opportunities:read',
      'activities:read',
      'activities:write',
      'assignments:write',
    ],
  });
  const adminTools = getToolsForActor({}, recoveryActor);

  assert.equal(readOnlyTools[0].name, 'tool_guide');
  assert.equal(postMeetingTools[0].name, 'tool_guide');
  assert.equal(adminTools[0].name, 'tool_guide');
  assert.ok(readOnlyTools.length <= 30);
  assert.ok(postMeetingTools.length <= 55);
  assert.ok(adminTools.length > 200);

  const guide = postMeetingTools.find(tool => tool.name === 'tool_guide');
  assert.ok(guide);
  const result = await guide.handler({ workflow: 'ingest_raw_context' }, memberActor);
  assert.equal(result.recommended_tools.includes('context_ingest_auto'), true);
  assert.match(result.avoid_tools.join(' '), /context_add/);
});

test('sensitive tool scopes enforce read/write and object-level boundaries', () => {
  const adminReadOnly = { ...recoveryActor, scopes: ['read'] };
  const adminWriteOnly = { ...recoveryActor, scopes: ['write'] };
  const systemsOperator = { ...recoveryActor, scopes: ['systems:read', 'systems:write'] };
  const contradictionActor = { ...recoveryActor, scopes: ['context:read', 'assignments:write'] };

  assert.doesNotThrow(() => enforceToolScopes('ops_privacy_export', adminReadOnly));
  assert.throws(
    () => enforceToolScopes('ops_pii_redact', adminReadOnly),
    err => err?.code === 'PERMISSION_DENIED' && err?.status === 403,
  );
  assert.throws(
    () => enforceToolScopes('workflow_run_replay', adminReadOnly),
    err => err?.code === 'PERMISSION_DENIED' && err?.status === 403,
  );
  assert.throws(
    () => enforceToolScopes('context_contradiction_assign', adminReadOnly),
    err => err?.code === 'PERMISSION_DENIED' && err?.status === 403,
  );
  assert.throws(
    () => enforceToolScopes('sor_sync_run', adminWriteOnly),
    err => err?.code === 'PERMISSION_DENIED' && err?.status === 403,
  );

  assert.doesNotThrow(() => enforceToolScopes('ops_pii_redact', adminWriteOnly));
  assert.doesNotThrow(() => enforceToolScopes('sor_sync_run', systemsOperator));
  assert.doesNotThrow(() => enforceToolScopes('assignment_block', { ...recoveryActor, scopes: ['assignments:write'] }));
  assert.doesNotThrow(() => enforceToolScopes('context_contradiction_assign', contradictionActor));
});

class FakeRawContextAccessDb {
  rawSources = new Map([
    ['own-source', {
      id: '88888888-8888-4888-8888-888888888801',
      tenant_id: recoveryActor.tenant_id,
      source_type: 'add_context',
      source_ref: 'auto:own',
      actor_id: '88888888-8888-4888-8888-888888888901',
      status: 'skipped',
      stage: 'resolve_subjects',
      detected_subjects: [],
      signals_created: 0,
      memory_created: 0,
      skipped: 1,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }],
    ['peer-source', {
      id: '88888888-8888-4888-8888-888888888802',
      tenant_id: recoveryActor.tenant_id,
      source_type: 'add_context',
      source_ref: 'auto:peer',
      actor_id: '88888888-8888-4888-8888-888888888902',
      status: 'skipped',
      stage: 'resolve_subjects',
      detected_subjects: [],
      signals_created: 0,
      memory_created: 0,
      skipped: 1,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }],
  ]);

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT * FROM raw_context_sources')) {
      const source = this.rawSources.get(params[1]);
      return { rows: source ? [source] : [], rowCount: source ? 1 : 0 };
    }
    if (text.startsWith('SELECT * FROM actors WHERE id = $1')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith('SELECT * FROM actors WHERE tenant_id = $1 AND user_id = $2')) {
      const row = params[1] === '99999999-9999-4999-8999-999999999901'
        ? { id: '88888888-8888-4888-8888-888888888901' }
        : undefined;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

test('Raw Context get allows own actor receipts and hides peer no-subject receipts', async () => {
  const db = new FakeRawContextAccessDb();
  const actor = {
    tenant_id: recoveryActor.tenant_id,
    actor_id: '99999999-9999-4999-8999-999999999901',
    actor_type: 'user',
    role: 'member',
    scopes: ['context:read'],
  };
  const tool = getAllTools(db).find(candidate => candidate.name === 'context_raw_source_get');
  assert.ok(tool);

  const own = await tool.handler({ id: 'own-source' }, actor);
  assert.equal(own.raw_context_source.id, '88888888-8888-4888-8888-888888888801');

  await assert.rejects(
    () => tool.handler({ id: 'peer-source' }, actor),
    err => err?.code === 'NOT_FOUND' && err?.status === 404,
  );
});

test('Workspace Agent revenue-object writes default on in migrations', async () => {
  const migration = await readFile(new URL('../migrations/064_agent_write_objects_default.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER COLUMN can_write_objects SET DEFAULT true/);
  assert.match(migration, /WHERE can_write_objects = false\s+AND enabled = false/);
});

test('Workspace Agent write scopes follow can_write_objects', () => {
  const readOnlyScopes = buildAgentScopes({
    can_write_objects: false,
    can_log_activities: true,
    can_create_assignments: true,
  });
  assert.equal(readOnlyScopes.includes('contacts:write'), false);
  assert.equal(readOnlyScopes.includes('accounts:write'), false);
  assert.equal(readOnlyScopes.includes('opportunities:write'), false);
  assert.equal(readOnlyScopes.includes('write'), false);
  assert.equal(readOnlyScopes.includes('activities:write'), true);
  assert.equal(readOnlyScopes.includes('context:write'), true);

  const writeScopes = buildAgentScopes({
    can_write_objects: true,
    can_log_activities: true,
    can_create_assignments: true,
  });
  assert.equal(writeScopes.includes('contacts:write'), true);
  assert.equal(writeScopes.includes('accounts:write'), true);
  assert.equal(writeScopes.includes('opportunities:write'), true);
  assert.equal(writeScopes.includes('write'), true);
});

test('lite record draft preview respects can_write_objects', async () => {
  const db = new FakeAgentConfigDb({ can_write_objects: false });
  await assert.rejects(
    () => previewRecordDraft(db, { ...recoveryActor, scopes: ['accounts:write'] }, {
      text: 'Create Nike as a retail account.',
      mode: 'create',
      object_type: 'account',
    }),
    err => err?.code === 'PERMISSION_DENIED' && /record writing is disabled/i.test(err.message),
  );
});

test('agent harness setup grants admin systems scopes', async () => {
  const migration = await readFile(new URL('../migrations/065_agent_harness_system_scopes.sql', import.meta.url), 'utf8');
  assert.match(migration, /systems:read/);
  assert.match(migration, /systems:write/);
  assert.match(migration, /systems:admin/);
  assert.match(migration, /actor_type = 'human'/);
  assert.match(migration, /role IN \('admin', 'owner'\)/);
});

test('MCP entity resources enforce context scope and subject access', async () => {
  const source = await readFile(new URL('../src/mcp/resources.ts', import.meta.url), 'utf8');
  assert.match(source, /requireScopes\(actor,\s*'context:read'\)/);
  assert.match(source, /assertSubjectAccess\(db,\s*actor,\s*type,\s*id as string\)/);
});

test('every tool has an explicit scope mapping unless intentionally public', () => {
  const intentionallyPublic = new Set(['actor_whoami', 'entity_resolve', 'schema_get', 'tool_guide', 'guide_search']);
  const scopedActor = { ...recoveryActor, scopes: [] };
  const accidentalPublic = [];

  for (const tool of getAllTools({})) {
    try {
      enforceToolScopes(tool.name, scopedActor);
      if (!intentionallyPublic.has(tool.name)) accidentalPublic.push(tool.name);
    } catch {
      // Expected for tools with explicit requirements when the actor has no scopes.
    }
  }

  assert.deepEqual(accidentalPublic.sort(), []);
});

test('privacy governance actions reject non-admin actors before touching storage', async () => {
  await assert.rejects(
    () => redactSubjectPii({}, memberActor, 'contact', '66666666-6666-4666-8666-666666666666', 'customer request', true),
    err => err?.code === 'PERMISSION_DENIED' && err?.status === 403,
  );
});

class FakeRetentionDb {
  async query(sql) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.includes('FROM events')) return { rows: [{ count: 4 }], rowCount: 1 };
    if (text.includes('FROM idempotency_keys')) return { rows: [{ count: 2 }], rowCount: 1 };
    throw new Error(`Unexpected query: ${text}`);
  }
}

test('retention policy dry-runs deletion counts without mutating data', async () => {
  const result = await applyRetentionPolicy(new FakeRetentionDb(), recoveryActor, {
    older_than_days: 90,
    targets: ['events', 'idempotency_keys'],
    dry_run: true,
  });

  assert.deepEqual(result, {
    dry_run: true,
    older_than_days: 90,
    results: { events: 4, idempotency_keys: 2 },
  });
});

class FakeDataQualityRepairDb {
  events = [];

  async query(sql) {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.startsWith('SELECT count(*)::int AS count') && text.includes('FROM context_outbox')) {
      return { rows: [{ count: 2 }], rowCount: 1 };
    }

    if (text.startsWith('WITH target AS') && text.includes('UPDATE activities')) {
      return { rows: [], rowCount: 3 };
    }

    if (text.startsWith('INSERT INTO events')) {
      this.events.push(text);
      return { rows: [{ id: 101 }], rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${text}`);
  }
}

test('data-quality repair supports dry-run previews and audited safe repairs', async () => {
  const db = new FakeDataQualityRepairDb();
  const dryRun = await repairDataQualityFinding(db, recoveryActor, 'stuck_context_outbox_processing', {
    dry_run: true,
  });

  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.repaired_count, 2);

  const repaired = await repairDataQualityFinding(db, recoveryActor, 'activities_missing_canonical_subject', {
    dry_run: false,
    limit: 3,
  });

  assert.equal(repaired.dry_run, false);
  assert.equal(repaired.repaired_count, 3);
  assert.equal(repaired.event_id, 101);
  assert.equal(db.events.length, 1);
});

class FakeRawContextRepairDb {
  events = [];

  async query(sql) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT count(*)::int AS count') && text.includes('FROM raw_context_sources')) {
      return { rows: [{ count: 4 }], rowCount: 1 };
    }
    if (text.startsWith('WITH target AS') && text.includes('UPDATE raw_context_sources')) {
      return { rows: [], rowCount: 2 };
    }
    if (text.startsWith('INSERT INTO events')) {
      this.events.push(text);
      return { rows: [{ id: 202 }], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

class FakeRawContextAttemptRepairDb {
  events = [];

  async query(sql) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT count(*)::int AS count') && text.includes('FROM raw_context_extraction_attempts')) {
      return { rows: [{ count: 1 }], rowCount: 1 };
    }
    if (text.startsWith('WITH target AS') && text.includes('UPDATE raw_context_extraction_attempts')) {
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO events')) {
      this.events.push(text);
      return { rows: [{ id: 303 }], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

test('data-quality repair can requeue stale Raw Context processing receipts', async () => {
  const db = new FakeRawContextRepairDb();
  const dryRun = await repairDataQualityFinding(db, recoveryActor, 'stale_raw_context_sources_processing', {
    dry_run: true,
  });
  assert.equal(dryRun.repaired_count, 4);

  const repaired = await repairDataQualityFinding(db, recoveryActor, 'stale_raw_context_sources_processing', {
    dry_run: false,
    limit: 2,
  });
  assert.equal(repaired.repaired_count, 2);
  assert.equal(repaired.event_id, 202);
});

test('data-quality repair can fail stale Raw Context extraction attempts and requeue work', async () => {
  const db = new FakeRawContextAttemptRepairDb();
  const dryRun = await repairDataQualityFinding(db, recoveryActor, 'stuck_raw_context_extraction_attempts_running', {
    dry_run: true,
  });
  assert.equal(dryRun.repaired_count, 1);

  const repaired = await repairDataQualityFinding(db, recoveryActor, 'stuck_raw_context_extraction_attempts_running', {
    dry_run: false,
    limit: 1,
  });
  assert.equal(repaired.repaired_count, 1);
  assert.equal(repaired.event_id, 303);
});

test('data-quality repair can requeue retryable Raw Context failures', async () => {
  const db = new FakeRawContextRepairDb();
  const dryRun = await repairDataQualityFinding(db, recoveryActor, 'failed_raw_context_sources_retryable', {
    dry_run: true,
  });
  assert.equal(dryRun.repaired_count, 4);

  const repaired = await repairDataQualityFinding(db, recoveryActor, 'failed_raw_context_sources_retryable', {
    dry_run: false,
    limit: 2,
  });
  assert.equal(repaired.repaired_count, 2);
  assert.equal(repaired.event_id, 202);
});

test('data-quality repair rejects unsafe checks and non-admin actors', async () => {
  await assert.rejects(
    () => repairDataQualityFinding({}, recoveryActor, 'invalid_contact_lifecycle_stage'),
    err => err?.code === 'VALIDATION_ERROR' && err?.status === 422,
  );

  await assert.rejects(
    () => repairDataQualityFinding({}, memberActor, 'stuck_context_outbox_processing'),
    err => err?.code === 'PERMISSION_DENIED' && err?.status === 403,
  );
});

test('connector secrets round-trip encrypted and redact sensitive fields', () => {
  const envelope = encryptSecret({
    access_token: 'pat-secret',
    nested: { client_secret: 'client-secret', safe: 'visible' },
  });

  assert.notEqual(envelope.data.includes('pat-secret'), true);
  assert.deepEqual(decryptSecret(envelope), {
    access_token: 'pat-secret',
    nested: { client_secret: 'client-secret', safe: 'visible' },
  });
  assert.deepEqual(redactSecrets({
    token: 'pat-secret',
    nested: { client_secret: 'client-secret', safe: 'visible' },
  }), {
    token: '***',
    nested: { client_secret: '***', safe: 'visible' },
  });
});

test('connector HTTP errors are actionable and redact secrets', () => {
  const err = connectorHttpError('Snowflake', 403, {
    message: 'Forbidden: access_token=secret-token client_secret="very-secret"',
  });

  assert.match(err.message, /Snowflake returned HTTP 403/);
  assert.match(err.message, /Check scopes, permissions/);
  assert.equal(err.message.includes('secret-token'), false);
  assert.equal(err.message.includes('very-secret'), false);
});

test('HubSpot sync requests external properties, not CRMy field names', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify({
      results: [{
        id: '101',
        updatedAt: '2026-05-18T12:00:00.000Z',
        properties: {
          firstname: 'Cody',
          lastname: 'Harris',
          email: 'cody@databricks.com',
          hs_lastmodifieddate: '2026-05-18T12:00:00.000Z',
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const mapping = {
      external_object: 'contacts',
      external_id_field: 'id',
      watermark_field: 'hs_lastmodifieddate',
      field_mapping: {
        first_name: 'firstname',
        last_name: 'lastname',
        email: 'email',
      },
      readable_fields: [],
    };
    const result = await hubspotAdapter.pullChanges({ credentials: { access_token: 'test' }, system: { config: {} } }, mapping);
    const requestUrl = new URL(requestedUrls[0]);
    const properties = requestUrl.searchParams.get('properties');

    assert.equal(result.records[0].external_record_id, '101');
    assert.equal(properties.includes('firstname'), true);
    assert.equal(properties.includes('email'), true);
    assert.equal(properties.includes('first_name'), false);
    assert.equal(properties.includes('last_name'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HubSpot writeback PATCHes existing mapped records with allowed properties', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: '101', properties: JSON.parse(init.body).properties }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const mapping = {
      external_object: 'contacts',
      writeback_mode: 'mapped_upsert',
      writable_fields: ['email', 'firstname'],
      source_authority: 'approval_required',
    };
    const preview = await hubspotAdapter.previewWrite({ credentials: { access_token: 'test' }, system: { config: {} } }, mapping, {
      operation: 'update',
      writeback_mode: 'mapped_upsert',
      external_record_id: '101',
      payload: { email: 'cody@databricks.com', firstname: 'Cody' },
    });
    const result = await hubspotAdapter.executeWrite({ credentials: { access_token: 'test' }, system: { config: {} } }, mapping, {
      operation: 'update',
      writeback_mode: 'mapped_upsert',
      external_record_id: '101',
      payload: { email: 'cody@databricks.com', firstname: 'Cody' },
    });

    assert.equal(preview.allowed, true);
    assert.equal(preview.requires_approval, true);
    assert.equal(result.ok, true);
    assert.equal(result.external_record_id, '101');
    assert.equal(calls[0].init.method, 'PATCH');
    assert.equal(calls[0].url.endsWith('/crm/v3/objects/contacts/101'), true);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      properties: { email: 'cody@databricks.com', firstname: 'Cody' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Salesforce sync paginates with nextRecordsUrl and preserves watermark cursor', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes('/query/01g-next')) {
      return new Response(JSON.stringify({
        records: [{ Id: '003B', LastModifiedDate: '2026-05-18T12:05:00.000+0000', Email: 'next@example.com' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      records: [{ Id: '003A', LastModifiedDate: '2026-05-18T12:00:00.000+0000', Email: 'first@example.com' }],
      nextRecordsUrl: '/services/data/v60.0/query/01g-next',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const mapping = {
      external_object: 'Contact',
      external_id_field: 'Id',
      watermark_field: 'LastModifiedDate',
      field_mapping: { email: 'Email' },
      readable_fields: [],
    };
    const ctx = { credentials: { instance_url: 'https://example.my.salesforce.com', access_token: 'test' }, system: { config: {} } };
    const first = await salesforceAdapter.pullChanges(ctx, mapping, JSON.stringify({ watermark: '2026-05-18T11:00:00.000Z' }));
    const second = await salesforceAdapter.pullChanges(ctx, mapping, first.next_cursor);

    assert.equal(first.records[0].external_record_id, '003A');
    assert.equal(Boolean(first.next_cursor), true);
    assert.equal(second.records[0].external_record_id, '003B');
    assert.equal(requestedUrls[0].includes('LastModifiedDate%20%3E%202026-05-18T11%3A00%3A00Z'), true);
    assert.equal(requestedUrls[1].endsWith('/services/data/v60.0/query/01g-next'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('blocked external writebacks cannot be approved', async () => {
  const writeback = {
    id: '77777777-7777-4777-8777-777777777777',
    tenant_id: baseInput.tenantId,
    system_id: '88888888-8888-4888-8888-888888888888',
    status: 'approval_required',
    operation: 'update',
    writeback_mode: 'mapped_upsert',
    object_type: 'contact',
    external_object: 'contacts',
    policy_result: { allowed: false, warnings: ['Field secret_field is not writable for this mapping.'] },
  };
  const db = {
    async query(sql) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT * FROM external_writeback_requests')) {
        return { rows: [writeback], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    () => reviewExternalWriteback(db, baseInput.tenantId, 'reviewer-1', {
      id: writeback.id,
      decision: 'approved',
    }),
    err => err?.code === 'VALIDATION_ERROR' && String(err.message).includes('blocked by policy'),
  );
});

test('source authority blocks read-only external writeback previews', async () => {
  const tenantId = baseInput.tenantId;
  const systemId = '88888888-8888-4888-8888-888888888888';
  const mappingId = '99999999-9999-4999-8999-999999999999';
  const db = {
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT * FROM external_systems')) {
        return {
          rows: [{
            id: systemId,
            tenant_id: tenantId,
            name: 'HubSpot',
            system_type: 'hubspot',
            auth_type: 'oauth_app',
            status: 'connected',
            encrypted_credentials: encryptSecret({ access_token: 'test-token' }),
            config: {},
            sync_settings: {},
            health: {},
          }],
          rowCount: 1,
        };
      }
      if (text.startsWith('SELECT * FROM external_object_mappings')) {
        assert.equal(params[1], mappingId);
        return {
          rows: [{
            id: mappingId,
            tenant_id: tenantId,
            system_id: systemId,
            object_type: 'contact',
            external_object: 'contacts',
            external_id_field: 'id',
            field_mapping: { email: 'email' },
            readable_fields: [],
            writable_fields: ['email'],
            source_authority: 'read_only',
            writeback_mode: 'mapped_upsert',
            writeback_config: {},
            allow_source_loop: false,
            is_active: true,
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const preview = await previewExternalWriteback(db, tenantId, {
    system_id: systemId,
    mapping_id: mappingId,
    object_type: 'contact',
    external_object: 'contacts',
    operation: 'update',
    writeback_mode: 'mapped_upsert',
    payload: { email: 'cody@example.com' },
  });

  assert.equal(preview.allowed, false);
  assert.equal(preview.requires_approval, false);
  assert.equal(preview.warnings.some(warning => warning.includes('read-only')), true);
});

test('writeback idempotency keys reject changed payloads', async () => {
  const tenantId = baseInput.tenantId;
  const systemId = '88888888-8888-4888-8888-888888888888';
  const db = {
    async query(sql) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT * FROM external_writeback_requests WHERE tenant_id = $1 AND system_id = $2 AND idempotency_key = $3')) {
        return {
          rows: [{
            id: '77777777-7777-4777-8777-777777777777',
            tenant_id: tenantId,
            system_id: systemId,
            mapping_id: '99999999-9999-4999-8999-999999999999',
            status: 'approval_required',
            operation: 'update',
            writeback_mode: 'mapped_upsert',
            object_type: 'contact',
            object_id: null,
            external_object: 'contacts',
            external_record_id: 'hs-1',
            payload: { email: 'old@example.com' },
            policy_result: { allowed: true },
            execution_result: {},
            idempotency_key: 'idem-1',
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    () => requestExternalWriteback(db, tenantId, 'actor-1', {
      system_id: systemId,
      object_type: 'contact',
      external_object: 'contacts',
      external_record_id: 'hs-1',
      operation: 'update',
      writeback_mode: 'mapped_upsert',
      payload: { email: 'new@example.com' },
      idempotency_key: 'idem-1',
    }),
    err => err?.code === 'VALIDATION_ERROR' && String(err.message).includes('already used'),
  );
});

test('executed external writebacks create a receipt, sync run, and record reference', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => new Response(JSON.stringify({
    id: 'hs-101',
    properties: JSON.parse(init.body).properties,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  const tenantId = baseInput.tenantId;
  const systemId = '88888888-8888-4888-8888-888888888888';
  const mappingId = '99999999-9999-4999-8999-999999999999';
  const writebackId = '77777777-7777-4777-8777-777777777777';
  const objectId = '66666666-6666-4666-8666-666666666666';
  const runId = '55555555-5555-4555-8555-555555555555';
  const events = [];
  const recordRefs = [];
  const syncRunUpdates = [];
  const writebackUpdates = [];

  const writeback = {
    id: writebackId,
    tenant_id: tenantId,
    system_id: systemId,
    mapping_id: mappingId,
    status: 'approved',
    operation: 'create',
    writeback_mode: 'mapped_upsert',
    object_type: 'contact',
    object_id: objectId,
    external_object: 'contacts',
    external_record_id: null,
    payload: { email: 'cody@databricks.com', firstname: 'Cody' },
    policy_result: { allowed: true },
    execution_result: {},
    idempotency_key: 'idem-1',
  };
  const system = {
    id: systemId,
    tenant_id: tenantId,
    name: 'HubSpot',
    system_type: 'hubspot',
    auth_type: 'oauth_app',
    status: 'connected',
    encrypted_credentials: encryptSecret({ access_token: 'test-token' }),
    config: {},
    sync_settings: {},
    health: {},
  };
  const mapping = {
    id: mappingId,
    tenant_id: tenantId,
    system_id: systemId,
    object_type: 'contact',
    external_object: 'contacts',
    external_id_field: 'id',
    field_mapping: { email: 'email' },
    readable_fields: [],
    writable_fields: ['email', 'firstname'],
    source_authority: 'approval_required',
    writeback_mode: 'mapped_upsert',
    writeback_config: {},
    allow_source_loop: false,
    is_active: true,
  };

  const db = {
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT * FROM external_writeback_requests')) {
        return { rows: [writeback], rowCount: 1 };
      }
      if (text.startsWith('SELECT * FROM external_systems')) {
        return { rows: [system], rowCount: 1 };
      }
      if (text.startsWith('SELECT * FROM external_object_mappings')) {
        return { rows: [mapping], rowCount: 1 };
      }
      if (text.startsWith('INSERT INTO external_sync_runs')) {
        return { rows: [{ id: runId, tenant_id: tenantId, system_id: systemId, mode: 'writeback', status: 'running' }], rowCount: 1 };
      }
      if (text.startsWith('UPDATE external_sync_runs')) {
        syncRunUpdates.push({ text, params });
        return { rows: [{ id: runId, status: params[2], metadata: JSON.parse(params.at(-1) ?? '{}') }], rowCount: 1 };
      }
      if (text.startsWith('UPDATE external_writeback_requests')) {
        writebackUpdates.push({ text, params });
        const updated = { ...writeback };
        if (params.includes('executing')) updated.status = 'executing';
        if (params.includes('completed')) updated.status = 'completed';
        const receiptParam = params.find(value => typeof value === 'string' && value.includes('"writeback_id"'));
        if (receiptParam) updated.execution_result = JSON.parse(receiptParam);
        const externalId = params.find(value => value === 'hs-101');
        if (externalId) updated.external_record_id = externalId;
        return { rows: [updated], rowCount: 1 };
      }
      if (text.startsWith('SELECT external_record_id, object_type, object_id FROM external_record_refs')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.startsWith('INSERT INTO external_record_refs')) {
        recordRefs.push({ text, params });
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith('UPDATE external_systems SET')) {
        return { rows: [system], rowCount: 1 };
      }
      if (text.startsWith('INSERT INTO events')) {
        events.push({ text, params });
        return { rows: [{ id: 42 }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  try {
    const completed = await executeExternalWriteback(db, tenantId, writebackId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.external_record_id, 'hs-101');
    assert.equal(completed.execution_result.writeback_id, writebackId);
    assert.equal(completed.execution_result.sync_run_id, runId);
    assert.equal(completed.execution_result.reference.updated, true);
    assert.equal(recordRefs.length, 1);
    assert.equal(syncRunUpdates.some(update => update.params.includes('completed')), true);
    assert.equal(writebackUpdates.some(update => update.params.includes('executing')), true);
    assert.equal(events.length, 1);
    assert.equal(JSON.parse(events[0].params[8]).sync_run_id, runId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Salesforce connector context refreshes encrypted OAuth credentials', async () => {
  const originalFetch = globalThis.fetch;
  const tokenRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    tokenRequests.push({ url: String(url), body: String(init.body ?? '') });
    return new Response(JSON.stringify({
      access_token: 'fresh-salesforce-token',
      instance_url: 'https://acme.my.salesforce.com',
      token_type: 'Bearer',
      expires_in: 3600,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const tenantId = baseInput.tenantId;
  const systemId = '88888888-8888-4888-8888-888888888888';
  const updates = [];
  const system = {
    id: systemId,
    tenant_id: tenantId,
    name: 'Salesforce',
    system_type: 'salesforce',
    auth_type: 'oauth',
    status: 'connected',
    encrypted_credentials: encryptSecret({
      instance_url: 'https://login.salesforce.com',
      refresh_token: 'sf-refresh',
      client_id: 'sf-client',
      client_secret: 'sf-secret',
    }),
    config: {},
    sync_settings: {},
    health: {},
  };

  const db = {
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT * FROM external_systems')) {
        return { rows: [system], rowCount: 1 };
      }
      if (text.startsWith('UPDATE external_systems SET')) {
        updates.push({ text, params });
        const encryptedParam = params.find(value => typeof value === 'string' && value.includes('"aes-256-gcm"'));
        if (encryptedParam) system.encrypted_credentials = JSON.parse(encryptedParam);
        return { rows: [system], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  try {
    const ctx = await buildConnectorContext(db, tenantId, systemId);
    assert.equal(ctx.credentials.access_token, 'fresh-salesforce-token');
    assert.equal(ctx.credentials.instance_url, 'https://acme.my.salesforce.com');
    assert.equal(updates.length, 1);
    assert.equal(tokenRequests.length, 1);
    assert.equal(tokenRequests[0].url, 'https://login.salesforce.com/services/oauth2/token');
    assert.equal(tokenRequests[0].body.includes('grant_type=refresh_token'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('warehouse writeback previews require configured templates and writable fields', async () => {
  const ctx = { credentials: {}, system: { config: {} } };
  const mapping = {
    external_object: 'analytics.customer_updates',
    writeback_mode: 'mapped_upsert',
    writable_fields: ['health_score'],
    writeback_config: {},
  };
  const databricksPreview = await databricksAdapter.previewWrite(ctx, mapping, {
    operation: 'upsert',
    writeback_mode: 'mapped_upsert',
    payload: { health_score: 88, secret_note: 'do not write' },
  });
  const snowflakePreview = await snowflakeAdapter.previewWrite(ctx, {
    ...mapping,
    writeback_config: { sql_template: 'CALL update_customer(?)' },
  }, {
    operation: 'upsert',
    writeback_mode: 'mapped_upsert',
    payload: { health_score: 88, secret_note: 'do not write' },
  });

  assert.equal(databricksPreview.allowed, false);
  assert.equal(databricksPreview.warnings.some(warning => warning.includes('sql_template')), true);
  assert.equal(databricksPreview.warnings.some(warning => warning.includes('secret_note')), true);
  assert.equal(snowflakePreview.allowed, false);
  assert.equal(snowflakePreview.warnings.some(warning => warning.includes('secret_note')), true);

  const allowedPreview = await snowflakeAdapter.previewWrite(ctx, {
    ...mapping,
    writeback_config: { sql_template: 'CALL update_customer(?)' },
  }, {
    operation: 'upsert',
    writeback_mode: 'mapped_upsert',
    payload: { health_score: 88 },
  });
  assert.equal(allowedPreview.allowed, true);
});

test('warehouse writeback parameters follow admin-defined parameter_order', () => {
  assert.deepEqual(
    writebackParameters(
      { parameter_order: ['account_id', 'health_score', 'note'] },
      { note: 'QBR risk', health_score: 72, account_id: 'acct-1' },
    ),
    ['acct-1', 72, 'QBR risk'],
  );
  assert.throws(
    () => writebackParameters({ parameter_order: ['account_id', 'health_score'] }, { account_id: 'acct-1' }),
    /health_score/,
  );
});

test('sequence goal contact resolution supports external-origin event shapes', () => {
  const contactId = '22222222-2222-4222-8222-222222222222';
  assert.equal(resolveSequenceGoalContactId({
    objectType: 'opportunity',
    afterData: { contact_id: contactId, metadata: { origin: 'crm_sync' } },
  }), contactId);
  assert.equal(resolveSequenceGoalContactId({
    objectType: 'external_writeback',
    afterData: { object_type: 'contact', object_id: contactId },
  }), contactId);
  assert.equal(resolveSequenceGoalContactId({
    objectType: 'activity',
    afterData: { subject_type: 'contact', subject_id: contactId },
  }), contactId);
  assert.equal(resolveSequenceGoalContactId({
    objectType: 'opportunity',
    afterData: { contact: { id: contactId } },
  }), contactId);
  assert.equal(resolveSequenceGoalContactId({
    objectType: 'opportunity',
    metadata: { contact_id: contactId, origin: 'warehouse_sync' },
  }), contactId);
  assert.equal(resolveSequenceGoalContactId({
    objectType: 'opportunity',
    objectId: '33333333-3333-4333-8333-333333333333',
    afterData: { id: '33333333-3333-4333-8333-333333333333' },
  }), undefined);
});

test('workflow filters and variables support connector metadata', () => {
  const payload = {
    id: 'opp-1',
    object_type: 'opportunity',
    metadata: {
      origin: 'warehouse_sync',
      system_id: 'sys-1',
      system_type: 'databricks',
      external_record_id: 'warehouse-row-42',
      sync_run_id: 'run-1',
      changed_fields: ['health_score', 'renewal_date'],
      conflict_state: 'none',
      confidence: 0.93,
    },
  };

  assert.equal(matchesFilter({
    'metadata.origin': { op: 'eq', value: 'warehouse_sync' },
    'metadata.system_type': { op: 'eq', value: 'databricks' },
    'metadata.changed_fields': { op: 'contains', value: 'health_score' },
    'metadata.confidence': { op: 'gt', value: 0.8 },
  }, payload), true);
  assert.equal(matchesFilter({
    'metadata.changed_fields': { op: 'contains', value: 'amount' },
  }, payload), false);

  const context = buildVariableContext(payload);
  assert.equal(interpolate('Sync {{external.sync_run_id}} changed {{external.changed_fields}} on {{external.record_id}}', context), 'Sync run-1 changed health_score,renewal_date on warehouse-row-42');
});

test('workflow draft dry-run resolves governed system actions without persistence', () => {
  const result = dryRunWorkflowDefinition({
    trigger_filter: {
      'metadata.origin': { op: 'eq', value: 'warehouse_sync' },
    },
    actions: [
      {
        type: 'request_external_writeback',
        config: {
          system_id: '22222222-2222-4222-8222-222222222222',
          object_type: 'opportunity',
          object_id: '{{subject.id}}',
          external_object: 'deals',
          operation: 'upsert',
          writeback_mode: 'mapped_upsert',
          payload: '{"id":"{{subject.id}}","stage":"{{subject.stage}}"}',
          require_approval: 'true',
        },
      },
    ],
  }, {
    id: 'opp-1',
    subject: { stage: 'technical_validation' },
    metadata: { origin: 'warehouse_sync' },
  });

  assert.equal(result.would_trigger, true);
  assert.equal(result.actions[0].would_execute, true);
  assert.equal(result.actions[0].resolved_config.object_id, 'opp-1');
  assert.match(result.actions[0].note, /governed writeback request/);
});

test('workflow engine skips replayed sync events before querying workflows', async () => {
  let queries = 0;
  const db = {
    async query() {
      queries++;
      throw new Error('Workflow lookup should not run for sync replay events');
    },
  };
  const engine = createWorkflowEngine(db);

  await engine.processEvent(baseInput.tenantId, 'contact.updated', 123, {
    id: 'contact-1',
    metadata: { origin: 'crm_sync', sync_mode: 'replay' },
  });

  assert.equal(queries, 0);
});

test('workflow engine skips workflow-originated events before querying workflows', async () => {
  let queries = 0;
  const db = {
    async query() {
      queries++;
      throw new Error('Workflow lookup should not run for workflow-originated events');
    },
  };
  const engine = createWorkflowEngine(db);

  await engine.processEvent(baseInput.tenantId, 'email.created', 124, {
    id: 'email-1',
    metadata: { origin: 'workflow' },
  });

  assert.equal(queries, 0);
});

test('action policy requires approval for non-user forecast changes', () => {
  const result = evaluateActionPolicy({
    action_type: 'opportunity.update',
    object_type: 'opportunity',
    field_names: ['forecast_cat'],
    actor: {
      tenant_id: baseInput.tenantId,
      actor_id: 'agent-1',
      actor_type: 'agent',
      role: 'member',
      scopes: ['opportunities:write'],
    },
  });

  assert.equal(result.decision, 'approval_required');
  assert.equal(result.risk_level, 'high');
  assert.match(result.reasons.join(' '), /forecast/);
});

test('action policy blocks Signal promotion without evidence', () => {
  const result = evaluateActionPolicy({
    action_type: 'context.signal_promote',
    object_type: 'opportunity',
    memory_status: 'signal',
    confidence: 0.95,
    evidence: [],
    actor: {
      tenant_id: baseInput.tenantId,
      actor_id: 'agent-1',
      actor_type: 'agent',
      role: 'member',
      scopes: ['context:write'],
    },
  });

  assert.equal(result.decision, 'blocked');
  assert.equal(result.required_evidence, true);
});

function actionReadinessBriefing(overrides = {}) {
  return {
    subject: { id: '33333333-3333-4333-8333-333333333333', first_name: 'Ada', last_name: 'Lovelace' },
    subject_type: 'contact',
    related_objects: {},
    activities: [],
    open_assignments: [],
    context_entries: {
      preference: [{
        id: '55555555-5555-4555-8555-555555555555',
        tenant_id: baseInput.tenantId,
        subject_type: 'contact',
        subject_id: '33333333-3333-4333-8333-333333333333',
        context_type: 'preference',
        authored_by: '44444444-4444-4444-8444-444444444444',
        title: 'Prefers concise updates',
        body: 'Prefers concise update emails.',
        structured_data: {},
        tags: [],
        confidence: 0.9,
        memory_status: 'active',
        evidence: [{ source_type: 'activity', source_ref: 'call', snippet: 'Keep it concise.' }],
        is_current: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }],
    },
    staleness_warnings: [],
    ...overrides,
  };
}

function actionReadinessSystems(overrides = {}) {
  return {
    mappings: [],
    open_conflict_count: 0,
    pending_writeback_count: 0,
    source_blockers: [],
    ...overrides,
  };
}

test('action readiness is ready when context, policy, and source checks are clear', () => {
  const result = deriveActionReadiness({
    briefing: actionReadinessBriefing(),
    systems: actionReadinessSystems(),
  });

  assert.equal(result.readiness.status, 'ready');
  assert.equal(result.readiness.risk_level, 'low');
  assert.equal(result.checks.memory.confirmed_count, 1);
  assert.equal(result.required_handoffs.length, 0);
});

test('action readiness asks for review when confirmed Memory is stale', () => {
  const staleEntry = actionReadinessBriefing().context_entries.preference[0];
  const result = deriveActionReadiness({
    briefing: actionReadinessBriefing({ staleness_warnings: [staleEntry] }),
    systems: actionReadinessSystems(),
  });

  assert.equal(result.readiness.status, 'review_needed');
  assert.equal(result.checks.memory.stale_count, 1);
  assert.match(result.readiness.reasons.join(' '), /review/);
});

test('action readiness asks for review when no confirmed Memory is loaded', () => {
  const result = deriveActionReadiness({
    briefing: actionReadinessBriefing({ context_entries: {} }),
    systems: actionReadinessSystems(),
  });

  assert.equal(result.readiness.status, 'review_needed');
  assert.equal(result.checks.memory.confirmed_count, 0);
  assert.match(result.readiness.reasons.join(' '), /No confirmed Memory/);
});

test('action readiness asks for review when Signal readiness is unresolved', () => {
  const result = deriveActionReadiness({
    briefing: actionReadinessBriefing({
      signal_groups: [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tenant_id: baseInput.tenantId,
        subject_type: 'contact',
        subject_id: '33333333-3333-4333-8333-333333333333',
        context_type: 'stakeholder',
        claim_key: 'maya-champion',
        title: 'Maya may be the champion',
        normalized_claim: 'Maya may be the champion.',
        status: 'gathering',
        aggregate_confidence: 0.62,
        support_count: 1,
        independent_source_count: 1,
        conflict_count: 0,
        evidence_count: 1,
        metadata: {},
        readiness: deriveSignalReadiness({
          group_status: 'gathering',
          score: 0.62,
          threshold: 0.85,
          support_count: 1,
          independent_source_count: 1,
          evidence_count: 1,
          conflict_count: 0,
        }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }],
    }),
    systems: actionReadinessSystems(),
  });

  assert.equal(result.readiness.status, 'review_needed');
  assert.equal(result.checks.signals.unresolved_readiness_count, 1);
  assert.match(result.checks.signals.readiness_reasons.join(' '), /below the 85% confirmation threshold/);
  assert.equal(result.required_handoffs[0].type, 'signal_review');
});

test('action readiness blocks when source authority or policy blocks action', () => {
  const result = deriveActionReadiness({
    briefing: actionReadinessBriefing(),
    systems: actionReadinessSystems({
      source_blockers: ['Target mapping does not allow writes to: forecast_cat.'],
    }),
    policy: {
      decision: 'blocked',
      reasons: ['The target mapping is read-only.'],
      risk_level: 'high',
      policy: 'crmy.action_policy.v1',
    },
  });

  assert.equal(result.readiness.status, 'blocked');
  assert.equal(result.readiness.risk_level, 'high');
  assert.match(result.readiness.blockers.join(' '), /read-only|forecast_cat/);
});
