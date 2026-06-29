// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import {
  PROVIDERS,
  findPrecertifiedModel,
  getProvider,
  type ModelDef,
  type ProviderDef,
  type ProviderId,
} from '@crmy/shared';
import { CRMY_DIR } from './config.js';

export type ModelCatalogSource = 'built_in' | 'openrouter' | 'ollama' | 'local_override';

export interface ModelCatalogEntry {
  provider: string;
  provider_label: string;
  base_url: string;
  model: string;
  label: string;
  description?: string;
  source: ModelCatalogSource;
  source_url?: string;
  fetched_at?: string;
  context_window?: number;
  tool_support?: 'known' | 'unknown';
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  certification_status: 'certified' | 'uncertified';
  certification_run_id?: string;
  certification_score?: number;
}

export interface ModelCatalogCache {
  schema_version: 1;
  fetched_at: string;
  entries: ModelCatalogEntry[];
}

const CATALOG_FILE = path.join(CRMY_DIR, 'model-catalog.json');
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

function nowIso(): string {
  return new Date().toISOString();
}

function cleanModelId(value: unknown): string {
  return String(value ?? '').trim();
}

function isModelCatalogEntry(value: ModelCatalogEntry | null): value is ModelCatalogEntry {
  return value !== null;
}

function providerBaseUrl(provider: string): string {
  return getProvider(provider).baseUrl;
}

function providerLabel(provider: string): string {
  return getProvider(provider).label;
}

function certificationFields(provider: string, baseUrl: string, model: string): Pick<ModelCatalogEntry, 'certification_status' | 'certification_run_id' | 'certification_score'> {
  const certification = findPrecertifiedModel({ provider, baseUrl, model })?.certification;
  if (!certification) return { certification_status: 'uncertified' };
  return {
    certification_status: 'certified',
    certification_run_id: certification.run_id,
    certification_score: certification.score,
  };
}

function builtInEntry(provider: ProviderDef, model: ModelDef): ModelCatalogEntry {
  const baseUrl = provider.baseUrl;
  return {
    provider: provider.id,
    provider_label: provider.label,
    base_url: baseUrl,
    model: model.id,
    label: model.label,
    description: model.description,
    source: 'built_in',
    tool_support: 'known',
    ...certificationFields(provider.id, baseUrl, model.id),
  };
}

export function builtInModelCatalogEntries(): ModelCatalogEntry[] {
  return PROVIDERS.flatMap(provider => provider.models.map(model => builtInEntry(provider, model)));
}

function catalogKey(entry: ModelCatalogEntry): string {
  return `${entry.provider.toLowerCase()}|${entry.base_url.replace(/\/+$/, '')}|${entry.model}`;
}

export function mergeModelCatalogEntries(...groups: ModelCatalogEntry[][]): ModelCatalogEntry[] {
  const byKey = new Map<string, ModelCatalogEntry>();
  for (const group of groups) {
    for (const entry of group) {
      const key = catalogKey(entry);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, entry);
        continue;
      }
      byKey.set(key, {
        ...entry,
        description: entry.description ?? existing.description,
        context_window: entry.context_window ?? existing.context_window,
        pricing: entry.pricing ?? existing.pricing,
        source: existing.source === 'built_in' ? existing.source : entry.source,
        certification_status: existing.certification_status === 'certified' || entry.certification_status === 'certified' ? 'certified' : 'uncertified',
        certification_run_id: existing.certification_run_id ?? entry.certification_run_id,
        certification_score: existing.certification_score ?? entry.certification_score,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.provider.localeCompare(b.provider)
    || Number(b.certification_status === 'certified') - Number(a.certification_status === 'certified')
    || a.model.localeCompare(b.model),
  );
}

export function readModelCatalogCache(): ModelCatalogCache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')) as ModelCatalogCache;
    if (parsed.schema_version !== 1 || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeModelCatalogCache(entries: ModelCatalogEntry[]): ModelCatalogCache {
  fs.mkdirSync(CRMY_DIR, { recursive: true });
  const cache: ModelCatalogCache = {
    schema_version: 1,
    fetched_at: nowIso(),
    entries,
  };
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(cache, null, 2) + '\n', { mode: 0o600 });
  return cache;
}

export function modelCatalogCachePath(): string {
  return CATALOG_FILE;
}

async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function openRouterEntry(raw: Record<string, unknown>, fetchedAt: string): ModelCatalogEntry | null {
  const model = cleanModelId(raw.id);
  if (!model) return null;
  const baseUrl = providerBaseUrl('openrouter');
  const pricing = raw.pricing && typeof raw.pricing === 'object'
    ? raw.pricing as { prompt?: unknown; completion?: unknown }
    : null;
  return {
    provider: 'openrouter',
    provider_label: providerLabel('openrouter'),
    base_url: baseUrl,
    model,
    label: String(raw.name ?? model),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    source: 'openrouter',
    source_url: OPENROUTER_MODELS_URL,
    fetched_at: fetchedAt,
    context_window: typeof raw.context_length === 'number' ? raw.context_length : undefined,
    tool_support: 'unknown',
    pricing: pricing ? {
      prompt: pricing.prompt == null ? undefined : String(pricing.prompt),
      completion: pricing.completion == null ? undefined : String(pricing.completion),
    } : undefined,
    ...certificationFields('openrouter', baseUrl, model),
  };
}

export async function refreshOpenRouterModels(): Promise<ModelCatalogEntry[]> {
  const fetchedAt = nowIso();
  const payload = await fetchJson(OPENROUTER_MODELS_URL) as { data?: Array<Record<string, unknown>> };
  return (payload.data ?? [])
    .map(item => openRouterEntry(item, fetchedAt))
    .filter((item): item is ModelCatalogEntry => Boolean(item));
}

export async function refreshOllamaModels(baseUrl = providerBaseUrl('ollama')): Promise<ModelCatalogEntry[]> {
  const fetchedAt = nowIso();
  const tagsBase = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const payload = await fetchJson(`${tagsBase}/api/tags`, 2_000) as { models?: Array<Record<string, unknown>> };
  return (payload.models ?? [])
    .map((raw): ModelCatalogEntry | null => {
      const model = cleanModelId(raw.name);
      if (!model) return null;
      return {
        provider: 'ollama',
        provider_label: providerLabel('ollama'),
        base_url: providerBaseUrl('ollama'),
        model,
        label: model,
        source: 'ollama' as const,
        source_url: `${tagsBase}/api/tags`,
        fetched_at: fetchedAt,
        tool_support: 'unknown' as const,
        ...certificationFields('ollama', providerBaseUrl('ollama'), model),
      };
    })
    .filter(isModelCatalogEntry);
}

export function mergedCachedModelCatalog(): ModelCatalogEntry[] {
  return mergeModelCatalogEntries(builtInModelCatalogEntries(), readModelCatalogCache()?.entries ?? []);
}

export function providerModelsFromCatalog(provider: ProviderId | string, entries = mergedCachedModelCatalog()): ModelDef[] {
  const providerDef = getProvider(provider);
  const catalogModels: ModelDef[] = entries
    .filter(entry => entry.provider === provider)
    .map((entry): ModelDef => ({
      id: entry.model,
      label: entry.label,
      description: entry.description
        ?? (entry.certification_status === 'certified'
          ? 'CRMy-certified model.'
          : entry.source === 'built_in'
            ? undefined
            : `Discovered from ${entry.source}; run crmy certify --output ./eval-runs before automatic Memory.`),
    }));
  return catalogModels.concat(providerDef.models.filter(model =>
    !entries.some(entry => entry.provider === provider && entry.model === model.id),
  ));
}
