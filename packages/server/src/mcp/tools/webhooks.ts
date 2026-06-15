// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  webhookCreate, webhookUpdate, webhookDelete, webhookGet,
  webhookRevealSecret, webhookRotateSecret, webhookList, webhookListDeliveries,
} from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as webhookRepo from '../../db/repos/webhooks.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';
import { runToolOperation } from '../tool-operation.js';
import { mutationReceipt } from '../mutation-receipt.js';

function maskWebhookSecret(secret?: string | null): string | null {
  if (!secret) return null;
  return `${secret.slice(0, 6)}••••••••`;
}

function publicWebhook(webhook: webhookRepo.WebhookEndpointRow): Omit<webhookRepo.WebhookEndpointRow, 'secret'> & { has_secret: boolean; secret_masked: string | null } {
  const { secret, ...safe } = webhook;
  return {
    ...safe,
    has_secret: Boolean(secret),
    secret_masked: maskWebhookSecret(secret),
  };
}

export function webhookTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'webhook_create',
      tier: 'admin',
      description: 'Register a new webhook endpoint to receive real-time event notifications. Specify the URL and events to subscribe to (e.g. "contact.created", "opportunity.stage_changed"). CRMy generates a signing secret and sends POST requests with an X-CRMy-Signature HMAC header.',
      inputSchema: webhookCreate,
      handler: async (input: z.infer<typeof webhookCreate>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'webhook_create', input, async () => {
        const webhook = await webhookRepo.createWebhook(db, actor.tenant_id, {
          ...input,
          created_by: actor.actor_id,
        });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'webhook.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'webhook',
          objectId: webhook.id,
          afterData: { id: webhook.id, url: webhook.url, events: webhook.event_types },
        });
        return {
          webhook,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'webhook',
            objectId: webhook.id,
            eventId: event_id,
          }),
        };
        });
      },
    },
    {
      name: 'webhook_get',
      tier: 'admin',
      description: 'Retrieve a webhook endpoint configuration by UUID, including its URL, subscribed events, active status, and masked signing-secret state. Use webhook_reveal_secret only when you need to copy the full signing secret.',
      inputSchema: webhookGet,
      handler: async (input: z.infer<typeof webhookGet>, actor: ActorContext) => {
        const webhook = await webhookRepo.getWebhook(db, actor.tenant_id, input.id);
        if (!webhook) throw notFound('Webhook', input.id);
        return { webhook: publicWebhook(webhook) };
      },
    },
    {
      name: 'webhook_reveal_secret',
      tier: 'admin',
      description: 'Reveal the full signing secret for an outbound webhook endpoint. Use only when configuring or repairing the receiving service.',
      inputSchema: webhookRevealSecret,
      handler: async (input: z.infer<typeof webhookRevealSecret>, actor: ActorContext) => {
        const webhook = await webhookRepo.getWebhook(db, actor.tenant_id, input.id);
        if (!webhook) throw notFound('Webhook', input.id);
        return { id: webhook.id, secret: webhook.secret, secret_masked: maskWebhookSecret(webhook.secret) };
      },
    },
    {
      name: 'webhook_rotate_secret',
      tier: 'admin',
      description: 'Rotate the signing secret for an outbound webhook endpoint. The old secret stops working immediately, so update the receiver before relying on new deliveries.',
      inputSchema: webhookRotateSecret,
      handler: async (input: z.infer<typeof webhookRotateSecret>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'webhook_rotate_secret', input, async () => {
          const before = await webhookRepo.getWebhook(db, actor.tenant_id, input.id);
          if (!before) throw notFound('Webhook', input.id);
          const webhook = await webhookRepo.rotateWebhookSecret(db, actor.tenant_id, input.id);
          if (!webhook) throw notFound('Webhook', input.id);
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id,
            eventType: 'webhook.secret_rotated',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'webhook',
            objectId: input.id,
            beforeData: publicWebhook(before),
            afterData: publicWebhook(webhook),
          });
          return {
            webhook: publicWebhook(webhook),
            secret: webhook.secret,
            secret_masked: maskWebhookSecret(webhook.secret),
            event_id,
            mutation: mutationReceipt(actor, {
              objectType: 'webhook',
              objectId: input.id,
              eventId: event_id,
            }),
          };
        });
      },
    },
    {
      name: 'webhook_update',
      tier: 'admin',
      description: 'Update a webhook endpoint configuration including its URL, subscribed events, active status, and description. Use webhook_rotate_secret to regenerate the signing secret.',
      inputSchema: webhookUpdate,
      handler: async (input: z.infer<typeof webhookUpdate>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'webhook_update', input, async () => {
        const before = await webhookRepo.getWebhook(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Webhook', input.id);
        const webhook = await webhookRepo.updateWebhook(db, actor.tenant_id, input.id, input.patch);
        if (!webhook) throw notFound('Webhook', input.id);
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'webhook.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'webhook',
          objectId: input.id,
          beforeData: publicWebhook(before),
          afterData: publicWebhook(webhook),
        });
        return {
          webhook: publicWebhook(webhook),
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'webhook',
            objectId: input.id,
            eventId: event_id,
          }),
        };
        });
      },
    },
    {
      name: 'webhook_delete',
      tier: 'admin',
      description: 'Delete a webhook endpoint and stop all future deliveries. Past delivery records are retained for debugging.',
      inputSchema: webhookDelete,
      handler: async (input: z.infer<typeof webhookDelete>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'webhook_delete', input, async () => {
        const before = await webhookRepo.getWebhook(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Webhook', input.id);
        const deleted = await webhookRepo.deleteWebhook(db, actor.tenant_id, input.id);
        if (!deleted) throw notFound('Webhook', input.id);
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'webhook.deleted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'webhook',
          objectId: input.id,
          beforeData: publicWebhook(before),
        });
        return {
          deleted: true,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'webhook',
            objectId: input.id,
            eventId: event_id,
          }),
        };
        });
      },
    },
    {
      name: 'webhook_list',
      tier: 'admin',
      description: 'List all registered webhook endpoints for the current tenant, including their URLs, subscribed events, and active status.',
      inputSchema: webhookList,
      handler: async (input: z.infer<typeof webhookList>, actor: ActorContext) => {
        const result = await webhookRepo.listWebhooks(db, actor.tenant_id, {
          active: input.active,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { webhooks: result.data.map(webhook => publicWebhook(webhook)), next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'webhook_list_deliveries',
      tier: 'admin',
      description: 'List webhook delivery attempts with optional filters for a specific webhook. Shows delivery status (success, failed, pending), response codes, and timestamps. Useful for debugging webhook integration issues.',
      inputSchema: webhookListDeliveries,
      handler: async (input: z.infer<typeof webhookListDeliveries>, _actor: ActorContext) => {
        const result = await webhookRepo.listDeliveries(db, {
          endpoint_id: input.endpoint_id,
          status: input.status,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { deliveries: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
  ];
}
