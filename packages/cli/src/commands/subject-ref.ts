// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { CliClient } from '../client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CliSubjectType = 'account' | 'contact' | 'opportunity' | 'use_case';

export function normalizeCliSubjectType(value: string): CliSubjectType {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (['account', 'company', 'companies', 'acct'].includes(normalized)) return 'account';
  if (['contact', 'person', 'stakeholder'].includes(normalized)) return 'contact';
  if (['opportunity', 'opp', 'deal'].includes(normalized)) return 'opportunity';
  if (['use_case', 'use-case', 'usecase', 'use'].includes(normalized)) return 'use_case';
  throw new Error(`Unsupported subject type "${value}". Use account, contact, opportunity, or use_case.`);
}

export function parseSubjectRef(ref?: string): { subject_type?: CliSubjectType; subject_id?: string; query?: string } {
  if (!ref) return {};
  const separator = ref.indexOf(':');
  if (separator === -1) {
    throw new Error(`Subject must be type:name or type:id, for example account:Northstar Labs.`);
  }
  const subject_type = normalizeCliSubjectType(ref.slice(0, separator));
  const value = ref.slice(separator + 1).trim();
  if (!value) throw new Error(`Subject reference is missing a name or ID.`);
  return UUID_RE.test(value) ? { subject_type, subject_id: value } : { subject_type, query: value };
}

function candidateName(candidate: Record<string, unknown>): string {
  return String(candidate.name ?? candidate.label ?? candidate.title ?? candidate.email ?? candidate.id ?? 'unknown');
}

function candidateId(candidate: Record<string, unknown>): string | undefined {
  return typeof candidate.id === 'string'
    ? candidate.id
    : typeof candidate.entity_id === 'string'
      ? candidate.entity_id
      : undefined;
}

function throwAmbiguous(type: CliSubjectType, query: string, candidates: Record<string, unknown>[]): never {
  const suggestions = candidates
    .slice(0, 5)
    .map(candidate => {
      const id = candidateId(candidate);
      return id ? `${candidateName(candidate)} (${id})` : candidateName(candidate);
    })
    .join('; ');
  throw new Error(`Ambiguous ${type.replace('_', ' ')} "${query}". Try a more specific name or use one of: ${suggestions}`);
}

async function resolveViaEntityResolve(client: CliClient, type: 'account' | 'contact', query: string): Promise<string> {
  const response = JSON.parse(await client.call('entity_resolve', {
    query,
    entity_type: type,
    limit: 5,
  }));
  const resolvedId = candidateId(response.resolved ?? {});
  if (response.status === 'resolved' && resolvedId) return resolvedId;
  const candidates = (response.candidates ?? []) as Record<string, unknown>[];
  if (candidates.length === 1) {
    const onlyId = candidateId(candidates[0]);
    if (onlyId) return onlyId;
  }
  if (candidates.length > 1) throwAmbiguous(type, query, candidates);
  throw new Error(`No ${type} matched "${query}". Try \`crmy search "${query}"\` or create the record first.`);
}

async function resolveViaCustomerRecordResolve(client: CliClient, type: CliSubjectType, query: string): Promise<string> {
  const response = JSON.parse(await client.call('customer_record_resolve', {
    query,
    subject_type: type,
    limit: 5,
  }));
  const subjects = ((response.subjects ?? []) as Record<string, unknown>[])
    .filter(subject => subject.type === type && typeof subject.id === 'string');
  if (subjects.length === 1) return subjects[0].id as string;
  if (subjects.length > 1) throwAmbiguous(type, query, subjects);
  const skipped = ((response.skipped ?? []) as Record<string, unknown>[])
    .filter(item => item.candidate_records);
  const candidates = skipped.flatMap(item => (item.candidate_records ?? []) as Record<string, unknown>[])
    .filter(candidate => candidate.type === type && typeof candidate.id === 'string');
  if (candidates.length > 1) throwAmbiguous(type, query, candidates);
  const proposalCount = Array.isArray(response.proposed_records) ? response.proposed_records.length : 0;
  const proposalHint = proposalCount > 0 ? ` CRMy found ${proposalCount} possible new ${type.replace('_', ' ')} record(s) that need review.` : '';
  throw new Error(`No ${type.replace('_', ' ')} matched "${query}".${proposalHint} Try \`crmy search "${query}"\` or create the record first.`);
}

function canFallbackToEntityResolve(type: CliSubjectType, err: unknown): type is 'account' | 'contact' {
  if (type !== 'account' && type !== 'contact') return false;
  const message = err instanceof Error ? err.message : String(err);
  return /context:read|customer_record_resolve|Unknown tool|API error \(403\)/i.test(message);
}

export async function resolveSubjectRef(client: CliClient, ref?: string): Promise<{ subject_type?: CliSubjectType; subject_id?: string }> {
  const parsed = parseSubjectRef(ref);
  if (!parsed.subject_type || parsed.subject_id) return { subject_type: parsed.subject_type, subject_id: parsed.subject_id };
  if (!parsed.query) return { subject_type: parsed.subject_type };
  let id: string;
  try {
    id = await resolveViaCustomerRecordResolve(client, parsed.subject_type, parsed.query);
  } catch (err) {
    if (!canFallbackToEntityResolve(parsed.subject_type, err)) throw err;
    id = await resolveViaEntityResolve(client, parsed.subject_type, parsed.query);
  }
  return { subject_type: parsed.subject_type, subject_id: id };
}

export async function resolveRecordRef(client: CliClient, type: CliSubjectType, ref: string): Promise<string> {
  if (UUID_RE.test(ref)) return ref;
  const resolved = await resolveSubjectRef(client, `${type}:${ref}`);
  if (!resolved.subject_id) throw new Error(`Could not resolve ${type.replace('_', ' ')} "${ref}".`);
  return resolved.subject_id;
}
