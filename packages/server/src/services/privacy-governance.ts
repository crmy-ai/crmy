// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { CrmyError, type ActorContext, type UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import { emitEvent } from '../events/emitter.js';
import { withTransaction } from '../db/transaction.js';

export type PrivacySubjectType = 'contact' | 'account' | 'opportunity' | 'use_case';
export type RetentionTarget = 'events' | 'ops_recovery_log' | 'context_outbox_complete' | 'idempotency_keys';

const SUBJECT_TABLES: Record<PrivacySubjectType, string> = {
  contact: 'contacts',
  account: 'accounts',
  opportunity: 'opportunities',
  use_case: 'use_cases',
};

function assertAdmin(actor: ActorContext): void {
  if (actor.role !== 'admin' && actor.role !== 'owner') {
    throw new CrmyError('PERMISSION_DENIED', 'Privacy governance actions require admin or owner role', 403);
  }
}

function subjectWhere(subjectType: PrivacySubjectType): { table: string; activityColumn?: string } {
  return {
    table: SUBJECT_TABLES[subjectType],
    activityColumn:
      subjectType === 'contact' ? 'contact_id' :
      subjectType === 'account' ? 'account_id' :
      subjectType === 'opportunity' ? 'opportunity_id' :
      subjectType === 'use_case' ? 'use_case_id' :
      undefined,
  };
}

export async function exportSubjectData(
  db: DbPool,
  actor: ActorContext,
  subjectType: PrivacySubjectType,
  subjectId: UUID,
): Promise<Record<string, unknown>> {
  assertAdmin(actor);
  const { table, activityColumn } = subjectWhere(subjectType);

  const subject = await db.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2`, [actor.tenant_id, subjectId]);
  if (subject.rows.length === 0) {
    throw new CrmyError('NOT_FOUND', `${subjectType} ${subjectId} not found`, 404);
  }

  const [context, assignments, events, activities] = await Promise.all([
    db.query(
      `SELECT * FROM context_entries
       WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
       ORDER BY created_at DESC`,
      [actor.tenant_id, subjectType, subjectId],
    ),
    db.query(
      `SELECT * FROM assignments
       WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
       ORDER BY created_at DESC`,
      [actor.tenant_id, subjectType, subjectId],
    ),
    db.query(
      `SELECT * FROM events
       WHERE tenant_id = $1 AND object_type = $2 AND object_id = $3
       ORDER BY id DESC`,
      [actor.tenant_id, subjectType, subjectId],
    ),
    activityColumn
      ? db.query(
        `SELECT * FROM activities
         WHERE tenant_id = $1 AND (${activityColumn} = $2 OR (subject_type = $3 AND subject_id = $2))
         ORDER BY created_at DESC`,
        [actor.tenant_id, subjectId, subjectType],
      )
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    exported_at: new Date().toISOString(),
    tenant_id: actor.tenant_id,
    subject_type: subjectType,
    subject_id: subjectId,
    subject: subject.rows[0],
    activities: activities.rows,
    context_entries: context.rows,
    assignments: assignments.rows,
    events: events.rows,
  };
}

export async function redactSubjectPii(
  db: DbPool,
  actor: ActorContext,
  subjectType: PrivacySubjectType,
  subjectId: UUID,
  reason: string,
  dryRun = false,
): Promise<{ subject_type: PrivacySubjectType; subject_id: UUID; dry_run: boolean; redacted_fields: string[]; event_id?: number }> {
  assertAdmin(actor);

  if (subjectType !== 'contact' && subjectType !== 'account') {
    throw new CrmyError('VALIDATION_ERROR', `PII redaction is supported for contact and account subjects, not ${subjectType}`, 422);
  }

  const { table } = subjectWhere(subjectType);
  const before = await db.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2`, [actor.tenant_id, subjectId]);
  if (before.rows.length === 0) throw new CrmyError('NOT_FOUND', `${subjectType} ${subjectId} not found`, 404);

  const redactedFields = subjectType === 'contact'
    ? ['first_name', 'last_name', 'email', 'phone', 'title', 'source', 'custom_fields']
    : ['domain', 'website', 'custom_fields'];

  if (dryRun) {
    return { subject_type: subjectType, subject_id: subjectId, dry_run: true, redacted_fields: redactedFields };
  }

  let eventId: number | undefined;
  await withTransaction(db, async (tx) => {
    if (subjectType === 'contact') {
      await tx.query(
        `UPDATE contacts
         SET first_name = 'Redacted', last_name = '', email = null, phone = null,
             title = null, source = null, custom_fields = '{}', updated_at = now(),
             row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2`,
        [actor.tenant_id, subjectId],
      );
    } else {
      await tx.query(
        `UPDATE accounts
         SET domain = null, website = null, custom_fields = '{}', updated_at = now(),
             row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2`,
        [actor.tenant_id, subjectId],
      );
    }

    eventId = await emitEvent(tx, {
      tenantId: actor.tenant_id,
      eventType: 'privacy.pii_redacted',
      actorId: actor.actor_id,
      actorType: actor.actor_type,
      objectType: subjectType,
      objectId: subjectId,
      beforeData: { redacted_fields: redactedFields },
      afterData: { reason },
    });
  });

  return { subject_type: subjectType, subject_id: subjectId, dry_run: false, redacted_fields: redactedFields, event_id: eventId };
}

