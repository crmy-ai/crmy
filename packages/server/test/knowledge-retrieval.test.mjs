// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  retrieveKnowledge,
  isProductKnowledgeConfigured,
  selectClaims,
  upsertProductKnowledgeClaim,
} from '../dist/services/knowledge-retrieval.js';
import { getAllTools, getToolsForActor } from '../dist/mcp/server.js';
import { TOOLSET_DEFINITIONS, CORE_TOOLS } from '../dist/mcp/toolsets.js';
import { getToolScopeRequirements, actorHasScope } from '../dist/auth/scopes.js';

const agent = { tenant_id: 't1', actor_id: 'a1', actor_type: 'agent', role: 'member', scopes: ['read'] };

function claim(over = {}) {
  return {
    id: over.id ?? `c-${Math.random().toString(36).slice(2, 8)}`,
    tenant_id: 't1', category: 'capability', title: 'Title', body: 'Body text', summary: null,
    product_scope: [], competitors: [], personas: [], industries: [],
    source_ref: 'doc:1', source_url: null, source_label: 'Battlecard', source_version: 'v1',
    grounded: true, confidence: 0.9, source_priority: 'authoritative',
    approval_status: 'approved', approved_for_external_use: true, visibility: 'external', status: 'active',
    effective_at: null, valid_until: null, last_verified_at: null, review_owner_id: null,
    external_key: null, metadata: {}, created_at: '2026-01-01', updated_at: '2026-01-01', rank: 0.5,
    ...over,
  };
}

class FakeKnowledgeDb {
  constructor(claims = []) { this.claims = claims; this.inserts = []; this.failSearch = false; }
  async query(sql, params) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.includes('count(*)::int AS count FROM knowledge_claims')) {
      return { rows: [{ count: this.claims.filter(c => c.status !== 'rejected').length }], rowCount: 1 };
    }
    if (text.startsWith('SELECT *') && text.includes('FROM knowledge_claims')) {
      if (this.failSearch) throw new Error('search boom');
      return { rows: this.claims, rowCount: this.claims.length };
    }
    if (text.includes('INSERT INTO knowledge_retrieval_receipts')) {
      return { rows: [{ id: 'receipt-1', policy: params[4], retrieved_at: '2026-06-24T00:00:00Z' }], rowCount: 1 };
    }
    if (text.includes('INSERT INTO knowledge_claims')) {
      this.inserts.push(params);
      return { rows: [claim({ id: 'new', category: params[2], title: params[3], body: params[4], grounded: params[14] })], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  }
}

// ---- Pure decision core ----

test('customer_facing keeps approved+grounded+external claims and excludes the rest with reasons', () => {
  const { claims, excluded } = selectClaims([
    claim({ id: 'ok' }),
    claim({ id: 'ungrounded', grounded: false }),
    claim({ id: 'internal', visibility: 'internal' }),
    claim({ id: 'unapproved', approval_status: 'pending' }),
    claim({ id: 'not_safe', approved_for_external_use: false }),
    claim({ id: 'deprecated', status: 'deprecated' }),
    claim({ id: 'expired', valid_until: '2000-01-01T00:00:00Z' }),
  ], { query: 'x', audience: 'customer_facing' });

  assert.deepEqual(claims.map(c => c.id), ['ok']);
  const reasons = Object.fromEntries(excluded.map(e => [e.id, e.reason]));
  assert.equal(reasons.ungrounded, 'ungrounded');
  assert.equal(reasons.internal, 'internal_only');
  assert.equal(reasons.unapproved, 'unapproved');
  assert.equal(reasons.not_safe, 'not_external_safe');
  assert.equal(reasons.deprecated, 'deprecated');
  assert.equal(reasons.expired, 'stale');
});

test('internal audience includes risky claims with warnings, but never deprecated', () => {
  const { claims, excluded, warnings } = selectClaims([
    claim({ id: 'unapproved', approval_status: 'pending', visibility: 'internal' }),
    claim({ id: 'deprecated', status: 'deprecated' }),
  ], { query: 'x', audience: 'internal' });

  assert.ok(claims.some(c => c.id === 'unapproved'), 'internal use surfaces unapproved with a warning');
  assert.ok(warnings.some(w => w.includes('internal use')));
  assert.deepEqual(excluded.map(e => e.id), ['deprecated']);
});

