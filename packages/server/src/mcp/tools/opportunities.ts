// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { opportunityCreate, opportunityUpdate, opportunitySearch, opportunityAdvanceStage, pipelineSummary } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as oppRepo from '../../db/repos/opportunities.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, validationError, permissionDenied } from '@crmy/shared';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import type { ToolDef } from '../server.js';

export function opportunityTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'opportunity_create',
      description: 'Create a new sales opportunity linked to an account. Set stage, amount (in cents), close_date, probability, and forecast_cat to build the pipeline record. The amount field represents ARR in cents (e.g. 180000 for $1,800). Link to an account_id and optionally a primary contact_id.',
      inputSchema: opportunityCreate,
      handler: async (input: z.infer<typeof opportunityCreate>, actor: ActorContext) => {
        if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
          input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'opportunity', input.custom_fields, { isCreate: true });
        }
        const opportunity = await oppRepo.createOpportunity(db, actor.tenant_id, {
          ...input,
          created_by: actor.actor_id,
        });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'opportunity.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'opportunity',
          objectId: opportunity.id,
          afterData: opportunity,
        });
        return { opportunity, event_id };
      },
    },
    {
      name: 'opportunity_get',
      description: 'Retrieve a single opportunity by UUID, including its account details and recent activities. For a comprehensive view with context entries, stale warnings, and assignments, use briefing_get on the opportunity instead.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const opportunity = await oppRepo.getOpportunity(db, actor.tenant_id, input.id);
        if (!opportunity) throw notFound('Opportunity', input.id);

        const activities = await oppRepo.getOpportunityActivities(db, actor.tenant_id, input.id);
        return { opportunity, activities };
      },
    },
    {
      name: 'opportunity_search',
      description: 'Search opportunities with flexible filters. Use stage to find deals at a specific pipeline stage (e.g. "Negotiation"), account_id for a specific company, forecast_cat for pipeline categorization, and date range to find deals closing within a window. Useful for pipeline reviews and identifying at-risk deals approaching their close_date.',
      inputSchema: opportunitySearch,
      handler: async (input: z.infer<typeof opportunitySearch>, actor: ActorContext) => {
        const result = await oppRepo.searchOpportunities(db, actor.tenant_id, {
          ...input,
          limit: input.limit ?? 20,
        });
        return { opportunities: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'opportunity_advance_stage',
      description: 'Advance an opportunity to a new pipeline stage. Automatically logs a stage_change activity for the audit trail. When setting stage to "closed_lost", you must provide a lost_reason explaining why the deal was lost — this is required for pipeline analytics.',
      inputSchema: opportunityAdvanceStage,
      handler: async (input: z.infer<typeof opportunityAdvanceStage>, actor: ActorContext) => {
        if (input.stage === 'closed_lost' && !input.lost_reason) {
          throw validationError('lost_reason is required when closing as lost');
        }

        const before = await oppRepo.getOpportunity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Opportunity', input.id);

        const patch: Record<string, unknown> = { stage: input.stage };
        if (input.lost_reason) patch.lost_reason = input.lost_reason;
        if (input.stage === 'closed_won' || input.stage === 'closed_lost') {
          patch.forecast_cat = 'closed';
        }

        const opportunity = await oppRepo.updateOpportunity(db, actor.tenant_id, input.id, patch);
        if (!opportunity) throw notFound('Opportunity', input.id);

        const eventType = (input.stage === 'closed_won' || input.stage === 'closed_lost')
          ? 'opportunity.closed'
          : 'opportunity.stage_changed';

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType,
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'opportunity',
          objectId: opportunity.id,
          beforeData: { stage: before.stage },
          afterData: { stage: opportunity.stage },
          metadata: {
            ...(input.note ? { note: input.note } : {}),
            ...(input.lost_reason ? { lost_reason: input.lost_reason } : {}),
          },
        });
        return { opportunity, event_id };
      },
    },
    {
      name: 'opportunity_update',
      description: 'Update an opportunity by passing its id and a patch object with fields to change. Supports amount, close_date, probability, forecast_cat, description, and custom_fields. For stage changes, prefer opportunity_advance_stage which auto-logs the transition.',
      inputSchema: opportunityUpdate,
      handler: async (input: z.infer<typeof opportunityUpdate>, actor: ActorContext) => {
        const before = await oppRepo.getOpportunity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Opportunity', input.id);

        if (input.patch.custom_fields && Object.keys(input.patch.custom_fields).length > 0) {
          input.patch.custom_fields = await validateCustomFields(db, actor.tenant_id, 'opportunity', input.patch.custom_fields);
        }
        const opportunity = await oppRepo.updateOpportunity(db, actor.tenant_id, input.id, input.patch);
        if (!opportunity) throw notFound('Opportunity', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'opportunity.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'opportunity',
          objectId: opportunity.id,
          beforeData: before,
          afterData: opportunity,
        });
        return { opportunity, event_id };
      },
    },
    {
      name: 'pipeline_summary',
      description: 'Get a pipeline summary showing total deal count, amount, and weighted value grouped by stage, owner, or forecast category. Use this for high-level pipeline snapshots in reports and reviews. For deeper pipeline analytics with win rates and cycle time, use pipeline_forecast instead.',
      inputSchema: pipelineSummary,
      handler: async (input: z.infer<typeof pipelineSummary>, actor: ActorContext) => {
        return oppRepo.getPipelineSummary(db, actor.tenant_id, {
          owner_id: input.owner_id,
          group_by: input.group_by ?? 'stage',
        });
      },
    },
    {
      name: 'opportunity_delete',
      description: 'Permanently delete an opportunity and all associated data. This is a destructive action that requires admin or owner role. For lost deals, prefer closing with opportunity_advance_stage to preserve analytics.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        if (actor.role !== 'admin' && actor.role !== 'owner') {
          throw permissionDenied('Only admins and owners can delete opportunities');
        }
        const before = await oppRepo.getOpportunity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Opportunity', input.id);

        await oppRepo.deleteOpportunity(db, actor.tenant_id, input.id);
        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'opportunity.deleted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'opportunity',
          objectId: input.id,
          beforeData: before,
        });
        return { deleted: true };
      },
    },
  ];
}
