#!/usr/bin/env tsx
// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0
//
// Seed realistic sample data for development & demos.
// Usage: DATABASE_URL=postgres://... tsx scripts/seed-sample-data.ts
//
// Creates:
//   - 3 actors (2 human reps, 1 AI agent)
//   - 30 accounts (across 6 industries)
//   - 36 contacts (spread across accounts)
//   - 30 opportunities (all pipeline stages)
//   - 30 activities (diverse types and outcomes)
//   - 30 assignments (all lifecycle states, triggers pagination)
//   - 18 context entries with tags and confidence scores

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

  const alexActor = await upsertActor(db, tenantId, {
    actor_type: 'human',
    display_name: 'Alex Rivera',
    email: 'alex@example.com',
  });

  const jordanActor = await upsertActor(db, tenantId, {
    actor_type: 'human',
    display_name: 'Jordan Kim',
    email: 'jordan@example.com',
  });

  const agentActor = await upsertActor(db, tenantId, {
    actor_type: 'agent',
    display_name: 'Outreach Agent',
    agent_identifier: 'outreach-agent-v1',
    agent_model: 'claude-sonnet-4-6',
  });

  console.log(`  Actor: ${alexActor.display_name} (${alexActor.id})`);
  console.log(`  Actor: ${jordanActor.display_name} (${jordanActor.id})`);
  console.log(`  Actor: ${agentActor.display_name} (${agentActor.id})`);

  // ── Accounts ─────────────────────────────────────────────────────────────────
  console.log('Seeding accounts…');

  // Technology
  const acme         = await upsertAccount(db, tenantId, { name: 'Acme Corp',            industry: 'Technology',           website: 'https://acme.com',          domain: 'acme.com',         annual_revenue: 12_000_000, employee_count: 350,  health_score: 82 });
  const novaTech     = await upsertAccount(db, tenantId, { name: 'NovaTech Systems',      industry: 'Technology',           website: 'https://novatech.io',        domain: 'novatech.io',      annual_revenue: 28_000_000, employee_count: 520,  health_score: 74 });
  const cloudNine    = await upsertAccount(db, tenantId, { name: 'CloudNine Platforms',   industry: 'Technology',           website: 'https://cloudnine.dev',      domain: 'cloudnine.dev',    annual_revenue:  8_000_000, employee_count: 180,  health_score: 88 });
  const cascade      = await upsertAccount(db, tenantId, { name: 'Cascade Software',      industry: 'Technology',           website: 'https://cascadesw.com',      domain: 'cascadesw.com',    annual_revenue:  4_000_000, employee_count:  95,  health_score: 66 });
  const quantum      = await upsertAccount(db, tenantId, { name: 'Quantum Computing Co',  industry: 'Technology',           website: 'https://quantumcc.ai',       domain: 'quantumcc.ai',     annual_revenue:  2_000_000, employee_count:  45,  health_score: 91 });
  const dataBridge   = await upsertAccount(db, tenantId, { name: 'DataBridge Inc',        industry: 'Data & Analytics',     website: 'https://databridge.io',      domain: 'databridge.io',    annual_revenue: 15_000_000, employee_count: 210,  health_score: 55 });
  const apexAnalytics= await upsertAccount(db, tenantId, { name: 'Apex Analytics',        industry: 'Data & Analytics',     website: 'https://apexanalytics.com',  domain: 'apexanalytics.com',annual_revenue: 22_000_000, employee_count: 340,  health_score: 79 });

  // Healthcare
  const blueSky      = await upsertAccount(db, tenantId, { name: 'BlueSky Healthcare',    industry: 'Healthcare',           website: 'https://bluesky.health',     domain: 'bluesky.health',   annual_revenue: 90_000_000, employee_count: 1800, health_score: 72 });
  const pulseBio     = await upsertAccount(db, tenantId, { name: 'Pulse Biomedical',       industry: 'Healthcare',           website: 'https://pulsebio.com',       domain: 'pulsebio.com',     annual_revenue: 35_000_000, employee_count: 430,  health_score: 83 });
  const pinnacleRx   = await upsertAccount(db, tenantId, { name: 'Pinnacle Pharma',        industry: 'Healthcare',           website: 'https://pinnaclepharm.com',  domain: 'pinnaclepharm.com',annual_revenue:180_000_000, employee_count: 2200, health_score: 61 });
  const medCore      = await upsertAccount(db, tenantId, { name: 'MedCore Systems',        industry: 'Healthcare',           website: 'https://medcore.io',         domain: 'medcore.io',       annual_revenue: 62_000_000, employee_count: 890,  health_score: 44 });

  // Financial Services
  const initech      = await upsertAccount(db, tenantId, { name: 'Initech Solutions',      industry: 'Financial Services',   website: 'https://initech.co',         domain: 'initech.co',       annual_revenue:  8_000_000, employee_count: 120,  health_score: 44 });
  const cornerstone  = await upsertAccount(db, tenantId, { name: 'Cornerstone Capital',    industry: 'Financial Services',   website: 'https://cornerstonecap.com', domain: 'cornerstonecap.com',annual_revenue:120_000_000, employee_count: 280, health_score: 76 });
  const orion        = await upsertAccount(db, tenantId, { name: 'Orion Financial',         industry: 'Financial Services',   website: 'https://orionfinancial.com', domain: 'orionfinancial.com',annual_revenue: 85_000_000, employee_count: 540, health_score: 59 });
  const nexusFin     = await upsertAccount(db, tenantId, { name: 'Nexus Fintech',           industry: 'Fintech',              website: 'https://nexusfin.io',        domain: 'nexusfin.io',      annual_revenue:  5_000_000, employee_count:  75,  health_score: 93 });
  const prismIns     = await upsertAccount(db, tenantId, { name: 'Prism Insurance',         industry: 'Insurance',            website: 'https://prismins.com',       domain: 'prismins.com',     annual_revenue:210_000_000, employee_count: 1100, health_score: 52 });

  // Manufacturing
  const globex       = await upsertAccount(db, tenantId, { name: 'Globex Industries',      industry: 'Manufacturing',        website: 'https://globex.io',          domain: 'globex.io',        annual_revenue: 45_000_000, employee_count: 1200, health_score: 61 });
  const ridgeline    = await upsertAccount(db, tenantId, { name: 'Ridgeline Manufacturing', industry: 'Manufacturing',        website: 'https://ridgeline-mfg.com',  domain: 'ridgeline-mfg.com',annual_revenue: 67_000_000, employee_count: 870,  health_score: 70 });
  const forgeInd     = await upsertAccount(db, tenantId, { name: 'Forge Industrial',        industry: 'Manufacturing',        website: 'https://forgeindustrial.com',domain: 'forgeindustrial.com',annual_revenue:150_000_000, employee_count: 2100, health_score: 48 });
  const granite      = await upsertAccount(db, tenantId, { name: 'Granite Construction',    industry: 'Construction',         website: 'https://graniteconstruct.com',domain: 'graniteconstruct.com',annual_revenue: 38_000_000, employee_count: 640, health_score: 65 });

  // Logistics & Energy
  const meridian     = await upsertAccount(db, tenantId, { name: 'Meridian Logistics',      industry: 'Logistics',            website: 'https://meridianlog.com',    domain: 'meridianlog.com',  annual_revenue: 72_000_000, employee_count: 950,  health_score: 69 });
  const harbor       = await upsertAccount(db, tenantId, { name: 'Harbor Logistics',        industry: 'Logistics',            website: 'https://harborlog.co',       domain: 'harborlog.co',     annual_revenue: 41_000_000, employee_count: 580,  health_score: 77 });
  const clearPath    = await upsertAccount(db, tenantId, { name: 'ClearPath Energy',        industry: 'Energy',               website: 'https://clearpathener.com',  domain: 'clearpathener.com',annual_revenue:230_000_000, employee_count: 1400, health_score: 58 });

  // Media, Retail & Other
  const nautilus     = await upsertAccount(db, tenantId, { name: 'Nautilus Media',          industry: 'Media',                website: 'https://nautilusmedia.com',  domain: 'nautilusmedia.com',annual_revenue: 18_000_000, employee_count: 320,  health_score: 82 });
  const terraForge   = await upsertAccount(db, tenantId, { name: 'TerraForge Agriculture',  industry: 'Agriculture',          website: 'https://terraforge.ag',      domain: 'terraforge.ag',    annual_revenue: 29_000_000, employee_count: 440,  health_score: 71 });
  const vantage      = await upsertAccount(db, tenantId, { name: 'Vantage Realty Group',    industry: 'Real Estate',          website: 'https://vantagerealty.com',  domain: 'vantagerealty.com',annual_revenue: 55_000_000, employee_count: 190,  health_score: 63 });
  const summit       = await upsertAccount(db, tenantId, { name: 'Summit Consulting',       industry: 'Professional Services',website: 'https://summitconsult.com',  domain: 'summitconsult.com',annual_revenue: 12_000_000, employee_count:  85,  health_score: 87 });
  const stellar      = await upsertAccount(db, tenantId, { name: 'Stellar Retail Group',    industry: 'Retail',               website: 'https://stellarretail.com',  domain: 'stellarretail.com',annual_revenue:420_000_000, employee_count: 3200, health_score: 50 });
  const olympus      = await upsertAccount(db, tenantId, { name: 'Olympus Retail',          industry: 'Retail',               website: 'https://olympusretail.com',  domain: 'olympusretail.com',annual_revenue:180_000_000, employee_count: 1800, health_score: 66 });
  const ironclad     = await upsertAccount(db, tenantId, { name: 'Ironclad Security',       industry: 'Cybersecurity',        website: 'https://ironcladsec.com',    domain: 'ironcladsec.com',  annual_revenue: 11_000_000, employee_count: 160,  health_score: 68 });

  console.log(`  Seeded 30 accounts`);

  // ── Contacts ─────────────────────────────────────────────────────────────────
  console.log('Seeding contacts…');

  // Acme Corp
  const sarah   = await upsertContact(db, tenantId, { first_name: 'Sarah',    last_name: 'Chen',        email: 'sarah.chen@acme.com',          title: 'VP of Engineering',          company_name: 'Acme Corp',              lifecycle_stage: 'customer',     account_id: acme.id });
  const marcus  = await upsertContact(db, tenantId, { first_name: 'Marcus',   last_name: 'Webb',        email: 'marcus.webb@acme.com',         title: 'CTO',                        company_name: 'Acme Corp',              lifecycle_stage: 'customer',     account_id: acme.id });

  // Globex Industries
  const priya   = await upsertContact(db, tenantId, { first_name: 'Priya',    last_name: 'Patel',       email: 'p.patel@globex.io',            title: 'Director of Operations',     company_name: 'Globex Industries',     lifecycle_stage: 'opportunity',  account_id: globex.id });
  const james   = await upsertContact(db, tenantId, { first_name: 'James',    last_name: 'Okonkwo',     email: 'jokonkwo@globex.io',           title: 'Head of IT',                 company_name: 'Globex Industries',     lifecycle_stage: 'qualified',    account_id: globex.id });

  // Initech Solutions
  const nina    = await upsertContact(db, tenantId, { first_name: 'Nina',     last_name: 'Hartmann',    email: 'nina@initech.co',              title: 'CFO',                        company_name: 'Initech Solutions',     lifecycle_stage: 'lead',         account_id: initech.id });
  const tom     = await upsertContact(db, tenantId, { first_name: 'Tom',      last_name: 'Bradley',     email: 'tbradley@initech.co',          title: 'Procurement Manager',        company_name: 'Initech Solutions',     lifecycle_stage: 'lead',         account_id: initech.id });

  // NovaTech Systems
  const diana   = await upsertContact(db, tenantId, { first_name: 'Diana',    last_name: 'Reyes',       email: 'd.reyes@novatech.io',          title: 'Chief Product Officer',      company_name: 'NovaTech Systems',      lifecycle_stage: 'opportunity',  account_id: novaTech.id });
  const kevin   = await upsertContact(db, tenantId, { first_name: 'Kevin',    last_name: 'Marsh',       email: 'k.marsh@novatech.io',          title: 'VP of Sales',                company_name: 'NovaTech Systems',      lifecycle_stage: 'qualified',    account_id: novaTech.id });

  // CloudNine Platforms
  const lena    = await upsertContact(db, tenantId, { first_name: 'Lena',     last_name: 'Park',        email: 'lena@cloudnine.dev',           title: 'CEO',                        company_name: 'CloudNine Platforms',   lifecycle_stage: 'customer',     account_id: cloudNine.id });

  // BlueSky Healthcare
  const rachel  = await upsertContact(db, tenantId, { first_name: 'Rachel',   last_name: 'Torres',      email: 'r.torres@bluesky.health',      title: 'CIO',                        company_name: 'BlueSky Healthcare',    lifecycle_stage: 'opportunity',  account_id: blueSky.id });
  const dan     = await upsertContact(db, tenantId, { first_name: 'Daniel',   last_name: 'Sung',        email: 'd.sung@bluesky.health',        title: 'VP of IT',                   company_name: 'BlueSky Healthcare',    lifecycle_stage: 'qualified',    account_id: blueSky.id });

  // Cornerstone Capital
  const amanda  = await upsertContact(db, tenantId, { first_name: 'Amanda',   last_name: 'Forsythe',    email: 'a.forsythe@cornerstonecap.com',title: 'Managing Director',           company_name: 'Cornerstone Capital',   lifecycle_stage: 'opportunity',  account_id: cornerstone.id });

  // Orion Financial
  const victor  = await upsertContact(db, tenantId, { first_name: 'Victor',   last_name: 'Huang',       email: 'v.huang@orionfinancial.com',   title: 'Head of Operations',         company_name: 'Orion Financial',       lifecycle_stage: 'lead',         account_id: orion.id });

  // Nexus Fintech
  const sophie  = await upsertContact(db, tenantId, { first_name: 'Sophie',   last_name: 'Laurent',     email: 's.laurent@nexusfin.io',        title: 'Co-founder & CTO',           company_name: 'Nexus Fintech',         lifecycle_stage: 'opportunity',  account_id: nexusFin.id });

  // Ridgeline Manufacturing
  const garrett = await upsertContact(db, tenantId, { first_name: 'Garrett',  last_name: 'Mills',       email: 'g.mills@ridgeline-mfg.com',    title: 'VP of Operations',           company_name: 'Ridgeline Manufacturing',lifecycle_stage: 'qualified',   account_id: ridgeline.id });

  // Pinnacle Pharma
  const claire  = await upsertContact(db, tenantId, { first_name: 'Claire',   last_name: 'Weston',      email: 'c.weston@pinnaclepharm.com',   title: 'SVP of Digital Strategy',    company_name: 'Pinnacle Pharma',       lifecycle_stage: 'lead',         account_id: pinnacleRx.id });

  // MedCore Systems
  const omar    = await upsertContact(db, tenantId, { first_name: 'Omar',     last_name: 'Khalid',      email: 'o.khalid@medcore.io',          title: 'Director of Technology',     company_name: 'MedCore Systems',       lifecycle_stage: 'lead',         account_id: medCore.id });

  // Meridian Logistics
  const tanya   = await upsertContact(db, tenantId, { first_name: 'Tanya',    last_name: 'Novak',       email: 't.novak@meridianlog.com',      title: 'VP of Supply Chain',         company_name: 'Meridian Logistics',    lifecycle_stage: 'opportunity',  account_id: meridian.id });

  // Harbor Logistics
  const ben     = await upsertContact(db, tenantId, { first_name: 'Benjamin', last_name: 'Owens',       email: 'b.owens@harborlog.co',         title: 'Head of Procurement',        company_name: 'Harbor Logistics',      lifecycle_stage: 'qualified',    account_id: harbor.id });

  // ClearPath Energy
  const elise   = await upsertContact(db, tenantId, { first_name: 'Elise',    last_name: 'Fontaine',    email: 'e.fontaine@clearpathener.com', title: 'Chief Digital Officer',      company_name: 'ClearPath Energy',      lifecycle_stage: 'opportunity',  account_id: clearPath.id });
  const raj     = await upsertContact(db, tenantId, { first_name: 'Raj',      last_name: 'Mehta',       email: 'r.mehta@clearpathener.com',    title: 'Director of IT',             company_name: 'ClearPath Energy',      lifecycle_stage: 'qualified',    account_id: clearPath.id });

  // DataBridge Inc
  const morgan  = await upsertContact(db, tenantId, { first_name: 'Morgan',   last_name: 'Shaw',        email: 'm.shaw@databridge.io',         title: 'VP of Product',              company_name: 'DataBridge Inc',        lifecycle_stage: 'opportunity',  account_id: dataBridge.id });

  // Apex Analytics
  const alex2   = await upsertContact(db, tenantId, { first_name: 'Alex',     last_name: 'Thornton',    email: 'a.thornton@apexanalytics.com', title: 'Head of Data Science',       company_name: 'Apex Analytics',        lifecycle_stage: 'customer',     account_id: apexAnalytics.id });

  // Ironclad Security
  const finn    = await upsertContact(db, tenantId, { first_name: 'Finn',     last_name: 'O\'Brien',    email: 'f.obrien@ironcladsec.com',     title: 'CISO',                       company_name: 'Ironclad Security',     lifecycle_stage: 'opportunity',  account_id: ironclad.id });

  // Stellar Retail Group
  const jade    = await upsertContact(db, tenantId, { first_name: 'Jade',     last_name: 'Morrison',    email: 'j.morrison@stellarretail.com', title: 'Director of eCommerce',      company_name: 'Stellar Retail Group',  lifecycle_stage: 'lead',         account_id: stellar.id });

  // Olympus Retail
  const carlos  = await upsertContact(db, tenantId, { first_name: 'Carlos',   last_name: 'Vega',        email: 'c.vega@olympusretail.com',     title: 'VP of Technology',           company_name: 'Olympus Retail',        lifecycle_stage: 'qualified',    account_id: olympus.id });

  // Prism Insurance
  const helena  = await upsertContact(db, tenantId, { first_name: 'Helena',   last_name: 'Cross',       email: 'h.cross@prismins.com',         title: 'Chief Risk Officer',         company_name: 'Prism Insurance',       lifecycle_stage: 'lead',         account_id: prismIns.id });

  // Forge Industrial
  const tony    = await upsertContact(db, tenantId, { first_name: 'Tony',     last_name: 'Russo',       email: 't.russo@forgeindustrial.com',  title: 'VP of Manufacturing Ops',    company_name: 'Forge Industrial',      lifecycle_stage: 'lead',         account_id: forgeInd.id });

  // Quantum Computing Co
  const zoe     = await upsertContact(db, tenantId, { first_name: 'Zoe',      last_name: 'Chen',        email: 'z.chen@quantumcc.ai',          title: 'CEO',                        company_name: 'Quantum Computing Co',  lifecycle_stage: 'customer',     account_id: quantum.id });

  // Cascade Software
  const ian     = await upsertContact(db, tenantId, { first_name: 'Ian',      last_name: 'Gallagher',   email: 'i.gallagher@cascadesw.com',    title: 'VP of Engineering',          company_name: 'Cascade Software',      lifecycle_stage: 'opportunity',  account_id: cascade.id });

  // Summit Consulting
  const grace   = await upsertContact(db, tenantId, { first_name: 'Grace',    last_name: 'Adeyemi',     email: 'g.adeyemi@summitconsult.com',  title: 'Principal Consultant',       company_name: 'Summit Consulting',     lifecycle_stage: 'customer',     account_id: summit.id });

  // Granite Construction
  const phil    = await upsertContact(db, tenantId, { first_name: 'Philip',   last_name: 'Drake',       email: 'p.drake@graniteconstruct.com', title: 'COO',                        company_name: 'Granite Construction',  lifecycle_stage: 'lead',         account_id: granite.id });

  // Vantage Realty Group
  const mia     = await upsertContact(db, tenantId, { first_name: 'Mia',      last_name: 'Jacobs',      email: 'm.jacobs@vantagerealty.com',   title: 'Chief Technology Officer',   company_name: 'Vantage Realty Group',  lifecycle_stage: 'lead',         account_id: vantage.id });

  // Nautilus Media
  const evan    = await upsertContact(db, tenantId, { first_name: 'Evan',     last_name: 'Whitfield',   email: 'e.whitfield@nautilusmedia.com',title: 'VP of Digital Products',     company_name: 'Nautilus Media',        lifecycle_stage: 'opportunity',  account_id: nautilus.id });

  // TerraForge Agriculture
  const lara    = await upsertContact(db, tenantId, { first_name: 'Lara',     last_name: 'Fischer',     email: 'l.fischer@terraforge.ag',      title: 'Head of Technology',         company_name: 'TerraForge Agriculture',lifecycle_stage: 'lead',         account_id: terraForge.id });

  // Pulse Biomedical
  const nick    = await upsertContact(db, tenantId, { first_name: 'Nicholas', last_name: 'Strand',      email: 'n.strand@pulsebio.com',        title: 'VP of Engineering',          company_name: 'Pulse Biomedical',      lifecycle_stage: 'opportunity',  account_id: pulseBio.id });

  console.log(`  Seeded 36 contacts`);

  // ── Opportunities ─────────────────────────────────────────────────────────────
  console.log('Seeding opportunities…');

  const acmeOpp      = await upsertOpportunity(db, tenantId, { name: 'Acme Platform Expansion',            account_id: acme.id,         stage: 'proposal',       amount: 240_000, probability: 65, close_date: addDays(30),  description: 'Expanding existing platform license to cover 3 additional business units.' });
  const globexOpp    = await upsertOpportunity(db, tenantId, { name: 'Globex Digital Transformation',      account_id: globex.id,       stage: 'qualification',  amount: 580_000, probability: 40, close_date: addDays(90),  description: 'Full digital transformation program across manufacturing operations.' });
  const initechOpp   = await upsertOpportunity(db, tenantId, { name: 'Initech Compliance Suite',           account_id: initech.id,      stage: 'prospecting',    amount:  95_000, probability: 20, close_date: addDays(120), description: 'Compliance automation tooling for financial reporting and SOX requirements.' });
  const novaTechOpp  = await upsertOpportunity(db, tenantId, { name: 'NovaTech CRM Integration',           account_id: novaTech.id,     stage: 'negotiation',    amount: 185_000, probability: 78, close_date: addDays(14),  description: 'Native CRM integration with their existing Salesforce instance.' });
  const cloudOpp     = await upsertOpportunity(db, tenantId, { name: 'CloudNine Enterprise License',       account_id: cloudNine.id,    stage: 'closed_won',     amount: 120_000, probability: 100,close_date: daysAgo(5),   description: 'Full enterprise license renewal with premium support tier.' });
  const blueSkyOpp   = await upsertOpportunity(db, tenantId, { name: 'BlueSky Clinical Data Platform',     account_id: blueSky.id,      stage: 'qualification',  amount: 440_000, probability: 35, close_date: addDays(75),  description: 'Clinical data management platform for 12 hospital network.' });
  const cornerOpp    = await upsertOpportunity(db, tenantId, { name: 'Cornerstone Portfolio Analytics',    account_id: cornerstone.id,  stage: 'proposal',       amount: 310_000, probability: 60, close_date: addDays(45),  description: 'Real-time portfolio analytics and risk dashboard for fund managers.' });
  const orionOpp     = await upsertOpportunity(db, tenantId, { name: 'Orion Operations Overhaul',          account_id: orion.id,        stage: 'prospecting',    amount: 220_000, probability: 15, close_date: addDays(150), description: 'Back-office operations platform to replace legacy systems.' });
  const nexusOpp     = await upsertOpportunity(db, tenantId, { name: 'Nexus Fintech Pilot',                account_id: nexusFin.id,     stage: 'proposal',       amount:  45_000, probability: 70, close_date: addDays(21),  description: '3-month paid pilot with expansion path to $250K ARR.' });
  const pulseBioOpp  = await upsertOpportunity(db, tenantId, { name: 'Pulse Biomedical R&D Ops',           account_id: pulseBio.id,     stage: 'qualification',  amount: 175_000, probability: 45, close_date: addDays(60),  description: 'Research operations management platform for 4 lab sites.' });
  const pinnacleOpp  = await upsertOpportunity(db, tenantId, { name: 'Pinnacle Pharma Enterprise Deal',    account_id: pinnacleRx.id,   stage: 'prospecting',    amount: 850_000, probability: 10, close_date: addDays(180), description: 'Enterprise-wide rollout across 14 global offices.' });
  const medCoreOpp   = await upsertOpportunity(db, tenantId, { name: 'MedCore EHR Data Integration',       account_id: medCore.id,      stage: 'qualification',  amount: 290_000, probability: 30, close_date: addDays(90),  description: 'Integration layer connecting EHR systems to analytics pipeline.' });
  const ridgeOpp     = await upsertOpportunity(db, tenantId, { name: 'Ridgeline Ops Intelligence',         account_id: ridgeline.id,    stage: 'proposal',       amount: 195_000, probability: 55, close_date: addDays(35),  description: 'Production line analytics and predictive maintenance platform.' });
  const forgeOpp     = await upsertOpportunity(db, tenantId, { name: 'Forge Industrial MES Upgrade',       account_id: forgeInd.id,     stage: 'prospecting',    amount: 620_000, probability: 18, close_date: addDays(120), description: 'Manufacturing Execution System modernization program.' });
  const graniteOpp   = await upsertOpportunity(db, tenantId, { name: 'Granite Project Management Suite',   account_id: granite.id,      stage: 'qualification',  amount: 130_000, probability: 38, close_date: addDays(80),  description: 'Project tracking and resource management for construction sites.' });
  const meridianOpp  = await upsertOpportunity(db, tenantId, { name: 'Meridian Supply Chain Visibility',   account_id: meridian.id,     stage: 'negotiation',    amount: 345_000, probability: 72, close_date: addDays(18),  description: 'End-to-end supply chain visibility and exception management.' });
  const harborOpp    = await upsertOpportunity(db, tenantId, { name: 'Harbor Fleet Optimization',          account_id: harbor.id,       stage: 'proposal',       amount: 160_000, probability: 58, close_date: addDays(40),  description: 'Route optimization and fuel analytics for 200-vehicle fleet.' });
  const clearOpp     = await upsertOpportunity(db, tenantId, { name: 'ClearPath Grid Analytics',           account_id: clearPath.id,    stage: 'qualification',  amount: 780_000, probability: 32, close_date: addDays(100), description: 'Smart grid analytics platform for renewable energy portfolio.' });
  const nautilusOpp  = await upsertOpportunity(db, tenantId, { name: 'Nautilus Audience Intelligence',      account_id: nautilus.id,     stage: 'proposal',       amount:  88_000, probability: 62, close_date: addDays(28),  description: 'Audience segmentation and content performance analytics.' });
  const terraOpp     = await upsertOpportunity(db, tenantId, { name: 'TerraForge Precision Ag Platform',   account_id: terraForge.id,   stage: 'prospecting',    amount: 145_000, probability: 22, close_date: addDays(110), description: 'IoT-driven crop monitoring and yield optimization platform.' });
  const vantageOpp   = await upsertOpportunity(db, tenantId, { name: 'Vantage Property Intelligence',      account_id: vantage.id,      stage: 'qualification',  amount: 210_000, probability: 42, close_date: addDays(65),  description: 'Market intelligence and deal pipeline management for commercial real estate.' });
  const summitOpp    = await upsertOpportunity(db, tenantId, { name: 'Summit Knowledge Management',        account_id: summit.id,       stage: 'closed_won',     amount:  75_000, probability: 100,close_date: daysAgo(12),  description: 'Internal knowledge base and client delivery tracking platform.' });
  const stellarOpp   = await upsertOpportunity(db, tenantId, { name: 'Stellar Retail Analytics Expansion', account_id: stellar.id,      stage: 'negotiation',    amount: 520_000, probability: 68, close_date: addDays(22),  description: 'Expanding retail analytics to 400 additional store locations.' });
  const olympusOpp   = await upsertOpportunity(db, tenantId, { name: 'Olympus Omnichannel Platform',       account_id: olympus.id,      stage: 'qualification',  amount: 380_000, probability: 28, close_date: addDays(85),  description: 'Unified customer data platform across online and physical retail.' });
  const prismOpp     = await upsertOpportunity(db, tenantId, { name: 'Prism Claims Intelligence',          account_id: prismIns.id,     stage: 'prospecting',    amount: 430_000, probability: 12, close_date: addDays(160), description: 'AI-assisted claims processing and fraud detection.' });
  const ironcladOpp  = await upsertOpportunity(db, tenantId, { name: 'Ironclad Threat Analytics',          account_id: ironclad.id,     stage: 'proposal',       amount: 140_000, probability: 66, close_date: addDays(32),  description: 'Behavioral threat analytics integrated with SIEM platform.' });
  const dataBridgeOpp= await upsertOpportunity(db, tenantId, { name: 'DataBridge Pipeline Automation',     account_id: dataBridge.id,   stage: 'qualification',  amount: 265_000, probability: 48, close_date: addDays(55),  description: 'Automated data pipeline orchestration replacing custom ETL scripts.' });
  const apexOpp      = await upsertOpportunity(db, tenantId, { name: 'Apex Analytics Pro Upgrade',         account_id: apexAnalytics.id,stage: 'closed_won',     amount:  95_000, probability: 100,close_date: daysAgo(8),   description: 'Upgrade from Starter to Pro tier with advanced ML features.' });
  const cascadeOpp   = await upsertOpportunity(db, tenantId, { name: 'Cascade DevOps Integration',         account_id: cascade.id,      stage: 'proposal',       amount:  62_000, probability: 53, close_date: addDays(38),  description: 'CI/CD pipeline integration and deployment analytics.' });
  const quantumOpp   = await upsertOpportunity(db, tenantId, { name: 'Quantum Research Collaboration Hub', account_id: quantum.id,      stage: 'closed_won',     amount:  38_000, probability: 100,close_date: daysAgo(3),   description: 'Collaboration platform for quantum algorithm research team.' });

  console.log(`  Seeded 30 opportunities`);

  // ── Activities ────────────────────────────────────────────────────────────────
  console.log('Seeding activities…');

  await insertActivity(db, tenantId, { type: 'meeting',  subject: 'Q1 QBR with Acme Corp',                        subject_type: 'account',      subject_id: acme.id,         performed_by: alexActor.id,   occurred_at: daysAgo(14), outcome: 'positive',         description: 'Reviewed Q1 usage. Sarah confirmed budget approved for expansion. Marcus wants SSO resolved before sign-off.' });
  await insertActivity(db, tenantId, { type: 'demo',     subject: 'Platform demo — Acme engineering team',         subject_type: 'opportunity',  subject_id: acmeOpp.id,      performed_by: alexActor.id,   occurred_at: daysAgo(10), outcome: 'positive',         description: 'Demo to Sarah and 4 engineers. Strong reaction to API gateway. Minor SSO concern raised by Marcus.' });
  await insertActivity(db, tenantId, { type: 'email',    subject: 'Sent proposal: Acme Platform Expansion',        subject_type: 'opportunity',  subject_id: acmeOpp.id,      performed_by: alexActor.id,   occurred_at: daysAgo(5),  outcome: 'neutral',          description: 'Sent 3-tier pricing proposal. Awaiting sign-off from Marcus (CTO). SSO doc still outstanding.' });
  await insertActivity(db, tenantId, { type: 'call',     subject: 'Discovery call — Globex digital transformation', subject_type: 'contact',      subject_id: priya.id,        performed_by: agentActor.id,  occurred_at: daysAgo(7),  outcome: 'follow_up_needed', description: 'Priya outlined operational pain points. IT approval needed from James. SAP integration concern flagged.' });
  await insertActivity(db, tenantId, { type: 'research', subject: 'Competitive intel — Globex alternatives',       subject_type: 'account',      subject_id: globex.id,       performed_by: agentActor.id,  occurred_at: daysAgo(3),  outcome: 'positive',         description: 'Globex evaluating Competitor X. Our manufacturing analytics module is strongly differentiated.' });
  await insertActivity(db, tenantId, { type: 'call',     subject: 'Cold outreach — Nina Hartmann at Initech',      subject_type: 'contact',      subject_id: nina.id,         performed_by: agentActor.id,  occurred_at: daysAgo(2),  outcome: 'connected',        description: 'Nina interested in compliance demo. Budget ~$100K confirmed. Decision timeline Q2.' });
  await insertActivity(db, tenantId, { type: 'meeting',  subject: 'NovaTech contract review meeting',              subject_type: 'opportunity',  subject_id: novaTechOpp.id,  performed_by: alexActor.id,   occurred_at: daysAgo(4),  outcome: 'positive',         description: 'Final contract terms under review. Legal on both sides aligned. Expected signature next week.' });
  await insertActivity(db, tenantId, { type: 'demo',     subject: 'BlueSky clinical platform walkthrough',         subject_type: 'contact',      subject_id: rachel.id,        performed_by: jordanActor.id, occurred_at: daysAgo(9),  outcome: 'positive',         description: 'Rachel and Dan excited about HL7 integration. HIPAA compliance certification required before procurement.' });
  await insertActivity(db, tenantId, { type: 'call',     subject: 'Cornerstone initial discovery call',            subject_type: 'contact',      subject_id: amanda.id,        performed_by: alexActor.id,   occurred_at: daysAgo(11), outcome: 'positive',         description: 'Amanda shared portfolio analytics gaps. Strong fit with our risk dashboard. Moving to proposal.' });
  await insertActivity(db, tenantId, { type: 'email',    subject: 'Sent intro deck to Orion Financial',            subject_type: 'contact',      subject_id: victor.id,        performed_by: agentActor.id,  occurred_at: daysAgo(6),  outcome: 'neutral',          description: 'Personalized intro deck sent. No response yet. Follow up in 3 days.' });
  await insertActivity(db, tenantId, { type: 'call',     subject: 'Nexus Fintech pilot scoping call',              subject_type: 'contact',      subject_id: sophie.id,        performed_by: jordanActor.id, occurred_at: daysAgo(2),  outcome: 'positive',         description: 'Sophie confirmed pilot scope and budget. Legal review starting this week. Close target: 3 weeks.' });
  await insertActivity(db, tenantId, { type: 'meeting',  subject: 'Meridian supply chain kickoff',                 subject_type: 'opportunity',  subject_id: meridianOpp.id,  performed_by: alexActor.id,   occurred_at: daysAgo(1),  outcome: 'positive',         description: 'Tanya and supply chain team aligned on rollout plan. Final pricing negotiation in progress.' });
  await insertActivity(db, tenantId, { type: 'research', subject: 'Pinnacle Pharma org mapping',                   subject_type: 'account',      subject_id: pinnacleRx.id,   performed_by: agentActor.id,  occurred_at: daysAgo(5),  outcome: 'positive',         description: 'Mapped 14 global offices and identified 3 key champions. Claire Weston is digital strategy lead.' });
  await insertActivity(db, tenantId, { type: 'call',     subject: 'Ridgeline ops intelligence discovery',          subject_type: 'contact',      subject_id: garrett.id,       performed_by: jordanActor.id, occurred_at: daysAgo(8),  outcome: 'follow_up_needed', description: 'Garrett interested but needs VP approval. Budget cycle starts April. Proposal ready to go.' });
  await insertActivity(db, tenantId, { type: 'email',    subject: 'Sent ClearPath energy analytics case study',    subject_type: 'contact',      subject_id: elise.id,         performed_by: agentActor.id,  occurred_at: daysAgo(4),  outcome: 'neutral',          description: 'Relevant wind farm case study sent. Raj CC\'d. Elise confirmed she\'s reviewing with her team.' });
  await insertActivity(db, tenantId, { type: 'demo',     subject: 'Ironclad threat analytics live demo',           subject_type: 'opportunity',  subject_id: ironcladOpp.id,  performed_by: alexActor.id,   occurred_at: daysAgo(6),  outcome: 'positive',         description: 'Finn and security team impressed with behavioral anomaly detection. Moving to proposal stage.' });
  await insertActivity(db, tenantId, { type: 'meeting',  subject: 'Stellar Retail deal negotiation session',       subject_type: 'opportunity',  subject_id: stellarOpp.id,   performed_by: jordanActor.id, occurred_at: daysAgo(3),  outcome: 'positive',         description: 'Jade and procurement aligned on pricing. Volume discount agreed. Legal drafting amendment.' });
  await insertActivity(db, tenantId, { type: 'call',     subject: 'MedCore EHR integration scoping',               subject_type: 'contact',      subject_id: omar.id,          performed_by: agentActor.id,  occurred_at: daysAgo(10), outcome: 'follow_up_needed', description: 'Complex HL7 and FHIR requirements. Omar needs technical architecture doc before moving forward.' });
  await insertActivity(db, tenantId, { type: 'email',    subject: 'DataBridge pipeline automation intro',           subject_type: 'contact',      subject_id: morgan.id,        performed_by: alexActor.id,   occurred_at: daysAgo(7),  outcome: 'positive',         description: 'Morgan responded positively. Scheduling a technical deep-dive for next week.' });
  await insertActivity(db, tenantId, { type: 'call',     subject: 'Harbor fleet pilot proposal call',              subject_type: 'contact',      subject_id: ben.id,           performed_by: jordanActor.id, occurred_at: daysAgo(5),  outcome: 'positive',         description: 'Ben enthusiastic about fuel savings ROI. Moving proposal to procurement review.' });
  await insertActivity(db, tenantId, { type: 'research', subject: 'Cascade Software tech stack audit',             subject_type: 'account',      subject_id: cascade.id,      performed_by: agentActor.id,  occurred_at: daysAgo(3),  outcome: 'positive',         description: 'Ian\'s team uses GitHub Actions + ArgoCD. Our integration fits natively. Personalized demo prep complete.' });
  await insertActivity(db, tenantId, { type: 'meeting',  subject: 'Olympus Retail product roadmap review',         subject_type: 'contact',      subject_id: carlos.id,        performed_by: alexActor.id,   occurred_at: daysAgo(12), outcome: 'follow_up_needed', description: 'Carlos aligned on vision but needs CTO approval for budget reallocation. Q2 budget review April 1.' });
  await insertActivity(db, tenantId, { type: 'demo',     subject: 'Summit Consulting onboarding walkthrough',      subject_type: 'account',      subject_id: summit.id,       performed_by: jordanActor.id, occurred_at: daysAgo(15), outcome: 'positive',         description: 'Grace and team onboarded successfully. Live in production. Upsell conversation started.' });
  await insertActivity(db, tenantId, { type: 'call',     subject: 'Prism Insurance intro call — Helena Cross',     subject_type: 'contact',      subject_id: helena.id,        performed_by: agentActor.id,  occurred_at: daysAgo(8),  outcome: 'neutral',          description: 'Helena politely skeptical. Interested in AI claims ROI data. Send case study from similar insurer.' });
  await insertActivity(db, tenantId, { type: 'email',    subject: 'Vantage Realty market intelligence overview',   subject_type: 'contact',      subject_id: mia.id,           performed_by: agentActor.id,  occurred_at: daysAgo(4),  outcome: 'neutral',          description: 'Sent overview of commercial real estate analytics capability. Awaiting response from Mia.' });
  await insertActivity(db, tenantId, { type: 'call',     subject: 'TerraForge precision ag intro call',            subject_type: 'contact',      subject_id: lara.id,          performed_by: jordanActor.id, occurred_at: daysAgo(6),  outcome: 'follow_up_needed', description: 'Lara interested but decision cycles slow. Next season budget. Keep warm with content.' });
  await insertActivity(db, tenantId, { type: 'research', subject: 'Pulse Biomedical competitor landscape',         subject_type: 'account',      subject_id: pulseBio.id,     performed_by: agentActor.id,  occurred_at: daysAgo(9),  outcome: 'positive',         description: 'Benchmarked 4 lab data management competitors. We have strongest compliance and audit trail story.' });
  await insertActivity(db, tenantId, { type: 'meeting',  subject: 'Apex Analytics renewal & upsell review',        subject_type: 'account',      subject_id: apexAnalytics.id,performed_by: alexActor.id,   occurred_at: daysAgo(10), outcome: 'positive',         description: 'Alex T. renewed and upgraded to Pro. Exploring ML forecasting add-on for Q3.' });
  await insertActivity(db, tenantId, { type: 'call',     subject: 'Granite Construction product fit call',         subject_type: 'contact',      subject_id: phil.id,          performed_by: jordanActor.id, occurred_at: daysAgo(13), outcome: 'follow_up_needed', description: 'Phil interested in site-level tracking. Needs integration with Procore. Technical validation needed.' });
  await insertActivity(db, tenantId, { type: 'email',    subject: 'Nautilus Media analytics proposal sent',        subject_type: 'opportunity',  subject_id: nautilusOpp.id,  performed_by: alexActor.id,   occurred_at: daysAgo(2),  outcome: 'neutral',          description: 'Evan confirmed proposal received. Legal team reviewing subscription terms. Expected feedback in 5 days.' });

  console.log(`  Seeded 30 activities`);

  // ── Context Entries ───────────────────────────────────────────────────────────
  console.log('Seeding context entries…');

  await insertContextEntry(db, tenantId, alexActor.id,  { subject_type: 'account',     subject_id: acme.id,        context_type: 'preference',       title: 'Acme contract preferences',              body: 'Annual contracts paid upfront. Net-60 terms required by finance. Marcus makes final purchase decisions; Sarah is technical champion.',          confidence: 0.95, source: 'manual',           tags: ['contract', 'finance', 'decision-maker'] });
  await insertContextEntry(db, tenantId, alexActor.id,  { subject_type: 'contact',     subject_id: sarah.id,       context_type: 'relationship_map', title: 'Sarah Chen — influence & relationships',  body: 'Primary technical champion. Strong influence over CTO Marcus Webb. Ex-Stripe. Responds well to technical depth over sales pitches.',           confidence: 0.88, source: 'call_transcript',  tags: ['champion', 'technical', 'influence'] });
  await insertContextEntry(db, tenantId, alexActor.id,  { subject_type: 'opportunity', subject_id: globexOpp.id,   context_type: 'objection',        title: 'Globex SAP integration concern',          body: 'Priya and James concerned about SAP integration complexity. Need clear migration path and PS estimate before moving to proposal.',              confidence: 0.90, source: 'call_transcript',  tags: ['objection', 'integration', 'sap', 'blocker'] });
  await insertContextEntry(db, tenantId, agentActor.id, { subject_type: 'account',     subject_id: globex.id,      context_type: 'competitive_intel',title: 'Competitor X evaluation at Globex',       body: 'Globex evaluating Competitor X alongside us. Competitor X stronger on ERP connectors, weaker on analytics. Our manufacturing module wins on dashboards.', confidence: 0.72, source: 'agent_research',   tags: ['competitive', 'competitor-x', 'differentiator'] });
  await insertContextEntry(db, tenantId, alexActor.id,  { subject_type: 'contact',     subject_id: nina.id,        context_type: 'note',             title: 'Nina Hartmann — initial call notes',      body: 'CFO, SOX compliance focus. Current process is Excel-based. Budget ~$100K confirmed verbally. Decision timeline Q2. Strong pain signal.',       confidence: 1.00, source: 'manual',           tags: ['compliance', 'budget', 'timeline'] });
  await insertContextEntry(db, tenantId, agentActor.id, { subject_type: 'opportunity', subject_id: acmeOpp.id,     context_type: 'summary',          title: 'Acme Platform Expansion — deal summary',  body: 'Strong deal. Budget approved ($240K). Sarah on board. Pending CTO SSO sign-off. Send SSO architecture doc. Expected close 30 days.',           confidence: 0.92, source: 'agent_reasoning',  tags: ['deal-summary', 'next-steps', 'sso'] });
  await insertContextEntry(db, tenantId, jordanActor.id,{ subject_type: 'contact',     subject_id: rachel.id,      context_type: 'note',             title: 'Rachel Torres — HIPAA requirements',      body: 'BlueSky requires BAA before procurement. Rachel confirmed HIPAA certification is mandatory. Security review will take 4-6 weeks once initiated.', confidence: 0.96, source: 'manual',           tags: ['hipaa', 'compliance', 'blocker'] });
  await insertContextEntry(db, tenantId, agentActor.id, { subject_type: 'account',     subject_id: pinnacleRx.id,  context_type: 'relationship_map', title: 'Pinnacle Pharma org chart — digital',     body: 'Claire Weston drives digital strategy globally. Reports to CDO (unfilled role post-reorg). 3 regional IT directors have budget authority up to $250K.', confidence: 0.78, source: 'agent_research',   tags: ['org-chart', 'decision-maker', 'digital'] });
  await insertContextEntry(db, tenantId, alexActor.id,  { subject_type: 'opportunity', subject_id: stellarOpp.id,  context_type: 'preference',       title: 'Stellar Retail contract terms',           body: 'Stellar requires multi-year agreement (3-year min). Volume pricing agreed at 400 stores. Implementation must start before June 1 fiscal close.', confidence: 0.93, source: 'call_transcript',  tags: ['contract', 'volume', 'timeline'] });
  await insertContextEntry(db, tenantId, agentActor.id, { subject_type: 'contact',     subject_id: sophie.id,      context_type: 'note',             title: 'Sophie Laurent — technical priorities',   body: 'Sophie prioritizes API-first architecture and event streaming (Kafka). Pre-built connectors for Plaid and Stripe are major selling points. Budget pre-approved.', confidence: 0.89, source: 'call_transcript', tags: ['technical', 'api', 'fintech'] });
  await insertContextEntry(db, tenantId, jordanActor.id,{ subject_type: 'account',     subject_id: meridian.id,    context_type: 'summary',          title: 'Meridian Logistics — deal status',        body: 'Tanya and supply chain team aligned. Tanya has budget authority. Legal reviewing MSA. Rollout plan approved for 3 regional DCs. Close in 18 days.', confidence: 0.91, source: 'manual',           tags: ['deal-summary', 'close-plan'] });
  await insertContextEntry(db, tenantId, agentActor.id, { subject_type: 'account',     subject_id: clearPath.id,   context_type: 'competitive_intel',title: 'ClearPath — energy analytics landscape',  body: 'ClearPath evaluating OSIsoft (PI System) and Palantir. OSIsoft has installed base but aging UI. Palantir expensive. Our ROI story resonates with Elise.', confidence: 0.68, source: 'agent_research',   tags: ['competitive', 'energy', 'roi'] });
  await insertContextEntry(db, tenantId, alexActor.id,  { subject_type: 'contact',     subject_id: amanda.id,      context_type: 'relationship_map', title: 'Amanda Forsythe — buying process',        body: 'Amanda has P&L authority up to $500K. Works with 2 direct reports on evaluation. Prefers quarterly success reviews. References from similar PE firms critical.', confidence: 0.85, source: 'call_transcript', tags: ['champion', 'decision-maker', 'pe'] });
  await insertContextEntry(db, tenantId, agentActor.id, { subject_type: 'opportunity', subject_id: ironcladOpp.id,  context_type: 'note',             title: 'Ironclad — SIEM integration details',    body: 'Finn uses Splunk as primary SIEM. Our Splunk integration (HEC) is native. Finn confirmed this is the #1 technical requirement. Demo landed well.', confidence: 0.94, source: 'call_transcript',  tags: ['technical', 'siem', 'splunk', 'integration'] });
  await insertContextEntry(db, tenantId, jordanActor.id,{ subject_type: 'account',     subject_id: novaTech.id,    context_type: 'preference',       title: 'NovaTech contract — final terms',         body: 'Kevin prefers month-to-month initially with 12-month lock-in option. Diana wants custom onboarding SLA (48hr support response). Both terms are doable.', confidence: 0.97, source: 'manual',           tags: ['contract', 'sla', 'onboarding'] });
  await insertContextEntry(db, tenantId, alexActor.id,  { subject_type: 'contact',     subject_id: evan.id,        context_type: 'note',             title: 'Evan Whitfield — Nautilus priorities',    body: 'Evan wants content performance attribution across channels. Currently using a patchwork of GA4 + custom scripts. Deal timeline tied to Q2 OKR planning (April).', confidence: 0.88, source: 'manual',           tags: ['analytics', 'attribution', 'timeline'] });
  await insertContextEntry(db, tenantId, agentActor.id, { subject_type: 'account',     subject_id: cornerstone.id, context_type: 'summary',          title: 'Cornerstone Capital — deal summary',      body: 'Amanda aligned on pricing and scope. Risk dashboard resonated with fund managers. Pending reference check from 2 existing PE clients. Proposal signed off internally.', confidence: 0.87, source: 'agent_reasoning', tags: ['deal-summary', 'reference', 'pe'] });
  await insertContextEntry(db, tenantId, jordanActor.id,{ subject_type: 'contact',     subject_id: carlos.id,      context_type: 'note',             title: 'Carlos Vega — Olympus decision timeline', body: 'Carlos champions the deal internally but CFO approval needed for reallocation above $200K. CFO board meeting April 8. Pitch deck to be shared by March 28.', confidence: 0.90, source: 'call_transcript',  tags: ['timeline', 'approval', 'cfr'] });

  console.log(`  Seeded 18 context entries`);

  // ── Assignments ───────────────────────────────────────────────────────────────
  console.log('Seeding assignments…');

  // Needs Attention (pending / blocked)
  await insertAssignment(db, tenantId, { title: 'Send SSO architecture doc to Marcus Webb',               assignment_type: 'send',      assigned_by: agentActor.id,   assigned_to: alexActor.id,   subject_type: 'opportunity', subject_id: acmeOpp.id,       priority: 'urgent', status: 'pending',     context: 'Last blocker before Acme moves to negotiation. CTO needs SSO clarity before sign-off.', due_at: addDays(3) });
  await insertAssignment(db, tenantId, { title: 'Get legal to review Initech contract terms',             assignment_type: 'review',    assigned_by: alexActor.id,    assigned_to: alexActor.id,   subject_type: 'opportunity', subject_id: initechOpp.id,    priority: 'normal', status: 'blocked',     context: 'Nina wants net-90 terms. Legal ticket submitted 2 days ago. 5-day SLA. Following up.' });
  await insertAssignment(db, tenantId, { title: 'Follow up with Tom Bradley — procurement requirements',  assignment_type: 'follow_up', assigned_by: agentActor.id,   assigned_to: alexActor.id,   subject_type: 'contact',     subject_id: tom.id,           priority: 'normal', status: 'pending',     context: 'Understand vendor approval process and security questionnaire at Initech.', due_at: addDays(7) });
  await insertAssignment(db, tenantId, { title: 'Send Prism Insurance claims AI case study',              assignment_type: 'send',      assigned_by: agentActor.id,   assigned_to: jordanActor.id, subject_type: 'contact',     subject_id: helena.id,        priority: 'high',   status: 'pending',     context: 'Helena asked for proof point from comparable insurer. Use Liberty Mutual case study.', due_at: addDays(2) });
  await insertAssignment(db, tenantId, { title: 'Escalate MedCore technical architecture review',         assignment_type: 'review',    assigned_by: jordanActor.id,  assigned_to: alexActor.id,   subject_type: 'opportunity', subject_id: medCoreOpp.id,    priority: 'high',   status: 'blocked',     context: 'Omar needs HL7/FHIR architecture doc. Solutions engineering team has been unresponsive for 3 days.' });
  await insertAssignment(db, tenantId, { title: 'Send Granite Construction Procore integration spec',     assignment_type: 'send',      assigned_by: agentActor.id,   assigned_to: jordanActor.id, subject_type: 'contact',     subject_id: phil.id,          priority: 'normal', status: 'pending',     context: 'Philip needs proof of Procore compatibility before going to COO.', due_at: addDays(5) });
  await insertAssignment(db, tenantId, { title: 'Schedule Olympus Retail CFO pitch prep',                assignment_type: 'call',      assigned_by: agentActor.id,   assigned_to: jordanActor.id, subject_type: 'contact',     subject_id: carlos.id,        priority: 'urgent', status: 'pending',     context: 'CFO board meeting April 8. Pitch deck must be sent by March 28. Only 12 days.', due_at: addDays(2) });
  await insertAssignment(db, tenantId, { title: 'Send Vantage Realty market intelligence overview',       assignment_type: 'send',      assigned_by: agentActor.id,   assigned_to: alexActor.id,   subject_type: 'contact',     subject_id: mia.id,           priority: 'low',    status: 'pending',     context: 'Mia has not responded. New CRE case study ready to attach.', due_at: addDays(10) });
  await insertAssignment(db, tenantId, { title: 'Draft ClearPath Energy ROI analysis',                   assignment_type: 'draft',     assigned_by: alexActor.id,    assigned_to: agentActor.id,  subject_type: 'opportunity', subject_id: clearOpp.id,      priority: 'high',   status: 'pending',     context: 'Elise wants a grid-scale ROI model. Use wind farm benchmark data.', due_at: addDays(4) });
  await insertAssignment(db, tenantId, { title: 'Prepare Olympus omnichannel pitch deck',                assignment_type: 'draft',     assigned_by: jordanActor.id,  assigned_to: jordanActor.id, subject_type: 'opportunity', subject_id: olympusOpp.id,    priority: 'urgent', status: 'accepted',    context: 'CFO approval gate coming April 8. Deck due by March 28. Carlos has reviewed outline.', due_at: addDays(12) });

  // In Progress
  await insertAssignment(db, tenantId, { title: 'Prepare professional services estimate for Globex',     assignment_type: 'draft',     assigned_by: alexActor.id,    assigned_to: alexActor.id,   subject_type: 'opportunity', subject_id: globexOpp.id,     priority: 'high',   status: 'in_progress', context: 'Unblocks qualification → proposal gate. Priya expects end of week.', due_at: addDays(2) });
  await insertAssignment(db, tenantId, { title: 'Research Nina Hartmann compliance background',          assignment_type: 'research',  assigned_by: alexActor.id,    assigned_to: agentActor.id,  subject_type: 'contact',     subject_id: nina.id,          priority: 'low',    status: 'in_progress' });
  await insertAssignment(db, tenantId, { title: 'Draft Meridian Logistics MSA redline response',         assignment_type: 'draft',     assigned_by: jordanActor.id,  assigned_to: jordanActor.id, subject_type: 'opportunity', subject_id: meridianOpp.id,   priority: 'urgent', status: 'in_progress', context: 'Legal returned MSA with 4 redlines. Tanya expects response by EOD tomorrow.', due_at: addDays(1) });
  await insertAssignment(db, tenantId, { title: 'Write Stellar Retail volume discount amendment',        assignment_type: 'draft',     assigned_by: jordanActor.id,  assigned_to: jordanActor.id, subject_type: 'opportunity', subject_id: stellarOpp.id,    priority: 'high',   status: 'in_progress', context: 'Jade confirmed 400-store volume pricing. Amendment to base contract required.', due_at: addDays(3) });
  await insertAssignment(db, tenantId, { title: 'Build NovaTech custom onboarding runbook',              assignment_type: 'draft',     assigned_by: alexActor.id,    assigned_to: jordanActor.id, subject_type: 'opportunity', subject_id: novaTechOpp.id,   priority: 'normal', status: 'in_progress', context: 'Kevin and Diana requested custom SLA (48hr support). Runbook to be included in contract.', due_at: addDays(5) });
  await insertAssignment(db, tenantId, { title: 'Research Forge Industrial ERP environment',             assignment_type: 'research',  assigned_by: alexActor.id,    assigned_to: agentActor.id,  subject_type: 'account',     subject_id: forgeInd.id,      priority: 'normal', status: 'in_progress', context: 'Tony mentioned SAP S/4HANA. Need to map integration touchpoints before discovery call.' });
  await insertAssignment(db, tenantId, { title: 'Prepare Cornerstone Capital reference list',            assignment_type: 'research',  assigned_by: alexActor.id,    assigned_to: agentActor.id,  subject_type: 'opportunity', subject_id: cornerOpp.id,     priority: 'high',   status: 'in_progress', context: 'Amanda needs 2 PE client references. Identify best matches from existing customer base.' });

  // Accepted
  await insertAssignment(db, tenantId, { title: 'Schedule discovery call with James Okonkwo (Globex IT)',assignment_type: 'call',      assigned_by: agentActor.id,   assigned_to: alexActor.id,   subject_type: 'contact',     subject_id: james.id,         priority: 'high',   status: 'accepted',    context: 'Priya confirmed James must approve SAP path before budget unlocked.' });
  await insertAssignment(db, tenantId, { title: 'Prepare Acme QBR slide deck for Q2',                   assignment_type: 'draft',     assigned_by: alexActor.id,    assigned_to: alexActor.id,   subject_type: 'account',     subject_id: acme.id,          priority: 'normal', status: 'accepted',    due_at: addDays(21) });
  await insertAssignment(db, tenantId, { title: 'Send BlueSky HIPAA BAA for legal review',              assignment_type: 'send',      assigned_by: jordanActor.id,  assigned_to: jordanActor.id, subject_type: 'opportunity', subject_id: blueSkyOpp.id,    priority: 'high',   status: 'accepted',    context: 'Rachel confirmed BAA is prerequisite for procurement. Send to our legal team first.', due_at: addDays(4) });
  await insertAssignment(db, tenantId, { title: 'Book DataBridge technical deep-dive session',           assignment_type: 'call',      assigned_by: agentActor.id,   assigned_to: alexActor.id,   subject_type: 'contact',     subject_id: morgan.id,        priority: 'normal', status: 'accepted',    context: 'Morgan responded positively to intro. Schedule 90-min technical session with solutions eng.', due_at: addDays(6) });
  await insertAssignment(db, tenantId, { title: 'Draft Pinnacle Pharma global rollout proposal',         assignment_type: 'draft',     assigned_by: agentActor.id,   assigned_to: jordanActor.id, subject_type: 'opportunity', subject_id: pinnacleOpp.id,   priority: 'low',    status: 'accepted',    context: 'Claire needs proposal before Q3 budget cycle opens. No urgency until May but draft early.', due_at: addDays(45) });
  await insertAssignment(db, tenantId, { title: 'Research TerraForge precision ag use cases',            assignment_type: 'research',  assigned_by: alexActor.id,    assigned_to: agentActor.id,  subject_type: 'account',     subject_id: terraForge.id,   priority: 'low',    status: 'accepted',    context: 'Lara\'s team interested in crop monitoring. Find comparable ag analytics deployments.', due_at: addDays(14) });

  // Completed
  await insertAssignment(db, tenantId, { title: 'Run competitive analysis on Globex alternatives',       assignment_type: 'research',  assigned_by: alexActor.id,    assigned_to: agentActor.id,  subject_type: 'account',     subject_id: globex.id,        priority: 'normal', status: 'completed',   context: 'Results stored as context entry on Globex account.' });
  await insertAssignment(db, tenantId, { title: 'Send Ironclad Splunk HEC integration documentation',   assignment_type: 'send',      assigned_by: jordanActor.id,  assigned_to: alexActor.id,   subject_type: 'opportunity', subject_id: ironcladOpp.id,   priority: 'high',   status: 'completed',   context: 'Finn confirmed receipt. Moved deal to proposal stage.' });
  await insertAssignment(db, tenantId, { title: 'Book Summit Consulting upsell discovery call',          assignment_type: 'call',      assigned_by: agentActor.id,   assigned_to: jordanActor.id, subject_type: 'account',     subject_id: summit.id,        priority: 'normal', status: 'completed',   context: 'Grace confirmed interest in knowledge graph add-on. Call completed, demo scheduled.' });
  await insertAssignment(db, tenantId, { title: 'Prepare Harbor Logistics ROI model',                   assignment_type: 'draft',     assigned_by: jordanActor.id,  assigned_to: jordanActor.id, subject_type: 'opportunity', subject_id: harborOpp.id,     priority: 'high',   status: 'completed',   context: 'Ben asked for fuel savings ROI. Model based on 200-vehicle fleet delivered.' });
  await insertAssignment(db, tenantId, { title: 'Draft Nexus Fintech pilot agreement',                  assignment_type: 'draft',     assigned_by: alexActor.id,    assigned_to: alexActor.id,   subject_type: 'opportunity', subject_id: nexusOpp.id,      priority: 'normal', status: 'completed',   context: 'Sophie confirmed pilot terms. Agreement drafted and sent to legal.' });
  await insertAssignment(db, tenantId, { title: 'Map Pinnacle Pharma org chart — digital leads',        assignment_type: 'research',  assigned_by: alexActor.id,    assigned_to: agentActor.id,  subject_type: 'account',     subject_id: pinnacleRx.id,   priority: 'low',    status: 'completed',   context: 'Claire Weston identified as key stakeholder. Regional IT directors mapped.' });

  // Declined / Cancelled
  await insertAssignment(db, tenantId, { title: 'Prepare TerraForge IOT hardware comparison',           assignment_type: 'research',  assigned_by: alexActor.id,    assigned_to: agentActor.id,  subject_type: 'account',     subject_id: terraForge.id,   priority: 'low',    status: 'declined',    context: 'Out of scope — hardware is not our product. Lara redirected to software-only use case.' });
  await insertAssignment(db, tenantId, { title: 'Cold outreach campaign to Orion Financial list',       assignment_type: 'email',     assigned_by: agentActor.id,   assigned_to: jordanActor.id, subject_type: 'account',     subject_id: orion.id,        priority: 'low',    status: 'cancelled',   context: 'Victor asked for warm intro instead. Direct campaign would be counterproductive.' });

  console.log(`  Seeded 30 assignments`);
  console.log('');
  console.log('✓ Sample data seeded successfully!');
  console.log('');
  console.log('Summary:');
  console.log('  Actors:         3 (2 human reps, 1 AI agent)');
  console.log('  Accounts:      30 (6 industries)');
  console.log('  Contacts:      36');
  console.log('  Opportunities: 30 (all pipeline stages)');
  console.log('  Activities:    30 (diverse types and outcomes)');
  console.log('  Context:       18 entries with confidence scores');
  console.log('  Assignments:   30 (all lifecycle states — triggers pagination)');
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
