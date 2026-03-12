// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { opportunityCreate, opportunityUpdate, opportunitySearch, opportunityAdvanceStage, pipelineSummary } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as oppRepo from '../../db/repos/opportunities.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, validationError } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function opportunityTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'opportunity_create',
      description: 'Create a new sales opportunity',
      inputSchema: opportunityCreate,
      handler: async (input: z.infer<typeof opportunityCreate>, actor: ActorContext) => {
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
      description: 'Get an opportunity by ID, including recent activities',
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
      description: 'Search opportunities with filters. Supports query, stage, owner_id, account_id, forecast_cat, and date range.',
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
      description: 'Advance an opportunity to a new stage. Requires lost_reason when stage is closed_lost.',
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
      description: 'Update an opportunity. Pass id and a patch object with fields to update.',
      inputSchema: opportunityUpdate,
      handler: async (input: z.infer<typeof opportunityUpdate>, actor: ActorContext) => {
        const before = await oppRepo.getOpportunity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Opportunity', input.id);

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
      description: 'Get pipeline summary grouped by stage, owner, or forecast category',
      inputSchema: pipelineSummary,
      handler: async (input: z.infer<typeof pipelineSummary>, actor: ActorContext) => {
        return oppRepo.getPipelineSummary(db, actor.tenant_id, {
          owner_id: input.owner_id,
          group_by: input.group_by ?? 'stage',
        });
      },
    },
  ];
}
