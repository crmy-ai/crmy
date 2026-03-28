// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Embedding provider for pgvector semantic search.
 *
 * Uses the same fetch-based, no-SDK pattern as anthropic.ts and openai-compat.ts.
 * Anthropic does not offer an embeddings API — configure a separate EMBEDDING_PROVIDER
 * (openai, openrouter, or ollama) alongside LLM_PROVIDER=anthropic if needed.
 *
 * Required env vars:
 *   EMBEDDING_PROVIDER   openai | openrouter | ollama | custom
 *   EMBEDDING_API_KEY    Bearer token (not required for local Ollama)
 *
 * Optional env vars:
 *   EMBEDDING_MODEL      Defaults: openai → text-embedding-3-small, ollama → nomic-embed-text
 *   EMBEDDING_BASE_URL   Override base URL (e.g. custom OpenAI-compat server)
 *   EMBEDDING_DIMENSIONS Vector dimension (must match model). Default: 1536.
 */

export interface EmbeddingConfig {
  provider: 'openai' | 'openrouter' | 'ollama' | 'custom';
  baseUrl: string;
  apiKey: string | null;
  model: string;
  dimensions: number;
}

/**
 * Load embedding config from environment variables.
 * Returns null if EMBEDDING_PROVIDER is not set — callers treat null as "FTS-only mode."
 */
export function loadEmbeddingConfig(): EmbeddingConfig | null {
  const provider = process.env.EMBEDDING_PROVIDER as EmbeddingConfig['provider'] | undefined;
  if (!provider) return null;

  const baseUrl = process.env.EMBEDDING_BASE_URL ?? defaultBaseUrl(provider);
  const apiKey = process.env.EMBEDDING_API_KEY ?? null;
  const model = process.env.EMBEDDING_MODEL ?? defaultModel(provider);
  const dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS ?? '1536', 10);

  return { provider, baseUrl, apiKey, model, dimensions };
}

/**
 * Generate a float32 embedding vector for a text string.
 * Throws on network or API errors — callers must catch and degrade gracefully.
 */
export async function embedText(
  text: string,
  config: EmbeddingConfig,
): Promise<number[]> {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/embeddings`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const body: Record<string, unknown> = {
    model: config.model,
    input: text,
  };

  // OpenAI and OpenRouter support the `dimensions` param to truncate output vectors.
  if (config.provider === 'openai' || config.provider === 'openrouter') {
    body.dimensions = config.dimensions;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${errBody}`);
  }

  const json = await res.json() as { data: Array<{ embedding: number[] }> };
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error('Embedding API returned no vector');
  }
  return vec;
}

function defaultBaseUrl(provider: string): string {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1';
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    case 'ollama': return 'http://localhost:11434/v1';
    default: return '';
  }
}

function defaultModel(provider: string): string {
  switch (provider) {
    case 'openai': return 'text-embedding-3-small';
    case 'openrouter': return 'openai/text-embedding-3-small';
    case 'ollama': return 'nomic-embed-text';
    default: return 'text-embedding-3-small';
  }
}
