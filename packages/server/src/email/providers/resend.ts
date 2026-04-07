// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Resend } from 'resend';
import type { EmailProvider, EmailMessage, EmailSendResult } from '../provider.js';

export const resendProvider: EmailProvider = {
  type: 'resend',

  validateConfig(config: Record<string, unknown>) {
    if (!config.api_key || typeof config.api_key !== 'string') {
      return { valid: false, error: 'Resend requires an "api_key" string' };
    }
    return { valid: true };
  },

  async send(config: Record<string, unknown>, message: EmailMessage): Promise<EmailSendResult> {
    try {
      const client = new Resend(config.api_key as string);

      const { data, error } = await client.emails.send({
        from: `${message.from_name} <${message.from_email}>`,
        to: message.to_name
          ? `${message.to_name} <${message.to_email}>`
          : message.to_email,
        subject: message.subject,
        html: message.body_html,
        text: message.body_text,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, provider_msg_id: data?.id };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Resend send failed',
      };
    }
  },
};
