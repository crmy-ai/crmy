// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Provider and model definitions for the Local Workspace Agent.
 * Add new providers here — AgentSettings.tsx picks them up automatically.
 *
 * Model IDs must match the provider's API exactly.
 * Verify against provider docs when updating:
 *   Anthropic  → https://docs.anthropic.com/en/docs/about-claude/models
 *   OpenAI     → https://platform.openai.com/docs/models
 *   OpenRouter → https://openrouter.ai/models
 *   Ollama     → https://ollama.com/library
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
  /** Whether an API key is required (hidden for Ollama) */
  requiresKey: boolean;
  models: ModelDef[];
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    dotColor: 'bg-orange-400',
    requiresKey: true,
    models: [
      { id: 'claude-opus-4-20250514',    label: 'Claude Opus 4' },
      { id: 'claude-sonnet-4-20250514',  label: 'Claude Sonnet 4' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    dotColor: 'bg-green-500',
    requiresKey: true,
    models: [
      { id: 'gpt-4o',      label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'o3-mini',     label: 'o3-mini' },
      { id: 'o1',          label: 'o1' },
      { id: 'o1-mini',     label: 'o1-mini' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    dotColor: 'bg-violet-500',
    requiresKey: true,
    models: [
      { id: 'openrouter/auto',                    label: 'Auto (best available)' },
      { id: 'anthropic/claude-sonnet-4',          label: 'Claude Sonnet 4' },
      { id: 'anthropic/claude-opus-4',            label: 'Claude Opus 4' },
      { id: 'openai/gpt-4o',                      label: 'GPT-4o' },
      { id: 'google/gemini-2.0-flash',            label: 'Gemini 2.0 Flash' },
      { id: 'deepseek/deepseek-chat',             label: 'DeepSeek V3' },
      { id: 'meta-llama/llama-3.3-70b-instruct',  label: 'Llama 3.3 70B' },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    dotColor: 'bg-blue-400',
    requiresKey: false,
    models: [
      { id: 'llama3.2',     label: 'Llama 3.2 (8B)' },
      { id: 'llama3.2:1b',  label: 'Llama 3.2 (1B)' },
      { id: 'mistral',      label: 'Mistral 7B' },
      { id: 'phi3',         label: 'Phi-3 Mini' },
      { id: 'codellama',    label: 'Code Llama' },
      { id: 'gemma2',       label: 'Gemma 2 (9B)' },
      { id: 'deepseek-r1',  label: 'DeepSeek R1' },
    ],
  },
  {
    id: 'custom',
    label: 'Custom / Other',
    baseUrl: '',
    dotColor: 'bg-slate-400',
    requiresKey: false,
    models: [],
  },
];

/** Sentinel value used in the model <Select> to represent a user-typed custom model. */
export const CUSTOM_MODEL_SENTINEL = '__custom__';

export function getProvider(id: ProviderId | string): ProviderDef {
  return PROVIDERS.find(p => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}
