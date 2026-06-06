// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Router, type Request, type Response } from 'express';
import type { DbPool } from '../db/pool.js';
import type { ActorContext, UUID } from '@crmy/shared';
import { CrmyError, permissionDenied } from '@crmy/shared';
import * as agentRepo from '../db/repos/agent.js';
import * as activityRepo from '../db/repos/agent-activity.js';
import { encrypt, decrypt } from './crypto.js';
import { callLLM } from './providers/llm.js';
import { getToolsForActor } from '../mcp/server.js';
import { getAllTools } from '../mcp/server.js';
import { enforceToolScopes, getToolScopeRequirements } from '../auth/scopes.js';
import { assertSubjectAccess, resolveOwnerFilter } from '../services/access-control.js';
import { entityResolve } from '../services/entity-resolve.js';
import * as accountRepo from '../db/repos/accounts.js';
import * as contactRepo from '../db/repos/contacts.js';
import * as oppRepo from '../db/repos/opportunities.js';
import * as ucRepo from '../db/repos/use-cases.js';
import { listCustomFields } from '../db/repos/custom-fields.js';
import { checkAccountDuplicate, checkContactDuplicate, checkOpportunityDuplicate, type DuplicateCheckResult } from '../services/deduplication.js';
import { extractTextFromBuffer } from '../lib/file-extract.js';
import {
  cancelRunningAgentTurn,
  startAgentTurnRunner,
} from './turn-runner.js';
import type { AgentSessionAttachment, AgentTurn, AgentTurnEventRow } from './types.js';
import { previewRecordDraft, recordDraftPreviewSchema } from '../services/record-drafts.js';
import {
  buildOpenAICompatibleHeaders,
  verifyAgentToolCalling,
  type ReadinessResult,
} from './readiness.js';

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

const AGENT_READINESS_TTL_MS = Number(process.env.AGENT_READINESS_TTL_MS ?? 60_000);
const readinessCache = new Map<string, { expiresAt: number; result: ReadinessResult }>();

function readinessError(actor: ActorContext, error: string): string {
  return isAdmin(actor)
    ? redactSensitive(error)
    : 'Workspace Agent is configured but unreachable. Ask an admin to check Model Settings.';
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

function isAdmin(actor: ActorContext): boolean {
  return actor.role === 'owner' || actor.role === 'admin';
}

function toolHandler(db: DbPool, toolName: string) {
  const tools = getAllTools(db);
  const tool = tools.find(t => t.name === toolName);
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return async (input: unknown, actor: ActorContext) => {
    enforceToolScopes(toolName, actor);
    return tool.handler(input, actor);
  };
}

function normalizeAgentContextType(contextType?: string | null): 'account' | 'contact' | 'opportunity' | 'use_case' | null {
  if (!contextType) return null;
  if (contextType === 'account' || contextType === 'contact' || contextType === 'opportunity' || contextType === 'use_case') return contextType;
  if (contextType === 'use-case' || contextType === 'useCase') return 'use_case';
  return null;
}

async function canAccessAgentContext(
  db: DbPool,
  actor: ActorContext,
  contextType?: string | null,
  contextId?: string | null,
): Promise<boolean> {
  if (!contextType && !contextId) return true;
  const subjectType = normalizeAgentContextType(contextType);
  if (!subjectType || !contextId) return false;
  try {
    await assertSubjectAccess(db, actor, subjectType, contextId as UUID);
    return true;
  } catch {
    return false;
  }
}

function redactAttachment(att: AgentSessionAttachment): Omit<AgentSessionAttachment, 'extracted_text'> & { extracted_text?: never } {
  const { extracted_text: _text, ...rest } = att;
  return rest;
}

async function loadOwnedSession(db: DbPool, actor: ActorContext, sessionId: string) {
  const session = await agentRepo.getSession(db, actor.tenant_id, sessionId);
  if (!session || session.user_id !== actor.actor_id) return null;
  if (!(await canAccessAgentContext(db, actor, session.context_type, session.context_id))) return null;
  return session;
}

async function loadOwnedTurn(db: DbPool, actor: ActorContext, sessionId: string, turnId: string): Promise<AgentTurn | null> {
  const session = await loadOwnedSession(db, actor, sessionId);
  if (!session) return null;
  return await agentRepo.getTurnForSession(db, actor.tenant_id, session.id, turnId);
}

function dataUrlToBuffer(input: string): Buffer {
  const base64 = input.includes(',') && input.slice(0, 40).includes('base64')
    ? input.slice(input.indexOf(',') + 1)
    : input;
  return Buffer.from(base64, 'base64');
}

function writeSse(res: Response, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
    (res as unknown as { flush: () => void }).flush();
  }
}

async function streamTurnEvents(
  db: DbPool,
  actor: ActorContext,
  res: Response,
  sessionId: string,
  turnId: string,
  startAfterIndex = 0,
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.socket?.setNoDelay(true);
  res.flushHeaders();

  let closed = false;
  res.on('close', () => { closed = true; });
  let afterIndex = startAfterIndex;

  while (!closed && !res.writableEnded) {
    const turn = await loadOwnedTurn(db, actor, sessionId, turnId);
    if (!turn) {
      writeSse(res, { type: 'error', message: 'Agent turn not found' });
      break;
    }
    const events = await agentRepo.listTurnEventsAfter(db, actor.tenant_id, turnId, afterIndex);
    for (const row of events) {
      afterIndex = row.event_index;
      writeSse(res, row.payload);
    }
    if (['succeeded', 'failed', 'cancelled'].includes(turn.status) && events.length === 0) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }

  setImmediate(() => res.end());
}

