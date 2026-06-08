// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { loadConfigFile, saveConfigFile } from '../config.js';
import { printBanner } from '../banner.js';
import { createSpinner, type Spinner } from '../spinner.js';
import { logToFile, LOG_FILE } from '../logger.js';

const _require = createRequire(import.meta.url);
function getCLIVersion(): string {
  const baseDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Bundled CLI: packages/cli/dist/index.js -> packages/cli/package.json
    path.resolve(baseDir, '../package.json'),
    // Source/tsx CLI: packages/cli/src/commands/server.ts -> packages/cli/package.json
    path.resolve(baseDir, '../../package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const pkg = _require(candidate) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // Try the next runtime layout.
    }
  }
  return 'unknown';
}

function printReadyBox(port: number): void {
  const lines = [
    `  Web UI  \u2192  http://localhost:${port}/app`,
    `  API     \u2192  http://localhost:${port}/api/v1`,
    `  MCP     \u2192  http://localhost:${port}/mcp`,
    `  Health  \u2192  http://localhost:${port}/health`,
  ];
  const innerWidth = Math.max(...lines.map(l => l.length)) + 2;
  const bar = '\u2500'.repeat(innerWidth);
  console.log(`\n  \u250c${bar}\u2510`);
  for (const line of lines) {
    console.log(`  \u2502${line.padEnd(innerWidth)}\u2502`);
  }
  console.log(`  \u2514${bar}\u2518\n`);
  console.log(`  Log file: ${LOG_FILE}`);
  console.log('  Press Ctrl+C to stop\n');
}

export function serverCommand(): Command {
  return new Command('server')
    .description('Start the CRMy API, Web UI, and HTTP MCP endpoint')
    .option('--port <port>', 'HTTP port', '3000')
    .action(async (opts) => {
      const version = getCLIVersion();
      const port = parseInt(opts.port, 10);

      printBanner(version);
      logToFile(`=== CRMy server starting (v${version}) ===`);

      // Load .crmy.json config
      let config: ReturnType<typeof loadConfigFile>;
      try {
        config = loadConfigFile();
      } catch (err) {
        console.error(
          '\n  No .crmy.json found in the current directory.\n' +
          '  Run `npx -y @crmy/cli init` to set up CRMy first.\n',
        );
        logToFile('ERROR: .crmy.json not found');
        process.exit(1);
      }

      process.env.DATABASE_URL = config.database?.url ?? process.env.DATABASE_URL;
      process.env.JWT_SECRET = config.jwtSecret ?? process.env.JWT_SECRET;
      if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = randomBytes(32).toString('hex');
        console.warn(
          '\n  Warning: .crmy.json has no jwtSecret. Using an ephemeral local JWT secret for this server process.\n' +
          '  Run `npx -y @crmy/cli init` to persist a stable local secret.\n',
        );
        logToFile('WARN: .crmy.json missing jwtSecret; using ephemeral local JWT secret');
      }
      if (!process.env.CRMY_ENCRYPTION_KEY && !process.env.AGENT_ENCRYPTION_KEY) {
        if (config.encryptionKey) {
          process.env.CRMY_ENCRYPTION_KEY = config.encryptionKey;
        } else {
          const encryptionKey = randomBytes(32).toString('hex');
          config = { ...config, encryptionKey };
          saveConfigFile(config);
          process.env.CRMY_ENCRYPTION_KEY = encryptionKey;
          console.log(
            '\n  Generated a dedicated stored-secret encryption key and saved it to .crmy.json.\n' +
            '  This key protects connector credentials, OAuth tokens, and Workspace Agent provider keys.\n',
          );
          logToFile('Generated missing CRMY_ENCRYPTION_KEY and saved it to config');
        }
      }
      process.env.PORT = String(port);
      process.env.CRMY_IMPORTED = '1';

      if (!process.env.DATABASE_URL) {
        console.error(
          '\n  No database URL configured.\n' +
          '  Run `npx -y @crmy/cli init` first, or set the DATABASE_URL environment variable.\n',
        );
        logToFile('ERROR: No DATABASE_URL configured');
        process.exit(1);
      }

      const { createApp, loadConfig, closePool, shutdownPlugins } = await import('@crmy/server');
      const serverConfig = loadConfig();

      // Per-step spinner — one active at a time, driven by onProgress callback
      let spinner: Spinner = createSpinner('');

      const stepLabels: Record<string, string> = {
        db_connect:    'Connecting to database',
        migrations:    'Running database migrations',
        seed_defaults: 'Seeding defaults',
      };

      serverConfig.onProgress = (step, status, detail) => {
        logToFile(`[${status.toUpperCase()}] ${step}${detail ? ': ' + detail : ''}`);

        if (status === 'start') {
          spinner = createSpinner(stepLabels[step] ?? step);
        } else if (status === 'done') {
          const label = stepLabels[step] ?? step;
          const suffix = detail ? `  \x1b[2m(${detail})\x1b[0m` : '';
          spinner.succeed(`${label}${suffix}`);
        } else if (status === 'error') {
          spinner.fail(`${stepLabels[step] ?? step} failed`);
        }
      };

      serverConfig.onMigration = (name: string, index: number, total: number) => {
        spinner.update(`Running migration ${index + 1}/${total}: ${name}…`);
        logToFile(`[MIGRATION] ${index + 1}/${total}: ${name}`);
      };

      let hitlInterval: ReturnType<typeof setInterval> | undefined;

      try {
        const result = await createApp(serverConfig);
        hitlInterval = result.hitlInterval;
        const app = result.app;

        // Bind port
        spinner = createSpinner(`Starting HTTP server on port ${port}`);
        logToFile(`[START] bind_port: ${port}`);

        await new Promise<void>((resolve, reject) => {
          const srv = app.listen(port, () => {
            spinner.succeed(`Server listening on port ${port}`);
            logToFile(`[DONE] bind_port: ${port}`);
            resolve();
          });
          srv.on('error', reject);
        });

        printReadyBox(port);

        // Graceful shutdown
        const shutdown = async () => {
          console.log('\n  Shutting down...');
          logToFile('Received shutdown signal');
          if (hitlInterval) clearInterval(hitlInterval);
          await shutdownPlugins?.();
          await closePool();
          process.exit(0);
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT',  shutdown);

      } catch (err) {
        const error = err as NodeJS.ErrnoException & Error;
        spinner.stop();

        if (error.code === 'EADDRINUSE') {
          console.error(
            `\n  Port ${port} is already in use.\n` +
            `  Try a different port:\n` +
            `    npx -y @crmy/cli server --port ${port + 1}\n`,
          );
          logToFile(`ERROR: EADDRINUSE on port ${port}`);
        } else if (
          error.message?.includes('ECONNREFUSED') ||
          error.message?.includes('password authentication') ||
          error.message?.includes('SCRAM') ||
          error.message?.includes('connect') ||
          error.message?.includes('database')
        ) {
          console.error(
            '\n  Could not connect to PostgreSQL.\n' +
            `  Error: ${error.message}\n\n` +
            '  Check that:\n' +
            '    \u2022 PostgreSQL is running\n' +
            '    \u2022 The DATABASE_URL in .crmy.json is correct\n' +
            '    \u2022 The database exists  (create it: createdb crmy)\n' +
            '    \u2022 The database user has the right permissions\n',
          );
          logToFile(`ERROR: DB connection: ${error.message}`);
        } else {
          console.error(`\n  Server failed to start: ${error.message}\n`);
          logToFile(`ERROR: ${error.message}`);
        }

        process.exit(1);
      }
    });
}
