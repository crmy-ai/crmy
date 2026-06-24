// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import type { EvalRunProfile, EvalRunSummary, EvalSuiteName, EvalSuiteSummary } from '@crmy/shared';

const KNOWN_SUITES: EvalSuiteName[] = [
  'raw_context_extraction',
  'raw_context_extraction_quality',
  'raw_context_custom_registry',
  'record_resolution',
  'retrieval_quality',
  'tool_choice',
  'action_context',
  'source_attribution',
  'agent_trajectory',
  'connector_certification',
];

async function loadEvalRunner(): Promise<{
  listCrmyEvalSuites: (options?: { includePlanned?: boolean }) => Promise<EvalSuiteSummary[]>;
  runCrmyEval: (options?: {
    suites?: EvalSuiteName[];
    profile?: EvalRunProfile;
    requireLive?: boolean;
    failUnder?: number;
    output?: string;
  }) => Promise<EvalRunSummary>;
}> {
  return await import('@crmy/server') as unknown as {
    listCrmyEvalSuites: (options?: { includePlanned?: boolean }) => Promise<EvalSuiteSummary[]>;
    runCrmyEval: (options?: {
      suites?: EvalSuiteName[];
      profile?: EvalRunProfile;
      requireLive?: boolean;
      failUnder?: number;
      output?: string;
    }) => Promise<EvalRunSummary>;
  };
}

function parseSuites(value?: string): EvalSuiteName[] | undefined {
  if (!value?.trim()) return undefined;
  const suites = value.split(',').map(item => item.trim()).filter(Boolean);
  const unknown = suites.filter(suite => !KNOWN_SUITES.includes(suite as EvalSuiteName));
  if (unknown.length > 0) {
    throw new Error(`Unknown eval suite: ${unknown.join(', ')}`);
  }
  return suites as EvalSuiteName[];
}

function parseProfile(value?: string): EvalRunProfile | undefined {
  if (!value) return undefined;
  if (value === 'contract' || value === 'live_model' || value === 'seeded_context' || value === 'agent_runtime') {
    return value;
  }
  throw new Error(`Unknown eval profile: ${value}`);
}

function parseFailUnder(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('--fail-under must be a number between 0 and 1');
  }
  return parsed;
}

function printSuite(suite: EvalSuiteSummary): void {
  console.log(`${suite.name}`);
  console.log(`  ${suite.title}`);
  console.log(`  Cases: ${suite.case_count} | status: ${suite.implementation_status} | profiles: ${suite.profiles.join(', ')}`);
  console.log(`  deterministic: ${suite.deterministic ? 'yes' : 'no'} | model: ${suite.requires_model ? 'required' : 'no'} | database: ${suite.requires_database ? 'required' : 'no'} | quality gate: ${suite.quality_gate ? 'yes' : 'no'}`);
  console.log(`  golden output input: ${suite.uses_golden_model_output ? 'yes' : 'no'}`);
  console.log(`  ${suite.description}`);
  console.log(`  Proof: ${suite.proof_scope}`);
  if (suite.limitations.length > 0) {
    console.log(`  Limits: ${suite.limitations.join(' ')}`);
  }
}

