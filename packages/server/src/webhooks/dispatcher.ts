// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';
import { eventBus, type BusEvent } from '../events/bus.js';
import * as webhookRepo from '../db/repos/webhooks.js';

const MAX_ATTEMPTS = 5;
const RETRY_BATCH_SIZE = 20;
const EVENT_BACKLOG_BATCH_SIZE = 100;
const REDACTED_RESPONSE_BODY = '[redacted: webhook response body omitted]';

type DispatchableWebhookEvent = BusEvent | webhookRepo.WebhookEventRow;

interface NormalizedWebhookEvent {
  eventId: number;
  tenantId: UUID;
  eventType: string;
  objectType: string;
  objectId?: UUID | null;
  actorType: string;
  actorId?: string | null;
  data?: unknown;
}

/** Sign a payload with HMAC-SHA256 using the endpoint secret. */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function redactedEndpointLabel(endpointId: UUID, url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/… (${endpointId})`;
  } catch {
    return `invalid-url (${endpointId})`;
  }
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

    await res.body?.cancel().catch(() => undefined);

    if (res.ok) {
      await webhookRepo.updateDeliveryStatus(db, deliveryId, {
        status: 'delivered',
        response_status: res.status,
        response_body: REDACTED_RESPONSE_BODY,
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
        response_body: REDACTED_RESPONSE_BODY,
        next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
      });
    } else {
      await webhookRepo.updateDeliveryStatus(db, deliveryId, {
        status: 'failed',
        response_status: res.status,
        response_body: REDACTED_RESPONSE_BODY,
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

function normalizeEvent(event: DispatchableWebhookEvent): NormalizedWebhookEvent {
  if ('eventType' in event) {
    return {
      eventId: event.event_id,
      tenantId: event.tenantId,
      eventType: event.eventType,
      objectType: event.objectType,
      objectId: event.objectId,
      actorType: event.actorType,
      actorId: event.actorId,
      data: event.afterData,
    };
  }

  return {
    eventId: event.event_id,
    tenantId: event.tenant_id,
    eventType: event.event_type,
    objectType: event.object_type,
    objectId: event.object_id,
    actorType: event.actor_type,
    actorId: event.actor_id,
    data: event.after_data,
  };
}

function payloadForEvent(event: NormalizedWebhookEvent): Record<string, unknown> {
  return {
    event_id: event.eventId,
    event_type: event.eventType,
    tenant_id: event.tenantId,
    object_type: event.objectType,
    object_id: event.objectId,
    actor_type: event.actorType,
    actor_id: event.actorId,
    data: event.data,
    timestamp: new Date().toISOString(),
  };
}

export async function enqueueWebhookDeliveriesForEvent(
  db: DbPool,
  event: DispatchableWebhookEvent,
): Promise<{ created: number; existing: number; attempted: number }> {
  const normalized = normalizeEvent(event);
  const endpoints = await webhookRepo.getActiveWebhooksForEvent(db, normalized.tenantId, normalized.eventType);
  if (endpoints.length === 0) return { created: 0, existing: 0, attempted: 0 };

  const payload = JSON.stringify(payloadForEvent(normalized));
  let created = 0;
  let existing = 0;
  let attempted = 0;

  for (const endpoint of endpoints) {
    const { delivery, created: deliveryCreated } = await webhookRepo.createDelivery(db, {
      endpoint_id: endpoint.id,
      event_id: normalized.eventId,
      event_type: normalized.eventType,
      payload: JSON.parse(payload),
    });

    if (!deliveryCreated) {
      existing++;
      continue;
    }
    created++;

    // Fire-and-forget first attempt. If this process dies after inserting the
    // delivery, the normal retry worker will pick up the pending row.
    attemptDelivery(db, delivery.id, endpoint.url, endpoint.secret, payload, 0).catch((err) => {
      console.error(`[webhook] delivery attempt failed for ${redactedEndpointLabel(endpoint.id, endpoint.url)}:`, err);
    });
    attempted++;
  }

  return { created, existing, attempted };
}

export async function processWebhookEventBacklog(db: DbPool, limit = EVENT_BACKLOG_BATCH_SIZE): Promise<{ events: number; created: number; existing: number; attempted: number }> {
  const events = await webhookRepo.listWebhookBacklogEvents(db, limit);
  const totals = { events: events.length, created: 0, existing: 0, attempted: 0 };
  for (const event of events) {
    const result = await enqueueWebhookDeliveriesForEvent(db, event);
    totals.created += result.created;
    totals.existing += result.existing;
    totals.attempted += result.attempted;
  }
  return totals;
}

/**
 * Register the webhook dispatcher on the event bus.
 * For each emitted event, find matching active webhook endpoints and deliver.
 */
export function registerWebhookDispatcher(db: DbPool): void {
  eventBus.on('crmy:event', async (event: BusEvent) => {
    try {
      await enqueueWebhookDeliveriesForEvent(db, event);
    } catch (err) {
      console.error('[webhook] dispatcher error:', err);
    }
  });
}
