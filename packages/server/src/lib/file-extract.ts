// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Extract plain text from uploaded file buffers.
 *
 * Supported formats:
 *   .txt  .md   — read buffer as UTF-8 directly
 *   .pdf        — extract via pdf-parse
 *   .docx       — extract via mammoth
 *
 * Returns { text, truncated } where text is trimmed content and
 * truncated is true when the source exceeded MAX_CHARS.
 */

const MAX_CHARS = 120_000;

export type ExtractResult = {
  text: string;
  truncated: boolean;
  format: string;
};

export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string,
  options: { maxChars?: number } = {},
): Promise<ExtractResult> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const maxChars = Math.max(1_000, options.maxChars ?? MAX_CHARS);

  let text = '';
  let format = ext;

  if (ext === 'txt' || ext === 'md' || ext === 'csv') {
    text = buffer.toString('utf-8');
  } else if (ext === 'vtt') {
    text = normalizeWebVtt(buffer.toString('utf-8'));
  } else if (ext === 'srt') {
    text = normalizeSrt(buffer.toString('utf-8'));
  } else if (ext === 'json') {
    text = normalizeJsonTranscript(buffer.toString('utf-8'));
  } else if (ext === 'pdf') {
    try {
      // pdf-parse exports a default function; handle both CJS and ESM interop
      const pdfMod = await import('pdf-parse');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfParse: (buf: Buffer) => Promise<{ text: string }> = (pdfMod as any).default ?? pdfMod;
      const result = await pdfParse(buffer);
      text = result.text ?? '';
    } catch (err) {
      throw new Error(`PDF extraction failed: ${(err as Error).message}`);
    }
  } else if (ext === 'docx') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value ?? '';
    } catch (err) {
      throw new Error(`DOCX extraction failed: ${(err as Error).message}`);
    }
  } else {
    // Try reading as plain text (handles .json, .xml, .html etc.)
    try {
      text = buffer.toString('utf-8');
      format = 'text';
    } catch {
      throw new Error(`Unsupported file format: .${ext}`);
    }
  }

  text = text.trim();
  const truncated = text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars);

  return { text, truncated, format };
}

function normalizeWebVtt(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'WEBVTT' || trimmed.startsWith('NOTE')) continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (/-->/u.test(trimmed)) {
      out.push(`[${trimmed.replace(/\s+align:.+$/u, '')}]`);
      continue;
    }
    out.push(stripCueTags(trimmed));
  }
  return collapseTranscriptLines(out);
}

function normalizeSrt(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^\d+$/.test(trimmed)) continue;
    if (/-->/u.test(trimmed)) {
      out.push(`[${trimmed}]`);
      continue;
    }
    out.push(stripCueTags(trimmed));
  }
  return collapseTranscriptLines(out);
}

function normalizeJsonTranscript(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const lines = collectTranscriptLines(parsed);
    return lines.length > 0 ? collapseTranscriptLines(lines) : JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function collectTranscriptLines(value: unknown): string[] {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(item => collectTranscriptLines(item));
  const obj = value as Record<string, unknown>;
  const text = firstString(obj, ['text', 'transcript', 'content', 'body', 'utterance', 'sentence']);
  const speaker = firstString(obj, ['speaker', 'speaker_name', 'name', 'author']);
  const start = firstString(obj, ['start', 'start_time', 'timestamp', 'time']);
  const nested = ['segments', 'utterances', 'items', 'messages', 'results', 'transcript'].flatMap(key => collectTranscriptLines(obj[key]));
  const line = text ? `${start ? `[${start}] ` : ''}${speaker ? `${speaker}: ` : ''}${text}` : '';
  return [line, ...nested].filter(Boolean);
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function stripCueTags(line: string): string {
  return line.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function collapseTranscriptLines(lines: string[]): string {
  return lines
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
