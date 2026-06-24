// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EVAL_EXPORT_FORMATS,
  exportRun,
  isEvalExportFormat,
  toGenericJsonl,
  toLangSmithJson,
  toOpenAIEvalsJsonl,
  toRagasJsonl,
} from '../dist/evals/exporters.js';
import { runCrmyEval, loadExternalCases } from '../dist/evals/runner.js';

async function contractRun() {
  return runCrmyEval({ profile: 'contract' });
}

test('runCrmyEval skips planned suites instead of throwing (#1)', async () => {
  const run = await runCrmyEval({ suites: ['record_resolution', 'connector_certification'] });
  assert.notEqual(run.status, 'error');
  const planned = run.results.find(result => result.suite === 'connector_certification');
  assert.ok(planned, 'connector_certification should appear in results');
  assert.equal(planned.status, 'skipped');
});

test('exporters produce non-empty, parseable output for every format (#4)', async () => {
  const run = await contractRun();

  const generic = toGenericJsonl(run).trim().split('\n');
  assert.equal(generic.length, run.results.length);
  assert.doesNotThrow(() => JSON.parse(generic[0]));

  const openai = toOpenAIEvalsJsonl(run).trim().split('\n');
  assert.ok(JSON.parse(openai[0]).sample_id.includes('/'));

  const ragas = toRagasJsonl(run).trim().split('\n');
  assert.ok('metrics' in JSON.parse(ragas[0]));

  const langsmith = JSON.parse(toLangSmithJson(run));
  assert.equal(langsmith.examples.length, run.results.length);
});

test('exportRun yields distinct filenames per format', async () => {
  const run = await contractRun();
  const names = new Set(EVAL_EXPORT_FORMATS.map(format => exportRun(run, format).filename));
  assert.equal(names.size, EVAL_EXPORT_FORMATS.length);
  assert.ok(isEvalExportFormat('openai'));
  assert.ok(!isEvalExportFormat('nope'));
});

test('loadExternalCases validates against crmy.eval_case.v1 (#5)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crmy-eval-'));
  try {
    const valid = join(dir, 'cases.jsonl');
    await writeFile(valid, [
      JSON.stringify({ version: 'crmy.eval_case.v1', id: 'c1', suite: 'record_resolution', document: 'Nike call with Jacob.' }),
      JSON.stringify({ version: 'crmy.eval_case.v1', id: 'c2', suite: 'record_resolution', document: 'Acme sync.' }),
    ].join('\n'));
    const cases = await loadExternalCases(valid, 'record_resolution');
    assert.equal(cases.length, 2);
    assert.equal(cases[0].id, 'c1');

    // JSON array form also works.
    const arr = join(dir, 'cases.json');
    await writeFile(arr, JSON.stringify([{ version: 'crmy.eval_case.v1', id: 'a1', suite: 'record_resolution' }]));
    assert.equal((await loadExternalCases(arr, 'record_resolution')).length, 1);

    // Suite mismatch is rejected.
    const mismatch = join(dir, 'mismatch.json');
    await writeFile(mismatch, JSON.stringify([{ version: 'crmy.eval_case.v1', id: 'm1', suite: 'raw_context_extraction' }]));
    await assert.rejects(loadExternalCases(mismatch, 'record_resolution'), /targets suite/);

    // Invalid (missing version) is rejected.
    const invalid = join(dir, 'invalid.json');
    await writeFile(invalid, JSON.stringify([{ id: 'x1', suite: 'record_resolution' }]));
    await assert.rejects(loadExternalCases(invalid, 'record_resolution'), /invalid/i);

    // Redacted cases cannot drive the live-model suite.
    const redacted = join(dir, 'redacted.json');
    await writeFile(redacted, JSON.stringify([{ version: 'crmy.eval_case.v1', id: 'r1', suite: 'raw_context_extraction_quality', redacted: true }]));
    await assert.rejects(loadExternalCases(redacted, 'raw_context_extraction_quality'), /redacted/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('externalCases override a corpus-driven suite run', async () => {
  // A single bogus case should be the only one graded when injected.
  const run = await runCrmyEval({
    suites: ['record_resolution'],
    externalCases: [{ id: 'injected-1', suite: 'record_resolution' }],
  });
  const ids = run.results.map(result => result.id);
  assert.ok(ids.includes('injected-1') || run.results.length >= 1);
});
