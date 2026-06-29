// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { loadConfigFile, GLOBAL_CONFIG, type CrmyConfig } from '../config.js';
import { getProvider } from '@crmy/shared';

const KNOWN_BAD_SECRETS = ['change-me-in-production', 'dev-secret', 'secret', ''];

function pass(msg: string): void {
  console.log(`  \x1b[32m✓\x1b[0m  ${msg}`);
}
function fail(msg: string, fix?: string): void {
  console.log(`  \x1b[31m✗\x1b[0m  ${msg}`);
  if (fix) console.log(`     \x1b[2m→ ${fix}\x1b[0m`);
}
function info(msg: string): void {
  console.log(`  \x1b[36mℹ\x1b[0m  ${msg}`);
}

async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Check CRMy config, database, migrations, model readiness, port, pgvector, and secrets')
    .option('--port <port>', 'Port to check availability for', '3000')
    .option('--skip-model-check', 'Skip Workspace Agent model configuration and provider checks')
    .option('--skip-model-test', 'Check saved model config without calling the provider')
    .action(async (opts) => {
      console.log('\n  CRMy Doctor\n  ══════════════════════════════════════\n');

      let passed = 0;
      let failed = 0;

      // ── Check 1: Node.js version ──────────────────────────────────────────
      const [major] = process.versions.node.split('.').map(Number);
      if (major >= 20) {
        pass(`Node.js ${process.version}`);
        passed++;
      } else {
        fail(`Node.js ${process.version} — CRMy requires >= 20.0.0`, 'Install from https://nodejs.org');
        failed++;
      }

      // ── Check 2: Config file exists ───────────────────────────────────────
      const localPath = path.join(process.cwd(), '.crmy.json');
      const hasLocal = fs.existsSync(localPath);
      const hasGlobal = fs.existsSync(GLOBAL_CONFIG);
      let config: CrmyConfig = {};

      if (hasLocal || hasGlobal) {
        try {
          config = loadConfigFile();
          const source = hasLocal ? '.crmy.json (local)' : '~/.crmy/config.json (global)';
          pass(`Config found: ${source}`);
          passed++;
        } catch {
          fail('Config file exists but is not valid JSON', 'Run: crmy init');
          failed++;
        }
      } else {
        fail('No config file found', 'Run: crmy init  (or set DATABASE_URL for direct database mode)');
        failed++;
      }

      // ── Check 3: Database connection ──────────────────────────────────────
      const dbUrl = config.database?.url ?? process.env.DATABASE_URL;
      if (dbUrl) {
        try {
          process.env.CRMY_IMPORTED = '1';
          const { initPool, closePool } = await import('@crmy/server');
          const db = await initPool(dbUrl, 2); // low pool for quick check
          await db.query('SELECT 1');
          pass('PostgreSQL reachable');
          passed++;

          // ── Check 4: Migrations up to date ────────────────────────────────
          try {
            const { getMigrationStatus } = await import('@crmy/server');
            const status = await getMigrationStatus(db);
            if (status.pending.length === 0) {
              pass(`Migrations up to date (${status.applied.length} applied)`);
              passed++;
            } else {
              // Filter out pgvector if not enabled
              const realPending = status.pending.filter(
                f => f !== '022_pgvector.sql' || process.env.ENABLE_PGVECTOR === 'true',
              );
              if (realPending.length === 0) {
                pass(`Migrations up to date (${status.applied.length} applied, pgvector optional)`);
                passed++;
              } else {
                fail(`${realPending.length} pending migration(s)`, 'Run: crmy migrate run');
                failed++;
              }
            }
          } catch {
            // getMigrationStatus may not be directly importable — try inline
            try {
              const applied = await db.query('SELECT name FROM _migrations ORDER BY name');
              pass(`Migrations table exists (${applied.rows.length} applied)`);
              passed++;
            } catch {
              fail('Migrations table not found', 'Run: crmy init');
              failed++;
            }
          }

          // ── Check 5: Admin user exists ────────────────────────────────────
          try {
            const users = await db.query('SELECT id FROM users LIMIT 1');
            if (users.rows.length > 0) {
              pass('Admin user exists');
              passed++;
            } else {
              fail('No users found', 'Run: crmy init  (or POST /auth/register)');
              failed++;
            }
          } catch {
            fail('Could not check users table', 'Run: crmy init');
            failed++;
          }

          // ── Check 6: pgvector extension ───────────────────────────────────
          try {
            const pgv = await db.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
            if (pgv.rows.length > 0) {
              pass('pgvector extension installed (semantic search available)');
              passed++;
            } else {
              info('pgvector not installed (semantic search disabled — this is optional)');
            }
          } catch {
            info('Could not check pgvector status');
          }

          // ── Check 7: API key validity for MCP/agent harnesses ─────────────
          const apiKey = process.env.CRMY_API_KEY ?? config.apiKey;
          if (apiKey) {
            try {
              const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
              const key = await db.query(
                `SELECT ak.id, a.is_active as actor_is_active
                 FROM api_keys ak
                 LEFT JOIN actors a ON ak.actor_id = a.id
                 WHERE ak.key_hash = $1
                 LIMIT 1`,
                [keyHash],
              );
              const row = key.rows[0];
              if (!row) {
                fail('CRMY_API_KEY is configured but does not match this database', 'Run: crmy init  (or update CRMY_API_KEY for this workspace)');
                failed++;
              } else if (row.actor_is_active === false) {
                fail('CRMY_API_KEY resolves to a deactivated actor', 'Create a new API key for an active user or agent actor');
                failed++;
              } else {
                pass('CRMY_API_KEY is valid for this workspace');
                passed++;
              }
            } catch {
              fail('Could not validate CRMY_API_KEY', 'Check the api_keys table or run: crmy init');
              failed++;
            }
          } else {
            info('No CRMY_API_KEY configured; direct local CLI mode will use the first active local user.');
          }

          // ── Check 8: Workspace Agent model readiness ─────────────────────
          if (opts.skipModelCheck) {
            info('Workspace Agent model check skipped; connector-free demo and review-only mode can still run.');
          } else {
            try {
              const tenantLookup = config.tenantId ?? 'default';
              const agent = await db.query(
                `SELECT ac.enabled, ac.provider, ac.base_url, ac.model, ac.api_key_enc,
                        ac.auto_promote_signals, ac.model_certification_status,
                        ac.model_certification_profile, ac.model_certification_run_id,
                        ac.model_certification_score
                 FROM agent_configs ac
                 JOIN tenants t ON t.id = ac.tenant_id
                 WHERE t.id::text = $1 OR t.slug = $1
                 ORDER BY ac.updated_at DESC
                 LIMIT 1`,
                [tenantLookup],
              );
              const row = agent.rows[0];
              if (!row) {
                fail('Workspace Agent model is not configured', 'Run `crmy init` interactively or open Settings -> Model.');
                failed++;
              } else if (!row.enabled) {
                fail('Workspace Agent model is saved but disabled', 'Enable it in Settings -> Model or rerun `crmy init`.');
                failed++;
              } else if (!row.provider || !row.base_url || !row.model) {
                fail('Workspace Agent model config is incomplete', 'Set provider, base URL, and model in Settings -> Model.');
                failed++;
              } else {
                const provider = String(row.provider);
                const providerDef = getProvider(provider);
                const certified = row.model_certification_status === 'certified'
                  && row.model_certification_profile === 'live_model'
                  && typeof row.model_certification_run_id === 'string'
                  && row.model_certification_run_id.trim().length > 0
                  && typeof row.model_certification_score === 'number'
                  && row.model_certification_score >= 0.85;
                const printCertificationState = () => {
                  if (row.auto_promote_signals === false) {
                    info('Automatic Memory is disabled in model settings.');
                  } else if (certified) {
                    pass(`Automatic Memory certification ready (${Math.round(Number(row.model_certification_score) * 100)}%)`);
                    passed++;
                  } else {
                    info('Automatic Memory is review-only until this exact model passes `crmy certify --output ./eval-runs`.');
                    info('CRMy will not let an unproven model invent customer truth.');
                  }
                };
                if (providerDef.requiresKey && !row.api_key_enc) {
                  fail(`${providerDef.label} model is missing an API key`, 'Save an API key in Settings -> Model or rerun `crmy init`.');
                  failed++;
                } else if (opts.skipModelTest) {
                  pass(`Workspace Agent configured (${providerDef.label} · ${row.model})`);
                  passed++;
                  printCertificationState();
                } else {
                  try {
                    const jwt = config.jwtSecret ?? process.env.JWT_SECRET;
                    if (jwt) process.env.JWT_SECRET = jwt;
                    const {
                      decryptAgentSecret,
                      buildOpenAICompatibleHeaders,
                      verifyAgentToolCalling,
                    } = await import('@crmy/server');
                    const baseUrl = String(row.base_url).replace(/\/+$/, '');
                    const apiKey = row.api_key_enc ? decryptAgentSecret(String(row.api_key_enc)).trim() : '';
                    const readiness = provider === 'anthropic'
                      ? await verifyAgentToolCalling({ provider, baseUrl, model: String(row.model), apiKey })
                      : await verifyAgentToolCalling({
                        provider,
                        baseUrl,
                        model: String(row.model),
                        apiKey,
                        headers: buildOpenAICompatibleHeaders(baseUrl, apiKey, provider),
                      });
                    if (readiness.ok && readiness.tool_calling_verified !== false) {
                      pass(`Workspace Agent online (${providerDef.label} · ${row.model})`);
                      passed++;
                      printCertificationState();
                    } else if (readiness.ok) {
                      pass(`Workspace Agent reachable (${providerDef.label} · ${row.model}; tool calling unverified)`);
                      passed++;
                      info(readiness.warning ?? 'Tool calling could not be verified; run a first agent request carefully.');
                      printCertificationState();
                    } else {
                      fail(
                        `Workspace Agent unreachable (${providerDef.label} · ${row.model})`,
                        readiness.error ?? 'Check provider URL, model ID, API key, and local runtime.',
                      );
                      failed++;
                    }
                  } catch (err) {
                    fail(
                      `Workspace Agent readiness failed: ${(err as Error).message}`,
                      'Check Settings -> Model or run `crmy doctor --skip-model-test` to verify saved config only.',
                    );
                    failed++;
                  }
                }
              }
            } catch (err) {
              fail(`Could not check Workspace Agent config: ${(err as Error).message}`, 'Run migrations, then configure Settings -> Model.');
              failed++;
            }
          }

          await closePool();
        } catch (err) {
          fail(`PostgreSQL unreachable: ${(err as Error).message}`, 'Check that PostgreSQL is running and DATABASE_URL is correct');
          failed++;
        }
      } else {
        fail('No DATABASE_URL configured', 'Run: crmy init, or export DATABASE_URL=postgresql://user:password@host:5432/crmy');
        failed++;
      }

      // ── Check 8: Port available ───────────────────────────────────────────
      const port = parseInt(opts.port, 10);
      const portAvailable = await checkPort(port);
      if (portAvailable) {
        pass(`Port ${port} is available`);
        passed++;
      } else {
        fail(`Port ${port} is in use`, `Try: crmy server --port ${port + 1}`);
        failed++;
      }

      // ── Check 9: JWT_SECRET strength ──────────────────────────────────────
      const jwt = config.jwtSecret ?? process.env.JWT_SECRET;
      if (jwt && !KNOWN_BAD_SECRETS.includes(jwt)) {
        pass('JWT_SECRET is set and not a known default');
        passed++;
      } else if (jwt && KNOWN_BAD_SECRETS.includes(jwt)) {
        fail('JWT_SECRET is a known default value', 'Generate a new one: openssl rand -hex 32');
        failed++;
      } else {
        fail('JWT_SECRET not configured', 'Run: crmy init');
        failed++;
      }

      // ── Check 10: Stored-secret encryption key ────────────────────────────
      const encryptionKey = config.encryptionKey ?? process.env.CRMY_ENCRYPTION_KEY ?? process.env.AGENT_ENCRYPTION_KEY;
      if (encryptionKey && !KNOWN_BAD_SECRETS.includes(encryptionKey)) {
        pass('Stored-secret encryption key is configured');
        passed++;
      } else if (encryptionKey && KNOWN_BAD_SECRETS.includes(encryptionKey)) {
        fail('Stored-secret encryption key is a known default value', 'Generate a new one: openssl rand -hex 32');
        failed++;
      } else {
        fail(
          'Stored-secret encryption key is not configured',
          'Run: crmy init, or run crmy server once to generate and save a local key',
        );
        failed++;
      }

      // ── Summary ───────────────────────────────────────────────────────────
      console.log('\n  ──────────────────────────────────────');
      if (failed === 0) {
        console.log(`  \x1b[32m${passed} checks passed\x1b[0m — everything looks good!\n`);
      } else {
        console.log(`  ${passed} passed, \x1b[31m${failed} issue(s) found\x1b[0m\n`);
      }
    });
}
