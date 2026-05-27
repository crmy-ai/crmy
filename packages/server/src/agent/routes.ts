// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Router, type Request, type Response } from 'express';
import type { DbPool } from '../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import { CrmyError, permissionDenied } from '@crmy/shared';
import * as agentRepo from '../db/repos/agent.js';
import * as activityRepo from '../db/repos/agent-activity.js';
import { encrypt, decrypt } from './crypto.js';
import { runAgentTurn } from './engine.js';
import { callLLM } from './providers/llm.js';
import { trimForPersistence, estimateHistoryChars } from './compaction.js';
import type { AgentEvent, ConversationMessage } from './types.js';
import { getToolsForActor } from '../mcp/server.js';
import { getToolScopeRequirements } from '../auth/scopes.js';

function getActor(req: Request): ActorContext {
  return req.actor!;
}

function redactSensitive(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+):([^@\s]+)@/gi, '$1:***@')
    .replace(/((?:password|token|secret|api[_-]?key)=)[^&\s]+/gi, '$1***');
}

function safeErrorMessage(err: unknown, fallback = 'Agent request failed'): string {
  if (process.env.NODE_ENV === 'production') return fallback;
  return redactSensitive(err instanceof Error ? err.message : fallback);
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof CrmyError) {
    res.status(err.status).json(err.toJSON());
    return;
  }
  res.status(500).json({
    type: 'https://crmy.ai/errors/internal',
    title: 'Internal Error',
    status: 500,
    detail: safeErrorMessage(err, 'An unexpected agent error occurred. Check Model Settings and try again.'),
  });
}

function requireAdmin(actor: ActorContext): void {
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    throw permissionDenied('Admin role required');
  }
}

/**
 * Build safe key metadata for the client response.
 * Decrypts the stored key only to extract the last 4 chars as a hint.
 * Never sends the full plaintext or the ciphertext to the client.
 */
function buildKeyMeta(apiKeyEnc: string | null): { api_key_configured: boolean; api_key_hint: string | null } {
  if (!apiKeyEnc) return { api_key_configured: false, api_key_hint: null };
  try {
    const plain = decrypt(apiKeyEnc);
    return { api_key_configured: true, api_key_hint: plain.slice(-4) };
  } catch {
    // Key exists but cannot be decrypted (wrong env key, corrupted data)
    return { api_key_configured: true, api_key_hint: null };
  }
}

