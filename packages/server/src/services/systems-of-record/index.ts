// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import type { ExternalObjectMapping, ExternalSyncConflict, ExternalSystem, SystemOfRecordType, UUID, WritebackMode } from '@crmy/shared';
import { notFound, validationError } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { decryptSecret } from '../../lib/secrets.js';
import { redactSecrets } from '../../lib/secrets.js';
import { emitEvent } from '../../events/emitter.js';
import * as sorRepo from '../../db/repos/systems-of-record.js';
import * as contactRepo from '../../db/repos/contacts.js';
import * as accountRepo from '../../db/repos/accounts.js';
import * as oppRepo from '../../db/repos/opportunities.js';
import * as activityRepo from '../../db/repos/activities.js';
import * as hitlRepo from '../../db/repos/hitl.js';
import { hubspotAdapter, refreshHubSpotOAuthCredentials } from './hubspot.js';
import { salesforceAdapter, refreshSalesforceOAuthCredentials } from './salesforce.js';
import { databricksAdapter } from './databricks.js';
import { snowflakeAdapter } from './snowflake.js';
import type { ConnectorAdapter, ConnectorContext, ExternalRecord } from './adapters.js';
import { evaluateActionPolicy } from '../action-policy.js';

const adapters: Record<SystemOfRecordType, ConnectorAdapter> = {
  hubspot: hubspotAdapter,
  salesforce: salesforceAdapter,
  databricks: databricksAdapter,
  snowflake: snowflakeAdapter,
};

export function getAdapter(type: SystemOfRecordType): ConnectorAdapter {
  return adapters[type];
}

function externalSyncOrigin(type: SystemOfRecordType): 'crm_sync' | 'warehouse_sync' {
  return type === 'databricks' || type === 'snowflake' ? 'warehouse_sync' : 'crm_sync';
}

export async function buildConnectorContext(db: DbPool, tenantId: UUID, systemId: UUID): Promise<ConnectorContext> {
  const system = await sorRepo.getSystemWithCredentials(db, tenantId, systemId);
  if (!system) throw notFound('System of record', systemId);
  let credentials = decryptSecret<Record<string, unknown>>(system.encrypted_credentials);
  if (system.system_type === 'hubspot') {
    const refreshed = await refreshHubSpotOAuthCredentials(credentials);
    if (refreshed.refreshed) {
      credentials = refreshed.credentials;
      const tokenExpiresAt = typeof credentials.token_expires_at === 'string' ? credentials.token_expires_at : undefined;
      await sorRepo.updateSystem(db, tenantId, systemId, {
        credentials,
        health: {
          ...((system.health ?? {}) as Record<string, unknown>),
          token_refreshed_at: new Date().toISOString(),
          token_expires_at: tokenExpiresAt,
        },
        last_error: null,
      });
      system.health = {
        ...((system.health ?? {}) as Record<string, unknown>),
        token_refreshed_at: new Date().toISOString(),
        token_expires_at: tokenExpiresAt,
      };
    }
  }
  if (system.system_type === 'salesforce') {
    const refreshed = await refreshSalesforceOAuthCredentials(credentials);
    if (refreshed.refreshed) {
      credentials = refreshed.credentials;
      const tokenExpiresAt = typeof credentials.token_expires_at === 'string' ? credentials.token_expires_at : undefined;
      await sorRepo.updateSystem(db, tenantId, systemId, {
        credentials,
        health: {
          ...((system.health ?? {}) as Record<string, unknown>),
          token_refreshed_at: new Date().toISOString(),
          token_expires_at: tokenExpiresAt,
          instance_url: typeof credentials.instance_url === 'string' ? credentials.instance_url : undefined,
        },
        last_error: null,
      });
      system.health = {
        ...((system.health ?? {}) as Record<string, unknown>),
        token_refreshed_at: new Date().toISOString(),
        token_expires_at: tokenExpiresAt,
        instance_url: typeof credentials.instance_url === 'string' ? credentials.instance_url : undefined,
      };
    }
  }
  return {
    system: {
      ...system,
      has_credentials: Boolean(system.encrypted_credentials),
    } as ExternalSystem,
    credentials,
  };
}

export async function testSystemConnection(db: DbPool, tenantId: UUID, systemId: UUID) {
  const ctx = await buildConnectorContext(db, tenantId, systemId);
  const adapter = getAdapter(ctx.system.system_type);
  const validation = await adapter.validateConfig(ctx);
  if (!validation.valid) {
    await sorRepo.updateSystem(db, tenantId, systemId, { status: 'error', last_error: validation.errors.join('; ') });
    return { ok: false, message: validation.errors.join('; '), details: { validation } };
  }
  try {
    const result = await adapter.testConnection(ctx);
    await sorRepo.updateSystem(db, tenantId, systemId, {
      status: 'connected',
      health: {
        ...((ctx.system.health ?? {}) as Record<string, unknown>),
        last_test_at: new Date().toISOString(),
        message: result.message,
        ok: result.ok,
        ...(result.details ?? {}),
      },
      last_error: null,
    });
    return result;
  } catch (err) {
    const normalized = adapter.normalizeError(err);
    await sorRepo.updateSystem(db, tenantId, systemId, {
      status: 'error',
      health: { last_test_at: new Date().toISOString(), ok: false, retryable: normalized.retryable },
      last_error: normalized.message,
    });
    return { ok: false, message: normalized.message, details: normalized.details };
  }
}

function mapFields(record: ExternalRecord, mapping: ExternalObjectMapping): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [crmyField, externalField] of Object.entries(mapping.field_mapping ?? {})) {
    if (externalField in record.fields) mapped[crmyField] = record.fields[externalField];
  }
  return mapped;
}

function hashRecord(record: ExternalRecord): string {
  return crypto.createHash('sha256').update(JSON.stringify(record.fields)).digest('hex');
}

function hashPayload(payload: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableJson(val)}`)
    .join(',')}}`;
}

function equivalentValue(a: unknown, b: unknown): boolean {
  return stableJson(a ?? null) === stableJson(b ?? null);
}

function cleanPatch<T extends Record<string, unknown>>(patch: T): T {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as T;
}

function changedPatchFields(before: Record<string, unknown> | null | undefined, patch: Record<string, unknown>): string[] {
  if (!before) return Object.keys(patch);
  return Object.keys(patch).filter(field => !equivalentValue(before[field], patch[field]));
}

function priorMappedPatch(existing: { metadata?: Record<string, unknown> } | null | undefined, mapping: ExternalObjectMapping): Record<string, unknown> {
  const metadata = existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
  const fields = metadata.fields && typeof metadata.fields === 'object' ? metadata.fields as Record<string, unknown> : {};
  return mapFields({ external_object: mapping.external_object, external_record_id: '', fields }, mapping);
}

function normalizeEmail(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}

function normalizeDomainValue(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    return host.replace(/^www\./, '') || undefined;
  } catch {
    return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || undefined;
  }
}

