// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import pg from 'pg';

const { Pool } = pg;

export type DbPool = pg.Pool;

let pool: DbPool | null = null;

export function getPool(): DbPool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initPool() first.');
  }
  return pool;
}

export async function initPool(databaseUrl: string, maxConnections = 10): Promise<DbPool> {
  pool = new Pool({
    connectionString: databaseUrl,
    max: maxConnections,
  });

  // Test the connection with retries
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const client = await pool.connect();
      client.release();
      return pool;
    } catch (err) {
      lastError = err as Error;
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`Failed to connect to database after 5 attempts: ${lastError?.message}`);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
