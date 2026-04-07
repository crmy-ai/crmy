// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { EmailProvider, EmailMessage, EmailSendResult } from '../provider.js';

export const sesProvider: EmailProvider = {
  type: 'ses',

  validateConfig(config: Record<string, unknown>) {
    if (!config.access_key_id || typeof config.access_key_id !== 'string') {
      return { valid: false, error: 'SES requires an "access_key_id" string' };
    }
    if (!config.secret_access_key || typeof config.secret_access_key !== 'string') {
      return { valid: false, error: 'SES requires a "secret_access_key" string' };
    }
    if (!config.region || typeof config.region !== 'string') {
      return { valid: false, error: 'SES requires a "region" string (e.g. "us-east-1")' };
    }
    return { valid: true };
  },

  async send(config: Record<string, unknown>, message: EmailMessage): Promise<EmailSendResult> {
    try {
      const client = new SESClient({
        region: config.region as string,
        credentials: {
          accessKeyId: config.access_key_id as string,
          secretAccessKey: config.secret_access_key as string,
        },
      });

      const fromAddress = `${message.from_name} <${message.from_email}>`;
      const toAddress = message.to_name
        ? `${message.to_name} <${message.to_email}>`
        : message.to_email;

      const response = await client.send(new SendEmailCommand({
        Source: fromAddress,
        Destination: { ToAddresses: [toAddress] },
        Message: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.body_text, Charset: 'UTF-8' },
            ...(message.body_html ? { Html: { Data: message.body_html, Charset: 'UTF-8' } } : {}),
          },
        },
      }));

      return { success: true, provider_msg_id: response.MessageId };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'SES send failed',
      };
    }
  },
};
