// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type pg from 'pg';
import type { DbPool } from './pool.js';

export type DbTransaction = pg.PoolClient;

/**
 * Run a set of database operations atomically.
 *
 * Existing repositories accept DbPool because they only depend on query().
 * PoolClient has the same query surface, so callers can pass the transaction
 * client through those repositories without a repo-wide type refactor.
 */
export async function withTransaction<T>(
  db: DbPool,
  fn: (tx: DbPool) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client as unknown as DbPool);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
