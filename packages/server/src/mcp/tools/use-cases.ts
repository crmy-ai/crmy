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
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function useCaseTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'use_case_create',
      description: 'Create a new use case for an account. Use cases track consumption-based workloads.',
      inputSchema: useCaseCreate,
      handler: async (input: z.infer<typeof useCaseCreate>, actor: ActorContext) => {
        const uc = await ucRepo.createUseCase(db, actor.tenant_id, {
          ...input,
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
        return { use_case: uc, event_id };
      },
    },
    {
      name: 'use_case_get',
      description: 'Get a use case by ID, including linked contacts',
      inputSchema: useCaseGet,
      handler: async (input: z.infer<typeof useCaseGet>, actor: ActorContext) => {
        const uc = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!uc) throw notFound('UseCase', input.id);
        const contacts = await ucRepo.listContacts(db, input.id);
        return { use_case: uc, contacts };
      },
    },
    {
      name: 'use_case_search',
      description: 'Search use cases with filters. Supports account_id, stage, owner_id, product_line, tags, query.',
      inputSchema: useCaseSearch,
      handler: async (input: z.infer<typeof useCaseSearch>, actor: ActorContext) => {
        const result = await ucRepo.searchUseCases(db, actor.tenant_id, {
          ...input,
          limit: input.limit ?? 20,
        });
        return { use_cases: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'use_case_update',
      description: 'Update a use case. Pass id and a patch object with fields to update.',
      inputSchema: useCaseUpdate,
      handler: async (input: z.infer<typeof useCaseUpdate>, actor: ActorContext) => {
        const before = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!before) throw notFound('UseCase', input.id);

        const uc = await ucRepo.updateUseCase(db, actor.tenant_id, input.id, input.patch);
        if (!uc) throw notFound('UseCase', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'use_case.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'use_case',
          objectId: uc.id,
          beforeData: before,
          afterData: uc,
        });
        return { use_case: uc, event_id };
      },
    },
    {
      name: 'use_case_delete',
      description: 'Delete a use case by ID',
      inputSchema: useCaseDelete,
      handler: async (input: z.infer<typeof useCaseDelete>, actor: ActorContext) => {
        const uc = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!uc) throw notFound('UseCase', input.id);

        await ucRepo.deleteUseCase(db, actor.tenant_id, input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'use_case.deleted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'use_case',
          objectId: input.id,
          beforeData: uc,
        });
        return { deleted: true, event_id };
      },
    },
    {
      name: 'use_case_advance_stage',
      description: 'Advance a use case to a new stage (discovery → onboarding → active → expansion, or at_risk/churned)',
      inputSchema: useCaseAdvanceStage,
      handler: async (input: z.infer<typeof useCaseAdvanceStage>, actor: ActorContext) => {
        const before = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!before) throw notFound('UseCase', input.id);

        const uc = await ucRepo.updateUseCase(db, actor.tenant_id, input.id, {
          stage: input.stage,
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
        return { use_case: uc, event_id };
      },
    },
    {
      name: 'use_case_update_consumption',
      description: 'Update current consumption metrics for a use case',
      inputSchema: useCaseUpdateConsumption,
      handler: async (input: z.infer<typeof useCaseUpdateConsumption>, actor: ActorContext) => {
        const before = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!before) throw notFound('UseCase', input.id);

        const uc = await ucRepo.updateUseCase(db, actor.tenant_id, input.id, {
          consumption_current: input.consumption_current,
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
        return { use_case: uc, event_id };
      },
    },
    {
      name: 'use_case_set_health',
      description: 'Set the health score (0-100) for a use case',
      inputSchema: useCaseSetHealth,
      handler: async (input: z.infer<typeof useCaseSetHealth>, actor: ActorContext) => {
        const before = await ucRepo.getUseCase(db, actor.tenant_id, input.id);
        if (!before) throw notFound('UseCase', input.id);

        const uc = await ucRepo.updateUseCase(db, actor.tenant_id, input.id, {
          health_score: input.score,
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
        return { use_case: uc, event_id };
      },
    },
    {
      name: 'use_case_link_contact',
      description: 'Link a contact to a use case with an optional role',
      inputSchema: useCaseLinkContact,
      handler: async (input: z.infer<typeof useCaseLinkContact>, actor: ActorContext) => {
        const uc = await ucRepo.getUseCase(db, actor.tenant_id, input.use_case_id);
        if (!uc) throw notFound('UseCase', input.use_case_id);

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
        return { link, event_id };
      },
    },
    {
      name: 'use_case_unlink_contact',
      description: 'Remove a contact from a use case',
      inputSchema: useCaseUnlinkContact,
      handler: async (input: z.infer<typeof useCaseUnlinkContact>, actor: ActorContext) => {
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
        return { removed: true, event_id };
      },
    },
    {
      name: 'use_case_list_contacts',
      description: 'List all contacts linked to a use case',
      inputSchema: useCaseListContacts,
      handler: async (input: z.infer<typeof useCaseListContacts>, actor: ActorContext) => {
        const contacts = await ucRepo.listContacts(db, input.use_case_id);
        return { contacts };
      },
    },
    {
      name: 'use_case_get_timeline',
      description: 'Get activity timeline for a use case',
      inputSchema: useCaseGetTimeline,
      handler: async (input: z.infer<typeof useCaseGetTimeline>, actor: ActorContext) => {
        const activities = await ucRepo.getUseCaseTimeline(db, actor.tenant_id, input.id, {
          limit: input.limit ?? 50,
          types: input.types,
        });
        return { activities };
      },
    },
    {
      name: 'use_case_summary',
      description: 'Get aggregate summary of use cases grouped by stage, product_line, or owner',
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
