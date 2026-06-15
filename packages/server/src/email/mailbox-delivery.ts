// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as emailRepo from '../db/repos/emails.js';
import * as emailMessageRepo from '../db/repos/email-messages.js';
import { mailboxAccessToken } from '../services/source-sync.js';

interface MailboxSendResult {
  success: boolean;
  provider_msg_id?: string;
  message_id?: string;
  thread_id?: string;
  error?: string;
  retryable?: boolean;
}

function encodeMimeHeader(value: string | undefined | null): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function address(name: string | undefined | null, email: string | undefined | null): string {
  const cleanEmail = encodeMimeHeader(email);
  const cleanName = encodeMimeHeader(name);
  return cleanName ? `"${cleanName.replace(/"/g, '\\"')}" <${cleanEmail}>` : cleanEmail;
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function outboundMessageId(email: emailRepo.EmailRow): string {
  const fromDomain = String(email.from_email ?? email.to_email ?? 'local').split('@')[1]?.toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'local';
  return `<crmy-${email.id}@${fromDomain}>`;
}

class MailboxProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }

  get retryable(): boolean {
    return this.status === 429 || (typeof this.status === 'number' && this.status >= 500);
  }

  get authorizationFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

function buildRawMessage(
  email: emailRepo.EmailRow,
  sender: emailMessageRepo.MailboxConnection,
  source?: emailMessageRepo.EmailMessage | null,
): string {
  const messageId = outboundMessageId(email);
  const headers = [
    `From: ${address(email.from_name ?? sender.display_name, email.from_email ?? sender.email_address)}`,
    `To: ${address(email.to_name, email.to_email)}`,
    `Subject: ${encodeMimeHeader(email.subject)}`,
    `Message-ID: ${messageId}`,
    `X-CRMy-Email-ID: ${encodeMimeHeader(email.id)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
  ];
  const replyId = source?.message_id ?? source?.provider_message_id;
  if (replyId) headers.push(`In-Reply-To: ${encodeMimeHeader(replyId)}`);
  const references = [...(source?.references_header ?? []), replyId].filter(Boolean);
  if (references.length > 0) headers.push(`References: ${references.map(encodeMimeHeader).join(' ')}`);
  return `${headers.join('\r\n')}\r\n\r\n${email.body_text}`;
}

async function fetchJson(url: string, token: string, init: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let body: any = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 500) };
      }
    }
    if (!response.ok) {
      throw new MailboxProviderError(
        body?.error?.message ?? body?.error_description ?? `Mailbox provider request failed (${response.status})`,
        response.status,
      );
    }
    return body;
  } catch (err) {
    if (err instanceof MailboxProviderError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MailboxProviderError('Mailbox provider request timed out', 504);
    }
    throw new MailboxProviderError(err instanceof Error ? err.message : 'Mailbox provider request failed');
  } finally {
    clearTimeout(timer);
  }
}

export async function sendWithMailbox(
  db: DbPool,
  tenantId: UUID,
  email: emailRepo.EmailRow,
): Promise<MailboxSendResult> {
  if (!email.mailbox_connection_id) return { success: false, error: 'Email has no mailbox sender connection.' };
  const sender = await emailMessageRepo.getMailboxConnection(db, tenantId, email.mailbox_connection_id);
  if (!sender || !sender.send_enabled || sender.send_status !== 'ready') {
    return { success: false, error: 'Mailbox sender is not send-enabled. Reauthorize the mailbox with send permissions.' };
  }
  const source = email.source_email_message_id
    ? await emailMessageRepo.getEmailMessage(db, tenantId, email.source_email_message_id)
    : null;
  try {
    const token = await mailboxAccessToken(db, sender);
    if (sender.provider === 'google') {
      const body = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', token, {
        method: 'POST',
        body: JSON.stringify({
          raw: base64url(buildRawMessage(email, sender, source)),
          ...(source?.thread_id ? { threadId: source.thread_id } : {}),
        }),
      });
      return {
        success: true,
        provider_msg_id: String(body.id ?? ''),
        message_id: outboundMessageId(email),
        thread_id: body.threadId ? String(body.threadId) : undefined,
      };
    }
    if (sender.provider === 'microsoft') {
      const messageId = outboundMessageId(email);
      const references = [...(source?.references_header ?? []), source?.message_id ?? source?.provider_message_id].filter(Boolean);
      await fetchJson('https://graph.microsoft.com/v1.0/me/sendMail', token, {
        method: 'POST',
        body: JSON.stringify({
          message: {
            subject: email.subject,
            body: { contentType: 'Text', content: email.body_text },
            toRecipients: [{ emailAddress: { address: email.to_email, name: email.to_name } }],
            internetMessageHeaders: [
              { name: 'Message-ID', value: messageId },
              { name: 'X-CRMy-Email-ID', value: email.id },
              ...(source?.message_id ? [{ name: 'In-Reply-To', value: source.message_id }] : []),
              ...(references.length > 0 ? [{ name: 'References', value: references.join(' ') }] : []),
            ],
          },
          saveToSentItems: true,
        }),
      });
      return { success: true, provider_msg_id: `graph-send:${email.id}`, message_id: messageId, thread_id: source?.thread_id ?? undefined };
    }
    return { success: false, error: `Mailbox provider ${sender.provider} does not support outbound send.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Mailbox send failed';
    const retryable = err instanceof MailboxProviderError ? err.retryable : false;
    const authorizationFailure = err instanceof MailboxProviderError ? err.authorizationFailure : false;
    await emailMessageRepo.updateMailboxConnection(db, tenantId, sender.id, {
      ...(authorizationFailure ? { send_status: 'error' as const } : {}),
      send_last_error: message.slice(0, 500),
    });
    return { success: false, error: message, retryable };
  }
}

