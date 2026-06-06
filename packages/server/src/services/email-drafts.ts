// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  type ActorContext,
  type SubjectType,
  type UUID,
  notFound,
  validationError,
} from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as emailRepo from '../db/repos/emails.js';
import * as emailMessageRepo from '../db/repos/email-messages.js';
import * as hitlRepo from '../db/repos/hitl.js';
import { emitEvent } from '../events/emitter.js';
import { deliverEmail } from '../email/delivery.js';
import { createProviderDraft } from '../email/provider-drafts.js';
import { callLLM, requireTenantLLMConfig } from '../agent/providers/llm.js';
import { assembleBriefing, formatBriefingText } from './briefing.js';
import {
  assertSubjectAccess,
  getActorUserId,
  isGlobalActor,
} from './access-control.js';

const subjectType = z.enum(['account', 'contact', 'opportunity', 'use_case', 'use-case']).transform(v => v === 'use-case' ? 'use_case' : v);

export const emailDraftPreviewSchema = z.object({
  source_email_message_id: z.string().uuid().optional(),
  subject_type: subjectType.optional(),
  subject_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  account_id: z.string().uuid().optional(),
  opportunity_id: z.string().uuid().optional(),
  use_case_id: z.string().uuid().optional(),
  to_address: z.string().email().optional(),
  to_name: z.string().optional(),
  intent: z.enum(['reply', 'follow_up', 'recap_next_steps', 'nudge_stalled_deal', 'custom']).default('follow_up'),
  instruction: z.string().max(4000).optional(),
  tone: z.string().max(100).optional().default('concise, helpful, and specific'),
  target: z.enum(['crmy', 'provider_draft']).optional().default('crmy'),
});

export const emailDraftSaveSchema = emailDraftPreviewSchema.extend({
  subject: z.string().min(1),
  body_text: z.string().min(1),
  body_html: z.string().optional(),
  draft_origin: z.enum(['manual', 'agent_generated']).default('manual'),
  draft_target: z.enum(['crmy', 'provider_draft']).default('crmy'),
  delivery_action: z.enum(['save_draft', 'request_approval', 'send_now']).default('save_draft'),
  generation_metadata: z.record(z.unknown()).optional().default({}),
  idempotency_key: z.string().max(128).optional(),
});

export type EmailDraftPreviewInput = z.infer<typeof emailDraftPreviewSchema>;
export type EmailDraftSaveInput = z.infer<typeof emailDraftSaveSchema>;

type LinkedRecords = {
  contact_id?: UUID;
  account_id?: UUID;
  opportunity_id?: UUID;
  use_case_id?: UUID;
};

async function assertEmailMessageAccess(db: DbPool, actor: ActorContext, message: emailMessageRepo.EmailMessage): Promise<void> {
  if (isGlobalActor(actor)) return;
  const actorUserId = await getActorUserId(db, actor);
  if (actorUserId && message.user_id === actorUserId) return;
  const linked = [
    ['opportunity', message.opportunity_id],
    ['use_case', message.use_case_id],
    ['contact', message.contact_id],
    ['account', message.account_id],
  ] as const;
  for (const [type, id] of linked) {
    if (!id) continue;
    await assertSubjectAccess(db, actor, type, id);
    return;
  }
  throw notFound('EmailMessage', message.id);
}

function primarySubject(input: LinkedRecords & { subject_type?: SubjectType; subject_id?: UUID }): { subject_type?: SubjectType; subject_id?: UUID } {
  if (input.subject_type && input.subject_id) return { subject_type: input.subject_type, subject_id: input.subject_id };
  if (input.opportunity_id) return { subject_type: 'opportunity', subject_id: input.opportunity_id };
  if (input.use_case_id) return { subject_type: 'use_case', subject_id: input.use_case_id };
  if (input.contact_id) return { subject_type: 'contact', subject_id: input.contact_id };
  if (input.account_id) return { subject_type: 'account', subject_id: input.account_id };
  return {};
}

