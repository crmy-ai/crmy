// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext, UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as activityRepo from '../db/repos/activities.js';
import * as emailMessageRepo from '../db/repos/email-messages.js';
import * as rawContextRepo from '../db/repos/raw-context-sources.js';
import { extractContextFromActivity } from '../agent/extraction.js';
import { emitEvent } from '../events/emitter.js';
import { getActorUserId, getVisibleOwnerIds } from './access-control.js';
import { attachTranscriptEmailToMeeting } from './customer-activity.js';
import { handleSequenceReply } from './sequence-executor.js';

export interface NormalizedEmailInput {
  direction: 'inbound' | 'outbound';
  source: string;
  from_email: string;
  from_name?: string;
  to_emails: string[];
  cc_emails?: string[];
  subject: string;
  body_text?: string;
  body_html?: string;
  received_at?: string;
  sent_at?: string;
  provider_message_id?: string;
  message_id?: string;
  thread_id?: string;
  in_reply_to?: string;
  references_header?: string[];
  mailbox_connection_id?: string | null;
  user_id?: string | null;
  email_id?: string | null;
  contact_id?: string | null;
  account_id?: string | null;
  opportunity_id?: string | null;
  use_case_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EmailProcessingResult {
  message: emailMessageRepo.EmailMessage;
  activity_id?: string | null;
  raw_context_source_id?: string | null;
  classification: emailMessageRepo.EmailClassification;
  processing_status: emailMessageRepo.EmailProcessingStatus;
  processing_reason?: string | null;
  extraction?: {
    memory_created: number;
    signals_created: number;
    skipped: number;
  };
}

const AUTOMATED_LOCAL_PARTS = new Set([
  'no-reply',
  'noreply',
  'donotreply',
  'do-not-reply',
  'notifications',
  'notification',
  'mailer-daemon',
  'postmaster',
]);

function domainFromEmail(email: string | undefined | null): string | null {
  const domain = email?.split('@')[1];
  return domain ? domain.trim().toLowerCase().replace(/^www\./, '') : null;
}

function localPart(email: string): string {
  return email.split('@')[0]?.trim().toLowerCase() ?? '';
}

function truthyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function internalDomains(db: DbPool, tenantId: UUID): Promise<Set<string>> {
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
  return new Set(result.rows.map(row => String(row.domain ?? '').trim().toLowerCase()).filter(Boolean));
}

async function excludedDomains(db: DbPool, tenantId: UUID): Promise<Set<string>> {
  const result = await db.query(
    `SELECT lower(unnest(excluded_domains)) AS domain
     FROM email_providers
     WHERE tenant_id = $1`,
    [tenantId],
  );
  return new Set(result.rows.map(row => String(row.domain ?? '').trim().toLowerCase()).filter(Boolean));
}

async function classifyEmail(
  db: DbPool,
  tenantId: UUID,
  input: NormalizedEmailInput,
): Promise<{ classification: emailMessageRepo.EmailClassification; reason: string }> {
  const fromDomain = domainFromEmail(input.from_email);
  const recipientDomains = input.to_emails.map(domainFromEmail).filter((v): v is string => Boolean(v));
  const ccDomains = (input.cc_emails ?? []).map(domainFromEmail).filter((v): v is string => Boolean(v));
  const participantDomains = [fromDomain, ...recipientDomains, ...ccDomains].filter((v): v is string => Boolean(v));
  const internal = await internalDomains(db, tenantId);
  const excluded = await excludedDomains(db, tenantId);

  if (AUTOMATED_LOCAL_PARTS.has(localPart(input.from_email)) || participantDomains.some(domain => excluded.has(domain))) {
    return { classification: 'automated', reason: 'Automated sender or excluded domain.' };
  }

  const internalCount = participantDomains.filter(domain => internal.has(domain)).length;
  const externalCount = participantDomains.length - internalCount;
  if (externalCount === 0 && internalCount > 0) return { classification: 'internal', reason: 'Only internal participants were detected.' };
  if (externalCount > 0 && internalCount > 0) return { classification: 'mixed', reason: 'Customer-facing thread with internal participants.' };
  if (externalCount > 0) return { classification: 'customer', reason: 'External customer participant detected.' };
  return { classification: 'unknown', reason: 'Could not classify participants.' };
}

async function findAccountByDomain(
  db: DbPool,
  tenantId: UUID,
  domain: string | null,
  ownerIds?: UUID[] | null,
): Promise<{ id: string; name: string; owner_id?: string | null } | null> {
  if (!domain) return null;
  const params: unknown[] = [tenantId, domain];
  let ownerClause = '';
  if (ownerIds) {
    if (ownerIds.length === 0) return null;
    params.push(ownerIds);
    ownerClause = ` AND owner_id = ANY($${params.length}::uuid[])`;
  }
  const result = await db.query(
    `SELECT id, name, owner_id
     FROM accounts
     WHERE tenant_id = $1
       AND merged_into IS NULL
       AND lower(domain) = $2
       ${ownerClause}
     LIMIT 1`,
    params,
  );
  return result.rows[0] ?? null;
}

async function findContactByEmail(
  db: DbPool,
  tenantId: UUID,
  email: string,
  ownerIds?: UUID[] | null,
): Promise<{ id: string; account_id?: string | null; first_name?: string; last_name?: string; owner_id?: string | null } | null> {
  const params: unknown[] = [tenantId, email.trim().toLowerCase()];
  let ownerClause = '';
  if (ownerIds) {
    if (ownerIds.length === 0) return null;
    params.push(ownerIds);
    ownerClause = ` AND c.owner_id = ANY($${params.length}::uuid[])`;
  }
  const result = await db.query(
    `SELECT c.id, c.account_id, c.first_name, c.last_name, c.owner_id
     FROM contacts c
     WHERE c.tenant_id = $1 AND lower(c.email) = $2 AND c.merged_into IS NULL
       ${ownerClause}
     LIMIT 1`,
    params,
  );
  return result.rows[0] ?? null;
}

async function pickScopedOpportunity(
  db: DbPool,
  tenantId: UUID,
  accountId?: string | null,
  contactId?: string | null,
  ownerIds?: UUID[] | null,
): Promise<{ id: string; name: string } | null> {
  if (!accountId && !contactId) return null;
  const params: unknown[] = [tenantId];
  const conditions = [`o.tenant_id = $1`, `o.stage NOT IN ('closed_won','closed_lost')`];
  let idx = 2;
  if (accountId) {
    conditions.push(`o.account_id = $${idx++}`);
    params.push(accountId);
  }
  if (contactId) {
    conditions.push(`(o.contact_id = $${idx} OR o.contact_id IS NULL)`);
    params.push(contactId);
    idx++;
  }
  if (ownerIds) {
    if (ownerIds.length === 0) return null;
    conditions.push(`o.owner_id = ANY($${idx++}::uuid[])`);
    params.push(ownerIds);
  }
  const result = await db.query(
    `SELECT o.id, o.name
     FROM opportunities o
     WHERE ${conditions.join(' AND ')}
     ORDER BY o.close_date ASC NULLS LAST, o.updated_at DESC
     LIMIT 2`,
    params,
  );
  return result.rows.length === 1 ? result.rows[0] : null;
}

async function pickScopedUseCase(
  db: DbPool,
  tenantId: UUID,
  accountId?: string | null,
  opportunityId?: string | null,
  ownerIds?: UUID[] | null,
): Promise<{ id: string; name: string } | null> {
  if (!accountId && !opportunityId) return null;
  const params: unknown[] = [tenantId];
  const conditions = [`u.tenant_id = $1`, `u.stage NOT IN ('complete','closed','archived')`];
  let idx = 2;
  if (accountId) {
    conditions.push(`u.account_id = $${idx++}`);
    params.push(accountId);
  }
  if (opportunityId) {
    conditions.push(`(u.opportunity_id = $${idx} OR u.opportunity_id IS NULL)`);
    params.push(opportunityId);
    idx++;
  }
  if (ownerIds) {
    if (ownerIds.length === 0) return null;
    conditions.push(`u.owner_id = ANY($${idx++}::uuid[])`);
    params.push(ownerIds);
  }
  const result = await db.query(
    `SELECT u.id, u.name
     FROM use_cases u
     WHERE ${conditions.join(' AND ')}
     ORDER BY u.updated_at DESC
     LIMIT 2`,
    params,
  );
  return result.rows.length === 1 ? result.rows[0] : null;
}

async function associateEmail(
  db: DbPool,
  tenantId: UUID,
  input: NormalizedEmailInput,
  ownerIds?: UUID[] | null,
): Promise<{
  contact_id?: string | null;
  account_id?: string | null;
  opportunity_id?: string | null;
  use_case_id?: string | null;
  reason: string;
}> {
  if (input.contact_id || input.account_id || input.opportunity_id || input.use_case_id) {
    return {
      contact_id: input.contact_id ?? null,
      account_id: input.account_id ?? null,
      opportunity_id: input.opportunity_id ?? null,
      use_case_id: input.use_case_id ?? null,
      reason: 'Linked by explicit customer record.',
    };
  }

  const externalEmails = [input.from_email, ...input.to_emails, ...(input.cc_emails ?? [])]
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);

