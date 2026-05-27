// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';

export const SAMPLE_DATA_IDS = {
  ACTOR_HUMAN: 'd0000000-0000-4000-a000-000000000101',
  ACTOR_AGENT: 'd0000000-0000-4000-a000-000000000102',
  ACCOUNT: 'd0000000-0000-4000-b000-000000000101',
  CONTACT: 'd0000000-0000-4000-c000-000000000101',
  OPPORTUNITY: 'd0000000-0000-4000-d000-000000000101',
  USE_CASE: 'd0000000-0000-4000-f200-000000000101',
  ACTIVITY: 'd0000000-0000-4000-e000-000000000101',
  CONTEXT: 'd0000000-0000-4000-f000-000000000101',
  MEMORY_CRITERIA: 'd0000000-0000-4000-f000-000000000102',
  SIGNAL_SECURITY: 'd0000000-0000-4000-f000-000000000103',
  SIGNAL_BUYER: 'd0000000-0000-4000-f000-000000000104',
  SIGNAL_GROUP_SECURITY: 'd0000000-0000-4000-f500-000000000101',
  SIGNAL_GROUP_BUYER: 'd0000000-0000-4000-f500-000000000102',
  SIGNAL_GROUP_MEMBER_SECURITY: 'd0000000-0000-4000-f600-000000000101',
  SIGNAL_GROUP_MEMBER_BUYER: 'd0000000-0000-4000-f600-000000000102',
  ASSIGNMENT: 'd0000000-0000-4000-f100-000000000101',
  RAW_CONTEXT: 'd0000000-0000-4000-f300-000000000101',
  HANDOFF: 'd0000000-0000-4000-f400-000000000101',
} as const;

const IDS = SAMPLE_DATA_IDS;

const LEGACY_DEMO_IDS = [
  'd0000000-0000-4000-a000-000000000001',
  'd0000000-0000-4000-a000-000000000002',
  'd0000000-0000-4000-a000-000000000003',
  'd0000000-0000-4000-a000-000000000004',
  'd0000000-0000-4000-b000-000000000001',
  'd0000000-0000-4000-b000-000000000002',
  'd0000000-0000-4000-b000-000000000003',
  'd0000000-0000-4000-c000-000000000001',
  'd0000000-0000-4000-c000-000000000002',
  'd0000000-0000-4000-c000-000000000003',
  'd0000000-0000-4000-c000-000000000004',
  'd0000000-0000-4000-c000-000000000005',
  'd0000000-0000-4000-c000-000000000006',
  'd0000000-0000-4000-d000-000000000001',
  'd0000000-0000-4000-d000-000000000002',
  'd0000000-0000-4000-d000-000000000003',
  'd0000000-0000-4000-e000-000000000001',
  'd0000000-0000-4000-e000-000000000002',
  'd0000000-0000-4000-e000-000000000003',
  'd0000000-0000-4000-e000-000000000004',
  'd0000000-0000-4000-e000-000000000005',
  'd0000000-0000-4000-e000-000000000006',
  'd0000000-0000-4000-e000-000000000007',
  'd0000000-0000-4000-e000-000000000008',
  'd0000000-0000-4000-e000-000000000009',
  'd0000000-0000-4000-e000-000000000010',
  'd0000000-0000-4000-f000-000000000001',
  'd0000000-0000-4000-f000-000000000002',
  'd0000000-0000-4000-f000-000000000003',
  'd0000000-0000-4000-f000-000000000004',
  'd0000000-0000-4000-f000-000000000005',
  'd0000000-0000-4000-f000-000000000006',
  'd0000000-0000-4000-f000-000000000007',
  'd0000000-0000-4000-f000-000000000008',
  'd0000000-0000-4000-f000-000000000009',
  'd0000000-0000-4000-f000-000000000010',
  'd0000000-0000-4000-f000-000000000011',
  'd0000000-0000-4000-f000-000000000012',
  'd0000000-0000-4000-f000-000000000013',
  'd0000000-0000-4000-f000-000000000014',
  'd0000000-0000-4000-f000-000000000015',
  'd0000000-0000-4000-f000-000000000016',
  'd0000000-0000-4000-f000-000000000017',
  'd0000000-0000-4000-f000-000000000018',
  'd0000000-0000-4000-f000-000000000019',
  'd0000000-0000-4000-f000-000000000020',
  'd0000000-0000-4000-f000-000000000021',
  'd0000000-0000-4000-f100-000000000001',
  'd0000000-0000-4000-f100-000000000002',
  'd0000000-0000-4000-f100-000000000003',
  'd0000000-0000-4000-f200-000000000001',
  'd0000000-0000-4000-f200-000000000002',
  'd0000000-0000-4000-f200-000000000003',
] as const;

