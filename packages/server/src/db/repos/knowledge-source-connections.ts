// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type {
  KnowledgeSourceConnection,
  KnowledgeSourceConnectionAuthType,
  KnowledgeSourceConnectionStatus,
  KnowledgeSourceConnectionTransport,
  UUID,
} from '@crmy/shared';
import type { DbPool } from '../pool.js';
import { encryptSecret, redactSecrets } from '../../lib/secrets.js';

type Json = Record<string, unknown>;

export interface KnowledgeSourceConnectionRow extends Omit<KnowledgeSourceConnection, 'has_credentials'> {
  tenant_id: UUID;
  credentials_enc?: Json | null;
}

function safeConnection(row: Record<string, unknown>): KnowledgeSourceConnection {
  const { credentials_enc: encryptedCredentials, tenant_id: _tenantId, ...rest } = row;
  return {
    ...(rest as unknown as KnowledgeSourceConnection),
    has_credentials: Boolean(encryptedCredentials),
    config: redactSecrets((row.config ?? {}) as Json),
    sync_stats: redactSecrets((row.sync_stats ?? {}) as Json),
  };
}

export async function createConnection(
  db: DbPool,
  tenantId: UUID,
  input: {
    name: string;
    transport: KnowledgeSourceConnectionTransport;
    auth_type: KnowledgeSourceConnectionAuthType;
    config: Json;
    credentials?: Json;
    created_by?: UUID | null;
  },
): Promise<KnowledgeSourceConnection> {
  const result = await db.query(
    `INSERT INTO knowledge_source_connections (
       tenant_id, name, provider, transport, auth_type, config, credentials_enc, created_by
     )
     VALUES ($1,$2,'mcp',$3,$4,$5::jsonb,$6::jsonb,$7)
     RETURNING *`,
    [
      tenantId,
      input.name,
      input.transport,
      input.auth_type,
      JSON.stringify(input.config ?? {}),
      input.credentials ? JSON.stringify(encryptSecret(input.credentials)) : null,
      input.created_by ?? null,
    ],
  );
  return safeConnection(result.rows[0]);
}

export async function listConnections(db: DbPool, tenantId: UUID): Promise<KnowledgeSourceConnection[]> {
  const result = await db.query(
    `SELECT *
     FROM knowledge_source_connections
     WHERE tenant_id = $1
     ORDER BY updated_at DESC`,
    [tenantId],
  );
  return result.rows.map(safeConnection);
}

export async function getConnection(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  includeCredentials = false,
): Promise<KnowledgeSourceConnectionRow | null> {
  const result = await db.query(
    `SELECT *
     FROM knowledge_source_connections
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (!includeCredentials) delete row.credentials_enc;
  return row as KnowledgeSourceConnectionRow;
}

export async function updateConnection(
  db: DbPool,
  tenantId: UUID,
  id: UUID,
  patch: {
    name?: string;
    transport?: KnowledgeSourceConnectionTransport;
    auth_type?: KnowledgeSourceConnectionAuthType;
    status?: KnowledgeSourceConnectionStatus;
    config?: Json;
    credentials?: Json | null;
    sync_stats?: Json;
    last_test_at?: string | null;
    last_sync_at?: string | null;
    last_error?: string | null;
  },
): Promise<KnowledgeSourceConnection | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [tenantId, id];
  let idx = 3;

  for (const field of ['name', 'transport', 'auth_type', 'status', 'last_test_at', 'last_sync_at', 'last_error'] as const) {
    if (field in patch) {
      sets.push(`${field} = $${idx++}`);
      params.push(patch[field] ?? null);
    }
  }
  if (patch.config !== undefined) {
    sets.push(`config = $${idx++}::jsonb`);
    params.push(JSON.stringify(patch.config ?? {}));
  }
  if (patch.sync_stats !== undefined) {
    sets.push(`sync_stats = $${idx++}::jsonb`);
    params.push(JSON.stringify(patch.sync_stats ?? {}));
  }
  if ('credentials' in patch) {
    sets.push(`credentials_enc = $${idx++}::jsonb`);
    params.push(patch.credentials ? JSON.stringify(encryptSecret(patch.credentials)) : null);
  }

  const result = await db.query(
    `UPDATE knowledge_source_connections
     SET ${sets.join(', ')}
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    params,
  );
  return result.rows[0] ? safeConnection(result.rows[0]) : null;
}

export async function deleteConnection(db: DbPool, tenantId: UUID, id: UUID): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM knowledge_source_connections WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  return (result.rowCount ?? 0) > 0;
}

