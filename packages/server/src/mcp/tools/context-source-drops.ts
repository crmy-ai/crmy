// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ToolDef } from '../server.js';
import { runToolOperation } from '../tool-operation.js';
import { mutationReceipt } from '../mutation-receipt.js';
import {
  createContextSourceConnection,
  deleteContextSourceConnection,
  enqueueContextSourceSync,
  getContextSourceObject,
  ignoreContextSourceObject,
  listContextSourceConnections,
  listContextSourceObjects,
  reprocessContextSourceObject,
  resolveContextSourceObject,
  updateContextSourceConnection,
} from '../../services/context-source-drops.js';

const provider = z.enum(['s3', 'local_folder']);
const connectionStatus = z.enum(['configured', 'syncing', 'error', 'disabled']);
const matchStatus = z.enum(['unmatched', 'matched', 'ambiguous', 'needs_review', 'ignored', 'all']);
const processingStatus = z.enum(['discovered', 'queued', 'processing', 'processed', 'needs_review', 'failed', 'ignored', 'all']);
const idempotencyKey = z.string().min(1).max(128).optional();

export function contextSourceDropTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'context_source_connection_list',
      tier: 'admin',
      description: 'List admin-managed transcript and raw-note storage drops. These sources discover S3/local files, then feed matching transcript artifacts into Customer Activity, Sources, Signals, and Memory.',
      inputSchema: z.object({}),
      handler: async (_input: {}, actor: ActorContext) => listContextSourceConnections(db, actor),
    },
    {
      name: 'context_source_connection_create',
      tier: 'admin',
      description: 'Create an admin-managed transcript/raw-note drop. Supported providers: s3 and local_folder. Credentials are encrypted and write-only. Local folders are self-hosted/local only unless explicitly enabled.',
      inputSchema: z.object({
        idempotency_key: idempotencyKey,
        name: z.string().min(1).max(200),
        provider,
        config: z.record(z.unknown()).describe('S3: bucket, prefix, region, endpoint, force_path_style, include_globs, exclude_globs. Local: path, include_globs, exclude_globs.'),
        credentials: z.record(z.unknown()).optional().describe('S3 only: access_key_id, secret_access_key, optional session_token. Never returned by list/get.'),
      }),
      handler: async (input, actor: ActorContext) => runToolOperation(db, actor, 'context_source_connection_create', input, async () => {
        const result = await createContextSourceConnection(db, actor, input);
        return { ...result, mutation: mutationReceipt(actor, { objectType: 'context_source_connection', objectId: result.connection.id }) };
      }),
    },
    {
      name: 'context_source_connection_update',
      tier: 'admin',
      description: 'Update a transcript/raw-note source drop configuration, status, or write-only credentials.',
      inputSchema: z.object({
        idempotency_key: idempotencyKey,
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        status: connectionStatus.optional(),
        config: z.record(z.unknown()).optional(),
        credentials: z.record(z.unknown()).nullable().optional(),
      }),
      handler: async (input, actor: ActorContext) => runToolOperation(db, actor, 'context_source_connection_update', input, async () => {
        const { id, ...patch } = input;
        const result = await updateContextSourceConnection(db, actor, id, patch);
        return { ...result, mutation: mutationReceipt(actor, { objectType: 'context_source_connection', objectId: result.connection.id }) };
      }),
    },
    {
      name: 'context_source_connection_delete',
      tier: 'admin',
      description: 'Delete a transcript/raw-note source drop and its encrypted credentials. Discovered source objects are removed by cascade.',
      inputSchema: z.object({ idempotency_key: idempotencyKey, id: z.string().uuid() }),
      handler: async (input, actor: ActorContext) => runToolOperation(db, actor, 'context_source_connection_delete', input, async () => {
        const result = await deleteContextSourceConnection(db, actor, input.id);
        return { ...result, mutation: mutationReceipt(actor, { objectType: 'context_source_connection', objectId: input.id }) };
      }),
    },
    {
      name: 'context_source_connection_sync',
      tier: 'admin',
      description: 'Queue a background sync for a transcript/raw-note source drop. The request returns immediately; processing happens in durable DB-claimed jobs.',
      inputSchema: z.object({ idempotency_key: idempotencyKey, id: z.string().uuid() }),
      handler: async (input, actor: ActorContext) => runToolOperation(db, actor, 'context_source_connection_sync', input, async () => {
        const result = await enqueueContextSourceSync(db, actor, input.id);
        return { ...result, mutation: mutationReceipt(actor, { objectType: 'context_source_connection', objectId: input.id }) };
      }),
    },
    {
      name: 'context_source_object_list',
      tier: 'extended',
      description: 'List transcript/raw-note drop objects visible to the actor, including match/processing state and review needs. Use match_status=needs_review or ambiguous to find dropped files requiring human linkage.',
      inputSchema: z.object({
        connection_id: z.string().uuid().optional(),
        match_status: matchStatus.optional(),
        processing_status: processingStatus.optional(),
        q: z.string().optional(),
        account_id: z.string().uuid().optional(),
        contact_id: z.string().uuid().optional(),
        opportunity_id: z.string().uuid().optional(),
        use_case_id: z.string().uuid().optional(),
        calendar_event_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(),
      }),
      handler: async (input, actor: ActorContext) => listContextSourceObjects(db, actor, input),
    },
    {
      name: 'context_source_object_get',
      tier: 'extended',
      description: 'Inspect one transcript/raw-note source object, including file metadata, match reason, candidates, linked meeting/activity/source receipt, and extraction receipt.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input, actor: ActorContext) => getContextSourceObject(db, actor, input.id),
    },
    {
      name: 'context_source_object_resolve',
      tier: 'extended',
      description: 'Resolve an unmatched or ambiguous transcript/raw-note object by linking it to a calendar event or customer record. Queues processing and resolves the related handoff when present.',
      inputSchema: z.object({
        idempotency_key: idempotencyKey,
        id: z.string().uuid(),
        calendar_event_id: z.string().uuid().optional(),
        account_id: z.string().uuid().optional(),
        contact_id: z.string().uuid().optional(),
        opportunity_id: z.string().uuid().optional(),
        use_case_id: z.string().uuid().optional(),
        note: z.string().max(1000).optional(),
      }),
      handler: async (input, actor: ActorContext) => runToolOperation(db, actor, 'context_source_object_resolve', input, async () => {
        const { id, ...payload } = input;
        const result = await resolveContextSourceObject(db, actor, id, payload);
        return { ...result, mutation: mutationReceipt(actor, { objectType: 'context_source_object', objectId: id }) };
      }),
    },
    {
      name: 'context_source_object_reprocess',
      tier: 'extended',
      description: 'Queue reprocessing for a transcript/raw-note source object after fixing configuration, matching, or context extraction issues.',
      inputSchema: z.object({ idempotency_key: idempotencyKey, id: z.string().uuid() }),
      handler: async (input, actor: ActorContext) => runToolOperation(db, actor, 'context_source_object_reprocess', input, async () => {
        const result = await reprocessContextSourceObject(db, actor, input.id);
        return { ...result, mutation: mutationReceipt(actor, { objectType: 'context_source_object', objectId: input.id }) };
      }),
    },
    {
      name: 'context_source_object_ignore',
      tier: 'extended',
      description: 'Ignore a transcript/raw-note source object that should not become customer context. This keeps the source visible as intentionally skipped and resolves its handoff when present.',
      inputSchema: z.object({ idempotency_key: idempotencyKey, id: z.string().uuid(), reason: z.string().max(1000).optional() }),
      handler: async (input, actor: ActorContext) => runToolOperation(db, actor, 'context_source_object_ignore', input, async () => {
        const result = await ignoreContextSourceObject(db, actor, input.id, input.reason);
        return { ...result, mutation: mutationReceipt(actor, { objectType: 'context_source_object', objectId: input.id }) };
      }),
    },
  ];
}
