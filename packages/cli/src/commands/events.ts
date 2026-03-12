// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { loadConfigFile } from '../config.js';

export function eventsCommand(): Command {
  return new Command('events')
    .description('View audit log')
    .option('--object <id>', 'Filter by object ID')
    .option('--type <type>', 'Filter by event type')
    .action(async (opts) => {
      const config = loadConfigFile();
      const databaseUrl = process.env.DATABASE_URL ?? config.database?.url;
      if (!databaseUrl) {
        console.error('No database URL configured.');
        process.exit(1);
      }

      process.env.CRMY_IMPORTED = '1';
      const { initPool, closePool } = await import('@crmy/server');
      const { searchEvents } = await import('@crmy/server/dist/db/repos/events.js');

      const db = await initPool(databaseUrl);

      // Get default tenant
      const tenantResult = await db.query("SELECT id FROM tenants WHERE slug = 'default' LIMIT 1");
      if (tenantResult.rows.length === 0) {
        console.log('No tenant found. Run crmy init first.');
        await closePool();
        return;
      }

      const result = await searchEvents(db, tenantResult.rows[0].id, {
        object_id: opts.object,
        event_type: opts.type,
        limit: 50,
      });

      if (result.data.length === 0) {
        console.log('No events found.');
      } else {
        console.table(result.data.map((e) => ({
          id: e.id,
          type: e.event_type,
          actor: e.actor_type,
          object: e.object_type,
          created: e.created_at,
        })));
      }

      await closePool();
    });
}
