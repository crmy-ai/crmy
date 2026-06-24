// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import test from 'node:test';
import { getAllTools } from '../dist/mcp/server.js';
import {
  CORE_TOOLS,
  FULL_TOOLSET,
  TOOLSET_DEFINITIONS,
  isValidToolset,
  listToolsets,
  resolveToolsetName,
  selectToolset,
  toolNamesForToolset,
} from '../dist/mcp/toolsets.js';

// getAllTools only closes over db in handlers; construction needs no live pool.
const dbStub = new Proxy({}, { get: () => () => {} });
const allToolNames = new Set(getAllTools(dbStub).map((tool) => tool.name));
const asTools = (names) => [...names].map((name) => ({ name }));

test('every toolset references only real, registered tools (no drift)', () => {
  const referenced = new Set(CORE_TOOLS);
  for (const def of Object.values(TOOLSET_DEFINITIONS)) {
    for (const name of def.tools) referenced.add(name);
  }
  const unknown = [...referenced].filter((name) => !allToolNames.has(name));
  assert.deepEqual(unknown, [], `toolset definitions reference unknown tools: ${unknown.join(', ')}`);
});

test('all core navigation tools exist', () => {
  for (const name of CORE_TOOLS) {
    assert.ok(allToolNames.has(name), `missing core tool: ${name}`);
  }
});

test('full toolset does not narrow', () => {
  const tools = asTools(allToolNames);
  assert.equal(selectToolset(tools, FULL_TOOLSET).length, tools.length);
  assert.equal(toolNamesForToolset(FULL_TOOLSET), null);
});

test('a named toolset narrows the catalog and always includes core tools', () => {
  const tools = asTools(allToolNames);
  const selected = selectToolset(tools, 'customer_outreach');
  assert.ok(selected.length < tools.length, 'expected the working set to be smaller than the full catalog');
  for (const name of CORE_TOOLS) {
    assert.ok(selected.some((tool) => tool.name === name), `focused toolset should still include core tool: ${name}`);
  }
  assert.ok(selected.some((tool) => tool.name === 'email_draft_preview'));
});

test('selection only narrows — it can never widen beyond the input (scope-safe)', () => {
  // Actor is only allowed two tools; asking for a broad toolset must not add any.
  const allowed = asTools(['tool_guide', 'briefing_get']);
  const selected = selectToolset(allowed, 'systems_writeback');
  assert.ok(selected.every((tool) => allowed.some((a) => a.name === tool.name)));
  assert.ok(selected.length <= allowed.length);
});

test('unknown toolset names do not narrow rather than throwing', () => {
  const tools = asTools(allToolNames);
  assert.equal(selectToolset(tools, 'does-not-exist').length, tools.length);
  assert.equal(toolNamesForToolset('does-not-exist'), null);
});

test('resolveToolsetName precedence: explicit > env > actor default', () => {
  assert.equal(resolveToolsetName('customer_outreach', 'agent', 'ops'), 'customer_outreach');
  assert.equal(resolveToolsetName(undefined, 'agent', 'ops'), 'ops');
  assert.equal(resolveToolsetName('bogus', 'agent', undefined), 'standard', 'invalid explicit falls through to agent default');
  assert.equal(resolveToolsetName(undefined, 'agent', undefined), 'standard');
  assert.equal(resolveToolsetName(undefined, 'user', undefined), FULL_TOOLSET, 'humans default to full');
  assert.equal(resolveToolsetName(undefined, 'system', undefined), FULL_TOOLSET);
  assert.equal(resolveToolsetName(undefined, 'agent', 'full'), FULL_TOOLSET, 'CRMY_MCP_DEFAULT_TOOLSET=full restores legacy behavior');
});

test('toolset names are case-insensitive', () => {
  assert.ok(isValidToolset('STANDARD'));
  assert.ok(isValidToolset('Full'));
  assert.equal(resolveToolsetName('CUSTOMER_OUTREACH', 'agent', undefined), 'customer_outreach');
});

test('isValidToolset guards bad input', () => {
  assert.ok(isValidToolset('full'));
  assert.ok(!isValidToolset('nope'));
  assert.ok(!isValidToolset(undefined));
  assert.ok(!isValidToolset(''));
});

test('listToolsets advertises full plus every defined toolset', () => {
  const names = listToolsets().map((entry) => entry.name);
  assert.ok(names.includes(FULL_TOOLSET));
  for (const name of Object.keys(TOOLSET_DEFINITIONS)) {
    assert.ok(names.includes(name), `tool_guide should advertise toolset: ${name}`);
  }
  assert.ok(listToolsets().every((entry) => typeof entry.description === 'string' && entry.description.length > 0));
});
