// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfigFile } from '../config.js';

export function mcpCommand(): Command {
  return new Command('mcp')
    .description('Start stdio MCP server (for Claude Code)')
    .action(async () => {
      const config = loadConfigFile();

      const databaseUrl = process.env.DATABASE_URL ?? config.database?.url;
      const apiKey = process.env.CRMY_API_KEY ?? config.apiKey;

      if (!databaseUrl) {
        console.error('No database URL. Run `crmy-ai init` first or set DATABASE_URL.');
        process.exit(1);
      }

      process.env.CRMY_IMPORTED = '1';

      const { initPool, createMcpServer } = await import('@crmy/server');
      const { runMigrations } = await import('@crmy/server');

      const db = await initPool(databaseUrl);
      await runMigrations(db);

      // Resolve actor from API key or create default
      let actor = {
        tenant_id: '',
        actor_id: 'cli-agent',
        actor_type: 'agent' as const,
        role: 'owner' as const,
      };

      if (apiKey) {
        const crypto = await import('node:crypto');
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const result = await db.query(
          `SELECT ak.tenant_id, ak.user_id, ak.scopes, u.role
           FROM api_keys ak LEFT JOIN users u ON ak.user_id = u.id
           WHERE ak.key_hash = $1`,
          [keyHash],
        );
        if (result.rows.length > 0) {
          const row = result.rows[0];
          actor = {
            tenant_id: row.tenant_id,
            actor_id: row.user_id ?? 'api-key-agent',
            actor_type: 'agent',
            role: row.role ?? 'member',
          };
        }
      }

      // Fallback: use default tenant
      if (!actor.tenant_id) {
        const tenantResult = await db.query("SELECT id FROM tenants WHERE slug = 'default' LIMIT 1");
        if (tenantResult.rows.length > 0) {
          actor.tenant_id = tenantResult.rows[0].id;
        }
      }

      const server = createMcpServer(db, () => actor);
      const transport = new StdioServerTransport();
      await server.connect(transport);
    });
}
