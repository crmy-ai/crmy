// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groundedAutoPromoteRequired,
  isPromotionGrounded,
  isSnippetGrounded,
} from '../dist/agent/extraction-grounding.js';

const SOURCE = `Northstar call: Maya is pushing for expansion, but security review is the blocker.
They need technical validation before Friday. Procurement is not involved yet.`;

test('verbatim snippet is grounded', () => {
  assert.ok(isSnippetGrounded('security review is the blocker', SOURCE));
});

test('snippet with punctuation/format drift still grounds via token overlap', () => {
  assert.ok(isSnippetGrounded('Maya is pushing, for expansion!', SOURCE));
});

test('hallucinated snippet is not grounded', () => {
  assert.ok(!isSnippetGrounded('the contract was signed for two million dollars', SOURCE));
});

test('trivially short snippets do not count as grounding', () => {
  assert.ok(!isSnippetGrounded('Friday', SOURCE));
});

test('isPromotionGrounded passes when any evidence snippet is grounded', () => {
  const evidence = [
    { snippet: 'totally invented quote that is not present anywhere' },
    { snippet: 'technical validation before Friday' },
  ];
  assert.ok(isPromotionGrounded(evidence, SOURCE));
});

test('isPromotionGrounded fails when no snippet is grounded', () => {
  const evidence = [
    { snippet: 'invented quote one that is long enough' },
    { snippet: 'another fabricated statement entirely' },
  ];
  assert.ok(!isPromotionGrounded(evidence, SOURCE));
});

test('isPromotionGrounded fails with no evidence, empty snippets, or empty source', () => {
  assert.ok(!isPromotionGrounded([], SOURCE));
  assert.ok(!isPromotionGrounded([{ snippet: '' }, { snippet: null }], SOURCE));
  assert.ok(!isPromotionGrounded([{ snippet: 'security review is the blocker' }], ''));
  assert.ok(!isPromotionGrounded(undefined, SOURCE));
});

test('grounding requirement is on by default and disablable via env', () => {
  assert.ok(groundedAutoPromoteRequired({}));
  assert.ok(groundedAutoPromoteRequired({ CRMY_REQUIRE_GROUNDED_AUTOPROMOTE: '1' }));
  assert.ok(!groundedAutoPromoteRequired({ CRMY_REQUIRE_GROUNDED_AUTOPROMOTE: '0' }));
  assert.ok(!groundedAutoPromoteRequired({ CRMY_REQUIRE_GROUNDED_AUTOPROMOTE: 'false' }));
});
