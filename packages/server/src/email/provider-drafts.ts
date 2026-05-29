// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { CrmyError, type UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';

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
  _db: DbPool,
  _tenantId: UUID,
  _input: ProviderDraftInput,
): Promise<ProviderDraftResult> {
  throw new CrmyError(
    'VALIDATION_ERROR',
    'Provider draft folders are not enabled yet. Save this as a CRMy draft or send it for approval.',
    412,
    { code: 'unsupported_capability' },
  );
}