function normalizeContact(patch: Record<string, unknown>): Record<string, unknown> & { email?: string; account_id?: UUID } {
  const lifecycleStage = ['lead', 'prospect', 'customer', 'churned'].includes(String(patch.lifecycle_stage ?? patch.lifecyclestage))
    ? String(patch.lifecycle_stage ?? patch.lifecyclestage) as 'lead' | 'prospect' | 'customer' | 'churned'
    : 'lead';
  return {
    first_name: String(patch.first_name ?? patch.firstname ?? '').trim() || 'Unknown',
    last_name: String(patch.last_name ?? patch.lastname ?? '').trim(),
    email: normalizeEmail(patch.email),
    phone: typeof patch.phone === 'string' ? patch.phone : undefined,
    title: typeof patch.title === 'string' || typeof patch.jobtitle === 'string' ? String(patch.title ?? patch.jobtitle) : undefined,
    company_name: typeof patch.company_name === 'string' || typeof patch.company === 'string' ? String(patch.company_name ?? patch.company) : undefined,
    lifecycle_stage: lifecycleStage,
    source: 'external_sync',
    custom_fields: patch.custom_fields && typeof patch.custom_fields === 'object' ? patch.custom_fields as Record<string, unknown> : {},
  };
}

function normalizeAccount(patch: Record<string, unknown>): Record<string, unknown> & { domain?: string } {
  return {
    name: String(patch.name ?? patch.company_name ?? '').trim() || 'Unknown company',
    domain: normalizeDomainValue(patch.domain),
    industry: typeof patch.industry === 'string' ? patch.industry : undefined,
    employee_count: patch.employee_count != null || patch.numberofemployees != null ? Number(patch.employee_count ?? patch.numberofemployees) || undefined : undefined,
    annual_revenue: patch.annual_revenue != null || patch.annualrevenue != null ? Number(patch.annual_revenue ?? patch.annualrevenue) || undefined : undefined,
    website: typeof patch.website === 'string' ? patch.website : undefined,
    custom_fields: patch.custom_fields && typeof patch.custom_fields === 'object' ? patch.custom_fields as Record<string, unknown> : {},
  };
}

function normalizeOpportunity(patch: Record<string, unknown>): Record<string, unknown> & { account_id?: UUID; contact_id?: UUID } {
  const stage = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'].includes(String(patch.stage ?? patch.dealstage))
    ? String(patch.stage ?? patch.dealstage) as 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost'
    : 'prospecting';
  return {
    name: String(patch.name ?? patch.dealname ?? '').trim() || 'External opportunity',
    amount: patch.amount != null ? Number(patch.amount) || undefined : undefined,
    stage,
    close_date: typeof patch.close_date === 'string' || typeof patch.closedate === 'string' ? String(patch.close_date ?? patch.closedate) : undefined,
    custom_fields: patch.custom_fields && typeof patch.custom_fields === 'object' ? patch.custom_fields as Record<string, unknown> : {},
  };
}

function normalizeMappedPatch(objectType: string, mapped: Record<string, unknown>): Record<string, unknown> {
  if (objectType === 'contact') return cleanPatch(normalizeContact(mapped));
  if (objectType === 'account') return cleanPatch(normalizeAccount(mapped));
  if (objectType === 'opportunity') return cleanPatch(normalizeOpportunity(mapped));
  return cleanPatch(mapped);
}

function mappingPriority(mapping: ExternalObjectMapping): number {
  switch (mapping.object_type) {
    case 'account':
      return 10;
    case 'contact':
      return 20;
    case 'opportunity':
      return 30;
    case 'activity':
      return 40;
    default:
      return 50;
  }
}

function initialSyncCursor(mapping: ExternalObjectMapping, mode: 'test' | 'full' | 'incremental' | 'replay'): string | undefined {
  if (mode !== 'incremental') return undefined;
  if (mapping.sync_cursor) return mapping.sync_cursor;
  if (mapping.sync_watermark) return JSON.stringify({ watermark: mapping.sync_watermark });
  return undefined;
}

type PendingAssociationConflict = {
  field_name: string;
  external_object: string;
  external_record_id: string;
  external_value: Record<string, unknown>;
};

function associatedIds(record: ExternalRecord, externalObject: string): string[] {
  return record.associations?.[externalObject] ?? [];
}

async function resolveAssociatedObject(
  db: DbPool,
  tenantId: UUID,
  system: ExternalSystem,
  record: ExternalRecord,
  externalObject: string,
  expectedObjectType: string,
): Promise<{ id?: UUID; conflict?: PendingAssociationConflict }> {
  const [externalRecordId] = associatedIds(record, externalObject);
  if (!externalRecordId) return {};
  const ref = await sorRepo.findRecordRef(db, tenantId, system.id, externalObject, externalRecordId);
  if (ref && ref.object_type === expectedObjectType) return { id: ref.object_id };
  return {
    conflict: {
      field_name: `association:${externalObject}`,
      external_object: record.external_object,
      external_record_id: record.external_record_id,
      external_value: {
        expected_object_type: expectedObjectType,
        associated_external_object: externalObject,
        associated_external_record_id: externalRecordId,
        resolved_object_type: ref?.object_type,
      },
    },
  };
}

async function createAssociationConflicts(
  db: DbPool,
  tenantId: UUID,
  system: ExternalSystem,
  mapping: ExternalObjectMapping,
  syncRunId: UUID,
  objectId: UUID,
  conflicts: PendingAssociationConflict[],
): Promise<number> {
  for (const conflict of conflicts) {
    await sorRepo.createConflict(db, tenantId, {
      system_id: system.id,
      mapping_id: mapping.id,
      sync_run_id: syncRunId,
      object_type: mapping.object_type,
      object_id: objectId,
      external_object: conflict.external_object,
      external_record_id: conflict.external_record_id,
      field_name: conflict.field_name,
      local_value: { object_id: objectId },
      external_value: conflict.external_value,
    });
  }
  return conflicts.length;
}

async function hasConflictingObjectRef(
  db: DbPool,
  tenantId: UUID,
  system: ExternalSystem,
  mapping: ExternalObjectMapping,
  syncRunId: UUID,
  record: ExternalRecord,
  objectId: UUID,
): Promise<boolean> {
  const existingObjectRef = await sorRepo.findRecordRefForObject(
    db,
    tenantId,
    system.id,
    mapping.object_type,
    objectId,
    record.external_object,
  );
  if (!existingObjectRef || existingObjectRef.external_record_id === record.external_record_id) return false;

  await sorRepo.createConflict(db, tenantId, {
    system_id: system.id,
    mapping_id: mapping.id,
    sync_run_id: syncRunId,
    object_type: mapping.object_type,
    object_id: objectId,
    external_object: record.external_object,
    external_record_id: record.external_record_id,
    field_name: 'external_record_id',
    local_value: {
      linked_external_record_id: existingObjectRef.external_record_id,
      object_id: objectId,
    },
    external_value: {
      incoming_external_record_id: record.external_record_id,
      fields: record.fields,
    },
  });
  return true;
}

