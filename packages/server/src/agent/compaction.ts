// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Automatic context compaction for agent sessions.
 *
 * Problem: the full `history[]` is sent to the LLM every turn. As a session
 * accumulates tool calls, the raw JSON results (briefing_get, context_search,
 * etc.) can push the payload well past 100 K tokens, causing 4xx errors and
 * degraded coherence as the model struggles to attend to a huge context.
 *
 * Solution (two layers):
 *
 * 1. `trimForPersistence` — called after each turn before writing to the DB.
 *    Caps stored tool results at TOOL_RESULT_MAX_CHARS characters so that
 *    the history loaded on the next turn is already lean. The LLM already
 *    acted on the full result; the trimmed version is sufficient for future
 *    context.
 *
 * 2. `compactHistory` — called at the start of a turn when the total history
 *    size exceeds COMPACT_THRESHOLD_CHARS. It makes a lightweight summarisation
 *    LLM call to distil the *older* portion of the conversation into a
 *    structured bullet-point summary, then splices that summary in place of
 *    the old messages. The most recent COMPACT_KEEP_RECENT messages are kept
 *    verbatim so the agent has full fidelity on what just happened.
 *
 * Compacted messages are marked with COMPACT_SUMMARY_PREFIX / COMPACT_ACK_PREFIX
 * so the frontend can filter them from the visible chat history.
 */

import type { ConversationMessage, AgentConfig } from './types.js';
import { callAnthropic } from './providers/anthropic.js';
import { callOpenAICompat } from './providers/openai-compat.js';
import { decrypt } from './crypto.js';

// ── Thresholds ────────────────────────────────────────────────────────────────

/**
 * Total character count above which we compact. ~120 K chars ≈ 30 K tokens —
 * safely inside the 200 K token context window while leaving ample headroom for
 * the system prompt, tool definitions, and the current turn's output.
 */
export const COMPACT_THRESHOLD_CHARS = 120_000;

/**
 * Number of non-system messages to keep verbatim after compaction.
 * 12 messages ≈ 6 full user/assistant turns — recent enough to stay coherent.
 */
const COMPACT_KEEP_RECENT = 12;

/**
 * Maximum characters for a stored tool result. Trimmed during persistence.
 * The LLM has already processed the full result; future turns only need the gist.
 */
const TOOL_RESULT_MAX_CHARS = 6_000;

/** Prefix used to mark a compacted-context user message. Filtered by the frontend. */
export const COMPACT_SUMMARY_PREFIX = '[COMPACTED_CONTEXT]';

/** Prefix used to mark the agent's acknowledgement of a compacted context. Filtered by the frontend. */
export const COMPACT_ACK_PREFIX = '[COMPACT_ACK]';

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Character count of a single message (content + serialised tool calls). */
function msgChars(m: ConversationMessage): number {
  let n = m.content?.length ?? 0;
  if (m.tool_calls) n += JSON.stringify(m.tool_calls).length;
  return n;
}

/** Total character count of all messages in the history. */
export function estimateHistoryChars(messages: ConversationMessage[]): number {
  return messages.reduce((sum, m) => sum + msgChars(m), 0);
}

/** True when the history is large enough to warrant compaction. */
export function needsCompaction(messages: ConversationMessage[]): boolean {
  return estimateHistoryChars(messages) > COMPACT_THRESHOLD_CHARS;
}

// ── Persistence trimming ──────────────────────────────────────────────────────

/**
 * Return a copy of `messages` with tool results capped at TOOL_RESULT_MAX_CHARS.
 * Call this before writing the updated history back to the database so that
 * subsequent turns start with a leaner payload.
 */
export function trimForPersistence(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.map(m => {
    if (m.role !== 'tool') return m;
    if ((m.content?.length ?? 0) <= TOOL_RESULT_MAX_CHARS) return m;
    return {
      ...m,
      content: m.content.slice(0, TOOL_RESULT_MAX_CHARS) + '\n…[trimmed for context window]',
    };
  });
}

// ── Compaction ────────────────────────────────────────────────────────────────

/**
 * Compact `messages` so the history fits inside the context window.
 *
 * Steps:
 *   1. Identify the split point: keep the last COMPACT_KEEP_RECENT non-system
 *      messages verbatim; summarise everything before them.
 *   2. Make a lightweight LLM call (no tools, low max_tokens) to produce a
 *      structured bullet-point summary of the older portion.
 *   3. Replace the old messages with a [COMPACTED_CONTEXT] user message and a
 *      [COMPACT_ACK] assistant acknowledgement, then append the recent verbatim
 *      messages.
 *
 * If the LLM summarisation call fails, a simple fallback summary is used so
 * the turn can still proceed.
 *
 * @param messages   Full conversation history (may be mutated internally).
 * @param config     Tenant agent config (used to call the same LLM provider).
 * @returns          Compacted message array, always shorter than the input.
 */
