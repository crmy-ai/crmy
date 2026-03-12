// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  workflowCreate, workflowUpdate, workflowGet,
  workflowDelete, workflowList, workflowRunList,
} from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as wfRepo from '../../db/repos/workflows.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function workflowTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'workflow_create',
      description: 'Create an automation workflow triggered by a CRM event (e.g. contact.created, opportunity.stage_changed)',
      inputSchema: workflowCreate,
      handler: async (input: z.infer<typeof workflowCreate>, actor: ActorContext) => {
        const workflow = await wfRepo.createWorkflow(db, actor.tenant_id, {
          ...input,
          created_by: actor.actor_id,
        });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'workflow.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'workflow',
          objectId: workflow.id,
          afterData: { name: workflow.name, trigger: workflow.trigger_event },
        });
        return { workflow, event_id };
      },
    },
    {
      name: 'workflow_get',
      description: 'Get a workflow by ID with recent run history',
      inputSchema: workflowGet,
      handler: async (input: z.infer<typeof workflowGet>, actor: ActorContext) => {
        const workflow = await wfRepo.getWorkflow(db, actor.tenant_id, input.id);
        if (!workflow) throw notFound('Workflow', input.id);
        const runs = await wfRepo.listRuns(db, input.id, { limit: 5 });
        return { workflow, recent_runs: runs.data };
      },
    },
    {
      name: 'workflow_update',
      description: 'Update a workflow configuration, trigger, or actions',
      inputSchema: workflowUpdate,
      handler: async (input: z.infer<typeof workflowUpdate>, actor: ActorContext) => {
        const before = await wfRepo.getWorkflow(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Workflow', input.id);
        const workflow = await wfRepo.updateWorkflow(db, actor.tenant_id, input.id, input.patch);
        return { workflow };
      },
    },
    {
      name: 'workflow_delete',
      description: 'Delete a workflow and its run history',
      inputSchema: workflowDelete,
      handler: async (input: z.infer<typeof workflowDelete>, actor: ActorContext) => {
        const deleted = await wfRepo.deleteWorkflow(db, actor.tenant_id, input.id);
        if (!deleted) throw notFound('Workflow', input.id);
        return { deleted: true };
      },
    },
    {
      name: 'workflow_list',
      description: 'List workflows, optionally filtered by trigger event or active status',
      inputSchema: workflowList,
      handler: async (input: z.infer<typeof workflowList>, actor: ActorContext) => {
        const result = await wfRepo.listWorkflows(db, actor.tenant_id, {
          trigger_event: input.trigger_event,
          is_active: input.is_active,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { workflows: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'workflow_run_list',
      description: 'List execution runs for a workflow',
      inputSchema: workflowRunList,
      handler: async (input: z.infer<typeof workflowRunList>, actor: ActorContext) => {
        const workflow = await wfRepo.getWorkflow(db, actor.tenant_id, input.workflow_id);
        if (!workflow) throw notFound('Workflow', input.workflow_id);
        const result = await wfRepo.listRuns(db, input.workflow_id, {
          status: input.status,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { runs: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
  ];
}
