// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ProviderId } from '@crmy/shared';
import type { AgentConfig } from './types.js';

export function providerUsesAnthropicFormat(provider: string | null | undefined): boolean {
  return provider === 'anthropic';
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
  };
}