async function createFieldConflicts(
  db: DbPool,
  tenantId: UUID,
  system: ExternalSystem,
  mapping: ExternalObjectMapping,
  syncRunId: UUID,
  record: ExternalRecord,
  objectId: UUID | undefined,
  before: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
  fields: string[],
  reason: string,
): Promise<number> {
  for (const field of fields) {
    await sorRepo.createConflict(db, tenantId, {
      system_id: system.id,
      mapping_id: mapping.id,
      sync_run_id: syncRunId,
      object_type: mapping.object_type,
      object_id: objectId,
      external_object: record.external_object,
      external_record_id: record.external_record_id,
      field_name: field,
      local_value: {
        value: before?.[field] ?? null,
        reason,
        source_authority: mapping.source_authority,
      },
      external_value: {
        value: patch[field] ?? null,
        fields: record.fields,
      },
    });
  }
  return fields.length;
}

async function createRowErrorConflict(
  db: DbPool,
  tenantId: UUID,
  system: ExternalSystem,
  mapping: ExternalObjectMapping,
  syncRunId: UUID,
  record: ExternalRecord,
  error: unknown,
): Promise<void> {
  await sorRepo.createConflict(db, tenantId, {
    system_id: system.id,
    mapping_id: mapping.id,
    sync_run_id: syncRunId,
    object_type: mapping.object_type,
    external_object: record.external_object,
    external_record_id: record.external_record_id,
    field_name: 'row_error',
    local_value: { error: 'record_not_applied' },
    external_value: {
      message: error instanceof Error ? error.message : String(error),
      fields: record.fields,
    },
  });
}

type AuthorityDecision = {
  action: 'apply' | 'skip' | 'conflict';
  fields: string[];
  reason?: string;
};

function authorityDecision(
  mapping: ExternalObjectMapping,
  before: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
  changedFields: string[],
  priorPatch: Record<string, unknown>,
): AuthorityDecision {
  if (changedFields.length === 0) return { action: 'skip', fields: [] };
  if (!before) return { action: 'apply', fields: changedFields };

  switch (mapping.source_authority) {
    case 'crmy':
    case 'read_only':
    case 'approval_required':
      return {
        action: 'conflict',
        fields: changedFields,
        reason: `${mapping.source_authority} mappings do not overwrite existing CRMy values during sync.`,
      };
    case 'bidirectional': {
      const locallyDiverged = changedFields.filter(field => (
        field in priorPatch && !equivalentValue(before[field], priorPatch[field])
      ));
      if (locallyDiverged.length) {
        return {
          action: 'conflict',
          fields: locallyDiverged,
          reason: 'CRMy and the external system both changed this field since the last sync.',
        };
      }
      return { action: 'apply', fields: changedFields };
    }
    case 'external':
    default:
      return { action: 'apply', fields: changedFields };
  }
}

type ApplyRecordResult = {
  status: 'created' | 'updated' | 'skipped' | 'conflict';
  conflictsCreated: number;
};

