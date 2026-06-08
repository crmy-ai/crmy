// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { Contact, Account, Opportunity, UUID } from '@crmy/shared';

export async function crmSearch(
  db: DbPool,
  tenantId: UUID,
  query: string,
  limit: number,
  ownerIds?: UUID[],
): Promise<{
  contacts: Contact[];
  accounts: Account[];
  opportunities: Opportunity[];
  activities: Record<string, unknown>[];
  useCases: Record<string, unknown>[];
  assignments: Record<string, unknown>[];
  contextEntries: Record<string, unknown>[];
}> {
  if (ownerIds) {
    return fallbackCrmSearch(db, tenantId, query, limit, ownerIds);
  }
  // ── Unified index path ────────────────────────────────────────────────────
  // Query the search_index table using PostgreSQL full-text search.
  // Falls back to direct ILIKE scans when:
  //   a) the table doesn't exist yet (migration not yet applied), or
  //   b) the index is empty (no documents indexed yet for this tenant).
  try {
    const indexResult = await db.query(
      `SELECT entity_type, entity_id, metadata,
              ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank
       FROM search_index
       WHERE tenant_id = $1
         AND search_vector @@ plainto_tsquery('english', $2)
         AND (
           (entity_type = 'contact' AND EXISTS (SELECT 1 FROM contacts c WHERE c.tenant_id = $1 AND c.id = entity_id AND c.merged_into IS NULL AND c.archived_at IS NULL))
        OR (entity_type = 'account' AND EXISTS (SELECT 1 FROM accounts a WHERE a.tenant_id = $1 AND a.id = entity_id AND a.merged_into IS NULL AND a.archived_at IS NULL))
        OR (entity_type = 'opportunity' AND EXISTS (SELECT 1 FROM opportunities o WHERE o.tenant_id = $1 AND o.id = entity_id AND o.archived_at IS NULL))
        OR (entity_type = 'use_case' AND EXISTS (SELECT 1 FROM use_cases u WHERE u.tenant_id = $1 AND u.id = entity_id AND u.archived_at IS NULL))
        OR entity_type NOT IN ('contact', 'account', 'opportunity', 'use_case')
         )
       ORDER BY rank DESC
       LIMIT $3`,
      [tenantId, query, limit * 6],  // fetch up to 6× limit so each bucket can fill
    );

    if (indexResult.rows.length > 0) {
      const contacts: Contact[] = [];
      const accounts: Account[] = [];
      const opportunities: Opportunity[] = [];
      const activities: Record<string, unknown>[] = [];
      const useCases: Record<string, unknown>[] = [];
      const assignments: Record<string, unknown>[] = [];
      const contextEntries: Record<string, unknown>[] = [];

      for (const row of indexResult.rows as { entity_type: string; entity_id: string; metadata: Record<string, unknown> }[]) {
        const entity = { ...row.metadata, id: row.entity_id };
        switch (row.entity_type) {
          case 'contact':     contacts.push(entity as unknown as Contact);     break;
          case 'account':     accounts.push(entity as unknown as Account);     break;
          case 'opportunity': opportunities.push(entity as unknown as Opportunity); break;
          case 'activity':    activities.push(entity);                         break;
          case 'use_case':    useCases.push(entity);                           break;
          case 'assignment':  assignments.push(entity);                         break;
          case 'context_entry': contextEntries.push(entity);                    break;
        }
      }

      return {
        contacts:      contacts.slice(0, limit),
        accounts:      accounts.slice(0, limit),
        opportunities: opportunities.slice(0, limit),
        activities:    activities.slice(0, limit),
        useCases:      useCases.slice(0, limit),
        assignments:   assignments.slice(0, limit),
        contextEntries: contextEntries.slice(0, limit),
      };
    }
  } catch {
    // Table not yet created (migration pending) — fall through to ILIKE.
  }

  return fallbackCrmSearch(db, tenantId, query, limit, ownerIds);
}

