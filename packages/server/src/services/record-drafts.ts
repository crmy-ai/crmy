// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import type { ActorContext } from '@crmy/shared';
import { permissionDenied } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as agentRepo from '../db/repos/agent.js';
import * as accountRepo from '../db/repos/accounts.js';
import * as contactRepo from '../db/repos/contacts.js';
import * as oppRepo from '../db/repos/opportunities.js';
import * as ucRepo from '../db/repos/use-cases.js';
import { listCustomFields } from '../db/repos/custom-fields.js';
import { checkAccountDuplicate, checkContactDuplicate, checkOpportunityDuplicate, type DuplicateCheckResult } from './deduplication.js';
import { assertSubjectAccess, resolveOwnerFilter } from './access-control.js';
import { entityResolve } from './entity-resolve.js';
import { actorHasScope } from '../auth/scopes.js';
import { callLLM } from '../agent/providers/llm.js';

export type RecordDraftType = 'contact' | 'account' | 'opportunity' | 'use-case' | 'activity' | 'assignment';
type DraftSubjectType = 'account' | 'contact' | 'opportunity' | 'use_case' | 'use-case';

type LinkedRecord = {
  type: 'account' | 'contact' | 'opportunity' | 'use_case';
  id: string;
  name: string;
  detail?: string | null;
};

type ParentContext = {
  parent_subject_type?: string;
  parent_subject_id?: string;
  parent_subject_name?: string;
  defaults?: Record<string, unknown>;
};

type FieldRow = {
  field: string;
  label: string;
  value: unknown;
  current_value?: unknown;
  draft_value?: unknown;
  changed?: boolean;
  source: 'user' | 'model_knowledge' | 'matched_record' | 'provider' | 'required';
  source_label: string;
  status: 'ready' | 'missing' | 'linked' | 'optional';
  required: boolean;
  confidence_label?: string;
  requires_confirmation?: boolean;
};

const recordType = z.enum(['contact', 'account', 'opportunity', 'use-case', 'use_case', 'activity', 'assignment'])
  .transform(value => value === 'use_case' ? 'use-case' : value);

const subjectType = z.enum(['account', 'contact', 'opportunity', 'use-case', 'use_case']).optional()
  .transform(value => value === 'use_case' ? 'use-case' : value);

export const recordDraftPreviewSchema = z.object({
  text: z.string().min(1),
  mode: z.enum(['create', 'edit']).optional().default('create'),
  object_type: recordType,
  record_type: recordType.optional(),
  record_id: z.string().uuid().optional(),
  parent_subject_type: subjectType,
  parent_subject_id: z.string().uuid().optional(),
  parent_subject_name: z.string().optional(),
  defaults: z.record(z.unknown()).optional(),
});

export type RecordDraftPreviewInput = z.infer<typeof recordDraftPreviewSchema>;

const REQUIRED_FIELDS: Record<RecordDraftType, string[]> = {
  account: ['name'],
  contact: ['first_name'],
  opportunity: ['name'],
  'use-case': ['name', 'account_id'],
  activity: ['type', 'subject'],
  assignment: ['title', 'assignment_type', 'assigned_to'],
};