async function applyRecord(
  db: DbPool,
  tenantId: UUID,
  system: ExternalSystem,
  mapping: ExternalObjectMapping,
  syncRunId: UUID,
  record: ExternalRecord,
  syncMode: 'test' | 'full' | 'incremental' | 'replay',
): Promise<ApplyRecordResult> {
  const existing = await sorRepo.findRecordRef(db, tenantId, system.id, record.external_object, record.external_record_id);
  const sourceHash = hashRecord(record);
  if (existing?.source_hash === sourceHash) {
    return { status: 'skipped', conflictsCreated: 0 };
  }
  const mapped = mapFields(record, mapping);
  let objectId = existing?.object_id;
  let linkedExistingRecord = Boolean(existing);
  let changedFields = Object.keys(mapped);
  let eventType: string | null = null;
  let afterData: Record<string, unknown> | null = null;
  const associationConflicts: PendingAssociationConflict[] = [];

  if (mapping.object_type === 'contact') {
    const patch = cleanPatch(normalizeContact(mapped));
    const accountAssociation = await resolveAssociatedObject(db, tenantId, system, record, 'companies', 'account');
    if (accountAssociation.id) patch.account_id = accountAssociation.id;
    if (accountAssociation.conflict) associationConflicts.push(accountAssociation.conflict);
    if (!objectId && patch.email) {
      const matched = await contactRepo.getContactByEmail(db, tenantId, patch.email);
      if (matched) {
        objectId = matched.id;
        linkedExistingRecord = true;
      }
    }
    if (!existing && objectId && await hasConflictingObjectRef(db, tenantId, system, mapping, syncRunId, record, objectId)) {
      return { status: 'conflict', conflictsCreated: 1 };
    }
    if (objectId) {
      const before = await contactRepo.getContact(db, tenantId, objectId);
      changedFields = changedPatchFields(before as unknown as Record<string, unknown> | null, patch);
      const decision = authorityDecision(
        mapping,
        before as unknown as Record<string, unknown> | null,
        patch,
        changedFields,
        normalizeMappedPatch(mapping.object_type, priorMappedPatch(existing, mapping)),
      );
      if (decision.action === 'skip') {
        await sorRepo.upsertRecordRef(db, tenantId, {
          system_id: system.id,
          mapping_id: mapping.id,
          object_type: mapping.object_type,
          object_id: objectId,
          external_object: record.external_object,
          external_record_id: record.external_record_id,
          external_updated_at: record.external_updated_at,
          source_hash: sourceHash,
          last_sync_run_id: syncRunId,
          metadata: { fields: record.fields },
        });
        return { status: 'skipped', conflictsCreated: 0 };
      }
      if (decision.action === 'conflict') {
        const count = await createFieldConflicts(db, tenantId, system, mapping, syncRunId, record, objectId, before as unknown as Record<string, unknown> | null, patch, decision.fields, decision.reason ?? 'source authority conflict');
        return { status: 'conflict', conflictsCreated: count };
      }
      const updated = before ? await contactRepo.updateContact(db, tenantId, objectId, patch) : null;
      afterData = updated as unknown as Record<string, unknown>;
      eventType = 'contact.updated';
    } else {
      const created = await contactRepo.createContact(db, tenantId, patch);
      objectId = created.id;
      afterData = created as unknown as Record<string, unknown>;
      eventType = 'contact.created';
    }
  } else if (mapping.object_type === 'account') {
    const patch = cleanPatch(normalizeAccount(mapped));
    if (!objectId && patch.domain) {
      const matched = await accountRepo.getAccountByDomain(db, tenantId, patch.domain);
      if (matched) {
        objectId = matched.id;
        linkedExistingRecord = true;
      }
    }
    if (!existing && objectId && await hasConflictingObjectRef(db, tenantId, system, mapping, syncRunId, record, objectId)) {
      return { status: 'conflict', conflictsCreated: 1 };
    }
    if (objectId) {
      const before = await accountRepo.getAccount(db, tenantId, objectId);
      changedFields = changedPatchFields(before as unknown as Record<string, unknown> | null, patch);
      const decision = authorityDecision(
        mapping,
        before as unknown as Record<string, unknown> | null,
        patch,
        changedFields,
        normalizeMappedPatch(mapping.object_type, priorMappedPatch(existing, mapping)),
      );
      if (decision.action === 'skip') {
        await sorRepo.upsertRecordRef(db, tenantId, {
          system_id: system.id,
          mapping_id: mapping.id,
          object_type: mapping.object_type,
          object_id: objectId,
          external_object: record.external_object,
          external_record_id: record.external_record_id,
          external_updated_at: record.external_updated_at,
          source_hash: sourceHash,
          last_sync_run_id: syncRunId,
          metadata: { fields: record.fields },
        });
        return { status: 'skipped', conflictsCreated: 0 };
      }
      if (decision.action === 'conflict') {
        const count = await createFieldConflicts(db, tenantId, system, mapping, syncRunId, record, objectId, before as unknown as Record<string, unknown> | null, patch, decision.fields, decision.reason ?? 'source authority conflict');
        return { status: 'conflict', conflictsCreated: count };
      }
      const updated = await accountRepo.updateAccount(db, tenantId, objectId, patch);
      afterData = updated as unknown as Record<string, unknown>;
      eventType = 'account.updated';
    } else {
      const created = await accountRepo.createAccount(db, tenantId, patch);
      objectId = created.id;
      afterData = created as unknown as Record<string, unknown>;
      eventType = 'account.created';
    }
  } else if (mapping.object_type === 'opportunity') {
    const patch = cleanPatch(normalizeOpportunity(mapped));
    const accountAssociation = await resolveAssociatedObject(db, tenantId, system, record, 'companies', 'account');
    const contactAssociation = await resolveAssociatedObject(db, tenantId, system, record, 'contacts', 'contact');
    if (accountAssociation.id) patch.account_id = accountAssociation.id;
    if (contactAssociation.id) patch.contact_id = contactAssociation.id;
    if (accountAssociation.conflict) associationConflicts.push(accountAssociation.conflict);
    if (contactAssociation.conflict) associationConflicts.push(contactAssociation.conflict);
    if (objectId) {
      const before = await oppRepo.getOpportunity(db, tenantId, objectId);
      changedFields = changedPatchFields(before as unknown as Record<string, unknown> | null, patch);
      const decision = authorityDecision(
        mapping,
        before as unknown as Record<string, unknown> | null,
        patch,
        changedFields,
        normalizeMappedPatch(mapping.object_type, priorMappedPatch(existing, mapping)),
      );
      if (decision.action === 'skip') {
        await sorRepo.upsertRecordRef(db, tenantId, {
          system_id: system.id,
          mapping_id: mapping.id,
          object_type: mapping.object_type,
          object_id: objectId,
          external_object: record.external_object,
          external_record_id: record.external_record_id,
          external_updated_at: record.external_updated_at,
          source_hash: sourceHash,
          last_sync_run_id: syncRunId,
          metadata: { fields: record.fields },
        });
        return { status: 'skipped', conflictsCreated: 0 };
      }
      if (decision.action === 'conflict') {
        const count = await createFieldConflicts(db, tenantId, system, mapping, syncRunId, record, objectId, before as unknown as Record<string, unknown> | null, patch, decision.fields, decision.reason ?? 'source authority conflict');
        return { status: 'conflict', conflictsCreated: count };
      }
      const updated = await oppRepo.updateOpportunity(db, tenantId, objectId, patch);
      afterData = updated as unknown as Record<string, unknown>;
      eventType = 'opportunity.updated';
    } else {
      const created = await oppRepo.createOpportunity(db, tenantId, patch);
      objectId = created.id;
      afterData = created as unknown as Record<string, unknown>;
      eventType = 'opportunity.created';
    }
  } else if (mapping.object_type === 'activity') {
    const accountAssociation = await resolveAssociatedObject(db, tenantId, system, record, 'companies', 'account');
    const contactAssociation = await resolveAssociatedObject(db, tenantId, system, record, 'contacts', 'contact');
    const opportunityAssociation = await resolveAssociatedObject(db, tenantId, system, record, 'deals', 'opportunity');
    if (accountAssociation.conflict) associationConflicts.push(accountAssociation.conflict);
    if (contactAssociation.conflict) associationConflicts.push(contactAssociation.conflict);
    if (opportunityAssociation.conflict) associationConflicts.push(opportunityAssociation.conflict);
    const created = await activityRepo.createActivity(db, tenantId, {
      type: (mapped.type as any) ?? (record.external_object === 'calls' ? 'call' : 'note'),
      subject: String(mapped.subject ?? mapped.title ?? 'External activity'),
      body: typeof mapped.body === 'string' ? mapped.body : undefined,
      account_id: accountAssociation.id,
      contact_id: contactAssociation.id,
      opportunity_id: opportunityAssociation.id,
      source_agent: `${system.system_type}:${system.id}`,
      detail: { external_record: record.fields, associations: record.associations ?? {} },
    });
    objectId = created.id;
    afterData = created as unknown as Record<string, unknown>;
    eventType = 'activity.created';
  } else if (mapping.object_type === 'context_entry') {
    await sorRepo.createConflict(db, tenantId, {
      system_id: system.id,
      mapping_id: mapping.id,
      sync_run_id: syncRunId,
      object_type: mapping.object_type,
      external_object: record.external_object,
      external_record_id: record.external_record_id,
      field_name: 'context_entry_author',
      local_value: { reason: 'connector_author_required' },
      external_value: {
        message: 'Context entry sync needs a configured connector/system author actor before CRMy can save external rows as reviewed memory.',
        fields: record.fields,
      },
    });
    return { status: 'conflict', conflictsCreated: 1 };
  } else {
    await sorRepo.createConflict(db, tenantId, {
      system_id: system.id,
      mapping_id: mapping.id,
      sync_run_id: syncRunId,
      object_type: mapping.object_type,
      external_object: record.external_object,
      external_record_id: record.external_record_id,
      field_name: 'unsupported_object_type',
      local_value: { reason: 'mapping_not_syncable' },
      external_value: {
        message: `${mapping.object_type} mappings are not syncable in this 0.8 release path.`,
        fields: record.fields,
      },
    });
    return { status: 'conflict', conflictsCreated: 1 };
  }

  if (!objectId || !eventType || !afterData) return { status: 'skipped', conflictsCreated: 0 };

  const associationConflictCount = await createAssociationConflicts(
    db,
    tenantId,
    system,
    mapping,
    syncRunId,
    objectId,
    associationConflicts,
  );

  await sorRepo.upsertRecordRef(db, tenantId, {
    system_id: system.id,
    mapping_id: mapping.id,
    object_type: mapping.object_type,
    object_id: objectId,
    external_object: record.external_object,
    external_record_id: record.external_record_id,
    external_updated_at: record.external_updated_at,
    source_hash: sourceHash,
    last_sync_run_id: syncRunId,
    metadata: { fields: record.fields },
  });

  await emitEvent(db, {
    tenantId,
    eventType,
    actorType: 'system',
    objectType: mapping.object_type,
    objectId,
    afterData,
    metadata: {
      origin: externalSyncOrigin(system.system_type),
      system_id: system.id,
      system_type: system.system_type,
      external_record_id: record.external_record_id,
      sync_run_id: syncRunId,
      sync_mode: syncMode,
      changed_fields: changedFields,
      confidence: 1,
      conflict_state: 'none',
    },
  });

  return { status: linkedExistingRecord ? 'updated' : 'created', conflictsCreated: associationConflictCount };
}

