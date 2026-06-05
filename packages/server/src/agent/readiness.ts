// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import {
  buildOpenAICompatibleHeaders as buildHeaders,
  chatCompletionsUrl,
} from './provider-utils.js';

const AGENT_READINESS_TIMEOUT_MS = Number(process.env.AGENT_READINESS_TIMEOUT_MS ?? 10_000);

export type ReadinessResult = {
  ok: boolean;
  status: string;
  error?: string;
  warning?: string;
  tool_calling_verified?: boolean;
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = AGENT_READINESS_TIMEOUT_MS): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function responseIncludesToolCall(value: unknown, toolName: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(item => responseIncludesToolCall(item, toolName));
  const record = value as Record<string, unknown>;

  if (record.type === 'tool_use' && record.name === toolName) return true;
  if (record.type === 'function' && record.name === toolName) return true;
  if (record.name === toolName && ('arguments' in record || 'input' in record)) return true;
  if (record.function && typeof record.function === 'object') {
    const fn = record.function as Record<string, unknown>;
    if (fn.name === toolName) return true;
  }
  if (record.function_call && typeof record.function_call === 'object') {
    const fn = record.function_call as Record<string, unknown>;
    if (fn.name === toolName) return true;
  }

  return Object.values(record).some(child => responseIncludesToolCall(child, toolName));
}

function unverifiedToolCallResult(): ReadinessResult {
  return {
    ok: true,
    status: 'tool_calling_unverified',
    tool_calling_verified: false,
    warning: 'CRMy reached the model, but could not verify tool/function calling from this provider response. You can save if you know this model or gateway supports tool calls; CRMy will still enforce scoped tool use at runtime.',
  };
}

export async function verifyPlainModelReachability(input: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  headers?: Record<string, string>;
}): Promise<ReadinessResult> {
  if (input.provider === 'anthropic') {
    const res = await fetchWithTimeout(`${input.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with ok.' }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, status: 'offline', error: `${res.status}: ${err.slice(0, 200)}` };
    }
    return { ok: true, status: 'online' };
  }

  const res = await fetchWithTimeout(chatCompletionsUrl(input.baseUrl), {
    method: 'POST',
    headers: input.headers ?? { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with ok.' }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, status: 'offline', error: `${res.status}: ${err.slice(0, 200)}` };
  }
  return { ok: true, status: 'online' };
}

export async function verifyAgentToolCalling(input: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  headers?: Record<string, string>;
}): Promise<ReadinessResult> {
  const toolName = 'crmy_readiness_check';
  const parameters = {
    type: 'object',
    properties: {
      ok: { type: 'boolean', description: 'Always true for this readiness check.' },
    },
    required: ['ok'],
    additionalProperties: false,
  };

  if (input.provider === 'anthropic') {
    const testRes = await fetchWithTimeout(`${input.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Use the readiness tool now.' }],
        tools: [{
          name: toolName,
          description: 'Confirms the selected model can call CRMy tools.',
          input_schema: parameters,
        }],
        tool_choice: { type: 'tool', name: toolName },
      }),
    });
    if (!testRes.ok) {
      const reachable = await verifyPlainModelReachability(input);
      return reachable.ok ? unverifiedToolCallResult() : reachable;
    }
    const json = await testRes.json().catch(() => null);
    const called = responseIncludesToolCall(json, toolName);
    return called
      ? { ok: true, status: 'online', tool_calling_verified: true }
      : unverifiedToolCallResult();
  }

  const testRes = await fetchWithTimeout(chatCompletionsUrl(input.baseUrl), {
    method: 'POST',
    headers: input.headers ?? { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Use the readiness tool now.' }],
      tools: [{
        type: 'function',
        function: {
          name: toolName,
          description: 'Confirms the selected model can call CRMy tools.',
          parameters,
        },
      }],
      tool_choice: { type: 'function', function: { name: toolName } },
    }),
  });
  if (!testRes.ok) {
    const reachable = await verifyPlainModelReachability(input);
    return reachable.ok ? unverifiedToolCallResult() : reachable;
  }
  const json = await testRes.json().catch(() => null);
  const called = responseIncludesToolCall(json, toolName);
  return called
    ? { ok: true, status: 'online', tool_calling_verified: true }
    : unverifiedToolCallResult();
}

export function buildOpenAICompatibleHeaders(
  baseUrl: string,
  apiKey: string,
  provider = 'custom',
): Record<string, string> {
  return buildHeaders(provider, baseUrl, apiKey);
}
