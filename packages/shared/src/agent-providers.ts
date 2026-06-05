// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Centrally maintained Workspace Agent provider catalog.
 *
 * These model IDs are curated starting points, not an exhaustive provider
 * catalog. Every surface must keep a custom model path because provider
 * catalogs and local runtimes change faster than CRMy releases.
 */

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'azure_openai'
  | 'google_gemini'
  | 'aws_bedrock'
  | 'mistral'
  | 'litellm'
  | 'openrouter'
  | 'ollama'
  | 'databricks'
  | 'nvidia_nim'
  | 'custom';

export type ProviderRuntime = 'anthropic' | 'openai-compatible';
export type ProviderCategory = 'hosted' | 'gateway' | 'local' | 'custom';

export interface ModelDef {
  id: string;
  label: string;
  description?: string;
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  baseUrl: string;
  dotColor: string;
  requiresKey: boolean;
  keyLabel: string;
  modelLabel: string;
  baseUrlPlaceholder: string;
  setupHint: string;
  models: ModelDef[];
  supportsThinking: boolean;
  isAnthropicFormat: boolean;
  runtime: ProviderRuntime;
  category: ProviderCategory;
}

export const CUSTOM_MODEL_SENTINEL = '__custom__';

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    dotColor: 'bg-orange-400',
    requiresKey: true,
    keyLabel: 'Anthropic API key',
    modelLabel: 'Model ID',
    baseUrlPlaceholder: 'https://api.anthropic.com/v1',
    setupHint: 'Use an Anthropic API key. CRMy calls the native Messages API for Claude models.',
    isAnthropicFormat: true,
    runtime: 'anthropic',
    category: 'hosted',
    supportsThinking: true,
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
        description: 'Recommended balance for Workspace Agent use.',
      },
      {
        id: 'claude-opus-4-20250514',
        label: 'Claude Opus 4',
        description: 'Higher reasoning capability when latency/cost are acceptable.',
      },
      {
        id: 'claude-3-5-haiku-20241022',
        label: 'Claude Haiku 3.5',
        description: 'Fast, lower-cost option for lightweight tasks.',
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    dotColor: 'bg-green-500',
    requiresKey: true,
    keyLabel: 'OpenAI API key',
    modelLabel: 'Model ID',
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    setupHint: 'Use an OpenAI API key. CRMy verifies Chat Completions tool calling before saving.',
    isAnthropicFormat: false,
    runtime: 'openai-compatible',
    category: 'hosted',
    supportsThinking: false,
    models: [
      {
        id: 'gpt-5.2',
        label: 'GPT-5.2',
        description: 'Recommended current OpenAI option for agentic tasks.',
      },
      {
        id: 'gpt-5.1',
        label: 'GPT-5.1',
        description: 'Strong reasoning with configurable effort.',
      },
      {
        id: 'gpt-5',
        label: 'GPT-5',
        description: 'Baseline GPT-5 reasoning model.',
      },
      {
        id: 'gpt-5-mini',
        label: 'GPT-5 mini',
        description: 'Lower-latency, lower-cost option.',
      },
    ],
  },
  {
    id: 'azure_openai',
    label: 'Azure OpenAI',
    baseUrl: 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
    dotColor: 'bg-sky-500',
    requiresKey: true,
    keyLabel: 'Azure OpenAI API key',
    modelLabel: 'Deployment name',
    baseUrlPlaceholder: 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
    setupHint: 'Use the Azure OpenAI v1 base URL and your deployment name as the model. Microsoft Entra bearer tokens can be pasted as the key for manual testing.',
    isAnthropicFormat: false,
    runtime: 'openai-compatible',
    category: 'hosted',
    supportsThinking: false,
    models: [],
  },
  {
    id: 'google_gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    dotColor: 'bg-blue-500',
    requiresKey: true,
    keyLabel: 'Gemini API key',
    modelLabel: 'Model ID',
    baseUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta/openai',
    setupHint: 'Uses Gemini’s OpenAI-compatible endpoint so CRMy can keep one tool-calling contract.',
    isAnthropicFormat: false,
    runtime: 'openai-compatible',
    category: 'hosted',
    supportsThinking: true,
    models: [
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'Fast Gemini option with function calling support.',
      },
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        description: 'Higher-capability Gemini option when available on your account.',
      },
    ],
  },
  {
    id: 'aws_bedrock',
    label: 'Amazon Bedrock',
    baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/v1',
    dotColor: 'bg-amber-500',
    requiresKey: true,
    keyLabel: 'Bedrock API key',
    modelLabel: 'Bedrock model ID',
    baseUrlPlaceholder: 'https://bedrock-mantle.<region>.api.aws/v1',
    setupHint: 'Use a Bedrock API key with the bedrock-mantle OpenAI-compatible Chat Completions endpoint. SigV4-only setups should use a gateway for now.',
    isAnthropicFormat: false,
    runtime: 'openai-compatible',
    category: 'hosted',
    supportsThinking: false,
    models: [
      {
        id: 'openai.gpt-oss-120b',
        label: 'GPT OSS 120B on Bedrock',
        description: 'Bedrock Chat Completions example model. Replace with the model enabled in your region.',
      },
      {
        id: 'us.anthropic.claude-sonnet-4-6',
        label: 'Claude Sonnet on Bedrock',
        description: 'Example Bedrock model ID. Replace with your region/account model ID when needed.',
      },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    dotColor: 'bg-rose-500',
    requiresKey: true,
    keyLabel: 'Mistral API key',
    modelLabel: 'Model ID',
    baseUrlPlaceholder: 'https://api.mistral.ai/v1',
    setupHint: 'Uses Mistral’s Chat Completions API and function-calling capable models.',
    isAnthropicFormat: false,
    runtime: 'openai-compatible',
    category: 'hosted',
    supportsThinking: true,
    models: [
      {
        id: 'mistral-large-latest',
        label: 'Mistral Large',
        description: 'General high-capability Mistral option with function calling.',
      },
      {
        id: 'mistral-medium-latest',
        label: 'Mistral Medium',
        description: 'Balanced Mistral option.',
      },
      {
        id: 'mistral-small-latest',
        label: 'Mistral Small',
        description: 'Lower-latency Mistral option.',
      },
    ],
  },
  {
    id: 'litellm',
    label: 'LiteLLM Proxy',
    baseUrl: 'http://localhost:4000/v1',
    dotColor: 'bg-indigo-500',
    requiresKey: false,
    keyLabel: 'LiteLLM virtual key',
    modelLabel: 'Proxy model name',
    baseUrlPlaceholder: 'http://localhost:4000/v1',
    setupHint: 'Use when a team manages routing, spend, and provider credentials through a LiteLLM proxy. Add a virtual key if your proxy requires one.',
    isAnthropicFormat: false,
    runtime: 'openai-compatible',
    category: 'gateway',
    supportsThinking: false,
    models: [],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    dotColor: 'bg-violet-500',
    requiresKey: true,
    keyLabel: 'OpenRouter API key',
    modelLabel: 'Model route',
    baseUrlPlaceholder: 'https://openrouter.ai/api/v1',
    setupHint: 'Use a model route enabled in your OpenRouter account. CRMy sends app headers for attribution.',
    isAnthropicFormat: false,
    runtime: 'openai-compatible',
    category: 'gateway',
    supportsThinking: false,
    models: [
      {
        id: 'anthropic/claude-sonnet-4',
        label: 'Claude Sonnet 4 via OpenRouter',
        description: 'Common OpenRouter route for strong agent work.',
      },
      {
        id: 'openai/gpt-5.2',
        label: 'GPT-5.2 via OpenRouter',
        description: 'Use when available on your OpenRouter account.',
      },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    dotColor: 'bg-blue-400',
    requiresKey: false,
    keyLabel: 'Ollama API key',
    modelLabel: 'Installed model',
    baseUrlPlaceholder: 'http://localhost:11434/v1',
    setupHint: 'Runs locally through Ollama’s OpenAI-compatible endpoint. Tool reliability depends on the installed model.',
    isAnthropicFormat: false,
    runtime: 'openai-compatible',
    category: 'local',
    supportsThinking: false,
    models: [
      {
        id: 'qwen2.5:7b-instruct',
        label: 'Qwen 2.5 7B Instruct',
        description: 'Good local default when installed and tool calling works.',
      },
      {
        id: 'llama3.1:8b',
        label: 'Llama 3.1 8B',
        description: 'Common local option for development.',
      },
    ],
  },
  {
    id: 'databricks',
    label: 'Databricks AI Gateway',
    baseUrl: 'https://YOUR-WORKSPACE.cloud.databricks.com/serving-endpoints',
    dotColor: 'bg-red-500',
    requiresKey: true,
    keyLabel: 'Databricks token',
    modelLabel: 'Served model or endpoint model',
    baseUrlPlaceholder: 'https://YOUR-WORKSPACE.cloud.databricks.com/serving-endpoints',
    setupHint: 'Use your Databricks workspace serving-endpoints base URL and set model to the serving endpoint name. Function calling must be enabled/supported on the endpoint.',
    isAnthropicFormat: false,
    runtime: 'openai-compatible',
    category: 'gateway',
    supportsThinking: false,
    models: [],
  },
  {
    id: 'nvidia_nim',
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    dotColor: 'bg-lime-500',
    requiresKey: true,
    keyLabel: 'NVIDIA API key',
    modelLabel: 'NIM model ID',
    baseUrlPlaceholder: 'https://integrate.api.nvidia.com/v1',
    setupHint: 'Use NVIDIA NIM’s OpenAI-compatible endpoint or your self-hosted NIM base URL.',
    isAnthropicFormat: false,
    runtime: 'openai-compatible',
    category: 'hosted',
    supportsThinking: false,
    models: [
      {
        id: 'meta/llama-3.1-70b-instruct',
        label: 'Llama 3.1 70B Instruct',
        description: 'NIM function-calling example model. Replace with the model exposed by your endpoint.',
      },
      {
        id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
        label: 'Nemotron Super 49B',
        description: 'NVIDIA-hosted NIM model route when available.',
      },
    ],
  },
  {
    id: 'custom',
    label: 'Other OpenAI-compatible',
    baseUrl: '',
    dotColor: 'bg-slate-400',
    requiresKey: false,
    keyLabel: 'API key',
    modelLabel: 'Model ID',
    baseUrlPlaceholder: 'https://your-gateway.example.com/v1',
    setupHint: 'Use any endpoint that implements OpenAI-compatible Chat Completions with tool/function calling.',
    isAnthropicFormat: false,
    runtime: 'openai-compatible',
    category: 'custom',
    supportsThinking: false,
    models: [],
  },
];

export function getProvider(id: ProviderId | string): ProviderDef {
  return PROVIDERS.find(p => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}

export function getProviderDefaultModel(id: ProviderId | string): string {
  return getProvider(id).models[0]?.id ?? '';
}

export function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.some(provider => provider.id === value);
}
