// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import type { EmailClassification } from '../db/repos/email-messages.js';

export interface SourceFilterSettings {
  tenant_id?: UUID;
  internal_domains: string[];
  excluded_domains: string[];
  excluded_senders: string[];
  excluded_local_parts: string[];
  included_mailbox_labels: string[];
  excluded_mailbox_labels: string[];
  skip_spam_trash: boolean;
  skip_promotions: boolean;
  skip_newsletters: boolean;
  include_internal_calendar: boolean;
  email_initial_backfill_days: number;
  calendar_initial_past_days: number;
  calendar_initial_future_days: number;
  derived_internal_domains?: string[];
}

export interface EmailSourceCandidate {
  from_email?: string | null;
  to_emails?: string[];
  cc_emails?: string[];
  subject?: string | null;
  body_text?: string | null;
  headers?: Record<string, string | string[] | undefined>;
  mailbox_labels?: string[];
  folder?: string | null;
}

export interface CalendarSourceCandidate {
  organizer_email?: string | null;
  attendee_emails?: string[];
  title?: string | null;
}

export type SourceFilterReason =
  | 'customer'
  | 'mixed'
  | 'internal'
  | 'automated'
  | 'spam_trash'
  | 'newsletter'
  | 'excluded_domain'
  | 'excluded_sender'
  | 'unknown';

export interface SourceFilterDecision {
  keep: boolean;
  reason: SourceFilterReason;
  classification: EmailClassification;
  message: string;
}

const DEFAULT_LOCAL_PARTS = [
  'no-reply',
  'noreply',
  'donotreply',
  'do-not-reply',
  'notifications',
  'notification',
  'mailer-daemon',
  'postmaster',
];

const SPAM_TRASH_LABELS = new Set([
  'spam',
  'trash',
  'junk',
  'deleteditems',
  'deleted items',
  'deleted',
]);

const PROMOTION_LABELS = new Set([
  'category_promotions',
  'promotions',
  'bulk',
  'clutter',
]);

function arrayOfStrings(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : fallback;
}

function normalizeDomain(value: string | undefined | null): string | null {
  const raw = value?.includes('@') ? value.split('@').pop() : value;
  const domain = raw?.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
  return domain || null;
}

function normalizeEmail(value: string | undefined | null): string | null {
  const email = value?.trim().toLowerCase();
  return email && email.includes('@') ? email : null;
}

function localPart(email: string | undefined | null): string {
  return normalizeEmail(email)?.split('@')[0] ?? '';
}

function uniq(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(value => value?.trim().toLowerCase()).filter((value): value is string => Boolean(value)))];
}

function rowToSettings(row: Record<string, unknown> | undefined, derivedInternal: string[]): SourceFilterSettings {
  return {
    tenant_id: row?.tenant_id as UUID | undefined,
    internal_domains: uniq([...(arrayOfStrings(row?.internal_domains)), ...derivedInternal]),
    excluded_domains: uniq(arrayOfStrings(row?.excluded_domains)),
    excluded_senders: uniq(arrayOfStrings(row?.excluded_senders)),
    excluded_local_parts: uniq(arrayOfStrings(row?.excluded_local_parts, DEFAULT_LOCAL_PARTS)),
    included_mailbox_labels: uniq(arrayOfStrings(row?.included_mailbox_labels)),
    excluded_mailbox_labels: uniq(arrayOfStrings(row?.excluded_mailbox_labels)),
    skip_spam_trash: row?.skip_spam_trash !== false,
    skip_promotions: row?.skip_promotions !== false,
    skip_newsletters: row?.skip_newsletters !== false,
    include_internal_calendar: row?.include_internal_calendar === true,
    email_initial_backfill_days: Number(row?.email_initial_backfill_days ?? 30),
    calendar_initial_past_days: Number(row?.calendar_initial_past_days ?? 45),
    calendar_initial_future_days: Number(row?.calendar_initial_future_days ?? 30),
    derived_internal_domains: derivedInternal,
  };
}

export async function deriveTenantInternalDomains(db: DbPool, tenantId: UUID): Promise<string[]> {
  const result = await db.query(
    `SELECT lower(split_part(email, '@', 2)) AS domain
     FROM users
     WHERE tenant_id = $1 AND email LIKE '%@%'
     UNION
     SELECT lower(unnest(internal_domains)) AS domain
     FROM email_providers
     WHERE tenant_id = $1`,
    [tenantId],
  );
  return uniq(result.rows.map(row => normalizeDomain(String(row.domain ?? ''))));
}

export async function getSourceFilterSettings(db: DbPool, tenantId: UUID): Promise<SourceFilterSettings> {
  const [settings, derivedInternal] = await Promise.all([
    db.query('SELECT * FROM source_filter_settings WHERE tenant_id = $1', [tenantId]),
    deriveTenantInternalDomains(db, tenantId),
  ]);
  return rowToSettings(settings.rows[0], derivedInternal);
}

