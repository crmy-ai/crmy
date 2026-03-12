// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function initCommand(): Command {
  return new Command('init')
    .description('Initialize crmy.ai: configure database, run migrations, create user')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');

      console.log('\n  crmy.ai — Agent-first CRM setup\n');

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'databaseUrl',
          message: 'PostgreSQL URL?',
          default: 'postgresql://localhost:5432/crmy',
        },
        {
          type: 'input',
          name: 'name',
          message: 'Your name?',
        },
        {
          type: 'input',
          name: 'email',
          message: 'Your email?',
        },
        {
          type: 'password',
          name: 'password',
          message: 'Password?',
          mask: '*',
        },
      ]);

      process.env.CRMY_IMPORTED = '1';

      try {
        // Import server modules
        const { initPool, closePool } = await import('@crmy/server');
        const { runMigrations } = await import('@crmy/server');

        console.log('\nConnecting to database...');
        const db = await initPool(answers.databaseUrl);
        console.log('Connected.');

        console.log('Running migrations...');
        const ran = await runMigrations(db);
        if (ran.length > 0) {
          console.log(`  Ran ${ran.length} migration(s): ${ran.join(', ')}`);
        } else {
          console.log('  No pending migrations.');
        }

        // Seed tenant
        const tenantResult = await db.query(
          `INSERT INTO tenants (slug, name) VALUES ('default', 'Default Tenant')
           ON CONFLICT (slug) DO UPDATE SET name = 'Default Tenant'
           RETURNING id`,
        );
        const tenantId = tenantResult.rows[0].id;

        // Create user
        const passwordHash = crypto.createHash('sha256').update(answers.password).digest('hex');
        const userResult = await db.query(
          `INSERT INTO users (tenant_id, email, name, role, password_hash)
           VALUES ($1, $2, $3, 'owner', $4)
           ON CONFLICT (tenant_id, email) DO UPDATE SET name = $3, password_hash = $4
           RETURNING id`,
          [tenantId, answers.email, answers.name, passwordHash],
        );
        const userId = userResult.rows[0].id;

        // Generate API key
        const rawKey = 'crmy_' + crypto.randomBytes(32).toString('hex');
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        await db.query(
          `INSERT INTO api_keys (tenant_id, user_id, key_hash, label, scopes)
           VALUES ($1, $2, $3, 'default', '{read,write,admin}')`,
          [tenantId, userId, keyHash],
        );

        // Generate JWT secret
        const jwtSecret = crypto.randomBytes(32).toString('hex');

        // Write config
        const config = {
          serverUrl: 'http://localhost:3000',
          apiKey: rawKey,
          tenantId: 'default',
          database: {
            url: answers.databaseUrl,
          },
          jwtSecret,
          hitl: {
            requireApproval: ['bulk_update', 'bulk_delete', 'send_email'],
            autoApproveSeconds: 0,
          },
        };

        const configPath = path.join(process.cwd(), '.crmy.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

        // Add to .gitignore
        const gitignorePath = path.join(process.cwd(), '.gitignore');
        const gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
        if (!gitignoreContent.includes('.crmy.json')) {
          fs.appendFileSync(gitignorePath, '\n.crmy.json\n');
        }

        await closePool();

        console.log('\n  ✓ crmy.ai initialized\n');
        console.log('  Add to Claude Code:');
        console.log('  claude mcp add crmy -- npx crmy mcp\n');
        console.log('  Or start the server:');
        console.log('  npx crmy server\n');
      } catch (err) {
        console.error('\nSetup failed:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
