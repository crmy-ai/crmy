// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { loadConfigFile, GLOBAL_CONFIG, type CrmyConfig } from '../config.js';

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
    .description('Check your CRMy setup for common issues')
    .option('--port <port>', 'Port to check availability for', '3000')
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
        fail('No config file found', 'Run: crmy init');
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
            const { getMigrationStatus } = await import('@crmy/server/db/migrate');
            const status = await (getMigrationStatus as (db: typeof db) => Promise<{ applied: string[]; pending: string[] }>)(db);
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
                fail(`${realPending.length} pending migration(s)`, 'Run: crmy migrate');
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

          await closePool();
        } catch (err) {
          fail(`PostgreSQL unreachable: ${(err as Error).message}`, 'Check that PostgreSQL is running and DATABASE_URL is correct');
          failed++;
        }
      } else {
        fail('No DATABASE_URL configured', 'Run: crmy init');
        failed++;
      }

      // ── Check 7: Port available ───────────────────────────────────────────
      const port = parseInt(opts.port, 10);
      const portAvailable = await checkPort(port);
      if (portAvailable) {
        pass(`Port ${port} is available`);
        passed++;
      } else {
        fail(`Port ${port} is in use`, `Try: crmy server --port ${port + 1}`);
        failed++;
      }

      // ── Check 8: JWT_SECRET strength ──────────────────────────────────────
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

      // ── Summary ───────────────────────────────────────────────────────────
      console.log('\n  ──────────────────────────────────────');
      if (failed === 0) {
        console.log(`  \x1b[32m${passed} checks passed\x1b[0m — everything looks good!\n`);
      } else {
        console.log(`  ${passed} passed, \x1b[31m${failed} issue(s) found\x1b[0m\n`);
      }
    });
}
