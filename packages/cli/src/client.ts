// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { loadConfigFile } from './config.js';

export interface CliClient {
  call(toolName: string, input: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export async function getClient(): Promise<CliClient> {
  const config = loadConfigFile();
  const databaseUrl = process.env.DATABASE_URL ?? config.database?.url;

  if (!databaseUrl) {
    console.error('No database URL. Run `crmy init` first or set DATABASE_URL.');
    process.exit(1);
  }

  process.env.CRMY_IMPORTED = '1';

  const { initPool, closePool, getAllTools } = await import('@crmy/server');
  const db = await initPool(databaseUrl);

  const apiKey = process.env.CRMY_API_KEY ?? config.apiKey;
  let actor = {
    tenant_id: '',
    actor_id: 'cli-user',
    actor_type: 'user' as const,
    role: 'owner' as const,
  };

  if (apiKey) {
    const crypto = await import('node:crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const result = await db.query(
      `SELECT ak.tenant_id, ak.user_id, u.role
       FROM api_keys ak LEFT JOIN users u ON ak.user_id = u.id
       WHERE ak.key_hash = $1`,
      [keyHash],
    );
    if (result.rows.length > 0) {
      actor.tenant_id = result.rows[0].tenant_id;
      actor.actor_id = result.rows[0].user_id ?? 'cli-user';
      actor.role = result.rows[0].role ?? 'owner';
    }
  }

  if (!actor.tenant_id) {
    const tenantResult = await db.query("SELECT id FROM tenants WHERE slug = 'default' LIMIT 1");
    if (tenantResult.rows.length > 0) {
      actor.tenant_id = tenantResult.rows[0].id;
    }
  }

  const tools = getAllTools(db);

  return {
    async call(toolName: string, input: Record<string, unknown>): Promise<string> {
      const tool = tools.find(t => t.name === toolName);
      if (!tool) throw new Error(`Unknown tool: ${toolName}`);
      const result = await tool.handler(input, actor);
      return JSON.stringify(result, null, 2);
    },
    async close() {
      await closePool();
    },
  };
}
