// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ProviderId } from './agent-providers.js';

export const MODEL_CERTIFICATION_PROFILE = 'live_model' as const;
export const MODEL_CERTIFICATION_MIN_SCORE = 0.85;

export interface RecordedModelCertification {
  status: 'certified';
  profile: typeof MODEL_CERTIFICATION_PROFILE;
  run_id: string;
  score: number;
  certified_at: string;
  provenance: 'crmy_published';
  suite: 'raw_context_extraction_quality';
}

export interface PrecertifiedModelEntry {
  provider: ProviderId;
  base_url: string;
  model: string;
  label: string;
  certification: RecordedModelCertification;
}

function normalizeBaseUrl(value: string | undefined | null): string {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function normalizeProvider(value: string | undefined | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeModel(value: string | undefined | null): string {
  return String(value ?? '').trim();
}

export const PRECERTIFIED_MODEL_REGISTRY: readonly PrecertifiedModelEntry[] = [
  {
    provider: 'anthropic',
    base_url: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    certification: {
      status: 'certified',
      profile: MODEL_CERTIFICATION_PROFILE,
      run_id: 'crmy_cert_20260628_live_model_claude_sonnet_4_20250514',
      score: 0.93,
      certified_at: '2026-06-28T00:00:00.000Z',
      provenance: 'crmy_published',
      suite: 'raw_context_extraction_quality',
    },
  },
  {
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-5.2',
    label: 'GPT-5.2',
    certification: {
      status: 'certified',
      profile: MODEL_CERTIFICATION_PROFILE,
      run_id: 'crmy_cert_20260628_live_model_gpt_5_2',
      score: 0.94,
      certified_at: '2026-06-28T00:00:00.000Z',
      provenance: 'crmy_published',
      suite: 'raw_context_extraction_quality',
    },
  },
] as const;

export function findPrecertifiedModel(input: {
  provider?: string | null;
  baseUrl?: string | null;
  model?: string | null;
}): PrecertifiedModelEntry | null {
  const provider = normalizeProvider(input.provider);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const model = normalizeModel(input.model);
  if (!provider || !baseUrl || !model) return null;
  return PRECERTIFIED_MODEL_REGISTRY.find(entry =>
    normalizeProvider(entry.provider) === provider
    && normalizeBaseUrl(entry.base_url) === baseUrl
    && normalizeModel(entry.model) === model
  ) ?? null;
}

export function precertifiedCertificationForModel(input: {
  provider?: string | null;
  baseUrl?: string | null;
  model?: string | null;
}): RecordedModelCertification | null {
  return findPrecertifiedModel(input)?.certification ?? null;
}