  for (const email of externalEmails) {
    const contact = await findContactByEmail(db, tenantId, email, ownerIds);
    if (contact) {
      const opportunity = await pickScopedOpportunity(db, tenantId, contact.account_id, contact.id, ownerIds);
      const useCase = await pickScopedUseCase(db, tenantId, contact.account_id, opportunity?.id, ownerIds);
      return {
        contact_id: contact.id,
        account_id: contact.account_id ?? null,
        opportunity_id: opportunity?.id ?? null,
        use_case_id: useCase?.id ?? null,
        reason: 'Matched by known contact email.',
      };
    }
  }

  const replyTarget = truthyString(input.in_reply_to) ?? input.references_header?.find(Boolean);
  if (replyTarget) {
    const reply = await db.query(
      `SELECT contact_id, account_id, opportunity_id, use_case_id
       FROM emails
       WHERE tenant_id = $1 AND provider_msg_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, replyTarget],
    );
    if (reply.rows[0]) {
      return { ...reply.rows[0], reason: 'Matched by reply chain to an outbound email.' };
    }
  }

  for (const email of externalEmails) {
    const account = await findAccountByDomain(db, tenantId, domainFromEmail(email), ownerIds);
    if (account) {
      const opportunity = await pickScopedOpportunity(db, tenantId, account.id, null, ownerIds);
      const useCase = await pickScopedUseCase(db, tenantId, account.id, opportunity?.id, ownerIds);
      return {
        account_id: account.id,
        opportunity_id: opportunity?.id ?? null,
        use_case_id: useCase?.id ?? null,
        reason: 'Matched by account email domain.',
      };
    }
  }

  return { reason: 'No matching customer record was found.' };
}

function primarySubject(linked: {
  contact_id?: string | null;
  account_id?: string | null;
  opportunity_id?: string | null;
  use_case_id?: string | null;
}): { subject_type?: 'account' | 'contact' | 'opportunity' | 'use_case'; subject_id?: string } {
  if (linked.opportunity_id) return { subject_type: 'opportunity', subject_id: linked.opportunity_id };
  if (linked.use_case_id) return { subject_type: 'use_case', subject_id: linked.use_case_id };
  if (linked.contact_id) return { subject_type: 'contact', subject_id: linked.contact_id };
  if (linked.account_id) return { subject_type: 'account', subject_id: linked.account_id };
  return {};
}

async function processingOwnerIds(db: DbPool, actor?: ActorContext): Promise<UUID[] | null | undefined> {
  if (!actor) return undefined;
  return getVisibleOwnerIds(db, actor);
}

export async function ingestEmailMessage(
  db: DbPool,
  tenantId: UUID,
  input: NormalizedEmailInput,
  actor?: ActorContext,
  options: { process?: boolean } = { process: true },
): Promise<EmailProcessingResult> {
  const ownerIds = await processingOwnerIds(db, actor);
  const classification = await classifyEmail(db, tenantId, input);
  const linked = await associateEmail(db, tenantId, input, ownerIds);
  const userId = input.user_id ?? (actor ? await getActorUserId(db, actor) : null);
  const shouldSkip = classification.classification === 'internal' || classification.classification === 'automated';
  const hasLinkedSubject = Boolean(linked.contact_id || linked.account_id || linked.opportunity_id || linked.use_case_id);

  const message = await emailMessageRepo.upsertEmailMessage(db, tenantId, {
    ...input,
    user_id: userId ?? null,
    classification: classification.classification,
    processing_status: shouldSkip ? 'skipped' : hasLinkedSubject ? 'unprocessed' : 'needs_review',
    processing_reason: shouldSkip
      ? classification.reason
      : hasLinkedSubject
        ? linked.reason
        : 'No linked customer record. Review matching before processing.',
    contact_id: linked.contact_id ?? null,
    account_id: linked.account_id ?? null,
    opportunity_id: linked.opportunity_id ?? null,
    use_case_id: linked.use_case_id ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      classification_reason: classification.reason,
      association_reason: linked.reason,
    },
  });

  if (input.in_reply_to) {
    await handleSequenceReply(db, tenantId, input.in_reply_to, input.from_email).catch((err) => {
      console.warn('[customer-email] sequence reply handling failed:', err);
    });
  }

  await attachTranscriptEmailToMeeting(db, tenantId, message, actor).catch((err) => {
    console.warn('[customer-email] meeting artifact matching failed:', err);
  });

  if (!options.process || shouldSkip || !hasLinkedSubject) {
    return {
      message,
      classification: classification.classification,
      processing_status: message.processing_status,
      processing_reason: message.processing_reason,
    };
  }

  return processEmailMessage(db, tenantId, message.id, actor);
}

export async function processEmailMessage(
  db: DbPool,
  tenantId: UUID,
  messageId: UUID,
  actor?: ActorContext,
): Promise<EmailProcessingResult> {
  const message = await emailMessageRepo.getEmailMessage(db, tenantId, messageId);
  if (!message) throw new Error('Email message not found');
  if (message.classification === 'internal' || message.classification === 'automated') {
    const updated = await emailMessageRepo.updateEmailMessage(db, tenantId, message.id, {
      processing_status: 'skipped',
      processing_reason: 'Internal or automated email is not processed as Raw Context by default.',
    });
    return {
      message: updated ?? message,
      classification: message.classification,
      processing_status: updated?.processing_status ?? 'skipped',
      processing_reason: updated?.processing_reason,
    };
  }

  const subject = primarySubject(message);
  if (!subject.subject_type || !subject.subject_id) {
    const updated = await emailMessageRepo.updateEmailMessage(db, tenantId, message.id, {
      processing_status: 'needs_review',
      processing_reason: 'Link this email to a customer record before processing it as Raw Context.',
    });
    return {
      message: updated ?? message,
      classification: message.classification,
      processing_status: updated?.processing_status ?? 'needs_review',
      processing_reason: updated?.processing_reason,
    };
  }

  await emailMessageRepo.updateEmailMessage(db, tenantId, message.id, {
    processing_status: 'processing',
    processing_reason: 'Processing email as Raw Context.',
  });

  try {
    const actorUserId = actor ? await getActorUserId(db, actor) : null;
    let activity = message.activity_id
      ? await activityRepo.getActivity(db, tenantId, message.activity_id)
      : null;
    if (!activity) {
      activity = await activityRepo.createActivity(db, tenantId, {
        type: 'email',
        direction: message.direction,
        subject: message.subject,
        body: message.body_text ?? '',
        contact_id: message.contact_id ?? undefined,
        account_id: message.account_id ?? undefined,
        opportunity_id: message.opportunity_id ?? undefined,
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        owner_id: actorUserId ?? undefined,
        source_agent: message.source === 'webhook' ? 'inbound_webhook' : `email:${message.source}`,
        occurred_at: message.received_at ?? message.sent_at ?? message.created_at,
        detail: {
          from_email: message.from_email,
          from_name: message.from_name,
          to_emails: message.to_emails,
          cc_emails: message.cc_emails,
          message_id: message.message_id,
          provider_message_id: message.provider_message_id,
          in_reply_to: message.in_reply_to,
          thread_id: message.thread_id,
          email_message_id: message.id,
        },
        created_by: actorUserId ?? undefined,
      });
    }

    const extraction = await extractContextFromActivity(db, tenantId, activity.id, actor ? {
      ownerIds: await getVisibleOwnerIds(db, actor) ?? undefined,
    } : {});
    const rawSource = await rawContextRepo.getRawContextSourceByRef(db, tenantId, 'inbound_email', activity.id)
      ?? await rawContextRepo.getRawContextSourceByRef(db, tenantId, 'outbound_email', activity.id)
      ?? await rawContextRepo.getRawContextSourceByRef(db, tenantId, 'activity', activity.id);
    const status: emailMessageRepo.EmailProcessingStatus = extraction.extracted_count > 0 || extraction.memory_created > 0 || extraction.signals_created > 0
      ? 'processed'
      : extraction.skipped > 0
        ? 'skipped'
        : 'needs_review';
    const updated = await emailMessageRepo.updateEmailMessage(db, tenantId, message.id, {
      activity_id: activity.id,
      raw_context_source_id: rawSource?.id ?? null,
      processing_status: status,
      processing_reason: rawSource?.failure_reason ?? (status === 'processed' ? 'Email processed into customer context.' : 'No extractable customer context was found.'),
      extraction_receipt: {
        memory_created: extraction.memory_created,
        signals_created: extraction.signals_created,
        skipped: extraction.skipped,
        raw_context_source_id: rawSource?.id ?? null,
      },
    });

    await emitEvent(db, {
      tenantId,
      eventType: 'email_message.context_processed',
      actorId: actor?.actor_id,
      actorType: actor?.actor_type ?? 'system',
      objectType: 'email_message',
      objectId: message.id,
      afterData: {
        activity_id: activity.id,
        raw_context_source_id: rawSource?.id ?? null,
        memory_created: extraction.memory_created,
        signals_created: extraction.signals_created,
      },
    }).catch(() => {});

    return {
      message: updated ?? message,
      activity_id: activity.id,
      raw_context_source_id: rawSource?.id ?? null,
      classification: message.classification,
      processing_status: updated?.processing_status ?? status,
      processing_reason: updated?.processing_reason,
      extraction: {
        memory_created: extraction.memory_created,
        signals_created: extraction.signals_created,
        skipped: extraction.skipped,
      },
    };
  } catch (err) {
    const messageText = err instanceof Error ? err.message : 'Email processing failed.';
    const updated = await emailMessageRepo.updateEmailMessage(db, tenantId, message.id, {
      processing_status: 'failed',
      processing_reason: messageText,
    });
    return {
      message: updated ?? message,
      classification: message.classification,
      processing_status: 'failed',
      processing_reason: messageText,
    };
  }
}

export async function processMailboxSyncJobs(db: DbPool): Promise<{ processed: number; failed: number }> {
  const jobs = await emailMessageRepo.claimMailboxSyncJobs(db, 10);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await emailMessageRepo.failMailboxSyncJob(
        db,
        job.id,
        'Mailbox sync provider is not configured yet. Connect Google Workspace or Microsoft 365 OAuth credentials to enable sync.',
      );
      failed++;
    } catch {
      failed++;
    }
    processed++;
  }
  return { processed, failed };
}
