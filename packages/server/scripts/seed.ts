#!/usr/bin/env npx tsx
// Seed script — loads synthetic CRM data via the REST API
// Usage: npx tsx packages/server/scripts/seed.ts

import * as jose from 'jose';
import pg from 'pg';

const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const DB_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/crmy';
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

async function api(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function getToken(): Promise<string> {
  // First try HTTP login
  const email = process.env.SEED_EMAIL ?? 'admin@crmy.dev';
  const password = process.env.SEED_PASSWORD ?? 'password123';
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) {
    const data = await loginRes.json();
    return data.token;
  }

  // Fall back: generate a JWT directly from the DB using jose
  const pool = new pg.Pool({ connectionString: DB_URL });
  try {
    const r = await pool.query(
      `SELECT u.id, u.role, t.id AS tenant_id FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.role = 'owner' LIMIT 1`,
    );
    if (r.rows.length === 0) throw new Error('No owner user found in database');
    const user = r.rows[0];
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new jose.SignJWT({ sub: user.id, tenant_id: user.tenant_id, role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(secret);
    console.log(`  ✓ Generated token for owner ${user.id} (tenant ${user.tenant_id})`);
    return token;
  } finally {
    await pool.end();
  }
}

// ── Data ────────────────────────────────────────────────────────────────────

const ACCOUNT_DEFS = [
  { name: 'Acme Corporation',      industry: 'Technology',    employee_count: 850,   annual_revenue: 12000000, website: 'https://acme.com',        domain: 'acme.com',        stage: 'customer' },
  { name: 'TechFlow Inc',          industry: 'Technology',    employee_count: 220,   annual_revenue: 4500000,  website: 'https://techflow.io',      domain: 'techflow.io',     stage: 'customer' },
  { name: 'MediCare Systems',      industry: 'Healthcare',    employee_count: 1200,  annual_revenue: 28000000, website: 'https://medicaresys.com',  domain: 'medicaresys.com', stage: 'customer' },
  { name: 'FinanceFirst',          industry: 'Finance',       employee_count: 340,   annual_revenue: 7800000,  website: 'https://financefirst.com', domain: 'financefirst.com',stage: 'prospect' },
  { name: 'RetailMax Group',       industry: 'Retail',        employee_count: 580,   annual_revenue: 9200000,  website: 'https://retailmax.com',    domain: 'retailmax.com',   stage: 'customer' },
  { name: 'CloudNine Solutions',   industry: 'Technology',    employee_count: 95,    annual_revenue: 1800000,  website: 'https://cloudnine.io',     domain: 'cloudnine.io',    stage: 'prospect' },
  { name: 'DataSphere',            industry: 'Technology',    employee_count: 420,   annual_revenue: 8600000,  website: 'https://datasphere.ai',    domain: 'datasphere.ai',   stage: 'partner' },
  { name: 'BioGen Labs',           industry: 'Healthcare',    employee_count: 670,   annual_revenue: 15000000, website: 'https://biogenlabs.com',   domain: 'biogenlabs.com',  stage: 'prospect' },
  { name: 'Quantum Analytics',     industry: 'Technology',    employee_count: 180,   annual_revenue: 3200000,  website: 'https://quantumanaly.com', domain: 'quantumanaly.com',stage: 'customer' },
  { name: 'NexGen Finance',        industry: 'Finance',       employee_count: 250,   annual_revenue: 5100000,  website: 'https://nexgenfi.com',     domain: 'nexgenfi.com',    stage: 'churned' },
  { name: 'Omega Manufacturing',   industry: 'Manufacturing', employee_count: 1500,  annual_revenue: 42000000, website: 'https://omegamfg.com',     domain: 'omegamfg.com',    stage: 'customer' },
  { name: 'PrimeRetail Group',     industry: 'Retail',        employee_count: 320,   annual_revenue: 6700000,  website: 'https://primeretail.com',  domain: 'primeretail.com', stage: 'prospect' },
  { name: 'HealthBridge',          industry: 'Healthcare',    employee_count: 480,   annual_revenue: 11000000, website: 'https://healthbridge.io',  domain: 'healthbridge.io', stage: 'customer' },
  { name: 'SecureVault Inc',       industry: 'Technology',    employee_count: 130,   annual_revenue: 2400000,  website: 'https://securevault.com',  domain: 'securevault.com', stage: 'partner' },
  { name: 'LogiTech Solutions',    industry: 'Manufacturing', employee_count: 760,   annual_revenue: 18000000, website: 'https://logitech-sol.com', domain: 'logitech-sol.com',stage: 'customer' },
  { name: 'StreamLine CRM',        industry: 'Technology',    employee_count: 55,    annual_revenue: 900000,   website: 'https://streamlinecrm.io', domain: 'streamlinecrm.io',stage: 'prospect' },
  { name: 'AlphaMetrics',          industry: 'Technology',    employee_count: 310,   annual_revenue: 6200000,  website: 'https://alphametrics.com', domain: 'alphametrics.com',stage: 'customer' },
  { name: 'NovaBridge Capital',    industry: 'Finance',       employee_count: 90,    annual_revenue: 2100000,  website: 'https://novabridge.com',   domain: 'novabridge.com',  stage: 'prospect' },
  { name: 'EcoSystems Inc',        industry: 'Manufacturing', employee_count: 640,   annual_revenue: 14500000, website: 'https://ecosystems.com',   domain: 'ecosystems.com',  stage: 'customer' },
  { name: 'Peak Performance Co',   industry: 'Retail',        employee_count: 200,   annual_revenue: 3800000,  website: 'https://peakperf.com',     domain: 'peakperf.com',    stage: 'churned' },
  { name: 'Vertex Dynamics',       industry: 'Technology',    employee_count: 390,   annual_revenue: 7700000,  website: 'https://vertexdyn.com',    domain: 'vertexdyn.com',   stage: 'customer' },
  { name: 'BlueSky Logistics',     industry: 'Manufacturing', employee_count: 920,   annual_revenue: 22000000, website: 'https://blueskylog.com',   domain: 'blueskylog.com',  stage: 'prospect' },
];

const CONTACT_DEFS = [
  { first_name: 'Sarah',   last_name: 'Chen',       email: 'sarah.chen@acme.com',        phone: '415-555-0101', title: 'VP of Engineering',      company_idx: 0,  lifecycle_stage: 'customer',  source: 'inbound' },
  { first_name: 'Michael', last_name: 'Torres',     email: 'm.torres@techflow.io',        phone: '628-555-0202', title: 'CTO',                    company_idx: 1,  lifecycle_stage: 'customer',  source: 'referral' },
  { first_name: 'Emma',    last_name: 'Patel',      email: 'emma.patel@medicaresys.com',  phone: '312-555-0303', title: 'Director of IT',         company_idx: 2,  lifecycle_stage: 'customer',  source: 'outbound' },
  { first_name: 'James',   last_name: 'Wilson',     email: 'jwilson@financefirst.com',    phone: '212-555-0404', title: 'CFO',                    company_idx: 3,  lifecycle_stage: 'qualified', source: 'event' },
  { first_name: 'Olivia',  last_name: 'Nguyen',     email: 'o.nguyen@retailmax.com',      phone: '310-555-0505', title: 'Head of Operations',     company_idx: 4,  lifecycle_stage: 'customer',  source: 'inbound' },
  { first_name: 'Liam',    last_name: 'Rodriguez',  email: 'liam@cloudnine.io',           phone: '503-555-0606', title: 'CEO',                    company_idx: 5,  lifecycle_stage: 'lead',      source: 'website' },
  { first_name: 'Ava',     last_name: 'Kim',        email: 'ava.kim@datasphere.ai',       phone: '206-555-0707', title: 'Chief Data Officer',     company_idx: 6,  lifecycle_stage: 'customer',  source: 'partner' },
  { first_name: 'Noah',    last_name: 'Johnson',    email: 'n.johnson@biogenlabs.com',    phone: '617-555-0808', title: 'SVP R&D',                company_idx: 7,  lifecycle_stage: 'qualified', source: 'conference' },
  { first_name: 'Isabella',last_name: 'Martinez',   email: 'imartinez@quantumanaly.com',  phone: '415-555-0909', title: 'Analytics Lead',         company_idx: 8,  lifecycle_stage: 'customer',  source: 'referral' },
  { first_name: 'Ethan',   last_name: 'Davis',      email: 'edavis@nexgenfi.com',         phone: '646-555-1010', title: 'Head of Technology',     company_idx: 9,  lifecycle_stage: 'lead',      source: 'outbound' },
  { first_name: 'Mia',     last_name: 'Thompson',   email: 'mia.t@omegamfg.com',          phone: '313-555-1111', title: 'VP Operations',          company_idx: 10, lifecycle_stage: 'customer',  source: 'inbound' },
  { first_name: 'Lucas',   last_name: 'Anderson',   email: 'l.anderson@primeretail.com',  phone: '404-555-1212', title: 'Digital Director',       company_idx: 11, lifecycle_stage: 'qualified', source: 'event' },
  { first_name: 'Charlotte',last_name: 'Garcia',    email: 'c.garcia@healthbridge.io',    phone: '512-555-1313', title: 'CIO',                    company_idx: 12, lifecycle_stage: 'customer',  source: 'referral' },
  { first_name: 'Mason',   last_name: 'Lee',        email: 'mason@securevault.com',       phone: '415-555-1414', title: 'CISO',                   company_idx: 13, lifecycle_stage: 'customer',  source: 'partner' },
  { first_name: 'Amelia',  last_name: 'Harris',     email: 'aharris@logitech-sol.com',    phone: '714-555-1515', title: 'VP Supply Chain',        company_idx: 14, lifecycle_stage: 'customer',  source: 'inbound' },
  { first_name: 'Benjamin',last_name: 'Clark',      email: 'ben@streamlinecrm.io',        phone: '888-555-1616', title: 'Founder',                company_idx: 15, lifecycle_stage: 'lead',      source: 'website' },
  { first_name: 'Harper',  last_name: 'Lewis',      email: 'h.lewis@alphametrics.com',    phone: '415-555-1717', title: 'Director of Sales',      company_idx: 16, lifecycle_stage: 'customer',  source: 'inbound' },
  { first_name: 'Elijah',  last_name: 'Walker',     email: 'ewalker@novabridge.com',      phone: '212-555-1818', title: 'Managing Partner',       company_idx: 17, lifecycle_stage: 'qualified', source: 'conference' },
  { first_name: 'Evelyn',  last_name: 'Hall',       email: 'evelyn@ecosystems.com',       phone: '360-555-1919', title: 'COO',                    company_idx: 18, lifecycle_stage: 'customer',  source: 'referral' },
  { first_name: 'Oliver',  last_name: 'Young',      email: 'o.young@peakperf.com',        phone: '702-555-2020', title: 'Head of Digital',        company_idx: 19, lifecycle_stage: 'lead',      source: 'outbound' },
  { first_name: 'Sophia',  last_name: 'Scott',      email: 'sophia@vertexdyn.com',        phone: '415-555-2121', title: 'VP Product',             company_idx: 20, lifecycle_stage: 'customer',  source: 'inbound' },
  { first_name: 'William', last_name: 'Adams',      email: 'w.adams@blueskylog.com',      phone: '253-555-2222', title: 'Director of Logistics',  company_idx: 21, lifecycle_stage: 'qualified', source: 'event' },
];

type OppStage = 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
interface OppDef {
  name: string; account_idx: number; contact_idx: number; stage: OppStage;
  amount: number; probability: number; close_date: string; description: string;
}
const OPP_DEFS: OppDef[] = [
  { name: 'Acme — Enterprise Platform',    account_idx: 0,  contact_idx: 0,  stage: 'negotiation',   amount: 180000, probability: 75, close_date: '2026-04-30', description: 'Full platform rollout across 850 seats' },
  { name: 'TechFlow — Growth Package',     account_idx: 1,  contact_idx: 1,  stage: 'proposal',      amount: 64000,  probability: 55, close_date: '2026-05-15', description: 'Upgrade from starter to growth tier' },
  { name: 'MediCare — Compliance Suite',   account_idx: 2,  contact_idx: 2,  stage: 'closed_won',    amount: 240000, probability: 100,close_date: '2026-02-28', description: 'HIPAA compliance and reporting modules' },
  { name: 'FinanceFirst — Analytics Add-on',account_idx: 3, contact_idx: 3,  stage: 'qualification', amount: 52000,  probability: 35, close_date: '2026-06-30', description: 'Advanced analytics and forecasting' },
  { name: 'RetailMax — Mobile Commerce',   account_idx: 4,  contact_idx: 4,  stage: 'closed_won',    amount: 98000,  probability: 100,close_date: '2026-01-31', description: 'Mobile commerce integration' },
  { name: 'CloudNine — Starter Bundle',    account_idx: 5,  contact_idx: 5,  stage: 'prospecting',   amount: 18000,  probability: 15, close_date: '2026-07-31', description: 'Initial engagement — starter package' },
  { name: 'DataSphere — Partner License',  account_idx: 6,  contact_idx: 6,  stage: 'closed_won',    amount: 72000,  probability: 100,close_date: '2026-03-01', description: 'OEM partner licensing deal' },
  { name: 'BioGen — R&D Data Platform',    account_idx: 7,  contact_idx: 7,  stage: 'proposal',      amount: 145000, probability: 60, close_date: '2026-05-31', description: 'Research data management platform' },
  { name: 'Quantum Analytics Expansion',   account_idx: 8,  contact_idx: 8,  stage: 'negotiation',   amount: 88000,  probability: 80, close_date: '2026-04-15', description: 'Seat expansion + premium support' },
  { name: 'NexGen — Recovery Deal',        account_idx: 9,  contact_idx: 9,  stage: 'closed_lost',   amount: 44000,  probability: 0,  close_date: '2026-02-15', description: 'Win-back attempt post-churn' },
  { name: 'Omega Mfg — ERP Integration',   account_idx: 10, contact_idx: 10, stage: 'closed_won',    amount: 310000, probability: 100,close_date: '2026-03-15', description: 'Deep ERP integration project' },
  { name: 'PrimeRetail — Pilot Program',   account_idx: 11, contact_idx: 11, stage: 'qualification', amount: 36000,  probability: 30, close_date: '2026-08-15', description: '3-store pilot before full rollout' },
  { name: 'HealthBridge — Telehealth Ext', account_idx: 12, contact_idx: 12, stage: 'proposal',      amount: 120000, probability: 65, close_date: '2026-05-01', description: 'Telehealth workflow extension' },
  { name: 'SecureVault — Security Bundle', account_idx: 13, contact_idx: 13, stage: 'closed_won',    amount: 56000,  probability: 100,close_date: '2026-02-01', description: 'Security and compliance bundle' },
  { name: 'LogiTech — Supply Chain Suite', account_idx: 14, contact_idx: 14, stage: 'negotiation',   amount: 195000, probability: 70, close_date: '2026-04-30', description: 'End-to-end supply chain visibility' },
  { name: 'AlphaMetrics — Premium Tier',   account_idx: 16, contact_idx: 16, stage: 'proposal',      amount: 76000,  probability: 50, close_date: '2026-06-01', description: 'Migration from competitor + premium tier' },
  { name: 'EcoSystems — Automation Suite', account_idx: 18, contact_idx: 18, stage: 'closed_won',    amount: 168000, probability: 100,close_date: '2026-03-10', description: 'Manufacturing automation integration' },
];

type UCStage = 'discovery' | 'poc' | 'production' | 'scaling' | 'sunset';
interface UCDef {
  name: string; account_idx: number; opp_idx: number; stage: UCStage;
  attributed_arr: number; health_score: number; description: string;
}
const UC_DEFS: UCDef[] = [
  { name: 'Acme — Pipeline Analytics',         account_idx: 0,  opp_idx: 0,  stage: 'production', attributed_arr: 85000,  health_score: 82, description: 'Real-time pipeline analytics for sales team' },
  { name: 'Acme — Forecast Automation',         account_idx: 0,  opp_idx: 0,  stage: 'scaling',    attributed_arr: 62000,  health_score: 90, description: 'Automated quarterly forecasting' },
  { name: 'TechFlow — Lead Scoring',            account_idx: 1,  opp_idx: 1,  stage: 'poc',        attributed_arr: 28000,  health_score: 65, description: 'AI-driven lead scoring model' },
  { name: 'MediCare — Compliance Reporting',    account_idx: 2,  opp_idx: 2,  stage: 'production', attributed_arr: 140000, health_score: 95, description: 'Automated HIPAA compliance reports' },
  { name: 'MediCare — Patient Journey',         account_idx: 2,  opp_idx: 2,  stage: 'scaling',    attributed_arr: 78000,  health_score: 88, description: 'Patient journey tracking and automation' },
  { name: 'RetailMax — Customer 360',           account_idx: 4,  opp_idx: 4,  stage: 'production', attributed_arr: 55000,  health_score: 79, description: 'Unified customer view across all channels' },
  { name: 'DataSphere — Partner Analytics',     account_idx: 6,  opp_idx: 6,  stage: 'production', attributed_arr: 48000,  health_score: 91, description: 'Partner performance analytics dashboard' },
  { name: 'BioGen — Research Pipeline',         account_idx: 7,  opp_idx: 7,  stage: 'discovery',  attributed_arr: 95000,  health_score: 55, description: 'Research project pipeline tracking' },
  { name: 'Quantum — Revenue Intelligence',     account_idx: 8,  opp_idx: 8,  stage: 'production', attributed_arr: 52000,  health_score: 76, description: 'Revenue intelligence and churn prediction' },
  { name: 'Omega Mfg — Demand Planning',        account_idx: 10, opp_idx: 10, stage: 'scaling',    attributed_arr: 185000, health_score: 92, description: 'Demand forecasting integrated with ERP' },
  { name: 'Omega Mfg — Supplier Mgmt',          account_idx: 10, opp_idx: 10, stage: 'production', attributed_arr: 72000,  health_score: 84, description: 'Supplier relationship management' },
  { name: 'HealthBridge — Care Coordination',   account_idx: 12, opp_idx: 12, stage: 'poc',        attributed_arr: 68000,  health_score: 62, description: 'Care coordination workflow automation' },
  { name: 'LogiTech — Fleet Analytics',         account_idx: 14, opp_idx: 14, stage: 'production', attributed_arr: 110000, health_score: 87, description: 'Fleet performance and route optimization' },
  { name: 'LogiTech — Warehouse Ops',           account_idx: 14, opp_idx: 14, stage: 'poc',        attributed_arr: 58000,  health_score: 60, description: 'Warehouse operations automation' },
  { name: 'EcoSystems — Energy Monitoring',     account_idx: 18, opp_idx: 16, stage: 'scaling',    attributed_arr: 92000,  health_score: 89, description: 'Energy consumption monitoring and optimization' },
  { name: 'SecureVault — Threat Detection',     account_idx: 13, opp_idx: 13, stage: 'production', attributed_arr: 38000,  health_score: 97, description: 'Real-time threat detection and alerting' },
  { name: 'AlphaMetrics — Sales Intelligence',  account_idx: 16, opp_idx: 15, stage: 'discovery',  attributed_arr: 42000,  health_score: 48, description: 'Sales intelligence and competitive tracking' },
];

const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'task'] as const;
const ACTIVITY_TEMPLATES = [
  { type: 'call'    as const, subj: 'Discovery call',             body: 'Discussed current pain points and product fit. Strong interest in automation features.' },
  { type: 'email'   as const, subj: 'Follow-up: demo recap',      body: 'Sent over demo recording and pricing deck. Asked for stakeholder intro.' },
  { type: 'meeting' as const, subj: 'Executive business review',  body: 'Quarterly review with VP and CTO. Expansion opportunity identified — AI features.' },
  { type: 'call'    as const, subj: 'Technical deep dive',        body: 'Walked through integration requirements with their engineering team.' },
  { type: 'email'   as const, subj: 'Proposal sent',              body: 'Shared custom proposal and SOW. Follow up in 3 days.' },
  { type: 'meeting' as const, subj: 'Kickoff meeting',            body: 'Onboarding kickoff — defined success metrics and 30-day milestones.' },
  { type: 'task'    as const, subj: 'Send case study',            body: 'Deliver relevant case study from healthcare vertical before end of week.' },
  { type: 'call'    as const, subj: 'Renewal discussion',         body: 'Annual renewal call. Customer happy with ROI. Upsell conversation initiated.' },
  { type: 'email'   as const, subj: 'Check-in email',             body: 'Monthly check-in. Usage is up 40%. Scheduling health review.' },
  { type: 'meeting' as const, subj: 'Product roadmap review',     body: 'Shared upcoming roadmap items. Customer excited about Q3 AI features.' },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding CRMy database...\n');

  const token = await getToken();
  console.log('✅ Authenticated\n');

  // 1. Create accounts
  console.log('📦 Creating accounts...');
  const accountIds: string[] = [];
  for (const def of ACCOUNT_DEFS) {
    const { stage, ...rest } = def;
    const res = await api(token, 'POST', '/accounts', { ...rest, tags: [stage] });
    accountIds.push(res.account?.id ?? res.id);
    process.stdout.write('.');
  }
  console.log(`\n   ✅ ${accountIds.length} accounts created\n`);

  // 2. Create contacts
  console.log('👤 Creating contacts...');
  const contactIds: string[] = [];
  for (const def of CONTACT_DEFS) {
    const { company_idx, ...rest } = def;
    const res = await api(token, 'POST', '/contacts', {
      ...rest,
      account_id: accountIds[company_idx],
      company_name: ACCOUNT_DEFS[company_idx].name,
    });
    contactIds.push(res.contact?.id ?? res.id);
    process.stdout.write('.');
  }
  console.log(`\n   ✅ ${contactIds.length} contacts created\n`);

  // 3. Create opportunities
  console.log('💰 Creating opportunities...');
  const oppIds: string[] = [];
  for (const def of OPP_DEFS) {
    const { account_idx, contact_idx, ...rest } = def;
    const res = await api(token, 'POST', '/opportunities', {
      ...rest,
      account_id: accountIds[account_idx],
      contact_id: contactIds[contact_idx],
    });
    oppIds.push(res.opportunity?.id ?? res.id);
    process.stdout.write('.');
  }
  console.log(`\n   ✅ ${oppIds.length} opportunities created\n`);

  // 4. Create use cases
  console.log('🎯 Creating use cases...');
  const ucIds: string[] = [];
  for (const def of UC_DEFS) {
    const { account_idx, opp_idx, ...rest } = def;
    const res = await api(token, 'POST', '/use-cases', {
      ...rest,
      account_id: accountIds[account_idx],
      opportunity_id: oppIds[opp_idx] ?? undefined,
    });
    ucIds.push(res.use_case?.id ?? res.id);
    process.stdout.write('.');
  }
  console.log(`\n   ✅ ${ucIds.length} use cases created\n`);

  // 5. Create activities — 2-3 per contact, 2 per opportunity
  console.log('📋 Creating activities...');
  let actCount = 0;
  const tmpl = ACTIVITY_TEMPLATES;

  for (let i = 0; i < contactIds.length; i++) {
    const count = i % 3 === 0 ? 3 : 2;
    for (let j = 0; j < count; j++) {
      const t = tmpl[(i * 3 + j) % tmpl.length];
      await api(token, 'POST', '/activities', {
        type: t.type,
        subject: t.subj,
        body: t.body,
        status: 'completed',
        contact_id: contactIds[i],
        account_id: accountIds[CONTACT_DEFS[i].company_idx],
        due_at: daysAgo(30 - i * 2 - j * 5),
        completed_at: daysAgo(28 - i * 2 - j * 5),
      });
      actCount++;
      process.stdout.write('.');
    }
  }

  for (let i = 0; i < oppIds.length; i++) {
    const t = tmpl[(i * 2 + 1) % tmpl.length];
    await api(token, 'POST', '/activities', {
      type: t.type,
      subject: t.subj,
      body: t.body,
      status: i % 4 === 0 ? 'pending' : 'completed',
      opportunity_id: oppIds[i],
      account_id: accountIds[OPP_DEFS[i].account_idx],
      contact_id: contactIds[OPP_DEFS[i].contact_idx],
      due_at: daysAgo(15 - i),
      completed_at: i % 4 === 0 ? undefined : daysAgo(14 - i),
    });
    actCount++;
    process.stdout.write('.');
  }

  console.log(`\n   ✅ ${actCount} activities created\n`);

  console.log('─'.repeat(50));
  console.log(`🎉 Seed complete!`);
  console.log(`   Accounts:      ${accountIds.length}`);
  console.log(`   Contacts:      ${contactIds.length}`);
  console.log(`   Opportunities: ${oppIds.length}`);
  console.log(`   Use Cases:     ${ucIds.length}`);
  console.log(`   Activities:    ${actCount}`);
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  process.exit(1);
});
