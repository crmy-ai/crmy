// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  useCaseCreate, useCaseUpdate, useCaseSearch, useCaseGet, useCaseDelete,
  useCaseAdvanceStage, useCaseUpdateConsumption, useCaseSetHealth,
  useCaseLinkContact, useCaseUnlinkContact, useCaseListContacts,
  useCaseGetTimeline, useCaseSummary,
} from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as ucRepo from '../../db/repos/use-cases.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, validationError } from '@crmy/shared';
import { validateUseCaseTransition } from '../../services/state-machine.js';
import { indexDocument, removeDocument } from '../../search/SearchIndexerService.js';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import { runIdempotent } from '../../db/repos/idempotency.js';
import { mutationReceipt } from '../mutation-receipt.js';
import type { ToolDef } from '../server.js';
import { assertOwnedObjectAccess, defaultOwnerForCreate, resolveOwnerFilter } from '../../services/access-control.js';
import { verifiedActionContextMetadataForReceipt } from '../../services/action-context.js';

function runUseCaseOperation<T>(
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

export function useCaseTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'use_case_create',
      tier: 'extended',
      description: 'Create a new use case for an account to track a consumption-based workload or deployment. Use cases complement opportunities by tracking ongoing product usage after a deal closes. Set product_line, target consumption metrics, and stage (discovery, poc, production, scaling, sunset).',
      inputSchema: useCaseCreate,
      handler: async (input: z.infer<typeof useCaseCreate>, actor: ActorContext) => {
        return runUseCaseOperation(db, actor, 'use_case_create', input, async () => {
        if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
          input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'use_case', input.custom_fields, { isCreate: true });
        }
        const owner_id = await defaultOwnerForCreate(db, actor, input.owner_id);
        const uc = await ucRepo.createUseCase(db, actor.tenant_id, {
          ...input,
          owner_id: owner_id ?? undefined,
          created_by: actor.actor_id,
        });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'use_case.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'use_case',
          objectId: uc.id,
          afterData: uc,
        });
        indexDocument(db, 'use_case', uc as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] use_case index ${uc.id}: ${(err as Error).message}`));
        return {
          use_case: uc,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'use_case',
            objectId: uc.id,
            rowVersion: uc.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'use_case_get',
      tier: 'core',
      description: 'Retrieve a single use case by UUID including its linked contacts, consumption metrics, and current stage. For a comprehensive view with context entries and activity timeline, use briefing_get on the use case.',
      inputSchema: useCaseGet,
      handler: async (input: z.infer<typeof useCaseGet>, actor: ActorContext) => {
        const uc = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!uc) throw notFound('UseCase', input.id);
        await assertOwnedObjectAccess(db, actor, 'use_case', input.id);
        const contacts = await ucRepo.listContacts(db, input.id);
        return { use_case: uc, contacts };
      },
    },
    {
      name: 'use_case_search',
      tier: 'core',
      description: 'Search use cases with flexible filters. Use account_id for a specific account, stage for lifecycle filtering, product_line for product segmentation, and query for text search. Returns paginated results sorted by recency.',
      inputSchema: useCaseSearch,
      handler: async (input: z.infer<typeof useCaseSearch>, actor: ActorContext) => {
        const ownerFilter = await resolveOwnerFilter(db, actor, input.owner_id);
        const result = await ucRepo.searchUseCases(db, actor.tenant_id, {
          ...input,
          ...ownerFilter,
          limit: input.limit ?? 20,
        });
        return { use_cases: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'use_case_update',
      tier: 'extended',
      description: 'Update a use case by passing its id and a patch object with fields to change. Supports all use case fields including product_line, consumption metrics, tags, and custom_fields.',
      inputSchema: useCaseUpdate,
      handler: async (input: z.infer<typeof useCaseUpdate>, actor: ActorContext) => {
        return runUseCaseOperation(db, actor, 'use_case_update', input, async () => {
        const before = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!before) throw notFound('UseCase', input.id);
        await assertOwnedObjectAccess(db, actor, 'use_case', input.id);

        if (input.patch.custom_fields && Object.keys(input.patch.custom_fields).length > 0) {
          input.patch.custom_fields = await validateCustomFields(db, actor.tenant_id, 'use_case', input.patch.custom_fields);
        }
        const uc = await ucRepo.updateUseCase(db, actor.tenant_id, input.id, input.patch, {
          expectedVersion: input.expected_version,
        });
        if (!uc) throw notFound('UseCase', input.id);
        const actionContextMetadata = await verifiedActionContextMetadataForReceipt(db, actor, 'use_case', input.id, input.action_context);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'use_case.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'use_case',
          objectId: uc.id,
          beforeData: before,
          afterData: uc,
          metadata: actionContextMetadata ? { action_context: actionContextMetadata } : undefined,
        });
        indexDocument(db, 'use_case', uc as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] use_case index ${uc.id}: ${(err as Error).message}`));
        return {
          use_case: uc,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'use_case',
            objectId: uc.id,
            rowVersion: uc.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'use_case_delete',
      tier: 'admin',
      description: 'Delete a use case by UUID. This permanently removes the use case and unlinks all associated contacts. Consider advancing to "sunset" stage instead to preserve the historical record.',
      inputSchema: useCaseDelete,
      handler: async (input: z.infer<typeof useCaseDelete>, actor: ActorContext) => {
        return runUseCaseOperation(db, actor, 'use_case_delete', input, async () => {
        const uc = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!uc) throw notFound('UseCase', input.id);
        await assertOwnedObjectAccess(db, actor, 'use_case', input.id);

        await ucRepo.deleteUseCase(db, actor.tenant_id, input.id, {
          expectedVersion: input.expected_version,
        });
        removeDocument(db, actor.tenant_id, 'use_case', input.id)
          .catch((err: unknown) => console.warn(`[search] use_case remove ${input.id}: ${(err as Error).message}`));

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'use_case.deleted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'use_case',
          objectId: input.id,
          beforeData: uc,
        });
        return {
          deleted: true,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'use_case',
            objectId: input.id,
            rowVersion: uc.row_version,
            eventId: event_id,
            sideEffects: ['search_remove:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'use_case_advance_stage',
      tier: 'extended',
      description: 'Advance a use case to its next lifecycle stage: discovery, poc, production, scaling, or sunset. Logs the stage transition as an activity for the audit trail. Use this to track product adoption progress.',
      inputSchema: useCaseAdvanceStage,
      handler: async (input: z.infer<typeof useCaseAdvanceStage>, actor: ActorContext) => {
        return runUseCaseOperation(db, actor, 'use_case_advance_stage', input, async () => {
        const before = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!before) throw notFound('UseCase', input.id);
        await assertOwnedObjectAccess(db, actor, 'use_case', input.id);

        const transition = await validateUseCaseTransition(
          db, actor.tenant_id, input.id, before.stage, input.stage,
        );
        if (!transition.allowed) {
          throw validationError(transition.blockers.join('; '));
        }

        const uc = await ucRepo.updateUseCase(db, actor.tenant_id, input.id, {
          stage: input.stage,
        }, {
          expectedVersion: input.expected_version,
        });
        if (!uc) throw notFound('UseCase', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'use_case.stage_changed',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'use_case',
          objectId: uc.id,
          beforeData: { stage: before.stage },
          afterData: { stage: uc.stage },
          metadata: input.note ? { note: input.note } : {},
        });
        indexDocument(db, 'use_case', uc as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] use_case index ${uc.id}: ${(err as Error).message}`));
        return {
          use_case: uc,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'use_case',
            objectId: uc.id,
            rowVersion: uc.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'use_case_update_consumption',
      tier: 'extended',
      description: 'Update the current consumption metrics for a use case. Set actual usage values against targets to track product adoption. The consumption ratio (actual/target) feeds into health score calculations.',
      inputSchema: useCaseUpdateConsumption,
      handler: async (input: z.infer<typeof useCaseUpdateConsumption>, actor: ActorContext) => {
        return runUseCaseOperation(db, actor, 'use_case_update_consumption', input, async () => {
        const before = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!before) throw notFound('UseCase', input.id);
        await assertOwnedObjectAccess(db, actor, 'use_case', input.id);

        const uc = await ucRepo.updateUseCase(db, actor.tenant_id, input.id, {
          consumption_current: input.consumption_current,
        }, {
          expectedVersion: input.expected_version,
        });
        if (!uc) throw notFound('UseCase', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'use_case.consumption_updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'use_case',
          objectId: uc.id,
          beforeData: { consumption_current: before.consumption_current },
          afterData: { consumption_current: uc.consumption_current },
          metadata: input.note ? { note: input.note } : {},
        });
        indexDocument(db, 'use_case', uc as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] use_case index ${uc.id}: ${(err as Error).message}`));
        return {
          use_case: uc,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'use_case',
            objectId: uc.id,
            rowVersion: uc.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'use_case_set_health',
      tier: 'extended',
      description: 'Set the health score (0–100) for a use case to reflect current adoption health. Consider consumption ratio, user engagement, support ticket volume, and stakeholder sentiment when setting this score.',
      inputSchema: useCaseSetHealth,
      handler: async (input: z.infer<typeof useCaseSetHealth>, actor: ActorContext) => {
        return runUseCaseOperation(db, actor, 'use_case_set_health', input, async () => {
        const before = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!before) throw notFound('UseCase', input.id);
        await assertOwnedObjectAccess(db, actor, 'use_case', input.id);

        const uc = await ucRepo.updateUseCase(db, actor.tenant_id, input.id, {
          health_score: input.score,
        }, {
          expectedVersion: input.expected_version,
        });
        if (!uc) throw notFound('UseCase', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'use_case.health_updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'use_case',
          objectId: uc.id,
          beforeData: { health_score: before.health_score },
          afterData: { health_score: uc.health_score },
          metadata: input.rationale ? { rationale: input.rationale } : {},
        });
        return {
          use_case: uc,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'use_case',
            objectId: uc.id,
            rowVersion: uc.row_version,
            eventId: event_id,
          }),
        };
        });
      },
    },
    {
      name: 'use_case_link_contact',
      tier: 'extended',
      description: 'Link a contact to a use case with an optional role description (e.g. "champion", "end user", "executive sponsor"). Creates a many-to-many relationship between the contact and the use case.',
      inputSchema: useCaseLinkContact,
      handler: async (input: z.infer<typeof useCaseLinkContact>, actor: ActorContext) => {
        return runUseCaseOperation(db, actor, 'use_case_link_contact', input, async () => {
        const uc = await ucRepo.getUseCase(db, actor.tenant_id, input.use_case_id);
        if (!uc) throw notFound('UseCase', input.use_case_id);
        await assertOwnedObjectAccess(db, actor, 'use_case', input.use_case_id);
        await assertOwnedObjectAccess(db, actor, 'contact', input.contact_id);

        const link = await ucRepo.linkContact(db, input.use_case_id, input.contact_id, input.role);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'use_case.contact_linked',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'use_case',
          objectId: input.use_case_id,
          afterData: link,
        });
        return {
          link,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'use_case',
            objectId: input.use_case_id,
            rowVersion: uc.row_version,
            eventId: event_id,
          }),
        };
        });
      },
    },
    {
      name: 'use_case_unlink_contact',
      tier: 'extended',
      description: 'Remove a contact from a use case, breaking the many-to-many link. The contact record itself is not affected.',
      inputSchema: useCaseUnlinkContact,
      handler: async (input: z.infer<typeof useCaseUnlinkContact>, actor: ActorContext) => {
        return runUseCaseOperation(db, actor, 'use_case_unlink_contact', input, async () => {
        await assertOwnedObjectAccess(db, actor, 'use_case', input.use_case_id);
        await assertOwnedObjectAccess(db, actor, 'contact', input.contact_id);
        const removed = await ucRepo.unlinkContact(db, input.use_case_id, input.contact_id);
        if (!removed) throw notFound('UseCaseContact', `${input.use_case_id}/${input.contact_id}`);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'use_case.contact_unlinked',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'use_case',
          objectId: input.use_case_id,
          afterData: { contact_id: input.contact_id },
        });
        return {
          removed: true,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'use_case',
            objectId: input.use_case_id,
            eventId: event_id,
          }),
        };
        });
      },
    },
    {
      name: 'use_case_list_contacts',
      tier: 'extended',
      description: 'List all contacts linked to a use case, including their roles. Returns contact profiles with their relationship to the use case.',
      inputSchema: useCaseListContacts,
      handler: async (input: z.infer<typeof useCaseListContacts>, actor: ActorContext) => {
        await assertOwnedObjectAccess(db, actor, 'use_case', input.use_case_id);
        const contacts = await ucRepo.listContacts(db, input.use_case_id);
        return { contacts };
      },
    },
    {
      name: 'use_case_get_timeline',
      tier: 'extended',
      description: 'Get a chronological activity timeline for a use case. Returns all activities linked to this use case sorted by occurred_at descending.',
      inputSchema: useCaseGetTimeline,
      handler: async (input: z.infer<typeof useCaseGetTimeline>, actor: ActorContext) => {
        await assertOwnedObjectAccess(db, actor, 'use_case', input.id);
        const activities = await ucRepo.getUseCaseTimeline(db, actor.tenant_id, input.id, {
          limit: input.limit ?? 50,
          types: input.types,
        });
        return { activities };
      },
    },
    {
      name: 'use_case_summary',
      tier: 'analytics',
      description: 'Get an aggregate summary of use cases grouped by stage, product_line, or owner. Returns counts and consumption totals per group. Useful for portfolio reviews and product adoption dashboards.',
      inputSchema: useCaseSummary,
      handler: async (input: z.infer<typeof useCaseSummary>, actor: ActorContext) => {
        const summary = await ucRepo.getUseCaseSummary(db, actor.tenant_id, {
          account_id: input.account_id,
          group_by: input.group_by ?? 'stage',
        });
        return { summary };
      },
    },
  ];
}
