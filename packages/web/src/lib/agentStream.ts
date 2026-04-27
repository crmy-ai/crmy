// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared streaming helpers and types for the workspace agent.
 * Extracted here so they can be reused across components without circular deps.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** turn_id groups all tool calls from the same agent loop round */
export type DisplayMessage =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; content: string }
  /** Extended reasoning block from thinking-capable models (e.g. claude-3-7-sonnet). */
  | { kind: 'thinking'; content: string; turn_id: string }
  | { kind: 'tool_status'; id: string; name: string; status: string; turn_id: string }
  | { kind: 'tool_call'; id: string; name: string; arguments: Record<string, unknown>; turn_id: string }
  | { kind: 'tool_result'; id: string; name: string; is_error: boolean; result?: unknown; turn_id: string }
  | { kind: 'error'; message: string };

export type SSEEvent =
  | { type: 'delta'; content: string }
  | { type: 'thinking'; content: string; turn_id: string }
  | { type: 'tool_status'; id: string; name: string; status: string; turn_id: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown>; turn_id: string }
  | { type: 'tool_result'; id: string; name: string; result: unknown; is_error: boolean; turn_id: string }
  | { type: 'done'; session_id: string; label: string | null }
  | { type: 'error'; message: string };

/** A single resolved tool step, enriched with its call arguments and result. */
export type ToolGroupStep = {
  id: string;
  name: string;
  status: string;
  turn_id: string;
  arguments?: Record<string, unknown>; // populated from tool_call event
  result?: unknown;                     // populated from tool_result event
  is_error?: boolean;
};

export type ToolGroupItem = {
  kind: 'tool_group';
  turn_id: string;
  steps: ToolGroupStep[];
};
export type RenderItem = DisplayMessage | ToolGroupItem;

// ── Constants ─────────────────────────────────────────────────────────────────

/** Prefix for internal auto-greet prompts. Filtered out of displayed history. */
export const SYSTEM_INIT_PREFIX = '[SYSTEM_INIT]';

// ── SSE stream helper ─────────────────────────────────────────────────────────

export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal,
  opts?: { auto_greet?: boolean },
): Promise<void> {
  const token = localStorage.getItem('crmy_token');
  const res = await fetch(`/api/v1/agent/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, ...(opts?.auto_greet ? { auto_greet: true } : {}) }),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || body.detail || `HTTP ${res.status}`);
  }

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
      try {
        const event: SSEEvent = JSON.parse(line.slice(6));
        onEvent(event);
      } catch { /* skip malformed */ }
    }
  }
}

// ── Message grouping ──────────────────────────────────────────────────────────

/**
 * Collapse the flat DisplayMessage array into render items.
 * - Consecutive `tool_status` messages sharing the same `turn_id` are grouped into
 *   a single `ToolGroupItem` so the UI shows one collapsible "Working…" row.
 * - `tool_call` and `tool_result` messages are not rendered directly; instead their
 *   arguments and results are attached to the matching step in the last ToolGroupItem
 *   so the expanded ToolGroup can show full call/result details.
 */
export function groupToolMessages(messages: DisplayMessage[]): RenderItem[] {
  const result: RenderItem[] = [];

  const findLastGroup = (): ToolGroupItem | undefined =>
    [...result].reverse().find((r): r is ToolGroupItem => r.kind === 'tool_group');

  for (const msg of messages) {
    if (msg.kind === 'tool_call') {
      // Attach arguments to the matching step in the nearest preceding group
      const group = findLastGroup();
      if (group) {
        const step = group.steps.find(s => s.id === msg.id);
        if (step) step.arguments = msg.arguments;
      }
      continue;
    }

    if (msg.kind === 'tool_result') {
      // Attach result to the matching step
      const group = findLastGroup();
      if (group) {
        const step = group.steps.find(s => s.id === msg.id);
        if (step) { step.result = msg.result; step.is_error = msg.is_error; }
      }
      continue;
    }

    if (msg.kind === 'tool_status') {
      const last = result[result.length - 1];
      if (last?.kind === 'tool_group' && last.turn_id === msg.turn_id) {
        const existingIdx = last.steps.findIndex(s => s.id === msg.id);
        const step: ToolGroupStep = { id: msg.id, name: msg.name, status: msg.status, turn_id: msg.turn_id };
        if (existingIdx >= 0) {
          // Preserve arguments/result if already attached, only update status
          last.steps[existingIdx] = { ...last.steps[existingIdx], ...step };
        } else {
          last.steps.push(step);
        }
      } else {
        result.push({
          kind: 'tool_group',
          turn_id: msg.turn_id,
          steps: [{ id: msg.id, name: msg.name, status: msg.status, turn_id: msg.turn_id }],
        });
      }
      continue;
    }

    result.push(msg);
  }
  return result;
}

// ── Entity-aware suggestion chips ─────────────────────────────────────────────

export function getSuggestions(entityType: string | null, entityName: string | null): string[] {
  if (!entityType || !entityName) return [
    'Summarize my pipeline',
    'Deals needing attention',
    'Create a contact',
    'My open assignments',
  ];
  const n = entityName;
  switch (entityType) {
    case 'contact':     return [`Log a call with ${n}`, 'Draft a follow-up email', 'Update lifecycle stage', 'Check active sequences'];
    case 'account':     return [`Account health for ${n}`, 'Open opportunities', 'List use cases', 'Recent activities'];
    case 'opportunity': return ['Advance to next stage', 'Log a touchpoint', 'Summarize deal history', 'Assign a follow-up'];
    case 'use-case':    return ['Update health score', 'Recent activities', 'Log a check-in', 'List linked contacts'];
    default:            return ['Summarize my pipeline', 'Deals needing attention', 'Create a contact', 'My open assignments'];
  }
}
