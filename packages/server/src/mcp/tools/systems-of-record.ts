// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  notFound,
  sorConflictList,
  sorConflictResolve,
  sorDiscover,
  sorMappingDelete,
  sorMappingList,
  sorMappingUpsert,
  sorSyncRun,
  sorSyncStatus,
  sorSystemCreate,
  sorSystemDelete,
  sorSystemGet,
  sorSystemList,
  sorSystemTest,
  sorSystemUpdate,
  sorWritebackPreview,
  sorWritebackExecute,
  sorWritebackRequest,
  sorWritebackReview,
  sorWritebackStatus,
} from '@crmy/shared';
import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ToolDef } from '../server.js';
import { runToolOperation } from '../tool-operation.js';
import { mutationReceipt } from '../mutation-receipt.js';
import { emitEvent } from '../../events/emitter.js';
import { requireScopes } from '../../auth/scopes.js';
import * as sorRepo from '../../db/repos/systems-of-record.js';
import { decryptSecret } from '../../lib/secrets.js';
import {
  buildConnectorContext,
  executeExternalWriteback,
  getAdapter,
  previewExternalWriteback,
  requestExternalWriteback,
  reviewExternalWriteback,
  resolveSyncConflict,
  runSystemSync,
  testSystemConnection,
} from '../../services/systems-of-record/index.js';
import { exchangeHubSpotOAuthCredentials } from '../../services/systems-of-record/hubspot.js';

const OBJECT_WRITE_SCOPES: Record<string, string> = {
  contact: 'contacts:write',
  account: 'accounts:write',
  opportunity: 'opportunities:write',
  activity: 'activities:write',
  use_case: 'use_cases:write',
  context_entry: 'context:write',
};

function requireObjectWriteScope(actor: ActorContext, objectType: string | undefined): void {
  const scope = objectType ? OBJECT_WRITE_SCOPES[objectType] : undefined;
  if (scope) requireScopes(actor, scope);
}

async function prepareSystemCredentials(systemType: string, credentials?: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  if (!credentials) return credentials;
  if (systemType === 'hubspot') return exchangeHubSpotOAuthCredentials(credentials);
  return credentials;
}

async function prepareSystemPatchCredentials(
  db: DbPool,
  tenantId: string,
  systemId: string,
  systemType: string,
  credentials?: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  if (!credentials) return credentials;
  const existing = await sorRepo.getSystemWithCredentials(db, tenantId, systemId);
  const existingCredentials = existing?.encrypted_credentials
    ? decryptSecret<Record<string, unknown>>(existing.encrypted_credentials)
    : {};
  return prepareSystemCredentials(systemType, { ...existingCredentials, ...credentials });
}

