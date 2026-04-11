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
      tier: 'admin',
      description: 'Register a new actor (human or agent) in the CRMy system. Agents should call this at the start of each session — it is idempotent, so calling it when already registered is safe and returns the existing actor. Provide actor_type ("human" or "agent"), display_name, and for agents: agent_identifier and agent_model. The returned actor ID is used in all subsequent tool calls as performed_by and authored_by.',
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
      tier: 'admin',
      description: 'Retrieve an actor profile by UUID. Returns the actor type, display name, email, agent model, and activity status. Use this to look up details about who performed an activity or authored a context entry.',
      inputSchema: actorGet,
      handler: async (input: z.infer<typeof actorGet>, actor: ActorContext) => {
        const found = await actorRepo.getActor(db, actor.tenant_id, input.id);
        if (!found) throw notFound('Actor', input.id);
        return { actor: found };
      },
    },
    {
      name: 'actor_list',
      tier: 'admin',
      description: 'List all registered actors (humans and agents) with optional filters. Filter by actor_type to see only humans or only agents, is_active to find active participants, or query to search by name. Returns paginated results with cursor-based pagination.',
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
      tier: 'admin',
      description: 'Update an actor profile. Pass the actor id and a patch object with the fields to change (display_name, email, agent_model, metadata, is_active). Use this to update agent configuration or deactivate an actor.',
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
      tier: 'core',
      description: 'Return your current actor identity — call this at the start of any agent session to get your actor_id, which is required as performed_by in activity_create and authored_by in context_add. If you are not registered, call actor_register first (it is idempotent and safe to call every session). Returns tenant_id, actor_id, actor_type, and role.',
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
      tier: 'core',
      description: 'Find the actor (human or agent) with the most knowledge about a CRM entity, or see what a specific actor knows. Two modes: pass actor_id alone to get the subjects this actor has contributed context to (useful for routing review requests to the right person), or pass subject_type + subject_id to get actors ranked by contribution count for that entity (useful for finding who to ask about an account or opportunity). At least one of actor_id or (subject_type + subject_id) must be provided. Returns contribution counts, context types, and recency.',
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
    // ── Specialist registry ──────────────────────────────────────────────────
    {
      name: 'agent_register_specialization',
      tier: 'core',
      description: 'Register or update a skill specialization for yourself. Call this at startup to declare what you are good at so other agents can discover and route work to you. skill_tag should be a short kebab-case identifier like "pricing", "legal", "discovery", "renewal", "technical". proficiency is "novice", "intermediate", or "expert".',
      inputSchema: z.object({
        skill_tag: z.string().min(1).max(50).describe('Short skill identifier, e.g. "pricing", "legal"'),
        proficiency: z.enum(['novice', 'intermediate', 'expert']).default('intermediate'),
        description: z.string().max(300).optional().describe('What you can do with this skill'),
      }),
      handler: async (input: { skill_tag: string; proficiency?: string; description?: string }, actor: ActorContext) => {
        const spec = await actorRepo.upsertSpecialization(db, actor.tenant_id, actor.actor_id, {
          skill_tag: input.skill_tag,
          proficiency: input.proficiency,
          description: input.description,
        });
        return { specialization: spec };
      },
    },
    {
      name: 'agent_find_specialist',
      tier: 'core',
      description: 'Find agents with a specific skill tag, sorted by proficiency (expert first) then recency. Use this before creating an assignment to find the best agent to route work to. Returns actors with their specialization metadata and availability status.',
      inputSchema: z.object({
        skill_tag: z.string().min(1).describe('The skill to search for, e.g. "pricing"'),
        exclude_actor_id: z.string().uuid().optional().describe('Exclude this actor from results (typically yourself)'),
      }),
      handler: async (input: { skill_tag: string; exclude_actor_id?: string }, actor: ActorContext) => {
        const specialists = await actorRepo.findSpecialists(
          db,
          actor.tenant_id,
          input.skill_tag,
          input.exclude_actor_id as string | undefined,
        );
        return {
          skill_tag: input.skill_tag,
          specialists: specialists.map(s => ({
            actor_id: s.actor_id,
            display_name: s.actor.display_name,
            proficiency: s.proficiency,
            description: s.description,
            availability_status: s.actor.availability_status ?? 'available',
          })),
          total: specialists.length,
        };
      },
    },
    {
      name: 'agent_set_availability',
      tier: 'core',
      description: 'Update your availability status so other agents know whether you can take work. Set to "busy" when you are actively working on a task, "available" when idle, and "offline" when shutting down.',
      inputSchema: z.object({
        status: z.enum(['available', 'busy', 'offline']).describe('Your availability status'),
      }),
      handler: async (input: { status: 'available' | 'busy' | 'offline' }, actor: ActorContext) => {
        await actorRepo.setAvailabilityStatus(db, actor.tenant_id, actor.actor_id, input.status);
        return { actor_id: actor.actor_id, availability_status: input.status };
      },
    },
  ];
}
