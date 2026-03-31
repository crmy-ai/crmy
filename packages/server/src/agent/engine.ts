// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import { getAllTools, type ToolDef } from '../mcp/server.js';
import { enforceToolScopes } from '../auth/scopes.js';
import { decrypt } from './crypto.js';
import { callAnthropic } from './providers/anthropic.js';
import { callOpenAICompat } from './providers/openai-compat.js';
import { logToolCall } from '../db/repos/agent-activity.js';
import type {
  AgentConfig,
  AgentEvent,
  AgentToolDef,
  ConversationMessage,
  ToolCallRecord,
} from './types.js';

const MAX_TOOL_ROUNDS = 10; // prevent runaway loops

/**
 * Derive the actor scopes the agent is allowed to use based on its config.
 * Read scopes are always granted. Write scopes depend on config toggles.
 */
function buildAgentScopes(config: AgentConfig): string[] {
  const scopes = ['read', 'contacts:read', 'accounts:read', 'opportunities:read', 'activities:read', 'context:read'];

  if (config.can_write_objects) {
    scopes.push('contacts:write', 'accounts:write', 'opportunities:write', 'write');
  }
  if (config.can_log_activities) {
    scopes.push('activities:write');
  }
  if (config.can_create_assignments) {
    scopes.push('assignments:create', 'assignments:update');
  }
  // Context writing is always allowed — the agent should be able to add context
  scopes.push('context:write');

  return scopes;
}

/**
 * Convert CRM MCP tools into the provider-agnostic AgentToolDef format,
 * filtering to only tools the agent is allowed to call.
 */
function getAvailableTools(db: DbPool, scopes: string[]): { defs: AgentToolDef[]; handlers: Map<string, ToolDef> } {
  const allTools = getAllTools(db);
  const defs: AgentToolDef[] = [];
  const handlers = new Map<string, ToolDef>();

  // Build a fake actor to test scope access
  const testActor: ActorContext = {
    tenant_id: '',
    actor_id: '',
    actor_type: 'agent',
    role: 'member',
    scopes,
  };

  for (const tool of allTools) {
    try {
      enforceToolScopes(tool.name, testActor);
    } catch {
      continue; // agent doesn't have this scope
    }

    defs.push({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.inputSchema),
    });
    handlers.set(tool.name, tool);
  }

  return { defs, handlers };
}

/**
 * Minimal Zod-to-JSON-Schema converter for tool input schemas.
 * Handles the ZodObject shapes used by CRMy tools.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToJsonSchema(schema: any): Record<string, unknown> {
  // If the schema has a _def, it's a Zod schema
  if (schema?._def) {
    const def = schema._def;
    const typeName = def.typeName;

    if (typeName === 'ZodObject') {
      const shape = schema.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, val] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(val);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((val as any)?._def?.typeName !== 'ZodOptional') {
          required.push(key);
        }
      }

      return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
    }

    if (typeName === 'ZodString') return { type: 'string' };
    if (typeName === 'ZodNumber') return { type: 'number' };
    if (typeName === 'ZodBoolean') return { type: 'boolean' };
    if (typeName === 'ZodEnum') return { type: 'string', enum: def.values };
    if (typeName === 'ZodArray') return { type: 'array', items: zodToJsonSchema(def.type) };

    if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
      return zodToJsonSchema(def.innerType);
    }

    if (typeName === 'ZodDefault') {
      return zodToJsonSchema(def.innerType);
    }

    if (typeName === 'ZodRecord') {
      return { type: 'object', additionalProperties: true };
    }

    if (typeName === 'ZodUnion' || typeName === 'ZodDiscriminatedUnion') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options = (def.options ?? []).map((o: any) => zodToJsonSchema(o));
      return { anyOf: options };
    }

    if (typeName === 'ZodLiteral') {
      return { type: typeof def.value, const: def.value };
    }
  }

  // Fallback
  return { type: 'string' };
}

/**
 * Run a single agent turn: send user message → LLM → tool calls → loop → final response.
 *
 * @param history  The existing conversation messages (will be mutated with new messages).
 * @param config   Tenant agent config.
 * @param actor    Authenticated user making the request.
 * @param db       Database pool.
 * @param onEvent  Callback for streaming SSE events to the client.
 * @returns        Updated messages array.
 */
