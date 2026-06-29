// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createSpinner } from '../spinner.js';
import { saveConfigFile } from '../config.js';
import { providerModelsFromCatalog } from '../model-catalog.js';
import {
  CUSTOM_MODEL_SENTINEL,
  PRECERTIFIED_MODEL_REGISTRY,
  PROVIDERS,
  getProvider,
  getProviderDefaultModel,
  isProviderId,
  precertifiedCertificationForModel,
  type ProviderId,
} from '@crmy/shared';

const CERTIFY_OUTPUT_DIR = './eval-runs';

// ── Input validators ───────────────────────────────────────────────────────────
function validateEmail(input: string): boolean | string {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim())
    ? true
    : 'Please enter a valid email address (e.g. you@example.com)';
}

function validatePassword(input: string): boolean | string {
  return input.length >= 12 ? true : 'Password must be at least 12 characters';
}

function maskDatabaseUrl(value: string): string {
  let redacted = value;
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = '***';
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/pass|password|token|secret|key/i.test(key)) {
        parsed.searchParams.set(key, '***');
      }
    }
    redacted = parsed.toString();
  } catch {
    // Error strings often include the URL inside a longer sentence.
  }

  return redacted
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+):([^@\s]+)@/gi, '$1:***@')
    .replace(/([?&](?:pass|password|token|secret|key)=)[^&\s]+/gi, '$1***');
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

type DbLike = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

interface AgentSetupConfig {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

interface OllamaStatus {
  available: boolean;
  models: string[];
}

async function detectOllamaModels(baseUrl = 'http://localhost:11434'): Promise<OllamaStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: controller.signal });
    if (!res.ok) return { available: false, models: [] };
    const json = await res.json().catch(() => null) as { models?: Array<{ name?: string }> } | null;
    const models = (json?.models ?? [])
      .map(model => model.name)
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b));
    return { available: true, models };
  } catch {
    return { available: false, models: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function preferredOllamaModel(installedModels: string[]): string {
  const preferred = providerModelsFromCatalog('ollama').map(model => model.id);
  return preferred.find(model => installedModels.includes(model)) ?? installedModels[0] ?? getProviderDefaultModel('ollama');
}

function uniqueProviderChoices(...groups: ProviderId[][]): ProviderId[] {
  const seen = new Set<ProviderId>();
  const choices: ProviderId[] = [];
  for (const group of groups) {
    for (const provider of group) {
      if (seen.has(provider)) continue;
      seen.add(provider);
      choices.push(provider);
    }
  }
  return choices;
}

function precertifiedProviderChoices(): ProviderId[] {
  return uniqueProviderChoices(
    PRECERTIFIED_MODEL_REGISTRY.map(entry => entry.provider),
    PROVIDERS.map(provider => provider.id).filter(id => id !== 'ollama' && id !== 'custom'),
  );
}

async function promptForModel(
  inquirer: typeof import('inquirer').default,
  provider: ProviderId,
  extraModels: string[] = [],
): Promise<string> {
  const providerDef = getProvider(provider);
  const providerModels = providerModelsFromCatalog(provider);
  const choices = new Map<string, { name: string; value: string }>();

  for (const model of extraModels) {
    choices.set(model, { name: `${model} (installed locally)`, value: model });
  }
  for (const model of providerModels) {
    if (!choices.has(model.id)) {
      choices.set(model.id, { name: `${model.label} (${model.id})`, value: model.id });
    }
  }

  if (choices.size > 0) {
    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: '  Model:',
        default: extraModels[0] ?? getProviderDefaultModel(provider) ?? CUSTOM_MODEL_SENTINEL,
        choices: [
          ...Array.from(choices.values()),
          { name: 'Custom model ID...', value: CUSTOM_MODEL_SENTINEL },
        ],
      },
    ]);
    if (selected !== CUSTOM_MODEL_SENTINEL) return selected;
  }

  const { customModel } = await inquirer.prompt([
    {
      type: 'input',
      name: 'customModel',
      message: '  Model ID:',
      validate: (value: string) => value.trim() ? true : 'Enter a model ID',
    },
  ]);
  return customModel.trim();
}

