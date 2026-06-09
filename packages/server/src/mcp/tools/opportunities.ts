// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { opportunityCreate, opportunityUpdate, opportunitySearch, opportunityAdvanceStage, pipelineSummary } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as oppRepo from '../../db/repos/opportunities.js';
import * as contextRepo from '../../db/repos/context-entries.js';
import { emitEvent } from '../../events/emitter.js';
import { CrmyError, notFound, validationError, permissionDenied, duplicateError } from '@crmy/shared';
import { validateOpportunityTransition } from '../../services/state-machine.js';
import { assertActionPolicyAllowsMutation, evaluateActionPolicy } from '../../services/action-policy.js';
import { indexDocument, removeDocument } from '../../search/SearchIndexerService.js';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import { computeDealHealthScore } from '../../services/scoring.js';
import { checkOpportunityDuplicate } from '../../services/deduplication.js';
import { runIdempotent } from '../../db/repos/idempotency.js';
import { mutationReceipt } from '../mutation-receipt.js';
import type { ToolDef } from '../server.js';
import { writeToolUx } from '../tool-ux.js';
import { assertOwnedObjectAccess, defaultOwnerForCreate, resolveOwnerFilter } from '../../services/access-control.js';
import { verifiedActionContextMetadataForReceipt } from '../../services/action-context.js';

function runOpportunityOperation<T>(
  db: DbPool,
  actor: ActorContext,
  operation: string,
  input: object,
  fn: () => Promise<T>,
): Promise<T> {
  const idempotencyKey = (input as { idempotency_key?: string }).idempotency_key;
  return runIdempotent(db, {
    tenantId: actor.tenant_id,
    actorId: actor.actor_id,
    operation,
    key: idempotencyKey,
    request: input,
  }, fn);
}

function concurrencyConflict(entity: string, id: string, expectedVersion: number): CrmyError {
  return new CrmyError(
    'CONFLICT',
    `${entity} ${id} was modified by another writer; refresh the object and retry with the latest row_version`,
    409,
    { expected_version: expectedVersion },
  );
}

