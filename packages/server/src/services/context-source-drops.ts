// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import * as path from 'node:path';
import type { ActorContext, UUID } from '@crmy/shared';
import { CrmyError, notFound, permissionDenied, validationError } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as contextSourceRepo from '../db/repos/context-source-drops.js';
import * as calendarRepo from '../db/repos/calendar.js';
import * as hitlRepo from '../db/repos/hitl.js';
import { encryptSecret, decryptSecret, redactSecrets } from '../lib/secrets.js';
import { extractTextFromBuffer } from '../lib/file-extract.js';
import { emitEvent } from '../events/emitter.js';
import { getActorUserId, getVisibleOwnerIds, isGlobalActor, assertSubjectAccess } from './access-control.js';
import { resolveSubjectGraphForSource } from './subject-graph-resolver.js';
import { processMeetingArtifact, upsertCalendarEventWithIntelligence, validateMeetingEvent } from './customer-activity.js';

type Provider = contextSourceRepo.ContextSourceProvider;
type SourceObject = contextSourceRepo.ContextSourceObject;
type SourceConnection = contextSourceRepo.ContextSourceConnection;

interface ListedObject {
  key: string;
  version?: string | null;
  size: number;
  modified_at?: string | null;
  etag?: string | null;
}

interface ListedObjectsResult {
  objects: ListedObject[];
  truncated?: boolean;
  pages?: number;
  next_continuation_token?: string;
}

interface DownloadedObject {
  buffer: Buffer;
  content_hash: string;
}

class RetryableContextSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableContextSourceError';
  }
}

interface SidecarMetadata {
  title?: string;
  meeting_start?: string;
  meeting_end?: string;
  organizer?: string;
  organizer_email?: string;
  attendees?: string[];
  source_url?: string;
  calendar_event_id?: string;
  provider_event_id?: string;
  i_cal_uid?: string;
  account_id?: string;
  contact_id?: string;
  opportunity_id?: string;
  use_case_id?: string;
  account_hint?: string;
  artifact_type?: contextSourceRepo.ContextSourceArtifactType;
  source_authorship?: 'customer_or_external' | 'crmy' | 'mixed_or_unknown' | 'unknown';
  customer_authored?: boolean;
  [key: string]: unknown;
}

interface MatchResult {
  status: 'matched' | 'ambiguous' | 'needs_review';
  reason: string;
  candidates?: Array<Record<string, unknown>>;
  calendar_event_id?: UUID;
  contact_id?: UUID | null;
  account_id?: UUID | null;
  opportunity_id?: UUID | null;
  use_case_id?: UUID | null;
}

const SUPPORTED_EXTENSIONS = new Set(['txt', 'md', 'vtt', 'srt', 'json', 'docx', 'pdf']);
const SIDECAR_EXT = 'json';
const DEFAULT_MAX_OBJECT_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_PARSE_CHARS = 240_000;
const DEFAULT_CHUNK_CHARS = 55_000;
const DEFAULT_S3_LIST_PAGES = 10;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

function maxObjectBytes(): number {
  return Number(process.env.CRMY_CONTEXT_DROP_MAX_OBJECT_BYTES ?? DEFAULT_MAX_OBJECT_BYTES);
}

function maxParseChars(): number {
  return Number(process.env.CRMY_CONTEXT_DROP_MAX_PARSE_CHARS ?? DEFAULT_MAX_PARSE_CHARS);
}

function chunkChars(): number {
  return Number(process.env.CRMY_CONTEXT_DROP_CHUNK_CHARS ?? DEFAULT_CHUNK_CHARS);
}

function maxS3ListPages(): number {
  return Math.max(1, Number(process.env.CRMY_CONTEXT_DROP_MAX_S3_LIST_PAGES ?? DEFAULT_S3_LIST_PAGES));
}

function contextDropFetchTimeoutMs(): number {
  return Math.max(1000, Number(process.env.CRMY_CONTEXT_DROP_FETCH_TIMEOUT_MS ?? process.env.SOURCE_SYNC_FETCH_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS));
}

function sha256(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function lower(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function fileExt(key: string): string {
  return key.split('.').pop()?.toLowerCase() ?? '';
}

function isSupportedObject(key: string): boolean {
  return SUPPORTED_EXTENSIONS.has(fileExt(key));
}

function isLikelySidecar(key: string, objectKeys: Set<string>): boolean {
  if (fileExt(key) !== SIDECAR_EXT) return false;
  const base = key.replace(/\.json$/i, '');
  return [...SUPPORTED_EXTENSIONS].some(ext => ext !== 'json' && objectKeys.has(`${base}.${ext}`));
}

function sidecarKeyFor(key: string): string {
  return key.replace(/\.[^.]+$/u, '.json');
}

function labelForKey(key: string): string {
  return path.basename(key).replace(/[_-]+/g, ' ');
}

function artifactTypeFor(key: string, sidecar: SidecarMetadata): contextSourceRepo.ContextSourceArtifactType {
  if (sidecar.artifact_type && ['transcript', 'notes', 'summary', 'recording', 'other'].includes(sidecar.artifact_type)) {
    return sidecar.artifact_type;
  }
  const text = `${key} ${sidecar.title ?? ''}`.toLowerCase();
  if (text.includes('summary')) return 'summary';
  if (text.includes('note')) return 'notes';
  if (text.includes('recording')) return 'recording';
  return 'transcript';
}

function emailsFrom(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.flatMap(item => emailsFrom(item)))];
  const text = typeof value === 'string' ? value : '';
  return [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? []).map(item => item.toLowerCase()))];
}

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.includes('@') ? value.split('@')[1] : value;
  return domain ? domain.trim().toLowerCase().replace(/^https?:\/\//u, '').replace(/^www\./u, '').replace(/\/.*$/u, '') : null;
}