async function getContactRecipient(db: DbPool, tenantId: UUID, contactId?: UUID): Promise<{ to_address?: string; to_name?: string }> {
  if (!contactId) return {};
  const result = await db.query(
    'SELECT first_name, last_name, email FROM contacts WHERE tenant_id = $1 AND id = $2 LIMIT 1',
    [tenantId, contactId],
  );
  const contact = result.rows[0] as { first_name?: string; last_name?: string; email?: string } | undefined;
  if (!contact?.email) return {};
  return {
    to_address: contact.email,
    to_name: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || undefined,
  };
}

async function resolveDraftContext(
  db: DbPool,
  actor: ActorContext,
  input: EmailDraftPreviewInput | EmailDraftSaveInput,
): Promise<{
  sourceMessage?: emailMessageRepo.EmailMessage;
  linked: LinkedRecords;
  subject_type?: SubjectType;
  subject_id?: UUID;
  to_address?: string;
  to_name?: string;
}> {
  let sourceMessage: emailMessageRepo.EmailMessage | undefined;
  const linked: LinkedRecords = {
    contact_id: input.contact_id as UUID | undefined,
    account_id: input.account_id as UUID | undefined,
    opportunity_id: input.opportunity_id as UUID | undefined,
    use_case_id: input.use_case_id as UUID | undefined,
  };

  if (input.source_email_message_id) {
    const message = await emailMessageRepo.getEmailMessage(db, actor.tenant_id, input.source_email_message_id);
    if (!message) throw notFound('EmailMessage', input.source_email_message_id);
    await assertEmailMessageAccess(db, actor, message);
    sourceMessage = message;
    linked.contact_id ??= message.contact_id as UUID | undefined;
    linked.account_id ??= message.account_id as UUID | undefined;
    linked.opportunity_id ??= message.opportunity_id as UUID | undefined;
    linked.use_case_id ??= message.use_case_id as UUID | undefined;
  }

  for (const [type, id] of [
    ['account', linked.account_id],
    ['contact', linked.contact_id],
    ['opportunity', linked.opportunity_id],
    ['use_case', linked.use_case_id],
  ] as const) {
    if (id) await assertSubjectAccess(db, actor, type, id);
  }

  const explicitSubject = input.subject_type && input.subject_id
    ? { subject_type: input.subject_type as SubjectType, subject_id: input.subject_id as UUID }
    : {};
  if (explicitSubject.subject_type && explicitSubject.subject_id) {
    await assertSubjectAccess(db, actor, explicitSubject.subject_type, explicitSubject.subject_id);
  }
  const subject = primarySubject({ ...linked, ...explicitSubject });
  const contactRecipient = await getContactRecipient(db, actor.tenant_id, linked.contact_id);

  return {
    sourceMessage,
    linked,
    subject_type: subject.subject_type,
    subject_id: subject.subject_id,
    to_address: input.to_address ?? (sourceMessage?.direction === 'inbound' ? sourceMessage.from_email : undefined) ?? contactRecipient.to_address,
    to_name: input.to_name ?? (sourceMessage?.direction === 'inbound' ? sourceMessage.from_name ?? undefined : undefined) ?? contactRecipient.to_name,
  };
}

