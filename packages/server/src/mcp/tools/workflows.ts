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
import { invalidateWorkflowCache, dryRunWorkflow, executeWorkflowDirect } from '../../workflows/engine.js';
import type { ToolDef } from '../server.js';
import { WORKFLOW_TEMPLATES, getTemplatesByCategory, getTemplateById } from '../../lib/workflow-templates.js';

export function workflowTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'workflow_create',
      tier: 'admin',
      description: 'Create an automation workflow triggered by a CRM event (e.g. "contact.created", "opportunity.stage_changed"). Define the trigger event, optional filter conditions, and a sequence of up to 20 typed actions. Supports {{variable}} interpolation in action config fields. Set max_runs_per_hour to rate-limit high-frequency triggers.',
      inputSchema: workflowCreate,
      handler: async (input: z.infer<typeof workflowCreate>, actor: ActorContext) => {
        const workflow = await wfRepo.createWorkflow(db, actor.tenant_id, {
          ...input,
          actions: input.actions as unknown[],
          created_by: actor.actor_id,
        });
        invalidateWorkflowCache(actor.tenant_id);
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'workflow.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'workflow',
          objectId: workflow.id,
          afterData: { name: workflow.name, trigger: workflow.trigger_event, is_active: workflow.is_active },
        });
        return { workflow, event_id };
      },
    },
    {
      name: 'workflow_get',
      tier: 'admin',
      description: 'Retrieve a workflow configuration by UUID including its trigger event, filter conditions, actions, error stats, and recent execution history. Use this to inspect or debug a workflow.',
      inputSchema: workflowGet,
      handler: async (input: z.infer<typeof workflowGet>, actor: ActorContext) => {
        const workflow = await wfRepo.getWorkflow(db, actor.tenant_id, input.id);
        if (!workflow) throw notFound('Workflow', input.id);
        const runs = await wfRepo.listRuns(db, input.id, { limit: 10 });
        return { workflow, recent_runs: runs.data };
      },
    },
    {
      name: 'workflow_update',
      tier: 'admin',
      description: 'Update a workflow configuration including its trigger event, filter conditions, actions, active status, and rate limit. Use is_active: false to temporarily disable a workflow without deleting it.',
      inputSchema: workflowUpdate,
      handler: async (input: z.infer<typeof workflowUpdate>, actor: ActorContext) => {
        const before = await wfRepo.getWorkflow(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Workflow', input.id);

        const patch = { ...input.patch } as Record<string, unknown>;
        if (patch.actions) patch.actions = patch.actions as unknown[];

        const workflow = await wfRepo.updateWorkflow(db, actor.tenant_id, input.id, patch);
        invalidateWorkflowCache(actor.tenant_id);

        // Emit audit event
        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'workflow.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'workflow',
          objectId: input.id,
          beforeData: { name: before.name, is_active: before.is_active, trigger_event: before.trigger_event },
          afterData: { name: workflow?.name, is_active: workflow?.is_active, trigger_event: workflow?.trigger_event },
        });

        return { workflow };
      },
    },
    {
      name: 'workflow_delete',
      tier: 'admin',
      description: 'Delete a workflow and its entire run history. This is a destructive action — the workflow stops executing and all execution records are removed. Consider using workflow_update with is_active: false to disable without deleting.',
      inputSchema: workflowDelete,
      handler: async (input: z.infer<typeof workflowDelete>, actor: ActorContext) => {
        const workflow = await wfRepo.getWorkflow(db, actor.tenant_id, input.id);
        if (!workflow) throw notFound('Workflow', input.id);

        const deleted = await wfRepo.deleteWorkflow(db, actor.tenant_id, input.id);
        if (!deleted) throw notFound('Workflow', input.id);

        invalidateWorkflowCache(actor.tenant_id);

        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'workflow.deleted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'workflow',
          objectId: input.id,
          beforeData: { name: workflow.name, trigger_event: workflow.trigger_event },
        });

        return { deleted: true };
      },
    },
    {
      name: 'workflow_list',
      tier: 'admin',
      description: 'List all workflows for the current tenant, optionally filtered by trigger event type or active status. Returns workflow configurations with run counts, last run time, and error counts.',
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
      tier: 'admin',
      description: 'List execution runs for a specific workflow. Shows each run status, action progress, execution duration in milliseconds, per-action logs, and any error details. Useful for monitoring and debugging automation.',
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
    {
      name: 'workflow_test',
      tier: 'admin',
      description: 'Dry-run a workflow against a sample payload without executing any actions. Returns whether the workflow would trigger, per-field filter match details, and fully resolved action configs with {{variables}} substituted. Use this to validate a workflow before activating it or to debug trigger filter conditions.',
      inputSchema: z.object({
        id: z.string().uuid().describe('Workflow UUID to test'),
        sample_payload: z.record(z.unknown()).optional().default({}).describe('Sample event payload to test against. Should match the shape of the workflow trigger event (e.g. contact fields for contact.created)'),
      }),
      handler: async (input: { id: string; sample_payload?: Record<string, unknown> }, actor: ActorContext) => {
        return dryRunWorkflow(db, actor.tenant_id, input.id, input.sample_payload ?? {});
      },
    },
    {
      name: 'workflow_clone',
      tier: 'admin',
      description: 'Duplicate an existing workflow. Creates a new workflow with the same trigger, filter, and actions but with the name prefixed "Copy of" and is_active set to false. Use this to create workflow variants or templates.',
      inputSchema: z.object({
        id: z.string().uuid().describe('UUID of the workflow to clone'),
        name: z.string().min(1).optional().describe('Custom name for the clone (defaults to "Copy of <original name>")'),
      }),
      handler: async (input: { id: string; name?: string }, actor: ActorContext) => {
        const source = await wfRepo.getWorkflow(db, actor.tenant_id, input.id);
        if (!source) throw notFound('Workflow', input.id);

        const clone = await wfRepo.createWorkflow(db, actor.tenant_id, {
          name: input.name ?? `Copy of ${source.name}`,
          description: source.description,
          trigger_event: source.trigger_event,
          trigger_filter: source.trigger_filter,
          actions: source.actions,
          is_active: false, // always start inactive
          created_by: actor.actor_id,
          max_runs_per_hour: source.max_runs_per_hour,
        });

        invalidateWorkflowCache(actor.tenant_id);
        return { workflow: clone };
      },
    },
    {
      name: 'workflow_trigger',
      tier: 'admin',
      description: 'Manually trigger a workflow by ID, bypassing normal event dispatch. Works for any workflow (manual or event-driven). Use this to run an automation on behalf of a human, test a live workflow against a real subject, or invoke a workflow as part of a multi-agent orchestration. Returns a run summary with status and action count.',
      inputSchema: z.object({
        id: z.string().uuid().describe('UUID of the workflow to trigger'),
        subject_type: z.enum(['contact', 'account', 'opportunity', 'use_case']).optional()
          .describe('Entity type the workflow is running for (used to resolve {{contact.*}} etc. variables)'),
        subject_id: z.string().uuid().optional()
          .describe('UUID of the subject entity'),
        variables: z.record(z.unknown()).optional()
          .describe('Additional variables to inject into action templates, merged on top of subject fields'),
      }),
      handler: async (
        input: { id: string; subject_type?: string; subject_id?: string; variables?: Record<string, unknown> },
        actor: ActorContext,
      ) => {
        const payload: Record<string, unknown> = {
          ...(input.variables ?? {}),
          ...(input.subject_type ? { _subject_type: input.subject_type } : {}),
          ...(input.subject_id   ? { _subject_id:   input.subject_id   } : {}),
        };
        return executeWorkflowDirect(db, actor.tenant_id, input.id, payload);
      },
    },
    {
      name: 'workflow_template_list',
      tier: 'core',
      description: 'List available workflow templates for common GTM patterns (lead qualification, deal won, churn risk, inbound reply, assignment overdue, etc.). Each template returns a ready-to-use workflow configuration that can be passed directly to workflow_create. Use this to help users bootstrap automations quickly instead of building from scratch.',
      inputSchema: z.object({
        category: z.string().optional().describe('Filter templates by category (Inbound, Revenue, Customer Success, Outreach, Operations). Omit to return all templates.'),
        id:       z.string().optional().describe('Return a single template by its ID'),
      }),
      handler: async (input: { category?: string; id?: string }) => {
        if (input.id) {
          const tpl = getTemplateById(input.id);
          if (!tpl) throw Object.assign(new Error(`Template "${input.id}" not found`), { status: 404 });
          return { template: tpl };
        }

        if (input.category) {
          const byCategory = getTemplatesByCategory();
          const templates = byCategory[input.category] ?? [];
          return {
            category: input.category,
            count: templates.length,
            templates,
          };
        }

        return {
          count: WORKFLOW_TEMPLATES.length,
          categories: Object.keys(getTemplatesByCategory()),
          templates: WORKFLOW_TEMPLATES.map(t => ({
            id:          t.id,
            category:    t.category,
            name:        t.name,
            description: t.description,
            trigger_event: t.trigger_event,
          })),
        };
      },
    },
  ];
}
