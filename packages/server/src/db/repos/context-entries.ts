// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { ContextEntry, UUID, PaginatedResponse } from '@crmy/shared';
import type { EmbeddingConfig } from '../../agent/providers/embeddings.js';
import { embedText } from '../../agent/providers/embeddings.js';

export async function createContextEntry(
  db: DbPool,
  tenantId: UUID,
  data: Partial<ContextEntry> & { authored_by: UUID },
): Promise<ContextEntry> {
  const result = await db.query(
    `INSERT INTO context_entries (tenant_id, subject_type, subject_id,
       context_type, authored_by, title, body, structured_data,
       confidence, tags, source, source_ref, source_activity_id, valid_until,
       parent_id, visibility, mentions, pinned)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
      (data as Record<string, unknown>).parent_id ?? null,
      (data as Record<string, unknown>).visibility ?? 'internal',
      JSON.stringify((data as Record<string, unknown>).mentions ?? []),
      (data as Record<string, unknown>).pinned ?? false,
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
  filters?: {
    context_type?: string;
    tag?: string;
    current_only?: boolean;
    limit?: number;
    source_activity_id?: UUID;
  },
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

  if (filters?.source_activity_id) {
    conditions.push(`source_activity_id = $${idx}`);
    params.push(filters.source_activity_id);
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
 * Fetch all context entries created by a specific activity (via source_activity_id).
 * Used by context_ingest to return extracted entries after running the pipeline.
 */
export async function getContextByActivityId(
  db: DbPool,
  tenantId: UUID,
  activityId: UUID,
): Promise<ContextEntry[]> {
  const result = await db.query(
    `SELECT * FROM context_entries
     WHERE tenant_id = $1 AND source_activity_id = $2 AND is_current = true
     ORDER BY created_at ASC`,
    [tenantId, activityId],
  );
  return result.rows as ContextEntry[];
}

/**
 * Compute a context diff for a subject since a given timestamp.
 * Returns new entries, superseded entries, freshly stale entries, and reviewed entries.
 */
export async function diffContextEntries(
  db: DbPool,
  tenantId: UUID,
  subjectType: string,
  subjectId: UUID,
  since: string,
): Promise<{
  new_entries: ContextEntry[];
  superseded_entries: ContextEntry[];
  newly_stale: ContextEntry[];
  resolved_entries: ContextEntry[];
}> {
  const base = [tenantId, subjectType, subjectId, since];

  // New entries: created in the window and currently active
  const newResult = await db.query(
    `SELECT * FROM context_entries
     WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
       AND created_at >= $4 AND is_current = true
       AND supersedes_id IS NULL
     ORDER BY created_at DESC`,
    base,
  );

  // Superseded: entries that WERE replaced in this window (the old, now-inactive entry)
  const supersededResult = await db.query(
    `SELECT old.* FROM context_entries old
     JOIN context_entries replacement ON old.id = replacement.supersedes_id
     WHERE old.tenant_id = $1 AND old.subject_type = $2 AND old.subject_id = $3
       AND replacement.created_at >= $4
     ORDER BY replacement.created_at DESC`,
    base,
  );

  // Newly stale: valid_until fell within the window
  const staleResult = await db.query(
    `SELECT * FROM context_entries
     WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
       AND valid_until >= $4 AND valid_until < now()
       AND is_current = true
     ORDER BY valid_until ASC`,
    base,
  );

  // Resolved: reviewed_at set within the window
  const resolvedResult = await db.query(
    `SELECT * FROM context_entries
     WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
       AND reviewed_at >= $4
     ORDER BY reviewed_at DESC`,
    base,
  );

  return {
    new_entries: newResult.rows as ContextEntry[],
    superseded_entries: supersededResult.rows as ContextEntry[],
    newly_stale: staleResult.rows as ContextEntry[],
    resolved_entries: resolvedResult.rows as ContextEntry[],
  };
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
    visibility?: 'internal' | 'external';
    pinned?: boolean;
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
  if (filters.visibility) {
    conditions.push(`c.visibility = $${idx}`);
    params.push(filters.visibility);
    idx++;
  }
  if (filters.pinned !== undefined) {
    conditions.push(`c.pinned = $${idx}`);
    params.push(filters.pinned);
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

// ─── pgvector semantic search ─────────────────────────────────────────────────

/**
 * Store a precomputed embedding vector for a context entry.
 * Called fire-and-forget from context_add and context_supersede handlers.
 */
export async function updateEmbedding(
  db: DbPool,
  id: UUID,
  tenantId: UUID,
  embedding: number[],
): Promise<void> {
  // pg accepts vector literal as '[v1,v2,...]' text with ::vector cast in the SQL.
  await db.query(
    `UPDATE context_entries SET embedding = $1::vector WHERE id = $2 AND tenant_id = $3`,
    [`[${embedding.join(',')}]`, id, tenantId],
  );
}

/**
 * Semantic similarity search using pgvector cosine distance.
 * Requires ENABLE_PGVECTOR=true and an embedded query vector.
 * All typed filters (subject_type, subject_id, context_type, tag, structured_data_filter)
 * are applied as WHERE conditions so the entity graph and type structure are preserved.
 */
export async function semanticSearch(
  db: DbPool,
  tenantId: UUID,
  queryEmbedding: number[],
  filters?: {
    subject_type?: string;
    subject_id?: UUID;
    context_type?: string;
    tag?: string;
    current_only?: boolean;
    limit?: number;
    structured_data_filter?: Record<string, unknown>;
  },
): Promise<Array<ContextEntry & { similarity: number }>> {
  const conditions: string[] = [
    'c.tenant_id = $1',
    'c.embedding IS NOT NULL',
  ];
  const params: unknown[] = [tenantId, `[${queryEmbedding.join(',')}]`];
  let idx = 3;

  if (filters?.current_only !== false) {
    conditions.push('c.is_current = true');
  }
  if (filters?.subject_type) {
    conditions.push(`c.subject_type = $${idx++}`);
    params.push(filters.subject_type);
  }
  if (filters?.subject_id) {
    conditions.push(`c.subject_id = $${idx++}`);
    params.push(filters.subject_id);
  }
  if (filters?.context_type) {
    conditions.push(`c.context_type = $${idx++}`);
    params.push(filters.context_type);
  }
  if (filters?.tag) {
    conditions.push(`c.tags @> $${idx++}::jsonb`);
    params.push(JSON.stringify([filters.tag]));
  }
  if (filters?.structured_data_filter) {
    conditions.push(`c.structured_data @> $${idx++}::jsonb`);
    params.push(JSON.stringify(filters.structured_data_filter));
  }

  const lim = filters?.limit ?? 20;
  params.push(lim);

  const result = await db.query(
    `SELECT c.*, 1 - (c.embedding <=> $2::vector) AS similarity
     FROM context_entries c
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.embedding <=> $2::vector
     LIMIT $${idx}`,
    params,
  );

  return result.rows as Array<ContextEntry & { similarity: number }>;
}

/**
 * Embed all context entries that are missing embeddings.
 * Called by the context_embed_backfill MCP tool.
 * Processes up to batchSize entries per call — loop until pending reaches 0.
 */
export async function backfillEmbeddings(
  db: DbPool,
  tenantId: UUID,
  embConfig: EmbeddingConfig,
  batchSize: number,
  subjectType?: string,
  dryRun?: boolean,
): Promise<{ processed: number; skipped: number; failed: number; pending: number }> {
  const countParams: unknown[] = [tenantId];
  const subjectFilter = subjectType ? ` AND subject_type = $2` : '';
  if (subjectType) countParams.push(subjectType);

  const countResult = await db.query(
    `SELECT count(*)::int AS n FROM context_entries
     WHERE tenant_id = $1 AND embedding IS NULL${subjectFilter}`,
    countParams,
  );
  const pending: number = countResult.rows[0].n;

  if (dryRun) return { processed: 0, skipped: 0, failed: 0, pending };

  const rowParams: unknown[] = [tenantId];
  if (subjectType) rowParams.push(subjectType);
  rowParams.push(batchSize);

  const limitIdx = rowParams.length;
  const rows = await db.query(
    `SELECT id, body FROM context_entries
     WHERE tenant_id = $1 AND embedding IS NULL${subjectFilter}
     ORDER BY created_at DESC
     LIMIT $${limitIdx}`,
    rowParams,
  );

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows.rows) {
    const body = row.body as string | null;
    if (!body?.trim()) { skipped++; continue; }
    try {
      const vec = await embedText(body, embConfig);
      await updateEmbedding(db, row.id as UUID, tenantId, vec);
      processed++;
    } catch {
      failed++;
    }
  }

  return { processed, skipped, failed, pending: pending - processed };
}
