// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { emailCreate, emailGet, emailSearch, emailProviderSet, emailProviderGet } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as emailRepo from '../../db/repos/emails.js';
import * as hitlRepo from '../../db/repos/hitl.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import { deliverEmail } from '../../email/delivery.js';
import { getEmailProvider, listEmailProviderTypes } from '../../email/providers/index.js';
import type { ToolDef } from '../server.js';

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

export function emailTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'email_create',
      description: 'Draft an outbound email linked to a contact. By default require_approval is true, which creates a HITL request for human review before sending — this is the recommended approach for high-stakes communications. Set require_approval to false only for routine, low-risk sends. The email is stored as a draft until approved.',
      inputSchema: emailCreate,
      handler: async (input: z.infer<typeof emailCreate>, actor: ActorContext) => {
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
          return { email: sent ?? email, event_id };
        }

        return { email, hitl_request_id: hitlRequestId, event_id };
      },
    },
    {
      name: 'email_get',
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

    // ── Provider configuration ─────────────────────────────────────────────

    {
      name: 'email_provider_set',
      description:
        'Configure the tenant\'s email provider for outbound email delivery. ' +
        'Required: provider type, config object, from_name, from_email. ' +
        'SMTP config requires: host, port, auth.user, auth.pass (optional: secure). ' +
        'Resend config requires: api_key. ' +
        'Postmark config requires: server_token (optional: message_stream, defaults to "outbound"). ' +
        'This overwrites any existing provider config for the tenant.',
      inputSchema: emailProviderSet,
      handler: async (input: z.infer<typeof emailProviderSet>, actor: ActorContext) => {
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

        return { ...result, config: redactProviderConfig(input.provider, result.config) };
      },
    },
    {
      name: 'email_provider_get',
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