function printRunSummary(run: EvalRunSummary): void {
  const symbol = run.status === 'pass' ? 'PASS' : run.status.toUpperCase();
  console.log(`\n${symbol} ${run.run_id}`);
  console.log(`Profile: ${run.profile}`);
  console.log(`Suites: ${run.suites.map(suite => suite.name).join(', ')}`);
  console.log(`Cases: ${run.totals.cases} | passed: ${run.totals.passed} | failed: ${run.totals.failed} | errored: ${run.totals.errored} | skipped: ${run.totals.skipped}`);

  const scoreRows = Object.entries(run.scores);
  if (scoreRows.length > 0) {
    console.log('\nScores:');
    for (const [name, score] of scoreRows) {
      console.log(`  ${name}: ${score}`);
    }
  }

  if (run.thresholds.length > 0) {
    console.log('\nThresholds:');
    for (const threshold of run.thresholds) {
      console.log(`  ${threshold.metric} ${threshold.op} ${threshold.value}`);
    }
  }

  if (run.artifacts.length > 0) {
    console.log('\nArtifacts:');
    for (const artifact of run.artifacts) {
      console.log(`  ${artifact}`);
    }
  }

  const failures = run.results.filter(result => result.status === 'fail' || result.status === 'error');
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const result of failures) {
      const details = [
        ...result.diagnostics.missing_expected_items.map(item => `missing ${item}`),
        ...result.diagnostics.forbidden_items_found.map(item => `forbidden ${item}`),
      ];
      console.log(`  - ${result.suite}/${result.id}: ${details.join('; ') || result.status}`);
    }
  }

  const skipped = run.results.filter(result => result.status === 'skipped');
  if (skipped.length > 0) {
    console.log('\nSkipped:');
    for (const result of skipped) {
      const reason = result.diagnostics.warnings[0] ?? 'skipped';
      console.log(`  - ${result.suite}/${result.id}: ${reason}`);
    }
  }
}

export function evalCommand(): Command {
  const cmd = new Command('eval')
    .description('Run CRMy eval harness suites for customer-context control-plane contracts');

  cmd.command('list')
    .description('List eval suites')
    .option('--all', 'Include planned suites')
    .option('--json', 'Print raw JSON')
    .action(async (opts: { all?: boolean; json?: boolean }) => {
      const { listCrmyEvalSuites } = await loadEvalRunner();
      const suites = await listCrmyEvalSuites({ includePlanned: opts.all });
      if (opts.json) {
        console.log(JSON.stringify({ data: suites, total: suites.length }, null, 2));
        return;
      }
      for (const suite of suites) {
        printSuite(suite);
      }
    });

  cmd.command('describe <suite>')
    .description('Describe one eval suite')
    .option('--json', 'Print raw JSON')
    .action(async (suiteName: string, opts: { json?: boolean }) => {
      const suite = parseSuites(suiteName)?.[0];
      const { listCrmyEvalSuites } = await loadEvalRunner();
      const match = (await listCrmyEvalSuites({ includePlanned: true })).find(candidate => candidate.name === suite);
      if (!match) throw new Error(`Unknown eval suite: ${suiteName}`);
      if (opts.json) {
        console.log(JSON.stringify(match, null, 2));
        return;
      }
      printSuite(match);
    });

  cmd.command('run')
    .description('Run eval suites')
    .option('--suite <suite>', 'Suite name or comma-separated suite names')
    .option('--profile <profile>', 'Eval profile: contract, live_model, seeded_context, or agent_runtime')
    .option('--all', 'Run all implemented suites')
    .option('--fail-under <score>', 'Fail if any emitted aggregate score is below this value (0-1)')
    .option('--output <dir>', 'Write JSON and JSONL eval artifacts to a directory')
    .option('--require-live', 'Fail live-model suites when CRMY_EVAL_MODEL_* config is absent')
    .option('--json', 'Print raw JSON result')
    .action(async (opts: {
      suite?: string;
      profile?: string;
      all?: boolean;
      failUnder?: string;
      output?: string;
      requireLive?: boolean;
      json?: boolean;
    }) => {
      const suites = opts.all ? KNOWN_SUITES.filter(suite => suite !== 'connector_certification') : parseSuites(opts.suite);
      const { runCrmyEval } = await loadEvalRunner();
      const run = await runCrmyEval({
        suites,
        profile: parseProfile(opts.profile),
        requireLive: opts.requireLive,
        failUnder: parseFailUnder(opts.failUnder),
        output: opts.output,
      });
      if (opts.json) {
        console.log(JSON.stringify(run, null, 2));
      } else {
        printRunSummary(run);
      }
      if (run.status !== 'pass' && run.status !== 'skipped') process.exitCode = 1;
    });

  return cmd;
}
