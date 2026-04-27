// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { opportunityCreate, opportunityUpdate, opportunitySearch, opportunityAdvanceStage, pipelineSummary } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as oppRepo from '../../db/repos/opportunities.js';
import * as contextRepo from '../../db/repos/context-entries.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, validationError, permissionDenied, duplicateError } from '@crmy/shared';
import { validateOpportunityTransition } from '../../services/state-machine.js';
import { indexDocument, removeDocument } from '../../search/SearchIndexerService.js';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import { computeDealHealthScore } from '../../services/scoring.js';
import { checkOpportunityDuplicate } from '../../services/deduplication.js';
import type { ToolDef } from '../server.js';

export function opportunityTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'opportunity_create',
      tier: 'extended',
      description: 'Create a new sales opportunity linked to an account. Set stage, amount (in cents), close_date, probability, and forecast_cat to build the pipeline record. The amount field represents ARR in cents (e.g. 180000 for $1,800). If a duplicate opportunity is detected (same name on the same account), a 409 is returned with candidates. Pass allow_duplicates: true to create anyway.',
      inputSchema: opportunityCreate,
      handler: async (input: z.infer<typeof opportunityCreate>, actor: ActorContext) => {
        // ── Duplicate check ──
        if (!input.allow_duplicates) {
          const dedup = await checkOpportunityDuplicate(db, actor.tenant_id, {
            name: input.name,
            account_id: input.account_id,
            amount: input.amount,
            close_date: input.close_date,
          });

          if (dedup.confidence === 'definitive' || dedup.confidence === 'high') {
            if (input.if_exists === 'return_existing' && dedup.candidates[0]) {
              const existing = await oppRepo.getOpportunity(db, actor.tenant_id, dedup.candidates[0].id);
              return {
                opportunity: existing,
                was_existing: true,
                duplicate_confidence: dedup.confidence,
                matched_by: dedup.candidates[0].reasons,
              };
            }
            throw duplicateError(
              `A similar opportunity already exists (${dedup.candidates[0]?.reasons.join(', ')})`,
              dedup.candidates,
            );
          }

          if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
            input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'opportunity', input.custom_fields, { isCreate: true });
          }
          const opportunity = await oppRepo.createOpportunity(db, actor.tenant_id, { ...input, created_by: actor.actor_id });
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id, eventType: 'opportunity.created',
            actorId: actor.actor_id, actorType: actor.actor_type,
            objectType: 'opportunity', objectId: opportunity.id, afterData: opportunity,
          });
          indexDocument(db, 'opportunity', opportunity as unknown as Record<string, unknown>)
            .catch((err: unknown) => console.warn(`[search] opportunity index ${opportunity.id}: ${(err as Error).message}`));
          return {
            opportunity,
            event_id,
            potential_duplicates: dedup.confidence === 'medium' ? dedup.candidates : undefined,
          };
        }

        // allow_duplicates=true — skip check
        if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
          input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'opportunity', input.custom_fields, { isCreate: true });
        }
        const opportunity = await oppRepo.createOpportunity(db, actor.tenant_id, { ...input, created_by: actor.actor_id });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id, eventType: 'opportunity.created',
          actorId: actor.actor_id, actorType: actor.actor_type,
          objectType: 'opportunity', objectId: opportunity.id, afterData: opportunity,
        });
        indexDocument(db, 'opportunity', opportunity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] opportunity index ${opportunity.id}: ${(err as Error).message}`));
        return { opportunity, event_id };
      },
    },
    {
      name: 'opportunity_get',
      tier: 'core',
      description: 'Retrieve a single opportunity by UUID, including its account details and recent activities. Pass include_context_entries: true to also get current context entries without a full briefing. For a comprehensive view with stale warnings and assignments, use briefing_get on the opportunity instead.',
      inputSchema: z.object({
        id: z.string().uuid(),
        include_context_entries: z.boolean().optional().default(false).describe('If true, also return current context entries for this opportunity'),
      }),
      handler: async (input: { id: string; include_context_entries?: boolean }, actor: ActorContext) => {
        const opportunity = await oppRepo.getOpportunity(db, actor.tenant_id, input.id);
        if (!opportunity) throw notFound('Opportunity', input.id);

        const activities = await oppRepo.getOpportunityActivities(db, actor.tenant_id, input.id);
        if (input.include_context_entries) {
          const context_entries = await contextRepo.getContextForSubject(db, actor.tenant_id, 'opportunity', input.id);
          return { opportunity, activities, context_entries };
        }
        return { opportunity, activities };
      },
    },
    {
      name: 'opportunity_search',
      tier: 'core',
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
      tier: 'core',
      description: 'Advance an opportunity to a new pipeline stage. Automatically logs a stage_change activity for the audit trail. When setting stage to "closed_lost", you must provide a lost_reason explaining why the deal was lost — this is required for pipeline analytics.',
      inputSchema: opportunityAdvanceStage,
      handler: async (input: z.infer<typeof opportunityAdvanceStage>, actor: ActorContext) => {
        if (input.stage === 'closed_lost' && !input.lost_reason) {
          throw validationError('lost_reason is required when closing as lost');
        }

        const before = await oppRepo.getOpportunity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Opportunity', input.id);

        const transition = await validateOpportunityTransition(
          db, actor.tenant_id, input.id, before.stage, input.stage,
        );
        if (!transition.allowed) {
          throw validationError(transition.blockers.join('; '));
        }

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
        indexDocument(db, 'opportunity', opportunity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] opportunity index ${opportunity.id}: ${(err as Error).message}`));
        return { opportunity, event_id };
      },
    },
    {
      name: 'opportunity_update',
      tier: 'extended',
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
        indexDocument(db, 'opportunity', opportunity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] opportunity index ${opportunity.id}: ${(err as Error).message}`));
        return { opportunity, event_id };
      },
    },
    {
      name: 'pipeline_summary',
      tier: 'analytics',
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
      tier: 'admin',
      description: 'Permanently delete an opportunity and all associated data. This is a destructive action that requires admin or owner role. For lost deals, prefer closing with opportunity_advance_stage to preserve analytics.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        if (actor.role !== 'admin' && actor.role !== 'owner') {
          throw permissionDenied('Only admins and owners can delete opportunities');
        }
        const before = await oppRepo.getOpportunity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Opportunity', input.id);

        await oppRepo.deleteOpportunity(db, actor.tenant_id, input.id);
        removeDocument(db, actor.tenant_id, 'opportunity', input.id)
          .catch((err: unknown) => console.warn(`[search] opportunity remove ${input.id}: ${(err as Error).message}`));
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
    {
      name: 'opportunity_health_score',
      tier: 'core',
      description: 'Compute the deal health score (0–100) for an opportunity. Factors in stage progression, activity recency, context completeness (has commitment/stakeholder/next_step entries), close date urgency, and deal risk entries. Risk entries reduce the score. Returns the score with breakdown and a list of risk factors. Use this before preparing for any important deal conversation.',
      inputSchema: z.object({
        opportunity_id: z.string().uuid().describe('ID of the opportunity to score'),
      }),
      handler: async (input: { opportunity_id: string }, actor: ActorContext) => {
        const { score, breakdown, risk_factors } = await computeDealHealthScore(db, actor.tenant_id, input.opportunity_id);
        // Persist score
        await db.query(
          'UPDATE opportunities SET deal_health_score = $1, deal_health_score_updated_at = now() WHERE id = $2 AND tenant_id = $3',
          [score, input.opportunity_id, actor.tenant_id],
        );
        return { opportunity_id: input.opportunity_id, health_score: score, score_breakdown: breakdown, risk_factors, last_updated: new Date().toISOString() };
      },
    },
  ];
}
