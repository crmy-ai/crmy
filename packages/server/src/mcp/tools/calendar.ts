// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import type { ActorContext } from '@crmy/shared';
import { notFound } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import * as calendarRepo from '../../db/repos/calendar.js';
import { assertSubjectAccess, getActorUserId, isGlobalActor, resolveOwnerFilter } from '../../services/access-control.js';
import { processCalendarEvent, processMeetingArtifact } from '../../services/customer-activity.js';
import { suggestAvailabilityTimes } from '../../services/availability.js';
import { buildOAuthUrl, oauthReadiness } from '../../services/source-sync.js';
import type { ToolDef } from '../server.js';
import { runToolOperation } from '../tool-operation.js';
import { mutationReceipt } from '../mutation-receipt.js';

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
      name: 'availability_suggest_times',
      tier: 'extended',
      description: 'Suggest meeting times using connected internal actor calendar free/busy plus customer timing preferences from Memory. Returns ranked windows, checked calendar identities, freshness, and caveats. Does not expose raw calendar event details and does not create or send invites.',
      inputSchema: z.object({
        subject_type: z.enum(['account', 'contact', 'opportunity', 'use_case']).optional().describe('Customer record type for preference context and access checks.'),
        subject_id: z.string().uuid().optional().describe('Customer record id for preference context and access checks.'),
        account_id: z.string().uuid().optional().describe('Shortcut for subject_type=account.'),
        contact_id: z.string().uuid().optional().describe('Shortcut for subject_type=contact.'),
        opportunity_id: z.string().uuid().optional().describe('Shortcut for subject_type=opportunity.'),
        use_case_id: z.string().uuid().optional().describe('Shortcut for subject_type=use_case.'),
        actor_ids: z.array(z.string().uuid()).max(10).optional().describe('Human actor calendars to check. Defaults to the current human/session owner when available.'),
        duration_minutes: z.number().int().min(15).max(480).optional().default(30),
        date_start: z.string().datetime().optional().describe('Earliest candidate start time. Defaults to the next rounded hour.'),
        date_end: z.string().datetime().optional().describe('Latest candidate end time. Defaults to 14 days after date_start. Max range is 45 days.'),
        timezone: z.string().optional().default('UTC').describe('Timezone used for business-hour filtering and display labels, e.g. America/Los_Angeles.'),
        business_hours_start: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).optional().default('09:00'),
        business_hours_end: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).optional().default('17:00'),
        business_days_only: z.boolean().optional().default(true),
        increment_minutes: z.number().int().min(5).max(120).optional().default(30),
        limit: z.number().int().min(1).max(10).optional().default(3),
      }),
      handler: async (input, actor: ActorContext) => {
        return suggestAvailabilityTimes(db, actor, input);
      },
    },
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
      name: 'calendar_connection_start',
      tier: 'extended',
      description: 'Start Google or Microsoft calendar OAuth for the current human-linked actor and return the browser auth_url to finish provider consent. Use this from MCP/CLI when the user does not want to open the CRMy web UI. Pure agent actors without a linked human user cannot connect a calendar.',
      inputSchema: z.object({
        provider: z.enum(['google', 'microsoft']).describe('Calendar provider to connect. google = Google Calendar, microsoft = Outlook/Microsoft 365 Calendar.'),
        email_address: z.string().email().optional().describe('Calendar account email. Defaults to the current user email when omitted.'),
        display_name: z.string().optional(),
        meeting_ingest_scope: z.enum(['owned_accounts', 'accessible_accounts', 'all_meetings']).optional().default('owned_accounts'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input, actor: ActorContext) => {
        return runToolOperation(db, actor, 'calendar_connection_start', input, async () => {
          const userId = await getActorUserId(db, actor);
          if (!userId) {
            throw new Error('A human-linked user is required to connect a calendar. Use a user API key/session, or ask the human calendar owner to connect it.');
          }
          const user = await db.query('SELECT email, name FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1', [actor.tenant_id, userId]);
          const email = String(input.email_address ?? user.rows[0]?.email ?? '').trim().toLowerCase();
          if (!email || !email.includes('@')) throw new Error('A valid calendar email address is required.');
          const meetingIngestScope = input.meeting_ingest_scope === 'accessible_accounts' || input.meeting_ingest_scope === 'all_meetings'
            ? input.meeting_ingest_scope
            : 'owned_accounts';
          const setupCheck = await oauthReadiness(db, actor.tenant_id, 'calendar', input.provider);
          let connection = await calendarRepo.createPlaceholderCalendarConnection(db, actor.tenant_id, {
            user_id: userId,
            provider: input.provider,
            email_address: email,
            display_name: String(input.display_name ?? user.rows[0]?.name ?? ''),
            status: 'configuration_required',
            last_error: null,
            settings: {
              setup_required: true,
              meeting_ingest_scope: meetingIngestScope,
              setup_started_from: 'mcp',
              next_step: 'Open the returned auth_url in a browser to finish calendar OAuth.',
            },
          });
          const authUrl = setupCheck.can_start_oauth
            ? await buildOAuthUrl(db, 'calendar', input.provider, {
                kind: 'calendar',
                provider: input.provider,
                tenant_id: actor.tenant_id,
                user_id: userId,
                email_address: email,
                display_name: String(input.display_name ?? user.rows[0]?.name ?? ''),
                meeting_ingest_scope: meetingIngestScope,
              })
            : null;
          if (!authUrl) {
            connection = await calendarRepo.updateCalendarConnection(db, actor.tenant_id, connection.id, {
              last_error: setupCheck.setup_blockers[0] ?? 'Calendar OAuth setup is not ready yet.',
              settings: {
                setup_required: true,
                oauth_configured: false,
                oauth_ready: false,
                oauth_setup_status: setupCheck.setup_status,
                oauth_setup_blockers: setupCheck.setup_blockers,
                oauth_app_source: setupCheck.app_source,
                oauth_redirect_uri: setupCheck.redirect_uri,
                meeting_ingest_scope: meetingIngestScope,
              },
            }) ?? connection;
          }
          return {
            connection,
            auth_url: authUrl,
            oauth_ready: Boolean(authUrl),
            setup_check: setupCheck,
            status: authUrl ? 'oauth_required' : 'configuration_required',
            message: authUrl
              ? 'Open auth_url in a browser, finish provider consent, then return here and list calendar connections to confirm status=connected.'
              : setupCheck.user_action,
            mutation: mutationReceipt(actor, { objectType: 'calendar_connection', objectId: connection.id }),
          };
        });
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
      inputSchema: z.object({ id: z.string().uuid(), idempotency_key: z.string().max(128).optional() }),
      handler: async (input: { id: string; idempotency_key?: string }, actor: ActorContext) => {
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
        idempotency_key: z.string().max(128).optional(),
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