const FIELD_LABELS: Record<string, string> = {
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

const BLOCKED_EDIT_FIELDS = new Set([
  'id',
  'tenant_id',
  'owner_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'account_id',
  'contact_id',
  'opportunity_id',
  'use_case_id',
  'subject_type',
  'subject_id',
]);

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeSubjectType(value?: string | null): DraftSubjectType | undefined {
  if (!value) return undefined;
  if (value === 'use_case') return 'use-case';
  if (['account', 'contact', 'opportunity', 'use-case'].includes(value)) return value as DraftSubjectType;
  return undefined;
}

function objectTypeForCustomFields(type: RecordDraftType): string {
  return type === 'use-case' ? 'use_case' : type;
}

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

function sanitizeRecordDraft(type: RecordDraftType, input: Record<string, unknown>): Record<string, unknown> {
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
    for (const key of ['industry', 'domain', 'website'] as const) {
      const value = readString(input, key, key === 'website' ? 300 : 200);
      if (!value) continue;
      if (key === 'domain') out.domain = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      else if (key === 'website') out.website = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      else out.industry = value;
    }
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

async function assertRecordDraftWriteAccess(actor: ActorContext, objectType: RecordDraftType): Promise<void> {
  const requiredScope = objectType === 'contact'
    ? 'contacts:write'
    : objectType === 'opportunity'
      ? 'opportunities:write'
      : objectType === 'activity'
        ? 'activities:write'
        : objectType === 'assignment'
          ? 'assignments:write'
          : 'accounts:write';
  if (!actorHasScope(actor, requiredScope)) throw permissionDenied(`Missing scope: ${requiredScope}`);
}

function assertAgentDraftCapability(
  config: { can_write_objects?: boolean; can_log_activities?: boolean; can_create_assignments?: boolean },
  objectType: RecordDraftType,
): void {
  if (objectType === 'activity') {
    if (config.can_log_activities === false) {
      throw permissionDenied('Workspace Agent activity logging is disabled. Use the form to log this activity.');
    }
    return;
  }
  if (objectType === 'assignment') {
    if (config.can_create_assignments === false) {
      throw permissionDenied('Workspace Agent handoff creation is disabled. Use the form to create this assignment.');
    }
    return;
  }
  if (config.can_write_objects === false) {
    throw permissionDenied('Workspace Agent record writing is disabled. Use the form to create or edit this record.');
  }
}

async function getParentRecord(db: DbPool, actor: ActorContext, parentType?: string, parentId?: string): Promise<LinkedRecord | null> {
  const normalized = normalizeSubjectType(parentType);
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

async function getEditableRecord(db: DbPool, actor: ActorContext, objectType: RecordDraftType, recordId?: string) {
  if (!recordId || objectType === 'assignment' || objectType === 'activity') return null;
  const accessType = objectType === 'use-case' ? 'use_case' : objectType;
  await assertSubjectAccess(db, actor, accessType, recordId);
  if (objectType === 'account') return accountRepo.getAccount(db, actor.tenant_id, recordId) as Promise<Record<string, unknown> | null>;
  if (objectType === 'contact') return contactRepo.getContact(db, actor.tenant_id, recordId) as Promise<Record<string, unknown> | null>;
  if (objectType === 'opportunity') return oppRepo.getOpportunity(db, actor.tenant_id, recordId) as Promise<Record<string, unknown> | null>;
  return ucRepo.getUseCase(db, actor.tenant_id, recordId) as Promise<Record<string, unknown> | null>;
}

function compactEditableRecord(record: Record<string, unknown> | null) {
  if (!record) return null;
  const hidden = new Set(['tenant_id', 'embedding', 'metadata']);
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key, value]) => !hidden.has(key) && value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, typeof value === 'string' && value.length > 1000 ? value.slice(0, 1000) : value]),
  );
}

async function accountScopeForParent(db: DbPool, actor: ActorContext, parentType?: string, parentId?: string): Promise<string | undefined> {
  const normalized = normalizeSubjectType(parentType);
  if (!normalized || !parentId) return undefined;
  if (normalized === 'account') return parentId;
  if (normalized === 'contact') return (await contactRepo.getContact(db, actor.tenant_id, parentId))?.account_id ?? undefined;
  if (normalized === 'opportunity') return (await oppRepo.getOpportunity(db, actor.tenant_id, parentId))?.account_id ?? undefined;
  return (await ucRepo.getUseCase(db, actor.tenant_id, parentId))?.account_id ?? undefined;
}

