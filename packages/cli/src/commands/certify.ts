// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { loadConfigFile } from '../config.js';

type DbLike = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

function parseList(value?: string): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

async function resolveTenantId(db: DbLike, requested?: string): Promise<string> {
  const lookup = requested?.trim();
  if (lookup) {
    const match = await db.query<{ id: string }>(
      'SELECT id FROM tenants WHERE id::text = $1 OR slug = $1 ORDER BY created_at DESC LIMIT 1',
      [lookup],
    );
    if (match.rows[0]?.id) return match.rows[0].id;
    throw new Error(`No tenant found for "${lookup}".`);
  }
  const fallback = await db.query<{ id: string }>('SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1');
  if (fallback.rows[0]?.id) return fallback.rows[0].id;
  throw new Error('No CRMy tenant found. Run `crmy init` first.');
}

export function certifyCommand(): Command {
  return new Command('certify')
    .description('Run the live_model eval suite and certify the configured Workspace Agent model if it passes')
    .option('--tenant <id-or-slug>', 'Tenant id or slug to certify (defaults to configured/first tenant)')
    .option('--output <dir>', 'Write eval artifacts to a directory')
    .option('--cases <file>', 'Run external live-model eval cases (JSON array or JSONL, crmy.eval_case.v1)')
    .option('--export <formats>', 'Also write eval export files (requires --output), comma-separated')
    .option('--config <path>', 'Explicit path to a .crmy.json config file')
    .option('--json', 'Print machine-readable JSON')
    .action(async (opts: {
      tenant?: string;
      output?: string;
      cases?: string;
      export?: string;
      config?: string;
      json?: boolean;
    }) => {
      const config = loadConfigFile(opts.config);
      const databaseUrl = (process.env.DATABASE_URL ?? config.database?.url)?.trim();
      if (config.jwtSecret && !process.env.JWT_SECRET) process.env.JWT_SECRET = config.jwtSecret;
      if (config.encryptionKey && !process.env.CRMY_ENCRYPTION_KEY && !process.env.AGENT_ENCRYPTION_KEY) {
        process.env.CRMY_ENCRYPTION_KEY = config.encryptionKey;
      }
      if (!databaseUrl) {
        throw new Error('No database URL configured. Run `crmy init` first, or set DATABASE_URL.');
      }

      process.env.CRMY_IMPORTED = '1';
      const { initPool, closePool, certifyTenantModel } = await import('@crmy/server');
      const db = await initPool(databaseUrl);
      try {
        const tenantId = await resolveTenantId(db as DbLike, opts.tenant ?? config.tenantId);
        const result = await certifyTenantModel({
          db,
          tenantId,
          output: opts.output,
          casesFile: opts.cases,
          exportFormats: parseList(opts.export),
        });
        if (opts.json) {
          console.log(JSON.stringify({ tenant_id: tenantId, ...result }, null, 2));
        } else {
          const run = result.run;
          const status = result.status === 'certified' ? 'CERTIFIED' : 'FAILED';
          console.log(`\n${status} ${result.model.provider} · ${result.model.model}`);
          if (run) {
            console.log(`Run: ${run.run_id} (${run.profile})`);
            console.log(`Cases: ${run.totals.cases} | passed: ${run.totals.passed} | failed: ${run.totals.failed} | errored: ${run.totals.errored} | skipped: ${run.totals.skipped}`);
          }
          console.log(`Score: ${result.score ?? 'n/a'}`);
          console.log(result.message);
          if (run?.artifacts.length) {
            console.log('\nArtifacts:');
            for (const artifact of run.artifacts) console.log(`  ${artifact}`);
          }
        }
        if (result.status !== 'certified') process.exitCode = 1;
      } finally {
        await closePool();
      }
    });
}