export async function deleteSubjectForPrivacy(
  db: DbPool,
  actor: ActorContext,
  subjectType: PrivacySubjectType,
  subjectId: UUID,
  reason: string,
  dryRun = false,
): Promise<{ subject_type: PrivacySubjectType; subject_id: UUID; dry_run: boolean; deleted: boolean; affected: Record<string, number>; event_id?: number }> {
  assertAdmin(actor);
  const { table, activityColumn } = subjectWhere(subjectType);
  const subject = await db.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2`, [actor.tenant_id, subjectId]);
  if (subject.rows.length === 0) throw new CrmyError('NOT_FOUND', `${subjectType} ${subjectId} not found`, 404);

  const affected = {
    context_entries: Number((await db.query(
      'SELECT count(*)::int AS count FROM context_entries WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3',
      [actor.tenant_id, subjectType, subjectId],
    )).rows[0].count),
    assignments: Number((await db.query(
      'SELECT count(*)::int AS count FROM assignments WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3',
      [actor.tenant_id, subjectType, subjectId],
    )).rows[0].count),
    activities: activityColumn
      ? Number((await db.query(
        `SELECT count(*)::int AS count FROM activities WHERE tenant_id = $1 AND (${activityColumn} = $2 OR (subject_type = $3 AND subject_id = $2))`,
        [actor.tenant_id, subjectId, subjectType],
      )).rows[0].count)
      : 0,
  };

  if (dryRun) {
    return { subject_type: subjectType, subject_id: subjectId, dry_run: true, deleted: false, affected };
  }

  let eventId: number | undefined;
  await withTransaction(db, async (tx) => {
    eventId = await emitEvent(tx, {
      tenantId: actor.tenant_id,
      eventType: 'privacy.subject_deleted',
      actorId: actor.actor_id,
      actorType: actor.actor_type,
      objectType: subjectType,
      objectId: subjectId,
      beforeData: subject.rows[0],
      metadata: { reason, affected },
    });
    await tx.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND id = $2`, [actor.tenant_id, subjectId]);
  });

  return { subject_type: subjectType, subject_id: subjectId, dry_run: false, deleted: true, affected, event_id: eventId };
}

export async function applyRetentionPolicy(
  db: DbPool,
  actor: ActorContext,
  input: { older_than_days: number; targets: RetentionTarget[]; dry_run?: boolean },
): Promise<{ dry_run: boolean; older_than_days: number; results: Record<RetentionTarget, number> }> {
  assertAdmin(actor);
  const results = {} as Record<RetentionTarget, number>;
  const cutoffExpr = `now() - ($2 * interval '1 day')`;

  const queries: Record<RetentionTarget, { count: string; delete: string }> = {
    events: {
      count: `SELECT count(*)::int AS count FROM events WHERE tenant_id = $1 AND created_at < ${cutoffExpr}`,
      delete: `DELETE FROM events WHERE tenant_id = $1 AND created_at < ${cutoffExpr}`,
    },
    ops_recovery_log: {
      count: `SELECT count(*)::int AS count FROM ops_recovery_log WHERE tenant_id = $1 AND created_at < ${cutoffExpr}`,
      delete: `DELETE FROM ops_recovery_log WHERE tenant_id = $1 AND created_at < ${cutoffExpr}`,
    },
    context_outbox_complete: {
      count: `SELECT count(*)::int AS count FROM context_outbox WHERE tenant_id = $1 AND status = 'complete' AND processed_at < ${cutoffExpr}`,
      delete: `DELETE FROM context_outbox WHERE tenant_id = $1 AND status = 'complete' AND processed_at < ${cutoffExpr}`,
    },
    idempotency_keys: {
      count: `SELECT count(*)::int AS count FROM idempotency_keys WHERE tenant_id = $1 AND updated_at < ${cutoffExpr}`,
      delete: `DELETE FROM idempotency_keys WHERE tenant_id = $1 AND updated_at < ${cutoffExpr}`,
    },
  };

  for (const target of input.targets) {
    const countResult = await db.query(queries[target].count, [actor.tenant_id, input.older_than_days]);
    results[target] = Number(countResult.rows[0].count);
  }

  if (!input.dry_run) {
    await withTransaction(db, async (tx) => {
      for (const target of input.targets) {
        await tx.query(queries[target].delete, [actor.tenant_id, input.older_than_days]);
      }
      await emitEvent(tx, {
        tenantId: actor.tenant_id,
        eventType: 'privacy.retention_applied',
        actorId: actor.actor_id,
        actorType: actor.actor_type,
        objectType: 'tenant',
        metadata: { older_than_days: input.older_than_days, targets: input.targets, deleted_counts: results },
      });
    });
  }

  return { dry_run: Boolean(input.dry_run), older_than_days: input.older_than_days, results };
}
