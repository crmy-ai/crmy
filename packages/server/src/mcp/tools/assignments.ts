// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  assignmentCreate, assignmentGet, assignmentSearch,
  assignmentUpdate, assignmentAccept, assignmentComplete, assignmentDecline,
} from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as assignmentRepo from '../../db/repos/assignments.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function assignmentTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'assignment_create',
      description: 'Create a new assignment — assign work to a human or agent. The assigner is automatically set to the current actor.',
      inputSchema: assignmentCreate,
      handler: async (input: z.infer<typeof assignmentCreate>, actor: ActorContext) => {
        const assignment = await assignmentRepo.createAssignment(db, actor.tenant_id, {
          ...input,
          assigned_by: actor.actor_id,
        });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'assignment.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'assignment',
          objectId: assignment.id,
          afterData: assignment,
        });
        return { assignment, event_id };
      },
    },
    {
      name: 'assignment_get',
      description: 'Get an assignment by ID',
      inputSchema: assignmentGet,
      handler: async (input: z.infer<typeof assignmentGet>, actor: ActorContext) => {
        const assignment = await assignmentRepo.getAssignment(db, actor.tenant_id, input.id);
        if (!assignment) throw notFound('Assignment', input.id);
        return { assignment };
      },
    },
    {
      name: 'assignment_list',
      description: 'List assignments with filters. Supports assigned_to, assigned_by, status, priority, subject_type, subject_id.',
      inputSchema: assignmentSearch,
      handler: async (input: z.infer<typeof assignmentSearch>, actor: ActorContext) => {
        const result = await assignmentRepo.searchAssignments(db, actor.tenant_id, {
          ...input,
          limit: input.limit ?? 20,
        });
        return { assignments: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'assignment_update',
      description: 'Update an assignment. Pass id and a patch object with fields to update.',
      inputSchema: assignmentUpdate,
      handler: async (input: z.infer<typeof assignmentUpdate>, actor: ActorContext) => {
        const before = await assignmentRepo.getAssignment(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Assignment', input.id);

        const assignment = await assignmentRepo.updateAssignment(db, actor.tenant_id, input.id, input.patch);
        if (!assignment) throw notFound('Assignment', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'assignment.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'assignment',
          objectId: assignment.id,
          beforeData: before,
          afterData: assignment,
        });
        return { assignment, event_id };
      },
    },
    {
      name: 'assignment_accept',
      description: 'Accept a pending assignment.',
      inputSchema: assignmentAccept,
      handler: async (input: z.infer<typeof assignmentAccept>, actor: ActorContext) => {
        const before = await assignmentRepo.getAssignment(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Assignment', input.id);

        const assignment = await assignmentRepo.acceptAssignment(db, actor.tenant_id, input.id);
        if (!assignment) throw notFound('Assignment', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'assignment.accepted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'assignment',
          objectId: assignment.id,
          beforeData: { status: before.status },
          afterData: { status: 'accepted' },
        });
        return { assignment, event_id };
      },
    },
    {
      name: 'assignment_complete',
      description: 'Complete an assignment. Optionally link the completing activity.',
      inputSchema: assignmentComplete,
      handler: async (input: z.infer<typeof assignmentComplete>, actor: ActorContext) => {
        const before = await assignmentRepo.getAssignment(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Assignment', input.id);

        const assignment = await assignmentRepo.completeAssignment(
          db, actor.tenant_id, input.id, input.completed_by_activity_id,
        );
        if (!assignment) throw notFound('Assignment', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'assignment.completed',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'assignment',
          objectId: assignment.id,
          beforeData: { status: before.status },
          afterData: { status: 'completed' },
        });
        return { assignment, event_id };
      },
    },
    {
      name: 'assignment_decline',
      description: 'Decline an assignment. Optionally provide a reason.',
      inputSchema: assignmentDecline,
      handler: async (input: z.infer<typeof assignmentDecline>, actor: ActorContext) => {
        const before = await assignmentRepo.getAssignment(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Assignment', input.id);

        const assignment = await assignmentRepo.declineAssignment(db, actor.tenant_id, input.id);
        if (!assignment) throw notFound('Assignment', input.id);

        // If a reason was given, store it in metadata
        if (input.reason) {
          await assignmentRepo.updateAssignment(db, actor.tenant_id, input.id, {
            metadata: { ...((assignment.metadata as Record<string, unknown>) ?? {}), decline_reason: input.reason },
          });
        }

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'assignment.declined',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'assignment',
          objectId: assignment.id,
          beforeData: { status: before.status },
          afterData: { status: 'declined' },
          metadata: input.reason ? { reason: input.reason } : undefined,
        });
        return { assignment, event_id };
      },
    },
  ];
}
