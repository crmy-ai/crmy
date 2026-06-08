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

  const attemptStartedAt = new Date().toISOString();
  const deliveryAttempt = {
    status: 'provider_call_started',
    started_at: attemptStartedAt,
    provider: providerConfig.provider,
    email_id: emailId,
    idempotency_key: `email:${tenantId}:${emailId}`,
    reconciliation_supported: provider.supportsIdempotentSend === true,
    replay_policy: provider.supportsIdempotentSend === true
      ? 'provider_idempotency_key'
      : 'manual_reconciliation_required',
  };

  // Atomically claim the send and persist the provider-call receipt before the external side effect.
  const claimedEmail = await emailRepo.claimEmailForDelivery(db, tenantId, emailId, deliveryAttempt);
  if (!claimedEmail) return;

  // Send via provider
  const result = await provider.send(providerConfig.config, {
    from_name: providerConfig.from_name,
    from_email: providerConfig.from_email,
    to_email: claimedEmail.to_email,
    to_name: claimedEmail.to_name,
    subject: claimedEmail.subject,
    body_html: claimedEmail.body_html,
    body_text: claimedEmail.body_text,
    idempotency_key: deliveryAttempt.idempotency_key,
  });

  if (result.success) {
    await emailRepo.updateEmailDelivery(db, tenantId, emailId, {
      status: 'sent',
      provider_msg_id: result.provider_msg_id,
    });
    await emailRepo.mergeEmailGenerationMetadata(db, tenantId, emailId, {
      delivery_attempt: {
        ...deliveryAttempt,
        status: 'completed',
        completed_at: new Date().toISOString(),
        provider_msg_id: result.provider_msg_id,
      },
    });
    emitEvent(db, {
      tenantId,
      eventType: 'email.sent',
      actorType: 'system',
      objectType: 'email',
      objectId: emailId,
      afterData: { id: emailId, to: claimedEmail.to_email, subject: claimedEmail.subject, status: 'sent' },
    }).catch(() => {});
  } else {
    await emailRepo.updateEmailDelivery(db, tenantId, emailId, {
      status: 'failed',
      error: result.error,
    });
    await emailRepo.mergeEmailGenerationMetadata(db, tenantId, emailId, {
      delivery_attempt: {
        ...deliveryAttempt,
        status: 'failed',
        failed_at: new Date().toISOString(),
        error: result.error,
      },
    });
    emitEvent(db, {
      tenantId,
      eventType: 'email.failed',
      actorType: 'system',
      objectType: 'email',
      objectId: emailId,
      afterData: { id: emailId, to: claimedEmail.to_email, subject: claimedEmail.subject, error: result.error },
    }).catch(() => {});
  }
}
