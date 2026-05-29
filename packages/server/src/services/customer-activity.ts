// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { Activity, ActorContext, UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as activityRepo from '../db/repos/activities.js';
import * as calendarRepo from '../db/repos/calendar.js';
import * as rawContextRepo from '../db/repos/raw-context-sources.js';
import type { EmailMessage } from '../db/repos/email-messages.js';
import { extractContextFromActivity } from '../agent/extraction.js';
import { emitEvent } from '../events/emitter.js';
import { getActorUserId, getVisibleOwnerIds } from './access-control.js';

function normalizeDomain(value: string | undefined | null): string | null {
  const domain = value?.split('@')[1] ?? value;
  return domain ? domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') : null;
}

function localPart(email: string): string {
  return email.split('@')[0]?.trim().toLowerCase() ?? '';
}

const AUTOMATED_LOCALS = new Set(['no-reply', 'noreply', 'donotreply', 'do-not-reply', 'notifications', 'notification']);

type ActivityType = NonNullable<Activity['type']>;
const ACTIVITY_TYPE_VALUES = new Set<ActivityType>([
  'call', 'email', 'meeting', 'note', 'task', 'demo', 'proposal', 'research', 'handoff', 'status_update',
  'outreach_email', 'outreach_call', 'outreach_linkedin', 'outreach_other',
  'meeting_held', 'meeting_scheduled', 'note_added', 'research_completed', 'stage_change',
]);