test('ranks authoritative above secondary and respects limit', () => {
  const { claims } = selectClaims([
    claim({ id: 'sec', source_priority: 'secondary' }),
    claim({ id: 'auth', source_priority: 'authoritative' }),
    claim({ id: 'inf', source_priority: 'informal' }),
  ], { query: 'x', audience: 'customer_facing', limit: 2 });
  assert.deepEqual(claims.map(c => c.id), ['auth', 'sec']);
});

// ---- Service over a fake DB ----

test('not_configured when no claims exist (optional, non-blocking)', async () => {
  const db = new FakeKnowledgeDb([]);
  assert.equal(await isProductKnowledgeConfigured(db, 't1'), false);
  const result = await retrieveKnowledge(db, agent, { query: 'pricing' });
  assert.equal(result.status, 'not_configured');
  assert.ok(result.message);
});

test('available returns claims with a retrieval receipt', async () => {
  const db = new FakeKnowledgeDb([claim({ id: 'ok' })]);
  const result = await retrieveKnowledge(db, agent, { query: 'vendor lock-in' });
  assert.equal(result.status, 'available');
  assert.deepEqual(result.claims.map(c => c.id), ['ok']);
  assert.ok(result.retrieval_receipt?.id);
  assert.equal(result.retrieval_receipt.policy, 'customer_facing_approved_grounded');
});

test('no_results when candidates are all filtered out', async () => {
  const db = new FakeKnowledgeDb([claim({ id: 'ungrounded', grounded: false })]);
  const result = await retrieveKnowledge(db, agent, { query: 'x' });
  assert.equal(result.status, 'no_results');
  assert.equal(result.claims.length, 0);
  assert.equal(result.excluded_claims[0].reason, 'ungrounded');
});

test('retrieval degrades (not fails) on a backend error', async () => {
  const db = new FakeKnowledgeDb([claim()]);
  db.failSearch = true;
  const result = await retrieveKnowledge(db, agent, { query: 'x' });
  assert.equal(result.status, 'degraded');
});

test('upsert verifies grounding against source_text', async () => {
  const db = new FakeKnowledgeDb([]);
  const admin = { ...agent, role: 'admin', scopes: ['*'] };
  await upsertProductKnowledgeClaim(db, admin, {
    category: 'competitive_response', title: 'Lock-in', body: 'CRMy is open source and self-hostable.',
    source_text: 'Our docs note CRMy is open source and self-hostable under Apache-2.0.',
  });
  assert.equal(db.inserts[0][14], true, 'grounded should be true when body is supported by source_text');

  await upsertProductKnowledgeClaim(db, admin, {
    category: 'competitive_response', title: 'Lock-in', body: 'CRMy beats every competitor on price.',
    source_text: 'Our docs describe the context engine architecture.',
  });
  assert.equal(db.inserts[1][14], false, 'grounded should be false when body is not in source_text');
});

// ---- Registration / governance surface ----

test('both knowledge tools are registered with correct scopes and tiers', () => {
  const tools = getAllTools(new FakeKnowledgeDb());
  const byName = new Map(tools.map(t => [t.name, t]));
  assert.ok(byName.has('knowledge_retrieve'));
  assert.ok(byName.has('knowledge_claim_upsert'));
  assert.deepEqual(getToolScopeRequirements('knowledge_retrieve'), ['knowledge:read']);
  assert.deepEqual(getToolScopeRequirements('knowledge_claim_upsert'), ['knowledge:write']);
  assert.equal(byName.get('knowledge_claim_upsert').tier, 'admin');
  assert.ok(actorHasScope({ ...agent, scopes: ['read'] }, 'knowledge:read'));
});

test('knowledge_claim_upsert is admin-only; agents only see knowledge_retrieve', () => {
  const db = new FakeKnowledgeDb();
  const agentTools = new Set(getToolsForActor(db, { ...agent, scopes: ['read', 'write'] }).map(t => t.name));
  assert.ok(agentTools.has('knowledge_retrieve'));
  assert.ok(!agentTools.has('knowledge_claim_upsert'), 'non-admin agents must not see the claim author tool');

  const adminTools = new Set(getToolsForActor(db, { ...agent, role: 'admin', scopes: ['*'] }).map(t => t.name));
  assert.ok(adminTools.has('knowledge_claim_upsert'));
});

test('knowledge_retrieve is in product_knowledge and customer_outreach toolsets; not in core', () => {
  assert.ok(TOOLSET_DEFINITIONS.product_knowledge.tools.includes('knowledge_retrieve'));
  assert.ok(TOOLSET_DEFINITIONS.customer_outreach.tools.includes('knowledge_retrieve'));
  assert.ok(!CORE_TOOLS.includes('knowledge_retrieve'));
});
