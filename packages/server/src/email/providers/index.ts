// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { EmailProvider } from '../provider.js';
import { smtpProvider } from './smtp.js';
import { resendProvider } from './resend.js';
import { postmarkProvider } from './postmark.js';
import { sendgridProvider } from './sendgrid.js';
import { sesProvider } from './ses.js';
import { mailgunProvider } from './mailgun.js';

const providers = new Map<string, EmailProvider>();

// Register built-in providers
providers.set(smtpProvider.type, smtpProvider);
providers.set(resendProvider.type, resendProvider);
providers.set(postmarkProvider.type, postmarkProvider);
providers.set(sendgridProvider.type, sendgridProvider);
providers.set(sesProvider.type, sesProvider);
providers.set(mailgunProvider.type, mailgunProvider);

/** Register an email provider. Plugins can call this to add new providers (e.g. SendGrid, SES). */
export function registerEmailProvider(provider: EmailProvider): void {
  providers.set(provider.type, provider);
}

/** Look up a registered email provider by type. */
export function getEmailProvider(type: string): EmailProvider | undefined {
  return providers.get(type);
}

/** List all registered email provider type names. */
export function listEmailProviderTypes(): string[] {
  return Array.from(providers.keys());
}
