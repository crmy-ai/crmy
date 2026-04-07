// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import sgMail from '@sendgrid/mail';
import type { EmailProvider, EmailMessage, EmailSendResult } from '../provider.js';

export const sendgridProvider: EmailProvider = {
  type: 'sendgrid',

  validateConfig(config: Record<string, unknown>) {
    if (!config.api_key || typeof config.api_key !== 'string') {
      return { valid: false, error: 'SendGrid requires an "api_key" string' };
    }
    return { valid: true };
  },

  async send(config: Record<string, unknown>, message: EmailMessage): Promise<EmailSendResult> {
    try {
      sgMail.setApiKey(config.api_key as string);

      const [response] = await sgMail.send({
        from: { name: message.from_name, email: message.from_email },
        to: message.to_name
          ? { name: message.to_name, email: message.to_email }
          : message.to_email,
        subject: message.subject,
        html: message.body_html,
        text: message.body_text,
      });

      return {
        success: response.statusCode >= 200 && response.statusCode < 300,
        provider_msg_id: response.headers['x-message-id'] as string | undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'SendGrid send failed',
      };
    }
  },
};
