// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { ActivityTypeRegistryEntry, UUID } from '@crmy/shared';

const DEFAULT_ACTIVITY_TYPES: Omit<ActivityTypeRegistryEntry, 'tenant_id' | 'created_at'>[] = [
  { type_name: 'outreach_email', label: 'Email Sent', category: 'outreach', is_default: true },
  { type_name: 'outreach_call', label: 'Call Made', category: 'outreach', is_default: true },
  { type_name: 'outreach_sms', label: 'SMS Sent', category: 'outreach', is_default: true },
  { type_name: 'outreach_social', label: 'Social Touch', category: 'outreach', is_default: true },
  { type_name: 'meeting_scheduled', label: 'Meeting Scheduled', category: 'meeting', is_default: true },
  { type_name: 'meeting_held', label: 'Meeting Held', category: 'meeting', is_default: true },
  { type_name: 'meeting_cancelled', label: 'Meeting Cancelled', category: 'meeting', is_default: true },
  { type_name: 'proposal_drafted', label: 'Proposal Drafted', category: 'proposal', is_default: true },
  { type_name: 'proposal_sent', label: 'Proposal Sent', category: 'proposal', is_default: true },
  { type_name: 'proposal_viewed', label: 'Proposal Viewed', category: 'proposal', is_default: true },
  { type_name: 'contract_sent', label: 'Contract Sent', category: 'contract', is_default: true },
  { type_name: 'contract_signed', label: 'Contract Signed', category: 'contract', is_default: true },
  { type_name: 'note_added', label: 'Note Added', category: 'internal', is_default: true },
  { type_name: 'research_completed', label: 'Research Completed', category: 'internal', is_default: true },
  { type_name: 'stage_change', label: 'Stage Changed', category: 'lifecycle', is_default: true },
  { type_name: 'field_update', label: 'Field Updated', category: 'lifecycle', is_default: true },
  { type_name: 'task_completed', label: 'Task Completed', category: 'internal', is_default: true },
  { type_name: 'handoff_initiated', label: 'Handoff Initiated', category: 'handoff', is_default: true },
  { type_name: 'handoff_accepted', label: 'Handoff Accepted', category: 'handoff', is_default: true },
];

export async function seedDefaults(db: DbPool, tenantId: UUID): Promise<void> {
  for (const entry of DEFAULT_ACTIVITY_TYPES) {
    await db.query(
      `INSERT INTO activity_type_registry (type_name, tenant_id, label, description, category, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (type_name) DO NOTHING`,
      [entry.type_name, tenantId, entry.label, entry.description ?? null, entry.category, true],
    );
  }
}

export async function listActivityTypes(
  db: DbPool,
  tenantId: UUID,
  filters?: { category?: string },
): Promise<ActivityTypeRegistryEntry[]> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters?.category) {
    conditions.push(`category = $${idx}`);
    params.push(filters.category);
    idx++;
  }

  const result = await db.query(
    `SELECT * FROM activity_type_registry WHERE ${conditions.join(' AND ')} ORDER BY category, type_name`,
    params,
  );
  return result.rows as ActivityTypeRegistryEntry[];
}

export async function addActivityType(
  db: DbPool,
  tenantId: UUID,
  data: { type_name: string; label: string; description?: string; category: string },
): Promise<ActivityTypeRegistryEntry> {
  const result = await db.query(
    `INSERT INTO activity_type_registry (type_name, tenant_id, label, description, category, is_default)
     VALUES ($1, $2, $3, $4, $5, FALSE)
     RETURNING *`,
    [data.type_name, tenantId, data.label, data.description ?? null, data.category],
  );
  return result.rows[0] as ActivityTypeRegistryEntry;
}

export async function removeActivityType(
  db: DbPool,
  tenantId: UUID,
  typeName: string,
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM activity_type_registry
     WHERE type_name = $1 AND tenant_id = $2 AND is_default = FALSE
     RETURNING type_name`,
    [typeName, tenantId],
  );
  return result.rows.length > 0;
}

export async function getActivityType(
  db: DbPool,
  tenantId: UUID,
  typeName: string,
): Promise<ActivityTypeRegistryEntry | null> {
  const result = await db.query(
    'SELECT * FROM activity_type_registry WHERE type_name = $1 AND tenant_id = $2',
    [typeName, tenantId],
  );
  return (result.rows[0] as ActivityTypeRegistryEntry) ?? null;
}
