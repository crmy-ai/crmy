#!/usr/bin/env tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CRMy.ai
//
// Seeds rich, realistic demo data for developer onboarding.
// Idempotent — safe to run multiple times (uses INSERT ... ON CONFLICT DO NOTHING).
//
// Usage:
//   DATABASE_URL=postgres://... tsx scripts/seed-demo.ts
//   DATABASE_URL=postgres://... tsx scripts/seed-demo.ts --reset

import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const RESET = process.argv.includes('--reset');
const pool = new Pool({ connectionString: DATABASE_URL });

// ── Stable UUIDs ────────────────────────────────────────────────────────────────
// Every ID is hardcoded so seeds are reproducible and recipes can reference them.

const IDS = {
  // Actors
  ACTOR_CODY:       'd0000000-0000-4000-a000-000000000001',
  ACTOR_SARAH_R:    'd0000000-0000-4000-a000-000000000002',
  ACTOR_OUTREACH:   'd0000000-0000-4000-a000-000000000003',
  ACTOR_RESEARCH:   'd0000000-0000-4000-a000-000000000004',
  // Accounts
  ACCT_ACME:        'd0000000-0000-4000-b000-000000000001',
  ACCT_BRIGHTSIDE:  'd0000000-0000-4000-b000-000000000002',
  ACCT_VERTEX:      'd0000000-0000-4000-b000-000000000003',
  // Contacts
  CT_SARAH_CHEN:    'd0000000-0000-4000-c000-000000000001',
  CT_MARCUS_WEBB:   'd0000000-0000-4000-c000-000000000002',
  CT_PRIYA_NAIR:    'd0000000-0000-4000-c000-000000000003',
  CT_JORDAN_LIU:    'd0000000-0000-4000-c000-000000000004',
  CT_TOMAS_RIVERA:  'd0000000-0000-4000-c000-000000000005',
  CT_KEIKO_YAMAMOTO:'d0000000-0000-4000-c000-000000000006',
  // Opportunities
  OPP_ACME:         'd0000000-0000-4000-d000-000000000001',
  OPP_BRIGHTSIDE:   'd0000000-0000-4000-d000-000000000002',
  OPP_VERTEX:       'd0000000-0000-4000-d000-000000000003',
  // Activities
  ACT_1:            'd0000000-0000-4000-e000-000000000001',
  ACT_2:            'd0000000-0000-4000-e000-000000000002',
  ACT_3:            'd0000000-0000-4000-e000-000000000003',
  ACT_4:            'd0000000-0000-4000-e000-000000000004',
  ACT_5:            'd0000000-0000-4000-e000-000000000005',
  ACT_6:            'd0000000-0000-4000-e000-000000000006',
  ACT_7:            'd0000000-0000-4000-e000-000000000007',
  ACT_8:            'd0000000-0000-4000-e000-000000000008',
  ACT_9:            'd0000000-0000-4000-e000-000000000009',
  ACT_10:           'd0000000-0000-4000-e000-000000000010',
  // Context entries
  CTX_1:            'd0000000-0000-4000-f000-000000000001',
  CTX_2:            'd0000000-0000-4000-f000-000000000002',
  CTX_3:            'd0000000-0000-4000-f000-000000000003',
  CTX_4:            'd0000000-0000-4000-f000-000000000004',
  CTX_5:            'd0000000-0000-4000-f000-000000000005',
  CTX_6:            'd0000000-0000-4000-f000-000000000006',
  CTX_7:            'd0000000-0000-4000-f000-000000000007',
  CTX_8:            'd0000000-0000-4000-f000-000000000008',
  CTX_9:            'd0000000-0000-4000-f000-000000000009',
  CTX_10:           'd0000000-0000-4000-f000-000000000010',
  CTX_11:           'd0000000-0000-4000-f000-000000000011',
  CTX_12:           'd0000000-0000-4000-f000-000000000012',
  // Assignments
  ASSIGN_1:         'd0000000-0000-4000-f100-000000000001',
  ASSIGN_2:         'd0000000-0000-4000-f100-000000000002',
  ASSIGN_3:         'd0000000-0000-4000-f100-000000000003',
} as const;

