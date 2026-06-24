// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { createSpinner } from '../spinner.js';
import { loadConfigFile } from '../config.js';
import { runAgentSmoke } from './agent-smoke.js';

const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const DOCKER_HINT = [
  '  Start PostgreSQL, then re-run quickstart:',
  '',
  `  ${DIM}docker run --name crmy-postgres \\${RESET}`,
  `  ${DIM}  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=crmy \\${RESET}`,
  `  ${DIM}  -p 5432:5432 -d pgvector/pgvector:pg16${RESET}`,
  '',
  `  ${DIM}export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crmy${RESET}`,
].join('\n');

function printNeedsDatabase(): void {
  console.log(`\n  ${BOLD}No database configured.${RESET}\n`);
  console.log(DOCKER_HINT);
  console.log(`\n  Then run ${CYAN}crmy init --demo${RESET} once to create the workspace, and ${CYAN}crmy quickstart${RESET} again.\n`);
}

function printDbUnreachable(message: string): void {
  console.log(`\n  ${BOLD}Could not reach PostgreSQL.${RESET} ${DIM}(${message})${RESET}\n`);
  console.log(DOCKER_HINT);
  console.log('');
}

function printNeedsInit(): void {
  console.log(`\n  ${BOLD}No CRMy workspace found yet.${RESET}\n`);
  console.log(`  Run ${CYAN}crmy init --demo${RESET} once (creates the schema, owner, and keys), then ${CYAN}crmy quickstart${RESET}.\n`);
}

/** True when a Workspace Agent model is configured for live extraction. */
async function detectModelConfigured(pool: import('pg').Pool, tenantId: string): Promise<boolean> {
  try {
    const res = await pool.query<{ enabled: boolean; model: string | null; base_url: string | null }>(
      'SELECT enabled, model, base_url FROM agent_configs WHERE tenant_id = $1 LIMIT 1',
      [tenantId],
    );
    const row = res.rows[0];
    return Boolean(row?.enabled && row.model && row.base_url);
  } catch {
    return false;
  }
}

/** Resolve the demo tenant the same way seed-demo does. */
async function resolveTenantId(pool: import('pg').Pool, configuredTenant: unknown): Promise<string | null> {
  const sampleTenant = await pool.query(
    `SELECT t.id FROM tenants t
     JOIN users u ON u.tenant_id = t.id
     WHERE u.email = 'sample.admin@crmy.local'
     ORDER BY t.slug ASC LIMIT 1`,
  );
  if (sampleTenant.rows.length > 0) return sampleTenant.rows[0].id;
  const fallback = configuredTenant
    ? await pool.query('SELECT id FROM tenants WHERE id::text = $1 OR slug = $1 ORDER BY created_at DESC LIMIT 1', [String(configuredTenant)])
    : await pool.query('SELECT id FROM tenants ORDER BY slug ASC LIMIT 1');
  return fallback.rows.length > 0 ? fallback.rows[0].id : null;
}

function printNextSteps(account: string, modelConfigured: boolean, withModel: boolean): void {
  console.log(`\n  ${BOLD}That briefing came from messy context — with no CRM connector configured.${RESET}`);
  console.log(`  ${DIM}Signals, Memory, Action Context, and lineage are all from local seeded transcripts/notes.${RESET}\n`);
  console.log(`  ${BOLD}Next:${RESET}\n`);
  console.log(`  ${GREEN}1.${RESET} Connect an agent over MCP:`);
  console.log(`     ${CYAN}claude mcp add crmy -- npx -y @crmy/cli mcp${RESET}`);
  console.log(`     ${DIM}codex mcp add crmy -- npx -y @crmy/cli mcp${RESET}\n`);
  console.log(`  ${GREEN}2.${RESET} Open the web app:`);
  console.log(`     ${CYAN}crmy server${RESET}  ${DIM}→ http://localhost:3000/app${RESET}\n`);
  console.log(`  ${GREEN}3.${RESET} Drop in your own customer context (still no connector):`);
  console.log(`     ${CYAN}crmy context ingest --subject "account:${account}" --file ./call-notes.txt${RESET}`);
  if (!modelConfigured) {
    console.log(`     ${DIM}Configure a Workspace Agent model in Settings to extract Signals from it automatically.${RESET}`);
  } else if (!withModel) {
    console.log(`     ${DIM}A model is configured — re-run with ${RESET}${CYAN}--with-model${RESET}${DIM} to watch live transcript → Signal extraction.${RESET}`);
  }
  console.log('');
  console.log(`  ${DIM}Optional later: connect a CRM or warehouse as a system of record — see \`crmy systems --help\`.${RESET}\n`);
}

