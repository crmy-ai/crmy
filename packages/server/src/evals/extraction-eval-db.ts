// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { DEFAULT_CONTEXT_TYPES } from '../db/repos/context-type-registry.js';

export interface ExtractionEvalFixture {
  id: string;
  title?: string;
  source_type?: string;
  source_occurred_at?: string;
  document?: string;
}

export interface ExtractionEvalModelConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyEnc?: string | null;
  maxTokensPerTurn?: number;
  llmTimeoutMs?: number;
}

export interface ExtractionEvalDbOptions {
  tenantId: string;
  activityId: string;
  accountId: string;
  contactId: string;
  opportunityId: string;
  actorId: string;
  fixture: ExtractionEvalFixture;
  modelConfig: ExtractionEvalModelConfig;
}

export class ExtractionEvalDb {
  readonly contextEntries: Record<string, unknown>[] = [];
  readonly signalGroups: Record<string, unknown>[] = [];
  readonly signalGroupMembers: Record<string, unknown>[] = [];
  readonly rawContextSources = new Map<string, Record<string, unknown>>();
  readonly attempts: Record<string, unknown>[] = [];
  readonly activities = new Map<string, Record<string, unknown>>();
  readonly queryLog: string[] = [];

  constructor(private readonly options: ExtractionEvalDbOptions) {
    const fixture = options.fixture;
    const sourceType = String(fixture.source_type ?? '').toLowerCase();
    const activityType = sourceType.includes('email')
      ? 'email'
      : sourceType.includes('call')
        ? 'call'
        : 'meeting';
    const occurredAt = fixture.source_occurred_at ?? this.now();
    this.activities.set(options.activityId, {
      id: options.activityId,
      tenant_id: options.tenantId,
      type: activityType,
      subject: fixture.title ?? `Eval Raw Context ${fixture.id}`,
      body: fixture.document ?? '',
      outcome: null,
      occurred_at: occurredAt,
      created_at: occurredAt,
      subject_type: 'opportunity',
      subject_id: options.opportunityId,
      created_by: options.actorId,
      performed_by: options.actorId,
      direction: sourceType.includes('email') ? 'inbound' : null,
      source_agent: 'context_ingest',
      detail: {
        source_document_hash: `corpus-${fixture.id}`,
        raw_context_source_ref: `corpus:${fixture.id}`,
        source_occurred_at: occurredAt,
        source_occurred_at_provided: true,
      },
      extraction_status: null,
      extraction_error: null,
    });
  }

