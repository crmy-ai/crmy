// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext, Assignment, HITLRequest, UUID } from '@crmy/shared';
import { permissionDenied } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';

export type VisibilityScope = 'own' | 'team' | 'all';
export type OwnedObjectType = 'account' | 'contact' | 'opportunity' | 'use_case' | 'activity';

const OBJECT_TABLES: Record<OwnedObjectType, string> = {
  account: 'accounts',
  contact: 'contacts',
  opportunity: 'opportunities',
  use_case: 'use_cases',
  activity: 'activities',
};
const HITL_SUBJECT_TYPES = new Set(['account', 'contact', 'opportunity', 'use_case']);

function uuidLike(value: unknown): value is UUID {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isGlobalActor(actor: ActorContext): boolean {
  return actor.role === 'admin' || actor.role === 'owner';
}

export async function getActorUserId(db: DbPool, actor: ActorContext): Promise<UUID | null> {
  const direct = await db.query(
    'SELECT id FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1',
    [actor.tenant_id, actor.actor_id],
  );
  if (direct.rows[0]?.id) return direct.rows[0].id as UUID;

  const linked = await db.query(
    `SELECT COALESCE(a.user_id, ak.user_id) AS user_id
     FROM actors a
     LEFT JOIN api_keys ak ON ak.actor_id = a.id AND ak.tenant_id = a.tenant_id
     WHERE a.tenant_id = $1 AND a.id::text = $2
     LIMIT 1`,
    [actor.tenant_id, actor.actor_id],
  );
  return (linked.rows[0]?.user_id as UUID | undefined) ?? null;
}

export async function getDirectOwnerIds(db: DbPool, actor: ActorContext): Promise<UUID[]> {
  const userId = await getActorUserId(db, actor);
  return userId ? [userId] : [];
}

export async function getVisibleOwnerIds(db: DbPool, actor: ActorContext): Promise<UUID[] | null> {
  if (isGlobalActor(actor)) return null;

  const userId = await getActorUserId(db, actor);
  if (!userId) return [];
  if (actor.role !== 'manager') return [userId];

  const result = await db.query(
    `WITH RECURSIVE reports AS (
       SELECT id
       FROM users
       WHERE tenant_id = $1 AND id = $2
       UNION
       SELECT u.id
       FROM users u
       JOIN reports r ON u.manager_id = r.id
       WHERE u.tenant_id = $1
     )
     SELECT id FROM reports`,
    [actor.tenant_id, userId],
  );
  return result.rows.map(row => row.id as UUID);
}

export async function resolveOwnerFilter(
  db: DbPool,
  actor: ActorContext,
  requestedOwnerId?: UUID,
): Promise<{ owner_id?: UUID; owner_ids?: UUID[] }> {
  const visibleOwnerIds = await getVisibleOwnerIds(db, actor);
  if (visibleOwnerIds === null) return requestedOwnerId ? { owner_id: requestedOwnerId } : {};
  if (requestedOwnerId) {
    return visibleOwnerIds.includes(requestedOwnerId) ? { owner_id: requestedOwnerId } : { owner_ids: [] };
  }
  return { owner_ids: visibleOwnerIds };
}

export async function defaultOwnerForCreate(
  db: DbPool,
  actor: ActorContext,
  requestedOwnerId?: UUID | null,
): Promise<UUID | null> {
  if (requestedOwnerId && isGlobalActor(actor)) return requestedOwnerId;
  const visibleOwnerIds = await getVisibleOwnerIds(db, actor);
  if (requestedOwnerId && visibleOwnerIds?.includes(requestedOwnerId)) return requestedOwnerId;
  if (requestedOwnerId && visibleOwnerIds !== null) throw permissionDenied('You cannot assign records outside your visible book of business');
  return await getActorUserId(db, actor);
}

export async function assertOwnedObjectAccess(
  db: DbPool,
  actor: ActorContext,
  objectType: OwnedObjectType,
  objectId: UUID,
): Promise<void> {
  if (isGlobalActor(actor)) return;
  const visibleOwnerIds = await getVisibleOwnerIds(db, actor);
  if (visibleOwnerIds === null) return;
  if (visibleOwnerIds.length === 0) throw permissionDenied('You do not have access to this record');

  const table = OBJECT_TABLES[objectType];
  const result = await db.query(
    `SELECT owner_id FROM ${table} WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [actor.tenant_id, objectId],
  );
  const ownerId = result.rows[0]?.owner_id as UUID | null | undefined;
  if (!ownerId || !visibleOwnerIds.includes(ownerId)) {
    throw permissionDenied('You do not have access to this record');
  }
}

export async function assertSubjectAccess(
  db: DbPool,
  actor: ActorContext,
  subjectType?: string,
  subjectId?: UUID,
): Promise<void> {
  if (!subjectType || !subjectId) return;
  if (!['account', 'contact', 'opportunity', 'use_case'].includes(subjectType)) return;
  await assertOwnedObjectAccess(db, actor, subjectType as OwnedObjectType, subjectId);
}

export async function assertActivityAccess(db: DbPool, actor: ActorContext, activityId: UUID): Promise<void> {
  if (isGlobalActor(actor)) return;
  const activity = await db.query(
    'SELECT owner_id, subject_type, subject_id FROM activities WHERE tenant_id = $1 AND id = $2 LIMIT 1',
    [actor.tenant_id, activityId],
  );
  const row = activity.rows[0];
  if (!row) throw permissionDenied('You do not have access to this activity');
  const visibleOwnerIds = await getVisibleOwnerIds(db, actor);
  if (visibleOwnerIds === null) return;
  if (row.owner_id && visibleOwnerIds.includes(row.owner_id)) return;
  await assertSubjectAccess(db, actor, row.subject_type, row.subject_id);
}

function hitlPayload(request: HITLRequest): Record<string, unknown> {
  const payload = request.action_payload;
  if (!payload) return {};
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function payloadSubject(payload: Record<string, unknown>): { subjectType?: string; subjectId?: UUID } {
  const type = payload.subject_type ?? payload._subject_type ?? payload.object_type ?? payload.target_object_type;
  const id = payload.subject_id ?? payload._subject_id ?? payload.object_id ?? payload.target_object_id;
  return typeof type === 'string' && HITL_SUBJECT_TYPES.has(type) && typeof id === 'string'
    ? { subjectType: type, subjectId: id as UUID }
    : {};
}

async function hitlSubjectFromLinkedArtifact(
  db: DbPool,
  tenantId: UUID,
  payload: Record<string, unknown>,
): Promise<{ subjectType?: string; subjectId?: UUID }> {
  const signalGroupId = typeof payload.signal_group_id === 'string' ? payload.signal_group_id : undefined;
  if (signalGroupId) {
    const result = await db.query(
      'SELECT subject_type, subject_id FROM signal_groups WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, signalGroupId],
    );
    if (result.rows[0]?.subject_type && result.rows[0]?.subject_id) {
      return { subjectType: result.rows[0].subject_type, subjectId: result.rows[0].subject_id as UUID };
    }
  }

  const contextEntryId = typeof payload.context_entry_id === 'string' ? payload.context_entry_id : undefined;
  if (contextEntryId) {
    const result = await db.query(
      'SELECT subject_type, subject_id FROM context_entries WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, contextEntryId],
    );
    if (result.rows[0]?.subject_type && result.rows[0]?.subject_id) {
      return { subjectType: result.rows[0].subject_type, subjectId: result.rows[0].subject_id as UUID };
    }
  }

  const rawContextSourceId = typeof payload.raw_context_source_id === 'string' ? payload.raw_context_source_id : undefined;
  if (rawContextSourceId) {
    const result = await db.query(
      'SELECT subject_type, subject_id FROM raw_context_sources WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, rawContextSourceId],
    );
    if (result.rows[0]?.subject_type && result.rows[0]?.subject_id) {
      return { subjectType: result.rows[0].subject_type, subjectId: result.rows[0].subject_id as UUID };
    }
  }

  return {};
}

async function hitlSessionSubject(
  db: DbPool,
  tenantId: UUID,
  sessionId?: string | null,
): Promise<{ subjectType?: string; subjectId?: UUID; userId?: string | null }> {
  if (!sessionId) return {};
  if (!uuidLike(sessionId)) return {};
  const result = await db.query(
    'SELECT user_id, context_type, context_id FROM agent_sessions WHERE tenant_id = $1 AND id = $2 LIMIT 1',
    [tenantId, sessionId],
  );
  const row = result.rows[0];
  if (!row) return {};
  return {
    userId: row.user_id ?? null,
    subjectType: HITL_SUBJECT_TYPES.has(row.context_type) ? row.context_type : undefined,
    subjectId: row.context_id ?? undefined,
  };
}

export async function canAccessHITLRequest(db: DbPool, actor: ActorContext, request: HITLRequest): Promise<boolean> {
  if (isGlobalActor(actor)) return true;
  if (request.agent_id === actor.actor_id || request.reviewer_id === actor.actor_id || request.escalate_to_id === actor.actor_id) return true;

  const session = await hitlSessionSubject(db, actor.tenant_id, request.session_id);
  if (session.userId === actor.actor_id) return true;
  if (session.subjectType && session.subjectId) {
    try {
      await assertSubjectAccess(db, actor, session.subjectType, session.subjectId);
      return true;
    } catch {
      return false;
    }
  }

  const payload = hitlPayload(request);
  const direct = payloadSubject(payload);
  const linked = direct.subjectType && direct.subjectId
    ? direct
    : await hitlSubjectFromLinkedArtifact(db, actor.tenant_id, payload);
  if (!linked.subjectType || !linked.subjectId) return false;

  try {
    await assertSubjectAccess(db, actor, linked.subjectType, linked.subjectId);
    return true;
  } catch {
    return false;
  }
}

export async function assertHITLPayloadAccess(
  db: DbPool,
  actor: ActorContext,
  payload: unknown,
  sessionId?: string | null,
): Promise<void> {
  if (isGlobalActor(actor)) return;

  const session = await hitlSessionSubject(db, actor.tenant_id, sessionId);
  if (session.userId && session.userId !== actor.actor_id) {
    throw permissionDenied('You cannot create a handoff for another user session');
  }
  if (session.subjectType && session.subjectId) {
    await assertSubjectAccess(db, actor, session.subjectType, session.subjectId);
  }

  const parsed = hitlPayload({
    action_payload: payload,
  } as HITLRequest);
  const direct = payloadSubject(parsed);
  const linked = direct.subjectType && direct.subjectId
    ? direct
    : await hitlSubjectFromLinkedArtifact(db, actor.tenant_id, parsed);
  if (linked.subjectType && linked.subjectId) {
    await assertSubjectAccess(db, actor, linked.subjectType, linked.subjectId);
  }
}

export async function assertHITLAccess(db: DbPool, actor: ActorContext, request: HITLRequest): Promise<void> {
  if (!await canAccessHITLRequest(db, actor, request)) {
    throw permissionDenied('You do not have access to this handoff');
  }
}

export async function filterVisibleHITLRequests(
  db: DbPool,
  actor: ActorContext,
  requests: HITLRequest[],
  limit: number,
): Promise<HITLRequest[]> {
  if (isGlobalActor(actor)) return requests.slice(0, limit);
  const visible: HITLRequest[] = [];
  for (const request of requests) {
    if (await canAccessHITLRequest(db, actor, request)) {
      visible.push(request);
      if (visible.length >= limit) break;
    }
  }
  return visible;
}

export async function canAccessAssignment(db: DbPool, actor: ActorContext, assignment: Assignment): Promise<boolean> {
  if (isGlobalActor(actor)) return true;

  const linkedType = assignment.subject_type;
  const linkedId = assignment.subject_id;
  if (linkedType && linkedId) {
    try {
      await assertSubjectAccess(db, actor, linkedType, linkedId);
      return true;
    } catch {
      return false;
    }
  }

  return assignment.assigned_to === actor.actor_id || assignment.assigned_by === actor.actor_id;
}

export async function assertAssignmentAccess(db: DbPool, actor: ActorContext, assignment: Assignment): Promise<void> {
  if (!await canAccessAssignment(db, actor, assignment)) {
    throw permissionDenied('You do not have access to this assignment');
  }
}

export async function filterVisibleAssignments(
  db: DbPool,
  actor: ActorContext,
  assignments: Assignment[],
  limit: number,
): Promise<Assignment[]> {
  if (isGlobalActor(actor)) return assignments.slice(0, limit);
  const visible: Assignment[] = [];
  for (const assignment of assignments) {
    if (await canAccessAssignment(db, actor, assignment)) {
      visible.push(assignment);
      if (visible.length >= limit) break;
    }
  }
  return visible;
}

export function adminRoles(): Array<ActorContext['role']> {
  return ['admin', 'owner'];
}