function sidecarFromBuffer(buffer: Buffer | null): SidecarMetadata {
  if (!buffer) return {};
  try {
    const parsed = JSON.parse(buffer.toString('utf-8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as SidecarMetadata : {};
  } catch {
    return {};
  }
}

function sourceAuthorship(sidecar: SidecarMetadata): Pick<SidecarMetadata, 'source_authorship' | 'customer_authored'> {
  if (typeof sidecar.customer_authored === 'boolean') {
    return {
      customer_authored: sidecar.customer_authored,
      source_authorship: sidecar.customer_authored ? 'customer_or_external' : 'crmy',
    };
  }
  if (sidecar.source_authorship) {
    return {
      source_authorship: sidecar.source_authorship,
      customer_authored: sidecar.source_authorship === 'customer_or_external'
        ? true
        : sidecar.source_authorship === 'crmy'
          ? false
          : undefined,
    };
  }
  return { source_authorship: 'mixed_or_unknown' };
}

function splitTranscript(text: string): string[] {
  const size = Math.max(10_000, chunkChars());
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + size);
    const breakAt = text.lastIndexOf('\n\n', end);
    if (breakAt > pos + size * 0.5) end = breakAt;
    chunks.push(text.slice(pos, end).trim());
    pos = end;
  }
  return chunks.filter(Boolean);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesGlobs(key: string, include?: unknown, exclude?: unknown): boolean {
  const includes = Array.isArray(include) ? include.map(String).filter(Boolean) : [];
  const excludes = Array.isArray(exclude) ? exclude.map(String).filter(Boolean) : [];
  if (includes.length > 0 && !includes.some(pattern => globToRegExp(pattern).test(key))) return false;
  if (excludes.some(pattern => globToRegExp(pattern).test(key))) return false;
  return true;
}

function safeConnection(connection: SourceConnection): SourceConnection {
  const clone = { ...connection };
  delete clone.credentials_enc;
  clone.config = redactSecrets(clone.config ?? {});
  return clone;
}

function normalizeConfig(provider: Provider, input: Record<string, unknown>): Record<string, unknown> {
  if (provider === 's3') {
    const bucket = String(input.bucket ?? '').trim();
    if (!bucket) throw validationError('S3 bucket is required', [{ field: 'bucket', message: 'Enter the bucket name.' }]);
    return {
      bucket,
      prefix: String(input.prefix ?? '').replace(/^\/+/u, ''),
      region: String(input.region ?? 'us-east-1'),
      endpoint: input.endpoint ? String(input.endpoint) : null,
      force_path_style: Boolean(input.force_path_style),
      include_globs: Array.isArray(input.include_globs) ? input.include_globs.map(String) : [],
      exclude_globs: Array.isArray(input.exclude_globs) ? input.exclude_globs.map(String) : [],
    };
  }
  const folderPath = String(input.path ?? input.folder_path ?? '').trim();
  if (!folderPath) throw validationError('Local folder path is required', [{ field: 'path', message: 'Enter a folder path.' }]);
  return {
    path: folderPath,
    include_globs: Array.isArray(input.include_globs) ? input.include_globs.map(String) : [],
    exclude_globs: Array.isArray(input.exclude_globs) ? input.exclude_globs.map(String) : [],
  };
}

function normalizeCredentials(provider: Provider, credentials: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!credentials || Object.keys(credentials).length === 0) return null;
  if (provider === 's3') {
    const accessKeyId = String(credentials.access_key_id ?? credentials.accessKeyId ?? '').trim();
    const secretAccessKey = String(credentials.secret_access_key ?? credentials.secretAccessKey ?? '').trim();
    if (!accessKeyId || !secretAccessKey) {
      throw validationError('S3 access key and secret are required', [
        { field: 'access_key_id', message: 'Enter an access key with read/list access.' },
        { field: 'secret_access_key', message: 'Enter the matching secret access key.' },
      ]);
    }
    return {
      access_key_id: accessKeyId,
      secret_access_key: secretAccessKey,
      session_token: credentials.session_token ? String(credentials.session_token) : undefined,
    };
  }
  return null;
}

export async function createContextSourceConnection(
  db: DbPool,
  actor: ActorContext,
  input: {
    name: string;
    provider: Provider;
    config: Record<string, unknown>;
    credentials?: Record<string, unknown>;
  },
): Promise<{ connection: SourceConnection; sync_job: { id: UUID; status: string }; message: string }> {
  if (!isGlobalActor(actor)) throw permissionDenied('Only admins and owners can configure transcript and notes drops.');
  const config = normalizeConfig(input.provider, input.config ?? {});
  assertProviderAllowed(input.provider, config);
  const credentials = normalizeCredentials(input.provider, input.credentials);
  const connection = await contextSourceRepo.createConnection(db, actor.tenant_id, {
    name: input.name.trim(),
    provider: input.provider,
    config,
    credentials_enc: credentials ? encryptSecret(credentials) as unknown as Record<string, unknown> : null,
    created_by: actor.actor_id,
  });
  await emitEvent(db, {
    tenantId: actor.tenant_id,
    eventType: 'context_source_connection.created',
    actorId: actor.actor_id,
    actorType: actor.actor_type,
    objectType: 'context_source_connection',
    objectId: connection.id,
    afterData: { provider: connection.provider, name: connection.name },
  }).catch(() => {});
  const syncJob = await contextSourceRepo.enqueueSyncJob(db, actor.tenant_id, connection.id, {
    enqueued_from: 'connection_create',
    requested_by: actor.actor_id,
  });
  return {
    connection: safeConnection(connection),
    sync_job: syncJob,
    message: 'Transcript and notes source created. Initial sync queued automatically.',
  };
}

export async function updateContextSourceConnection(
  db: DbPool,
  actor: ActorContext,
  id: UUID,
  input: {
    name?: string;
    status?: contextSourceRepo.ContextSourceConnectionStatus;
    config?: Record<string, unknown>;
    credentials?: Record<string, unknown> | null;
  },
): Promise<{ connection: SourceConnection }> {
  if (!isGlobalActor(actor)) throw permissionDenied('Only admins and owners can update transcript and notes drops.');
  const current = await contextSourceRepo.getConnection(db, actor.tenant_id, id, true);
  if (!current) throw notFound('ContextSourceConnection', id);
  const nextConfig = input.config ? normalizeConfig(current.provider, { ...(current.config ?? {}), ...input.config }) : undefined;
  if (nextConfig) assertProviderAllowed(current.provider, nextConfig);
  const credentials = input.credentials === undefined ? undefined : normalizeCredentials(current.provider, input.credentials ?? undefined);
  const updated = await contextSourceRepo.updateConnection(db, actor.tenant_id, id, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(nextConfig !== undefined ? { config: nextConfig } : {}),
    ...(input.credentials !== undefined ? { credentials_enc: credentials ? encryptSecret(credentials) as unknown as Record<string, unknown> : null } : {}),
    last_error: input.status === 'disabled' ? null : undefined,
  });
  if (!updated) throw notFound('ContextSourceConnection', id);
  return { connection: safeConnection(updated) };
}

export async function deleteContextSourceConnection(db: DbPool, actor: ActorContext, id: UUID): Promise<{ ok: true }> {
  if (!isGlobalActor(actor)) throw permissionDenied('Only admins and owners can delete transcript and notes drops.');
  const deleted = await contextSourceRepo.deleteConnection(db, actor.tenant_id, id);
  if (!deleted) throw notFound('ContextSourceConnection', id);
  return { ok: true };
}

export async function enqueueContextSourceSync(db: DbPool, actor: ActorContext, id: UUID): Promise<{ job: { id: UUID; status: string }; message: string }> {
  if (!isGlobalActor(actor)) throw permissionDenied('Only admins and owners can sync transcript and notes drops.');
  const connection = await contextSourceRepo.getConnection(db, actor.tenant_id, id);
  if (!connection) throw notFound('ContextSourceConnection', id);
  if (connection.status === 'disabled') throw validationError('This transcript source is disabled. Activate it before syncing.');
  const job = await contextSourceRepo.enqueueSyncJob(db, actor.tenant_id, id, { requested_by: actor.actor_id });
  return { job, message: 'Transcript and notes source sync queued.' };
}

export async function listContextSourceConnections(db: DbPool, actor: ActorContext): Promise<{ data: SourceConnection[] }> {
  if (!isGlobalActor(actor)) return { data: [] };
  const data = await contextSourceRepo.listConnections(db, actor.tenant_id);
  return { data: data.map(safeConnection) };
}

export async function listContextSourceObjects(
  db: DbPool,
  actor: ActorContext,
  filters: Omit<contextSourceRepo.SourceObjectFilters, 'owner_ids'>,
) {
  const ownerIds = await getVisibleOwnerIds(db, actor);
  return contextSourceRepo.listSourceObjects(db, actor.tenant_id, {
    ...filters,
    owner_ids: ownerIds ?? undefined,
  });
}

export async function getContextSourceObject(db: DbPool, actor: ActorContext, id: UUID): Promise<{ source_object: SourceObject }> {
  const object = await contextSourceRepo.getSourceObject(db, actor.tenant_id, id);
  if (!object) throw notFound('ContextSourceObject', id);
  await assertSourceObjectAccess(db, actor, object);
  return { source_object: object };
}