  async query(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    const text = sql.replace(/\s+/g, ' ').trim();
    this.queryLog.push(text);

    if (text.startsWith('SELECT id FROM ( SELECT id, 0 AS priority FROM actors')) {
      return this.rows([{ id: this.options.actorId }]);
    }
    if (text === 'SELECT * FROM agent_configs WHERE tenant_id = $1') {
      return this.rows([this.agentConfigRow()]);
    }
    if (text.startsWith('SELECT id, tenant_id, type, subject, body')) {
      const row = this.activities.get(String(params[0]));
      return this.rows(row && row.tenant_id === params[1] ? [row] : []);
    }
    if (text.startsWith('UPDATE activities SET extraction_status')) {
      const row = this.activities.get(String(params[2]));
      if (row) {
        row.extraction_status = params[0];
        row.extraction_error = params[1];
      }
      return this.rows([]);
    }
    if (text.startsWith('INSERT INTO raw_context_sources')) {
      const row = this.rawSourceFromParams(params);
      return this.rows([row]);
    }
    if (text.startsWith('SELECT * FROM raw_context_sources WHERE tenant_id = $1 AND source_type = $2 AND source_ref = $3')) {
      const row = this.rawContextSources.get(this.rawKey(String(params[1]), String(params[2])));
      return this.rows(row ? [row] : []);
    }
    if (text.startsWith('UPDATE raw_context_sources')) {
      const key = this.rawKey(String(params[1]), String(params[2]));
      const row = this.rawContextSources.get(key);
      if (!row) return this.rows([]);
      row.status = params[3] ?? row.status;
      row.stage = params[4] ?? row.stage;
      row.source_label = params[5] ?? row.source_label;
      row.subject_type = params[6] ?? row.subject_type;
      row.subject_id = params[7] ?? row.subject_id;
      row.actor_id = this.options.actorId;
      row.raw_excerpt = params[9] ?? row.raw_excerpt;
      row.detected_subjects = params[10] ? this.parseJson(params[10], row.detected_subjects) : row.detected_subjects;
      row.signals_created = params[11] ?? row.signals_created;
      row.memory_created = params[12] ?? row.memory_created;
      row.skipped = params[13] ?? row.skipped;
      row.failure_reason = params[14];
      row.failure_code = params[15] ?? row.failure_code;
      row.metadata = { ...this.objectValue(row.metadata), ...this.objectValue(this.parseJson(params[20], {})) };
      row.processed_at = ['processed', 'needs_review', 'failed', 'skipped'].includes(String(row.status)) ? this.now() : row.processed_at;
      row.updated_at = this.now();
      return this.rows([row]);
    }
    if (text.startsWith('INSERT INTO context_type_registry')) {
      return this.rows([]);
    }
    if (text.includes('FROM context_type_registry')) {
      const rows = this.contextTypeRows();
      return this.rows(rows);
    }
    if (text === 'SELECT * FROM actors WHERE tenant_id = $1 AND agent_identifier = $2') {
      return this.rows([]);
    }
    if (text.startsWith('INSERT INTO actors')) {
      return this.rows([{
        id: this.options.actorId,
        tenant_id: params[0],
        actor_type: params[1],
        display_name: params[2],
        agent_identifier: params[7],
        agent_model: params[8],
        metadata: this.parseJson(params[10], {}),
        created_at: this.now(),
        updated_at: this.now(),
      }]);
    }
    if (text.includes('FROM custom_field_definitions')) {
      return this.rows([]);
    }
    if (text.includes('FROM opportunities o LEFT JOIN accounts')) {
      return this.rows([this.opportunityRow()]);
    }
    if (text.startsWith('SELECT * FROM opportunities WHERE tenant_id = $1 AND id = $2')) {
      return this.rows([this.opportunityRow()]);
    }
    if (text.startsWith('SELECT * FROM accounts WHERE tenant_id = $1 AND id = $2')) {
      return this.rows([this.accountRow()]);
    }
    if (text.includes('FROM contacts c LEFT JOIN accounts')) {
      return this.rows([this.contactRow()]);
    }
    if (text.startsWith('SELECT * FROM contacts WHERE tenant_id = $1 AND id = $2')) {
      return this.rows([this.contactRow()]);
    }
    if (text.includes("SELECT 'account' AS relation_type, to_jsonb(a.*) AS record FROM opportunities")) {
      return this.rows([
        { relation_type: 'account', record: this.accountRow() },
        { relation_type: 'contact', record: this.contactRow() },
      ]);
    }
    if (text.startsWith('SELECT * FROM use_cases WHERE tenant_id = $1 AND opportunity_id = $2')) {
      return this.rows([]);
    }
    if (text.startsWith('SELECT * FROM context_entries WHERE')) {
      const memoryStatus = text.includes("memory_status = 'active'") ? 'active' : params.includes('signal') ? 'signal' : undefined;
      return this.rows(this.contextEntries.filter(entry =>
        entry.tenant_id === params[0]
          && (!params[1] || entry.subject_type === params[1])
          && (!params[2] || entry.subject_id === params[2])
          && (!memoryStatus || entry.memory_status === memoryStatus)
      ));
    }
    if (text.startsWith('SELECT count(*)::int AS total FROM signal_groups')) {
      return this.rows([{ total: 0 }]);
    }
    if (text.startsWith('SELECT sg.*, CASE sg.subject_type') && text.includes('FROM signal_groups sg WHERE')) {
      if (text.includes('sg.id = $2')) {
        const group = this.signalGroups.find(item => item.id === params[1]);
        return this.rows(group ? [{ ...group, subject_name: 'Agent Context Rollout' }] : []);
      }
      return this.rows([]);
    }
    if (text.startsWith('SELECT sgm.*, to_jsonb(ce.*)')) {
      return this.rows(this.signalGroupMembers
        .filter(member => member.signal_group_id === params[1])
        .map(member => ({
          ...member,
          context_entry: this.contextEntries.find(entry => entry.id === member.context_entry_id),
        })));
    }
    if (text.startsWith('WITH subject_scope AS') && text.includes('SELECT sg.* FROM signal_groups')) {
      return this.rows(this.signalGroups.filter(group =>
        group.context_type === params[3]
          && group.status !== 'dismissed'
          && group.status !== 'merged'
          && group.subject_type === params[1]
          && group.subject_id === params[2]
      ));
    }
    if (text.startsWith('SELECT scope.account_id, a.name AS account_name')) {
      return this.rows([{ account_id: this.options.accountId, account_name: 'Northstar' }]);
    }
    if (text.startsWith('INSERT INTO context_entries')) {
      const row = {
        id: `88888888-8888-4888-8888-${String(this.contextEntries.length + 1).padStart(12, '0')}`.slice(0, 36),
        tenant_id: params[0],
        subject_type: params[1],
        subject_id: params[2],
        context_type: params[3],
        authored_by: params[4],
        title: params[5],
        body: params[6],
        structured_data: this.parseJson(params[7], {}),
        confidence: params[8],
        memory_status: params[9],
        evidence: this.parseJson(params[10], []),
        tags: this.parseJson(params[11], []),
        source: params[12],
        source_ref: params[13],
        source_activity_id: params[14],
        valid_until: params[15],
        is_current: true,
        created_at: this.now(),
        updated_at: this.now(),
      };
      this.contextEntries.push(row);
      return this.rows([row]);
    }
    if (text.startsWith('INSERT INTO context_outbox')) {
      return this.rows([{
        id: `outbox-${this.contextEntries.length}`,
        tenant_id: params[0],
        entity_type: params[1],
        entity_id: params[2],
        payload: this.parseJson(params[3], {}),
      }]);
    }
    if (text.startsWith('INSERT INTO raw_context_extraction_attempts')) {
      const row = {
        id: `99999999-9999-4999-8999-${String(this.attempts.length + 1).padStart(12, '0')}`.slice(0, 36),
        tenant_id: params[0],
        raw_context_source_id: params[1],
        activity_id: params[2],
        attempt_number: this.attempts.length + 1,
        status: 'running',
        stage: params[3],
        model: params[4],
        response_format: params[5],
        timeout_ms: params[6],
        prompt_version: params[7],
        input_summary: this.parseJson(params[8], {}),
        telemetry: {},
        output_summary: {},
        created_at: this.now(),
        updated_at: this.now(),
      };
      this.attempts.push(row);
      return this.rows([row]);
    }
    if (text.startsWith('UPDATE raw_context_extraction_attempts')) {
      const row = this.attempts.find(item => item.id === params[1]);
      if (!row) return this.rows([]);
      row.status = params[2];
      row.outcome = params[3] ?? row.outcome;
      row.telemetry = { ...this.objectValue(row.telemetry), ...this.objectValue(this.parseJson(params[4], {})) };
      row.output_summary = { ...this.objectValue(row.output_summary), ...this.objectValue(this.parseJson(params[5], {})) };
      row.raw_output_excerpt = params[6] ?? row.raw_output_excerpt;
      row.repaired_output_excerpt = params[7] ?? row.repaired_output_excerpt;
      row.failure_code = params[8] ?? row.failure_code;
      row.failure_reason = params[9] ?? row.failure_reason;
      row.latency_ms = params[10] ?? row.latency_ms;
      row.completed_at = this.now();
      row.updated_at = this.now();
      return this.rows([row]);
    }
    if (text.startsWith('INSERT INTO signal_groups')) {
      let row = this.signalGroups.find(group =>
        group.tenant_id === params[0]
          && group.subject_type === params[1]
          && group.subject_id === params[2]
          && group.context_type === params[3]
          && group.claim_key === params[4]
      );
      if (!row) {
        row = {
          id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(this.signalGroups.length + 1).padStart(12, '0')}`.slice(0, 36),
          tenant_id: params[0],
          subject_type: params[1],
          subject_id: params[2],
          context_type: params[3],
          claim_key: params[4],
          title: params[5],
          normalized_claim: params[6],
          status: 'gathering',
          aggregate_confidence: 0,
          support_count: 0,
          independent_source_count: 0,
          conflict_count: 0,
          evidence_count: 0,
          latest_signal_id: null,
          promoted_context_entry_id: null,
          blocked_reason: null,
          metadata: this.parseJson(params[7], {}),
          created_at: this.now(),
          updated_at: this.now(),
        };
        this.signalGroups.push(row);
      }
      return this.rows([row]);
    }
    if (text.startsWith('INSERT INTO signal_group_members')) {
      const row = {
        id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(this.signalGroupMembers.length + 1).padStart(12, '0')}`.slice(0, 36),
        tenant_id: params[0],
        signal_group_id: params[1],
        context_entry_id: params[2],
        relation: params[3],
        similarity_score: params[4],
        evidence_weight: params[5],
        source_key: params[6],
        created_at: this.now(),
      };
      this.signalGroupMembers.push(row);
      return this.rows([row]);
    }
    if (text.startsWith('UPDATE signal_groups SET status = $3')) {
      const row = this.signalGroups.find(group => group.id === params[1]);
      if (!row) return this.rows([]);
      row.status = params[2];
      row.aggregate_confidence = params[3];
      row.support_count = params[4];
      row.independent_source_count = params[5];
      row.conflict_count = params[6];
      row.evidence_count = params[7];
      row.latest_signal_id = params[8] ?? row.latest_signal_id;
      row.blocked_reason = params[9];
      row.metadata = { ...this.objectValue(row.metadata), ...this.objectValue(this.parseJson(params[10], {})) };
      row.updated_at = this.now();
      return this.rows([row]);
    }
    if (text.startsWith('UPDATE signal_groups SET metadata = metadata')) {
      const row = this.signalGroups.find(group => group.id === params[1]);
      if (!row) return this.rows([]);
      row.metadata = { ...this.objectValue(row.metadata), ...this.objectValue(this.parseJson(params[2], {})) };
      row.updated_at = this.now();
      return this.rows([row]);
    }

    throw new Error(`ExtractionEvalDb unexpected query: ${text}`);
  }

