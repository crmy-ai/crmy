// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID } from '@crmy/shared';
import { GOVERNOR_DEFAULTS } from '@crmy/shared';
import { CrmyError } from '@crmy/shared';

/**
 * Get the effective limit for a given tenant and limit name.
 * Falls back to plan defaults, then to 'team' tier defaults.
 */
export async function getLimit(
  db: DbPool,
  tenantId: UUID,
  limitName: string,
): Promise<number> {
  // Check for tenant-specific override
  const override = await db.query(
    'SELECT limit_value FROM governor_limits WHERE tenant_id = $1 AND limit_name = $2',
    [tenantId, limitName],
  );
  if (override.rows.length > 0) return override.rows[0].limit_value;

  // Fall back to plan defaults
  const tenant = await db.query('SELECT plan FROM tenants WHERE id = $1', [tenantId]);
  const plan = tenant.rows[0]?.plan ?? 'solo_agent';
  const planDefaults = GOVERNOR_DEFAULTS[plan] ?? GOVERNOR_DEFAULTS.team;
  return planDefaults?.[limitName] ?? GOVERNOR_DEFAULTS.team[limitName] ?? Infinity;
}

/**
 * Enforce a governor limit. Throws CrmyError if limit exceeded.
 */
export async function enforceLimit(
  db: DbPool,
  tenantId: UUID,
  limitName: string,
  currentCount: number,
): Promise<void> {
  const max = await getLimit(db, tenantId, limitName);
  if (currentCount >= max) {
    throw new CrmyError(
      'QUOTA_EXCEEDED',
      `Governor limit exceeded: ${limitName} (current: ${currentCount}, max: ${max})`,
      429,
      { limit_name: limitName, current: currentCount, max },
    );
  }
}

/**
 * Count active actors for a tenant.
 */
export async function countActiveActors(db: DbPool, tenantId: UUID): Promise<number> {
  const result = await db.query(
    "SELECT count(*)::int as cnt FROM actors WHERE tenant_id = $1 AND is_active = TRUE",
    [tenantId],
  );
  return result.rows[0].cnt;
}

/**
 * Count activities created today (UTC) for a tenant.
 */
export async function countActivitiesToday(db: DbPool, tenantId: UUID): Promise<number> {
  const result = await db.query(
    "SELECT count(*)::int as cnt FROM activities WHERE tenant_id = $1 AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')",
    [tenantId],
  );
  return result.rows[0].cnt;
}

/**
 * Count active (non-terminal) assignments for a tenant.
 */
export async function countActiveAssignments(db: DbPool, tenantId: UUID): Promise<number> {
  const result = await db.query(
    "SELECT count(*)::int as cnt FROM assignments WHERE tenant_id = $1 AND status NOT IN ('completed', 'declined', 'cancelled')",
    [tenantId],
  );
  return result.rows[0].cnt;
}

/**
 * Count all context entries for a tenant.
 */
export async function countContextEntries(db: DbPool, tenantId: UUID): Promise<number> {
  const result = await db.query(
    'SELECT count(*)::int as cnt FROM context_entries WHERE tenant_id = $1',
    [tenantId],
  );
  return result.rows[0].cnt;
}
