#!/usr/bin/env tsx
import { initPool, closePool } from '../packages/server/src/db/pool.js';
import { runMigrations, getMigrationStatus } from '../packages/server/src/db/migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const command = process.argv[2] ?? 'run';

async function main() {
  const pool = await initPool(databaseUrl!);

  try {
    if (command === 'status') {
      const status = await getMigrationStatus(pool);
      console.log('Applied:', status.applied.length ? status.applied.join(', ') : '(none)');
      console.log('Pending:', status.pending.length ? status.pending.join(', ') : '(none)');
    } else {
      const ran = await runMigrations(pool);
      if (ran.length === 0) {
        console.log('No pending migrations.');
      } else {
        console.log(`Ran ${ran.length} migration(s): ${ran.join(', ')}`);
      }
    }
  } finally {
    await closePool();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