export async function compactHistory(
  messages: ConversationMessage[],
  config: AgentConfig,
): Promise<ConversationMessage[]> {
  const systemMsg = messages.find(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');

  // Not enough messages to compact meaningfully
  if (nonSystem.length <= COMPACT_KEEP_RECENT + 2) return messages;

  const cutpoint = nonSystem.length - COMPACT_KEEP_RECENT;
  const toSummarise = nonSystem.slice(0, cutpoint);
  const toKeep = nonSystem.slice(cutpoint);

  const summaryText = await summarise(toSummarise, config);

  const compacted: ConversationMessage[] = [];
  if (systemMsg) compacted.push(systemMsg);

  compacted.push({
    role: 'user',
    content:
      `${COMPACT_SUMMARY_PREFIX}\n` +
      `The following is a structured summary of the earlier portion of this conversation ` +
      `that has been compacted to stay within context limits. ` +
      `All key facts, record IDs, decisions, and completed actions are preserved below.\n\n` +
      summaryText +
      `\n[END_COMPACTED_CONTEXT]`,
  });

  compacted.push({
    role: 'assistant',
    content:
      `${COMPACT_ACK_PREFIX} I have the summary of our earlier work and will continue ` +
      `seamlessly from where we left off.`,
  });

  compacted.push(...toKeep);
  return compacted;
}

// ── Internal: LLM summarisation call ─────────────────────────────────────────

async function summarise(
  messages: ConversationMessage[],
  config: AgentConfig,
): Promise<string> {
  const promptText = buildSummaryPrompt(messages);

  const summaryHistory: ConversationMessage[] = [
    {
      role: 'system',
      content:
        'You are a precise context summariser for a CRM AI assistant. ' +
        'Produce a concise, factual bullet-point summary of the conversation segment provided. ' +
        'You MUST include: what the user asked for, all CRM records accessed or modified ' +
        '(with names AND IDs), key findings or decisions, and any unresolved items. ' +
        'Be specific — never omit IDs or exact values. Max 500 words.',
    },
    { role: 'user', content: promptText },
  ];

  // Lightweight call: low token budget, no tools.
  const compactConfig: AgentConfig = { ...config, max_tokens_per_turn: 1000 };
  const apiKey = config.api_key_enc ? decrypt(config.api_key_enc).trim() : '';

  let summaryText = '';
  try {
    if (config.provider === 'anthropic') {
      // Thinking explicitly disabled — no reasoning budget needed for summarisation.
      const result = await callAnthropic(
        summaryHistory,
        [],            // no tools needed for summarisation
        compactConfig,
        apiKey,
        (delta) => { summaryText += delta; },
        undefined,                  // no thinking callback
        { enableThinking: false },  // never use reasoning budget here
      );
      return result.content || summaryText;
    } else {
      // OpenAI-compatible path (OpenAI, OpenRouter, Ollama, custom)
      const result = await callOpenAICompat(
        summaryHistory,
        [],
        compactConfig,
        apiKey || null,
        (delta) => { summaryText += delta; },
      );
      return result.content || summaryText;
    }
  } catch {
    return buildFallbackSummary(messages);
  }
}

function buildSummaryPrompt(messages: ConversationMessage[]): string {
  const lines: string[] = [
    'Summarise the following conversation segment. Include every CRM record name and ID mentioned.',
    '',
    '--- SEGMENT ---',
    '',
  ];

  for (const m of messages) {
    if (m.role === 'user') {
      const preview = m.content.startsWith(COMPACT_SUMMARY_PREFIX)
        ? '[Earlier compacted context — already summarised]'
        : m.content.slice(0, 600);
      lines.push(`USER: ${preview}`);
    } else if (m.role === 'assistant') {
      if (m.content?.startsWith(COMPACT_ACK_PREFIX)) continue; // skip our own ack
      if (m.content) lines.push(`ASSISTANT: ${m.content.slice(0, 600)}`);
      if (m.tool_calls?.length) {
        lines.push(`  (called tools: ${m.tool_calls.map(tc => tc.name).join(', ')})`);
      }
    } else if (m.role === 'tool') {
      const preview = m.content?.slice(0, 400) ?? '';
      const ellipsis = (m.content?.length ?? 0) > 400 ? '…' : '';
      lines.push(`  TOOL RESULT (${m.tool_name ?? 'unknown'}): ${preview}${ellipsis}`);
    }
    lines.push('');
  }

  lines.push('--- END SEGMENT ---');
  return lines.join('\n');
}

function buildFallbackSummary(messages: ConversationMessage[]): string {
  const userLines = messages
    .filter(m => m.role === 'user' && !m.content.startsWith(COMPACT_SUMMARY_PREFIX))
    .map(m => `• ${m.content.slice(0, 120)}`)
    .slice(0, 8);

  const toolNames = [
    ...new Set(
      messages
        .filter(m => m.role === 'tool')
        .map(m => m.tool_name)
        .filter(Boolean),
    ),
  ];

  return [
    '**Summary of earlier conversation (automated fallback):**',
    '',
    'User messages discussed:',
    ...userLines,
    '',
    toolNames.length ? `Tools used: ${toolNames.join(', ')}` : '',
  ]
    .filter(l => l !== undefined)
    .join('\n');
}
