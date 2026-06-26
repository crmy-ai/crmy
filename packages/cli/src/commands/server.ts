// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CRMY_DIR, loadConfigFile, saveConfigFile } from '../config.js';
import { printBanner } from '../banner.js';
import { createSpinner, type Spinner } from '../spinner.js';
import { logToFile, LOG_FILE } from '../logger.js';

const DEFAULT_PORT = '3000';
const SERVER_PID_FILE = path.join(CRMY_DIR, 'server.pid');
const SERVER_STATE_FILE = path.join(CRMY_DIR, 'server.json');

interface ServerState {
  pid: number;
  port: number;
  startedAt: string;
  cwd: string;
  logFile: string;
  command: string;
}

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

function parsePort(value: unknown): number {
  const port = Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port "${String(value)}". Choose a number between 1 and 65535.`);
  }
  return port;
}

function resolvePortOption(opts: { port?: string }, command: Command): number {
  if (command.getOptionValueSource('port') === 'cli') {
    return parsePort(opts.port);
  }

  const parent = command.parent;
  const parentPort = parent?.opts<{ port?: string }>().port;
  if (parent?.getOptionValueSource('port') === 'cli' && parentPort) {
    return parsePort(parentPort);
  }

  return parsePort(opts.port ?? parentPort ?? DEFAULT_PORT);
}

function printReadyBox(port: number, background = false): void {
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
  if (background) {
    console.log('  Managed by: crmy server stop\n');
  } else {
    console.log('  Press Ctrl+C to stop\n');
  }
}

function ensureStateDir(): void {
  fs.mkdirSync(CRMY_DIR, { recursive: true });
}

function writeServerState(state: ServerState): void {
  ensureStateDir();
  fs.writeFileSync(SERVER_STATE_FILE, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(SERVER_PID_FILE, `${state.pid}\n`, { mode: 0o600 });
}

function readServerState(): ServerState | null {
  try {
    const state = JSON.parse(fs.readFileSync(SERVER_STATE_FILE, 'utf-8')) as ServerState;
    if (Number.isInteger(state.pid) && state.pid > 0) return state;
  } catch {
    // fall through
  }
  return null;
}

function clearServerState(pid?: number): void {
  const current = readServerState();
  if (pid && current?.pid && current.pid !== pid) return;
  for (const file of [SERVER_PID_FILE, SERVER_STATE_FILE]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // Already gone.
    }
  }
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function probeHealth(port: number, timeoutMs = 800): Promise<{ ok: boolean; detail?: string; crmy?: boolean; version?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    try {
      const body = await res.json() as { status?: unknown; version?: unknown };
      const version = typeof body.version === 'string' ? body.version : undefined;
      return { ok: true, crmy: body.status === 'ok' && !!version, version };
    } catch {
      return { ok: true };
    }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function findListeningPid(port: number): Promise<number | null> {
  return new Promise(resolve => {
    execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeout: 1500 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const pid = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? '', 10);
      resolve(Number.isInteger(pid) && pid > 0 ? pid : null);
    });
  });
}

async function adoptUnmanagedServer(port: number, health: { crmy?: boolean; version?: string }): Promise<boolean> {
  if (!health.crmy) return false;

  const pid = await findListeningPid(port);
  if (!pid || !isProcessRunning(pid) || pid === process.pid) return false;

  const state: ServerState = {
    pid,
    port,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
    logFile: LOG_FILE,
    command: `crmy server --port ${port}`,
  };
  writeServerState(state);

  console.log(`\n  CRMy is already responding on http://localhost:${port}/health.`);
  console.log('  Adopted the existing process so this CLI can manage it.\n');
  printManagedServerSummary(state);
  if (health.version) console.log(`  Version: ${health.version}`);
  console.log('\n  Stop it with: crmy server stop');
  console.log('  Watch logs with: crmy server logs --follow\n');
  return true;
}

