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
 *
 * Pricing is in USD per million tokens (input / output).
 * Set to undefined for local/free models or models with variable pricing.
 * Prices are approximate and may lag behind provider announcements.
 */

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'ollama' | 'custom';

export interface ModelDef {
  id: string;
  label: string;
  /** USD per million INPUT tokens. Undefined = free / unknown / variable. */
  inputPricePerM?: number;
  /** USD per million OUTPUT tokens. Undefined = free / unknown / variable. */
  outputPricePerM?: number;
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
      { id: 'claude-opus-4-20250514',    label: 'Claude Opus 4',    inputPricePerM: 15,   outputPricePerM: 75   },
      { id: 'claude-sonnet-4-20250514',  label: 'Claude Sonnet 4',  inputPricePerM: 3,    outputPricePerM: 15   },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', inputPricePerM: 0.80, outputPricePerM: 4    },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    dotColor: 'bg-green-500',
    requiresKey: true,
    models: [
      { id: 'gpt-4o',      label: 'GPT-4o',       inputPricePerM: 2.50,  outputPricePerM: 10   },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini',  inputPricePerM: 0.15,  outputPricePerM: 0.60 },
      { id: 'o3-mini',     label: 'o3-mini',       inputPricePerM: 1.10,  outputPricePerM: 4.40 },
      { id: 'o1',          label: 'o1',            inputPricePerM: 15,    outputPricePerM: 60   },
      { id: 'o1-mini',     label: 'o1-mini',       inputPricePerM: 3,     outputPricePerM: 12   },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    dotColor: 'bg-violet-500',
    requiresKey: true,
    models: [
      // Pricing is fetched live from openrouter.ai/api/v1/models when this provider is active.
      // Fallback static prices are provided here for offline / initial render.
      { id: 'openrouter/auto',                    label: 'Auto (best available)'                                                      },
      { id: 'anthropic/claude-sonnet-4',          label: 'Claude Sonnet 4',   inputPricePerM: 3,    outputPricePerM: 15   },
      { id: 'anthropic/claude-opus-4',            label: 'Claude Opus 4',     inputPricePerM: 15,   outputPricePerM: 75   },
      { id: 'openai/gpt-4o',                      label: 'GPT-4o',            inputPricePerM: 2.50, outputPricePerM: 10   },
      { id: 'google/gemini-2.0-flash',            label: 'Gemini 2.0 Flash',  inputPricePerM: 0.10, outputPricePerM: 0.40 },
      { id: 'deepseek/deepseek-chat',             label: 'DeepSeek V3',       inputPricePerM: 0.27, outputPricePerM: 1.10 },
      { id: 'meta-llama/llama-3.3-70b-instruct',  label: 'Llama 3.3 70B',    inputPricePerM: 0.12, outputPricePerM: 0.30 },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    dotColor: 'bg-blue-400',
    requiresKey: false,
    models: [
      // Ollama runs locally — no token cost.
      { id: 'llama3.2',     label: 'Llama 3.2 (8B)',  inputPricePerM: 0, outputPricePerM: 0 },
      { id: 'llama3.2:1b',  label: 'Llama 3.2 (1B)',  inputPricePerM: 0, outputPricePerM: 0 },
      { id: 'mistral',      label: 'Mistral 7B',       inputPricePerM: 0, outputPricePerM: 0 },
      { id: 'phi3',         label: 'Phi-3 Mini',       inputPricePerM: 0, outputPricePerM: 0 },
      { id: 'codellama',    label: 'Code Llama',       inputPricePerM: 0, outputPricePerM: 0 },
      { id: 'gemma2',       label: 'Gemma 2 (9B)',     inputPricePerM: 0, outputPricePerM: 0 },
      { id: 'deepseek-r1',  label: 'DeepSeek R1',      inputPricePerM: 0, outputPricePerM: 0 },
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

/** Look up static pricing for a known model. Returns undefined if not found. */
export function getModelPricing(provider: string, modelId: string): { inputPricePerM: number; outputPricePerM: number } | undefined {
  const prov = getProvider(provider);
  const model = prov.models.find(m => m.id === modelId);
  if (!model || model.inputPricePerM === undefined || model.outputPricePerM === undefined) return undefined;
  return { inputPricePerM: model.inputPricePerM, outputPricePerM: model.outputPricePerM };
}
