// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { activityCreate, activityUpdate, activitySearch, activityComplete, activityGetTimeline } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as activityRepo from '../../db/repos/activities.js';
import * as governorLimits from '../../db/repos/governor-limits.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import { indexDocument } from '../../search/SearchIndexerService.js';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import { triggerExtraction } from '../../agent/extraction.js';
import type { ToolDef } from '../server.js';

export function activityTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'activity_create',
      tier: 'core',
      description: 'Log a meaningful action: outreach sent, call made, meeting held, stage changed, proposal drafted, research completed. Set occurred_at to when the event actually happened, not when you are logging it — this is critical for accurate timelines when logging retroactively. The detail field is a free JSONB payload for type-specific data: for outreach_email include {to, subject, channel}, for meeting_held include {duration_minutes, attendees}, for stage_change include {from_stage, to_stage}. If an LLM backend is configured, CRMy auto-extracts context entries from the activity description. To log an activity for a contact, set subject_type to "contact" and subject_id to the contact UUID.',
      inputSchema: activityCreate,
      handler: async (input: z.infer<typeof activityCreate>, actor: ActorContext) => {
        // Enforce governor limit on daily activity count
        const todayCount = await governorLimits.countActivitiesToday(db, actor.tenant_id);
        await governorLimits.enforceLimit(db, actor.tenant_id, 'activities_per_day', todayCount);

        if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
          input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'activity', input.custom_fields, { isCreate: true });
        }
        const activity = await activityRepo.createActivity(db, actor.tenant_id, {
          ...input,
          source_agent: actor.actor_type === 'agent' ? actor.actor_id : undefined,
          created_by: actor.actor_id,
        });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'activity.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'activity',
          objectId: activity.id,
          afterData: activity,
        });

        // Fire-and-forget extraction — does not affect the response
        triggerExtraction(db, actor.tenant_id, activity.id).catch(err =>
          console.error('[extraction] trigger failed:', err),
        );

        indexDocument(db, 'activity', activity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] activity index ${activity.id}: ${(err as Error).message}`));

        return { activity, event_id };
      },
    },
    {
      name: 'activity_get',
      tier: 'core',
      description: 'Retrieve a single activity by UUID including its full body, detail payload, outcome, and linked subject. Use this when you need the complete activity record from a timeline or search result.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const activity = await activityRepo.getActivity(db, actor.tenant_id, input.id);
        if (!activity) throw notFound('Activity', input.id);
        return { activity };
      },
    },
    {
      name: 'activity_search',
      tier: 'core',
      description: 'Search activities across the CRM with flexible filters. Use type to filter by activity kind (outreach_email, meeting_held, stage_change, etc.), performed_by to see a specific actor contributions, outcome to find activities with a particular result, or subject_type/subject_id to scope to a specific CRM record. Returns paginated results sorted by occurred_at descending.',
      inputSchema: activitySearch,
      handler: async (input: z.infer<typeof activitySearch>, actor: ActorContext) => {
        const result = await activityRepo.searchActivities(db, actor.tenant_id, {
          ...input,
          limit: input.limit ?? 20,
        });
        return { activities: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'activity_complete',
      tier: 'extended',
      description: 'Mark an activity as completed, setting its status and completed_at timestamp. Optionally add a completion note that appends to the activity body. If a note is added and an LLM backend is configured, context extraction re-runs on the updated content.',
      inputSchema: activityComplete,
      handler: async (input: z.infer<typeof activityComplete>, actor: ActorContext) => {
        const before = await activityRepo.getActivity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Activity', input.id);

        const activity = await activityRepo.completeActivity(
          db,
          actor.tenant_id,
          input.id,
          input.completed_at,
        );
        if (!activity) throw notFound('Activity', input.id);

        // If a note was provided, update the body
        if (input.note) {
          await activityRepo.updateActivity(db, actor.tenant_id, input.id, {
            body: before.body ? `${before.body}\n\n---\n${input.note}` : input.note,
          });
          // Re-extract now that body has changed
          triggerExtraction(db, actor.tenant_id, input.id).catch(err =>
            console.error('[extraction] trigger on complete failed:', err),
          );
        }

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'activity.completed',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'activity',
          objectId: activity.id,
          beforeData: { status: before.status },
          afterData: { status: 'completed' },
        });
        indexDocument(db, 'activity', activity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] activity index ${activity.id}: ${(err as Error).message}`));
        return { activity, event_id };
      },
    },
    {
      name: 'activity_update',
      tier: 'extended',
      description: 'Update an existing activity record. Pass the id and a patch object with fields to change (body, subject, outcome, detail, custom_fields, etc.). If the body content changes, context extraction automatically re-runs to capture any new information.',
      inputSchema: activityUpdate,
      handler: async (input: z.infer<typeof activityUpdate>, actor: ActorContext) => {
        const before = await activityRepo.getActivity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Activity', input.id);

        if (input.patch.custom_fields && Object.keys(input.patch.custom_fields).length > 0) {
          input.patch.custom_fields = await validateCustomFields(db, actor.tenant_id, 'activity', input.patch.custom_fields);
        }
        const activity = await activityRepo.updateActivity(db, actor.tenant_id, input.id, input.patch);
        if (!activity) throw notFound('Activity', input.id);

        // Re-extract if body content changed
        if (input.patch.body != null) {
          triggerExtraction(db, actor.tenant_id, input.id).catch(err =>
            console.error('[extraction] trigger on update failed:', err),
          );
        }

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'activity.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'activity',
          objectId: activity.id,
          beforeData: before,
          afterData: activity,
        });
        indexDocument(db, 'activity', activity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] activity index ${activity.id}: ${(err as Error).message}`));
        return { activity, event_id };
      },
    },
    {
      name: 'activity_get_timeline',
      tier: 'core',
      description: 'Get a chronological activity timeline for any CRM object (contact, account, opportunity, or use_case) via polymorphic subject_type and subject_id. Optionally filter by activity types to see only specific kinds of activities. Returns activities sorted by occurred_at descending with the total count for pagination.',
      inputSchema: activityGetTimeline,
      handler: async (input: z.infer<typeof activityGetTimeline>, actor: ActorContext) => {
        const result = await activityRepo.getSubjectTimeline(
          db,
          actor.tenant_id,
          input.subject_type,
          input.subject_id,
          { limit: input.limit ?? 50, types: input.types },
        );
        return { activities: result.activities, total: result.total };
      },
    },
  ];
}