async function waitForHealth(port: number, pid: number, timeoutMs: number): Promise<{ ok: boolean; detail?: string; running: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let lastDetail = 'health check timed out';

  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return { ok: false, detail: 'server process exited', running: false };
    }

    const health = await probeHealth(port, 500);
    if (health.ok) return { ok: true, running: true };
    lastDetail = health.detail ?? lastDetail;
    await delay(250);
  }

  return { ok: false, detail: lastDetail, running: isProcessRunning(pid) };
}

function printManagedServerSummary(state: ServerState): void {
  console.log(`  PID:    ${state.pid}`);
  console.log(`  Web UI: http://localhost:${state.port}/app`);
  console.log(`  Health: http://localhost:${state.port}/health`);
  console.log(`  Logs:   ${state.logFile}`);
}

function printLogTail(lines = 80): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.log(`  No server log yet: ${LOG_FILE}`);
    return;
  }

  const content = fs.readFileSync(LOG_FILE, 'utf-8').trimEnd();
  if (!content) {
    console.log(`  Server log is empty: ${LOG_FILE}`);
    return;
  }
  console.log(content.split(/\r?\n/).slice(-lines).join('\n'));
}

function printLogSince(offset: number, fallbackLines = 80): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.log(`  No server log yet: ${LOG_FILE}`);
    return;
  }

  const buffer = fs.readFileSync(LOG_FILE);
  const start = Math.max(0, Math.min(offset, buffer.length));
  const content = buffer.subarray(start).toString('utf-8').trimEnd();
  if (!content) {
    printLogTail(fallbackLines);
    return;
  }
  console.log(content.split(/\r?\n/).slice(-fallbackLines).join('\n'));
}

function followLogFile(): void {
  ensureStateDir();
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');

  let offset = fs.statSync(LOG_FILE).size;
  console.log(`\n  Following ${LOG_FILE}. Press Ctrl+C to stop.\n`);

  const interval = setInterval(() => {
    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size < offset) offset = 0;
      if (stat.size <= offset) return;

      const fd = fs.openSync(LOG_FILE, 'r');
      try {
        const buffer = Buffer.alloc(stat.size - offset);
        fs.readSync(fd, buffer, 0, buffer.length, offset);
        offset = stat.size;
        process.stdout.write(buffer.toString('utf-8'));
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      console.error(`  Could not read log file: ${(err as Error).message}`);
    }
  }, 1000);

  const stop = () => {
    clearInterval(interval);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await delay(200);
  }
  return !isProcessRunning(pid);
}

