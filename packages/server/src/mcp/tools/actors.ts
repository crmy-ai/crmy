// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { actorCreate, actorGet, actorSearch, actorUpdate, actorExpertise } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as actorRepo from '../../db/repos/actors.js';
import * as governorLimits from '../../db/repos/governor-limits.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, validationError } from '@crmy/shared';
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
    {
      name: 'actor_expertise',
      description: `Query actor knowledge contributions. Two modes:
• actor_id only — returns the subjects this actor has contributed context to, ordered by contribution count. Useful for understanding who knows what and routing reviews to the right person.
• subject_type + subject_id — returns the actors who have contributed the most context about a given CRM entity. Useful for finding the best person to ask about an account or opportunity.
At least one of actor_id or (subject_type + subject_id) must be provided.`,
      inputSchema: actorExpertise,
      handler: async (input: z.infer<typeof actorExpertise>, actor: ActorContext) => {
        if (!input.actor_id && !(input.subject_type && input.subject_id)) {
          throw validationError('Provide either actor_id or both subject_type and subject_id');
        }

        if (input.actor_id) {
          // Mode 1: what subjects does this actor know about?
          const subjectsResult = await db.query(
            `SELECT subject_type, subject_id,
                    count(*)::int AS entry_count,
                    max(created_at) AS last_authored_at,
                    array_agg(DISTINCT context_type) AS context_types
             FROM context_entries
             WHERE tenant_id = $1 AND authored_by = $2 AND is_current = true
             GROUP BY subject_type, subject_id
             ORDER BY entry_count DESC, last_authored_at DESC
             LIMIT $3`,
            [actor.tenant_id, input.actor_id, input.limit],
          );

          const typesResult = await db.query(
            `SELECT context_type, count(*)::int AS count
             FROM context_entries
             WHERE tenant_id = $1 AND authored_by = $2 AND is_current = true
             GROUP BY context_type
             ORDER BY count DESC
             LIMIT 10`,
            [actor.tenant_id, input.actor_id],
          );

          const totalResult = await db.query(
            `SELECT count(*)::int AS total FROM context_entries
             WHERE tenant_id = $1 AND authored_by = $2 AND is_current = true`,
            [actor.tenant_id, input.actor_id],
          );

          return {
            mode: 'by_actor',
            actor_id: input.actor_id,
            total_entries: totalResult.rows[0].total,
            subjects: subjectsResult.rows,
            top_context_types: typesResult.rows,
          };
        } else {
          // Mode 2: who knows the most about this subject?
          const expertsResult = await db.query(
            `SELECT authored_by AS actor_id, count(*)::int AS entry_count,
                    max(created_at) AS last_authored_at
             FROM context_entries
             WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 AND is_current = true
             GROUP BY authored_by
             ORDER BY entry_count DESC, last_authored_at DESC
             LIMIT $4`,
            [actor.tenant_id, input.subject_type, input.subject_id, input.limit],
          );

          return {
            mode: 'by_subject',
            subject_type: input.subject_type,
            subject_id: input.subject_id,
            experts: expertsResult.rows,
          };
        }
      },
    },
  ];
}