export function opportunityTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'opportunity_create',
      tier: 'extended',
      description: 'Create a new sales opportunity linked to an account. Set stage, amount (in cents), close_date, probability, and forecast_cat to build the pipeline record. The amount field represents ARR in cents (e.g. 180000 for $1,800). If a duplicate opportunity is detected (same name on the same account), a 409 is returned with candidates. Pass allow_duplicates: true to create anyway.',
      inputSchema: opportunityCreate,
      ux: writeToolUx({
        displayName: 'Create opportunity',
        actionPhrase: 'create the opportunity',
        objectLabel: 'opportunity',
      }),
      handler: async (input: z.infer<typeof opportunityCreate>, actor: ActorContext) => {
        return runOpportunityOperation(db, actor, 'opportunity_create', input, async () => {
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
          const owner_id = await defaultOwnerForCreate(db, actor, input.owner_id);
          const opportunity = await oppRepo.createOpportunity(db, actor.tenant_id, { ...input, owner_id: owner_id ?? undefined, created_by: actor.actor_id });
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
            mutation: mutationReceipt(actor, {
              objectType: 'opportunity',
              objectId: opportunity.id,
              rowVersion: opportunity.row_version,
              eventId: event_id,
              sideEffects: ['search_index:queued'],
            }),
            potential_duplicates: dedup.confidence === 'medium' ? dedup.candidates : undefined,
          };
        }

        // allow_duplicates=true — skip check
        if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
          input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'opportunity', input.custom_fields, { isCreate: true });
        }
        const owner_id = await defaultOwnerForCreate(db, actor, input.owner_id);
        const opportunity = await oppRepo.createOpportunity(db, actor.tenant_id, { ...input, owner_id: owner_id ?? undefined, created_by: actor.actor_id });
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
          mutation: mutationReceipt(actor, {
            objectType: 'opportunity',
            objectId: opportunity.id,
            rowVersion: opportunity.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
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
        await assertOwnedObjectAccess(db, actor, 'opportunity', input.id);

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
      description: 'Search opportunities with flexible filters. Use stage to find deals at a specific pipeline stage (e.g. "Negotiation"), account_id for a specific account, forecast_cat for pipeline categorization, and date range to find deals closing within a window. Useful for pipeline reviews and identifying at-risk deals approaching their close_date.',
      inputSchema: opportunitySearch,
      handler: async (input: z.infer<typeof opportunitySearch>, actor: ActorContext) => {
        const ownerFilter = await resolveOwnerFilter(db, actor, input.owner_id);
        const result = await oppRepo.searchOpportunities(db, actor.tenant_id, {
          ...input,
          ...ownerFilter,
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
        return runOpportunityOperation(db, actor, 'opportunity_advance_stage', input, async () => {
        if (input.stage === 'closed_lost' && !input.lost_reason) {
          throw validationError('lost_reason is required when closing as lost');
        }

        const before = await oppRepo.getOpportunity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Opportunity', input.id);
        await assertOwnedObjectAccess(db, actor, 'opportunity', input.id);

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

        const opportunity = await oppRepo.updateOpportunity(db, actor.tenant_id, input.id, patch, {
          expectedVersion: input.expected_version,
        });
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
        return {
          opportunity,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'opportunity',
            objectId: opportunity.id,
            rowVersion: opportunity.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'opportunity_update',
      tier: 'extended',
      description: 'Update an opportunity by passing its id and a patch object with fields to change. Supports amount, close_date, probability, forecast_cat, description, and custom_fields. For stage changes, prefer opportunity_advance_stage which auto-logs the transition.',
      inputSchema: opportunityUpdate,
      ux: writeToolUx({
        displayName: 'Update opportunity',
        actionPhrase: 'update the opportunity',
        objectLabel: 'opportunity',
      }),
      handler: async (input: z.infer<typeof opportunityUpdate>, actor: ActorContext) => {
        return runOpportunityOperation(db, actor, 'opportunity_update', input, async () => {
        const before = await oppRepo.getOpportunity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Opportunity', input.id);
        await assertOwnedObjectAccess(db, actor, 'opportunity', input.id);

        if (input.patch.custom_fields && Object.keys(input.patch.custom_fields).length > 0) {
          input.patch.custom_fields = await validateCustomFields(db, actor.tenant_id, 'opportunity', input.patch.custom_fields);
        }
        const policy = evaluateActionPolicy({
          action_type: 'opportunity.update',
          object_type: 'opportunity',
          field_names: Object.keys(input.patch),
          actor,
        });
        assertActionPolicyAllowsMutation(policy);
        const opportunity = await oppRepo.updateOpportunity(db, actor.tenant_id, input.id, input.patch, {
          expectedVersion: input.expected_version,
        });
        if (!opportunity) throw notFound('Opportunity', input.id);
        const actionContextMetadata = await verifiedActionContextMetadataForReceipt(db, actor, 'opportunity', input.id, input.action_context);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'opportunity.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'opportunity',
          objectId: opportunity.id,
          beforeData: before,
          afterData: opportunity,
          metadata: {
            action_policy: policy,
            ...(actionContextMetadata ? { action_context: actionContextMetadata } : {}),
          },
        });
        indexDocument(db, 'opportunity', opportunity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] opportunity index ${opportunity.id}: ${(err as Error).message}`));
        return {
          opportunity,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'opportunity',
            objectId: opportunity.id,
            rowVersion: opportunity.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'pipeline_summary',
      tier: 'analytics',
      description: 'Get a pipeline summary showing total deal count, amount, and weighted value grouped by stage, owner, or forecast category. Use this for high-level pipeline snapshots in reports and reviews. For deeper pipeline analytics with win rates and cycle time, use pipeline_forecast instead.',
      inputSchema: pipelineSummary,
      handler: async (input: z.infer<typeof pipelineSummary>, actor: ActorContext) => {
        const ownerFilter = await resolveOwnerFilter(db, actor, input.owner_id);
        return oppRepo.getPipelineSummary(db, actor.tenant_id, {
          ...ownerFilter,
          group_by: input.group_by ?? 'stage',
        });
      },
    },
    {
      name: 'opportunity_delete',
      tier: 'admin',
      description: 'Permanently delete an opportunity and all associated data. This is a destructive action that requires admin or owner role. For lost deals, prefer closing with opportunity_advance_stage to preserve analytics.',
      inputSchema: z.object({
        id: z.string().uuid(),
        idempotency_key: z.string().max(128).optional(),
        expected_version: z.number().int().positive().optional(),
      }),
      handler: async (input: { id: string; idempotency_key?: string; expected_version?: number }, actor: ActorContext) => {
        return runOpportunityOperation(db, actor, 'opportunity_delete', input, async () => {
        if (actor.role !== 'admin' && actor.role !== 'owner') {
          throw permissionDenied('Only admins and owners can delete opportunities');
        }
        const before = await oppRepo.getOpportunity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Opportunity', input.id);
        await assertOwnedObjectAccess(db, actor, 'opportunity', input.id);

        await oppRepo.deleteOpportunity(db, actor.tenant_id, input.id, {
          expectedVersion: input.expected_version,
        });
        removeDocument(db, actor.tenant_id, 'opportunity', input.id)
          .catch((err: unknown) => console.warn(`[search] opportunity remove ${input.id}: ${(err as Error).message}`));
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'opportunity.deleted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'opportunity',
          objectId: input.id,
          beforeData: before,
        });
        return {
          deleted: true,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'opportunity',
            objectId: input.id,
            rowVersion: before.row_version,
            eventId: event_id,
            sideEffects: ['search_remove:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'opportunity_health_score',
      tier: 'core',
      description: 'Compute the deal health score (0–100) for an opportunity. Factors in stage progression, activity recency, context completeness (has commitment/stakeholder/next_step entries), close date urgency, and deal risk entries. Risk entries reduce the score. Returns the score with breakdown and a list of risk factors. Use this before preparing for any important deal conversation.',
      inputSchema: z.object({
        opportunity_id: z.string().uuid().describe('ID of the opportunity to score'),
        idempotency_key: z.string().max(128).optional(),
        expected_version: z.number().int().positive().optional(),
      }),
      handler: async (input: { opportunity_id: string; idempotency_key?: string; expected_version?: number }, actor: ActorContext) => {
        return runOpportunityOperation(db, actor, 'opportunity_health_score', input, async () => {
        const before = await oppRepo.getOpportunity(db, actor.tenant_id, input.opportunity_id);
        if (!before) throw notFound('Opportunity', input.opportunity_id);
        await assertOwnedObjectAccess(db, actor, 'opportunity', input.opportunity_id);
        const { score, breakdown, risk_factors } = await computeDealHealthScore(db, actor.tenant_id, input.opportunity_id);
        // Persist score
        const params: unknown[] = [score, input.opportunity_id, actor.tenant_id];
        const versionClause = input.expected_version !== undefined ? ' AND row_version = $4' : '';
        if (input.expected_version !== undefined) params.push(input.expected_version);
        const updated = await db.query(
          `UPDATE opportunities
           SET deal_health_score = $1, deal_health_score_updated_at = now(), row_version = row_version + 1, updated_at = now()
           WHERE id = $2 AND tenant_id = $3${versionClause}
           RETURNING row_version`,
          params,
        );
        if (updated.rows.length === 0 && input.expected_version !== undefined) {
          throw concurrencyConflict('Opportunity', input.opportunity_id, input.expected_version);
        }
        return {
          opportunity_id: input.opportunity_id,
          health_score: score,
          score_breakdown: breakdown,
          risk_factors,
          last_updated: new Date().toISOString(),
          mutation: mutationReceipt(actor, {
            objectType: 'opportunity',
            objectId: input.opportunity_id,
            rowVersion: updated.rows[0]?.row_version,
          }),
        };
        });
      },
    },
  ];
}