async function runForegroundServer(port: number): Promise<void> {
      const version = getCLIVersion();
      const backgroundChild = process.env.CRMY_SERVER_BACKGROUND_CHILD === '1';

      if (backgroundChild) {
        console.log(`\n  CRMy server v${version} starting in the background\n`);
      } else {
        printBanner(version);
      }
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
        migrations:    'Checking database migrations',
        seed_defaults: 'Checking built-in registries',
      };

      serverConfig.onProgress = (step, status, detail) => {
        logToFile(`[${status.toUpperCase()}] ${step}${detail ? ': ' + detail : ''}`);

        if (status === 'start') {
          spinner = createSpinner(stepLabels[step] ?? step);
        } else if (status === 'done') {
          const label = step === 'migrations' && detail === 'up to date'
            ? 'Database migrations skipped'
            : stepLabels[step] ?? step;
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
      let mcpHeartbeatInterval: ReturnType<typeof setInterval> | undefined;
      let stopRetryLoop: (() => void) | undefined;
      let stopMcpResourceNotifications: (() => Promise<void>) | undefined;
      let stateWritten = false;

      try {
        const result = await createApp(serverConfig);
        hitlInterval = result.hitlInterval;
        mcpHeartbeatInterval = result.mcpHeartbeatInterval;
        stopRetryLoop = result.stopRetryLoop;
        stopMcpResourceNotifications = result.stopMcpResourceNotifications;
        const app = result.app;

        // Bind port
        spinner = createSpinner(`Starting HTTP server on port ${port}`);
        logToFile(`[START] bind_port: ${port}`);

        await new Promise<void>((resolve, reject) => {
          const srv = app.listen(port, () => {
            spinner.succeed(`Server listening on port ${port}`);
            logToFile(`[DONE] bind_port: ${port}`);
            writeServerState({
              pid: process.pid,
              port,
              startedAt: new Date().toISOString(),
              cwd: process.cwd(),
              logFile: LOG_FILE,
              command: `crmy server --port ${port}`,
            });
            stateWritten = true;
            resolve();
          });
          srv.on('error', reject);
        });

        printReadyBox(port, backgroundChild);

        // Graceful shutdown
        const shutdown = async () => {
          console.log('\n  Shutting down...');
          logToFile('Received shutdown signal');
          if (hitlInterval) clearInterval(hitlInterval);
          if (mcpHeartbeatInterval) clearInterval(mcpHeartbeatInterval);
          stopRetryLoop?.();
          await stopMcpResourceNotifications?.();
          await shutdownPlugins?.();
          await closePool();
          clearServerState(process.pid);
          process.exit(0);
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT',  shutdown);

      } catch (err) {
        const error = err as NodeJS.ErrnoException & Error;
        spinner.stop();
        if (stateWritten) clearServerState(process.pid);

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
}

async function startBackgroundServer(port: number): Promise<void> {
  const existing = readServerState();
  if (existing && isProcessRunning(existing.pid)) {
    const health = await probeHealth(existing.port);
    if (health.ok) {
      console.log('\n  CRMy is already running in the background.\n');
      printManagedServerSummary(existing);
      console.log('\n  Stop it with: crmy server stop\n');
      return;
    }

    console.error(
      `\n  A CRMy server process is already running as PID ${existing.pid}, but health is not ready.\n` +
      '  Check it with:\n' +
      '    crmy server status\n' +
      '    crmy server logs\n',
    );
    process.exitCode = 1;
    return;
  }
  if (existing) clearServerState(existing.pid);

  const unmanagedHealth = await probeHealth(port);
  if (unmanagedHealth.ok) {
    if (await adoptUnmanagedServer(port, unmanagedHealth)) return;

    console.log(`\n  CRMy is already responding on http://localhost:${port}/health.\n`);
    console.log('  No CRMy PID file was found, so this process is not managed by `crmy server stop`.\n');
    console.log('  Stop the existing listener manually, then run: crmy server start\n');
    return;
  }

  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error('Could not resolve the CRMy CLI entrypoint for background start.');
  }

  ensureStateDir();
  const logStartOffset = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
  const logFd = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [entrypoint, 'server', '--port', String(port)], {
    cwd: process.cwd(),
    detached: true,
    env: { ...process.env, CRMY_SERVER_BACKGROUND_CHILD: '1' },
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);

  if (!child.pid) {
    throw new Error('Could not start CRMy in the background.');
  }
  child.unref();

  const state: ServerState = {
    pid: child.pid,
    port,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
    logFile: LOG_FILE,
    command: `crmy server --port ${port}`,
  };
  writeServerState(state);

  console.log('\n  Starting CRMy in the background...');
  const health = await waitForHealth(port, child.pid, 45_000);
  if (health.ok) {
    console.log('\n  CRMy is running in the background.\n');
    printManagedServerSummary(state);
    console.log('\n  Stop it with: crmy server stop');
    console.log('  Watch logs with: crmy server logs --follow\n');
    return;
  }

  if (!health.running) {
    clearServerState(child.pid);
    console.error(`\n  CRMy did not stay running: ${health.detail ?? 'process exited'}\n`);
    printLogSince(logStartOffset, 60);
    process.exitCode = 1;
    return;
  }

  console.log('\n  CRMy started, but health is still warming up.\n');
  printManagedServerSummary(state);
  console.log('\n  Check readiness with: crmy server status');
  console.log('  Watch logs with:     crmy server logs --follow\n');
}

async function stopBackgroundServer(force: boolean): Promise<void> {
  const state = readServerState();
  if (!state) {
    console.log('\n  CRMy server is not running. No PID file was found.\n');
    return;
  }

  if (!isProcessRunning(state.pid)) {
    clearServerState(state.pid);
    console.log(`\n  CRMy server is not running. Removed stale PID ${state.pid}.\n`);
    return;
  }

  if (state.pid === process.pid) {
    console.error('\n  Refusing to stop the current CLI process.\n');
    process.exitCode = 1;
    return;
  }

  console.log(`\n  Stopping CRMy server PID ${state.pid}...`);
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      clearServerState(state.pid);
      console.log('  CRMy server was already stopped.\n');
      return;
    }
    throw err;
  }

  if (await waitForExit(state.pid, 10_000)) {
    clearServerState(state.pid);
    console.log('  CRMy server stopped.\n');
    return;
  }

  if (force) {
    process.kill(state.pid, 'SIGKILL');
    if (await waitForExit(state.pid, 3_000)) {
      clearServerState(state.pid);
      console.log('  CRMy server stopped with SIGKILL.\n');
      return;
    }
  }

  console.error('\n  CRMy server is still running.');
  console.error('  Inspect logs with: crmy server logs');
  console.error('  Force stop with:   crmy server stop --force\n');
  process.exitCode = 1;
}

