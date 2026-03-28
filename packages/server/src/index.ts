// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { initPool, getPool, closePool, type DbPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { authRouter } from './auth/routes.js';
import { authMiddleware } from './auth/middleware.js';
import { apiRouter } from './rest/router.js';
import { agentRouter } from './agent/routes.js';
import { createMcpServer } from './mcp/server.js';
import { mcpSessions, registerMcpSession, removeMcpSession, touchMcpSession, evictStaleMcpSessions } from './mcp/session-registry.js';
import { autoApproveExpired, expireOldRequests } from './db/repos/hitl.js';
import { cleanExpiredSessions } from './db/repos/agent.js';
import { processPendingExtractions } from './agent/extraction.js';
import { processStaleEntries } from './services/staleness.js';
import { loadPlugins, shutdownPlugins, type PluginConfig } from './plugins/index.js';
import type { ActorContext } from '@crmy/shared';

// Read package version at runtime — avoids hardcoding across builds
const _require = createRequire(import.meta.url);
const SERVER_VERSION: string = (() => {
  try {
    const pkg = _require(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
})();

export type ProgressStep = 'db_connect' | 'migrations' | 'seed_defaults';
export type ProgressStatus = 'start' | 'done' | 'error';

export interface ServerConfig {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  tenantSlug: string;
  plugins?: PluginConfig[];
  /** Optional progress callback for CLI startup UI */
  onProgress?: (step: ProgressStep, status: ProgressStatus, detail?: string) => void;
  /** Optional per-migration progress callback */
  onMigration?: (name: string, index: number, total: number) => void;
}

export function loadConfig(): ServerConfig {
  const databaseUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!jwtSecret) throw new Error('JWT_SECRET is required');

  const KNOWN_BAD_SECRETS = ['change-me-in-production', 'dev-secret', 'secret', ''];
  if (KNOWN_BAD_SECRETS.includes(jwtSecret) && process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is set to a known default — this is not safe for production.\n' +
      '  Generate a real secret:  openssl rand -hex 32',
    );
  }

  return {
    databaseUrl,
    jwtSecret,
    port: parseInt(process.env.PORT ?? '3000', 10),
    tenantSlug: process.env.CRMY_TENANT_ID ?? 'default',
  };
}

