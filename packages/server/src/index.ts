// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { initPool, getPool, closePool, type DbPool } from './db/pool.js';
import { getMigrationStatus, runMigrations } from './db/migrate.js';
import { authRouter } from './auth/routes.js';
import { authMiddleware } from './auth/middleware.js';
import { apiRouter, inboundRouter } from './rest/router.js';
import { agentRouter } from './agent/routes.js';
import { createMcpServer } from './mcp/server.js';
import {
  mcpSessions,
  registerMcpSession,
  removeMcpSession,
  touchMcpSession,
  evictStaleMcpSessions,
  isSameMcpActor,
  startMcpResourceNotificationListener,
} from './mcp/session-registry.js';
import {
  closeMcpSessionRecord,
  durableSessionMatchesActor,
  expireMcpSessionRecord,
  expireMcpSessionsForInstance,
  expireSessionsOwnedByStaleInstances,
  expireTimedOutMcpSessions,
  getMcpSession,
  heartbeatMcpInstance,
  isDurableSessionUsable,
  touchMcpSessionRecord,
  upsertMcpSession,
} from './db/repos/mcp-sessions.js';
import { autoApproveExpired, expireOldRequests } from './db/repos/hitl.js';
import { cleanExpiredSessions } from './db/repos/agent.js';
import { processPendingExtractions } from './agent/extraction.js';
import { processPendingAgentTurns } from './agent/turn-runner.js';
import { processStaleEntries } from './services/staleness.js';
import { sweepKnowledgeFreshness } from './services/knowledge-freshness.js';
import { processKnowledgeReviews } from './services/knowledge-governance.js';
import { getSampleDataStatus, seedSampleData } from './services/sample-data.js';
import { actorRateLimitMiddleware, enforceActorRateLimit } from './services/rate-limit.js';
import { redactSecrets } from './lib/secrets.js';
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

const MCP_INSTANCE_ID = process.env.CRMY_INSTANCE_ID?.trim()
  || `local-${process.pid}-${randomUUID()}`;
const MCP_SESSION_TTL_MS = Math.max(60, Number(process.env.CRMY_MCP_SESSION_TTL_SECONDS ?? 30 * 60)) * 1000;
const MCP_STALE_INSTANCE_MS = Math.max(60, Number(process.env.CRMY_MCP_STALE_INSTANCE_SECONDS ?? 120)) * 1000;

function safeLogError(err: unknown): unknown {
  if (err instanceof Error) {
    return redactSecrets({
      name: err.name,
      message: err.message,
      code: (err as { code?: unknown }).code,
      status: (err as { status?: unknown }).status,
    });
  }
  return redactSecrets(err);
}

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code ?? '')
    : undefined;
}

export type ProgressStep = 'db_connect' | 'migrations' | 'seed_defaults';
export type ProgressStatus = 'start' | 'done' | 'error';
export type ProcessRole = 'all' | 'web' | 'worker';
export type MigrationStartupMode = 'auto' | 'validate' | 'skip';

export interface ServerConfig {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  tenantSlug: string;
  allowPublicRegistration: boolean;
  processRole: ProcessRole;
  migrationStartupMode: MigrationStartupMode;
  plugins?: PluginConfig[];
  /** Optional progress callback for CLI startup UI */
  onProgress?: (step: ProgressStep, status: ProgressStatus, detail?: string) => void;
  /** Optional per-migration progress callback */
  onMigration?: (name: string, index: number, total: number) => void;
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  const numeric = Number(normalized);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : value;
}

function parseCorsOrigins(value: string | undefined): Set<string> | true | false {
  if (!value?.trim()) return false;
  const trimmed = value.trim();
  if (trimmed === '*') return true;
  return new Set(trimmed.split(',').map(origin => origin.trim()).filter(Boolean));
}

function isAllowedLocalDevOrigin(origin: string): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return origin === 'http://localhost:5173'
    || origin === 'http://127.0.0.1:5173'
    || origin === 'http://[::1]:5173';
}

function isSameRequestOrigin(req: express.Request, origin: string): boolean {
  try {
    const requestOrigin = new URL(origin);
    return requestOrigin.protocol.replace(':', '') === req.protocol && requestOrigin.host === req.get('host');
  } catch {
    return false;
  }
}

