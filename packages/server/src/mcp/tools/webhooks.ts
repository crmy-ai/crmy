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
      description: 'Register a new webhook endpoint to receive event notifications',
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
      description: 'Get a webhook endpoint by ID',
      inputSchema: webhookGet,
      handler: async (input: z.infer<typeof webhookGet>, actor: ActorContext) => {
        const webhook = await webhookRepo.getWebhook(db, actor.tenant_id, input.id);
        if (!webhook) throw notFound('Webhook', input.id);
        return { webhook };
      },
    },
    {
      name: 'webhook_update',
      description: 'Update a webhook endpoint configuration',
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
      description: 'Delete a webhook endpoint',
      inputSchema: webhookDelete,
      handler: async (input: z.infer<typeof webhookDelete>, actor: ActorContext) => {
        const deleted = await webhookRepo.deleteWebhook(db, actor.tenant_id, input.id);
        if (!deleted) throw notFound('Webhook', input.id);
        return { deleted: true };
      },
    },
    {
      name: 'webhook_list',
      description: 'List webhook endpoints',
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
      description: 'List webhook delivery attempts with optional filters',
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
