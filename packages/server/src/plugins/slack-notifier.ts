// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { CrmyPlugin, PluginContext } from './index.js';
import type { CrmyEvent } from '@crmy/shared';

interface SlackConfig {
  webhookUrl: string;
  channel?: string;
  events?: string[];
}

export default function slackNotifier(options: SlackConfig): CrmyPlugin {
  const subscribedEvents = options.events ?? [
    'opportunity.stage_changed',
    'hitl.submitted',
    'workflow.notification',
  ];

  return {
    name: 'slack-notifier',
    version: '0.3.0',

    async onInit(_ctx: PluginContext) {
      if (!options.webhookUrl) {
        throw new Error('slack-notifier requires webhookUrl');
      }
      console.warn(
        '[slack-notifier] This plugin is deprecated. Configure a Slack messaging channel instead ' +
        '(message_channel_create with provider "slack") for delivery tracking and retries.',
      );
      console.log(`  Slack notifier → ${options.channel ?? '#crm-alerts'}`);
    },

    async onEvent(event: CrmyEvent) {
      if (!subscribedEvents.includes(event.event_type)) return;

      const text = formatSlackMessage(event);
      try {
        await fetch(options.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: options.channel,
            text,
          }),
        });
      } catch (err) {
        console.error('Slack notification failed:', err);
      }
    },

    async onShutdown() {
      // nothing to clean up
    },
  };
}

function formatSlackMessage(event: CrmyEvent): string {
  const data = (event.after_data ?? event.before_data ?? {}) as Record<string, unknown>;

  switch (event.event_type) {
    case 'opportunity.stage_changed':
      return `🔄 Opportunity stage changed → *${data.stage ?? 'unknown'}*`;
    case 'hitl.submitted':
      return `⏳ HITL approval needed: ${data.action_summary ?? event.event_type}`;
    case 'workflow.notification':
      return (data.message as string) ?? `Workflow notification: ${event.event_type}`;
    default:
      return `CRM event: ${event.event_type} on ${event.object_type} ${event.object_id ?? ''}`;
  }
}
