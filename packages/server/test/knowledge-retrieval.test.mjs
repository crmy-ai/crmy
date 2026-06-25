// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import test from 'node:test';
import { retrieveKnowledge, isProductKnowledgeConfigured } from '../dist/services/knowledge-retrieval.js';
import { getAllTools } from '../dist/mcp/server.js';
import { TOOLSET_DEFINITIONS, CORE_TOOLS } from '../dist/mcp/toolsets.js';
import { getToolScopeRequirements, actorHasScope } from '../dist/auth/scopes.js';

const dbStub = new Proxy({}, { get: () => () => {} });
const actor = { tenant_id: 't1', actor_id: 'a1', actor_type: 'agent', role: 'member', scopes: ['read'] };

test('product knowledge is not configured in Phase 1', async () => {
  assert.equal(await isProductKnowledgeConfigured(dbStub, 't1'), false);
});

test('retrieveKnowledge is optional and non-blocking — returns not_configured', async () => {
  const result = await retrieveKnowledge(dbStub, actor, { query: 'vendor lock-in objection' });
  assert.equal(result.status, 'not_configured');
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.excluded_claims, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.retrieval_receipt, undefined);
  assert.ok(typeof result.message === 'string' && result.message.length > 0, 'should explain not_configured to the agent');
});

test('knowledge_retrieve is a registered MCP tool', () => {
  const names = new Set(getAllTools(dbStub).map(tool => tool.name));
  assert.ok(names.has('knowledge_retrieve'));
});

test('knowledge_retrieve requires knowledge:read, satisfied by the read wildcard', () => {
  assert.deepEqual(getToolScopeRequirements('knowledge_retrieve'), ['knowledge:read']);
  assert.ok(actorHasScope({ ...actor, scopes: ['read'] }, 'knowledge:read'));
  assert.ok(!actorHasScope({ ...actor, scopes: ['contacts:read'] }, 'knowledge:read'));
});

test('knowledge_retrieve is in the product_knowledge and customer_outreach toolsets', () => {
  assert.ok(TOOLSET_DEFINITIONS.product_knowledge, 'product_knowledge toolset should exist');
  assert.ok(TOOLSET_DEFINITIONS.product_knowledge.tools.includes('knowledge_retrieve'));
  assert.ok(TOOLSET_DEFINITIONS.customer_outreach.tools.includes('knowledge_retrieve'));
  // It is an opt-in tool, not part of the always-present core navigation set.
  assert.ok(!CORE_TOOLS.includes('knowledge_retrieve'));
});
