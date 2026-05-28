// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { initPool, getPool, closePool, type DbPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { authRouter } from './auth/routes.js';
import { authMiddleware } from './auth/middleware.js';
import { apiRouter, inboundRouter } from './rest/router.js';
import { agentRouter } from './agent/routes.js';
import { createMcpServer } from './mcp/server.js';
import { mcpSessions, registerMcpSession, removeMcpSession, touchMcpSession, evictStaleMcpSessions } from './mcp/session-registry.js';
import { autoApproveExpired, expireOldRequests } from './db/repos/hitl.js';
import { cleanExpiredSessions } from './db/repos/agent.js';
import { processPendingExtractions } from './agent/extraction.js';
import { processPendingAgentTurns } from './agent/turn-runner.js';
import { processStaleEntries } from './services/staleness.js';
import { seedSampleData } from './services/sample-data.js';
import { loadPlugins, shutdownPlugins, type PluginConfig } from './plugins/index.js';
import { CrmyError, unauthorized, type ActorContext } from '@crmy/shared';

async function purgeOldWorkflowRuns(db: DbPool): Promise<void> {
  await db.query(
    `DELETE FROM workflow_runs
     WHERE completed_at < now() - interval '90 days'
       AND status IN ('completed', 'failed')`,
  );
}
import { eventBus } from './events/bus.js';

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
  allowPublicRegistration: boolean;
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
    allowPublicRegistration: process.env.CRMY_ALLOW_PUBLIC_REGISTRATION === 'true',
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
      const tenantRes = await db.query(
        'SELECT id FROM tenants WHERE id::text = $1 OR slug = $1 ORDER BY created_at DESC LIMIT 1',
        [config.tenantSlug],
      );
      if (tenantRes.rows.length > 0) {
        await seedSampleData(db, tenantRes.rows[0].id as string);
      }
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
      const userCountResult = await db.query('SELECT COUNT(*)::int AS count FROM users');
      const userCount = Number(userCountResult.rows[0]?.count ?? 0);
      const hasUsers = userCount > 0;
      res.json({
        status: 'ok',
        db: 'ok',
        version: SERVER_VERSION,
        environment: process.env.NODE_ENV ?? 'development',
        setup: {
          has_users: hasUsers,
          bootstrap_required: !hasUsers,
          public_registration_enabled: config.allowPublicRegistration,
          registration_open: !hasUsers || config.allowPublicRegistration,
        },
      });
    } catch {
      res.status(503).json({
        status: 'error',
        db: 'error',
        version: SERVER_VERSION,
        environment: process.env.NODE_ENV ?? 'development',
      });
    }
  });

  // Auth routes (no /api/v1 prefix)
  app.use('/auth', authRouter(db, config.jwtSecret, { allowPublicRegistration: config.allowPublicRegistration }));

  // Inbound webhook routes (no auth — provider HMAC-signed)
  app.use('/api/v1', inboundRouter(db));

  // Helper: authenticate and return actor from Authorization header
  async function extractMcpActor(req: express.Request): Promise<ActorContext> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw unauthorized('MCP requires an Authorization: Bearer token header');
    }

    const fakeReq = { headers: req.headers, actor: undefined } as express.Request;
    let authFailure: { status: number; body: unknown } | undefined;

    await new Promise<void>((resolve) => {
      const fakeRes = {
        status: (status: number) => ({
          json: (body: unknown) => {
            authFailure = { status, body };
            resolve();
          },
        }),
      } as unknown as express.Response;

      Promise.resolve(authMiddleware(db, config.jwtSecret)(fakeReq, fakeRes, () => resolve()))
        .catch((err) => {
          authFailure = { status: 500, body: { detail: err instanceof Error ? err.message : 'Authentication failed' } };
          resolve();
        });
    });

    if (!fakeReq.actor) {
      const detail = (authFailure?.body as { detail?: string } | undefined)?.detail ?? 'Invalid MCP credentials';
      throw unauthorized(detail);
    }

    return fakeReq.actor;
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
      const server = createMcpServer(db, actor, () => actor);
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
        if (err instanceof CrmyError) {
          res.status(err.status).json(err.toJSON());
          return;
        }
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
  const { processWebhookRetries } = await import('./webhooks/dispatcher.js');
  const { processNextBatch: processContextOutbox } = await import('./workers/context_ingestion_worker.service.js');
  const { processEmbeddingJobs } = await import('./services/embedding-service.js');
  const { checkHitlSlaExpiry } = await import('./hitl/sla-checker.js');
  const { refreshStaleScores } = await import('./services/scoring.js');
  const { processSequenceDue, handleSequenceGoalEvent, resolveSequenceGoalContactId } = await import('./services/sequence-executor.js');
  const { refreshSequenceAnalytics } = await import('./services/sequence-analytics.js');
  const { markBackgroundTickFailure, markBackgroundTickSuccess } = await import('./services/scheduler-health.js');
  const { createWorkflowEngine } = await import('./workflows/engine.js');
  const workflowEngine = createWorkflowEngine(db);
  let backgroundWorkerRunning = false;
  const BACKGROUND_WORKER_LOCK_KEY = 8444219208;
  const BACKGROUND_TASK_TIMEOUT_MS = Number(process.env.BACKGROUND_TASK_TIMEOUT_MS ?? 45_000);
  async function tryAcquireBackgroundLock(): Promise<boolean> {
    const result = await db.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [BACKGROUND_WORKER_LOCK_KEY]);
    return result.rows[0]?.locked === true;
  }
  async function releaseBackgroundLock(): Promise<void> {
    await db.query('SELECT pg_advisory_unlock($1::bigint)', [BACKGROUND_WORKER_LOCK_KEY]);
  }
  async function runBackgroundTask(name: string, task: () => Promise<unknown>, failures: string[]): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        task(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${name} timed out after ${BACKGROUND_TASK_TIMEOUT_MS}ms`)), BACKGROUND_TASK_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      failures.push(name);
      console.error(`[background] ${name} failed:`, err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const hitlInterval = setInterval(async () => {
    if (backgroundWorkerRunning) return;
    let lockHeld = false;
    try {
      backgroundWorkerRunning = true;
      lockHeld = await tryAcquireBackgroundLock();
      if (!lockHeld) return;
      const failures: string[] = [];
      await runBackgroundTask('hitl_auto_approve_expired', () => autoApproveExpired(db), failures);
      await runBackgroundTask('hitl_expire_old_requests', () => expireOldRequests(db), failures);
      await runBackgroundTask('hitl_sla_expiry', () => checkHitlSlaExpiry(db), failures);
      await runBackgroundTask('agent_session_cleanup', () => cleanExpiredSessions(db), failures);
      await runBackgroundTask('agent_turns', () => processPendingAgentTurns(db), failures);
      await runBackgroundTask('context_pending_extractions', () => processPendingExtractions(db), failures);
      await runBackgroundTask('context_stale_entries', () => processStaleEntries(db), failures);
      await runBackgroundTask('webhook_retries', () => processWebhookRetries(db), failures);
      await runBackgroundTask('context_outbox', () => processContextOutbox(db), failures);
      await runBackgroundTask('context_embedding_jobs', () => processEmbeddingJobs(db), failures);
      await runBackgroundTask('context_stale_scores', () => refreshStaleScores(db), failures);
      // Purge workflow run history older than 90 days
      await runBackgroundTask('workflow_run_purge', () => purgeOldWorkflowRuns(db), failures);
      // Catch up workflow events that were persisted but missed by in-process delivery
      await runBackgroundTask('workflow_backlog', () => workflowEngine.processBacklog(100), failures);
      // Process due sequence enrollments
      await runBackgroundTask('sequence_due_steps', () => processSequenceDue(db), failures);
      // Refresh sequence analytics rollup
      await runBackgroundTask('sequence_analytics', () => refreshSequenceAnalytics(db), failures);
      // Evict idle MCP sessions (30-minute TTL)
      evictStaleMcpSessions();
      if (failures.length > 0) {
        markBackgroundTickFailure(new Error(`Background tasks failed: ${failures.join(', ')}`));
      } else {
        markBackgroundTickSuccess();
      }
    } catch (err) {
      // Log the error but keep the interval running — a transient DB error
      // should not permanently disable all background maintenance tasks.
      markBackgroundTickFailure(err);
      console.error('Background worker error:', err);
    } finally {
      if (lockHeld) {
        try {
          await releaseBackgroundLock();
        } catch (err) {
          console.warn('[background] Failed to release advisory lock:', err);
        }
      }
      backgroundWorkerRunning = false;
    }
  }, 60_000);

  // Load plugins
  if (config.plugins?.length) {
    await loadPlugins(config.plugins, { db, config: {} });
  }

  // Register email HITL approval/rejection handler
  const { registerEmailHitlHandler } = await import('./email/hitl-handler.js');
  registerEmailHitlHandler(db);

  // Register HITL submission notification handler (channel notify + fallback assignment)
  const { registerHitlNotificationHandler } = await import('./hitl/notification-handler.js');
  registerHitlNotificationHandler(db);

  // Register Systems of Record writeback approval/rejection handler
  const { registerSystemsOfRecordHitlHandler } = await import('./services/systems-of-record/hitl-handler.js');
  registerSystemsOfRecordHitlHandler(db);

  // Wire workflow engine to event bus — workflows trigger on emitted events
  eventBus.on('crmy:event', (event) => {
    // Skip workflow-generated events to prevent infinite loops
    if (event.eventType.startsWith('workflow.')) return;
    const workflowPayload = {
      ...((event.afterData && typeof event.afterData === 'object') ? event.afterData as Record<string, unknown> : { value: event.afterData }),
      event_type: event.eventType,
      event_id: event.event_id,
      object_type: event.objectType,
      object_id: event.objectId,
      metadata: event.metadata ?? {},
    };
    workflowEngine
      .processEvent(event.tenantId, event.eventType, event.event_id, workflowPayload)
      .catch((err) => console.error('[workflow] processEvent error:', err));
  });

  // Wire plugin event dispatch to event bus
  const { dispatchEvent } = await import('./plugins/index.js');
  eventBus.on('crmy:event', (event) => {
    dispatchEvent({
      id: event.event_id,
      tenant_id: event.tenantId,
      event_type: event.eventType,
      actor_id: event.actorId,
      actor_type: event.actorType,
      object_type: event.objectType,
      object_id: event.objectId,
      before_data: event.beforeData,
      after_data: event.afterData,
      metadata: event.metadata ?? {},
      created_at: new Date().toISOString(),
    }).catch((err) => console.error('[plugins] dispatchEvent error:', err));
  });

  // Wire sequence goal-event detection to event bus
  eventBus.on('crmy:event', (event) => {
    const contactId = resolveSequenceGoalContactId({
      objectType: event.objectType,
      objectId: event.objectId,
      afterData: event.afterData,
      metadata: event.metadata ?? {},
    });
    if (contactId) {
      handleSequenceGoalEvent(db, event.tenantId, event.eventType, contactId)
        .catch((err) => console.error('[sequences] goal-event error:', err));
    }
  });

  // Wire webhook dispatcher to event bus — delivers to registered webhook endpoints
  const { registerWebhookDispatcher } = await import('./webhooks/dispatcher.js');
  registerWebhookDispatcher(db);

  // Start messaging retry loop (30s interval for exponential backoff retries)
  const { startRetryLoop, stopRetryLoop } = await import('./messaging/delivery.js');
  startRetryLoop(db);

  return { app, db, hitlInterval, stopRetryLoop };
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
    const tenants = await db.query<{ id: string }>('SELECT id FROM tenants');
    const tenantIds = new Set([tenantId, ...tenants.rows.map(row => row.id)]);
    for (const id of tenantIds) {
      await seedActivityTypes(db, id);
      await seedContextTypes(db, id);
    }
  } catch {
    // Tables may not exist yet if migration hasn't run
  }
}

// Direct startup
async function main() {
  const config = loadConfig();
  const { app, hitlInterval, stopRetryLoop } = await createApp(config);

  const server = app.listen(config.port, () => {
    console.log(`crmy server ready on :${config.port}`);
  });
  server.on('error', async (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Could not start CRMy server: port ${config.port} is already in use. Stop the other CRMy server process or set PORT to another value.`);
    } else {
      console.error('Could not start CRMy server:', err.message);
    }
    clearInterval(hitlInterval);
    stopRetryLoop();
    await shutdownPlugins();
    await closePool();
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = async () => {
    clearInterval(hitlInterval);
    stopRetryLoop();
    await shutdownPlugins();
    server.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only run if this is the main module
const isMain = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;
if (isMain && !process.env.CRMY_IMPORTED) {
  main().catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}

export { getPool, initPool, closePool } from './db/pool.js';
export { runMigrations, getMigrationStatus } from './db/migrate.js';
export { createMcpServer, getAllTools, normalizeToolInput } from './mcp/server.js';
export { emitEvent } from './events/emitter.js';
export { createWorkflowEngine } from './workflows/engine.js';
export { getSampleDataStatus, resetSampleData, seedSampleData } from './services/sample-data.js';
export { loadPlugins, shutdownPlugins } from './plugins/index.js';
export type { CrmyPlugin, PluginConfig } from './plugins/index.js';
export type { ToolDef } from './mcp/server.js';
