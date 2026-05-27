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
  email?: string;
  company_name?: string;
  domain?: string;
  title?: string;
  confidence?: number;
  rationale?: string;
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
  if (!name && !email && !domain) return null;
  const entityType = obj.entity_type === 'contact' || obj.entity_type === 'account'
    ? obj.entity_type
    : 'unknown';
  const confidence = typeof obj.confidence === 'number'
    ? Math.max(0, Math.min(1, obj.confidence))
    : undefined;
  return {
    name: name ?? email ?? domain ?? '',
    entity_type: entityType,
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
      normalized.email?.toLowerCase() ?? '',
      normalized.domain?.toLowerCase() ?? '',
      normalized.name.toLowerCase(),
      normalized.company_name?.toLowerCase() ?? '',
    ].join('|');
    if (!deduped.has(key)) deduped.set(key, normalized);
  }
  return [...deduped.values()].slice(0, limit);
}

async function extractRawContextSubjectCandidates(
  db: DbPool,
  tenantId: string,
  text: string,
  limit: number,
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
{"candidates":[{"name":"...", "entity_type":"contact|account|unknown", "email":"...", "company_name":"...", "domain":"...", "title":"...", "confidence":0.0, "rationale":"..."}]}

Rules:
1. Extract only people or companies that could map to CRMy contacts or companies/accounts.
2. Do not extract generic departments, job titles, products, dates, topics, or internal CRMy concepts as records.
3. Include useful hints such as email, company_name, domain, and title when present or clearly implied.
4. Prefer high recall: include plausible customer/company references, but set confidence below 0.6 when uncertain.
5. Never invent IDs or facts. The resolver will ground candidates against existing CRMy records.
6. Return at most ${limit} candidates.`;

  const user = `Raw Context:\n${text.slice(0, 60_000)}`;
  const response = await callLLM(db, tenantId, {
    system,
    user,
    maxTokens: 1200,
  });
  return parseCandidateResponse(response, limit);
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
  const modelCandidates = await extractRawContextSubjectCandidates(db, tenantId, text, options.limit ?? 20);
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
