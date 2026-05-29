// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import type { ActorContext } from '@crmy/shared';
import { notFound } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import * as calendarRepo from '../../db/repos/calendar.js';
import { assertSubjectAccess, getActorUserId, isGlobalActor, resolveOwnerFilter } from '../../services/access-control.js';
import { processCalendarEvent, processMeetingArtifact } from '../../services/customer-activity.js';
import type { ToolDef } from '../server.js';
import { runToolOperation } from '../tool-operation.js';

async function assertCalendarEventAccess(db: DbPool, actor: ActorContext, event: calendarRepo.CalendarEvent): Promise<void> {
  if (isGlobalActor(actor)) return;
  const actorUserId = await getActorUserId(db, actor);
  if (actorUserId && event.user_id === actorUserId) return;
  const linked = [
    ['opportunity', event.opportunity_id],
    ['use_case', event.use_case_id],
    ['contact', event.contact_id],
    ['account', event.account_id],
  ] as const;
  for (const [type, id] of linked) {
    if (!id) continue;
    await assertSubjectAccess(db, actor, type, id);
    return;
  }
  throw notFound('CalendarEvent', event.id);
}

export function calendarTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'calendar_connection_list',
      tier: 'extended',
      description: 'List calendar connections and meeting-capture health visible to the current user.',
      inputSchema: z.object({}),
      handler: async (_input: {}, actor: ActorContext) => {
        const userId = isGlobalActor(actor) ? undefined : await getActorUserId(db, actor);
        const ownerFilter = await resolveOwnerFilter(db, actor);
        const data = await calendarRepo.listCalendarConnections(db, actor.tenant_id, userId);
        const summary = await calendarRepo.summarizeCalendarEvents(db, actor.tenant_id, ownerFilter.owner_ids);
        return { calendar_connections: data, total: data.length, summary };
      },
    },
    {
      name: 'calendar_event_search',
      tier: 'extended',
      description: 'Search customer calendar meetings, including validation state, linked records, and processing status.',
      inputSchema: z.object({
        q: z.string().optional(),
        tab: z.enum(['meetings', 'needs_context', 'all']).optional().default('meetings'),
        classification: z.string().optional(),
        validation_status: z.enum(['ready', 'missing_context', 'needs_record_link', 'needs_review', 'skipped_internal', 'failed']).optional(),
        processing_status: z.enum(['unprocessed', 'processing', 'processed', 'needs_review', 'skipped', 'failed', 'ignored']).optional(),
        include_internal: z.boolean().optional().default(false),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
      handler: async (input, actor: ActorContext) => {
        const ownerFilter = await resolveOwnerFilter(db, actor);
        const result = await calendarRepo.listCalendarEvents(db, actor.tenant_id, {
          q: input.q,
          tab: input.tab,
          classification: input.classification,
          validation_status: input.validation_status,
          processing_status: input.processing_status,
          owner_ids: ownerFilter.owner_ids,
          include_internal: input.include_internal,
          limit: input.limit,
          cursor: input.cursor,
        });
        return { calendar_events: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'calendar_event_get',
      tier: 'extended',
      description: 'Get a single customer meeting, including linked records, validation blockers, and artifacts.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const event = await calendarRepo.getCalendarEvent(db, actor.tenant_id, input.id);
        if (!event) throw notFound('CalendarEvent', input.id);
        await assertCalendarEventAccess(db, actor, event);
        const artifacts = await calendarRepo.listMeetingArtifacts(db, actor.tenant_id, event.id);
        return { calendar_event: event, artifacts };
      },
    },
    {
      name: 'calendar_event_process',
      tier: 'extended',
      description: 'Process a ready customer meeting artifact as Raw Context so CRMy can extract Signals and Memory.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        return runToolOperation(db, actor, 'calendar_event_process', input, async () => {
          const event = await calendarRepo.getCalendarEvent(db, actor.tenant_id, input.id);
          if (!event) throw notFound('CalendarEvent', input.id);
          await assertCalendarEventAccess(db, actor, event);
          return processCalendarEvent(db, actor.tenant_id, event.id, actor);
        });
      },
    },
    {
      name: 'calendar_event_add_context',
      tier: 'extended',
      description: 'Attach meeting notes, transcript, or recap text to a customer meeting and process it as Raw Context.',
      inputSchema: z.object({
        id: z.string().uuid(),
        artifact_type: z.enum(['transcript', 'notes', 'summary', 'recording', 'other']).default('notes'),
        text_content: z.string().min(1),
        source_label: z.string().optional(),
        process: z.boolean().optional().default(true),
      }),
      handler: async (input, actor: ActorContext) => {
        return runToolOperation(db, actor, 'calendar_event_add_context', input, async () => {
          const event = await calendarRepo.getCalendarEvent(db, actor.tenant_id, input.id);
          if (!event) throw notFound('CalendarEvent', input.id);
          await assertCalendarEventAccess(db, actor, event);
          const artifact = await calendarRepo.createMeetingArtifact(db, actor.tenant_id, {
            calendar_event_id: event.id,
            artifact_type: input.artifact_type,
            source: 'mcp',
            source_label: input.source_label ?? event.title,
            text_content: input.text_content,
            created_by: actor.actor_id,
            metadata: { input_channel: 'mcp_calendar_event_add_context' },
          });
          const processed = input.process
            ? await processMeetingArtifact(db, actor.tenant_id, event.id, artifact, actor)
            : artifact;
          return { calendar_event_id: event.id, artifact: processed };
        });
      },
    },
    {
      name: 'meeting_classification_list',
      tier: 'core',
      description: 'List meeting classifications CRMy uses to classify customer meetings and validate required context.',
      inputSchema: z.object({ include_disabled: z.boolean().optional().default(false) }),
      handler: async (input: { include_disabled?: boolean }, actor: ActorContext) => {
        const classifications = await calendarRepo.listMeetingClassifications(db, actor.tenant_id, input.include_disabled ?? false);
        return { meeting_classifications: classifications, total: classifications.length };
      },
    },
  ];
}
