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
  recordedCertificationForModel,
} from '../dist/services/model-certification.js';
import { setModelCertification } from '../dist/db/repos/agent.js';
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

test('Tier-2 corroborated policy requires independent sources and recency', () => {
  const base = {
    contextType: 'deal_risk',
    confidence: 0.92,
    threshold: 0.85,
    evidenceCount: 1,
    sourceGrounded: true,
    readinessReady: true,
    tier2AutopromotePolicy: 'corroborated',
    recencySatisfied: true,
  };

  assert.equal(canAutoPromoteSignalByTrustTier(base), false);
  assert.equal(canAutoPromoteSignalByTrustTier({ ...base, independentSourceCount: 1 }), false);
  assert.equal(canAutoPromoteSignalByTrustTier({ ...base, independentSourceCount: 2 }), true);
  assert.equal(canAutoPromoteSignalByTrustTier({ ...base, independentSourceCount: 2, recencySatisfied: false }), false);
  assert.equal(canAutoPromoteSignalByTrustTier({ ...base, independentSourceCount: 2, sourceGrounded: false }), false);
  assert.equal(canAutoPromoteSignalByTrustTier({ ...base, independentSourceCount: 2, confidence: 0.7 }), false);
});

test('Tier-2 human_only policy never auto-promotes', () => {
  assert.equal(canAutoPromoteSignalByTrustTier({
    contextType: 'forecast_signal',
    confidence: 0.99,
    threshold: 0.85,
    evidenceCount: 2,
    independentSourceCount: 3,
    tier2AutopromotePolicy: 'human_only',
    recencySatisfied: true,
    sourceGrounded: true,
    readinessReady: true,
  }), false);
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

test('pre-certified recommended models carry gate-valid recorded provenance only on exact matches', () => {
  const recommended = recordedCertificationForModel({
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1/',
    model: 'gpt-5.2',
  });
  assert.ok(recommended);
  assert.equal(modelCertificationMeetsAutoPromoteGate(recommended), true);
  assert.equal(recordedCertificationForModel({
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'arbitrary-local-model',
  }), null);
});

test('setModelCertification rejects non-passing certified evidence before writing', async () => {
  let wrote = false;
  const db = {
    async query() {
      wrote = true;
      throw new Error('should not write');
    },
  };
  await assert.rejects(
    () => setModelCertification(db, 'tenant-1', {
      status: 'certified',
      profile: 'contract',
      runId: 'eval_contract',
      score: 1,
    }),
    /requires a passing live_model eval/,
  );
  assert.equal(wrote, false);
});
