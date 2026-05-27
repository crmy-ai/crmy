// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext, UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as actorRepo from '../db/repos/actors.js';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function resolveActorRecordId(
  db: DbPool,
  tenantId: UUID | string,
  actorId?: UUID | string | null,
): Promise<UUID | undefined> {
  if (!actorId) return undefined;
  if (!isUuid(String(actorId))) return undefined;

  const direct = await actorRepo.getActor(db, tenantId as UUID, actorId as UUID);
  if (direct) return direct.id;

  const linked = await actorRepo.findByUserId(db, tenantId as UUID, actorId as UUID);
  return linked?.id;
}

export async function ensureActorRecordForContext(
  db: DbPool,
  actor: ActorContext,
): Promise<UUID> {
  const existing = await resolveActorRecordId(db, actor.tenant_id, actor.actor_id);
  if (existing) return existing;

  if (actor.actor_type === 'user') {
    const userResult = await db.query(
      `SELECT id, email, name, role
       FROM users
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [actor.tenant_id, actor.actor_id],
    );
    const user = userResult.rows[0] as { id: UUID; email: string; name: string | null; role: string | null } | undefined;
    if (user) {
      const created = await actorRepo.ensureActor(db, actor.tenant_id as UUID, {
        actor_type: 'human',
        display_name: user.name ?? user.email,
        email: user.email,
        user_id: user.id,
        role: user.role ?? actor.role,
        registration_source: 'migration',
        registration_status: 'approved',
        metadata: { created_for_context_fk: true },
      });
      return created.id;
    }
  }

  if (actor.actor_type === 'agent') {
    const created = await actorRepo.ensureActor(db, actor.tenant_id as UUID, {
      actor_type: 'agent',
      display_name: 'External Agent',
      agent_identifier: `external:${actor.actor_id}`,
      role: actor.role,
      scopes: actor.scopes ?? ['context:write'],
      registration_source: 'self_registered',
      registration_status: 'pending_review',
      is_active: true,
      metadata: { created_for_context_fk: true, source_actor_id: actor.actor_id },
    });
    return created.id;
  }

  const system = await actorRepo.ensureActor(db, actor.tenant_id as UUID, {
    actor_type: 'agent',
    display_name: 'CRMy System',
    agent_identifier: 'crmy-system',
    role: 'admin',
    scopes: ['context:write'],
    registration_source: 'migration',
    registration_status: 'approved',
    metadata: { purpose: 'system_context_operations' },
  });
  return system.id;
}