export async function syncContextSourceConnection(db: DbPool, tenantId: UUID, connectionId: UUID): Promise<{ discovered: number; queued: number; skipped: number }> {
  const connection = await contextSourceRepo.getConnection(db, tenantId, connectionId, true);
  if (!connection) throw new Error('Context source connection not found.');
  if (connection.status === 'disabled') return { discovered: 0, queued: 0, skipped: 0 };
  await contextSourceRepo.updateConnection(db, tenantId, connection.id, {
    status: 'syncing',
    last_error: null,
  });

  let discovered = 0;
  let queued = 0;
  let skipped = 0;
  try {
    const listing = await listProviderObjects(connection);
    const { objects } = listing;
    const objectKeys = new Set(objects.map(item => item.key));
    for (const item of objects) {
      if (!isSupportedObject(item.key) || isLikelySidecar(item.key, objectKeys)) {
        skipped++;
        continue;
      }
      if (!matchesGlobs(item.key, connection.config.include_globs, connection.config.exclude_globs)) {
        skipped++;
        continue;
      }
      const metadataHash = sha256(`${connection.provider}:${item.key}:${item.version ?? ''}:${item.etag ?? ''}:${item.size}:${item.modified_at ?? ''}`);
      const tooLarge = item.size > maxObjectBytes();
      const sourceObject = await contextSourceRepo.upsertSourceObject(db, tenantId, {
        connection_id: connection.id,
        object_key: item.key,
        object_version: item.version ?? item.etag ?? null,
        content_hash: metadataHash,
        size_bytes: item.size,
        modified_at: item.modified_at ?? null,
        source_label: labelForKey(item.key),
        artifact_type: artifactTypeFor(item.key, {}),
        processing_status: tooLarge ? 'needs_review' : 'queued',
        match_status: tooLarge ? 'needs_review' : 'unmatched',
        failure_code: tooLarge ? 'file_too_large' : null,
        failure_reason: tooLarge ? `File is larger than the ${Math.round(maxObjectBytes() / 1024 / 1024)} MB transcript-drop limit. Split it or raise CRMY_CONTEXT_DROP_MAX_OBJECT_BYTES.` : null,
        metadata: {
          discovered_by: 'context_source_sync',
          provider: connection.provider,
          provider_etag: item.etag ?? null,
          metadata_hash: metadataHash,
        },
      });
      discovered++;
      if (tooLarge) {
        await ensureReviewHandoff(db, tenantId, sourceObject, {
          reason: 'File is too large to process automatically.',
          candidates: [],
        });
      } else if (sourceObject.processing_status !== 'processed' && sourceObject.processing_status !== 'ignored') {
        await contextSourceRepo.enqueueProcessingJob(db, tenantId, sourceObject.id, { enqueued_from: 'sync' });
        queued++;
      }
    }
    await contextSourceRepo.updateConnection(db, tenantId, connection.id, {
      status: 'configured',
      last_sync_at: new Date().toISOString(),
      last_error: null,
      sync_stats: {
        discovered,
        queued,
        skipped,
        last_result: listing.truncated ? 'partial' : 'success',
        truncated: Boolean(listing.truncated),
        pages: listing.pages ?? 1,
      },
      ...(listing.truncated
        ? { last_error: `S3 listing reached the ${listing.pages ?? maxS3ListPages()} page safety limit. Some transcript objects may not be discovered until the page limit is raised or the prefix is narrowed.` }
        : {}),
    });
    return { discovered, queued, skipped };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Context source sync failed.';
    await contextSourceRepo.updateConnection(db, tenantId, connection.id, {
      status: 'error',
      last_error: message,
      sync_stats: { discovered, queued, skipped, last_result: 'failed' },
    });
    throw err;
  }
}

export async function processContextSourceObject(db: DbPool, tenantId: UUID, objectId: UUID, actor?: ActorContext): Promise<SourceObject> {
  let object = await contextSourceRepo.getSourceObject(db, tenantId, objectId);
  if (!object) throw new Error('Context source object not found.');
  if (object.processing_status === 'ignored') return object;
  const connection = object.connection_id ? await contextSourceRepo.getConnection(db, tenantId, object.connection_id, true) : null;
  if (!connection) throw new Error('Context source connection not found.');
  await contextSourceRepo.updateSourceObject(db, tenantId, object.id, {
    processing_status: 'processing',
    failure_code: null,
    failure_reason: null,
  });

  try {
    const sidecarBuffer = await downloadSidecar(connection, object.object_key);
    const sidecar = sidecarFromBuffer(sidecarBuffer);
    const artifactType = artifactTypeFor(object.object_key, sidecar);
    const downloaded = await downloadProviderObject(connection, object.object_key);
    if (downloaded.buffer.byteLength > maxObjectBytes()) {
      return await markNeedsReview(db, tenantId, object, {
        failure_code: 'file_too_large',
        reason: `File is larger than the ${Math.round(maxObjectBytes() / 1024 / 1024)} MB transcript-drop limit.`,
        sidecar,
      });
    }
    const extracted = await extractTextFromBuffer(downloaded.buffer, object.object_key, { maxChars: maxParseChars() });
    const text = extracted.text.trim();
    if (!text) {
      return await markNeedsReview(db, tenantId, object, {
        failure_code: 'empty_file',
        reason: 'No readable transcript or notes text was found in this file.',
        sidecar,
      });
    }
    const duplicate = object.connection_id
      ? await contextSourceRepo.findSourceObjectByActualHash(db, tenantId, object.connection_id, downloaded.content_hash, object.id)
      : null;
    if (duplicate) {
      return await contextSourceRepo.updateSourceObject(db, tenantId, object.id, {
        processing_status: 'ignored',
        match_status: 'ignored',
        failure_code: 'duplicate_source_object',
        failure_reason: `Duplicate content already discovered as ${duplicate.source_label ?? duplicate.object_key}.`,
        match_reason: 'Skipped because this transcript content was already processed or queued from the same source connection.',
        raw_context_source_id: duplicate.raw_context_source_id ?? null,
        activity_id: duplicate.activity_id ?? null,
        meeting_artifact_id: duplicate.meeting_artifact_id ?? null,
        metadata: {
          actual_content_hash: downloaded.content_hash,
          duplicate_of_source_object_id: duplicate.id,
          duplicate_detected_at: new Date().toISOString(),
        },
      }) ?? object;
    }
    object = await contextSourceRepo.updateSourceObject(db, tenantId, object.id, {
      text_excerpt: text.slice(0, 1200),
      sidecar_metadata: sidecar,
      metadata: {
        actual_content_hash: downloaded.content_hash,
        parse_format: extracted.format,
        parse_truncated: extracted.truncated,
        text_chars: text.length,
      },
    }) ?? object;

    const match = await matchSourceObject(db, tenantId, object, text, sidecar, actor);
    if (match.status !== 'matched') {
      return await markNeedsReview(db, tenantId, object, {
        reason: match.reason,
        candidates: match.candidates ?? [],
        sidecar,
        matchStatus: match.status,
      });
    }
    return await processMatchedSourceObject(db, tenantId, object, text, sidecar, artifactType, match, actor);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcript source processing failed.';
    await contextSourceRepo.updateSourceObject(db, tenantId, object.id, {
      processing_status: 'failed',
      match_status: 'needs_review',
      failure_code: 'processing_failed',
      failure_reason: message,
      match_reason: message,
    });
    if (err instanceof RetryableContextSourceError) throw err;
    return await contextSourceRepo.getSourceObject(db, tenantId, object.id) ?? object;
  }
}

export async function processContextSourceSyncJobs(db: DbPool): Promise<{ processed: number; failed: number }> {
  const jobs = await contextSourceRepo.claimSyncJobs(db, 5);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await syncContextSourceConnection(db, job.tenant_id, job.connection_id);
      await contextSourceRepo.completeSyncJob(db, job.id);
    } catch (err) {
      failed++;
      await contextSourceRepo.failSyncJob(db, job.id, err instanceof Error ? err.message : 'Context source sync failed.');
    }
    processed++;
  }
  return { processed, failed };
}

