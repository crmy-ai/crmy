// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { Actor, UUID, PaginatedResponse } from '@crmy/shared';

export async function createActor(
  db: DbPool,
  tenantId: UUID,
  data: Partial<Actor>,
): Promise<Actor> {
  const result = await db.query(
    `INSERT INTO actors (tenant_id, actor_type, display_name, email, phone, user_id, role,
       agent_identifier, agent_model, scopes, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      tenantId,
      data.actor_type,
      data.display_name,
      data.email ?? null,
      data.phone ?? null,
      data.user_id ?? null,
      data.role ?? null,
      data.agent_identifier ?? null,
      data.agent_model ?? null,
      data.scopes ?? (data.actor_type === 'human' ? ['read', 'write'] : ['read']),
      JSON.stringify(data.metadata ?? {}),
    ],
  );
  return result.rows[0] as Actor;
}

export async function getActor(db: DbPool, tenantId: UUID, id: UUID): Promise<Actor | null> {
  const result = await db.query(
    'SELECT * FROM actors WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as Actor) ?? null;
}

export async function findByEmail(db: DbPool, tenantId: UUID, email: string): Promise<Actor | null> {
  const result = await db.query(
    'SELECT * FROM actors WHERE tenant_id = $1 AND email = $2',
    [tenantId, email],
  );
  return (result.rows[0] as Actor) ?? null;
}

export async function findByUserId(db: DbPool, tenantId: UUID, userId: UUID): Promise<Actor | null> {
  const result = await db.query(
    'SELECT * FROM actors WHERE tenant_id = $1 AND user_id = $2',
    [tenantId, userId],
  );
  return (result.rows[0] as Actor) ?? null;
}

export async function findByAgentIdentifier(db: DbPool, tenantId: UUID, agentIdentifier: string): Promise<Actor | null> {
  const result = await db.query(
    'SELECT * FROM actors WHERE tenant_id = $1 AND agent_identifier = $2',
    [tenantId, agentIdentifier],
  );
  return (result.rows[0] as Actor) ?? null;
}

/**
 * Find-or-create actor — used for auto-registration on MCP connect.
 */
export async function ensureActor(
  db: DbPool,
  tenantId: UUID,
  data: Partial<Actor> & { actor_type: string; display_name: string },
): Promise<Actor> {
  // Try to find by email or agent_identifier first
  if (data.email) {
    const existing = await findByEmail(db, tenantId, data.email);
    if (existing) return existing;
  }
  if (data.user_id) {
    const existing = await findByUserId(db, tenantId, data.user_id);
    if (existing) return existing;
  }
  if (data.agent_identifier) {
    const existing = await findByAgentIdentifier(db, tenantId, data.agent_identifier);
    if (existing) return existing;
  }
  return createActor(db, tenantId, data);
}

export async function updateActor(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: Record<string, unknown>,
): Promise<Actor | null> {
  const allowedFields = ['display_name', 'email', 'phone', 'role', 'agent_identifier', 'agent_model', 'scopes', 'metadata', 'is_active'];

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  for (const field of allowedFields) {
    if (field in patch) {
      const value = field === 'metadata' ? JSON.stringify(patch[field]) : patch[field];
      sets.push(`${field} = $${idx}`);
      params.push(value);
      idx++;
    }
  }

  if (sets.length === 1) return getActor(db, tenantId, id);

  const result = await db.query(
    `UPDATE actors SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as Actor) ?? null;
}

// ── Specializations ──────────────────────────────────────────────────────────

export interface AgentSpecialization {
  id: UUID;
  tenant_id: UUID;
  actor_id: UUID;
  skill_tag: string;
  proficiency: 'novice' | 'intermediate' | 'expert';
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function upsertSpecialization(
  db: DbPool,
  tenantId: UUID,
  actorId: UUID,
  data: { skill_tag: string; proficiency?: string; description?: string },
): Promise<AgentSpecialization> {
  const result = await db.query(
    `INSERT INTO agent_specializations (tenant_id, actor_id, skill_tag, proficiency, description)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, actor_id, skill_tag) DO UPDATE SET
       proficiency = $4, description = $5, is_active = true, updated_at = now()
     RETURNING *`,
    [tenantId, actorId, data.skill_tag, data.proficiency ?? 'intermediate', data.description ?? null],
  );
  return result.rows[0] as AgentSpecialization;
}

export async function findSpecialists(
  db: DbPool,
  tenantId: UUID,
  skillTag: string,
  excludeActorId?: UUID,
): Promise<Array<AgentSpecialization & { actor: Actor }>> {
  const result = await db.query(
    `SELECT s.*, row_to_json(a.*) as actor
     FROM agent_specializations s
     JOIN actors a ON a.id = s.actor_id
     WHERE s.tenant_id = $1 AND s.skill_tag = $2 AND s.is_active = true
       AND a.is_active = true
       AND ($3::uuid IS NULL OR s.actor_id != $3)
     ORDER BY
       CASE s.proficiency WHEN 'expert' THEN 0 WHEN 'intermediate' THEN 1 ELSE 2 END,
       a.updated_at DESC`,
    [tenantId, skillTag, excludeActorId ?? null],
  );
  return result.rows.map((row) => ({
    ...(row as AgentSpecialization),
    actor: row.actor as Actor,
  }));
}

export async function setAvailabilityStatus(
  db: DbPool,
  tenantId: UUID,
  actorId: UUID,
  status: 'available' | 'busy' | 'offline',
): Promise<void> {
  await db.query(
    'UPDATE actors SET availability_status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3',
    [status, actorId, tenantId],
  );
}

export async function searchActors(
  db: DbPool,
  tenantId: UUID,
  filters: {
    actor_type?: string;
    query?: string;
    is_active?: boolean;
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<Actor>> {
  const conditions: string[] = ['a.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.actor_type) {
    conditions.push(`a.actor_type = $${idx}`);
    params.push(filters.actor_type);
    idx++;
  }
  if (filters.is_active !== undefined) {
    conditions.push(`a.is_active = $${idx}`);
    params.push(filters.is_active);
    idx++;
  }
  if (filters.query) {
    conditions.push(`(a.display_name ILIKE $${idx} OR a.email ILIKE $${idx} OR a.phone ILIKE $${idx} OR a.agent_identifier ILIKE $${idx})`);
    params.push(`%${filters.query}%`);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`a.created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int as total FROM actors a WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT a.* FROM actors a WHERE ${where} ORDER BY a.created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as Actor[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}
