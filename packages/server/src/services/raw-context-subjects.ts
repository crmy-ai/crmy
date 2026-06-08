// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import { entityResolve } from './entity-resolve.js';
import { callLLM, requireTenantLLMConfig } from '../agent/providers/llm.js';
import { CrmyError } from '@crmy/shared';

export interface RawContextResolvedSubject {
  type: string;
  id: string;
  name: string;
  confidence: string;
  match_tier: string;
  account_id?: string;
  account_name?: string;
  scope_reason?: string;
  parent_subject?: { type: string; id: string; name: string };
}

export interface RawContextSkippedCandidate {
  name: string;
  reason: string;
  candidate_count?: number;
  candidate_records?: Array<{
    type: string;
    id: string;
    name: string;
    account_id?: string;
    account_name?: string;
  }>;
  recommended_action?: string;
}

export interface RawContextSubjectDetection {
  candidates: string[];
  subjects: RawContextResolvedSubject[];
  skipped: RawContextSkippedCandidate[];
  proposed_records?: RawContextRecordProposal[];
  account_scope?: RawContextAccountScope[];
  records_examined?: {
    accounts: number;
    contacts: number;
    opportunities: number;
    use_cases: number;
  };
  resolution_summary?: string;
}

export interface RawContextRecordProposal {
  record_type: 'contact' | 'account' | 'opportunity' | 'use_case';
  name: string;
  confidence: number;
  reason: string;
  fields: Record<string, unknown>;
  duplicate_candidates?: Array<{
    record_type: string;
    id: string;
    name: string;
    confidence?: string;
    reason?: string;
  }>;
}

const CONFIDENCE_RANK: Record<string, number> = { high: 1, medium: 0.67, low: 0.33 };
const RAW_CONTEXT_SUBJECT_MATCH_TIMEOUT_MS = Number(process.env.RAW_CONTEXT_SUBJECT_MATCH_TIMEOUT_MS ?? 15_000);

interface ModelSubjectCandidate {
  name: string;
  entity_type?: 'contact' | 'account' | 'opportunity' | 'use_case' | 'unknown';
  record_id?: string;
  email?: string;
  company_name?: string;
  account_name?: string;
  domain?: string;
  title?: string;
  stage?: string;
  description?: string;
  confidence?: number;
  rationale?: string;
}

interface DirectoryContact {
  id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  title?: string | null;
  company_name?: string | null;
  account_id?: string | null;
  account_domain?: string | null;
  aliases?: string[];
  account_aliases?: string[];
}

interface DirectoryAccount {
  id: string;
  name: string;
  domain?: string | null;
  industry?: string | null;
  aliases?: string[];
}

interface DirectoryOpportunity {
  id: string;
  name: string;
  account_id?: string | null;
  account_name?: string | null;
  contact_id?: string | null;
  contact_name?: string | null;
  stage?: string | null;
  close_date?: string | null;
}

interface DirectoryUseCase {
  id: string;
  name: string;
  account_id?: string | null;
  account_name?: string | null;
  opportunity_id?: string | null;
  opportunity_name?: string | null;
  stage?: string | null;
  status?: string | null;
}

export interface RawContextAccountScope {
  account_id: string;
  account_name: string;
  contacts_checked: number;
  opportunities_checked: number;
  use_cases_checked: number;
}

interface SubjectResolutionDirectory {
  contacts: DirectoryContact[];
  accounts: DirectoryAccount[];
  opportunities: DirectoryOpportunity[];
  use_cases: DirectoryUseCase[];
}

function cleanString(value: unknown, max = 160): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function normalizeCandidate(raw: unknown): ModelSubjectCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const name = cleanString(obj.name);
  const email = cleanString(obj.email);
  const domain = cleanString(obj.domain);
  const recordId = cleanString(obj.record_id);
  if (!name && !email && !domain && !recordId) return null;
  const entityType = obj.entity_type === 'contact' || obj.entity_type === 'account' || obj.entity_type === 'opportunity' || obj.entity_type === 'use_case'
    ? obj.entity_type
    : 'unknown';
  const confidence = typeof obj.confidence === 'number'
    ? Math.max(0, Math.min(1, obj.confidence))
    : undefined;
  return {
    name: name ?? email ?? domain ?? recordId ?? '',
    entity_type: entityType,
    record_id: recordId,
    email,
    company_name: cleanString(obj.company_name),
    account_name: cleanString(obj.account_name),
    domain,
    title: cleanString(obj.title),
    stage: cleanString(obj.stage),
    description: cleanString(obj.description, 1000),
    confidence,
    rationale: cleanString(obj.rationale, 500),
  };
}

