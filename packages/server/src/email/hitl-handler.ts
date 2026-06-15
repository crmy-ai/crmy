// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { HITLRequest } from '@crmy/shared';
import { eventBus } from '../events/bus.js';

/**
 * Register event listeners that keep legacy HITL email events aligned.
 *
 * Delivery is intentionally not performed here. hitl_resolve persists the email
 * status and enqueues a durable delivery job in the same transaction, so an
 * in-process event cannot send externally before the transaction commits.
 * Call once during server startup.
 */
export function registerEmailHitlHandler(db: DbPool): void {
  void db;
  eventBus.on('crmy:event', async (data) => {
    if (data.eventType !== 'hitl.approved' && data.eventType !== 'hitl.rejected') return;

    const request = data.afterData as HITLRequest | undefined;
    if (!request || request.action_type !== 'email.send') return;
    // The durable state transition lives in hitl_resolve. This listener exists
    // only so older deployments that import/register it remain harmless.
  });
}