async function buildResponsePacket(
  db: DbPool,
  actor: ActorContext,
  input: EmailDraftPreviewInput,
) {
  const ctx = await resolveDraftContext(db, actor, input);
  let briefingText = '';
  let memoryCount = 0;
  let signalCount = 0;
  if (ctx.subject_type && ctx.subject_id) {
    const briefing = await assembleBriefing(db, actor.tenant_id, ctx.subject_type, ctx.subject_id, {
      context_radius: ctx.subject_type === 'account' ? 'account_wide' : ctx.subject_type === 'contact' ? 'adjacent' : 'direct',
      token_budget: 2500,
    });
    briefingText = formatBriefingText(briefing).slice(0, 12000);
    memoryCount = Object.values(briefing.context_entries ?? {}).reduce((sum, entries) => sum + entries.length, 0);
    signalCount = briefing.signal_groups?.length ?? 0;
  }

  return {
    ctx,
    packet: {
      objective: 'Draft a customer-ready follow-up email from CRMy customer context.',
      intent: input.intent,
      tone: input.tone,
      instruction: input.instruction ?? '',
      recipient: { email: ctx.to_address, name: ctx.to_name },
      linked_records: {
        subject_type: ctx.subject_type,
        subject_id: ctx.subject_id,
        ...ctx.linked,
      },
      source_email: ctx.sourceMessage ? {
        from: ctx.sourceMessage.from_email,
        from_name: ctx.sourceMessage.from_name,
        to: ctx.sourceMessage.to_emails,
        subject: ctx.sourceMessage.subject,
        snippet: ctx.sourceMessage.snippet,
        body_text: (ctx.sourceMessage.body_text ?? '').slice(0, 5000),
        received_at: ctx.sourceMessage.received_at,
      } : null,
      briefing: briefingText,
      guardrails: [
        'Use confirmed Memory as facts.',
        'Treat Signals as unconfirmed and do not overstate them.',
        'Be concise, specific, and useful.',
        'Do not invent customer commitments, dates, pricing, or approvals.',
      ],
    },
    context_used: {
      subject_type: ctx.subject_type,
      subject_id: ctx.subject_id,
      source_email_message_id: ctx.sourceMessage?.id,
      memory_count: memoryCount,
      signal_count: signalCount,
      used_unconfirmed_signals: signalCount > 0,
    },
  };
}

function parseDraftJson(raw: string): { subject: string; body_text: string } | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { subject?: unknown; body_text?: unknown };
    if (typeof parsed.subject === 'string' && typeof parsed.body_text === 'string') {
      return { subject: parsed.subject.trim(), body_text: parsed.body_text.trim() };
    }
  } catch {
    return null;
  }
  return null;
}

export async function previewEmailDraft(db: DbPool, actor: ActorContext, input: EmailDraftPreviewInput) {
  await requireTenantLLMConfig(db, actor.tenant_id);
  const { packet, context_used } = await buildResponsePacket(db, actor, input);
  const system = [
    'You are CRMy’s customer email drafting model.',
    'You draft emails from operational customer context for revenue teams.',
    'Return ONLY valid JSON: {"subject":"...","body_text":"..."}.',
  ].join('\n');
  const user = [
    'Draft packet:',
    JSON.stringify(packet, null, 2),
    '',
    'Write a polished first draft. If context is insufficient, still draft a useful neutral note and avoid unsupported claims.',
  ].join('\n');

  let raw = await callLLM(db, actor.tenant_id, {
    system,
    user,
    maxTokens: 1400,
    responseFormat: 'json_object',
  });
  let draft = parseDraftJson(raw);
  if (!draft) {
    raw = await callLLM(db, actor.tenant_id, {
      system,
      user: [
        'Your previous response was not valid JSON.',
        'Return ONLY valid JSON with exactly these fields: {"subject":"...","body_text":"..."}.',
        'Previous response:',
        raw.slice(0, 4000),
        '',
        'Draft packet:',
        JSON.stringify(packet, null, 2),
      ].join('\n'),
      maxTokens: 1400,
      responseFormat: 'json_object',
    });
    draft = parseDraftJson(raw);
  }
  if (!draft) throw validationError('Workspace Agent returned an email draft that CRMy could not parse. Try a shorter instruction or adjust the model settings.');

  return {
    ...draft,
    context_used,
    warnings: context_used.used_unconfirmed_signals
      ? ['Relevant Signals were available. CRMy treated them as unconfirmed context while drafting.']
      : [],
    model_metadata: {
      draft_origin: 'agent_generated',
      generated_at: new Date().toISOString(),
    },
  };
}

