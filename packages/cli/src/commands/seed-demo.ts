// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CRMy.ai

import { Command } from 'commander';
import { createSpinner } from '../spinner.js';
import { loadConfigFile } from '../config.js';

export function seedDemoCommand(): Command {
  return new Command('seed-demo')
    .description('Seed rich demo data for exploring CRMy (idempotent)')
    .option('--reset', 'Drop and re-seed demo data (dev only)')
    .action(async (opts) => {
      const config = loadConfigFile();
      const databaseUrl = (config as Record<string, unknown> & { database?: { url?: string } }).database?.url ?? process.env.DATABASE_URL;

      if (!databaseUrl) {
        console.error(
          '\n  Error: No database URL found.\n\n' +
          '  Either run `crmy init` first or set DATABASE_URL in your environment.\n',
        );
        process.exit(1);
      }

      const spinner = createSpinner('Seeding demo data…');

      try {
        // Dynamic import to avoid loading pg at module level
        const pgMod = await import('pg');
        const { Pool } = pgMod.default ?? pgMod;
        const pool = new Pool({ connectionString: databaseUrl });

        // Get default tenant
        const tenantRes = await pool.query(`SELECT id FROM tenants LIMIT 1`);
        if (tenantRes.rows.length === 0) {
          spinner.fail('No tenant found');
          console.error('\n  Run `crmy init` first to create the database schema.\n');
          await pool.end();
          process.exit(1);
        }
        const tenantId: string = tenantRes.rows[0].id;

        // ── Stable UUIDs ──────────────────────────────────────────────────────
        const IDS = {
          ACTOR_CODY:       'd0000000-0000-4000-a000-000000000001',
          ACTOR_SARAH_R:    'd0000000-0000-4000-a000-000000000002',
          ACTOR_OUTREACH:   'd0000000-0000-4000-a000-000000000003',
          ACTOR_RESEARCH:   'd0000000-0000-4000-a000-000000000004',
          ACCT_ACME:        'd0000000-0000-4000-b000-000000000001',
          ACCT_BRIGHTSIDE:  'd0000000-0000-4000-b000-000000000002',
          ACCT_VERTEX:      'd0000000-0000-4000-b000-000000000003',
          CT_SARAH_CHEN:    'd0000000-0000-4000-c000-000000000001',
          CT_MARCUS_WEBB:   'd0000000-0000-4000-c000-000000000002',
          CT_PRIYA_NAIR:    'd0000000-0000-4000-c000-000000000003',
          CT_JORDAN_LIU:    'd0000000-0000-4000-c000-000000000004',
          CT_TOMAS_RIVERA:  'd0000000-0000-4000-c000-000000000005',
          CT_KEIKO_YAMAMOTO:'d0000000-0000-4000-c000-000000000006',
          OPP_ACME:         'd0000000-0000-4000-d000-000000000001',
          OPP_BRIGHTSIDE:   'd0000000-0000-4000-d000-000000000002',
          OPP_VERTEX:       'd0000000-0000-4000-d000-000000000003',
          UC_ACME:          'd0000000-0000-4000-f200-000000000001',
          UC_BRIGHTSIDE:    'd0000000-0000-4000-f200-000000000002',
          UC_VERTEX:        'd0000000-0000-4000-f200-000000000003',
          ACT_1: 'd0000000-0000-4000-e000-000000000001', ACT_2: 'd0000000-0000-4000-e000-000000000002',
          ACT_3: 'd0000000-0000-4000-e000-000000000003', ACT_4: 'd0000000-0000-4000-e000-000000000004',
          ACT_5: 'd0000000-0000-4000-e000-000000000005', ACT_6: 'd0000000-0000-4000-e000-000000000006',
          ACT_7: 'd0000000-0000-4000-e000-000000000007', ACT_8: 'd0000000-0000-4000-e000-000000000008',
          ACT_9: 'd0000000-0000-4000-e000-000000000009', ACT_10:'d0000000-0000-4000-e000-000000000010',
          CTX_1: 'd0000000-0000-4000-f000-000000000001', CTX_2: 'd0000000-0000-4000-f000-000000000002',
          CTX_3: 'd0000000-0000-4000-f000-000000000003', CTX_4: 'd0000000-0000-4000-f000-000000000004',
          CTX_5: 'd0000000-0000-4000-f000-000000000005', CTX_6: 'd0000000-0000-4000-f000-000000000006',
          CTX_7: 'd0000000-0000-4000-f000-000000000007', CTX_8: 'd0000000-0000-4000-f000-000000000008',
          CTX_9: 'd0000000-0000-4000-f000-000000000009', CTX_10:'d0000000-0000-4000-f000-000000000010',
          CTX_11:'d0000000-0000-4000-f000-000000000011', CTX_12:'d0000000-0000-4000-f000-000000000012',
          CTX_13:'d0000000-0000-4000-f000-000000000013', CTX_14:'d0000000-0000-4000-f000-000000000014',
          CTX_15:'d0000000-0000-4000-f000-000000000015', CTX_16:'d0000000-0000-4000-f000-000000000016',
          CTX_17:'d0000000-0000-4000-f000-000000000017', CTX_18:'d0000000-0000-4000-f000-000000000018',
          CTX_19:'d0000000-0000-4000-f000-000000000019', CTX_20:'d0000000-0000-4000-f000-000000000020',
          CTX_21:'d0000000-0000-4000-f000-000000000021',
          ASSIGN_1: 'd0000000-0000-4000-f100-000000000001',
          ASSIGN_2: 'd0000000-0000-4000-f100-000000000002',
          ASSIGN_3: 'd0000000-0000-4000-f100-000000000003',
        };

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

        // ── Reset if requested ────────────────────────────────────────────────
        if (opts.reset) {
          const demoIds = Object.values(IDS);
          await pool.query(`DELETE FROM assignments WHERE id = ANY($1::uuid[])`, [demoIds]);
          await pool.query(`DELETE FROM context_entries WHERE id = ANY($1::uuid[])`, [demoIds]);
          await pool.query(`DELETE FROM activities WHERE id = ANY($1::uuid[])`, [demoIds]);
          await pool.query(`DELETE FROM use_case_contacts WHERE use_case_id = ANY($1::uuid[])`, [demoIds]);
          await pool.query(`DELETE FROM use_cases WHERE id = ANY($1::uuid[])`, [demoIds]);
          await pool.query(`DELETE FROM opportunities WHERE id = ANY($1::uuid[])`, [demoIds]);
          await pool.query(`DELETE FROM contacts WHERE id = ANY($1::uuid[])`, [demoIds]);
          await pool.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[])`, [demoIds]);
          await pool.query(`DELETE FROM actors WHERE id = ANY($1::uuid[])`, [demoIds]);
        }

        // ── Actors ────────────────────────────────────────────────────────────
        await pool.query(
          `INSERT INTO actors (id, tenant_id, actor_type, display_name, email) VALUES ($1, $2, 'human', 'Cody Harris', 'cody@crmy.ai') ON CONFLICT (id) DO NOTHING`,
          [IDS.ACTOR_CODY, tenantId],
        );
        await pool.query(
          `INSERT INTO actors (id, tenant_id, actor_type, display_name, email) VALUES ($1, $2, 'human', 'Sarah Reeves', 'sarah@crmy.ai') ON CONFLICT (id) DO NOTHING`,
          [IDS.ACTOR_SARAH_R, tenantId],
        );
        await pool.query(
          `INSERT INTO actors (id, tenant_id, actor_type, display_name, email, agent_identifier, agent_model) VALUES ($1, $2, 'agent', 'Outreach Agent', NULL, 'outreach-v1', 'claude-sonnet-4-20250514') ON CONFLICT (id) DO NOTHING`,
          [IDS.ACTOR_OUTREACH, tenantId],
        );
        await pool.query(
          `INSERT INTO actors (id, tenant_id, actor_type, display_name, email, agent_identifier, agent_model) VALUES ($1, $2, 'agent', 'Research Agent', NULL, 'research-v1', 'claude-sonnet-4-20250514') ON CONFLICT (id) DO NOTHING`,
          [IDS.ACTOR_RESEARCH, tenantId],
        );

        // ── Accounts ──────────────────────────────────────────────────────────
        await pool.query(
          `INSERT INTO accounts (id, tenant_id, name, industry, health_score, annual_revenue, domain, website) VALUES ($1, $2, 'Acme Corp', 'SaaS', 72, 180000, 'acme.com', 'https://acme.com') ON CONFLICT (id) DO NOTHING`,
          [IDS.ACCT_ACME, tenantId],
        );
        await pool.query(
          `INSERT INTO accounts (id, tenant_id, name, industry, health_score, annual_revenue, domain, website) VALUES ($1, $2, 'Brightside Health', 'Healthcare', 45, 96000, 'brightsidehealth.com', 'https://brightsidehealth.com') ON CONFLICT (id) DO NOTHING`,
          [IDS.ACCT_BRIGHTSIDE, tenantId],
        );
        await pool.query(
          `INSERT INTO accounts (id, tenant_id, name, industry, health_score, annual_revenue, domain, website) VALUES ($1, $2, 'Vertex Logistics', 'Logistics', 88, 240000, 'vertex.io', 'https://vertex.io') ON CONFLICT (id) DO NOTHING`,
          [IDS.ACCT_VERTEX, tenantId],
        );

        // ── Contacts ──────────────────────────────────────────────────────────
        await pool.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Sarah', 'Chen', 'sarah.chen@acme.com', 'VP Engineering', $3, 'prospect') ON CONFLICT (id) DO NOTHING`, [IDS.CT_SARAH_CHEN, tenantId, IDS.ACCT_ACME]);
        await pool.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Marcus', 'Webb', 'marcus.webb@acme.com', 'CFO', $3, 'prospect') ON CONFLICT (id) DO NOTHING`, [IDS.CT_MARCUS_WEBB, tenantId, IDS.ACCT_ACME]);
        await pool.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Priya', 'Nair', 'p.nair@brightsidehealth.com', 'CTO', $3, 'active') ON CONFLICT (id) DO NOTHING`, [IDS.CT_PRIYA_NAIR, tenantId, IDS.ACCT_BRIGHTSIDE]);
        await pool.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Jordan', 'Liu', 'j.liu@brightsidehealth.com', 'RevOps Lead', $3, 'active') ON CONFLICT (id) DO NOTHING`, [IDS.CT_JORDAN_LIU, tenantId, IDS.ACCT_BRIGHTSIDE]);
        await pool.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Tomás', 'Rivera', 't.rivera@vertex.io', 'Head of Sales Ops', $3, 'champion') ON CONFLICT (id) DO NOTHING`, [IDS.CT_TOMAS_RIVERA, tenantId, IDS.ACCT_VERTEX]);
        await pool.query(`INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage) VALUES ($1, $2, 'Keiko', 'Yamamoto', 'k.yamamoto@vertex.io', 'CEO', $3, 'champion') ON CONFLICT (id) DO NOTHING`, [IDS.CT_KEIKO_YAMAMOTO, tenantId, IDS.ACCT_VERTEX]);

        // ── Opportunities ─────────────────────────────────────────────────────
        await pool.query(`INSERT INTO opportunities (id, tenant_id, name, account_id, stage, amount, close_date) VALUES ($1, $2, 'Acme Corp Enterprise Deal', $3, 'Discovery', 180000, '2026-06-30') ON CONFLICT (id) DO NOTHING`, [IDS.OPP_ACME, tenantId, IDS.ACCT_ACME]);
        await pool.query(`INSERT INTO opportunities (id, tenant_id, name, account_id, stage, amount, close_date) VALUES ($1, $2, 'Brightside Health Platform Deal', $3, 'PoC', 96000, '2026-05-15') ON CONFLICT (id) DO NOTHING`, [IDS.OPP_BRIGHTSIDE, tenantId, IDS.ACCT_BRIGHTSIDE]);
        await pool.query(`INSERT INTO opportunities (id, tenant_id, name, account_id, stage, amount, close_date) VALUES ($1, $2, 'Vertex Logistics Expansion', $3, 'Negotiation', 240000, '2026-04-30') ON CONFLICT (id) DO NOTHING`, [IDS.OPP_VERTEX, tenantId, IDS.ACCT_VERTEX]);

        // ── Use Cases ─────────────────────────────────────────────────────────
        await pool.query(`INSERT INTO use_cases (id, tenant_id, name, account_id, opportunity_id, stage, health_score) VALUES ($1, $2, 'CRM Migration', $3, $4, 'implementation', 68) ON CONFLICT (id) DO NOTHING`, [IDS.UC_ACME, tenantId, IDS.ACCT_ACME, IDS.OPP_ACME]);
        await pool.query(`INSERT INTO use_cases (id, tenant_id, name, account_id, opportunity_id, stage, health_score) VALUES ($1, $2, 'Clinical Workflow Automation', $3, $4, 'pilot', 50) ON CONFLICT (id) DO NOTHING`, [IDS.UC_BRIGHTSIDE, tenantId, IDS.ACCT_BRIGHTSIDE, IDS.OPP_BRIGHTSIDE]);
        await pool.query(`INSERT INTO use_cases (id, tenant_id, name, account_id, opportunity_id, stage, health_score) VALUES ($1, $2, 'Route Optimization', $3, $4, 'live', 91) ON CONFLICT (id) DO NOTHING`, [IDS.UC_VERTEX, tenantId, IDS.ACCT_VERTEX, IDS.OPP_VERTEX]);

        // ── Use Case Contacts ─────────────────────────────────────────────────
        await pool.query(`INSERT INTO use_case_contacts (use_case_id, contact_id, role) VALUES ($1, $2, 'champion') ON CONFLICT DO NOTHING`, [IDS.UC_ACME, IDS.CT_SARAH_CHEN]);
        await pool.query(`INSERT INTO use_case_contacts (use_case_id, contact_id, role) VALUES ($1, $2, 'champion') ON CONFLICT DO NOTHING`, [IDS.UC_BRIGHTSIDE, IDS.CT_PRIYA_NAIR]);
        await pool.query(`INSERT INTO use_case_contacts (use_case_id, contact_id, role) VALUES ($1, $2, 'champion') ON CONFLICT DO NOTHING`, [IDS.UC_VERTEX, IDS.CT_TOMAS_RIVERA]);

        // ── Activities (10) ───────────────────────────────────────────────────
        await pool.query(`INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail) VALUES ($1, $2, 'outreach_email', 'Initial outreach to Sarah Chen', 'Personalized email introducing CRMy platform capabilities and requesting a discovery call.', $3, 'contact', $4, $5, 'replied', $6) ON CONFLICT (id) DO NOTHING`, [IDS.ACT_1, tenantId, IDS.ACTOR_OUTREACH, IDS.CT_SARAH_CHEN, daysAgo(14), JSON.stringify({ to: 'sarah.chen@acme.com', subject: 'Scaling your sales ops after Series B', channel: 'email' })]);
        await pool.query(`INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, related_type, related_id, occurred_at, outcome, detail) VALUES ($1, $2, 'meeting_held', 'Discovery call — Acme Corp', 'Discussed current pain points with Salesforce. Sarah is the champion. Marcus asked pointed questions about 6-month ROI.', $3, 'opportunity', $4, 'account', $5, $6, 'completed', $7) ON CONFLICT (id) DO NOTHING`, [IDS.ACT_2, tenantId, IDS.ACTOR_CODY, IDS.OPP_ACME, IDS.ACCT_ACME, daysAgo(10), JSON.stringify({ duration_minutes: 45, attendees: ['sarah.chen@acme.com', 'marcus.webb@acme.com', 'cody@crmy.ai'] })]);
        await pool.query(`INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail) VALUES ($1, $2, 'proposal_drafted', 'Draft proposal for Acme Corp Enterprise Deal', 'Generated initial proposal with three tiers. Included ROI projections and the Vertex case study.', $3, 'opportunity', $4, $5, 'completed', $6) ON CONFLICT (id) DO NOTHING`, [IDS.ACT_3, tenantId, IDS.ACTOR_OUTREACH, IDS.OPP_ACME, daysAgo(7), JSON.stringify({ document_type: 'proposal', version: 'v1-draft' })]);
        await pool.query(`INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail) VALUES ($1, $2, 'research_completed', 'Deep research on Brightside Health', 'Compiled competitive landscape, org chart, recent funding, and technology stack analysis.', $3, 'account', $4, $5, 'completed', $6) ON CONFLICT (id) DO NOTHING`, [IDS.ACT_4, tenantId, IDS.ACTOR_RESEARCH, IDS.ACCT_BRIGHTSIDE, daysAgo(5), JSON.stringify({ sources: ['crunchbase', 'linkedin', 'company_blog'], findings_count: 8 })]);
        await pool.query(`INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail) VALUES ($1, $2, 'outreach_call', 'Follow-up call to Dr. Priya Nair', 'Attempted direct call. Went to voicemail. Left message highlighting open-source model and self-hosting.', $3, 'contact', $4, $5, 'voicemail', $6) ON CONFLICT (id) DO NOTHING`, [IDS.ACT_5, tenantId, IDS.ACTOR_CODY, IDS.CT_PRIYA_NAIR, daysAgo(3), JSON.stringify({ duration_minutes: 2, phone: '+1-555-0147', voicemail_left: true })]);
        await pool.query(`INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail) VALUES ($1, $2, 'meeting_scheduled', 'Executive alignment call — Vertex Logistics', 'Scheduled 30-minute call with Keiko Yamamoto and Tomás Rivera for next week.', $3, 'opportunity', $4, $5, 'scheduled', $6) ON CONFLICT (id) DO NOTHING`, [IDS.ACT_6, tenantId, IDS.ACTOR_OUTREACH, IDS.OPP_VERTEX, daysAgo(2), JSON.stringify({ meeting_date: daysFromNow(5), duration_minutes: 30 })]);
        await pool.query(`INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail) VALUES ($1, $2, 'stage_change', 'Vertex Logistics → Negotiation', 'Advanced deal from Qualification to Negotiation after PoC exceeded throughput targets by 22%.', $3, 'opportunity', $4, $5, 'completed', $6) ON CONFLICT (id) DO NOTHING`, [IDS.ACT_7, tenantId, IDS.ACTOR_CODY, IDS.OPP_VERTEX, daysAgo(1), JSON.stringify({ from_stage: 'Qualification', to_stage: 'Negotiation' })]);
        await pool.query(`INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail) VALUES ($1, $2, 'outreach_email', 'Technical deep-dive request to Jordan Liu', 'Follow-up with API docs and sandbox link. Positioned around their pipeline update pain point.', $3, 'contact', $4, $5, 'opened', $6) ON CONFLICT (id) DO NOTHING`, [IDS.ACT_8, tenantId, IDS.ACTOR_OUTREACH, IDS.CT_JORDAN_LIU, daysAgo(4), JSON.stringify({ to: 'j.liu@brightsidehealth.com', subject: 'CRMy sandbox access + MCP integration docs', channel: 'email' })]);
        await pool.query(`INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail) VALUES ($1, $2, 'review', 'Internal review of Acme Corp proposal', 'Reviewed draft with Sarah Reeves. Identified three areas for revision.', $3, 'opportunity', $4, $5, 'completed', $6) ON CONFLICT (id) DO NOTHING`, [IDS.ACT_9, tenantId, IDS.ACTOR_SARAH_R, IDS.OPP_ACME, daysAgo(6), JSON.stringify({ reviewers: ['sarah@crmy.ai', 'cody@crmy.ai'], revision_items: 3 })]);
        await pool.query(`INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, occurred_at, outcome, detail) VALUES ($1, $2, 'research_completed', 'Competitive analysis — Vertex Logistics', 'Vertex using custom Airtable CRM with Zapier. 20 hrs/week manual updates. Attio lacks MCP.', $3, 'account', $4, $5, 'completed', $6) ON CONFLICT (id) DO NOTHING`, [IDS.ACT_10, tenantId, IDS.ACTOR_RESEARCH, IDS.ACCT_VERTEX, daysAgo(8), JSON.stringify({ sources: ['linkedin', 'company_website', 'glassdoor'], findings_count: 5 })]);

        // ── Context Entries (12) ──────────────────────────────────────────────
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags) VALUES ($1, $2, 'account', $3, 'objection', $4, 'CFO skeptical of ROI timeline', 'CFO Marcus Webb is skeptical about 6-month ROI claims — referenced a failed Salesforce implementation in 2023 that took 14 months to break even instead of the promised 6. He explicitly said "I will not sign off on anything that leads with theoretical projections." Approach with concrete case studies from similar-sized SaaS companies, not projections. The Vertex case study (40% ramp reduction in 90 days) is the strongest proof point we have.', 0.95, 'discovery_call', $5, $6) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_1, tenantId, IDS.ACCT_ACME, IDS.ACTOR_CODY, daysFromNow(60), JSON.stringify(['roi', 'cfo', 'salesforce-migration'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags) VALUES ($1, $2, 'account', $3, 'objection', $4, 'Concern about vendor lock-in with proprietary MCP', 'Dr. Nair raised concerns about MCP being a proprietary protocol controlled by Anthropic. She asked specifically whether CRMy would work with non-Anthropic models and whether the MCP specification is truly open. This objection can likely be addressed by showing the open-source MCP spec and demonstrating multi-model support, but we have not had the opportunity to do so yet.', 0.7, 'research', $5, $6) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_2, tenantId, IDS.ACCT_BRIGHTSIDE, IDS.ACTOR_RESEARCH, daysFromNow(30), JSON.stringify(['lock-in', 'open-source', 'mcp'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags) VALUES ($1, $2, 'account', $3, 'competitive_intel', $4, 'Brightside evaluating HubSpot and Attio', 'Brightside Health is actively evaluating HubSpot (Enterprise tier, $3,600/mo) and Attio (Growth plan, $1,200/mo) alongside CRMy. Neither has MCP support. Our differentiator is the open-source, self-hosted model with native MCP.', 0.85, 'linkedin_research', $5, $6) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_3, tenantId, IDS.ACCT_BRIGHTSIDE, IDS.ACTOR_RESEARCH, daysFromNow(45), JSON.stringify(['hubspot', 'attio', 'competitive'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags) VALUES ($1, $2, 'account', $3, 'competitive_intel', $4, 'Vertex considering Attio as alternative', 'Vertex Logistics was evaluating Attio as a potential CRM replacement. This intelligence is from initial conversations and may be outdated — Tomás has since expressed strong preference for CRMy after the PoC results.', 0.6, 'initial_call', $5, $6) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_4, tenantId, IDS.ACCT_VERTEX, IDS.ACTOR_CODY, daysAgo(10).slice(0, 10), JSON.stringify(['attio', 'competitive', 'airtable'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'contact', $3, 'preference', $4, 'Sarah Chen communication preferences', 'Sarah Chen prefers async communication (Slack or email) over calls. She responds fastest to technical content — architecture diagrams, API documentation, and code examples. Avoid scheduling calls before 10am PT. She is the internal champion at Acme.', 0.9, 'observation', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_5, tenantId, IDS.CT_SARAH_CHEN, IDS.ACTOR_OUTREACH, JSON.stringify(['communication', 'async', 'technical'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'contact', $3, 'preference', $4, 'Marcus Webb decision-making style', 'Marcus Webb makes decisions based on quantitative data and peer references, not product demos. He explicitly asked for "three CFOs I can call who switched from Salesforce to CRMy." Lead every communication with a specific number or case study result.', 0.85, 'discovery_call', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_6, tenantId, IDS.CT_MARCUS_WEBB, IDS.ACTOR_CODY, JSON.stringify(['decision-maker', 'data-driven', 'brevity'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'account', $3, 'relationship_map', $4, 'Acme Corp internal dynamics', 'Sarah Chen (VP Engineering) is the champion. Marcus Webb (CFO) is the economic buyer and final decision maker. There is a third stakeholder — their VP Sales (name unknown) who would be the primary end user.', 0.8, 'discovery_call', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_7, tenantId, IDS.ACCT_ACME, IDS.ACTOR_CODY, JSON.stringify(['champion', 'buyer', 'stakeholder-map'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'account', $3, 'relationship_map', $4, 'Vertex Logistics buying committee', 'Tomás Rivera is the champion and day-to-day contact. Keiko Yamamoto (CEO) has final sign-off authority on all annual contracts over $100K. Tomás warned: "Don''t oversell to Keiko — she values directness."', 0.9, 'partner_feedback', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_8, tenantId, IDS.ACCT_VERTEX, IDS.ACTOR_OUTREACH, JSON.stringify(['champion', 'ceo', 'buying-committee'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags) VALUES ($1, $2, 'account', $3, 'research', $4, 'Brightside Health org chart and tech stack', 'Brightside Health uses microservices on AWS (EKS). CTO Dr. Priya Nair reports to CEO. Engineering team of ~40, with 6 dedicated to internal tools. New CTO hire rumored for Q1 2026.', 0.65, 'web_research', $5, $6) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_9, tenantId, IDS.ACCT_BRIGHTSIDE, IDS.ACTOR_RESEARCH, daysAgo(45).slice(0, 10), JSON.stringify(['org-chart', 'tech-stack', 'aws'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'account', $3, 'summary', $4, 'Vertex Logistics account summary', 'Vertex Logistics is our highest-probability deal ($240K ARR, Negotiation stage). The PoC exceeded throughput targets by 22%. Remaining gate: CEO Keiko Yamamoto sign-off. Next action: executive alignment call scheduled.', 0.9, 'agent_synthesis', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_10, tenantId, IDS.ACCT_VERTEX, IDS.ACTOR_RESEARCH, JSON.stringify(['deal-summary', 'high-priority'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'opportunity', $3, 'agent_reasoning', $4, 'Outreach strategy decision for Acme proposal revision', 'Decision: Lead revised Acme proposal with Vertex case study (40% ramp reduction in 90 days) rather than original ROI projections. Marcus Webb explicitly rejected theoretical projections. Sarah Chen confirmed concrete examples carry more weight.', 0.85, 'agent_analysis', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_11, tenantId, IDS.OPP_ACME, IDS.ACTOR_OUTREACH, JSON.stringify(['strategy', 'proposal', 'reasoning'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, source_activity_id, tags) VALUES ($1, $2, 'opportunity', $3, 'meeting_notes', $4, 'Acme Corp discovery call notes — 2026-03-16', E'Attendees: Cody Harris, Sarah Chen, Marcus Webb. Duration: 45 min.\n\nKey points: (1) Acme spending 15 hrs/week on manual CRM data entry. (2) Failed Salesforce impl in 2023. (3) Sarah wants API-first CRM for AI agents. (4) Marcus wants reference customers, not projections. (5) Sarah offered 2-week pilot.', 1.0, 'meeting_transcript', $5, $6) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_12, tenantId, IDS.OPP_ACME, IDS.ACTOR_CODY, IDS.ACT_2, JSON.stringify(['discovery', 'meeting', 'acme'])]);

        // ── Additional contact context entries ────────────────────────────────
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'contact', $3, 'preference', $4, 'Dr. Priya Nair communication preferences', 'Dr. Nair prefers written technical proposals over live demos — she reviews them asynchronously and shares with her team before any follow-up call. She has a strong bias toward open-source and self-hosted solutions due to HIPAA data sensitivity. She is skeptical of SaaS vendors who cannot provide a self-hosted deployment option. Best approach: send a concise one-pager with security architecture and HIPAA compliance posture before requesting a call.', 0.88, 'voicemail_followup', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_13, tenantId, IDS.CT_PRIYA_NAIR, IDS.ACTOR_CODY, JSON.stringify(['communication', 'hipaa', 'self-hosted', 'technical'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'contact', $3, 'key_fact', $4, 'Jordan Liu is the technical evaluator and integration owner', 'Jordan Liu owns the RevOps toolchain at Brightside Health and would be the primary CRMy admin. He is evaluating whether CRMy''s API and MCP interface can replace their current Zapier + Airtable workflow. He opened the sandbox access email and clicked the API docs link twice — strong buying signal. He has not responded yet; follow up with a specific integration example using their existing webhook endpoint.', 0.82, 'email_tracking', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_14, tenantId, IDS.CT_JORDAN_LIU, IDS.ACTOR_OUTREACH, JSON.stringify(['technical-evaluator', 'revops', 'api', 'integration'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'contact', $3, 'preference', $4, 'Tomás Rivera — champion, eager to close before Q2', 'Tomás is our strongest champion across all open deals. He has been pushing internally for CRMy since the PoC exceeded targets. He expressed concern about the implementation timeline — specifically worried about a 6-month onboarding dragging into Q3. He wants contractual SLA on go-live within 60 days. He is the one who confirmed Keiko''s communication style: direct, results-first, dislikes being oversold. Best move: have implementation timeline locked before the executive call.', 0.93, 'partner_feedback', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_15, tenantId, IDS.CT_TOMAS_RIVERA, IDS.ACTOR_CODY, JSON.stringify(['champion', 'timeline', 'q2', 'vertex'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'contact', $3, 'key_fact', $4, 'Keiko Yamamoto — CEO, signs off on all contracts over $100K', 'Keiko Yamamoto (CEO, Vertex Logistics) has final contract authority for all deals over $100K annually. Per Tomás, she values brevity and operational ROI over feature lists. She will ask two questions: "What does it replace?" and "What does it cost per month?" Prepare a one-page executive summary with current tool costs vs CRMy total cost of ownership. She has approved the PoC results and is aware of the deal — this call is a formality if Tomás''s read is correct.', 0.87, 'partner_feedback', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_16, tenantId, IDS.CT_KEIKO_YAMAMOTO, IDS.ACTOR_OUTREACH, JSON.stringify(['ceo', 'executive', 'decision-maker', 'vertex'])]);

        // ── Additional opportunity context entries ─────────────────────────────
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags) VALUES ($1, $2, 'opportunity', $3, 'research', $4, 'Brightside Health PoC scope and evaluation criteria', 'The PoC for Brightside Health focuses on two workflows: (1) clinical lead intake automation and (2) patient outreach sequencing. Jordan Liu defined the evaluation criteria: API response time < 200ms p99, HIPAA-compatible data handling, and a working MCP integration demo. Dr. Nair will review Jordan''s technical report before approving the next stage. PoC deadline is end of May 2026.', 0.8, 'internal_brief', $5, $6) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_17, tenantId, IDS.OPP_BRIGHTSIDE, IDS.ACTOR_RESEARCH, daysFromNow(40), JSON.stringify(['poc', 'hipaa', 'evaluation', 'brightside'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'opportunity', $3, 'summary', $4, 'Vertex Logistics deal — ready to close pending CEO alignment', 'The Vertex Logistics deal ($240K ARR) is in Negotiation. PoC exceeded all throughput targets by 22%. Tomás Rivera is a confirmed champion. Only remaining gate is a 30-minute executive alignment call with CEO Keiko Yamamoto, scheduled for next week. Recommended action: prepare one-page TCO comparison (current Airtable + Zapier costs vs CRMy) and a 60-day implementation SLA commitment to address Tomás''s timeline concern.', 0.92, 'agent_synthesis', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_18, tenantId, IDS.OPP_VERTEX, IDS.ACTOR_RESEARCH, JSON.stringify(['deal-summary', 'negotiation', 'high-priority', 'vertex'])]);

        // ── Use case context entries ───────────────────────────────────────────
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'use_case', $3, 'key_fact', $4, 'Acme CRM Migration — primary blocker is Salesforce data export', 'The CRM Migration use case is in Implementation stage. The main technical blocker is Salesforce data export: Acme''s instance has 6 years of activity history and 4 custom objects that require manual field mapping. Sarah Chen''s team has begun the export process. Estimated data migration window: 2 weeks. Go-live target remains end of Q2 2026. Recommend assigning a technical onboarding resource to accelerate the field mapping step.', 0.85, 'implementation_check_in', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_19, tenantId, IDS.UC_ACME, IDS.ACTOR_CODY, JSON.stringify(['migration', 'salesforce', 'implementation', 'blocker'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, valid_until, tags) VALUES ($1, $2, 'use_case', $3, 'key_fact', $4, 'Brightside Clinical Workflow Automation — HIPAA sign-off pending', 'The Clinical Workflow Automation use case is in Pilot. All functionality is working in the sandbox environment. Remaining blocker: Dr. Nair''s legal team needs to sign off on the BAA (Business Associate Agreement). Legal review was submitted 12 days ago; typical turnaround is 2–3 weeks. Once BAA is signed, Brightside can move to a limited production pilot with 3 care coordinators.', 0.78, 'status_update', $5, $6) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_20, tenantId, IDS.UC_BRIGHTSIDE, IDS.ACTOR_RESEARCH, daysFromNow(21), JSON.stringify(['hipaa', 'baa', 'legal', 'pilot-blocker'])]);
        await pool.query(`INSERT INTO context_entries (id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body, confidence, source, tags) VALUES ($1, $2, 'use_case', $3, 'summary', $4, 'Vertex Route Optimization — live and performing above target', 'The Route Optimization use case is fully live in production (health score: 91). Vertex''s logistics dispatch team runs 100% of their routing decisions through CRMy''s workflow engine. Measured outcomes after 60 days: 18% reduction in average delivery time, 12% fuel cost reduction, and dispatch team headcount reduced from 6 to 4 through automation. Tomás uses this as an internal success story when presenting ROI to Keiko. Case study rights obtained — cleared for use in sales materials.', 0.96, 'success_review', $5) ON CONFLICT (id) DO NOTHING`, [IDS.CTX_21, tenantId, IDS.UC_VERTEX, IDS.ACTOR_RESEARCH, JSON.stringify(['live', 'roi-proven', 'case-study', 'vertex'])]);

        // ── Assignments (3) ───────────────────────────────────────────────────
        await pool.query(`INSERT INTO assignments (id, tenant_id, title, description, assignment_type, assigned_by, assigned_to, subject_type, subject_id, status, priority, context) VALUES ($1, $2, 'Send revised proposal to Acme Corp — address Marcus Webb''s ROI concern', 'Review and send the revised proposal that leads with the Vertex case study.', 'send', $3, $4, 'opportunity', $5, 'pending', 'high', 'Marcus pushed back on the 6-month ROI claim in the last call. I''ve drafted a revised proposal in section 3 that leads with the Vertex case study (40% ramp reduction in 90 days). Sarah Chen is the champion — copy her on send. Do not cc Marcus directly.') ON CONFLICT (id) DO NOTHING`, [IDS.ASSIGN_1, tenantId, IDS.ACTOR_OUTREACH, IDS.ACTOR_CODY, IDS.OPP_ACME]);
        await pool.query(`INSERT INTO assignments (id, tenant_id, title, description, assignment_type, assigned_by, assigned_to, subject_type, subject_id, status, priority, context) VALUES ($1, $2, 'Review stale research on Brightside Health before next call', 'The research entry from January is past its valid_until date and needs verification.', 'review', $3, $4, 'account', $5, 'pending', 'normal', 'The research entry from January is past its valid_until date. Dr. Nair mentioned a new CTO hire at their last board meeting — the org chart context entry may be wrong.') ON CONFLICT (id) DO NOTHING`, [IDS.ASSIGN_2, tenantId, IDS.ACTOR_RESEARCH, IDS.ACTOR_SARAH_R, IDS.ACCT_BRIGHTSIDE]);
        await pool.query(`INSERT INTO assignments (id, tenant_id, title, description, assignment_type, assigned_by, assigned_to, subject_type, subject_id, status, priority, context) VALUES ($1, $2, 'Schedule executive alignment call with Keiko Yamamoto at Vertex', 'Coordinate schedules for a 15-minute executive alignment call.', 'call', $3, $4, 'opportunity', $5, 'accepted', 'urgent', 'Tomas has given us the green light but Keiko needs to sign off. Use the Calendly link in my preferences. Propose Tues/Thurs mornings PT.') ON CONFLICT (id) DO NOTHING`, [IDS.ASSIGN_3, tenantId, IDS.ACTOR_CODY, IDS.ACTOR_OUTREACH, IDS.OPP_VERTEX]);

        spinner.succeed('Demo data seeded successfully');
        await pool.end();
      } catch (err) {
        spinner.fail('Failed to seed demo data');
        console.error(`\n  Error: ${(err as Error).message}\n`);
        process.exit(1);
      }

      // ── Summary ───────────────────────────────────────────────────────────
      console.log('  4 actors (2 humans, 2 agents)');
      console.log('  3 accounts · 6 contacts · 3 opportunities · 3 use cases');
      console.log('  10 activities · 21 context entries · 3 assignments');
      console.log('');
      console.log('Try it:');
      console.log('  crmy briefing contact:d0000000-0000-4000-c000-000000000001');
      console.log('  crmy briefing account:d0000000-0000-4000-b000-000000000001');
      console.log('  crmy briefing opportunity:d0000000-0000-4000-d000-000000000001');
      console.log('  crmy briefing use_case:d0000000-0000-4000-f200-000000000001');
      console.log('');
    });
}