export async function runSystemSync(
  db: DbPool,
  tenantId: UUID,
  input: { system_id: UUID; mapping_id?: UUID; mode: 'test' | 'full' | 'incremental' | 'replay'; replay_of_run_id?: UUID },
) {
  const ctx = await buildConnectorContext(db, tenantId, input.system_id);
  const adapter = getAdapter(ctx.system.system_type);
  const mappings = input.mapping_id
    ? [await sorRepo.getMapping(db, tenantId, input.mapping_id)]
    : (await sorRepo.listMappings(db, tenantId, { system_id: input.system_id, is_active: true, limit: 100, cursor: undefined })).data;
  const activeMappings = (mappings.filter(Boolean) as ExternalObjectMapping[]).sort((a, b) => mappingPriority(a) - mappingPriority(b));
  if (activeMappings.length === 0) throw validationError('No active mappings exist for this system.');

  const run = await sorRepo.createSyncRun(db, tenantId, {
    system_id: input.system_id,
    mapping_id: input.mapping_id,
    mode: input.mode,
    replay_of_run_id: input.replay_of_run_id,
  });

  let recordsSeen = 0;
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;
  let conflictsCreated = 0;
  let watermark: string | undefined;
  try {
    for (const mapping of activeMappings) {
      let cursor: string | undefined = initialSyncCursor(mapping, input.mode);
      let mappingWatermark: string | undefined;
      do {
        const pulled = await adapter.pullChanges(ctx, mapping, cursor);
        cursor = pulled.next_cursor;
        watermark = pulled.watermark ?? watermark;
        mappingWatermark = pulled.watermark ?? mappingWatermark;
        for (const record of pulled.records) {
          recordsSeen++;
          try {
            const result = await applyRecord(db, tenantId, ctx.system, mapping, run.id, record, input.mode);
            conflictsCreated += result.conflictsCreated;
            if (result.status === 'created') recordsCreated++;
            else if (result.status === 'updated') recordsUpdated++;
            else if (result.status === 'conflict') {
              recordsSkipped++;
            }
            else recordsSkipped++;
          } catch (err) {
            await createRowErrorConflict(db, tenantId, ctx.system, mapping, run.id, record, err);
            conflictsCreated++;
            recordsSkipped++;
          }
        }
      } while (cursor && input.mode !== 'test');
      if (input.mode !== 'test') {
        await sorRepo.updateMappingCheckpoint(db, tenantId, mapping.id, {
          sync_cursor: null,
          sync_watermark: mappingWatermark,
          last_sync_run_id: run.id,
        });
      }
    }
    const completed = await sorRepo.updateSyncRun(db, tenantId, run.id, {
      status: 'completed',
      records_seen: recordsSeen,
      records_created: recordsCreated,
      records_updated: recordsUpdated,
      records_skipped: recordsSkipped,
      conflicts_created: conflictsCreated,
      watermark_value: watermark,
    });
    await sorRepo.updateSystem(db, tenantId, input.system_id, {
      status: 'connected',
      last_sync_at: new Date().toISOString(),
      last_error: null,
      health: {
        last_sync_run_id: run.id,
        records_seen: recordsSeen,
        records_created: recordsCreated,
        records_updated: recordsUpdated,
        records_skipped: recordsSkipped,
        conflicts_created: conflictsCreated,
      },
    });
    await emitEvent(db, {
      tenantId,
      eventType: 'system_sync.completed',
      actorType: 'system',
      objectType: 'external_sync_run',
      objectId: run.id,
      afterData: completed as unknown as Record<string, unknown>,
      metadata: {
        origin: externalSyncOrigin(ctx.system.system_type),
        system_id: input.system_id,
        system_type: ctx.system.system_type,
        sync_run_id: run.id,
        sync_mode: input.mode,
        changed_fields: [],
        confidence: 1,
        conflict_state: conflictsCreated > 0 ? 'open' : 'none',
      },
    });
    return completed ?? run;
  } catch (err) {
    const normalized = adapter.normalizeError(err);
    const failed = await sorRepo.updateSyncRun(db, tenantId, run.id, {
      status: 'failed',
      error: normalized.message,
      records_seen: recordsSeen,
      records_created: recordsCreated,
      records_updated: recordsUpdated,
      records_skipped: recordsSkipped,
      conflicts_created: conflictsCreated,
    });
    await sorRepo.updateSystem(db, tenantId, input.system_id, { status: 'error', last_error: normalized.message });
    await emitEvent(db, {
      tenantId,
      eventType: 'system_sync.failed',
      actorType: 'system',
      objectType: 'external_sync_run',
      objectId: run.id,
      afterData: (failed ?? { ...run, status: 'failed', error: normalized.message }) as unknown as Record<string, unknown>,
      metadata: {
        origin: externalSyncOrigin(ctx.system.system_type),
        system_id: input.system_id,
        system_type: ctx.system.system_type,
        sync_run_id: run.id,
        sync_mode: input.mode,
        changed_fields: [],
        confidence: 1,
        conflict_state: conflictsCreated > 0 ? 'open' : 'none',
      },
    });
    throw err;
  }
}

function associationPatchForConflict(conflict: ExternalSyncConflict, relatedObjectId: UUID): Record<string, UUID> {
  const externalValue = conflict.external_value && typeof conflict.external_value === 'object'
    ? conflict.external_value as Record<string, unknown>
    : {};
  const expectedType = typeof externalValue.expected_object_type === 'string' ? externalValue.expected_object_type : '';

  if (conflict.object_type === 'contact' && expectedType === 'account') {
    return { account_id: relatedObjectId };
  }
  if (conflict.object_type === 'opportunity' && expectedType === 'account') {
    return { account_id: relatedObjectId };
  }
  if (conflict.object_type === 'opportunity' && expectedType === 'contact') {
    return { contact_id: relatedObjectId };
  }
  if (conflict.object_type === 'activity' && expectedType === 'account') {
    return { account_id: relatedObjectId };
  }
  if (conflict.object_type === 'activity' && expectedType === 'contact') {
    return { contact_id: relatedObjectId };
  }
  if (conflict.object_type === 'activity' && expectedType === 'opportunity') {
    return { opportunity_id: relatedObjectId };
  }

  throw validationError(`Conflict ${conflict.id} cannot apply association ${expectedType} to ${conflict.object_type}.`);
}