export async function runAgentTurn(
  history: ConversationMessage[],
  config: AgentConfig,
  actor: ActorContext,
  db: DbPool,
  onEvent: (event: AgentEvent) => void,
  opts?: { sessionId?: string },
): Promise<ConversationMessage[]> {
  const apiKey = config.api_key_enc ? decrypt(config.api_key_enc).trim() : '';
  const agentScopes = buildAgentScopes(config);
  const { defs: toolDefs, handlers } = getAvailableTools(db, agentScopes);

  // Build the agent actor context (used when executing tools)
  const agentActor: ActorContext = {
    tenant_id: actor.tenant_id,
    actor_id: actor.actor_id, // attribute actions to the requesting user
    actor_type: 'user',
    role: actor.role,
    scopes: agentScopes,
  };

  // Ensure system prompt is at the front
  if (history.length === 0 || history[0].role !== 'system') {
    const sysPrompt = config.system_prompt ??
      'You are a CRM assistant. You have access to tools for managing contacts, accounts, opportunities, activities, and more. Be concise and accurate. Always confirm before making changes.';
    history.unshift({ role: 'system', content: sysPrompt });
  }

  const sessionId = opts?.sessionId;
  let turnIndex = 0;

  // Agent loop: LLM call → tool execution → repeat
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let result: { content: string; tool_calls: ToolCallRecord[] };

    const callLLM = config.provider === 'anthropic' ? callAnthropic : callOpenAICompat;
    const key = config.provider === 'ollama' ? null : apiKey;

    try {
      result = await callLLM(
        history,
        toolDefs,
        config,
        key as string,
        (text) => onEvent({ type: 'delta', content: text }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'LLM call failed';
      onEvent({ type: 'error', message });
      throw err;
    }

    // No tool calls — we're done
    if (!result.tool_calls.length) {
      history.push({ role: 'assistant', content: result.content });
      return history;
    }

    // Record the assistant message with tool calls
    history.push({
      role: 'assistant',
      content: result.content,
      tool_calls: result.tool_calls,
    });

    // Execute each tool call
    for (const tc of result.tool_calls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }

      onEvent({ type: 'tool_call', id: tc.id, name: tc.name, arguments: args });

      const handler = handlers.get(tc.name);
      let toolResult: unknown;
      let isError = false;
      const callStart = Date.now();

      if (!handler) {
        toolResult = { error: `Unknown tool: ${tc.name}` };
        isError = true;
      } else {
        try {
          toolResult = await handler.handler(args, agentActor);
        } catch (err) {
          toolResult = { error: err instanceof Error ? err.message : 'Tool execution failed' };
          isError = true;
        }
      }

      const durationMs = Date.now() - callStart;

      // Fire-and-forget activity log
      if (sessionId) {
        logToolCall(db, {
          tenantId: actor.tenant_id,
          sessionId,
          userId: actor.actor_id,
          turnIndex: turnIndex++,
          toolName: tc.name,
          toolArgs: args,
          toolResult,
          isError,
          durationMs,
        }).catch((err) => console.error('[agent-activity] logToolCall error:', err));
      }

      const resultStr = JSON.stringify(toolResult, null, 2);
      onEvent({ type: 'tool_result', id: tc.id, name: tc.name, result: toolResult, is_error: isError });

      history.push({
        role: 'tool',
        content: resultStr,
        tool_call_id: tc.id,
        tool_name: tc.name,
      });
    }
  }

  // If we exhausted MAX_TOOL_ROUNDS, add an error
  history.push({
    role: 'assistant',
    content: 'I reached the maximum number of tool calls for this turn. Please try a more specific request.',
  });

  return history;
}