async function printServerStatus(): Promise<void> {
  const state = readServerState();
  if (!state) {
    const defaultPort = parsePort(DEFAULT_PORT);
    const unmanagedHealth = await probeHealth(defaultPort);
    if (unmanagedHealth.ok) {
      console.log(`\n  CRMy is responding on http://localhost:${defaultPort}/health, but no managed PID file exists.`);
      console.log('  Run `crmy server start` to adopt the running process, or stop the existing listener manually.\n');
      process.exitCode = 2;
      return;
    }

    console.log('\n  CRMy server is not running. Start it with: crmy server start\n');
    process.exitCode = 1;
    return;
  }

  if (!isProcessRunning(state.pid)) {
    clearServerState(state.pid);
    console.log(`\n  CRMy server is not running. Removed stale PID ${state.pid}.\n`);
    process.exitCode = 1;
    return;
  }

  const health = await probeHealth(state.port);
  if (health.ok) {
    console.log('\n  CRMy server is running.\n');
    printManagedServerSummary(state);
    console.log(`  Started: ${state.startedAt}`);
    console.log(`  Workdir: ${state.cwd}\n`);
    return;
  }

  console.log('\n  CRMy server process is running, but health is not ready.\n');
  printManagedServerSummary(state);
  console.log(`  Health detail: ${health.detail ?? 'not ready'}`);
  console.log('\n  Watch logs with: crmy server logs --follow\n');
  process.exitCode = 2;
}

function printServerLogs(linesOption: string, follow: boolean): void {
  const lines = Number.parseInt(linesOption, 10);
  printLogTail(Number.isInteger(lines) && lines > 0 ? lines : 80);
  if (follow) followLogFile();
}

export function serverCommand(): Command {
  const command = new Command('server')
    .description('Start the CRMy API, Web UI, and HTTP MCP endpoint')
    .option('--port <port>', 'HTTP port', DEFAULT_PORT)
    .action(async (opts) => {
      await runForegroundServer(parsePort(opts.port));
    });

  command
    .command('start')
    .description('Start CRMy in the background')
    .option('--port <port>', 'HTTP port', DEFAULT_PORT)
    .option('--foreground', 'Run in the foreground instead of the background')
    .action(async (opts, subcommand: Command) => {
      const port = resolvePortOption(opts, subcommand);
      if (opts.foreground) {
        await runForegroundServer(port);
      } else {
        await startBackgroundServer(port);
      }
    });

  command
    .command('stop')
    .description('Stop the background CRMy server')
    .option('--force', 'Use SIGKILL if graceful shutdown does not finish')
    .action(async (opts) => {
      await stopBackgroundServer(!!opts.force);
    });

  command
    .command('status')
    .description('Show CRMy server process and health status')
    .action(async () => {
      await printServerStatus();
    });

  command
    .command('logs')
    .description('Show CRMy server logs')
    .option('-n, --lines <lines>', 'Number of log lines to show', '80')
    .option('-f, --follow', 'Keep streaming new log lines')
    .action((opts) => {
      printServerLogs(opts.lines, !!opts.follow);
    });

  return command;
}
