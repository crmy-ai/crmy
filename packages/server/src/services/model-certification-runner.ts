// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { EvalRunSummary } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as agentRepo from '../db/repos/agent.js';
import { decrypt } from '../agent/crypto.js';
import { runCrmyEval, type RunEvalOptions } from '../evals/runner.js';
import {
  MODEL_CERTIFICATION_MIN_SCORE,
  MODEL_CERTIFICATION_PROFILE,
  modelCertificationMeetsAutoPromoteGate,
} from './model-certification.js';

type EvalRunner = (options?: RunEvalOptions) => Promise<EvalRunSummary>;

export interface CertifyTenantModelOptions {
  db: DbPool;
  tenantId: string;
  output?: string;
  casesFile?: string;
  exportFormats?: string[];
  runEval?: EvalRunner;
}

export interface CertifyTenantModelResult {
  status: 'certified' | 'failed';
  run?: EvalRunSummary;
  score: number | null;
  model: {
    provider: string;
    base_url: string;
    model: string;
  };
  message: string;
}

function certificationScoreForRun(run: EvalRunSummary): number {
  const metrics = run.thresholds.length > 0
    ? run.thresholds.map(threshold => run.scores[threshold.metric])
    : Object.values(run.scores);
  const valid = metrics.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (valid.length === 0) return 0;
  return Number(Math.min(...valid).toFixed(3));
}

function temporarilySetEvalModelEnv(config: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string | null;
}): () => void {
  const keys = [
    'CRMY_EVAL_MODEL_PROVIDER',
    'CRMY_EVAL_MODEL_BASE_URL',
    'CRMY_EVAL_MODEL_NAME',
    'CRMY_EVAL_MODEL_API_KEY',
  ] as const;
  const previous = new Map<string, string | undefined>(keys.map(key => [key, process.env[key]]));
  process.env.CRMY_EVAL_MODEL_PROVIDER = config.provider;
  process.env.CRMY_EVAL_MODEL_BASE_URL = config.baseUrl;
  process.env.CRMY_EVAL_MODEL_NAME = config.model;
  if (config.apiKey) process.env.CRMY_EVAL_MODEL_API_KEY = config.apiKey;
  else delete process.env.CRMY_EVAL_MODEL_API_KEY;
  return () => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export async function certifyTenantModel(options: CertifyTenantModelOptions): Promise<CertifyTenantModelResult> {
  const config = await agentRepo.getConfig(options.db, options.tenantId);
  if (!config?.enabled || !config.model || !config.base_url) {
    await agentRepo.setModelCertification(options.db, options.tenantId, { status: 'failed' });
    return {
      status: 'failed',
      score: null,
      model: {
        provider: config?.provider ?? 'custom',
        base_url: config?.base_url ?? '',
        model: config?.model ?? '',
      },
      message: 'Workspace Agent model is not configured; certification did not run.',
    };
  }

  const apiKey = config.api_key_enc ? decrypt(config.api_key_enc) : null;
  const restoreEnv = temporarilySetEvalModelEnv({
    provider: config.provider,
    baseUrl: config.base_url,
    model: config.model,
    apiKey,
  });

  let run: EvalRunSummary | undefined;
  try {
    run = await (options.runEval ?? runCrmyEval)({
      profile: MODEL_CERTIFICATION_PROFILE,
      requireLive: true,
      output: options.output,
      casesFile: options.casesFile,
      exportFormats: options.exportFormats,
    });
  } catch (err) {
    await agentRepo.setModelCertification(options.db, options.tenantId, { status: 'failed' });
    return {
      status: 'failed',
      score: null,
      model: { provider: config.provider, base_url: config.base_url, model: config.model },
      message: `Certification eval failed before producing a passing run: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    restoreEnv();
  }

  const score = certificationScoreForRun(run);
  const evidence = {
    model_certification_status: 'certified' as const,
    model_certification_profile: run.profile,
    model_certification_run_id: run.run_id,
    model_certification_score: score,
  };
  const passed = run.profile === MODEL_CERTIFICATION_PROFILE
    && run.status === 'pass'
    && run.totals.skipped === 0
    && run.totals.failed === 0
    && run.totals.errored === 0
    && modelCertificationMeetsAutoPromoteGate(evidence);

  if (!passed) {
    await agentRepo.setModelCertification(options.db, options.tenantId, {
      status: 'failed',
      profile: run.profile,
      runId: run.run_id,
      score,
    });
    return {
      status: 'failed',
      run,
      score,
      model: { provider: config.provider, base_url: config.base_url, model: config.model },
      message: `Certification did not pass the live_model gate (score ${score}; minimum ${MODEL_CERTIFICATION_MIN_SCORE}). Automatic Memory remains disabled.`,
    };
  }

  await agentRepo.setModelCertification(options.db, options.tenantId, {
    status: 'certified',
    profile: MODEL_CERTIFICATION_PROFILE,
    runId: run.run_id,
    score,
    certifiedAt: run.created_at,
  });
  return {
    status: 'certified',
    run,
    score,
    model: { provider: config.provider, base_url: config.base_url, model: config.model },
    message: `Model certified by live_model eval ${run.run_id} with score ${score}. Automatic Memory can run when grounding and trust-tier gates pass.`,
  };
}
