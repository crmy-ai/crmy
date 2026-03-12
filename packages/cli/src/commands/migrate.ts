// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { loadConfigFile } from '../config.js';

export function migrateCommand(): Command {
  const cmd = new Command('migrate').description('Database migrations');

  cmd.command('run')
    .action(async () => {
      const config = loadConfigFile();
      const databaseUrl = process.env.DATABASE_URL ?? config.database?.url;
      if (!databaseUrl) {
        console.error('No database URL configured.');
        process.exit(1);
      }
      process.env.CRMY_IMPORTED = '1';
      const { initPool, closePool, runMigrations } = await import('@crmy/server');
      const db = await initPool(databaseUrl);
      const ran = await runMigrations(db);
      if (ran.length === 0) {
        console.log('No pending migrations.');
      } else {
        console.log(`Ran ${ran.length} migration(s): ${ran.join(', ')}`);
      }
      await closePool();
    });

  cmd.command('status')
    .action(async () => {
      const config = loadConfigFile();
      const databaseUrl = process.env.DATABASE_URL ?? config.database?.url;
      if (!databaseUrl) {
        console.error('No database URL configured.');
        process.exit(1);
      }
      process.env.CRMY_IMPORTED = '1';
      const { initPool, closePool } = await import('@crmy/server');
      const { getMigrationStatus } = await import('@crmy/server/dist/db/migrate.js');
      const db = await initPool(databaseUrl);
      const status = await getMigrationStatus(db);
      console.log('Applied:', status.applied.length ? status.applied.join(', ') : '(none)');
      console.log('Pending:', status.pending.length ? status.pending.join(', ') : '(none)');
      await closePool();
    });

  return cmd;
}
