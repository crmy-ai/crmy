// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

export function friendlyErrorMessage(error: unknown, fallback = 'Try again.'): string {
  const domainConflict = friendlyDomainConflictError(error);
  if (domainConflict) return domainConflict;
  const raw = rawErrorMessage(error).trim();
  if (!raw) return fallback;
  return friendlyModelProviderError(raw) || stripRawJsonTail(raw) || fallback;
}

function friendlyDomainConflictError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  const conflicts = Array.isArray(record.domain_conflicts) ? record.domain_conflicts as Array<Record<string, unknown>> : [];
  const first = conflicts[0];
  if (!first) return null;
  const account = first.existing_account && typeof first.existing_account === 'object'
    ? first.existing_account as Record<string, unknown>
    : {};
  const domain = String(first.domain ?? 'This domain');
  const accountName = String(account.name ?? 'another account');
  const accountDomain = account.domain ? ` (${String(account.domain)})` : '';
  return `${domain} already belongs to ${accountName}${accountDomain}. Remove it here, open that account to move the domain, or ask an admin to merge/split the accounts.`;
}

export function friendlyModelProviderError(message: string): string | null {
  const raw = String(message ?? '').trim();
  if (!raw) return null;

  const providerHttp = raw.match(/\b(?:LLM|Anthropic|Embedding)\s+API error\s+(\d{3}):\s*([\s\S]*)$/i);
  if (providerHttp) {
    return formatProviderHttpError(Number(providerHttp[1]), providerHttp[2]);
  }

  const status = raw.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
  if (status && /model|provider|llm|anthropic|openai|openrouter|ollama/i.test(raw)) {
    return formatProviderHttpError(Number(status), raw);
  }

  if (/\b429\b|rate[-\s]?limit|too many requests/i.test(raw)) {
    return 'The model provider is rate limited right now. Try again in a moment, or switch to a backup model provider in Workspace Agent settings.';
  }
  if (/invalid tool call arguments/i.test(raw)) {
    return 'The model returned an invalid tool request. Try again; CRMy will keep the customer context and retry safely where possible.';
  }
  if (/api key|unauthorized|forbidden|permission/i.test(raw) && /model|provider|llm|anthropic|openai|openrouter|ollama/i.test(raw)) {
    return 'The model provider rejected the configured API key or permissions. Check Workspace Agent model settings.';
  }

  const parsed = parseMaybeJson(raw);
  if (parsed) {
    const providerMessage = extractProviderMessage(parsed);
    if (providerMessage) return providerMessage;
  }

  return null;
}

function formatProviderHttpError(status: number, rawBody: string): string {
  const providerMessage = extractProviderMessage(parseMaybeJson(rawBody) ?? rawBody);
  if (status === 429) {
    return 'The model provider is rate limited right now. Try again in a moment, or switch to a backup model provider in Workspace Agent settings.';
  }
  if (status === 401 || status === 403) {
    return 'The model provider rejected the configured API key or permissions. Check Workspace Agent model settings.';
  }
  if (status === 404) {
    return 'The selected model or provider endpoint could not be found. Check the provider, base URL, and model name.';
  }
  if (status === 400) {
    if (/invalid tool call arguments/i.test(providerMessage)) {
      return 'The model returned an invalid tool request. Try again; CRMy will keep the customer context and retry safely where possible.';
    }
    return providerMessage
      ? `The model provider rejected the request. ${providerMessage}`
      : 'The model provider rejected the request. Check the selected model and provider settings.';
  }
  if (status >= 500) {
    return 'The model provider is temporarily unavailable. Try again, or use a backup provider if one is configured.';
  }
  return providerMessage
    ? `The model provider returned an error (${status}). ${providerMessage}`
    : `The model provider returned an error (${status}). Check provider settings and try again.`;
}

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return String(record.detail ?? record.error ?? record.message ?? '');
  }
  return String(error ?? '');
}

function parseMaybeJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractProviderMessage(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return cleanProviderDetail(stripRawJsonTail(value));
  if (typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === 'object') {
    const errorRecord = error as Record<string, unknown>;
    return cleanProviderDetail(String(errorRecord.message ?? errorRecord.detail ?? errorRecord.code ?? ''));
  }
  return cleanProviderDetail(String(record.message ?? record.detail ?? record.error ?? ''));
}

function cleanProviderDetail(value: string): string {
  const cleaned = stripRawJsonTail(value)
    .replace(/\s+/g, ' ')
    .replace(/^error[:\s-]+/i, '')
    .trim();
  if (!cleaned || /^[{}\[\]",:\s\d._-]+$/.test(cleaned)) return '';
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function stripRawJsonTail(raw: string): string {
  return raw
    .replace(/\s*\{[\s\S]*\}\s*$/g, '')
    .replace(/\s*\[[\s\S]*\]\s*$/g, '')
    .trim();
}