async function promptForProviderSetup(
  inquirer: typeof import('inquirer').default,
  providerChoices: ProviderId[],
  options: {
    intro?: string;
    configureMessage?: string;
    defaultProvider?: ProviderId;
  } = {},
): Promise<AgentSetupConfig | null> {
  if (options.intro) console.log(options.intro);
  const { configure } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configure',
      message: options.configureMessage ?? '  Configure a Workspace Agent model now?',
      default: true,
    },
  ]);
  if (!configure) return null;

  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: '  Provider:',
      default: options.defaultProvider ?? providerChoices[0],
      choices: providerChoices.map(id => {
        const providerDef = getProvider(id);
        return { name: providerDef.label, value: id };
      }),
    },
  ]);
  const providerId = provider as ProviderId;
  const providerDef = getProvider(providerId);

  const { baseUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'baseUrl',
      message: '  Base URL:',
      default: providerDef.baseUrl,
      validate: (value: string) => value.trim() ? true : 'Enter a base URL',
    },
  ]);

  const model = await promptForModel(inquirer, providerId);
  let apiKey = '';
  if (providerDef.requiresKey) {
    const answer = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: '  API key:',
        mask: '*',
        validate: (value: string) => value.trim() ? true : `${providerDef.label} requires an API key`,
      },
    ]);
    apiKey = answer.apiKey.trim();
  } else if (providerId !== 'ollama') {
    const answer = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: `  ${providerDef.keyLabel} (optional; leave blank if this endpoint does not require one):`,
        mask: '*',
      },
    ]);
    apiKey = answer.apiKey.trim();
  }

  return {
    provider: providerId,
    baseUrl: String(baseUrl).trim(),
    model,
    apiKey: apiKey || undefined,
  };
}

async function chooseAgentSetup(
  inquirer: typeof import('inquirer').default,
  yesMode: boolean,
  isInteractive: boolean,
  demoMode: boolean,
): Promise<AgentSetupConfig | null> {
  if (process.env.CRMY_AGENT_ENABLED === 'false') return null;

  const envProvider = process.env.CRMY_AGENT_PROVIDER;
  const envModel = process.env.CRMY_AGENT_MODEL;
  if (envProvider || envModel) {
    const provider = isProviderId(envProvider ?? '') ? envProvider as ProviderId : 'custom';
    const providerDef = getProvider(provider);
    if (!envModel?.trim()) {
      throw new Error('CRMY_AGENT_MODEL is required when configuring CRMY_AGENT_PROVIDER during init.');
    }
    if (providerDef.requiresKey && !process.env.CRMY_AGENT_API_KEY?.trim()) {
      throw new Error(`CRMY_AGENT_API_KEY is required for ${providerDef.label}.`);
    }
    return {
      provider,
      baseUrl: process.env.CRMY_AGENT_BASE_URL?.trim() || providerDef.baseUrl,
      model: envModel.trim(),
      apiKey: process.env.CRMY_AGENT_API_KEY?.trim() || undefined,
    };
  }

  const ollama = await detectOllamaModels();
  if (yesMode || !isInteractive) {
    if (ollama.available && ollama.models.length > 0) {
      return {
        provider: 'ollama',
        baseUrl: getProvider('ollama').baseUrl,
        model: preferredOllamaModel(ollama.models),
      };
    }
    return null;
  }

  if (demoMode) {
    const providerChoices = uniqueProviderChoices(
      precertifiedProviderChoices(),
      ollama.available ? ['ollama'] : [],
      ['custom'],
    );
    return promptForProviderSetup(
      inquirer,
      providerChoices,
      {
        intro: '  For the full automatic Memory demo, choose a CRMy pre-certified hosted model. Local or custom models still work in review mode until certification passes.',
        configureMessage: '  Configure a Workspace Agent model for the demo now?',
        defaultProvider: PRECERTIFIED_MODEL_REGISTRY[0]?.provider,
      },
    );
  }

  if (ollama.available) {
    console.log(ollama.models.length > 0
      ? `  Ollama detected with ${ollama.models.length} installed model(s).`
      : '  Ollama detected, but no installed models were reported.');
    const { useOllama } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useOllama',
        message: '  Use local Ollama for the Workspace Agent?',
        default: ollama.models.length > 0,
      },
    ]);
    if (useOllama) {
      const model = await promptForModel(inquirer, 'ollama', ollama.models);
      return {
        provider: 'ollama',
        baseUrl: getProvider('ollama').baseUrl,
        model,
      };
    }
  } else {
    console.log('  Ollama was not detected at http://localhost:11434.');
  }

  return promptForProviderSetup(
    inquirer,
    PROVIDERS.map(provider => provider.id).filter(id => id !== 'ollama'),
  );
}

