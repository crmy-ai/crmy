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
import { classifySourceParticipants, getSourceFilterSettings } from './source-filters.js';
import { resolveSubjectGraphForSource, type SubjectGraphResolution } from './subject-graph-resolver.js';

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
): Promise<{ id: UUID; account_id?: UUID | null; account_name?: string | null; owner_id?: UUID | null } | null> {
  const params: unknown[] = [tenantId, email.trim().toLowerCase()];
  let ownerClause = '';
  if (ownerIds) {
    if (ownerIds.length === 0) return null;
    params.push(ownerIds);
    ownerClause = ` AND c.owner_id = ANY($${params.length}::uuid[])`;
  }
  const result = await db.query(
    `SELECT c.id, c.account_id, a.name AS account_name, c.owner_id
	     FROM contacts c
	     LEFT JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
	     WHERE c.tenant_id = $1 AND lower(c.email) = $2 AND c.merged_into IS NULL AND c.archived_at IS NULL
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
    const ownerId = result.rows[0]?.owner_id as UUID | null | undefined;
    if (ownerId && ownerIds.includes(ownerId)) return true;
  }
  return false;
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

  const emails = [input.organizer_email, ...(input.attendee_emails ?? [])]
    .map(email => email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email));
  const filterSettings = await getSourceFilterSettings(db, tenantId);
  const externalEmails = emails.filter(email => !filterSettings.internal_domains.includes(normalizeDomain(email) ?? ''));
  const sourceText = meetingAssociationText(input, externalEmails);

  for (const email of externalEmails) {
    const contact = await findContactByEmail(db, tenantId, email, ownerIds);
    if (contact) {
      const base = {
        contact_id: contact.id,
        account_id: contact.account_id ?? null,
        reason: 'Matched by known attendee email.',
      };
      return enrichAssociationWithSubjectGraph(db, tenantId, sourceText, base, {
        accountHint: contact.account_name ?? normalizeDomain(email) ?? undefined,
        ownerIds,
      });
    }
  }

  for (const email of externalEmails) {
    const account = await findAccountByDomain(db, tenantId, normalizeDomain(email), ownerIds);
    if (account) {
      const base = {
        account_id: account.id,
        reason: 'Matched by attendee account domain.',
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

function meetingAssociationText(input: Partial<calendarRepo.CalendarEvent>, externalEmails: string[]): string {
  const participants = externalEmails.slice(0, 20).join(', ');
  return [
    input.title,
    input.description?.slice(0, 4000),
    input.location,
    input.meeting_url,
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
  if (added.length > 0) reasonParts.push(`Subject Graph matched ${added.join(', ')} from meeting details.`);
  if (ambiguityCount > 0) reasonParts.push(`${ambiguityCount} ambiguous customer reference${ambiguityCount === 1 ? '' : 's'} need review.`);
  return {
    ...next,
    reason: reasonParts.join(' '),
    resolution_summary: graph.resolution_summary,
    ambiguity_count: ambiguityCount,
  };
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
  const participantDomains = [input.organizer_email, ...(input.attendee_emails ?? [])]
    .map(email => email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email));
  const sourceSettings = await getSourceFilterSettings(db, tenantId);
  const participants = classifySourceParticipants(sourceSettings, participantDomains);
  const allInternal = participants.classification === 'internal';
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
  options: { ownerIds?: UUID[] | null; requireLinkedCustomer?: boolean } = {},
): Promise<calendarRepo.CalendarEvent | null> {
  const ownerIds = options.ownerIds !== undefined ? options.ownerIds : actor ? await getVisibleOwnerIds(db, actor) : undefined;
  const linked = await associateMeeting(db, tenantId, input, ownerIds);
  const hasLinkedSubject = Boolean(linked.contact_id || linked.account_id || linked.opportunity_id || linked.use_case_id);
  if (options.requireLinkedCustomer && (!hasLinkedSubject || !await linkedSubjectInOwnerScope(db, tenantId, linked, ownerIds))) {
    return null;
  }
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
      association_resolution_summary: linked.resolution_summary,
      association_ambiguity_count: linked.ambiguity_count,
      classification_reason: classified.reason,
    },
  });
  const validation = await validateMeetingEvent(db, tenantId, event);
  event = await calendarRepo.updateCalendarEvent(db, tenantId, event.id, validation) ?? event;
  const subject = primarySubject(event);
  if (event.validation_status !== 'skipped_internal' && !event.activity_id && subject.subject_type && subject.subject_id) {
    const registry = classified.registry;
    const fallbackActivityType: ActivityType = event.status === 'scheduled' ? 'meeting_scheduled' : 'meeting_held';
    const activity = await activityRepo.createActivity(db, tenantId, {
      type: toActivityType(registry?.mapped_activity_type, fallbackActivityType),
      subject: event.title,
      body: event.description ?? '',
      contact_id: event.contact_id ?? undefined,
      account_id: event.account_id ?? undefined,
      opportunity_id: event.opportunity_id ?? undefined,
      use_case_id: event.use_case_id ?? undefined,
      subject_type: subject.subject_type,
      subject_id: subject.subject_id,
      owner_id: userId ?? undefined,
      source_agent: `calendar:${event.provider}`,
      occurred_at: event.starts_at,
      detail: {
        calendar_event_id: event.id,
        meeting_url: event.meeting_url,
        attendees: event.attendee_emails,
        validation_status: event.validation_status,
      },
      created_by: userId ?? undefined,
    });
    event = await calendarRepo.updateCalendarEvent(db, tenantId, event.id, { activity_id: activity.id }) ?? event;
  }
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
  const { syncCalendarConnection } = await import('./source-sync.js');
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await syncCalendarConnection(db, job.tenant_id, job.connection_id);
      await calendarRepo.completeCalendarSyncJob(db, job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Calendar sync failed.';
      await calendarRepo.failCalendarSyncJob(db, job.id, message);
      try {
        await calendarRepo.updateCalendarConnection(db, job.tenant_id, job.connection_id, {
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
