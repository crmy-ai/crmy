// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import express from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { initPool, getPool, closePool, type DbPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { authRouter } from './auth/routes.js';
import { authMiddleware } from './auth/middleware.js';
import { apiRouter } from './rest/router.js';
import { createMcpServer } from './mcp/server.js';
import { autoApproveExpired, expireOldRequests } from './db/repos/hitl.js';
import type { ActorContext } from '@crmy/shared';

export interface ServerConfig {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  tenantSlug: string;
}

export function loadConfig(): ServerConfig {
  const databaseUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!jwtSecret) throw new Error('JWT_SECRET is required');

  return {
    databaseUrl,
    jwtSecret,
    port: parseInt(process.env.PORT ?? '3000', 10),
    tenantSlug: process.env.CRMY_TENANT_ID ?? 'default',
  };
}

export async function createApp(config: ServerConfig) {
  const db = await initPool(config.databaseUrl);

  // Run migrations
  const ran = await runMigrations(db);
  if (ran.length > 0) {
    console.log(`Ran ${ran.length} migration(s): ${ran.join(', ')}`);
  }

  // Seed default tenant if first run
  await seedDefaults(db, config.tenantSlug);

  const app = express();
  app.use(express.json());

  // Health check (no auth)
  app.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok', version: '0.1.0' });
    } catch {
      res.status(503).json({ status: 'error', db: 'error', version: '0.1.0' });
    }
  });

  // Auth routes (no /api/v1 prefix)
  app.use('/auth', authRouter(db, config.jwtSecret));

  // MCP Streamable HTTP endpoint
  app.post('/mcp', async (req, res) => {
    try {
      // Extract actor from auth header
      let actor: ActorContext = {
        tenant_id: '',
        actor_id: 'anonymous',
        actor_type: 'agent',
        role: 'member',
      };

      // Try to authenticate
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        // Reuse auth middleware logic inline for MCP
        const fakeReq = { headers: req.headers, actor: undefined } as express.Request;
        const fakeRes = { status: () => ({ json: () => {} }) } as unknown as express.Response;
        await new Promise<void>((resolve) => {
          authMiddleware(db, config.jwtSecret)(fakeReq, fakeRes, () => resolve());
        });
        if (fakeReq.actor) actor = fakeReq.actor;
      }

      const server = createMcpServer(db, () => actor);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP request failed' });
      }
    }
  });

  // Handle MCP GET and DELETE for session management
  app.get('/mcp', async (req, res) => {
    res.writeHead(405).end(JSON.stringify({ error: 'Method not allowed. Use POST for MCP requests.' }));
  });

  app.delete('/mcp', async (req, res) => {
    res.writeHead(405).end(JSON.stringify({ error: 'Method not allowed.' }));
  });

  // Authenticated API routes
  app.use('/api/v1', authMiddleware(db, config.jwtSecret), apiRouter(db));

  // HITL auto-approval worker (every 60 seconds)
  const hitlInterval = setInterval(async () => {
    try {
      await autoApproveExpired(db);
      await expireOldRequests(db);
    } catch (err) {
      console.error('HITL worker error:', err);
    }
  }, 60_000);

  return { app, db, hitlInterval };
}

async function seedDefaults(db: DbPool, tenantSlug: string): Promise<void> {
  const existing = await db.query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug]);
  if (existing.rows.length > 0) return;

  await db.query(
    `INSERT INTO tenants (slug, name) VALUES ($1, $2)`,
    [tenantSlug, tenantSlug === 'default' ? 'Default Tenant' : tenantSlug],
  );
  console.log(`Seeded default tenant: ${tenantSlug}`);
}

// Direct startup
async function main() {
  const config = loadConfig();
  const { app, hitlInterval } = await createApp(config);

  const server = app.listen(config.port, () => {
    console.log(`crmy server ready on :${config.port}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    clearInterval(hitlInterval);
    server.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only run if this is the main module
const isMain = !process.argv[1] || process.argv[1].includes('server') || process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index.ts');
if (isMain && !process.env.CRMY_IMPORTED) {
  main().catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}

export { getPool, initPool, closePool } from './db/pool.js';
export { runMigrations } from './db/migrate.js';
export { createMcpServer, getAllTools } from './mcp/server.js';
export { emitEvent } from './events/emitter.js';
export type { ToolDef } from './mcp/server.js';
