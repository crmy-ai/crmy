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

test('CLI HTTP mode falls back to actor-scoped generic MCP tool bridge', async () => {
  const clientSource = await read('packages/cli/src/client.ts');
  const routerSource = await read('packages/server/src/rest/router.ts');
  const openApiSource = await read('packages/server/src/openapi/paths.ts');
  const indexSource = await read('packages/cli/src/index.ts');
  const toolsCommandSource = await read('packages/cli/src/commands/tools.ts');
  const describeSource = await read('packages/server/src/mcp/tool-describe.ts');

  assert.match(clientSource, /callGenericTool/);
  assert.match(clientSource, /\/api\/v1\/tools\/\$\{toolName\}\/call/);
  assert.doesNotMatch(clientSource, /no REST mapping/);
  assert.match(routerSource, /router\.get\('\/tools'/);
  assert.match(routerSource, /router\.get\('\/tools\/:tool_name'/);
  assert.match(routerSource, /router\.post\('\/tools\/:tool_name\/call'/);
  assert.match(routerSource, /getToolsForActor\(db, actor\)/);
  assert.match(routerSource, /describeTool\(tool\)/);
  assert.match(routerSource, /tool\.inputSchema\.parse\(normalizeToolInput\(input\)\)/);
  assert.match(openApiSource, /path: '\/tools\/\{tool_name\}'/);
  assert.match(openApiSource, /path: '\/tools\/\{tool_name\}\/call'/);
  assert.match(indexSource, /toolsCommand/);
  assert.match(clientSource, /describeTool\?/);
  assert.match(toolsCommandSource, /command\('call <tool_name>'\)/);
  assert.match(toolsCommandSource, /command\('describe <tool_name>'\)/);
  assert.match(describeSource, /export function zodToJsonSchema/);
  assert.match(describeSource, /export function describeTool/);
});

test('friendly CLI commands stay mapped to efficient HTTP routes', async () => {
  const clientSource = await read('packages/cli/src/client.ts');
  const mappedTools = new Set([...clientSource.matchAll(/^\s+([a-z0-9_]+):\s*\{/gm)].map(match => match[1]));
  const expected = [
    'customer_record_resolve',
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

test('direct DB CLI uses actor-scoped MCP tool filtering', async () => {
  const clientSource = await read('packages/cli/src/client.ts');
  assert.match(clientSource, /getToolsForActor/);
  assert.doesNotMatch(clientSource, /const tools = getAllTools\(db\)/);
  assert.match(clientSource, /actorScopes \? keyScopes\.filter/);
  assert.match(clientSource, /Invalid CRMY_API_KEY/);
});

test('agent harness setup avoids npx prompts and includes systems scopes', async () => {
  const readme = await read('README.md');
  const guide = await read('docs/guide.md');
  const initSource = await read('packages/cli/src/commands/init.ts');
  const doctorSource = await read('packages/cli/src/commands/doctor.ts');
  const providerSource = await read('packages/shared/src/agent-providers.ts');
  const webProviderSource = await read('packages/web/src/lib/agentProviders.ts');
  assert.match(readme, /npx -y @crmy\/cli mcp/);
  assert.match(guide, /npx -y @crmy\/cli mcp/);
  assert.match(initSource, /systems:read,systems:write,systems:admin/);
  assert.match(initSource, /chooseAgentSetup/);
  assert.match(initSource, /CRMY_AGENT_PROVIDER/);
  assert.match(doctorSource, /Workspace Agent online/);
  assert.match(doctorSource, /CRMY_API_KEY is valid for this workspace/);
  assert.match(doctorSource, /does not match this database/);
  assert.match(providerSource, /export const PROVIDERS/);
  for (const provider of [
    'azure_openai',
    'google_gemini',
    'aws_bedrock',
    'mistral',
    'litellm',
    'openrouter',
    'ollama',
    'databricks',
    'nvidia_nim',
    'custom',
  ]) {
    assert.match(providerSource, new RegExp(`id: '${provider}'`));
  }
  assert.match(webProviderSource, /from '@crmy\/shared'/);
});

test('workspace agent provider catalog and backup config stay wired', async () => {
  const providerSource = await read('packages/shared/src/agent-providers.ts');
  const routeSource = await read('packages/server/src/agent/routes.ts');
  const typeSource = await read('packages/server/src/agent/types.ts');
  const engineSource = await read('packages/server/src/agent/engine.ts');
  const webSource = await read('packages/web/src/pages/AgentSettings.tsx');
  const migrationSource = await read('packages/server/migrations/069_agent_backup_provider.sql');

  assert.match(providerSource, /runtime: 'openai-compatible'/);
  assert.match(routeSource, /backup_api_key_enc/);
  assert.match(routeSource, /target === 'backup'/);
  assert.match(typeSource, /backup_enabled: boolean/);
  assert.match(engineSource, /backupRuntimeConfig/);
  assert.match(webSource, /Backup provider/);
  assert.match(migrationSource, /backup_provider TEXT/);
});

test('agent smoke command exercises the one-minute MCP tool path', async () => {
  const indexSource = await read('packages/cli/src/index.ts');
  const smokeSource = await read('packages/cli/src/commands/agent-smoke.ts');
  const mcpSource = await read('packages/cli/src/commands/mcp.ts');
  assert.match(indexSource, /agentSmokeCommand/);
  for (const tool of ['customer_record_resolve', 'briefing_get', 'context_signal_group_list']) {
    assert.match(smokeSource, new RegExp(`['"]${tool}['"]`));
  }
  assert.match(smokeSource, /context_ingest_auto/);
  assert.match(smokeSource, /withModel/);
  assert.match(mcpSource, /command\('doctor'\)/);
  assert.match(mcpSource, /with-model/);
  assert.match(smokeSource, /Northstar Labs/);
});
