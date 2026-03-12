// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';

export interface EmitEventOpts {
  tenantId: UUID;
  eventType: string;
  actorId?: string;
  actorType: 'user' | 'agent' | 'system';
  objectType: string;
  objectId?: UUID;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: Record<string, unknown>;
}

export async function emitEvent(db: DbPool, opts: EmitEventOpts): Promise<number> {
  const result = await db.query(
    `INSERT INTO events (tenant_id, event_type, actor_id, actor_type,
       object_type, object_id, before_data, after_data, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      opts.tenantId,
      opts.eventType,
      opts.actorId,
      opts.actorType,
      opts.objectType,
      opts.objectId,
      opts.beforeData ? JSON.stringify(opts.beforeData) : null,
      opts.afterData ? JSON.stringify(opts.afterData) : null,
      JSON.stringify(opts.metadata ?? {}),
    ],
  );
  return result.rows[0].id;
}
