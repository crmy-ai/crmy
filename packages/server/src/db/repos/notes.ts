// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID, PaginatedResponse } from '@crmy/shared';

export interface NoteRow {
  id: UUID;
  tenant_id: UUID;
  object_type: string;
  object_id: UUID;
  parent_id?: UUID;
  body: string;
  visibility: string;
  mentions: string[];
  pinned: boolean;
  author_id?: UUID;
  author_type: string;
  created_at: string;
  updated_at: string;
}

export async function createNote(
  db: DbPool, tenantId: UUID,
  data: {
    object_type: string; object_id: UUID; parent_id?: UUID;
    body: string; visibility?: string; mentions?: string[];
    pinned?: boolean; author_id?: UUID; author_type?: string;
  },
): Promise<NoteRow> {
  const result = await db.query(
    `INSERT INTO notes (tenant_id, object_type, object_id, parent_id, body,
       visibility, mentions, pinned, author_id, author_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      tenantId, data.object_type, data.object_id, data.parent_id ?? null,
      data.body, data.visibility ?? 'internal', data.mentions ?? [],
      data.pinned ?? false, data.author_id ?? null, data.author_type ?? 'user',
    ],
  );
  return result.rows[0] as NoteRow;
}

export async function getNote(db: DbPool, tenantId: UUID, id: UUID): Promise<NoteRow | null> {
  const result = await db.query(
    'SELECT * FROM notes WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rows[0] as NoteRow) ?? null;
}

export async function updateNote(
  db: DbPool, tenantId: UUID, id: UUID,
  patch: Record<string, unknown>,
): Promise<NoteRow | null> {
  const fieldMap: Record<string, string> = {
    body: 'body',
    visibility: 'visibility',
    pinned: 'pinned',
  };

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in patch) {
      sets.push(`${col} = $${idx}`);
      params.push(patch[key]);
      idx++;
    }
  }

  if (sets.length === 1) return getNote(db, tenantId, id);

  const result = await db.query(
    `UPDATE notes SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params,
  );
  return (result.rows[0] as NoteRow) ?? null;
}

export async function deleteNote(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM notes WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listNotes(
  db: DbPool, tenantId: UUID,
  filters: {
    object_type: string; object_id: UUID;
    visibility?: string; pinned?: boolean;
    limit: number; cursor?: string;
  },
): Promise<PaginatedResponse<NoteRow>> {
  const conditions: string[] = ['tenant_id = $1', 'object_type = $2', 'object_id = $3'];
  const params: unknown[] = [tenantId, filters.object_type, filters.object_id];
  let idx = 4;

  if (filters.visibility) {
    conditions.push(`visibility = $${idx}`);
    params.push(filters.visibility);
    idx++;
  }
  if (filters.pinned !== undefined) {
    conditions.push(`pinned = $${idx}`);
    params.push(filters.pinned);
    idx++;
  }
  if (filters.cursor) {
    conditions.push(`created_at < $${idx}`);
    params.push(filters.cursor);
    idx++;
  }

  const where = conditions.join(' AND ');
  const countResult = await db.query(`SELECT count(*)::int as total FROM notes WHERE ${where}`, params);

  params.push(filters.limit + 1);
  const dataResult = await db.query(
    `SELECT * FROM notes WHERE ${where} ORDER BY pinned DESC, created_at DESC LIMIT $${idx}`,
    params,
  );

  const rows = dataResult.rows as NoteRow[];
  const hasMore = rows.length > filters.limit;
  const data = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    data,
    total: countResult.rows[0].total,
    next_cursor: hasMore ? data[data.length - 1].created_at : undefined,
  };
}

export async function getReplies(
  db: DbPool, tenantId: UUID, parentId: UUID,
): Promise<NoteRow[]> {
  const result = await db.query(
    'SELECT * FROM notes WHERE tenant_id = $1 AND parent_id = $2 ORDER BY created_at',
    [tenantId, parentId],
  );
  return result.rows as NoteRow[];
}
