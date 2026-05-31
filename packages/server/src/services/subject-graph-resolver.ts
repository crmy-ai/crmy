// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import { resolveOwnerFilter } from './access-control.js';
import {
  detectRawContextSubjects,
  type RawContextSubjectDetection,
} from './raw-context-subjects.js';

export type CustomerSubjectType = 'account' | 'contact' | 'opportunity' | 'use_case' | 'any';

export interface SubjectGraphResolveInput {
  query?: string;
  text?: string;
  subject_type?: CustomerSubjectType;
  account_hint?: string;
  confidence_threshold?: number;
  limit?: number;
}

export interface SubjectGraphResolveOptions {
  actorId?: string;
  ownerIds?: string[] | null;
}

export type SubjectGraphResolution = RawContextSubjectDetection & {
  resolver: 'subject_graph';
  query: string;
  subject_type: CustomerSubjectType;
};

function subjectTypeHint(type: CustomerSubjectType | undefined): string {
  if (!type || type === 'any') return '';
  const label = type === 'use_case' ? 'use case' : type;
  return `\nResolve this primarily as a ${label} reference.`;
}

function accountHintText(accountHint: string | undefined): string {
  return accountHint?.trim()
    ? `\nAccount/customer hint: ${accountHint.trim()}`
    : '';
}

function normalizeSubjectType(value: unknown): CustomerSubjectType {
  if (value === 'account' || value === 'contact' || value === 'opportunity' || value === 'use_case') return value;
  if (value === 'use-case' || value === 'useCase') return 'use_case';
  return 'any';
}

export async function resolveSubjectGraph(
  db: DbPool,
  actor: ActorContext,
  input: SubjectGraphResolveInput,
): Promise<SubjectGraphResolution> {
  const ownerFilter = await resolveOwnerFilter(db, actor);
  return resolveSubjectGraphForSource(db, actor.tenant_id, input, {
    actorId: actor.actor_id,
    ownerIds: 'owner_ids' in ownerFilter ? ownerFilter.owner_ids : undefined,
  });
}

export async function resolveSubjectGraphForSource(
  db: DbPool,
  tenantId: string,
  input: SubjectGraphResolveInput,
  options: SubjectGraphResolveOptions = {},
): Promise<SubjectGraphResolution> {
  const query = (input.text ?? input.query ?? '').trim();
  const subjectType = normalizeSubjectType(input.subject_type);
  if (!query) {
    return {
      resolver: 'subject_graph',
      query: '',
      subject_type: subjectType,
      candidates: [],
      subjects: [],
      skipped: [],
      resolution_summary: 'Add a customer name, email, domain, opportunity, use case, or source text to resolve records.',
    };
  }

  const resolutionText = `${query}${accountHintText(input.account_hint)}${subjectTypeHint(subjectType)}`;
  const detection = await detectRawContextSubjects(db, tenantId, resolutionText, {
    limit: input.limit ?? 15,
    confidenceThreshold: input.confidence_threshold ?? 0.67,
    actorId: options.actorId,
    ownerIds: options.ownerIds ?? undefined,
  });

  if (subjectType === 'any') {
    return {
      resolver: 'subject_graph',
      query,
      subject_type: subjectType,
      ...detection,
    };
  }

  const filteredSubjects = detection.subjects.filter(subject => subject.type === subjectType || subject.type === 'account');
  const filteredProposals = detection.proposed_records?.filter(proposal => proposal.record_type === subjectType);
  return {
    resolver: 'subject_graph',
    query,
    subject_type: subjectType,
    ...detection,
    subjects: filteredSubjects,
    ...(filteredProposals?.length ? { proposed_records: filteredProposals } : { proposed_records: undefined }),
  };
}