function extractionPrompt(type: RecordDraftType): string {
  const common = [
    'Return JSON only. Do not create records. Do not include commentary.',
    'Extract fields for exactly one record. Do not invent UUIDs or linked record IDs.',
    'If a related account/contact/opportunity/use case is named but no record ID is known, use account_name, contact_name, opportunity_name, or use_case_name when allowed. CRMy will resolve safely.',
  ];
  const byType: Record<RecordDraftType, string[]> = {
    contact: [
      'Object type: contact.',
      'Allowed fields: name, first_name, last_name, email, phone, title, company_name, lifecycle_stage.',
      'Allowed lifecycle_stage values: lead, prospect, customer, churned.',
    ],
    account: [
      'Object type: account.',
      'Allowed fields: name, company_name, domain, website, industry, aliases, tags, employee_count, annual_revenue, field_sources.',
      'For well-known companies, you may suggest domain, website, industry, aliases, and simple tags from model knowledge.',
      'Do not infer employee_count or annual_revenue from model knowledge. Include those only when the user explicitly provided them.',
      'When suggesting a field from model knowledge, include field_sources with that field set to "model_knowledge". When the user explicitly provided a field, set it to "user".',
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
    ],
    assignment: [
      'Object type: assignment/task.',
      'Allowed fields: title, description, assignment_type, priority, due_at, context.',
      'Allowed priority values: low, normal, high, urgent.',
    ],
  };
  return [...common, ...byType[type]].join('\n');
}

