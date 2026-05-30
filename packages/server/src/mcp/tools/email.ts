// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { emailCreate, emailGet, emailSearch, emailProviderSet, emailProviderGet } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as emailRepo from '../../db/repos/emails.js';
import * as emailMessageRepo from '../../db/repos/email-messages.js';
import * as hitlRepo from '../../db/repos/hitl.js';
import * as activityRepo from '../../db/repos/activities.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import { deliverEmail } from '../../email/delivery.js';
import { getEmailProvider, listEmailProviderTypes } from '../../email/providers/index.js';
import { parseInboundEmail } from '../../email/inbound-parser.js';
import { extractContextFromActivity } from '../../agent/extraction.js';
import { entityResolve } from '../../services/entity-resolve.js';
import { getActorUserId, isGlobalActor, resolveOwnerFilter, assertSubjectAccess } from '../../services/access-control.js';
import { ingestEmailMessage, processEmailMessage } from '../../services/customer-email.js';
import { emailDraftPreviewSchema, emailDraftSaveSchema, previewEmailDraft, saveEmailDraft, type EmailDraftPreviewInput, type EmailDraftSaveInput } from '../../services/email-drafts.js';
import type { ToolDef } from '../server.js';
import { runToolOperation } from '../tool-operation.js';
import { mutationReceipt } from '../mutation-receipt.js';

type CustomerSubjectType = 'account' | 'contact' | 'opportunity' | 'use_case';

const CUSTOMER_SUBJECT_TABLES: Record<CustomerSubjectType, string> = {
  account: 'accounts',
  contact: 'contacts',
  opportunity: 'opportunities',
  use_case: 'use_cases',
};

/** Redact provider-specific sensitive fields before returning config to callers. */
function redactProviderConfig(provider: string, config: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...config };
  if (provider === 'smtp') {
    if (safe.auth && typeof safe.auth === 'object') {
      safe.auth = { ...(safe.auth as Record<string, unknown>), pass: '***' };
    }
  } else if (provider === 'resend' || provider === 'sendgrid') {
    if (safe.api_key) safe.api_key = '***';
  } else if (provider === 'postmark') {
    if (safe.server_token) safe.server_token = '***';
  } else if (provider === 'ses') {
    if (safe.secret_access_key) safe.secret_access_key = '***';
  } else if (provider === 'mailgun') {
    if (safe.api_key) safe.api_key = '***';
  }
  return safe;
}

