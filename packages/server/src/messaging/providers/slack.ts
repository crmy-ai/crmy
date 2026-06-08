// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ChannelProvider, ChannelProviderMessage, ChannelProviderSendResult } from '../provider.js';

const SLACK_SEND_TIMEOUT_MS = Number(process.env.SLACK_SEND_TIMEOUT_MS ?? 10_000);
const REDACTED_RESPONSE_BODY = '[redacted: provider response body omitted]';

export const slackProvider: ChannelProvider = {
  type: 'slack',

  validateConfig(config: Record<string, unknown>) {
    if (!config.webhook_url || typeof config.webhook_url !== 'string') {
      return { valid: false, error: 'Slack provider requires a "webhook_url" string in config' };
    }
    return { valid: true };
  },

  async send(config: Record<string, unknown>, message: ChannelProviderMessage): Promise<ChannelProviderSendResult> {
    const webhookUrl = config.webhook_url as string;
    const channel = (config.channel as string | undefined) ?? undefined;

    const payload: Record<string, unknown> = { text: message.body };
    if (channel) payload.channel = channel;
    if (message.recipient) payload.channel = message.recipient; // recipient overrides default channel

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SLACK_SEND_TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => undefined);

      if (res.ok) {
        return { success: true, response_status: res.status, response_body: REDACTED_RESPONSE_BODY };
      }
      return {
        success: false,
        response_status: res.status,
        response_body: REDACTED_RESPONSE_BODY,
        error: `Slack returned HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Slack request failed',
      };
    }
  },
};