export async function saveEmailDraft(db: DbPool, actor: ActorContext, input: EmailDraftSaveInput) {
  const ctx = await resolveDraftContext(db, actor, input);
  if (!ctx.to_address) throw validationError('A recipient email address is required.');
  if (input.draft_target === 'provider_draft') {
    await emitEvent(db, {
      tenantId: actor.tenant_id,
      eventType: 'email.draft_provider_push_failed',
      actorId: actor.actor_id,
      actorType: actor.actor_type,
      objectType: 'email',
      afterData: { to_address: ctx.to_address, subject: input.subject },
      metadata: { reason: 'unsupported_capability' },
    });
    await createProviderDraft(db, actor.tenant_id, {
      email_id: '00000000-0000-0000-0000-000000000000' as UUID,
      to_email: ctx.to_address,
      subject: input.subject,
      body_text: input.body_text,
    });
  }

  const userId = await getActorUserId(db, actor);
  let hitlRequestId: string | undefined;
  let status = input.delivery_action === 'request_approval' ? 'pending_approval' : 'draft';

  if (input.delivery_action === 'request_approval') {
    const hitl = await hitlRepo.createHITLRequest(db, actor.tenant_id, {
      agent_id: actor.actor_id,
      action_type: 'email.send',
      action_summary: `Send email to ${ctx.to_address}: "${input.subject}"`,
      action_payload: {
        to_address: ctx.to_address,
        subject: input.subject,
        body_preview: input.body_text.slice(0, 240),
        subject_type: ctx.subject_type,
        subject_id: ctx.subject_id,
        ...ctx.linked,
        source_email_message_id: input.source_email_message_id,
        draft_origin: input.draft_origin,
      },
      priority: 'normal',
      sla_minutes: 1440,
    });
    hitlRequestId = hitl.id;
  }

  const email = await emailRepo.createEmail(db, actor.tenant_id, {
    ...ctx.linked,
    to_email: ctx.to_address,
    to_name: ctx.to_name,
    subject: input.subject,
    body_html: input.body_html,
    body_text: input.body_text,
    status,
    hitl_request_id: hitlRequestId as UUID | undefined,
    created_by: userId ?? undefined,
    draft_origin: input.draft_origin,
    draft_target: input.draft_target,
    source_email_message_id: input.source_email_message_id as UUID | undefined,
    provider_draft_status: 'not_requested',
    generation_metadata: input.generation_metadata,
  });

  const providerConfig = await emailRepo.getProvider(db, actor.tenant_id);
  await emailMessageRepo.upsertEmailMessage(db, actor.tenant_id, {
    direction: 'outbound',
    source: 'outbound',
    from_email: providerConfig?.from_email ?? 'unknown@local',
    from_name: providerConfig?.from_name ?? undefined,
    to_emails: [ctx.to_address],
    subject: input.subject,
    body_html: input.body_html,
    body_text: input.body_text,
    classification: 'customer',
    processing_status: input.delivery_action === 'send_now' ? 'processed' : 'unprocessed',
    processing_reason: status === 'pending_approval' ? 'Waiting for governed send approval.' : 'Outbound draft recorded.',
    contact_id: ctx.linked.contact_id,
    account_id: ctx.linked.account_id,
    opportunity_id: ctx.linked.opportunity_id,
    use_case_id: ctx.linked.use_case_id,
    email_id: email.id,
    user_id: userId ?? undefined,
    metadata: {
      draft_origin: input.draft_origin,
      draft_target: input.draft_target,
      source_email_message_id: input.source_email_message_id,
    },
  });

  const eventId = await emitEvent(db, {
    tenantId: actor.tenant_id,
    eventType: input.draft_origin === 'agent_generated' ? 'email.draft_generated' : 'email.draft_saved',
    actorId: actor.actor_id,
    actorType: actor.actor_type,
    objectType: 'email',
    objectId: email.id,
    afterData: { id: email.id, to: email.to_email, subject: email.subject, status: email.status },
    metadata: input.generation_metadata,
  });
  await emitEvent(db, {
    tenantId: actor.tenant_id,
    eventType: 'email.created',
    actorId: actor.actor_id,
    actorType: actor.actor_type,
    objectType: 'email',
    objectId: email.id,
    afterData: { id: email.id, to: email.to_email, subject: email.subject, status: email.status },
    metadata: { origin: 'customer_email_draft' },
  });

  if (input.delivery_action === 'send_now') {
    await deliverEmail(db, actor.tenant_id, email.id);
    status = 'sending';
  }

  const latest = await emailRepo.getEmail(db, actor.tenant_id, email.id);
  return {
    email: latest ?? email,
    hitl_request_id: hitlRequestId,
    event_id: eventId,
    status,
  };
}