export async function processContextSourceProcessingJobs(db: DbPool): Promise<{ processed: number; failed: number }> {
  const jobs = await contextSourceRepo.claimProcessingJobs(db, 5);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await processContextSourceObject(db, job.tenant_id, job.source_object_id);
      await contextSourceRepo.completeProcessingJob(db, job.id);
    } catch (err) {
      failed++;
      await contextSourceRepo.failProcessingJob(db, job.id, err instanceof Error ? err.message : 'Context source processing failed.');
    }
    processed++;
  }
  return { processed, failed };
}

export async function resolveContextSourceObject(
  db: DbPool,
  actor: ActorContext,
  id: UUID,
  input: {
    calendar_event_id?: UUID;
    account_id?: UUID;
    contact_id?: UUID;
    opportunity_id?: UUID;
    use_case_id?: UUID;
    note?: string;
  },
): Promise<{ source_object: SourceObject; message: string }> {
  const object = await contextSourceRepo.getSourceObject(db, actor.tenant_id, id);
  if (!object) throw notFound('ContextSourceObject', id);
  await assertSourceObjectAccess(db, actor, object);
  await assertResolvedLinks(db, actor, input);
  let calendarEvent = input.calendar_event_id
    ? await calendarRepo.getCalendarEvent(db, actor.tenant_id, input.calendar_event_id)
    : null;
  if (input.calendar_event_id && !calendarEvent) throw notFound('CalendarEvent', input.calendar_event_id);
  if (calendarEvent) {
    calendarEvent = await calendarRepo.updateCalendarEvent(db, actor.tenant_id, calendarEvent.id, {
      contact_id: input.contact_id ?? calendarEvent.contact_id ?? null,
      account_id: input.account_id ?? calendarEvent.account_id ?? null,
      opportunity_id: input.opportunity_id ?? calendarEvent.opportunity_id ?? null,
      use_case_id: input.use_case_id ?? calendarEvent.use_case_id ?? null,
      metadata: { context_source_resolved_by: actor.actor_id, context_source_object_id: object.id },
    }) ?? calendarEvent;
    const validation = await validateMeetingEvent(db, actor.tenant_id, calendarEvent);
    await calendarRepo.updateCalendarEvent(db, actor.tenant_id, calendarEvent.id, validation);
  }
  const updated = await contextSourceRepo.updateSourceObject(db, actor.tenant_id, object.id, {
    calendar_event_id: calendarEvent?.id ?? object.calendar_event_id ?? null,
    contact_id: input.contact_id ?? calendarEvent?.contact_id ?? object.contact_id ?? null,
    account_id: input.account_id ?? calendarEvent?.account_id ?? object.account_id ?? null,
    opportunity_id: input.opportunity_id ?? calendarEvent?.opportunity_id ?? object.opportunity_id ?? null,
    use_case_id: input.use_case_id ?? calendarEvent?.use_case_id ?? object.use_case_id ?? null,
    match_status: 'matched',
    processing_status: 'queued',
    match_reason: input.note ?? 'Linked by human review.',
    metadata: { resolved_by: actor.actor_id, resolved_at: new Date().toISOString() },
  }) ?? object;
  await contextSourceRepo.enqueueProcessingJob(db, actor.tenant_id, updated.id, { requested_by: actor.actor_id, reason: 'human_resolve' });
  if (updated.hitl_request_id) {
    await resolveHandoffIfPending(db, actor.tenant_id, updated.hitl_request_id, await getActorUserId(db, actor), 'approved', input.note ?? 'Linked and queued for processing.');
  }
  return { source_object: updated, message: 'Transcript source linked and queued for processing.' };
}

export async function reprocessContextSourceObject(db: DbPool, actor: ActorContext, id: UUID): Promise<{ source_object: SourceObject; job: { id: UUID; status: string } }> {
  const object = await contextSourceRepo.getSourceObject(db, actor.tenant_id, id);
  if (!object) throw notFound('ContextSourceObject', id);
  await assertSourceObjectAccess(db, actor, object);
  const updated = await contextSourceRepo.updateSourceObject(db, actor.tenant_id, id, {
    processing_status: 'queued',
    failure_code: null,
    failure_reason: null,
    metadata: { reprocess_requested_by: actor.actor_id, reprocess_requested_at: new Date().toISOString() },
  }) ?? object;
  const job = await contextSourceRepo.enqueueProcessingJob(db, actor.tenant_id, id, { requested_by: actor.actor_id, reason: 'manual_reprocess' });
  return { source_object: updated, job };
}

export async function ignoreContextSourceObject(db: DbPool, actor: ActorContext, id: UUID, reason?: string): Promise<{ source_object: SourceObject }> {
  const object = await contextSourceRepo.getSourceObject(db, actor.tenant_id, id);
  if (!object) throw notFound('ContextSourceObject', id);
  await assertSourceObjectAccess(db, actor, object);
  const updated = await contextSourceRepo.updateSourceObject(db, actor.tenant_id, id, {
    match_status: 'ignored',
    processing_status: 'ignored',
    ignored_at: new Date().toISOString(),
    failure_reason: reason ?? 'Ignored by user.',
    metadata: { ignored_by: actor.actor_id, ignored_reason: reason ?? null },
  }) ?? object;
  if (updated.hitl_request_id) {
    await resolveHandoffIfPending(db, actor.tenant_id, updated.hitl_request_id, await getActorUserId(db, actor), 'rejected', reason ?? 'Transcript source ignored.');
  }
  return { source_object: updated };
}

async function assertResolvedLinks(db: DbPool, actor: ActorContext, input: {
  account_id?: UUID;
  contact_id?: UUID;
  opportunity_id?: UUID;
  use_case_id?: UUID;
}): Promise<void> {
  if (input.account_id) await assertSubjectAccess(db, actor, 'account', input.account_id);
  if (input.contact_id) await assertSubjectAccess(db, actor, 'contact', input.contact_id);
  if (input.opportunity_id) await assertSubjectAccess(db, actor, 'opportunity', input.opportunity_id);
  if (input.use_case_id) await assertSubjectAccess(db, actor, 'use_case', input.use_case_id);
}

async function assertSourceObjectAccess(db: DbPool, actor: ActorContext, object: SourceObject): Promise<void> {
  if (isGlobalActor(actor)) return;
  const linked = [
    ['opportunity', object.opportunity_id],
    ['use_case', object.use_case_id],
    ['contact', object.contact_id],
    ['account', object.account_id],
  ] as const;
  for (const [type, id] of linked) {
    if (!id) continue;
    await assertSubjectAccess(db, actor, type, id);
    return;
  }
  throw notFound('ContextSourceObject', object.id);
}

function assertProviderAllowed(provider: Provider, config: Record<string, unknown>): void {
  if (provider === 's3') {
    assertS3EndpointAllowed(config);
    return;
  }
  if (process.env.NODE_ENV === 'production' && process.env.CRMY_ENABLE_LOCAL_CONTEXT_DROPS !== 'true') {
    throw validationError('Local transcript folders are disabled in hosted production. Use S3-compatible drops or enable CRMY_ENABLE_LOCAL_CONTEXT_DROPS explicitly for self-hosted deployments.');
  }
  assertLocalPathAllowed(String(config.path ?? ''));
}

