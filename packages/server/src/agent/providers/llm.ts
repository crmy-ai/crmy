// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * callLLM — provider-agnostic, non-streaming LLM utility.
 *
 * Used by background services (extraction, consolidation, contradiction
 * detection, sequence execution) that need a one-shot inference call without
 * the full streaming agent engine.
 *
 * Reads the tenant's AgentConfig to select the correct provider, decrypts
 * the stored API key, and dispatches to the right endpoint.  Falls back to
 * a direct Anthropic call when no tenant config is available (e.g. system
 * background tasks that pre-date the tenant context).
 *
 * Provider routing:
 *   anthropic                → POST /messages (Anthropic format, x-api-key header)
 *   openai | openrouter |
 *   ollama | custom          → POST /chat/completions (OpenAI-compat, Bearer header)
 */

import type { DbPool } from '../../db/pool.js';

export interface LLMCallOptions {
  system: string;
  user: string;
  maxTokens?: number;
  /** If provided, prefers this model over the one in AgentConfig */
  modelOverride?: string;
}

/**
 * Call the tenant's configured LLM with a single system+user turn.
 * Returns the response text.  Throws on HTTP error.
 */
export async function callLLM(
  db: DbPool,
  tenantId: string,
  opts: LLMCallOptions,
): Promise<string> {
  const config = await loadConfig(db, tenantId);
  const model = opts.modelOverride ?? config?.model ?? 'claude-3-5-haiku-20241022';
  const maxTokens = opts.maxTokens ?? 1024;

  if (!config || config.provider === 'anthropic') {
    return callAnthropicSync(
      opts.system,
      opts.user,
      model,
      config?.base_url ?? 'https://api.anthropic.com/v1',
      config ? await resolveApiKey(config) : (process.env.ANTHROPIC_API_KEY ?? ''),
      maxTokens,
    );
  }

  return callOpenAICompatSync(
    opts.system,
    opts.user,
    model,
    config.base_url,
    await resolveApiKey(config),
    maxTokens,
  );
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function loadConfig(db: DbPool, tenantId: string) {
  try {
    const { getConfig } = await import('../../db/repos/agent.js');
    return await getConfig(db, tenantId);
  } catch {
    return null;
  }
}

async function resolveApiKey(config: { api_key_enc: string | null }): Promise<string> {
  if (!config.api_key_enc) return '';
  try {
    const { decrypt } = await import('../crypto.js');
    return decrypt(config.api_key_enc).trim();
  } catch {
    return '';
  }
}

async function callAnthropicSync(
  system: string,
  user: string,
  model: string,
  baseUrl: string,
  apiKey: string,
  maxTokens: number,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json() as { content: { type: string; text: string }[] };
  return data.content?.find(c => c.type === 'text')?.text ?? '';
}

async function callOpenAICompatSync(
  system: string,
  user: string,
  model: string,
  baseUrl: string,
  apiKey: string,
  maxTokens: number,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}
