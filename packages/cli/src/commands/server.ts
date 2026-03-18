// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfigFile } from '../config.js';
import { printBanner } from '../banner.js';
import { createSpinner, type Spinner } from '../spinner.js';
import { logToFile, LOG_FILE } from '../logger.js';

const _require = createRequire(import.meta.url);
function getCLIVersion(): string {
  try {
    const pkg = _require(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return '0.5.5';
  }
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
    .description('Start the crmy HTTP server')
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
          '  Run `npx @crmy/cli init` to set up CRMy first.\n',
        );
        logToFile('ERROR: .crmy.json not found');
        process.exit(1);
      }

      process.env.DATABASE_URL  = config.database?.url ?? process.env.DATABASE_URL;
      process.env.JWT_SECRET    = config.jwtSecret     ?? process.env.JWT_SECRET ?? 'dev-secret';
      process.env.PORT          = String(port);
      process.env.CRMY_IMPORTED = '1';

      if (!process.env.DATABASE_URL) {
        console.error(
          '\n  No database URL configured.\n' +
          '  Run `npx @crmy/cli init` first, or set the DATABASE_URL environment variable.\n',
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
            `    npx @crmy/cli server --port ${port + 1}\n`,
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
