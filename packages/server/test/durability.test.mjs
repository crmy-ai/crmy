// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
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
import { withTransaction } from '../dist/db/transaction.js';
import { encryptSecret, decryptSecret, redactSecrets } from '../dist/lib/secrets.js';
import { shouldAutoPromoteSignal } from '../dist/agent/extraction.js';
import { hubspotAdapter } from '../dist/services/systems-of-record/hubspot.js';
import { salesforceAdapter } from '../dist/services/systems-of-record/salesforce.js';
import { databricksAdapter } from '../dist/services/systems-of-record/databricks.js';
import { snowflakeAdapter } from '../dist/services/systems-of-record/snowflake.js';
import { connectorHttpError, writebackParameters } from '../dist/services/systems-of-record/adapters.js';
import { buildConnectorContext, executeExternalWriteback, previewExternalWriteback, requestExternalWriteback, reviewExternalWriteback } from '../dist/services/systems-of-record/index.js';
import { evaluateActionPolicy } from '../dist/services/action-policy.js';
import { resolveSequenceGoalContactId } from '../dist/services/sequence-executor.js';
import { createWorkflowEngine, dryRunWorkflowDefinition, matchesFilter } from '../dist/workflows/engine.js';
import { buildVariableContext, interpolate } from '../dist/workflows/variables.js';

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

test('every tool has an explicit scope mapping unless intentionally public', () => {
  const intentionallyPublic = new Set(['actor_whoami', 'entity_resolve', 'schema_get', 'guide_search']);
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
