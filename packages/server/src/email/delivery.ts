// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';
import { emitEvent } from '../events/emitter.js';
import * as emailRepo from '../db/repos/emails.js';
import * as emailMessageRepo from '../db/repos/email-messages.js';
import { getEmailProvider } from './providers/index.js';
import { sendWithMailbox } from './mailbox-delivery.js';

/**
 * Deliver an email through the tenant's configured provider.
 * Updates the email status throughout the lifecycle: sending → sent | failed.
 */
export async function deliverEmail(db: DbPool, tenantId: UUID, emailId: UUID): Promise<{ status: 'sent' | 'failed' | 'skipped'; retryable?: boolean; error?: string }> {
  const email = await emailRepo.getEmail(db, tenantId, emailId);
  if (!email) {
    console.error(`[email] deliverEmail: email not found: ${emailId}`);
    return { status: 'skipped', retryable: false, error: 'Email not found' };
  }

  const useMailboxSender = email.sender_type === 'actor_mailbox' && Boolean(email.mailbox_connection_id);
  const providerConfig = useMailboxSender ? null : await emailRepo.getProvider(db, tenantId);
  if (!useMailboxSender && !providerConfig) {
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
    return { status: 'failed', retryable: false, error: 'No email provider configured for this tenant' };
  }

  const provider = providerConfig ? getEmailProvider(providerConfig.provider) : undefined;
  if (!useMailboxSender && (!provider || !providerConfig)) {
    await emailRepo.updateEmailDelivery(db, tenantId, emailId, {
      status: 'failed',
      error: `Unknown email provider: ${providerConfig?.provider ?? 'none'}`,
    });
    emitEvent(db, {
      tenantId,
      eventType: 'email.failed',
      actorType: 'system',
      objectType: 'email',
      objectId: emailId,
      afterData: { id: emailId, error: `Unknown provider: ${providerConfig?.provider ?? 'none'}` },
    }).catch(() => {});
    return { status: 'failed', retryable: false, error: `Unknown email provider: ${providerConfig?.provider ?? 'none'}` };
  }

  const attemptStartedAt = new Date().toISOString();
  const deliveryAttempt = {
    status: 'provider_call_started',
    started_at: attemptStartedAt,
    provider: useMailboxSender ? 'actor_mailbox' : providerConfig!.provider,
    sender_type: email.sender_type,
    mailbox_connection_id: email.mailbox_connection_id,
    from_email: email.from_email,
    email_id: emailId,
    idempotency_key: `email:${tenantId}:${emailId}`,
    reconciliation_supported: useMailboxSender ? false : provider!.supportsIdempotentSend === true,
    replay_policy: !useMailboxSender && provider!.supportsIdempotentSend === true
      ? 'provider_idempotency_key'
      : 'manual_reconciliation_required',
  };

  // Atomically claim the send and persist the provider-call receipt before the external side effect.
  const claimedEmail = await emailRepo.claimEmailForDelivery(db, tenantId, emailId, deliveryAttempt);
  if (!claimedEmail) return { status: 'skipped', retryable: false, error: 'Email is not ready for delivery or is already being delivered' };

  let result: { success: boolean; provider_msg_id?: string; message_id?: string; thread_id?: string; error?: string; retryable?: boolean };
  try {
    // Tenant fallback continues through provider.send after claimEmailForDelivery persists the attempt receipt.
    result = useMailboxSender
      ? await sendWithMailbox(db, tenantId, claimedEmail)
      : await provider!.send(providerConfig!.config, {
      from_name: providerConfig!.from_name,
      from_email: providerConfig!.from_email,
      to_email: claimedEmail.to_email,
      to_name: claimedEmail.to_name,
      subject: claimedEmail.subject,
      body_html: claimedEmail.body_html,
      body_text: claimedEmail.body_text,
      idempotency_key: deliveryAttempt.idempotency_key,
    });
  } catch (err) {
    result = {
      success: false,
      error: err instanceof Error ? err.message : 'Email provider threw during send',
    };
  }

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
	        message_id: result.message_id,
	        thread_id: result.thread_id,
	      },
	    });
	    const deliveredMessage = await emailMessageRepo.markOutboundEmailMessageDelivered(db, tenantId, emailId, {
	      provider_message_id: result.provider_msg_id,
	      message_id: result.message_id,
	      thread_id: result.thread_id,
	      metadata: {
	        delivery_status: 'sent',
	        provider_msg_id: result.provider_msg_id,
	        message_id: result.message_id,
	        thread_id: result.thread_id,
	      },
	    });
	    if (deliveredMessage) {
	      await emailRepo.mergeEmailGenerationMetadata(db, tenantId, emailId, {
	        outbound_context_processing: {
	          email_message_id: deliveredMessage.id,
	          processing_status: 'pending',
	          processing_reason: 'Sent email recorded. CRMy-authored context processing will run in the background.',
	          queued_at: new Date().toISOString(),
	        },
	      }).catch(() => {});
	    }
    emitEvent(db, {
      tenantId,
      eventType: 'email.sent',
      actorType: 'system',
      objectType: 'email',
      objectId: emailId,
      afterData: { id: emailId, to: claimedEmail.to_email, subject: claimedEmail.subject, status: 'sent' },
    }).catch(() => {});
    return { status: 'sent', retryable: false };
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
	        retryable: result.retryable === true,
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
    return { status: 'failed', retryable: result.retryable === true, error: result.error };
  }
}

export async function processEmailDeliveryJobs(db: DbPool, limit = 5): Promise<{ processed: number; failed: number; recovered: number }> {
  const recovered = await emailRepo.recoverStaleEmailDeliveryState(db);
  const jobs = await emailRepo.claimEmailDeliveryJobs(db, limit);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const result = await deliverEmail(db, job.tenant_id, job.email_id);
      if (result.status === 'sent' || result.status === 'skipped') {
        await emailRepo.completeEmailDeliveryJob(db, job.id);
        processed++;
      } else {
        await emailRepo.failEmailDeliveryJob(db, job.id, result.error ?? 'Email delivery failed', result.retryable !== false);
        failed++;
      }
    } catch (err) {
      await emailRepo.failEmailDeliveryJob(
        db,
        job.id,
        err instanceof Error ? err.message : 'Email delivery worker failed',
        true,
      );
      failed++;
    }
  }
  return { processed, failed, recovered };
}