async function buildCreationPacket(db: DbPool, actor: ActorContext, objectType: RecordDraftType, context: ParentContext) {
  const ownerFilter = await resolveOwnerFilter(db, actor);
  const ownerIds = 'owner_ids' in ownerFilter ? ownerFilter.owner_ids : undefined;
  const customFields = await listCustomFields(db, actor.tenant_id, objectTypeForCustomFields(objectType));
  const parent = await getParentRecord(db, actor, context.parent_subject_type, context.parent_subject_id);
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
    required_fields: REQUIRED_FIELDS[objectType],
    allowed_fields: extractionPrompt(objectType),
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

function applyDefaultsAndScope(draft: Record<string, unknown>, objectType: RecordDraftType, context: ParentContext, parent: LinkedRecord | null) {
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

async function resolveReferences(db: DbPool, actor: ActorContext, type: RecordDraftType, draft: Record<string, unknown>, context: ParentContext) {
  const resolutionSummary: string[] = [];
  const unresolvedReferences: string[] = [];
  const ownerFilter = await resolveOwnerFilter(db, actor);
  const ownerIds = 'owner_ids' in ownerFilter ? ownerFilter.owner_ids : undefined;
  const parent = await getParentRecord(db, actor, context.parent_subject_type, context.parent_subject_id);
  applyDefaultsAndScope(draft, type, context, parent);
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

  if (type === 'use-case' && !draft.account_id && opportunityName) {
    const result = await oppRepo.searchOpportunities(db, actor.tenant_id, { query: opportunityName, owner_ids: ownerIds, limit: 2 });
    if (result.data.length === 1 && result.data[0].account_id) {
      draft.opportunity_id = result.data[0].id;
      draft.account_id = result.data[0].account_id;
      resolutionSummary.push(`Matched opportunity: ${result.data[0].name}`);
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
      }
    }
    if (!draft.subject_type && !draft.subject_id) {
      if (draft.use_case_id) {
        draft.subject_type = 'use_case';
        draft.subject_id = draft.use_case_id;
      } else if (draft.opportunity_id) {
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

  for (const key of ['account_name', 'contact_name', 'opportunity_name', 'use_case_name']) delete draft[key];
  return { draft, resolution_summary: resolutionSummary, unresolved_references: unresolvedReferences };
}

async function linkedRecordsForDraft(db: DbPool, actor: ActorContext, draft: Record<string, unknown>): Promise<LinkedRecord[]> {
  const linked: LinkedRecord[] = [];
  const add = (record: LinkedRecord | null) => {
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

async function duplicateCandidates(db: DbPool, actor: ActorContext, objectType: RecordDraftType, draft: Record<string, unknown>) {
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
      // Do not leak duplicates outside the actor's visible scope.
    }
  }
  return visible;
}

async function missingFields(db: DbPool, actor: ActorContext, objectType: RecordDraftType, draft: Record<string, unknown>) {
  const missing = REQUIRED_FIELDS[objectType].filter(field => !isPresent(draft[field]));
  const customFields = await listCustomFields(db, actor.tenant_id, objectTypeForCustomFields(objectType));
  const customValues = draft.custom_fields && typeof draft.custom_fields === 'object' && !Array.isArray(draft.custom_fields)
    ? draft.custom_fields as Record<string, unknown>
    : {};
  for (const field of customFields) {
    if (field.is_required && !isPresent(customValues[field.field_key])) missing.push(`custom_fields.${field.field_key}`);
  }
  return missing;
}

function normalizeFieldSource(value: unknown): FieldRow['source'] | undefined {
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

function fieldSourceForDraft(objectType: RecordDraftType, field: string, value: unknown, sourceText: string, rawInput: Record<string, unknown>): FieldRow['source'] {
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

function sourceLabel(source: FieldRow['source']): string {
  if (source === 'model_knowledge') return 'Suggested by model';
  if (source === 'matched_record') return 'Matched existing record';
  if (source === 'provider') return 'Suggested by provider';
  if (source === 'required') return 'Needs confirmation';
  return 'Provided by user';
}

function confidenceLabel(source: FieldRow['source']): string | undefined {
  if (source === 'model_knowledge') return 'Unverified';
  if (source === 'provider') return 'Provider supplied';
  return undefined;
}

function fieldRowsForDraft(objectType: RecordDraftType, draft: Record<string, unknown>, missing: string[], sourceText: string, rawInput: Record<string, unknown>): FieldRow[] {
  const rows: FieldRow[] = [];
  const required = new Set([...REQUIRED_FIELDS[objectType], ...missing]);
  const hidden = new Set(['allow_duplicates', 'if_exists', 'idempotency_key']);
  for (const [field, value] of Object.entries(draft)) {
    if (hidden.has(field) || value === undefined || value === '') continue;
    const source = fieldSourceForDraft(objectType, field, value, sourceText, rawInput);
    rows.push({
      field,
      label: labelFor(field),
      value,
      source,
      source_label: sourceLabel(source),
      status: source === 'matched_record' ? 'linked' : 'ready',
      required: required.has(field),
      confidence_label: confidenceLabel(source),
      requires_confirmation: source === 'model_knowledge' || source === 'provider',
    });
  }
  for (const field of missing) {
    if (rows.some(row => row.field === field)) continue;
    rows.push({
      field,
      label: field.startsWith('custom_fields.') ? labelFor(field.replace('custom_fields.', '')) : labelFor(field),
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

function valuesEqual(a: unknown, b: unknown) {
  if (a == null && b == null) return true;
  if (Array.isArray(a) || Array.isArray(b) || (typeof a === 'object' && a != null) || (typeof b === 'object' && b != null)) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return String(a ?? '') === String(b ?? '');
}

function fieldRowsForEdit(
  objectType: RecordDraftType,
  currentRecord: Record<string, unknown>,
  patch: Record<string, unknown>,
  sourceText: string,
  rawInput: Record<string, unknown>,
): FieldRow[] {
  return Object.entries(patch)
    .filter(([field, value]) => value !== undefined && value !== '' && field !== 'allow_duplicates')
    .map(([field, value]) => {
      const source = fieldSourceForDraft(objectType, field, value, sourceText, rawInput);
      const changed = !valuesEqual(currentRecord[field], value);
      return {
        field,
        label: labelFor(field),
        value,
        current_value: currentRecord[field] ?? null,
        draft_value: value,
        changed,
        source,
        source_label: sourceLabel(source),
        status: BLOCKED_EDIT_FIELDS.has(field) ? 'optional' : source === 'matched_record' ? 'linked' : changed ? 'ready' : 'optional',
        required: false,
        confidence_label: confidenceLabel(source),
        requires_confirmation: source === 'model_knowledge' || source === 'provider' || BLOCKED_EDIT_FIELDS.has(field),
      } satisfies FieldRow;
    });
}

function editPolicyBlockers(rows: FieldRow[]) {
  const blockers: string[] = [];
  for (const row of rows) {
    if (BLOCKED_EDIT_FIELDS.has(row.field)) {
      blockers.push(`${row.label} changes need form review or a governed workflow.`);
    }
  }
  return blockers;
}

function enrichmentSuggestionsFromRows(rows: FieldRow[]) {
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

function removeUnprovidedVolatileAccountFields(draft: Record<string, unknown>, sourceText: string, rawInput: Record<string, unknown>) {
  const fieldSources = rawInput.field_sources && typeof rawInput.field_sources === 'object' && !Array.isArray(rawInput.field_sources)
    ? rawInput.field_sources as Record<string, unknown>
    : {};
  for (const field of ['employee_count', 'annual_revenue']) {
    if (draft[field] == null) continue;
    const source = normalizeFieldSource(fieldSources[field]);
    if (source !== 'user' && !valueLooksUserProvided(draft[field], sourceText)) delete draft[field];
  }
}

function removeImplicitEditDefaults(draft: Record<string, unknown>, objectType: RecordDraftType, rawInput: Record<string, unknown>) {
  if ((objectType === 'opportunity' || objectType === 'use-case') && rawInput.stage == null) delete draft.stage;
  if (objectType === 'activity') {
    if (rawInput.type == null) delete draft.type;
    if (rawInput.subject == null) delete draft.subject;
  }
}

export async function previewRecordDraft(db: DbPool, actor: ActorContext, input: RecordDraftPreviewInput) {
  const objectType = input.object_type as RecordDraftType;
  const mode = input.mode ?? 'create';
  await assertRecordDraftWriteAccess(actor, objectType);
  if (mode === 'edit' && !input.record_id) throw permissionDenied('record_id is required for record edit drafting');

  const text = input.text.trim();
  const config = await agentRepo.getConfig(db, actor.tenant_id);
  if (!config?.enabled || !config.model || !config.base_url) {
    throw permissionDenied('Workspace Agent is not configured for record drafting');
  }
  assertAgentDraftCapability(config, objectType);

  const context: ParentContext = {
    parent_subject_type: input.parent_subject_type,
    parent_subject_id: input.parent_subject_id,
    parent_subject_name: input.parent_subject_name,
    defaults: input.defaults,
  };
  const packet = await buildCreationPacket(db, actor, objectType, context);
  const currentRecord = mode === 'edit'
    ? compactEditableRecord(await getEditableRecord(db, actor, objectType, input.record_id))
    : null;
  if (mode === 'edit' && !currentRecord) throw permissionDenied('Record is not available for edit drafting');
  const today = new Date().toISOString().slice(0, 10);
  const responseText = await callLLM(db, actor.tenant_id, {
    maxTokens: Math.min(config.max_tokens_per_turn ?? 1200, 1200),
    system: [
      mode === 'edit'
        ? 'You are the CRMy lightweight record update model.'
        : 'You are the CRMy lightweight record creation model.',
      mode === 'edit'
        ? 'Your job is to draft a minimal patch for one existing revenue record from a user note so CRMy can validate it before writing.'
        : 'Your job is to draft one revenue record from a user note so CRMy can validate it before writing.',
      'Use the creation packet to understand required fields, allowed values, custom fields, parent scope, and related visible records.',
      mode === 'edit'
        ? 'Return only fields the user clearly wants to change. Do not repeat unchanged fields.'
        : 'Prefer existing linked records from the packet. Do not invent UUIDs. Use *_name fields when a linked record is mentioned but not confidently identified.',
      extractionPrompt(objectType),
      `Today is ${today}. Resolve explicit relative dates like today, tomorrow, or yesterday when present.`,
    ].join('\n'),
    user: `${mode === 'edit' ? 'Update' : 'Creation'} packet:\n${JSON.stringify({
      ...packet,
      operation: mode,
      current_record: currentRecord,
    })}\n\nUser note:\n${text}\n\nReturn only the ${mode === 'edit' ? 'patch' : 'draft'} JSON object.`,
  });

  const parsedDraft = parseJsonObject(responseText);
  const draft = sanitizeRecordDraft(objectType, parsedDraft);
  if (mode === 'edit') removeImplicitEditDefaults(draft, objectType, parsedDraft);
  if (objectType === 'account') removeUnprovidedVolatileAccountFields(draft, text, parsedDraft);

  if (mode === 'edit' && currentRecord) {
    const resolved = await resolveReferences(db, actor, objectType, draft, {});
    const rows = fieldRowsForEdit(objectType, currentRecord, resolved.draft, text, parsedDraft);
    const changedRows = rows.filter(row => row.changed);
    const blockers = editPolicyBlockers(changedRows);
    const safePatch = Object.fromEntries(
      Object.entries(resolved.draft)
        .filter(([field]) => !BLOCKED_EDIT_FIELDS.has(field))
        .filter(([field, value]) => !valuesEqual(currentRecord[field], value)),
    );
    return {
      data: safePatch,
      draft: safePatch,
      patch: safePatch,
      operation: 'edit',
      source: 'agent',
      current_record: currentRecord,
      field_rows: rows,
      required_fields: [],
      missing_fields: [],
      linked_records: await linkedRecordsForDraft(db, actor, { ...currentRecord, ...safePatch }),
      duplicate_candidates: [],
      enrichment_suggestions: objectType === 'account' ? enrichmentSuggestionsFromRows(rows) : [],
      resolution_summary: resolved.resolution_summary,
      unresolved_references: resolved.unresolved_references,
      policy_blockers: blockers,
      can_write: Object.keys(safePatch).length > 0 && blockers.length === 0,
      can_create: false,
      work_log: [
        'Read current record',
        'Drafted changed fields only',
        blockers.length ? `Found ${blockers.length} guarded change${blockers.length === 1 ? '' : 's'}` : 'No guarded changes found',
      ],
    };
  }

  const resolved = await resolveReferences(db, actor, objectType, draft, context);
  const linkedRecords = await linkedRecordsForDraft(db, actor, resolved.draft);
  const missing = await missingFields(db, actor, objectType, resolved.draft);
  const duplicates = await duplicateCandidates(db, actor, objectType, resolved.draft);
  const rows = fieldRowsForDraft(objectType, resolved.draft, missing, text, parsedDraft);
  const requiredFields = [
    ...REQUIRED_FIELDS[objectType],
    ...packet.custom_fields.filter(field => field.required).map(field => `custom_fields.${field.key}`),
  ];

  return {
    data: resolved.draft,
    draft: resolved.draft,
    source: 'agent',
    field_rows: rows,
    required_fields: requiredFields,
    missing_fields: missing,
    linked_records: linkedRecords,
    duplicate_candidates: duplicates,
    enrichment_suggestions: objectType === 'account' ? enrichmentSuggestionsFromRows(rows) : [],
    resolution_summary: resolved.resolution_summary,
    unresolved_references: resolved.unresolved_references,
    work_log: [
      'Read object requirements',
      packet.parent_record ? `Applied ${packet.parent_record.type.replace('_', ' ')} scope` : 'Checked workspace scope',
      linkedRecords.length ? `Matched ${linkedRecords.length} linked record${linkedRecords.length === 1 ? '' : 's'}` : 'No linked records matched yet',
      duplicates.length ? `Found ${duplicates.length} possible duplicate${duplicates.length === 1 ? '' : 's'}` : 'No obvious duplicate found',
    ],
    can_create: missing.length === 0 && duplicates.every(candidate => Number(candidate.score ?? 0) < 90),
  };
}
