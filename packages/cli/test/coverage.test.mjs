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
	    'action_context_get',
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

test('Action Context has a friendly CLI command and efficient REST mapping', async () => {
  const indexSource = await read('packages/cli/src/index.ts');
  const helpSource = await read('packages/cli/src/commands/help.ts');
  const commandSource = await read('packages/cli/src/commands/action-context.ts');
  const clientSource = await read('packages/cli/src/client.ts');
  const routerSource = await read('packages/server/src/rest/router.ts');

  assert.match(indexSource, /actionContextCommand/);
  assert.match(helpSource, /action-context/);
  assert.match(commandSource, /client\.call\('action_context_get'/);
  assert.match(commandSource, /resolveSubjectRef/);
  assert.match(clientSource, /action_context_get:\s*\{ method: 'POST', path: \(\) => '\/api\/v1\/action-context' \}/);
  assert.match(routerSource, /router\.post\('\/action-context'/);
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

test('production setup and health hardening stay gated', async () => {
  const indexSource = await read('packages/server/src/index.ts');
  const routerSource = await read('packages/server/src/rest/router.ts');
  const settingsSource = await read('packages/web/src/pages/Settings.tsx');
  const guide = await read('docs/guide.md');

  assert.match(indexSource, /process\.env\.NODE_ENV === 'production'/);
  assert.match(indexSource, /status: 'ok',\s*db: 'ok',\s*version: SERVER_VERSION/s);
  assert.match(routerSource, /function isLocalDbConfigEnabled/);
  assert.match(routerSource, /CRMY_LOCAL_SETUP_MODE/);
  assert.match(routerSource, /CRMY_ALLOW_DB_CONFIG_WRITE/);
  assert.match(routerSource, /rejectLocalDbConfigDisabled/);
  assert.match(routerSource, /local_setup_enabled: isLocalDbConfigEnabled\(\)/);
  assert.match(settingsSource, /Managed by server environment/);
  assert.match(guide, /hosted\/production deployments show the current connection/);
});

test('customer record deletes archive instead of removing trust anchors', async () => {
  const migration = await read('packages/server/migrations/074_revenue_record_archives.sql');
  const docs = await read('docs/mcp-tools.md');
  for (const table of ['accounts', 'contacts', 'opportunities', 'use_cases']) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS archived_at`));
  }
  for (const repo of ['accounts', 'contacts', 'opportunities', 'use-cases']) {
    const source = await read(`packages/server/src/db/repos/${repo}.ts`);
    assert.match(source, /archived_at = COALESCE\(archived_at, now\(\)\)/);
    assert.doesNotMatch(source, new RegExp(`DELETE FROM ${repo === 'use-cases' ? 'use_cases' : repo}\\b`));
  }
  assert.match(docs, /Archive a contact/);
  assert.match(docs, /Archive an account/);
  assert.match(docs, /Archive an opportunity/);
  assert.match(docs, /Archive a use case/);
});

test('CLI and web request paths have bounded waits', async () => {
  const cliClient = await read('packages/cli/src/client.ts');
  const webClient = await read('packages/web/src/api/client.ts');
  const agentStream = await read('packages/web/src/lib/agentStream.ts');
  const login = await read('packages/web/src/pages/auth/Login.tsx');
  const setup = await read('packages/web/src/pages/auth/Setup.tsx');

  assert.match(cliClient, /function fetchWithTimeout/);
  assert.match(cliClient, /CRMY_CLI_HTTP_TIMEOUT_MS/);
  assert.match(webClient, /DEFAULT_REQUEST_TIMEOUT_MS/);
  assert.match(webClient, /controller\.abort\(\)/);
  assert.match(agentStream, /function fetchAgentJson/);
  assert.match(login, /fetch\('\/health', \{ signal: controller\.signal \}\)/);
  assert.match(setup, /Setup request timed out/);
});

test('external writeback approval request creation is transactional', async () => {
  const service = await read('packages/server/src/services/systems-of-record/index.ts');
  assert.match(service, /return await withTransaction\(db, async tx =>/);
  assert.match(service, /sorRepo\.createWriteback\(tx/);
  assert.match(service, /hitlRepo\.createHITLRequest\(tx/);
  assert.match(service, /sorRepo\.updateWriteback\(tx/);
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
  for (const scope of [
    'systems:read',
    'systems:write',
    'systems:admin',
    'api_keys:admin',
    'email_provider:admin',
    'hitl:admin',
  ]) {
    assert.match(initSource, new RegExp(scope));
  }
  assert.match(initSource, /INSERT INTO actors/);
  assert.match(initSource, /registration_status = 'approved'/);
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
  assert.match(smokeSource, /Running model-backed Raw Context extraction/);
  assert.match(mcpSource, /command\('doctor'\)/);
  assert.match(mcpSource, /with-model/);
  assert.match(smokeSource, /Northstar Labs/);
});

test('first-run proof path uses rich seeded sample data and signal groups', async () => {
  const readme = await read('README.md');
  const guide = await read('docs/guide.md');
  const serverSource = await read('packages/server/src/index.ts');
  const webHtml = await read('packages/web/index.html');
  const initSource = await read('packages/cli/src/commands/init.ts');
  const mcpSource = await read('packages/cli/src/commands/mcp.ts');
  const seedDemoSource = await read('packages/cli/src/commands/seed-demo.ts');
  const contextSource = await read('packages/cli/src/commands/context.ts');
  const sampleSource = await read('packages/server/src/services/sample-data.ts');
  const uiSmokeSource = await read('scripts/ui-smoke.mjs');

  assert.match(readme, /npx -y @crmy\/cli init --demo/);
  assert.match(readme, /init --yes --no-demo/);
  assert.match(guide, /npx -y @crmy\/cli init --demo/);
  assert.match(mcpSource, /crmy init --demo/);
  assert.match(initSource, /\.option\('--demo'/);
  assert.match(initSource, /\.option\('--no-demo'/);
  assert.match(initSource, /let seedDemo = demoMode \|\| \(yesMode && !skipDemo\)/);
  assert.match(initSource, /process\.env\.ENABLE_PGVECTOR !== 'true' && !yesMode && !demoMode && isInteractive/);
  assert.match(readme, /context signal-groups/);
  assert.doesNotMatch(readme, /context signals --subject "account:Northstar Labs"\n> npx -y @crmy\/cli context lineage/);
  assert.match(initSource, /counts\.signal_groups/);
  assert.match(initSource, /crmy\/cli context signal-groups/);
  assert.match(seedDemoSource, /counts\.signal_groups/);
  assert.match(seedDemoSource, /crmy context signal-groups/);
  assert.match(contextSource, /Resolving subjects and extracting Raw Context/);
  assert.match(contextSource, /Raw Context extraction complete/);
  assert.match(sampleSource, /ACTIVITY_INGESTED_NOTE/);
  assert.match(sampleSource, /RAW_MODEL_NOTE/);
  assert.match(sampleSource, /SIGNAL_GROUP_TRUST_PACKET/);
  assert.match(sampleSource, /Schedule technical validation next Friday/);
  assert.match(sampleSource, /Security review is the blocker for the pilot/);
  assert.match(uiSmokeSource, /childElementCount > 0/);
  assert.match(uiSmokeSource, /CRMy UI root is blank/);
  assert.match(serverSource, /isSameRequestOrigin/);
  assert.match(serverSource, /callback\(null, \{/);
  assert.match(serverSource, /isSameRequestOrigin\(req, origin\)/);
  assert.doesNotMatch(webHtml, /fonts\.googleapis\.com/);
  assert.doesNotMatch(webHtml, /<script>\s*\(function/);
});

test('migration guidance points at executable subcommands', async () => {
  const initSource = await read('packages/cli/src/commands/init.ts');
  const doctorSource = await read('packages/cli/src/commands/doctor.ts');
  assert.match(initSource, /crmy migrate run/);
  assert.match(doctorSource, /crmy migrate run/);
  assert.doesNotMatch(initSource, /running: crmy migrate\\n/);
  assert.doesNotMatch(doctorSource, /Run: crmy migrate['"`]/);
});

test('first-run setup persists a dedicated stored-secret encryption key', async () => {
  const configSource = await read('packages/cli/src/config.ts');
  const configCommandSource = await read('packages/cli/src/commands/config.ts');
  const initSource = await read('packages/cli/src/commands/init.ts');
  const serverCommandSource = await read('packages/cli/src/commands/server.ts');
  const doctorSource = await read('packages/cli/src/commands/doctor.ts');
  const mcpSource = await read('packages/cli/src/commands/mcp.ts');
  const migrateSource = await read('packages/cli/src/commands/migrate.ts');
  const seedDemoSource = await read('packages/cli/src/commands/seed-demo.ts');
  const loadEnvSource = await read('packages/server/scripts/load-env.cjs');
  const readme = await read('README.md');
  const guide = await read('docs/guide.md');

  assert.match(configSource, /encryptionKey\?: string/);
  assert.match(configCommandSource, /encryptionKey: config\.encryptionKey \? '\*\*\*' : undefined/);
  assert.match(initSource, /encryptionKey = crypto\.randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(initSource, /process\.env\.CRMY_ENCRYPTION_KEY = encryptionKey/);
  assert.match(initSource, /Secret storage: dedicated encryption key generated and saved/);
  assert.match(serverCommandSource, /Generated a dedicated stored-secret encryption key and saved it to \.crmy\.json/);
  assert.match(serverCommandSource, /saveConfigFile\(config\)/);
  assert.match(doctorSource, /Stored-secret encryption key is configured/);
  assert.match(doctorSource, /Run: crmy init, or run crmy server once to generate and save a local key/);
  for (const source of [mcpSource, migrateSource, seedDemoSource]) {
    assert.match(source, /process\.env\.CRMY_ENCRYPTION_KEY = config\.encryptionKey|process\.env\.CRMY_ENCRYPTION_KEY = encryptionKey/);
  }
  assert.match(loadEnvSource, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(loadEnvSource, /Generated CRMY_ENCRYPTION_KEY and saved it to/);
  assert.match(readme, /local source dev server generate this automatically/);
  assert.match(guide, /local source dev server also generates and appends one to `\.env`/);
  assert.match(guide, /"encryptionKey": "\.\.\."/);
});

test('README and guide stay aligned with canonical sequence and REST surfaces', async () => {
  const guide = await read('docs/guide.md');
  const routerSource = await read('packages/server/src/rest/router.ts');
  const clientSource = await read('packages/cli/src/client.ts');
  const sequencesCommandSource = await read('packages/cli/src/commands/sequences.ts');
  const sequenceTools = await read('packages/server/src/mcp/tools/email-sequences.ts');
  const mcpHelpSource = await read('packages/cli/src/commands/mcp.ts');

  assert.match(guide, /use `sequence_enroll` to start a contact on the sequence/);
  assert.match(guide, /\| `sequence_create` \| Create a multi-channel sequence/);
  assert.match(guide, /GET    \/api\/v1\/sequences/);
  assert.match(guide, /POST   \/api\/v1\/sequences\/enrollments\/:id\/pause/);
  assert.match(guide, /POST \| `\/sequences\/enrollments\/:id\/unenroll`/);
  assert.match(guide, /Legacy `\/api\/v1\/email-sequences\/\*` routes remain available/);
  assert.match(guide, /\| Email Sequences \| `sequence_create`/);
  assert.match(guide, /`sequence_enrollment_context`/);
  assert.match(guide, /GET \| `\/messaging-channels`/);
  assert.match(guide, /there are not dedicated REST routes for those operations yet/);
  assert.match(guide, /later GET, POST, and DELETE requests can reuse that session/);
  assert.match(guide, /Base URL for REST resources: `\/api\/v1`\. Auth endpoints are mounted separately at `\/auth`\./);
  assert.doesNotMatch(guide, /email_sequence_/);
  assert.doesNotMatch(guide, /\/messaging\/channels/);
  assert.doesNotMatch(guide, /\/messaging\/send/);
  assert.doesNotMatch(guide, /Each request creates a new session/);
  assert.match(mcpHelpSource, /crmy init --demo/);

  assert.match(routerSource, /router\.get\('\/messaging-channels'/);
  assert.doesNotMatch(routerSource, /router\.get\('\/messaging\/channels'/);
  assert.match(routerSource, /router\.post\('\/sequences\/enrollments\/:id\/pause'/);
  assert.match(routerSource, /router\.post\('\/sequences\/enrollments\/:id\/resume'/);
  assert.match(routerSource, /router\.post\('\/sequences\/enrollments\/:id\/unenroll'/);
  assert.match(clientSource, /sequence_pause:\s*\{ method: 'POST', path: \(i\) => `\/api\/v1\/sequences\/enrollments\/\$\{i\.id\}\/pause`/);
  assert.match(clientSource, /sequence_resume:\s*\{ method: 'POST', path: \(i\) => `\/api\/v1\/sequences\/enrollments\/\$\{i\.id\}\/resume`/);
  assert.match(sequencesCommandSource, /command\('unenroll <enrollment_id>'\)/);
  assert.doesNotMatch(sequencesCommandSource, /command\('unenroll <sequence_id>'\)/);
  assert.match(sequencesCommandSource, /client\.call\('sequence_unenroll', \{\s*id: enrollmentId,/);
  for (const tool of ['sequence_create', 'sequence_enrollment_context', 'sequence_clone']) {
    assert.match(sequenceTools, new RegExp(`name: '${tool}'`));
    assert.match(guide, new RegExp(`\\\`${tool}\\\``));
  }
});

test('OpenAPI artifact advertises the canonical public REST surface', async () => {
  const openapi = JSON.parse(await read('docs/openapi.json'));
  const paths = openapi.paths ?? {};
  const routerSource = await read('packages/server/src/rest/router.ts');

  for (const route of [
    '/ops/status',
    '/ops/data-quality',
    '/ops/data-quality/{check_name}/repair',
    '/auth/setup/{token}',
    '/auth/profile',
    '/context/raw-sources/{id}/reprocess',
    '/context/semantic-search',
    '/context/contradictions',
    '/subjects/resolve',
    '/context/detect-subjects',
    '/context/ingest-file',
    '/context/review-batch',
    '/context/mark-stale',
    '/context/consolidate',
    '/context/contradictions/assign',
    '/context/contradictions/resolve',
    '/email-messages/{id}',
    '/email-messages/{id}/classification',
    '/email-messages/{id}/ignore',
    '/source-filters',
    '/calendar/connections',
    '/calendar-events',
    '/calendar-events/{id}/artifacts',
    '/messaging-channels',
    '/messaging-channels/{id}',
    '/sequences',
    '/sequences/{id}',
    '/sequences/{id}/enroll',
    '/sequences/{id}/analytics',
    '/sequences/enrollments',
    '/sequences/enrollments/{id}/unenroll',
    '/sequences/enrollments/{id}/pause',
    '/sequences/enrollments/{id}/resume',
    '/sequences/draft-preview',
    '/sequences/enrollments/{enrollmentId}/activities',
    '/sequences/enrollments/{enrollmentId}/context',
    '/workflows/{id}/test',
    '/workflows/{id}/clone',
    '/workflows/{id}/trigger',
    '/admin/sample-data',
    '/admin/actors',
    '/admin/actors/{id}/approve',
    '/admin/actors/{id}/reject',
    '/admin/users',
    '/admin/users/{id}/invite',
    '/admin/users/{id}/password-reset',
    '/resolve',
  ]) {
    assert.ok(paths[route], `missing OpenAPI route ${route}`);
  }

  assert.ok(paths['/messaging-channels'].get);
  assert.ok(paths['/messaging-channels'].post);
  assert.ok(paths['/sequences'].get);
  assert.ok(paths['/sequences'].post);
  assert.ok(paths['/sequences/enrollments/{id}/pause'].post);
  assert.ok(paths['/sequences/enrollments/{id}/resume'].post);
  assert.ok(paths['/sequences/enrollments/{id}/unenroll'].post);
  assert.equal(paths['/auth/login'].post.servers?.[0]?.url, '/');
  assert.equal(paths['/auth/profile'].patch.servers?.[0]?.url, '/');

  assert.equal(paths['/email-sequences'], undefined);
  assert.equal(paths['/messaging/channels'], undefined);
  assert.equal(paths['/messaging/send'], undefined);

  const intentionallyUndocumented = new Set([
    'GET /openapi.json',
    'GET /calendar/oauth/{provider}/callback',
    'GET /mailbox/oauth/{provider}/callback',
    'POST /email/inbound',
    'GET /email-sequences',
    'POST /email-sequences',
    'GET /email-sequences/{id}',
    'PATCH /email-sequences/{id}',
    'DELETE /email-sequences/{id}',
    'POST /email-sequences/enroll',
    'POST /email-sequences/unenroll',
    'GET /email-sequences/enrollments',
    'POST /sequences/{id}/unenroll',
    'POST /sequences/enroll',
  ]);
  const routeMatches = [...routerSource.matchAll(/router\.(get|post|patch|delete|put)\('([^']+)'/g)];
  for (const match of routeMatches) {
    const method = match[1].toUpperCase();
    const normalizedPath = match[2]
      .replace(/:([A-Za-z_][A-Za-z0-9_]*)(\([^)]*\))?/g, '{$1}')
      .replace(/\/+/g, '/');
    const key = `${method} ${normalizedPath}`;
    if (intentionallyUndocumented.has(key)) continue;
    assert.ok(
      paths[normalizedPath]?.[method.toLowerCase()],
      `missing OpenAPI route ${key}`,
    );
  }
});