async function saveWorkspaceAgentConfig(
  db: DbLike,
  tenantId: string,
  setup: AgentSetupConfig,
  jwtSecret: string,
  encryptionKey: string,
): Promise<void> {
  process.env.JWT_SECRET = jwtSecret;
  process.env.CRMY_ENCRYPTION_KEY = encryptionKey;
  const { encryptAgentSecret } = await import('@crmy/server');
  const apiKeyEnc = setup.apiKey ? encryptAgentSecret(setup.apiKey) : null;
  const certification = precertifiedCertificationForModel({
    provider: setup.provider,
    baseUrl: setup.baseUrl,
    model: setup.model,
  });
  await db.query(
    `INSERT INTO agent_configs (
       tenant_id, enabled, provider, base_url, api_key_enc, model,
       max_tokens_per_turn, history_retention_days,
       can_write_objects, can_log_activities, can_create_assignments,
       auto_extract_context, auto_promote_signals, signal_auto_promote_threshold,
       model_certification_status, model_certification_profile,
       model_certification_run_id, model_certification_score, model_certified_at
     )
     VALUES ($1, true, $2, $3, $4, $5, 4000, 90, true, true, true, true, true, 0.85, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id) DO UPDATE SET
       enabled = true,
       provider = EXCLUDED.provider,
       base_url = EXCLUDED.base_url,
       api_key_enc = EXCLUDED.api_key_enc,
       model = EXCLUDED.model,
       can_write_objects = true,
       can_log_activities = true,
       can_create_assignments = true,
       auto_extract_context = true,
       auto_promote_signals = true,
       signal_auto_promote_threshold = 0.85,
       model_certification_status = EXCLUDED.model_certification_status,
       model_certification_profile = EXCLUDED.model_certification_profile,
       model_certification_run_id = EXCLUDED.model_certification_run_id,
       model_certification_score = EXCLUDED.model_certification_score,
       model_certified_at = EXCLUDED.model_certified_at,
       updated_at = now()`,
    [
      tenantId,
      setup.provider,
      setup.baseUrl,
      apiKeyEnc,
      setup.model,
      certification?.status ?? 'uncertified',
      certification?.profile ?? null,
      certification?.run_id ?? null,
      certification?.score ?? null,
      certification?.certified_at ?? null,
    ],
  );
}

function printUncertifiedModelGuidance(): void {
  console.log('  CRMy won\'t let an unproven model invent customer truth.');
  console.log(`  Certify this exact model to turn on automatic Memory: crmy certify --output ${CERTIFY_OUTPUT_DIR}`);
  console.log('  Until then, CRMy will keep grounded Signals in review mode.');
}

async function runInitModelCertification(db: DbLike, tenantId: string): Promise<void> {
  let spinner = createSpinner('Running live model certification...');
  try {
    const { certifyTenantModel } = await import('@crmy/server') as unknown as {
      certifyTenantModel: (options: {
        db: DbLike;
        tenantId: string;
        output?: string;
      }) => Promise<{
        status: 'certified' | 'failed';
        score: number | null;
        run?: {
          run_id: string;
          profile: string;
          totals: { cases: number; passed: number; failed: number; errored: number; skipped: number };
          artifacts: string[];
        };
        message: string;
      }>;
    };
    const result = await certifyTenantModel({ db, tenantId, output: CERTIFY_OUTPUT_DIR });
    if (result.status === 'certified') {
      spinner.succeed(`Model certified (${Math.round((result.score ?? 0) * 100)}%). Automatic Memory can run when the remaining trust gates pass.`);
    } else {
      spinner.fail('Model certification did not pass; automatic Memory remains review-only.');
    }
    if (result.run) {
      console.log(`  Run: ${result.run.run_id} (${result.run.profile})`);
      console.log(`  Cases: ${result.run.totals.cases} | passed: ${result.run.totals.passed} | failed: ${result.run.totals.failed} | errored: ${result.run.totals.errored} | skipped: ${result.run.totals.skipped}`);
    }
    console.log(`  ${result.message}`);
    if (result.run?.artifacts.length) {
      console.log('  Artifacts:');
      for (const artifact of result.run.artifacts) console.log(`    ${artifact}`);
    }
  } catch (err) {
    spinner.fail('Model certification could not run; automatic Memory remains review-only.');
    console.log(`  ${(err as Error).message}`);
    console.log(`  Run later: crmy certify --output ${CERTIFY_OUTPUT_DIR}`);
  }
}

