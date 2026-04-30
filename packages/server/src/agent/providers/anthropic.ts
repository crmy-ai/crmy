// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { AgentConfig, ConversationMessage, AgentToolDef, ToolCallRecord } from '../types.js';

// ── Thinking support ──────────────────────────────────────────────────────────

/** Models that support extended thinking + interleaved reasoning between tool calls. */
const THINKING_MODELS = ['claude-3-7', 'claude-opus-4', 'claude-sonnet-4'];

function supportsThinking(model: string): boolean {
  return THINKING_MODELS.some(prefix => model.includes(prefix));
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface CallAnthropicOpts {
  /**
   * Override whether extended thinking is enabled for this call.
   * Defaults to `supportsThinking(config.model)`.
   * Pass `false` for lightweight summarisation/compaction calls that don't
   * need interleaved reasoning.
   */
  enableThinking?: boolean;
}

/**
 * Call the Anthropic Messages API with streaming.
 *
 * Key behaviours:
 * - Streams text deltas in real-time via `onDelta`.
 * - Emits complete thinking blocks via `onThinking` (when extended thinking is active).
 * - Returns the full assistant text and any tool calls once the stream closes.
 * - Correctly batches consecutive tool-result messages into a single user message
 *   (Anthropic requires all results from one tool-use round in one user turn).
 */
export async function callAnthropic(
  messages: ConversationMessage[],
  tools: AgentToolDef[],
  config: AgentConfig,
  apiKey: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void,
  opts?: CallAnthropicOpts,
): Promise<{ content: string; tool_calls: ToolCallRecord[] }> {
  const { systemPrompt, anthropicMessages } = toAnthropicFormat(messages);

  const anthropicTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const thinkingEnabled =
    opts?.enableThinking !== undefined ? opts.enableThinking : supportsThinking(config.model);

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.max_tokens_per_turn,
    messages: anthropicMessages,
    stream: true,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (anthropicTools.length > 0) body.tools = anthropicTools;
  if (thinkingEnabled) body.thinking = { type: 'enabled', budget_tokens: 8000 };

  const baseUrl = config.base_url.replace(/\/+$/, '');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  // Interleaved thinking lets the model reason between tool calls (not just before the first).
  if (thinkingEnabled) {
    headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
  }

  const res = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
  }

  return parseAnthropicStream(res, onDelta, onThinking);
}

// ── Message format conversion ─────────────────────────────────────────────────

/**
 * Convert our generic ConversationMessage[] into Anthropic's messages format.
 *
 * Critical rule: Anthropic requires that ALL tool results from the same
 * tool-use round be sent as a SINGLE user message containing multiple
 * `tool_result` content blocks. Sending each result as a separate user
 * message (the naive approach) produces a 400 Bad Request on the second
 * LLM call in the agentic loop.
 *
 * This function uses an indexed loop so it can look ahead and batch all
 * consecutive `tool` role messages into one user message.
 */
function toAnthropicFormat(messages: ConversationMessage[]): {
  systemPrompt: string | undefined;
  anthropicMessages: Record<string, unknown>[];
} {
  let systemPrompt: string | undefined;
  const out: Record<string, unknown>[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

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
      // Text preamble (may be empty string — omit in that case)
      if (msg.content) content.push({ type: 'text', text: msg.content });
      // Tool-use blocks (one per tool call in this turn)
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: unknown;
          try { input = JSON.parse(tc.arguments); } catch { input = {}; }
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
        }
      }
      out.push({ role: 'assistant', content });
      continue;
    }

    if (msg.role === 'tool') {
      // Batch ALL consecutive tool-result messages into one user turn.
      // This matches the Anthropic requirement that every tool result from a
      // single assistant tool-use message is returned together.
      const toolResults: unknown[] = [];
      while (i < messages.length && messages[i].role === 'tool') {
        const tm = messages[i];
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tm.tool_call_id,
          content: tm.content,
        });
        i++;
      }
      i--; // compensate for the outer for-loop's i++
      out.push({ role: 'user', content: toolResults });
    }
  }

  return { systemPrompt, anthropicMessages: out };
}

// ── Stream parser ─────────────────────────────────────────────────────────────

/**
 * Parse the Anthropic SSE stream, handling text, thinking, and tool-use blocks.
 *
 * Anthropic's streaming format uses a content-block model:
 *   content_block_start  → declares the block type (text | thinking | tool_use)
 *   content_block_delta  → incremental content for the current block
 *   content_block_stop   → block is complete; finalise and emit
 *
 * Multiple blocks can appear in a single message (e.g. thinking → text →
 * tool_use × N with interleaved thinking).
 */
async function parseAnthropicStream(
  res: Response,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void,
): Promise<{ content: string; tool_calls: ToolCallRecord[] }> {
  let fullText = '';
  const toolCalls: ToolCallRecord[] = [];

  // Current block state — reset on every content_block_start
  type BlockType = 'text' | 'thinking' | 'tool_use' | 'other';
  let blockType: BlockType = 'other';
  let currentToolId = '';
  let currentToolName = '';
  let currentToolArgs = '';
  let currentThinkingText = '';

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!; // keep any incomplete line for the next chunk

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      let event: Record<string, unknown>;
      try { event = JSON.parse(data); } catch { continue; }

      const eventType = event.type as string;

      // ── Block start: identify what kind of block is opening ──────────────
      if (eventType === 'content_block_start') {
        const block = event.content_block as Record<string, unknown>;
        const type = block?.type as string;

        if (type === 'thinking') {
          blockType = 'thinking';
          currentThinkingText = '';
        } else if (type === 'tool_use') {
          blockType = 'tool_use';
          currentToolId   = (block.id as string)   ?? '';
          currentToolName = (block.name as string)  ?? '';
          currentToolArgs = '';
        } else {
          // text or unknown
          blockType = type === 'text' ? 'text' : 'other';
        }
        continue;
      }

      // ── Block delta: accumulate incremental content ───────────────────────
      if (eventType === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown>;
        const deltaType = delta?.type as string;

        if (deltaType === 'text_delta') {
          const text = (delta.text as string) ?? '';
          fullText += text;
          onDelta(text);
        } else if (deltaType === 'thinking_delta' && blockType === 'thinking') {
          currentThinkingText += (delta.thinking as string) ?? '';
        } else if (deltaType === 'input_json_delta' && blockType === 'tool_use') {
          currentToolArgs += (delta.partial_json as string) ?? '';
        }
        continue;
      }

      // ── Block stop: finalise and emit ─────────────────────────────────────
      if (eventType === 'content_block_stop') {
        if (blockType === 'thinking') {
          if (currentThinkingText && onThinking) {
            onThinking(currentThinkingText);
          }
          currentThinkingText = '';
        } else if (blockType === 'tool_use' && currentToolId) {
          toolCalls.push({
            id: currentToolId,
            name: currentToolName,
            arguments: currentToolArgs,
          });
          currentToolId   = '';
          currentToolName = '';
          currentToolArgs = '';
        }
        blockType = 'other';
        continue;
      }
      // message_start, message_delta, message_stop, ping — intentionally ignored
    }
  }

  return { content: fullText, tool_calls: toolCalls };
}
