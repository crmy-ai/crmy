// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Demo seed — loads a realistic CRM dataset for developer onboarding.
 * Called by `crmy init --demo`. Writes directly to the database (no running
 * server required). After seeding, run:
 *
 *   briefing_get contact <showcaseContactId> adjacent
 *
 * to see a rich context-engine response: activities, 9 context entries across
 * 8 types, 2 staleness warnings, and adjacent account context.
 */

import crypto from 'node:crypto';

// Minimal interface — only .query() is needed
interface DbLike {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface DemoSeedResult {
  accounts: number;
  contacts: number;
  opportunities: number;
  activities: number;
  contextEntries: number;
  /** James Wilson, CFO at FinanceFirst — the richest showcase contact */
  showcaseContactId: string;
  showcaseContactName: string;
  showcaseAccountName: string;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

const uid = () => crypto.randomUUID();

function ago(days: number, hours = 0): string {
  return new Date(Date.now() - (days * 86_400 + hours * 3_600) * 1000).toISOString();
}

function fromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function seedDemoData(
  db: DbLike,
  tenantId: string,
  userId: string,
): Promise<DemoSeedResult> {
  // Retrieve admin name/email to create the actor row
  const userRow = await db.query(`SELECT name, email FROM users WHERE id = $1`, [userId]);
  const adminName  = (userRow.rows[0]?.name  as string) || 'Admin';
  const adminEmail = (userRow.rows[0]?.email as string) || '';

  // Ensure an actor exists for the admin user (migration 014 backfill only runs
  // at migration time; the admin user is created after migrations in `init`).
  const actorResult = await db.query(`
    WITH ins AS (
      INSERT INTO actors (tenant_id, actor_type, display_name, email, user_id, role)
      VALUES ($1, 'human', $2, $3, $4, 'owner')
      ON CONFLICT DO NOTHING
      RETURNING id
    )
    SELECT id FROM ins
    UNION ALL
    SELECT id FROM actors WHERE tenant_id = $1 AND user_id = $4
    LIMIT 1`,
    [tenantId, adminName, adminEmail, userId],
  );
  const actorId = actorResult.rows[0].id as string;

  // ── Accounts ─────────────────────────────────────────────────────────────────

  const A = {
    acme:       uid(), techflow:  uid(), medicare:  uid(),
    finance:    uid(), retailmax: uid(), cloudnine: uid(),
    datasphere: uid(), biogen:    uid(), omega:     uid(), novabridge: uid(),
  };

  type AccRow = [string, string, string, string, number, number, string, string[]];
  const accounts: AccRow[] = [
    [A.acme,       'Acme Corp',           'acme.com',         'Technology',    850,  12_000_000, 'https://acme.com',          ['customer']],
    [A.techflow,   'TechFlow Inc',        'techflow.io',      'Technology',    220,   4_500_000, 'https://techflow.io',       ['prospect']],
    [A.medicare,   'MediCare Systems',    'medicaresys.com',  'Healthcare',   1200,  28_000_000, 'https://medicaresys.com',   ['customer']],
    [A.finance,    'FinanceFirst',        'financefirst.com', 'Finance',       340,   7_800_000, 'https://financefirst.com',  ['prospect']],
    [A.retailmax,  'RetailMax Group',     'retailmax.com',    'Retail',        580,   9_200_000, 'https://retailmax.com',     ['customer']],
    [A.cloudnine,  'CloudNine Solutions', 'cloudnine.io',     'Technology',     95,   1_800_000, 'https://cloudnine.io',      ['prospect']],
    [A.datasphere, 'DataSphere',          'datasphere.ai',    'Technology',    420,   8_600_000, 'https://datasphere.ai',     ['partner']],
    [A.biogen,     'BioGen Labs',         'biogenlabs.com',   'Healthcare',    670,  15_000_000, 'https://biogenlabs.com',    ['prospect']],
    [A.omega,      'Omega Manufacturing', 'omegamfg.com',     'Manufacturing',1500,  42_000_000, 'https://omegamfg.com',      ['customer']],
    [A.novabridge, 'NovaBridge Capital',  'novabridge.com',   'Finance',        90,   2_100_000, 'https://novabridge.com',    ['prospect']],
  ];

  for (const [id, name, domain, industry, emp, rev, website, tags] of accounts) {
    await db.query(
      `INSERT INTO accounts (id, tenant_id, name, domain, industry, employee_count,
         annual_revenue, website, tags, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, tenantId, name, domain, industry, emp, rev, website, tags, userId],
    );
  }

  // ── Contacts (5 per account = 50) ────────────────────────────────────────────

  const C = {
    // Acme Corp
    sarahChen: uid(), marcusRivera: uid(), lisaPark: uid(), danielOkafor: uid(), amyWalsh: uid(),
    // TechFlow
    michaelTorres: uid(), rebeccaKim: uid(), tomNguyen: uid(), sandraPatel: uid(), kevinLiu: uid(),
    // MediCare
    emmaPatel: uid(), jamesReed: uid(), rachelKim: uid(), brianCohen: uid(), nancyLiu: uid(),
    // FinanceFirst (showcase)
    jamesWilson: uid(), catherineLee: uid(), robertMarsh: uid(), dianaTorres: uid(), henryPark: uid(),
    // RetailMax
    oliviaNguyen: uid(), frankChen: uid(), mariaSantos: uid(), chrisDavis: uid(), ashleyKim: uid(),
    // CloudNine
    liamRodriguez: uid(), priyaPatel: uid(), alexJohnson: uid(), jordanKim: uid(), miaChen: uid(),
    // DataSphere
    avaKim: uid(), marcusThompson: uid(), lilyPark: uid(), ethanTorres: uid(), sophieMartin: uid(),
    // BioGen
    noahJohnson: uid(), emilyC: uid(), adrianPark: uid(), rachelWilson: uid(), davidNguyen: uid(),
    // Omega
    miaThompson: uid(), carlosGarcia: uid(), elenaRossi: uid(), williamJones: uid(), patriciaBrown: uid(),
    // NovaBridge
    elijahWalker: uid(), graceLee: uid(), tylerChen: uid(), isabellaMartinez: uid(), seanPark: uid(),
  };

  // [id, account_id, first, last, email, phone, title, lifecycle_stage, source]
  type ContactRow = [string, string, string, string, string, string, string, string, string];
  const contacts: ContactRow[] = [
    // Acme
    [C.sarahChen,       A.acme,      'Sarah',    'Chen',      'sarah.chen@acme.com',         '415-555-0101', 'VP of Engineering',         'customer',  'inbound'],
    [C.marcusRivera,    A.acme,      'Marcus',   'Rivera',    'm.rivera@acme.com',           '415-555-0102', 'CTO',                       'customer',  'referral'],
    [C.lisaPark,        A.acme,      'Lisa',     'Park',      'lisa.park@acme.com',          '415-555-0103', 'Head of IT',                'customer',  'inbound'],
    [C.danielOkafor,    A.acme,      'Daniel',   'Okafor',    'd.okafor@acme.com',           '415-555-0104', 'Sr. Director Engineering',  'customer',  'inbound'],
    [C.amyWalsh,        A.acme,      'Amy',      'Walsh',     'a.walsh@acme.com',            '415-555-0105', 'Principal Architect',       'customer',  'inbound'],
    // TechFlow
    [C.michaelTorres,   A.techflow,  'Michael',  'Torres',    'm.torres@techflow.io',        '628-555-0201', 'CTO',                       'qualified', 'referral'],
    [C.rebeccaKim,      A.techflow,  'Rebecca',  'Kim',       'r.kim@techflow.io',           '628-555-0202', 'VP Product',                'qualified', 'conference'],
    [C.tomNguyen,       A.techflow,  'Tom',      'Nguyen',    't.nguyen@techflow.io',        '628-555-0203', 'Director of Engineering',   'lead',      'website'],
    [C.sandraPatel,     A.techflow,  'Sandra',   'Patel',     's.patel@techflow.io',         '628-555-0204', 'CIO',                       'qualified', 'referral'],
    [C.kevinLiu,        A.techflow,  'Kevin',    'Liu',       'k.liu@techflow.io',           '628-555-0205', 'Head of Data',              'lead',      'website'],
    // MediCare
    [C.emmaPatel,       A.medicare,  'Emma',     'Patel',     'emma.patel@medicaresys.com',  '312-555-0301', 'Director of IT',            'customer',  'outbound'],
    [C.jamesReed,       A.medicare,  'James',    'Reed',      'j.reed@medicaresys.com',      '312-555-0302', 'Chief Medical Officer',     'customer',  'referral'],
    [C.rachelKim,       A.medicare,  'Rachel',   'Kim',       'r.kim@medicaresys.com',       '312-555-0303', 'VP Operations',             'customer',  'outbound'],
    [C.brianCohen,      A.medicare,  'Brian',    'Cohen',     'b.cohen@medicaresys.com',     '312-555-0304', 'CTO',                       'customer',  'referral'],
    [C.nancyLiu,        A.medicare,  'Nancy',    'Liu',       'n.liu@medicaresys.com',       '312-555-0305', 'CISO',                      'customer',  'referral'],
    // FinanceFirst — showcase
    [C.jamesWilson,     A.finance,   'James',    'Wilson',    'jwilson@financefirst.com',    '212-555-0401', 'CFO',                       'qualified', 'event'],
    [C.catherineLee,    A.finance,   'Catherine','Lee',       'c.lee@financefirst.com',      '212-555-0402', 'Head of Technology',        'qualified', 'event'],
    [C.robertMarsh,     A.finance,   'Robert',   'Marsh',     'r.marsh@financefirst.com',    '212-555-0403', 'VP Operations',             'lead',      'outbound'],
    [C.dianaTorres,     A.finance,   'Diana',    'Torres',    'd.torres@financefirst.com',   '212-555-0404', 'Director of Finance',       'lead',      'outbound'],
    [C.henryPark,       A.finance,   'Henry',    'Park',      'h.park@financefirst.com',     '212-555-0405', 'IT Manager',                'lead',      'outbound'],
    // RetailMax
    [C.oliviaNguyen,    A.retailmax, 'Olivia',   'Nguyen',    'o.nguyen@retailmax.com',      '310-555-0501', 'Head of Operations',        'customer',  'inbound'],
    [C.frankChen,       A.retailmax, 'Frank',    'Chen',      'f.chen@retailmax.com',        '310-555-0502', 'CTO',                       'customer',  'inbound'],
    [C.mariaSantos,     A.retailmax, 'Maria',    'Santos',    'm.santos@retailmax.com',      '310-555-0503', 'VP Digital',                'customer',  'referral'],
    [C.chrisDavis,      A.retailmax, 'Chris',    'Davis',     'c.davis@retailmax.com',       '310-555-0504', 'Director of Commerce',      'customer',  'inbound'],
    [C.ashleyKim,       A.retailmax, 'Ashley',   'Kim',       'a.kim@retailmax.com',         '310-555-0505', 'Head of Analytics',         'customer',  'inbound'],
    // CloudNine
    [C.liamRodriguez,   A.cloudnine, 'Liam',     'Rodriguez', 'liam@cloudnine.io',           '503-555-0601', 'CEO',                       'lead',      'website'],
    [C.priyaPatel,      A.cloudnine, 'Priya',    'Patel',     'p.patel@cloudnine.io',        '503-555-0602', 'CTO',                       'lead',      'website'],
    [C.alexJohnson,     A.cloudnine, 'Alex',     'Johnson',   'a.johnson@cloudnine.io',      '503-555-0603', 'VP Sales',                  'lead',      'website'],
    [C.jordanKim,       A.cloudnine, 'Jordan',   'Kim',       'j.kim@cloudnine.io',          '503-555-0604', 'Head of Product',           'lead',      'website'],
    [C.miaChen,         A.cloudnine, 'Mia',      'Chen',      'm.chen@cloudnine.io',         '503-555-0605', 'Director of Engineering',   'lead',      'website'],
    // DataSphere
    [C.avaKim,          A.datasphere,'Ava',      'Kim',       'ava.kim@datasphere.ai',       '206-555-0701', 'Chief Data Officer',        'customer',  'partner'],
    [C.marcusThompson,  A.datasphere,'Marcus',   'Thompson',  'm.thompson@datasphere.ai',    '206-555-0702', 'VP Engineering',            'customer',  'partner'],
    [C.lilyPark,        A.datasphere,'Lily',     'Park',      'l.park@datasphere.ai',        '206-555-0703', 'Head of Data Platform',     'customer',  'partner'],
    [C.ethanTorres,     A.datasphere,'Ethan',    'Torres',    'e.torres@datasphere.ai',      '206-555-0704', 'Director of Analytics',     'customer',  'partner'],
    [C.sophieMartin,    A.datasphere,'Sophie',   'Martin',    's.martin@datasphere.ai',      '206-555-0705', 'Data Architect',            'customer',  'partner'],
    // BioGen
    [C.noahJohnson,     A.biogen,    'Noah',     'Johnson',   'n.johnson@biogenlabs.com',    '617-555-0801', 'SVP of R&D',                'qualified', 'conference'],
    [C.emilyC,          A.biogen,    'Emily',    'Chen',      'e.chen@biogenlabs.com',       '617-555-0802', 'VP Research',               'qualified', 'conference'],
    [C.adrianPark,      A.biogen,    'Adrian',   'Park',      'a.park@biogenlabs.com',       '617-555-0803', 'Director of IT',            'lead',      'outbound'],
    [C.rachelWilson,    A.biogen,    'Rachel',   'Wilson',    'r.wilson@biogenlabs.com',     '617-555-0804', 'CTO',                       'lead',      'outbound'],
    [C.davidNguyen,     A.biogen,    'David',    'Nguyen',    'd.nguyen@biogenlabs.com',     '617-555-0805', 'Head of Data',              'lead',      'outbound'],
    // Omega
    [C.miaThompson,     A.omega,     'Mia',      'Thompson',  'mia.t@omegamfg.com',          '313-555-0901', 'VP Operations',             'customer',  'inbound'],
    [C.carlosGarcia,    A.omega,     'Carlos',   'Garcia',    'c.garcia@omegamfg.com',       '313-555-0902', 'CTO',                       'customer',  'referral'],
    [C.elenaRossi,      A.omega,     'Elena',    'Rossi',     'e.rossi@omegamfg.com',        '313-555-0903', 'Director Supply Chain',     'customer',  'inbound'],
    [C.williamJones,    A.omega,     'William',  'Jones',     'w.jones@omegamfg.com',        '313-555-0904', 'Head of IT',                'customer',  'inbound'],
    [C.patriciaBrown,   A.omega,     'Patricia', 'Brown',     'p.brown@omegamfg.com',        '313-555-0905', 'VP Manufacturing',          'customer',  'referral'],
    // NovaBridge
    [C.elijahWalker,    A.novabridge,'Elijah',   'Walker',    'ewalker@novabridge.com',      '212-555-1001', 'Managing Partner',          'lead',      'conference'],
    [C.graceLee,        A.novabridge,'Grace',    'Lee',       'g.lee@novabridge.com',        '212-555-1002', 'Head of Technology',        'lead',      'conference'],
    [C.tylerChen,       A.novabridge,'Tyler',    'Chen',      't.chen@novabridge.com',       '212-555-1003', 'VP Operations',             'lead',      'outbound'],
    [C.isabellaMartinez,A.novabridge,'Isabella', 'Martinez',  'i.martinez@novabridge.com',   '212-555-1004', 'Director of Finance',       'lead',      'outbound'],
    [C.seanPark,        A.novabridge,'Sean',     'Park',      's.park@novabridge.com',       '212-555-1005', 'IT Director',               'lead',      'outbound'],
  ];

  for (const [id, accId, first, last, email, phone, title, stage, source] of contacts) {
    await db.query(
      `INSERT INTO contacts
         (id, tenant_id, first_name, last_name, email, phone, title,
          account_id, company_name, lifecycle_stage, source, created_by)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,a.name,$9,$10,$11
       FROM accounts a WHERE a.id = $8`,
      [id, tenantId, first, last, email, phone, title, accId, stage, source, userId],
    );
  }

  // ── Opportunities ─────────────────────────────────────────────────────────────

  const O = {
    acmeExpansion:    uid(),
    techflowGrowth:   uid(),
    financeAnalytics: uid(),
    cloudnineStarter: uid(),
    biogenRD:         uid(),
  };

  type OppRow = [string, string, string, string, string, number, string, number, string];
  const opps: OppRow[] = [
    [O.acmeExpansion,    'Acme Corp — Platform Expansion',        A.acme,      C.sarahChen,     'negotiation',   180_000, '2026-04-30', 75, 'Full rollout to all 850 seats, enterprise support tier'],
    [O.techflowGrowth,   'TechFlow — Growth Package Upgrade',     A.techflow,  C.michaelTorres, 'proposal',       64_000, '2026-05-15', 55, 'Upgrade starter → growth, adds AI context features'],
    [O.financeAnalytics, 'FinanceFirst — Analytics Suite',        A.finance,   C.jamesWilson,   'qualification',  52_000, '2026-06-30', 35, 'AI-powered revenue forecasting for 12 AEs; replacing Dynamics 2019'],
    [O.cloudnineStarter, 'CloudNine Solutions — Starter Bundle',  A.cloudnine, C.liamRodriguez, 'prospecting',    18_000, '2026-07-31', 15, 'Initial 50-seat CRM package, land-and-expand motion'],
    [O.biogenRD,         'BioGen Labs — R&D Data Platform',       A.biogen,    C.noahJohnson,   'proposal',      145_000, '2026-05-31', 60, 'Research data management and pipeline analytics'],
  ];

  for (const [id, name, accId, contId, stage, amount, closeDate, prob, desc] of opps) {
    await db.query(
      `INSERT INTO opportunities
         (id, tenant_id, name, account_id, contact_id, stage, amount, close_date,
          probability, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, tenantId, name, accId, contId, stage, amount, closeDate, prob, desc, userId],
    );
  }

  // ── Activities helper ─────────────────────────────────────────────────────────

  let activityCount = 0;

  async function act(
    type: string,
    subject: string,
    body: string,
    contactId: string | null,
    accountId: string | null,
    opportunityId: string | null,
    occurredDaysAgo: number,
    status: 'completed' | 'pending' = 'completed',
  ): Promise<void> {
    const id = uid();
    const occurredAt = ago(occurredDaysAgo);
    const subjectType = contactId ? 'contact' : accountId ? 'account' : 'opportunity';
    const subjectId   = contactId ?? accountId ?? opportunityId ?? '';
    await db.query(
      `INSERT INTO activities
         (id, tenant_id, type, activity_type, subject, body, status,
          contact_id, account_id, opportunity_id,
          subject_type, subject_id,
          occurred_at, completed_at, created_by, performed_by)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id, tenantId, type, subject, body, status,
        contactId, accountId, opportunityId,
        subjectType, subjectId,
        occurredAt, status === 'completed' ? occurredAt : null,
        userId, actorId,
      ],
    );
    activityCount++;
  }

  // Showcase: James Wilson / FinanceFirst (5 rich activities)
  await act('outreach_call', 'Initial outreach — CRM modernisation discovery',
    'Connected with James Wilson (CFO) after meeting at FinTech Summit. 20-minute intro call. He confirmed they are evaluating options to replace their EOL Dynamics 2019 instance. Budget cycle aligns with Q2 FY close (June 30). Agreed to set up a full demo with the technical team.',
    C.jamesWilson, A.finance, null, 62);

  await act('meeting_held', 'Product demo — analytics and AI context features',
    'Full 90-minute demo for James Wilson and Catherine Lee (Head of Technology). Showcased pipeline analytics, AI briefing engine, and context memory. Catherine was visibly excited about briefing_get and the context engine. James focused on pricing and security. Action: send SOC 2 report and reference list (finance vertical) by next week.',
    C.jamesWilson, A.finance, O.financeAnalytics, 45);

  await act('outreach_email', 'Sent SOC 2 report, pricing proposal, and reference list',
    'Delivered on post-demo commitments: (1) SOC 2 Type II report attached, (2) custom pricing proposal at $52K/year including professional services, (3) list of 3 finance-vertical reference customers — NovaBridge Capital, FinEdge Partners, Meridian Wealth. Requested intro call with their legal/procurement team.',
    C.jamesWilson, A.finance, O.financeAnalytics, 30);

  await act('outreach_call', 'Technical deep-dive — security and integration requirements',
    'Technical call with Catherine Lee and Henry Park (IT Manager). Reviewed our data model, encryption at rest, and API architecture. Henry had detailed questions about the PostgreSQL schema and webhook reliability. Catherine confirmed the Dynamics 2019 migration path is feasible. James joined the last 10 minutes — reiterated hard June 30 budget deadline.',
    C.jamesWilson, A.finance, O.financeAnalytics, 15);

  await act('meeting_held', 'Executive business review — budget discussion',
    'Key 60-min Zoom with James Wilson (CFO) and Catherine Lee (Head of Technology). James confirmed the $52K budget has board approval for Q1. He is running a parallel Salesforce evaluation — decision expected by April 20. He needs an ROI calculator showing 3-year TCO vs Salesforce before he can make a recommendation to the board. Committed to delivering by March 18.',
    C.jamesWilson, A.finance, O.financeAnalytics, 15);

  // Showcase: Sarah Chen / Acme Corp (4 activities)
  await act('meeting_held', 'Annual executive business review — renewal + expansion',
    'QBR with Sarah Chen (VP Engineering) and Marcus Rivera (CTO). Platform adoption at 97% across current 340 seats. Sales team reporting 35% reduction in pre-call research time. Raised possibility of expanding to all 850 employees for FY2027. Sarah is championing the expansion internally — needs a revised contract covering all seats plus enterprise SLA.',
    C.sarahChen, A.acme, O.acmeExpansion, 68);

  await act('outreach_call', 'Renewal confirmed — expansion scope discussion',
    'Follow-up with Sarah Chen. She confirmed renewal is approved. Now scoping the full 850-seat expansion. New procurement process added a security audit step — we need to submit a vendor security questionnaire to their InfoSec team. Timeline: 4-6 weeks for audit. Expansion contract should close by end of April.',
    C.sarahChen, A.acme, O.acmeExpansion, 42);

  await act('outreach_email', 'Sent expansion proposal — 850-seat enterprise contract',
    'Delivered custom expansion proposal including: volume pricing for 850 seats ($180K/year vs $85K current), dedicated CSM, enterprise SLA (99.9% uptime, 4hr response), and quarterly executive reviews. Also attached the vendor security questionnaire completed by our InfoSec team.',
    C.sarahChen, A.acme, O.acmeExpansion, 28);

  await act('meeting_held', 'Contract review with Acme legal and procurement',
    'Working session with Sarah Chen, their General Counsel (Rachel Moore), and procurement lead. Reviewed MSA redlines. Three open items: (1) data residency clause — we are adding US-only hosting commitment, (2) SLA credits calculation — aligned on 10% credit per hour beyond SLA, (3) auto-renewal notice period extended from 30 to 60 days. Next step: final redlines from their legal by April 5.',
    C.sarahChen, A.acme, O.acmeExpansion, 10);

  // Emma Patel / MediCare (3 activities)
  await act('meeting_held', 'HIPAA compliance module — implementation kickoff',
    'Kickoff with Emma Patel (Director IT) and the MediCare implementation team. Reviewed HIPAA BAA signed last week. Defined 30/60/90-day milestones for compliance module rollout. Emma confirmed all 1,200 employees will migrate from their legacy system by end of Q1.',
    C.emmaPatel, A.medicare, null, 88);

  await act('outreach_call', 'Health check — 90-day post-go-live review',
    'Check-in with Emma Patel. HIPAA compliance module is live and performing well. 98% user adoption. Automated reporting saving their compliance team 12 hours/week. Emma mentioned the telehealth workflow team is interested in an extension for patient journey tracking — flagged as expansion opportunity.',
    C.emmaPatel, A.medicare, null, 44);

  await act('meeting_held', 'Q1 QBR — expansion discussion (telehealth workflows)',
    'Quarterly review with Emma Patel and Rachel Kim (VP Operations). Strong NPS of 71. Discussed expanding into telehealth workflow automation — estimated 2,400 additional workflow events/month. Emma is preparing an internal business case for the expansion. Expected decision by end of Q2. No current competitors in evaluation.',
    C.emmaPatel, A.medicare, null, 24);

  // Noah Johnson / BioGen (4 activities)
  await act('outreach_call', 'Post-conference follow-up — BioWorld 2025 intro',
    'Brief intro call following our BioWorld conference booth conversation with Noah Johnson (SVP R&D). He is evaluating research data management platforms for their 670-person R&D org. Strong interest in our structured context and knowledge graph capabilities for multi-year research project tracking.',
    C.noahJohnson, A.biogen, null, 73);

  await act('meeting_held', 'Deep-dive demo — research data platform capabilities',
    'Full demo for Noah Johnson (SVP R&D) and Emily Chen (VP Research). Demonstrated context versioning, confidence scoring, and the briefing engine. Emily was very engaged with the supersedes_id revision chain — she sees direct applicability to their experimental hypothesis tracking. Noah asked hard questions about EU data residency for their Frankfurt research teams.',
    C.noahJohnson, A.biogen, O.biogenRD, 46);

  await act('outreach_email', 'Sent security documentation and data residency options',
    'Delivered: (1) SOC 2 Type II report, (2) ISO 27001 certificate, (3) data residency documentation including EU-hosted option on Frankfurt AWS region, (4) DPA template for GDPR compliance. Also included references from two other biotech customers. Noah confirmed their legal team will start review — typical timeline 3-4 months at BioGen.',
    C.noahJohnson, A.biogen, O.biogenRD, 28);

  await act('outreach_call', 'Legal review status check',
    'Brief check-in with Noah Johnson. Legal review is underway. No blockers identified yet. He confirmed the budget is reserved for H1 and the proposal is still being evaluated seriously alongside AWS HealthLake. He asked us to submit a formal security questionnaire to their vendor management portal — due April 5.',
    C.noahJohnson, A.biogen, O.biogenRD, 18);

  // Generic activities for remaining contacts (2-3 each)
  const genericActs: Array<[string, string, string | null, string | null, number]> = [
    // TechFlow
    [C.michaelTorres, A.techflow, null, O.techflowGrowth, 55],
    [C.michaelTorres, A.techflow, null, O.techflowGrowth, 25],
    [C.rebeccaKim,    A.techflow, null, null,              48],
    [C.rebeccaKim,    A.techflow, null, null,              18],
    [C.tomNguyen,     A.techflow, null, null,              35],
    [C.sandraPatel,   A.techflow, null, null,              60],
    [C.kevinLiu,      A.techflow, null, null,              40],
    // RetailMax
    [C.oliviaNguyen,  A.retailmax, null, null, 70],
    [C.oliviaNguyen,  A.retailmax, null, null, 30],
    [C.frankChen,     A.retailmax, null, null, 55],
    [C.mariaSantos,   A.retailmax, null, null, 45],
    [C.chrisDavis,    A.retailmax, null, null, 33],
    [C.ashleyKim,     A.retailmax, null, null, 20],
    // CloudNine
    [C.liamRodriguez, A.cloudnine, null, O.cloudnineStarter, 38],
    [C.priyaPatel,    A.cloudnine, null, O.cloudnineStarter, 22],
    [C.alexJohnson,   A.cloudnine, null, null,              50],
    // DataSphere
    [C.avaKim,        A.datasphere, null, null, 80],
    [C.avaKim,        A.datasphere, null, null, 35],
    [C.marcusThompson,A.datasphere, null, null, 60],
    [C.lilyPark,      A.datasphere, null, null, 42],
    // Omega
    [C.miaThompson,   A.omega, null, null, 65],
    [C.miaThompson,   A.omega, null, null, 28],
    [C.carlosGarcia,  A.omega, null, null, 50],
    [C.elenaRossi,    A.omega, null, null, 38],
    [C.williamJones,  A.omega, null, null, 22],
    // NovaBridge
    [C.elijahWalker,  A.novabridge, null, null, 45],
    [C.graceLee,      A.novabridge, null, null, 30],
    [C.tylerChen,     A.novabridge, null, null, 55],
  ];

  const genericTypes = ['outreach_call', 'outreach_email', 'meeting_held', 'note_added'];
  const genericSubjects = [
    ['Discovery call', 'Discussed platform capabilities and fit. Requested follow-up materials.'],
    ['Follow-up email', 'Sent product overview deck and case studies relevant to their industry.'],
    ['Stakeholder meeting', 'Reviewed requirements with the extended team. Strong interest in context engine features.'],
    ['Internal note', 'Research completed on prospect. Good ICP fit — mid-market, data-driven, growing headcount.'],
  ];

  for (let i = 0; i < genericActs.length; i++) {
    const [cId, aId, , oppId, daysAgo] = genericActs[i];
    const tIdx = i % 4;
    const [subj, body] = genericSubjects[tIdx];
    await act(genericTypes[tIdx], subj, body, cId, aId, oppId ?? null, daysAgo);
  }

  // ── Context entries helper ────────────────────────────────────────────────────

  let contextCount = 0;

  async function ctx(
    subjectType: 'contact' | 'account' | 'opportunity',
    subjectId: string,
    contextType: string,
    title: string,
    body: string,
    opts: {
      confidence?: number;
      validUntil?: string | null;
      structuredData?: Record<string, unknown>;
      tags?: string[];
      isCurrent?: boolean;
      supersedesId?: string | null;
      createdAt?: string;
    } = {},
  ): Promise<string> {
    const id = uid();
    const {
      confidence = 0.7,
      validUntil = null,
      structuredData = {},
      tags = [],
      isCurrent = true,
      supersedesId = null,
      createdAt = new Date().toISOString(),
    } = opts;

    // memory_status must align with is_current: superseded entries are not 'active'
    const memoryStatus = isCurrent ? 'active' : 'superseded';

    await db.query(
      `INSERT INTO context_entries
         (id, tenant_id, subject_type, subject_id, context_type, authored_by,
          title, body, structured_data, confidence, is_current, supersedes_id,
          source, tags, valid_until, memory_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
      [
        id, tenantId, subjectType, subjectId, contextType, actorId,
        title, body, JSON.stringify(structuredData), confidence,
        isCurrent, supersedesId,
        'demo', JSON.stringify(tags), validUntil, memoryStatus, createdAt,
      ],
    );
    contextCount++;
    return id;
  }

  // ── Context: James Wilson / FinanceFirst (showcase — 9 entries) ───────────────

  await ctx('contact', C.jamesWilson, 'commitment',
    'Q1 budget approval confirmed — $52K analytics suite',
    'In our March 10 executive call, James confirmed that the $52K annual budget for the analytics suite has been approved at the board level for Q1. This covers the core analytics platform and $8K in professional services for migration from Dynamics 2019. Implementation must begin before March 31 to hit the Q2 reporting deadline. James explicitly said the budget does not roll over into FY2027.',
    {
      confidence: 0.90,
      validUntil: fromNow(60),
      structuredData: {
        commitment_type: 'budget_approved',
        committed_by: 'James Wilson',
        value: '$52,000 analytics suite annual subscription + $8,000 professional services',
        due_date: '2026-06-30',
      },
      tags: ['budget', 'q1', 'decision'],
    });

  await ctx('contact', C.jamesWilson, 'deal_risk',
    'Active Salesforce evaluation — decision deadline April 20',
    'FinanceFirst is running a parallel evaluation with Salesforce as of early March 2026. Salesforce submitted an Enterprise CRM + Tableau Analytics package at $85K/year (vs our $52K). The Salesforce team completed a live demo on March 12. James confirmed the decision deadline is approximately April 20 — he wants to make a recommendation to the board before their April 22 board meeting. Key vulnerability: Salesforce has stronger brand recognition internally; our advantage is 40% lower TCO and 60-day activation vs their typical 6-9 month rollout.',
    {
      confidence: 0.85,
      validUntil: fromNow(30),
      structuredData: {
        risk_type: 'competitive',
        severity: 'high',
        competitor: 'Salesforce',
        their_price: 85000,
        decision_deadline: '2026-04-20',
        mitigation: 'Deliver ROI calculator immediately; schedule executive reference call with NovaBridge Capital CFO',
      },
      tags: ['salesforce', 'competitive', 'urgent'],
    });

  await ctx('contact', C.jamesWilson, 'next_step',
    'ROI calculator delivery — OVERDUE (was due March 18)',
    'After the March 10 EBR, we committed to sending James an ROI calculator showing 3-year total cost of ownership comparison vs Salesforce by March 18. This item is now overdue. James specifically requested this before he can make his board recommendation. This is blocking deal progression and needs immediate follow-up — the longer it takes, the more ground Salesforce gains.',
    {
      confidence: 0.95,
      validUntil: ago(7), // STALE — was due 7 days ago
      structuredData: {
        action: 'Deliver ROI calculator: 3-year TCO comparison vs Salesforce (CRMy $52K vs SFDC $85K)',
        owner: 'Account Executive',
        due_date: ago(7).split('T')[0],
        priority: 'urgent',
        blocking: true,
      },
      tags: ['overdue', 'roi', 'action-required'],
    });

  await ctx('contact', C.jamesWilson, 'objection',
    'Price sensitivity — 30% above current CRM spend',
    'James flagged that FinanceFirst\'s current annual CRM spend is $40K (aging on-prem Dynamics 2019 with 2 FTEs maintaining it). Our $52K quote is ~30% above that headline number. He is not blocked on price — the board has approved it — but he needs to justify the delta in his board presentation. Recommended framing: net savings of $120K/year when factoring out the 2-FTE maintenance cost and eliminating 3 bolt-on analytics tools. Also offered quarterly payment option to reduce cash flow impact.',
    {
      confidence: 0.80,
      validUntil: fromNow(45),
      structuredData: {
        objection_type: 'pricing',
        severity: 'medium',
        current_spend: 40000,
        quoted_price: 52000,
        status: 'in_progress',
        response_given: 'Framing as net savings; quarterly payment option offered; preparing board-ready ROI deck',
      },
      tags: ['pricing', 'objection'],
    });

  await ctx('contact', C.jamesWilson, 'stakeholder',
    'James Wilson — CFO profile and buying style',
    'James Wilson joined FinanceFirst 3 years ago from JP Morgan Chase where he was SVP Finance. He is analytically rigorous and prefers data over storytelling — he will not approve a vendor without a solid ROI model and verifiable references. He has a known pattern of delaying decisions until he has at least 3 reference customers from his own industry. Secondary decision-maker: Catherine Lee (Head of Technology, joined January 2026 from Goldman Sachs) — she is the technical champion with strong internal credibility, but does not have budget authority. Henry Park (IT Manager) is the day-to-day evaluator and is technically very capable.',
    {
      confidence: 0.90,
      structuredData: {
        name: 'James Wilson',
        role: 'CFO',
        influence_level: 'decision_maker',
        sentiment: 'cautiously_positive',
        decision_style: 'data_driven',
        key_concerns: ['ROI justification', 'vendor track record in finance vertical', 'data security and compliance'],
        internal_champion: 'Catherine Lee (Head of Technology)',
      },
      tags: ['cfp', 'decision-maker', 'stakeholder-map'],
    });

  await ctx('contact', C.jamesWilson, 'competitive_intel',
    'Salesforce evaluation — positioning and counter-strategy',
    'Salesforce submitted Enterprise CRM + Tableau Analytics bundle at $85K/year. Their demo (March 12) focused on dashboards and pipeline analytics — standard playbook. FinanceFirst\'s internal team expressed concern about Salesforce implementation complexity; they researched a similar-sized finance firm that took 14 months to go live. This is our primary wedge: 60-day activation guarantee vs Salesforce\'s typical 6-14 month timeline. Also key: CRMy\'s AI context engine has no Salesforce equivalent — their AI features are Einstein, which is add-on and adds ~$25K/year. Position our $52K as all-inclusive against Salesforce\'s $85K base + $25K Einstein + implementation costs.',
    {
      confidence: 0.75,
      validUntil: fromNow(45),
      structuredData: {
        competitor: 'Salesforce',
        solution: 'Enterprise CRM + Tableau Analytics + Einstein AI',
        their_price: 85000,
        their_strengths: ['brand recognition', 'ecosystem breadth', 'established finance vertical references'],
        their_weaknesses: ['implementation complexity (6-14 months)', 'high TCO with add-ons', 'AI features are bolt-on'],
        our_counter: '60-day activation guarantee; AI-native context engine included; 40% lower 3-year TCO',
      },
      tags: ['salesforce', 'competitive', 'positioning'],
    });

  await ctx('contact', C.jamesWilson, 'key_fact',
    'Hard close deadline: June 30 fiscal year end',
    'FinanceFirst operates on a fiscal year ending June 30. Any software commitment not signed before June 30 rolls into FY2027 budget planning (which starts in August after the July board meeting), causing a minimum 5-month delay. James was explicit: "I have board approval to spend from this year\'s budget, but it expires June 30 — if we don\'t sign by then, this goes back to the board next fiscal year." This is a real hard deadline, not a negotiating tactic.',
    {
      confidence: 0.95,
      structuredData: {
        category: 'timeline_constraint',
        fact: 'FY ends June 30; unspent budget authorization expires and does not roll over',
        implication: 'Deal must be signed by June 30 or faces minimum 5-month delay',
        source: 'direct_statement_james_wilson_march_10',
      },
      tags: ['deadline', 'fiscal-year', 'critical'],
    });

  await ctx('contact', C.jamesWilson, 'meeting_notes',
    'Discovery call notes — March 10, 2026',
    `60-minute Zoom with James Wilson (CFO) and Catherine Lee (Head of Technology). Attended by: our AE and SE.

Key findings:
• Current CRM: Microsoft Dynamics 2019 (EOL) — painful to maintain, requires 2 dedicated FTEs
• Primary use case: AI-powered revenue forecasting + deal intelligence for 12 AEs
• Secondary use case: Automated activity capture and context extraction from call recordings
• Security requirement: SOC 2 Type II + BAA required before contract signing
• Data residency: US-only acceptable (no EU or APAC hosting needed)
• Timeline: Want live before July 1 to start new fiscal year on the platform
• Champion: Catherine Lee — researching CRMy for 3 weeks, technically enthusiastic
• Blocker: James needs 3 finance-vertical reference customers before recommendation

Action items (from this call):
1. ✅ Send reference customer list (finance vertical) — delivered March 13
2. ⚠️  Send ROI calculator (3-year TCO vs Salesforce) — due March 18, OVERDUE
3. ✅ Submit SOC 2 Type II report — delivered March 13
4. 📅 Schedule technical deep-dive with Catherine — completed March 20`,
    {
      confidence: 1.0,
      tags: ['meeting-notes', 'discovery', 'march-2026'],
    });

  await ctx('contact', C.jamesWilson, 'sentiment_analysis',
    'Post-EBR sentiment: 7/10 — cautiously engaged',
    'Sentiment assessment following March 10 EBR. James Wilson scored 7/10 overall engagement (up from 5/10 at first touch — January LinkedIn outreach). Positive signals: asked 8 detailed technical questions about data model and API, requested follow-up before end of week, proactively shared Salesforce pricing. Negative signals: mentioned Salesforce unprompted twice, expressed mild concern about "yet another CRM vendor" and 12-month contract lock-in. Overall trajectory is improving but ROI calculator delivery failure may have cooled sentiment — follow-up urgently needed.',
    {
      confidence: 0.70,
      validUntil: ago(14), // STALE — sentiment assessment is 14 days old
      structuredData: {
        score: 7,
        scale: 10,
        trend: 'improving',
        previous_score: 5,
        positive_signals: ['technical curiosity', 'proactive Salesforce disclosure', 'unprompted follow-up request'],
        negative_signals: ['repeated Salesforce mention', 'contract length concern'],
        assessed_at: ago(15).split('T')[0],
        risk: 'ROI calculator overdue may have impacted sentiment negatively',
      },
      tags: ['sentiment', 'engagement'],
    });

  // ── Context: FinanceFirst account (4 entries, including superseded chain) ─────

  const oldResearchId = await ctx('account', A.finance, 'research',
    'FinanceFirst — initial company research',
    'FinanceFirst was founded in 2008 as a regional mid-market finance services firm. Headquartered in New York (340 FTEs). Focus areas: commercial lending, wealth management, and SMB treasury services. Estimated ARR ~$7.8M. Currently using Microsoft Dynamics 2019 for CRM. No recent funding events or major news found. ICP fit: good — mid-market finance, data-driven culture, growing headcount.',
    {
      confidence: 0.75,
      isCurrent: false, // superseded by updated research
      createdAt: ago(45),
      tags: ['research', 'initial'],
    });

  await ctx('account', A.finance, 'research',
    'FinanceFirst — updated research (post Series C)',
    'UPDATED March 20, 2026: FinanceFirst closed a $35M Series C in February 2026 (lead: Sequoia Growth, source: Crunchbase + press release). They are actively expanding into consumer banking and hired 40 FTEs in Q1 alone — headcount now at 340 and growing to ~420 by year-end. New CTO hire: Catherine Lee (ex-Goldman Sachs tech executive, joined January 2026) is driving the CRM modernisation initiative. Series C financing puts them on track to 2x ARR in 18 months. REVISED ICP ASSESSMENT: Tier 1 account. Upgrade account health score and prioritise deal closure.',
    {
      confidence: 0.90,
      supersedesId: oldResearchId,
      createdAt: ago(5),
      tags: ['research', 'updated', 'series-c', 'tier-1'],
    });

  await ctx('account', A.finance, 'relationship_map',
    'FinanceFirst — org chart and influence map',
    'C-Suite: CEO David Park (low engagement with us — has not attended any calls), CFO James Wilson (primary sponsor, budget owner), Head of Technology Catherine Lee (champion, strong internal credibility). Board: 5 members including 2 Sequoia Growth partners from Series C. Key influencers: IT Manager Henry Park (reports to Catherine, day-to-day evaluator, technically rigorous) and Director of Finance Diana Torres (will own MSA contract negotiation once James gives the go-ahead). Legal: outside counsel at Sullivan & Cromwell — slow review cycle, 4-6 weeks typical.',
    {
      confidence: 0.90,
      structuredData: {
        sponsor: 'James Wilson (CFO)',
        champion: 'Catherine Lee (Head of Technology)',
        evaluator: 'Henry Park (IT Manager)',
        contract_owner: 'Diana Torres (Director of Finance)',
        legal: 'Sullivan & Cromwell (outside counsel)',
        board_influence: 'Sequoia Growth partners (2 of 5 board seats)',
      },
      tags: ['org-chart', 'stakeholders', 'relationships'],
    });

  await ctx('account', A.finance, 'summary',
    'FinanceFirst — account summary',
    'HIGH PRIORITY prospect. $7.8M ARR, 340 employees (growing to ~420), Series C closed February 2026. Evaluating CRMy vs Salesforce for CRM modernisation, replacing EOL Microsoft Dynamics 2019. Deal: $52K/year analytics suite (qualification stage). Champion: Catherine Lee (Head of Technology). Budget owner: James Wilson (CFO). Hard close deadline: June 30 fiscal year end — no flexibility. Primary risk: parallel Salesforce evaluation with April 20 decision deadline. Primary advantage: 40% lower 3-year TCO and 60-day activation vs Salesforce\'s 6-14 months. URGENT: ROI calculator delivery is 7+ days overdue and is blocking deal progression.',
    {
      confidence: 0.95,
      tags: ['summary', 'account-overview', 'urgent'],
    });

  // ── Context: Sarah Chen / Acme Corp (showcase — 6 entries) ───────────────────

  await ctx('contact', C.sarahChen, 'commitment',
    'Platform expansion to 850 seats — budget confirmed',
    'Sarah Chen confirmed in the Q1 EBR that the Acme board has approved the full-company platform expansion covering all 850 seats for FY2027. This represents a revenue increase from $85K/year (current 340 seats) to $180K/year. The expansion contract must close by April 30 to meet their FY planning timeline.',
    {
      confidence: 0.95,
      validUntil: fromNow(55),
      structuredData: { commitment_type: 'budget_approved', committed_by: 'Sarah Chen', value: '$180,000 full-company expansion', due_date: '2026-04-30' },
      tags: ['expansion', 'commitment', 'budget'],
    });

  await ctx('contact', C.sarahChen, 'next_step',
    'Finalise contract amendments with Acme legal by April 5',
    'Three open contract items from March 15 legal review: (1) US-only data residency clause to be added by our legal team, (2) SLA credits at 10% per hour beyond SLA agreed in principle, (3) auto-renewal notice period extended to 60 days. Acme\'s General Counsel Rachel Moore will deliver final redlines by April 5. We need to turn around within 48 hours to hit April 10 signing target.',
    {
      confidence: 0.90,
      validUntil: fromNow(16),
      structuredData: { action: 'Respond to final contract redlines', owner: 'Account Executive + Legal', due_date: fromNow(16).split('T')[0] },
      tags: ['contract', 'legal', 'expansion'],
    });

  await ctx('contact', C.sarahChen, 'stakeholder',
    'Sarah Chen — VP Engineering, primary champion',
    'Sarah Chen has been the primary CRMy champion at Acme for 18 months. She personally drove adoption from pilot (50 seats) to current 340-seat deployment. She is technically sophisticated — understands our data model and frequently uses briefing_get in her own workflow. She reports directly to Marcus Rivera (CTO) who is supportive but uninvolved in day-to-day. She has full authority to recommend the expansion; Marcus will sign off based on her recommendation.',
    {
      confidence: 0.90,
      tags: ['champion', 'vp-engineering', 'decision-maker'],
    });

  await ctx('contact', C.sarahChen, 'deal_risk',
    'New InfoSec audit requirement from Acme procurement',
    'As part of their post-Series D procurement hardening (November 2025), Acme now requires all vendors above $100K/year to complete a vendor security questionnaire and receive InfoSec sign-off before contract expansion. We submitted our completed questionnaire on March 28. Estimated InfoSec review: 4-6 weeks. This could push the contract close from April 30 to late May if they don\'t expedite. Sarah is escalating internally to request a prioritised review.',
    {
      confidence: 0.70,
      validUntil: fromNow(30),
      structuredData: { risk_type: 'process', severity: 'medium', mitigation: 'Sarah escalating for prioritised review; questionnaire submitted March 28' },
      tags: ['security-audit', 'procurement', 'risk'],
    });

  await ctx('contact', C.sarahChen, 'key_fact',
    'Acme runs SAP ERP — deep integration is deal requirement',
    'Acme Corp runs SAP S/4HANA for all financial and operational data. Sarah confirmed in the EBR that any expanded CRM deployment must include a native SAP integration for opportunity-to-revenue reconciliation. She has an internal SAP architect (Amy Walsh) who will need to review our integration approach. This is a hard requirement for the expansion — not optional.',
    {
      confidence: 0.95,
      tags: ['integration', 'sap', 'technical-requirement'],
    });

  await ctx('contact', C.sarahChen, 'sentiment_analysis',
    'Sentiment: 9/10 — strongest champion in portfolio',
    'Sarah Chen is the most engaged champion across the entire customer base. Consistently responds to emails within 2 hours. Has referred 3 other prospects to us (DataSphere, CloudNine, and BioGen introductions all originated from her). Proactively advocates for CRMy in industry forums. The only reason she isn\'t 10/10 is the InfoSec audit uncertainty — she is frustrated by her own procurement process, not by the product.',
    {
      confidence: 0.88,
      validUntil: fromNow(14),
      structuredData: { score: 9, scale: 10, trend: 'stable_high', assessed_at: ago(10).split('T')[0] },
      tags: ['sentiment', 'champion', 'referral-source'],
    });

  // ── Context: Emma Patel / MediCare (4 entries) ───────────────────────────────

  await ctx('contact', C.emmaPatel, 'commitment',
    'HIPAA compliance module — full rollout complete, 100% adoption',
    'Emma confirmed in the Q1 QBR that the HIPAA compliance module rollout is complete across all 1,200 MediCare employees. Adoption rate: 98%. Automated compliance reporting is saving their team an estimated 12 hours/week. Emma is now preparing the business case for the telehealth workflow expansion.',
    {
      confidence: 0.95,
      structuredData: { commitment_type: 'decision_made', committed_by: 'Emma Patel', value: 'Full HIPAA module rollout — 1,200 users, 98% adoption' },
      tags: ['hipaa', 'adoption', 'success'],
    });

  await ctx('contact', C.emmaPatel, 'key_fact',
    'All vendor software requires HIPAA BAA before deployment',
    'MediCare has a standing policy: any software touching patient data — even indirectly — requires a signed Business Associate Agreement before any production deployment. Emma is the designated BAA signing authority for technology vendors. Average BAA turnaround at MediCare: 3-4 weeks from receipt to signature. Plan accordingly for any expansion scope.',
    {
      confidence: 0.95,
      tags: ['hipaa', 'baa', 'compliance', 'procurement'],
    });

  await ctx('contact', C.emmaPatel, 'stakeholder',
    'Emma Patel — Director IT, technical gatekeeper',
    'Emma Patel is the technical gatekeeper for all vendor technology decisions at MediCare. She has been Director of IT for 6 years and has a reputation for rigorous vendor evaluation — but once committed, she becomes a vocal internal advocate. She has direct budget authority up to $500K/year without board approval. She is risk-averse on new vendors but has become a strong CRMy champion after the successful HIPAA rollout. CISO Nancy Liu is a secondary approval for security tooling but does not have final say on CRM.',
    {
      confidence: 0.88,
      tags: ['gatekeeper', 'budget-authority', 'champion'],
    });

  await ctx('contact', C.emmaPatel, 'meeting_notes',
    'Q1 QBR notes — March 1, 2026',
    `45-minute QBR with Emma Patel (Director IT) and Rachel Kim (VP Operations).

Results:
• HIPAA compliance module: 100% deployed, 98% active usage
• Automated weekly compliance reports eliminating 12 hours/week of manual work
• NPS: 71 (up from 44 at 6-month mark)
• Zero critical incidents in 12 months

Expansion discussion:
• Telehealth workflow automation: ~2,400 workflow events/month projected
• Rachel Kim: "The briefing engine would be transformative for our care coordinators"
• Emma is preparing internal business case — targeting Q2 budget approval
• No competitive pressure identified

Action items:
1. Send telehealth workflow use case documentation — due March 8 ✅
2. Schedule technical scoping call with Emma + IT architect — pending`,
    {
      confidence: 1.0,
      tags: ['meeting-notes', 'qbr', 'expansion'],
    });

  // ── Context: Noah Johnson / BioGen (5 entries) ───────────────────────────────

  await ctx('contact', C.noahJohnson, 'deal_risk',
    'Long legal review cycle — 3-4 months typical at BioGen',
    'BioGen Labs has a well-documented reputation for extended legal review cycles driven by their stringent IP protection policies. All vendor contracts go through their IP Counsel team before standard legal review — this adds 4-6 weeks to the normal 6-8 week commercial review. Realistic minimum from proposal to signature: 3 months. Noah acknowledged this directly: "Our legal team is thorough — plan for 12-16 weeks." This means the May 31 close date is very aggressive; more realistic target is August/September.',
    {
      confidence: 0.85,
      validUntil: fromNow(30),
      structuredData: { risk_type: 'process', severity: 'high', description: 'IP Counsel review + standard legal = 12-16 weeks minimum', mitigation: 'Start legal process in parallel with technical evaluation; submit NDA now' },
      tags: ['legal', 'timeline-risk', 'ip'],
    });

  await ctx('contact', C.noahJohnson, 'objection',
    'EU data sovereignty — Frankfurt region required for research data',
    'BioGen\'s EU-based research teams (Frankfurt office, ~120 researchers) are subject to GDPR and internal data sovereignty policies. All research data — including any data that flows through a CRM system — must remain in the AWS Frankfurt region (eu-central-1). Noah raised this as a hard requirement: "Our legal team will kill any deal that puts EU researcher data outside the EU." We provided our EU data residency documentation, but need to confirm Frankfurt-region SLA parity with our US regions.',
    {
      confidence: 0.80,
      validUntil: fromNow(45),
      structuredData: { objection_type: 'compliance', severity: 'high', requirement: 'All EU research data must remain in AWS eu-central-1 (Frankfurt)', status: 'under_review', response_given: 'EU data residency documentation provided; SLA parity confirmation pending' },
      tags: ['gdpr', 'eu', 'data-residency', 'compliance'],
    });

  await ctx('contact', C.noahJohnson, 'next_step',
    'Submit vendor security questionnaire to BioGen portal by April 5',
    'Noah Johnson requested we submit a formal security questionnaire to their vendor management portal (VendorSafe) by April 5. This is the official start of their vendor evaluation process and triggers the legal review clock. Failure to submit by April 5 would push the entire timeline by 4+ weeks due to their monthly vendor intake cycle.',
    {
      confidence: 0.88,
      validUntil: fromNow(11),
      structuredData: { action: 'Submit security questionnaire to VendorSafe portal', owner: 'Account Executive + Security Team', due_date: fromNow(11).split('T')[0], system: 'VendorSafe' },
      tags: ['action-required', 'security', 'deadline'],
    });

  await ctx('contact', C.noahJohnson, 'stakeholder',
    'Noah Johnson — SVP R&D, ultimate technical buyer',
    'Noah Johnson is the SVP of R&D and holds full budget authority for R&D tooling. He reports directly to the CEO and presents quarterly to the board. He attended BioWorld 2025 and sought out our booth after reading our whitepaper on AI-native research data management. He is technically sophisticated (PhD in Computational Biology, former software engineer). He has a reputation for long evaluation cycles but once committed becomes a long-term, loyal customer. Emily Chen (VP Research) is his technical champion who will do the day-to-day evaluation work.',
    {
      confidence: 0.85,
      tags: ['svp-rd', 'budget-authority', 'technical-buyer'],
    });

  await ctx('contact', C.noahJohnson, 'competitive_intel',
    'AWS HealthLake evaluation — active alternative',
    'BioGen is also evaluating AWS HealthLake as an alternative for research data management. Noah mentioned it in passing in the March 20 follow-up call. AWS HealthLake is purpose-built for healthcare/life sciences data but is a data lake product, not a CRM — the use cases overlap only partially (data storage and querying, not relationship management or context engine capabilities). Emily Chen reportedly prefers CRMy because of the context versioning and confidence scoring, which maps directly to their experimental hypothesis tracking workflow.',
    {
      confidence: 0.72,
      validUntil: fromNow(45),
      structuredData: { competitor: 'AWS HealthLake', overlap: 'partial', their_strength: 'purpose-built for life sciences data', our_advantage: 'Context engine, relationship management, briefing engine — features HealthLake has no equivalent for', champion_preference: 'Emily Chen prefers CRMy' },
      tags: ['aws', 'competitive', 'healthlake'],
    });

  // ── Context: Account-level entries for remaining accounts ────────────────────

  await ctx('account', A.acme, 'summary',
    'Acme Corp — key customer, expansion in progress',
    'Flagship enterprise customer since 2024. Currently 340 seats at $85K/year; expansion to 850 seats ($180K/year) in negotiation. Platform adoption at 97%. Sarah Chen (VP Engineering) is our strongest champion across the portfolio and has referred 3 prospects. Primary risk: InfoSec audit for expansion contract adds 4-6 week delay. Expected close: April 30 (potentially pushed to late May).',
    { confidence: 0.95, tags: ['summary', 'enterprise', 'expansion'] });

  await ctx('account', A.medicare, 'summary',
    'MediCare Systems — healthy customer, expansion pipeline',
    'HIPAA compliance module fully deployed, 98% adoption, NPS 71. Telehealth workflow expansion in early stages — Emma Patel preparing Q2 business case. No competitive pressure. Estimated expansion value: $45K/year incremental. Strong reference customer for healthcare vertical.',
    { confidence: 0.92, tags: ['summary', 'healthcare', 'expansion'] });

  await ctx('account', A.biogen, 'research',
    'BioGen Labs — company research',
    'BioGen Labs is a mid-sized healthcare/life sciences company (670 employees, $15M ARR). 120-person R&D team based in Frankfurt (EU) with additional teams in Boston and San Diego. Strong focus on computational biology and genomics. Well-funded — Series D in 2024. Strict vendor requirements driven by IP protection and GDPR. Long evaluation cycles typical. Potential deal value $145K/year.',
    { confidence: 0.82, tags: ['research', 'healthcare'] });

  // Simple note entries for other contacts
  const simpleNotes: Array<[string, string, string]> = [
    [C.michaelTorres, 'TechFlow CTO — technical evaluator', 'Michael Torres is leading the CRMy evaluation at TechFlow. CTO background, strong preference for API-first architecture. Asked detailed questions about webhook reliability and API rate limits. Positive overall but wants to see a reference from a company of similar size (~220 employees).'],
    [C.rebeccaKim,    'TechFlow VP Product — product champion', 'Rebecca Kim is excited about the context engine and sees applicability in their product feedback management workflow. She has influence but does not have budget authority — Michael Torres owns the decision.'],
    [C.oliviaNguyen,  'RetailMax Head of Ops — satisfied customer', 'Olivia has been using CRMy for 18 months. Primary use case: unified customer view across 5 retail brands. Adoption strong. No current expansion needs flagged — stable, healthy account.'],
    [C.liamRodriguez,  'CloudNine CEO — key decision maker for starter deal', 'Liam Rodriguez contacted us via the website after reading our developer blog. Budget-conscious (startup stage, 95 employees). Wants to start with starter package and expand. 30-day free trial requested — follow up with trial setup.'],
    [C.avaKim,        'DataSphere CDO — active partner', 'Ava Kim runs our strategic partner relationship at DataSphere. They are an OEM partner embedding CRMy context engine in their analytics platform. Relationship health: strong. Quarterly partner reviews running smoothly.'],
    [C.miaThompson,   'Omega Mfg VP Ops — enterprise customer', 'Mia Thompson manages day-to-day at Omega. Large enterprise account ($42M ARR, 1500 employees). Using CRMy for supply chain relationship management — non-standard use case but very high value. Annual renewal in October.'],
    [C.elijahWalker,  'NovaBridge Managing Partner — early stage lead', 'Elijah Walker met our CEO at a fintech conference. Interested in CRMy for client relationship management across their private equity portfolio companies. Budget TBD — needs qualification. Strong ICP fit based on industry and size.'],
  ];

  for (const [contactId, title, body] of simpleNotes) {
    await ctx('contact', contactId, 'note', title, body, { confidence: 0.75, tags: ['note'] });
  }

  return {
    accounts: accounts.length,
    contacts: contacts.length,
    opportunities: opps.length,
    activities: activityCount,
    contextEntries: contextCount,
    showcaseContactId: C.jamesWilson,
    showcaseContactName: 'James Wilson',
    showcaseAccountName: 'FinanceFirst',
  };
}