async function applyExternalConflictResolution(
  db: DbPool,
  tenantId: UUID,
  conflict: ExternalSyncConflict,
): Promise<Record<string, unknown>> {
  if (!conflict.object_id) {
    throw validationError('This conflict is not linked to a CRMy record. Resolve it manually or ignore it.');
  }

  if (conflict.field_name.startsWith('association:')) {
    const externalValue = conflict.external_value && typeof conflict.external_value === 'object'
      ? conflict.external_value as Record<string, unknown>
      : {};
    const externalObject = typeof externalValue.associated_external_object === 'string'
      ? externalValue.associated_external_object
      : conflict.field_name.replace('association:', '');
    const externalRecordId = typeof externalValue.associated_external_record_id === 'string'
      ? externalValue.associated_external_record_id
      : '';
    const expectedObjectType = typeof externalValue.expected_object_type === 'string'
      ? externalValue.expected_object_type
      : '';
    if (!externalRecordId || !expectedObjectType) {
      throw validationError('This association conflict is missing the external record details needed to apply it.');
    }

    const ref = await sorRepo.findRecordRef(db, tenantId, conflict.system_id, externalObject, externalRecordId);
    if (!ref) {
      throw validationError(`The related ${expectedObjectType} has not been synced yet. Run sync for ${externalObject}, then resolve this conflict again.`);
    }
    if (ref.object_type !== expectedObjectType) {
      throw validationError(`The related external record resolved to ${ref.object_type}, not ${expectedObjectType}. Review the mapping before applying this conflict.`);
    }

    const patch = associationPatchForConflict(conflict, ref.object_id);
    let updated: Record<string, unknown> | null = null;
    if (conflict.object_type === 'contact') {
      updated = await contactRepo.updateContact(db, tenantId, conflict.object_id, patch) as unknown as Record<string, unknown> | null;
    } else if (conflict.object_type === 'opportunity') {
      updated = await oppRepo.updateOpportunity(db, tenantId, conflict.object_id, patch) as unknown as Record<string, unknown> | null;
    } else if (conflict.object_type === 'activity') {
      updated = await activityRepo.updateActivity(db, tenantId, conflict.object_id, patch) as unknown as Record<string, unknown> | null;
    }
    if (!updated) throw validationError(`Could not update ${conflict.object_type} ${conflict.object_id}.`);
    return { applied: true, patch, object: updated };
  }

  if (conflict.field_name === 'external_record_id') {
    const externalValue = conflict.external_value && typeof conflict.external_value === 'object'
      ? conflict.external_value as Record<string, unknown>
      : {};
    const incomingExternalRecordId = typeof externalValue.incoming_external_record_id === 'string'
      ? externalValue.incoming_external_record_id
      : conflict.external_record_id;
    const replaced = await sorRepo.replaceRecordRefExternalId(db, tenantId, {
      system_id: conflict.system_id,
      object_type: conflict.object_type,
      object_id: conflict.object_id,
      external_object: conflict.external_object,
      external_record_id: incomingExternalRecordId,
      metadata: { resolved_conflict_id: conflict.id, previous_value: conflict.local_value },
    });
    if (!replaced) {
      throw validationError('Could not relink the external record reference. It may have already been changed or removed.');
    }
    return { applied: true, external_record_id: incomingExternalRecordId };
  }

  throw validationError(`Conflict field ${conflict.field_name} cannot be automatically applied yet. Keep local or ignore it, or update the record manually.`);
}

export async function resolveSyncConflict(
  db: DbPool,
  tenantId: UUID,
  actorId: string,
  actorType: 'user' | 'agent' | 'system',
  input: { id: UUID; resolution: ExternalSyncConflict['status']; note?: string },
) {
  const before = await sorRepo.getConflict(db, tenantId, input.id);
  if (!before) throw notFound('Sync conflict', input.id);
  if (before.status !== 'open') {
    throw validationError(`Conflict ${before.id} is already ${before.status}.`);
  }

  let applied: Record<string, unknown> | undefined;
  if (input.resolution === 'resolved_external') {
    applied = await applyExternalConflictResolution(db, tenantId, before);
  }

  const conflict = await sorRepo.resolveConflict(db, tenantId, input.id, input.resolution, input.note, actorId);
  if (!conflict) throw notFound('Sync conflict', input.id);
  const event_id = await emitEvent(db, {
    tenantId,
    eventType: 'sync_conflict.resolved',
    actorId,
    actorType,
    objectType: 'external_sync_conflict',
    objectId: conflict.id,
    beforeData: before as unknown as Record<string, unknown>,
    afterData: { conflict, applied },
    metadata: {
      origin: 'crmy',
      system_id: conflict.system_id,
      external_record_id: conflict.external_record_id,
      conflict_state: conflict.status === 'ignored' ? 'unknown' : 'resolved',
    },
  });
  return { conflict, applied, event_id };
}

export async function previewExternalWriteback(
  db: DbPool,
  tenantId: UUID,
  input: {
    system_id: UUID; mapping_id?: UUID; object_type: string; external_object: string;
    external_record_id?: string; operation: string; writeback_mode: WritebackMode; payload: Record<string, unknown>;
  },
) {
  const ctx = await buildConnectorContext(db, tenantId, input.system_id);
  const mapping = input.mapping_id
    ? await sorRepo.getMapping(db, tenantId, input.mapping_id)
    : null;
  if (!mapping) throw notFound('System mapping', input.mapping_id ?? 'default');
  if (mapping.system_id !== input.system_id) throw validationError('The selected mapping does not belong to this system.');
  const preview = await getAdapter(ctx.system.system_type).previewWrite(ctx, mapping, input);
  const policyWarnings: string[] = [];
  let allowed = preview.allowed;
  let requiresApproval = preview.requires_approval;

  if (mapping.source_authority === 'read_only') {
    allowed = false;
    requiresApproval = false;
    policyWarnings.push('This mapping is read-only. Change source authority before requesting external writeback.');
  } else if (mapping.source_authority === 'external') {
    requiresApproval = true;
    policyWarnings.push('The external system is marked authoritative for this mapping, so writeback requires approval.');
  } else if (mapping.source_authority === 'approval_required') {
    requiresApproval = true;
    policyWarnings.push('This mapping requires approval before external writeback.');
  }

  const actionPolicy = evaluateActionPolicy({
    action_type: 'external.writeback',
    object_type: mapping.object_type,
    field_names: Object.keys(input.payload ?? {}),
    target_system_type: ctx.system.system_type,
    source_authority: mapping.source_authority,
  });
  if (actionPolicy.decision === 'blocked') {
    allowed = false;
    requiresApproval = false;
  } else if (actionPolicy.decision === 'approval_required') {
    requiresApproval = true;
  }

  return {
    ...preview,
    allowed,
    requires_approval: requiresApproval,
    warnings: [...(preview.warnings ?? []), ...policyWarnings, ...actionPolicy.reasons.filter(reason => reason !== 'Policy allows this action.')],
    policy: {
      source_authority: mapping.source_authority,
      mapping_id: mapping.id,
      action_policy: actionPolicy,
    },
  };
}

