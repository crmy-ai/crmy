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
}

export interface RawContextSubjectDetection {
  candidates: string[];
  subjects: RawContextResolvedSubject[];
  skipped: Array<{ name: string; reason: string }>;
}

const CONFIDENCE_RANK: Record<string, number> = { high: 1, medium: 0.67, low: 0.33 };

interface ModelSubjectCandidate {
  name: string;
  entity_type?: 'contact' | 'account' | 'unknown';
  record_id?: string;
  email?: string;
  company_name?: string;
  domain?: string;
  title?: string;
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
}

interface DirectoryAccount {
  id: string;
  name: string;
  domain?: string | null;
  industry?: string | null;
}

interface SubjectResolutionDirectory {
  contacts: DirectoryContact[];
  accounts: DirectoryAccount[];
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
  const entityType = obj.entity_type === 'contact' || obj.entity_type === 'account'
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
    domain,
    title: cleanString(obj.title),
    confidence,
    rationale: cleanString(obj.rationale, 500),
  };
}

function parseCandidateResponse(raw: string, limit: number): ModelSubjectCandidate[] {
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Subject detection response was not valid JSON.');
    parsed = JSON.parse(match[0]);
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
): Promise<SubjectResolutionDirectory> {
  const perType = Math.min(Math.max(limit, 25), 120);
  const [contacts, accounts] = await Promise.all([
    db.query(
      `SELECT c.id, c.first_name || ' ' || c.last_name AS name, c.first_name, c.last_name,
              c.email, c.title, COALESCE(a.name, c.company_name) AS company_name,
              c.account_id, a.domain AS account_domain
       FROM contacts c
       LEFT JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
       WHERE c.tenant_id = $1
       ORDER BY c.updated_at DESC
       LIMIT $2`,
      [tenantId, perType],
    ),
    db.query(
      `SELECT id, name, domain, industry
       FROM accounts
       WHERE tenant_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [tenantId, perType],
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
    })),
    accounts: accounts.rows.map(row => ({
      id: row.id,
      name: row.name,
      domain: row.domain,
      industry: row.industry,
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
  return ` ${normalizedText} `.includes(` ${phrase} `);
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
  const mentionedAccountIds = new Set<string>();
  const mentionedCompanyVariants = new Set<string>();

  for (const account of directory.accounts) {
    const variants = matchVariants(account.name, account.domain);
    if (variants.some(variant => containsPhrase(normalizedText, variant))) {
      candidates.add(account.name);
      mentionedAccountIds.add(account.id);
      variants.forEach(variant => mentionedCompanyVariants.add(variant));
      if (!seen.has(account.id) && subjects.length < limit) {
        seen.add(account.id);
        subjects.push({
          type: 'account',
          id: account.id,
          name: account.name,
          confidence: 'high',
          match_tier: 'deterministic_account_mention',
        });
      }
    }
  }

  const firstNameCounts = new Map<string, number>();
  for (const contact of directory.contacts) {
    const first = normalizeForMatch(contact.first_name ?? contact.name.split(/\s+/)[0] ?? '');
    if (first) firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1);
  }

  for (const contact of directory.contacts) {
    const fullName = normalizeForMatch(contact.name);
    const firstName = normalizeForMatch(contact.first_name ?? contact.name.split(/\s+/)[0] ?? '');
    const email = normalizeForMatch(contact.email ?? '');
    const companyVariants = matchVariants(contact.company_name, contact.account_domain);
    const fullMatch = containsPhrase(normalizedText, fullName) || (email.includes('@') && normalizedText.includes(email));
    const companyMatch = (contact.account_id && mentionedAccountIds.has(contact.account_id))
      || companyVariants.some(variant => mentionedCompanyVariants.has(variant) || containsPhrase(normalizedText, variant));
    const uniqueFirstName = firstName.length >= 3 && firstNameCounts.get(firstName) === 1;
    const firstNameWithCompany = uniqueFirstName && containsPhrase(normalizedText, firstName) && companyMatch;

    if (!fullMatch && !firstNameWithCompany) continue;
    candidates.add(contact.name);
    if (!seen.has(contact.id) && subjects.length < limit) {
      seen.add(contact.id);
      subjects.push({
        type: 'contact',
        id: contact.id,
        name: contact.name,
        confidence: fullMatch ? 'high' : 'medium',
        match_tier: fullMatch ? 'deterministic_contact_mention' : 'deterministic_contact_company_hint',
      });
    }
  }

  return { candidates: [...candidates], subjects, skipped: [] };
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
{"candidates":[{"name":"...", "entity_type":"contact|account|unknown", "record_id":"...", "email":"...", "company_name":"...", "domain":"...", "title":"...", "confidence":0.0, "rationale":"..."}]}

Rules:
1. Extract only people or companies that could map to CRMy contacts or companies/accounts.
2. Do not extract generic departments, job titles, products, dates, topics, or internal CRMy concepts as records.
3. Include useful hints such as email, company_name, domain, and title when present or clearly implied.
4. Prefer high recall: include plausible customer/company references, but set confidence below 0.6 when uncertain.
5. Use the known customer record directory when it matches the Raw Context. If a listed record matches, include its record_id exactly.
6. Never invent IDs or facts. Only copy record_id values from the known customer record directory.
7. Return at most ${limit} candidates.`;

  const user = `Known customer records:
${JSON.stringify(directory, null, 2)}

Raw Context:
${text.slice(0, 60_000)}`;
  const response = await callLLM(db, tenantId, {
    system,
    user,
    maxTokens: 1200,
  });
  return parseCandidateResponse(response, limit);
}

async function resolveCandidateByRecordId(
  db: DbPool,
  tenantId: string,
  candidate: ModelSubjectCandidate,
): Promise<RawContextResolvedSubject | null> {
  if (!candidate.record_id) return null;
  const allowedTypes = candidate.entity_type === 'contact' || candidate.entity_type === 'account'
    ? [candidate.entity_type]
    : ['contact', 'account'];
  if (allowedTypes.includes('contact')) {
    const result = await db.query(
      `SELECT c.id, c.first_name || ' ' || c.last_name AS name
       FROM contacts c
       WHERE c.tenant_id = $1 AND c.id = $2`,
      [tenantId, candidate.record_id],
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
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, candidate.record_id],
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

export async function detectRawContextSubjects(
  db: DbPool,
  tenantId: string,
  text: string,
  options: { limit?: number; confidenceThreshold?: number; actorId?: string } = {},
): Promise<RawContextSubjectDetection> {
  const limit = options.limit ?? 20;
  const directory = await loadSubjectResolutionDirectory(db, tenantId, limit * 8);
  const deterministic = deterministicSubjectMatches(text, directory, limit);
  if (deterministic.subjects.length > 0) {
    return deterministic;
  }

  const modelCandidates = await extractRawContextSubjectCandidates(db, tenantId, text, limit, directory);
  const candidates = modelCandidates.map(candidate => candidate.name);
  const threshold = options.confidenceThreshold ?? 0.67;

  const seen = new Set<string>();
  const subjects: RawContextResolvedSubject[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const candidate of modelCandidates) {
    if ((candidate.confidence ?? 1) < Math.max(0.25, threshold - 0.35)) {
      skipped.push({ name: candidate.name, reason: 'model_low_confidence' });
      continue;
    }
    const directoryResolved = await resolveCandidateByRecordId(db, tenantId, candidate);
    if (directoryResolved) {
      if (seen.has(directoryResolved.id)) continue;
      seen.add(directoryResolved.id);
      subjects.push(directoryResolved);
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
      continue;
    }
    const score = CONFIDENCE_RANK[resolved.confidence] ?? 0;
    if (score < threshold) {
      skipped.push({ name: candidate.name, reason: `confidence_${resolved.confidence}` });
      continue;
    }
    if (seen.has(resolved.id)) continue;
    seen.add(resolved.id);
    subjects.push({
      type: resolved.entity_type,
      id: resolved.id,
      name: resolved.name,
      confidence: resolved.confidence,
      match_tier: resolved.match_reason,
    });
  }

  return { candidates, subjects, skipped };
}
