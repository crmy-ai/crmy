// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Unified Search Indexer — Phase 3
 *
 * All write paths that mutate a CRM entity call indexDocument() as a
 * fire-and-forget operation immediately after their DB commit. This keeps
 * the search_index table within one event-loop tick of the source record.
 *
 * Context entries are indexed via the outbox worker (Phase 1 integration):
 * the worker calls indexDocument() for each job it drains rather than the
 * MCP tool directly, ensuring retries if the initial write fails.
 *
 * Search engine: PostgreSQL tsvector / GIN index (026_search_index.sql).
 * No external dependency required — the same Postgres instance used for the
 * rest of the application handles full-text search at this data scale.
 */

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';

export type IndexableEntityType =
  | 'contact'
  | 'account'
  | 'opportunity'
  | 'use_case'
  | 'activity'
  | 'context_entry';

interface IndexDoc {
  tenant_id: UUID;
  entity_id: UUID;
  primary_name: string;
  secondary_text: string;
  status: string | null;
  owner_id: UUID | null;
  metadata: Record<string, unknown>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Upsert a single entity into the unified search index.
 *
 * The tsvector is computed by the database trigger on insert/update so the GIN
 * index is always consistent with the stored text. Caller never needs to touch
 * the search_vector column directly.
 */
export async function indexDocument(
  db: DbPool,
  entityType: IndexableEntityType,
  entity: Record<string, unknown>,
): Promise<void> {
  const doc = normalize(entityType, entity);

  await db.query(
    `INSERT INTO search_index
       (tenant_id, entity_type, entity_id, primary_name, secondary_text,
        status, owner_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE
       SET primary_name   = EXCLUDED.primary_name,
           secondary_text = EXCLUDED.secondary_text,
           status         = EXCLUDED.status,
           owner_id       = EXCLUDED.owner_id,
           metadata       = EXCLUDED.metadata,
           indexed_at     = now()`,
    [
      doc.tenant_id, entityType, doc.entity_id,
      doc.primary_name, doc.secondary_text,
      doc.status, doc.owner_id, JSON.stringify(doc.metadata),
    ],
  );
}

/**
 * Remove an entity from the index. Call from delete handlers so stale entries
 * don't pollute search results.
 */
export async function removeDocument(
  db: DbPool,
  tenantId: UUID,
  entityType: IndexableEntityType,
  entityId: UUID,
): Promise<void> {
  await db.query(
    `DELETE FROM search_index
     WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3`,
    [tenantId, entityType, entityId],
  );
}

// ─── Normalisers ──────────────────────────────────────────────────────────────

function normalize(entityType: IndexableEntityType, e: Record<string, unknown>): IndexDoc {
  switch (entityType) {
    case 'contact':       return normalizeContact(e);
    case 'account':       return normalizeAccount(e);
    case 'opportunity':   return normalizeOpportunity(e);
    case 'use_case':      return normalizeUseCase(e);
    case 'activity':      return normalizeActivity(e);
    case 'context_entry': return normalizeContextEntry(e);
  }
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function normalizeContact(e: Record<string, unknown>): IndexDoc {
  const name = [e.first_name, e.last_name].filter(Boolean).join(' ');
  const secondary = [e.email, e.title, e.company_name, e.phone]
    .filter(Boolean).join(' ');

  return {
    tenant_id: e.tenant_id as UUID,
    entity_id: e.id as UUID,
    primary_name: name || 'Unnamed Contact',
    secondary_text: secondary,
    status: str(e.lifecycle_stage) || null,
    owner_id: (e.owner_id as UUID) ?? null,
    metadata: {
      first_name: e.first_name,
      last_name: e.last_name,
      email: e.email,
      phone: e.phone,
      title: e.title,
      company_name: e.company_name,
      account_id: e.account_id,
      lifecycle_stage: e.lifecycle_stage,
    },
  };
}

function normalizeAccount(e: Record<string, unknown>): IndexDoc {
  const secondary = [e.domain, e.industry, e.website]
    .filter(Boolean).join(' ');

  return {
    tenant_id: e.tenant_id as UUID,
    entity_id: e.id as UUID,
    primary_name: str(e.name) || 'Unnamed Account',
    secondary_text: secondary,
    status: null,
    owner_id: (e.owner_id as UUID) ?? null,
    metadata: {
      name: e.name,
      domain: e.domain,
      industry: e.industry,
      website: e.website,
      health_score: e.health_score,
      annual_revenue: e.annual_revenue,
    },
  };
}

function normalizeOpportunity(e: Record<string, unknown>): IndexDoc {
  const secondary = [e.description, e.lost_reason]
    .filter(Boolean).join(' ');

  return {
    tenant_id: e.tenant_id as UUID,
    entity_id: e.id as UUID,
    primary_name: str(e.name) || 'Unnamed Opportunity',
    secondary_text: secondary,
    status: str(e.stage) || null,
    owner_id: (e.owner_id as UUID) ?? null,
    metadata: {
      name: e.name,
      account_id: e.account_id,
      stage: e.stage,
      amount: e.amount,
      close_date: e.close_date,
      forecast_cat: e.forecast_cat,
    },
  };
}

function normalizeUseCase(e: Record<string, unknown>): IndexDoc {
  return {
    tenant_id: e.tenant_id as UUID,
    entity_id: e.id as UUID,
    primary_name: str(e.name) || 'Unnamed Use Case',
    secondary_text: str(e.description),
    status: str(e.stage) || null,
    owner_id: (e.owner_id as UUID) ?? null,
    metadata: {
      name: e.name,
      account_id: e.account_id,
      stage: e.stage,
      attributed_arr: e.attributed_arr,
      health_score: e.health_score,
    },
  };
}

function normalizeActivity(e: Record<string, unknown>): IndexDoc {
  const secondary = [e.body, e.outcome]
    .filter(Boolean).join(' ');

  return {
    tenant_id: e.tenant_id as UUID,
    entity_id: e.id as UUID,
    primary_name: str(e.subject) || 'Activity',
    secondary_text: secondary,
    status: str(e.status) || null,
    owner_id: (e.owner_id as UUID) ?? null,
    metadata: {
      type: e.type,
      subject: e.subject,
      status: e.status,
      contact_id: e.contact_id,
      account_id: e.account_id,
      opportunity_id: e.opportunity_id,
      subject_type: e.subject_type,
      subject_id: e.subject_id,
      occurred_at: e.occurred_at,
    },
  };
}

function normalizeContextEntry(e: Record<string, unknown>): IndexDoc {
  return {
    tenant_id: e.tenant_id as UUID,
    entity_id: e.id as UUID,
    primary_name: str(e.title) || 'Context Entry',
    secondary_text: str(e.body),
    status: null,
    owner_id: (e.authored_by as UUID) ?? null,
    metadata: {
      context_type: e.context_type,
      title: e.title,
      subject_type: e.subject_type,
      subject_id: e.subject_id,
      confidence: e.confidence,
      is_current: e.is_current,
    },
  };
}
