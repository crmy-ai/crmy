// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAutoPromoteSignalByTrustTier,
  defaultMemoryReviewDate,
  groundingMethodForPromotion,
  memoryClaimTier,
  memoryFreshnessWindowDays,
  shouldMarkMemoryDueForReview,
} from '../dist/services/memory-trust.js';
import {
  autoPromoteBlockedByModelCertification,
  isModelCertifiedForAutoPromote,
  modelCertificationMeetsAutoPromoteGate,
  modelCertificationRequired,
} from '../dist/services/model-certification.js';
import { computeMemoryIdsDueForReview } from '../dist/services/staleness.js';

const DAY = 24 * 60 * 60 * 1000;

test('memoryClaimTier classifies low-risk, volatile, and high-impact context types', () => {
  assert.equal(memoryClaimTier('preference'), 0);
  assert.equal(memoryClaimTier('competitive_intel'), 1);
  assert.equal(memoryClaimTier('next_step'), 1);
  assert.equal(memoryClaimTier('forecast_signal'), 2);
  assert.equal(memoryClaimTier('commitment'), 2);
});

test('canAutoPromoteSignalByTrustTier requires grounded evidence and blocks fragile claims', () => {
  const base = {
    contextType: 'preference',
    confidence: 0.9,
    threshold: 0.85,
    evidenceCount: 1,
    sourceGrounded: true,
    readinessReady: true,
  };

  assert.equal(canAutoPromoteSignalByTrustTier(base), true);
  assert.equal(canAutoPromoteSignalByTrustTier({ ...base, sourceGrounded: false }), false);
  assert.equal(canAutoPromoteSignalByTrustTier({ ...base, speculative: true }), false);
  assert.equal(canAutoPromoteSignalByTrustTier({ ...base, evidenceCount: 0 }), false);
  assert.equal(canAutoPromoteSignalByTrustTier({ ...base, confidence: 0.7 }), false);
});

test('high-impact claims need corroboration unless the grouping pass can find it', () => {
  const base = {
    contextType: 'deal_risk',
    confidence: 0.92,
    threshold: 0.85,
    evidenceCount: 1,
    sourceGrounded: true,
    readinessReady: true,
  };

  assert.equal(canAutoPromoteSignalByTrustTier(base), false);
  assert.equal(canAutoPromoteSignalByTrustTier({ ...base, independentSourceCount: 2 }), true);
  assert.equal(canAutoPromoteSignalByTrustTier({ ...base, allowGroupCorroboration: true }), true);
});

test('promotion grounding method reflects who or what confirmed Memory', () => {
  assert.equal(groundingMethodForPromotion({}), 'lexical');
  assert.equal(groundingMethodForPromotion({ independentSourceCount: 2 }), 'corroborated');
  assert.equal(groundingMethodForPromotion({ humanReviewed: true, independentSourceCount: 2 }), 'human_reviewed');
});

test('defaultMemoryReviewDate uses type-specific freshness windows', () => {
  const now = new Date('2026-06-28T00:00:00Z');
  assert.equal(memoryFreshnessWindowDays('forecast_signal'), 30);
  assert.equal(memoryFreshnessWindowDays('competitive_intel'), 45);
  assert.equal(defaultMemoryReviewDate('forecast_signal', now), new Date(now.getTime() + 30 * DAY).toISOString());
});

test('shouldMarkMemoryDueForReview flags undated active Memory after its window', () => {
  const now = new Date('2026-06-28T00:00:00Z');
  assert.equal(shouldMarkMemoryDueForReview({
    context_type: 'competitive_intel',
    created_at: new Date(now.getTime() - 60 * DAY).toISOString(),
  }, now), true);
  assert.equal(shouldMarkMemoryDueForReview({
    context_type: 'competitive_intel',
    created_at: new Date(now.getTime() - 10 * DAY).toISOString(),
  }, now), false);
  assert.equal(shouldMarkMemoryDueForReview({
    context_type: 'competitive_intel',
    valid_until: '2026-07-01T00:00:00Z',
    created_at: new Date(now.getTime() - 60 * DAY).toISOString(),
  }, now), false);
});

test('computeMemoryIdsDueForReview returns only rows past their freshness window', () => {
  const now = new Date('2026-06-28T00:00:00Z');
  const ids = computeMemoryIdsDueForReview([
    {
      id: 'old-competitive',
      context_type: 'competitive_intel',
      valid_until: null,
      reviewed_at: null,
      promoted_at: null,
      updated_at: null,
      created_at: new Date(now.getTime() - 60 * DAY).toISOString(),
    },
    {
      id: 'fresh-competitive',
      context_type: 'competitive_intel',
      valid_until: null,
      reviewed_at: null,
      promoted_at: null,
      updated_at: null,
      created_at: new Date(now.getTime() - 10 * DAY).toISOString(),
    },
  ], now);
  assert.deepEqual(ids, ['old-competitive']);
});

test('model certification is required for auto-promotion by default', () => {
  assert.equal(modelCertificationRequired({}), true);
  assert.equal(isModelCertifiedForAutoPromote({ model_certification_status: 'uncertified' }, {}), false);
  assert.equal(isModelCertifiedForAutoPromote({ model_certification_status: 'failed' }, {}), false);
  assert.equal(isModelCertifiedForAutoPromote({ model_certification_status: 'certified' }, {}), false);
  assert.equal(isModelCertifiedForAutoPromote({
    model_certification_status: 'certified',
    model_certification_profile: 'live_model',
    model_certification_run_id: 'eval_run_123',
    model_certification_score: 0.91,
  }, {}), true);
});

test('model certification gate can be disabled only by explicit operator env', () => {
  const env = { CRMY_REQUIRE_MODEL_CERTIFIED_AUTOPROMOTE: 'false' };
  assert.equal(modelCertificationRequired(env), false);
  assert.equal(isModelCertifiedForAutoPromote({ model_certification_status: 'uncertified' }, env), true);
});

test('autoPromoteBlockedByModelCertification respects user-disabled auto-promotion', () => {
  assert.equal(autoPromoteBlockedByModelCertification({
    auto_promote_signals: true,
    model_certification_status: 'uncertified',
  }, {}), true);
  assert.equal(autoPromoteBlockedByModelCertification({
    auto_promote_signals: false,
    model_certification_status: 'uncertified',
  }, {}), false);
});

test('modelCertificationMeetsAutoPromoteGate requires live-model run evidence', () => {
  assert.equal(modelCertificationMeetsAutoPromoteGate({
    model_certification_status: 'certified',
    model_certification_profile: 'contract',
    model_certification_run_id: 'eval_run_123',
    model_certification_score: 0.99,
  }), false);
  assert.equal(modelCertificationMeetsAutoPromoteGate({
    model_certification_status: 'certified',
    model_certification_profile: 'live_model',
    model_certification_run_id: '',
    model_certification_score: 0.99,
  }), false);
  assert.equal(modelCertificationMeetsAutoPromoteGate({
    model_certification_status: 'certified',
    model_certification_profile: 'live_model',
    model_certification_run_id: 'eval_run_123',
    model_certification_score: 0.84,
  }), false);
});
