// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Provider and model definitions for the Workspace Agent.
 * Provider defaults for the Workspace Agent.
 *
 * Do not maintain static model menus here. Provider model catalogs change too
 * quickly, and stale model lists make setup feel broken. AgentSettings asks the
 * admin to paste the exact model ID from their provider or local runtime, then
 * the server verifies that the model is reachable and supports tool calls.
 */

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'ollama' | 'custom';

export interface ModelDef {
  id: string;
  label: string;
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  baseUrl: string;
  /** Tailwind bg-* class for the provider colour dot */
  dotColor: string;
  /** Whether an API key is required (hidden for Ollama / local models) */
  requiresKey: boolean;
  models: ModelDef[];
  /**
   * Whether this provider emits extended reasoning / thinking blocks.
   * Only Anthropic supports this — via the `thinking` API parameter and
   * interleaved-thinking beta. All other providers should show a notice.
   */
  supportsThinking: boolean;
  /**
   * Whether the provider uses Anthropic's Messages API format (`/messages`).
   * False = OpenAI-compatible format (`/chat/completions`).
   * The server routes to the correct provider implementation based on the
   * `provider` field stored in the agent config.
   */
  isAnthropicFormat: boolean;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    dotColor: 'bg-orange-400',
    requiresKey: true,
    isAnthropicFormat: true,
  supportsThinking: true,
    models: [],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    dotColor: 'bg-green-500',
    requiresKey: true,
    isAnthropicFormat: false,
    supportsThinking: false,
    models: [],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    dotColor: 'bg-violet-500',
    requiresKey: true,
    isAnthropicFormat: false,
    supportsThinking: false,
    models: [],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    dotColor: 'bg-blue-400',
    requiresKey: false,
    isAnthropicFormat: false,
    supportsThinking: false,
    models: [],
  },
  {
    id: 'custom',
    label: 'Custom / Other (OpenAI-compatible)',
    baseUrl: '',
    dotColor: 'bg-slate-400',
    requiresKey: false,
    isAnthropicFormat: false,
    supportsThinking: false,
    models: [],
  },
];

/** Sentinel value used in the model <Select> to represent a user-typed custom model. */
export const CUSTOM_MODEL_SENTINEL = '__custom__';

export function getProvider(id: ProviderId | string): ProviderDef {
  return PROVIDERS.find(p => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}