export async function requestExternalWriteback(
  db: DbPool,
  tenantId: UUID,
  actorId: string,
  input: {
    system_id: UUID; mapping_id?: UUID; object_type: string; object_id?: UUID; external_object: string;
    external_record_id?: string; operation: ExternalWritebackModeOperation; writeback_mode: WritebackMode;
    payload: Record<string, unknown>; require_approval?: boolean; idempotency_key?: string;
  },
) {
  if (input.idempotency_key) {
    const existing = await sorRepo.getWritebackByIdempotencyKey(db, tenantId, input.system_id, input.idempotency_key);
    if (existing) {
      const sameRequest = existing.object_type === input.object_type
        && existing.object_id === (input.object_id ?? null)
        && existing.external_object === input.external_object
        && existing.external_record_id === (input.external_record_id ?? null)
        && existing.operation === input.operation
        && existing.writeback_mode === input.writeback_mode
        && equivalentValue(existing.payload, input.payload);
      if (!sameRequest) {
        throw validationError('This writeback idempotency key was already used for a different request. Reuse the same payload or provide a new idempotency key.');
      }
      return existing;
    }
  }
  const preview = await previewExternalWriteback(db, tenantId, input);
  const status = !preview.allowed
    ? 'rejected'
    : input.require_approval === false && !preview.requires_approval
      ? 'approved'
      : 'approval_required';
  const writeback = await sorRepo.createWriteback(db, tenantId, {
    ...input,
    operation: input.operation,
    preview: preview as unknown as Record<string, unknown>,
    policy_result: {
      allowed: preview.allowed,
      requires_approval: preview.requires_approval || input.require_approval !== false,
      action_policy: (preview as { policy?: unknown }).policy,
    },
    status,
    requested_by: actorId,
  });

  if (status === 'rejected') {
    return writeback;
  }

  if (status === 'approval_required') {
    const hitl = await hitlRepo.createHITLRequest(db, tenantId, {
      agent_id: actorId,
      action_type: 'external.writeback',
      action_summary: `Approve ${input.operation} writeback to ${input.external_object}`,
      action_payload: {
        writeback_id: writeback.id,
        system_id: input.system_id,
        mapping_id: input.mapping_id,
        object_type: input.object_type,
        object_id: input.object_id,
        external_object: input.external_object,
        external_record_id: input.external_record_id,
        operation: input.operation,
        writeback_mode: input.writeback_mode,
        preview,
      },
      priority: preview.allowed ? 'normal' : 'high',
      sla_minutes: 1440,
    });
    const nextStatus = hitl.status === 'approved' || hitl.status === 'auto_approved'
      ? 'approved'
      : hitl.status === 'rejected'
        ? 'rejected'
        : 'approval_required';
    const linked = await sorRepo.updateWriteback(db, tenantId, writeback.id, {
      status: nextStatus,
      hitl_request_id: hitl.id,
      policy_result: {
        allowed: preview.allowed,
        requires_approval: preview.requires_approval || input.require_approval !== false,
        hitl_status: hitl.status,
        action_policy: (preview as { policy?: unknown }).policy,
      },
    });
    return linked ?? writeback;
  }

  return writeback;
}

export async function reviewExternalWriteback(
  db: DbPool,
  tenantId: UUID,
  actorId: string,
  input: { id: UUID; decision: 'approved' | 'rejected'; note?: string },
) {
  const before = await sorRepo.getWriteback(db, tenantId, input.id);
  if (!before) throw notFound('External writeback', input.id);
  if (before.status !== 'approval_required') {
    throw validationError(`Writeback ${before.id} is ${before.status} and cannot be reviewed.`);
  }
  const policyResult = before.policy_result ?? {};
  if (input.decision === 'approved' && policyResult.allowed === false) {
    throw validationError('This writeback is blocked by policy and cannot be approved. Update the mapping or payload, then create a new writeback request.');
  }

  const nextPolicyResult = {
    ...policyResult,
    reviewer_id: actorId,
    review_note: input.note,
    reviewed_at: new Date().toISOString(),
  };

  const writeback = await withTransaction(db, async (tx) => {
    if (before.hitl_request_id) {
      const resolved = await hitlRepo.resolveHITLRequest(
        tx,
        tenantId,
        before.hitl_request_id,
        input.decision,
        actorId,
        input.note,
      );
      if (!resolved) {
        throw validationError(`HITL request ${before.hitl_request_id} is no longer pending.`);
      }
    }

    return sorRepo.updateWriteback(tx, tenantId, before.id, {
      status: input.decision,
      policy_result: nextPolicyResult,
    });
  });
  if (!writeback) throw notFound('External writeback', input.id);

  const event_id = await emitEvent(db, {
    tenantId,
    eventType: input.decision === 'approved' ? 'system_writeback.approved' : 'system_writeback.rejected',
    actorId,
    actorType: 'user',
    objectType: 'external_writeback',
    objectId: writeback.id,
    beforeData: before as unknown as Record<string, unknown>,
    afterData: writeback as unknown as Record<string, unknown>,
    metadata: {
      origin: 'crmy',
      system_id: writeback.system_id,
      external_record_id: writeback.external_record_id,
    },
  });
  return { writeback, event_id };
}