function assertS3EndpointAllowed(config: Record<string, unknown>): void {
  const endpoint = String(config.endpoint ?? '').trim();
  if (!endpoint) return;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw validationError('S3-compatible endpoint must be a valid URL.', [
      { field: 'endpoint', message: 'Enter a valid HTTPS endpoint URL.' },
    ]);
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw validationError('S3-compatible endpoints must use HTTPS in production.', [
      { field: 'endpoint', message: 'Use an HTTPS endpoint or omit the endpoint for AWS S3.' },
    ]);
  }
  const allowCustomProductionEndpoint = process.env.CRMY_ALLOW_CUSTOM_CONTEXT_DROP_ENDPOINTS === 'true';
  if (process.env.NODE_ENV === 'production' && !allowCustomProductionEndpoint) {
    throw validationError('Custom S3-compatible endpoints are disabled in production by default.', [
      { field: 'endpoint', message: 'Omit endpoint for AWS S3, or set CRMY_ALLOW_CUSTOM_CONTEXT_DROP_ENDPOINTS=true for a deliberate self-hosted exception.' },
    ]);
  }
  if (!isPublicEndpointHost(url.hostname) && process.env.CRMY_ALLOW_PRIVATE_CONTEXT_DROP_ENDPOINTS !== 'true') {
    throw validationError('S3-compatible endpoint cannot target local or private network addresses.', [
      { field: 'endpoint', message: 'Use a public S3-compatible endpoint, or set CRMY_ALLOW_PRIVATE_CONTEXT_DROP_ENDPOINTS=true only for trusted self-hosted deployments.' },
    ]);
  }
}

function isPublicEndpointHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  const ipVersion = net.isIP(host);
  if (ipVersion === 6) return host !== '::1' && !host.startsWith('fc') && !host.startsWith('fd') && !host.startsWith('fe80:');
  if (ipVersion === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

function localAllowedRoots(): string[] {
  const configured = String(process.env.CRMY_LOCAL_SOURCE_ROOTS ?? '').split(',').map(item => item.trim()).filter(Boolean);
  if (configured.length > 0) return configured.map(item => path.resolve(item));
  if (process.env.NODE_ENV === 'production') return [];
  return [process.cwd(), '/tmp'].map(item => path.resolve(item));
}

function assertLocalPathAllowed(folderPath: string): string {
  const resolved = path.resolve(folderPath);
  const roots = localAllowedRoots();
  if (!roots.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    throw validationError('Local transcript folder is outside the allowed roots.', [
      { field: 'path', message: `Allowed roots: ${roots.length ? roots.join(', ') : 'none configured'}` },
    ]);
  }
  return resolved;
}

async function listProviderObjects(connection: SourceConnection): Promise<ListedObjectsResult> {
  if (connection.provider === 'local_folder') return listLocalObjects(connection);
  return listS3Objects(connection);
}

async function downloadProviderObject(connection: SourceConnection, key: string): Promise<DownloadedObject> {
  const buffer = connection.provider === 'local_folder'
    ? await fs.readFile(localPathForKey(connection, key))
    : await getS3Object(connection, key);
  return { buffer, content_hash: sha256(buffer) };
}

async function downloadSidecar(connection: SourceConnection, objectKey: string): Promise<Buffer | null> {
  const sidecarKey = sidecarKeyFor(objectKey);
  try {
    return connection.provider === 'local_folder'
      ? await fs.readFile(localPathForKey(connection, sidecarKey))
      : await getS3Object(connection, sidecarKey);
  } catch {
    return null;
  }
}

function localPathForKey(connection: SourceConnection, key: string): string {
  const root = assertLocalPathAllowed(String(connection.config.path ?? ''));
  const resolved = path.resolve(root, key);
  if (!(resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    throw validationError('Local source object path escaped the configured folder.');
  }
  return resolved;
}

async function listLocalObjects(connection: SourceConnection): Promise<ListedObjectsResult> {
  const root = assertLocalPathAllowed(String(connection.config.path ?? ''));
  const out: ListedObject[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      const stat = await fs.stat(full);
      if (!matchesGlobs(rel, connection.config.include_globs, connection.config.exclude_globs)) continue;
      out.push({
        key: rel,
        size: stat.size,
        modified_at: stat.mtime.toISOString(),
        etag: sha256(`${rel}:${stat.size}:${stat.mtimeMs}`),
      });
    }
  }
  await walk(root);
  return { objects: out, truncated: false, pages: 1 };
}

async function listS3Objects(connection: SourceConnection): Promise<ListedObjectsResult> {
  const config = s3Config(connection);
  const objects: ListedObject[] = [];
  let continuationToken: string | undefined;
  const maxPages = maxS3ListPages();
  let page = 0;
  for (; page < maxPages; page++) {
    const query = new URLSearchParams({
      'list-type': '2',
      prefix: config.prefix,
      'max-keys': '1000',
    });
    if (continuationToken) query.set('continuation-token', continuationToken);
    const url = s3Url(config, '', query);
    const response = await signedS3Fetch(connection, 'GET', url);
    const xml = await response.text();
    objects.push(...parseS3List(xml));
    continuationToken = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/u)?.[1];
    if (!continuationToken) break;
  }
  return {
    objects,
    truncated: Boolean(continuationToken),
    pages: Math.min(page + 1, maxPages),
    next_continuation_token: continuationToken,
  };
}

async function getS3Object(connection: SourceConnection, key: string): Promise<Buffer> {
  const config = s3Config(connection);
  const url = s3Url(config, key);
  const response = await signedS3Fetch(connection, 'GET', url);
  return readResponseBufferWithLimit(response, maxObjectBytes());
}

