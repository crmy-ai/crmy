// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  assignmentCreate, assignmentGet, assignmentSearch,
  assignmentUpdate, assignmentAccept, assignmentComplete, assignmentDecline,
  assignmentStart, assignmentBlock, assignmentCancel,
} from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as assignmentRepo from '../../db/repos/assignments.js';
import * as governorLimits from '../../db/repos/governor-limits.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function assignmentTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'assignment_create',
      description: 'Create an assignment to hand off work from one actor to another — this is the agent-to-human (or agent-to-agent) coordination primitive. The context field (plain text) is the handoff brief: write it as if explaining to a colleague what they need to know — what you tried, what you learned, what the assignee needs to do, and what to avoid. Set priority to "urgent" sparingly as it surfaces at the top of the human queue. The human sees assignments in the web UI Assignments view and via "crmy assignments list --mine". The assigner is automatically set to the current actor.',
      inputSchema: assignmentCreate,
      handler: async (input: z.infer<typeof assignmentCreate>, actor: ActorContext) => {
        // Enforce governor limit on active assignments
        const activeCount = await governorLimits.countActiveAssignments(db, actor.tenant_id);
        await governorLimits.enforceLimit(db, actor.tenant_id, 'assignments_active', activeCount);

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
      description: 'Retrieve a single assignment by UUID, including its full context brief, status, priority, and linked subject. Use this to read the handoff details before starting work on an assignment.',
      inputSchema: assignmentGet,
      handler: async (input: z.infer<typeof assignmentGet>, actor: ActorContext) => {
        const assignment = await assignmentRepo.getAssignment(db, actor.tenant_id, input.id);
        if (!assignment) throw notFound('Assignment', input.id);
        return { assignment };
      },
    },
    {
      name: 'assignment_list',
      description: 'List assignments with flexible filters. Use assigned_to to see your own queue, assigned_by to see what you have delegated, status to filter by lifecycle state (pending, accepted, in_progress, blocked, completed, declined, cancelled), and priority to focus on urgent items. Returns paginated results sorted by priority and creation time.',
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
      description: 'Update an assignment by passing its id and a patch object with fields to change. Use this to modify the context brief, adjust priority, update the due date, or change the assignee. For status transitions, prefer the dedicated accept/start/complete/block/decline/cancel tools instead.',
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
      description: 'Accept a pending assignment, transitioning it from "pending" to "accepted" status. Call this when you are ready to take ownership of the work. The assignment must be in "pending" status.',
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
      description: 'Mark an assignment as completed. Optionally pass completed_by_activity_id to link the activity that fulfilled the assignment — this creates a clear audit trail showing exactly what action completed the work.',
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
      description: 'Decline a pending assignment you cannot or should not handle. Optionally provide a reason so the assigner understands why and can reassign. The reason is stored in the assignment metadata for audit.',
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
    {
      name: 'assignment_start',
      description: 'Begin working on an accepted assignment, transitioning it from "accepted" to "in_progress" status. Call this when you actively start the work so the assigner can see progress.',
      inputSchema: assignmentStart,
      handler: async (input: z.infer<typeof assignmentStart>, actor: ActorContext) => {
        const before = await assignmentRepo.getAssignment(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Assignment', input.id);

        const assignment = await assignmentRepo.startAssignment(db, actor.tenant_id, input.id);
        if (!assignment) throw notFound('Assignment', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'assignment.started',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'assignment',
          objectId: assignment.id,
          beforeData: { status: before.status },
          afterData: { status: 'in_progress' },
        });
        return { assignment, event_id };
      },
    },
    {
      name: 'assignment_block',
      description: 'Mark an in-progress assignment as blocked when you cannot continue without external input or resolution. Provide a reason describing what is blocking progress so the assigner or team can help unblock.',
      inputSchema: assignmentBlock,
      handler: async (input: z.infer<typeof assignmentBlock>, actor: ActorContext) => {
        const before = await assignmentRepo.getAssignment(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Assignment', input.id);

        const assignment = await assignmentRepo.blockAssignment(db, actor.tenant_id, input.id);
        if (!assignment) throw notFound('Assignment', input.id);

        if (input.reason) {
          await assignmentRepo.updateAssignment(db, actor.tenant_id, input.id, {
            metadata: { ...((assignment.metadata as Record<string, unknown>) ?? {}), block_reason: input.reason },
          });
        }

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'assignment.blocked',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'assignment',
          objectId: assignment.id,
          beforeData: { status: before.status },
          afterData: { status: 'blocked' },
          metadata: input.reason ? { reason: input.reason } : undefined,
        });
        return { assignment, event_id };
      },
    },
    {
      name: 'assignment_cancel',
      description: 'Cancel an assignment that is no longer needed. Works from any non-terminal state (pending, accepted, in_progress, blocked). Optionally provide a reason explaining why the work is no longer required.',
      inputSchema: assignmentCancel,
      handler: async (input: z.infer<typeof assignmentCancel>, actor: ActorContext) => {
        const before = await assignmentRepo.getAssignment(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Assignment', input.id);

        const assignment = await assignmentRepo.cancelAssignment(db, actor.tenant_id, input.id);
        if (!assignment) throw notFound('Assignment', input.id);

        if (input.reason) {
          await assignmentRepo.updateAssignment(db, actor.tenant_id, input.id, {
            metadata: { ...((assignment.metadata as Record<string, unknown>) ?? {}), cancel_reason: input.reason },
          });
        }

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'assignment.cancelled',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'assignment',
          objectId: assignment.id,
          beforeData: { status: before.status },
          afterData: { status: 'cancelled' },
          metadata: input.reason ? { reason: input.reason } : undefined,
        });
        return { assignment, event_id };
      },
    },
  ];
}
