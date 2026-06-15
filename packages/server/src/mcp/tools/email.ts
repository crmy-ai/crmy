// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { emailCreate, emailGet, emailSearch, emailProviderSet, emailProviderGet } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as emailRepo from '../../db/repos/emails.js';
import * as emailMessageRepo from '../../db/repos/email-messages.js';
import * as activityRepo from '../../db/repos/activities.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import { getEmailProvider, listEmailProviderTypes } from '../../email/providers/index.js';
import { parseInboundEmail } from '../../email/inbound-parser.js';
import { extractContextFromActivity } from '../../agent/extraction.js';
import { entityResolve } from '../../services/entity-resolve.js';
import { getActorUserId, isGlobalActor, resolveOwnerFilter, assertSubjectAccess } from '../../services/access-control.js';
import { ingestEmailMessage, processEmailMessage } from '../../services/customer-email.js';
import { emailDraftPreviewSchema, emailDraftSaveSchema, previewEmailDraft, saveEmailDraft, type EmailDraftPreviewInput, type EmailDraftSaveInput } from '../../services/email-drafts.js';
import { buildOAuthUrl, oauthReadiness } from '../../services/source-sync.js';
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

async function assertOutboundEmailAccess(db: DbPool, actor: ActorContext, email: emailRepo.EmailRow): Promise<void> {
  if (isGlobalActor(actor)) return;
  const actorUserId = await getActorUserId(db, actor);
  if ((actorUserId && email.created_by === actorUserId) || email.created_by === actor.actor_id) return;
  const linked = [
    ['opportunity', email.opportunity_id],
    ['use_case', email.use_case_id],
    ['contact', email.contact_id],
    ['account', email.account_id],
  ] as const;
  for (const [type, id] of linked) {
    if (!id) continue;
    if (await canAccessSubjectLink(db, actor, type, id)) return;
  }
  throw notFound('Email', email.id);
}