export async function createApp(config: ServerConfig) {
  const progress = config.onProgress ?? (() => {});

  progress('db_connect', 'start');
  let db: DbPool;
  try {
    db = await initPool(config.databaseUrl);
    progress('db_connect', 'done');
  } catch (err) {
    progress('db_connect', 'error', (err as Error).message);
    throw err;
  }

  progress('migrations', 'start');
  let ran: string[];
  try {
    ran = await runMigrations(db, config.onMigration);
    progress('migrations', 'done', ran.length > 0 ? `${ran.length} applied` : 'up to date');
  } catch (err) {
    progress('migrations', 'error', (err as Error).message);
    throw err;
  }

  progress('seed_defaults', 'start');
  try {
    await seedDefaults(db, config.tenantSlug);
    progress('seed_defaults', 'done');
  } catch (err) {
    progress('seed_defaults', 'error', (err as Error).message);
    throw err;
  }

  // First-run: create admin from env vars or warn if no users exist
  await checkFirstRun(db, config.tenantSlug);

  // Seed demo data if requested via CRMY_SEED_DEMO=true (Docker / CI path)
  if (process.env.CRMY_SEED_DEMO === 'true') {
    try {
      await seedDemoData(db);
      console.log('[crmy] Demo data seeded successfully');
    } catch (err) {
      console.warn('[crmy] Demo data seeding failed:', (err as Error).message);
    }
  }

  const app = express();
  // Limit JSON payloads to 1 MB to prevent DoS via oversized bodies.
  // MCP tool calls may include context blobs — 1 MB is generous but bounded.
  app.use(express.json({ limit: '1mb' }));

  // Health check (no auth)
  app.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok', version: SERVER_VERSION });
    } catch {
      res.status(503).json({ status: 'error', db: 'error', version: SERVER_VERSION });
    }
  });

  // Auth routes (no /api/v1 prefix)
  app.use('/auth', authRouter(db, config.jwtSecret));

  // Helper: authenticate and return actor from Authorization header
  async function extractMcpActor(req: express.Request): Promise<ActorContext> {
    let actor: ActorContext = {
      tenant_id: '',
      actor_id: 'anonymous',
      actor_type: 'agent',
      role: 'member',
    };
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const fakeReq = { headers: req.headers, actor: undefined } as express.Request;
      const fakeRes = { status: () => ({ json: () => {} }) } as unknown as express.Response;
      await new Promise<void>((resolve) => {
        authMiddleware(db, config.jwtSecret)(fakeReq, fakeRes, () => resolve());
      });
      if (fakeReq.actor) actor = fakeReq.actor;
    }
    return actor;
  }

  // MCP Streamable HTTP endpoint — stateful sessions for resource subscriptions
  const handleMcpRequest = async (req: express.Request, res: express.Response): Promise<void> => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      // Reuse existing session (subsequent GET/POST from same client)
      if (sessionId && mcpSessions.has(sessionId)) {
        touchMcpSession(sessionId); // reset idle TTL
        const session = mcpSessions.get(sessionId)!;
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      // New session — authenticate and create
      const actor = await extractMcpActor(req);
      const server = createMcpServer(db, () => actor);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          registerMcpSession(sid, server, transport, actor);
        },
      });

      transport.onclose = () => {
        // Clean up registry when the session closes
        for (const [sid, s] of mcpSessions) {
          if (s.transport === transport) {
            removeMcpSession(sid);
            break;
          }
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP request failed' });
      }
    }
  };

  // POST for tool calls / initialize; GET for SSE notification stream; DELETE for session termination
  app.post('/mcp', handleMcpRequest);
  app.get('/mcp', handleMcpRequest);
  app.delete('/mcp', handleMcpRequest);

  // Authenticated API routes
  app.use('/api/v1', authMiddleware(db, config.jwtSecret), apiRouter(db));
  app.use('/api/v1/agent', authMiddleware(db, config.jwtSecret), agentRouter(db));

  // Serve web UI — public/ is populated at build time by scripts/copy-web.cjs
  // and ships inside the @crmy/server npm tarball alongside dist/.
  // Path: dist/index.js -> ../public  (both in monorepo and after npm install)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(__dirname, '../public');
  app.use('/app', express.static(webDist));
  app.get('/app/*', (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });

  // Background workers (every 60 seconds)
  const hitlInterval = setInterval(async () => {
    try {
      await autoApproveExpired(db);
      await expireOldRequests(db);
      await cleanExpiredSessions(db);
      await processPendingExtractions(db);
      await processStaleEntries(db);
      // Evict idle MCP sessions (30-minute TTL)
      evictStaleMcpSessions();
    } catch (err) {
      // Log the error but keep the interval running — a transient DB error
      // should not permanently disable all background maintenance tasks.
      console.error('Background worker error:', err);
    }
  }, 60_000);

  // Load plugins
  if (config.plugins?.length) {
    await loadPlugins(config.plugins, { db, config: {} });
  }

  return { app, db, hitlInterval };
}

/**
 * First-run check: if no users exist, either create the first admin user from
 * CRMY_ADMIN_EMAIL + CRMY_ADMIN_PASSWORD env vars (useful for Docker / CI), or
 * print a prominent warning so the operator knows to create one.
 *
 * This prevents ships-with-defaults security footguns: there are no hardcoded
 * credentials, and a freshly started server that has no users will loudly say so.
 */
async function checkFirstRun(db: DbPool, tenantSlug: string): Promise<void> {
  const { rows } = await db.query('SELECT id FROM users LIMIT 1');
  if (rows.length > 0) return; // Users already exist — nothing to do

  const adminEmail    = process.env.CRMY_ADMIN_EMAIL?.trim();
  const adminPassword = process.env.CRMY_ADMIN_PASSWORD;
  const adminName     = process.env.CRMY_ADMIN_NAME?.trim() ?? 'Admin';

  if (adminEmail && adminPassword) {
    // Create first admin user from env vars (Docker / headless init path)
    const tenantResult = await db.query(
      `SELECT id FROM tenants WHERE slug = $1`,
      [tenantSlug],
    );
    if (tenantResult.rows.length === 0) {
      console.warn('[crmy] checkFirstRun: tenant not found, skipping user creation');
      return;
    }
    const tenantId = tenantResult.rows[0].id as string;

    // scrypt — same params as auth/routes.ts
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(adminPassword, salt, 64, { N: 16384, r: 8, p: 1 });
    const passwordHash = `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;

    await db.query(
      `INSERT INTO users (tenant_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, 'owner', $4)
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      [tenantId, adminEmail, adminName, passwordHash],
    );
    console.log(`[crmy] First-run: admin user created for ${adminEmail}`);
    return;
  }

  // No env vars set — warn loudly so the operator knows they need to create a user
  console.warn('');
  console.warn('┌─────────────────────────────────────────────────────────────┐');
  console.warn('│  WARNING: No users exist in this CRMy instance.             │');
  console.warn('│                                                              │');
  console.warn('│  Create your first admin account:                           │');
  console.warn('│    • CLI:  npx @crmy/cli init                               │');
  console.warn('│    • API:  POST /auth/register                               │');
  console.warn('│    • ENV:  set CRMY_ADMIN_EMAIL and CRMY_ADMIN_PASSWORD      │');
  console.warn('│            then restart the server                           │');
  console.warn('└─────────────────────────────────────────────────────────────┘');
  console.warn('');
}

