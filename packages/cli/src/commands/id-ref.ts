// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { CliClient } from '../client.js';

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function resolveShortId(
  client: CliClient,
  ref: string,
  options: {
    label: string;
    listTool: string;
    listInput?: Record<string, unknown>;
    responseKeys: string[];
    helpCommand: string;
  },
): Promise<string> {
  if (isUuid(ref)) return ref;
  const result = await client.call(options.listTool, { limit: 100, ...(options.listInput ?? {}) });
  const data = JSON.parse(result);
  const rows = options.responseKeys
    .flatMap((key) => data[key] ?? [])
    .concat(Array.isArray(data) ? data : []);
  const matches = rows.filter((row: Record<string, unknown>) => String(row.id ?? '').startsWith(ref));
  if (matches.length === 1) return String(matches[0].id);
  if (matches.length > 1) throw new Error(`${options.label} ID "${ref}" is ambiguous. Use more characters from the ID.`);
  throw new Error(`No ${options.label} found with ID prefix "${ref}". Run \`${options.helpCommand}\`.`);
}
