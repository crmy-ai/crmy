// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { emailCreate, emailGet, emailSearch } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as emailRepo from '../../db/repos/emails.js';
import * as hitlRepo from '../../db/repos/hitl.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

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
  ];
}
