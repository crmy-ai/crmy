// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { actorCreate, actorGet, actorSearch, actorUpdate } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as actorRepo from '../../db/repos/actors.js';
import * as governorLimits from '../../db/repos/governor-limits.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function actorTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'actor_register',
      description: 'Register a new actor (human or agent). Agents auto-register on first MCP connect.',
      inputSchema: actorCreate,
      handler: async (input: z.infer<typeof actorCreate>, actor: ActorContext) => {
        // Enforce governor limit on active actor count
        const activeCount = await governorLimits.countActiveActors(db, actor.tenant_id);
        await governorLimits.enforceLimit(db, actor.tenant_id, 'actors_max', activeCount);

        const created = await actorRepo.createActor(db, actor.tenant_id, input);
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'actor.registered',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'actor',
          objectId: created.id,
          afterData: created,
        });
        return { actor: created, event_id };
      },
    },
    {
      name: 'actor_get',
      description: 'Get an actor by ID',
      inputSchema: actorGet,
      handler: async (input: z.infer<typeof actorGet>, actor: ActorContext) => {
        const found = await actorRepo.getActor(db, actor.tenant_id, input.id);
        if (!found) throw notFound('Actor', input.id);
        return { actor: found };
      },
    },
    {
      name: 'actor_list',
      description: 'List actors with optional filters. Supports actor_type, is_active, and query.',
      inputSchema: actorSearch,
      handler: async (input: z.infer<typeof actorSearch>, actor: ActorContext) => {
        const result = await actorRepo.searchActors(db, actor.tenant_id, {
          ...input,
          limit: input.limit ?? 20,
        });
        return { actors: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'actor_update',
      description: 'Update an actor. Pass id and a patch object with fields to update.',
      inputSchema: actorUpdate,
      handler: async (input: z.infer<typeof actorUpdate>, actor: ActorContext) => {
        const before = await actorRepo.getActor(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Actor', input.id);

        const updated = await actorRepo.updateActor(db, actor.tenant_id, input.id, input.patch);
        if (!updated) throw notFound('Actor', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'actor.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'actor',
          objectId: updated.id,
          beforeData: before,
          afterData: updated,
        });
        return { actor: updated, event_id };
      },
    },
    {
      name: 'actor_whoami',
      description: 'Return the current actor identity based on the authenticated session.',
      inputSchema: z.object({}),
      handler: async (_input: unknown, actor: ActorContext) => {
        return {
          tenant_id: actor.tenant_id,
          actor_id: actor.actor_id,
          actor_type: actor.actor_type,
          role: actor.role,
        };
      },
    },
  ];
}