  private agentConfigRow(): Record<string, unknown> {
    return {
      enabled: true,
      provider: this.options.modelConfig.provider,
      model: this.options.modelConfig.model,
      base_url: this.options.modelConfig.baseUrl,
      api_key_enc: this.options.modelConfig.apiKeyEnc ?? null,
      max_tokens_per_turn: this.options.modelConfig.maxTokensPerTurn ?? 4096,
      llm_timeout_ms: this.options.modelConfig.llmTimeoutMs ?? 90_000,
      auto_extract_context: true,
      auto_promote_signals: false,
      signal_auto_promote_threshold: 0.85,
    };
  }

  private parseJson(value: unknown, fallback: unknown): unknown {
    if (typeof value !== 'string') return value ?? fallback;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return fallback;
    }
  }

  private objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private now(): string {
    return '2026-05-30T18:00:00.000Z';
  }

  private rawKey(sourceType: string, sourceRef: string): string {
    return `${sourceType}:${sourceRef}`;
  }

  private contextTypeRows(): Record<string, unknown>[] {
    return DEFAULT_CONTEXT_TYPES
      .filter(type => type.is_extractable)
      .map(type => ({
        ...type,
        tenant_id: this.options.tenantId,
        is_default: true,
        created_at: this.now(),
        updated_at: this.now(),
      }));
  }

  private accountRow(): Record<string, unknown> {
    return {
      id: this.options.accountId,
      tenant_id: this.options.tenantId,
      name: 'Northstar',
      domain: 'northstar.example',
      industry: 'SaaS',
      owner_id: this.options.actorId,
      created_at: this.now(),
      updated_at: this.now(),
    };
  }

  private contactRow(): Record<string, unknown> {
    return {
      id: this.options.contactId,
      tenant_id: this.options.tenantId,
      first_name: 'Maya',
      last_name: 'Patel',
      email: 'maya@northstar.example',
      title: 'VP Sales',
      account_id: this.options.accountId,
      owner_id: this.options.actorId,
      created_at: this.now(),
      updated_at: this.now(),
    };
  }

  private opportunityRow(): Record<string, unknown> {
    return {
      id: this.options.opportunityId,
      tenant_id: this.options.tenantId,
      name: 'Agent Context Rollout',
      account_id: this.options.accountId,
      contact_id: this.options.contactId,
      stage: 'evaluation',
      amount: 125000,
      forecast_category: 'pipeline',
      owner_id: this.options.actorId,
      account_name: 'Northstar',
      contact_name: 'Maya Patel',
      contact_email: 'maya@northstar.example',
      created_at: this.now(),
      updated_at: this.now(),
    };
  }

  private rawSourceFromParams(params: unknown[]): Record<string, unknown> {
    const key = this.rawKey(String(params[1]), String(params[2]));
    const existing = this.rawContextSources.get(key);
    const row = {
      id: existing?.id ?? '77777777-7777-4777-8777-777777777777',
      tenant_id: params[0],
      source_type: params[1],
      source_ref: params[2],
      source_label: params[3],
      subject_type: params[4],
      subject_id: params[5],
      actor_id: this.options.actorId,
      status: params[7],
      stage: params[8],
      raw_excerpt: params[9],
      detected_subjects: this.parseJson(params[10], []),
      signals_created: params[11] ?? 0,
      memory_created: params[12] ?? 0,
      skipped: params[13] ?? 0,
      failure_reason: params[14],
      failure_code: params[15],
      attempt_count: params[16] ?? 0,
      locked_at: params[17],
      next_retry_at: params[18],
      last_error: params[19],
      metadata: this.parseJson(params[20], {}),
      processed_at: ['processed', 'needs_review', 'failed', 'skipped'].includes(String(params[7])) ? this.now() : null,
      created_at: existing?.created_at ?? this.now(),
      updated_at: this.now(),
    };
    this.rawContextSources.set(key, row);
    return row;
  }

  private rows(rows: unknown[]): { rows: Record<string, unknown>[]; rowCount: number } {
    return { rows: rows as Record<string, unknown>[], rowCount: rows.length };
  }
}