export function emailTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'email_create',
      tier: 'extended',
      description: 'Draft an outbound email linked to a customer record. CRMy resolves the sender from the actor’s send-enabled mailbox first, then the tenant fallback provider. By default require_approval is true, which creates a HITL request for human review before sending. Delivered sends are recorded as account activity and CRMy-authored context, not customer-authored evidence.',
      inputSchema: emailCreate,
      handler: async (input: z.infer<typeof emailCreate>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'email_create', input, async () => {
          const bodyText = input.body_text ?? input.body_html?.replace(/<[^>]+>/g, '') ?? '';
          return saveEmailDraft(db, actor, {
            contact_id: input.contact_id,
            account_id: input.account_id,
            opportunity_id: input.opportunity_id,
            use_case_id: input.use_case_id,
            to_address: input.to_address,
            subject: input.subject,
            body_html: input.body_html,
            body_text: bodyText,
            intent: 'follow_up',
            tone: 'concise, helpful, and specific',
            target: 'crmy',
            draft_origin: 'manual',
            draft_target: 'crmy',
            delivery_action: input.require_approval === false ? 'send_now' : 'request_approval',
            generation_metadata: { legacy_tool: 'email_create' },
            idempotency_key: input.idempotency_key,
          });
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
        await assertOutboundEmailAccess(db, actor, email);
        return { email };
      },
    },
    {
      name: 'email_search',
      tier: 'extended',
      description: 'Search outbound email actions with optional filters for contact_id, account_id, opportunity_id, use_case_id, q, and status. Use this to find linked drafts, rejected drafts, pending approvals, sent emails, or failed sends. Returns emails sorted by creation time.',
      inputSchema: emailSearch,
      handler: async (input: z.infer<typeof emailSearch>, actor: ActorContext) => {
        const ownerFilter = await resolveOwnerFilter(db, actor);
        const result = await emailRepo.searchEmails(db, actor.tenant_id, {
          contact_id: input.contact_id,
          account_id: input.account_id,
          opportunity_id: input.opportunity_id,
          use_case_id: input.use_case_id,
          q: input.q,
          status: input.status,
          owner_ids: ownerFilter.owner_ids,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { emails: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'mailbox_connection_list',
      tier: 'extended',
	      description: 'List mailbox connections and customer-email processing summary visible to the current user. Mailbox connections are both customer context sources and optional actor sender identities when send permissions are enabled.',
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
      name: 'mailbox_connection_start',
      tier: 'extended',
      description: 'Start Gmail or Outlook mailbox OAuth for the current human-linked actor and return the browser auth_url to finish provider consent. Use this from MCP/CLI when the user does not want to open the CRMy web UI. Pure agent actors without a linked human user cannot connect a mailbox.',
      inputSchema: z.object({
        provider: z.enum(['google', 'microsoft']).describe('Mailbox provider to connect. google = Gmail/Google Workspace, microsoft = Outlook/Microsoft 365.'),
        email_address: z.string().email().optional().describe('Mailbox address. Defaults to the current user email when omitted.'),
        display_name: z.string().optional(),
        context_sync_enabled: z.boolean().optional().default(true),
        send_enabled: z.boolean().optional().default(true),
        provider_draft_enabled: z.boolean().optional().default(true),
        is_default_sender: z.boolean().optional().default(true),
        account_ingest_scope: z.enum(['owned_accounts', 'accessible_accounts']).optional().default('owned_accounts'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input, actor: ActorContext) => {
        return runToolOperation(db, actor, 'mailbox_connection_start', input, async () => {
          const userId = await getActorUserId(db, actor);
          if (!userId) {
            throw new Error('A human-linked user is required to connect a mailbox. Use a user API key/session, or ask the human mailbox owner to connect it.');
          }
          const user = await db.query('SELECT email, name FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1', [actor.tenant_id, userId]);
          const email = String(input.email_address ?? user.rows[0]?.email ?? '').trim().toLowerCase();
          if (!email || !email.includes('@')) throw new Error('A valid mailbox email address is required.');
          const contextSyncEnabled = input.context_sync_enabled !== false;
          const sendEnabled = input.send_enabled !== false;
          const providerDraftEnabled = input.provider_draft_enabled !== false;
          const isDefaultSender = input.is_default_sender !== false && sendEnabled;
          const accountIngestScope = input.account_ingest_scope === 'accessible_accounts' ? 'accessible_accounts' : 'owned_accounts';
          const setupCheck = await oauthReadiness(db, actor.tenant_id, 'mailbox', input.provider);
          let connection = await emailMessageRepo.createPlaceholderConnection(db, actor.tenant_id, {
            user_id: userId,
            provider: input.provider,
            email_address: email,
            display_name: String(input.display_name ?? user.rows[0]?.name ?? ''),
            status: 'configuration_required',
            last_error: null,
            context_sync_enabled: contextSyncEnabled,
            send_enabled: sendEnabled,
            provider_draft_enabled: providerDraftEnabled,
            send_status: sendEnabled ? 'not_authorized' : 'disabled',
            is_default_sender: isDefaultSender,
            settings: {
              setup_required: true,
              account_ingest_scope: accountIngestScope,
              setup_started_from: 'mcp',
              next_step: 'Open the returned auth_url in a browser to finish mailbox OAuth.',
            },
          });
          const authUrl = setupCheck.can_start_oauth
            ? await buildOAuthUrl(db, 'mailbox', input.provider, {
                kind: 'mailbox',
                provider: input.provider,
                tenant_id: actor.tenant_id,
                user_id: userId,
                email_address: email,
                display_name: String(input.display_name ?? user.rows[0]?.name ?? ''),
                context_sync_enabled: contextSyncEnabled,
                account_ingest_scope: accountIngestScope,
                send_enabled: sendEnabled,
                provider_draft_enabled: providerDraftEnabled,
                is_default_sender: isDefaultSender,
              })
            : null;
          if (!authUrl) {
            connection = await emailMessageRepo.updateMailboxConnection(db, actor.tenant_id, connection.id, {
              last_error: setupCheck.setup_blockers[0] ?? 'Mailbox OAuth setup is not ready yet.',
              settings: {
                setup_required: true,
                oauth_configured: false,
                oauth_ready: false,
                oauth_setup_status: setupCheck.setup_status,
                oauth_setup_blockers: setupCheck.setup_blockers,
                oauth_app_source: setupCheck.app_source,
                oauth_redirect_uri: setupCheck.redirect_uri,
                account_ingest_scope: accountIngestScope,
              },
            }) ?? connection;
          }
          return {
            connection,
            auth_url: authUrl,
            oauth_ready: Boolean(authUrl),
            setup_check: setupCheck,
            status: authUrl ? 'oauth_required' : 'configuration_required',
            message: authUrl
              ? 'Open auth_url in a browser, finish provider consent, then return here and list mailbox connections to confirm status=connected.'
              : setupCheck.user_action,
            mutation: mutationReceipt(actor, { objectType: 'mailbox_connection', objectId: connection.id }),
          };
        });
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
        contact_id: z.string().uuid().optional(),
        account_id: z.string().uuid().optional(),
        opportunity_id: z.string().uuid().optional(),
        use_case_id: z.string().uuid().optional(),
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
          contact_id: input.contact_id,
          account_id: input.account_id,
          opportunity_id: input.opportunity_id,
          use_case_id: input.use_case_id,
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
      inputSchema: z.object({ id: z.string().uuid(), idempotency_key: z.string().max(128).optional() }),
      handler: async (input: { id: string; idempotency_key?: string }, actor: ActorContext) => {
        return runToolOperation(db, actor, 'email_message_process', input, async () => {
          const message = await emailMessageRepo.getEmailMessage(db, actor.tenant_id, input.id);
          if (!message) throw notFound('EmailMessage', input.id);
          await assertEmailMessageAccess(db, actor, message);
          return processEmailMessage(db, actor.tenant_id, message.id, actor);
        });
      },
    },
    {
      name: 'email_message_ignore',
      tier: 'extended',
      description: 'Ignore a customer email message so it no longer appears in review queues.',
      inputSchema: z.object({ id: z.string().uuid(), reason: z.string().optional(), idempotency_key: z.string().max(128).optional() }),
      handler: async (input: { id: string; reason?: string; idempotency_key?: string }, actor: ActorContext) => {
        return runToolOperation(db, actor, 'email_message_ignore', input, async () => {
          const message = await emailMessageRepo.getEmailMessage(db, actor.tenant_id, input.id);
          if (!message) throw notFound('EmailMessage', input.id);
          await assertEmailMessageAccess(db, actor, message);
          const updated = await emailMessageRepo.updateEmailMessage(db, actor.tenant_id, message.id, {
            processing_status: 'ignored',
            processing_reason: input.reason ?? 'Ignored by user.',
            ignored_at: new Date().toISOString(),
          });
          return {
            email_message: updated,
            mutation: mutationReceipt(actor, {
              objectType: 'email_message',
              objectId: message.id,
            }),
          };
        });
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
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input: {
        id: string;
        classification?: emailMessageRepo.EmailClassification;
        contact_id?: string | null;
        account_id?: string | null;
        opportunity_id?: string | null;
        use_case_id?: string | null;
        process?: boolean;
        idempotency_key?: string;
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
      description: 'Generate a customer email draft preview from CRMy Memory, relevant Signals, source email context, linked revenue records, and the selected sender identity. This does not save or send email; use email_draft_save after review.',
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
      description: 'Save a reviewed customer email draft, request approval, create a provider draft, or explicitly send now through CRMy governed email flow. Sends use the actor mailbox when send-enabled, otherwise the tenant fallback provider; no sender means save-draft only. After provider delivery, CRMy records the sent email as account activity and CRMy-authored context.',
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
        'Configure the tenant fallback/shared provider for outbound email delivery when an actor mailbox sender is unavailable, and for sequence or system-generated emails. ' +
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
	        'Get the tenant fallback/shared sending provider configuration. ' +
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
