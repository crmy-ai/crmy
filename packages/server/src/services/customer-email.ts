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
import { getSourceFilterSettings, shouldKeepEmailSource } from './source-filters.js';
import { resolveSubjectGraphForSource, type SubjectGraphResolution } from './subject-graph-resolver.js';

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
  snippet?: string;
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
  const settings = await getSourceFilterSettings(db, tenantId);
  const decision = shouldKeepEmailSource(settings, {
    from_email: input.from_email,
    to_emails: input.to_emails,
    cc_emails: input.cc_emails,
    subject: input.subject,
    body_text: input.body_text,
    headers: input.metadata?.headers as Record<string, string | string[] | undefined> | undefined,
    mailbox_labels: input.metadata?.label_ids as string[] | undefined,
    folder: typeof input.metadata?.folder === 'string' ? input.metadata.folder : undefined,
  });
  return { classification: decision.classification, reason: decision.message };
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
    ownerClause = ` AND a.owner_id = ANY($${params.length}::uuid[])`;
  }
  const result = await db.query(
    `SELECT a.id, a.name, a.owner_id
	     FROM accounts a
       LEFT JOIN account_domains ad ON ad.tenant_id = a.tenant_id AND ad.account_id = a.id
	     WHERE a.tenant_id = $1
	       AND a.merged_into IS NULL
	       AND a.archived_at IS NULL
	       AND (lower(a.domain) = $2 OR lower(ad.domain) = $2)
       ${ownerClause}
     LIMIT 1`,
    params,
  );
  return result.rows[0] ?? null;
}