export async function getSampleDataStatus(db: DbPool, tenantId: string) {
  const seeded = await db.query('SELECT 1 FROM accounts WHERE tenant_id = $1 AND id = $2 LIMIT 1', [tenantId, IDS.ACCOUNT]);
  const counts = await db.query(
    `SELECT
       (SELECT count(*)::int FROM accounts WHERE tenant_id = $1) as accounts,
       (SELECT count(*)::int FROM contacts WHERE tenant_id = $1) as contacts,
       (SELECT count(*)::int FROM opportunities WHERE tenant_id = $1) as opportunities,
       (SELECT count(*)::int FROM context_entries WHERE tenant_id = $1) as context_entries,
       (SELECT count(*)::int FROM context_entries WHERE tenant_id = $1 AND memory_status = 'signal') as signals,
       (SELECT count(*)::int FROM signal_groups WHERE tenant_id = $1 AND status IN ('ready', 'blocked', 'conflicting')) as signal_groups,
       (SELECT count(*)::int FROM context_entries WHERE tenant_id = $1 AND memory_status = 'active') as memory,
       (SELECT count(*)::int FROM raw_context_sources WHERE tenant_id = $1) as raw_context_sources,
       (SELECT count(*)::int FROM hitl_requests WHERE tenant_id = $1 AND status = 'pending') as handoffs`,
    [tenantId],
  );
  return {
    seeded: (seeded.rowCount ?? 0) > 0,
    counts: counts.rows[0] as {
      accounts: number;
      contacts: number;
      opportunities: number;
      context_entries: number;
      signals: number;
      signal_groups: number;
      memory: number;
      raw_context_sources: number;
      handoffs: number;
    },
  };
}

