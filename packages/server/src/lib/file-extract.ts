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
): Promise<ExtractResult> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  let text = '';
  let format = ext;

  if (ext === 'txt' || ext === 'md' || ext === 'csv') {
    text = buffer.toString('utf-8');
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
  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS);

  return { text, truncated, format };
}
