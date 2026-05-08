// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { api, ApiError } from '@/api/client';

export type ReferenceType = 'account' | 'contact' | 'opportunity' | 'use_case' | 'actor';

const referenceConfig: Record<ReferenceType, { label: string; path: string }> = {
  account: { label: 'account', path: 'accounts' },
  contact: { label: 'contact', path: 'contacts' },
  opportunity: { label: 'opportunity', path: 'opportunities' },
  use_case: { label: 'use case', path: 'use-cases' },
  actor: { label: 'actor', path: 'actors' },
};

export function referenceLabel(type: ReferenceType): string {
  return referenceConfig[type].label;
}

export async function assertReferenceExists(type: ReferenceType, id?: string, fieldLabel?: string) {
  if (!id) return;
  const config = referenceConfig[type];
  try {
    await api.get(`${config.path}/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(`The selected ${fieldLabel ?? config.label} no longer exists. Clear it or choose another record.`);
    }
    throw err;
  }
}

export async function assertSubjectReference(subjectType?: string, subjectId?: string) {
  if (!subjectType && !subjectId) return;
  if (!subjectType || !subjectId) {
    throw new Error('Choose both a linked record type and a record, or leave the link empty.');
  }
  if (!(subjectType in referenceConfig) || subjectType === 'actor') {
    throw new Error('Choose a supported linked record type.');
  }
  await assertReferenceExists(subjectType as ReferenceType, subjectId, referenceLabel(subjectType as ReferenceType));
}

export function normalizeSubjectLink(payload: Record<string, unknown>) {
  const subjectType = typeof payload.subject_type === 'string' ? payload.subject_type.trim() : '';
  const subjectId = typeof payload.subject_id === 'string' ? payload.subject_id.trim() : '';
  if (!subjectType || !subjectId) {
    delete payload.subject_type;
    delete payload.subject_id;
    return;
  }
  payload.subject_type = subjectType;
  payload.subject_id = subjectId;
}

export function trimStringPayload(payload: Record<string, unknown>) {
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) payload[key] = trimmed;
    else delete payload[key];
  }
}