export async function resetSampleData(db: DbPool, tenantId: string, options?: { includeLegacyDemo?: boolean }) {
  const ids = [
    ...Object.values(SAMPLE_DATA_IDS),
    ...(options?.includeLegacyDemo ? LEGACY_DEMO_IDS : []),
  ];

  await db.query('BEGIN');
  try {
    await db.query('DELETE FROM hitl_requests WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    await db.query('DELETE FROM signal_groups WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    await db.query('DELETE FROM raw_context_sources WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    await db.query('DELETE FROM assignments WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    await db.query('DELETE FROM context_entries WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    await db.query('DELETE FROM activities WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    await db.query('DELETE FROM use_case_contacts WHERE use_case_id = ANY($1::uuid[]) OR contact_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM use_cases WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    await db.query('DELETE FROM opportunities WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    await db.query('DELETE FROM contacts WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    await db.query('DELETE FROM accounts WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    await db.query('DELETE FROM actors WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

export async function seedSampleData(db: DbPool, tenantId: string) {
  const callBody = 'Maya wants agents to remember account priorities, open risks, and human handoffs without re-querying the CRM every run. She said security and data residency need review before the buying team will approve a pilot. Maya can likely sponsor the evaluation, but Finance still needs proof that the agent workflow reduces manual CRM updates. She asked for a demo focused on governed writebacks and human approval.';
  const callEvidence = {
    source_type: 'activity',
    source_id: IDS.ACTIVITY,
    source_label: 'Discovery call with Maya Patel',
    speaker: 'Maya Patel',
    snippet: 'Security and data residency need review before the buying team will approve a pilot. Maya can likely sponsor the evaluation, but Finance still needs proof.',
    observed_at: new Date().toISOString(),
    confidence: 0.78,
  };

  await db.query('BEGIN');
  try {
  const sampleIds = Object.values(SAMPLE_DATA_IDS);
  await db.query('DELETE FROM hitl_requests WHERE tenant_id <> $1 AND id = ANY($2::uuid[])', [tenantId, sampleIds]);
  await db.query('DELETE FROM signal_groups WHERE tenant_id <> $1 AND id = ANY($2::uuid[])', [tenantId, sampleIds]);
  await db.query('DELETE FROM raw_context_sources WHERE tenant_id <> $1 AND id = ANY($2::uuid[])', [tenantId, sampleIds]);
  await db.query('DELETE FROM assignments WHERE tenant_id <> $1 AND id = ANY($2::uuid[])', [tenantId, sampleIds]);
  await db.query('DELETE FROM context_entries WHERE tenant_id <> $1 AND id = ANY($2::uuid[])', [tenantId, sampleIds]);
  await db.query('DELETE FROM activities WHERE tenant_id <> $1 AND id = ANY($2::uuid[])', [tenantId, sampleIds]);
  await db.query(
    `DELETE FROM use_case_contacts
     WHERE use_case_id IN (SELECT id FROM use_cases WHERE tenant_id <> $1 AND id = ANY($2::uuid[]))
        OR contact_id IN (SELECT id FROM contacts WHERE tenant_id <> $1 AND id = ANY($2::uuid[]))`,
    [tenantId, sampleIds],
  );
  await db.query('DELETE FROM use_cases WHERE tenant_id <> $1 AND id = ANY($2::uuid[])', [tenantId, sampleIds]);
  await db.query('DELETE FROM opportunities WHERE tenant_id <> $1 AND id = ANY($2::uuid[])', [tenantId, sampleIds]);
  await db.query('DELETE FROM contacts WHERE tenant_id <> $1 AND id = ANY($2::uuid[])', [tenantId, sampleIds]);
  await db.query('DELETE FROM accounts WHERE tenant_id <> $1 AND id = ANY($2::uuid[])', [tenantId, sampleIds]);
  await db.query('DELETE FROM actors WHERE tenant_id <> $1 AND id = ANY($2::uuid[])', [tenantId, sampleIds]);

  await db.query(
    `INSERT INTO actors (id, tenant_id, actor_type, display_name, email)
     VALUES ($1, $2, 'human', 'Sample Owner', 'owner@example.com')
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       email = EXCLUDED.email,
       updated_at = now()`,
    [IDS.ACTOR_HUMAN, tenantId],
  );
  await db.query(
    `INSERT INTO actors (id, tenant_id, actor_type, display_name, agent_identifier, agent_model)
     VALUES ($1, $2, 'agent', 'Sample Research Agent', 'sample-research-agent', 'local-model')
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       agent_identifier = EXCLUDED.agent_identifier,
       agent_model = EXCLUDED.agent_model,
       updated_at = now()`,
    [IDS.ACTOR_AGENT, tenantId],
  );
  await db.query(
    `INSERT INTO accounts (id, tenant_id, name, industry, health_score, annual_revenue, domain, website)
     VALUES ($1, $2, 'Northstar Labs', 'AI Infrastructure', 82, 250000, 'northstarlabs.example', 'https://northstarlabs.example')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       industry = EXCLUDED.industry,
       health_score = EXCLUDED.health_score,
       annual_revenue = EXCLUDED.annual_revenue,
       domain = EXCLUDED.domain,
       website = EXCLUDED.website,
       updated_at = now()`,
    [IDS.ACCOUNT, tenantId],
  );
  await db.query(
    `INSERT INTO contacts (id, tenant_id, first_name, last_name, email, title, account_id, lifecycle_stage)
     VALUES ($1, $2, 'Maya', 'Patel', 'maya@northstarlabs.example', 'VP Revenue Systems', $3, 'prospect')
     ON CONFLICT (id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       email = EXCLUDED.email,
       title = EXCLUDED.title,
       account_id = EXCLUDED.account_id,
       lifecycle_stage = EXCLUDED.lifecycle_stage,
       updated_at = now()`,
    [IDS.CONTACT, tenantId, IDS.ACCOUNT],
  );
  await db.query(
    `INSERT INTO opportunities (id, tenant_id, name, account_id, contact_id, stage, amount, close_date)
     VALUES ($1, $2, 'Northstar Agent Context Rollout', $3, $4, 'prospecting', 125000, '2026-06-30')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       account_id = EXCLUDED.account_id,
       contact_id = EXCLUDED.contact_id,
       stage = EXCLUDED.stage,
       amount = EXCLUDED.amount,
       close_date = EXCLUDED.close_date,
       updated_at = now()`,
    [IDS.OPPORTUNITY, tenantId, IDS.ACCOUNT, IDS.CONTACT],
  );
  await db.query(
    `INSERT INTO use_cases (id, tenant_id, name, account_id, opportunity_id, stage, health_score, attributed_arr)
     VALUES ($1, $2, 'Agent Briefing Memory', $3, $4, 'discovery', 76, 125000)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       account_id = EXCLUDED.account_id,
       opportunity_id = EXCLUDED.opportunity_id,
       stage = EXCLUDED.stage,
       health_score = EXCLUDED.health_score,
       attributed_arr = EXCLUDED.attributed_arr,
       updated_at = now()`,
    [IDS.USE_CASE, tenantId, IDS.ACCOUNT, IDS.OPPORTUNITY],
  );
  await db.query(
    `INSERT INTO activities (id, tenant_id, type, subject, body, performed_by, subject_type, subject_id, account_id, contact_id, opportunity_id, occurred_at, outcome, detail)
     VALUES ($1, $2, 'call', 'Discovery call with Maya Patel', $3, $4, 'opportunity', $5, $6, $7, $5, now(), 'connected', $8)
     ON CONFLICT (id) DO UPDATE SET
       subject = EXCLUDED.subject,
       body = EXCLUDED.body,
       performed_by = EXCLUDED.performed_by,
       subject_type = EXCLUDED.subject_type,
       subject_id = EXCLUDED.subject_id,
       account_id = EXCLUDED.account_id,
       contact_id = EXCLUDED.contact_id,
       opportunity_id = EXCLUDED.opportunity_id,
       occurred_at = EXCLUDED.occurred_at,
       outcome = EXCLUDED.outcome,
       detail = EXCLUDED.detail`,
    [
      IDS.ACTIVITY,
      tenantId,
      callBody,
      IDS.ACTOR_HUMAN,
      IDS.OPPORTUNITY,
      IDS.ACCOUNT,
      IDS.CONTACT,
      JSON.stringify({
        duration_minutes: 35,
        attendees: ['maya@northstarlabs.example'],
        processing: {
          raw_context_source_id: IDS.RAW_CONTEXT,
          signals_created: 2,
          memory_created: 2,
        },
      }),
    ],
  );
  await db.query(
    `INSERT INTO raw_context_sources (
       id, tenant_id, source_type, source_ref, source_label, subject_type, subject_id,
       actor_id, status, stage, raw_excerpt, detected_subjects, signals_created,
       memory_created, skipped, metadata, processed_at
     )
     VALUES ($1, $2, 'activity', $3, 'Discovery call with Maya Patel', 'opportunity', $4,
       $5, 'needs_review', 'signals_ready', $6, $7, 2, 2, 0, $8, now()
     )
     ON CONFLICT (tenant_id, source_type, source_ref) DO UPDATE SET
       source_label = EXCLUDED.source_label,
       subject_type = EXCLUDED.subject_type,
       subject_id = EXCLUDED.subject_id,
       actor_id = EXCLUDED.actor_id,
       status = EXCLUDED.status,
       stage = EXCLUDED.stage,
       raw_excerpt = EXCLUDED.raw_excerpt,
       detected_subjects = EXCLUDED.detected_subjects,
       signals_created = EXCLUDED.signals_created,
       memory_created = EXCLUDED.memory_created,
       skipped = EXCLUDED.skipped,
       metadata = EXCLUDED.metadata,
       processed_at = now(),
       updated_at = now()`,
    [
      IDS.RAW_CONTEXT,
      tenantId,
      IDS.ACTIVITY,
      IDS.OPPORTUNITY,
      IDS.ACTOR_HUMAN,
      callBody,
      JSON.stringify([
        { subject_type: 'account', subject_id: IDS.ACCOUNT, label: 'Northstar Labs', confidence: 0.96 },
        { subject_type: 'contact', subject_id: IDS.CONTACT, label: 'Maya Patel', confidence: 0.94 },
        { subject_type: 'opportunity', subject_id: IDS.OPPORTUNITY, label: 'Northstar Agent Context Rollout', confidence: 0.98 },
      ]),
      JSON.stringify({
        sample: true,
        extraction_summary: 'Call transcript produced two confirmed Memory entries and two Signals needing review.',
        created_context_entry_ids: [IDS.CONTEXT, IDS.MEMORY_CRITERIA, IDS.SIGNAL_SECURITY, IDS.SIGNAL_BUYER],
      }),
    ],
  );
  await db.query(
    `INSERT INTO context_entries (
       id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body,
       confidence, memory_status, evidence, source, source_ref, source_activity_id,
       tags, promoted_at, promoted_by, valid_until
     )
     VALUES ($1, $2, 'account', $3, 'summary', $4, 'Agent context rollout priority',
       'Northstar Labs is evaluating CRMy as the operational customer context layer for revenue agents. The main evaluation criteria are typed objects, persistent context, scoped tools, human handoffs, and retry-safe writes.',
       0.92, 'active', $5, 'sample_data', $6, $7, $8, now(), $4, now() + interval '90 days'
     )
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       body = EXCLUDED.body,
       confidence = EXCLUDED.confidence,
       memory_status = EXCLUDED.memory_status,
       evidence = EXCLUDED.evidence,
       source = EXCLUDED.source,
       source_ref = EXCLUDED.source_ref,
       source_activity_id = EXCLUDED.source_activity_id,
       tags = EXCLUDED.tags,
       promoted_at = COALESCE(context_entries.promoted_at, EXCLUDED.promoted_at),
       promoted_by = COALESCE(context_entries.promoted_by, EXCLUDED.promoted_by),
       valid_until = EXCLUDED.valid_until,
       is_current = true,
       updated_at = now()`,
    [
      IDS.CONTEXT,
      tenantId,
      IDS.ACCOUNT,
      IDS.ACTOR_AGENT,
      JSON.stringify([{ ...callEvidence, confidence: 0.92 }]),
      IDS.RAW_CONTEXT,
      IDS.ACTIVITY,
      JSON.stringify(['sample', 'agent-context', 'evaluation', 'memory']),
    ],
  );
  await db.query(
    `INSERT INTO context_entries (
       id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body,
       confidence, memory_status, evidence, source, source_ref, source_activity_id,
       tags, promoted_at, promoted_by, valid_until
     )
     VALUES ($1, $2, 'opportunity', $3, 'evaluation_criteria', $4, 'Governed writeback demo is required',
       'Maya asked for the demo to focus on governed writebacks, scoped tools, and human approval before any update reaches an external system of record.',
       0.9, 'active', $5, 'sample_data', $6, $7, $8, now(), $4, now() + interval '60 days'
     )
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       body = EXCLUDED.body,
       confidence = EXCLUDED.confidence,
       memory_status = EXCLUDED.memory_status,
       evidence = EXCLUDED.evidence,
       source = EXCLUDED.source,
       source_ref = EXCLUDED.source_ref,
       source_activity_id = EXCLUDED.source_activity_id,
       tags = EXCLUDED.tags,
       promoted_at = COALESCE(context_entries.promoted_at, EXCLUDED.promoted_at),
       promoted_by = COALESCE(context_entries.promoted_by, EXCLUDED.promoted_by),
       valid_until = EXCLUDED.valid_until,
       is_current = true,
       updated_at = now()`,
    [
      IDS.MEMORY_CRITERIA,
      tenantId,
      IDS.OPPORTUNITY,
      IDS.ACTOR_AGENT,
      JSON.stringify([{ ...callEvidence, snippet: 'She asked for a demo focused on governed writebacks and human approval.', confidence: 0.9 }]),
      IDS.RAW_CONTEXT,
      IDS.ACTIVITY,
      JSON.stringify(['sample', 'writeback', 'handoff', 'memory']),
    ],
  );
  await db.query(
    `INSERT INTO context_entries (
       id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body,
       confidence, memory_status, evidence, source, source_ref, source_activity_id, tags, valid_until
     )
     VALUES ($1, $2, 'opportunity', $3, 'deal_risk', $4, 'Security review may block pilot approval',
       'Security and data residency may be the main blocker before Northstar approves a pilot. This is still a Signal because the security owner and exact requirement are not confirmed.',
       0.78, 'signal', $5, 'sample_data', $6, $7, $8, now() + interval '30 days'
     )
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       body = EXCLUDED.body,
       confidence = EXCLUDED.confidence,
       memory_status = EXCLUDED.memory_status,
       evidence = EXCLUDED.evidence,
       source = EXCLUDED.source,
       source_ref = EXCLUDED.source_ref,
       source_activity_id = EXCLUDED.source_activity_id,
       tags = EXCLUDED.tags,
       valid_until = EXCLUDED.valid_until,
       is_current = true,
       updated_at = now()`,
    [
      IDS.SIGNAL_SECURITY,
      tenantId,
      IDS.OPPORTUNITY,
      IDS.ACTOR_AGENT,
      JSON.stringify([callEvidence]),
      IDS.RAW_CONTEXT,
      IDS.ACTIVITY,
      JSON.stringify(['sample', 'risk', 'signal', 'needs-review']),
    ],
  );
  await db.query(
    `INSERT INTO context_entries (
       id, tenant_id, subject_type, subject_id, context_type, authored_by, title, body,
       confidence, memory_status, evidence, source, source_ref, source_activity_id, tags, valid_until
     )
     VALUES ($1, $2, 'contact', $3, 'stakeholder_role', $4, 'Maya may be the evaluation sponsor',
       'Maya can likely sponsor the evaluation, but Finance still needs proof before the buying team commits. Promote this only after confirming her role and authority.',
       0.74, 'signal', $5, 'sample_data', $6, $7, $8, now() + interval '30 days'
     )
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       body = EXCLUDED.body,
       confidence = EXCLUDED.confidence,
       memory_status = EXCLUDED.memory_status,
       evidence = EXCLUDED.evidence,
       source = EXCLUDED.source,
       source_ref = EXCLUDED.source_ref,
       source_activity_id = EXCLUDED.source_activity_id,
       tags = EXCLUDED.tags,
       valid_until = EXCLUDED.valid_until,
       is_current = true,
       updated_at = now()`,
    [
      IDS.SIGNAL_BUYER,
      tenantId,
      IDS.CONTACT,
      IDS.ACTOR_AGENT,
      JSON.stringify([{ ...callEvidence, snippet: 'Maya can likely sponsor the evaluation, but Finance still needs proof.', confidence: 0.74 }]),
      IDS.RAW_CONTEXT,
      IDS.ACTIVITY,
      JSON.stringify(['sample', 'stakeholder', 'signal', 'needs-review']),
    ],
  );
  await db.query(
    `INSERT INTO signal_groups (
       id, tenant_id, subject_type, subject_id, context_type, claim_key, title,
       normalized_claim, status, aggregate_confidence, support_count,
       independent_source_count, conflict_count, evidence_count, latest_signal_id,
       blocked_reason, metadata
     )
     VALUES ($1, $2, 'opportunity', $3, 'deal_risk', 'security-review-may-block-pilot-approval',
       'Security review may block pilot approval',
       'Security and data residency may be the main blocker before Northstar approves a pilot.',
       'blocked', 0.78, 1, 1, 0, 1, $4,
       'Sensitive deal risk needs corroboration or approval before becoming Memory.',
       $5
     )
     ON CONFLICT (tenant_id, subject_type, subject_id, context_type, claim_key) DO UPDATE SET
       title = EXCLUDED.title,
       normalized_claim = EXCLUDED.normalized_claim,
       status = EXCLUDED.status,
       aggregate_confidence = EXCLUDED.aggregate_confidence,
       support_count = EXCLUDED.support_count,
       independent_source_count = EXCLUDED.independent_source_count,
       conflict_count = EXCLUDED.conflict_count,
       evidence_count = EXCLUDED.evidence_count,
       latest_signal_id = EXCLUDED.latest_signal_id,
       blocked_reason = EXCLUDED.blocked_reason,
       metadata = EXCLUDED.metadata,
       updated_at = now()`,
    [
      IDS.SIGNAL_GROUP_SECURITY,
      tenantId,
      IDS.OPPORTUNITY,
      IDS.SIGNAL_SECURITY,
      JSON.stringify({ sample: true, sensitive: true, threshold: 0.85 }),
    ],
  );
  await db.query(
    `INSERT INTO signal_groups (
       id, tenant_id, subject_type, subject_id, context_type, claim_key, title,
       normalized_claim, status, aggregate_confidence, support_count,
       independent_source_count, conflict_count, evidence_count, latest_signal_id,
       blocked_reason, metadata
     )
     VALUES ($1, $2, 'contact', $3, 'stakeholder_role', 'maya-may-be-evaluation-sponsor',
       'Maya may be the evaluation sponsor',
       'Maya can likely sponsor the evaluation, but Finance still needs proof before the buying team commits.',
       'blocked', 0.74, 1, 1, 0, 1, $4,
       'Stakeholder role needs corroboration or approval before becoming Memory.',
       $5
     )
     ON CONFLICT (tenant_id, subject_type, subject_id, context_type, claim_key) DO UPDATE SET
       title = EXCLUDED.title,
       normalized_claim = EXCLUDED.normalized_claim,
       status = EXCLUDED.status,
       aggregate_confidence = EXCLUDED.aggregate_confidence,
       support_count = EXCLUDED.support_count,
       independent_source_count = EXCLUDED.independent_source_count,
       conflict_count = EXCLUDED.conflict_count,
       evidence_count = EXCLUDED.evidence_count,
       latest_signal_id = EXCLUDED.latest_signal_id,
       blocked_reason = EXCLUDED.blocked_reason,
       metadata = EXCLUDED.metadata,
       updated_at = now()`,
    [
      IDS.SIGNAL_GROUP_BUYER,
      tenantId,
      IDS.CONTACT,
      IDS.SIGNAL_BUYER,
      JSON.stringify({ sample: true, sensitive: true, threshold: 0.85 }),
    ],
  );
  await db.query(
    `INSERT INTO signal_group_members (
       id, tenant_id, signal_group_id, context_entry_id, relation,
       similarity_score, evidence_weight, source_key
     )
     VALUES
       ($1, $2, $3, $4, 'supports', 1, 1, $5),
       ($6, $2, $7, $8, 'supports', 1, 1, $5)
     ON CONFLICT (tenant_id, signal_group_id, context_entry_id) DO UPDATE SET
       relation = EXCLUDED.relation,
       similarity_score = EXCLUDED.similarity_score,
       evidence_weight = EXCLUDED.evidence_weight,
       source_key = EXCLUDED.source_key`,
    [
      IDS.SIGNAL_GROUP_MEMBER_SECURITY,
      tenantId,
      IDS.SIGNAL_GROUP_SECURITY,
      IDS.SIGNAL_SECURITY,
      `activity:${IDS.ACTIVITY}:maya patel`,
      IDS.SIGNAL_GROUP_MEMBER_BUYER,
      IDS.SIGNAL_GROUP_BUYER,
      IDS.SIGNAL_BUYER,
    ],
  );
  await db.query(
    `INSERT INTO assignments (id, tenant_id, title, description, assignment_type, assigned_by, assigned_to, subject_type, subject_id, status, priority, context)
     VALUES ($1, $2, 'Review Northstar Signals before the demo', 'Confirm whether security review and Maya''s sponsor role should become Memory.', 'review', $3, $4, 'opportunity', $5, 'pending', 'high', 'Use this sample assignment to test human review, signal promotion, briefing assembly, and assignment queues.')
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       assignment_type = EXCLUDED.assignment_type,
       assigned_by = EXCLUDED.assigned_by,
       assigned_to = EXCLUDED.assigned_to,
       subject_type = EXCLUDED.subject_type,
       subject_id = EXCLUDED.subject_id,
       status = EXCLUDED.status,
       priority = EXCLUDED.priority,
       context = EXCLUDED.context,
       updated_at = now()`,
    [IDS.ASSIGNMENT, tenantId, IDS.ACTOR_AGENT, IDS.ACTOR_HUMAN, IDS.OPPORTUNITY],
  );
  await db.query(
    `INSERT INTO hitl_requests (
       id, tenant_id, agent_id, session_id, action_type, action_summary, action_payload,
       status, priority, sla_minutes, expires_at
     )
     VALUES ($1, $2, 'sample-research-agent', 'sample-northstar-context-review',
       'context.signal_promote',
       'Review whether Northstar security risk should be promoted to Memory before writeback',
       $3,
       'pending', 'high', 240, now() + interval '4 hours'
     )
     ON CONFLICT (id) DO UPDATE SET
       agent_id = EXCLUDED.agent_id,
       session_id = EXCLUDED.session_id,
       action_type = EXCLUDED.action_type,
       action_summary = EXCLUDED.action_summary,
       action_payload = EXCLUDED.action_payload,
       status = CASE WHEN hitl_requests.status IN ('approved', 'rejected') THEN hitl_requests.status ELSE EXCLUDED.status END,
       priority = EXCLUDED.priority,
       sla_minutes = EXCLUDED.sla_minutes,
       expires_at = EXCLUDED.expires_at,
       resolved_at = CASE WHEN hitl_requests.status IN ('approved', 'rejected') THEN hitl_requests.resolved_at ELSE NULL END,
       reviewer_id = CASE WHEN hitl_requests.status IN ('approved', 'rejected') THEN hitl_requests.reviewer_id ELSE NULL END,
       review_note = CASE WHEN hitl_requests.status IN ('approved', 'rejected') THEN hitl_requests.review_note ELSE NULL END`,
    [
      IDS.HANDOFF,
      tenantId,
      JSON.stringify({
        subject_type: 'opportunity',
        subject_id: IDS.OPPORTUNITY,
        signal_id: IDS.SIGNAL_SECURITY,
        proposed_action: 'Promote security-review Signal to Memory and use it to prepare a governed follow-up task.',
        evidence: callEvidence,
        policy_reason: 'Signals that influence customer engagement require human review before becoming operational Memory.',
      }),
    ],
  );

  await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }

  return getSampleDataStatus(db, tenantId);
}