function parseProcessRole(value: string | undefined): ProcessRole {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'all';
  if (normalized === 'all' || normalized === 'web' || normalized === 'worker') return normalized;
  throw new Error('CRMY_PROCESS_ROLE must be one of: all, web, worker');
}

function parseMigrationStartupMode(value: string | undefined): MigrationStartupMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return process.env.NODE_ENV === 'production' ? 'validate' : 'auto';
  if (normalized === 'auto' || normalized === 'validate' || normalized === 'skip') return normalized;
  throw new Error('CRMY_MIGRATION_MODE must be one of: auto, validate, skip');
}

export function loadConfig(): ServerConfig {
  const databaseUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  const processRole = parseProcessRole(process.env.CRMY_PROCESS_ROLE);
  const migrationStartupMode = parseMigrationStartupMode(process.env.CRMY_MIGRATION_MODE);

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!jwtSecret) throw new Error('JWT_SECRET is required');

  const KNOWN_BAD_SECRETS = ['change-me-in-production', 'dev-secret', 'secret', ''];
  if (KNOWN_BAD_SECRETS.includes(jwtSecret) && process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is set to a known default — this is not safe for production.\n' +
      '  Generate a real secret:  openssl rand -hex 32',
    );
  }
  if (process.env.NODE_ENV === 'production' && !process.env.CRMY_ENCRYPTION_KEY && !process.env.AGENT_ENCRYPTION_KEY) {
    throw new Error(
      'CRMY_ENCRYPTION_KEY is required in production for stored secrets.\n' +
      '  Generate a real secret:  openssl rand -hex 32',
    );
  }
  if (process.env.CRMY_DEPLOYMENT_MODE === 'multi_instance') {
    const instanceId = process.env.CRMY_INSTANCE_ID?.trim();
    const mcpSessionMode = process.env.CRMY_MCP_SESSION_MODE?.trim();
    const browserCookieAuth = process.env.CRMY_BROWSER_COOKIE_AUTH === 'true';
    const allowBrowserBearerAuth = process.env.CRMY_ALLOW_BROWSER_BEARER_AUTH === 'true';
    if (!instanceId) {
      throw new Error(
        'CRMY_INSTANCE_ID is required when CRMY_DEPLOYMENT_MODE=multi_instance.\n' +
        '  Set a stable unique id per app instance so MCP session ownership and expiry are durable.',
      );
    }
    if (mcpSessionMode !== 'sticky') {
      throw new Error(
        'CRMY_MCP_SESSION_MODE=sticky is required when CRMY_DEPLOYMENT_MODE=multi_instance.\n' +
        '  Configure the load balancer to route by mcp-session-id. CRMy will reject wrong-instance session requests clearly instead of creating unsafe in-process sessions.',
      );
    }
    if (!browserCookieAuth && !allowBrowserBearerAuth) {
      throw new Error(
        'CRMY_BROWSER_COOKIE_AUTH=true is required when CRMY_DEPLOYMENT_MODE=multi_instance.\n' +
        '  Hosted browser sessions should use HttpOnly cookies instead of localStorage bearer tokens. ' +
        'Set CRMY_ALLOW_BROWSER_BEARER_AUTH=true only for a deliberate private deployment exception.',
      );
    }
  }

  return {
    databaseUrl,
    jwtSecret,
    port: parseInt(process.env.PORT ?? '3000', 10),
    tenantSlug: process.env.CRMY_TENANT_ID ?? 'default',
    allowPublicRegistration: process.env.CRMY_ALLOW_PUBLIC_REGISTRATION === 'true',
    processRole,
    migrationStartupMode,
  };
}

async function prepareDatabaseMigrations(
  db: DbPool,
  config: ServerConfig,
): Promise<string> {
  if (config.migrationStartupMode === 'skip') {
    return 'skipped by CRMY_MIGRATION_MODE';
  }
  if (config.migrationStartupMode === 'validate') {
    const status = await getMigrationStatus(db);
    if (status.pending.length > 0) {
      throw new Error(
        `Database has ${status.pending.length} pending migration(s): ${status.pending.join(', ')}.\n` +
        '  Run `crmy migrate run` as a one-shot migration job, or set CRMY_MIGRATION_MODE=auto only for local/single-instance deployments.',
      );
    }
    return 'up to date';
  }
  const ran = await runMigrations(db, config.onMigration);
  return ran.length > 0 ? `${ran.length} applied` : 'up to date';
}

