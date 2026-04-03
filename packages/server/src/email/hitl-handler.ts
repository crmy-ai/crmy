// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { HITLRequest } from '@crmy/shared';
import { eventBus } from '../events/bus.js';
import * as emailRepo from '../db/repos/emails.js';
import { deliverEmail } from './delivery.js';

/**
 * Register event listeners that bridge HITL approval/rejection to email delivery.
 * Call once during server startup.
 */
export function registerEmailHitlHandler(db: DbPool): void {
  eventBus.on('crmy:event', async (data) => {
    if (data.eventType !== 'hitl.approved' && data.eventType !== 'hitl.rejected') return;

    const request = data.afterData as HITLRequest | undefined;
    if (!request || request.action_type !== 'email.send') return;

    const email = await emailRepo.getEmailByHitlRequestId(db, data.tenantId, request.id);
    if (!email) {
      console.error(`[email] No email found for HITL request: ${request.id}`);
      return;
    }

    if (data.eventType === 'hitl.rejected') {
      await emailRepo.updateEmailStatus(db, data.tenantId, email.id, 'rejected');
      return;
    }

    // Approved — transition to approved, then deliver
    await emailRepo.updateEmailStatus(db, data.tenantId, email.id, 'approved');

    try {
      await deliverEmail(db, data.tenantId, email.id);
    } catch (err) {
      console.error(`[email] delivery failed for email ${email.id}:`, err);
      await emailRepo.updateEmailDelivery(db, data.tenantId, email.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Delivery error',
      });
    }
  });
}
