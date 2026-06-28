// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

// Phase 6 (freshness) + Phase 7 (governance) for Trusted Facts.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  freshnessWindowDays,
  computeStaleClaimIds,
  sweepTenantKnowledgeFreshness,
  DEFAULT_FRESHNESS_WINDOW_DAYS,
} from '../dist/services/knowledge-freshness.js';
import {
  reviewDecisionToPatch,
  reviewKnowledgeClaim,
  listKnowledgeClaimsForReview,
  conflictBasis,
  classifyConflict,
  detectKnowledgeConflicts,
  processKnowledgeReviewsForTenant,
  rowToKnowledgeRecord,
} from '../dist/services/knowledge-governance.js';
import { inferKnowledgeType } from '../dist/db/repos/knowledge-claims.js';
import { getToolScopeRequirements } from '../dist/auth/scopes.js';
import { getAllTools } from '../dist/mcp/server.js';

const admin = { tenant_id: 't1', actor_id: 'a1', actor_type: 'agent', role: 'admin', scopes: ['*'] };
const DAY = 24 * 60 * 60 * 1000;

function row(over = {}) {
  return {
    id: over.id ?? `c-${Math.random().toString(36).slice(2, 8)}`,
    tenant_id: 't1', category: 'capability', title: 'Title', body: 'Body', summary: null,
    product_scope: [], competitors: [], personas: [], industries: [],
    source_ref: 'doc:1', source_url: null, source_label: 'Doc', source_version: 'v1',
    grounded: true, confidence: 0.9, source_priority: 'secondary',
    approval_status: 'approved', approved_for_external_use: true, visibility: 'external', status: 'active',
    effective_at: null, valid_until: null, last_verified_at: null, review_owner_id: null, created_by: null,
    external_key: null, metadata: {}, created_at: '2026-01-01', updated_at: '2026-01-01',
    ...over,
  };
}

// ── Phase 6: freshness windows (pure) ────────────────────────────────────────

test('freshnessWindowDays maps categories by keyword with a stable default', () => {
  assert.equal(freshnessWindowDays('pricing_note'), 21);
  assert.equal(freshnessWindowDays('roadmap_caveat'), 21);
  assert.equal(freshnessWindowDays('competitive_response'), 45);
  assert.equal(freshnessWindowDays('security_posture'), 60);
  assert.equal(freshnessWindowDays('implementation_requirement'), 90);
  assert.equal(freshnessWindowDays('proof_point'), 120);
  assert.equal(freshnessWindowDays('capability'), DEFAULT_FRESHNESS_WINDOW_DAYS);
  assert.equal(freshnessWindowDays('totally_unknown'), DEFAULT_FRESHNESS_WINDOW_DAYS);
});

test('computeStaleClaimIds: explicit expiry wins; verified-age uses the category window', () => {
  const now = new Date('2026-06-25T00:00:00Z');
  const ids = computeStaleClaimIds([
    row({ id: 'expired', valid_until: '2026-06-01T00:00:00Z' }),
    row({ id: 'future', valid_until: '2026-12-01T00:00:00Z' }),
    // competitive window is 45 days; verified 60 days ago -> stale
    row({ id: 'aged', category: 'competitive_response', last_verified_at: new Date(now.getTime() - 60 * DAY).toISOString() }),
    // verified 10 days ago -> fresh
    row({ id: 'recent', category: 'competitive_response', last_verified_at: new Date(now.getTime() - 10 * DAY).toISOString() }),
    // no expiry and never verified -> not auto-staled
    row({ id: 'never', last_verified_at: null }),
  ], now);
  assert.deepEqual(ids.sort(), ['aged', 'expired']);
});

test('sweepTenantKnowledgeFreshness demotes expired active claims to stale', async () => {
  const claims = [row({ id: 'a', valid_until: '2000-01-01T00:00:00Z' }), row({ id: 'b' })];
  const db = new FakeGovDb(claims);
  const marked = await sweepTenantKnowledgeFreshness(db, 't1');
  assert.equal(marked, 1);
  assert.equal(claims.find(c => c.id === 'a').status, 'stale');
  assert.equal(claims.find(c => c.id === 'b').status, 'active');
});

// ── Phase 7: review decisions (pure) ─────────────────────────────────────────

test('reviewDecisionToPatch: approve re-verifies and revives a stale claim', () => {
  const patch = reviewDecisionToPatch('approve', { status: 'stale' }, { approved_for_external_use: true });
  assert.equal(patch.approval_status, 'approved');
  assert.equal(patch.status, 'active');
  assert.equal(patch.touch_verified, true);
  assert.equal(patch.approved_for_external_use, true);
  assert.equal(patch.visibility, 'external');
});

test('reviewDecisionToPatch: reject/deprecate/mark_stale/reactivate transitions', () => {
  assert.deepEqual(reviewDecisionToPatch('reject', { status: 'active' }), { approval_status: 'rejected', status: 'rejected', approved_for_external_use: false, visibility: 'internal' });
  assert.deepEqual(reviewDecisionToPatch('deprecate', { status: 'active' }), { status: 'deprecated', approved_for_external_use: false, visibility: 'internal' });
  assert.deepEqual(reviewDecisionToPatch('mark_stale', { status: 'active' }), { status: 'stale' });
  const reactivate = reviewDecisionToPatch('reactivate', { status: 'deprecated' });
  assert.equal(reactivate.status, 'active');
  assert.equal(reactivate.touch_verified, true);
});

