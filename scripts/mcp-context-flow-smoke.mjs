#!/usr/bin/env node
// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import * as jose from 'jose';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_MCP_URL = 'http://127.0.0.1:5173/mcp';

const args = new Set(process.argv.slice(2));
const mcpUrl = valueArg('--mcp-url') ?? process.env.CRMY_MCP_URL ?? DEFAULT_MCP_URL;
const skipAuto = args.has('--skip-auto');
const noPromote = args.has('--no-promote');
const runId = valueArg('--run-id') ?? makeRunId();
const requestTimeoutMs = Number(valueArg('--timeout-ms') ?? process.env.CRMY_MCP_TEST_TIMEOUT_MS ?? 180000);

const checks = [];
const warnings = [];
const artifacts = { run_id: runId, mcp_url: mcpUrl };

function valueArg(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function makeRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${suffix}`;
}

function timestampFromRunId(id) {
  const match = id.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return new Date().toISOString();
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}

function loadDotenv(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadCrmyConfig() {
  const configPath = path.join(os.homedir(), '.crmy', 'config.json');
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

async function resolveBearerToken() {
  if (process.env.CRMY_API_KEY) return process.env.CRMY_API_KEY;

  const config = loadCrmyConfig();
  if (config.apiKey) return config.apiKey;

  const merged = {
    ...loadDotenv(path.join(ROOT, '.env')),
    ...loadDotenv(path.join(ROOT, 'packages', 'server', '.env')),
    ...process.env,
  };
  const connectionString = merged.DATABASE_URL ?? config.database?.url;
  const jwtSecret = merged.JWT_SECRET ?? config.jwtSecret;
  if (!connectionString || !jwtSecret) {
    throw new Error('No CRMY_API_KEY found, and DATABASE_URL/JWT_SECRET were not available for short-lived JWT creation.');
  }

  const pool = new pg.Pool({ connectionString });
  try {
    const result = await pool.query(`
      SELECT id, email, role, tenant_id
      FROM users
      WHERE role IN ('owner', 'admin')
        AND COALESCE(is_active, true) = true
      ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC
      LIMIT 1
    `);
    const user = result.rows[0];
    if (!user) throw new Error('No active owner/admin user found for MCP smoke auth.');
    artifacts.auth_actor = { role: user.role, email: user.email };
    return new jose.SignJWT({ sub: user.id, tenant_id: user.tenant_id, role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(jwtSecret));
  } finally {
    await pool.end();
  }
}

function parseSse(text) {
  if (!text.trim()) return undefined;
  const messages = [];
  for (const block of text.split(/\n\n+/)) {
    const dataLines = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim());
    if (!dataLines.length) continue;
    messages.push(JSON.parse(dataLines.join('\n')));
  }
  return messages.at(-1);
}

function parseMcpBody(contentType, text) {
  if (!text.trim()) return undefined;
  if (contentType?.includes('text/event-stream')) return parseSse(text);
  if (contentType?.includes('application/json')) return JSON.parse(text);
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function parseToolPayload(result, toolName) {
  if (result?.isError) {
    const text = result.content?.map(item => item.text).filter(Boolean).join('\n') ?? 'Tool error';
    throw new Error(`${toolName} returned MCP tool error: ${text}`);
  }
  const text = result?.content?.map(item => item.text).filter(Boolean).join('\n');
  if (!text) return undefined;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { text };
  }
  if (payload?.type?.includes('/errors/') || (payload?.status >= 400 && payload?.title)) {
    throw new Error(`${toolName} failed: ${payload.title ?? payload.status} - ${payload.detail ?? JSON.stringify(payload)}`);
  }
  return payload;
}

function compact(value, max = 220) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text && text.length > max ? `${text.slice(0, max)}...` : text;
}

function recordCheck(name, passed, detail, { required = true } = {}) {
  checks.push({ name, status: passed ? 'pass' : required ? 'fail' : 'warn', detail });
  const marker = passed ? 'PASS' : required ? 'FAIL' : 'WARN';
  console.log(`${marker} ${name}${detail ? ` - ${compact(detail)}` : ''}`);
}

async function step(name, fn, { required = true } = {}) {
  const started = Date.now();
  try {
    const detail = await fn();
    recordCheck(name, true, detail, { required });
    return detail;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    recordCheck(name, false, detail, { required });
    if (required) throw err;
    return undefined;
  } finally {
    const last = checks.at(-1);
    if (last?.name === name) last.duration_ms = Date.now() - started;
  }
}

class McpHttpClient {
  constructor({ url, bearerToken, timeoutMs }) {
    this.url = url;
    this.bearerToken = bearerToken;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.sessionId = undefined;
    this.serverInfo = undefined;
  }

  headers(extra = {}) {
    const headers = {
      authorization: `Bearer ${this.bearerToken}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...extra,
    };
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) delete headers[key];
    }
    return headers;
  }

  async post(body, { includeSession = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: this.headers(includeSession ? {} : { 'mcp-session-id': undefined }),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      const parsed = parseMcpBody(res.headers.get('content-type'), text);
      if (!res.ok && res.status !== 202) {
        throw new Error(`HTTP ${res.status}: ${compact(parsed ?? text, 500)}`);
      }
      if (parsed?.error) {
        throw new Error(`MCP ${parsed.error.code}: ${parsed.error.message}`);
      }
      return { res, parsed };
    } finally {
      clearTimeout(timer);
    }
  }

  async request(method, params = {}, { notification = false, includeSession = true } = {}) {
    const body = notification
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: this.nextId++, method, params };
    return this.post(body, { includeSession });
  }

  async connect() {
    const { res, parsed } = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'crmy-mcp-context-flow-smoke', version: '0.1.0' },
    }, { includeSession: false });
    this.sessionId = res.headers.get('mcp-session-id') ?? undefined;
    this.serverInfo = parsed?.result?.serverInfo;
    if (!this.sessionId) throw new Error('MCP initialize did not return mcp-session-id.');
    await this.request('notifications/initialized', {}, { notification: true });
    return this.serverInfo;
  }

  async listTools() {
    const { parsed } = await this.request('tools/list', {});
    return parsed?.result?.tools ?? [];
  }

  async callTool(name, args = {}) {
    const { parsed } = await this.request('tools/call', { name, arguments: args });
    return parseToolPayload(parsed?.result, name);
  }

  async close() {
    if (!this.sessionId) return;
    try {
      await fetch(this.url, { method: 'DELETE', headers: this.headers() });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function countEntries(result) {
  return Array.isArray(result?.context_entries) ? result.context_entries.length : Number(result?.total ?? 0);
}

function firstEntry(result) {
  return Array.isArray(result?.context_entries) ? result.context_entries[0] : undefined;
}

function firstSignalFromIngest(ingest) {
  if (Array.isArray(ingest?.signals) && ingest.signals.length) return ingest.signals[0];
  if (Array.isArray(ingest?.context_entries)) {
    return ingest.context_entries.find(entry => entry.memory_status === 'signal');
  }
  return undefined;
}

function briefingCounts(briefing) {
  const payload = briefing?.briefing ?? briefing;
  const memoryBuckets = payload?.context_entries ?? payload?.context ?? {};
  const signalBuckets = payload?.signals ?? {};
  const countBuckets = buckets => Object.values(buckets ?? {}).reduce((sum, value) => {
    if (Array.isArray(value)) return sum + value.length;
    if (value && typeof value === 'object' && Array.isArray(value.entries)) return sum + value.entries.length;
    return sum;
  }, 0);
  return {
    memory_entries: countBuckets(memoryBuckets),
    signals: countBuckets(signalBuckets),
    signal_groups: Array.isArray(payload?.signal_groups) ? payload.signal_groups.length : 0,
    adjacent_subjects: Array.isArray(payload?.adjacent_context) ? payload.adjacent_context.length : 0,
  };
}

async function main() {
  console.log(`CRMy MCP context flow smoke test (${runId})`);
  console.log(`Endpoint: ${mcpUrl}`);

  const bearerToken = await resolveBearerToken();
  const client = new McpHttpClient({ url: mcpUrl, bearerToken, timeoutMs: requestTimeoutMs });

  try {
    const healthUrl = new URL(mcpUrl);
    healthUrl.pathname = '/health';
    healthUrl.search = '';
    await step('health_check', async () => {
      const res = await fetch(healthUrl);
      const body = await res.json();
      if (!res.ok || body.status !== 'ok' || body.db !== 'ok') throw new Error(JSON.stringify(body));
      artifacts.health = { version: body.version, db: body.db };
      return artifacts.health;
    });

    await step('mcp_initialize', async () => {
      const serverInfo = await client.connect();
      artifacts.server = serverInfo;
      return serverInfo;
    });

    const tools = await step('tools_list', async () => {
      const listed = await client.listTools();
      const names = new Set(listed.map(tool => tool.name));
      const requiredTools = [
        'account_create',
        'contact_create',
        'customer_record_resolve',
        'context_ingest',
        'context_ingest_auto',
        'context_source_get',
        'context_source_list',
        'context_list',
        'context_signal_group_list',
        'context_signal_group_get',
        'context_signal_promote',
        'briefing_get',
        'action_context_get',
        'context_lineage_get',
      ];
      const missing = requiredTools.filter(name => !names.has(name));
      if (missing.length) throw new Error(`Missing tools: ${missing.join(', ')}`);
      artifacts.tool_count = listed.length;
      return { count: listed.length };
    });

    const shortRun = runId.replace(/[^a-z0-9-]/gi, '').toLowerCase();
    const runOccurredAt = timestampFromRunId(runId);
    const accountName = `MCP Smoke ${runId} Labs`;
    const domain = `mcp-smoke-${shortRun}.example.com`;
    const contactEmail = `avery.stone.${shortRun}@mcp-smoke.example.com`;
    const commonTags = ['mcp-smoke', 'context-test'];

    const account = await step('account_create', async () => {
      const out = await client.callTool('account_create', {
        name: accountName,
        domain,
        industry: 'Software',
        employee_count: 420,
        website: `https://${domain}`,
        aliases: [`Smoke Labs ${runId}`, `MSL ${shortRun.slice(-6)}`],
        tags: commonTags,
        allow_duplicates: true,
        idempotency_key: `mcp-smoke-${runId}-account`,
      });
      if (!out?.account?.id) throw new Error('No account ID returned.');
      artifacts.account_id = out.account.id;
      artifacts.account_name = out.account.name;
      return { id: out.account.id, name: out.account.name };
    });

    const contact = await step('contact_create', async () => {
      const out = await client.callTool('contact_create', {
        first_name: 'Avery',
        last_name: `Stone ${shortRun.slice(-6)}`,
        email: contactEmail,
        title: 'Director of Revenue Operations',
        company_name: accountName,
        account_id: account.id,
        lifecycle_stage: 'prospect',
        aliases: [`Avery from ${accountName}`, `Avery ${shortRun.slice(-6)}`],
        tags: commonTags,
        source: 'mcp-context-flow-smoke',
        allow_duplicates: true,
        idempotency_key: `mcp-smoke-${runId}-contact`,
      });
      if (!out?.contact?.id) throw new Error('No contact ID returned.');
      artifacts.contact_id = out.contact.id;
      artifacts.contact_email = out.contact.email;
      return { id: out.contact.id, email: out.contact.email, account_id: out.contact.account_id };
    });

    await step('customer_record_resolve_created_records', async () => {
      const out = await client.callTool('customer_record_resolve', {
        text: `${contactEmail} from ${accountName} needs a briefing about the CRMy pilot.`,
        subject_type: 'any',
        confidence_threshold: 0.45,
        limit: 10,
      });
      const subjects = out?.subjects ?? [];
      const accountResolved = subjects.some(subject => subject.id === account.id);
      const contactResolved = subjects.some(subject => subject.id === contact.id);
      if (!accountResolved || !contactResolved) {
        throw new Error(`Expected account/contact resolution. Got: ${JSON.stringify(subjects)}`);
      }
      return { subjects: subjects.map(subject => ({ type: subject.type, id: subject.id, confidence: subject.confidence })) };
    });

    const transcript = [
      `Transcript: CRMy MCP smoke test discovery call for ${accountName} on 2026-06-05.`,
      `Participants: Avery Stone (${contactEmail}), Maya Chen VP Customer Experience, and Kai Patel from CRMy.`,
      'Avery: We approved a 48000 USD pilot budget if CRMy can support SOC 2 retention controls.',
      'Maya: Renewal risk is low if the security packet arrives by 2026-06-12, but we need agent-assist live before 2026-07-15.',
      'Avery: Mark me as the champion. The main blocker is security review, specifically data retention and audit log export.',
      'Kai: Next action is to send the security packet and draft implementation plan by Friday.',
      'Avery: The success metric is reducing manual account research by 30 percent in the first month.',
    ].join('\n');

    let knownIngestOut;
    await step('context_ingest_known_account', async () => {
      const out = await client.callTool('context_ingest', {
        subject_type: 'account',
        subject_id: account.id,
        document: transcript,
        source_label: `MCP smoke discovery transcript ${runId}`,
        idempotency_key: `mcp-smoke-${runId}-known-ingest`,
      });
      knownIngestOut = out;
      artifacts.known_ingest = {
        extracted_count: out?.extracted_count,
        memory_created: out?.memory_created,
        signals_created: out?.signals_created,
        skipped: out?.skipped,
        source_id: out?.source?.id ?? out?.processing_receipt?.source_id,
      };
      if (Number(out?.extracted_count ?? 0) <= 0) {
        throw new Error(`No context extracted. Receipt: ${JSON.stringify(out?.processing_receipt ?? out)}`);
      }
      return artifacts.known_ingest;
    }, { required: false });

    const knownSourceId = artifacts.known_ingest?.source_id
      ?? knownIngestOut?.source?.id
      ?? knownIngestOut?.processing_receipt?.source_id;
    if (knownSourceId) {
      const sourceId = knownSourceId;
      artifacts.source_id = sourceId;
      await step('context_source_get', async () => {
        const out = await client.callTool('context_source_get', { id: sourceId });
        const source = out?.source;
        if (!source?.id) throw new Error('No source returned.');
        return {
          id: source.id,
          status: source.status,
          stage: source.stage,
          memory_created: source.memory_created,
          signals_created: source.signals_created,
          skipped: source.skipped,
        };
      }, { required: false });
    } else {
      warnings.push('Known-subject ingest did not return a source_id.');
    }

    await step('context_source_list_for_account', async () => {
      const out = await client.callTool('context_source_list', {
        subject_type: 'account',
        subject_id: account.id,
        limit: 20,
      });
      return { total: out?.total, returned: out?.sources?.length ?? 0 };
    }, { required: false });

    let signalList;
    await step('context_list_signals', async () => {
      const out = await client.callTool('context_list', {
        subject_type: 'account',
        subject_id: account.id,
        memory_status: 'signal',
        limit: 50,
      });
      signalList = out;
      artifacts.signal_count = countEntries(out);
      return { total: out?.total, returned: artifacts.signal_count };
    }, { required: false });

    let memoryList;
    await step('context_list_memory_before_promotion', async () => {
      const out = await client.callTool('context_list', {
        subject_type: 'account',
        subject_id: account.id,
        memory_status: 'active',
        limit: 50,
      });
      memoryList = out;
      artifacts.memory_count_before_promotion = countEntries(out);
      return { total: out?.total, returned: artifacts.memory_count_before_promotion };
    }, { required: false });

    let signalCandidate = firstEntry(signalList) ?? firstSignalFromIngest(knownIngestOut);
    if (!signalCandidate && Number(artifacts.memory_count_before_promotion ?? 0) <= 0) {
      warnings.push('Source extraction did not produce a current Signal; creating a direct evidence-backed Signal so promotion mechanics can still be tested.');
      let directSignalOut;
      await step('context_add_fallback_signal', async () => {
        const out = await client.callTool('context_add', {
          subject_type: 'account',
          subject_id: account.id,
          context_type: 'deal_risk',
          title: 'Security review blocks pilot launch',
          body: `${accountName} has a security-review blocker around SOC 2 retention controls and audit log export before pilot launch.`,
          confidence: 0.92,
          memory_status: 'signal',
          evidence: [{
            source_type: 'mcp_smoke',
            source_ref: runId,
            source_label: `MCP smoke fallback signal ${runId}`,
            speaker: 'Avery Stone',
            snippet: 'The main blocker is security review, specifically data retention and audit log export.',
            observed_at: runOccurredAt,
            confidence: 0.92,
            rationale: 'Direct transcript statement names the blocker and required controls.',
          }],
          tags: commonTags,
          allow_similar: true,
          idempotency_key: `mcp-smoke-${runId}-fallback-signal`,
        });
        if (!out?.context_entry?.id) throw new Error('No context entry returned for fallback signal.');
        directSignalOut = out;
        return {
          id: out.context_entry.id,
          memory_status: out.context_entry.memory_status,
          signal_group_id: out.signal_group?.id,
          validation_warnings: out.validation_warnings,
        };
      }, { required: false });
      signalCandidate = directSignalOut?.context_entry;
      signalList = await client.callTool('context_list', {
        subject_type: 'account',
        subject_id: account.id,
        memory_status: 'signal',
        limit: 50,
      });
      artifacts.signal_count = countEntries(signalList);
    }

    await step('context_signal_group_list', async () => {
      const out = await client.callTool('context_signal_group_list', {
        subject_type: 'account',
        subject_id: account.id,
        attention_only: false,
        limit: 20,
      });
      const groups = out?.signal_groups ?? [];
      artifacts.signal_group_count = groups.length;
      artifacts.signal_groups = groups.slice(0, 5).map(group => ({
        id: group.id,
        status: group.status,
        confidence: group.aggregate_confidence,
        readiness: group.readiness?.status,
        blockers: group.readiness?.blockers,
      }));
      return { total: out?.total, returned: groups.length, first: artifacts.signal_groups?.[0] };
    }, { required: false });

    if (artifacts.signal_groups?.[0]?.id) {
      await step('context_signal_group_get_first', async () => {
        const out = await client.callTool('context_signal_group_get', { id: artifacts.signal_groups[0].id });
        const group = out?.signal_group;
        return {
          id: group?.id,
          status: group?.status,
          readiness: group?.readiness?.status,
          support_count: group?.support_count,
          source_count: group?.source_count,
        };
      }, { required: false });
    }

    if (!noPromote && signalCandidate?.id) {
      await step('context_signal_promote', async () => {
        const out = await client.callTool('context_signal_promote', {
          id: signalCandidate.id,
          confidence: Math.max(Number(signalCandidate.confidence ?? 0.9), 0.9),
          tags: commonTags,
          idempotency_key: `mcp-smoke-${runId}-promote-${signalCandidate.id}`,
        });
        if (!out?.context_entry?.id) throw new Error('No promoted context entry returned.');
        artifacts.promoted_context_entry_id = out.context_entry.id;
        return { id: out.context_entry.id, memory_status: out.context_entry.memory_status };
      }, { required: false });
    }

    memoryList = await step('context_list_memory_after_promotion', async () => {
      const out = await client.callTool('context_list', {
        subject_type: 'account',
        subject_id: account.id,
        memory_status: 'active',
        limit: 50,
      });
      artifacts.memory_count_after_promotion = countEntries(out);
      if (artifacts.memory_count_after_promotion <= 0) {
        throw new Error('No active Memory entries found after ingest/promotion checks.');
      }
      return { total: out?.total, returned: artifacts.memory_count_after_promotion };
    }, { required: false });

    await step('briefing_get_account', async () => {
      const out = await client.callTool('briefing_get', {
        subject_type: 'account',
        subject_id: account.id,
        context_radius: 'adjacent',
        include_stale: true,
        format: 'json',
        token_budget: 2000,
      });
      const briefing = out?.briefing;
      artifacts.briefing = {
        subject_type: briefing?.subject_type,
        subject_id: briefing?.subject?.id,
        context_counts: briefingCounts(out),
        token_estimate: briefing?.token_estimate,
        truncated: briefing?.truncated,
      };
      if (!briefing?.subject) throw new Error('No briefing subject returned.');
      return artifacts.briefing;
    }, { required: false });

    await step('action_context_get_customer_outreach', async () => {
      const out = await client.callTool('action_context_get', {
        subject_type: 'account',
        subject_id: account.id,
        context_radius: 'adjacent',
        token_budget: 2000,
        proposed_action: {
          action_type: 'customer_outreach',
          object_type: 'account',
        },
      });
      artifacts.action_context = {
        readiness: out?.action_context?.readiness?.status,
        allowed_actions: out?.action_context?.allowed_actions,
        required_handoffs: out?.action_context?.required_handoffs?.length,
      };
      return artifacts.action_context;
    }, { required: false });

    await step('context_lineage_get', async () => {
      const input = artifacts.source_id
        ? { source_id: artifacts.source_id }
        : { subject_type: 'account', subject_id: account.id };
      const out = await client.callTool('context_lineage_get', input);
      artifacts.lineage = {
        nodes: out?.lineage?.nodes?.length,
        edges: out?.lineage?.edges?.length,
        summary: out?.lineage?.summary,
      };
      return artifacts.lineage;
    }, { required: false });

    if (!skipAuto) {
      const autoDoc = [
        `Email thread for ${accountName} on 2026-06-05.`,
        `From: Avery Stone <${contactEmail}>`,
        `Subject: Security follow-up for ${accountName}`,
        'Avery confirmed the security packet is the critical next step for the pilot.',
        'Maya Chen asked CRMy to include audit log export details before the July 15 launch target.',
      ].join('\n');
      await step('context_ingest_auto_resolution', async () => {
        const out = await client.callTool('context_ingest_auto', {
          document: autoDoc,
          source_label: `MCP smoke auto email ${runId}`,
          source_occurred_at: runOccurredAt,
          confidence_threshold: 0.45,
          idempotency_key: `mcp-smoke-${runId}-auto-ingest`,
        });
        artifacts.auto_ingest = {
          subjects_resolved: out?.subjects_resolved?.map(subject => ({
            type: subject.entity_type,
            id: subject.id,
            name: subject.name,
            confidence: subject.confidence,
            entries_created: subject.entries_created,
            memory_created: subject.memory_created,
            signals_created: subject.signals_created,
          })) ?? [],
          entries_created: out?.entries_created,
          memory_created: out?.memory_created,
          signals_created: out?.signals_created,
          skipped: out?.skipped,
          low_confidence_skipped: out?.low_confidence_skipped,
          resolution_summary: out?.resolution_summary,
        };
        const ids = new Set(artifacts.auto_ingest.subjects_resolved.map(subject => subject.id));
        if (!ids.has(account.id) && !ids.has(contact.id)) {
          throw new Error(`Auto ingest did not resolve the created account/contact. ${JSON.stringify(artifacts.auto_ingest)}`);
        }
        return artifacts.auto_ingest;
      }, { required: false });
    }

    const failed = checks.filter(check => check.status === 'fail');
    const warned = checks.filter(check => check.status === 'warn');
    const summary = {
      status: failed.length ? 'failed' : warned.length || warnings.length ? 'passed_with_warnings' : 'passed',
      artifacts,
      checks,
      warnings,
    };
    console.log('\nSummary');
    console.log(JSON.stringify(summary, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(`FATAL ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exitCode = 1;
});
