// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { Command } from 'commander';

const PACKAGE_NAME = '@crmy/cli';

interface UpdateTarget {
  mode: 'npm';
  prefix?: string;
  reason: string;
}

function currentCliEntrypoint(): string {
  return fs.realpathSync(fileURLToPath(import.meta.url));
}

function inferNpmPrefix(entrypoint: string): string | undefined {
  const normalized = entrypoint.split(path.sep).join('/');
  const marker = '/node_modules/@crmy/cli/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) return undefined;

  const beforeNodeModules = normalized.slice(0, markerIndex);
  if (beforeNodeModules.endsWith('/lib')) {
    return beforeNodeModules.slice(0, -'/lib'.length);
  }
  return beforeNodeModules || undefined;
}

function inferInstallerPrefix(entrypoint: string): string | undefined {
  const normalized = entrypoint.split(path.sep).join('/');
  const installerSource = '/.crmy/source/crmy/packages/cli/';
  if (!normalized.includes(installerSource)) return undefined;

  return path.join(os.homedir(), '.crmy', 'npm');
}

function resolveUpdateTarget(prefixOverride?: string): UpdateTarget {
  if (prefixOverride) {
    return {
      mode: 'npm',
      prefix: path.resolve(prefixOverride),
      reason: 'using --prefix override',
    };
  }

  const entrypoint = currentCliEntrypoint();
  const prefix = inferNpmPrefix(entrypoint) ?? inferInstallerPrefix(entrypoint);
  if (prefix) {
    return {
      mode: 'npm',
      prefix,
      reason: `current CLI resolves under ${prefix}`,
    };
  }

  return {
    mode: 'npm',
    reason: 'could not infer the current npm prefix; using npm global defaults',
  };
}

function run(command: string, args: string[], options: { dryRun?: boolean } = {}): Promise<void> {
  const shown = [command, ...args].join(' ');
  if (options.dryRun) {
    console.log(`  ${shown}`);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(signal ? `${command} exited with signal ${signal}` : `${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

function buildNpmInstallArgs(target: UpdateTarget, version: string): string[] {
  const args = ['install', '-g'];
  if (target.prefix) {
    args.push('--prefix', target.prefix);
  }
  args.push(`${PACKAGE_NAME}@${version}`);
  return args;
}

function updatedCrmyCommand(target: UpdateTarget): string {
  return target.prefix ? path.join(target.prefix, 'bin', 'crmy') : 'crmy';
}

export function updateCommand(): Command {
  return new Command('update')
    .description('Update the CRMy CLI to the latest release')
    .option('--to <version>', 'Install a specific @crmy/cli version or npm tag', 'latest')
    .option('--prefix <path>', 'npm global prefix to update')
    .option('--skip-doctor', 'Do not run `crmy doctor` after updating')
    .option('--dry-run', 'Print the update command without running it')
    .action(async (opts) => {
      const version = String(opts.to || 'latest');
      const target = resolveUpdateTarget(opts.prefix);
      const installArgs = buildNpmInstallArgs(target, version);
      const crmyCmd = updatedCrmyCommand(target);

      console.log('\n  CRMy Update\n  ══════════════════════════════════════\n');
      console.log(`  Package: ${PACKAGE_NAME}@${version}`);
      console.log(`  Method:  npm global install`);
      console.log(`  Target:  ${target.prefix ? target.prefix : 'npm default global prefix'}`);
      console.log(`  Note:    This updates the CLI only. Config, database, demo data, and admin users are preserved.\n`);

      if (target.reason) {
        console.log(`  ${target.reason}\n`);
      }

      await run('npm', installArgs, { dryRun: !!opts.dryRun });

      if (opts.dryRun) {
        console.log('\n  Dry run only. No files were changed.\n');
        return;
      }

      console.log('\n  CRMy CLI updated.\n');
      await run(crmyCmd, ['--version']);

      if (!opts.skipDoctor) {
        console.log('\n  Checking setup health...\n');
        try {
          await run(crmyCmd, ['doctor']);
        } catch {
          console.log('\n  Update succeeded, but doctor found setup issues. Run `crmy doctor` after checking your database/server.\n');
        }
      }

      console.log('\n  If the server is running, restart it to use the updated CLI/server bundle:');
      console.log('    crmy server stop');
      console.log('    crmy server start\n');
    });
}