async function fallbackCrmSearch(
  db: DbPool,
  tenantId: UUID,
  query: string,
  limit: number,
  ownerIds?: UUID[],
): Promise<{
  contacts: Contact[];
  accounts: Account[];
  opportunities: Opportunity[];
  activities: Record<string, unknown>[];
  useCases: Record<string, unknown>[];
  assignments: Record<string, unknown>[];
  contextEntries: Record<string, unknown>[];
}> {
  // ── Direct fallback: parallel ILIKE scans ────────────────────────────────
  // Used during the migration window before search_index is populated, or when
  // a query returns zero results from the index (e.g. new tenant, no docs yet).
  const pattern = `%${query}%`;
  const ownerClause = ownerIds
    ? ownerIds.length === 0
      ? ' AND FALSE'
      : ' AND owner_id = ANY($4::uuid[])'
    : '';
  const subjectOwnerClause = ownerIds
    ? ownerIds.length === 0
      ? ' AND FALSE'
      : ` AND (
          (subject_type = 'contact' AND EXISTS (SELECT 1 FROM contacts c WHERE c.tenant_id = $1 AND c.id = subject_id AND c.owner_id = ANY($4::uuid[]) AND c.archived_at IS NULL))
       OR (subject_type = 'account' AND EXISTS (SELECT 1 FROM accounts a WHERE a.tenant_id = $1 AND a.id = subject_id AND a.owner_id = ANY($4::uuid[]) AND a.archived_at IS NULL))
       OR (subject_type = 'opportunity' AND EXISTS (SELECT 1 FROM opportunities o WHERE o.tenant_id = $1 AND o.id = subject_id AND o.owner_id = ANY($4::uuid[]) AND o.archived_at IS NULL))
       OR (subject_type = 'use_case' AND EXISTS (SELECT 1 FROM use_cases u WHERE u.tenant_id = $1 AND u.id = subject_id AND u.owner_id = ANY($4::uuid[]) AND u.archived_at IS NULL))
      )`
    : '';
  const ownerParams = ownerIds ? [tenantId, pattern, limit, ownerIds] : [tenantId, pattern, limit];

  const [contacts, accounts, opportunities, activities, useCases, assignments, contextEntries] = await Promise.all([
    db.query(
      `SELECT * FROM contacts
       WHERE tenant_id = $1
         AND merged_into IS NULL
         AND archived_at IS NULL
         AND (first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2 OR company_name ILIKE $2
              OR EXISTS (SELECT 1 FROM unnest(aliases) _a WHERE _a ILIKE $2))
         ${ownerClause}
       ORDER BY updated_at DESC LIMIT $3`,
      ownerParams,
    ),
    db.query(
      `SELECT * FROM accounts
       WHERE tenant_id = $1
         AND merged_into IS NULL
         AND archived_at IS NULL
         AND (name ILIKE $2 OR domain ILIKE $2
              OR EXISTS (SELECT 1 FROM unnest(aliases) _a WHERE _a ILIKE $2))
         ${ownerClause}
       ORDER BY updated_at DESC LIMIT $3`,
      ownerParams,
    ),
    db.query(
      `SELECT * FROM opportunities
       WHERE tenant_id = $1
         AND archived_at IS NULL
         AND name ILIKE $2
         ${ownerClause}
       ORDER BY updated_at DESC LIMIT $3`,
      ownerParams,
    ),
    db.query(
      `SELECT * FROM activities
       WHERE tenant_id = $1
         AND body ILIKE $2
         ${ownerClause}
       ORDER BY created_at DESC LIMIT $3`,
      ownerParams,
    ),
    db.query(
      `SELECT * FROM use_cases
       WHERE tenant_id = $1
         AND archived_at IS NULL
         AND (name ILIKE $2 OR description ILIKE $2)
         ${ownerClause}
       ORDER BY updated_at DESC LIMIT $3`,
      ownerParams,
    ),
    db.query(
      `SELECT * FROM assignments
       WHERE tenant_id = $1
         AND (title ILIKE $2 OR description ILIKE $2)
         ${subjectOwnerClause}
       ORDER BY created_at DESC LIMIT $3`,
      ownerParams,
    ),
    db.query(
      `SELECT * FROM context_entries
       WHERE tenant_id = $1
         AND is_current = true
         AND (title ILIKE $2 OR body ILIKE $2 OR context_type ILIKE $2
              OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) _t WHERE _t ILIKE $2))
         ${subjectOwnerClause}
       ORDER BY updated_at DESC LIMIT $3`,
      ownerParams,
    ),
  ]);

  return {
    contacts:      contacts.rows as Contact[],
    accounts:      accounts.rows as Account[],
    opportunities: opportunities.rows as Opportunity[],
    activities:    activities.rows,
    useCases:      useCases.rows,
    assignments:   assignments.rows,
    contextEntries: contextEntries.rows,
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
    db.query('SELECT health_score FROM accounts WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL', [accountId, tenantId]),
    db.query(
      `SELECT count(*)::int as count, COALESCE(SUM(amount), 0)::bigint as value
       FROM opportunities
       WHERE account_id = $1 AND tenant_id = $2 AND archived_at IS NULL AND stage NOT IN ('closed_won', 'closed_lost')`,
      [accountId, tenantId],
    ),
    db.query(
      `SELECT created_at FROM activities
       WHERE account_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [accountId, tenantId],
    ),
    db.query(
      'SELECT count(*)::int as count FROM contacts WHERE account_id = $1 AND tenant_id = $2 AND archived_at IS NULL',
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
  ownerIds?: UUID[],
): Promise<{
  contacts: number;
  accounts: number;
  opportunities: number;
  activities: number;
  open_pipeline_value: number;
}> {
  const ownerClause = ownerIds
    ? ownerIds.length === 0
      ? ' AND FALSE'
      : ' AND owner_id = ANY($2::uuid[])'
    : '';
  const params = ownerIds ? [tenantId, ownerIds] : [tenantId];
  const [contacts, accounts, opps, activities, pipeline] = await Promise.all([
    db.query(`SELECT count(*)::int as c FROM contacts WHERE tenant_id = $1 AND archived_at IS NULL${ownerClause}`, params),
    db.query(`SELECT count(*)::int as c FROM accounts WHERE tenant_id = $1 AND archived_at IS NULL${ownerClause}`, params),
    db.query(`SELECT count(*)::int as c FROM opportunities WHERE tenant_id = $1 AND archived_at IS NULL${ownerClause}`, params),
    db.query(`SELECT count(*)::int as c FROM activities WHERE tenant_id = $1${ownerClause}`, params),
    db.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint as value FROM opportunities
       WHERE tenant_id = $1 AND archived_at IS NULL AND stage NOT IN ('closed_won', 'closed_lost')${ownerClause}`,
      params,
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