async function linkedSubjectInOwnerScope(
  db: DbPool,
  tenantId: UUID,
  linked: {
    contact_id?: string | null;
    account_id?: string | null;
    opportunity_id?: string | null;
    use_case_id?: string | null;
  },
  ownerIds?: UUID[] | null,
): Promise<boolean> {
  if (ownerIds === undefined || ownerIds === null) return true;
  if (ownerIds.length === 0) return false;
  const checks: Array<[string, string | null | undefined]> = [
    ['accounts', linked.account_id],
    ['contacts', linked.contact_id],
    ['opportunities', linked.opportunity_id],
    ['use_cases', linked.use_case_id],
  ];
  for (const [table, id] of checks) {
    if (!id) continue;
    const result = await db.query(
      `SELECT owner_id FROM ${table} WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id],
    );
    const ownerId = result.rows[0]?.owner_id as string | null | undefined;
    if (ownerId && ownerIds.includes(ownerId)) return true;
  }
  return false;
}

async function findContactByEmail(
  db: DbPool,
  tenantId: UUID,
  email: string,
  ownerIds?: UUID[] | null,
): Promise<{ id: string; account_id?: string | null; account_name?: string | null; first_name?: string; last_name?: string; owner_id?: string | null } | null> {
  const params: unknown[] = [tenantId, email.trim().toLowerCase()];
  let ownerClause = '';
  if (ownerIds) {
    if (ownerIds.length === 0) return null;
    params.push(ownerIds);
    ownerClause = ` AND c.owner_id = ANY($${params.length}::uuid[])`;
  }
  const result = await db.query(
    `SELECT c.id, c.account_id, a.name AS account_name, c.first_name, c.last_name, c.owner_id
     FROM contacts c
	     LEFT JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
	     WHERE c.tenant_id = $1 AND lower(c.email) = $2 AND c.merged_into IS NULL AND c.archived_at IS NULL
       ${ownerClause}
     LIMIT 1`,
    params,
  );
  return result.rows[0] ?? null;
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
	  email_id?: string | null;
	  reply_to_email_message_id?: string | null;
	  conversation_root_email_message_id?: string | null;
	  reason: string;
	  resolution_summary?: string;
	  ambiguity_count?: number;
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
	  const sourceText = emailAssociationText(input, externalEmails);
	  const replyLink = await emailMessageRepo.findReplyLink(db, tenantId, {
	    mailbox_connection_id: input.mailbox_connection_id as UUID | null | undefined,
	    thread_id: input.thread_id,
	    in_reply_to: input.in_reply_to,
	    references_header: input.references_header,
	  });
	  if (replyLink) {
	    return {
	      contact_id: replyLink.contact_id ?? null,
	      account_id: replyLink.account_id ?? null,
	      opportunity_id: replyLink.opportunity_id ?? null,
	      use_case_id: replyLink.use_case_id ?? null,
	      email_id: replyLink.email_id ?? null,
	      reply_to_email_message_id: replyLink.id,
	      conversation_root_email_message_id: replyLink.conversation_root_email_message_id ?? replyLink.id,
	      reason: input.thread_id
	        ? 'Matched by mailbox thread/conversation to an outbound email.'
	        : 'Matched by message headers to an outbound email.',
	    };
	  }

	  for (const email of externalEmails) {
    const contact = await findContactByEmail(db, tenantId, email, ownerIds);
    if (contact) {
      const base = {
        contact_id: contact.id,
        account_id: contact.account_id ?? null,
        reason: 'Matched by known contact email.',
      };
      return enrichAssociationWithSubjectGraph(db, tenantId, sourceText, base, {
        accountHint: contact.account_name ?? domainFromEmail(email) ?? undefined,
        ownerIds,
      });
    }
  }

	  for (const email of externalEmails) {
    const account = await findAccountByDomain(db, tenantId, domainFromEmail(email), ownerIds);
    if (account) {
      const base = {
        account_id: account.id,
        reason: 'Matched by account email domain.',
      };
      return enrichAssociationWithSubjectGraph(db, tenantId, sourceText, base, {
        accountHint: account.name,
        ownerIds,
      });
    }
  }

  const graphLinked = await enrichAssociationWithSubjectGraph(db, tenantId, sourceText, {
    reason: 'No matching customer record was found.',
  }, { ownerIds });
  return graphLinked.contact_id || graphLinked.account_id || graphLinked.opportunity_id || graphLinked.use_case_id
    ? graphLinked
    : { reason: graphLinked.reason, resolution_summary: graphLinked.resolution_summary, ambiguity_count: graphLinked.ambiguity_count };
}

export async function previewEmailAssociation(
  db: DbPool,
  tenantId: UUID,
  input: NormalizedEmailInput,
  ownerIds?: UUID[] | null,
): Promise<{
  has_linked_subject: boolean;
  in_owner_scope: boolean;
  reason: string;
  contact_id?: string | null;
  account_id?: string | null;
  opportunity_id?: string | null;
  use_case_id?: string | null;
}> {
  const linked = await associateEmail(db, tenantId, input, ownerIds);
  const hasLinkedSubject = Boolean(linked.contact_id || linked.account_id || linked.opportunity_id || linked.use_case_id);
  return {
    ...linked,
    has_linked_subject: hasLinkedSubject,
    in_owner_scope: hasLinkedSubject ? await linkedSubjectInOwnerScope(db, tenantId, linked, ownerIds) : false,
  };
}

function emailAssociationText(input: NormalizedEmailInput, externalEmails: string[]): string {
  const participants = externalEmails.slice(0, 12).join(', ');
  return [
    input.subject,
    input.snippet,
    input.body_text?.slice(0, 4000),
    participants ? `Participants: ${participants}` : '',
  ].filter(Boolean).join('\n');
}

function oneSubject(
  graph: SubjectGraphResolution,
  type: 'account' | 'contact' | 'opportunity' | 'use_case',
  accountId?: string | null,
): { id: string; account_id?: string; name?: string } | null {
  const subjects = graph.subjects.filter(subject => {
    if (subject.type !== type) return false;
    if (!accountId || type === 'account') return true;
    return subject.account_id === accountId;
  });
  return subjects.length === 1 ? subjects[0] : null;
}

async function enrichAssociationWithSubjectGraph(
  db: DbPool,
  tenantId: UUID,
  text: string,
  linked: {
    contact_id?: string | null;
    account_id?: string | null;
    opportunity_id?: string | null;
    use_case_id?: string | null;
    reason: string;
  },
  options: { accountHint?: string; ownerIds?: UUID[] | null } = {},
): Promise<{
  contact_id?: string | null;
  account_id?: string | null;
  opportunity_id?: string | null;
  use_case_id?: string | null;
  reason: string;
  resolution_summary?: string;
  ambiguity_count?: number;
}> {
  if (!text.trim()) return linked;
  let graph: SubjectGraphResolution;
  try {
    graph = await resolveSubjectGraphForSource(db, tenantId, {
      text,
      subject_type: 'any',
      account_hint: options.accountHint,
      limit: 12,
      confidence_threshold: 0.67,
    }, {
      ownerIds: options.ownerIds,
    });
  } catch (err) {
    return {
      ...linked,
      reason: `${linked.reason} Subject Graph enrichment unavailable: ${err instanceof Error ? err.message : 'resolution failed'}`,
    };
  }

  const next = { ...linked };
  const added: string[] = [];
  const account = oneSubject(graph, 'account');
  if (!next.account_id && account?.id) {
    next.account_id = account.id;
    added.push('account');
  }
  const contact = oneSubject(graph, 'contact', next.account_id);
  if (!next.contact_id && contact?.id) {
    next.contact_id = contact.id;
    if (!next.account_id && contact.account_id) next.account_id = contact.account_id;
    added.push('contact');
  }
  const opportunity = oneSubject(graph, 'opportunity', next.account_id);
  if (!next.opportunity_id && opportunity?.id) {
    next.opportunity_id = opportunity.id;
    if (!next.account_id && opportunity.account_id) next.account_id = opportunity.account_id;
    added.push('opportunity');
  }
  const useCase = oneSubject(graph, 'use_case', next.account_id);
  if (!next.use_case_id && useCase?.id) {
    next.use_case_id = useCase.id;
    if (!next.account_id && useCase.account_id) next.account_id = useCase.account_id;
    added.push('use case');
  }

  const ambiguityCount = graph.skipped?.filter(item => item.reason?.includes('ambiguous')).length ?? 0;
  const reasonParts = [linked.reason];
  if (added.length > 0) reasonParts.push(`Subject Graph matched ${added.join(', ')} from message content.`);
  if (ambiguityCount > 0) reasonParts.push(`${ambiguityCount} ambiguous customer reference${ambiguityCount === 1 ? '' : 's'} need review.`);
  return {
    ...next,
    reason: reasonParts.join(' '),
    resolution_summary: graph.resolution_summary,
    ambiguity_count: ambiguityCount,
  };
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

function emailContextProvenance(message: emailMessageRepo.EmailMessage): Record<string, unknown> {
  const outbound = message.direction === 'outbound';
  const sender = message.metadata && typeof message.metadata.sender === 'object' && message.metadata.sender !== null
    ? message.metadata.sender as Record<string, unknown>
    : undefined;
  return outbound
    ? {
        context_origin: 'crmy_outbound_email',
        source_authorship: 'crmy',
        source_perspective: 'our_words',
        customer_authored: false,
        customer_statement: false,
        evidence_weight: 'self_authored_action_context',
        evidence_role: 'seller_action_or_commitment',
        extraction_guidance: 'Treat this as CRMy-authored outbound context. Extract our commitments, asks, and follow-up actions; do not treat it as a customer-authored claim.',
        sender_type: sender?.sender_type ?? message.metadata?.sender_type ?? null,
        sender_identity: sender?.from_email ?? message.from_email,
        reply_processing_path: message.metadata?.reply_handling ?? 'Customer replies become customer-authored context when they sync back through a connected mailbox or inbound webhook.',
      }
    : {
        context_origin: 'customer_email',
        source_authorship: 'customer_or_external',
        source_perspective: 'customer_or_external_words',
        customer_authored: true,
        customer_statement: true,
        evidence_weight: 'customer_authored_context',
        evidence_role: 'customer_source',
      };
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
	    email_id: input.email_id ?? linked.email_id ?? null,
	    reply_to_email_message_id: linked.reply_to_email_message_id ?? null,
	    conversation_root_email_message_id: linked.conversation_root_email_message_id ?? null,
	    metadata: {
      ...(input.metadata ?? {}),
      classification_reason: classification.reason,
      association_reason: linked.reason,
      association_resolution_summary: linked.resolution_summary,
      association_ambiguity_count: linked.ambiguity_count,
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
    processing_reason: message.direction === 'outbound'
      ? 'Processing delivered outbound email as account activity and CRMy-authored context.'
      : 'Processing email as Raw Context.',
  });

  try {
    const actorUserId = actor ? await getActorUserId(db, actor) : (message.user_id ?? null);
    const outbound = message.direction === 'outbound';
    const provenance = emailContextProvenance(message);
    let activity = message.activity_id
      ? await activityRepo.getActivity(db, tenantId, message.activity_id)
      : null;
    if (!activity) {
      activity = await activityRepo.createActivity(db, tenantId, {
        type: outbound ? 'outreach_email' : 'email',
        direction: message.direction,
        subject: outbound ? `Sent email: ${message.subject}` : message.subject,
        body: message.body_text ?? '',
        contact_id: message.contact_id ?? undefined,
        account_id: message.account_id ?? undefined,
        opportunity_id: message.opportunity_id ?? undefined,
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        owner_id: actorUserId ?? undefined,
        performed_by: actorUserId ?? undefined,
        source_agent: outbound ? 'email:outbound_send' : message.source === 'webhook' ? 'inbound_webhook' : `email:${message.source}`,
        occurred_at: message.received_at ?? message.sent_at ?? message.created_at,
        outcome: outbound ? 'sent' : undefined,
        custom_fields: provenance,
        detail: {
          ...provenance,
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
      processing_reason: rawSource?.failure_reason ?? (status === 'processed'
        ? outbound
          ? 'Outbound email recorded as account activity and CRMy-authored context.'
          : 'Email processed into customer context.'
        : 'No extractable customer context was found.'),
      extraction_receipt: {
        memory_created: extraction.memory_created,
        signals_created: extraction.signals_created,
        skipped: extraction.skipped,
        raw_context_source_id: rawSource?.id ?? null,
        context_origin: provenance.context_origin,
        source_authorship: provenance.source_authorship,
        customer_authored: provenance.customer_authored,
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

export async function processDeliveredOutboundEmailContextJobs(db: DbPool, limit = 5): Promise<{ processed: number; failed: number }> {
  const messages = await emailMessageRepo.claimDeliveredOutboundEmailMessagesForProcessing(db, Math.max(1, Math.min(limit, 25)));
  let processed = 0;
  let failed = 0;
  for (const message of messages) {
    const result = await processEmailMessage(db, message.tenant_id, message.id);
    if (result.processing_status === 'processed' || result.processing_status === 'skipped' || result.processing_status === 'needs_review') {
      processed++;
    } else {
      failed++;
    }
  }
  return { processed, failed };
}

export async function processMailboxSyncJobs(db: DbPool): Promise<{ processed: number; failed: number }> {
  const jobs = await emailMessageRepo.claimMailboxSyncJobs(db, 10);
  const { syncMailboxConnection } = await import('./source-sync.js');
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await syncMailboxConnection(db, job.tenant_id, job.connection_id);
      await emailMessageRepo.completeMailboxSyncJob(db, job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Mailbox sync failed.';
      await emailMessageRepo.failMailboxSyncJob(db, job.id, message);
      try {
        await emailMessageRepo.updateMailboxConnection(db, job.tenant_id, job.connection_id, {
          status: 'error',
          last_error: message,
        });
      } catch {
        // Best effort status update only.
      }
      failed++;
    }
    processed++;
  }
  return { processed, failed };
}
