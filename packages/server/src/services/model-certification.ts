// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { AgentConfig } from '../agent/types.js';

export const MODEL_CERTIFICATION_STATUSES = ['uncertified', 'certified', 'failed'] as const;
export const MODEL_CERTIFICATION_PROFILE = 'live_model' as const;
export const MODEL_CERTIFICATION_MIN_SCORE = 0.85;

export type ModelCertificationStatus = typeof MODEL_CERTIFICATION_STATUSES[number];

export interface ModelCertificationEvidence {
  model_certification_status?: ModelCertificationStatus | string | null;
  model_certification_profile?: string | null;
  model_certification_run_id?: string | null;
  model_certification_score?: number | null;
}

export function modelCertificationRequired(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.CRMY_REQUIRE_MODEL_CERTIFIED_AUTOPROMOTE;
  if (raw == null || raw.trim() === '') return true;
  return !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase());
}

export function isModelCertifiedForAutoPromote(
  config: ModelCertificationEvidence | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!modelCertificationRequired(env)) return true;
  return modelCertificationMeetsAutoPromoteGate(config);
}

export function autoPromoteBlockedByModelCertification(
  config: (Pick<AgentConfig, 'auto_promote_signals'> & ModelCertificationEvidence) | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return config?.auto_promote_signals !== false && !isModelCertifiedForAutoPromote(config, env);
}

export function modelCertificationMeetsAutoPromoteGate(config: ModelCertificationEvidence | null | undefined): boolean {
  return config?.model_certification_status === 'certified'
    && config.model_certification_profile === MODEL_CERTIFICATION_PROFILE
    && typeof config.model_certification_run_id === 'string'
    && config.model_certification_run_id.trim().length > 0
    && typeof config.model_certification_score === 'number'
    && config.model_certification_score >= MODEL_CERTIFICATION_MIN_SCORE;
}
