// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { HITLRequest, UUID } from '@crmy/shared';
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

async function escalateRequest(db: DbPool, request: HITLRequest): Promise<void> {
  const tenantId = request.tenant_id as UUID;

  // Determine escalation target: explicit escalate_to_id, or first human actor
  const assignedTo: UUID | null = request.escalate_to_id ?? await findFirstHumanActor(db, tenantId);
  if (!assignedTo) {
    console.warn(`[hitl-sla] No escalation target found for request ${request.id}`);
    return;
  }

  // Create escalation assignment
  await createAssignment(db, tenantId, {
    title: `[ESCALATED] HITL Request Overdue: ${request.action_type}`,
    description: `SLA breached. Original request:\n\n${request.action_summary}`,
    assignment_type: 'hitl_review',
    assigned_by: request.agent_id as UUID,
    assigned_to: assignedTo,
    priority: 'urgent',
    metadata: { hitl_request_id: request.id, escalated: true },
  });

  // Send escalation message to default channel
  const channel = await msgRepo.getDefaultChannel(db, tenantId);
  if (channel) {
    await sendMessage(db, tenantId, {
      channel_id: channel.id,
      subject: `[HITL ESCALATED] SLA Breach: ${request.action_type}`,
      body: `⚠️ HITL request is overdue and has been escalated.\n\n${request.action_summary}\n\nReview at /app/hitl`,
    }).catch((err) => {
      console.error(`[hitl-sla] Failed to send escalation message for ${request.id}:`, err);
    });
  }
}

/**
 * Check for HITL requests that have breached their SLA, mark them as escalated,
 * create escalation assignments, and send channel notifications.
 *
 * Called from the 60-second background interval.
 */
export async function checkHitlSlaExpiry(db: DbPool): Promise<void> {
  let breached: HITLRequest[];
  try {
    breached = await hitlRepo.findSlaBreachedRequests(db);
  } catch (err) {
    console.error('[hitl-sla] Failed to query SLA-breached requests:', err);
    return;
  }

  for (const request of breached) {
    try {
      await hitlRepo.markHitlEscalated(db, request.id);
      await escalateRequest(db, request);
    } catch (err) {
      console.error(`[hitl-sla] Failed to escalate request ${request.id}:`, err);
    }
  }

  if (breached.length > 0) {
    console.log(`[hitl-sla] Escalated ${breached.length} SLA-breached request(s)`);
  }
}
