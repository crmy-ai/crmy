// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext, UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as emailRepo from '../db/repos/emails.js';
import * as emailMessageRepo from '../db/repos/email-messages.js';
import { getActorUserId } from '../services/access-control.js';

export interface ResolvedEmailSender {
  sender_type: 'actor_mailbox' | 'tenant_provider' | 'unknown';
  from_email?: string | null;
  from_name?: string | null;
  mailbox_connection_id?: UUID | null;
  provider?: string | null;
  can_send: boolean;
  can_provider_draft: boolean;
  reason: string;
  reply_handling: string;
}

function mailboxFromIdentity(connection: emailMessageRepo.MailboxConnection): { from_email: string; from_name?: string | null; aliasSelected: boolean } {
  const selectedEmail = typeof connection.settings?.selected_send_as_email === 'string'
    ? connection.settings.selected_send_as_email.trim().toLowerCase()
    : '';
  const aliases = Array.isArray(connection.settings?.send_as_aliases)
    ? connection.settings.send_as_aliases as Array<Record<string, unknown>>
    : [];
  const selectedAlias = selectedEmail
    ? aliases.find(alias => String(alias.email_address ?? '').trim().toLowerCase() === selectedEmail)
    : undefined;
  return {
    from_email: selectedAlias ? selectedEmail : connection.email_address,
    from_name: typeof selectedAlias?.display_name === 'string' && selectedAlias.display_name.trim()
      ? selectedAlias.display_name.trim()
      : typeof connection.settings?.selected_send_as_name === 'string' && connection.settings.selected_send_as_name.trim()
      ? connection.settings.selected_send_as_name.trim()
      : connection.display_name,
    aliasSelected: Boolean(selectedAlias && selectedEmail !== connection.email_address.toLowerCase()),
  };
}

export async function resolveEmailSender(db: DbPool, actor: ActorContext): Promise<ResolvedEmailSender> {
  const userId = await getActorUserId(db, actor);
  if (userId) {
    const mailboxes = await emailMessageRepo.listSendEnabledMailboxConnections(db, actor.tenant_id, userId);
    const defaultMailbox = mailboxes.find(connection => connection.is_default_sender);
    const selected = defaultMailbox ?? (mailboxes.length === 1 ? mailboxes[0] : null);
    if (selected) {
      const from = mailboxFromIdentity(selected);
      return {
        sender_type: 'actor_mailbox',
        from_email: from.from_email,
        from_name: from.from_name ?? undefined,
        mailbox_connection_id: selected.id,
        provider: selected.provider,
        can_send: true,
        can_provider_draft: selected.provider_draft_enabled,
        reason: from.aliasSelected
          ? `Selected because this verified send-as alias is configured on your ${selected.provider === 'google' ? 'Gmail' : 'mailbox'} sender.`
          : selected.is_default_sender
          ? 'Selected because this is your default send-enabled mailbox.'
          : 'Selected because this is your only send-enabled mailbox.',
        reply_handling: 'Replies sync back through this mailbox and are matched to the outbound thread before becoming customer context.',
      };
    }
  }

  const provider = await emailRepo.getProvider(db, actor.tenant_id);
  if (provider) {
    return {
      sender_type: 'tenant_provider',
      from_email: provider.from_email,
      from_name: provider.from_name,
      mailbox_connection_id: null,
      provider: provider.provider,
      can_send: true,
      can_provider_draft: false,
      reason: 'No send-enabled actor mailbox was available, so CRMy selected the tenant fallback sending provider.',
      reply_handling: 'Replies are only processed as context if they arrive through a connected mailbox or inbound webhook.',
    };
  }

  return {
    sender_type: 'unknown',
    from_email: null,
    from_name: null,
    mailbox_connection_id: null,
    provider: null,
    can_send: false,
    can_provider_draft: false,
    reason: 'No send-enabled mailbox or tenant fallback sending provider is configured.',
    reply_handling: 'Save as a CRMy draft until a mailbox sender or fallback provider is configured.',
  };
}

export function publicSender(sender: ResolvedEmailSender): ResolvedEmailSender {
  return { ...sender };
}
