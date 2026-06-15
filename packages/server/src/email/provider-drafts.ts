// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { CrmyError, type UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as emailRepo from '../db/repos/emails.js';
import { createMailboxDraft } from './mailbox-delivery.js';

export interface ProviderDraftInput {
  email_id: UUID;
  to_email: string;
  subject: string;
  body_text: string;
}

export interface ProviderDraftResult {
  status: 'created' | 'unsupported_capability';
  provider_draft_id?: string;
  message?: string;
}

export async function createProviderDraft(
  db: DbPool,
  tenantId: UUID,
  input: ProviderDraftInput,
): Promise<ProviderDraftResult> {
  const email = await emailRepo.getEmail(db, tenantId, input.email_id);
  if (!email) {
    throw new CrmyError('NOT_FOUND', 'Email draft not found', 404);
  }
  if (email.sender_type !== 'actor_mailbox') {
    return {
      status: 'unsupported_capability',
      message: 'Provider drafts are available only for connected Gmail or Outlook mailbox senders. Save this as a CRMy draft instead.',
    };
  }
  return createMailboxDraft(db, tenantId, email);
}
