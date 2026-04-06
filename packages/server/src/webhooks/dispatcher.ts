// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';
import { eventBus, type BusEvent } from '../events/bus.js';
import * as webhookRepo from '../db/repos/webhooks.js';

const MAX_ATTEMPTS = 5;
const RETRY_BATCH_SIZE = 20;

/** Sign a payload with HMAC-SHA256 using the endpoint secret. */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Attempt delivery of a single webhook, returns success status. */
async function attemptDelivery(
  db: DbPool,
  deliveryId: UUID,
  url: string,
  secret: string,
  payload: string,
  attemptCount: number,
): Promise<boolean> {
  try {
    const signature = signPayload(payload, secret);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CRMy-Signature': signature,
        'X-CRMy-Delivery': deliveryId,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });

    const responseBody = await res.text().catch(() => '');

    if (res.ok) {
      await webhookRepo.updateDeliveryStatus(db, deliveryId, {
        status: 'delivered',
        response_status: res.status,
        response_body: responseBody.slice(0, 1000),
      });
      return true;
    }

    // Non-2xx — schedule retry or mark failed
    const nextAttempt = attemptCount + 1;
    if (nextAttempt < MAX_ATTEMPTS) {
      const backoffMs = Math.min(Math.pow(2, nextAttempt) * 30_000, 3_600_000);
      await webhookRepo.updateDeliveryStatus(db, deliveryId, {
        status: 'retrying',
        response_status: res.status,
        response_body: responseBody.slice(0, 1000),
        next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
      });
    } else {
      await webhookRepo.updateDeliveryStatus(db, deliveryId, {
        status: 'failed',
        response_status: res.status,
        response_body: responseBody.slice(0, 1000),
      });
    }
    return false;
  } catch (err) {
    const nextAttempt = attemptCount + 1;
    if (nextAttempt < MAX_ATTEMPTS) {
      const backoffMs = Math.min(Math.pow(2, nextAttempt) * 30_000, 3_600_000);
      await webhookRepo.updateDeliveryStatus(db, deliveryId, {
        status: 'retrying',
        next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
      });
    } else {
      await webhookRepo.updateDeliveryStatus(db, deliveryId, {
        status: 'failed',
      });
    }
    return false;
  }
}

/** Look up a webhook endpoint by ID without tenant filter (for retries). */
async function getEndpointById(db: DbPool, id: UUID): Promise<webhookRepo.WebhookEndpointRow | null> {
  const result = await db.query('SELECT * FROM webhook_endpoints WHERE id = $1', [id]);
  return (result.rows[0] as webhookRepo.WebhookEndpointRow) ?? null;
}

/** Process pending webhook retries in batches. */
export async function processWebhookRetries(db: DbPool): Promise<number> {
  const pending = await webhookRepo.getPendingRetries(db, RETRY_BATCH_SIZE);
  let processed = 0;

  for (const delivery of pending) {
    const endpoint = await getEndpointById(db, delivery.endpoint_id);
    if (!endpoint) continue;

    const payload = typeof delivery.payload === 'string'
      ? delivery.payload
      : JSON.stringify(delivery.payload);

    await attemptDelivery(db, delivery.id, endpoint.url, endpoint.secret, payload, delivery.attempt_count);
    processed++;
  }
  return processed;
}

/**
 * Register the webhook dispatcher on the event bus.
 * For each emitted event, find matching active webhook endpoints and deliver.
 */
export function registerWebhookDispatcher(db: DbPool): void {
  eventBus.on('crmy:event', async (event: BusEvent) => {
    try {
      const endpoints = await webhookRepo.getActiveWebhooksForEvent(
        db,
        event.tenantId,
        event.eventType,
      );
      if (endpoints.length === 0) return;

      const payload = JSON.stringify({
        event_id: event.event_id,
        event_type: event.eventType,
        tenant_id: event.tenantId,
        object_type: event.objectType,
        object_id: event.objectId,
        actor_type: event.actorType,
        actor_id: event.actorId,
        data: event.afterData,
        timestamp: new Date().toISOString(),
      });

      for (const endpoint of endpoints) {
        const delivery = await webhookRepo.createDelivery(db, {
          endpoint_id: endpoint.id,
          event_id: event.event_id,
          event_type: event.eventType,
          payload: JSON.parse(payload),
        });

        // Fire-and-forget first attempt
        attemptDelivery(db, delivery.id, endpoint.url, endpoint.secret, payload, 0).catch((err) =>
          console.error(`[webhook] delivery attempt failed for ${endpoint.url}:`, err),
        );
      }
    } catch (err) {
      console.error('[webhook] dispatcher error:', err);
    }
  });
}
