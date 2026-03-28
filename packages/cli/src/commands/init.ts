// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createSpinner } from '../spinner.js';
import { saveConfigFile } from '../config.js';

// ── Input validators ───────────────────────────────────────────────────────────
function validateEmail(input: string): boolean | string {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim())
    ? true
    : 'Please enter a valid email address (e.g. you@example.com)';
}

function validatePassword(input: string): boolean | string {
  return input.length >= 12 ? true : 'Password must be at least 12 characters';
}

/**
 * Try to connect to the PostgreSQL maintenance database (usually `postgres`) to
 * check whether the target database exists. If it doesn't, offer to create it.
 * Returns the (possibly newly-created) database URL to use going forward.
 */
async function ensureDatabaseExists(
  databaseUrl: string,
  interactive: boolean,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return; // Can't parse — let the normal connection flow handle the error
  }

  const dbName = parsed.pathname.replace(/^\//, '');
  if (!dbName) return; // No DB name in URL — let initPool handle it

  // Only attempt the pre-check for local / standard PostgreSQL URLs.
  // Cloud providers (Supabase, Neon) provision the DB automatically.
  const isLocal =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1';
  if (!isLocal) return;

  // Connect to the `postgres` maintenance database
  const maintUrl = new URL(databaseUrl);
  maintUrl.pathname = '/postgres';
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: maintUrl.toString() });

  try {
    await client.connect();
  } catch {
    // Can't even reach PostgreSQL — let the normal flow give the full error
    return;
  }

  try {
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );

    if (result.rows.length > 0) return; // DB exists

    // DB doesn't exist — offer to create it
    if (interactive) {
      const { default: inquirer } = await import('inquirer');
      console.log(`\n  \x1b[33m⚠\x1b[0m  Database \x1b[1m${dbName}\x1b[0m does not exist.\n`);
      const { create } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'create',
          message: `  Create database "${dbName}" now?`,
          default: true,
        },
      ]);
      if (!create) {
        console.log(`\n  Create it manually:  createdb ${dbName}\n`);
        process.exit(1);
      }
    }

    // Create the database (works for both interactive "yes" and --yes mode)
    const spinner = createSpinner(`Creating database "${dbName}"…`);
    try {
      await client.query(`CREATE DATABASE "${dbName}"`);
      spinner.succeed(`Database "${dbName}" created`);
    } catch (err) {
      spinner.fail(`Failed to create database "${dbName}"`);
      console.error(`\n  Error: ${(err as Error).message}`);
      console.error(`  Create it manually:  createdb ${dbName}\n`);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

export function initCommand(): Command {
  return new Command('init')
    .description('Interactive setup wizard: database, migrations, admin account')
    .option('-y, --yes', 'Accept defaults non-interactively (requires CRMY_ADMIN_EMAIL + CRMY_ADMIN_PASSWORD env vars)')
    .action(async (opts) => {
      const yesMode = !!opts.yes;
      const { default: inquirer } = await import('inquirer');

      // ── Header ─────────────────────────────────────────────────────────────
      console.log('\n  ┌─────────────────────────────────────────────┐');
      console.log('  │         crmy.ai — Setup Wizard              │');
      console.log('  └─────────────────────────────────────────────┘\n');
      console.log('  This wizard will:\n');
      console.log('    Step 1 — Connect to your PostgreSQL database');
      console.log('    Step 2 — Create all CRMy tables (migrations)');
      console.log('    Step 3 — Create your admin account\n');

      // ── Detect existing config ──────────────────────────────────────────────
      const localConfigPath = path.join(process.cwd(), '.crmy.json');
      if (fs.existsSync(localConfigPath)) {
        if (yesMode) {
          console.log('  \x1b[33m⚠\x1b[0m  Overwriting existing .crmy.json (--yes mode)\n');
        } else {
          console.log('  \x1b[33m⚠\x1b[0m  A .crmy.json already exists in this directory.\n');
          const { overwrite } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'overwrite',
              message: '  Overwrite it and run setup again?',
              default: false,
            },
          ]);
          if (!overwrite) {
            console.log('\n  Setup cancelled. Your existing config was not changed.\n');
            process.exit(0);
          }
          console.log('');
        }
      }

      // ── Step 1: Database connection ─────────────────────────────────────────
      console.log('  ── Step 1 of 3: Database Connection ──────────────────\n');

      let databaseUrl: string;

      if (yesMode) {
        databaseUrl = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/crmy';
        console.log(`  Using database URL: ${databaseUrl}\n`);
      } else {
        console.log('  Enter your PostgreSQL connection string.');
        console.log('  Format: postgresql://user:password@host:5432/dbname\n');
        console.log('  Options:');
        console.log('    • Local install:  postgresql://localhost:5432/crmy');
        console.log('    • Docker:         postgresql://postgres:postgres@localhost:5432/crmy');
        console.log('    • Supabase:       Project Settings → Database → Connection String');
        console.log('    • Neon:           Dashboard → Connection Details\n');
        console.log('  \x1b[2mNote: the wizard will retry the connection up to 5 times.\x1b[0m\n');

        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'databaseUrl',
            message: '  PostgreSQL connection string:',
            default: 'postgresql://localhost:5432/crmy',
          },
        ]);
        databaseUrl = answers.databaseUrl;
      }

      // ── Pre-check: does the database exist? ─────────────────────────────────
      const isInteractive = process.stdin.isTTY !== false && !yesMode;
      await ensureDatabaseExists(databaseUrl, isInteractive);

      // ── Step 2: Migrations ───────────────────────────────────────────────────
      console.log('\n  ── Step 2 of 3: Database Setup ──────────────────────\n');

      process.env.CRMY_IMPORTED = '1';

      const { initPool, closePool, runMigrations } = await import('@crmy/server');

      // DB connection
      let spinner = createSpinner('Connecting to database…');
      let db: Awaited<ReturnType<typeof initPool>>;

      try {
        db = await initPool(databaseUrl);
        spinner.succeed('Connected to database');
      } catch (err) {
        spinner.fail('Database connection failed');
        const msg = (err as Error).message ?? String(err);
        console.error(
          `\n  Error: ${msg}\n\n` +
          '  Common causes:\n' +
          '    • PostgreSQL is not running\n' +
          '    • Wrong host, port, or database name in the URL\n' +
          '    • Wrong username or password\n' +
          '    • Database does not exist — create it with:  createdb crmy\n',
        );
        process.exit(1);
      }

      // Migrations (with per-file progress)
      spinner = createSpinner('Running database migrations…');
      let ran: string[] = [];

      try {
        ran = await runMigrations(db, (name, index, total) => {
          spinner.update(`Running migration ${index + 1}/${total}: ${name}…`);
        });
        if (ran.length > 0) {
          spinner.succeed(`Migrations complete  \x1b[2m(${ran.length} applied)\x1b[0m`);
        } else {
          spinner.succeed('Migrations complete  \x1b[2m(already up to date)\x1b[0m');
        }
      } catch (err) {
        spinner.fail('Migration failed');
        const msg = (err as Error).message ?? String(err);
        console.error(
          `\n  SQL error: ${msg}\n\n` +
          '  This may mean:\n' +
          '    • The database user lacks CREATE TABLE permissions\n' +
          '    • A previous partial migration left the schema in a bad state\n' +
          '      Try: drop and recreate the database, then run init again\n',
        );
        await closePool();
        process.exit(1);
      }

      // ── Optional: pgvector semantic search ──────────────────────────────────
      if (process.env.ENABLE_PGVECTOR !== 'true' && !yesMode && isInteractive) {
        console.log('');
        const { enablePgvector } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'enablePgvector',
            message: '  Enable semantic search? (requires pgvector extension in PostgreSQL)',
            default: false,
          },
        ]);
        if (enablePgvector) {
          process.env.ENABLE_PGVECTOR = 'true';
          spinner = createSpinner('Running pgvector migration…');
          try {
            const pgRan = await runMigrations(db);
            if (pgRan.length > 0) {
              spinner.succeed('Semantic search enabled  \x1b[2m(pgvector)\x1b[0m');
            } else {
              spinner.succeed('Semantic search  \x1b[2m(already enabled)\x1b[0m');
            }
          } catch (err) {
            spinner.fail('pgvector migration failed');
            console.log(
              `\n  \x1b[33m⚠\x1b[0m  ${(err as Error).message}` +
              '\n  This is non-fatal — CRMy works without semantic search.' +
              '\n  You can enable it later by setting ENABLE_PGVECTOR=true and running: crmy migrate\n',
            );
          }
        }
      }

      // Seed default tenant
      spinner = createSpinner('Seeding default tenant…');
      let tenantId: string;

      try {
        const result = await db.query(
          `INSERT INTO tenants (slug, name) VALUES ('default', 'Default Tenant')
           ON CONFLICT (slug) DO UPDATE SET name = 'Default Tenant'
           RETURNING id`,
        );
        tenantId = result.rows[0].id;
        spinner.succeed('Default tenant ready');
      } catch (err) {
        spinner.fail('Failed to seed tenant');
        console.error(`\n  Error: ${(err as Error).message}\n`);
        await closePool();
        process.exit(1);
      }

      // ── Step 3: Admin account ────────────────────────────────────────────────
      console.log('\n  ── Step 3 of 3: Admin Account ──────────────────────\n');

      // Support non-interactive (CI / Docker) via env vars
      const envEmail    = process.env.CRMY_ADMIN_EMAIL;
      const envPassword = process.env.CRMY_ADMIN_PASSWORD;
      const envName     = process.env.CRMY_ADMIN_NAME;
      const useEnvVars  = yesMode || !isInteractive || !!envEmail;

      let name: string;
      let email: string;
      let password: string;

      if (!useEnvVars) {
        console.log('  Create the first admin account for the CRMy web UI and CLI.\n');
        console.log(
          '  \x1b[33mNOTE:\x1b[0m These are your \x1b[1mCRMy login credentials\x1b[0m — NOT your database credentials.\n',
        );

        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: '  Your full name:',
          },
          {
            type: 'input',
            name: 'email',
            message: '  Admin email:',
            validate: validateEmail,
          },
          {
            type: 'password',
            name: 'password',
            message: '  Admin password (min 12 chars):',
            mask: '*',
            validate: validatePassword,
          },
          {
            type: 'password',
            name: 'confirmPassword',
            message: '  Confirm password:',
            mask: '*',
            validate: (input: string, answers: Record<string, string> | undefined) =>
              input === answers?.password ? true : 'Passwords do not match',
          },
        ]);
        name = answers.name;
        email = answers.email;
        password = answers.password;
      } else {
        // Non-interactive: require env vars
        if (!envEmail || !envPassword) {
          console.error(
            '\n  Error: Non-interactive environment detected.\n\n' +
            '  Set CRMY_ADMIN_EMAIL and CRMY_ADMIN_PASSWORD environment variables\n' +
            '  to create the admin account without interactive prompts.\n' +
            '  (Also required when using --yes flag)\n',
          );
          await closePool();
          process.exit(1);
        }
        const emailValid = validateEmail(envEmail);
        if (emailValid !== true) {
          console.error(`\n  Error: CRMY_ADMIN_EMAIL is invalid — ${emailValid}\n`);
          await closePool();
          process.exit(1);
        }
        const pwValid = validatePassword(envPassword);
        if (pwValid !== true) {
          console.error(`\n  Error: CRMY_ADMIN_PASSWORD is invalid — ${pwValid}\n`);
          await closePool();
          process.exit(1);
        }
        name = envName ?? 'Admin';
        email = envEmail;
        password = envPassword;
        console.log('  Creating admin account from environment variables…\n');
      }

      spinner = createSpinner('Creating admin account…');

      let rawKey = '';

      try {
        // scrypt — same params as auth/routes.ts so passwords are portable
        const salt = crypto.randomBytes(16);
        const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
        const passwordHash = `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
        const userResult = await db.query(
          `INSERT INTO users (tenant_id, email, name, role, password_hash)
           VALUES ($1, $2, $3, 'owner', $4)
           ON CONFLICT (tenant_id, email) DO UPDATE SET name = $3, password_hash = $4
           RETURNING id`,
          [tenantId, email.trim(), name, passwordHash],
        );
        const userId = userResult.rows[0].id;

        // Generate API key
        rawKey  = 'crmy_' + crypto.randomBytes(32).toString('hex');
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        await db.query(
          `INSERT INTO api_keys (tenant_id, user_id, key_hash, label, scopes)
           VALUES ($1, $2, $3, 'default', '{read,write,admin}')`,
          [tenantId, userId, keyHash],
        );

        spinner.succeed('Admin account created');

        // Generate JWT secret + write config
        const jwtSecret = crypto.randomBytes(32).toString('hex');
        const crmmyConfig = {
          serverUrl: 'http://localhost:3000',
          apiKey: rawKey,
          tenantId: 'default',
          database: { url: databaseUrl },
          jwtSecret,
          hitl: {
            requireApproval: ['bulk_update', 'bulk_delete', 'send_email'],
            autoApproveSeconds: 0,
          },
        };

        // Write to ~/.crmy/config.json (global) + process.cwd()/.crmy.json (local)
        saveConfigFile(crmmyConfig);

        // Add local .crmy.json to .gitignore
        const gitignorePath    = path.join(process.cwd(), '.gitignore');
        const gitignoreContent = fs.existsSync(gitignorePath)
          ? fs.readFileSync(gitignorePath, 'utf-8')
          : '';
        if (!gitignoreContent.includes('.crmy.json')) {
          fs.appendFileSync(gitignorePath, '\n.crmy.json\n');
        }
      } catch (err) {
        spinner.fail('Failed to create admin account');
        console.error(`\n  Error: ${(err as Error).message}\n`);
        await closePool();
        process.exit(1);
      }

      // ── Demo data prompt ──────────────────────────────────────────────────────
      let seedDemo = yesMode; // --yes mode auto-seeds demo data
      if (!yesMode && isInteractive) {
        const { loadDemo } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'loadDemo',
            message: '  Load demo data to explore CRMy?',
            default: true,
          },
        ]);
        seedDemo = loadDemo;
      }

      if (seedDemo) {
        console.log('');
        spinner = createSpinner('Seeding demo data…');
        try {
          // Import seedDemoData directly from @crmy/server — no fragile path resolution
          const serverModule = await import('@crmy/server');
          // seedDemoData is an internal function; we use the same inline approach
          // as the server's Docker-path seeder to avoid subprocess issues
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
          if (check.rows.length === 0) {
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

          spinner.succeed('Demo data seeded  \x1b[2m(3 accounts, 6 contacts, 3 opportunities)\x1b[0m');
        } catch {
          spinner.fail('Demo data seeding failed');
          console.log('  \x1b[33m⚠\x1b[0m  You can run it later with: crmy seed-demo\n');
        }
      }

      await closePool();

      // ── Success ───────────────────────────────────────────────────────────────
      const keyPreview = rawKey.substring(0, 16) + '…';
      console.log('\n  ┌───────────────────────────────────────────────────┐');
      console.log('  │   \x1b[32m✓\x1b[0m  CRMy is ready!                              │');
      console.log('  └───────────────────────────────────────────────────┘\n');
      console.log(`  Admin account:  ${email.trim()}`);
      console.log(`  API key:        ${keyPreview}  \x1b[2m(full key in .crmy.json)\x1b[0m`);
      console.log('  Config saved:   .crmy.json  \x1b[2m(added to .gitignore)\x1b[0m\n');
      console.log('  Next steps:\n');
      console.log('    Start the server:');
      console.log('    \x1b[1mnpx @crmy/cli server\x1b[0m\n');
      console.log('    Connect to Claude Code:');
      console.log('    \x1b[1mclaude mcp add crmy -- npx @crmy/cli mcp\x1b[0m\n');
    });
}
