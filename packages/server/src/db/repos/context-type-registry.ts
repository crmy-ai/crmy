// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { ContextTypeRegistryEntry, UUID } from '@crmy/shared';

const DEFAULT_CONTEXT_TYPES: Omit<ContextTypeRegistryEntry, 'tenant_id' | 'created_at'>[] = [
  { type_name: 'note', label: 'Note', description: 'General-purpose note or observation', is_default: true },
  { type_name: 'transcript', label: 'Transcript', description: 'Verbatim or near-verbatim record of a conversation', is_default: true },
  { type_name: 'summary', label: 'Summary', description: 'Condensed version of a longer interaction or document', is_default: true },
  { type_name: 'research', label: 'Research', description: 'Background research on a person, company, or market', is_default: true },
  { type_name: 'preference', label: 'Preference', description: 'Known preference of a contact or account (communication style, timing, etc.)', is_default: true },
  { type_name: 'objection', label: 'Objection', description: 'A stated concern, pushback, or blocker raised by the prospect', is_default: true },
  { type_name: 'decision', label: 'Decision', description: 'A decision that was made and the reasoning behind it', is_default: true },
  { type_name: 'competitive_intel', label: 'Competitive Intel', description: 'Information about competitors relevant to this deal or account', is_default: true },
  { type_name: 'relationship_map', label: 'Relationship Map', description: 'Key people, their roles, influence, and relationships to each other', is_default: true },
  { type_name: 'meeting_notes', label: 'Meeting Notes', description: 'Structured takeaways from a meeting (distinct from raw transcript)', is_default: true },
  { type_name: 'agent_reasoning', label: 'Agent Reasoning', description: 'An AI agent\'s internal reasoning or analysis about next steps', is_default: true },
  { type_name: 'sentiment_analysis', label: 'Sentiment Analysis', description: 'Assessment of prospect sentiment or engagement level', is_default: true },
];

export async function seedDefaults(db: DbPool, tenantId: UUID): Promise<void> {
  for (const entry of DEFAULT_CONTEXT_TYPES) {
    await db.query(
      `INSERT INTO context_type_registry (type_name, tenant_id, label, description, is_default)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (type_name) DO NOTHING`,
      [entry.type_name, tenantId, entry.label, entry.description ?? null, true],
    );
  }
}

export async function listContextTypes(
  db: DbPool,
  tenantId: UUID,
): Promise<ContextTypeRegistryEntry[]> {
  const result = await db.query(
    'SELECT * FROM context_type_registry WHERE tenant_id = $1 ORDER BY type_name',
    [tenantId],
  );
  return result.rows as ContextTypeRegistryEntry[];
}

export async function addContextType(
  db: DbPool,
  tenantId: UUID,
  data: { type_name: string; label: string; description?: string },
): Promise<ContextTypeRegistryEntry> {
  const result = await db.query(
    `INSERT INTO context_type_registry (type_name, tenant_id, label, description, is_default)
     VALUES ($1, $2, $3, $4, FALSE)
     RETURNING *`,
    [data.type_name, tenantId, data.label, data.description ?? null],
  );
  return result.rows[0] as ContextTypeRegistryEntry;
}

export async function removeContextType(
  db: DbPool,
  tenantId: UUID,
  typeName: string,
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM context_type_registry
     WHERE type_name = $1 AND tenant_id = $2 AND is_default = FALSE
     RETURNING type_name`,
    [typeName, tenantId],
  );
  return result.rows.length > 0;
}
