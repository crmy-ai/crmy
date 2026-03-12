// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { activityCreate, activityUpdate, activitySearch, activityComplete } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as activityRepo from '../../db/repos/activities.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function activityTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'activity_create',
      description: 'Create a standalone activity (call, email, meeting, note, task)',
      inputSchema: activityCreate,
      handler: async (input: z.infer<typeof activityCreate>, actor: ActorContext) => {
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
      description: 'Search activities with filters. Supports contact_id, account_id, opportunity_id, and type.',
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
  ];
}
