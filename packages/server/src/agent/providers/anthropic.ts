// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { AgentConfig, ConversationMessage, AgentToolDef, ToolCallRecord } from '../types.js';

/**
 * Call the Anthropic Messages API with streaming.
 * Uses raw fetch — avoids adding @anthropic-ai/sdk as a dependency.
 */
export async function callAnthropic(
  messages: ConversationMessage[],
  tools: AgentToolDef[],
  config: AgentConfig,
  apiKey: string,
  onDelta: (text: string) => void,
): Promise<{ content: string; tool_calls: ToolCallRecord[] }> {
  // Convert our message format to Anthropic format
  const { systemPrompt, anthropicMessages } = toAnthropicFormat(messages);

  const anthropicTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.max_tokens_per_turn,
    messages: anthropicMessages,
    stream: true,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (anthropicTools.length > 0) body.tools = anthropicTools;

  const baseUrl = config.base_url.replace(/\/+$/, '');
  const url = `${baseUrl}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
  }

  return parseAnthropicStream(res, onDelta);
}

/** Convert generic messages to Anthropic API format. */
function toAnthropicFormat(messages: ConversationMessage[]): {
  systemPrompt: string | undefined;
  anthropicMessages: Record<string, unknown>[];
} {
  let systemPrompt: string | undefined;
  const out: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
      continue;
    }

    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      const content: unknown[] = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments),
          });
        }
      }
      out.push({ role: 'assistant', content });
      continue;
    }

    if (msg.role === 'tool') {
      out.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        }],
      });
    }
  }

  return { systemPrompt, anthropicMessages: out };
}

/** Parse Anthropic streaming SSE response. */
async function parseAnthropicStream(
  res: Response,
  onDelta: (text: string) => void,
): Promise<{ content: string; tool_calls: ToolCallRecord[] }> {
  let fullText = '';
  const toolCalls: ToolCallRecord[] = [];
  let currentToolId = '';
  let currentToolName = '';
  let currentToolArgs = '';

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!; // keep partial line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      let event: Record<string, unknown>;
      try { event = JSON.parse(data); } catch { continue; }

      const eventType = event.type as string;

      if (eventType === 'content_block_start') {
        const block = event.content_block as Record<string, unknown>;
        if (block?.type === 'tool_use') {
          currentToolId = block.id as string;
          currentToolName = block.name as string;
          currentToolArgs = '';
        }
      } else if (eventType === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown>;
        if (delta?.type === 'text_delta') {
          const text = delta.text as string;
          fullText += text;
          onDelta(text);
        } else if (delta?.type === 'input_json_delta') {
          currentToolArgs += delta.partial_json as string;
        }
      } else if (eventType === 'content_block_stop') {
        if (currentToolId) {
          toolCalls.push({
            id: currentToolId,
            name: currentToolName,
            arguments: currentToolArgs,
          });
          currentToolId = '';
        }
      }
    }
  }

  return { content: fullText, tool_calls: toolCalls };
}
