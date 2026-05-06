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
import { withTransaction } from '../dist/db/transaction.js';

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
  }

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
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

  assert.equal(memberTools.includes('ops_pii_redact'), false);
  assert.equal(memberTools.includes('ops_data_quality_repair'), false);
  assert.equal(memberTools.includes('workflow_run_replay'), false);
  assert.equal(adminTools.includes('ops_pii_redact'), true);
  assert.equal(adminTools.includes('ops_data_quality_repair'), true);
  assert.equal(adminTools.includes('workflow_run_replay'), true);
});

test('sensitive tool scopes enforce read/write and object-level boundaries', () => {
  const adminReadOnly = { ...recoveryActor, scopes: ['read'] };
  const adminWriteOnly = { ...recoveryActor, scopes: ['write'] };
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

  assert.doesNotThrow(() => enforceToolScopes('ops_pii_redact', adminWriteOnly));
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
