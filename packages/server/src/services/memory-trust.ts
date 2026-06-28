// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

export const CONTEXT_GROUNDING_METHODS = ['lexical', 'corroborated', 'human_reviewed'] as const;

export type ContextGroundingMethod = typeof CONTEXT_GROUNDING_METHODS[number];
export type MemoryClaimTier = 0 | 1 | 2;

const TIER_2_CONTEXT_TYPES = new Set([
  'approval',
  'commitment',
  'deal_risk',
  'forecast',
  'forecast_risk',
  'forecast_signal',
  'risk',
]);

const TIER_1_CONTEXT_TYPES = new Set([
  'buying_process',
  'competitive_intel',
  'decision',
  'key_fact',
  'methodology_gap',
  'next_step',
  'objection',
  'stakeholder',
  'stakeholder_map',
  'stakeholder_role',
  'success_criteria',
]);

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeContextType(contextType: string | undefined | null): string {
  return String(contextType ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function memoryClaimTier(contextType: string | undefined | null): MemoryClaimTier {
  const normalized = normalizeContextType(contextType);
  if (TIER_2_CONTEXT_TYPES.has(normalized)) return 2;
  if (TIER_1_CONTEXT_TYPES.has(normalized)) return 1;
  return 0;
}

export function memoryFreshnessWindowDays(contextType: string | undefined | null): number {
  const normalized = normalizeContextType(contextType);
  if (/forecast|next_step|approval/.test(normalized)) return 30;
  if (/risk|objection|methodology|competitive/.test(normalized)) return 45;
  if (/commitment|buying_process|decision/.test(normalized)) return 60;
  if (/stakeholder|success_criteria|key_fact/.test(normalized)) return 90;
  if (/preference|relationship/.test(normalized)) return 180;
  return 120;
}

export function defaultMemoryReviewDate(contextType: string | undefined | null, now = new Date()): string {
  return new Date(now.getTime() + memoryFreshnessWindowDays(contextType) * DAY_MS).toISOString();
}

export function hasUsableReviewDate(validUntil: string | undefined | null): boolean {
  if (!validUntil) return false;
  const parsed = new Date(validUntil);
  return !Number.isNaN(parsed.getTime());
}

export function memoryFreshnessReferenceDate(input: {
  reviewed_at?: string | null;
  promoted_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}): Date | null {
  const raw = input.reviewed_at ?? input.promoted_at ?? input.updated_at ?? input.created_at;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function shouldMarkMemoryDueForReview(input: {
  context_type?: string | null;
  valid_until?: string | null;
  reviewed_at?: string | null;
  promoted_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}, now = new Date()): boolean {
  if (hasUsableReviewDate(input.valid_until)) return false;
  const reference = memoryFreshnessReferenceDate(input);
  if (!reference) return false;
  const ageDays = (now.getTime() - reference.getTime()) / DAY_MS;
  return ageDays > memoryFreshnessWindowDays(input.context_type);
}

export function groundingMethodForPromotion(input: {
  humanReviewed?: boolean;
  independentSourceCount?: number;
}): ContextGroundingMethod {
  if (input.humanReviewed) return 'human_reviewed';
  if ((input.independentSourceCount ?? 0) >= 2) return 'corroborated';
  return 'lexical';
}

export function canAutoPromoteSignalByTrustTier(input: {
  contextType?: string | null;
  confidence?: number;
  threshold: number;
  evidenceCount: number;
  independentSourceCount?: number;
  allowGroupCorroboration?: boolean;
  sourceGrounded: boolean;
  speculative?: boolean;
  readinessReady?: boolean;
}): boolean {
  if (input.evidenceCount < 1) return false;
  if (!input.sourceGrounded) return false;
  if (input.speculative) return false;
  if (input.readinessReady === false) return false;
  if ((input.confidence ?? 0) < input.threshold) return false;

  const tier = memoryClaimTier(input.contextType);
  if (tier === 2) return (input.independentSourceCount ?? 0) >= 2 || input.allowGroupCorroboration === true;
  return true;
}

export function promotionPolicyLabel(contextType: string | undefined | null): string {
  const tier = memoryClaimTier(contextType);
  if (tier === 2) return 'human_or_corroborated';
  if (tier === 1) return 'grounded_with_freshness_window';
  return 'grounded_low_risk';
}