export function quickstartCommand(): Command {
  return new Command('quickstart')
    .description('Connector-free first run: seed demo context and show CRMy giving an agent a governed briefing — no CRM connector required')
    .option('--account <name>', 'Demo account to brief', 'Northstar Labs')
    .option('--no-seed', 'Skip demo data seeding (assume the workspace is already seeded)')
    .option('--with-model', 'Also run a live model-backed extraction pass (requires a configured Workspace Agent model)')
    .option('--config <path>', 'Explicit path to a .crmy.json config file')
    .option('--json', 'Print machine-readable JSON')
    .action(async (opts) => {
      const json = Boolean(opts.json);
      const account = (opts.account as string | undefined)?.trim() || 'Northstar Labs';
      const config = loadConfigFile(opts.config as string | undefined) as Record<string, unknown> & {
        database?: { url?: string };
        tenantId?: string;
        jwtSecret?: string;
        encryptionKey?: string;
      };
      // Trim defensively: config files occasionally carry a stray leading/trailing
      // space in the URL, which the pg driver misparses into an unreachable host.
      const databaseUrl = (config.database?.url ?? process.env.DATABASE_URL)?.trim();
      if (typeof config.jwtSecret === 'string' && config.jwtSecret && !process.env.JWT_SECRET) {
        process.env.JWT_SECRET = config.jwtSecret;
      }
      if (typeof config.encryptionKey === 'string' && config.encryptionKey
        && !process.env.CRMY_ENCRYPTION_KEY && !process.env.AGENT_ENCRYPTION_KEY) {
        process.env.CRMY_ENCRYPTION_KEY = config.encryptionKey;
      }

      if (!databaseUrl) {
        if (!json) printNeedsDatabase();
        else console.log(JSON.stringify({ ok: false, error: 'no_database_url' }));
        process.exit(1);
      }

      if (!json) {
        console.log(`\n  ${BOLD}CRMy quickstart${RESET} ${DIM}— customer context for agents, no connector required${RESET}\n`);
      }

      const pgMod = await import('pg');
      const { Pool } = pgMod.default ?? pgMod;
      const pool = new Pool({ connectionString: databaseUrl });
      const spinner = json ? null : createSpinner('Preparing connector-free demo workspace...');
      let tenantId: string;
      let modelConfigured = false;

      try {
        await pool.query('SELECT 1');
        const resolved = await resolveTenantId(pool, config.tenantId);
        if (!resolved) {
          spinner?.fail('No CRMy workspace found');
          if (!json) printNeedsInit();
          else console.log(JSON.stringify({ ok: false, error: 'no_workspace' }));
          await pool.end().catch(() => {});
          process.exit(1);
        }
        tenantId = resolved;

        if (opts.seed !== false) {
          const { seedSampleData } = await import('@crmy/server') as unknown as {
            seedSampleData: (db: import('pg').Pool, tenantId: string) => Promise<{ counts: Record<string, number> }>;
          };
          const seeded = await seedSampleData(pool, tenantId);
          const c = seeded.counts;
          spinner?.succeed(`Demo workspace ready — ${c.accounts} accounts · ${c.signals} Signals · ${c.memory} Memory (no connector configured)`);
        } else {
          spinner?.succeed('Demo workspace ready (no connector configured)');
        }

        modelConfigured = await detectModelConfigured(pool, tenantId);
      } catch (err) {
        spinner?.fail('Could not reach PostgreSQL');
        if (!json) printDbUnreachable((err as Error).message);
        else console.log(JSON.stringify({ ok: false, error: 'db_unreachable', message: (err as Error).message }));
        await pool.end().catch(() => {});
        process.exit(1);
      }
      await pool.end().catch(() => {});

      // Connector-free golden path: resolve → briefing → Action Context → Signals → lineage.
      // Live model extraction is opt-in: it is a bonus, not the connector-free value,
      // and keeping it off by default makes quickstart deterministic and safe to re-run.
      const withModel = Boolean(opts.withModel) && modelConfigured;
      const result = await runAgentSmoke({ account, withModel, config: opts.config as string | undefined, json });

      // Exit on the connector-free core path; an optional model hiccup must not mask success.
      const CORE_CHECKS = ['customer_record_resolve', 'briefing_get', 'action_context_get', 'context_lineage_get'];
      const coreOk = result.checks
        .filter(check => CORE_CHECKS.includes(check.name))
        .every(check => check.ok);

      if (!json) printNextSteps(account, modelConfigured, withModel);
      process.exit(coreOk ? 0 : 1);
    });
}
