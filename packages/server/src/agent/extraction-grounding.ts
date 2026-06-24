// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Source-grounding gate for auto-promotion.
 *
 * Extraction confidence is self-reported by the model, so a weak or
 * mis-calibrated model can return a high-confidence, non-speculative claim that
 * is simply not in the source. If such a claim auto-promotes, it silently
 * poisons confirmed Memory.
 *
 * This gate is a model-independent guardrail: a Signal may only auto-promote to
 * Memory if at least one of its evidence snippets is actually grounded in the
 * source text it was extracted from. It does not trust the model's confidence —
 * it checks the source.
 *
 * Failures here are safe by construction: an ungrounded claim is still written
 * as a reviewable Signal, it just does not become Memory without human review.
 * So the match is intentionally lenient (normalized containment, with a
 * token-overlap fallback for minor punctuation/formatting differences) to keep
 * false negatives cheap (extra review) rather than risk false positives
 * (auto-promoted hallucinations).
 */

/** Minimum normalized snippet length to consider — guards against trivial matches. */
const MIN_SNIPPET_CHARS = 12;

/** Fraction of snippet tokens that must appear in the source for the fallback match. */
const TOKEN_OVERLAP_THRESHOLD = 0.6;

/** Minimum meaningful token length (skips "the", "a", "to", ...). */
const MIN_TOKEN_CHARS = 3;

export interface GroundingEvidenceLike {
  snippet?: string | null;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(token => token.length >= MIN_TOKEN_CHARS);
}

/**
 * True when a single snippet is grounded in the source text, by normalized
 * substring containment or sufficient token overlap.
 */
export function isSnippetGrounded(snippet: string, sourceText: string): boolean {
  const normalizedSnippet = normalizeText(snippet);
  if (normalizedSnippet.length < MIN_SNIPPET_CHARS) return false;

  const normalizedSource = normalizeText(sourceText);
  if (!normalizedSource) return false;

  if (normalizedSource.includes(normalizedSnippet)) return true;

  // Fallback: tolerate minor punctuation/format drift between the model's
  // snippet and the source by requiring most snippet tokens to be present.
  const snippetTokens = tokenize(snippet);
  if (snippetTokens.length === 0) return false;
  const sourceTokens = new Set(tokenize(sourceText));
  const present = snippetTokens.filter(token => sourceTokens.has(token)).length;
  return present / snippetTokens.length >= TOKEN_OVERLAP_THRESHOLD;
}

/**
 * True when at least one evidence snippet for a Signal is grounded in the
 * source text. Used to gate auto-promotion: no source grounding, no Memory.
 */
export function isPromotionGrounded(
  evidence: readonly GroundingEvidenceLike[] | undefined | null,
  sourceText: string | undefined | null,
): boolean {
  if (!sourceText || !sourceText.trim()) return false;
  for (const item of evidence ?? []) {
    const snippet = typeof item?.snippet === 'string' ? item.snippet : '';
    if (snippet && isSnippetGrounded(snippet, sourceText)) return true;
  }
  return false;
}

/**
 * Whether the source-grounding requirement is active. On by default; operators
 * can disable it with CRMY_REQUIRE_GROUNDED_AUTOPROMOTE=0 to restore the prior
 * confidence-only behavior.
 */
export function groundedAutoPromoteRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CRMY_REQUIRE_GROUNDED_AUTOPROMOTE;
  return raw !== '0' && raw !== 'false';
}