async function assertVisibleSubjectLink(
  db: DbPool,
  actor: ActorContext,
  subjectType: CustomerSubjectType,
  subjectId: string,
): Promise<void> {
  const table = CUSTOMER_SUBJECT_TABLES[subjectType];
  const result = await db.query(
    `SELECT id FROM ${table} WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [actor.tenant_id, subjectId],
  );
  if (!result.rows[0]) throw notFound('CustomerRecord', subjectId);
  await assertSubjectAccess(db, actor, subjectType, subjectId);
}

async function canAccessSubjectLink(
  db: DbPool,
  actor: ActorContext,
  subjectType: CustomerSubjectType,
  subjectId: string,
): Promise<boolean> {
  try {
    await assertVisibleSubjectLink(db, actor, subjectType, subjectId);
    return true;
  } catch {
    return false;
  }
}

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
    if (await canAccessSubjectLink(db, actor, type, id)) return;
  }
  throw notFound('EmailMessage', message.id);
}

export function emailTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'email_create',
      tier: 'extended',
      description: 'Draft an outbound email linked to a contact. By default require_approval is true, which creates a HITL request for human review before sending — this is the recommended approach for high-stakes communications. Set require_approval to false only for routine, low-risk sends. The email is stored as a draft until approved.',
      inputSchema: emailCreate,
      handler: async (input: z.infer<typeof emailCreate>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'email_create', input, async () => {
        const bodyText = input.body_text ?? input.body_html?.replace(/<[^>]+>/g, '') ?? '';

        let hitlRequestId: string | undefined;
        let status = 'draft';

        if (input.require_approval !== false) {
          // Create HITL request for approval
          const hitl = await hitlRepo.createHITLRequest(db, actor.tenant_id, {
            agent_id: actor.actor_id,
            action_type: 'email.send',
            action_summary: `Send email to ${input.to_address}: "${input.subject}"`,
            action_payload: {
              to_address: input.to_address,
              subject: input.subject,
              body_preview: bodyText.slice(0, 200),
            },
          });
          hitlRequestId = hitl.id;
          status = 'pending_approval';
        }

        const email = await emailRepo.createEmail(db, actor.tenant_id, {
          contact_id: input.contact_id,
          account_id: input.account_id,
          opportunity_id: input.opportunity_id,
          use_case_id: input.use_case_id,
          to_email: input.to_address,
          subject: input.subject,
          body_html: input.body_html,
          body_text: bodyText,
          status,
          hitl_request_id: hitlRequestId,
          created_by: actor.actor_id,
        });

        const providerConfig = await emailRepo.getProvider(db, actor.tenant_id);
        const actorUser = await db.query('SELECT email, name FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1', [actor.tenant_id, actor.actor_id]);
        await emailMessageRepo.upsertEmailMessage(db, actor.tenant_id, {
          direction: 'outbound',
          source: 'outbound',
          from_email: providerConfig?.from_email ?? actorUser.rows[0]?.email ?? 'unknown@local',
          from_name: providerConfig?.from_name ?? actorUser.rows[0]?.name ?? undefined,
          to_emails: [input.to_address],
          subject: input.subject,
          body_html: input.body_html,
          body_text: bodyText,
          classification: 'customer',
          processing_status: status === 'sent' ? 'processed' : 'unprocessed',
          processing_reason: status === 'pending_approval' ? 'Waiting for governed send approval.' : 'Outbound draft recorded.',
          contact_id: input.contact_id,
          account_id: input.account_id,
          opportunity_id: input.opportunity_id,
          use_case_id: input.use_case_id,
          email_id: email.id,
          user_id: actorUser.rows[0]?.email ? actor.actor_id : undefined,
          metadata: { governed_email_status: status },
        });

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'email.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'email',
          objectId: email.id,
          afterData: { id: email.id, to: email.to_email, subject: email.subject, status: email.status },
        });

        // When no approval required, send immediately
        if (input.require_approval === false) {
          await deliverEmail(db, actor.tenant_id, email.id);
          const sent = await emailRepo.getEmail(db, actor.tenant_id, email.id);
          return {
            email: sent ?? email,
            event_id,
            mutation: mutationReceipt(actor, {
              objectType: 'email',
              objectId: email.id,
              eventId: event_id,
              sideEffects: ['email_delivery:attempted'],
            }),
          };
        }

        return {
          email,
          hitl_request_id: hitlRequestId,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'email',
            objectId: email.id,
            eventId: event_id,
            sideEffects: hitlRequestId ? ['hitl_request:created'] : [],
          }),
        };
        });
      },
    },
    {
      name: 'email_get',
      tier: 'extended',
      description: 'Retrieve a single email by UUID including its subject, body, recipients, status (draft, pending_approval, sent), and linked contact. Use this to check the current state of an email draft or review its content.',
      inputSchema: emailGet,
      handler: async (input: z.infer<typeof emailGet>, actor: ActorContext) => {
        const email = await emailRepo.getEmail(db, actor.tenant_id, input.id);
        if (!email) throw notFound('Email', input.id);
        return { email };
      },
    },
    {
      name: 'email_search',
      tier: 'extended',
      description: 'Search emails with optional filters for contact_id and status. Use this to find all emails sent to a specific contact or to list all drafts pending approval. Returns emails sorted by creation time.',
      inputSchema: emailSearch,
      handler: async (input: z.infer<typeof emailSearch>, actor: ActorContext) => {
        const result = await emailRepo.searchEmails(db, actor.tenant_id, {
          contact_id: input.contact_id,
          status: input.status,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { emails: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'mailbox_connection_list',
      tier: 'extended',
      description: 'List mailbox connections and customer-email processing summary visible to the current user. Use this to check whether Customer Email is connected and healthy.',
      inputSchema: z.object({}),
      handler: async (_input: {}, actor: ActorContext) => {
        const userId = isGlobalActor(actor) ? undefined : await getActorUserId(db, actor);
        const ownerFilter = await resolveOwnerFilter(db, actor);
        const data = await emailMessageRepo.listMailboxConnections(db, actor.tenant_id, userId);
        const summary = await emailMessageRepo.summarizeEmailMessages(db, actor.tenant_id, ownerFilter.owner_ids);
        return { mailbox_connections: data, total: data.length, summary };
      },
    },
    {
      name: 'email_message_search',
      tier: 'extended',
      description: 'Search canonical customer email messages from mailbox sync, inbound webhooks, manual ingest, and outbound sends. Results are scoped to the current user and linked revenue records.',
      inputSchema: z.object({
        q: z.string().optional(),
        view: z.enum(['customer', 'review', 'all']).optional().default('customer'),
        direction: z.enum(['inbound', 'outbound']).optional(),
        classification: z.enum(['customer', 'mixed', 'internal', 'automated', 'unknown']).optional(),
        processing_status: z.enum(['unprocessed', 'processing', 'processed', 'needs_review', 'skipped', 'failed', 'ignored']).optional(),
        include_internal: z.boolean().optional().default(false),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
      handler: async (input, actor: ActorContext) => {
        const ownerFilter = await resolveOwnerFilter(db, actor);
        const result = await emailMessageRepo.listEmailMessages(db, actor.tenant_id, {
          q: input.q,
          direction: input.direction,
          classifications: input.view === 'customer' ? ['customer', 'mixed'] : input.classification ? [input.classification] : undefined,
          processing_statuses: input.view === 'review' ? ['needs_review', 'failed', 'unprocessed'] : input.processing_status ? [input.processing_status] : undefined,
          include_internal: input.include_internal || input.view === 'review',
          owner_ids: ownerFilter.owner_ids,
          limit: input.limit,
          cursor: input.cursor,
        });
        return { email_messages: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'email_message_get',
      tier: 'extended',
      description: 'Get one canonical customer email message, including linked records and processing receipt.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const message = await emailMessageRepo.getEmailMessage(db, actor.tenant_id, input.id);
        if (!message) throw notFound('EmailMessage', input.id);
        await assertEmailMessageAccess(db, actor, message);
        return { email_message: message };
      },
    },
    {
      name: 'email_message_process',
      tier: 'extended',
      description: 'Process an existing customer email message as Raw Context. Internal or automated emails are skipped unless reclassified first.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const message = await emailMessageRepo.getEmailMessage(db, actor.tenant_id, input.id);
        if (!message) throw notFound('EmailMessage', input.id);
        await assertEmailMessageAccess(db, actor, message);
        return processEmailMessage(db, actor.tenant_id, message.id, actor);
      },
    },
    {
      name: 'email_message_ignore',
      tier: 'extended',
      description: 'Ignore a customer email message so it no longer appears in review queues.',
      inputSchema: z.object({ id: z.string().uuid(), reason: z.string().optional() }),
      handler: async (input: { id: string; reason?: string }, actor: ActorContext) => {
        const message = await emailMessageRepo.getEmailMessage(db, actor.tenant_id, input.id);
        if (!message) throw notFound('EmailMessage', input.id);
        await assertEmailMessageAccess(db, actor, message);
        const updated = await emailMessageRepo.updateEmailMessage(db, actor.tenant_id, message.id, {
          processing_status: 'ignored',
          processing_reason: input.reason ?? 'Ignored by user.',
          ignored_at: new Date().toISOString(),
        });
        return { email_message: updated };
      },
    },
    {
      name: 'email_message_link',
      tier: 'extended',
      description: 'Link an unmatched customer email to visible customer records and optionally process it as Raw Context. Use this when matching was ambiguous or the email arrived before CRMy could identify the account/contact.',
      inputSchema: z.object({
        id: z.string().uuid(),
        classification: z.enum(['customer', 'mixed', 'internal', 'automated', 'unknown']).optional(),
        contact_id: z.string().uuid().nullable().optional(),
        account_id: z.string().uuid().nullable().optional(),
        opportunity_id: z.string().uuid().nullable().optional(),
        use_case_id: z.string().uuid().nullable().optional(),
        process: z.boolean().optional().default(true),
      }),
      handler: async (input: {
        id: string;
        classification?: emailMessageRepo.EmailClassification;
        contact_id?: string | null;
        account_id?: string | null;
        opportunity_id?: string | null;
        use_case_id?: string | null;
        process?: boolean;
      }, actor: ActorContext) => {
        return runToolOperation(db, actor, 'email_message_link', input, async () => {
          const message = await emailMessageRepo.getEmailMessage(db, actor.tenant_id, input.id);
          if (!message) throw notFound('EmailMessage', input.id);
          await assertEmailMessageAccess(db, actor, message);
          if (input.contact_id) await assertVisibleSubjectLink(db, actor, 'contact', input.contact_id);
          if (input.account_id) await assertVisibleSubjectLink(db, actor, 'account', input.account_id);
          if (input.opportunity_id) await assertVisibleSubjectLink(db, actor, 'opportunity', input.opportunity_id);
          if (input.use_case_id) await assertVisibleSubjectLink(db, actor, 'use_case', input.use_case_id);
          const patch: Parameters<typeof emailMessageRepo.updateEmailMessage>[3] = {
            processing_status: input.classification && ['internal', 'automated'].includes(input.classification)
              ? 'skipped'
              : 'unprocessed',
            processing_reason: input.classification && ['internal', 'automated'].includes(input.classification)
              ? 'Marked as non-customer email.'
              : 'Customer record link updated. Ready to process as Raw Context.',
            metadata: { link_updated_by: actor.actor_id, link_updated_at: new Date().toISOString() },
          };
          if (input.classification !== undefined) patch.classification = input.classification;
          if (input.contact_id !== undefined) patch.contact_id = input.contact_id;
          if (input.account_id !== undefined) patch.account_id = input.account_id;
          if (input.opportunity_id !== undefined) patch.opportunity_id = input.opportunity_id;
          if (input.use_case_id !== undefined) patch.use_case_id = input.use_case_id;
          const updated = await emailMessageRepo.updateEmailMessage(db, actor.tenant_id, message.id, patch);
          if (!updated) throw notFound('EmailMessage', input.id);
          if (input.process !== false
            && ['customer', 'mixed'].includes(updated.classification)
            && (updated.contact_id || updated.account_id || updated.opportunity_id || updated.use_case_id)) {
            return processEmailMessage(db, actor.tenant_id, updated.id, actor);
          }
          return { email_message: updated };
        });
      },
    },
    {
      name: 'email_draft_preview',
      tier: 'extended',
      description: 'Generate a customer email draft preview from CRMy Memory, relevant Signals, source email context, and linked revenue records. This does not save or send email; use email_draft_save after review.',
      inputSchema: emailDraftPreviewSchema,
      handler: async (input: EmailDraftPreviewInput, actor: ActorContext) => {
        return runToolOperation(db, actor, 'email_draft_preview', input, async () => (
          previewEmailDraft(db, actor, input)
        ));
      },
    },
    {
      name: 'email_draft_save',
      tier: 'extended',
      description: 'Save a reviewed customer email draft, request approval, or explicitly send now through CRMy governed email flow. Agent-generated drafts should normally be saved or sent for approval first.',
      inputSchema: emailDraftSaveSchema,
      handler: async (input: EmailDraftSaveInput, actor: ActorContext) => {
        return runToolOperation(db, actor, 'email_draft_save', input, async () => (
          saveEmailDraft(db, actor, input)
        ));
      },
    },

    // ── Provider configuration ─────────────────────────────────────────────

    {
      name: 'email_provider_set',
      tier: 'extended',
      description:
        'Configure the tenant\'s email provider for outbound email delivery. ' +
        'Required: provider type, config object, from_name, from_email. ' +
        'SMTP config requires: host, port, auth.user, auth.pass (optional: secure). ' +
        'Resend config requires: api_key. ' +
        'Postmark config requires: server_token (optional: message_stream, defaults to "outbound"). ' +
        'This overwrites any existing provider config for the tenant.',
      inputSchema: emailProviderSet,
      handler: async (input: z.infer<typeof emailProviderSet>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'email_provider_set', input, async () => {
        const provider = getEmailProvider(input.provider);
        if (!provider) {
          return {
            error: `Unknown provider: "${input.provider}". Available: ${listEmailProviderTypes().join(', ')}`,
          };
        }

        const validation = provider.validateConfig(input.config);
        if (!validation.valid) {
          return { error: `Invalid config for "${input.provider}": ${validation.error}` };
        }

        const result = await emailRepo.upsertProvider(db, actor.tenant_id, {
          provider: input.provider,
          config: input.config,
          from_name: input.from_name,
          from_email: input.from_email,
        });

        return {
          ...result,
          config: redactProviderConfig(input.provider, result.config),
          mutation: mutationReceipt(actor, {
            objectType: 'email_provider',
            objectId: result.id,
          }),
        };
        });
      },
    },
    {
      name: 'email_ingest',
      tier: 'extended',
      description: 'Manually ingest an inbound email without a webhook — useful when forwarding emails to the CRM or when the webhook is not available. Creates an inbound activity, attempts to resolve the sender to a contact, and triggers context extraction. If you pass a raw_payload from a supported provider (SendGrid, Postmark, Mailgun), it will be auto-parsed.',
      inputSchema: z.object({
        from_email: z.string().email()
          .describe('Sender email address'),
        from_name: z.string().optional()
          .describe('Sender display name'),
        subject: z.string().min(1)
          .describe('Email subject line'),
        body: z.string().min(1)
          .describe('Plain-text email body'),
        received_at: z.string().datetime().optional()
          .describe('ISO timestamp when the email was received. Defaults to now.'),
        contact_id: z.string().uuid().optional()
          .describe('Skip entity resolution and link directly to this contact.'),
        raw_payload: z.record(z.unknown()).optional()
          .describe('Raw provider webhook payload — if provided, parsed fields above are ignored and the payload is auto-detected (SendGrid, Postmark, Mailgun).'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input: {
        from_email: string;
        from_name?: string;
        subject: string;
        body: string;
        received_at?: string;
        contact_id?: string;
        raw_payload?: Record<string, unknown>;
        idempotency_key?: string;
      }, actor: ActorContext) => {
        return runToolOperation(db, actor, 'email_ingest', input, async () => {
        let fromEmail = input.from_email;
        let fromName = input.from_name;
        let subject = input.subject;
        let body = input.body;
        let receivedAt = input.received_at ?? new Date().toISOString();
        let htmlBody: string | undefined;
        let inReplyTo: string | undefined;

        if (input.raw_payload) {
          const parsed = parseInboundEmail(input.raw_payload);
          if (!parsed) throw new Error('Unrecognised inbound email payload format');
          fromEmail = parsed.from_email;
          fromName = parsed.from_name;
          subject = parsed.subject;
          body = parsed.text_body;
          htmlBody = parsed.html_body;
          receivedAt = parsed.received_at;
          inReplyTo = parsed.in_reply_to;
        }

        const result = await ingestEmailMessage(db, actor.tenant_id, {
          direction: 'inbound',
          source: 'manual',
          from_email: fromEmail,
          from_name: fromName,
          to_emails: [],
          subject,
          body_text: body,
          body_html: htmlBody,
          received_at: receivedAt,
          in_reply_to: inReplyTo,
          provider_message_id: input.idempotency_key,
          contact_id: input.contact_id,
          metadata: { input_channel: 'mcp_email_ingest' },
        }, actor);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'email_message.ingested',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'email_message',
          objectId: result.message.id,
          afterData: {
            classification: result.classification,
            processing_status: result.processing_status,
            activity_id: result.activity_id,
          },
        });

        return {
          email_message_id: result.message.id,
          activity_id: result.activity_id ?? null,
          raw_context_source_id: result.raw_context_source_id ?? null,
          contact_id: result.message.contact_id ?? null,
          account_id: result.message.account_id ?? null,
          classification: result.classification,
          processing_status: result.processing_status,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'email_message',
            objectId: result.message.id,
            eventId: event_id,
            sideEffects: result.activity_id ? ['raw_context:processed'] : ['email_message:recorded'],
          }),
        };
        });
      },
    },
    {
      name: 'email_provider_get',
      tier: 'extended',
      description:
        'Get the current email provider configuration for this tenant. ' +
        'Returns provider type, from_name, from_email, and config. ' +
        'Returns { configured: false } if no provider is set up.',
      inputSchema: emailProviderGet,
      handler: async (_input: z.infer<typeof emailProviderGet>, actor: ActorContext) => {
        const result = await emailRepo.getProvider(db, actor.tenant_id);
        if (!result) return { configured: false };

        return { ...result, config: redactProviderConfig(result.provider, result.config) };
      },
    },
  ];
}