export async function executeExternalWriteback(
  db: DbPool,
  tenantId: UUID,
  writebackId: UUID,
) {
  const writeback = await sorRepo.getWriteback(db, tenantId, writebackId);
  if (!writeback) throw notFound('External writeback', writebackId);
  if (writeback.status === 'approval_required' || writeback.status === 'pending') {
    throw validationError('This writeback requires approval before it can be executed.');
  }
  if (writeback.status !== 'approved') {
    throw validationError(`Writeback ${writeback.id} is ${writeback.status} and cannot be executed.`);
  }
  if (!writeback.mapping_id) {
    throw validationError('Writeback execution requires a configured mapping.');
  }

  const ctx = await buildConnectorContext(db, tenantId, writeback.system_id);
  const mapping = await sorRepo.getMapping(db, tenantId, writeback.mapping_id);
  if (!mapping) throw notFound('System mapping', writeback.mapping_id);
  const adapter = getAdapter(ctx.system.system_type);
  const writebackRun = await sorRepo.createSyncRun(db, tenantId, {
    system_id: writeback.system_id,
    mapping_id: writeback.mapping_id,
    mode: 'writeback',
    metadata: {
      writeback_id: writeback.id,
      operation: writeback.operation,
      external_object: writeback.external_object,
      external_record_id: writeback.external_record_id,
    },
  });
  const latestPreview = await adapter.previewWrite(ctx, mapping, {
    operation: writeback.operation,
    writeback_mode: writeback.writeback_mode,
    external_record_id: writeback.external_record_id ?? undefined,
    payload: writeback.payload ?? {},
  });
  if (!latestPreview.allowed) {
    await sorRepo.updateSyncRun(db, tenantId, writebackRun.id, {
      status: 'failed',
      error: `Writeback blocked by current mapping policy: ${latestPreview.warnings.join('; ') || 'not allowed'}`,
      records_skipped: 1,
      metadata: {
        writeback_id: writeback.id,
        preview: latestPreview as unknown as Record<string, unknown>,
      },
    });
    await sorRepo.updateWriteback(db, tenantId, writeback.id, {
      status: 'failed',
      execution_result: redactSecrets({
        ok: false,
        error: 'Writeback blocked by current mapping policy.',
        warnings: latestPreview.warnings,
        preview: latestPreview,
        sync_run_id: writebackRun.id,
      }),
    });
    throw validationError(`Writeback blocked by current mapping policy: ${latestPreview.warnings.join('; ') || 'not allowed'}`);
  }

  await sorRepo.updateWriteback(db, tenantId, writeback.id, { status: 'executing' });

  try {
    const result = await adapter.executeWrite(ctx, mapping, {
      operation: writeback.operation,
      writeback_mode: writeback.writeback_mode,
      external_record_id: writeback.external_record_id ?? undefined,
      payload: writeback.payload ?? {},
    });
    const executedAt = new Date().toISOString();
    const externalRecordId = result.external_record_id ?? writeback.external_record_id ?? undefined;
    const referenceResult: Record<string, unknown> = { updated: false };
    if (result.ok && writeback.object_id && externalRecordId) {
      try {
        const metadata = {
          last_writeback_id: writeback.id,
          last_writeback_at: executedAt,
          sync_run_id: writebackRun.id,
          result: redactSecrets(result.result ?? {}),
        };
        const existingRef = await sorRepo.findRecordRefForObject(
          db,
          tenantId,
          writeback.system_id,
          writeback.object_type,
          writeback.object_id,
          writeback.external_object,
        );
        if (existingRef && existingRef.external_record_id !== externalRecordId) {
          await sorRepo.replaceRecordRefExternalId(db, tenantId, {
            system_id: writeback.system_id,
            object_type: writeback.object_type,
            object_id: writeback.object_id,
            external_object: writeback.external_object,
            external_record_id: externalRecordId,
            metadata,
          });
          referenceResult.updated = true;
          referenceResult.action = 'relinked';
        } else {
          await sorRepo.upsertRecordRef(db, tenantId, {
            system_id: writeback.system_id,
            mapping_id: writeback.mapping_id,
            object_type: writeback.object_type,
            object_id: writeback.object_id,
            external_object: writeback.external_object,
            external_record_id: externalRecordId,
            source_hash: hashPayload(writeback.payload ?? {}),
            metadata,
          });
          referenceResult.updated = true;
          referenceResult.action = existingRef ? 'refreshed' : 'created';
        }
        referenceResult.external_record_id = externalRecordId;
      } catch (err) {
        const normalized = adapter.normalizeError(err);
        referenceResult.updated = false;
        referenceResult.warning = `External write succeeded, but CRMy could not update the external record reference: ${normalized.message}`;
      }
    }
    const receipt = redactSecrets({
      ok: result.ok,
      system_id: writeback.system_id,
      system_type: ctx.system.system_type,
      mapping_id: writeback.mapping_id,
      writeback_id: writeback.id,
      sync_run_id: writebackRun.id,
      operation: writeback.operation,
      writeback_mode: writeback.writeback_mode,
      object_type: writeback.object_type,
      object_id: writeback.object_id,
      external_object: writeback.external_object,
      external_record_id: externalRecordId,
      idempotency_key: writeback.idempotency_key,
      executed_at: executedAt,
      reference: referenceResult,
      result: result.result,
    });
    await sorRepo.updateSyncRun(db, tenantId, writebackRun.id, {
      status: result.ok ? 'completed' : 'failed',
      records_seen: 1,
      records_created: result.ok && writeback.operation === 'create' ? 1 : 0,
      records_updated: result.ok && writeback.operation !== 'create' ? 1 : 0,
      records_skipped: result.ok ? 0 : 1,
      error: result.ok ? undefined : 'Connector returned an unsuccessful writeback result.',
      metadata: receipt,
    });
    const completed = await sorRepo.updateWriteback(db, tenantId, writeback.id, {
      status: result.ok ? 'completed' : 'failed',
      external_record_id: externalRecordId,
      execution_result: receipt,
    });
    await sorRepo.updateSystem(db, tenantId, writeback.system_id, {
      status: result.ok ? 'connected' : 'error',
      health: {
        ...((ctx.system.health ?? {}) as Record<string, unknown>),
        last_writeback_at: executedAt,
        last_writeback_id: writeback.id,
        last_writeback_status: result.ok ? 'completed' : 'failed',
      },
      last_error: result.ok ? null : 'Connector returned an unsuccessful writeback result.',
    });
    await emitEvent(db, {
      tenantId,
      eventType: result.ok ? 'system_writeback.completed' : 'system_writeback.failed',
      actorType: 'system',
      objectType: 'external_writeback',
      objectId: writeback.id,
      beforeData: writeback as unknown as Record<string, unknown>,
      afterData: completed as unknown as Record<string, unknown>,
      metadata: {
        origin: 'crmy',
        system_id: writeback.system_id,
        system_type: ctx.system.system_type,
        external_record_id: externalRecordId,
        sync_run_id: writebackRun.id,
        changed_fields: Object.keys(writeback.payload ?? {}),
      },
    });
    return completed ?? writeback;
  } catch (err) {
    const normalized = adapter.normalizeError(err);
    await sorRepo.updateSyncRun(db, tenantId, writebackRun.id, {
      status: 'failed',
      error: normalized.message,
      records_seen: 1,
      records_skipped: 1,
      metadata: {
        writeback_id: writeback.id,
        retryable: normalized.retryable,
        details: redactSecrets(normalized.details ?? {}),
      },
    });
    const failed = await sorRepo.updateWriteback(db, tenantId, writeback.id, {
      status: 'failed',
      execution_result: redactSecrets({
        ok: false,
        error: normalized.message,
        retryable: normalized.retryable,
        details: normalized.details,
        sync_run_id: writebackRun.id,
      }),
    });
    await sorRepo.updateSystem(db, tenantId, writeback.system_id, {
      status: 'error',
      health: {
        ...((ctx.system.health ?? {}) as Record<string, unknown>),
        last_writeback_at: new Date().toISOString(),
        last_writeback_id: writeback.id,
        last_writeback_status: 'failed',
        retryable: normalized.retryable,
      },
      last_error: normalized.message,
    });
    await emitEvent(db, {
      tenantId,
      eventType: 'system_writeback.failed',
      actorType: 'system',
      objectType: 'external_writeback',
      objectId: writeback.id,
      beforeData: writeback as unknown as Record<string, unknown>,
      afterData: failed as unknown as Record<string, unknown>,
      metadata: {
        origin: 'crmy',
        system_id: writeback.system_id,
        system_type: ctx.system.system_type,
        external_record_id: writeback.external_record_id,
        sync_run_id: writebackRun.id,
      },
    });
    throw err;
  }
}

type ExternalWritebackModeOperation = 'create' | 'update' | 'upsert' | 'append_event' | 'stored_procedure';