export function systemsOfRecordTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'sor_system_create',
      tier: 'extended',
      description: 'Create a governed external system connection such as HubSpot, Salesforce, Databricks, or Snowflake. Credentials are encrypted and redacted from responses.',
      inputSchema: sorSystemCreate,
      handler: async (input: z.infer<typeof sorSystemCreate>, actor: ActorContext) =>
        runToolOperation(db, actor, 'sor_system_create', input, async () => {
          const credentials = await prepareSystemCredentials(input.system_type, input.credentials);
          const system = await sorRepo.createSystem(db, actor.tenant_id, { ...input, credentials, created_by: actor.actor_id });
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id,
            eventType: 'system_of_record.created',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'external_system',
            objectId: system.id,
            afterData: system,
          });
          return { system, event_id, mutation: mutationReceipt(actor, { objectType: 'external_system', objectId: system.id, eventId: event_id }) };
        }),
    },
    {
      name: 'sor_system_update',
      tier: 'extended',
      description: 'Update a system-of-record connection, including encrypted credentials, sync settings, or status.',
      inputSchema: sorSystemUpdate,
      handler: async (input: z.infer<typeof sorSystemUpdate>, actor: ActorContext) =>
        runToolOperation(db, actor, 'sor_system_update', input, async () => {
          const before = await sorRepo.getSystem(db, actor.tenant_id, input.id);
          if (!before) throw notFound('System of record', input.id);
          const patch: {
            name?: string;
            auth_type?: string;
            credentials?: Record<string, unknown>;
            config?: Record<string, unknown>;
            sync_settings?: Record<string, unknown>;
            status?: string;
            last_error?: string | null;
          } = {
            ...input.patch,
            credentials: await prepareSystemPatchCredentials(db, actor.tenant_id, input.id, before.system_type, input.patch.credentials),
          };
          if (patch.credentials) patch.last_error = null;
          const system = await sorRepo.updateSystem(db, actor.tenant_id, input.id, patch);
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id,
            eventType: 'system_of_record.updated',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'external_system',
            objectId: input.id,
            beforeData: before,
            afterData: system,
          });
          return { system, event_id, mutation: mutationReceipt(actor, { objectType: 'external_system', objectId: input.id, eventId: event_id }) };
        }),
    },
    {
      name: 'sor_system_delete',
      tier: 'extended',
      description: 'Admin-only destructive tool for removing a system-of-record connection and its mappings, refs, conflicts, sync runs, and writeback queue. Prefer disabling or pausing sync when historical integration state should remain available.',
      inputSchema: sorSystemDelete,
      handler: async (input: z.infer<typeof sorSystemDelete>, actor: ActorContext) =>
        runToolOperation(db, actor, 'sor_system_delete', input, async () => {
          const before = await sorRepo.getSystem(db, actor.tenant_id, input.id);
          if (!before) throw notFound('System of record', input.id);
          const deleted = await sorRepo.deleteSystem(db, actor.tenant_id, input.id);
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id,
            eventType: 'system_of_record.deleted',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'external_system',
            objectId: input.id,
            beforeData: before,
          });
          return { deleted, event_id, mutation: mutationReceipt(actor, { objectType: 'external_system', objectId: input.id, eventId: event_id }) };
        }),
    },
    {
      name: 'sor_system_list',
      tier: 'extended',
      description: 'List configured systems of record with health and credential status. Credentials are never returned.',
      inputSchema: sorSystemList,
      handler: async (input: z.infer<typeof sorSystemList>, actor: ActorContext) => {
        const result = await sorRepo.listSystems(db, actor.tenant_id, {
          system_type: input.system_type,
          status: input.status,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { systems: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'sor_system_get',
      tier: 'extended',
      description: 'Get one system-of-record connection with health and redacted configuration.',
      inputSchema: sorSystemGet,
      handler: async (input: z.infer<typeof sorSystemGet>, actor: ActorContext) => {
        const system = await sorRepo.getSystem(db, actor.tenant_id, input.id);
        if (!system) throw notFound('System of record', input.id);
        return { system };
      },
    },
    {
      name: 'sor_system_test',
      tier: 'extended',
      description: 'Validate credentials and test connectivity for a system of record.',
      inputSchema: sorSystemTest,
      handler: async (input: z.infer<typeof sorSystemTest>, actor: ActorContext) => {
        const result = await testSystemConnection(db, actor.tenant_id, input.id);
        return { result };
      },
    },
    {
      name: 'sor_discover',
      tier: 'extended',
      description: 'Discover available external objects or fields for a configured system of record.',
      inputSchema: sorDiscover,
      handler: async (input: z.infer<typeof sorDiscover>, actor: ActorContext) => {
        const ctx = await buildConnectorContext(db, actor.tenant_id, input.system_id);
        const adapter = getAdapter(ctx.system.system_type);
        const data = input.object_name
          ? await adapter.discoverFields(ctx, input.object_name)
          : await adapter.discoverObjects(ctx);
        return { data };
      },
    },
    {
      name: 'sor_mapping_upsert',
      tier: 'extended',
      description: 'Create or update an object mapping between an external object/table and a typed CRMy object.',
      inputSchema: sorMappingUpsert,
      handler: async (input: z.infer<typeof sorMappingUpsert>, actor: ActorContext) =>
        runToolOperation(db, actor, 'sor_mapping_upsert', input, async () => {
          const mapping = await sorRepo.upsertMapping(db, actor.tenant_id, input);
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id,
            eventType: 'system_mapping.upserted',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'external_mapping',
            objectId: mapping.id,
            afterData: mapping,
          });
          return { mapping, event_id, mutation: mutationReceipt(actor, { objectType: 'external_mapping', objectId: mapping.id, eventId: event_id }) };
        }),
    },
    {
      name: 'sor_mapping_delete',
      tier: 'extended',
      description: 'Admin-only destructive tool for deleting one external object mapping. Use only after reviewing affected sync and writeback behavior for the mapped object.',
      inputSchema: sorMappingDelete,
      handler: async (input: z.infer<typeof sorMappingDelete>, actor: ActorContext) =>
        runToolOperation(db, actor, 'sor_mapping_delete', input, async () => {
          const before = await sorRepo.getMapping(db, actor.tenant_id, input.id);
          if (!before) throw notFound('System mapping', input.id);
          const deleted = await sorRepo.deleteMapping(db, actor.tenant_id, input.id);
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id,
            eventType: 'system_mapping.deleted',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'external_mapping',
            objectId: input.id,
            beforeData: before,
          });
          return { deleted, event_id, mutation: mutationReceipt(actor, { objectType: 'external_mapping', objectId: input.id, eventId: event_id }) };
        }),
    },
    {
      name: 'sor_mapping_list',
      tier: 'extended',
      description: 'List external object mappings for systems of record.',
      inputSchema: sorMappingList,
      handler: async (input: z.infer<typeof sorMappingList>, actor: ActorContext) => {
        const result = await sorRepo.listMappings(db, actor.tenant_id, {
          system_id: input.system_id,
          object_type: input.object_type,
          is_active: input.is_active,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { mappings: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'sor_sync_run',
      tier: 'extended',
      description: 'Run a system-of-record sync. Synced changes emit normal CRMy events with source metadata for Automations, Sequences, audit, and context extraction.',
      inputSchema: sorSyncRun,
      handler: async (input: z.infer<typeof sorSyncRun>, actor: ActorContext) =>
        runToolOperation(db, actor, 'sor_sync_run', input, async () => {
          const run = await runSystemSync(db, actor.tenant_id, input);
          return { run };
        }),
    },
    {
      name: 'sor_sync_status',
      tier: 'extended',
      description: 'List recent sync runs and their status, counts, watermarks, and errors.',
      inputSchema: sorSyncStatus,
      handler: async (input: z.infer<typeof sorSyncStatus>, actor: ActorContext) => {
        const result = await sorRepo.listSyncRuns(db, actor.tenant_id, {
          system_id: input.system_id,
          status: input.status,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { runs: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'sor_conflict_list',
      tier: 'extended',
      description: 'List source/local conflicts created by system-of-record sync.',
      inputSchema: sorConflictList,
      handler: async (input: z.infer<typeof sorConflictList>, actor: ActorContext) => {
        const result = await sorRepo.listConflicts(db, actor.tenant_id, {
          system_id: input.system_id,
          status: input.status,
          object_type: input.object_type,
          object_id: input.object_id,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { conflicts: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'sor_conflict_resolve',
      tier: 'extended',
      description: 'Resolve a sync conflict by choosing local value, external value, or ignoring it.',
      inputSchema: sorConflictResolve,
      handler: async (input: z.infer<typeof sorConflictResolve>, actor: ActorContext) =>
        runToolOperation(db, actor, 'sor_conflict_resolve', input, async () => {
          return resolveSyncConflict(db, actor.tenant_id, actor.actor_id, actor.actor_type, input);
        }),
    },
    {
      name: 'sor_writeback_preview',
      tier: 'extended',
      description: 'Preview a governed external writeback and return policy, diff, warnings, and approval requirement.',
      inputSchema: sorWritebackPreview,
      handler: async (input: z.infer<typeof sorWritebackPreview>, actor: ActorContext) => {
        requireObjectWriteScope(actor, input.object_type);
        const preview = await previewExternalWriteback(db, actor.tenant_id, input);
        return { preview };
      },
    },
    {
      name: 'sor_writeback_request',
      tier: 'extended',
      description: 'Create a governed external writeback request. High-risk writes enter approval_required status and can be linked to HITL.',
      inputSchema: sorWritebackRequest,
      handler: async (input: z.infer<typeof sorWritebackRequest>, actor: ActorContext) =>
        runToolOperation(db, actor, 'sor_writeback_request', input, async () => {
          requireObjectWriteScope(actor, input.object_type);
          const writeback = await requestExternalWriteback(db, actor.tenant_id, actor.actor_id, input);
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id,
            eventType: 'system_writeback.requested',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'external_writeback',
            objectId: writeback.id,
            afterData: writeback,
            metadata: {
              origin: actor.actor_type === 'agent' ? 'agent' : 'crmy',
              system_id: writeback.system_id,
              external_record_id: writeback.external_record_id,
            },
          });
          return { writeback, event_id, mutation: mutationReceipt(actor, { objectType: 'external_writeback', objectId: writeback.id, eventId: event_id }) };
        }),
    },
    {
      name: 'sor_writeback_review',
      tier: 'extended',
      description: 'Approve or reject a governed external writeback request before execution.',
      inputSchema: sorWritebackReview,
      handler: async (input: z.infer<typeof sorWritebackReview>, actor: ActorContext) =>
        runToolOperation(db, actor, 'sor_writeback_review', input, async () => {
          const before = await sorRepo.getWriteback(db, actor.tenant_id, input.id);
          if (!before) throw notFound('External writeback', input.id);
          requireObjectWriteScope(actor, before.object_type);
          return reviewExternalWriteback(db, actor.tenant_id, actor.actor_id, input);
        }),
    },
    {
      name: 'sor_writeback_execute',
      tier: 'extended',
      description: 'Execute an approved governed external writeback using the configured mapping and connector adapter.',
      inputSchema: sorWritebackExecute,
      handler: async (input: z.infer<typeof sorWritebackExecute>, actor: ActorContext) =>
        runToolOperation(db, actor, 'sor_writeback_execute', input, async () => {
          const before = await sorRepo.getWriteback(db, actor.tenant_id, input.id);
          if (!before) throw notFound('External writeback', input.id);
          requireObjectWriteScope(actor, before.object_type);
          const writeback = await executeExternalWriteback(db, actor.tenant_id, input.id);
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id,
            eventType: writeback.status === 'completed' ? 'system_writeback.executed' : 'system_writeback.execution_failed',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'external_writeback',
            objectId: writeback.id,
            beforeData: before,
            afterData: writeback,
            metadata: {
              origin: actor.actor_type === 'agent' ? 'agent' : 'crmy',
              system_id: writeback.system_id,
              external_record_id: writeback.external_record_id,
            },
          });
          return { writeback, event_id, mutation: mutationReceipt(actor, { objectType: 'external_writeback', objectId: writeback.id, eventId: event_id }) };
        }),
    },
    {
      name: 'sor_writeback_status',
      tier: 'extended',
      description: 'List governed external writeback requests with approval and execution status.',
      inputSchema: sorWritebackStatus,
      handler: async (input: z.infer<typeof sorWritebackStatus>, actor: ActorContext) => {
        const result = await sorRepo.listWritebacks(db, actor.tenant_id, {
          system_id: input.system_id,
          status: input.status,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { writebacks: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
  ];
}
