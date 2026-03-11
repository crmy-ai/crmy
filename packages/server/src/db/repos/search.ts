import type { DbPool } from '../pool.js';
import type { Contact, Account, Opportunity, UUID } from '@crmy/shared';

export async function crmSearch(
  db: DbPool,
  tenantId: UUID,
  query: string,
  limit: number,
): Promise<{ contacts: Contact[]; accounts: Account[]; opportunities: Opportunity[] }> {
  const pattern = `%${query}%`;

  const [contacts, accounts, opportunities] = await Promise.all([
    db.query(
      `SELECT * FROM contacts
       WHERE tenant_id = $1
         AND (first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2 OR company_name ILIKE $2)
       ORDER BY updated_at DESC LIMIT $3`,
      [tenantId, pattern, limit],
    ),
    db.query(
      `SELECT * FROM accounts
       WHERE tenant_id = $1
         AND (name ILIKE $2 OR domain ILIKE $2)
       ORDER BY updated_at DESC LIMIT $3`,
      [tenantId, pattern, limit],
    ),
    db.query(
      `SELECT * FROM opportunities
       WHERE tenant_id = $1
         AND name ILIKE $2
       ORDER BY updated_at DESC LIMIT $3`,
      [tenantId, pattern, limit],
    ),
  ]);

  return {
    contacts: contacts.rows as Contact[],
    accounts: accounts.rows as Account[],
    opportunities: opportunities.rows as Opportunity[],
  };
}

export async function getAccountHealthReport(
  db: DbPool,
  tenantId: UUID,
  accountId: UUID,
): Promise<{
  health_score: number;
  open_opps: number;
  open_opp_value: number;
  last_activity_days: number;
  contact_count: number;
  activity_count_30d: number;
}> {
  const [account, opps, lastActivity, contactCount, activityCount] = await Promise.all([
    db.query('SELECT health_score FROM accounts WHERE id = $1 AND tenant_id = $2', [accountId, tenantId]),
    db.query(
      `SELECT count(*)::int as count, COALESCE(SUM(amount), 0)::bigint as value
       FROM opportunities
       WHERE account_id = $1 AND tenant_id = $2 AND stage NOT IN ('closed_won', 'closed_lost')`,
      [accountId, tenantId],
    ),
    db.query(
      `SELECT created_at FROM activities
       WHERE account_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [accountId, tenantId],
    ),
    db.query(
      'SELECT count(*)::int as count FROM contacts WHERE account_id = $1 AND tenant_id = $2',
      [accountId, tenantId],
    ),
    db.query(
      `SELECT count(*)::int as count FROM activities
       WHERE account_id = $1 AND tenant_id = $2
         AND created_at >= now() - interval '30 days'`,
      [accountId, tenantId],
    ),
  ]);

  const lastActivityDate = lastActivity.rows[0]?.created_at;
  const daysSince = lastActivityDate
    ? Math.floor((Date.now() - new Date(lastActivityDate).getTime()) / 86400000)
    : -1;

  return {
    health_score: account.rows[0]?.health_score ?? 0,
    open_opps: opps.rows[0].count,
    open_opp_value: Number(opps.rows[0].value),
    last_activity_days: daysSince,
    contact_count: contactCount.rows[0].count,
    activity_count_30d: activityCount.rows[0].count,
  };
}

export async function getTenantStats(
  db: DbPool,
  tenantId: UUID,
): Promise<{
  contacts: number;
  accounts: number;
  opportunities: number;
  activities: number;
  open_pipeline_value: number;
}> {
  const [contacts, accounts, opps, activities, pipeline] = await Promise.all([
    db.query('SELECT count(*)::int as c FROM contacts WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT count(*)::int as c FROM accounts WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT count(*)::int as c FROM opportunities WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT count(*)::int as c FROM activities WHERE tenant_id = $1', [tenantId]),
    db.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint as value FROM opportunities
       WHERE tenant_id = $1 AND stage NOT IN ('closed_won', 'closed_lost')`,
      [tenantId],
    ),
  ]);

  return {
    contacts: contacts.rows[0].c,
    accounts: accounts.rows[0].c,
    opportunities: opps.rows[0].c,
    activities: activities.rows[0].c,
    open_pipeline_value: Number(pipeline.rows[0].value),
  };
}
