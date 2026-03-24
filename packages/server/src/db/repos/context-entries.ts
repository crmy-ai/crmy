// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { ContextEntry, UUID, PaginatedResponse } from '@crmy/shared';

export async function createContextEntry(
  db: DbPool,
  tenantId: UUID,
  data: Partial<ContextEntry> & { authored_by: UUID },
): Promise<ContextEntry> {
  const result = await db.query(
    `INSERT INTO context_entries (tenant_id, subject_type, subject_id,
       context_type, authored_by, title, body, structured_data,
       confidence, tags, source, source_ref, source_activity_id, valid_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      tenantId,
      data.subject_type,
      data.subject_id,
      data.context_type,
      data.authored_by,
      data.title ?? null,
      data.body,
      JSON.stringify(data.structured_data ?? {}),
      data.confidence ?? null,
      JSON.stringify(data.tags ?? []),
      data.source ?? null,
      data.source_ref ?? null,
      data.source_activity_id ?? null,
      data.valid_until ?? null,
    ],
  );
  return result.rows[0] as ContextEntry;
}

export async function getContextEntry(db: DbPool, tenantId: UUID, id: UUID): Promise<ContextEntry | null> {
  const result = await db.query(
    'SELECT * FROM context_entries WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as ContextEntry) ?? null;
}

/**
 * Get all current context for a given CRM object.
 */
export async function getContextForSubject(
  db: DbPool,
  tenantId: UUID,
  subjectType: string,
  subjectId: UUID,
  filters?: { context_type?: string; tag?: string; current_only?: boolean; limit?: number },
): Promise<ContextEntry[]> {
  const conditions: string[] = [
    'tenant_id = $1',
    'subject_type = $2',
    'subject_id = $3',
  ];
  const params: unknown[] = [tenantId, subjectType, subjectId];
  let idx = 4;

  if (filters?.current_only !== false) {
    conditions.push('is_current = true');
  }

  if (filters?.context_type) {
    conditions.push(`context_type = $${idx}`);
    params.push(filters.context_type);
    idx++;
  }

  if (filters?.tag) {
    conditions.push(`tags @> $${idx}::jsonb`);
    params.push(JSON.stringify([filters.tag]));
    idx++;
  }

  const lim = filters?.limit ?? 50;
  params.push(lim);

  const result = await db.query(
    `SELECT * FROM context_entries
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    params,
  );
  return result.rows as ContextEntry[];
}

/**
 * Full-text search on context entries using the GIN-indexed search_vector.
 */
export async function fullTextSearch(
  db: DbPool,
  tenantId: UUID,
  query: string,
  filters?: {
    subject_type?: string;
    subject_id?: UUID;
    context_type?: string;
    tag?: string;
    current_only?: boolean;
    limit?: number;
    structured_data_filter?: Record<string, unknown>;
  },
): Promise<ContextEntry[]> {
  const conditions: string[] = [
    'c.tenant_id = $1',
    `c.search_vector @@ plainto_tsquery('english', $2)`,
  ];
  const params: unknown[] = [tenantId, query];
  let idx = 3;

  if (filters?.current_only !== false) {
    conditions.push('c.is_current = true');
  }

  if (filters?.subject_type) {
    conditions.push(`c.subject_type = $${idx}`);
    params.push(filters.subject_type);
    idx++;
  }
  if (filters?.subject_id) {
    conditions.push(`c.subject_id = $${idx}`);
    params.push(filters.subject_id);
    idx++;
  }
  if (filters?.context_type) {
    conditions.push(`c.context_type = $${idx}`);
    params.push(filters.context_type);
    idx++;
  }
  if (filters?.tag) {
    conditions.push(`c.tags @> $${idx}::jsonb`);
    params.push(JSON.stringify([filters.tag]));
    idx++;
  }
  if (filters?.structured_data_filter) {
    conditions.push(`c.structured_data @> $${idx}::jsonb`);
    params.push(JSON.stringify(filters.structured_data_filter));
    idx++;
  }

  const lim = filters?.limit ?? 20;
  params.push(lim);

  const where = conditions.join(' AND ');

  const result = await db.query(
    `SELECT c.*, ts_rank(c.search_vector, plainto_tsquery('english', $2)) AS rank
     FROM context_entries c
     WHERE ${where}
     ORDER BY rank DESC
     LIMIT $${idx}`,
    params,
  );
  return result.rows as ContextEntry[];
}

/**
 * Get all current context for a list of CRM subjects in one query.
 * Used by the briefing service when context_radius is 'adjacent' or 'account_wide'.
 * Returns entries tagged with their origin subject_type and subject_id (already on ContextEntry).
 */
