// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  webhookCreate, webhookUpdate, webhookDelete, webhookGet,
  webhookList, webhookListDeliveries,
} from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as webhookRepo from '../../db/repos/webhooks.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function webhookTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'webhook_create',
      description: 'Register a new webhook endpoint to receive real-time event notifications. Specify the URL, events to subscribe to (e.g. "contact.created", "opportunity.stage_changed"), and an optional secret for HMAC signature verification. CRMy sends POST requests with the event payload to your endpoint.',
      inputSchema: webhookCreate,
      handler: async (input: z.infer<typeof webhookCreate>, actor: ActorContext) => {
        const webhook = await webhookRepo.createWebhook(db, actor.tenant_id, {
          ...input,
          created_by: actor.actor_id,
        });
        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'webhook.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'webhook',
          objectId: webhook.id,
          afterData: { id: webhook.id, url: webhook.url, events: webhook.event_types },
        });
        return { webhook };
      },
    },
    {
      name: 'webhook_get',
      description: 'Retrieve a webhook endpoint configuration by UUID, including its URL, subscribed events, active status, and delivery statistics.',
      inputSchema: webhookGet,
      handler: async (input: z.infer<typeof webhookGet>, actor: ActorContext) => {
        const webhook = await webhookRepo.getWebhook(db, actor.tenant_id, input.id);
        if (!webhook) throw notFound('Webhook', input.id);
        return { webhook };
      },
    },
    {
      name: 'webhook_update',
      description: 'Update a webhook endpoint configuration including its URL, subscribed events, active status, and secret. Use this to change event subscriptions or temporarily disable a webhook.',
      inputSchema: webhookUpdate,
      handler: async (input: z.infer<typeof webhookUpdate>, actor: ActorContext) => {
        const before = await webhookRepo.getWebhook(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Webhook', input.id);
        const webhook = await webhookRepo.updateWebhook(db, actor.tenant_id, input.id, input.patch);
        return { webhook };
      },
    },
    {
      name: 'webhook_delete',
      description: 'Delete a webhook endpoint and stop all future deliveries. Past delivery records are retained for debugging.',
      inputSchema: webhookDelete,
      handler: async (input: z.infer<typeof webhookDelete>, actor: ActorContext) => {
        const deleted = await webhookRepo.deleteWebhook(db, actor.tenant_id, input.id);
        if (!deleted) throw notFound('Webhook', input.id);
        return { deleted: true };
      },
    },
    {
      name: 'webhook_list',
      description: 'List all registered webhook endpoints for the current tenant, including their URLs, subscribed events, and active status.',
      inputSchema: webhookList,
      handler: async (input: z.infer<typeof webhookList>, actor: ActorContext) => {
        const result = await webhookRepo.listWebhooks(db, actor.tenant_id, {
          active: input.active,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { webhooks: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'webhook_list_deliveries',
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