test('reviewDecisionToPatch: approve does not flip an already-active claim status', () => {
  const patch = reviewDecisionToPatch('approve', { status: 'active' });
  assert.equal(patch.status, undefined);
  assert.equal(patch.approval_status, 'approved');
});

// ── Phase 7: conflict classification (pure) ──────────────────────────────────

const c = (over) => row(over);

test('conflictBasis requires same category and prefers competitor > scope > broad', () => {
  assert.equal(conflictBasis(c({ category: 'a' }), c({ category: 'b' })), null);
  assert.deepEqual(conflictBasis(c({ competitors: ['Attio'] }), c({ competitors: ['attio'] })).basis, 'competitor');
  assert.deepEqual(conflictBasis(c({ product_scope: ['mcp'] }), c({ product_scope: ['mcp'] })).basis, 'product_scope');
  assert.deepEqual(conflictBasis(c({}), c({})).basis, 'category');
  assert.equal(conflictBasis(c({ product_scope: ['mcp'] }), c({ product_scope: ['saas'] })), null);
});

test('classifyConflict resolves by source priority then approval, else manual review', () => {
  const auth = classifyConflict(c({ id: 'hi', source_priority: 'authoritative' }), c({ id: 'lo', source_priority: 'informal' }));
  assert.equal(auth.suggested_action, 'prefer_authoritative');
  assert.equal(auth.loser_id, 'lo');

  const appr = classifyConflict(
    c({ id: 'ok', source_priority: 'secondary', approval_status: 'approved' }),
    c({ id: 'bad', source_priority: 'secondary', approval_status: 'pending' }),
  );
  assert.equal(appr.suggested_action, 'prefer_approved');
  assert.equal(appr.loser_id, 'bad');

  const manual = classifyConflict(c({ source_priority: 'secondary' }), c({ source_priority: 'secondary' }));
  assert.equal(manual.suggested_action, 'manual_review');
  assert.equal(manual.loser_id, undefined);
});

// ── Phase 7: governance services over a fake DB ──────────────────────────────

test('reviewKnowledgeClaim applies the decision and returns the updated record', async () => {
  const claims = [row({ id: 'x', status: 'stale', approval_status: 'pending', approved_for_external_use: false })];
  const db = new FakeGovDb(claims);
  const result = await reviewKnowledgeClaim(db, admin, { id: 'x', decision: 'approve', approved_for_external_use: true });
  assert.equal(result.status, 'active');
  assert.equal(result.approval_status, 'approved');
  assert.equal(result.approved_for_external_use, true);
  assert.ok(result.last_verified_at, 'approve re-verifies freshness');
});

test('reviewKnowledgeClaim returns null for an unknown claim', async () => {
  const db = new FakeGovDb([]);
  assert.equal(await reviewKnowledgeClaim(db, admin, { id: 'missing', decision: 'approve' }), null);
});

test('listKnowledgeClaimsForReview maps full governance records', async () => {
  const db = new FakeGovDb([row({ id: 'q', status: 'conflicting', review_owner_id: 'owner-1' })]);
  const { claims, count } = await listKnowledgeClaimsForReview(db, admin, { needs_review: true });
  assert.equal(count, 1);
  assert.equal(claims[0].status, 'conflicting');
  assert.equal(claims[0].review_owner_id, 'owner-1');
});

test('detectKnowledgeConflicts finds competing claims and apply marks the loser', async () => {
  const claims = [
    row({ id: 'hi', category: 'competitive_response', competitors: ['Attio'], source_priority: 'authoritative' }),
    row({ id: 'lo', category: 'competitive_response', competitors: ['Attio'], source_priority: 'informal' }),
    row({ id: 'other', category: 'pricing', competitors: ['Attio'] }),
  ];
  const db = new FakeGovDb(claims);
  const { conflicts, applied } = await detectKnowledgeConflicts(db, admin, { apply: true });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].suggested_action, 'prefer_authoritative');
  assert.equal(applied, 1);
  assert.equal(claims.find(x => x.id === 'lo').status, 'conflicting');
  assert.equal(claims.find(x => x.id === 'hi').status, 'active');
});

test('processKnowledgeReviewsForTenant opens an assignment per owned reviewable claim', async () => {
  const db = new FakeGovDb([
    row({ id: 'r1', status: 'stale', review_owner_id: 'owner-1', created_by: 'author-1' }),
    row({ id: 'r2', status: 'conflicting', review_owner_id: 'owner-2' }),
    row({ id: 'r3', status: 'active', review_owner_id: 'owner-3' }), // not reviewable
  ]);
  const created = await processKnowledgeReviewsForTenant(db, 't1');
  assert.equal(created, 2);
  assert.equal(db.assignments.length, 2);
  // assigned_to is the review owner; high priority for conflicting claims
  const assignTos = db.assignments.map(a => a.assigned_to);
  assert.ok(assignTos.includes('owner-1') && assignTos.includes('owner-2'));
});

