// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { AgentConfig, ConversationMessage, AgentToolDef, ToolCallRecord } from '../types.js';

/**
 * Call any OpenAI-compatible API (OpenAI, OpenRouter, Ollama, custom gateways)
 * with streaming. Uses raw fetch — no SDK dependency.
 */
export async function callOpenAICompat(
  messages: ConversationMessage[],
  tools: AgentToolDef[],
  config: AgentConfig,
  apiKey: string | null,
  onDelta: (text: string) => void,
  _onThinking?: (text: string) => void, // not supported by OpenAI-compatible providers
): Promise<{ content: string; tool_calls: ToolCallRecord[] }> {
  const openaiMessages = toOpenAIFormat(messages);
  const openaiTools = tools.length > 0 ? tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  })) : undefined;

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.max_tokens_per_turn,
    messages: openaiMessages,
    stream: true,
  };
  if (openaiTools) body.tools = openaiTools;

  const baseUrl = config.base_url.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // OpenRouter requires HTTP-Referer to identify the calling app
  if (baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://github.com/crmy-dev/crmy';
    headers['X-Title'] = 'CRMy';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LLM API error ${res.status}: ${errBody}`);
  }

  return parseOpenAIStream(res, onDelta);
}

/** Convert generic messages to OpenAI chat format. */
function toOpenAIFormat(messages: ConversationMessage[]): Record<string, unknown>[] {
  return messages.map(msg => {
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }

    if (msg.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: msg.tool_call_id,
        content: msg.content,
      };
    }

    return { role: msg.role, content: msg.content };
  });
}

/** Parse OpenAI streaming SSE response. */
async function parseOpenAIStream(
  res: Response,
  onDelta: (text: string) => void,
): Promise<{ content: string; tool_calls: ToolCallRecord[] }> {
  let fullText = '';
  const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      let chunk: Record<string, unknown>;
      try { chunk = JSON.parse(data); } catch { continue; }

      const choices = chunk.choices as { delta: Record<string, unknown> }[] | undefined;
      if (!choices?.length) continue;
      const delta = choices[0].delta;

      // Text content
      if (delta.content) {
        const text = delta.content as string;
        fullText += text;
        onDelta(text);
      }

      // Tool calls (streamed incrementally)
      const tcDeltas = delta.tool_calls as { index: number; id?: string; function?: { name?: string; arguments?: string } }[] | undefined;
      if (tcDeltas) {
        for (const tcd of tcDeltas) {
          const existing = toolCallsMap.get(tcd.index);
          if (!existing) {
            toolCallsMap.set(tcd.index, {
              id: tcd.id ?? '',
              name: tcd.function?.name ?? '',
              arguments: tcd.function?.arguments ?? '',
            });
          } else {
            if (tcd.id) existing.id = tcd.id;
            if (tcd.function?.name) existing.name += tcd.function.name;
            if (tcd.function?.arguments) existing.arguments += tcd.function.arguments;
          }
        }
      }
    }
  }

  const tool_calls: ToolCallRecord[] = [];
  for (const [, tc] of [...toolCallsMap.entries()].sort((a, b) => a[0] - b[0])) {
    tool_calls.push({ id: tc.id, name: tc.name, arguments: tc.arguments });
  }

  return { content: fullText, tool_calls };
}