async function readResponseBufferWithLimit(response: Response, limit: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw validationError(`File is larger than the ${Math.round(limit / 1024 / 1024)} MB transcript-drop limit.`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = Buffer.from(await response.arrayBuffer());
    if (fallback.byteLength > limit) {
      throw validationError(`File is larger than the ${Math.round(limit / 1024 / 1024)} MB transcript-drop limit.`);
    }
    return fallback;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > limit) {
      throw validationError(`File is larger than the ${Math.round(limit / 1024 / 1024)} MB transcript-drop limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function s3Config(connection: SourceConnection): { bucket: string; region: string; prefix: string; endpoint?: string; forcePathStyle: boolean } {
  return {
    bucket: String(connection.config.bucket ?? ''),
    region: String(connection.config.region ?? 'us-east-1'),
    prefix: String(connection.config.prefix ?? ''),
    endpoint: connection.config.endpoint ? String(connection.config.endpoint) : undefined,
    forcePathStyle: Boolean(connection.config.force_path_style),
  };
}

function s3Credentials(connection: SourceConnection): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } {
  const creds = decryptSecret<Record<string, unknown>>(connection.credentials_enc);
  return {
    accessKeyId: String(creds.access_key_id ?? ''),
    secretAccessKey: String(creds.secret_access_key ?? ''),
    sessionToken: creds.session_token ? String(creds.session_token) : undefined,
  };
}

function s3Url(config: ReturnType<typeof s3Config>, key: string, query?: URLSearchParams): URL {
  const encodedKey = key.split('/').map(part => encodeURIComponent(part)).join('/');
  const base = config.endpoint
    ? new URL(config.endpoint)
    : new URL(`https://s3.${config.region}.amazonaws.com`);
  if (config.forcePathStyle || config.endpoint) {
    base.pathname = `/${config.bucket}/${encodedKey}`.replace(/\/+$/u, '');
  } else {
    base.hostname = `${config.bucket}.${base.hostname}`;
    base.pathname = `/${encodedKey}`.replace(/\/+$/u, '');
  }
  if (query) base.search = query.toString();
  return base;
}

async function signedS3Fetch(connection: SourceConnection, method: 'GET', url: URL): Promise<Response> {
  const config = s3Config(connection);
  const creds = s3Credentials(connection);
  if (!creds.accessKeyId || !creds.secretAccessKey) throw validationError('S3 credentials are required for this transcript source.');
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = url.host;
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-amz-date': amzDate,
  };
  if (creds.sessionToken) headers['x-amz-security-token'] = creds.sessionToken;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map(key => `${key}:${headers[key]}\n`).join('');
  const canonicalRequest = [
    method,
    url.pathname || '/',
    canonicalQueryString(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n');
  const signingKey = awsSigningKey(creds.secretAccessKey, dateStamp, config.region);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), contextDropFetchTimeoutMs());
  let response: Response;
  try {
    response = await fetch(url, { method, headers, signal: controller.signal });
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? `S3 request timed out after ${contextDropFetchTimeoutMs()}ms`
      : `S3 request failed: ${err instanceof Error ? err.message : 'network error'}`;
    throw new RetryableContextSourceError(message);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    const message = `S3 request failed (${response.status})`;
    if (retryable) throw new RetryableContextSourceError(message);
    throw validationError(message);
  }
  return response;
}

function canonicalQueryString(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function awsSigningKey(secret: string, date: string, region: string): Buffer {
  const kDate = crypto.createHmac('sha256', `AWS4${secret}`).update(date).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
  return crypto.createHmac('sha256', kService).update('aws4_request').digest();
}

function parseS3List(xml: string): ListedObject[] {
  const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/gu) ?? [];
  return contents.map(block => ({
    key: xmlDecode(block.match(/<Key>([\s\S]*?)<\/Key>/u)?.[1] ?? ''),
    version: block.match(/<VersionId>([\s\S]*?)<\/VersionId>/u)?.[1] ?? null,
    etag: block.match(/<ETag>&quot;?([^<&]+)&quot;?<\/ETag>/u)?.[1] ?? null,
    size: Number(block.match(/<Size>(\d+)<\/Size>/u)?.[1] ?? 0),
    modified_at: block.match(/<LastModified>([^<]+)<\/LastModified>/u)?.[1] ?? null,
  })).filter(item => item.key);
}

function xmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function matchSourceObject(
  db: DbPool,
  tenantId: UUID,
  object: SourceObject,
  text: string,
  sidecar: SidecarMetadata,
  actor?: ActorContext,
): Promise<MatchResult> {
  const explicit = await matchExplicitIds(db, tenantId, sidecar);
  if (explicit) return explicit;
  const calendar = await matchCalendarIds(db, tenantId, sidecar);
  if (calendar) return calendar;
  const ownerIds = actor ? await getVisibleOwnerIds(db, actor) : undefined;
  const attendeeEmails = [
    ...emailsFrom(sidecar.attendees),
    ...emailsFrom(sidecar.organizer),
    ...emailsFrom(sidecar.organizer_email),
    ...emailsFrom(text.slice(0, 5000)),
  ];
  const byMeeting = await matchMeetingWindow(db, tenantId, sidecar, attendeeEmails, ownerIds);
  if (byMeeting) return byMeeting;
  const byEmail = await matchByEmailOrDomain(db, tenantId, attendeeEmails, ownerIds);
  if (byEmail) return byEmail;
  return matchSubjectGraph(db, tenantId, object, text, sidecar, ownerIds);
}

async function matchExplicitIds(db: DbPool, tenantId: UUID, sidecar: SidecarMetadata): Promise<MatchResult | null> {
  if (sidecar.calendar_event_id) {
    const event = await calendarRepo.getCalendarEvent(db, tenantId, sidecar.calendar_event_id as UUID);
    if (event) {
      return {
        status: 'matched',
        reason: 'Matched by sidecar calendar_event_id.',
        calendar_event_id: event.id,
        contact_id: event.contact_id,
        account_id: event.account_id,
        opportunity_id: event.opportunity_id,
        use_case_id: event.use_case_id,
      };
    }
  }
  const links = {
    contact_id: sidecar.contact_id as UUID | undefined,
    account_id: sidecar.account_id as UUID | undefined,
    opportunity_id: sidecar.opportunity_id as UUID | undefined,
    use_case_id: sidecar.use_case_id as UUID | undefined,
  };
  if (!links.contact_id && !links.account_id && !links.opportunity_id && !links.use_case_id) return null;
  const verified = await verifyRecordLinks(db, tenantId, links);
  if (!verified.any) {
    return { status: 'needs_review', reason: 'Sidecar record IDs were provided but none matched records in this tenant.' };
  }
  return {
    status: 'matched',
    reason: 'Matched by explicit sidecar customer record IDs.',
    ...verified.links,
  };
}

async function matchCalendarIds(db: DbPool, tenantId: UUID, sidecar: SidecarMetadata): Promise<MatchResult | null> {
  const providerEventId = typeof sidecar.provider_event_id === 'string' ? sidecar.provider_event_id : undefined;
  const iCalUid = typeof sidecar.i_cal_uid === 'string' ? sidecar.i_cal_uid : undefined;
  if (!providerEventId && !iCalUid) return null;
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  if (providerEventId) {
    params.push(providerEventId);
    conditions.push(`provider_event_id = $${params.length}`);
  }
  if (iCalUid) {
    params.push(iCalUid);
    conditions.push(`i_cal_uid = $${params.length}`);
  }
  const result = await db.query(
    `SELECT *
     FROM calendar_events
     WHERE ${conditions.join(' AND ')}
     ORDER BY starts_at DESC
     LIMIT 2`,
    params,
  );
  if (result.rows.length === 1) {
    const event = result.rows[0] as calendarRepo.CalendarEvent;
    return {
      status: 'matched',
      reason: 'Matched by provider calendar event identifier.',
      calendar_event_id: event.id,
      contact_id: event.contact_id,
      account_id: event.account_id,
      opportunity_id: event.opportunity_id,
      use_case_id: event.use_case_id,
    };
  }
  if (result.rows.length > 1) {
    return { status: 'ambiguous', reason: 'Multiple calendar meetings matched the provided provider event identifier.', candidates: result.rows };
  }
  return null;
}

async function matchMeetingWindow(
  db: DbPool,
  tenantId: UUID,
  sidecar: SidecarMetadata,
  attendeeEmails: string[],
  ownerIds?: UUID[] | null,
): Promise<MatchResult | null> {
  const start = typeof sidecar.meeting_start === 'string' ? sidecar.meeting_start : undefined;
  if (!start || attendeeEmails.length === 0) return null;
  const params: unknown[] = [tenantId, start, attendeeEmails];
  let ownerClause = '';
  if (ownerIds) {
    if (ownerIds.length === 0) return null;
    params.push(ownerIds);
    ownerClause = ` AND (
      ce.user_id = ANY($${params.length}::uuid[])
      OR EXISTS (SELECT 1 FROM accounts a WHERE a.tenant_id = ce.tenant_id AND a.id = ce.account_id AND a.owner_id = ANY($${params.length}::uuid[]))
      OR EXISTS (SELECT 1 FROM contacts c WHERE c.tenant_id = ce.tenant_id AND c.id = ce.contact_id AND c.owner_id = ANY($${params.length}::uuid[]))
      OR EXISTS (SELECT 1 FROM opportunities o WHERE o.tenant_id = ce.tenant_id AND o.id = ce.opportunity_id AND o.owner_id = ANY($${params.length}::uuid[]))
      OR EXISTS (SELECT 1 FROM use_cases u WHERE u.tenant_id = ce.tenant_id AND u.id = ce.use_case_id AND u.owner_id = ANY($${params.length}::uuid[]))
    )`;
  }
  const result = await db.query(
    `SELECT ce.*
     FROM calendar_events ce
     WHERE ce.tenant_id = $1
       AND ce.starts_at BETWEEN ($2::timestamptz - interval '6 hours') AND ($2::timestamptz + interval '6 hours')
       AND EXISTS (
         SELECT 1 FROM unnest(ce.attendee_emails || ARRAY[coalesce(ce.organizer_email, '')]) e
         WHERE lower(e) = ANY($3::text[])
       )
       ${ownerClause}
     ORDER BY abs(extract(epoch from (ce.starts_at - $2::timestamptz))) ASC
     LIMIT 3`,
    params,
  );
  if (result.rows.length === 1) {
    const event = result.rows[0] as calendarRepo.CalendarEvent;
    return {
      status: 'matched',
      reason: 'Matched by meeting time window and attendee overlap.',
      calendar_event_id: event.id,
      contact_id: event.contact_id,
      account_id: event.account_id,
      opportunity_id: event.opportunity_id,
      use_case_id: event.use_case_id,
    };
  }
  if (result.rows.length > 1) {
    return { status: 'ambiguous', reason: 'Multiple meetings matched the same time window and attendees.', candidates: result.rows };
  }
  return null;
}

async function matchByEmailOrDomain(
  db: DbPool,
  tenantId: UUID,
  emails: string[],
  ownerIds?: UUID[] | null,
): Promise<MatchResult | null> {
  if (emails.length === 0) return null;
  const params: unknown[] = [tenantId, emails];
  let ownerClause = '';
  if (ownerIds) {
    if (ownerIds.length === 0) return null;
    params.push(ownerIds);
    ownerClause = ` AND c.owner_id = ANY($${params.length}::uuid[])`;
  }
  const contacts = await db.query(
    `SELECT c.id AS contact_id, c.account_id, c.name, c.email, a.name AS account_name
     FROM contacts c
     LEFT JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
     WHERE c.tenant_id = $1
       AND lower(c.email) = ANY($2::text[])
       AND c.archived_at IS NULL
       AND c.merged_into IS NULL
       ${ownerClause}
     LIMIT 5`,
    params,
  );
  if (contacts.rows.length === 1) {
    const row = contacts.rows[0];
    return { status: 'matched', reason: 'Matched by attendee/contact email.', contact_id: row.contact_id, account_id: row.account_id };
  }
  if (contacts.rows.length > 1) {
    return { status: 'ambiguous', reason: 'Multiple contacts matched transcript attendee emails.', candidates: contacts.rows };
  }
  const domains = [...new Set(emails.map(normalizeDomain).filter((item): item is string => Boolean(item)))];
  if (domains.length === 0) return null;
  const domainParams: unknown[] = [tenantId, domains];
  let domainOwnerClause = '';
  if (ownerIds) {
    domainParams.push(ownerIds);
    domainOwnerClause = ` AND a.owner_id = ANY($${domainParams.length}::uuid[])`;
  }
  const accounts = await db.query(
    `SELECT DISTINCT a.id AS account_id, a.name, a.domain
     FROM accounts a
     LEFT JOIN account_domains ad ON ad.account_id = a.id AND ad.tenant_id = a.tenant_id
     WHERE a.tenant_id = $1
       AND a.archived_at IS NULL
       AND a.merged_into IS NULL
       AND (lower(a.domain) = ANY($2::text[]) OR lower(ad.domain) = ANY($2::text[]))
       ${domainOwnerClause}
     LIMIT 5`,
    domainParams,
  );
  if (accounts.rows.length === 1) {
    const row = accounts.rows[0];
    return { status: 'matched', reason: 'Matched by account primary/additional domain.', account_id: row.account_id };
  }
  if (accounts.rows.length > 1) {
    return { status: 'ambiguous', reason: 'Multiple accounts matched attendee domains.', candidates: accounts.rows };
  }
  return null;
}

async function matchSubjectGraph(
  db: DbPool,
  tenantId: UUID,
  object: SourceObject,
  text: string,
  sidecar: SidecarMetadata,
  ownerIds?: UUID[] | null,
): Promise<MatchResult> {
  const query = [
    sidecar.title,
    sidecar.account_hint,
    object.source_label,
    emailsFrom(sidecar.attendees).join(', '),
    text.slice(0, 4000),
  ].filter(Boolean).join('\n');
  const graph = await resolveSubjectGraphForSource(db, tenantId, {
    text: query,
    subject_type: 'any',
    account_hint: sidecar.account_hint,
    confidence_threshold: 0.74,
    limit: 10,
  }, { ownerIds });
  const accounts = graph.subjects.filter(subject => subject.type === 'account');
  const contacts = graph.subjects.filter(subject => subject.type === 'contact');
  const opportunities = graph.subjects.filter(subject => subject.type === 'opportunity');
  const useCases = graph.subjects.filter(subject => subject.type === 'use_case');
  const candidates = graph.subjects.map(subject => ({ ...subject, source: 'subject_graph' }));
  if (accounts.length === 1 && contacts.length <= 1 && opportunities.length <= 1 && useCases.length <= 1) {
    return {
      status: 'matched',
      reason: 'Matched by Subject Graph from title, attendees, and transcript excerpt.',
      account_id: accounts[0].id as UUID,
      contact_id: contacts[0]?.id as UUID | undefined,
      opportunity_id: opportunities[0]?.id as UUID | undefined,
      use_case_id: useCases[0]?.id as UUID | undefined,
      candidates,
    };
  }
  if (candidates.length > 0) {
    return { status: 'ambiguous', reason: 'Subject Graph found possible customer records but not one confident match.', candidates };
  }
  return { status: 'needs_review', reason: 'No customer record could be matched from sidecar metadata, calendar data, attendees, domains, or transcript text.' };
}

async function verifyRecordLinks(
  db: DbPool,
  tenantId: UUID,
  links: { contact_id?: UUID; account_id?: UUID; opportunity_id?: UUID; use_case_id?: UUID },
): Promise<{ any: boolean; links: { contact_id?: UUID; account_id?: UUID; opportunity_id?: UUID; use_case_id?: UUID } }> {
  const out: { contact_id?: UUID; account_id?: UUID; opportunity_id?: UUID; use_case_id?: UUID } = {};
  for (const [field, table] of [
    ['contact_id', 'contacts'],
    ['account_id', 'accounts'],
    ['opportunity_id', 'opportunities'],
    ['use_case_id', 'use_cases'],
  ] as const) {
    const id = links[field];
    if (!id) continue;
    const result = await db.query(`SELECT id FROM ${table} WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
    if (result.rows[0]?.id) out[field] = id;
  }
  return { any: Object.keys(out).length > 0, links: out };
}

async function processMatchedSourceObject(
  db: DbPool,
  tenantId: UUID,
  object: SourceObject,
  text: string,
  sidecar: SidecarMetadata,
  artifactType: contextSourceRepo.ContextSourceArtifactType,
  match: MatchResult,
  actor?: ActorContext,
): Promise<SourceObject> {
  const start = typeof sidecar.meeting_start === 'string'
    ? sidecar.meeting_start
    : object.modified_at ?? new Date().toISOString();
  let event = match.calendar_event_id
    ? await calendarRepo.getCalendarEvent(db, tenantId, match.calendar_event_id)
    : null;
  if (!event) {
    event = await upsertCalendarEventWithIntelligence(db, tenantId, {
      provider: 'context_source_drop',
      provider_event_id: `context-source:${object.id}`,
      title: sidecar.title ?? object.source_label ?? labelForKey(object.object_key),
      description: `Imported from transcript and notes drop: ${object.object_key}`,
      organizer_email: lower(sidecar.organizer_email || sidecar.organizer) || null,
      attendee_emails: [...new Set([...emailsFrom(sidecar.attendees), ...emailsFrom(text.slice(0, 5000))])],
      starts_at: start,
      ends_at: typeof sidecar.meeting_end === 'string' ? sidecar.meeting_end : null,
      status: 'held',
      contact_id: match.contact_id ?? null,
      account_id: match.account_id ?? null,
      opportunity_id: match.opportunity_id ?? null,
      use_case_id: match.use_case_id ?? null,
      metadata: {
        context_source_object_id: object.id,
        context_source_connection_id: object.connection_id,
        source_url: sidecar.source_url ?? null,
        association_reason: match.reason,
      },
    }, actor, { requireLinkedCustomer: false });
  } else {
    event = await calendarRepo.updateCalendarEvent(db, tenantId, event.id, {
      contact_id: match.contact_id ?? event.contact_id ?? null,
      account_id: match.account_id ?? event.account_id ?? null,
      opportunity_id: match.opportunity_id ?? event.opportunity_id ?? null,
      use_case_id: match.use_case_id ?? event.use_case_id ?? null,
      metadata: { context_source_object_id: object.id, context_source_match_reason: match.reason },
    }) ?? event;
  }
  if (!event) throw new Error('Unable to create or match a customer activity for this transcript source.');
  const validation = await validateMeetingEvent(db, tenantId, event);
  event = await calendarRepo.updateCalendarEvent(db, tenantId, event.id, validation) ?? event;
  const chunks = splitTranscript(text);
  const parentHash = object.metadata?.actual_content_hash as string | undefined ?? object.content_hash;
  let memoryCreated = 0;
  let signalsCreated = 0;
  let skipped = 0;
  let lastArtifact: calendarRepo.MeetingArtifact | null = null;
  let lastRawContextSourceId: UUID | null = null;
  const authorship = sourceAuthorship(sidecar);
  for (let i = 0; i < chunks.length; i++) {
    const artifact = await calendarRepo.createMeetingArtifact(db, tenantId, {
      calendar_event_id: event.id,
      artifact_type: artifactType,
      source: 'context_source_drop',
      source_label: chunks.length > 1
        ? `${object.source_label ?? labelForKey(object.object_key)} (${i + 1}/${chunks.length})`
        : object.source_label ?? labelForKey(object.object_key),
      text_content: chunks[i],
      created_by: actor?.actor_id ?? null,
      metadata: {
        context_source_object_id: object.id,
        context_source_connection_id: object.connection_id,
        source_object_key: object.object_key,
        source_document_hash: parentHash,
        parent_content_hash: parentHash,
        chunk_index: i,
        chunk_count: chunks.length,
        source_occurred_at: start,
        source_occurred_at_provided: Boolean(sidecar.meeting_start),
        context_origin: 'transcript_drop',
        source_url: sidecar.source_url ?? null,
        ...authorship,
        source_perspective: authorship.customer_authored === true
          ? 'customer_or_external_words'
          : authorship.customer_authored === false
            ? 'our_words'
            : 'mixed_or_unknown_words',
        evidence_weight: authorship.customer_authored === true
          ? 'customer_authored_context'
          : authorship.customer_authored === false
            ? 'self_authored_action_context'
            : 'mixed_or_unknown_context',
        evidence_role: authorship.customer_authored === true
          ? 'customer_source'
          : authorship.customer_authored === false
            ? 'seller_action_or_commitment'
            : 'meeting_context',
      },
    });
    lastArtifact = await processMeetingArtifact(db, tenantId, event.id, artifact, actor);
    memoryCreated += Number(lastArtifact.extraction_receipt?.memory_created ?? 0);
    signalsCreated += Number(lastArtifact.extraction_receipt?.signals_created ?? 0);
    skipped += Number(lastArtifact.extraction_receipt?.skipped ?? 0);
    lastRawContextSourceId = (lastArtifact.raw_context_source_id ?? lastRawContextSourceId) as UUID | null;
  }
  const updated = await contextSourceRepo.updateSourceObject(db, tenantId, object.id, {
    match_status: 'matched',
    processing_status: 'processed',
    match_reason: match.reason,
    calendar_event_id: event.id,
    contact_id: event.contact_id ?? match.contact_id ?? null,
    account_id: event.account_id ?? match.account_id ?? null,
    opportunity_id: event.opportunity_id ?? match.opportunity_id ?? null,
    use_case_id: event.use_case_id ?? match.use_case_id ?? null,
    meeting_artifact_id: lastArtifact?.id ?? null,
    activity_id: lastArtifact?.activity_id ?? event.activity_id ?? null,
    raw_context_source_id: lastRawContextSourceId,
    processed_at: new Date().toISOString(),
    extraction_receipt: {
      memory_created: memoryCreated,
      signals_created: signalsCreated,
      skipped,
      chunk_count: chunks.length,
      raw_context_source_id: lastRawContextSourceId,
    },
    metadata: {
      processed_by: 'context_source_drop',
      parent_content_hash: parentHash,
      source_authorship: authorship.source_authorship,
      customer_authored: authorship.customer_authored ?? null,
    },
  });
  return updated ?? object;
}

async function markNeedsReview(
  db: DbPool,
  tenantId: UUID,
  object: SourceObject,
  input: {
    reason: string;
    failure_code?: string;
    candidates?: Array<Record<string, unknown>>;
    sidecar?: SidecarMetadata;
    matchStatus?: 'ambiguous' | 'needs_review';
  },
): Promise<SourceObject> {
  const updated = await contextSourceRepo.updateSourceObject(db, tenantId, object.id, {
    processing_status: 'needs_review',
    match_status: input.matchStatus ?? 'needs_review',
    match_reason: input.reason,
    candidates: input.candidates ?? [],
    sidecar_metadata: input.sidecar ?? {},
    failure_code: input.failure_code ?? null,
    failure_reason: input.reason,
  }) ?? object;
  return ensureReviewHandoff(db, tenantId, updated, {
    reason: input.reason,
    candidates: input.candidates ?? [],
  });
}

async function ensureReviewHandoff(
  db: DbPool,
  tenantId: UUID,
  object: SourceObject,
  input: { reason: string; candidates: Array<Record<string, unknown>> },
): Promise<SourceObject> {
  const existing = await hitlRepo.findPendingHITLByPayload(db, tenantId, 'context_source.resolve', {
    context_source_object_id: object.id,
  });
  const hitl = existing ?? await hitlRepo.createHITLRequest(db, tenantId, {
    agent_id: 'crmy-context-source-ingest',
    action_type: 'context_source.resolve',
    action_summary: `Review transcript source: ${object.source_label ?? labelForKey(object.object_key)}`,
    action_payload: {
      context_source_object_id: object.id,
      source_object_key: object.object_key,
      source_label: object.source_label,
      reason: input.reason,
      candidates: input.candidates.slice(0, 10),
      raw_context_source_id: object.raw_context_source_id,
      subject_type: object.account_id ? 'account' : object.contact_id ? 'contact' : object.opportunity_id ? 'opportunity' : object.use_case_id ? 'use_case' : undefined,
      subject_id: object.account_id ?? object.contact_id ?? object.opportunity_id ?? object.use_case_id ?? undefined,
    },
    priority: 'normal',
    sla_minutes: 1440,
  });
  return await contextSourceRepo.updateSourceObject(db, tenantId, object.id, {
    hitl_request_id: hitl.id,
    metadata: { handoff_created_at: hitl.created_at },
  }) ?? object;
}

async function resolveHandoffIfPending(
  db: DbPool,
  tenantId: UUID,
  hitlRequestId: UUID,
  reviewerId: UUID | null,
  decision: 'approved' | 'rejected',
  note: string,
): Promise<void> {
  await db.query(
    `UPDATE hitl_requests
     SET status = $4, resolved_at = now(), reviewer_id = $3, review_note = $5
     WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
    [tenantId, hitlRequestId, reviewerId, decision, note],
  );
}