export async function createApp(config: ServerConfig) {
  const progress = config.onProgress ?? (() => {});
  const servesHttp = config.processRole !== 'worker';
  const runsWorkers = config.processRole !== 'web';

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
  try {
    progress('migrations', 'done', await prepareDatabaseMigrations(db, config));
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

  await expireMcpSessionsForInstance(db, MCP_INSTANCE_ID, 'server_startup').catch((err) => {
    console.warn('[mcp] Failed to expire previous sessions for this instance:', safeLogError(err));
  });
  await heartbeatMcpInstance(db, MCP_INSTANCE_ID, {
    version: SERVER_VERSION,
    deployment_mode: process.env.CRMY_DEPLOYMENT_MODE ?? 'single_instance',
  }).catch((err) => {
    console.warn('[mcp] Failed to write initial instance heartbeat:', safeLogError(err));
  });

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
  let stopMcpResourceNotifications: () => Promise<void> = async () => {};
  if (servesHttp) {
    try {
      stopMcpResourceNotifications = await startMcpResourceNotificationListener(db);
    } catch (err) {
      console.warn('[mcp] Cross-instance resource notifications are unavailable:', safeLogError(err));
    }
  }
  app.set('trust proxy', parseTrustProxy(process.env.CRMY_TRUST_PROXY ?? process.env.TRUST_PROXY));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  const allowedCorsOrigins = parseCorsOrigins(process.env.CRMY_CORS_ORIGINS ?? process.env.CORS_ORIGINS);
  app.use(cors((req, callback) => {
    callback(null, {
      origin(origin: string | undefined, originCallback: (err: Error | null, allow?: boolean) => void) {
        if (!origin) {
          originCallback(null, true);
          return;
        }
        if (isSameRequestOrigin(req, origin)) {
          originCallback(null, true);
          return;
        }
        if (isAllowedLocalDevOrigin(origin)) {
          originCallback(null, true);
          return;
        }
        if (allowedCorsOrigins === true || (allowedCorsOrigins instanceof Set && allowedCorsOrigins.has(origin))) {
          originCallback(null, true);
          return;
        }
        originCallback(new Error('Origin is not allowed by CRMy CORS policy'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['authorization', 'content-type', 'mcp-session-id', 'x-crmy-tenant-id', 'x-crmy-signature'],
      exposedHeaders: ['mcp-session-id'],
      maxAge: 600,
    });
  }));
  // Limit JSON payloads to 1 MB to prevent DoS via oversized bodies.
  // MCP tool calls may include context blobs — 1 MB is generous but bounded.
  app.use(express.json({ limit: '1mb' }));

  // Health check (no auth). Production returns only liveness/readiness signals;
  // local/dev keeps setup metadata so first-run onboarding can stay smooth.
  app.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      if (process.env.NODE_ENV === 'production') {
        res.json({
          status: 'ok',
          db: 'ok',
          version: SERVER_VERSION,
        });
        return;
      }
      const userCountResult = await db.query('SELECT COUNT(*)::int AS count FROM users');
      const userCount = Number(userCountResult.rows[0]?.count ?? 0);
      const hasUsers = userCount > 0;
      const tenantResult = await db.query(
        'SELECT id, name, slug FROM tenants WHERE id::text = $1 OR slug = $1 ORDER BY created_at DESC LIMIT 1',
        [config.tenantSlug],
      );
      const tenantId = tenantResult.rows[0]?.id ?? config.tenantSlug;
      const sampleStatus = await getSampleDataStatus(db, tenantId);
      const demoAccountsAvailable = process.env.NODE_ENV !== 'production' && sampleStatus.seeded;
      res.json({
        status: 'ok',
        db: 'ok',
        version: SERVER_VERSION,
        environment: process.env.NODE_ENV ?? 'development',
        tenant: {
          name: tenantResult.rows[0]?.name ?? 'CRMy Workspace',
          slug: tenantResult.rows[0]?.slug ?? config.tenantSlug,
        },
        setup: {
          has_users: hasUsers,
          bootstrap_required: !hasUsers,
          public_registration_enabled: config.allowPublicRegistration,
          registration_open: !hasUsers || config.allowPublicRegistration,
          demo_accounts_available: demoAccountsAvailable,
        },
      });
    } catch {
      res.status(503).json(process.env.NODE_ENV === 'production'
        ? { status: 'error', db: 'error', version: SERVER_VERSION }
        : {
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
      const actor = await extractMcpActor(req);
      await enforceActorRateLimit(db, actor, `MCP ${req.method}`);

      // Reuse existing session (subsequent GET/POST from same client).
      // Session ids are state handles, not bearer credentials; every request
      // must still authenticate as the actor that initialized the session.
      if (sessionId) {
        const existingSession = mcpSessions.get(sessionId);
        let durableSession = await getMcpSession(db, sessionId);

        if (!durableSession && existingSession && isSameMcpActor(actor, existingSession.actor)) {
          durableSession = await upsertMcpSession(db, {
            sessionId,
            actor,
            owningInstanceId: MCP_INSTANCE_ID,
            ttlMs: MCP_SESSION_TTL_MS,
            metadata: {
              recovered_from_local_registry: true,
              recovery_reason: 'durable_catalog_missing',
            },
          });
        }

        if (!durableSession) {
          throw new CrmyError(
            'CONFLICT',
            'MCP session was not found. Reinitialize the MCP session and retry.',
            410,
            { reason: 'mcp_session_not_found' },
          );
        }
        if (!durableSessionMatchesActor(durableSession, actor)) {
          throw unauthorized('MCP session belongs to a different actor or scope set');
        }
        if (!isDurableSessionUsable(durableSession)) {
          throw new CrmyError(
            'CONFLICT',
            'MCP session is closed or expired. Reinitialize the MCP session and retry.',
            410,
            {
              reason: durableSession.close_reason ?? durableSession.transport_state,
              transport_state: durableSession.transport_state,
            },
          );
        }
        if (!existingSession) {
          if (durableSession.owning_instance_id !== MCP_INSTANCE_ID) {
            throw new CrmyError(
              'CONFLICT',
              'MCP session belongs to another CRMy instance. Configure sticky routing by mcp-session-id or reinitialize the session.',
              409,
              { reason: 'mcp_session_wrong_instance' },
            );
          }
          await expireMcpSessionRecord(db, sessionId, 'local_transport_missing');
          throw new CrmyError(
            'CONFLICT',
            'MCP session transport is no longer active on this instance. Reinitialize the MCP session and retry.',
            410,
            { reason: 'mcp_session_transport_missing' },
          );
        }
        if (!isSameMcpActor(actor, existingSession.actor)) {
          throw unauthorized('MCP session belongs to a different actor or scope set');
        }
        touchMcpSession(sessionId); // reset local idle TTL
        await touchMcpSessionRecord(db, sessionId, MCP_SESSION_TTL_MS, MCP_INSTANCE_ID);
        await existingSession.transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method !== 'POST') {
        throw new CrmyError(
          'VALIDATION_ERROR',
          'MCP session id is required for GET and DELETE requests. Initialize a session with POST /mcp first.',
          400,
          { reason: 'mcp_session_id_required' },
        );
      }

      // New session — authenticate and create. The working set ("toolset") is
      // chosen per connection via ?toolset= or the X-CRMy-Toolset header, so the
      // same key can open differently-focused sessions for different jobs.
      const requestedToolset =
        (typeof req.query?.toolset === 'string' ? req.query.toolset : undefined)
        ?? (typeof req.headers['x-crmy-toolset'] === 'string' ? req.headers['x-crmy-toolset'] : undefined);
      const server = createMcpServer(db, actor, () => actor, { toolset: requestedToolset });
      let durableRegistration: Promise<unknown> | undefined;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          registerMcpSession(sid, server, transport, actor);
          durableRegistration = upsertMcpSession(db, {
            sessionId: sid,
            actor,
            owningInstanceId: MCP_INSTANCE_ID,
            ttlMs: MCP_SESSION_TTL_MS,
            metadata: {
              transport: 'streamable_http',
              server_version: SERVER_VERSION,
            },
          }).catch((err) => {
            removeMcpSession(sid);
            transport.close?.().catch(() => {});
            console.error('[mcp] Failed to record durable session:', safeLogError(err));
            throw err;
          });
        },
      });

      transport.onclose = () => {
        // Clean up registry when the session closes
        for (const [sid, s] of mcpSessions) {
          if (s.transport === transport) {
            removeMcpSession(sid);
            closeMcpSessionRecord(db, sid, 'transport_closed').catch(() => {});
            break;
          }
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      await durableRegistration;
    } catch (err) {
      console.error('MCP error:', safeLogError(err));
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

  const mcpHeartbeatInterval = servesHttp
    ? setInterval(async () => {
      try {
        await heartbeatMcpInstance(db, MCP_INSTANCE_ID, {
          version: SERVER_VERSION,
          deployment_mode: process.env.CRMY_DEPLOYMENT_MODE ?? 'single_instance',
          process_role: config.processRole,
        });
        await expireTimedOutMcpSessions(db);
        await expireSessionsOwnedByStaleInstances(db, MCP_STALE_INSTANCE_MS);
      } catch (err) {
        console.warn('[mcp] Session heartbeat/expiry failed:', safeLogError(err));
      }
    }, 30_000)
    : undefined;

  // Authenticated API routes
  app.use('/api/v1', authMiddleware(db, config.jwtSecret), actorRateLimitMiddleware(db), apiRouter(db));
  app.use('/api/v1/agent', authMiddleware(db, config.jwtSecret), actorRateLimitMiddleware(db), agentRouter(db));

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
  const { processWebhookRetries, processWebhookEventBacklog } = await import('./webhooks/dispatcher.js');
  const { processNextBatch: processContextOutbox } = await import('./workers/context_ingestion_worker.service.js');
  const { processEmbeddingJobs } = await import('./services/embedding-service.js');
  const { checkHitlSlaExpiry } = await import('./hitl/sla-checker.js');
  const { refreshStaleScores } = await import('./services/scoring.js');
  const { processPendingRawContextSources } = await import('./services/raw-context-processing.js');
  const { processMailboxSyncJobs, processDeliveredOutboundEmailContextJobs } = await import('./services/customer-email.js');
  const { processEmailDeliveryJobs } = await import('./email/delivery.js');
  const { processCalendarSyncJobs } = await import('./services/customer-activity.js');
  const { processContextSourceSyncJobs, processContextSourceProcessingJobs } = await import('./services/context-source-drops.js');
  const { processSequenceDue, handleSequenceGoalEvent, resolveSequenceGoalContactId } = await import('./services/sequence-executor.js');
  const { refreshSequenceAnalytics } = await import('./services/sequence-analytics.js');
  const { purgeRateLimitBuckets } = await import('./services/rate-limit.js');
  const { markBackgroundTickFailure, markBackgroundTickSuccess } = await import('./services/scheduler-health.js');
  const { createWorkflowEngine } = await import('./workflows/engine.js');
  const workflowEngine = createWorkflowEngine(db);
  let backgroundWorkerRunning = false;
  const backgroundTasksInFlight = new Set<Promise<unknown>>();
  const BACKGROUND_WORKER_LOCK_KEY = 8444219208;
  const BACKGROUND_TASK_TIMEOUT_MS = Number(process.env.BACKGROUND_TASK_TIMEOUT_MS ?? 45_000);
  async function runWithBackgroundLock(task: () => Promise<void>): Promise<boolean> {
    const client = await db.connect();
    let locked = false;
    try {
      const result = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [BACKGROUND_WORKER_LOCK_KEY]);
      locked = result.rows[0]?.locked === true;
      if (!locked) return false;
      await task();
      return true;
    } finally {
      if (locked) {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [BACKGROUND_WORKER_LOCK_KEY]).catch((err) => {
          console.warn('[background] Failed to release advisory lock:', safeLogError(err));
        });
      }
      client.release();
    }
  }
  async function runBackgroundTask(name: string, task: () => Promise<unknown>, failures: string[]): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const taskPromise = task();
    backgroundTasksInFlight.add(taskPromise);
    taskPromise.finally(() => backgroundTasksInFlight.delete(taskPromise)).catch(() => {});
    try {
      await Promise.race([
        taskPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${name} timed out after ${BACKGROUND_TASK_TIMEOUT_MS}ms`)), BACKGROUND_TASK_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      failures.push(name);
      if (errorCode(err) === '42P01') {
        console.error(
          `[background] ${name} failed because the database schema is missing a required table. ` +
          'Stop CRMy, run `crmy migrate run`, then restart the server.',
          safeLogError(err),
        );
      } else {
        console.error(`[background] ${name} failed:`, safeLogError(err));
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const hitlInterval = runsWorkers ? setInterval(async () => {
    if (backgroundWorkerRunning || backgroundTasksInFlight.size > 0) return;
    try {
      backgroundWorkerRunning = true;
      await runWithBackgroundLock(async () => {
        const failures: string[] = [];
        await runBackgroundTask('hitl_auto_approve_expired', () => autoApproveExpired(db), failures);
        await runBackgroundTask('hitl_expire_old_requests', () => expireOldRequests(db), failures);
        await runBackgroundTask('hitl_sla_expiry', () => checkHitlSlaExpiry(db), failures);
        await runBackgroundTask('agent_session_cleanup', () => cleanExpiredSessions(db), failures);
        await runBackgroundTask('agent_turns', () => processPendingAgentTurns(db), failures);
        await runBackgroundTask('context_pending_extractions', () => processPendingExtractions(db), failures);
        await runBackgroundTask('raw_context_sources', () => processPendingRawContextSources(db), failures);
        await runBackgroundTask('context_stale_entries', () => processStaleEntries(db), failures);
        // Product knowledge (optional): age out stale claims, then open review assignments for owned claims needing attention.
        await runBackgroundTask('knowledge_freshness_sweep', () => sweepKnowledgeFreshness(db), failures);
        await runBackgroundTask('knowledge_review_assignments', () => processKnowledgeReviews(db), failures);
        await runBackgroundTask('webhook_event_backlog', () => processWebhookEventBacklog(db), failures);
        await runBackgroundTask('webhook_retries', () => processWebhookRetries(db), failures);
        await runBackgroundTask('context_outbox', () => processContextOutbox(db), failures);
        await runBackgroundTask('context_embedding_jobs', () => processEmbeddingJobs(db), failures);
        await runBackgroundTask('email_delivery_jobs', () => processEmailDeliveryJobs(db), failures);
        await runBackgroundTask('delivered_outbound_email_context', () => processDeliveredOutboundEmailContextJobs(db), failures);
        await runBackgroundTask('mailbox_sync_jobs', () => processMailboxSyncJobs(db), failures);
        await runBackgroundTask('calendar_sync_jobs', () => processCalendarSyncJobs(db), failures);
        await runBackgroundTask('context_source_sync_jobs', () => processContextSourceSyncJobs(db), failures);
        await runBackgroundTask('context_source_processing_jobs', () => processContextSourceProcessingJobs(db), failures);
        await runBackgroundTask('context_stale_scores', () => refreshStaleScores(db), failures);
        // Purge workflow run history older than 90 days
        await runBackgroundTask('workflow_run_purge', () => purgeOldWorkflowRuns(db), failures);
        // Catch up workflow events that were persisted but missed by in-process delivery
        await runBackgroundTask('workflow_backlog', () => workflowEngine.processBacklog(100), failures);
        // Process due sequence enrollments
        await runBackgroundTask('sequence_due_steps', () => processSequenceDue(db), failures);
        // Refresh sequence analytics rollup
        await runBackgroundTask('sequence_analytics', () => refreshSequenceAnalytics(db), failures);
        await runBackgroundTask('rate_limit_bucket_purge', () => purgeRateLimitBuckets(db), failures);
        // Evict idle MCP sessions (30-minute TTL)
        await evictStaleMcpSessions(db);
        if (failures.length > 0) {
          markBackgroundTickFailure(new Error(`Background tasks failed: ${failures.join(', ')}`));
        } else {
          markBackgroundTickSuccess();
        }
      });
    } catch (err) {
      // Log the error but keep the interval running — a transient DB error
      // should not permanently disable all background maintenance tasks.
      markBackgroundTickFailure(err);
      console.error('Background worker error:', safeLogError(err));
    } finally {
      backgroundWorkerRunning = false;
    }
  }, 60_000) : undefined;

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
  let stopRetryLoop = (): void => {};
  if (runsWorkers) {
    const messagingDelivery = await import('./messaging/delivery.js');
    messagingDelivery.startRetryLoop(db);
    stopRetryLoop = messagingDelivery.stopRetryLoop;
  }

  return { app, db, hitlInterval, mcpHeartbeatInterval, stopRetryLoop, stopMcpResourceNotifications };
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
  const { app, hitlInterval, mcpHeartbeatInterval, stopRetryLoop, stopMcpResourceNotifications } = await createApp(config);
  let server: ReturnType<typeof app.listen> | undefined;

  if (config.processRole === 'worker') {
    console.log('crmy worker ready');
  } else {
    server = app.listen(config.port, () => {
      console.log(`crmy server ready on :${config.port}`);
    });
    server.on('error', async (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Could not start CRMy server: port ${config.port} is already in use. Stop the other CRMy server process or set PORT to another value.`);
      } else {
        console.error('Could not start CRMy server:', err.message);
      }
      if (hitlInterval) clearInterval(hitlInterval);
      if (mcpHeartbeatInterval) clearInterval(mcpHeartbeatInterval);
      stopRetryLoop();
      await stopMcpResourceNotifications();
      await shutdownPlugins();
      await closePool();
      process.exit(1);
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    if (hitlInterval) clearInterval(hitlInterval);
    if (mcpHeartbeatInterval) clearInterval(mcpHeartbeatInterval);
    stopRetryLoop();
    await expireMcpSessionsForInstance(getPool(), MCP_INSTANCE_ID, 'server_shutdown').catch(() => {});
    await stopMcpResourceNotifications();
    await shutdownPlugins();
    server?.close();
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
export { createMcpServer, getAllTools, getToolsForActor, normalizeToolInput } from './mcp/server.js';
export {
  CORE_TOOLS,
  FULL_TOOLSET,
  TOOLSET_DEFINITIONS,
  isValidToolset,
  listToolsets,
  resolveToolsetName,
  selectToolset,
  toolNamesForToolset,
} from './mcp/toolsets.js';
export { describeTool, zodToJsonSchema } from './mcp/tool-describe.js';
export { emitEvent } from './events/emitter.js';
export { createWorkflowEngine } from './workflows/engine.js';
export { getSampleDataStatus, resetSampleData, seedSampleData } from './services/sample-data.js';
export { retrieveKnowledge, isProductKnowledgeConfigured, selectClaims, upsertProductKnowledgeClaim, buildProductContext, getProductContextForSubject } from './services/knowledge-retrieval.js';
export { sweepKnowledgeFreshness, sweepTenantKnowledgeFreshness, computeStaleClaimIds, freshnessWindowDays } from './services/knowledge-freshness.js';
export {
  listKnowledgeClaimsForReview, reviewKnowledgeClaim, reviewDecisionToPatch,
  detectKnowledgeConflicts, conflictBasis, classifyConflict,
  processKnowledgeReviews, processKnowledgeReviewsForTenant, rowToKnowledgeRecord,
} from './services/knowledge-governance.js';
export { loadPlugins, shutdownPlugins } from './plugins/index.js';
export { encrypt as encryptAgentSecret, decrypt as decryptAgentSecret } from './agent/crypto.js';
export { buildOpenAICompatibleHeaders, verifyAgentToolCalling, verifyPlainModelReachability } from './agent/readiness.js';
export { listCrmyEvalSuites, runCrmyEval } from './evals/runner.js';
export type { CrmyPlugin, PluginConfig } from './plugins/index.js';
export type { ToolDef } from './mcp/server.js';
