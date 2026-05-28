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
import { CrmyError } from '@crmy/shared';

/** Default timeout for background LLM calls (30 seconds). */
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 30_000);

/**
 * Wrapper around fetch that aborts after `timeoutMs` milliseconds.
 * Throws a clear error so callers can distinguish timeouts from API errors.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = LLM_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeoutMs}ms (${url})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface LLMCallOptions {
  system: string;
  user: string;
  maxTokens?: number;
  /** Per-call timeout in milliseconds. Defaults to LLM_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Ask OpenAI-compatible providers for JSON when supported. Falls back if unsupported. */
  responseFormat?: 'json_object';
  /** If provided, prefers this model over the one in AgentConfig */
  modelOverride?: string;
}

export async function requireTenantLLMConfig(db: DbPool, tenantId: string): Promise<void> {
  const config = await loadConfig(db, tenantId);
  if (!config?.enabled || !config.model || !config.base_url) {
    throw new CrmyError(
      'VALIDATION_ERROR',
      'Local Workspace Agent is not configured. Configure and enable a model in Model Settings before using AI-generated workflow or sequence content.',
      412,
      { reason: 'agent_config_required' },
    );
  }
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
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;

  if (!config || config.provider === 'anthropic') {
    return callAnthropicSync(
      opts.system,
      opts.user,
      model,
      config?.base_url ?? 'https://api.anthropic.com/v1',
      config ? await resolveApiKey(config) : (process.env.ANTHROPIC_API_KEY ?? ''),
      maxTokens,
      timeoutMs,
    );
  }

  return callOpenAICompatSync(
    opts.system,
    opts.user,
    model,
    config.base_url,
    await resolveApiKey(config),
    maxTokens,
    timeoutMs,
    opts.responseFormat,
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
  timeoutMs: number,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/messages`;
  const res = await fetchWithTimeout(url, {
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
  }, timeoutMs);
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
  timeoutMs: number,
  responseFormat?: 'json_object',
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  if (responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  let res = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) {
    const err = await res.text();
    if (responseFormat === 'json_object' && /response_format|json_object|format/i.test(err)) {
      delete body.response_format;
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }, timeoutMs);
      if (res.ok) {
        const data = await res.json();
        return extractOpenAICompatText(data);
      }
      const fallbackErr = await res.text();
      throw new Error(`LLM API error ${res.status}: ${fallbackErr.slice(0, 300)}`);
    }
    throw new Error(`LLM API error ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return extractOpenAICompatText(data);
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      return textFromContent(record.text ?? record.content ?? record.value);
    }).filter(Boolean).join('\n');
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return textFromContent(record.text ?? record.content ?? record.value);
  }
  return '';
}

function extractOpenAICompatText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;
  if (typeof record.text === 'string') return record.text;
  if (record.message && typeof record.message === 'object') {
    const message = record.message as Record<string, unknown>;
    const direct = textFromContent(message.content);
    if (direct) return direct;
  }
  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const choiceRecord = choice as Record<string, unknown>;
    const message = choiceRecord.message as Record<string, unknown> | undefined;
    const messageText = textFromContent(message?.content);
    if (messageText) return messageText;
    const deltaText = textFromContent((choiceRecord.delta as Record<string, unknown> | undefined)?.content);
    if (deltaText) return deltaText;
    const choiceText = textFromContent(choiceRecord.text);
    if (choiceText) return choiceText;
  }
  return '';
}
