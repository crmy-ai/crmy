// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import * as postmark from 'postmark';
import type { EmailProvider, EmailMessage, EmailSendResult } from '../provider.js';

export const postmarkProvider: EmailProvider = {
  type: 'postmark',

  validateConfig(config: Record<string, unknown>) {
    if (!config.server_token || typeof config.server_token !== 'string') {
      return { valid: false, error: 'Postmark requires a "server_token" string' };
    }
    return { valid: true };
  },

  async send(config: Record<string, unknown>, message: EmailMessage): Promise<EmailSendResult> {
    try {
      const client = new postmark.ServerClient(config.server_token as string);

      const response = await client.sendEmail({
        From: `${message.from_name} <${message.from_email}>`,
        To: message.to_name
          ? `${message.to_name} <${message.to_email}>`
          : message.to_email,
        Subject: message.subject,
        HtmlBody: message.body_html,
        TextBody: message.body_text,
        MessageStream: (config.message_stream as string | undefined) ?? 'outbound',
      });

      return { success: true, provider_msg_id: response.MessageID };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Postmark send failed',
      };
    }
  },
};
