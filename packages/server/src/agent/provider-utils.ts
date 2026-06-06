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
  return err instanceof Error ? err.message : String(err ?? 'Model call failed');
}

export function isTransientModelError(err: unknown): boolean {
  const message = modelErrorMessage(err);
  return /timed out|timeout|abort|aborted|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|429|rate limit|temporarily|503|502|504|500/i.test(message);
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
