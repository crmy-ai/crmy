// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../../db/pool.js';
import type { HITLRequest } from '@crmy/shared';
import { eventBus } from '../../events/bus.js';
import { emitEvent } from '../../events/emitter.js';
import * as sorRepo from '../../db/repos/systems-of-record.js';

/**
 * Bridges Handoffs approvals back to governed external writeback requests.
 * This lets reviewers approve from the HITL queue without visiting Settings.
 */
export function registerSystemsOfRecordHitlHandler(db: DbPool): void {
  eventBus.on('crmy:event', async (data) => {
    if (data.eventType !== 'hitl.approved' && data.eventType !== 'hitl.rejected') return;

    const request = data.afterData as HITLRequest | undefined;
    if (!request || request.action_type !== 'external.writeback') return;

    const writeback = await sorRepo.getWritebackByHitlRequestId(db, data.tenantId, request.id);
    if (!writeback) {
      console.error(`[systems] No external writeback found for HITL request: ${request.id}`);
      return;
    }
    if (writeback.status !== 'approval_required') return;

    const nextStatus = data.eventType === 'hitl.approved' ? 'approved' : 'rejected';
    const policyResult = writeback.policy_result ?? {};
    if (nextStatus === 'approved' && policyResult.allowed === false) {
      const updated = await sorRepo.updateWriteback(db, data.tenantId, writeback.id, {
        status: 'rejected',
        policy_result: {
          ...policyResult,
          hitl_status: request.status,
          reviewer_id: request.reviewer_id,
          review_note: request.review_note,
          reviewed_at: request.resolved_at ?? new Date().toISOString(),
          blocked_reason: 'Policy preview did not allow this writeback.',
        },
      });
      await emitEvent(db, {
        tenantId: data.tenantId,
        eventType: 'system_writeback.rejected',
        actorId: data.actorId,
        actorType: data.actorType,
        objectType: 'external_writeback',
        objectId: writeback.id,
        beforeData: writeback,
        afterData: updated,
        metadata: {
          origin: 'crmy',
          system_id: writeback.system_id,
          external_record_id: writeback.external_record_id,
          hitl_request_id: request.id,
        },
      });
      return;
    }

    const updated = await sorRepo.updateWriteback(db, data.tenantId, writeback.id, {
      status: nextStatus,
      policy_result: {
        ...policyResult,
        hitl_status: request.status,
        reviewer_id: request.reviewer_id,
        review_note: request.review_note,
        reviewed_at: request.resolved_at ?? new Date().toISOString(),
      },
    });

    await emitEvent(db, {
      tenantId: data.tenantId,
      eventType: nextStatus === 'approved' ? 'system_writeback.approved' : 'system_writeback.rejected',
      actorId: data.actorId,
      actorType: data.actorType,
      objectType: 'external_writeback',
      objectId: writeback.id,
      beforeData: writeback,
      afterData: updated,
      metadata: {
        origin: 'crmy',
        system_id: writeback.system_id,
        external_record_id: writeback.external_record_id,
        hitl_request_id: request.id,
      },
    });
  });
}