function toActivityType(value: string | undefined | null, fallback: ActivityType): ActivityType {
  return ACTIVITY_TYPE_VALUES.has(value as ActivityType) ? value as ActivityType : fallback;
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

async function findContactByEmail(
  db: DbPool,
  tenantId: UUID,
  email: string,
  ownerIds?: UUID[] | null,
): Promise<{ id: UUID; account_id?: UUID | null; owner_id?: UUID | null } | null> {
  const params: unknown[] = [tenantId, email.trim().toLowerCase()];
  let ownerClause = '';
  if (ownerIds) {
    if (ownerIds.length === 0) return null;
    params.push(ownerIds);
    ownerClause = ` AND c.owner_id = ANY($${params.length}::uuid[])`;
  }
  const result = await db.query(
    `SELECT c.id, c.account_id, c.owner_id
     FROM contacts c
     WHERE c.tenant_id = $1 AND lower(c.email) = $2 AND c.merged_into IS NULL
       ${ownerClause}
     LIMIT 1`,
    params,
  );
  return result.rows[0] ?? null;
}

async function findAccountByDomain(
  db: DbPool,
  tenantId: UUID,
  domain: string | null,
  ownerIds?: UUID[] | null,
): Promise<{ id: UUID; name: string; owner_id?: UUID | null } | null> {
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

async function pickScopedOpportunity(
  db: DbPool,
  tenantId: UUID,
  accountId?: UUID | null,
  contactId?: UUID | null,
  ownerIds?: UUID[] | null,
): Promise<{ id: UUID; name: string } | null> {
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
  accountId?: UUID | null,
  opportunityId?: UUID | null,
  ownerIds?: UUID[] | null,
): Promise<{ id: UUID; name: string } | null> {
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

async function associateMeeting(
  db: DbPool,
  tenantId: UUID,
  input: Partial<calendarRepo.CalendarEvent>,
  ownerIds?: UUID[] | null,
): Promise<{
  contact_id?: UUID | null;
  account_id?: UUID | null;
  opportunity_id?: UUID | null;
  use_case_id?: UUID | null;
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

  const emails = [input.organizer_email, ...(input.attendee_emails ?? [])]
    .map(email => email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email));

  for (const email of emails) {
    const contact = await findContactByEmail(db, tenantId, email, ownerIds);
    if (contact) {
      const opportunity = await pickScopedOpportunity(db, tenantId, contact.account_id, contact.id, ownerIds);
      const useCase = await pickScopedUseCase(db, tenantId, contact.account_id, opportunity?.id, ownerIds);
      return {
        contact_id: contact.id,
        account_id: contact.account_id ?? null,
        opportunity_id: opportunity?.id ?? null,
        use_case_id: useCase?.id ?? null,
        reason: 'Matched by known attendee email.',
      };
    }
  }

  for (const email of emails) {
    const account = await findAccountByDomain(db, tenantId, normalizeDomain(email), ownerIds);
    if (account) {
      const opportunity = await pickScopedOpportunity(db, tenantId, account.id, null, ownerIds);
      const useCase = await pickScopedUseCase(db, tenantId, account.id, opportunity?.id, ownerIds);
      return {
        account_id: account.id,
        opportunity_id: opportunity?.id ?? null,
        use_case_id: useCase?.id ?? null,
        reason: 'Matched by attendee account domain.',
      };
    }
  }

  return { reason: 'No matching customer record was found.' };
}

async function classifyMeeting(
  db: DbPool,
  tenantId: UUID,
  input: Partial<calendarRepo.CalendarEvent>,
): Promise<{
  classification: string;
  confidence: number;
  reason: string;
  registry?: calendarRepo.MeetingClassification;
}> {
  const classifications = await calendarRepo.listMeetingClassifications(db, tenantId, true);
  const enabled = classifications.filter(c => c.is_enabled);
  const text = `${input.title ?? ''} ${input.description ?? ''} ${input.location ?? ''}`.toLowerCase();
  const internal = await internalDomains(db, tenantId);
  const participantDomains = [input.organizer_email, ...(input.attendee_emails ?? [])]
    .map(normalizeDomain)
    .filter((domain): domain is string => Boolean(domain));
  const externalCount = participantDomains.filter(domain => !internal.has(domain)).length;
  const allInternal = participantDomains.length > 0 && externalCount === 0;
  if (allInternal) {
    const registry = enabled.find(c => c.type_name === 'internal');
    return { classification: 'internal', confidence: 0.95, reason: 'Only internal participants were detected.', registry };
  }

  for (const item of enabled) {
    if (item.type_name === 'unknown' || item.type_name === 'internal') continue;
    const hit = item.matching_hints.find(hint => text.includes(hint.toLowerCase()));
    if (hit) {
      return {
        classification: item.type_name,
        confidence: 0.85,
        reason: `Matched meeting hint "${hit}".`,
        registry: item,
      };
    }
  }

  const fallback = enabled.find(c => c.type_name === 'unknown');
  return { classification: fallback?.type_name ?? 'unknown', confidence: 0.5, reason: 'No classification hint matched.', registry: fallback };
}

export async function validateMeetingEvent(
  db: DbPool,
  tenantId: UUID,
  event: calendarRepo.CalendarEvent,
): Promise<{ validation_status: calendarRepo.MeetingValidationStatus; validation_blockers: string[]; processing_status?: calendarRepo.MeetingProcessingStatus; processing_reason?: string }> {
  const registry = (await calendarRepo.listMeetingClassifications(db, tenantId, true)).find(item => item.type_name === event.classification);
  const blockers: string[] = [];
  if (registry && !registry.is_customer_facing) {
    return {
      validation_status: 'skipped_internal',
      validation_blockers: ['Internal meeting.'],
      processing_status: 'skipped',
      processing_reason: 'Internal meeting skipped by classification.',
    };
  }

  const requiredRecords = registry?.required_record_types ?? ['account'];
  if (requiredRecords.includes('account') && !event.account_id) blockers.push('Needs customer record link');
  if (requiredRecords.includes('contact') && !event.contact_id) blockers.push('Needs contact link');
  if (requiredRecords.includes('opportunity') && !event.opportunity_id) blockers.push('Needs opportunity link');
  if (requiredRecords.includes('use_case') && !event.use_case_id) blockers.push('Needs use case link');

  const artifacts = await calendarRepo.listMeetingArtifacts(db, tenantId, event.id);
  const artifactTypes = new Set(artifacts.map(artifact => artifact.artifact_type));
  const requiredArtifacts = registry?.required_artifact_types ?? ['notes'];
  const hasAnyRequiredArtifact = requiredArtifacts.length === 0 || requiredArtifacts.some(type => artifactTypes.has(type));
  if (!hasAnyRequiredArtifact) blockers.push(`Missing ${requiredArtifacts.join(' or ')}`);

  if (blockers.some(blocker => blocker.toLowerCase().includes('record'))) {
    return { validation_status: 'needs_record_link', validation_blockers: blockers, processing_status: 'needs_review', processing_reason: blockers.join('; ') };
  }
  if (blockers.length > 0) {
    return { validation_status: 'missing_context', validation_blockers: blockers, processing_status: 'needs_review', processing_reason: blockers.join('; ') };
  }
  return { validation_status: 'ready', validation_blockers: [], processing_status: event.processing_status };
}

export async function upsertCalendarEventWithIntelligence(
  db: DbPool,
  tenantId: UUID,
  input: Partial<calendarRepo.CalendarEvent> & { title: string; starts_at: string },
  actor?: ActorContext,
): Promise<calendarRepo.CalendarEvent> {
  const ownerIds = actor ? await getVisibleOwnerIds(db, actor) : undefined;
  const linked = await associateMeeting(db, tenantId, input, ownerIds);
  const classified = await classifyMeeting(db, tenantId, input);
  const userId = input.user_id ?? (actor ? await getActorUserId(db, actor) : null);
  let event = await calendarRepo.upsertCalendarEvent(db, tenantId, {
    ...input,
    user_id: userId ?? null,
    contact_id: linked.contact_id ?? input.contact_id ?? null,
    account_id: linked.account_id ?? input.account_id ?? null,
    opportunity_id: linked.opportunity_id ?? input.opportunity_id ?? null,
    use_case_id: linked.use_case_id ?? input.use_case_id ?? null,
    classification: classified.classification,
    classification_confidence: classified.confidence,
    classification_reason: classified.reason,
    metadata: {
      ...(input.metadata ?? {}),
      association_reason: linked.reason,
      classification_reason: classified.reason,
    },
  });
  const validation = await validateMeetingEvent(db, tenantId, event);
  event = await calendarRepo.updateCalendarEvent(db, tenantId, event.id, validation) ?? event;
  return event;
}

function primarySubject(event: calendarRepo.CalendarEvent): { subject_type?: 'account' | 'contact' | 'opportunity' | 'use_case'; subject_id?: string } {
  if (event.opportunity_id) return { subject_type: 'opportunity', subject_id: event.opportunity_id };
  if (event.use_case_id) return { subject_type: 'use_case', subject_id: event.use_case_id };
  if (event.contact_id) return { subject_type: 'contact', subject_id: event.contact_id };
  if (event.account_id) return { subject_type: 'account', subject_id: event.account_id };
  return {};
}

export async function processMeetingArtifact(
  db: DbPool,
  tenantId: UUID,
  eventId: UUID,
  artifact: calendarRepo.MeetingArtifact,
  actor?: ActorContext,
): Promise<calendarRepo.MeetingArtifact> {
  const event = await calendarRepo.getCalendarEvent(db, tenantId, eventId);
  if (!event) throw new Error('Calendar event not found');
  const subject = primarySubject(event);
  if (!subject.subject_type || !subject.subject_id) {
    const updated = await calendarRepo.updateMeetingArtifact(db, tenantId, artifact.id, {
      processing_status: 'needs_review',
      processing_reason: 'Link this meeting to a customer record before processing notes or transcript.',
    });
    return updated ?? artifact;
  }
  if (!artifact.text_content?.trim()) {
    const updated = await calendarRepo.updateMeetingArtifact(db, tenantId, artifact.id, {
      processing_status: 'needs_review',
      processing_reason: 'No transcript or notes text was provided.',
    });
    return updated ?? artifact;
  }

  await calendarRepo.updateMeetingArtifact(db, tenantId, artifact.id, {
    processing_status: 'processing',
    processing_reason: 'Processing meeting context.',
  });

  try {
    let activity = event.activity_id ? await activityRepo.getActivity(db, tenantId, event.activity_id) : null;
    if (!activity) {
      const registry = (await calendarRepo.listMeetingClassifications(db, tenantId, true)).find(item => item.type_name === event.classification);
      const actorUserId = actor ? await getActorUserId(db, actor) : null;
      const fallbackActivityType: ActivityType = event.status === 'scheduled' ? 'meeting_scheduled' : 'meeting_held';
      activity = await activityRepo.createActivity(db, tenantId, {
        type: toActivityType(registry?.mapped_activity_type, fallbackActivityType),
        subject: event.title,
        body: artifact.text_content,
        contact_id: event.contact_id ?? undefined,
        account_id: event.account_id ?? undefined,
        opportunity_id: event.opportunity_id ?? undefined,
        use_case_id: event.use_case_id ?? undefined,
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        owner_id: actorUserId ?? event.user_id ?? undefined,
        source_agent: `calendar:${event.provider}`,
        occurred_at: event.starts_at,
        detail: {
          calendar_event_id: event.id,
          meeting_artifact_id: artifact.id,
          artifact_type: artifact.artifact_type,
          meeting_url: event.meeting_url,
          attendees: event.attendee_emails,
        },
        created_by: actorUserId ?? undefined,
      });
      await calendarRepo.updateCalendarEvent(db, tenantId, event.id, { activity_id: activity.id });
    }

    const extraction = await extractContextFromActivity(db, tenantId, activity.id, actor ? {
      ownerIds: await getVisibleOwnerIds(db, actor) ?? undefined,
    } : {});
    const rawSource = await rawContextRepo.getRawContextSourceByRef(db, tenantId, 'activity', activity.id)
      ?? await rawContextRepo.getRawContextSourceByRef(db, tenantId, 'calendar_meeting', activity.id);
    const status: calendarRepo.MeetingProcessingStatus = extraction.extracted_count > 0 || extraction.memory_created > 0 || extraction.signals_created > 0
      ? 'processed'
      : extraction.skipped > 0
        ? 'skipped'
        : 'needs_review';
    const receipt = {
      memory_created: extraction.memory_created,
      signals_created: extraction.signals_created,
      skipped: extraction.skipped,
      raw_context_source_id: rawSource?.id ?? null,
    };
    const updatedArtifact = await calendarRepo.updateMeetingArtifact(db, tenantId, artifact.id, {
      activity_id: activity.id,
      raw_context_source_id: rawSource?.id ?? null,
      processing_status: status,
      processing_reason: rawSource?.failure_reason ?? (status === 'processed' ? 'Meeting context processed.' : 'No extractable customer context was found.'),
      extraction_receipt: receipt,
    });
    await calendarRepo.updateCalendarEvent(db, tenantId, event.id, {
      activity_id: activity.id,
      raw_context_source_id: rawSource?.id ?? null,
      processing_status: status,
      processing_reason: status === 'processed' ? 'Meeting context processed.' : 'Meeting context needs review.',
      extraction_receipt: receipt,
    });
    const refreshed = await calendarRepo.getCalendarEvent(db, tenantId, event.id);
    if (refreshed) {
      const validation = await validateMeetingEvent(db, tenantId, refreshed);
      await calendarRepo.updateCalendarEvent(db, tenantId, event.id, validation);
    }
    await emitEvent(db, {
      tenantId,
      eventType: 'calendar_event.context_processed',
      actorId: actor?.actor_id,
      actorType: actor?.actor_type ?? 'system',
      objectType: 'calendar_event',
      objectId: event.id,
      afterData: { activity_id: activity.id, ...receipt },
    }).catch(() => {});
    return updatedArtifact ?? artifact;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Meeting context processing failed.';
    await calendarRepo.updateCalendarEvent(db, tenantId, event.id, {
      validation_status: 'failed',
      processing_status: 'failed',
      processing_reason: message,
      validation_blockers: [message],
    });
    return await calendarRepo.updateMeetingArtifact(db, tenantId, artifact.id, {
      processing_status: 'failed',
      processing_reason: message,
    }) ?? artifact;
  }
}

export async function processCalendarEvent(db: DbPool, tenantId: UUID, eventId: UUID, actor?: ActorContext): Promise<{
  calendar_event: calendarRepo.CalendarEvent;
  artifacts: calendarRepo.MeetingArtifact[];
}> {
  let event = await calendarRepo.getCalendarEvent(db, tenantId, eventId);
  if (!event) throw new Error('Calendar event not found');
  const artifacts = await calendarRepo.listMeetingArtifacts(db, tenantId, event.id);
  if (artifacts.length === 0) {
    const validation = await validateMeetingEvent(db, tenantId, event);
    event = await calendarRepo.updateCalendarEvent(db, tenantId, event.id, validation) ?? event;
    return { calendar_event: event, artifacts };
  }
  const processed: calendarRepo.MeetingArtifact[] = [];
  for (const artifact of artifacts) {
    if (artifact.processing_status === 'processed') {
      processed.push(artifact);
      continue;
    }
    processed.push(await processMeetingArtifact(db, tenantId, event.id, artifact, actor));
  }
  event = await calendarRepo.getCalendarEvent(db, tenantId, event.id) ?? event;
  return { calendar_event: event, artifacts: processed };
}

export async function processCalendarSyncJobs(db: DbPool): Promise<{ processed: number; failed: number }> {
  const jobs = await calendarRepo.claimCalendarSyncJobs(db, 10);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await calendarRepo.failCalendarSyncJob(
        db,
        job.id,
        'Calendar sync provider is not configured yet. Connect Google Calendar or Microsoft 365 OAuth credentials to enable sync.',
      );
      failed++;
    } catch {
      failed++;
    }
    processed++;
  }
  return { processed, failed };
}

