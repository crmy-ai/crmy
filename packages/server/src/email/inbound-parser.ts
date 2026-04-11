// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Provider-specific inbound email payload parsers.
 *
 * Normalises the raw webhook body from SendGrid, Postmark, and Mailgun
 * into a common `InboundEmail` shape that the route handler consumes.
 */

export interface InboundEmail {
  from_email: string;
  from_name?: string;
  to_email: string;
  subject: string;
  text_body: string;
  html_body?: string;
  /** Value of the In-Reply-To header, if present */
  in_reply_to?: string;
  /** ISO timestamp of when the message was received */
  received_at: string;
}

// ── SendGrid ─────────────────────────────────────────────────────────────────

interface SendGridPayload {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  headers?: string;
  timestamp?: string;
}

function parseFromHeader(from: string): { email: string; name?: string } {
  // "Display Name <email@example.com>"  or  "email@example.com"
  const match = from.match(/^(.*?)\s*<([^>]+)>/);
  if (match) return { name: match[1].trim() || undefined, email: match[2].trim() };
  return { email: from.trim() };
}

function extractInReplyTo(headers: string): string | undefined {
  const match = headers.match(/^In-Reply-To:\s*(.+)$/im);
  return match ? match[1].trim() : undefined;
}

export function parseSendGrid(body: SendGridPayload): InboundEmail {
  const from = parseFromHeader(body.from ?? '');
  const to = (body.to ?? '').replace(/.*<([^>]+)>/, '$1').trim();
  return {
    from_email: from.email,
    from_name: from.name,
    to_email: to || (body.to ?? ''),
    subject: body.subject ?? '(no subject)',
    text_body: body.text ?? '',
    html_body: body.html,
    in_reply_to: body.headers ? extractInReplyTo(body.headers) : undefined,
    received_at: body.timestamp
      ? new Date(parseInt(body.timestamp, 10) * 1000).toISOString()
      : new Date().toISOString(),
  };
}

// ── Postmark ─────────────────────────────────────────────────────────────────

interface PostmarkPayload {
  From?: string;
  To?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  Headers?: Array<{ Name: string; Value: string }>;
  Date?: string;
}

export function parsePostmark(body: PostmarkPayload): InboundEmail {
  const from = parseFromHeader(body.From ?? '');
  const to = (body.To ?? '').replace(/.*<([^>]+)>/, '$1').trim();
  const inReplyTo = body.Headers?.find((h) => h.Name === 'In-Reply-To')?.Value;
  return {
    from_email: from.email,
    from_name: from.name,
    to_email: to || (body.To ?? ''),
    subject: body.Subject ?? '(no subject)',
    text_body: body.TextBody ?? '',
    html_body: body.HtmlBody,
    in_reply_to: inReplyTo,
    received_at: body.Date ? new Date(body.Date).toISOString() : new Date().toISOString(),
  };
}

// ── Mailgun ───────────────────────────────────────────────────────────────────

interface MailgunPayload {
  sender?: string;
  from?: string;
  recipient?: string;
  subject?: string;
  'body-plain'?: string;
  'body-html'?: string;
  'In-Reply-To'?: string;
  Date?: string;
  timestamp?: string;
}

export function parseMailgun(body: MailgunPayload): InboundEmail {
  const rawFrom = body.from ?? body.sender ?? '';
  const from = parseFromHeader(rawFrom);
  const to = (body.recipient ?? '').split(',')[0].trim();
  const ts = body.timestamp
    ? new Date(parseInt(body.timestamp, 10) * 1000).toISOString()
    : body.Date
      ? new Date(body.Date).toISOString()
      : new Date().toISOString();
  return {
    from_email: from.email,
    from_name: from.name,
    to_email: to,
    subject: body.subject ?? '(no subject)',
    text_body: body['body-plain'] ?? '',
    html_body: body['body-html'],
    in_reply_to: body['In-Reply-To'],
    received_at: ts,
  };
}

// ── Auto-detect ───────────────────────────────────────────────────────────────

/**
 * Try to detect the provider from payload shape and parse accordingly.
 * Returns null if the payload is unrecognisable.
 */
export function parseInboundEmail(body: Record<string, unknown>): InboundEmail | null {
  // Postmark: has PascalCase keys like "From", "TextBody"
  if (typeof body['From'] === 'string' || typeof body['TextBody'] === 'string') {
    return parsePostmark(body as PostmarkPayload);
  }
  // Mailgun: has 'body-plain' or 'sender'
  if (typeof body['body-plain'] === 'string' || typeof body['sender'] === 'string') {
    return parseMailgun(body as MailgunPayload);
  }
  // SendGrid: has lowercase 'from', 'text', 'headers'
  if (typeof body['from'] === 'string' || typeof body['text'] === 'string') {
    return parseSendGrid(body as SendGridPayload);
  }
  return null;
}
