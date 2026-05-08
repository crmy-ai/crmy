// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';

const IDS = {
  ACTOR_HUMAN: 'd0000000-0000-4000-a000-000000000101',
  ACTOR_AGENT: 'd0000000-0000-4000-a000-000000000102',
  ACCOUNT: 'd0000000-0000-4000-b000-000000000101',
  CONTACT: 'd0000000-0000-4000-c000-000000000101',
  OPPORTUNITY: 'd0000000-0000-4000-d000-000000000101',
  USE_CASE: 'd0000000-0000-4000-f200-000000000101',
  ACTIVITY: 'd0000000-0000-4000-e000-000000000101',
  CONTEXT: 'd0000000-0000-4000-f000-000000000101',
  ASSIGNMENT: 'd0000000-0000-4000-f100-000000000101',
} as const;

export async function getSampleDataStatus(db: DbPool, tenantId: string) {
  const seeded = await db.query('SELECT 1 FROM accounts WHERE tenant_id = $1 AND id = $2 LIMIT 1', [tenantId, IDS.ACCOUNT]);
  const counts = await db.query(
    `SELECT
       (SELECT count(*)::int FROM accounts WHERE tenant_id = $1) as accounts,
       (SELECT count(*)::int FROM contacts WHERE tenant_id = $1) as contacts,
       (SELECT count(*)::int FROM opportunities WHERE tenant_id = $1) as opportunities,
       (SELECT count(*)::int FROM context_entries WHERE tenant_id = $1) as context_entries`,
    [tenantId],
  );
  return {
    seeded: (seeded.rowCount ?? 0) > 0,
    counts: counts.rows[0] as { accounts: number; contacts: number; opportunities: number; context_entries: number },
  };
}

export async function seedSampleData(db: DbPool, tenantId: string) {
  await db.query(
    `INSERT INTO actors (id, tenant_id, actor_type, display_name, email)
     VALUES ($1, $2, 'human', 'Sample Owner', 'owner@example.com')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACTOR_HUMAN, tenantId],
  );
  await db.query(
    `INSERT INTO actors (id, tenant_id, actor_type, display_name, agent_identifier, agent_model)
     VALUES ($1, $2, 'agent', 'Sample Research Agent', 'sample-research-agent', 'local-model')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACTOR_AGENT, tenantId],
  );
  await db.query(
    `INSERT INTO accounts (id, tenant_id, name, industry, health_score, annual_revenue, domain, website)
     VALUES ($1, $2, 'Northstar Labs', 'AI Infrastructure', 82, 250000, 'northstarlabs.example', 'https://northstarlabs.example')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACCOUNT, tenantId],
  );
  await db.query(
    `INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage)
     VALUES ($1, $2, 'Maya', 'Patel', 'maya@northstarlabs.example', 'VP Revenue Systems', $3, 'prospect')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CONTACT, tenantId, IDS.ACCOUNT],
  );
  await db.query(
    `INSERT INTO opportunities (id, tenant_id, name, account_id, contact_id, stage, amount, close_date)
     VALUES ($1, $2, 'Northstar Agent Context Rollout', $3, $4, 'prospecting', 125000, '2026-06-30')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.OPPORTUNITY, tenantId, IDS.ACCOUNT, IDS.CONTACT],
  );
  await db.query(
    `INSERT INTO use_cases (id, tenant_id, name, account_id, opportunity_id, stage, health_score, attributed_arr)
     VALUES ($1, $2, 'Agent Briefing Memory', $3, $4, 'discovery', 76, 125000)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.USE_CASE, tenantId, IDS.ACCOUNT, IDS.OPPORTUNITY],
  );
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, account_id, contact_id, opportunity_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'call', 'Discovery call with Maya Patel', 'Maya wants agents to remember account priorities, open risks, and human handoffs without re-querying the CRM every run.', $3, 'opportunity', $4, $5, $6, $4, now(), 'connected', $7)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACTIVITY, tenantId, IDS.ACTOR_HUMAN, IDS.OPPORTUNITY, IDS.ACCOUNT, IDS.CONTACT, JSON.stringify({ duration_minutes: 35, attendees: ['maya@northstarlabs.example'] })],
  );
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags)
     VALUES ($1, $2, 'account', $3, 'summary', $4, 'Agent context rollout priority', 'Northstar Labs is evaluating CRMy as the durable customer context layer for revenue agents. The main evaluation criteria are typed objects, persistent context, scoped tools, human handoffs, and retry-safe writes.', 0.92, 'sample_data', $5)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CONTEXT, tenantId, IDS.ACCOUNT, IDS.ACTOR_AGENT, JSON.stringify(['sample', 'agent-context', 'evaluation'])],
  );
  await db.query(
    `INSERT INTO assignments (id, tenant_id, title, description, assignment_type, assigned_by, assigned_to, subject_type, subject_id, status, priority, context)
     VALUES ($1, $2, 'Review Northstar briefing before next agent run', 'Confirm the sample context is sufficient for an agent to prepare a useful briefing.', 'review', $3, $4, 'account', $5, 'pending', 'normal', 'Use this sample handoff to test human review, briefing assembly, and assignment queues.')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ASSIGNMENT, tenantId, IDS.ACTOR_AGENT, IDS.ACTOR_HUMAN, IDS.ACCOUNT],
  );

  return getSampleDataStatus(db, tenantId);
}
