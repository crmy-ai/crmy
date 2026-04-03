// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import nodemailer from 'nodemailer';
import type { EmailProvider, EmailMessage, EmailSendResult } from '../provider.js';

export const smtpProvider: EmailProvider = {
  type: 'smtp',

  validateConfig(config: Record<string, unknown>) {
    if (!config.host || typeof config.host !== 'string') {
      return { valid: false, error: 'SMTP requires a "host" string (e.g. "smtp.gmail.com")' };
    }
    if (!config.port || typeof config.port !== 'number') {
      return { valid: false, error: 'SMTP requires a "port" number (e.g. 587)' };
    }
    const auth = config.auth as Record<string, unknown> | undefined;
    if (!auth || typeof auth.user !== 'string' || typeof auth.pass !== 'string') {
      return { valid: false, error: 'SMTP requires "auth.user" and "auth.pass" strings' };
    }
    return { valid: true };
  },

  async send(config: Record<string, unknown>, message: EmailMessage): Promise<EmailSendResult> {
    try {
      const auth = config.auth as { user: string; pass: string };
      const transport = nodemailer.createTransport({
        host: config.host as string,
        port: config.port as number,
        secure: (config.secure as boolean | undefined) ?? (config.port as number) === 465,
        auth: { user: auth.user, pass: auth.pass },
      });

      const info = await transport.sendMail({
        from: `"${message.from_name}" <${message.from_email}>`,
        to: message.to_name
          ? `"${message.to_name}" <${message.to_email}>`
          : message.to_email,
        subject: message.subject,
        html: message.body_html,
        text: message.body_text,
      });

      return { success: true, provider_msg_id: info.messageId };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'SMTP send failed',
      };
    }
  },
};