function isTranscriptLike(message: EmailMessage): boolean {
  const text = `${message.subject ?? ''} ${message.body_text ?? ''}`.toLowerCase();
  if (AUTOMATED_LOCALS.has(localPart(message.from_email))) return false;
  return /\b(transcript|meeting notes|recording|call notes|recap)\b/.test(text);
}

export async function attachTranscriptEmailToMeeting(
  db: DbPool,
  tenantId: UUID,
  message: EmailMessage,
  actor?: ActorContext,
): Promise<calendarRepo.MeetingArtifact | null> {
  if (!message.body_text?.trim() || !isTranscriptLike(message)) return null;
  const ownerIds = actor ? await getVisibleOwnerIds(db, actor) : undefined;
  const emails = [message.from_email, ...message.to_emails, ...message.cc_emails].map(email => email.toLowerCase());
  const params: unknown[] = [tenantId, emails, message.received_at ?? message.sent_at ?? message.created_at];
  let ownerClause = '';
  if (ownerIds) {
    if (ownerIds.length === 0) return null;
    params.push(ownerIds);
    ownerClause = ` AND (
      c.owner_id = ANY($4::uuid[])
      OR a.owner_id = ANY($4::uuid[])
      OR o.owner_id = ANY($4::uuid[])
      OR u.owner_id = ANY($4::uuid[])
      OR ce.user_id = ANY($4::uuid[])
    )`;
  }
  const result = await db.query(
    `SELECT ce.*
     FROM calendar_events ce
     LEFT JOIN contacts c ON c.id = ce.contact_id AND c.tenant_id = ce.tenant_id
     LEFT JOIN accounts a ON a.id = ce.account_id AND a.tenant_id = ce.tenant_id
     LEFT JOIN opportunities o ON o.id = ce.opportunity_id AND o.tenant_id = ce.tenant_id
     LEFT JOIN use_cases u ON u.id = ce.use_case_id AND u.tenant_id = ce.tenant_id
     WHERE ce.tenant_id = $1
       AND ce.status <> 'ignored'
       AND ce.starts_at BETWEEN ($3::timestamptz - interval '2 days') AND ($3::timestamptz + interval '12 hours')
       AND EXISTS (
         SELECT 1 FROM unnest(ce.attendee_emails || ARRAY[coalesce(ce.organizer_email, '')]) e
         WHERE lower(e) = ANY($2::text[])
       )
       ${ownerClause}
     ORDER BY abs(extract(epoch from (ce.starts_at - $3::timestamptz))) ASC
     LIMIT 1`,
    params,
  );
  const event = result.rows[0] as calendarRepo.CalendarEvent | undefined;
  if (!event) return null;
  const artifact = await calendarRepo.createMeetingArtifact(db, tenantId, {
    calendar_event_id: event.id,
    email_message_id: message.id,
    artifact_type: /\btranscript\b/i.test(`${message.subject} ${message.body_text}`) ? 'transcript' : 'notes',
    source: 'email',
    source_label: message.subject,
    text_content: message.body_text,
    created_by: actor?.actor_id ?? null,
    metadata: { email_message_id: message.id, match_reason: 'transcript-like email matched attendee and time window' },
  });
  const refreshed = await calendarRepo.getCalendarEvent(db, tenantId, event.id);
  if (refreshed) {
    const validation = await validateMeetingEvent(db, tenantId, refreshed);
    await calendarRepo.updateCalendarEvent(db, tenantId, event.id, validation);
    if (validation.validation_status === 'ready') {
      await processMeetingArtifact(db, tenantId, event.id, artifact, actor);
    }
  }
  return artifact;
}