export async function updateSourceFilterSettings(
  db: DbPool,
  tenantId: UUID,
  patch: Partial<Omit<SourceFilterSettings, 'tenant_id' | 'derived_internal_domains'>>,
): Promise<SourceFilterSettings> {
  const current = await getSourceFilterSettings(db, tenantId);
  const next = {
    ...current,
    ...patch,
    internal_domains: patch.internal_domains ? uniq(patch.internal_domains) : current.internal_domains,
    excluded_domains: patch.excluded_domains ? uniq(patch.excluded_domains) : current.excluded_domains,
    excluded_senders: patch.excluded_senders ? uniq(patch.excluded_senders) : current.excluded_senders,
    excluded_local_parts: patch.excluded_local_parts ? uniq(patch.excluded_local_parts) : current.excluded_local_parts,
    included_mailbox_labels: patch.included_mailbox_labels ? uniq(patch.included_mailbox_labels) : current.included_mailbox_labels,
    excluded_mailbox_labels: patch.excluded_mailbox_labels ? uniq(patch.excluded_mailbox_labels) : current.excluded_mailbox_labels,
  };
  const result = await db.query(
    `INSERT INTO source_filter_settings (
       tenant_id, internal_domains, excluded_domains, excluded_senders, excluded_local_parts,
       included_mailbox_labels, excluded_mailbox_labels, skip_spam_trash, skip_promotions,
       skip_newsletters, include_internal_calendar, email_initial_backfill_days,
       calendar_initial_past_days, calendar_initial_future_days
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (tenant_id)
     DO UPDATE SET
       internal_domains = EXCLUDED.internal_domains,
       excluded_domains = EXCLUDED.excluded_domains,
       excluded_senders = EXCLUDED.excluded_senders,
       excluded_local_parts = EXCLUDED.excluded_local_parts,
       included_mailbox_labels = EXCLUDED.included_mailbox_labels,
       excluded_mailbox_labels = EXCLUDED.excluded_mailbox_labels,
       skip_spam_trash = EXCLUDED.skip_spam_trash,
       skip_promotions = EXCLUDED.skip_promotions,
       skip_newsletters = EXCLUDED.skip_newsletters,
       include_internal_calendar = EXCLUDED.include_internal_calendar,
       email_initial_backfill_days = EXCLUDED.email_initial_backfill_days,
       calendar_initial_past_days = EXCLUDED.calendar_initial_past_days,
       calendar_initial_future_days = EXCLUDED.calendar_initial_future_days,
       updated_at = now()
     RETURNING *`,
    [
      tenantId,
      next.internal_domains,
      next.excluded_domains,
      next.excluded_senders,
      next.excluded_local_parts,
      next.included_mailbox_labels,
      next.excluded_mailbox_labels,
      next.skip_spam_trash,
      next.skip_promotions,
      next.skip_newsletters,
      next.include_internal_calendar,
      next.email_initial_backfill_days,
      next.calendar_initial_past_days,
      next.calendar_initial_future_days,
    ],
  );
  return rowToSettings(result.rows[0], next.derived_internal_domains ?? []);
}

function participants(candidate: EmailSourceCandidate | CalendarSourceCandidate): string[] {
  if ('from_email' in candidate || 'to_emails' in candidate || 'cc_emails' in candidate) {
    const emailCandidate = candidate as EmailSourceCandidate;
    return uniq([
      emailCandidate.from_email ?? undefined,
      ...(emailCandidate.to_emails ?? []),
      ...(emailCandidate.cc_emails ?? []),
    ]);
  }
  const calendarCandidate = candidate as CalendarSourceCandidate;
  return uniq([
    calendarCandidate.organizer_email ?? undefined,
    ...(calendarCandidate.attendee_emails ?? []),
  ]);
}

function hasNewsletterSignal(candidate: EmailSourceCandidate): boolean {
  const headers = candidate.headers ?? {};
  const headerKeys = Object.keys(headers).map(key => key.toLowerCase());
  if (headerKeys.some(key => ['list-id', 'list-unsubscribe', 'precedence', 'x-campaign-id'].includes(key))) return true;
  const subject = `${candidate.subject ?? ''}`.toLowerCase();
  return /\b(newsletter|digest|unsubscribe|marketing update|webinar invite)\b/.test(subject);
}

function labelSet(candidate: EmailSourceCandidate): Set<string> {
  return new Set([
    ...(candidate.mailbox_labels ?? []),
    candidate.folder ?? '',
  ].map(label => label.trim().toLowerCase()).filter(Boolean));
}

export function classifySourceParticipants(
  settings: SourceFilterSettings,
  emails: string[],
): { classification: EmailClassification; internalCount: number; externalCount: number; domains: string[] } {
  const internalDomains = new Set(settings.internal_domains.map(domain => domain.toLowerCase()));
  const domains = uniq(emails.map(email => normalizeDomain(email)));
  const internalCount = domains.filter(domain => internalDomains.has(domain)).length;
  const externalCount = domains.length - internalCount;
  if (externalCount === 0 && internalCount > 0) return { classification: 'internal', internalCount, externalCount, domains };
  if (externalCount > 0 && internalCount > 0) return { classification: 'mixed', internalCount, externalCount, domains };
  if (externalCount > 0) return { classification: 'customer', internalCount, externalCount, domains };
  return { classification: 'unknown', internalCount, externalCount, domains };
}

