import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbPool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

export async function runMigrations(db: DbPool): Promise<string[]> {
  // Create migrations tracking table
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Get already-applied migrations
  const applied = await db.query('SELECT name FROM _migrations ORDER BY name');
  const appliedSet = new Set(applied.rows.map(r => r.name as string));

  // Read migration files
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    // Extract only the "Up" portion (before "-- Down:")
    const upSql = sql.split('-- Down:')[0];

    await db.query('BEGIN');
    try {
      await db.query(upSql);
      await db.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await db.query('COMMIT');
      ran.push(file);
    } catch (err) {
      await db.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }

  return ran;
}

export async function getMigrationStatus(db: DbPool): Promise<{ applied: string[]; pending: string[] }> {
  try {
    const applied = await db.query('SELECT name FROM _migrations ORDER BY name');
    const appliedSet = new Set(applied.rows.map(r => r.name as string));

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    return {
      applied: files.filter(f => appliedSet.has(f)),
      pending: files.filter(f => !appliedSet.has(f)),
    };
  } catch {
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();
    return { applied: [], pending: files };
  }
}