function deriveSessionLabel(message: string): string {
  const label = message
    .replace(/^\s*(please|can you|could you|would you|help me|i need you to|let'?s)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label) return 'New conversation';
  return label.length > 60 ? `${label.slice(0, 57).trimEnd()}...` : label;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
}

function sanitizeActivityDraft(input: Record<string, unknown>): Record<string, unknown> {
  const allowedTypes = new Set([
    'call', 'email', 'meeting', 'note', 'task', 'demo', 'proposal', 'research', 'handoff', 'status_update',
    'outreach_email', 'outreach_call', 'outreach_linkedin', 'outreach_other',
    'meeting_held', 'meeting_scheduled', 'note_added', 'research_completed', 'stage_change',
  ]);
  const out: Record<string, unknown> = {};
  const type = typeof input.type === 'string' && allowedTypes.has(input.type) ? input.type : 'note';
  out.type = type;
  out.subject = typeof input.subject === 'string' && input.subject.trim()
    ? input.subject.trim().slice(0, 240)
    : `${type.replace(/_/g, ' ')} activity`;
  if (typeof input.body === 'string' && input.body.trim()) out.body = input.body.trim().slice(0, 4000);
  if (typeof input.outcome === 'string' && input.outcome.trim()) out.outcome = input.outcome.trim().replace(/\s+/g, '_').slice(0, 80);
  if (typeof input.direction === 'string' && ['inbound', 'outbound'].includes(input.direction)) out.direction = input.direction;
  if (typeof input.occurred_at === 'string' && !Number.isNaN(Date.parse(input.occurred_at))) out.occurred_at = new Date(input.occurred_at).toISOString();

  const detail = input.detail && typeof input.detail === 'object' && !Array.isArray(input.detail)
    ? input.detail as Record<string, unknown>
    : {};
  const safeDetail = Object.fromEntries(
    Object.entries(detail)
      .filter(([, value]) => value == null || ['string', 'number', 'boolean'].includes(typeof value))
      .map(([key, value]) => [key.slice(0, 80), typeof value === 'string' ? value.slice(0, 500) : value]),
  );
  if (Object.keys(safeDetail).length > 0) out.detail = safeDetail;
  return out;
}

type QuickAddRecordType = 'contact' | 'account' | 'opportunity' | 'use-case' | 'activity' | 'assignment';

function readString(input: Record<string, unknown>, key: string, max = 500): string | undefined {
  const value = input[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function readNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readDate(input: Record<string, unknown>, key: string): string | undefined {
  const value = readString(input, key, 80);
  if (!value || Number.isNaN(Date.parse(value))) return undefined;
  return value.length <= 10 ? value : new Date(value).toISOString();
}

function readEnum<T extends string>(input: Record<string, unknown>, key: string, allowed: readonly T[], fallback?: T): T | undefined {
  const value = readString(input, key, 80)?.toLowerCase().replace(/\s+/g, '_') as T | undefined;
  if (value && allowed.includes(value)) return value;
  return fallback;
}

function sanitizeRecordDraft(type: QuickAddRecordType, input: Record<string, unknown>): Record<string, unknown> {
  if (type === 'activity') return sanitizeActivityDraft(input);

  const out: Record<string, unknown> = {};
  if (type === 'contact') {
    const fullName = readString(input, 'name', 160);
    const firstName = readString(input, 'first_name', 80);
    const lastName = readString(input, 'last_name', 120);
    if (firstName) out.first_name = firstName;
    else if (fullName) {
      const parts = fullName.split(/\s+/);
      out.first_name = parts[0];
      if (parts.length > 1) out.last_name = parts.slice(1).join(' ');
    }
    if (lastName) out.last_name = lastName;
    const email = readString(input, 'email', 200);
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.email = email;
    const phone = readString(input, 'phone', 80);
    if (phone) out.phone = phone;
    const title = readString(input, 'title', 160);
    if (title) out.title = title;
    const companyName = readString(input, 'company_name', 200);
    if (companyName) out.company_name = companyName;
    const lifecycle = readEnum(input, 'lifecycle_stage', ['lead', 'prospect', 'customer', 'churned'] as const);
    if (lifecycle) out.lifecycle_stage = lifecycle;
    return out;
  }

  if (type === 'account') {
    const name = readString(input, 'name', 240) ?? readString(input, 'company_name', 240);
    if (name) out.name = name;
    const industry = readString(input, 'industry', 160);
    if (industry) out.industry = industry;
    const domain = readString(input, 'domain', 200);
    if (domain) out.domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const website = readString(input, 'website', 300);
    if (website) out.website = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    const employeeCount = readNumber(input, 'employee_count');
    if (employeeCount && employeeCount > 0) out.employee_count = Math.round(employeeCount);
    const annualRevenue = readNumber(input, 'annual_revenue');
    if (annualRevenue && annualRevenue > 0) out.annual_revenue = annualRevenue;
    return out;
  }

  if (type === 'opportunity') {
    const name = readString(input, 'name', 240);
    if (name) out.name = name;
    const amount = readNumber(input, 'amount');
    if (amount && amount > 0) out.amount = Math.round(amount);
    const stage = readEnum(input, 'stage', ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] as const, 'prospecting');
    if (stage) out.stage = stage;
    const closeDate = readDate(input, 'close_date');
    if (closeDate) out.close_date = closeDate.slice(0, 10);
    const description = readString(input, 'description', 2000);
    if (description) out.description = description;
    return out;
  }

  if (type === 'use-case') {
    const name = readString(input, 'name', 240);
    if (name) out.name = name;
    const stage = readEnum(input, 'stage', ['discovery', 'poc', 'production', 'scaling', 'sunset'] as const, 'discovery');
    if (stage) out.stage = stage;
    const description = readString(input, 'description', 2000);
    if (description) out.description = description;
    const attributedArr = readNumber(input, 'attributed_arr');
    if (attributedArr && attributedArr > 0) out.attributed_arr = Math.round(attributedArr);
    const targetProdDate = readDate(input, 'target_prod_date');
    if (targetProdDate) out.target_prod_date = targetProdDate.slice(0, 10);
    return out;
  }

  if (type === 'assignment') {
    const title = readString(input, 'title', 240);
    if (title) out.title = title;
    const description = readString(input, 'description', 2000);
    if (description) out.description = description;
    const assignmentType = readString(input, 'assignment_type', 80);
    if (assignmentType) out.assignment_type = assignmentType.toLowerCase().replace(/\s+/g, '_');
    const priority = readEnum(input, 'priority', ['low', 'normal', 'high', 'urgent'] as const, 'normal');
    if (priority) out.priority = priority;
    const dueAt = readDate(input, 'due_at');
    if (dueAt) out.due_at = dueAt;
    const context = readString(input, 'context', 2000);
    if (context) out.context = context;
    return out;
  }

  return out;
}

function quickAddExtractionPrompt(type: QuickAddRecordType): string {
  const common = [
    'Return JSON only. Do not create records. Do not include commentary.',
    'Extract only fields clearly present in the note. Do not invent UUIDs or linked record IDs.',
    'If the user names a related company/contact but does not provide a UUID, include the name only in a human-readable field when allowed.',
  ];
  const byType: Record<QuickAddRecordType, string[]> = {
    contact: [
      'Object type: contact.',
      'Allowed fields: name, first_name, last_name, email, phone, title, company_name, lifecycle_stage.',
      'Allowed lifecycle_stage values: lead, prospect, customer, churned.',
    ],
    account: [
      'Object type: account/company.',
      'Allowed fields: name, company_name, domain, website, industry, employee_count, annual_revenue.',
    ],
    opportunity: [
      'Object type: opportunity/deal.',
      'Allowed fields: name, amount, stage, close_date, description.',
      'Allowed stage values: prospecting, qualification, proposal, negotiation, closed_won, closed_lost.',
    ],
    'use-case': [
      'Object type: use case.',
      'Allowed fields: name, stage, description, attributed_arr, target_prod_date.',
      'Allowed stage values: discovery, poc, production, scaling, sunset.',
    ],
    activity: [
      'Object type: activity.',
      'Allowed fields: type, subject, body, outcome, direction, occurred_at, detail.',
      'Allowed type values: call, email, meeting, note, task, demo, proposal, research, handoff, status_update, outreach_email, outreach_call, outreach_linkedin, outreach_other, meeting_held, meeting_scheduled, note_added, research_completed, stage_change.',
      'Use subject as a concise activity title. Use body for notes and next steps.',
      'Put unresolved names, company names, mentioned dates, requested next steps, and attendees in detail.',
    ],
    assignment: [
      'Object type: assignment/task.',
      'Allowed fields: title, description, assignment_type, priority, due_at, context.',
      'Allowed priority values: low, normal, high, urgent.',
    ],
  };
  return [...common, ...byType[type]].join('\n');
}

export function agentRouter(db: DbPool): Router {
  const router = Router();

  // ── Config ──────────────────────────────────────────────────────────────

  /** GET /agent/config — get agent config for this tenant. */
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const config = await agentRepo.getConfig(db, actor.tenant_id);
      if (!config) {
        res.json({ data: null });
        return;
      }
      // Never return the ciphertext — send only a hint (last 4 chars)
      const { api_key_enc: _enc, ...rest } = config;
      res.json({ data: { ...rest, ...buildKeyMeta(_enc) } });
    } catch (err) { handleError(res, err); }
  });

  /** PUT /agent/config — create or update agent config (admin only). */
  router.put('/config', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireAdmin(actor);

      const body = req.body as Record<string, unknown>;
      const update: Record<string, unknown> = {};

      // Pick allowed fields
      const boolFields = ['enabled', 'can_write_objects', 'can_log_activities', 'can_create_assignments', 'auto_extract_context', 'auto_promote_signals'];
      const strFields = ['provider', 'base_url', 'model', 'system_prompt'];
      const intFields = ['max_tokens_per_turn', 'history_retention_days'];

      for (const f of boolFields) {
        if (typeof body[f] === 'boolean') update[f] = body[f];
      }
      for (const f of strFields) {
        if (typeof body[f] === 'string') update[f] = body[f];
      }
      for (const f of intFields) {
        if (typeof body[f] === 'number') update[f] = body[f];
      }
      if (typeof body.signal_auto_promote_threshold === 'number') {
        const threshold = Math.min(0.98, Math.max(0.7, body.signal_auto_promote_threshold));
        update.signal_auto_promote_threshold = Number(threshold.toFixed(2));
      }

      // Encrypt API key if a new one was provided (non-empty string)
      if (typeof body.api_key === 'string' && body.api_key.trim()) {
        update.api_key_enc = encrypt(body.api_key.trim());
      }

      const config = await agentRepo.upsertConfig(db, actor.tenant_id, update);
      const { api_key_enc: _enc2, ...rest2 } = config;
      res.json({ data: { ...rest2, ...buildKeyMeta(_enc2) } });
    } catch (err) { handleError(res, err); }
  });

  /** POST /agent/config/test — test LLM connection.
   *
   * Accepts optional body overrides so the UI can test *current form values*
   * before the user has saved. Falls back to the stored config for any field
   * not supplied. Works regardless of whether the agent is enabled.
   */
  router.post('/config/test', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireAdmin(actor);

      const config = await agentRepo.getConfig(db, actor.tenant_id);

      // Merge form values (not-yet-saved) over stored config
      const body = req.body as { provider?: string; base_url?: string; api_key?: string; model?: string };

      const provider = body.provider ?? config?.provider;
      const rawUrl   = body.base_url  ?? config?.base_url ?? '';
      const model    = body.model     ?? config?.model    ?? '';
      const baseUrl  = rawUrl.replace(/\/+$/, '');

      // If caller sent an api_key, use it directly (trimmed). Otherwise decrypt the stored one.
      let apiKey = '';
      if (typeof body.api_key === 'string' && body.api_key.trim()) {
        apiKey = body.api_key.trim();
      } else if (config?.api_key_enc) {
        apiKey = decrypt(config.api_key_enc).trim();
      }

      if (!provider || !baseUrl || !model) {
        res.json({ ok: false, error: 'Provider, base URL, and model are required' });
        return;
      }

      // Attempt a minimal LLM call
      if (provider === 'anthropic') {
        const testRes = await fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });
        if (!testRes.ok) {
          const err = await testRes.text();
          res.json({ ok: false, error: `${testRes.status}: ${err.slice(0, 200)}` });
          return;
        }
      } else {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        if (baseUrl.includes('openrouter.ai')) {
          headers['HTTP-Referer'] = 'https://github.com/crmy-dev/crmy';
          headers['X-Title'] = 'CRMy';
        }

        const testRes = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });
        if (!testRes.ok) {
          const err = await testRes.text();
          res.json({ ok: false, error: `${testRes.status}: ${err.slice(0, 200)}` });
          return;
        }
      }

      res.json({ ok: true });
    } catch (err) {
      const message = safeErrorMessage(err, 'Connection failed. Check the model provider URL, model name, and API key.');
      res.json({ ok: false, error: message });
    }
  });

  /** POST /agent/extract/record — model-backed draft extraction for quick-add records. */
  router.post('/extract/record', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const type = typeof req.body?.object_type === 'string' ? req.body.object_type : '';
      const allowedTypes = new Set<QuickAddRecordType>(['contact', 'account', 'opportunity', 'use-case', 'activity', 'assignment']);
      if (!text) {
        res.status(400).json({ error: 'text is required' });
        return;
      }
      if (!allowedTypes.has(type as QuickAddRecordType)) {
        res.status(400).json({ error: 'object_type must be one of contact, account, opportunity, use-case, activity, or assignment' });
        return;
      }

      const config = await agentRepo.getConfig(db, actor.tenant_id);
      if (!config?.enabled || !config.model || !config.base_url) {
        res.status(400).json({ error: 'Workspace Agent is not configured for extraction' });
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const objectType = type as QuickAddRecordType;
      const responseText = await callLLM(db, actor.tenant_id, {
        maxTokens: Math.min(config.max_tokens_per_turn ?? 1200, 1200),
        system: [
          'You extract draft fields for CRMy quick-add record creation from one natural-language user note.',
          quickAddExtractionPrompt(objectType),
          `Today is ${today}. Resolve explicit relative dates like today, tomorrow, or yesterday when present.`,
        ].join('\n'),
        user: `Extract a ${objectType} draft from this note:\n\n${text}`,
      });

      const draft = sanitizeRecordDraft(objectType, parseJsonObject(responseText));
      res.json({ data: draft, source: 'agent' });
    } catch (err) { handleError(res, err); }
  });

  /** POST /agent/extract/activity — model-backed draft extraction for quick-add activity logging. */
  router.post('/extract/activity', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text) {
        res.status(400).json({ error: 'text is required' });
        return;
      }

      const config = await agentRepo.getConfig(db, actor.tenant_id);
      if (!config?.enabled || !config.model || !config.base_url) {
        res.status(400).json({ error: 'Workspace Agent is not configured for extraction' });
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const responseText = await callLLM(db, actor.tenant_id, {
        maxTokens: Math.min(config.max_tokens_per_turn ?? 1200, 1200),
        system: [
          'You extract CRMy activity draft fields from one natural-language user note.',
          quickAddExtractionPrompt('activity'),
          `Today is ${today}. Resolve explicit relative dates like today, tomorrow, or yesterday when present.`,
        ].join('\n'),
        user: `Extract an activity draft from this note:\n\n${text}`,
      });

      const draft = sanitizeActivityDraft(parseJsonObject(responseText));
      res.json({ data: draft, source: 'agent' });
    } catch (err) { handleError(res, err); }
  });

  // ── Sessions ────────────────────────────────────────────────────────────

  /** GET /agent/sessions — list current user's sessions. */
  router.get('/sessions', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const sessions = await agentRepo.listSessions(db, actor.tenant_id, actor.actor_id);
      res.json({ data: sessions });
    } catch (err) { handleError(res, err); }
  });

  /** POST /agent/sessions — create a new session. */
  router.post('/sessions', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const body = req.body as { context_type?: string; context_id?: string; context_name?: string; reuse_context?: boolean };
      if (body.reuse_context && body.context_type && body.context_id) {
        const existing = await agentRepo.getLatestSessionForContext(
          db,
          actor.tenant_id,
          actor.actor_id,
          body.context_type,
          body.context_id,
        );
        if (existing) {
          res.json({ data: existing });
          return;
        }
      }
      const session = await agentRepo.createSession(db, actor.tenant_id, actor.actor_id, body);
      res.status(201).json({ data: session });
    } catch (err) { handleError(res, err); }
  });

  /** GET /agent/sessions/:id — get session with messages. */
  router.get('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const session = await agentRepo.getSession(db, actor.tenant_id, String(req.params.id));
      if (!session || session.user_id !== actor.actor_id) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json({ data: session });
    } catch (err) { handleError(res, err); }
  });

  /** PATCH /agent/sessions/:id — rename a session (update label). */
  router.patch('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const session = await agentRepo.getSession(db, actor.tenant_id, String(req.params.id));
      if (!session || session.user_id !== actor.actor_id) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const { label } = req.body as { label?: string };
      const updated = await agentRepo.updateSession(db, actor.tenant_id, session.id, { label: label ?? undefined });
      res.json({ data: updated });
    } catch (err) { handleError(res, err); }
  });

  /** DELETE /agent/sessions/:id — delete a session. */
  router.delete('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      await agentRepo.deleteSession(db, actor.tenant_id, String(req.params.id));
      res.status(204).end();
    } catch (err) { handleError(res, err); }
  });

  /** DELETE /agent/sessions — clear all sessions for tenant (admin only). */
  router.delete('/sessions', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireAdmin(actor);
      const count = await agentRepo.deleteAllSessions(db, actor.tenant_id);
      res.json({ deleted: count });
    } catch (err) { handleError(res, err); }
  });

  /** POST /agent/sessions/:id/chat — send a message and stream the response via SSE. */
  router.post('/sessions/:id/chat', async (req: Request, res: Response) => {
    const actor = getActor(req);
    const { message, auto_greet, context_detail } = req.body as { message?: string; auto_greet?: boolean; context_detail?: string };

    // auto_greet is retained for older clients, but current clients attach
    // record context without starting a hidden model turn.
    const GREET_PROMPT =
      '[SYSTEM_INIT] The user has just opened this conversation from a CRM record. ' +
      'Acknowledge that the record context is attached and offer to get a briefing if they want the latest full context. ' +
      'Do not call briefing_get unless the user asks for a briefing or current record summary.';

    const effectiveMessage = auto_greet ? GREET_PROMPT : message;

    if (!effectiveMessage?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // Load config
    const config = await agentRepo.getConfig(db, actor.tenant_id);
    if (!config?.enabled) {
      res.status(400).json({ error: 'Agent is not enabled for this workspace' });
      return;
    }

    // Load or verify session
    let session = await agentRepo.getSession(db, actor.tenant_id, String(req.params.id));
    if (!session || session.user_id !== actor.actor_id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    });
    // Disable Nagle's algorithm so small SSE packets aren't delayed
    res.socket?.setNoDelay(true);
    // Flush headers immediately so the browser knows the stream has started
    res.flushHeaders();

    const sendEvent = (event: AgentEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      // If compression middleware is present it wraps the socket with flush()
      if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
        (res as unknown as { flush: () => void }).flush();
      }
    };

    try {
      // Build conversation history from session
      const history: ConversationMessage[] = [...(session.messages as ConversationMessage[])];

      // Add user message (or auto-greet internal prompt)
      history.push({ role: 'user', content: effectiveMessage });

      // Run the agent turn, injecting context metadata from the session so the
      // system prompt knows which record the conversation is about.
      const contextMeta = session.context_type
        ? { type: session.context_type, id: session.context_id ?? '', name: session.context_name ?? '', detail: context_detail }
        : undefined;

      const updatedHistory = await runAgentTurn(history, config, actor, db, sendEvent, {
        sessionId: session.id,
        contextMeta,
      });

      // Auto-label: use first visible user message as label (skip SYSTEM_INIT prompts)
      let label: string | undefined = session.label ?? undefined;
      if (!label && !auto_greet) {
        label = deriveSessionLabel(effectiveMessage);
      }

      // Trim large tool results before writing back to DB. The LLM has already
      // consumed them; future turns only need the gist. This keeps the stored
      // history lean so compaction is triggered less often.
      const persistHistory = trimForPersistence(updatedHistory);

      // Estimate token count (1 token ≈ 4 chars) for observability.
      const tokenCount = Math.round(estimateHistoryChars(persistHistory) / 4);

      // Persist updated session
      await agentRepo.updateSession(db, actor.tenant_id, session.id, {
        messages: persistHistory,
        label,
        token_count: tokenCount,
      });

      sendEvent({ type: 'done', session_id: session.id, label: label ?? null });
    } catch (err) {
      const errMsg = safeErrorMessage(err, 'Agent request failed. Check Model Settings and try again.');
      sendEvent({ type: 'error', message: errMsg });
    } finally {
      // setImmediate ensures the last SSE frames are flushed to the TCP buffer
      // before we close the connection, avoiding a race where res.end() races
      // ahead of the final write on some Node.js / proxy configurations.
      setImmediate(() => res.end());
    }
  });

  // ─── Activity log (admin: tenant-wide, user: own sessions only) ──────────────

  // GET /agent/tools — MCP tool catalog visible to the current actor
  router.get('/tools', async (req: Request, res: Response) => {
    const actor = getActor(req);
    const tools = getToolsForActor(db, actor).map(tool => ({
      name: tool.name,
      tier: tool.tier,
      required_scopes: getToolScopeRequirements(tool.name),
      description: tool.description,
      category: tool.name.split('_')[0] ?? 'tool',
    }));
    res.json({ data: tools, total: tools.length });
  });

  // GET /agent/activity — tenant-wide tool call log (admin) or own-session log (user)
  router.get('/activity', async (req: Request, res: Response) => {
    const actor = getActor(req);
    const isAdmin = actor.role === 'admin';

    const filters: activityRepo.ListActivityFilters = {
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
      cursor: req.query.cursor as string | undefined,
      toolName: req.query.tool_name as string | undefined,
      isError: req.query.is_error === 'true' ? true : req.query.is_error === 'false' ? false : undefined,
      since: req.query.since as string | undefined,
    };

    // Non-admins can only see their own tool calls
    if (!isAdmin) {
      filters.userId = actor.actor_id;
    } else if (req.query.user_id) {
      filters.userId = req.query.user_id as string;
    }

    const result = await activityRepo.listActivity(db, actor.tenant_id, filters);
    res.json(result);
  });

  // GET /agent/sessions/:id/activity — all tool calls in a specific session
  router.get('/sessions/:id/activity', async (req: Request, res: Response) => {
    const actor = getActor(req);
    const session = await agentRepo.getSession(db, actor.tenant_id, String(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    // Non-admins can only view their own sessions
    if (actor.role !== 'admin' && session.user_id !== actor.actor_id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const activity = await activityRepo.getSessionActivity(db, actor.tenant_id, session.id);
    res.json({ activity });
  });

  return router;
}
