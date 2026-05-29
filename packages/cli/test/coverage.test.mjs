// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('CLI HTTP client maps every directly-called tool', async () => {
  const clientSource = await read('packages/cli/src/client.ts');
  const mappedTools = new Set([...clientSource.matchAll(/^\s+([a-z0-9_]+):\s*\{/gm)].map(match => match[1]));

  const commandsDir = path.join(root, 'packages/cli/src/commands');
  const commandFiles = (await readdir(commandsDir)).filter(file => file.endsWith('.ts'));
  const calledTools = new Set(['context_ingest', 'context_ingest_auto']);
  for (const file of commandFiles) {
    const source = await read(`packages/cli/src/commands/${file}`);
    for (const match of source.matchAll(/client\.call\(\s*['"]([a-z0-9_]+)['"]/g)) {
      calledTools.add(match[1]);
    }
  }

  const missing = [...calledTools].filter(tool => !mappedTools.has(tool)).sort();
  assert.deepEqual(missing, []);
});

test('curated MCP-to-CLI coverage stays mapped in HTTP mode', async () => {
  const clientSource = await read('packages/cli/src/client.ts');
  const mappedTools = new Set([...clientSource.matchAll(/^\s+([a-z0-9_]+):\s*\{/gm)].map(match => match[1]));
  const expected = [
    'email_draft_preview',
    'email_draft_save',
    'record_draft_preview',
    'calendar_connection_list',
    'calendar_event_search',
    'calendar_event_get',
    'calendar_event_process',
    'calendar_event_add_context',
    'meeting_classification_list',
    'context_lineage_get',
    'context_semantic_search',
    'context_raw_source_reprocess',
    'workflow_update',
    'workflow_test',
    'workflow_clone',
    'workflow_trigger',
    'sequence_list',
    'sequence_get',
    'sequence_enrollment_list',
    'sequence_enroll',
    'sequence_unenroll',
    'sequence_pause',
    'sequence_resume',
    'sequence_analytics',
  ];
  const missing = expected.filter(tool => !mappedTools.has(tool));
  assert.deepEqual(missing, []);
});

test('new MCP agent workflow tools have scope entries', async () => {
  const scopesSource = await read('packages/server/src/auth/scopes.ts');
  for (const tool of ['email_draft_preview', 'email_draft_save', 'record_draft_preview']) {
    assert.match(scopesSource, new RegExp(`${tool}:\\s*\\[`));
  }
});
