// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CRMy.ai

import { Command } from 'commander';
import { createSpinner } from '../spinner.js';
import { loadConfigFile } from '../config.js';

export function seedDemoCommand(): Command {
  return new Command('seed-demo')
    .description('Seed the same lifecycle demo data used by the web app (idempotent)')
    .option('--reset', 'Remove CRMy demo records before re-seeding')
    .action(async (opts) => {
      const config = loadConfigFile();
      const databaseUrl = (config as Record<string, unknown> & { database?: { url?: string } }).database?.url ?? process.env.DATABASE_URL;
      const jwtSecret = (config as Record<string, unknown>).jwtSecret;
      const encryptionKey = (config as Record<string, unknown>).encryptionKey;
      if (typeof jwtSecret === 'string' && jwtSecret && !process.env.JWT_SECRET) process.env.JWT_SECRET = jwtSecret;
      if (typeof encryptionKey === 'string' && encryptionKey && !process.env.CRMY_ENCRYPTION_KEY && !process.env.AGENT_ENCRYPTION_KEY) {
        process.env.CRMY_ENCRYPTION_KEY = encryptionKey;
      }

      if (!databaseUrl) {
        console.error(
          '\n  Error: No database URL found.\n\n' +
          '  Run `crmy init` first or set DATABASE_URL in your environment.\n',
        );
        process.exit(1);
      }

      const spinner = createSpinner(opts.reset ? 'Resetting and seeding sample data...' : 'Seeding sample data...');

      try {
        const pgMod = await import('pg');
        const { seedSampleData, resetSampleData } = await import('@crmy/server') as unknown as {
          seedSampleData: (db: import('pg').Pool, tenantId: string) => Promise<{ counts: Record<string, number> }>;
          resetSampleData: (db: import('pg').Pool, tenantId: string, options?: { includeLegacyDemo?: boolean }) => Promise<void>;
        };
        const { Pool } = pgMod.default ?? pgMod;
        const pool = new Pool({ connectionString: databaseUrl });

        const configuredTenant = (config as Record<string, unknown>).tenantId;
        const existingSampleTenant = await pool.query(
          `SELECT t.id, t.slug
           FROM tenants t
           JOIN users u ON u.tenant_id = t.id
           WHERE u.email = 'sample.admin@crmy.local'
           ORDER BY t.slug ASC
           LIMIT 1`,
        );
        const tenantRes = existingSampleTenant.rows.length > 0
          ? existingSampleTenant
          : configuredTenant
          ? await pool.query(
            'SELECT id, slug FROM tenants WHERE id::text = $1 OR slug = $1 ORDER BY created_at DESC LIMIT 1',
            [String(configuredTenant)],
          )
          : await pool.query('SELECT id, slug FROM tenants ORDER BY slug ASC LIMIT 1');
        if (tenantRes.rows.length === 0) {
          spinner.fail('No tenant found');
          console.error(
            configuredTenant
              ? `\n  No tenant matched "${configuredTenant}". Run \`crmy doctor\` or update ~/.crmy/config.json.\n`
              : '\n  Run `crmy init` first to create the database schema.\n',
          );
          await pool.end();
          process.exit(1);
        }
        const tenantId: string = tenantRes.rows[0].id;

        if (opts.reset) {
          await resetSampleData(pool, tenantId, { includeLegacyDemo: true });
        }

        const status = await seedSampleData(pool, tenantId);
        await pool.end();

        spinner.succeed('Sample data ready');
        const counts = status.counts;
        console.log(`  ${counts.accounts} accounts · ${counts.contacts} contacts · ${counts.opportunities} opportunities`);
        console.log(`  ${counts.sources} Sources · ${counts.signals} Signals · ${counts.signal_groups} reviewable Signal sets · ${counts.memory} Memory entries · ${counts.handoffs} Handoffs`);
        console.log('');
        console.log('Try it:');
        console.log('  crmy briefing "contact:Maya Patel"');
        console.log('  crmy briefing "account:Northstar Labs"');
        console.log('  crmy action-context "account:Northstar Labs" --action customer_outreach');
        console.log('  crmy context signal-groups');
        console.log('  crmy context lineage --subject "account:Northstar Labs"');
        console.log('  crmy hitl list');
        console.log('');
        console.log('Sample logins:');
        console.log('  sample.admin@crmy.local / crmy-demo-123  (admin view)');
        console.log('  sample.rep@crmy.local / crmy-demo-123    (scoped rep view)');
        console.log('');
      } catch (err) {
        spinner.fail('Failed to seed sample data');
        console.error(`\n  Error: ${(err as Error).message}\n`);
        process.exit(1);
      }
    });
}
