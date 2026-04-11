// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { HITLRequest, UUID } from '@crmy/shared';
import { eventBus } from '../events/bus.js';
import * as hitlRepo from '../db/repos/hitl.js';
import * as msgRepo from '../db/repos/messaging.js';
import { sendMessage } from '../messaging/delivery.js';
import { createAssignment } from '../db/repos/assignments.js';

async function findFirstHumanActor(db: DbPool, tenantId: UUID): Promise<UUID | null> {
  const result = await db.query(
    `SELECT id FROM actors WHERE tenant_id = $1 AND actor_type = 'human' ORDER BY created_at ASC LIMIT 1`,
    [tenantId],
  );
  return (result.rows[0]?.id as UUID) ?? null;
}

async function notifyChannel(db: DbPool, tenantId: UUID, request: HITLRequest): Promise<boolean> {
  const channel = await msgRepo.getDefaultChannel(db, tenantId);
  if (!channel) return false;

  try {
    await sendMessage(db, tenantId, {
      channel_id: channel.id,
      subject: `[HITL] ${request.priority.toUpperCase()}: ${request.action_type}`,
      body: `Agent approval needed:\n\n${request.action_summary}\n\nReview at /app/hitl`,
    });
    return true;
  } catch (err) {
    console.error(`[hitl] Failed to send notification for request ${request.id}:`, err);
    return false;
  }
}

async function createHitlAssignment(db: DbPool, tenantId: UUID, request: HITLRequest): Promise<void> {
  const assignedTo = await findFirstHumanActor(db, tenantId);
  if (!assignedTo) return;

  await createAssignment(db, tenantId, {
    title: `Review HITL Request: ${request.action_type}`,
    description: request.action_summary,
    assignment_type: 'hitl_review',
    assigned_by: request.agent_id as UUID,
    assigned_to: assignedTo,
    priority: request.priority as 'low' | 'normal' | 'high' | 'urgent',
    metadata: { hitl_request_id: request.id },
  });
}

/**
 * Register an event listener that fires on hitl.submitted, sends a notification
 * to the default messaging channel, and falls back to creating an assignment
 * if no channel is configured.
 * Call once during server startup.
 */
export function registerHitlNotificationHandler(db: DbPool): void {
  eventBus.on('crmy:event', async (data) => {
    if (data.eventType !== 'hitl.submitted') return;

    const request = data.afterData as HITLRequest | undefined;
    if (!request) return;

    // Mark notified immediately
    await hitlRepo.markHitlNotified(db, request.id).catch(() => {});

    // Send to default channel; if none, create an assignment
    const sent = await notifyChannel(db, data.tenantId, request);
    if (!sent) {
      await createHitlAssignment(db, data.tenantId, request).catch((err) => {
        console.error(`[hitl] Failed to create assignment for request ${request.id}:`, err);
      });
    }
  });
}
