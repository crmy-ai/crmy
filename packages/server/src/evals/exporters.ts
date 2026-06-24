// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Eval run exporters.
 *
 * Convert a CRMy `EvalRunSummary` into the row shapes used by common external
 * eval and observability tools, so CRMy results can flow into existing
 * pipelines instead of being a closed format. These are pure functions over the
 * run summary; the runner writes them as artifacts when requested.
 */

import type { EvalRunSummary, EvalCaseSummary } from '@crmy/shared';

export type EvalExportFormat = 'generic' | 'openai' | 'ragas' | 'langsmith';

export const EVAL_EXPORT_FORMATS: EvalExportFormat[] = ['generic', 'openai', 'ragas', 'langsmith'];

export function isEvalExportFormat(value: string): value is EvalExportFormat {
  return (EVAL_EXPORT_FORMATS as string[]).includes(value);
}

function caseRow(run: EvalRunSummary, result: EvalCaseSummary) {
  return {
    run_id: run.run_id,
    suite: result.suite,
    case_id: result.id,
    status: result.status,
    scores: result.scores,
    expected: result.expected,
    observed: result.observed,
    diagnostics: result.diagnostics,
  };
}

/** Generic JSONL — one row per case. Stable, tool-agnostic. */
export function toGenericJsonl(run: EvalRunSummary): string {
  return run.results.map(result => JSON.stringify(caseRow(run, result))).join('\n') + '\n';
}

/** OpenAI Evals-style JSONL: one sample per case with input/ideal/result. */
export function toOpenAIEvalsJsonl(run: EvalRunSummary): string {
  return run.results.map(result => JSON.stringify({
    sample_id: `${result.suite}/${result.id}`,
    input: { suite: result.suite, case_id: result.id, title: result.title },
    ideal: result.expected ?? {},
    result: result.observed ?? {},
    metadata: { status: result.status, scores: result.scores, profile: result.profile },
  })).join('\n') + '\n';
}

/** Ragas-compatible JSONL: per-case metric rows keyed by CRMy metric names. */
export function toRagasJsonl(run: EvalRunSummary): string {
  return run.results.map(result => JSON.stringify({
    id: `${result.suite}/${result.id}`,
    suite: result.suite,
    metrics: result.scores,
    passed: result.status === 'pass',
    status: result.status,
  })).join('\n') + '\n';
}

/** LangSmith-compatible dataset JSON: examples with inputs/outputs/metadata. */
export function toLangSmithJson(run: EvalRunSummary): string {
  return JSON.stringify({
    name: `crmy-eval-${run.run_id}`,
    description: `CRMy eval run ${run.run_id} (profile: ${run.profile})`,
    examples: run.results.map(result => ({
      inputs: { suite: result.suite, case_id: result.id },
      outputs: result.observed ?? {},
      metadata: {
        expected: result.expected,
        scores: result.scores,
        status: result.status,
        profile: result.profile,
      },
    })),
  }, null, 2);
}

/** Render one export format to a {filename, content} pair for a run. */
export function exportRun(run: EvalRunSummary, format: EvalExportFormat): { filename: string; content: string } {
  switch (format) {
    case 'generic':
      return { filename: `${run.run_id}.generic.jsonl`, content: toGenericJsonl(run) };
    case 'openai':
      return { filename: `${run.run_id}.openai-evals.jsonl`, content: toOpenAIEvalsJsonl(run) };
    case 'ragas':
      return { filename: `${run.run_id}.ragas.jsonl`, content: toRagasJsonl(run) };
    case 'langsmith':
      return { filename: `${run.run_id}.langsmith.json`, content: toLangSmithJson(run) };
  }
}
