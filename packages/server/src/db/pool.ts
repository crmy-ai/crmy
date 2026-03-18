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
  // Parse the URL to extract password and sslmode explicitly.
  // - pg requires password to be a string (not undefined) for SCRAM auth.
  // - Passing sslmode via the connection string triggers a pg-connection-string
  //   deprecation warning in pg ≥8.x. We remove it and set ssl via Pool options
  //   instead, which is the forward-compatible approach.
  let password: string | undefined;
  let ssl: boolean | { rejectUnauthorized: boolean } | undefined;
  let cleanUrl = databaseUrl;

  try {
    const url = new URL(databaseUrl);
    password = url.password || '';

    const sslMode = url.searchParams.get('sslmode');
    const isLocal =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1';

    if (sslMode === 'disable' || (!sslMode && isLocal)) {
      ssl = false;
    } else if (sslMode === 'require' || sslMode === 'prefer' || sslMode === 'verify-ca') {
      // Cloud providers (Supabase, Neon, etc.) use these modes.
      // rejectUnauthorized:false mirrors historical pg behaviour for these modes.
      ssl = { rejectUnauthorized: false };
    } else if (sslMode === 'verify-full') {
      ssl = { rejectUnauthorized: true };
    }
    // sslMode === null && !isLocal → leave ssl undefined (pg decides)

    // Strip sslmode from the URL so pg-connection-string never sees it
    url.searchParams.delete('sslmode');
    cleanUrl = url.toString();
  } catch {
    password = undefined;
  }

  pool = new Pool({
    connectionString: cleanUrl,
    ...(password !== undefined && { password }),
    ...(ssl !== undefined && { ssl }),
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