export async function getContextForSubjectList(
  db: DbPool,
  tenantId: UUID,
  subjects: Array<{ subject_type: string; subject_id: UUID }>,
  filters?: { current_only?: boolean; limit?: number },
): Promise<ContextEntry[]> {
  if (subjects.length === 0) return [];

  const subjectIds = subjects.map(s => s.subject_id);
  const conditions: string[] = [
    'tenant_id = $1',
    `subject_id = ANY($2::uuid[])`,
  ];
  const params: unknown[] = [tenantId, subjectIds];
  let idx = 3;

  if (filters?.current_only !== false) {
    conditions.push('is_current = true');
  }

  const lim = filters?.limit ?? 500;
  params.push(lim);

  const result = await db.query(
    `SELECT * FROM context_entries
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    params,
  );
  return result.rows as ContextEntry[];
}

/**
 * Supersede an existing context entry with a new one.
 * Marks the old entry as not current and creates a new entry that points back to it.
 */
export async function supersedeContextEntry(
  db: DbPool,
  tenantId: UUID,
  existingId: UUID,
  newData: {
    body: string;
    title?: string;
    structured_data?: Record<string, unknown>;
    confidence?: number;
    tags?: string[];
    authored_by: UUID;
  },
): Promise<{ old: ContextEntry; new: ContextEntry }> {
  // Mark old entry as not current
  await db.query(
    `UPDATE context_entries SET is_current = false, updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [existingId, tenantId],
  );

  const oldEntry = await getContextEntry(db, tenantId, existingId);
  if (!oldEntry) throw new Error('Context entry not found');

  // Create new entry that supersedes the old one
  const result = await db.query(
    `INSERT INTO context_entries (tenant_id, subject_type, subject_id,
       context_type, authored_by, title, body, structured_data,
       confidence, tags, is_current, supersedes_id, source, source_ref,
       source_activity_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13,$14)
     RETURNING *`,
    [
      tenantId,
      oldEntry.subject_type,
      oldEntry.subject_id,
      oldEntry.context_type,
      newData.authored_by,
      newData.title ?? oldEntry.title,
      newData.body,
      JSON.stringify(newData.structured_data ?? oldEntry.structured_data),
      newData.confidence ?? oldEntry.confidence,
      JSON.stringify(newData.tags ?? oldEntry.tags ?? []),
      existingId,
      oldEntry.source,
      oldEntry.source_ref,
      oldEntry.source_activity_id,
    ],
  );

  return { old: oldEntry, new: result.rows[0] as ContextEntry };
}

/**
 * Mark a context entry as reviewed (still accurate).
 */
export async function reviewContextEntry(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
): Promise<ContextEntry | null> {
  const result = await db.query(
    `UPDATE context_entries SET reviewed_at = now(), updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [id, tenantId],
  );
  return (result.rows[0] as ContextEntry) ?? null;
}

/**
 * List stale context entries (valid_until has passed, still current).
 */
export async function listStaleEntries(
  db: DbPool,
  tenantId: UUID,
  filters?: { subject_type?: string; subject_id?: UUID; limit?: number },
): Promise<ContextEntry[]> {
  const conditions: string[] = [
    'tenant_id = $1',
    'valid_until < now()',
    'is_current = TRUE',
  ];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters?.subject_type) {
    conditions.push(`subject_type = $${idx}`);
    params.push(filters.subject_type);
    idx++;
  }
  if (filters?.subject_id) {
    conditions.push(`subject_id = $${idx}`);
    params.push(filters.subject_id);
    idx++;
  }

  const lim = filters?.limit ?? 20;
  params.push(lim);

  const result = await db.query(
    `SELECT * FROM context_entries
     WHERE ${conditions.join(' AND ')}
     ORDER BY valid_until ASC
     LIMIT $${idx}`,
    params,
  );
  return result.rows as ContextEntry[];
}

export async function searchContextEntries(
  db: DbPool,
  tenantId: UUID,
  filters: {
    subject_type?: string;
    subject_id?: UUID;
    context_type?: string;
    authored_by?: UUID;
    is_current?: boolean;
    tag?: string;
    query?: string;
    structured_data_filter?: Record<string, unknown>;
    limit: number;
    cursor?: string;
  },
): Promise<PaginatedResponse<ContextEntry>> {
  const conditions: string[] = ['c.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.subject_type) {
    conditions.push(`c.subject_type = $${idx}`);
    params.push(filters.subject_type);
    idx++;
  }
  if (filters.subject_id) {
    conditions.push(`c.subject_id = $${idx}`);
    params.push(filters.subject_id);
    idx++;
  }
  if (filters.context_type) {
    conditions.push(`c.context_type = $${idx}`);
    params.push(filters.context_type);
    idx++;
  }
  if (filters.authored_by) {
    conditions.push(`c.authored_by = $${idx}`);
    params.push(filters.authored_by);
    idx++;
  }
  if (filters.is_current !== undefined) {
    conditions.push(`c.is_current = $${idx}`);
    params.push(filters.is_current);
    idx++;
  }
  if (filters.tag) {
    conditions.push(`c.tags @> $${idx}::jsonb`);
    params.push(JSON.stringify([filters.tag]));
    idx++;
  }
  if (filters.query) {
    conditions.push(`(c.title ILIKE $${idx} OR c.body ILIKE $${idx})`);
    params.push(`%${filters.query}%`);
    idx++;
  }
  if (filters.structured_data_filter) {
    conditions.push(`c.structured_data @> $${idx}::jsonb`);
    params.push(JSON.stringify(filters.structured_data_filter));
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`c.created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int as total FROM context_entries c WHERE ${where}`,
    params,
  );

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT c.* FROM context_entries c WHERE ${where} ORDER BY c.created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as ContextEntry[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}