async function seedDefaults(db: DbPool, tenantSlug: string): Promise<void> {
  let tenantId: string;
  const existing = await db.query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug]);

  if (existing.rows.length > 0) {
    tenantId = existing.rows[0].id;
  } else {
    const result = await db.query(
      `INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id`,
      [tenantSlug, tenantSlug === 'default' ? 'Default Tenant' : tenantSlug],
    );
    tenantId = result.rows[0].id;
    console.log(`Seeded default tenant: ${tenantSlug}`);
  }

  // Seed registries (idempotent)
  try {
    const { seedDefaults: seedActivityTypes } = await import('./db/repos/activity-type-registry.js');
    const { seedDefaults: seedContextTypes } = await import('./db/repos/context-type-registry.js');
    await seedActivityTypes(db, tenantId);
    await seedContextTypes(db, tenantId);
  } catch {
    // Tables may not exist yet if migration hasn't run
  }
}

/**
 * Seed demo data using the same stable UUIDs as scripts/seed-demo.ts.
 * Called when CRMY_SEED_DEMO=true (Docker / container startup).
 */
async function seedDemoData(db: DbPool): Promise<void> {
  const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
  if (tenantRes.rows.length === 0) return;
  const tenantId = tenantRes.rows[0].id as string;

  const IDS = {
    ACTOR_CODY: 'd0000000-0000-4000-a000-000000000001',
    ACTOR_SARAH_R: 'd0000000-0000-4000-a000-000000000002',
    ACTOR_OUTREACH: 'd0000000-0000-4000-a000-000000000003',
    ACTOR_RESEARCH: 'd0000000-0000-4000-a000-000000000004',
    ACCT_ACME: 'd0000000-0000-4000-b000-000000000001',
    ACCT_BRIGHTSIDE: 'd0000000-0000-4000-b000-000000000002',
    ACCT_VERTEX: 'd0000000-0000-4000-b000-000000000003',
    CT_SARAH_CHEN: 'd0000000-0000-4000-c000-000000000001',
    CT_MARCUS_WEBB: 'd0000000-0000-4000-c000-000000000002',
    CT_PRIYA_NAIR: 'd0000000-0000-4000-c000-000000000003',
    CT_JORDAN_LIU: 'd0000000-0000-4000-c000-000000000004',
    CT_TOMAS_RIVERA: 'd0000000-0000-4000-c000-000000000005',
    CT_KEIKO_YAMAMOTO: 'd0000000-0000-4000-c000-000000000006',
    OPP_ACME: 'd0000000-0000-4000-d000-000000000001',
    OPP_BRIGHTSIDE: 'd0000000-0000-4000-d000-000000000002',
    OPP_VERTEX: 'd0000000-0000-4000-d000-000000000003',
  };

  // Check if already seeded
  const check = await db.query('SELECT id FROM actors WHERE id = $1', [IDS.ACTOR_CODY]);
  if (check.rows.length > 0) return; // already seeded

  // Actors
  await db.query(`INSERT INTO actors (id, tenant_id, actor_type, display_name, email) VALUES ($1, $2, 'human', 'Cody Harris', 'cody@crmy.ai') ON CONFLICT (id) DO NOTHING`, [IDS.ACTOR_CODY, tenantId]);
  await db.query(`INSERT INTO actors (id, tenant_id, actor_type, display_name, email) VALUES ($1, $2, 'human', 'Sarah Reeves', 'sarah@crmy.ai') ON CONFLICT (id) DO NOTHING`, [IDS.ACTOR_SARAH_R, tenantId]);
  await db.query(`INSERT INTO actors (id, tenant_id, actor_type, display_name, email, agent_identifier, agent_model) VALUES ($1, $2, 'agent', 'Outreach Agent', NULL, 'outreach-v1', 'claude-sonnet-4-20250514') ON CONFLICT (id) DO NOTHING`, [IDS.ACTOR_OUTREACH, tenantId]);
  await db.query(`INSERT INTO actors (id, tenant_id, actor_type, display_name, email, agent_identifier, agent_model) VALUES ($1, $2, 'agent', 'Research Agent', NULL, 'research-v1', 'claude-sonnet-4-20250514') ON CONFLICT (id) DO NOTHING`, [IDS.ACTOR_RESEARCH, tenantId]);

  // Accounts
  await db.query(`INSERT INTO accounts (id, tenant_id, name, industry, health_score, annual_revenue, domain, website) VALUES ($1, $2, 'Acme Corp', 'SaaS', 72, 180000, 'acme.com', 'https://acme.com') ON CONFLICT (id) DO NOTHING`, [IDS.ACCT_ACME, tenantId]);
  await db.query(`INSERT INTO accounts (id, tenant_id, name, industry, health_score, annual_revenue, domain, website) VALUES ($1, $2, 'Brightside Health', 'Healthcare', 45, 96000, 'brightsidehealth.com', 'https://brightsidehealth.com') ON CONFLICT (id) DO NOTHING`, [IDS.ACCT_BRIGHTSIDE, tenantId]);
  await db.query(`INSERT INTO accounts (id, tenant_id, name, industry, health_score, annual_revenue, domain, website) VALUES ($1, $2, 'Vertex Logistics', 'Logistics', 88, 240000, 'vertex.io', 'https://vertex.io') ON CONFLICT (id) DO NOTHING`, [IDS.ACCT_VERTEX, tenantId]);

  // Contacts
  await db.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Sarah', 'Chen', 'sarah.chen@acme.com', 'VP Engineering', $3, 'prospect') ON CONFLICT (id) DO NOTHING`, [IDS.CT_SARAH_CHEN, tenantId, IDS.ACCT_ACME]);
  await db.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Marcus', 'Webb', 'marcus.webb@acme.com', 'CFO', $3, 'prospect') ON CONFLICT (id) DO NOTHING`, [IDS.CT_MARCUS_WEBB, tenantId, IDS.ACCT_ACME]);
  await db.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Priya', 'Nair', 'p.nair@brightsidehealth.com', 'CTO', $3, 'active') ON CONFLICT (id) DO NOTHING`, [IDS.CT_PRIYA_NAIR, tenantId, IDS.ACCT_BRIGHTSIDE]);
  await db.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Jordan', 'Liu', 'j.liu@brightsidehealth.com', 'RevOps Lead', $3, 'active') ON CONFLICT (id) DO NOTHING`, [IDS.CT_JORDAN_LIU, tenantId, IDS.ACCT_BRIGHTSIDE]);
  await db.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Tomás', 'Rivera', 't.rivera@vertex.io', 'Head of Sales Ops', $3, 'champion') ON CONFLICT (id) DO NOTHING`, [IDS.CT_TOMAS_RIVERA, tenantId, IDS.ACCT_VERTEX]);
  await db.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Keiko', 'Yamamoto', 'k.yamamoto@vertex.io', 'CEO', $3, 'champion') ON CONFLICT (id) DO NOTHING`, [IDS.CT_KEIKO_YAMAMOTO, tenantId, IDS.ACCT_VERTEX]);

  // Opportunities
  await db.query(`INSERT INTO opportunities (id, tenant_id, name, account_id, stage, amount, close_date) VALUES ($1, $2, 'Acme Corp Enterprise Deal', $3, 'Discovery', 180000, '2026-06-30') ON CONFLICT (id) DO NOTHING`, [IDS.OPP_ACME, tenantId, IDS.ACCT_ACME]);
  await db.query(`INSERT INTO opportunities (id, tenant_id, name, account_id, stage, amount, close_date) VALUES ($1, $2, 'Brightside Health Platform Deal', $3, 'PoC', 96000, '2026-05-15') ON CONFLICT (id) DO NOTHING`, [IDS.OPP_BRIGHTSIDE, tenantId, IDS.ACCT_BRIGHTSIDE]);
  await db.query(`INSERT INTO opportunities (id, tenant_id, name, account_id, stage, amount, close_date) VALUES ($1, $2, 'Vertex Logistics Expansion', $3, 'Negotiation', 240000, '2026-04-30') ON CONFLICT (id) DO NOTHING`, [IDS.OPP_VERTEX, tenantId, IDS.ACCT_VERTEX]);
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
    await shutdownPlugins();
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
export { createWorkflowEngine } from './workflows/engine.js';
export { loadPlugins, shutdownPlugins } from './plugins/index.js';
export type { CrmyPlugin, PluginConfig } from './plugins/index.js';
export type { ToolDef } from './mcp/server.js';
