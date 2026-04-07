// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import type { EmailProvider, EmailMessage, EmailSendResult } from '../provider.js';

export const mailgunProvider: EmailProvider = {
  type: 'mailgun',

  validateConfig(config: Record<string, unknown>) {
    if (!config.api_key || typeof config.api_key !== 'string') {
      return { valid: false, error: 'Mailgun requires an "api_key" string' };
    }
    if (!config.domain || typeof config.domain !== 'string') {
      return { valid: false, error: 'Mailgun requires a "domain" string (e.g. "mg.example.com")' };
    }
    return { valid: true };
  },

  async send(config: Record<string, unknown>, message: EmailMessage): Promise<EmailSendResult> {
    try {
      const mailgun = new Mailgun(FormData);
      const client = mailgun.client({
        username: 'api',
        key: config.api_key as string,
        url: (config.url as string | undefined) ?? 'https://api.mailgun.net',
      });

      const response = await client.messages.create(config.domain as string, {
        from: `${message.from_name} <${message.from_email}>`,
        to: message.to_name
          ? `${message.to_name} <${message.to_email}>`
          : message.to_email,
        subject: message.subject,
        html: message.body_html,
        text: message.body_text,
      });

      return { success: true, provider_msg_id: response.id };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Mailgun send failed',
      };
    }
  },
};