export function shouldKeepEmailSource(
  settings: SourceFilterSettings,
  candidate: EmailSourceCandidate,
): SourceFilterDecision {
  const emails = participants(candidate);
  const labels = labelSet(candidate);
  const sender = normalizeEmail(candidate.from_email);
  const senderDomain = normalizeDomain(candidate.from_email);
  const excludedDomains = new Set(settings.excluded_domains);
  const excludedSenders = new Set(settings.excluded_senders.map(email => email.toLowerCase()));
  const excludedLocals = new Set(settings.excluded_local_parts.map(part => part.toLowerCase()));

  if (settings.included_mailbox_labels.length > 0) {
    const allowed = settings.included_mailbox_labels.some(label => labels.has(label.toLowerCase()));
    if (!allowed) {
      return { keep: false, reason: 'unknown', classification: 'unknown', message: 'Mailbox label is not included for customer context sync.' };
    }
  }
  if (settings.excluded_mailbox_labels.some(label => labels.has(label.toLowerCase()))) {
    return { keep: false, reason: 'unknown', classification: 'unknown', message: 'Mailbox label is excluded from context sync.' };
  }
  if (settings.skip_spam_trash && [...labels].some(label => SPAM_TRASH_LABELS.has(label))) {
    return { keep: false, reason: 'spam_trash', classification: 'automated', message: 'Spam, junk, or trash message filtered before storage.' };
  }
  if (settings.skip_promotions && [...labels].some(label => PROMOTION_LABELS.has(label))) {
    return { keep: false, reason: 'newsletter', classification: 'automated', message: 'Promotional or bulk mailbox category filtered before storage.' };
  }
  if (settings.skip_newsletters && hasNewsletterSignal(candidate)) {
    return { keep: false, reason: 'newsletter', classification: 'automated', message: 'Newsletter-style message filtered before storage.' };
  }
  if (sender && excludedSenders.has(sender)) {
    return { keep: false, reason: 'excluded_sender', classification: 'automated', message: 'Sender is excluded from context sync.' };
  }
  if (senderDomain && excludedDomains.has(senderDomain)) {
    return { keep: false, reason: 'excluded_domain', classification: 'automated', message: 'Sender domain is excluded from context sync.' };
  }
  if (excludedLocals.has(localPart(candidate.from_email))) {
    return { keep: false, reason: 'automated', classification: 'automated', message: 'Automated sender filtered before storage.' };
  }
  const anyExcludedParticipant = emails.map(normalizeDomain).some(domain => domain && excludedDomains.has(domain));
  if (anyExcludedParticipant) {
    return { keep: false, reason: 'excluded_domain', classification: 'automated', message: 'Participant domain is excluded from context sync.' };
  }

  const source = classifySourceParticipants(settings, emails);
  if (source.classification === 'internal') {
    return { keep: false, reason: 'internal', classification: 'internal', message: 'Internal-only email filtered before storage.' };
  }
  if (source.classification === 'customer' || source.classification === 'mixed') {
    return {
      keep: true,
      reason: source.classification,
      classification: source.classification,
      message: source.classification === 'mixed'
        ? 'Customer-facing thread with internal participants.'
        : 'Customer participant detected.',
    };
  }
  return { keep: false, reason: 'unknown', classification: 'unknown', message: 'Email could not be tied to customer-facing participants.' };
}

export function shouldKeepCalendarEventSource(
  settings: SourceFilterSettings,
  candidate: CalendarSourceCandidate,
): SourceFilterDecision {
  const emails = participants(candidate);
  const source = classifySourceParticipants(settings, emails);
  if (source.classification === 'internal' && !settings.include_internal_calendar) {
    return { keep: false, reason: 'internal', classification: 'internal', message: 'Internal-only meeting filtered before storage.' };
  }
  if (source.classification === 'customer' || source.classification === 'mixed') {
    return {
      keep: true,
      reason: source.classification,
      classification: source.classification,
      message: source.classification === 'mixed'
        ? 'Customer-facing meeting with internal participants.'
        : 'Customer attendee detected.',
    };
  }
  return settings.include_internal_calendar
    ? { keep: true, reason: 'unknown', classification: 'unknown', message: 'Meeting kept for review because internal-calendar inclusion is enabled.' }
    : { keep: false, reason: 'unknown', classification: 'unknown', message: 'Meeting could not be tied to customer-facing attendees.' };
}

export function sourceFilterStatKey(reason: SourceFilterReason): string {
  if (reason === 'customer' || reason === 'mixed') return 'customer_synced';
  if (reason === 'internal') return 'filtered_internal';
  if (reason === 'spam_trash') return 'filtered_spam_trash';
  if (reason === 'automated' || reason === 'newsletter' || reason === 'excluded_sender' || reason === 'excluded_domain') {
    return 'filtered_automated';
  }
  return 'filtered_unknown';
}