export async function createMailboxDraft(
  db: DbPool,
  tenantId: UUID,
  email: emailRepo.EmailRow,
): Promise<{ status: 'created' | 'unsupported_capability'; provider_draft_id?: string; message?: string }> {
  if (!email.mailbox_connection_id) return { status: 'unsupported_capability', message: 'No mailbox sender selected.' };
  const sender = await emailMessageRepo.getMailboxConnection(db, tenantId, email.mailbox_connection_id);
  if (!sender || !sender.provider_draft_enabled || sender.send_status !== 'ready') {
    return { status: 'unsupported_capability', message: 'Selected sender does not support provider drafts.' };
  }
  const source = email.source_email_message_id
    ? await emailMessageRepo.getEmailMessage(db, tenantId, email.source_email_message_id)
    : null;
  try {
    const token = await mailboxAccessToken(db, sender);
    if (sender.provider === 'google') {
      const body = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/drafts', token, {
        method: 'POST',
        body: JSON.stringify({
          message: {
            raw: base64url(buildRawMessage(email, sender, source)),
            ...(source?.thread_id ? { threadId: source.thread_id } : {}),
          },
        }),
      });
      return { status: 'created', provider_draft_id: String(body.id ?? '') };
    }
    if (sender.provider === 'microsoft') {
      const references = [...(source?.references_header ?? []), source?.message_id ?? source?.provider_message_id].filter(Boolean);
      const body = await fetchJson('https://graph.microsoft.com/v1.0/me/messages', token, {
        method: 'POST',
        body: JSON.stringify({
          subject: email.subject,
          body: { contentType: 'Text', content: email.body_text },
          toRecipients: [{ emailAddress: { address: email.to_email, name: email.to_name } }],
          internetMessageHeaders: [
            { name: 'Message-ID', value: outboundMessageId(email) },
            { name: 'X-CRMy-Email-ID', value: email.id },
            ...(source?.message_id ? [{ name: 'In-Reply-To', value: source.message_id }] : []),
            ...(references.length > 0 ? [{ name: 'References', value: references.join(' ') }] : []),
          ],
        }),
      });
      return { status: 'created', provider_draft_id: String(body.id ?? '') };
    }
    return { status: 'unsupported_capability', message: `Mailbox provider ${sender.provider} does not support provider drafts.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Provider draft creation failed';
    const authorizationFailure = err instanceof MailboxProviderError ? err.authorizationFailure : false;
    await emailMessageRepo.updateMailboxConnection(db, tenantId, sender.id, {
      ...(authorizationFailure ? { send_status: 'error' as const } : {}),
      send_last_error: message.slice(0, 500),
    });
    throw err;
  }
}
