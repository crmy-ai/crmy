// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

export interface StableCursor extends Record<string, unknown> {
  sort_value: string;
  id?: string;
}

export function encodeStableCursor(input: StableCursor & Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

export function decodeStableCursor(cursor?: string | null): StableCursor | null {
  if (!cursor?.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    const sortValue = typeof parsed.sort_value === 'string'
      ? parsed.sort_value
      : typeof parsed.created_at === 'string'
        ? parsed.created_at
        : typeof parsed.updated_at === 'string'
          ? parsed.updated_at
          : typeof parsed.timestamp === 'string'
            ? parsed.timestamp
            : null;
    if (!sortValue) return null;
    return {
      sort_value: sortValue,
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      ...parsed,
    };
  } catch {
    const parsedDate = new Date(cursor);
    return Number.isNaN(parsedDate.getTime()) ? null : { sort_value: cursor };
  }
}

export function addStableDescCursorCondition(
  conditions: string[],
  params: unknown[],
  idx: number,
  cursor: string | undefined,
  sortExpression: string,
  idExpression: string,
): number {
  const decoded = decodeStableCursor(cursor);
  if (!decoded) return idx;
  if (decoded.id) {
    conditions.push(`(${sortExpression} < $${idx} OR (${sortExpression} = $${idx} AND ${idExpression} < $${idx + 1}::uuid))`);
    params.push(decoded.sort_value, decoded.id);
    return idx + 2;
  }
  conditions.push(`${sortExpression} < $${idx}`);
  params.push(decoded.sort_value);
  return idx + 1;
}
