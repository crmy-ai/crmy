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
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import type { ToolDef } from '../server.js';

export function activityTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'activity_create',
      description: 'Create an activity (call, email, meeting, note, task, etc.). Supports Context Engine fields: performed_by, subject_type/subject_id for polymorphic linking, occurred_at, outcome, and detail JSONB.',
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
        return { activity, event_id };
      },
    },
    {
      name: 'activity_get',
      description: 'Get an activity by ID',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const activity = await activityRepo.getActivity(db, actor.tenant_id, input.id);
        if (!activity) throw notFound('Activity', input.id);
        return { activity };
      },
    },
    {
      name: 'activity_search',
      description: 'Search activities with filters. Supports contact_id, account_id, opportunity_id, type, subject_type, subject_id, performed_by, and outcome.',
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
      description: 'Mark an activity as completed',
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
        return { activity, event_id };
      },
    },
    {
      name: 'activity_update',
      description: 'Update an activity. Pass id and a patch object with fields to update.',
      inputSchema: activityUpdate,
      handler: async (input: z.infer<typeof activityUpdate>, actor: ActorContext) => {
        const before = await activityRepo.getActivity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Activity', input.id);

        if (input.patch.custom_fields && Object.keys(input.patch.custom_fields).length > 0) {
          input.patch.custom_fields = await validateCustomFields(db, actor.tenant_id, 'activity', input.patch.custom_fields);
        }
        const activity = await activityRepo.updateActivity(db, actor.tenant_id, input.id, input.patch);
        if (!activity) throw notFound('Activity', input.id);

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
        return { activity, event_id };
      },
    },
    {
      name: 'activity_get_timeline',
      description: 'Get the activity timeline for any CRM object (contact, account, opportunity, use_case) via polymorphic subject.',
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