function parseCandidateResponse(raw: string, limit: number): ModelSubjectCandidate[] {
  const cleaned = raw
    .replace(/^\uFEFF/, '')
    .replace(/^```(?:json|JSON)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();
  let parsed: unknown;
  const parseJson = (value: string) => JSON.parse(value.replace(/,\s*([}\]])/g, '$1'));
  try {
    parsed = parseJson(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Subject detection response was not valid JSON.');
    parsed = parseJson(match[0]);
  }
  const candidates = (parsed as Record<string, unknown>)?.candidates;
  if (!Array.isArray(candidates)) {
    throw new Error('Subject detection response must include a candidates array.');
  }
  const deduped = new Map<string, ModelSubjectCandidate>();
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) continue;
    const key = [
      normalized.entity_type ?? 'unknown',
      normalized.record_id ?? '',
      normalized.email?.toLowerCase() ?? '',
      normalized.domain?.toLowerCase() ?? '',
      normalized.name.toLowerCase(),
      normalized.company_name?.toLowerCase() ?? '',
    ].join('|');
    if (!deduped.has(key)) deduped.set(key, normalized);
  }
  return [...deduped.values()].slice(0, limit);
}

async function loadSubjectResolutionDirectory(
  db: DbPool,
  tenantId: string,
  limit: number,
  ownerIds?: string[],
): Promise<SubjectResolutionDirectory> {
  const perType = Math.min(Math.max(limit, 25), 120);
  const contactOwnerFilter = ownerIds ? 'AND c.owner_id = ANY($3::uuid[])' : '';
  const accountOwnerFilter = ownerIds ? 'AND owner_id = ANY($3::uuid[])' : '';
  const opportunityOwnerFilter = ownerIds ? 'AND o.owner_id = ANY($3::uuid[])' : '';
  const useCaseOwnerFilter = ownerIds ? 'AND uc.owner_id = ANY($3::uuid[])' : '';
  const params = ownerIds ? [tenantId, perType, ownerIds] : [tenantId, perType];
  const [contacts, accounts, opportunities, useCases] = await Promise.all([
    db.query(
      `SELECT c.id, c.first_name || ' ' || c.last_name AS name, c.first_name, c.last_name,
              c.email, c.title, COALESCE(a.name, c.company_name) AS company_name,
              c.account_id, a.domain AS account_domain, c.aliases, a.aliases AS account_aliases
       FROM contacts c
       LEFT JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
	       WHERE c.tenant_id = $1
	         AND c.merged_into IS NULL
	         AND c.archived_at IS NULL
	         ${contactOwnerFilter}
       ORDER BY c.updated_at DESC
       LIMIT $2`,
      params,
    ),
    db.query(
      `SELECT id, name, domain, industry, aliases
       FROM accounts
	       WHERE tenant_id = $1
	         AND merged_into IS NULL
	         AND archived_at IS NULL
	         ${accountOwnerFilter}
       ORDER BY updated_at DESC
      LIMIT $2`,
      params,
    ),
    db.query(
      `SELECT o.id, o.name, o.account_id, a.name AS account_name, o.contact_id,
              NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') AS contact_name,
              o.stage, o.close_date
       FROM opportunities o
       LEFT JOIN accounts a ON a.id = o.account_id AND a.tenant_id = o.tenant_id
       LEFT JOIN contacts c ON c.id = o.contact_id AND c.tenant_id = o.tenant_id
	       WHERE o.tenant_id = $1
	         AND o.archived_at IS NULL
	         ${opportunityOwnerFilter}
       ORDER BY o.updated_at DESC
       LIMIT $2`,
      params,
    ),
    db.query(
      `SELECT uc.id, uc.name, uc.account_id, a.name AS account_name, uc.opportunity_id,
              o.name AS opportunity_name, uc.stage
       FROM use_cases uc
       LEFT JOIN accounts a ON a.id = uc.account_id AND a.tenant_id = uc.tenant_id
       LEFT JOIN opportunities o ON o.id = uc.opportunity_id AND o.tenant_id = uc.tenant_id
	       WHERE uc.tenant_id = $1
	         AND uc.archived_at IS NULL
	         ${useCaseOwnerFilter}
       ORDER BY uc.updated_at DESC
       LIMIT $2`,
      params,
    ),
  ]);
  return {
    contacts: contacts.rows.map(row => ({
      id: row.id,
      name: row.name,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      title: row.title,
      company_name: row.company_name,
      account_id: row.account_id,
      account_domain: row.account_domain,
      aliases: row.aliases ?? [],
      account_aliases: row.account_aliases ?? [],
    })),
    accounts: accounts.rows.map(row => ({
      id: row.id,
      name: row.name,
      domain: row.domain,
      industry: row.industry,
      aliases: row.aliases ?? [],
    })),
    opportunities: opportunities.rows.map(row => ({
      id: row.id,
      name: row.name,
      account_id: row.account_id,
      account_name: row.account_name,
      contact_id: row.contact_id,
      contact_name: row.contact_name,
      stage: row.stage,
      close_date: row.close_date,
    })),
    use_cases: useCases.rows.map(row => ({
      id: row.id,
      name: row.name,
      account_id: row.account_id,
      account_name: row.account_name,
      opportunity_id: row.opportunity_id,
      opportunity_name: row.opportunity_name,
      stage: row.stage,
      status: row.stage,
    })),
  };
}

const COMPANY_SUFFIXES = new Set([
  'corp', 'corporation', 'inc', 'incorporated', 'llc', 'ltd', 'limited',
  'co', 'company', 'plc', 'gmbh', 'sa', 'ag',
]);

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bcorp\.\b/g, ' corporation ')
    .replace(/\bcorp\b/g, ' corporation ')
    .replace(/\bco\.\b/g, ' company ')
    .replace(/\binc\.\b/g, ' incorporated ')
    .replace(/[^a-z0-9@.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCompanySuffix(value: string): string {
  const parts = normalizeForMatch(value).split(' ').filter(Boolean);
  while (parts.length > 1 && COMPANY_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(' ');
}

function domainRoot(domain: string): string {
  return normalizeForMatch(domain)
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('.')[0] ?? '';
}

function matchVariants(...values: Array<string | null | undefined>): string[] {
  const variants = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const normalized = normalizeForMatch(value);
    if (normalized.length >= 3) variants.add(normalized);
    const stripped = stripCompanySuffix(value);
    if (stripped.length >= 3) variants.add(stripped);
    if (value.includes('.')) {
      const root = domainRoot(value);
      if (root.length >= 3) variants.add(root);
    }
  }
  return [...variants];
}

function containsPhrase(normalizedText: string, phrase: string): boolean {
  if (phrase.length < 3) return false;
  const padded = ` ${normalizedText} `;
  if (padded.includes(` ${phrase} `)) return true;
  return ` ${normalizedText.replace(/[.]+/g, ' ')} `.includes(` ${phrase.replace(/[.]+/g, ' ')} `);
}

function resolutionRecordsExamined(directory: SubjectResolutionDirectory): NonNullable<RawContextSubjectDetection['records_examined']> {
  return {
    accounts: directory.accounts.length,
    contacts: directory.contacts.length,
    opportunities: directory.opportunities.length,
    use_cases: directory.use_cases.length,
  };
}

function buildAccountScope(
  directory: SubjectResolutionDirectory,
  accountIds: Set<string>,
): RawContextAccountScope[] {
  return [...accountIds].map(accountId => {
    const account = directory.accounts.find(item => item.id === accountId);
    return {
      account_id: accountId,
      account_name: account?.name ?? accountId,
      contacts_checked: directory.contacts.filter(item => item.account_id === accountId).length,
      opportunities_checked: directory.opportunities.filter(item => item.account_id === accountId).length,
      use_cases_checked: directory.use_cases.filter(item => item.account_id === accountId).length,
    };
  });
}

function summarizeResolution(
  subjects: RawContextResolvedSubject[],
  accountScope: RawContextAccountScope[] = [],
  proposals: RawContextRecordProposal[] = [],
): string | undefined {
  if (accountScope.length > 0) {
    const names = accountScope.map(scope => scope.account_name).slice(0, 3).join(', ');
    const contacts = accountScope.reduce((sum, scope) => sum + scope.contacts_checked, 0);
    const opportunities = accountScope.reduce((sum, scope) => sum + scope.opportunities_checked, 0);
    const useCases = accountScope.reduce((sum, scope) => sum + scope.use_cases_checked, 0);
    const created = subjects.filter(subject => subject.type !== 'account').length;
    const proposalText = proposals.length > 0 ? ` ${proposals.length} possible new ${proposals.length === 1 ? 'record needs' : 'records need'} review.` : '';
    return `Matched ${names}. Checked ${contacts} contacts, ${opportunities} opportunities, and ${useCases} use cases.${created > 0 ? ` Matched ${created} related ${created === 1 ? 'record' : 'records'}.` : ''}${proposalText}`;
  }
  if (subjects.length > 0) return `Matched ${subjects.length} customer ${subjects.length === 1 ? 'record' : 'records'}.`;
  if (proposals.length > 0) return `${proposals.length} possible new ${proposals.length === 1 ? 'record needs' : 'records need'} review.`;
  return undefined;
}

function deterministicSubjectMatches(
  text: string,
  directory: SubjectResolutionDirectory,
  limit: number,
): RawContextSubjectDetection {
  const normalizedText = normalizeForMatch(text);
  const subjects: RawContextResolvedSubject[] = [];
  const candidates = new Set<string>();
  const seen = new Set<string>();
  const skipped: RawContextSkippedCandidate[] = [];
  const skippedKeys = new Set<string>();
  const mentionedAccountIds = new Set<string>();
  const mentionedCompanyVariants = new Set<string>();
  const pushSubject = (subject: RawContextResolvedSubject) => {
    const key = `${subject.type}:${subject.id}`;
    if (seen.has(key) || subjects.length >= limit) return;
    seen.add(key);
    subjects.push(subject);
  };
  const pushSkipped = (name: string, reason: string, details: Partial<RawContextSkippedCandidate> = {}) => {
    const key = `${reason}:${normalizeForMatch(name)}`;
    if (skippedKeys.has(key)) return;
    skippedKeys.add(key);
    skipped.push({ name, reason, ...details });
  };

  for (const account of directory.accounts) {
    const variants = matchVariants(account.name, account.domain, ...(account.aliases ?? []));
    if (variants.some(variant => containsPhrase(normalizedText, variant))) {
      candidates.add(account.name);
      mentionedAccountIds.add(account.id);
      variants.forEach(variant => mentionedCompanyVariants.add(variant));
      pushSubject({
        type: 'account',
        id: account.id,
        name: account.name,
        confidence: 'high',
        match_tier: 'deterministic_account_mention',
        scope_reason: 'Account mention created the customer scope.',
      });
    }
  }

  const firstNameCounts = new Map<string, number>();
  const fullNameCounts = new Map<string, number>();
  for (const contact of directory.contacts) {
    const first = normalizeForMatch(contact.first_name ?? contact.name.split(/\s+/)[0] ?? '');
    if (first) firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1);
    const full = normalizeForMatch(contact.name);
    if (full) fullNameCounts.set(full, (fullNameCounts.get(full) ?? 0) + 1);
  }

  for (const contact of directory.contacts) {
    const fullName = normalizeForMatch(contact.name);
    const firstName = normalizeForMatch(contact.first_name ?? contact.name.split(/\s+/)[0] ?? '');
    const email = normalizeForMatch(contact.email ?? '');
    const aliasMatch = (contact.aliases ?? []).some(alias => containsPhrase(normalizedText, normalizeForMatch(alias)));
    const companyVariants = matchVariants(contact.company_name, contact.account_domain, ...(contact.account_aliases ?? []));
    const fullNameMatch = containsPhrase(normalizedText, fullName) || aliasMatch;
    const emailMatch = email.includes('@') && normalizedText.includes(email);
    const fullMatch = fullNameMatch || emailMatch;
    const companyMatch = (contact.account_id && mentionedAccountIds.has(contact.account_id))
      || companyVariants.some(variant => mentionedCompanyVariants.has(variant) || containsPhrase(normalizedText, variant));
    const scopedFirstNameCount = contact.account_id
      ? directory.contacts.filter(item => item.account_id === contact.account_id && normalizeForMatch(item.first_name ?? item.name.split(/\s+/)[0] ?? '') === firstName).length
      : firstNameCounts.get(firstName) ?? 0;
    const scopedFullNameCount = contact.account_id
      ? directory.contacts.filter(item => item.account_id === contact.account_id && normalizeForMatch(item.name) === fullName).length
      : fullNameCounts.get(fullName) ?? 0;
    const uniqueFirstName = firstName.length >= 3 && (companyMatch ? scopedFirstNameCount === 1 : firstNameCounts.get(firstName) === 1);
    const firstNameWithCompany = uniqueFirstName && containsPhrase(normalizedText, firstName) && companyMatch;
    const ambiguousFirstNameWithoutScope = firstName.length >= 3
      && containsPhrase(normalizedText, firstName)
      && !companyMatch
      && (firstNameCounts.get(firstName) ?? 0) > 1;
    const ambiguousFullNameWithoutScope = fullNameMatch
      && !emailMatch
      && !companyMatch
      && (fullNameCounts.get(fullName) ?? 0) > 1;
    const ambiguousFullNameWithinScope = fullNameMatch
      && !emailMatch
      && companyMatch
      && scopedFullNameCount > 1;

    if (!fullMatch && !firstNameWithCompany) {
      if (ambiguousFirstNameWithoutScope) {
        candidates.add(contact.first_name ?? contact.name);
        pushSkipped(contact.first_name ?? contact.name, 'ambiguous_first_name_without_account_scope', {
          candidate_count: firstNameCounts.get(firstName) ?? undefined,
          recommended_action: 'Add an account, email, or full name so CRMy can link the right contact.',
        });
      }
      continue;
    }
    candidates.add(contact.name);
    if (ambiguousFullNameWithinScope) {
      pushSkipped(contact.name, 'ambiguous_within_account_scope', {
        candidate_count: scopedFullNameCount,
        recommended_action: 'Review duplicate contacts inside this account before linking context.',
      });
      continue;
    }
    if (ambiguousFullNameWithoutScope) {
      pushSkipped(contact.name, 'ambiguous_without_account_scope', {
        candidate_count: fullNameCounts.get(fullName) ?? undefined,
        recommended_action: 'Add an account or email so CRMy can link the right contact.',
      });
      continue;
    }
    pushSubject({
      type: 'contact',
      id: contact.id,
      name: contact.name,
      confidence: fullMatch ? 'high' : 'medium',
      match_tier: fullMatch ? 'deterministic_contact_mention' : 'deterministic_contact_company_hint',
      account_id: contact.account_id ?? undefined,
      account_name: contact.company_name ?? undefined,
      scope_reason: contact.account_id && mentionedAccountIds.has(contact.account_id)
        ? 'Contact matched inside the account scope.'
        : undefined,
      parent_subject: contact.account_id && contact.company_name
        ? { type: 'account', id: contact.account_id, name: contact.company_name }
        : undefined,
    });
  }

  const matchingOpportunities = directory.opportunities.filter(opportunity =>
    matchVariants(opportunity.name).some(variant => containsPhrase(normalizedText, variant)));
  const matchingOpportunityCounts = matchingOpportunities.reduce((map, opportunity) => {
    const key = `${opportunity.account_id ?? 'global'}:${normalizeForMatch(opportunity.name)}`;
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  const ambiguousOpportunityNames = matchingOpportunities
    .filter(opportunity => !mentionedAccountIds.size || !opportunity.account_id || !mentionedAccountIds.has(opportunity.account_id))
    .reduce((map, opportunity) => {
      const key = normalizeForMatch(opportunity.name);
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>());

  for (const opportunity of matchingOpportunities) {
    const variants = matchVariants(opportunity.name);
    const accountScoped = Boolean(opportunity.account_id && mentionedAccountIds.has(opportunity.account_id));
    const nameMatch = variants.some(variant => containsPhrase(normalizedText, variant));
    if (mentionedAccountIds.size > 0 && !accountScoped) continue;
    if (!nameMatch) continue;
    candidates.add(opportunity.name);
    if (accountScoped && (matchingOpportunityCounts.get(`${opportunity.account_id}:${normalizeForMatch(opportunity.name)}`) ?? 0) > 1) {
      pushSkipped(opportunity.name, 'ambiguous_within_account_scope', {
        candidate_count: matchingOpportunityCounts.get(`${opportunity.account_id}:${normalizeForMatch(opportunity.name)}`) ?? undefined,
        recommended_action: 'Review duplicate opportunities inside this account before linking context.',
      });
      continue;
    }
    if (!accountScoped && (ambiguousOpportunityNames.get(normalizeForMatch(opportunity.name)) ?? 0) > 1) {
      pushSkipped(opportunity.name, 'ambiguous_without_account_scope', {
        candidate_count: ambiguousOpportunityNames.get(normalizeForMatch(opportunity.name)) ?? undefined,
        recommended_action: 'Add an account name so CRMy can link the right opportunity.',
      });
      continue;
    }
    pushSubject({
      type: 'opportunity',
      id: opportunity.id,
      name: opportunity.name,
      confidence: accountScoped ? 'high' : 'medium',
      match_tier: accountScoped ? 'deterministic_opportunity_account_scope' : 'deterministic_opportunity_mention',
      account_id: opportunity.account_id ?? undefined,
      account_name: opportunity.account_name ?? undefined,
      scope_reason: accountScoped ? 'Opportunity matched inside the account scope.' : undefined,
      parent_subject: opportunity.account_id && opportunity.account_name
        ? { type: 'account', id: opportunity.account_id, name: opportunity.account_name }
        : undefined,
    });
  }

  const matchingUseCases = directory.use_cases.filter(useCase =>
    matchVariants(useCase.name).some(variant => containsPhrase(normalizedText, variant)));
  const matchingUseCaseCounts = matchingUseCases.reduce((map, useCase) => {
    const key = `${useCase.account_id ?? 'global'}:${normalizeForMatch(useCase.name)}`;
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  const ambiguousUseCaseNames = matchingUseCases
    .filter(useCase => !mentionedAccountIds.size || !useCase.account_id || !mentionedAccountIds.has(useCase.account_id))
    .reduce((map, useCase) => {
      const key = normalizeForMatch(useCase.name);
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>());

  for (const useCase of matchingUseCases) {
    const variants = matchVariants(useCase.name);
    const accountScoped = Boolean(useCase.account_id && mentionedAccountIds.has(useCase.account_id));
    const nameMatch = variants.some(variant => containsPhrase(normalizedText, variant));
    if (mentionedAccountIds.size > 0 && !accountScoped) continue;
    if (!nameMatch) continue;
    candidates.add(useCase.name);
    if (accountScoped && (matchingUseCaseCounts.get(`${useCase.account_id}:${normalizeForMatch(useCase.name)}`) ?? 0) > 1) {
      pushSkipped(useCase.name, 'ambiguous_within_account_scope', {
        candidate_count: matchingUseCaseCounts.get(`${useCase.account_id}:${normalizeForMatch(useCase.name)}`) ?? undefined,
        recommended_action: 'Review duplicate use cases inside this account before linking context.',
      });
      continue;
    }
    if (!accountScoped && (ambiguousUseCaseNames.get(normalizeForMatch(useCase.name)) ?? 0) > 1) {
      pushSkipped(useCase.name, 'ambiguous_without_account_scope', {
        candidate_count: ambiguousUseCaseNames.get(normalizeForMatch(useCase.name)) ?? undefined,
        recommended_action: 'Add an account name so CRMy can link the right use case.',
      });
      continue;
    }
    pushSubject({
      type: 'use_case',
      id: useCase.id,
      name: useCase.name,
      confidence: accountScoped ? 'high' : 'medium',
      match_tier: accountScoped ? 'deterministic_use_case_account_scope' : 'deterministic_use_case_mention',
      account_id: useCase.account_id ?? undefined,
      account_name: useCase.account_name ?? undefined,
      scope_reason: accountScoped ? 'Use case matched inside the account scope.' : undefined,
      parent_subject: useCase.account_id && useCase.account_name
        ? { type: 'account', id: useCase.account_id, name: useCase.account_name }
        : undefined,
    });
  }

  const accountScope = buildAccountScope(directory, mentionedAccountIds);
  return {
    candidates: [...candidates],
    subjects,
    skipped,
    account_scope: accountScope,
    records_examined: resolutionRecordsExamined(directory),
    resolution_summary: summarizeResolution(subjects, accountScope),
  };
}

async function extractRawContextSubjectCandidates(
  db: DbPool,
  tenantId: string,
  text: string,
  limit: number,
  directory: SubjectResolutionDirectory,
): Promise<ModelSubjectCandidate[]> {
  try {
    await requireTenantLLMConfig(db, tenantId);
  } catch {
    throw new CrmyError(
      'VALIDATION_ERROR',
      'Workspace Agent is required to match Raw Context to customer records. Configure and test a model in Model Settings, then try again.',
      412,
      { reason: 'agent_config_required' },
    );
  }

  const system = `You identify customer records mentioned in messy go-to-market context.

Return JSON only:
{"candidates":[{"name":"...", "entity_type":"contact|account|opportunity|use_case|unknown", "record_id":"...", "email":"...", "company_name":"...", "account_name":"...", "domain":"...", "title":"...", "stage":"...", "description":"...", "confidence":0.0, "rationale":"..."}]}

Rules:
1. Extract only people, companies/accounts, opportunities/deals, or use cases that could map to CRMy records.
2. Do not extract generic departments, job titles, products, dates, topics, or internal CRMy concepts as records.
3. Include useful hints such as email, company_name, account_name, domain, title, stage, and description when present or clearly implied.
4. Prefer high recall: include plausible customer/company references, but set confidence below 0.6 when uncertain.
5. Resolve accounts first. When a known account is mentioned, prefer contacts, opportunities, and use cases listed under that account before considering anything new.
6. Use the known customer record directory when it matches the Raw Context. If a listed record matches, include its record_id exactly.
7. If a contact, opportunity, or use case appears net-new under a matched account, include account_name/company_name so CRMy can route it for review.
8. Never invent IDs or facts. Only copy record_id values from the known customer record directory.
9. Return at most ${limit} candidates.`;

  const user = `Known customer records:
${JSON.stringify(directory, null, 2)}

Raw Context:
${text.slice(0, 60_000)}`;
  const response = await callLLM(db, tenantId, {
    system,
    user,
    maxTokens: 1200,
    timeoutMs: RAW_CONTEXT_SUBJECT_MATCH_TIMEOUT_MS,
    responseFormat: 'json_object',
  });
  return parseCandidateResponse(response, limit);
}

async function resolveCandidateByRecordId(
  db: DbPool,
  tenantId: string,
  candidate: ModelSubjectCandidate,
  ownerIds?: string[],
): Promise<RawContextResolvedSubject | null> {
  if (!candidate.record_id) return null;
  const ownerFilter = ownerIds ? 'AND owner_id = ANY($3::uuid[])' : '';
  const params = ownerIds ? [tenantId, candidate.record_id, ownerIds] : [tenantId, candidate.record_id];
  const allowedTypes = candidate.entity_type === 'contact' || candidate.entity_type === 'account' || candidate.entity_type === 'opportunity' || candidate.entity_type === 'use_case'
    ? [candidate.entity_type]
    : ['contact', 'account', 'opportunity', 'use_case'];
  if (allowedTypes.includes('contact')) {
    const result = await db.query(
	      `SELECT c.id, c.first_name || ' ' || c.last_name AS name
	       FROM contacts c
	       WHERE c.tenant_id = $1 AND c.id = $2 AND c.merged_into IS NULL AND c.archived_at IS NULL ${ownerFilter}`,
      params,
    );
    if (result.rows[0]) {
      return {
        type: 'contact',
        id: result.rows[0].id,
        name: result.rows[0].name,
        confidence: 'high',
        match_tier: 'model_directory_match',
      };
    }
  }
  if (allowedTypes.includes('account')) {
    const result = await db.query(
	      `SELECT id, name
	       FROM accounts
	       WHERE tenant_id = $1 AND id = $2 AND merged_into IS NULL AND archived_at IS NULL ${ownerFilter}`,
      params,
    );
    if (result.rows[0]) {
      return {
        type: 'account',
        id: result.rows[0].id,
        name: result.rows[0].name,
        confidence: 'high',
        match_tier: 'model_directory_match',
      };
    }
  }
  if (allowedTypes.includes('opportunity')) {
    const result = await db.query(
	      `SELECT o.id, o.name, o.account_id, a.name AS account_name
	       FROM opportunities o
	       LEFT JOIN accounts a ON a.id = o.account_id AND a.tenant_id = o.tenant_id
	       WHERE o.tenant_id = $1 AND o.id = $2 AND o.archived_at IS NULL ${ownerFilter.replace('owner_id', 'o.owner_id')}`,
      params,
    );
    if (result.rows[0]) {
      return {
        type: 'opportunity',
        id: result.rows[0].id,
        name: result.rows[0].name,
        confidence: 'high',
        match_tier: 'model_directory_match',
        account_id: result.rows[0].account_id ?? undefined,
        account_name: result.rows[0].account_name ?? undefined,
        parent_subject: result.rows[0].account_id && result.rows[0].account_name
          ? { type: 'account', id: result.rows[0].account_id, name: result.rows[0].account_name }
          : undefined,
      };
    }
  }
  if (allowedTypes.includes('use_case')) {
    const result = await db.query(
	      `SELECT uc.id, uc.name, uc.account_id, a.name AS account_name
	       FROM use_cases uc
	       LEFT JOIN accounts a ON a.id = uc.account_id AND a.tenant_id = uc.tenant_id
	       WHERE uc.tenant_id = $1 AND uc.id = $2 AND uc.archived_at IS NULL ${ownerFilter.replace('owner_id', 'uc.owner_id')}`,
      params,
    );
    if (result.rows[0]) {
      return {
        type: 'use_case',
        id: result.rows[0].id,
        name: result.rows[0].name,
        confidence: 'high',
        match_tier: 'model_directory_match',
        account_id: result.rows[0].account_id ?? undefined,
        account_name: result.rows[0].account_name ?? undefined,
        parent_subject: result.rows[0].account_id && result.rows[0].account_name
          ? { type: 'account', id: result.rows[0].account_id, name: result.rows[0].account_name }
          : undefined,
      };
    }
  }
  return null;
}

function queryVariants(candidate: ModelSubjectCandidate): string[] {
  const variants = [
    candidate.email,
    candidate.domain,
    candidate.name,
    candidate.company_name && candidate.entity_type === 'account' ? candidate.company_name : undefined,
  ].filter((v): v is string => Boolean(v && v.trim()));
  return [...new Set(variants)];
}

function entityType(candidate: ModelSubjectCandidate): 'contact' | 'account' | 'any' {
  if (candidate.entity_type === 'contact' || candidate.email) return 'contact';
  if (candidate.entity_type === 'account' || candidate.domain) return 'account';
  return 'any';
}

function proposalFromCandidate(
  candidate: ModelSubjectCandidate,
  reason: string,
  duplicateCandidates: RawContextRecordProposal['duplicate_candidates'] = [],
  scopedAccount?: DirectoryAccount | RawContextResolvedSubject,
): RawContextRecordProposal | null {
  if (
    candidate.entity_type !== 'contact' &&
    candidate.entity_type !== 'account' &&
    candidate.entity_type !== 'opportunity' &&
    candidate.entity_type !== 'use_case'
  ) {
    return null;
  }
  const fields: Record<string, unknown> = {};
  if (candidate.entity_type === 'contact') {
    fields.name = candidate.name;
    if (candidate.email) fields.email = candidate.email;
    if (candidate.title) fields.title = candidate.title;
    if (candidate.company_name ?? scopedAccount?.name) fields.company_name = candidate.company_name ?? scopedAccount?.name;
    if (scopedAccount?.id) fields.account_id = scopedAccount.id;
  } else if (candidate.entity_type === 'account') {
    fields.name = candidate.name;
    if (candidate.domain) fields.domain = candidate.domain;
  } else if (candidate.entity_type === 'opportunity') {
    fields.name = candidate.name;
    if (candidate.account_name ?? candidate.company_name ?? scopedAccount?.name) fields.account_name = candidate.account_name ?? candidate.company_name ?? scopedAccount?.name;
    if (scopedAccount?.id) fields.account_id = scopedAccount.id;
    if (candidate.stage) fields.stage = candidate.stage;
    if (candidate.description ?? candidate.rationale) fields.description = candidate.description ?? candidate.rationale;
  } else if (candidate.entity_type === 'use_case') {
    fields.name = candidate.name;
    if (candidate.account_name ?? candidate.company_name ?? scopedAccount?.name) fields.account_name = candidate.account_name ?? candidate.company_name ?? scopedAccount?.name;
    if (scopedAccount?.id) fields.account_id = scopedAccount.id;
    if (candidate.stage) fields.stage = candidate.stage;
    if (candidate.description ?? candidate.rationale) fields.description = candidate.description ?? candidate.rationale;
  }
  if (!fields.name || String(fields.name).trim().length < 2) return null;
  return {
    record_type: candidate.entity_type,
    name: candidate.name,
    confidence: candidate.confidence ?? 0.5,
    reason: candidate.rationale ?? reason,
    fields,
    ...(duplicateCandidates.length > 0 ? { duplicate_candidates: duplicateCandidates } : {}),
  };
}

function candidateAccountName(candidate: ModelSubjectCandidate): string | undefined {
  return candidate.account_name ?? candidate.company_name ?? (candidate.entity_type === 'account' ? candidate.name : undefined);
}

function findScopedAccount(
  candidate: ModelSubjectCandidate,
  directory: SubjectResolutionDirectory,
  accountSubjects: RawContextResolvedSubject[],
): DirectoryAccount | undefined {
  const accountName = candidateAccountName(candidate);
  const candidateVariants = matchVariants(accountName);
  const fromCandidate = accountName
    ? directory.accounts.find(account =>
      matchVariants(account.name, account.domain, ...(account.aliases ?? [])).some(variant => candidateVariants.includes(variant)))
    : undefined;
  if (fromCandidate) return fromCandidate;
  if (accountSubjects.length === 1) {
    return directory.accounts.find(account => account.id === accountSubjects[0].id);
  }
  return undefined;
}

function recordVariants(value: string | null | undefined): string[] {
  return matchVariants(value).filter(variant => variant.length >= 3);
}

function candidateMatchesRecord(candidate: ModelSubjectCandidate, recordName: string, aliases: string[] = []): boolean {
  const candidateVariants = recordVariants(candidate.name);
  const recordNameVariants = [...new Set([...recordVariants(recordName), ...aliases.flatMap(alias => recordVariants(alias))])];
  return candidateVariants.some(candidateVariant =>
    recordNameVariants.includes(candidateVariant) ||
    recordNameVariants.some(recordVariant => recordVariant.includes(candidateVariant) || candidateVariant.includes(recordVariant)));
}

type ScopedChildResolution =
  | { status: 'resolved'; subject: RawContextResolvedSubject }
  | { status: 'ambiguous'; skipped: RawContextSkippedCandidate }
  | { status: 'not_found' };

function childCandidateRecords(
  type: string,
  rows: Array<{ id: string; name: string; account_id?: string | null; account_name?: string | null; company_name?: string | null }>,
): NonNullable<RawContextSkippedCandidate['candidate_records']> {
  return rows.slice(0, 5).map(row => ({
    type,
    id: row.id,
    name: row.name,
    account_id: row.account_id ?? undefined,
    account_name: row.account_name ?? row.company_name ?? undefined,
  }));
}

function resolveScopedChildCandidate(
  candidate: ModelSubjectCandidate,
  directory: SubjectResolutionDirectory,
  accountSubjects: RawContextResolvedSubject[],
): ScopedChildResolution {
  const scopedAccount = findScopedAccount(candidate, directory, accountSubjects);
  const accountIds = scopedAccount
    ? new Set([scopedAccount.id])
    : new Set(accountSubjects.map(subject => subject.id));
  if (candidate.entity_type === 'contact' || candidate.email) {
    const emailMatches = candidate.email
      ? directory.contacts.filter(contact => contact.email?.toLowerCase() === candidate.email?.toLowerCase())
      : [];
    if (emailMatches.length > 1) {
      return {
        status: 'ambiguous',
        skipped: {
          name: candidate.name,
          reason: 'ambiguous_email_match',
          candidate_count: emailMatches.length,
          candidate_records: childCandidateRecords('contact', emailMatches),
          recommended_action: 'Review duplicate contacts with this email before linking context.',
        },
      };
    }
    const byEmail = emailMatches[0];
    const nameMatches = byEmail ? [] : directory.contacts.filter(contact =>
      (!accountIds.size || (contact.account_id && accountIds.has(contact.account_id))) &&
      candidateMatchesRecord(candidate, contact.name, contact.aliases ?? []));
    if (!byEmail && nameMatches.length > 1) {
      return {
        status: 'ambiguous',
        skipped: {
          name: candidate.name,
          reason: accountIds.size ? 'ambiguous_within_account_scope' : 'ambiguous_without_account_scope',
          candidate_count: nameMatches.length,
          candidate_records: childCandidateRecords('contact', nameMatches),
          recommended_action: accountIds.size
            ? 'Review duplicate contacts inside this account before linking context.'
            : 'Add an account or email so CRMy can link the right contact.',
        },
      };
    }
    const match = byEmail ?? nameMatches[0];
    if (!match) return { status: 'not_found' };
    return {
      status: 'resolved',
      subject: {
        type: 'contact',
        id: match.id,
        name: match.name,
        confidence: byEmail ? 'high' : accountIds.size ? 'high' : 'medium',
        match_tier: byEmail ? 'email_exact' : accountIds.size ? 'scoped_contact_match' : 'contact_name_match',
        account_id: match.account_id ?? undefined,
        account_name: match.company_name ?? undefined,
        scope_reason: accountIds.size ? 'Contact resolved inside the matched account scope.' : undefined,
        parent_subject: match.account_id && match.company_name
          ? { type: 'account', id: match.account_id, name: match.company_name }
          : undefined,
      },
    };
  }
  if (candidate.entity_type === 'opportunity') {
    const matches = directory.opportunities.filter(opportunity =>
      (!accountIds.size || (opportunity.account_id && accountIds.has(opportunity.account_id))) &&
      candidateMatchesRecord(candidate, opportunity.name));
    if (matches.length > 1) {
      return {
        status: 'ambiguous',
        skipped: {
          name: candidate.name,
          reason: accountIds.size ? 'ambiguous_within_account_scope' : 'ambiguous_without_account_scope',
          candidate_count: matches.length,
          candidate_records: childCandidateRecords('opportunity', matches),
          recommended_action: accountIds.size
            ? 'Review duplicate opportunities inside this account before linking context.'
            : 'Add an account name so CRMy can link the right opportunity.',
        },
      };
    }
    const match = matches[0];
    if (!match) return { status: 'not_found' };
    return {
      status: 'resolved',
      subject: {
        type: 'opportunity',
        id: match.id,
        name: match.name,
        confidence: accountIds.size ? 'high' : 'medium',
        match_tier: accountIds.size ? 'scoped_opportunity_match' : 'opportunity_name_match',
        account_id: match.account_id ?? undefined,
        account_name: match.account_name ?? undefined,
        scope_reason: accountIds.size ? 'Opportunity resolved inside the matched account scope.' : undefined,
        parent_subject: match.account_id && match.account_name
          ? { type: 'account', id: match.account_id, name: match.account_name }
          : undefined,
      },
    };
  }
  if (candidate.entity_type === 'use_case') {
    const matches = directory.use_cases.filter(useCase =>
      (!accountIds.size || (useCase.account_id && accountIds.has(useCase.account_id))) &&
      candidateMatchesRecord(candidate, useCase.name));
    if (matches.length > 1) {
      return {
        status: 'ambiguous',
        skipped: {
          name: candidate.name,
          reason: accountIds.size ? 'ambiguous_within_account_scope' : 'ambiguous_without_account_scope',
          candidate_count: matches.length,
          candidate_records: childCandidateRecords('use_case', matches),
          recommended_action: accountIds.size
            ? 'Review duplicate use cases inside this account before linking context.'
            : 'Add an account name so CRMy can link the right use case.',
        },
      };
    }
    const match = matches[0];
    if (!match) return { status: 'not_found' };
    return {
      status: 'resolved',
      subject: {
        type: 'use_case',
        id: match.id,
        name: match.name,
        confidence: accountIds.size ? 'high' : 'medium',
        match_tier: accountIds.size ? 'scoped_use_case_match' : 'use_case_name_match',
        account_id: match.account_id ?? undefined,
        account_name: match.account_name ?? undefined,
        scope_reason: accountIds.size ? 'Use case resolved inside the matched account scope.' : undefined,
        parent_subject: match.account_id && match.account_name
          ? { type: 'account', id: match.account_id, name: match.account_name }
          : undefined,
      },
    };
  }
  return { status: 'not_found' };
}

function shouldConsultModelForAccountScopedChildren(
  text: string,
  deterministic: RawContextSubjectDetection,
): boolean {
  if (deterministic.skipped.length > 0) return false;
  if (deterministic.subjects.length === 0) return true;
  if (!deterministic.subjects.every(subject => subject.type === 'account')) return false;
  return /\b(contact|person|stakeholder|champion|sponsor|buyer|economic buyer|opportunity|deal|pipeline|pilot|evaluation|rollout|expansion|renewal|use case|workflow|initiative|implementation|project)\b/i.test(text);
}

export async function detectRawContextSubjects(
  db: DbPool,
  tenantId: string,
  text: string,
  options: { limit?: number; confidenceThreshold?: number; actorId?: string; ownerIds?: string[] } = {},
): Promise<RawContextSubjectDetection> {
  const limit = options.limit ?? 20;
  const directory = await loadSubjectResolutionDirectory(db, tenantId, limit * 8, options.ownerIds);
  const deterministic = deterministicSubjectMatches(text, directory, limit);
  const threshold = options.confidenceThreshold ?? 0.67;
  const seen = new Set<string>();
  const subjects: RawContextResolvedSubject[] = [];
  const skipped: RawContextSkippedCandidate[] = [...deterministic.skipped];
  const proposals: RawContextRecordProposal[] = [];
  const addSubject = (subject: RawContextResolvedSubject) => {
    const key = `${subject.type}:${subject.id}`;
    if (seen.has(key) || subjects.length >= limit) return;
    seen.add(key);
    subjects.push(subject);
  };
  deterministic.subjects.forEach(addSubject);

  const deterministicAccountSubjects = subjects.filter(subject => subject.type === 'account');
  let modelCandidates: ModelSubjectCandidate[] = [];
  if (shouldConsultModelForAccountScopedChildren(text, deterministic)) {
    try {
      modelCandidates = await extractRawContextSubjectCandidates(db, tenantId, text, limit, directory);
    } catch (err) {
      if (deterministic.subjects.length === 0) throw err;
      skipped.push({
        name: 'additional customer records',
        reason: 'model_unavailable_for_child_resolution',
        recommended_action: 'CRMy matched the account. Add a record manually or enable Workspace Agent to detect child records automatically.',
      });
    }
  }

  const candidates = Array.from(new Set([
    ...deterministic.candidates,
    ...modelCandidates.map(candidate => candidate.name),
  ]));

  for (const candidate of modelCandidates) {
    const accountSubjects = subjects.filter(subject => subject.type === 'account');
    const scopedAccount = findScopedAccount(candidate, directory, accountSubjects);
    if ((candidate.confidence ?? 1) < Math.max(0.25, threshold - 0.35)) {
      skipped.push({ name: candidate.name, reason: 'model_low_confidence' });
      const proposal = proposalFromCandidate(candidate, 'model_low_confidence', [], scopedAccount);
      if (proposal) proposals.push(proposal);
      continue;
    }
    const directoryResolved = await resolveCandidateByRecordId(db, tenantId, candidate, options.ownerIds);
    if (directoryResolved) {
      addSubject(directoryResolved);
      continue;
    }
    const scopedResolved = resolveScopedChildCandidate(candidate, directory, accountSubjects);
    if (scopedResolved.status === 'resolved') {
      addSubject(scopedResolved.subject);
      continue;
    }
    if (scopedResolved.status === 'ambiguous') {
      skipped.push(scopedResolved.skipped);
      continue;
    }
    if (candidate.entity_type === 'opportunity' || candidate.entity_type === 'use_case') {
      const proposal = proposalFromCandidate(candidate, scopedAccount ? 'new_scoped_record_candidate' : 'new_record_candidate', [], scopedAccount);
      if (proposal) proposals.push(proposal);
      continue;
    }
    let resolved = null as Awaited<ReturnType<typeof entityResolve>>['resolved'] | null;
    let lastStatus = 'not_found';
    for (const query of queryVariants(candidate)) {
      const result = await entityResolve(db, tenantId, {
        query,
        entity_type: entityType(candidate),
        context_hints: {
          company_name: candidate.company_name,
          email_domain: candidate.domain,
          email: candidate.email,
          title: candidate.title,
        },
        actor_id: options.actorId,
        owner_ids: options.ownerIds,
        limit: 3,
      });
      lastStatus = result.status;
      if (result.status === 'resolved' && result.resolved) {
        resolved = result.resolved;
        break;
      }
    }
    if (!resolved) {
      skipped.push({ name: candidate.name, reason: lastStatus === 'ambiguous' ? 'ambiguous' : 'unresolved' });
      const proposal = proposalFromCandidate(candidate, lastStatus === 'ambiguous' ? 'ambiguous' : 'unresolved', [], scopedAccount);
      if (proposal) proposals.push(proposal);
      continue;
    }
    const score = CONFIDENCE_RANK[resolved.confidence] ?? 0;
    if (score < threshold) {
      skipped.push({ name: candidate.name, reason: `confidence_${resolved.confidence}` });
      const proposal = proposalFromCandidate(candidate, `confidence_${resolved.confidence}`, [{
        record_type: resolved.entity_type,
        id: resolved.id,
        name: resolved.name,
        confidence: resolved.confidence,
        reason: resolved.match_reason,
      }], scopedAccount);
      if (proposal) proposals.push(proposal);
      continue;
    }
    addSubject({
      type: resolved.entity_type,
      id: resolved.id,
      name: resolved.name,
      confidence: resolved.confidence,
      match_tier: resolved.match_reason,
    });
  }

  const proposalKeys = new Set<string>();
  const dedupedProposals = proposals.filter(proposal => {
    const key = `${proposal.record_type}:${proposal.name.toLowerCase()}`;
    if (proposalKeys.has(key)) return false;
    proposalKeys.add(key);
    return true;
  });
  const accountIds = new Set([
    ...deterministicAccountSubjects.map(subject => subject.id),
    ...subjects.filter(subject => subject.type === 'account').map(subject => subject.id),
    ...subjects.map(subject => subject.account_id).filter((id): id is string => Boolean(id)),
  ]);
  const accountScope = buildAccountScope(directory, accountIds);

  return {
    candidates,
    subjects,
    skipped,
    ...(dedupedProposals.length > 0 ? { proposed_records: dedupedProposals } : {}),
    account_scope: accountScope,
    records_examined: resolutionRecordsExamined(directory),
    resolution_summary: summarizeResolution(subjects, accountScope, dedupedProposals),
  };
}
