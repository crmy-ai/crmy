// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import type { UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import { embedText, loadEmbeddingConfig, type EmbeddingConfig } from '../agent/providers/embeddings.js';
import * as contextRepo from '../db/repos/context-entries.js';
import * as signalGroupRepo from '../db/repos/signal-groups.js';
import * as embeddingJobRepo from '../db/repos/context-embedding-jobs.js';

const SYNC_EMBED_TIMEOUT_MS = 2500;
const EMBEDDING_JOB_BATCH_SIZE = 50;

export type EmbeddableEntityType = 'context_entry' | 'signal_group';

export function hashEmbeddingText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function compactSignalGroupText(group: signalGroupRepo.SignalGroupWithMembers | signalGroupRepo.SignalGroup): string {
  return [
    group.context_type,
    group.title ?? '',
    group.normalized_claim,
    group.subject_name ? `Subject: ${group.subject_name}` : '',
  ].filter(Boolean).join('\n');
}

async function pgvectorReady(db: DbPool, entityType: EmbeddableEntityType): Promise<boolean> {
  if (process.env.ENABLE_PGVECTOR !== 'true') return false;
  const tableName = entityType === 'context_entry' ? 'context_entries' : 'signal_groups';
  const result = await db.query(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector,
            EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = $1 AND column_name = 'embedding'
            ) AS has_column`,
    [tableName],
  );
  return Boolean(result.rows[0]?.has_vector && result.rows[0]?.has_column);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Embedding timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readEmbeddableText(
  db: DbPool,
  tenantId: UUID | string,
  entityType: EmbeddableEntityType,
  entityId: UUID | string,
): Promise<string | null> {
  if (entityType === 'context_entry') {
    const entry = await contextRepo.getContextEntry(db, tenantId as UUID, entityId as UUID);
    if (!entry) return null;
    return [entry.context_type, entry.title ?? '', entry.body].filter(Boolean).join('\n');
  }
  const group = await signalGroupRepo.getSignalGroup(db, tenantId, entityId);
  if (!group) return null;
  return compactSignalGroupText(group);
}

async function writeEmbedding(
  db: DbPool,
  tenantId: UUID | string,
  entityType: EmbeddableEntityType,
  entityId: UUID | string,
  embedding: number[],
): Promise<void> {
  if (entityType === 'context_entry') {
    await contextRepo.updateEmbedding(db, entityId as UUID, tenantId as UUID, embedding);
  } else {
    await signalGroupRepo.updateSignalGroupEmbedding(db, tenantId, entityId, embedding);
  }
}

export async function enqueueEmbedding(
  db: DbPool,
  tenantId: UUID | string,
  entityType: EmbeddableEntityType,
  entityId: UUID | string,
  text?: string | null,
): Promise<void> {
  const config = loadEmbeddingConfig();
  if (!config) return;
  const body = text ?? await readEmbeddableText(db, tenantId, entityType, entityId);
  if (!body?.trim()) return;
  await embeddingJobRepo.enqueueEmbeddingJob(db, {
    tenantId,
    entityType,
    entityId,
    textHash: hashEmbeddingText(body),
    provider: config.provider,
    model: config.model,
    dimensions: config.dimensions,
  });
}

export async function ensureEmbeddingBestEffort(
  db: DbPool,
  tenantId: UUID | string,
  entityType: EmbeddableEntityType,
  entityId: UUID | string,
  text?: string | null,
): Promise<{ embedded: boolean; queued: boolean; reason?: string }> {
  const config = loadEmbeddingConfig();
  if (!config) return { embedded: false, queued: false, reason: 'embedding_provider_not_configured' };
  const body = text ?? await readEmbeddableText(db, tenantId, entityType, entityId);
  if (!body?.trim()) return { embedded: false, queued: false, reason: 'empty_text' };
  if (process.env.ENABLE_PGVECTOR !== 'true') {
    return { embedded: false, queued: false, reason: 'pgvector_disabled' };
  }
  if (!await pgvectorReady(db, entityType)) {
    await enqueueEmbedding(db, tenantId, entityType, entityId, body);
    return { embedded: false, queued: true, reason: 'pgvector_not_ready' };
  }
  try {
    const vector = await withTimeout(embedText(body, config), SYNC_EMBED_TIMEOUT_MS);
    await writeEmbedding(db, tenantId, entityType, entityId, vector);
    return { embedded: true, queued: false };
  } catch (err) {
    await enqueueEmbedding(db, tenantId, entityType, entityId, body);
    return { embedded: false, queued: true, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function embedQuery(text: string): Promise<{ config: EmbeddingConfig; embedding: number[] } | null> {
  const config = loadEmbeddingConfig();
  if (!config) return null;
  return { config, embedding: await embedText(text, config) };
}

export async function processEmbeddingJobs(db: DbPool): Promise<{ processed: number; failed: number }> {
  const jobs = await embeddingJobRepo.claimPendingEmbeddingJobs(db, EMBEDDING_JOB_BATCH_SIZE);
  if (jobs.length === 0) return { processed: 0, failed: 0 };
  const config = loadEmbeddingConfig();
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      if (!config) throw new Error('EMBEDDING_PROVIDER is not configured.');
      const text = await readEmbeddableText(db, job.tenant_id, job.entity_type, job.entity_id);
      if (!text?.trim()) throw new Error('No embeddable text found for entity.');
      if (!await pgvectorReady(db, job.entity_type)) throw new Error('pgvector embedding column is not ready.');
      const vector = await embedText(text, config);
      await writeEmbedding(db, job.tenant_id, job.entity_type, job.entity_id, vector);
      if (job.entity_type === 'context_entry') {
        const { regroupSignalAfterEmbedding } = await import('./signal-groups.js');
        await regroupSignalAfterEmbedding(db, job.tenant_id, job.entity_id);
      }
      await embeddingJobRepo.markEmbeddingJobComplete(db, job.id);
      processed++;
    } catch (err) {
      await embeddingJobRepo.markEmbeddingJobFailed(db, job.id, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }
  if (processed || failed) {
    console.log(`[embeddings] Batch complete — ${processed} embedded, ${failed} failed.`);
  }
  return { processed, failed };
}
