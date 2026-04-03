// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';
import { emitEvent } from '../events/emitter.js';
import * as msgRepo from '../db/repos/messaging.js';
import { getProvider } from './providers/index.js';

// ── Send ────────────────────────────────────────────────────────────────────

export interface SendMessageParams {
  channel_id: UUID;
  recipient?: string;
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export async function sendMessage(
  db: DbPool,
  tenantId: UUID,
  params: SendMessageParams,
): Promise<msgRepo.MessageDeliveryRow> {
  const channel = await msgRepo.getChannel(db, tenantId, params.channel_id);
  if (!channel) throw new Error(`Messaging channel not found: ${params.channel_id}`);
  if (!channel.is_active) throw new Error(`Messaging channel is disabled: ${channel.name}`);

  const provider = getProvider(channel.provider);
  if (!provider) throw new Error(`No provider registered for type: ${channel.provider}`);

  // Create the delivery record
  const delivery = await msgRepo.createDelivery(db, tenantId, {
    channel_id: params.channel_id,
    recipient: params.recipient,
    subject: params.subject,
    body: params.body,
    metadata: params.metadata,
  });

  // Attempt delivery
  const result = await provider.send(channel.config, {
    recipient: params.recipient,
    subject: params.subject,
    body: params.body,
  });

  if (result.success) {
    await msgRepo.updateDeliveryStatus(db, delivery.id, {
      status: 'delivered',
      provider_msg_id: result.provider_msg_id,
      response_status: result.response_status,
      response_body: result.response_body,
    });

    emitEvent(db, {
      tenantId,
      eventType: 'message.delivered',
      actorType: 'system',
      objectType: 'message_delivery',
      objectId: delivery.id,
      afterData: { channel_id: params.channel_id, recipient: params.recipient, status: 'delivered' },
    }).catch(() => {}); // fire-and-forget

    return { ...delivery, status: 'delivered', attempt_count: 1 };
  }

  // First attempt failed — schedule retry or mark as failed
  const nextAttempt = 1;
  if (nextAttempt < delivery.max_attempts) {
    const backoffMs = Math.min(Math.pow(2, nextAttempt) * 30_000, 3_600_000);
    const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();

    await msgRepo.updateDeliveryStatus(db, delivery.id, {
      status: 'retrying',
      response_status: result.response_status,
      response_body: result.response_body,
      error: result.error,
      next_retry_at: nextRetryAt,
    });

    return { ...delivery, status: 'retrying', attempt_count: 1, error: result.error ?? null } as unknown as msgRepo.MessageDeliveryRow;
  }

  await msgRepo.updateDeliveryStatus(db, delivery.id, {
    status: 'failed',
    response_status: result.response_status,
    response_body: result.response_body,
    error: result.error,
  });

  emitEvent(db, {
    tenantId,
    eventType: 'message.failed',
    actorType: 'system',
    objectType: 'message_delivery',
    objectId: delivery.id,
    afterData: { channel_id: params.channel_id, recipient: params.recipient, error: result.error },
  }).catch(() => {});

  return { ...delivery, status: 'failed', attempt_count: 1, error: result.error ?? null } as unknown as msgRepo.MessageDeliveryRow;
}

// ── Retry processing ────────────────────────────────────────────────────────

const RETRY_BATCH_SIZE = 20;

export async function processRetries(db: DbPool): Promise<number> {
  const pending = await msgRepo.getPendingRetries(db, RETRY_BATCH_SIZE);
  let processed = 0;

  for (const delivery of pending) {
    const channel = await msgRepo.getChannel(db, delivery.tenant_id, delivery.channel_id);
    if (!channel || !channel.is_active) {
      await msgRepo.updateDeliveryStatus(db, delivery.id, {
        status: 'failed',
        error: 'Channel no longer active',
      });
      processed++;
      continue;
    }

    const provider = getProvider(channel.provider);
    if (!provider) {
      await msgRepo.updateDeliveryStatus(db, delivery.id, {
        status: 'failed',
        error: `Provider not found: ${channel.provider}`,
      });
      processed++;
      continue;
    }

    const result = await provider.send(channel.config, {
      recipient: delivery.recipient ?? undefined,
      subject: delivery.subject ?? undefined,
      body: delivery.body,
    });

    if (result.success) {
      await msgRepo.updateDeliveryStatus(db, delivery.id, {
        status: 'delivered',
        provider_msg_id: result.provider_msg_id,
        response_status: result.response_status,
        response_body: result.response_body,
      });

      emitEvent(db, {
        tenantId: delivery.tenant_id,
        eventType: 'message.delivered',
        actorType: 'system',
        objectType: 'message_delivery',
        objectId: delivery.id,
        afterData: { channel_id: delivery.channel_id, recipient: delivery.recipient, status: 'delivered' },
      }).catch(() => {});
    } else {
      const nextAttempt = delivery.attempt_count + 1;
      if (nextAttempt < delivery.max_attempts) {
        const backoffMs = Math.min(Math.pow(2, nextAttempt) * 30_000, 3_600_000);
        const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();

        await msgRepo.updateDeliveryStatus(db, delivery.id, {
          status: 'retrying',
          response_status: result.response_status,
          response_body: result.response_body,
          error: result.error,
          next_retry_at: nextRetryAt,
        });
      } else {
        await msgRepo.updateDeliveryStatus(db, delivery.id, {
          status: 'failed',
          response_status: result.response_status,
          response_body: result.response_body,
          error: result.error,
        });

        emitEvent(db, {
          tenantId: delivery.tenant_id,
          eventType: 'message.failed',
          actorType: 'system',
          objectType: 'message_delivery',
          objectId: delivery.id,
          afterData: { channel_id: delivery.channel_id, recipient: delivery.recipient, error: result.error },
        }).catch(() => {});
      }
    }

    processed++;
  }

  return processed;
}

// ── Retry loop lifecycle ────────────────────────────────────────────────────

const RETRY_INTERVAL_MS = 30_000;
let retryTimer: ReturnType<typeof setInterval> | null = null;

export function startRetryLoop(db: DbPool): void {
  if (retryTimer) return;
  retryTimer = setInterval(() => {
    processRetries(db).catch((err) => {
      console.error('[messaging] retry loop error:', err);
    });
  }, RETRY_INTERVAL_MS);
}

export function stopRetryLoop(): void {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}
