// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ProviderId } from '@crmy/shared';
import type { AgentConfig } from './types.js';

export const DEFAULT_LLM_TIMEOUT_MS = 60_000;
export const MIN_LLM_TIMEOUT_MS = 5_000;
export const MAX_LLM_TIMEOUT_MS = 300_000;

export function providerUsesAnthropicFormat(provider: string | null | undefined): boolean {
  return provider === 'anthropic';
}

export function resolveLlmTimeoutMs(
  config?: Pick<AgentConfig, 'llm_timeout_ms'> | null,
  fallbackMs = DEFAULT_LLM_TIMEOUT_MS,
): number {
  const configured = Number(config?.llm_timeout_ms ?? fallbackMs);
  if (!Number.isFinite(configured)) return fallbackMs;
  return Math.min(MAX_LLM_TIMEOUT_MS, Math.max(MIN_LLM_TIMEOUT_MS, Math.round(configured)));
}

export function modelErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? 'Model call failed');
  return friendlyModelProviderError(message);
}

export function isTransientModelError(err: unknown): boolean {
  const message = modelErrorMessage(err);
  return /timed out|timeout|abort|aborted|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|429|rate limit|temporarily|503|502|504|500/i.test(message);
}

export function formatProviderHttpError(providerLabel: string, status: number, rawBody: string): string {
  const providerMessage = extractProviderMessage(rawBody);
  const label = providerLabel || 'Model provider';
  if (status === 429) {
    return `${label} is rate limited right now. Try again in a moment, or switch to a backup model provider in Workspace Agent settings.`;
  }
  if (status === 401 || status === 403) {
    return `${label} rejected the configured API key or permissions. Check Workspace Agent model settings.`;
  }
  if (status === 404) {
    return `${label} could not find the selected model or endpoint. Check the provider, base URL, and model name.`;
  }
  if (status === 400) {
    if (/invalid tool call arguments/i.test(providerMessage)) {
      return `${label} returned an invalid tool request. CRMy will retry when possible; otherwise try the request again.`;
    }
    return providerMessage
      ? `${label} rejected the model request. ${providerMessage}`
      : `${label} rejected the model request. Check the selected model and provider settings.`;
  }
  if (status >= 500) {
    return `${label} is temporarily unavailable. Try again, or use a backup model provider if one is configured.`;
  }
  return providerMessage
    ? `${label} returned an error (${status}). ${providerMessage}`
    : `${label} returned an error (${status}). Check provider settings and try again.`;
}

export function friendlyModelProviderError(message: string): string {
  const raw = String(message ?? '').trim();
  if (!raw) return 'The model call failed. Check Workspace Agent model settings and try again.';

  const match = raw.match(/\b(?:LLM|Anthropic|Embedding)\s+API error\s+(\d{3}):\s*([\s\S]*)$/i);
  if (match) {
    const [, status, body] = match;
    return formatProviderHttpError(match[0].startsWith('Anthropic') ? 'Anthropic' : 'Model provider', Number(status), body);
  }

  if (/\b429\b|rate[-\s]?limit|too many requests/i.test(raw)) {
    return 'The model provider is rate limited right now. Try again in a moment, or switch to a backup model provider in Workspace Agent settings.';
  }
  if (/invalid tool call arguments/i.test(raw)) {
    return 'The model returned an invalid tool request. CRMy will retry when possible; otherwise try the request again.';
  }
  if (/api key|unauthorized|forbidden|permission/i.test(raw) && /model|provider|llm|anthropic|openai|openrouter/i.test(raw)) {
    return 'The model provider rejected the configured API key or permissions. Check Workspace Agent model settings.';
  }

  return stripRawJsonTail(raw);
}

function extractProviderMessage(rawBody: string): string {
  const raw = String(rawBody ?? '').trim();
  if (!raw) return '';
  const parsed = parseMaybeJson(raw);
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === 'object') {
      const errorRecord = error as Record<string, unknown>;
      return cleanProviderDetail(String(errorRecord.message ?? errorRecord.detail ?? errorRecord.code ?? ''));
    }
    return cleanProviderDetail(String(record.message ?? record.detail ?? record.error ?? ''));
  }
  return cleanProviderDetail(stripRawJsonTail(raw));
}

function parseMaybeJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function cleanProviderDetail(value: string): string {
  const cleaned = stripRawJsonTail(value)
    .replace(/\s+/g, ' ')
    .replace(/^error[:\s-]+/i, '')
    .trim();
  if (!cleaned || /^[{}\[\]",:\s\d._-]+$/.test(cleaned)) return '';
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function stripRawJsonTail(raw: string): string {
  return raw
    .replace(/\s*\{[\s\S]*\}\s*$/g, '')
    .replace(/\s*\[[\s\S]*\]\s*$/g, '')
    .trim();
}

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function buildOpenAICompatibleHeaders(
  provider: string,
  baseUrl: string,
  apiKey: string,
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (provider === 'openrouter' || baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://github.com/crmy-dev/crmy';
    headers['X-Title'] = 'CRMy';
  }

  return headers;
}

export function backupRuntimeConfig(config: AgentConfig): AgentConfig | null {
  if (!config.backup_enabled) return null;
  if (!config.backup_provider || !config.backup_base_url || !config.backup_model) return null;
  return {
    ...config,
    provider: config.backup_provider as ProviderId,
    base_url: config.backup_base_url,
    api_key_enc: config.backup_api_key_enc ?? null,
    model: config.backup_model,
    llm_timeout_ms: resolveLlmTimeoutMs(config),
  };
}
