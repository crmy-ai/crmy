// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  messagingChannelCreate,
  messagingChannelUpdate,
  messagingChannelGet,
  messagingChannelDelete,
  messagingChannelList,
  messageSend,
  messageDeliveryGet,
  messageDeliverySearch,
} from '@crmy/shared';
import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ToolDef } from '../server.js';
import * as msgRepo from '../../db/repos/messaging.js';
import { sendMessage } from '../../messaging/delivery.js';
import { getProvider, listProviderTypes } from '../../messaging/providers/index.js';

export function messagingTools(db: DbPool): ToolDef[] {
  return [
    // ── Channel management ────────────────────────────────────────────────

    {
      name: 'message_channel_create',
      description:
        'Configure a new messaging channel for the tenant. A channel represents a delivery endpoint ' +
        'like a Slack workspace, email provider, or other messaging platform. ' +
        'Each provider type requires specific config fields (e.g. Slack needs "webhook_url"). ' +
        'Use message_channel_list to see existing channels before creating duplicates.',
      inputSchema: messagingChannelCreate,
      handler: async (input: z.infer<typeof messagingChannelCreate>, actor: ActorContext) => {
        // Validate provider exists
        const provider = getProvider(input.provider);
        if (!provider) {
          return {
            error: `Unknown provider: "${input.provider}". Available providers: ${listProviderTypes().join(', ')}`,
          };
        }

        // Validate provider-specific config
        const validation = provider.validateConfig(input.config);
        if (!validation.valid) {
          return { error: `Invalid config for provider "${input.provider}": ${validation.error}` };
        }

        return msgRepo.createChannel(db, actor.tenant_id, {
          name: input.name,
          provider: input.provider,
          config: input.config,
          is_active: input.is_active,
          is_default: input.is_default,
          created_by: actor.actor_id,
        });
      },
    },

    {
      name: 'message_channel_update',
      description: 'Update an existing messaging channel configuration. Can change the name, config, or active status.',
      inputSchema: messagingChannelUpdate,
      handler: async (input: z.infer<typeof messagingChannelUpdate>, actor: ActorContext) => {
        // If config is being updated, validate it
        if (input.patch.config) {
          const existing = await msgRepo.getChannel(db, actor.tenant_id, input.id);
          if (!existing) return { error: 'Channel not found' };

          const provider = getProvider(existing.provider);
          if (provider) {
            const validation = provider.validateConfig(input.patch.config);
            if (!validation.valid) {
              return { error: `Invalid config: ${validation.error}` };
            }
          }
        }

        const updated = await msgRepo.updateChannel(db, actor.tenant_id, input.id, input.patch);
        return updated ?? { error: 'Channel not found' };
      },
    },

    {
      name: 'message_channel_get',
      description: 'Get details of a specific messaging channel by ID.',
      inputSchema: messagingChannelGet,
      handler: async (input: z.infer<typeof messagingChannelGet>, actor: ActorContext) => {
        const channel = await msgRepo.getChannel(db, actor.tenant_id, input.id);
        return channel ?? { error: 'Channel not found' };
      },
    },

    {
      name: 'message_channel_delete',
      description: 'Delete a messaging channel. This does not delete past delivery records.',
      inputSchema: messagingChannelDelete,
      handler: async (input: z.infer<typeof messagingChannelDelete>, actor: ActorContext) => {
        const deleted = await msgRepo.deleteChannel(db, actor.tenant_id, input.id);
        return { deleted };
      },
    },

    {
      name: 'message_channel_list',
      description:
        'List configured messaging channels with optional filters by provider type or active status. ' +
        'Shows all channels the tenant has set up for sending messages.',
      inputSchema: messagingChannelList,
      handler: async (input: z.infer<typeof messagingChannelList>, actor: ActorContext) => {
        return msgRepo.listChannels(db, actor.tenant_id, {
          provider: input.provider,
          is_active: input.is_active,
          limit: input.limit,
          cursor: input.cursor,
        });
      },
    },

    // ── Sending messages ──────────────────────────────────────────────────

    {
      name: 'message_send',
      description:
        'Send a message through a configured messaging channel with delivery tracking. ' +
        'Returns the delivery record including status (delivered, retrying, or failed). ' +
        'The recipient field is optional and channel-specific: for Slack it can be a #channel or @user override, ' +
        'for email it would be the to-address. If omitted, the channel\'s default target is used.',
      inputSchema: messageSend,
      handler: async (input: z.infer<typeof messageSend>, actor: ActorContext) => {
        return sendMessage(db, actor.tenant_id, {
          channel_id: input.channel_id,
          recipient: input.recipient,
          subject: input.subject,
          body: input.body,
          metadata: input.metadata,
        });
      },
    },

    // ── Delivery tracking ─────────────────────────────────────────────────

    {
      name: 'message_delivery_get',
      description: 'Check the delivery status of a previously sent message by delivery ID.',
      inputSchema: messageDeliveryGet,
      handler: async (input: z.infer<typeof messageDeliveryGet>, actor: ActorContext) => {
        const delivery = await msgRepo.getDelivery(db, actor.tenant_id, input.id);
        return delivery ?? { error: 'Delivery not found' };
      },
    },

    {
      name: 'message_delivery_search',
      description:
        'Search message delivery records filtered by channel or status. ' +
        'Useful for checking if messages were delivered, finding failures, or auditing messaging activity.',
      inputSchema: messageDeliverySearch,
      handler: async (input: z.infer<typeof messageDeliverySearch>, actor: ActorContext) => {
        return msgRepo.listDeliveries(db, actor.tenant_id, {
          channel_id: input.channel_id,
          status: input.status,
          limit: input.limit,
          cursor: input.cursor,
        });
      },
    },
  ];
}
