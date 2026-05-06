// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import { runIdempotent } from '../db/repos/idempotency.js';

export function runToolOperation<T>(
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
