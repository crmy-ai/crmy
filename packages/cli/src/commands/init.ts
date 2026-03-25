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
  return input.length >= 8 ? true : 'Password must be at least 8 characters';
}

export function initCommand(): Command {
  return new Command('init')
    .description('Interactive setup wizard: database, migrations, admin account')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');

      // ── Header ─────────────────────────────────────────────────────────────
      console.log('\n  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
      console.log('  \u2502         crmy.ai \u2014 Setup Wizard              \u2502');
      console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n');
      console.log('  This wizard will:\n');
      console.log('    Step 1 \u2014 Connect to your PostgreSQL database');
      console.log('    Step 2 \u2014 Create all CRMy tables (migrations)');
      console.log('    Step 3 \u2014 Create your admin account\n');

      // ── Detect existing config ──────────────────────────────────────────────
      const localConfigPath = path.join(process.cwd(), '.crmy.json');
      if (fs.existsSync(localConfigPath)) {
        console.log('  \x1b[33m\u26a0\x1b[0m  A .crmy.json already exists in this directory.\n');
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

      // ── Step 1: Database connection ─────────────────────────────────────────
      console.log('  \u2500\u2500 Step 1 of 3: Database Connection \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n');
      console.log('  Enter your PostgreSQL connection string.');
      console.log('  Format: postgresql://user:password@host:5432/dbname\n');
      console.log('  Options:');
      console.log('    \u2022 Local install:  postgresql://localhost:5432/crmy');
      console.log('    \u2022 Docker:         postgresql://postgres:postgres@localhost:5432/crmy');
      console.log('    \u2022 Supabase:       Project Settings \u2192 Database \u2192 Connection String');
      console.log('    \u2022 Neon:           Dashboard \u2192 Connection Details\n');
      console.log('  \x1b[2mNote: the wizard will retry the connection up to 5 times.\x1b[0m\n');

      const { databaseUrl } = await inquirer.prompt([
        {
          type: 'input',
          name: 'databaseUrl',
          message: '  PostgreSQL connection string:',
          default: 'postgresql://localhost:5432/crmy',
        },
      ]);

      // ── Step 2: Migrations ───────────────────────────────────────────────────
      console.log('\n  \u2500\u2500 Step 2 of 3: Database Setup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n');

      process.env.CRMY_IMPORTED = '1';

      const { initPool, closePool, runMigrations } = await import('@crmy/server');

      // DB connection
      let spinner = createSpinner('Connecting to database\u2026');
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
          '    \u2022 PostgreSQL is not running\n' +
          '    \u2022 Wrong host, port, or database name in the URL\n' +
          '    \u2022 Wrong username or password\n' +
          '    \u2022 Database does not exist \u2014 create it with:  createdb crmy\n',
        );
        process.exit(1);
      }

      // Migrations
      spinner = createSpinner('Running database migrations\u2026');
      let ran: string[] = [];

      try {
        ran = await runMigrations(db);
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
          '    \u2022 The database user lacks CREATE TABLE permissions\n' +
          '    \u2022 A previous partial migration left the schema in a bad state\n' +
          '      Try: drop and recreate the database, then run init again\n',
        );
        await closePool();
        process.exit(1);
      }

      // Seed default tenant
      spinner = createSpinner('Seeding default tenant\u2026');
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
      console.log('\n  \u2500\u2500 Step 3 of 3: Admin Account \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n');
      console.log('  Create the first admin account for the CRMy web UI and CLI.\n');
      console.log(
        '  \x1b[33mNOTE:\x1b[0m These are your \x1b[1mCRMy login credentials\x1b[0m \u2014 NOT your database credentials.\n',
      );

      const { name, email, password } = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: '  Your full name:',
        },
        {
          type: 'input',
          name: 'email',
          message: '  Email address (used to log in):',
          validate: validateEmail,
        },
        {
          type: 'password',
          name: 'password',
          message: '  Password (min 8 characters):',
          mask: '*',
          validate: validatePassword,
        },
      ]);

      spinner = createSpinner('Creating admin account\u2026');

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
        const rawKey  = 'crmy_' + crypto.randomBytes(32).toString('hex');
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

      await closePool();

      // ── Success ───────────────────────────────────────────────────────────────
      console.log('\n  \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
      console.log('  \u2502   \x1b[32m\u2713\x1b[0m  CRMy is ready!                              \u2502');
      console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n');
      console.log(`  Admin account:  ${email.trim()}`);
      console.log('  Config saved:   .crmy.json  \x1b[2m(added to .gitignore)\x1b[0m\n');
      console.log('  Next steps:\n');
      console.log('    Start the server:');
      console.log('    \x1b[1mnpx @crmy/cli server\x1b[0m\n');
      console.log('    Connect to Claude Code:');
      console.log('    \x1b[1mclaude mcp add crmy -- npx @crmy/cli mcp\x1b[0m\n');
    });
}
