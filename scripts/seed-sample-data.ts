#!/usr/bin/env tsx
// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Seed realistic sample data for development & demos.
// Usage: DATABASE_URL=postgres://... tsx scripts/seed-sample-data.ts
//
// Creates:
//   - 2 actors (1 human rep, 1 AI agent)
//   - 3 accounts
//   - 6 contacts (spread across accounts)
//   - 3 opportunities
//   - 8 assignments in various lifecycle states
//   - 6 context entries with tags and types
//   - 6 activities

import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  const db = pool;

  // ── Get default tenant ──────────────────────────────────────────────────────
  const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
  if (tenantRes.rows.length === 0) {
    console.error('No tenant found. Run `crmy init` first.');
    process.exit(1);
  }
  const tenantId: string = tenantRes.rows[0].id;
  console.log(`Using tenant: ${tenantId}`);

  // ── Actors ──────────────────────────────────────────────────────────────────
  console.log('Seeding actors…');

  const repActor = await upsertActor(db, tenantId, {
    actor_type: 'human',
    display_name: 'Alex Rivera',
    email: 'alex@example.com',
  });

  const agentActor = await upsertActor(db, tenantId, {
    actor_type: 'agent',
    display_name: 'Outreach Agent',
    agent_identifier: 'outreach-agent-v1',
    agent_model: 'claude-sonnet-4-6',
  });

  console.log(`  Actor: ${repActor.display_name} (${repActor.id})`);
  console.log(`  Actor: ${agentActor.display_name} (${agentActor.id})`);

  // ── Accounts ─────────────────────────────────────────────────────────────────
  console.log('Seeding accounts…');

  const acme = await upsertAccount(db, tenantId, {
    name: 'Acme Corp',
    industry: 'Technology',
    website: 'https://acme.com',
    domain: 'acme.com',
    annual_revenue: 12_000_000,
    employee_count: 350,
    health_score: 82,
  });

  const globex = await upsertAccount(db, tenantId, {
    name: 'Globex Industries',
    industry: 'Manufacturing',
    website: 'https://globex.io',
    domain: 'globex.io',
    annual_revenue: 45_000_000,
    employee_count: 1200,
    health_score: 61,
  });

  const initech = await upsertAccount(db, tenantId, {
    name: 'Initech Solutions',
    industry: 'Financial Services',
    website: 'https://initech.co',
    domain: 'initech.co',
    annual_revenue: 8_000_000,
    employee_count: 120,
    health_score: 44,
  });

  console.log(`  Account: ${acme.name} (${acme.id})`);
  console.log(`  Account: ${globex.name} (${globex.id})`);
  console.log(`  Account: ${initech.name} (${initech.id})`);

  // ── Contacts ─────────────────────────────────────────────────────────────────
  console.log('Seeding contacts…');

  const sarah = await upsertContact(db, tenantId, {
    first_name: 'Sarah', last_name: 'Chen',
    email: 'sarah.chen@acme.com',
    title: 'VP of Engineering',
    company_name: 'Acme Corp',
    lifecycle_stage: 'customer',
    account_id: acme.id,
  });

  const marcus = await upsertContact(db, tenantId, {
    first_name: 'Marcus', last_name: 'Webb',
    email: 'marcus.webb@acme.com',
    title: 'CTO',
    company_name: 'Acme Corp',
    lifecycle_stage: 'customer',
    account_id: acme.id,
  });

  const priya = await upsertContact(db, tenantId, {
    first_name: 'Priya', last_name: 'Patel',
    email: 'p.patel@globex.io',
    title: 'Director of Operations',
    company_name: 'Globex Industries',
    lifecycle_stage: 'opportunity',
    account_id: globex.id,
  });

  const james = await upsertContact(db, tenantId, {
    first_name: 'James', last_name: 'Okonkwo',
    email: 'jokonkwo@globex.io',
    title: 'Head of IT',
    company_name: 'Globex Industries',
    lifecycle_stage: 'qualified',
    account_id: globex.id,
  });

  const nina = await upsertContact(db, tenantId, {
    first_name: 'Nina', last_name: 'Hartmann',
    email: 'nina@initech.co',
    title: 'CFO',
    company_name: 'Initech Solutions',
    lifecycle_stage: 'lead',
    account_id: initech.id,
  });

  const tom = await upsertContact(db, tenantId, {
    first_name: 'Tom', last_name: 'Bradley',
    email: 'tbradley@initech.co',
    title: 'Procurement Manager',
    company_name: 'Initech Solutions',
    lifecycle_stage: 'lead',
    account_id: initech.id,
  });

  const contacts = [sarah, marcus, priya, james, nina, tom];
  for (const c of contacts) {
    console.log(`  Contact: ${c.first_name} ${c.last_name} (${c.id})`);
  }

  // ── Opportunities ─────────────────────────────────────────────────────────────
  console.log('Seeding opportunities…');

  const acmeOpp = await upsertOpportunity(db, tenantId, {
    name: 'Acme Platform Expansion',
    account_id: acme.id,
    stage: 'proposal',
    amount: 240_000,
    probability: 65,
    close_date: addDays(30),
    description: 'Expanding existing platform license to cover 3 additional business units.',
  });

  const globexOpp = await upsertOpportunity(db, tenantId, {
    name: 'Globex Digital Transformation',
    account_id: globex.id,
    stage: 'qualification',
    amount: 580_000,
    probability: 40,
    close_date: addDays(90),
    description: 'Full digital transformation program across manufacturing ops.',
  });

  const initechOpp = await upsertOpportunity(db, tenantId, {
    name: 'Initech Compliance Suite',
    account_id: initech.id,
    stage: 'prospecting',
    amount: 95_000,
    probability: 20,
    close_date: addDays(120),
    description: 'Compliance automation tooling for financial reporting.',
  });

  console.log(`  Opp: ${acmeOpp.name} (${acmeOpp.id})`);
  console.log(`  Opp: ${globexOpp.name} (${globexOpp.id})`);
  console.log(`  Opp: ${initechOpp.name} (${initechOpp.id})`);

  // ── Activities ────────────────────────────────────────────────────────────────
  console.log('Seeding activities…');

  await insertActivity(db, tenantId, {
    type: 'meeting',
    subject: 'Quarterly Business Review with Acme',
    subject_type: 'account',
    subject_id: acme.id,
    performed_by: repActor.id,
    occurred_at: daysAgo(14),
    outcome: 'positive',
    description: 'Reviewed Q1 usage, discussed platform expansion needs. Sarah confirmed budget approved.',
  });

  await insertActivity(db, tenantId, {
    type: 'call',
    subject: 'Discovery call — Globex digital transformation',
    subject_type: 'contact',
    subject_id: priya.id,
    performed_by: agentActor.id,
    occurred_at: daysAgo(7),
    outcome: 'follow_up_needed',
    description: 'Initial discovery. Priya outlined operational pain points. IT approval needed from James.',
  });

  await insertActivity(db, tenantId, {
    type: 'email',
    subject: 'Sent proposal: Acme Platform Expansion',
    subject_type: 'opportunity',
    subject_id: acmeOpp.id,
    performed_by: repActor.id,
    occurred_at: daysAgo(5),
    outcome: 'neutral',
    description: 'Sent 3-tier pricing proposal. Awaiting sign-off from Marcus (CTO).',
  });

  await insertActivity(db, tenantId, {
    type: 'research',
    subject: 'Competitive intel — Globex alternatives evaluation',
    subject_type: 'account',
    subject_id: globex.id,
    performed_by: agentActor.id,
    occurred_at: daysAgo(3),
    outcome: 'positive',
    description: 'Research indicates Globex is also evaluating Competitor X. Our manufacturing module is differentiated.',
  });

  await insertActivity(db, tenantId, {
    type: 'call',
    subject: 'Cold outreach — Nina Hartmann at Initech',
    subject_type: 'contact',
    subject_id: nina.id,
    performed_by: agentActor.id,
    occurred_at: daysAgo(2),
    outcome: 'connected',
    description: 'Nina picked up. Interested in compliance automation demo. Scheduled follow-up for next week.',
  });

  await insertActivity(db, tenantId, {
    type: 'demo',
    subject: 'Platform demo — Acme engineering team',
    subject_type: 'opportunity',
    subject_id: acmeOpp.id,
    performed_by: repActor.id,
    occurred_at: daysAgo(10),
    outcome: 'positive',
    description: 'Demo to Sarah and 4 engineers. Strong reaction to API gateway feature. Minor concern about SSO.',
  });

  // ── Context Entries ───────────────────────────────────────────────────────────
  console.log('Seeding context entries…');

  await insertContextEntry(db, tenantId, repActor.id, {
    subject_type: 'account',
    subject_id: acme.id,
    context_type: 'preference',
    title: 'Contract preferences',
    body: 'Acme requires annual contracts paid upfront. Net-60 terms are a hard requirement from their finance team. Marcus Webb makes final purchase decisions but Sarah Chen is the technical champion.',
    confidence: 0.95,
    source: 'manual',
    tags: ['contract', 'finance', 'decision-maker'],
  });

  await insertContextEntry(db, tenantId, repActor.id, {
    subject_type: 'contact',
    subject_id: sarah.id,
    context_type: 'relationship_map',
    title: 'Sarah Chen — influence & relationships',
    body: 'Sarah is the primary technical champion at Acme. She has strong influence over CTO Marcus Webb. She was previously at Stripe and is familiar with modern developer tooling. Responds well to technical depth over sales pitches.',
    confidence: 0.88,
    source: 'call_transcript',
    tags: ['champion', 'technical', 'influence'],
  });

  await insertContextEntry(db, tenantId, repActor.id, {
    subject_type: 'opportunity',
    subject_id: globexOpp.id,
    context_type: 'objection',
    title: 'Integration complexity concern',
    body: 'Priya raised concerns about integrating with their existing SAP environment. James from IT echoed this. They need a clear migration path and ideally a professional services estimate before moving to proposal stage.',
    confidence: 0.9,
    source: 'call_transcript',
    tags: ['objection', 'integration', 'sap', 'blocker'],
  });

  await insertContextEntry(db, tenantId, agentActor.id, {
    subject_type: 'account',
    subject_id: globex.id,
    context_type: 'competitive_intel',
    title: 'Competitor X evaluation at Globex',
    body: 'Agent research indicates Globex is evaluating Competitor X alongside us. Competitor X has stronger ERP connectors but weaker analytics. Our manufacturing ops module and real-time dashboards are clear differentiators to emphasize.',
    confidence: 0.72,
    source: 'agent_research',
    tags: ['competitive', 'competitor-x', 'differentiator'],
  });

  await insertContextEntry(db, tenantId, repActor.id, {
    subject_type: 'contact',
    subject_id: nina.id,
    context_type: 'note',
    title: 'Initial call notes — Nina Hartmann',
    body: 'Nina is the CFO and is primarily concerned with audit trail and regulatory compliance (SOX). She mentioned their current solution is an Excel-based process. Pain is real. Budget: ~$100K range confirmed verbally. Decision timeline: Q2.',
    confidence: 1.0,
    source: 'manual',
    tags: ['cfr', 'compliance', 'budget', 'timeline'],
  });

  await insertContextEntry(db, tenantId, agentActor.id, {
    subject_type: 'opportunity',
    subject_id: acmeOpp.id,
    context_type: 'summary',
    title: 'Deal summary — Acme Platform Expansion',
    body: 'Strong deal. Budget approved ($240K range). Technical champion Sarah Chen on board. Pending CTO sign-off from Marcus Webb on SSO question. Send SSO architecture doc by EOW. Expected close: 30 days.',
    confidence: 0.92,
    source: 'agent_reasoning',
    tags: ['deal-summary', 'next-steps', 'sso'],
  });

  // ── Assignments ───────────────────────────────────────────────────────────────
  console.log('Seeding assignments…');

  // 1. Pending — agent created, waiting for rep to accept
  await insertAssignment(db, tenantId, {
    title: 'Send SSO architecture doc to Marcus Webb',
    description: 'Marcus raised SSO concerns during the demo. Send the architecture overview and schedule a 30-min technical call to address it.',
    assignment_type: 'send',
    assigned_by: agentActor.id,
    assigned_to: repActor.id,
    subject_type: 'opportunity',
    subject_id: acmeOpp.id,
    priority: 'urgent',
    status: 'pending',
    context: 'This is the last blocker before Acme moves to negotiation. CTO Marcus Webb needs SSO clarity before sign-off.',
    due_at: addDays(3),
  });

  // 2. Accepted — rep acknowledged but not started
  await insertAssignment(db, tenantId, {
    title: 'Schedule discovery call with James Okonkwo (Globex IT)',
    description: 'James is the IT gatekeeper for the Globex deal. Need to address integration concerns with their SAP environment directly with him.',
    assignment_type: 'call',
    assigned_by: agentActor.id,
    assigned_to: repActor.id,
    subject_type: 'contact',
    subject_id: james.id,
    priority: 'high',
    status: 'accepted',
    context: 'Priya confirmed James needs to approve the SAP integration path before budget can be unlocked.',
  });

  // 3. In progress — rep is actively working on it
  await insertAssignment(db, tenantId, {
    title: 'Prepare professional services estimate for Globex',
    description: 'Globex needs a PS estimate for the SAP migration before moving forward. Include onboarding + 90-day support package.',
    assignment_type: 'draft',
    assigned_by: repActor.id,
    assigned_to: repActor.id,
    subject_type: 'opportunity',
    subject_id: globexOpp.id,
    priority: 'high',
    status: 'in_progress',
    context: 'This unblocks the qualification → proposal stage gate. Priya expects it by end of week.',
    due_at: addDays(2),
  });

  // 4. Blocked — waiting on external dependency
  await insertAssignment(db, tenantId, {
    title: 'Get legal to review Initech contract terms',
    description: 'Nina wants net-90 terms which require legal review. Submitted ticket to legal team — waiting on their response.',
    assignment_type: 'review',
    assigned_by: repActor.id,
    assigned_to: repActor.id,
    subject_type: 'opportunity',
    subject_id: initechOpp.id,
    priority: 'normal',
    status: 'blocked',
    context: 'Legal team has a 5-day SLA. Submitted 2 days ago. Following up.',
  });

  // 5. Completed — done deal
  await insertAssignment(db, tenantId, {
    title: 'Run competitive analysis on Globex alternatives',
    description: 'Research what other vendors Globex is evaluating and identify our differentiation.',
    assignment_type: 'research',
    assigned_by: repActor.id,
    assigned_to: agentActor.id,
    subject_type: 'account',
    subject_id: globex.id,
    priority: 'normal',
    status: 'completed',
    context: 'Results stored as context entry on Globex account.',
  });

  // 6. Pending — follow up with Tom Bradley (procurement)
  await insertAssignment(db, tenantId, {
    title: 'Follow up with Tom Bradley — procurement requirements',
    description: 'Tom Bradley manages procurement at Initech. Need to understand their vendor approval process and security questionnaire requirements.',
    assignment_type: 'follow_up',
    assigned_by: agentActor.id,
    assigned_to: repActor.id,
    subject_type: 'contact',
    subject_id: tom.id,
    priority: 'normal',
    status: 'pending',
    due_at: addDays(7),
  });

  // 7. In progress — agent doing outreach research
  await insertAssignment(db, tenantId, {
    title: 'Research Nina Hartmann\'s compliance background',
    description: 'Gather intel on Nina\'s past compliance initiatives, LinkedIn activity, and Initech\'s regulatory filing history to personalize our outreach.',
    assignment_type: 'research',
    assigned_by: repActor.id,
    assigned_to: agentActor.id,
    subject_type: 'contact',
    subject_id: nina.id,
    priority: 'low',
    status: 'in_progress',
  });

  // 8. Accepted — prep for QBR
  await insertAssignment(db, tenantId, {
    title: 'Prepare Acme QBR slide deck for next quarter',
    description: 'Build the Q2 QBR deck for Acme. Include usage stats, expansion ROI projections, and roadmap preview.',
    assignment_type: 'draft',
    assigned_by: repActor.id,
    assigned_to: repActor.id,
    subject_type: 'account',
    subject_id: acme.id,
    priority: 'normal',
    status: 'accepted',
    due_at: addDays(21),
  });

  console.log('');
  console.log('✓ Sample data seeded successfully!');
  console.log('');
  console.log('Summary:');
  console.log('  Actors:       2 (1 human rep, 1 AI agent)');
  console.log('  Accounts:     3 (Acme Corp, Globex Industries, Initech Solutions)');
  console.log('  Contacts:     6');
  console.log('  Opportunities: 3');
  console.log('  Activities:   6');
  console.log('  Context:      6 entries with tags');
  console.log('  Assignments:  8 (across all lifecycle states)');
  console.log('');
  console.log('Login and visit /app to see the data.');

  await pool.end();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