function turnWithEvents(turn: AgentTurn, events: AgentTurnEventRow[]) {
  return {
    ...turn,
    events: events.map(row => row.payload),
    last_event_index: events.length > 0 ? events[events.length - 1].event_index : 0,
  };
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
  for (const key of ['account_name', 'contact_name', 'opportunity_name', 'use_case_name']) {
    const value = readString(input, key, 240);
    if (value) out[key] = value;
  }

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
type QuickAddSubjectType = 'account' | 'contact' | 'opportunity' | 'use_case' | 'use-case';

type QuickAddLinkedRecord = {
  type: 'account' | 'contact' | 'opportunity' | 'use_case';
  id: string;
  name: string;
  detail?: string | null;
};

type QuickAddFieldRow = {
  field: string;
  label: string;
  value: unknown;
  source: 'user' | 'model_knowledge' | 'matched_record' | 'provider' | 'required';
  source_label: string;
  status: 'ready' | 'missing' | 'linked' | 'optional';
  required: boolean;
  confidence_label?: string;
  requires_confirmation?: boolean;
};

type QuickAddEnrichmentSuggestion = {
  field: string;
  label: string;
  value: unknown;
  source: 'model_knowledge' | 'provider';
  source_label: string;
  confidence_label: string;
  requires_confirmation: boolean;
};

type QuickAddParentContext = {
  parent_subject_type?: string;
  parent_subject_id?: string;
  parent_subject_name?: string;
  defaults?: Record<string, unknown>;
};

const QUICK_ADD_REQUIRED_FIELDS: Record<QuickAddRecordType, string[]> = {
  account: ['name'],
  contact: ['first_name'],
  opportunity: ['name'],
  'use-case': ['name', 'account_id'],
  activity: ['type', 'subject'],
  assignment: ['title', 'assignment_type', 'assigned_to'],
};

const QUICK_ADD_FIELD_LABELS: Record<string, string> = {
  account_id: 'Account',
  contact_id: 'Contact',
  opportunity_id: 'Opportunity',
  use_case_id: 'Use Case',
  first_name: 'First Name',
  last_name: 'Last Name',
  company_name: 'Account Name',
  lifecycle_stage: 'Lifecycle Stage',
  close_date: 'Close Date',
  occurred_at: 'Occurred At',
  subject_type: 'Linked Record Type',
  subject_id: 'Linked Record',
  attributed_arr: 'Attributed ARR',
  target_prod_date: 'Target Production Date',
  annual_revenue: 'Annual Revenue',
  employee_count: 'Employee Count',
  assignment_type: 'Assignment Type',
  assigned_to: 'Assigned To',
};

function quickAddLabel(field: string): string {
  return QUICK_ADD_FIELD_LABELS[field] ?? field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeQuickAddSubjectType(value?: string | null): QuickAddSubjectType | undefined {
  if (!value) return undefined;
  if (value === 'use_case') return 'use-case';
  if (['account', 'contact', 'opportunity', 'use-case'].includes(value)) return value as QuickAddSubjectType;
  return undefined;
}

function readString(input: Record<string, unknown>, key: string, max = 500): string | undefined {
  const value = input[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function deleteKeys(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) delete input[key];
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

function readStringArray(input: Record<string, unknown>, key: string, maxItems = 10): string[] | undefined {
  const value = input[key];
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
  return cleaned.length ? cleaned : undefined;
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
    const aliases = readStringArray(input, 'aliases');
    if (aliases) out.aliases = aliases;
    const tags = readStringArray(input, 'tags');
    if (tags) out.tags = tags;
    const employeeCount = readNumber(input, 'employee_count');
    if (employeeCount && employeeCount > 0) out.employee_count = Math.round(employeeCount);
    const annualRevenue = readNumber(input, 'annual_revenue');
    if (annualRevenue && annualRevenue > 0) out.annual_revenue = annualRevenue;
    return out;
  }

  if (type === 'opportunity') {
    const name = readString(input, 'name', 240);
    if (name) out.name = name;
    const accountName = readString(input, 'account_name', 240) ?? readString(input, 'company_name', 240);
    if (accountName) out.account_name = accountName;
    const contactName = readString(input, 'contact_name', 180);
    if (contactName) out.contact_name = contactName;
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
    const accountName = readString(input, 'account_name', 240) ?? readString(input, 'company_name', 240);
    if (accountName) out.account_name = accountName;
    const opportunityName = readString(input, 'opportunity_name', 240);
    if (opportunityName) out.opportunity_name = opportunityName;
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

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
}

function quickAddObjectTypeForCustomFields(type: QuickAddRecordType): string {
  return type === 'use-case' ? 'use_case' : type;
}

async function getQuickAddParentRecord(
  db: DbPool,
  actor: ActorContext,
  parentType?: string,
  parentId?: string,
): Promise<QuickAddLinkedRecord | null> {
  const normalized = normalizeQuickAddSubjectType(parentType);
  if (!normalized || !parentId) return null;
  const accessType = normalized === 'use-case' ? 'use_case' : normalized;
  await assertSubjectAccess(db, actor, accessType, parentId);

  if (normalized === 'account') {
    const record = await accountRepo.getAccount(db, actor.tenant_id, parentId);
    return record ? { type: 'account', id: record.id, name: String(record.name), detail: record.industry ?? record.domain ?? null } : null;
  }
  if (normalized === 'contact') {
    const record = await contactRepo.getContact(db, actor.tenant_id, parentId);
    return record ? {
      type: 'contact',
      id: record.id,
      name: `${record.first_name ?? ''} ${record.last_name ?? ''}`.trim() || record.email || 'Contact',
      detail: record.account_name ?? record.company_name ?? null,
    } : null;
  }
  if (normalized === 'opportunity') {
    const record = await oppRepo.getOpportunity(db, actor.tenant_id, parentId);
    return record ? { type: 'opportunity', id: record.id, name: String(record.name), detail: record.stage ?? null } : null;
  }
  const record = await ucRepo.getUseCase(db, actor.tenant_id, parentId);
  return record ? { type: 'use_case', id: record.id, name: String(record.name), detail: record.stage ?? null } : null;
}

async function accountScopeForParent(
  db: DbPool,
  actor: ActorContext,
  parentType?: string,
  parentId?: string,
): Promise<string | undefined> {
  const normalized = normalizeQuickAddSubjectType(parentType);
  if (!normalized || !parentId) return undefined;
  if (normalized === 'account') return parentId;
  if (normalized === 'contact') return (await contactRepo.getContact(db, actor.tenant_id, parentId))?.account_id ?? undefined;
  if (normalized === 'opportunity') return (await oppRepo.getOpportunity(db, actor.tenant_id, parentId))?.account_id ?? undefined;
  return (await ucRepo.getUseCase(db, actor.tenant_id, parentId))?.account_id ?? undefined;
}

async function buildQuickAddCreationPacket(
  db: DbPool,
  actor: ActorContext,
  objectType: QuickAddRecordType,
  context: QuickAddParentContext,
) {
  const ownerFilter = await resolveOwnerFilter(db, actor);
  const ownerIds = 'owner_ids' in ownerFilter ? ownerFilter.owner_ids : undefined;
  const customFields = await listCustomFields(db, actor.tenant_id, quickAddObjectTypeForCustomFields(objectType));
  const parent = await getQuickAddParentRecord(db, actor, context.parent_subject_type, context.parent_subject_id);
  const accountId = await accountScopeForParent(db, actor, context.parent_subject_type, context.parent_subject_id);

  const related: Record<string, unknown[]> = {};
  if (accountId) {
    const [contacts, opportunities, useCases] = await Promise.all([
      contactRepo.searchContacts(db, actor.tenant_id, { account_id: accountId, owner_ids: ownerIds, limit: 8 }),
      oppRepo.searchOpportunities(db, actor.tenant_id, { account_id: accountId, owner_ids: ownerIds, limit: 8 }),
      ucRepo.searchUseCases(db, actor.tenant_id, { account_id: accountId, owner_ids: ownerIds, limit: 8 }),
    ]);
    related.contacts = contacts.data.map(c => ({ id: c.id, name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(), email: c.email, title: c.title }));
    related.opportunities = opportunities.data.map(o => ({ id: o.id, name: o.name, stage: o.stage, amount: o.amount, close_date: o.close_date }));
    related.use_cases = useCases.data.map(uc => ({ id: uc.id, name: uc.name, stage: uc.stage, opportunity_id: uc.opportunity_id }));
  }

  return {
    object_type: objectType,
    required_fields: QUICK_ADD_REQUIRED_FIELDS[objectType],
    allowed_fields: quickAddExtractionPrompt(objectType),
    parent_record: parent,
    account_scope_id: accountId,
    related_records: related,
    defaults: context.defaults ?? {},
    custom_fields: customFields.map(field => ({
      key: field.field_key,
      label: field.label,
      type: field.field_type,
      required: field.is_required,
      options: field.options ?? null,
    })),
  };
}

function applyQuickAddDefaultsAndScope(
  draft: Record<string, unknown>,
  objectType: QuickAddRecordType,
  context: QuickAddParentContext,
  parent: QuickAddLinkedRecord | null,
) {
  Object.assign(draft, context.defaults ?? {}, draft);
  if (!parent) return;

  if (parent.type === 'account') {
    if (['contact', 'opportunity', 'use-case', 'activity'].includes(objectType) && !draft.account_id) draft.account_id = parent.id;
    if (objectType === 'contact' && !draft.company_name) draft.company_name = parent.name;
  }
  if (parent.type === 'contact') {
    if (['opportunity', 'activity'].includes(objectType) && !draft.contact_id) draft.contact_id = parent.id;
    if (objectType === 'activity' && !draft.subject_type && !draft.subject_id) {
      draft.subject_type = 'contact';
      draft.subject_id = parent.id;
    }
  }
  if (parent.type === 'opportunity') {
    if (['use-case', 'activity'].includes(objectType) && !draft.opportunity_id) draft.opportunity_id = parent.id;
    if (objectType === 'activity' && !draft.subject_type && !draft.subject_id) {
      draft.subject_type = 'opportunity';
      draft.subject_id = parent.id;
    }
  }
  if (parent.type === 'use_case') {
    if (objectType === 'activity' && !draft.use_case_id) draft.use_case_id = parent.id;
    if (objectType === 'activity' && !draft.subject_type && !draft.subject_id) {
      draft.subject_type = 'use_case';
      draft.subject_id = parent.id;
    }
  }
}

async function linkedRecordsForDraft(db: DbPool, actor: ActorContext, draft: Record<string, unknown>): Promise<QuickAddLinkedRecord[]> {
  const linked: QuickAddLinkedRecord[] = [];
  const add = (record: QuickAddLinkedRecord | null) => {
    if (record && !linked.some(item => item.type === record.type && item.id === record.id)) linked.push(record);
  };

  if (typeof draft.account_id === 'string') {
    const record = await accountRepo.getAccount(db, actor.tenant_id, draft.account_id);
    add(record ? { type: 'account', id: record.id, name: String(record.name), detail: record.industry ?? record.domain ?? null } : null);
  }
  if (typeof draft.contact_id === 'string') {
    const record = await contactRepo.getContact(db, actor.tenant_id, draft.contact_id);
    add(record ? { type: 'contact', id: record.id, name: `${record.first_name ?? ''} ${record.last_name ?? ''}`.trim() || record.email || 'Contact', detail: record.account_name ?? record.company_name ?? null } : null);
  }
  if (typeof draft.opportunity_id === 'string') {
    const record = await oppRepo.getOpportunity(db, actor.tenant_id, draft.opportunity_id);
    add(record ? { type: 'opportunity', id: record.id, name: String(record.name), detail: record.stage ?? null } : null);
  }
  if (typeof draft.use_case_id === 'string') {
    const record = await ucRepo.getUseCase(db, actor.tenant_id, draft.use_case_id);
    add(record ? { type: 'use_case', id: record.id, name: String(record.name), detail: record.stage ?? null } : null);
  }
  return linked;
}

async function quickAddDuplicateCandidates(
  db: DbPool,
  actor: ActorContext,
  objectType: QuickAddRecordType,
  draft: Record<string, unknown>,
) {
  let result: DuplicateCheckResult | null = null;
  if (objectType === 'account' && typeof draft.name === 'string') {
    result = await checkAccountDuplicate(db, actor.tenant_id, {
      name: draft.name,
      domain: readString(draft, 'domain', 200),
      website: readString(draft, 'website', 300),
    });
  } else if (objectType === 'contact' && typeof draft.first_name === 'string') {
    result = await checkContactDuplicate(db, actor.tenant_id, {
      first_name: draft.first_name,
      last_name: readString(draft, 'last_name', 120),
      email: readString(draft, 'email', 200),
      phone: readString(draft, 'phone', 80),
      company_name: readString(draft, 'company_name', 200),
      account_id: readString(draft, 'account_id', 80),
    });
  } else if (objectType === 'opportunity' && typeof draft.name === 'string') {
    result = await checkOpportunityDuplicate(db, actor.tenant_id, {
      name: draft.name,
      account_id: readString(draft, 'account_id', 80),
      amount: readNumber(draft, 'amount'),
      close_date: readString(draft, 'close_date', 40),
    });
  } else if (objectType === 'use-case' && typeof draft.name === 'string' && typeof draft.account_id === 'string') {
    const ownerFilter = await resolveOwnerFilter(db, actor);
    const ownerIds = 'owner_ids' in ownerFilter ? ownerFilter.owner_ids : undefined;
    const matches = await ucRepo.searchUseCases(db, actor.tenant_id, {
      query: draft.name,
      account_id: draft.account_id,
      owner_ids: ownerIds,
      limit: 5,
    });
    return matches.data
      .filter(item => String(item.name).toLowerCase() === String(draft.name).toLowerCase())
      .map(item => ({ id: item.id, name: item.name, score: 70, reasons: ['same name on same account'] }));
  }
  const candidates = result?.candidates ?? [];
  const subjectType = objectType === 'use-case' ? 'use_case' : objectType;
  const visible = [];
  for (const candidate of candidates) {
    try {
      await assertSubjectAccess(db, actor, subjectType, candidate.id);
      visible.push(candidate);
    } catch {
      // Do not leak duplicate candidates outside the actor's visible scope.
    }
  }
  return visible;
}

async function missingQuickAddFields(
  db: DbPool,
  actor: ActorContext,
  objectType: QuickAddRecordType,
  draft: Record<string, unknown>,
) {
  const missing = QUICK_ADD_REQUIRED_FIELDS[objectType].filter(field => !isPresent(draft[field]));
  const customFields = await listCustomFields(db, actor.tenant_id, quickAddObjectTypeForCustomFields(objectType));
  const customValues = draft.custom_fields && typeof draft.custom_fields === 'object' && !Array.isArray(draft.custom_fields)
    ? draft.custom_fields as Record<string, unknown>
    : {};
  for (const field of customFields) {
    if (field.is_required && !isPresent(customValues[field.field_key])) missing.push(`custom_fields.${field.field_key}`);
  }
  return missing;
}

function normalizeFieldSource(value: unknown): QuickAddFieldRow['source'] | undefined {
  if (value === 'user' || value === 'model_knowledge' || value === 'matched_record' || value === 'provider') return value;
  return undefined;
}

function valueLooksUserProvided(value: unknown, sourceText: string): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(item => valueLooksUserProvided(item, sourceText));
  const normalizedText = sourceText.toLowerCase();
  const normalizedValue = String(value).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (!normalizedValue || normalizedValue.length < 3) return false;
  return normalizedText.includes(normalizedValue);
}

function volatileAccountFieldWasProvided(field: string, value: unknown, sourceText: string, rawInput: Record<string, unknown>): boolean {
  const fieldSources = rawInput.field_sources && typeof rawInput.field_sources === 'object' && !Array.isArray(rawInput.field_sources)
    ? rawInput.field_sources as Record<string, unknown>
    : {};
  return normalizeFieldSource(fieldSources[field]) === 'user' || valueLooksUserProvided(value, sourceText);
}

function removeUnprovidedVolatileAccountFields(draft: Record<string, unknown>, sourceText: string, rawInput: Record<string, unknown>) {
  for (const field of ['employee_count', 'annual_revenue']) {
    if (draft[field] != null && !volatileAccountFieldWasProvided(field, draft[field], sourceText, rawInput)) {
      delete draft[field];
    }
  }
}

function fieldSourceForDraft(
  objectType: QuickAddRecordType,
  field: string,
  value: unknown,
  sourceText: string,
  rawInput: Record<string, unknown>,
): QuickAddFieldRow['source'] {
  const fieldSources = rawInput.field_sources && typeof rawInput.field_sources === 'object' && !Array.isArray(rawInput.field_sources)
    ? rawInput.field_sources as Record<string, unknown>
    : {};
  const explicit = normalizeFieldSource(fieldSources[field]);
  if (explicit) return explicit;
  if (field.endsWith('_id') || field === 'subject_id') return 'matched_record';
  if (
    objectType === 'account'
    && ['industry', 'domain', 'website', 'aliases', 'tags'].includes(field)
    && !valueLooksUserProvided(value, sourceText)
  ) return 'model_knowledge';
  return 'user';
}

function sourceLabel(source: QuickAddFieldRow['source']): string {
  if (source === 'model_knowledge') return 'Suggested by model';
  if (source === 'matched_record') return 'Matched existing record';
  if (source === 'provider') return 'Suggested by provider';
  if (source === 'required') return 'Needs confirmation';
  return 'Provided by user';
}

function confidenceLabel(source: QuickAddFieldRow['source']): string | undefined {
  if (source === 'model_knowledge') return 'Unverified';
  if (source === 'provider') return 'Provider supplied';
  return undefined;
}

function fieldRowsForDraft(
  objectType: QuickAddRecordType,
  draft: Record<string, unknown>,
  missingFields: string[],
  sourceText = '',
  rawInput: Record<string, unknown> = {},
): QuickAddFieldRow[] {
  const rows: QuickAddFieldRow[] = [];
  const required = new Set([...QUICK_ADD_REQUIRED_FIELDS[objectType], ...missingFields]);
  const hidden = new Set(['allow_duplicates', 'if_exists', 'idempotency_key']);

  for (const [field, value] of Object.entries(draft)) {
    if (hidden.has(field) || value === undefined || value === '') continue;
    const source = fieldSourceForDraft(objectType, field, value, sourceText, rawInput);
    rows.push({
      field,
      label: quickAddLabel(field),
      value,
      source,
      source_label: sourceLabel(source),
      status: source === 'matched_record' ? 'linked' : 'ready',
      required: required.has(field),
      confidence_label: confidenceLabel(source),
      requires_confirmation: source === 'model_knowledge' || source === 'provider',
    });
  }

  for (const field of missingFields) {
    if (rows.some(row => row.field === field)) continue;
    rows.push({
      field,
      label: field.startsWith('custom_fields.') ? quickAddLabel(field.replace('custom_fields.', '')) : quickAddLabel(field),
      value: null,
      source: 'required',
      source_label: 'Needs confirmation',
      status: 'missing',
      required: true,
      requires_confirmation: true,
    });
  }

  return rows;
}

function enrichmentSuggestionsFromRows(rows: QuickAddFieldRow[]): QuickAddEnrichmentSuggestion[] {
  return rows
    .filter(row => row.source === 'model_knowledge' || row.source === 'provider')
    .map(row => ({
      field: row.field,
      label: row.label,
      value: row.value,
      source: row.source as 'model_knowledge' | 'provider',
      source_label: row.source_label,
      confidence_label: row.confidence_label ?? 'Unverified',
      requires_confirmation: true,
    }));
}

async function resolveQuickAddReferences(
  db: DbPool,
  actor: ActorContext,
  type: QuickAddRecordType,
  draft: Record<string, unknown>,
  context: QuickAddParentContext = {},
): Promise<{ draft: Record<string, unknown>; resolution_summary: string[]; unresolved_references: string[] }> {
  const resolutionSummary: string[] = [];
  const unresolvedReferences: string[] = [];
  const ownerFilter = await resolveOwnerFilter(db, actor);
  const ownerIds = 'owner_ids' in ownerFilter ? ownerFilter.owner_ids : undefined;
  const parent = await getQuickAddParentRecord(db, actor, context.parent_subject_type, context.parent_subject_id);
  applyQuickAddDefaultsAndScope(draft, type, context, parent);
  if (parent) resolutionSummary.push(`Using ${parent.type.replace('_', ' ')} scope: ${parent.name}`);

  const resolveAccount = async (name?: string) => {
    if (!name) return null;
    const result = await entityResolve(db, actor.tenant_id, {
      query: name,
      entity_type: 'account',
      actor_id: actor.actor_id,
      owner_ids: ownerIds,
      limit: 5,
    });
    if (result.status === 'resolved' && result.resolved?.entity_type === 'account') return result.resolved;
    unresolvedReferences.push(`Account "${name}" was not confidently matched.`);
    return null;
  };

  const resolveContact = async (name?: string, companyName?: string) => {
    if (!name) return null;
    const result = await entityResolve(db, actor.tenant_id, {
      query: name,
      entity_type: 'contact',
      context_hints: companyName ? { company_name: companyName } : undefined,
      actor_id: actor.actor_id,
      owner_ids: ownerIds,
      limit: 5,
    });
    if (result.status === 'resolved' && result.resolved?.entity_type === 'contact') return result.resolved;
    unresolvedReferences.push(`Contact "${name}" was not confidently matched.`);
    return null;
  };

  const accountName = readString(draft, 'account_name', 240) ?? readString(draft, 'company_name', 240);
  if ((type === 'contact' || type === 'opportunity' || type === 'use-case') && !draft.account_id && accountName) {
    const account = await resolveAccount(accountName);
    if (account) {
      draft.account_id = account.id;
      resolutionSummary.push(`Matched account: ${account.name}`);
      if (type === 'contact' && !draft.company_name) draft.company_name = account.name;
    }
  }

  const contactName = readString(draft, 'contact_name', 180);
  if ((type === 'opportunity' || type === 'activity') && !draft.contact_id && contactName) {
    const contact = await resolveContact(contactName, accountName);
    if (contact) {
      draft.contact_id = contact.id;
      resolutionSummary.push(`Matched contact: ${contact.name}`);
    }
  }

  const opportunityName = readString(draft, 'opportunity_name', 240);
  if ((type === 'use-case' || type === 'activity') && !draft.opportunity_id && opportunityName) {
    const result = await oppRepo.searchOpportunities(db, actor.tenant_id, {
      query: opportunityName,
      account_id: typeof draft.account_id === 'string' ? draft.account_id : undefined,
      owner_ids: ownerIds,
      limit: 2,
    });
    if (result.data.length === 1) {
      draft.opportunity_id = result.data[0].id;
      resolutionSummary.push(`Matched opportunity: ${result.data[0].name}`);
    } else if (result.data.length > 1) {
      unresolvedReferences.push(`Opportunity "${opportunityName}" matched multiple visible records.`);
    } else {
      unresolvedReferences.push(`Opportunity "${opportunityName}" was not found.`);
    }
  }

  if (type === 'activity') {
    const detail = draft.detail && typeof draft.detail === 'object' && !Array.isArray(draft.detail)
      ? draft.detail as Record<string, unknown>
      : {};
    const detailAccountName = readString(detail, 'account_name', 240) ?? readString(detail, 'company_name', 240);
    const detailContactName = readString(detail, 'contact_name', 180);
    if (!draft.account_id && detailAccountName) {
      const account = await resolveAccount(detailAccountName);
      if (account) {
        draft.account_id = account.id;
        resolutionSummary.push(`Matched account: ${account.name}`);
      }
    }
    if (!draft.contact_id && detailContactName) {
      const contact = await resolveContact(detailContactName, detailAccountName ?? accountName);
      if (contact) {
        draft.contact_id = contact.id;
        resolutionSummary.push(`Matched contact: ${contact.name}`);
      }
    }
    if (!draft.subject_type && !draft.subject_id) {
      if (draft.opportunity_id) {
        draft.subject_type = 'opportunity';
        draft.subject_id = draft.opportunity_id;
      } else if (draft.contact_id) {
        draft.subject_type = 'contact';
        draft.subject_id = draft.contact_id;
      } else if (draft.account_id) {
        draft.subject_type = 'account';
        draft.subject_id = draft.account_id;
      }
    }
  }

  if (type === 'use-case' && !draft.account_id && opportunityName) {
    const result = await oppRepo.searchOpportunities(db, actor.tenant_id, {
      query: opportunityName,
      owner_ids: ownerIds,
      limit: 2,
    });
    if (result.data.length === 1 && result.data[0].account_id) {
      draft.opportunity_id = result.data[0].id;
      draft.account_id = result.data[0].account_id;
      resolutionSummary.push(`Matched opportunity: ${result.data[0].name}`);
    }
  }

  if (type === 'activity') {
    const useCaseName = readString(draft, 'use_case_name', 240);
    if (useCaseName && !draft.use_case_id) {
      const result = await ucRepo.searchUseCases(db, actor.tenant_id, {
        query: useCaseName,
        account_id: typeof draft.account_id === 'string' ? draft.account_id : undefined,
        owner_ids: ownerIds,
        limit: 2,
      });
      if (result.data.length === 1) {
        draft.use_case_id = result.data[0].id;
        resolutionSummary.push(`Matched use case: ${result.data[0].name}`);
        if (!draft.subject_type && !draft.subject_id) {
          draft.subject_type = 'use_case';
          draft.subject_id = result.data[0].id;
        }
      }
    }
  }

  deleteKeys(draft, ['account_name', 'contact_name', 'opportunity_name', 'use_case_name']);
  return { draft, resolution_summary: resolutionSummary, unresolved_references: unresolvedReferences };
}

function quickAddExtractionPrompt(type: QuickAddRecordType): string {
  const common = [
    'Return JSON only. Do not create records. Do not include commentary.',
    'Extract only fields clearly present in the note. Do not invent UUIDs or linked record IDs.',
    'If the user names a related account/contact/opportunity/use case but does not provide a record ID, include the name in account_name, contact_name, opportunity_name, or use_case_name when allowed. CRMy will resolve it safely.',
  ];
  const byType: Record<QuickAddRecordType, string[]> = {
    contact: [
      'Object type: contact.',
      'Allowed fields: name, first_name, last_name, email, phone, title, company_name, lifecycle_stage.',
      'Allowed lifecycle_stage values: lead, prospect, customer, churned.',
    ],
    account: [
      'Object type: account.',
      'Allowed fields: name, company_name, domain, website, industry, aliases, tags, employee_count, annual_revenue, field_sources.',
      'For well-known companies, you may suggest domain, website, industry, aliases, and simple tags from your model knowledge even if the user did not explicitly provide them.',
      'Do not infer employee_count or annual_revenue from model knowledge. Include employee_count or annual_revenue only when the user explicitly provided the value.',
      'When you suggest a field from model knowledge, include field_sources with that field set to "model_knowledge". When the user explicitly provided a field, set it to "user".',
    ],
    opportunity: [
      'Object type: opportunity/deal.',
      'Allowed fields: name, account_name, contact_name, amount, stage, close_date, description.',
      'Allowed stage values: prospecting, qualification, proposal, negotiation, closed_won, closed_lost.',
    ],
    'use-case': [
      'Object type: use case.',
      'Allowed fields: name, account_name, opportunity_name, stage, description, attributed_arr, target_prod_date.',
      'Allowed stage values: discovery, poc, production, scaling, sunset.',
    ],
    activity: [
      'Object type: activity.',
      'Allowed fields: type, subject, body, outcome, direction, occurred_at, account_name, contact_name, opportunity_name, use_case_name, detail.',
      'Allowed type values: call, email, meeting, note, task, demo, proposal, research, handoff, status_update, outreach_email, outreach_call, outreach_linkedin, outreach_other, meeting_held, meeting_scheduled, note_added, research_completed, stage_change.',
      'Use subject as a concise activity title. Use body for notes and next steps.',
      'Put unresolved names, account names, mentioned dates, requested next steps, and attendees in detail.',
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
      const {
        api_key_enc: _enc,
        backup_api_key_enc: _backupEnc,
        ...rest
      } = config;
      const keyMeta = isAdmin(actor)
        ? buildKeyMeta(_enc)
        : { api_key_configured: Boolean(_enc), api_key_hint: null };
      const backupKeyMeta = isAdmin(actor)
        ? buildKeyMeta(_backupEnc)
        : { api_key_configured: Boolean(_backupEnc), api_key_hint: null };
      res.json({
        data: {
          ...rest,
          ...keyMeta,
          backup_api_key_configured: backupKeyMeta.api_key_configured,
          backup_api_key_hint: backupKeyMeta.api_key_hint,
        },
      });
    } catch (err) { handleError(res, err); }
  });

  /** PUT /agent/config — create or update agent config (admin only). */
  router.put('/config', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireAdmin(actor);

      const body = req.body as Record<string, unknown>;
      const existingConfig = await agentRepo.getConfig(db, actor.tenant_id);
      const update: Record<string, unknown> = {};

      // Pick allowed fields
      const boolFields = ['enabled', 'can_write_objects', 'can_log_activities', 'can_create_assignments', 'auto_extract_context', 'auto_promote_signals', 'backup_enabled'];
      const strFields = ['provider', 'base_url', 'model', 'system_prompt', 'backup_provider', 'backup_base_url', 'backup_model'];
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
      if (typeof body.llm_timeout_ms === 'number') {
        update.llm_timeout_ms = Math.min(300_000, Math.max(5_000, Math.round(body.llm_timeout_ms)));
      }
      if (typeof body.signal_auto_promote_threshold === 'number') {
        const threshold = Math.min(0.98, Math.max(0.7, body.signal_auto_promote_threshold));
        update.signal_auto_promote_threshold = Number(threshold.toFixed(2));
      }

      // Encrypt API key if a new one was provided (non-empty string)
      if (typeof body.api_key === 'string' && body.api_key.trim()) {
        update.api_key_enc = encrypt(body.api_key.trim());
      } else if (typeof body.provider === 'string' && existingConfig?.provider && existingConfig.provider !== body.provider) {
        update.api_key_enc = null;
      }
      if (typeof body.backup_api_key === 'string' && body.backup_api_key.trim()) {
        update.backup_api_key_enc = encrypt(body.backup_api_key.trim());
      } else if (
        typeof body.backup_provider === 'string'
        && existingConfig?.backup_provider
        && existingConfig.backup_provider !== body.backup_provider
      ) {
        update.backup_api_key_enc = null;
      }

      const config = await agentRepo.upsertConfig(db, actor.tenant_id, update);
      const {
        api_key_enc: _enc2,
        backup_api_key_enc: _backupEnc2,
        ...rest2
      } = config;
      const backupKeyMeta = buildKeyMeta(_backupEnc2);
      res.json({
        data: {
          ...rest2,
          ...buildKeyMeta(_enc2),
          backup_api_key_configured: backupKeyMeta.api_key_configured,
          backup_api_key_hint: backupKeyMeta.api_key_hint,
        },
      });
    } catch (err) { handleError(res, err); }
  });

  /** POST /agent/config/test — test LLM connection.
   *
   * Accepts optional body overrides so the UI can test *current form values*
   * before the user has saved. Non-admin users can only probe the saved
   * workspace config, which lets them use the shared agent without seeing or
   * overriding provider secrets.
   */
  router.post('/config/test', async (req: Request, res: Response) => {
    const actor = getActor(req);
    try {
      const config = await agentRepo.getConfig(db, actor.tenant_id);

      // Merge form values (not-yet-saved) over stored config
      const body = req.body as {
        provider?: string;
        base_url?: string;
        api_key?: string;
        model?: string;
        target?: 'primary' | 'backup';
      };
      const bodyKeys = Object.keys(body ?? {});
      const testingOverrides = bodyKeys.some(key => ['provider', 'base_url', 'api_key', 'model'].includes(key));
      if (!isAdmin(actor) && testingOverrides) {
        res.status(403).json({
          ok: false,
          status: 'forbidden',
          error: 'Only admins can test unsaved model settings. You can still use the saved Workspace Agent configuration.',
        });
        return;
      }

      const target = body.target === 'backup' ? 'backup' : 'primary';
      const savedProvider = target === 'backup' ? config?.backup_provider : config?.provider;
      const savedBaseUrl = target === 'backup' ? config?.backup_base_url : config?.base_url;
      const savedModel = target === 'backup' ? config?.backup_model : config?.model;
      const savedApiKeyEnc = target === 'backup' ? config?.backup_api_key_enc : config?.api_key_enc;

      const provider = isAdmin(actor) ? body.provider ?? savedProvider : savedProvider;
      const rawUrl   = isAdmin(actor) ? body.base_url  ?? savedBaseUrl ?? '' : savedBaseUrl ?? '';
      const model    = isAdmin(actor) ? body.model     ?? savedModel    ?? '' : savedModel ?? '';
      const baseUrl  = rawUrl.replace(/\/+$/, '');

      // If caller sent an api_key, use it directly (trimmed). Otherwise decrypt the stored one.
      let apiKey = '';
      if (isAdmin(actor) && typeof body.api_key === 'string' && body.api_key.trim()) {
        apiKey = body.api_key.trim();
      } else if (
        savedApiKeyEnc
        && !(isAdmin(actor) && typeof body.provider === 'string' && body.provider !== savedProvider)
      ) {
        apiKey = decrypt(savedApiKeyEnc).trim();
      }

      if (!config && !isAdmin(actor)) {
        res.json({ ok: false, status: 'not_configured', error: 'Workspace Agent is not configured. Ask an admin to enable it in Model Settings.' });
        return;
      }
      if (config && !config.enabled && !isAdmin(actor)) {
        res.json({ ok: false, status: 'not_configured', error: 'Workspace Agent is disabled. Ask an admin to enable it in Model Settings.' });
        return;
      }
      if (!provider || !baseUrl || !model) {
        res.json({ ok: false, status: 'not_configured', error: 'Provider, base URL, and model are required' });
        return;
      }

      const cacheKey = `${actor.tenant_id}:${provider}:${baseUrl}:${model}`;
      if (!testingOverrides) {
        const cached = readinessCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          res.json(cached.result);
          return;
        }
      }

      const finish = (result: ReadinessResult) => {
        if (!testingOverrides) readinessCache.set(cacheKey, { expiresAt: Date.now() + AGENT_READINESS_TTL_MS, result });
        res.json(result);
      };

      // Verify connectivity first, then try to verify tool calls. Some gateways
      // support runtime tool calls but do not return the exact forced test shape,
      // so tool-call verification is a warning rather than a hard connectivity
      // failure.
      let readinessResult: ReadinessResult;
      if (provider === 'anthropic') {
        readinessResult = await verifyAgentToolCalling({ provider, baseUrl, model, apiKey });
      } else {
        const headers = buildOpenAICompatibleHeaders(baseUrl, apiKey, provider);
        readinessResult = await verifyAgentToolCalling({ provider, baseUrl, model, apiKey, headers });
      }

      if (!readinessResult.ok) {
        finish({ ...readinessResult, error: readinessError(actor, readinessResult.error ?? 'The selected model could not be reached.') });
        return;
      }

      finish(readinessResult);
    } catch (err) {
      const message = readinessError(actor, safeErrorMessage(err, 'Connection failed. Check the model provider URL, model name, and API key.'));
      res.json({ ok: false, status: 'offline', error: message });
    }
  });

  /** POST /agent/extract/record — model-backed draft extraction for quick-add records. */
  router.post('/extract/record', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const parsed = recordDraftPreviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid record draft request',
          details: parsed.error.flatten(),
        });
        return;
      }
      res.json(await previewRecordDraft(db, actor, parsed.data));
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
      const resolved = await resolveQuickAddReferences(db, actor, 'activity', draft);
      const linkedRecords = await linkedRecordsForDraft(db, actor, resolved.draft);
      const missingFields = await missingQuickAddFields(db, actor, 'activity', resolved.draft);
      res.json({
        data: resolved.draft,
        draft: resolved.draft,
        source: 'agent',
        field_rows: fieldRowsForDraft('activity', resolved.draft, missingFields, text),
        required_fields: QUICK_ADD_REQUIRED_FIELDS.activity,
        missing_fields: missingFields,
        linked_records: linkedRecords,
        duplicate_candidates: [],
        resolution_summary: resolved.resolution_summary,
        unresolved_references: resolved.unresolved_references,
        work_log: [
          'Read activity requirements',
          linkedRecords.length ? `Matched ${linkedRecords.length} linked record${linkedRecords.length === 1 ? '' : 's'}` : 'No linked records matched yet',
          'Ready for user review',
        ],
        can_create: missingFields.length === 0,
      });
    } catch (err) { handleError(res, err); }
  });

  // ── Sessions ────────────────────────────────────────────────────────────

  /** GET /agent/sessions — list current user's sessions. */
  router.get('/sessions', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const sessions = await agentRepo.listSessions(db, actor.tenant_id, actor.actor_id);
      const visible = [];
      for (const session of sessions) {
        if (await canAccessAgentContext(db, actor, session.context_type, session.context_id)) {
          visible.push(session);
        }
      }
      res.json({ data: visible });
    } catch (err) { handleError(res, err); }
  });

  /** POST /agent/sessions — create a new session. */
  router.post('/sessions', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const body = req.body as { context_type?: string; context_id?: string; context_name?: string; reuse_context?: boolean };
      const normalizedContextType = normalizeAgentContextType(body.context_type);
      if (!(await canAccessAgentContext(db, actor, normalizedContextType, body.context_id))) {
        res.status(404).json({ error: 'Record not found' });
        return;
      }
      if (body.reuse_context && normalizedContextType && body.context_id) {
        const existing = await agentRepo.getLatestSessionForContext(
          db,
          actor.tenant_id,
          actor.actor_id,
          normalizedContextType,
          body.context_id,
        );
        if (existing) {
          if (!(await canAccessAgentContext(db, actor, existing.context_type, existing.context_id))) {
            res.status(404).json({ error: 'Session not found' });
            return;
          }
          res.json({ data: existing });
          return;
        }
      }
      const session = await agentRepo.createSession(db, actor.tenant_id, actor.actor_id, {
        ...body,
        context_type: normalizedContextType ?? undefined,
      });
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
      if (!(await canAccessAgentContext(db, actor, session.context_type, session.context_id))) {
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
      if (!(await canAccessAgentContext(db, actor, session.context_type, session.context_id))) {
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
      const session = await agentRepo.getSession(db, actor.tenant_id, String(req.params.id));
      if (!session || session.user_id !== actor.actor_id) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      if (!(await canAccessAgentContext(db, actor, session.context_type, session.context_id))) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      await agentRepo.deleteSession(db, actor.tenant_id, session.id);
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

  /** POST /agent/sessions/:id/attachments — attach file/text to a session. */
  router.post('/sessions/:id/attachments', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const session = await loadOwnedSession(db, actor, String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const { filename, data, mode, source_label } = req.body as {
        filename?: string;
        data?: string;
        mode?: 'active_context' | 'raw_context';
        source_label?: string;
      };
      if (!filename || !data) {
        res.status(400).json({ error: 'filename and data are required' });
        return;
      }
      if (mode !== 'active_context' && mode !== 'raw_context') {
        res.status(400).json({ error: 'mode must be active_context or raw_context' });
        return;
      }

      const buffer = dataUrlToBuffer(data);
      const { text, truncated, format } = await extractTextFromBuffer(buffer, filename);
      if (!text.trim()) {
        const attachment = await agentRepo.createAttachment(db, actor.tenant_id, actor.actor_id, session.id, {
          filename,
          format,
          mode,
          status: 'failed',
          text_excerpt: '',
          truncated,
          error_message: 'No readable text was found in this file.',
        });
        res.status(400).json({ error: 'No readable text was found in this file.', attachment: redactAttachment(attachment) });
        return;
      }

      if (mode === 'raw_context') {
        const attachment = await agentRepo.createAttachment(db, actor.tenant_id, actor.actor_id, session.id, {
          filename,
          format,
          mode,
          status: 'processing',
          text_excerpt: text.slice(0, 1000),
          truncated,
          metadata: { source_label: source_label ?? filename },
        });
        try {
          const handler = toolHandler(db, 'context_ingest_auto');
          const result = await handler({
            document: text,
            source_label: source_label ?? filename,
            confidence_threshold: 0.6,
          }, actor) as Record<string, unknown>;
          const rawSource = result.raw_context_source as { id?: string } | undefined;
          const updated = await agentRepo.updateAttachment(db, actor.tenant_id, attachment.id, {
            status: 'processed',
            raw_context_result: result,
            raw_context_source_id: rawSource?.id ?? null,
          });
          res.status(201).json({ data: redactAttachment(updated ?? attachment), result });
          return;
        } catch (err) {
          const updated = await agentRepo.updateAttachment(db, actor.tenant_id, attachment.id, {
            status: 'failed',
            error_message: safeErrorMessage(err, 'Raw Context processing failed.'),
          });
          res.status(400).json({
            error: safeErrorMessage(err, 'Raw Context processing failed.'),
            attachment: updated ? redactAttachment(updated) : redactAttachment(attachment),
          });
          return;
        }
      }

      const attachment = await agentRepo.createAttachment(db, actor.tenant_id, actor.actor_id, session.id, {
        filename,
        format,
        mode,
        status: 'ready',
        extracted_text: text,
        text_excerpt: text.slice(0, 1000),
        truncated,
      });
      res.status(201).json({ data: redactAttachment(attachment) });
    } catch (err) { handleError(res, err); }
  });

  router.delete('/sessions/:id/attachments/:attachment_id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const session = await loadOwnedSession(db, actor, String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const count = await agentRepo.deleteAttachment(db, actor.tenant_id, session.id, String(req.params.attachment_id));
      if (count === 0) {
        res.status(404).json({ error: 'Attachment not found or already used' });
        return;
      }
      res.status(204).end();
    } catch (err) { handleError(res, err); }
  });

  /** POST /agent/sessions/:id/turns — enqueue and start a durable agent turn. */
  router.post('/sessions/:id/turns', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const session = await loadOwnedSession(db, actor, String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const { message, context_detail } = req.body as { message?: string; context_detail?: string };
      if (!message?.trim()) {
        res.status(400).json({ error: 'message is required' });
        return;
      }
      const config = await agentRepo.getConfig(db, actor.tenant_id);
      if (!config?.enabled) {
        res.status(400).json({ error: 'Agent is not enabled for this workspace' });
        return;
      }
      const active = await agentRepo.getActiveTurnForSession(db, actor.tenant_id, session.id);
      if (active) {
        res.status(409).json({ error: 'An agent turn is already running for this session', active_turn: active });
        return;
      }
      const turn = await agentRepo.createTurn(db, actor.tenant_id, actor.actor_id, session.id, {
        input_message: message.trim(),
        context_detail: context_detail ?? null,
      });
      startAgentTurnRunner(db, turn.id);
      res.status(202).json({ data: turn });
    } catch (err) { handleError(res, err); }
  });

  router.get('/sessions/:id/turns/:turn_id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const turn = await loadOwnedTurn(db, actor, String(req.params.id), String(req.params.turn_id));
      if (!turn) {
        res.status(404).json({ error: 'Agent turn not found' });
        return;
      }
      const events = await agentRepo.listTurnEventsAfter(db, actor.tenant_id, turn.id, 0);
      res.json({ data: turnWithEvents(turn, events) });
    } catch (err) { handleError(res, err); }
  });

  router.get('/sessions/:id/turns/:turn_id/stream', async (req: Request, res: Response) => {
    const actor = getActor(req);
    const turn = await loadOwnedTurn(db, actor, String(req.params.id), String(req.params.turn_id));
    if (!turn) {
      res.status(404).json({ error: 'Agent turn not found' });
      return;
    }
    const after = typeof req.query.after === 'string' ? Number(req.query.after) || 0 : 0;
    await streamTurnEvents(db, actor, res, String(req.params.id), String(req.params.turn_id), after);
  });

  router.post('/sessions/:id/turns/:turn_id/cancel', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const turn = await loadOwnedTurn(db, actor, String(req.params.id), String(req.params.turn_id));
      if (!turn) {
        res.status(404).json({ error: 'Agent turn not found' });
        return;
      }
      const cancelled = await cancelRunningAgentTurn(db, actor.tenant_id, turn.id);
      if (!cancelled) {
        res.status(409).json({ error: 'Agent turn is no longer running' });
        return;
      }
      res.json({ data: { id: turn.id, status: 'cancelled' } });
    } catch (err) { handleError(res, err); }
  });

  /** Compatibility wrapper for older clients. */
  router.post('/sessions/:id/chat', async (req: Request, res: Response) => {
    const actor = getActor(req);
    try {
      const session = await loadOwnedSession(db, actor, String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const { message, auto_greet, context_detail } = req.body as { message?: string; auto_greet?: boolean; context_detail?: string };
      const effectiveMessage = auto_greet
        ? '[SYSTEM_INIT] The user opened this conversation from a CRM record. Acknowledge that record context is attached.'
        : message;
      if (!effectiveMessage?.trim()) {
        res.status(400).json({ error: 'message is required' });
        return;
      }
      const turn = await agentRepo.createTurn(db, actor.tenant_id, actor.actor_id, session.id, {
        input_message: effectiveMessage.trim(),
        context_detail: context_detail ?? null,
      });
      startAgentTurnRunner(db, turn.id);
      await streamTurnEvents(db, actor, res, session.id, turn.id);
    } catch (err) {
      if (!res.headersSent) handleError(res, err);
      else {
        writeSse(res, { type: 'error', message: safeErrorMessage(err, 'Agent request failed. Check Model Settings and try again.') });
        setImmediate(() => res.end());
      }
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
    if (!await canAccessAgentContext(db, actor, session.context_type, session.context_id)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const activity = await activityRepo.getSessionActivity(db, actor.tenant_id, session.id);
    res.json({ activity });
  });

  return router;
}