// ── Helpers ─────────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const db = pool;

  // Get default tenant
  const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
  if (tenantRes.rows.length === 0) {
    console.error('No tenant found. Run `crmy init` first.');
    process.exit(1);
  }
  const tenantId: string = tenantRes.rows[0].id;

  if (RESET) {
    console.log('Resetting demo data…');
    const demoIds = Object.values(IDS);
    // Delete in dependency order
    await db.query(`DELETE FROM assignments WHERE id = ANY($1::uuid[])`, [demoIds]);
    await db.query(`DELETE FROM context_entries WHERE id = ANY($1::uuid[])`, [demoIds]);
    await db.query(`DELETE FROM activities WHERE id = ANY($1::uuid[])`, [demoIds]);
    await db.query(`DELETE FROM opportunities WHERE id = ANY($1::uuid[])`, [demoIds]);
    await db.query(`DELETE FROM contacts WHERE id = ANY($1::uuid[])`, [demoIds]);
    await db.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[])`, [demoIds]);
    await db.query(`DELETE FROM actors WHERE id = ANY($1::uuid[])`, [demoIds]);
    console.log('  Demo data cleared.\n');
  }

  // ── Actors (4) ──────────────────────────────────────────────────────────────
  console.log('Seeding actors…');

  await db.query(
    `INSERT INTO actors (id, tenant_id, actor_type, display_name, email)
     VALUES ($1, $2, 'human', 'Cody Harris', 'cody@crmy.ai')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACTOR_CODY, tenantId],
  );
  await db.query(
    `INSERT INTO actors (id, tenant_id, actor_type, display_name, email)
     VALUES ($1, $2, 'human', 'Sarah Reeves', 'sarah@crmy.ai')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACTOR_SARAH_R, tenantId],
  );
  await db.query(
    `INSERT INTO actors (id, tenant_id, actor_type, display_name, email, agent_identifier, agent_model)
     VALUES ($1, $2, 'agent', 'Outreach Agent', NULL, 'outreach-v1', 'claude-sonnet-4-20250514')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACTOR_OUTREACH, tenantId],
  );
  await db.query(
    `INSERT INTO actors (id, tenant_id, actor_type, display_name, email, agent_identifier, agent_model)
     VALUES ($1, $2, 'agent', 'Research Agent', NULL, 'research-v1', 'claude-sonnet-4-20250514')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACTOR_RESEARCH, tenantId],
  );
  console.log('  4 actors (2 humans, 2 agents)');

  // ── Accounts (3) ────────────────────────────────────────────────────────────
  console.log('Seeding accounts…');

  await db.query(
    `INSERT INTO accounts (id, tenant_id, name, industry, health_score, annual_revenue, domain, website)
     VALUES ($1, $2, 'Acme Corp', 'SaaS', 72, 180000, 'acme.com', 'https://acme.com')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACCT_ACME, tenantId],
  );
  await db.query(
    `INSERT INTO accounts (id, tenant_id, name, industry, health_score, annual_revenue, domain, website)
     VALUES ($1, $2, 'Brightside Health', 'Healthcare', 45, 96000, 'brightsidehealth.com', 'https://brightsidehealth.com')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACCT_BRIGHTSIDE, tenantId],
  );
  await db.query(
    `INSERT INTO accounts (id, tenant_id, name, industry, health_score, annual_revenue, domain, website)
     VALUES ($1, $2, 'Vertex Logistics', 'Logistics', 88, 240000, 'vertex.io', 'https://vertex.io')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACCT_VERTEX, tenantId],
  );
  console.log('  3 accounts');

  // ── Contacts (6) ────────────────────────────────────────────────────────────
  console.log('Seeding contacts…');

  // Acme Corp contacts
  await db.query(
    `INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage)
     VALUES ($1, $2, 'Sarah', 'Chen', 'sarah.chen@acme.com', 'VP Engineering', $3, 'prospect')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CT_SARAH_CHEN, tenantId, IDS.ACCT_ACME],
  );
  await db.query(
    `INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage)
     VALUES ($1, $2, 'Marcus', 'Webb', 'marcus.webb@acme.com', 'CFO', $3, 'prospect')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CT_MARCUS_WEBB, tenantId, IDS.ACCT_ACME],
  );

  // Brightside Health contacts
  await db.query(
    `INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage)
     VALUES ($1, $2, 'Priya', 'Nair', 'p.nair@brightsidehealth.com', 'CTO', $3, 'active')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CT_PRIYA_NAIR, tenantId, IDS.ACCT_BRIGHTSIDE],
  );
  await db.query(
    `INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage)
     VALUES ($1, $2, 'Jordan', 'Liu', 'j.liu@brightsidehealth.com', 'RevOps Lead', $3, 'active')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CT_JORDAN_LIU, tenantId, IDS.ACCT_BRIGHTSIDE],
  );

  // Vertex Logistics contacts
  await db.query(
    `INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage)
     VALUES ($1, $2, 'Tomás', 'Rivera', 't.rivera@vertex.io', 'Head of Sales Ops', $3, 'champion')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CT_TOMAS_RIVERA, tenantId, IDS.ACCT_VERTEX],
  );
  await db.query(
    `INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage)
     VALUES ($1, $2, 'Keiko', 'Yamamoto', 'k.yamamoto@vertex.io', 'CEO', $3, 'champion')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CT_KEIKO_YAMAMOTO, tenantId, IDS.ACCT_VERTEX],
  );
  console.log('  6 contacts');

  // ── Opportunities (3) ───────────────────────────────────────────────────────
  console.log('Seeding opportunities…');

  await db.query(
    `INSERT INTO opportunities (id, tenant_id, name, account_id, stage, amount, close_date)
     VALUES ($1, $2, 'Acme Corp Enterprise Deal', $3, 'Discovery', 180000, '2026-06-30')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.OPP_ACME, tenantId, IDS.ACCT_ACME],
  );
  await db.query(
    `INSERT INTO opportunities (id, tenant_id, name, account_id, stage, amount, close_date)
     VALUES ($1, $2, 'Brightside Health Platform Deal', $3, 'PoC', 96000, '2026-05-15')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.OPP_BRIGHTSIDE, tenantId, IDS.ACCT_BRIGHTSIDE],
  );
  await db.query(
    `INSERT INTO opportunities (id, tenant_id, name, account_id, stage, amount, close_date)
     VALUES ($1, $2, 'Vertex Logistics Expansion', $3, 'Negotiation', 240000, '2026-04-30')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.OPP_VERTEX, tenantId, IDS.ACCT_VERTEX],
  );
  console.log('  3 opportunities');

  // ── Activities (10) ─────────────────────────────────────────────────────────
  console.log('Seeding activities…');

  // 1. Outreach email from outreach-agent to Sarah Chen, 14 days ago
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'outreach_email', 'Initial outreach to Sarah Chen', 'Personalized email introducing CRMy platform capabilities and requesting a discovery call. Referenced their recent Series B and scaling challenges mentioned in their engineering blog.', $3, 'contact', $4, $5, 'replied', $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACT_1, tenantId, IDS.ACTOR_OUTREACH, IDS.CT_SARAH_CHEN, daysAgo(14),
     JSON.stringify({ to: 'sarah.chen@acme.com', subject: 'Scaling your sales ops after Series B', channel: 'email' })],
  );

  // 2. Discovery meeting with Sarah Chen + Marcus Webb, 10 days ago
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, related_type, related_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'meeting_held', 'Discovery call — Acme Corp', 'Discussed current pain points with Salesforce: slow API, no agent integration, manual data entry consuming 15 hrs/week across the sales team. Sarah is the champion. Marcus asked pointed questions about 6-month ROI and referenced a failed Salesforce implementation in 2023. Need to lead with concrete case studies next time.', $3, 'opportunity', $4, 'account', $5, $6, 'completed', $7)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACT_2, tenantId, IDS.ACTOR_CODY, IDS.OPP_ACME, IDS.ACCT_ACME, daysAgo(10),
     JSON.stringify({ duration_minutes: 45, attendees: ['sarah.chen@acme.com', 'marcus.webb@acme.com', 'cody@crmy.ai'] })],
  );

  // 3. Proposal drafted by outreach-agent for Acme, 7 days ago
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'proposal_drafted', 'Draft proposal for Acme Corp Enterprise Deal', 'Generated initial proposal with three tiers: Starter ($1,500/mo), Growth ($3,000/mo), Enterprise (custom). Included ROI projections based on their 15 hrs/week manual data entry estimate and the Vertex case study showing 40% ramp reduction.', $3, 'opportunity', $4, $5, 'completed', $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACT_3, tenantId, IDS.ACTOR_OUTREACH, IDS.OPP_ACME, daysAgo(7),
     JSON.stringify({ document_type: 'proposal', version: 'v1-draft', sections: ['executive_summary', 'roi_analysis', 'pricing', 'implementation_timeline'] })],
  );

  // 4. Research completed on Brightside Health, 5 days ago
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'research_completed', 'Deep research on Brightside Health', 'Compiled competitive landscape, org chart, recent funding (Series C, $45M in Oct 2025), and technology stack analysis. Brightside is currently evaluating HubSpot and Attio. Their CTO Dr. Priya Nair has a strong preference for API-first tools — she published a blog post in January about "the death of GUI-first SaaS." Key risk: they have an incumbent Salesforce contract expiring in August 2026.', $3, 'account', $4, $5, 'completed', $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACT_4, tenantId, IDS.ACTOR_RESEARCH, IDS.ACCT_BRIGHTSIDE, daysAgo(5),
     JSON.stringify({ sources: ['crunchbase', 'linkedin', 'company_blog', 'g2_reviews'], findings_count: 8 })],
  );

  // 5. Outreach call to Dr. Priya Nair, 3 days ago
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'outreach_call', 'Follow-up call to Dr. Priya Nair', 'Attempted direct call to discuss MCP-native architecture and API-first approach. Went to voicemail. Left a 90-second message highlighting the open-source model and self-hosting capability — points that align with her published preferences for developer-controlled infrastructure.', $3, 'contact', $4, $5, 'voicemail', $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACT_5, tenantId, IDS.ACTOR_CODY, IDS.CT_PRIYA_NAIR, daysAgo(3),
     JSON.stringify({ duration_minutes: 2, phone: '+1-555-0147', voicemail_left: true })],
  );

  // 6. Meeting scheduled for Vertex Logistics, 2 days ago
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'meeting_scheduled', 'Executive alignment call — Vertex Logistics', 'Scheduled 30-minute call with Keiko Yamamoto (CEO) and Tomás Rivera for next week. Tomás has given internal approval but Keiko needs to sign off on the annual commitment. Prepared deck with usage metrics from the PoC and the 40% ramp reduction case study.', $3, 'opportunity', $4, $5, 'scheduled', $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACT_6, tenantId, IDS.ACTOR_OUTREACH, IDS.OPP_VERTEX, daysAgo(2),
     JSON.stringify({ meeting_date: daysFromNow(5), duration_minutes: 30, attendees: ['k.yamamoto@vertex.io', 't.rivera@vertex.io', 'cody@crmy.ai'] })],
  );

  // 7. Stage change on Vertex opportunity, 1 day ago
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'stage_change', 'Vertex Logistics → Negotiation', 'Advanced deal from Qualification to Negotiation after Tomás confirmed budget approval and timeline alignment. The PoC exceeded their throughput targets by 22%. Remaining gate: Keiko sign-off on annual commitment terms.', $3, 'opportunity', $4, $5, 'completed', $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACT_7, tenantId, IDS.ACTOR_CODY, IDS.OPP_VERTEX, daysAgo(1),
     JSON.stringify({ from_stage: 'Qualification', to_stage: 'Negotiation' })],
  );

  // 8. Email follow-up to Jordan Liu at Brightside, 4 days ago
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'outreach_email', 'Technical deep-dive request to Jordan Liu', 'Sent follow-up to Jordan Liu (RevOps Lead) with API documentation and a sandbox environment link. Jordan had expressed interest in the MCP integration after seeing the research agent demo. Positioned the email around their specific pain point: manual pipeline updates taking 4 hrs/week.', $3, 'contact', $4, $5, 'opened', $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACT_8, tenantId, IDS.ACTOR_OUTREACH, IDS.CT_JORDAN_LIU, daysAgo(4),
     JSON.stringify({ to: 'j.liu@brightsidehealth.com', subject: 'CRMy sandbox access + MCP integration docs', channel: 'email' })],
  );

  // 9. Internal review of Acme proposal, 6 days ago
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'review', 'Internal review of Acme Corp proposal', 'Reviewed the draft proposal with Sarah Reeves. Identified three areas for revision: (1) ROI section needs the Vertex case study instead of generic projections — Marcus will not accept theoretical numbers; (2) implementation timeline should show 2-week pilot, not 4-week; (3) add a section on data migration from Salesforce since that was raised as a concern.', $3, 'opportunity', $4, $5, 'completed', $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACT_9, tenantId, IDS.ACTOR_SARAH_R, IDS.OPP_ACME, daysAgo(6),
     JSON.stringify({ reviewers: ['sarah@crmy.ai', 'cody@crmy.ai'], revision_items: 3 })],
  );

  // 10. Research on Vertex competitive landscape, 8 days ago
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'research_completed', 'Competitive analysis — Vertex Logistics account', 'Vertex is currently using a custom-built CRM on top of Airtable with Zapier integrations. Pain points: no API for their AI agents, data sync issues between Airtable and their warehouse management system, and a 3-person ops team spending 20 hrs/week on manual updates. Their main alternative under consideration is Attio, but Attio lacks the MCP integration that Tomás specifically requested.', $3, 'account', $4, $5, 'completed', $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ACT_10, tenantId, IDS.ACTOR_RESEARCH, IDS.ACCT_VERTEX, daysAgo(8),
     JSON.stringify({ sources: ['linkedin', 'company_website', 'glassdoor', 'g2_reviews'], findings_count: 5 })],
  );

  console.log('  10 activities');

  // ── Context Entries (12) ────────────────────────────────────────────────────
  console.log('Seeding context entries…');

  // 1. Objection — Acme (high confidence)
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags)
     VALUES ($1, $2, 'account', $3, 'objection', $4, 'CFO skeptical of ROI timeline', 'CFO Marcus Webb is skeptical about 6-month ROI claims — referenced a failed Salesforce implementation in 2023 that took 14 months to break even instead of the promised 6. He explicitly said "I will not sign off on anything that leads with theoretical projections." Approach with concrete case studies from similar-sized SaaS companies, not projections. The Vertex case study (40% ramp reduction in 90 days) is the strongest proof point we have.', 0.95, 'discovery_call', $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_1, tenantId, IDS.ACCT_ACME, IDS.ACTOR_CODY, daysFromNow(60),
     JSON.stringify(['roi', 'cfo', 'salesforce-migration'])],
  );

  // 2. Objection — Brightside (moderate confidence)
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags)
     VALUES ($1, $2, 'account', $3, 'objection', $4, 'Concern about vendor lock-in with proprietary MCP', 'Dr. Nair raised concerns about MCP being a proprietary protocol controlled by Anthropic. She asked specifically whether CRMy would work with non-Anthropic models and whether the MCP specification is truly open. She mentioned her team evaluated and rejected three vendors last year because of proprietary lock-in. This objection can likely be addressed by showing the open-source MCP spec and demonstrating multi-model support, but we have not had the opportunity to do so yet.', 0.7, 'research', $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_2, tenantId, IDS.ACCT_BRIGHTSIDE, IDS.ACTOR_RESEARCH, daysFromNow(30),
     JSON.stringify(['lock-in', 'open-source', 'mcp'])],
  );

  // 3. Competitive intel — current (Brightside)
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags)
     VALUES ($1, $2, 'account', $3, 'competitive_intel', $4, 'Brightside evaluating HubSpot and Attio', 'Brightside Health is actively evaluating HubSpot (Enterprise tier, $3,600/mo) and Attio (Growth plan, $1,200/mo) alongside CRMy. Jordan Liu (RevOps Lead) mentioned in a LinkedIn post that they are "looking for a CRM that their AI agents can actually use." HubSpot is the incumbent preferred by their marketing team; Attio is preferred by engineering. Neither has MCP support. Our differentiator is the open-source, self-hosted model with native MCP — Dr. Nair values infrastructure control.', 0.85, 'linkedin_research', $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_3, tenantId, IDS.ACCT_BRIGHTSIDE, IDS.ACTOR_RESEARCH, daysFromNow(45),
     JSON.stringify(['hubspot', 'attio', 'competitive'])],
  );

  // 4. Competitive intel — stale (Vertex, valid_until in the past)
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags)
     VALUES ($1, $2, 'account', $3, 'competitive_intel', $4, 'Vertex considering Attio as alternative', 'Vertex Logistics was evaluating Attio as a potential CRM replacement for their Airtable setup. Tomás Rivera mentioned in early discussions that Attio''s API was "close to what they need" but lacked MCP integration. This intelligence is from initial conversations and may be outdated — Tomás has since expressed strong preference for CRMy after the PoC results.', 0.6, 'initial_call', $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_4, tenantId, IDS.ACCT_VERTEX, IDS.ACTOR_CODY, daysAgo(10).slice(0, 10),
     JSON.stringify(['attio', 'competitive', 'airtable'])],
  );

  // 5. Preference — Sarah Chen communication style
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags)
     VALUES ($1, $2, 'contact', $3, 'preference', $4, 'Sarah Chen communication preferences', 'Sarah Chen prefers async communication (Slack or email) over calls. She responds fastest to technical content — architecture diagrams, API documentation, and code examples. Avoid scheduling calls before 10am PT. She is the internal champion at Acme and will advocate for CRMy if given the right materials to share with her team. Send her technical deep-dives she can forward to her engineering leads.', 0.9, 'observation', $5)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_5, tenantId, IDS.CT_SARAH_CHEN, IDS.ACTOR_OUTREACH,
     JSON.stringify(['communication', 'async', 'technical'])],
  );

  // 6. Preference — Marcus Webb decision-making style
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags)
     VALUES ($1, $2, 'contact', $3, 'preference', $4, 'Marcus Webb decision-making style', 'Marcus Webb makes decisions based on quantitative data and peer references, not product demos. He explicitly asked for "three CFOs I can call who switched from Salesforce to CRMy." He respects brevity — his emails average 2 sentences. Do not send him long-form content. Lead every communication with a specific number or case study result. He has final budget authority but defers to Sarah on technical evaluation.', 0.85, 'discovery_call', $5)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_6, tenantId, IDS.CT_MARCUS_WEBB, IDS.ACTOR_CODY,
     JSON.stringify(['decision-maker', 'data-driven', 'brevity'])],
  );

  // 7. Relationship map — Acme Corp
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags)
     VALUES ($1, $2, 'account', $3, 'relationship_map', $4, 'Acme Corp internal dynamics', 'Sarah Chen (VP Engineering) is the champion — she initiated the CRMy evaluation and has been driving the technical review. Marcus Webb (CFO) is the economic buyer and final decision maker. Marcus is skeptical but respects Sarah''s technical judgment. There is a third stakeholder we have not yet engaged: their VP Sales (name unknown) who would be the primary end user. Sarah mentioned the VP Sales is "cautiously optimistic but wants to see the agent integration in action." Getting a demo with the VP Sales is the next critical milestone.', 0.8, 'discovery_call', $5)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_7, tenantId, IDS.ACCT_ACME, IDS.ACTOR_CODY,
     JSON.stringify(['champion', 'buyer', 'stakeholder-map'])],
  );

  // 8. Relationship map — Vertex Logistics
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags)
     VALUES ($1, $2, 'account', $3, 'relationship_map', $4, 'Vertex Logistics buying committee', 'Tomás Rivera (Head of Sales Ops) is the champion and day-to-day contact. He ran the PoC internally and presented results to the exec team. Keiko Yamamoto (CEO) has final sign-off authority on all annual contracts over $100K. Keiko is supportive but has not been directly engaged in the evaluation — she trusts Tomás''s recommendation but wants a brief (15-min) executive alignment call before signing. Tomás warned us: "Don''t oversell to Keiko — she values directness and will disengage if she feels marketed to."', 0.9, 'partner_feedback', $5)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_8, tenantId, IDS.ACCT_VERTEX, IDS.ACTOR_OUTREACH,
     JSON.stringify(['champion', 'ceo', 'buying-committee'])],
  );

  // 9. Research entry — stale (valid_until 45 days ago)
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags)
     VALUES ($1, $2, 'account', $3, 'research', $4, 'Brightside Health org chart and tech stack', 'Brightside Health uses a microservices architecture on AWS (EKS). Tech stack: React frontend, Go backend services, PostgreSQL and DynamoDB. CTO Dr. Priya Nair reports to CEO (unknown name). Engineering team of ~40, with 6 dedicated to internal tools. They built a custom CRM integration layer on top of Salesforce REST API that they described as "fragile and expensive to maintain." New CTO hire rumored for Q1 2026 to lead their platform engineering org.', 0.65, 'web_research', $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_9, tenantId, IDS.ACCT_BRIGHTSIDE, IDS.ACTOR_RESEARCH, daysAgo(45).slice(0, 10),
     JSON.stringify(['org-chart', 'tech-stack', 'aws'])],
  );

  // 10. Summary by research-agent
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags)
     VALUES ($1, $2, 'account', $3, 'summary', $4, 'Vertex Logistics account summary', 'Vertex Logistics is our highest-probability deal ($240K ARR, Negotiation stage). The PoC exceeded throughput targets by 22%. Champion Tomás Rivera has internal budget approval. Remaining gate: CEO Keiko Yamamoto sign-off on annual terms. Key differentiator vs. their Airtable status quo: MCP-native agent integration eliminates their 20 hrs/week of manual data sync. Risk factors: (1) stale competitive intel about Attio needs refresh, (2) we have not yet engaged Keiko directly. Next action: executive alignment call scheduled for next week.', 0.9, 'agent_synthesis', $5)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_10, tenantId, IDS.ACCT_VERTEX, IDS.ACTOR_RESEARCH,
     JSON.stringify(['deal-summary', 'high-priority'])],
  );

  // 11. Agent reasoning entry
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags)
     VALUES ($1, $2, 'opportunity', $3, 'agent_reasoning', $4, 'Outreach strategy decision for Acme proposal revision', 'Decision: Lead the revised Acme proposal with the Vertex case study (40% ramp reduction in 90 days) rather than the original ROI projections. Reasoning: (1) Marcus Webb explicitly rejected theoretical projections in the discovery call, citing a failed Salesforce ROI promise. (2) The Vertex case study is from a similar-sized company in a related vertical. (3) Sarah Chen (champion) confirmed that "concrete examples from real deployments" would carry more weight with Marcus than financial models. Risk: The Vertex deal has not officially closed yet, so citing it as a reference requires careful framing — use "pilot results" language, not "customer results."', 0.85, 'agent_analysis', $5)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_11, tenantId, IDS.OPP_ACME, IDS.ACTOR_OUTREACH,
     JSON.stringify(['strategy', 'proposal', 'reasoning'])],
  );

  // 12. Meeting notes from Acme discovery call
  await db.query(
    `INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, source_activity_id, tags)
     VALUES ($1, $2, 'opportunity', $3, 'meeting_notes', $4, 'Acme Corp discovery call notes — 2026-03-16', E'Attendees: Cody Harris (CRMy), Sarah Chen (VP Eng, Acme), Marcus Webb (CFO, Acme)\nDuration: 45 minutes\n\nKey discussion points:\n1. Acme is spending 15 hrs/week on manual CRM data entry across their 8-person sales team. Sarah called it "the single biggest productivity drain."\n2. They evaluated Salesforce in 2023, implemented it over 6 months, and abandoned it after 14 months. Marcus described the experience as "expensive and demoralizing."\n3. Sarah wants an API-first CRM that their AI agents can write to directly. She demonstrated a prototype sales agent they built with Claude that currently writes to a Google Sheet.\n4. Marcus asked three times about pricing and ROI timeline. He wants to see reference customers, not projections.\n5. Sarah offered to run a 2-week internal pilot if we can provide a sandbox by end of week.\n\nAction items:\n- Send sandbox credentials to Sarah (done via outreach agent)\n- Prepare revised proposal leading with case studies for Marcus\n- Schedule follow-up with Sarah after pilot week 1', 1.0, 'meeting_transcript', $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [IDS.CTX_12, tenantId, IDS.OPP_ACME, IDS.ACTOR_CODY, IDS.ACT_2,
     JSON.stringify(['discovery', 'meeting', 'acme'])],
  );

  console.log('  12 context entries');

  // ── Assignments (3) ─────────────────────────────────────────────────────────
  console.log('Seeding assignments…');

  // 1. Agent → Human: Send revised proposal to Acme
  await db.query(
    `INSERT INTO assignments (id, tenant_id, title, description, assignment_type, assigned_by, assigned_to, subject_type, subject_id, status, priority, context)
     VALUES ($1, $2, 'Send revised proposal to Acme Corp — address Marcus Webb''s ROI concern', 'Review and send the revised proposal that leads with the Vertex case study instead of ROI projections.', 'send', $3, $4, 'opportunity', $5, 'pending', 'high', 'Marcus pushed back on the 6-month ROI claim in the last call. I''ve drafted a revised proposal in section 3 that leads with the Vertex case study (40% ramp reduction in 90 days). Sarah Chen is the champion — copy her on send. Do not cc Marcus directly.')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ASSIGN_1, tenantId, IDS.ACTOR_OUTREACH, IDS.ACTOR_CODY, IDS.OPP_ACME],
  );

  // 2. Agent → Human: Review stale research on Brightside
  await db.query(
    `INSERT INTO assignments (id, tenant_id, title, description, assignment_type, assigned_by, assigned_to, subject_type, subject_id, status, priority, context)
     VALUES ($1, $2, 'Review stale research on Brightside Health before next call', 'The research entry from January is past its valid_until date and needs verification.', 'review', $3, $4, 'account', $5, 'pending', 'normal', 'The research entry from January is past its valid_until date. Dr. Nair mentioned a new CTO hire at their last board meeting — the org chart context entry may be wrong.')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ASSIGN_2, tenantId, IDS.ACTOR_RESEARCH, IDS.ACTOR_SARAH_R, IDS.ACCT_BRIGHTSIDE],
  );

  // 3. Human → Agent: Schedule executive call with Keiko
  await db.query(
    `INSERT INTO assignments (id, tenant_id, title, description, assignment_type, assigned_by, assigned_to, subject_type, subject_id, status, priority, context)
     VALUES ($1, $2, 'Schedule executive alignment call with Keiko Yamamoto at Vertex', 'Coordinate schedules and send calendar invite for a 15-minute executive alignment call.', 'call', $3, $4, 'opportunity', $5, 'accepted', 'urgent', 'Tomas has given us the green light but Keiko needs to sign off. Use the Calendly link in my preferences. Propose Tues/Thurs mornings PT.')
     ON CONFLICT (id) DO NOTHING`,
    [IDS.ASSIGN_3, tenantId, IDS.ACTOR_CODY, IDS.ACTOR_OUTREACH, IDS.OPP_VERTEX],
  );

  console.log('  3 assignments');

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('');
  console.log('✓ Demo data seeded successfully');
  console.log('  4 actors (2 humans, 2 agents)');
  console.log('  3 accounts · 6 contacts · 3 opportunities');
  console.log('  10 activities · 12 context entries · 3 assignments');
  console.log('');
  console.log('Try it:');
  console.log(`  crmy briefing contact:${IDS.CT_SARAH_CHEN}`);
  console.log(`  crmy briefing account:${IDS.ACCT_ACME}`);
  console.log(`  crmy briefing opportunity:${IDS.OPP_ACME}`);
  console.log('');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Seed failed:', (err as Error).message);
    await pool.end();
    process.exit(1);
  });
