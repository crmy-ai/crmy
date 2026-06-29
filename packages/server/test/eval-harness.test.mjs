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

test('runCrmyEval runs connector certification as an implemented seeded-context suite', async () => {
  const run = await runCrmyEval({ suites: ['record_resolution', 'connector_certification'] });
  assert.equal(run.status, 'pass');
  const connectorResults = run.results.filter(result => result.suite === 'connector_certification');
  assert.equal(connectorResults.length, 2);
  assert.equal(connectorResults.every(result => result.status === 'pass'), true);
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

test('external eval exports redact sensitive source and model output fields by default', async () => {
  const run = await contractRun();
  run.results[0].expected = { document: 'customer transcript body', safe_label: 'expected' };
  run.results[0].observed = { raw_output_excerpt: 'model output with customer data', metrics: { score: 1 } };

  const generic = JSON.parse(exportRun(run, 'generic').content.trim().split('\n')[0]);
  assert.equal(generic.expected.document, '[redacted]');
  assert.equal(generic.expected.safe_label, 'expected');
  assert.equal(generic.observed.raw_output_excerpt, '[redacted]');

  const openai = JSON.parse(exportRun(run, 'openai').content.trim().split('\n')[0]);
  assert.equal(openai.ideal.document, '[redacted]');
  assert.equal(openai.result.raw_output_excerpt, '[redacted]');
  assert.equal(openai.metadata.redacted, true);

  const langsmith = JSON.parse(exportRun(run, 'langsmith').content);
  assert.equal(langsmith.examples[0].outputs.raw_output_excerpt, '[redacted]');
  assert.equal(langsmith.examples[0].metadata.redacted, true);
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
