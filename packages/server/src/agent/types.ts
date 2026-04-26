// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/** Persisted agent config (one per tenant). */
export interface AgentConfig {
  id: string;
  tenant_id: string;
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'openrouter' | 'ollama' | 'custom';
  base_url: string;
  api_key_enc: string | null;
  model: string;
  system_prompt: string | null;
  max_tokens_per_turn: number;
  history_retention_days: number;
  can_write_objects: boolean;
  can_log_activities: boolean;
  can_create_assignments: boolean;
  auto_extract_context: boolean;
}

/** A single message in a conversation. */
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present when role === 'assistant' and the model invoked tools. */
  tool_calls?: ToolCallRecord[];
  /** Present when role === 'tool' — the result of a specific tool call. */
  tool_call_id?: string;
  tool_name?: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: string; // JSON string
}

/** Persisted session row. */
export interface AgentSession {
  id: string;
  tenant_id: string;
  user_id: string;
  label: string | null;
  context_type: string | null;
  context_id: string | null;
  context_name: string | null;
  messages: ConversationMessage[];
  token_count: number;
  created_at: string;
  updated_at: string;
}

/** SSE events emitted during a chat turn. */
export type AgentEvent =
  | { type: 'delta'; content: string }
  /** Human-readable status line emitted immediately before tool execution.
   *  turn_id groups all tool calls from the same agent loop round so the UI
   *  can collapse them into a single collapsible "Working…" row. */
  | { type: 'tool_status'; id: string; name: string; status: string; turn_id: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown>; turn_id: string }
  | { type: 'tool_result'; id: string; name: string; result: unknown; is_error: boolean; turn_id: string }
  | { type: 'done'; session_id: string; label: string | null }
  | { type: 'error'; message: string };

/** Tool definition passed to providers (provider-agnostic shape). */
export interface AgentToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}