export function initCommand(): Command {
  return new Command('init')
    .description('Set up CRMy: database tables, owner account, API key, Workspace Agent model, and demo data')
    .option('-y, --yes', 'Use defaults non-interactively (requires CRMY_ADMIN_EMAIL + CRMY_ADMIN_PASSWORD; DATABASE_URL optional)')
    .option('--demo', 'Load demo customer data and context for a fast first run')
    .option('--no-demo', 'Skip demo data seeding')
    .option('--certify-model', 'Run live model certification after saving an uncertified Workspace Agent model')
    .option('--no-certify-model', 'Do not prompt or run model certification during init')
    .option('--server-url <url>', 'Server URL to save in config', process.env.CRMY_SERVER_URL ?? 'http://localhost:3000')
    .action(async (opts, command: Command) => {
      const yesMode = !!opts.yes;
      const demoOptionSource = command.getOptionValueSource('demo');
      const demoMode = opts.demo === true;
      const skipDemo = opts.demo === false && demoOptionSource === 'cli';
      const { default: inquirer } = await import('inquirer');

      // ── Header ─────────────────────────────────────────────────────────────
      console.log('\n  ┌─────────────────────────────────────────────┐');
      console.log('  │         crmy.ai — Setup Wizard              │');
      console.log('  └─────────────────────────────────────────────┘\n');
      console.log('  This wizard will:\n');
      console.log('    Step 1 — Connect to your PostgreSQL database');
      console.log('    Step 2 — Prepare the CRMy database tables');
      console.log('    Step 3 — Create your owner account and local API key');
      console.log('    Step 4 — Optionally configure the Workspace Agent model');
      console.log('    Step 5 — Optionally seed demo data for a fast first run\n');

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
      console.log('  ── Step 1 of 5: Database Connection ──────────────────\n');

      let databaseUrl: string;

      if (yesMode || process.env.DATABASE_URL) {
        databaseUrl = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/crmy';
        console.log(`  Using database URL: ${maskDatabaseUrl(databaseUrl)}\n`);
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
      console.log('\n  ── Step 2 of 5: Database Setup ──────────────────────\n');

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
        const msg = maskDatabaseUrl((err as Error).message ?? String(err));
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
      spinner = createSpinner('Preparing database tables…');
      let ran: string[] = [];

      try {
        ran = await runMigrations(db, (name, index, total) => {
          spinner.update(`Applying database update ${index + 1}/${total}: ${name}…`);
        });
        if (ran.length > 0) {
          spinner.succeed(`Database tables ready  \x1b[2m(${ran.length} updates applied)\x1b[0m`);
        } else {
          spinner.succeed('Database tables ready  \x1b[2m(already up to date)\x1b[0m');
        }
      } catch (err) {
        spinner.fail('Database setup failed');
        const msg = (err as Error).message ?? String(err);
        console.error(
          `\n  SQL error: ${msg}\n\n` +
          '  This may mean:\n' +
          '    • The database user lacks CREATE TABLE permissions\n' +
          '    • A previous partial setup left the database tables in a bad state\n' +
          '      Try: drop and recreate the database, then run init again\n',
        );
        await closePool();
        process.exit(1);
      }

      // ── Optional: pgvector semantic search ──────────────────────────────────
      if (process.env.ENABLE_PGVECTOR !== 'true' && !yesMode && !demoMode && isInteractive) {
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
              '\n  You can enable it later by setting ENABLE_PGVECTOR=true and running: crmy migrate run\n',
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
      console.log('\n  ── Step 3 of 5: Admin Account ──────────────────────\n');

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
        ]);
        await inquirer.prompt([
          {
            type: 'password',
            name: 'confirmPassword',
            message: '  Confirm password:',
            mask: '*',
            validate: (input: string) =>
              input === answers.password ? true : 'Passwords do not match',
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
      let jwtSecret = '';
      let encryptionKey = '';

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
        const bootstrapAdminScopes = [
          'read',
          'write',
          'systems:read',
          'systems:write',
          'systems:admin',
          'api_keys:admin',
          'email_provider:admin',
          'agent:admin',
          'hitl:admin',
          'ops:read',
          'ops:write',
          'privacy:read',
          'privacy:write',
          'webhooks:read',
          'webhooks:write',
          'workflows:read',
          'workflows:write',
          'messaging:read',
          'messaging:write',
        ];

        await db.query(
          `INSERT INTO actors (tenant_id, actor_type, display_name, email, user_id, role, scopes, is_active, registration_source, registration_status)
           VALUES ($1, 'human', $2, $3, $4, 'owner', $5, true, 'admin', 'approved')
           ON CONFLICT (tenant_id, user_id) WHERE user_id IS NOT NULL
           DO UPDATE SET display_name = $2, email = $3, role = 'owner', scopes = $5, is_active = true,
                         registration_source = 'admin', registration_status = 'approved', updated_at = now()`,
          [tenantId, name, email.trim(), userId, bootstrapAdminScopes],
        );

        // Generate API key
        rawKey  = 'crmy_' + crypto.randomBytes(32).toString('hex');
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        await db.query(
          `INSERT INTO api_keys (tenant_id, user_id, key_hash, label, scopes)
           VALUES ($1, $2, $3, 'default', $4)`,
          [tenantId, userId, keyHash, bootstrapAdminScopes],
        );

        spinner.succeed('Admin account created');

        // Generate JWT + stored-secret encryption keys, then write config.
        jwtSecret = crypto.randomBytes(32).toString('hex');
        encryptionKey = crypto.randomBytes(32).toString('hex');
        const serverUrl = String(opts.serverUrl ?? process.env.CRMY_SERVER_URL ?? 'http://localhost:3000').trim() || 'http://localhost:3000';
        const crmmyConfig = {
          serverUrl,
          apiKey: rawKey,
          tenantId: 'default',
          database: { url: databaseUrl },
          jwtSecret,
          encryptionKey,
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

      // ── Step 4: Workspace Agent model ───────────────────────────────────────
      console.log('\n  ── Step 4 of 5: Workspace Agent Model ──────────────\n');

      let configuredAgent: AgentSetupConfig | null = null;
      try {
        configuredAgent = await chooseAgentSetup(inquirer, yesMode, isInteractive, demoMode);
        if (configuredAgent) {
          spinner = createSpinner(`Saving ${getProvider(configuredAgent.provider).label} model settings…`);
          await saveWorkspaceAgentConfig(db, tenantId, configuredAgent, jwtSecret, encryptionKey);
          spinner.succeed(
            `Workspace Agent configured  \x1b[2m(${getProvider(configuredAgent.provider).label} · ${configuredAgent.model})\x1b[0m`,
          );
          const certification = precertifiedCertificationForModel({
            provider: configuredAgent.provider,
            baseUrl: configuredAgent.baseUrl,
            model: configuredAgent.model,
          });
          if (certification) {
            console.log(`  Automatic Memory enabled by CRMy certification ${certification.run_id} (${Math.round(certification.score * 100)}%).`);
          } else {
            printUncertifiedModelGuidance();
            let runCertification = opts.certifyModel === true;
            if (opts.certifyModel === undefined && !yesMode && isInteractive) {
              const answer = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'runCertification',
                  message: '  Run quick certification now? (~1 min)',
                  default: true,
                },
              ]);
              runCertification = Boolean(answer.runCertification);
            }
            if (runCertification) {
              await runInitModelCertification(db, tenantId);
            } else {
              console.log(`  Continuing in review mode. Run later: crmy certify --output ${CERTIFY_OUTPUT_DIR}`);
            }
          }
        } else {
          console.log('  Workspace Agent model setup skipped.');
          console.log('  Configure it later in Settings -> Model or rerun init with CRMY_AGENT_PROVIDER and CRMY_AGENT_MODEL.\n');
          if (demoMode) {
            console.log('  Demo data and review-only workflows still work. Automatic Memory turns on after you choose a CRMy pre-certified model or run `crmy certify --output ./eval-runs`.\n');
          }
        }
      } catch (err) {
        console.log(`  \x1b[33m⚠\x1b[0m  Workspace Agent setup skipped: ${(err as Error).message}`);
        console.log('  Configure it later in Settings -> Model.\n');
      }

      // ── Demo data prompt ──────────────────────────────────────────────────────
      console.log('\n  ── Step 5 of 5: Demo Data ──────────────────────────\n');

      let seedDemo = demoMode || (yesMode && !skipDemo); // --yes remains backward-compatible.
      if (!demoMode && !skipDemo && !yesMode && isInteractive) {
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
          const { seedSampleData } = await import('@crmy/server');
          const status = await seedSampleData(db, tenantId);
          const counts = status.counts;
          spinner.succeed(
            `Demo data seeded  \x1b[2m(${counts.accounts} accounts, ${counts.contacts} contacts, ${counts.opportunities} opportunities, ${counts.sources} Sources, ${counts.memory} Memory, ${counts.signals} Signals, ${counts.signal_groups} reviewable Signal sets)\x1b[0m`,
          );
        } catch {
          spinner.fail('Demo data seeding failed');
          console.log('  \x1b[33m⚠\x1b[0m  You can run it later with: crmy seed-demo\n');
        }
      } else {
        console.log('  Demo data skipped. Run `crmy seed-demo` later to load demo customer data and context.\n');
      }

      await closePool();

      // ── Success ───────────────────────────────────────────────────────────────
      const keyPreview = rawKey.substring(0, 16) + '…';
      console.log('\n  ┌───────────────────────────────────────────────────┐');
      console.log('  │   \x1b[32m✓\x1b[0m  CRMy is ready!                              │');
      console.log('  └───────────────────────────────────────────────────┘\n');
      console.log(`  Admin account:  ${email.trim()}`);
      console.log(`  API key:        ${keyPreview}  \x1b[2m(full key in .crmy.json)\x1b[0m`);
      console.log('  Secret storage: dedicated encryption key generated and saved');
      if (configuredAgent) {
        console.log(`  Agent model:    ${getProvider(configuredAgent.provider).label} · ${configuredAgent.model}`);
      }
      console.log('  Config saved:   .crmy.json  \x1b[2m(added to .gitignore)\x1b[0m\n');
      console.log('  Next steps:\n');
      console.log('    Start the server:');
      console.log('    \x1b[1mnpx -y @crmy/cli server\x1b[0m\n');
      if (seedDemo) {
        console.log('    Try the demo data:');
        console.log('    \x1b[1mnpx -y @crmy/cli briefing "account:Northstar Labs"\x1b[0m');
        console.log('    \x1b[1mnpx -y @crmy/cli action-context "account:Northstar Labs" --action customer_outreach\x1b[0m');
        console.log('    \x1b[1mnpx -y @crmy/cli context signal-groups\x1b[0m');
        console.log('    \x1b[1mnpx -y @crmy/cli context lineage --subject "account:Northstar Labs"\x1b[0m');
        console.log('    \x1b[1mnpx -y @crmy/cli hitl list\x1b[0m\n');
        console.log('    Sample logins:');
        console.log('    \x1b[1msample.admin@crmy.local\x1b[0m / crmy-demo-123  \x1b[2m(admin view)\x1b[0m');
        console.log('    \x1b[1msample.rep@crmy.local\x1b[0m / crmy-demo-123    \x1b[2m(scoped rep view)\x1b[0m\n');
      }
      console.log('    Connect to Claude Code:');
      console.log('    \x1b[1mclaude mcp add crmy -- npx -y @crmy/cli mcp\x1b[0m\n');
      if (seedDemo) {
        console.log('    Check the demo agent workflow:');
        console.log('    \x1b[1mnpx -y @crmy/cli agent-smoke\x1b[0m\n');
        if (configuredAgent) {
          console.log('    Check live extraction with your model:');
          console.log('    \x1b[1mnpx -y @crmy/cli agent-smoke --with-model\x1b[0m\n');
        }
        console.log('    Demo Prompt - Ask your agent to run this with CRMy MCP tools:');
        console.log('    \x1b[1mUse the CRMy MCP tools to resolve "Northstar Labs", get a briefing, get Action Context for customer outreach, inspect Signals needing attention, check lineage outcomes, and tell me the safest next action with evidence.\x1b[0m\n');
      }
    });
}