async function upsertActor(db: pg.Pool, tenantId: string, data: {
  actor_type: string;
  display_name: string;
  email?: string;
  agent_identifier?: string;
  agent_model?: string;
}) {
  // Check for existing by email or agent_identifier
  if (data.email) {
    const existing = await db.query(
      'SELECT * FROM actors WHERE tenant_id = $1 AND email = $2',
      [tenantId, data.email],
    );
    if (existing.rows.length > 0) return existing.rows[0];
  }
  if (data.agent_identifier) {
    const existing = await db.query(
      'SELECT * FROM actors WHERE tenant_id = $1 AND agent_identifier = $2',
      [tenantId, data.agent_identifier],
    );
    if (existing.rows.length > 0) return existing.rows[0];
  }

  const res = await db.query(
    `INSERT INTO actors (tenant_id, actor_type, display_name, email, agent_identifier, agent_model)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tenantId, data.actor_type, data.display_name, data.email ?? null, data.agent_identifier ?? null, data.agent_model ?? null],
  );
  return res.rows[0];
}

async function upsertAccount(db: pg.Pool, tenantId: string, data: {
  name: string;
  industry?: string;
  website?: string;
  domain?: string;
  annual_revenue?: number;
  employee_count?: number;
  health_score?: number;
}) {
  const existing = await db.query(
    'SELECT * FROM accounts WHERE tenant_id = $1 AND name = $2',
    [tenantId, data.name],
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const res = await db.query(
    `INSERT INTO accounts (tenant_id, name, industry, website, domain, annual_revenue, employee_count, health_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [tenantId, data.name, data.industry ?? null, data.website ?? null, data.domain ?? null,
     data.annual_revenue ?? null, data.employee_count ?? null, data.health_score ?? 0],
  );
  return res.rows[0];
}

async function upsertContact(db: pg.Pool, tenantId: string, data: {
  first_name: string;
  last_name?: string;
  email?: string;
  title?: string;
  company_name?: string;
  lifecycle_stage?: string;
  account_id?: string;
}) {
  if (data.email) {
    const existing = await db.query(
      'SELECT * FROM contacts WHERE tenant_id = $1 AND email = $2',
      [tenantId, data.email],
    );
    if (existing.rows.length > 0) return existing.rows[0];
  }

  const res = await db.query(
    `INSERT INTO contacts (tenant_id, first_name, last_name, email, title, company_name, lifecycle_stage, account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [tenantId, data.first_name, data.last_name ?? null, data.email ?? null, data.title ?? null,
     data.company_name ?? null, data.lifecycle_stage ?? 'lead', data.account_id ?? null],
  );
  return res.rows[0];
}

async function upsertOpportunity(db: pg.Pool, tenantId: string, data: {
  name: string;
  account_id?: string;
  stage?: string;
  amount?: number;
  probability?: number;
  close_date?: string;
  description?: string;
}) {
  const existing = await db.query(
    'SELECT * FROM opportunities WHERE tenant_id = $1 AND name = $2',
    [tenantId, data.name],
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const res = await db.query(
    `INSERT INTO opportunities (tenant_id, name, account_id, stage, amount, probability, close_date, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [tenantId, data.name, data.account_id ?? null, data.stage ?? 'prospecting',
     data.amount ?? null, data.probability ?? 0, data.close_date ?? null, data.description ?? null],
  );
  return res.rows[0];
}

async function insertActivity(db: pg.Pool, tenantId: string, data: {
  type: string;
  subject: string;
  subject_type?: string;
  subject_id?: string;
  performed_by?: string;
  occurred_at?: string;
  outcome?: string;
  description?: string;
}) {
  // Skip if activity with same subject already exists for this tenant
  const existing = await db.query(
    `SELECT id FROM activities WHERE tenant_id = $1 AND subject = $2 LIMIT 1`,
    [tenantId, data.subject],
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const res = await db.query(
    `INSERT INTO activities (tenant_id, type, subject, body, subject_type, subject_id, performed_by, occurred_at, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [tenantId, data.type, data.subject, data.description ?? null, data.subject_type ?? null,
     data.subject_id ?? null, data.performed_by ?? null, data.occurred_at ?? new Date().toISOString(), data.outcome ?? null],
  );
  return res.rows[0];
}

async function insertContextEntry(db: pg.Pool, tenantId: string, authoredBy: string, data: {
  subject_type: string;
  subject_id: string;
  context_type: string;
  title?: string;
  body: string;
  confidence?: number;
  source?: string;
  tags?: string[];
}) {
  // Skip if a current entry of this type already exists for this subject
  const existing = await db.query(
    `SELECT id FROM context_entries
     WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
       AND context_type = $4 AND is_current = true AND title = $5`,
    [tenantId, data.subject_type, data.subject_id, data.context_type, data.title ?? null],
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const res = await db.query(
    `INSERT INTO context_entries
       (tenant_id, subject_type, subject_id, context_type, title, body, confidence, source, authored_by, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [tenantId, data.subject_type, data.subject_id, data.context_type, data.title ?? null,
     data.body, data.confidence ?? null, data.source ?? 'manual', authoredBy,
     JSON.stringify(data.tags ?? [])],
  );
  return res.rows[0];
}

async function insertAssignment(db: pg.Pool, tenantId: string, data: {
  title: string;
  description?: string;
  assignment_type: string;
  assigned_by: string;
  assigned_to: string;
  subject_type: string;
  subject_id: string;
  priority: string;
  status: string;
  context?: string;
  due_at?: string;
}) {
  // Skip if assignment with same title already exists
  const existing = await db.query(
    `SELECT id FROM assignments WHERE tenant_id = $1 AND title = $2`,
    [tenantId, data.title],
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const res = await db.query(
    `INSERT INTO assignments
       (tenant_id, title, description, assignment_type, assigned_by, assigned_to,
        subject_type, subject_id, priority, status, context, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [tenantId, data.title, data.description ?? null, data.assignment_type,
     data.assigned_by, data.assigned_to, data.subject_type, data.subject_id,
     data.priority, data.status, data.context ?? null, data.due_at ?? null],
  );
  return res.rows[0];
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
