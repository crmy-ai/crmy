// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfigFile } from '../config.js';
import type { ActorContext } from '@crmy/shared';

function redactSensitive(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+):([^@\s]+)@/gi, '$1:***@')
    .replace(/((?:password|token|secret|api[_-]?key)=)[^&\s]+/gi, '$1***');
}

export function mcpCommand(): Command {
  return new Command('mcp')
    .description('Start the local stdio MCP server for agents and IDEs')
    .option('--config <path>', 'Explicit path to a .crmy.json config file')
    .action(async (opts) => {
      // IMPORTANT: stdout is the MCP protocol pipe — all diagnostic output MUST
      // go to stderr so it does not corrupt the binary MCP framing.
      const config = loadConfigFile(opts.config as string | undefined);

      const databaseUrl = process.env.DATABASE_URL ?? config.database?.url;
      const apiKey      = process.env.CRMY_API_KEY  ?? config.apiKey;

      if (!databaseUrl) {
        process.stderr.write(
          '[crmy mcp] No database URL found.\n' +
          '  Run `npx @crmy/cli init` first, pass --config <path>, or set DATABASE_URL.\n' +
          '  Config lookup order:\n' +
          '    1. --config <path>\n' +
          '    2. process.cwd()/.crmy.json\n' +
          '    3. ~/.crmy/config.json  (written by init)\n' +
          '    4. DATABASE_URL environment variable\n',
        );
        process.exit(1);
      }

      process.env.CRMY_IMPORTED = '1';

      const { initPool, createMcpServer, runMigrations } = await import('@crmy/server');

      let db: Awaited<ReturnType<typeof initPool>>;
      try {
        db = await initPool(databaseUrl);
      } catch (err) {
        process.stderr.write(
          `[crmy mcp] Failed to connect to database: ${redactSensitive((err as Error).message)}\n` +
          '  Check that PostgreSQL is running and the configured DATABASE_URL is reachable.\n' +
          '  Run `npx @crmy/cli doctor` for a guided setup check.\n',
        );
        process.exit(1);
      }

      try {
        await runMigrations(db);
      } catch (err) {
        process.stderr.write(`[crmy mcp] Migration error: ${(err as Error).message}\n`);
        process.exit(1);
      }

      // Resolve actor from API key
      let actor: ActorContext = {
        tenant_id:  '',
        actor_id:   'cli-agent',
        actor_type: 'agent' as const,
        role:       'owner'  as const,
      };

      if (apiKey) {
        const crypto  = await import('node:crypto');
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const result  = await db.query(
          `SELECT ak.tenant_id, ak.user_id, ak.scopes, u.role
           FROM api_keys ak LEFT JOIN users u ON ak.user_id = u.id
           WHERE ak.key_hash = $1`,
          [keyHash],
        );
        if (result.rows.length > 0) {
          const row = result.rows[0];
          actor = {
            tenant_id:  row.tenant_id,
            actor_id:   row.user_id ?? 'api-key-agent',
            actor_type: 'agent',
            role:       row.role ?? 'member',
            scopes:     row.scopes ?? undefined,
          };
        }
      }

      // Fallback: use default tenant
      if (!actor.tenant_id) {
        const tenantResult = await db.query(
          "SELECT id FROM tenants WHERE slug = 'default' LIMIT 1",
        );
        if (tenantResult.rows.length > 0) {
          actor.tenant_id = tenantResult.rows[0].id;
        }
      }

      if (!actor.tenant_id) {
        process.stderr.write(
          '[crmy mcp] No tenant found in database.\n' +
          '  Run `npx @crmy/cli init` to create the first tenant and owner account.\n',
        );
        process.exit(1);
      }

      const server    = createMcpServer(db, actor, () => actor);
      const transport = new StdioServerTransport();
      await server.connect(transport);
    });
}