test('rowToKnowledgeRecord omits empty optionals and includes the governed envelope body', () => {
  const rec = rowToKnowledgeRecord(row({ id: 'rec', summary: null, body: 'secret internal text' }));
  assert.equal(rec.id, 'rec');
  assert.equal(rec.knowledge_type, 'product');
  assert.equal('summary' in rec, false);
  assert.equal(rec.body, 'secret internal text');
});

test('inferKnowledgeType honors explicit metadata and legacy category/scope signals', () => {
  assert.equal(inferKnowledgeType(row({ metadata: { knowledge_type: 'company' } })), 'company');
  assert.equal(inferKnowledgeType(row({ competitors: ['Attio'] })), 'competitor');
  assert.equal(inferKnowledgeType(row({ category: 'competitive_response' })), 'competitor');
  assert.equal(inferKnowledgeType(row({ category: 'positioning_overview' })), 'company');
  assert.equal(inferKnowledgeType(row({ category: 'security' })), 'product');
});

// ── Registration / scopes ────────────────────────────────────────────────────

test('governance tools are registered admin-tier with knowledge scopes', () => {
  const byName = new Map(getAllTools(new FakeGovDb()).map(t => [t.name, t]));
  for (const name of ['knowledge_claim_list', 'knowledge_claim_review', 'knowledge_conflicts_detect']) {
    assert.ok(byName.has(name), `${name} registered`);
    assert.equal(byName.get(name).tier, 'admin', `${name} is admin-tier`);
  }
  assert.deepEqual(getToolScopeRequirements('knowledge_claim_list'), ['knowledge:read']);
  assert.deepEqual(getToolScopeRequirements('knowledge_claim_review'), ['knowledge:write']);
  assert.deepEqual(getToolScopeRequirements('knowledge_conflicts_detect'), ['knowledge:write']);
});

test('Trusted Fact mutation tools expose idempotency keys for safe retries', () => {
  const byName = new Map(getAllTools(new FakeGovDb()).map(t => [t.name, t]));
  for (const name of ['knowledge_claim_upsert', 'knowledge_claim_review', 'knowledge_conflicts_detect']) {
    assert.ok(byName.get(name).inputSchema.shape.idempotency_key, `${name} accepts idempotency_key`);
  }
});

// ── Fake DB ──────────────────────────────────────────────────────────────────

class FakeGovDb {
  constructor(claims = []) { this.claims = claims; this.assignments = []; }
  _find(id) { return this.claims.find(c => c.id === id); }
  async query(sql, params) {
    const t = sql.replace(/\s+/g, ' ').trim();

    if (t.startsWith('SELECT * FROM knowledge_claims WHERE tenant_id = $1 AND id = $2')) {
      const r = this._find(params[1]);
      return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
    }
    if (t.includes('SELECT id, category, effective_at, valid_until, last_verified_at')) {
      const rows = this.claims.filter(x => x.status === 'active');
      return { rows, rowCount: rows.length };
    }
    if (t.includes('FROM knowledge_claims kc') && t.includes('NOT EXISTS')) {
      const rows = this.claims.filter(x => x.review_owner_id
        && (['stale', 'conflicting'].includes(x.status) || ['pending', 'unapproved'].includes(x.approval_status)));
      return { rows, rowCount: rows.length };
    }
    if (t.startsWith('SELECT * FROM knowledge_claims WHERE') && t.includes("status NOT IN ('deprecated', 'rejected')")) {
      const rows = this.claims.filter(x => !['deprecated', 'rejected'].includes(x.status));
      return { rows, rowCount: rows.length };
    }
    if (t.includes('AS rank FROM knowledge_claims')) {
      return { rows: this.claims.slice(), rowCount: this.claims.length };
    }
    if (t.includes("SET status = 'stale'") && t.includes('id = ANY')) {
      const ids = params[1];
      let n = 0;
      for (const x of this.claims) if (ids.includes(x.id) && x.status === 'active') { x.status = 'stale'; n++; }
      return { rows: [], rowCount: n };
    }
    if (t.startsWith('UPDATE knowledge_claims SET') && t.includes('RETURNING *')) {
      const r = this._find(params[1]);
      if (!r) return { rows: [], rowCount: 0 };
      const setPart = t.slice('UPDATE knowledge_claims SET'.length, t.indexOf(' WHERE'));
      for (const m of setPart.matchAll(/(\w+)\s*=\s*\$(\d+)/g)) {
        r[m[1]] = params[Number(m[2]) - 1];
      }
      if (/last_verified_at = now\(\)/.test(setPart)) r.last_verified_at = '2026-06-25T00:00:00Z';
      return { rows: [r], rowCount: 1 };
    }
    if (t.includes('INSERT INTO assignments')) {
      this.assignments.push({ assigned_by: params[4], assigned_to: params[5], type: params[3] });
      return { rows: [{ id: `asg-${this.assignments.length}` }], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${t.slice(0, 90)}`);
  }
}
