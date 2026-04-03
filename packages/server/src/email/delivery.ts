// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';
import { emitEvent } from '../events/emitter.js';
import * as emailRepo from '../db/repos/emails.js';
import { getEmailProvider } from './providers/index.js';

/**
 * Deliver an email through the tenant's configured provider.
 * Updates the email status throughout the lifecycle: sending → sent | failed.
 */
export async function deliverEmail(db: DbPool, tenantId: UUID, emailId: UUID): Promise<void> {
  const email = await emailRepo.getEmail(db, tenantId, emailId);
  if (!email) {
    console.error(`[email] deliverEmail: email not found: ${emailId}`);
    return;
  }

  // Load tenant's email provider config
  const providerConfig = await emailRepo.getProvider(db, tenantId);
  if (!providerConfig) {
    await emailRepo.updateEmailDelivery(db, tenantId, emailId, {
      status: 'failed',
      error: 'No email provider configured for this tenant',
    });
    emitEvent(db, {
      tenantId,
      eventType: 'email.failed',
      actorType: 'system',
      objectType: 'email',
      objectId: emailId,
      afterData: { id: emailId, error: 'No email provider configured' },
    }).catch(() => {});
    return;
  }

  const provider = getEmailProvider(providerConfig.provider);
  if (!provider) {
    await emailRepo.updateEmailDelivery(db, tenantId, emailId, {
      status: 'failed',
      error: `Unknown email provider: ${providerConfig.provider}`,
    });
    emitEvent(db, {
      tenantId,
      eventType: 'email.failed',
      actorType: 'system',
      objectType: 'email',
      objectId: emailId,
      afterData: { id: emailId, error: `Unknown provider: ${providerConfig.provider}` },
    }).catch(() => {});
    return;
  }

  // Mark as sending
  await emailRepo.updateEmailStatus(db, tenantId, emailId, 'sending');

  // Send via provider
  const result = await provider.send(providerConfig.config, {
    from_name: providerConfig.from_name,
    from_email: providerConfig.from_email,
    to_email: email.to_email,
    to_name: email.to_name,
    subject: email.subject,
    body_html: email.body_html,
    body_text: email.body_text,
  });

  if (result.success) {
    await emailRepo.updateEmailDelivery(db, tenantId, emailId, {
      status: 'sent',
      provider_msg_id: result.provider_msg_id,
    });
    emitEvent(db, {
      tenantId,
      eventType: 'email.sent',
      actorType: 'system',
      objectType: 'email',
      objectId: emailId,
      afterData: { id: emailId, to: email.to_email, subject: email.subject, status: 'sent' },
    }).catch(() => {});
  } else {
    await emailRepo.updateEmailDelivery(db, tenantId, emailId, {
      status: 'failed',
      error: result.error,
    });
    emitEvent(db, {
      tenantId,
      eventType: 'email.failed',
      actorType: 'system',
      objectType: 'email',
      objectId: emailId,
      afterData: { id: emailId, to: email.to_email, subject: email.subject, error: result.error },
    }).catch(() => {});
  }
}
