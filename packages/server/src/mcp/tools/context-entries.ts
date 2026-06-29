// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  contextEntryCreate, contextEntryGet, contextEntrySearch, contextEntrySupersede,
  contextSearch, contextReview, contextStaleList, briefingGet,
  contextDiff, contextIngest, contextSemanticSearch, contextEmbedBackfill,
  contextSignalPromote, contextSignalReject, contextLineageGet,
  contextSignalGroupCompleteDetails, contextSignalGroupHandoff,
} from '@crmy/shared';
import { resolveSubjectGraph } from '../../services/subject-graph-resolver.js';
import { loadEmbeddingConfig, embedText } from '../../agent/providers/embeddings.js';
import { ensureEmbeddingBestEffort } from '../../services/embedding-service.js';
import { evaluateMemoryReadiness } from '../../services/memory-readiness.js';
import { getContextLineage } from '../../services/context-lineage.js';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext, SubjectType, UUID } from '@crmy/shared';
import * as contextRepo from '../../db/repos/context-entries.js';
import * as activityRepo from '../../db/repos/activities.js';
import * as contextTypeRepo from '../../db/repos/context-type-registry.js';
import * as outboxRepo from '../../db/repos/context-outbox.js';
import * as rawContextRepo from '../../db/repos/raw-context-sources.js';
import * as rawContextPayloadRepo from '../../db/repos/raw-context-source-payloads.js';
import * as signalGroupRepo from '../../db/repos/signal-groups.js';
import * as governorLimits from '../../db/repos/governor-limits.js';
import * as hitlRepo from '../../db/repos/hitl.js';
import { assembleBriefing, formatBriefingText } from '../../services/briefing.js';
import { processStaleEntriesForTenant } from '../../services/staleness.js';
import { emitEvent } from '../../events/emitter.js';
import { CrmyError, notFound, validationError } from '@crmy/shared';
import { extractContextFromActivity } from '../../agent/extraction.js';
import { detectContradictions } from '../../services/contradictions.js';
import { consolidateContextEntries } from '../../services/consolidation.js';
import { checkContextConvergence } from '../../services/context-convergence.js';
import { createContradictionReviewAssignments } from '../../services/context-review-assignments.js';
import { assertActionPolicyAllowsMutation, evaluateActionPolicy } from '../../services/action-policy.js';
import { attachSignalToGroup, completeSignalGroupDetails, createSignalGroupHandoff, dismissSignalGroup, promoteSignalGroup } from '../../services/signal-groups.js';
import { completeOpenReviewAssignmentsForContextEntry } from '../../services/review-queue.js';
import { memoryFreshnessWindowDays } from '../../services/memory-trust.js';
import { withSignalReadiness } from '../../services/signal-readiness.js';
import { ensureActorRecordForContext, resolveActorRecordId } from '../../services/actor-identity.js';
import { assertActivityAccess, assertSubjectAccess, resolveOwnerFilter } from '../../services/access-control.js';
import { runIdempotent } from '../../db/repos/idempotency.js';
import { mutationReceipt } from '../mutation-receipt.js';
import type { ToolDef } from '../server.js';
import type { RawContextRecordProposal } from '../../services/raw-context-subjects.js';

async function visibleOwnerIds(db: DbPool, actor: ActorContext): Promise<UUID[] | undefined> {
  const filter = await resolveOwnerFilter(db, actor);
  return 'owner_ids' in filter ? filter.owner_ids as UUID[] : undefined;
}

function normalizeOptionalTimestamp(value?: string): string | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw validationError('source_occurred_at must be a valid date or timestamp.');
  }
  return parsed.toISOString();
}

function normalizeSinceTimestamp(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw validationError('since must be an ISO timestamp or a relative duration like "7d", "24h", or "30m".');
  const match = trimmed.match(/^(\d+)([dhm])$/);
  if (match) {
    const [, num, unit] = match;
    const ms = parseInt(num, 10) * (unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000);
    return new Date(Date.now() - ms).toISOString();
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw validationError('since must be an ISO timestamp or a relative duration like "7d", "24h", or "30m".');
  }
  return parsed.toISOString();
}

function metadataString(source: rawContextRepo.RawContextSource, key: string): string | null {
  const value = source.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uuidLike(value?: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

const contextFind = z.object({
  mode: z.enum(['recent', 'search', 'signals', 'stale']).default('recent')
    .describe('recent: list Memory/Signals on a record; search: full-text Memory search; signals: Signal groups needing review; stale: Current Memory needing reverification.'),
  query: z.string().min(1).optional()
    .describe('Search text. Required for mode="search"; optional filter for recent entries and Signal groups.'),
  subject_type: z.enum(['contact', 'account', 'opportunity', 'use_case']).optional(),
  subject_id: z.string().uuid().optional(),
  context_type: z.string().optional(),
  memory_status: z.enum(['signal', 'active', 'rejected', 'superseded']).optional()
    .describe('Filter entries by status. Defaults to active for recent/search; ignored for mode="signals" and mode="stale".'),
  current_only: z.boolean().default(true),
  attention_only: z.boolean().default(true)
    .describe('For mode="signals", return only Signal groups needing review/promotion/dismissal unless set false.'),
  structured_data_filter: z.record(z.unknown()).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

async function assertRawContextSourceAccess(
  db: DbPool,
  actor: ActorContext,
  source: rawContextRepo.RawContextSource,
  sourceIdForError = source.id,
): Promise<void> {
  if (!source.subject_type || !source.subject_id) {
    const requesterActorRecordId = await resolveActorRecordId(db, actor.tenant_id, actor.actor_id);
    if (
      actor.role !== 'admin' &&
      actor.role !== 'owner' &&
      source.actor_id !== actor.actor_id &&
      source.actor_id !== requesterActorRecordId
    ) {
      throw notFound('Source', sourceIdForError);
    }
    return;
  }
  await assertSubjectAccess(db, actor, source.subject_type as SubjectType | undefined, source.subject_id as string | undefined);
}

async function assertLineageAccess(db: DbPool, actor: ActorContext, input: z.infer<typeof contextLineageGet>): Promise<void> {
  if (input.subject_type && input.subject_id) {
    await assertSubjectAccess(db, actor, input.subject_type as SubjectType, input.subject_id);
  }
  if (input.context_entry_id) {
    const entry = await contextRepo.getContextEntry(db, actor.tenant_id, input.context_entry_id);
    if (!entry) throw notFound('ContextEntry', input.context_entry_id);
    await assertSubjectAccess(db, actor, entry.subject_type as SubjectType, entry.subject_id);
  }
  if (input.signal_group_id) {
    const group = await signalGroupRepo.getSignalGroup(db, actor.tenant_id, input.signal_group_id);
    if (!group) throw notFound('Signal', input.signal_group_id);
    await assertSubjectAccess(db, actor, group.subject_type as SubjectType, group.subject_id);
  }
  if (input.source_id) {
    const source = await rawContextRepo.getRawContextSource(db, actor.tenant_id, input.source_id);
    if (!source) throw notFound('Source', input.source_id);
    await assertRawContextSourceAccess(db, actor, source, input.source_id);
  }
}

function processingNextAction(input: {
  status?: string;
  memory_created?: number;
  signals_created?: number;
  skipped?: number;
}): string {
  if (input.status === 'failed') return 'Review the failure reason, fix the source or setup issue, then ingest again.';
  if (input.signals_created && input.signals_created > 0) return 'Review Signals and promote confirmed items to Memory.';
  if (input.memory_created && input.memory_created > 0) return 'View Memory or ask for a briefing.';
  if (input.skipped && input.skipped > 0) return 'Add more customer-specific detail or resolve the subject, then ingest again.';
  return 'No action needed.';
}

function processingReceipt(source: rawContextRepo.RawContextSource | null, fallback: {
  memory_created: number;
  signals_created: number;
  skipped: number;
}) {
  const receipt = {
    source_id: source?.id,
    status: source?.status ?? 'processed',
    stage: source?.stage ?? 'extracted',
    memory_created: source?.memory_created ?? fallback.memory_created,
    signals_created: source?.signals_created ?? fallback.signals_created,
    skipped: source?.skipped ?? fallback.skipped,
    failure_reason: source?.failure_reason ?? undefined,
  };
  return {
    ...receipt,
    next_action: processingNextAction(receipt),
  };
}

function proposalDedupeKey(proposal: RawContextRecordProposal): string {
  const fieldKey = String(
    proposal.fields.email
      ?? proposal.fields.domain
      ?? proposal.fields.name
      ?? proposal.name,
  ).trim().toLowerCase();
  return `${proposal.record_type}:${fieldKey}`;
}

function mergeRecordProposals(...groups: Array<RawContextRecordProposal[] | undefined>): RawContextRecordProposal[] {
  const merged = new Map<string, RawContextRecordProposal>();
  for (const group of groups) {
    for (const proposal of group ?? []) {
      const key = proposalDedupeKey(proposal);
      if (!merged.has(key)) merged.set(key, proposal);
    }
  }
  return [...merged.values()];
}

async function createRecordProposalHandoffs(
  db: DbPool,
  actor: ActorContext,
  input: {
    actorRecordId: string;
    sourceRef: string;
    rawContextSourceId?: string;
    rawExcerpt: string;
    proposals: RawContextRecordProposal[];
  },
): Promise<Array<{ request_id: string; proposal: RawContextRecordProposal; status: string }>> {
  const created: Array<{ request_id: string; proposal: RawContextRecordProposal; status: string }> = [];
  for (const proposal of input.proposals.slice(0, 8)) {
    if (proposal.confidence < 0.45) continue;
    const dedupeKey = proposalDedupeKey(proposal);
    const existing = await hitlRepo.findPendingHITLByPayload(db, actor.tenant_id, 'record.create.review', {
      dedupe_key: dedupeKey,
    });
    if (existing) {
      created.push({ request_id: existing.id, proposal, status: existing.status });
      continue;
    }

    const request = await hitlRepo.createHITLRequest(db, actor.tenant_id, {
      agent_id: actor.actor_id,
      action_type: 'record.create.review',
      action_summary: `Review new ${proposal.record_type.replace('_', ' ')}: ${proposal.name}`,
      priority: proposal.duplicate_candidates?.length ? 'normal' : 'low',
      sla_minutes: 1440,
      action_payload: {
        dedupe_key: dedupeKey,
        requested_decision: 'create_record_or_link_existing',
        proposed_record: proposal,
        raw_context_source_id: input.rawContextSourceId,
        source_ref: input.sourceRef,
        evidence_summary: proposal.reason,
        raw_excerpt: input.rawExcerpt.slice(0, 1000),
      },
    });
    created.push({ request_id: request.id, proposal, status: request.status });
  }
  return created;
}

export function contextEntryTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'context_add',
      tier: 'core',
      description: 'Advanced direct write for Current Memory or an already-reviewed Signal. Do not use this for transcripts, emails, notes, research, or other messy customer input; use context_ingest_auto or context_ingest so CRMy records a Source, extracts evidence-backed Signals, and promotes high-confidence Memory. Use memory_status="active" only for Current Memory that agents can rely on. Use memory_status="signal" only when you already have evidence and the entry needs review before writeback, forecast influence, task assignment, or customer engagement. Before creating Current Memory, CRMy checks existing Current Memory on the same subject and type; likely duplicates, updates, or contradictions are rejected with suggested actions so agents can use context_supersede or request review instead of creating noisy memory. Set confidence (0.0-1.0), evidence for signals, and valid_until whenever the information has a shelf life.',
      inputSchema: contextEntryCreate,
      handler: async (input: z.infer<typeof contextEntryCreate>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_add',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        await assertSubjectAccess(db, actor, input.subject_type, input.subject_id);
        // Enforce governor limit on context entry count
        const entryCount = await governorLimits.countContextEntries(db, actor.tenant_id);
        await governorLimits.enforceLimit(db, actor.tenant_id, 'context_entries_max', entryCount);

        // Enforce body length limit
        if (input.body) {
          const maxChars = await governorLimits.getLimit(db, actor.tenant_id, 'context_body_max_chars');
          if (input.body.length > maxChars) {
            throw validationError(`Context body exceeds maximum length (${input.body.length} > ${maxChars} chars)`);
          }
        }

        if (input.memory_status === 'signal' && (!input.evidence || input.evidence.length === 0)) {
          throw validationError('Signals require evidence. Add at least one evidence item with a source, snippet, or reference so reviewers can decide whether to promote it to Memory.');
        }

        if (input.memory_status === 'rejected' || input.memory_status === 'superseded') {
          throw validationError('Create Current Memory or Signals only. Use context_signal_reject or context_supersede to move entries into rejected or superseded lifecycle states.');
        }

        const lifecycle_warnings: string[] = [];
        if (input.memory_status === 'active' && input.confidence !== undefined && input.confidence < 0.7) {
          lifecycle_warnings.push('Low-confidence operational Memory should usually be created as a Signal first, then promoted after review or confirmation.');
        }
        const createInput = { ...input };
        if (createInput.parent_id && createInput.context_type !== 'note') {
          delete createInput.parent_id;
          lifecycle_warnings.push('Ignored parent_id because parent_id is only used for threaded notes. Current Memory and Signals should be linked by subject_type and subject_id.');
        }
        if (createInput.parent_id) {
          const parent = await contextRepo.getContextEntry(db, actor.tenant_id, createInput.parent_id);
          if (!parent) {
            throw validationError('Parent context entry was not found. Omit parent_id unless you are replying to an existing note context entry.');
          }
          if (parent.subject_type !== createInput.subject_type || parent.subject_id !== createInput.subject_id) {
            throw validationError('Parent context entry must belong to the same customer record as the new note.');
          }
        }

        const convergence = createInput.memory_status === 'signal'
          ? { suggested_action: 'add_new' as const, should_block: false, candidates: [] }
          : await checkContextConvergence(db, actor.tenant_id, {
          subject_type: createInput.subject_type,
          subject_id: createInput.subject_id,
          context_type: createInput.context_type,
          title: createInput.title,
          body: createInput.body,
          structured_data: createInput.structured_data as Record<string, unknown> | undefined,
        });

        if (!input.allow_similar && convergence.should_block) {
          throw new CrmyError(
            'CONFLICT',
            `Similar or conflicting Current Memory already exists; suggested action: ${convergence.suggested_action}`,
            409,
            {
              suggested_action: convergence.suggested_action,
              candidates: convergence.candidates,
            },
          );
        }

        const actorRecordId = await ensureActorRecordForContext(db, actor);
        const entry = await contextRepo.createContextEntry(db, actor.tenant_id, {
          ...createInput,
          source: createInput.source ?? 'mcp',
          source_ref: createInput.source_ref ?? `actor:${actor.actor_id}`,
          authored_by: actorRecordId,
        });

        const signal_group_result = entry.memory_status === 'signal'
          ? await attachSignalToGroup(db, actor.tenant_id, entry, {
            threshold: 0.85,
            autoPromote: false,
            actorId: actorRecordId,
          })
          : undefined;

        const directSourceType = input.source ?? (actor.actor_type === 'agent' ? 'mcp' : 'context_api');
        const directSourceRef = input.source_ref ?? entry.id;
        await rawContextRepo.upsertRawContextSource(db, actor.tenant_id, {
          source_type: directSourceType,
          source_ref: directSourceRef,
          source_label: input.title ?? input.context_type,
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          actor_id: actorRecordId,
          status: entry.memory_status === 'signal' ? 'needs_review' : 'processed',
          stage: entry.memory_status === 'signal' ? 'review_signals' : 'confirmed_memory',
          raw_excerpt: input.body.slice(0, 1000),
          signals_created: entry.memory_status === 'signal' ? 1 : 0,
          memory_created: entry.memory_status === 'active' ? 1 : 0,
          metadata: {
            context_entry_id: entry.id,
            context_type: entry.context_type,
            memory_status: entry.memory_status,
          },
        });

        await ensureEmbeddingBestEffort(db, actor.tenant_id, 'context_entry', entry.id, entry.body);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'context.added',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'context_entry',
          objectId: entry.id,
          afterData: entry,
        });

        // Enqueue for search indexing — fire-and-forget, never blocks the write.
        outboxRepo.insertJob(db, actor.tenant_id, 'context_entry', entry.id, entry as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[outbox] context_add enqueue ${entry.id}: ${(err as Error).message}`));

        // Check whether the typed details are complete enough for Memory.
        const schema = await contextTypeRepo.getContextTypeSchema(db, actor.tenant_id, input.context_type);
        const readiness = evaluateMemoryReadiness(input.structured_data as Record<string, unknown> | undefined, schema);
        const schema_warnings = readiness.validation_warnings;
        const validation_warnings = [...lifecycle_warnings, ...schema_warnings];
        return {
          context_entry: entry,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'context_entry',
            objectId: entry.id,
            eventId: event_id,
            sideEffects: ['embedding:queued', 'search_index:queued'],
          }),
          context_convergence: {
            suggested_action: convergence.suggested_action,
            candidates: convergence.candidates,
            bypassed: input.allow_similar && convergence.candidates.length > 0,
          },
          ...(signal_group_result ? { signal_group: withSignalReadiness(signal_group_result.signal_group) } : {}),
          ...(validation_warnings.length > 0 ? { validation_warnings } : {}),
        };
        });
      },
    },
    {
      name: 'context_get',
      tier: 'core',
      description: 'Retrieve a single context entry by its UUID. Returns the full entry including body, structured_data, confidence score, authorship, and staleness metadata. Use this when you have a specific entry ID from a briefing, search result, or stale warning and need the complete details.',
      inputSchema: contextEntryGet,
      handler: async (input: z.infer<typeof contextEntryGet>, actor: ActorContext) => {
        const entry = await contextRepo.getContextEntry(db, actor.tenant_id, input.id);
        if (!entry) throw notFound('ContextEntry', input.id);
        await assertSubjectAccess(db, actor, entry.subject_type as SubjectType, entry.subject_id);
        return { context_entry: entry };
      },
    },
    {
      name: 'context_find',
      tier: 'core',
      description: 'Consolidated retrieval for Current Memory, Signals, stale Memory, and workspace context search. Prefer this over context_list, context_search, context_stale, or context_signal_group_list unless you need one of those tools\' specialized parameters. Use mode="recent" for entries on a known record, mode="search" for keyword search, mode="signals" for Signal groups needing review, and mode="stale" for Memory that should be reverified.',
      inputSchema: contextFind,
      handler: async (input: z.infer<typeof contextFind>, actor: ActorContext) => {
        if (input.subject_type && input.subject_id) {
          await assertSubjectAccess(db, actor, input.subject_type as SubjectType, input.subject_id);
        }
        const ownerIds = await visibleOwnerIds(db, actor);

        if (input.mode === 'signals') {
          const result = await signalGroupRepo.listSignalGroups(db, actor.tenant_id, {
            status: undefined,
            subject_type: input.subject_type,
            subject_id: input.subject_id,
            context_type: input.context_type,
            query: input.query,
            attention_only: input.attention_only,
            limit: input.limit,
            cursor: input.cursor,
            owner_ids: ownerIds,
          });
          const signalGroups = result.data.map(group => withSignalReadiness(group));
          return {
            mode: input.mode,
            signal_groups: signalGroups,
            data: signalGroups,
            next_cursor: result.next_cursor,
            total: result.total,
            recommended_next_tools: ['context_signal_group_get', 'context_signal_group_complete_details', 'context_signal_handoff', 'context_signal_group_promote'],
          };
        }

        if (input.mode === 'stale') {
          const entries = await contextRepo.listStaleEntries(db, actor.tenant_id, {
            subject_type: input.subject_type,
            subject_id: input.subject_id,
            owner_ids: ownerIds,
            limit: input.limit,
          });
          return {
            mode: input.mode,
            stale_entries: entries,
            context_entries: entries,
            total: entries.length,
            recommended_next_tools: ['context_get', 'context_review_batch', 'context_supersede'],
          };
        }

        if (input.mode === 'search') {
          if (!input.query?.trim()) throw validationError('context_find mode="search" requires query.');
          const entries = await contextRepo.fullTextSearch(db, actor.tenant_id, input.query, {
            subject_type: input.subject_type,
            subject_id: input.subject_id,
            context_type: input.context_type,
            current_only: input.current_only,
            memory_status: input.memory_status ?? 'active',
            limit: input.limit,
            structured_data_filter: input.structured_data_filter as Record<string, unknown> | undefined,
            owner_ids: ownerIds,
          });
          return {
            mode: input.mode,
            context_entries: entries,
            total: entries.length,
            recommended_next_tools: ['context_get', 'briefing_get', 'action_context_get'],
          };
        }

        const result = await contextRepo.searchContextEntries(db, actor.tenant_id, {
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          context_type: input.context_type,
          memory_status: input.memory_status ?? 'active',
          is_current: input.current_only,
          query: input.query,
          structured_data_filter: input.structured_data_filter as Record<string, unknown> | undefined,
          owner_ids: ownerIds,
          limit: input.limit,
          cursor: input.cursor,
        });
        return {
          mode: input.mode,
          context_entries: result.data,
          next_cursor: result.next_cursor,
          total: result.total,
          recommended_next_tools: ['context_get', 'briefing_get', 'action_context_get'],
        };
      },
    },
    {
      name: 'context_list',
      tier: 'core',
      description: 'Specific/advanced listing tool for Current Memory and Signals attached to a customer record. Prefer context_find for ordinary retrieval. Use this when you need cursor pagination, authored_by filtering, visibility/pinned note filters, or exact low-level entry listing controls. Use memory_status="active" for Current Memory and memory_status="signal" for reviewable Signals.',
      inputSchema: contextEntrySearch,
      handler: async (input: z.infer<typeof contextEntrySearch>, actor: ActorContext) => {
        if (input.subject_type && input.subject_id) {
          await assertSubjectAccess(db, actor, input.subject_type as SubjectType, input.subject_id);
        }
        const ownerIds = await visibleOwnerIds(db, actor);
        const result = await contextRepo.searchContextEntries(db, actor.tenant_id, {
          ...input,
          memory_status: input.memory_status,
          structured_data_filter: input.structured_data_filter as Record<string, unknown> | undefined,
          visibility: input.visibility,
          pinned: input.pinned,
          owner_ids: ownerIds,
          limit: input.limit ?? 20,
        });
        return { context_entries: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'context_source_list',
      tier: 'core',
      description: 'List Source processing records. Use this to see where context came from, whether source material was processed, how many Signals or Memory entries it produced, and what failed or needs review. This is the best tool for agents and operators to inspect ingestion receipts before deciding whether to retry, review Signals, or rely on confirmed Memory.',
      inputSchema: z.object({
        source_type: z.string().optional().describe('Filter by source type such as activity, add_context, email_inbound, mcp, context_api, crm_sync, or warehouse_sync'),
        status: z.enum(['pending', 'processing', 'processed', 'needs_review', 'failed', 'skipped']).optional(),
        subject_type: z.enum(['contact', 'account', 'opportunity', 'use_case']).optional(),
        subject_id: z.string().uuid().optional(),
        q: z.string().max(200).optional().describe('Search source label, source ref, source type, or excerpt before applying cursor limits'),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
      }),
      handler: async (
        input: {
          source_type?: string;
          status?: rawContextRepo.RawContextSourceStatus;
          subject_type?: SubjectType;
          subject_id?: string;
          q?: string;
          limit: number;
          cursor?: string;
        },
        actor: ActorContext,
      ) => {
        const ownerIds = await visibleOwnerIds(db, actor);
        const actorRecordId = ownerIds ? await resolveActorRecordId(db, actor.tenant_id, actor.actor_id) : undefined;
        if (input.subject_type && input.subject_id) {
          await assertSubjectAccess(db, actor, input.subject_type, input.subject_id);
        }
        const result = await rawContextRepo.listRawContextSources(db, actor.tenant_id, {
          source_type: input.source_type,
          status: input.status,
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          query: input.q,
          owner_ids: ownerIds,
          actor_ids: actorRecordId ? [actorRecordId] : undefined,
          limit: input.limit ?? 50,
          cursor: input.cursor,
        });
        return { sources: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'context_source_get',
      tier: 'core',
      description: 'Get a Source processing record by ID, including source label, source type, status, processing stage, excerpt, counts, failure reason, and metadata. Use this when a processing receipt or Source list item needs inspection.',
      inputSchema: z.object({
        id: z.string().uuid().describe('Source ID'),
      }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const source = await rawContextRepo.getRawContextSource(db, actor.tenant_id, input.id);
        if (!source) throw notFound('Source', input.id);
        await assertRawContextSourceAccess(db, actor, source, input.id);
        return { source };
      },
    },
    {
      name: 'context_source_reprocess',
      tier: 'core',
      description: 'Retry a failed or skipped Source processing record. If the source points at an activity, CRMy reruns extraction on that activity. If CRMy retained the original payload, it reruns automatic subject matching and extraction from the full source text. Only falls back to the excerpt when no replayable payload is available.',
      inputSchema: z.object({
        id: z.string().uuid().describe('Source ID to reprocess'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input: { id: string; idempotency_key?: string }, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_source_reprocess',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        const source = await rawContextRepo.getRawContextSource(db, actor.tenant_id, input.id);
        if (!source) throw notFound('Source', input.id);
        await assertRawContextSourceAccess(db, actor, source, input.id);
        const actorRecordId = await ensureActorRecordForContext(db, actor);

        await rawContextRepo.updateRawContextSource(db, actor.tenant_id, source.source_type, source.source_ref, {
          status: 'processing',
          stage: 'reprocess',
          failure_reason: null,
          metadata: {
            reprocess_requested_at: new Date().toISOString(),
            reprocess_requested_by: actor.actor_id,
          },
        });

        const linkedActivityId = metadataString(source, 'primary_activity_id')
          ?? (uuidLike(source.source_ref) ? source.source_ref : null);
        const canRetryActivity = uuidLike(linkedActivityId)
          && (source.source_type === 'activity' || source.source_type === 'add_context' || source.source_type === 'mcp' || source.source_type.includes('email'));
        const payload = await rawContextPayloadRepo.getRawContextSourcePayload(db, actor.tenant_id, source.id);
        const replayDocument = payload?.document_text ?? source.raw_excerpt ?? '';
        const replaySourceLabel = payload?.source_label ?? source.source_label ?? 'Reprocessed Source';
        const replayOccurredAt = payload?.source_occurred_at ?? metadataString(source, 'source_occurred_at');
        const replayDocumentHash = payload?.document_hash ?? metadataString(source, 'source_document_hash')
          ?? (replayDocument ? createHash('sha256').update(replayDocument).digest('hex') : null);

        try {
          let result: unknown;
          if (canRetryActivity && linkedActivityId) {
            const outcome = await extractContextFromActivity(db, actor.tenant_id, linkedActivityId);
            result = {
              ...outcome,
              mutation: mutationReceipt(actor, {
                objectType: 'activity',
                objectId: linkedActivityId,
                sideEffects: ['context_extraction:completed'],
              }),
            };
          } else if (replayDocument.trim()) {
            const detected = await resolveSubjectGraph(db, actor, {
              text: replayDocument,
              limit: 20,
              confidence_threshold: 0.6,
            });
            if (detected.subjects.length === 0) {
              await rawContextRepo.updateRawContextSource(db, actor.tenant_id, source.source_type, source.source_ref, {
                status: 'skipped',
                stage: 'reprocess',
                skipped: Math.max(1, source.skipped),
                detected_subjects: detected.skipped.map(item => ({ name: item.name, status: 'skipped', reason: item.reason })),
                failure_reason: 'No customer records could be confidently identified in the stored excerpt.',
              });
              result = { extracted_count: 0, memory_created: 0, signals_created: 0, skipped: 1 };
            } else {
              let extractedCount = 0;
              let memoryCreated = 0;
              let signalsCreated = 0;
              let skippedCount = 0;
              for (const subject of detected.subjects) {
                const activity = await activityRepo.createActivity(db, actor.tenant_id, {
                  type: 'note',
                  subject: replaySourceLabel,
                  body: replayDocument,
                  subject_type: subject.type as SubjectType,
                  subject_id: subject.id,
                  performed_by: actorRecordId,
                  source_agent: actor.actor_type === 'agent' ? 'context_source_reprocess' : undefined,
                  occurred_at: replayOccurredAt ?? new Date().toISOString(),
                  detail: {
                    raw_context_source_ref: source.source_ref,
                    source_document_hash: replayDocumentHash,
                    source_occurred_at: replayOccurredAt,
                    source_occurred_at_provided: Boolean(replayOccurredAt),
                    reprocessed_from_raw_context_source_id: source.id,
                  },
                });
                const outcome = await extractContextFromActivity(db, actor.tenant_id, activity.id);
                extractedCount += outcome.extracted_count;
                memoryCreated += outcome.memory_created;
                signalsCreated += outcome.signals_created;
                skippedCount += outcome.skipped;
              }
              await rawContextRepo.updateRawContextSource(db, actor.tenant_id, source.source_type, source.source_ref, {
                status: signalsCreated > 0 ? 'needs_review' : extractedCount > 0 ? 'processed' : 'skipped',
                stage: 'reprocessed',
                memory_created: memoryCreated,
                signals_created: signalsCreated,
                skipped: skippedCount,
                detected_subjects: detected.subjects.map(subject => ({
                  subject_type: subject.type,
                  subject_id: subject.id,
                  name: subject.name,
                  confidence: subject.confidence,
                })),
                failure_reason: extractedCount > 0 ? null : 'Reprocess completed but no extractable context was found.',
                metadata: {
                  reprocessed_from_payload: Boolean(payload),
                  replay_payload_id: payload?.id,
                  replay_document_hash: replayDocumentHash,
                  replay_document_chars: replayDocument.length,
                },
              });
              result = { extracted_count: extractedCount, memory_created: memoryCreated, signals_created: signalsCreated, skipped: skippedCount };
            }
          } else {
            throw validationError('This Source cannot be reprocessed because CRMy does not have the original activity, replay payload, or source excerpt.');
          }

          const updated = await rawContextRepo.getRawContextSource(db, actor.tenant_id, source.id);
          return { source: updated, result };
        } catch (err) {
          await rawContextRepo.updateRawContextSource(db, actor.tenant_id, source.source_type, source.source_ref, {
            status: 'failed',
            stage: 'reprocess',
            failure_reason: err instanceof Error ? err.message : 'Reprocess failed.',
          });
          throw err;
        }
        });
      },
    },
    {
      name: 'context_signal_promote',
      tier: 'core',
      description: 'Advanced direct promotion for one evidence-backed Signal into Current Memory. Prefer context_signal_group_promote for ordinary agent workflows because it uses grouped evidence and readiness. Use this only after human review, explicit user confirmation, or an Action Policy that allows the Signal to become Memory.',
      inputSchema: contextSignalPromote,
      handler: async (input: z.infer<typeof contextSignalPromote>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_signal_promote',
          key: input.idempotency_key,
          request: input,
        }, async () => {
          const before = await contextRepo.getContextEntry(db, actor.tenant_id, input.id);
          if (!before) throw notFound('Signal', input.id);
          await assertSubjectAccess(db, actor, before.subject_type as SubjectType, before.subject_id);
          if (before.memory_status !== 'signal' || before.is_current === false) {
            throw validationError('Only current Signals can be promoted to Current Memory.');
          }
          const policy = evaluateActionPolicy({
            action_type: 'context.signal_promote',
            object_type: before.subject_type,
            actor,
            confidence: input.confidence ?? before.confidence ?? null,
            evidence: before.evidence ?? [],
            memory_status: 'signal',
          });
          assertActionPolicyAllowsMutation(policy);
          const actorRecordId = await ensureActorRecordForContext(db, actor);
          const entry = await contextRepo.promoteSignal(db, actor.tenant_id, input.id, actorRecordId, {
            body: input.body,
            title: input.title,
            structured_data: input.structured_data as Record<string, unknown> | undefined,
            confidence: input.confidence,
            tags: input.tags,
          });
          if (!entry) throw notFound('Signal', input.id);
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id,
            eventType: 'context.signal_promoted',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'context_entry',
            objectId: entry.id,
            beforeData: before,
            afterData: entry,
            metadata: { action_policy: policy },
          });
          const resolvedAssignments = await completeOpenReviewAssignmentsForContextEntry(db, actor.tenant_id, entry.id, {
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            reason: 'signal_promoted',
          });
          outboxRepo.insertJob(db, actor.tenant_id, 'context_entry', entry.id, entry as unknown as Record<string, unknown>)
            .catch((err: unknown) => console.warn(`[outbox] context_signal_promote enqueue ${entry.id}: ${(err as Error).message}`));
          return {
            context_entry: entry,
            event_id,
            mutation: mutationReceipt(actor, {
              objectType: 'context_entry',
              objectId: entry.id,
              eventId: event_id,
              sideEffects: [
                'search_index:queued',
                ...(resolvedAssignments.length > 0 ? ['review_assignments:completed'] : []),
              ],
            }),
          };
        });
      },
    },
    {
      name: 'context_signal_reject',
      tier: 'core',
      description: 'Reject an unconfirmed signal while preserving its evidence for audit. Rejected signals are excluded from briefing_get and normal memory search.',
      inputSchema: contextSignalReject,
      handler: async (input: z.infer<typeof contextSignalReject>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_signal_reject',
          key: input.idempotency_key,
          request: input,
        }, async () => {
          const before = await contextRepo.getContextEntry(db, actor.tenant_id, input.id);
          if (!before) throw notFound('Signal', input.id);
          await assertSubjectAccess(db, actor, before.subject_type as SubjectType, before.subject_id);
          const actorRecordId = await ensureActorRecordForContext(db, actor);
          const entry = await contextRepo.rejectSignal(db, actor.tenant_id, input.id, actorRecordId, input.reason);
          if (!entry) throw notFound('Signal', input.id);
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id,
            eventType: 'context.signal_rejected',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'context_entry',
            objectId: entry.id,
            afterData: entry,
          });
          return {
            context_entry: entry,
            event_id,
            mutation: mutationReceipt(actor, {
              objectType: 'context_entry',
              objectId: entry.id,
              eventId: event_id,
            }),
          };
        });
      },
    },
    {
      name: 'context_signal_group_list',
      tier: 'core',
      description: 'Specific Signal-group listing tool for evidence-backed inferred claims created from one or more source Signals. Prefer context_find mode="signals" for ordinary Signal review queues. Use this when you need status filters or cursor-level Signal group listing controls.',
      inputSchema: z.object({
        status: z.enum(['gathering', 'ready', 'promoted', 'blocked', 'dismissed', 'conflicting', 'merged']).optional(),
        subject_type: z.enum(['contact', 'account', 'opportunity', 'use_case']).optional(),
        subject_id: z.string().uuid().optional(),
        context_type: z.string().optional(),
        q: z.string().max(200).optional().describe('Search Signal claim, title, context type, or linked record name before applying cursor limits'),
        attention_only: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
      handler: async (input: {
        status?: signalGroupRepo.SignalGroupStatus;
        subject_type?: string;
        subject_id?: string;
        context_type?: string;
        q?: string;
        attention_only: boolean;
        limit: number;
        cursor?: string;
      }, actor: ActorContext) => {
        if (input.subject_type && input.subject_id) {
          await assertSubjectAccess(db, actor, input.subject_type as SubjectType, input.subject_id);
        }
        const ownerIds = await visibleOwnerIds(db, actor);
        const result = await signalGroupRepo.listSignalGroups(db, actor.tenant_id, { ...input, query: input.q, owner_ids: ownerIds });
        const data = result.data.map(group => withSignalReadiness(group));
        return { signal_groups: data, data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'context_signal_group_get',
      tier: 'core',
      description: 'Get one corroborated Signal with its supporting and conflicting evidence, aggregate confidence, source count, and promotion status.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const group = await signalGroupRepo.getSignalGroup(db, actor.tenant_id, input.id);
        if (!group) throw notFound('Signal', input.id);
        await assertSubjectAccess(db, actor, group.subject_type as SubjectType, group.subject_id);
        return { signal_group: withSignalReadiness(group) };
      },
    },
    {
      name: 'context_lineage_get',
      tier: 'core',
      description: 'Read the lineage behind Sources, Signals, Memory, Handoffs, writebacks, and audit events for a customer record or context artifact.',
      inputSchema: contextLineageGet,
      handler: async (input: z.infer<typeof contextLineageGet>, actor: ActorContext) => {
        await assertLineageAccess(db, actor, input);
        return {
          lineage: await getContextLineage(db, actor.tenant_id, input),
        };
      },
    },
    {
      name: 'context_signal_group_promote',
      tier: 'core',
      description: 'Promote a corroborated Signal into confirmed Memory. This promotes the best supporting Signal, preserves combined evidence, and retires duplicate supporting Signals.',
      inputSchema: z.object({ id: z.string().uuid(), idempotency_key: z.string().max(128).optional() }),
      handler: async (input: { id: string; idempotency_key?: string }, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_signal_group_promote',
          key: input.idempotency_key,
          request: input,
        }, async () => {
          const group = await signalGroupRepo.getSignalGroup(db, actor.tenant_id, input.id);
          if (!group) throw notFound('Signal', input.id);
          await assertSubjectAccess(db, actor, group.subject_type as SubjectType, group.subject_id);
          const actorRecordId = await ensureActorRecordForContext(db, actor);
          const result = await promoteSignalGroup(db, actor.tenant_id, input.id, actorRecordId, actor);
          if (!result.context_entry) {
            throw validationError('This Signal could not be promoted. Confirm it has supporting current Signals and no unresolved conflict.');
          }
          return {
            ...result,
            signal_group: withSignalReadiness(result.signal_group),
            mutation: mutationReceipt(actor, {
              objectType: 'context_entry',
              objectId: result.context_entry.id,
              sideEffects: ['signal_group:promoted', 'search_index:queued'],
            }),
          };
        });
      },
    },
    {
      name: 'context_signal_group_complete_details',
      tier: 'core',
      description: 'Add missing typed Signal details so readiness can be recomputed before confirmation. This updates only the unconfirmed Signal structured_data; it does not edit CRM records, promote Memory, or execute writebacks.',
      inputSchema: contextSignalGroupCompleteDetails,
      handler: async (input: z.infer<typeof contextSignalGroupCompleteDetails>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_signal_group_complete_details',
          key: input.idempotency_key,
          request: input,
        }, async () => {
          const group = await signalGroupRepo.getSignalGroup(db, actor.tenant_id, input.id);
          if (!group) throw notFound('Signal', input.id);
          await assertSubjectAccess(db, actor, group.subject_type as SubjectType, group.subject_id);
          const result = await completeSignalGroupDetails(db, actor.tenant_id, input.id, actor, input.structured_data_patch);
          return {
            ...result,
            signal_group: withSignalReadiness(result.signal_group),
            mutation: mutationReceipt(actor, {
              objectType: 'signal_group',
              objectId: result.signal_group.id,
              eventId: result.event_id,
              sideEffects: ['signal_group:details_completed', 'search_index:queued'],
            }),
          };
        });
      },
    },
    {
      name: 'context_signal_handoff',
      tier: 'core',
      description: 'Send a Signal to Handoff for a named reviewer when evidence is conflicting, policy-blocked, or not ready to become confirmed Memory.',
      inputSchema: contextSignalGroupHandoff,
      handler: async (input: z.infer<typeof contextSignalGroupHandoff>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_signal_handoff',
          key: input.idempotency_key,
          request: input,
        }, async () => {
          const group = await signalGroupRepo.getSignalGroup(db, actor.tenant_id, input.id);
          if (!group) throw notFound('Signal', input.id);
          await assertSubjectAccess(db, actor, group.subject_type as SubjectType, group.subject_id);
          const actorRecordId = await ensureActorRecordForContext(db, actor);
          const result = await createSignalGroupHandoff(db, actor.tenant_id, input.id, actorRecordId, actor, {
            assigneeActorId: input.assignee_actor_id,
            reason: input.reason,
            note: input.note,
            priority: input.priority,
          });
          return {
            ...result,
            signal_group: withSignalReadiness(result.signal_group),
            mutation: mutationReceipt(actor, {
              objectType: 'hitl_request',
              objectId: (result.hitl_request as { id: string }).id,
              sideEffects: ['signal:handoff_requested'],
            }),
          };
        });
      },
    },
    {
      name: 'context_signal_group_reject',
      tier: 'core',
      description: 'Dismiss a corroborated Signal and reject its unconfirmed supporting Signals while preserving evidence for audit.',
      inputSchema: z.object({
        id: z.string().uuid(),
        reason: z.string().max(1000).optional(),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input: { id: string; reason?: string; idempotency_key?: string }, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_signal_group_reject',
          key: input.idempotency_key,
          request: input,
        }, async () => {
          const existingGroup = await signalGroupRepo.getSignalGroup(db, actor.tenant_id, input.id);
          if (!existingGroup) throw notFound('Signal', input.id);
          await assertSubjectAccess(db, actor, existingGroup.subject_type as SubjectType, existingGroup.subject_id);
          const actorRecordId = await ensureActorRecordForContext(db, actor);
          const group = await dismissSignalGroup(db, actor.tenant_id, input.id, actorRecordId, input.reason);
          if (!group) throw notFound('Signal', input.id);
          return {
            signal_group: withSignalReadiness(group),
            mutation: mutationReceipt(actor, {
              objectType: 'context_entry',
              objectId: input.id,
              sideEffects: ['signal_group:dismissed'],
            }),
          };
        });
      },
    },
    {
      name: 'context_supersede',
      tier: 'core',
      description: 'Replace an existing context entry with updated information — use this instead of context_add when you have new information that contradicts or updates an existing belief. Marks the old entry as not current (preserving the full audit trail) and creates a new entry that references it. Find the entry to supersede with context_list or context_search first, then pass its ID along with the updated body and confidence. This is the correct way to update beliefs — never create a duplicate entry with context_add when you mean to revise.',
      inputSchema: contextEntrySupersede,
      handler: async (input: z.infer<typeof contextEntrySupersede>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_supersede',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        const existing = await contextRepo.getContextEntry(db, actor.tenant_id, input.id);
        if (!existing) throw notFound('ContextEntry', input.id);
        await assertSubjectAccess(db, actor, existing.subject_type as SubjectType, existing.subject_id);

        const actorRecordId = await ensureActorRecordForContext(db, actor);
        const result = await contextRepo.supersedeContextEntry(
          db,
          actor.tenant_id,
          input.id,
          {
            body: input.body,
            title: input.title,
            structured_data: input.structured_data as Record<string, unknown> | undefined,
            confidence: input.confidence ?? undefined,
            tags: input.tags,
            authored_by: actorRecordId,
          },
        );

        await ensureEmbeddingBestEffort(db, actor.tenant_id, 'context_entry', result.new.id, result.new.body);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'context.superseded',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'context_entry',
          objectId: result.new.id,
          beforeData: { superseded_id: input.id },
          afterData: result.new,
        });

        // Enqueue replacement entry for search re-indexing — fire-and-forget.
        outboxRepo.insertJob(db, actor.tenant_id, 'context_entry', result.new.id, result.new as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[outbox] context_supersede enqueue ${result.new.id}: ${(err as Error).message}`));
        const resolvedAssignments = await completeOpenReviewAssignmentsForContextEntry(db, actor.tenant_id, result.old.id, {
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          reason: 'context_superseded',
        });

        return {
          context_entry: result.new,
          superseded: result.old,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'context_entry',
            objectId: result.new.id,
            eventId: event_id,
            sideEffects: [
              'embedding:queued',
              'search_index:queued',
              ...(resolvedAssignments.length > 0 ? ['review_assignments:completed'] : []),
            ],
          }),
        };
        });
      },
    },
    {
      name: 'context_search',
      tier: 'core',
      description: 'Specific/advanced full-text search across context entries using PostgreSQL GIN index. Prefer context_find mode="search" for ordinary search. Use this lower-level tool when you need direct full-text search parameters, tag filtering, or typed structured_data_filter searches across multiple subjects.',
      inputSchema: contextSearch,
      handler: async (input: z.infer<typeof contextSearch>, actor: ActorContext) => {
        if (input.subject_type && input.subject_id) {
          await assertSubjectAccess(db, actor, input.subject_type as SubjectType, input.subject_id);
        }
        const ownerIds = await visibleOwnerIds(db, actor);
        const entries = await contextRepo.fullTextSearch(db, actor.tenant_id, input.query, {
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          context_type: input.context_type,
          tag: input.tag,
          current_only: input.current_only,
          memory_status: input.memory_status,
          limit: input.limit,
          structured_data_filter: input.structured_data_filter as Record<string, unknown> | undefined,
          owner_ids: ownerIds,
        });
        return { context_entries: entries, total: entries.length };
      },
    },
    {
      name: 'context_review',
      tier: 'admin',
      description: 'Mark Memory as reviewed and still accurate. Resets reviewed_at to now and optionally extends valid_until by extend_days days (default: the context type freshness window). Use this after verifying Memory is still correct — it returns the entry to Current Memory and prevents the review system from re-queuing it immediately.',
      inputSchema: contextReview,
      handler: async (input: z.infer<typeof contextReview>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_review',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        const existing = await contextRepo.getContextEntry(db, actor.tenant_id, input.id);
        if (!existing) throw notFound('ContextEntry', input.id);
        await assertSubjectAccess(db, actor, existing.subject_type as SubjectType, existing.subject_id);
        // Determine extend_days: use provided value, then the governed type freshness window.
        let extendDays = input.extend_days;
        if (!extendDays) {
          const trustSettings = await contextTypeRepo.getTypeTrustSettings(db, actor.tenant_id, existing.context_type);
          extendDays = trustSettings?.default_freshness_days ?? memoryFreshnessWindowDays(existing.context_type);
        }
        const entry = await contextRepo.reviewContextEntry(db, actor.tenant_id, input.id, extendDays);
        if (!entry) throw notFound('ContextEntry', input.id);
        const resolvedAssignments = await completeOpenReviewAssignmentsForContextEntry(db, actor.tenant_id, entry.id, {
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          reason: 'context_reviewed',
        });
        return {
          context_entry: entry,
          mutation: mutationReceipt(actor, {
            objectType: 'context_entry',
            objectId: entry.id,
            sideEffects: resolvedAssignments.length > 0 ? ['review_assignments:completed'] : [],
          }),
        };
        });
      },
    },
    {
      name: 'context_stale',
      tier: 'core',
      description: 'Specific Memory Health tool for Current Memory whose valid_until has passed. Prefer context_find mode="stale" for ordinary stale-memory retrieval. Use this lower-level tool for recurring Memory Health checks or direct stale-entry review workflows.',
      inputSchema: contextStaleList,
      handler: async (input: z.infer<typeof contextStaleList>, actor: ActorContext) => {
        if (input.subject_type && input.subject_id) {
          await assertSubjectAccess(db, actor, input.subject_type as SubjectType, input.subject_id);
        }
        const ownerIds = await visibleOwnerIds(db, actor);
        const entries = await contextRepo.listStaleEntries(db, actor.tenant_id, {
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          owner_ids: ownerIds,
          limit: input.limit,
        });
        return { stale_entries: entries, total: entries.length };
      },
    },
    {
      name: 'context_extract',
      tier: 'admin',
      description: 'Re-run the automatic context extraction pipeline on a specific activity. Useful for backfilling entries on older activities or retrying after an error. Returns the number of context entries created.',
      inputSchema: z.object({
        activity_id: z.string().uuid().describe('ID of the activity to extract context from'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input: { activity_id: string; idempotency_key?: string }, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_extract',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        await assertActivityAccess(db, actor, input.activity_id);
        const outcome = await extractContextFromActivity(db, actor.tenant_id, input.activity_id);
        return {
          ...outcome,
          mutation: mutationReceipt(actor, {
            objectType: 'activity',
            objectId: input.activity_id,
            sideEffects: ['context_extraction:completed'],
          }),
        };
        });
      },
    },
    {
      name: 'briefing_get',
      tier: 'core',
      description: 'Get a unified briefing for any customer record — the single most important tool in CRMy. Call this before every agent action that needs current state. It assembles the full record, related entities, recent activity timeline, open assignments, Current Memory, Signals, Memory that needs review, and contradiction warnings in one response. Set context_radius to "direct" for single-contact outreach, "adjacent" to include related accounts and opportunities, or "account_wide" for deal reviews that need the full picture. Set token_budget or token_budget_profile to tell CRMy how much space you have; it ranks by confidence, freshness, evidence, and type priority, then packs the highest-value context first. Use evidence_mode="summary" by default, "none" for cheap scanning, and "full" only when the agent needs proof inline. Check staleness_warnings before acting; they identify Memory past its valid_until date that should be reverified. Works on contacts, accounts, opportunities, and use_cases.',
      inputSchema: briefingGet,
      handler: async (input: z.infer<typeof briefingGet>, actor: ActorContext) => {
        await assertSubjectAccess(db, actor, input.subject_type as SubjectType, input.subject_id);
        const briefing = await assembleBriefing(
          db,
          actor.tenant_id,
          input.subject_type as SubjectType,
          input.subject_id,
          {
            since: input.since,
            context_types: input.context_types,
            include_stale: input.include_stale,
            context_radius: input.context_radius,
            token_budget: input.token_budget,
            token_budget_profile: input.token_budget_profile,
            evidence_mode: input.evidence_mode,
            include_knowledge: input.include_knowledge,
            actor_id: actor.actor_id,
          },
        );

        if (input.format === 'text') {
          return { briefing_text: formatBriefingText(briefing) };
        }
        return { briefing };
      },
    },
    {
      name: 'context_diff',
      tier: 'core',
      description: 'Get a bounded catch-up diff for a CRM subject showing what changed since a given timestamp. Returns capped lists for new context entries, superseded entries, newly stale entries, and recently reviewed entries, plus truncation flags. Ideal for daily agent check-ins or resuming work after a gap — call this instead of a full briefing when you already have baseline context and just need the delta.',
      inputSchema: contextDiff,
      handler: async (input: z.infer<typeof contextDiff>, actor: ActorContext) => {
        await assertSubjectAccess(db, actor, input.subject_type as SubjectType, input.subject_id);
        const since = normalizeSinceTimestamp(input.since);
        const diff = await contextRepo.diffContextEntries(
          db, actor.tenant_id,
          input.subject_type as SubjectType,
          input.subject_id,
          since,
          input.limit,
        );
        return {
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          since,
          ...diff,
          summary: {
            new: diff.new_entries.length,
            superseded: diff.superseded_entries.length,
            newly_stale: diff.newly_stale.length,
            resolved: diff.resolved_entries.length,
            truncated: diff.truncated,
          },
        };
      },
    },
    {
      name: 'context_ingest',
      tier: 'core',
      description: 'Ingest a Source (transcript, email, meeting notes, etc.) and auto-extract structured Signals from it. Creates an activity as provenance, records a Source processing receipt, and runs the extraction pipeline. Signals are evidence-backed but unconfirmed until promoted to Memory.',
      inputSchema: contextIngest,
      handler: async (input: z.infer<typeof contextIngest>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_ingest',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        await assertSubjectAccess(db, actor, input.subject_type, input.subject_id);
        // Enforce body length limit
        const maxChars = await governorLimits.getLimit(db, actor.tenant_id, 'context_body_max_chars');
        if (input.document.length > maxChars * 2) {
          // Allow up to 2× the per-entry limit for ingest documents
          throw validationError(`Document exceeds maximum ingest length (${input.document.length} chars)`);
        }

        const actorRecordId = await ensureActorRecordForContext(db, actor);

        // Create an activity as provenance for the ingested content
        const activity = await activityRepo.createActivity(db, actor.tenant_id, {
          type: 'note',
          subject: input.source_label ?? 'Ingested document',
          body: input.document,
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          performed_by: actorRecordId,
          source_agent: 'context_ingest',
          occurred_at: new Date().toISOString(),
        });

        // Run the extraction pipeline
        const outcome = await extractContextFromActivity(db, actor.tenant_id, activity.id);

        // Fetch the entries produced by this activity
        const signals = await contextRepo.getContextForSubject(
          db, actor.tenant_id, input.subject_type, input.subject_id,
          { source_activity_id: activity.id, current_only: true, memory_status: 'signal', limit: 50 },
        );
        const memoryEntries = await contextRepo.getContextForSubject(
          db, actor.tenant_id, input.subject_type, input.subject_id,
          { source_activity_id: activity.id, current_only: true, memory_status: 'active', limit: 50 },
        );
        const rawSource = await rawContextRepo.getRawContextSourceByRef(
          db,
          actor.tenant_id,
          'add_context',
          activity.id,
        ) ?? await rawContextRepo.getRawContextSourceByRef(
          db,
          actor.tenant_id,
          'activity',
          activity.id,
        );
        const receipt = processingReceipt(rawSource, outcome);

        return {
          ...outcome,
          signals,
          memory_entries: memoryEntries,
          context_entries: [...memoryEntries, ...signals],
          activity_id: activity.id,
          source: rawSource ?? undefined,
          processing_receipt: receipt,
          mutation: mutationReceipt(actor, {
            objectType: 'activity',
            objectId: activity.id,
            sideEffects: ['context_extraction:completed'],
          }),
        };
        });
      },
    },
    {
      name: 'context_ingest_auto',
      tier: 'core',
      description: 'Ingest a document (transcript, email, meeting notes, etc.) and automatically resolve which contacts and accounts are mentioned. Requires the configured Workspace Agent: the model identifies likely customer people/companies and useful hints, then CRMy grounds those candidates against actual contacts/accounts using entity resolution before extraction. Runs the full Sources -> Signals -> Memory pipeline for every resolved subject above the confidence threshold. Returns resolved subjects, entries created, and any names that could not be resolved. Ideal for agents processing inbound content when they do not know which customer records are involved.',
      inputSchema: z.object({
        document: z.string().min(1).describe('The full text to ingest — transcript, email body, meeting notes, research, etc.'),
        source_label: z.string().optional().describe('Human-readable label for the source (e.g. "Discovery call 2026-04-09")'),
        source_occurred_at: z.string().optional().describe('When this context event actually occurred, if known. Re-sending the same source with the same occurrence time will not count as independent corroboration.'),
        context_type: z.string().optional().describe('Override the context type for all extracted entries (e.g. "meeting_notes")'),
        confidence_threshold: z.number().min(0).max(1).default(0.6)
          .describe('Minimum entity resolution confidence to link an entry. 0.6 = medium+high (default). Set lower to include more speculative matches.'),
        subjects: z.array(z.object({
          type: z.enum(['contact', 'account', 'opportunity', 'use_case']),
          id: z.string().uuid(),
          name: z.string().optional(),
        })).max(20).optional().describe('Optional already-resolved customer records. When provided, CRMy skips subject detection and extracts once across this matched subject set.'),
        proposed_records: z.array(z.object({
          record_type: z.enum(['contact', 'account', 'opportunity', 'use_case']),
          name: z.string(),
          confidence: z.number().min(0).max(1).default(0.5),
          reason: z.string().optional().default('Extracted from Source.'),
          fields: z.record(z.string(), z.unknown()).default({}),
          duplicate_candidates: z.array(z.object({
            record_type: z.string(),
            id: z.string(),
            name: z.string(),
            confidence: z.string().optional(),
            reason: z.string().optional(),
          })).optional(),
        })).max(20).optional().describe('Optional proposed net-new records from prior subject detection. CRMy routes these to Handoffs instead of auto-creating them.'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (
        input: {
          document: string;
          source_label?: string;
          source_occurred_at?: string;
          context_type?: string;
          confidence_threshold: number;
          subjects?: Array<{ type: 'contact' | 'account' | 'opportunity' | 'use_case'; id: string; name?: string }>;
          proposed_records?: RawContextRecordProposal[];
          idempotency_key?: string;
        },
        actor: ActorContext,
      ) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_ingest_auto',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        const actorRecordId = await ensureActorRecordForContext(db, actor);
        const sourceOccurredAt = normalizeOptionalTimestamp(input.source_occurred_at);
        const sourceType = actor.actor_type === 'agent' ? 'mcp' : 'add_context';
        const sourceFingerprint = {
          document_hash: createHash('sha256').update(input.document).digest('hex'),
          actor_id: actor.actor_id,
          actor_type: actor.actor_type,
          source_type: sourceType,
          source_occurred_at: sourceOccurredAt,
          subjects: (input.subjects ?? [])
            .map(subject => `${subject.type}:${subject.id}`)
            .sort(),
        };
        const sourceRef = `auto:${createHash('sha256').update(JSON.stringify(sourceFingerprint)).digest('hex').slice(0, 32)}`;
        const existingSource = await rawContextRepo.getRawContextSourceByRef(db, actor.tenant_id, sourceType, sourceRef);
        if (existingSource && ['processed', 'needs_review'].includes(existingSource.status)) {
          const detected = Array.isArray(existingSource.detected_subjects)
            ? existingSource.detected_subjects as Array<Record<string, unknown>>
            : [];
          return {
            subjects_resolved: detected
              .filter(item => item.subject_id && item.subject_type)
              .map(item => ({
                entity_type: String(item.subject_type),
                id: String(item.subject_id),
                name: typeof item.name === 'string' ? item.name : String(item.subject_id),
                confidence: typeof item.confidence === 'string' ? item.confidence : 'high',
                entries_created: Number(item.entries_created ?? 0),
                memory_created: Number(item.memory_created ?? 0),
                signals_created: Number(item.signals_created ?? 0),
              })),
            entries_created: Number(existingSource.memory_created ?? 0) + Number(existingSource.signals_created ?? 0),
            extracted_count: Number(existingSource.memory_created ?? 0) + Number(existingSource.signals_created ?? 0),
            memory_created: Number(existingSource.memory_created ?? 0),
            signals_created: Number(existingSource.signals_created ?? 0),
            skipped: Number(existingSource.skipped ?? 0),
            source: existingSource,
            message: 'This Source was already processed. Returning the existing receipt instead of extracting it again.',
            duplicate_of_source_id: existingSource.id,
            mutation: mutationReceipt(actor, {
              objectType: 'raw_context_source',
              objectId: existingSource.id,
              sideEffects: ['context_extraction:deduped'],
            }),
          };
        }
        await rawContextRepo.upsertRawContextSource(db, actor.tenant_id, {
          source_type: sourceType,
          source_ref: sourceRef,
          source_label: input.source_label ?? 'Auto-ingested Source',
          actor_id: actorRecordId,
          status: 'processing',
          stage: 'resolve_subjects',
          raw_excerpt: input.document.slice(0, 1000),
          metadata: {
            input_channel: actor.actor_type === 'agent' ? 'mcp' : 'api',
            confidence_threshold: input.confidence_threshold,
            source_occurred_at: sourceOccurredAt,
            source_fingerprint: sourceFingerprint,
          },
        });
        const persistedSource = await rawContextRepo.getRawContextSourceByRef(db, actor.tenant_id, sourceType, sourceRef);
        if (persistedSource) {
          await rawContextPayloadRepo.upsertRawContextSourcePayload(db, actor.tenant_id, {
            raw_context_source_id: persistedSource.id,
            document_hash: sourceFingerprint.document_hash,
            document_text: input.document,
            source_label: input.source_label ?? null,
            source_occurred_at: sourceOccurredAt,
            subjects: input.subjects?.map(subject => ({
              subject_type: subject.type,
              subject_id: subject.id,
              name: subject.name,
            })) ?? [],
            proposed_records: input.proposed_records as unknown as Array<Record<string, unknown>> | undefined,
            metadata: {
              input_channel: actor.actor_type === 'agent' ? 'mcp' : 'api',
              source_ref: sourceRef,
            },
          });
        }

        let resolvedSubjects: Array<{
          entity_type: string;
          id: string;
          name: string;
          confidence: string;
          account_id?: string;
          account_name?: string;
          scope_reason?: string;
          parent_subject?: { type: string; id: string; name: string };
        }>;
        let skipped: string[];
        let detectedCandidates: string[];
        let detectedSkipped: Array<{ name: string; reason: string }>;
        let proposedRecords: RawContextRecordProposal[];
        let accountScope: Awaited<ReturnType<typeof resolveSubjectGraph>>['account_scope'] = [];
        let recordsExamined: Awaited<ReturnType<typeof resolveSubjectGraph>>['records_examined'];
        let resolutionSummary: string | undefined;
        const scopedOwnerIds = await visibleOwnerIds(db, actor);
        if (input.subjects?.length) {
          for (const subject of input.subjects) {
            await assertSubjectAccess(db, actor, subject.type, subject.id);
          }
          resolvedSubjects = input.subjects.map(subject => ({
            entity_type: subject.type,
            id: subject.id,
            name: subject.name ?? subject.id,
            confidence: 'high',
          }));
          skipped = [];
          detectedCandidates = resolvedSubjects.map(subject => subject.name);
          detectedSkipped = [];
          proposedRecords = input.proposed_records ?? [];
          resolutionSummary = `Using ${resolvedSubjects.length} selected customer ${resolvedSubjects.length === 1 ? 'record' : 'records'}.`;
        } else if (input.proposed_records?.length) {
          resolvedSubjects = [];
          skipped = [];
          detectedCandidates = input.proposed_records.map(proposal => proposal.name);
          detectedSkipped = [];
          proposedRecords = input.proposed_records;
          resolutionSummary = `${proposedRecords.length} possible new ${proposedRecords.length === 1 ? 'record needs' : 'records need'} review.`;
        } else {
          const detected = await resolveSubjectGraph(db, actor, {
            text: input.document,
            limit: 20,
            confidence_threshold: input.confidence_threshold,
          });
          resolvedSubjects = detected.subjects.map(subject => ({
            entity_type: subject.type,
            id: subject.id,
            name: subject.name,
            confidence: subject.confidence,
            account_id: subject.account_id,
            account_name: subject.account_name,
            scope_reason: subject.scope_reason,
            parent_subject: subject.parent_subject,
          }));
          skipped = detected.skipped.map(item => item.name);
          detectedCandidates = detected.candidates;
          detectedSkipped = detected.skipped;
          proposedRecords = mergeRecordProposals(detected.proposed_records, input.proposed_records);
          accountScope = detected.account_scope ?? [];
          recordsExamined = detected.records_examined;
          resolutionSummary = detected.resolution_summary;
        }

        if (resolvedSubjects.length === 0) {
          const currentSource = await rawContextRepo.getRawContextSourceByRef(
            db,
            actor.tenant_id,
            sourceType,
            sourceRef,
          );
          const proposalHandoffs = proposedRecords.length > 0
            ? await createRecordProposalHandoffs(db, actor, {
              actorRecordId,
              sourceRef,
              rawContextSourceId: currentSource?.id,
              rawExcerpt: input.document,
              proposals: proposedRecords,
            })
            : [];
          await rawContextRepo.updateRawContextSource(
            db,
            actor.tenant_id,
            sourceType,
            sourceRef,
            {
              status: proposalHandoffs.length > 0 ? 'needs_review' : 'skipped',
              stage: 'resolve_subjects',
              skipped: proposalHandoffs.length > 0 ? 0 : 1,
              detected_subjects: [
                ...detectedCandidates.map(name => ({ name, status: skipped.includes(name) ? 'unresolved' : 'candidate' })),
                ...detectedSkipped.map(item => ({ name: item.name, status: 'skipped', reason: item.reason })),
                ...proposedRecords.map(proposal => ({
                  name: proposal.name,
                  status: proposalHandoffs.some(handoff => handoff.proposal.name === proposal.name) ? 'proposed_record_review' : 'proposed_record',
                  record_type: proposal.record_type,
                  confidence: proposal.confidence,
                  reason: proposal.reason,
                })),
              ],
              failure_reason: proposalHandoffs.length > 0
                ? `${proposalHandoffs.length} possible new ${proposalHandoffs.length === 1 ? 'record needs' : 'records need'} review before CRMy creates anything.`
                : 'No customer records could be confidently identified in the source.',
              failure_code: proposalHandoffs.length > 0 ? 'needs_record_review' : 'no_customer_specific_context',
              metadata: proposalHandoffs.length > 0 ? {
                proposed_records: proposedRecords,
                handoff_request_ids: proposalHandoffs.map(item => item.request_id),
                failure_code: 'needs_record_review',
              } : {
                proposed_records: proposedRecords,
                failure_code: 'no_customer_specific_context',
              },
            },
          );
          const updatedSource = await rawContextRepo.getRawContextSourceByRef(
            db,
            actor.tenant_id,
            sourceType,
            sourceRef,
          );
          return {
            subjects_resolved: [],
            entries_created: 0,
            extracted_count: 0,
            memory_created: 0,
            signals_created: 0,
            skipped: proposalHandoffs.length > 0 ? 0 : 1,
            source: updatedSource ?? undefined,
            low_confidence_skipped: skipped,
            proposed_records: proposedRecords,
            handoff_requests: proposalHandoffs,
            account_scope: accountScope,
            records_examined: recordsExamined,
            resolution_summary: resolutionSummary,
            message: proposalHandoffs.length > 0
              ? `${proposalHandoffs.length} possible new ${proposalHandoffs.length === 1 ? 'record was' : 'records were'} sent to Handoffs for review.`
              : 'No customer records could be confidently identified in the document. Try adding contacts/accounts with matching names or aliases, or lower confidence_threshold.',
          };
        }

        // Step 3: run one extraction pass for the whole source. The model may
        // assign each Signal to one of the matched subjects, but CRMy only
        // accepts IDs from the resolved subject list.
        let totalCreated = 0;
        let memoryCreated = 0;
        let signalsCreated = 0;
        let skippedCount = 0;
        const subjectResults: {
          entity_type: string;
          id: string;
          name: string;
          confidence: string;
          account_id?: string;
          account_name?: string;
          scope_reason?: string;
          parent_subject?: { type: string; id: string; name: string };
          entries_created: number;
          memory_created: number;
          signals_created: number;
          skipped: number;
          activity_id: string;
          source_id?: string;
          processing_receipt?: ReturnType<typeof processingReceipt>;
          failure_reason?: string;
          skipped_reasons?: string[];
        }[] = [];

        const primarySubject = resolvedSubjects.find(subject => subject.entity_type === 'account') ?? resolvedSubjects[0];
        let activityId = '';
        let rawSource = null as rawContextRepo.RawContextSource | null;
        let extractionFailure: string | undefined;
        try {
          const activity = await activityRepo.createActivity(db, actor.tenant_id, {
            type: 'note',
            subject: input.source_label ?? 'Auto-ingested document',
            body: input.document,
            subject_type: primarySubject.entity_type as SubjectType,
            subject_id: primarySubject.id,
            performed_by: actorRecordId,
            source_agent: 'context_ingest_auto',
            occurred_at: sourceOccurredAt ?? new Date().toISOString(),
            detail: {
              raw_context_source_ref: sourceRef,
              source_document_hash: sourceFingerprint.document_hash,
              source_occurred_at: sourceOccurredAt,
              source_occurred_at_provided: Boolean(sourceOccurredAt),
            },
          });
          activityId = activity.id;
          const extracted = await extractContextFromActivity(db, actor.tenant_id, activity.id, {
            targetSubjects: resolvedSubjects.map(subject => ({
              type: subject.entity_type,
              id: subject.id,
              name: subject.name,
            })),
            ownerIds: scopedOwnerIds,
          });
          proposedRecords = mergeRecordProposals(proposedRecords, extracted.proposed_records);
          rawSource = await rawContextRepo.getRawContextSourceByRef(
            db,
            actor.tenant_id,
            'add_context',
            activity.id,
          ) ?? await rawContextRepo.getRawContextSourceByRef(
            db,
            actor.tenant_id,
            'activity',
            activity.id,
          );
          const allProducedEntries = await db.query(
            `SELECT subject_type, subject_id, memory_status, count(*)::int AS count
             FROM context_entries
             WHERE tenant_id = $1 AND source_activity_id = $2
             GROUP BY subject_type, subject_id, memory_status`,
            [actor.tenant_id, activity.id],
          );
          totalCreated += extracted.extracted_count;
          memoryCreated += extracted.memory_created;
          signalsCreated += extracted.signals_created;
          skippedCount += extracted.skipped;
          const counts = new Map<string, { active: number; signal: number }>();
          for (const row of allProducedEntries.rows as { subject_type: string; subject_id: string; memory_status: string; count: number }[]) {
            const key = `${row.subject_type}:${row.subject_id}`;
            const current = counts.get(key) ?? { active: 0, signal: 0 };
            if (row.memory_status === 'active') current.active += Number(row.count ?? 0);
            if (row.memory_status === 'signal') current.signal += Number(row.count ?? 0);
            counts.set(key, current);
          }
          const receipt = processingReceipt(rawSource, extracted);
          for (const subject of resolvedSubjects) {
            const count = counts.get(`${subject.entity_type}:${subject.id}`) ?? { active: 0, signal: 0 };
            subjectResults.push({
              ...subject,
              entries_created: count.active + count.signal,
              memory_created: count.active,
              signals_created: count.signal,
              skipped: count.active + count.signal > 0 ? 0 : 1,
              activity_id: activity.id,
              source_id: rawSource?.id,
              processing_receipt: receipt,
              failure_reason: rawSource?.failure_reason,
              skipped_reasons: Array.isArray(rawSource?.metadata?.skipped_reasons)
                ? rawSource.metadata.skipped_reasons.map(String)
                : undefined,
            });
          }
        } catch (err) {
          extractionFailure = err instanceof Error ? err.message : 'Extraction failed for this source.';
          console.error('[context_ingest_auto] Failed multi-subject extraction:', err);
          skippedCount += resolvedSubjects.length;
          for (const subject of resolvedSubjects) {
            subjectResults.push({
              ...subject,
              entries_created: 0,
              memory_created: 0,
              signals_created: 0,
              skipped: 1,
              activity_id: activityId,
              failure_reason: extractionFailure,
            });
          }
        }

        const noExtractionReasons = subjectResults
          .flatMap(subject => [
            subject.failure_reason,
            ...(subject.skipped_reasons ?? []),
          ])
          .filter((reason): reason is string => Boolean(reason?.trim()));
        const proposalHandoffs = proposedRecords.length > 0
          ? await createRecordProposalHandoffs(db, actor, {
            actorRecordId,
            sourceRef,
            rawContextSourceId: rawSource?.id,
            rawExcerpt: input.document,
            proposals: proposedRecords,
          })
          : [];
        const parentStatus = signalsCreated > 0 || proposalHandoffs.length > 0
          ? 'needs_review'
          : totalCreated > 0
            ? 'processed'
            : skippedCount > 0
              ? 'skipped'
              : 'processed';
        const noExtractionReason = noExtractionReasons.length > 0
          ? Array.from(new Set(noExtractionReasons)).slice(0, 3).join('; ')
          : extractionFailure ?? (accountScope.length > 0
            ? 'Matched the account scope, but no existing child record produced an extractable Signal. Review any proposed records or add more specific customer context.'
            : 'Subjects were matched, but the Workspace Agent did not find customer-specific Signals to save.');

        await rawContextRepo.updateRawContextSource(
          db,
          actor.tenant_id,
          sourceType,
          sourceRef,
          {
            status: parentStatus,
            stage: 'promote_or_review',
            detected_subjects: [
              ...subjectResults.map(subject => ({
                subject_type: subject.entity_type,
                subject_id: subject.id,
                name: subject.name,
                confidence: subject.confidence,
                account_id: subject.account_id,
                account_name: subject.account_name,
                scope_reason: subject.scope_reason,
                parent_subject: subject.parent_subject,
                entries_created: subject.entries_created,
                memory_created: subject.memory_created,
                signals_created: subject.signals_created,
              })),
              ...skipped.map(name => ({ name, status: 'unresolved' })),
              ...proposedRecords.map(proposal => ({
                name: proposal.name,
                status: proposalHandoffs.some(handoff => handoff.proposal.name === proposal.name) ? 'proposed_record_review' : 'proposed_record',
                record_type: proposal.record_type,
                confidence: proposal.confidence,
                reason: proposal.reason,
              })),
            ],
            signals_created: signalsCreated,
            memory_created: memoryCreated,
            skipped: skippedCount,
            failure_reason: totalCreated === 0 && proposalHandoffs.length === 0 ? noExtractionReason : null,
            failure_code: totalCreated === 0 && proposalHandoffs.length === 0
              ? extractionFailure
                ? 'write_failed'
                : 'model_returned_empty'
              : proposalHandoffs.length > 0
                ? 'needs_record_review'
                : null,
            metadata: {
              no_extraction_reasons: noExtractionReasons.slice(0, 10),
              primary_activity_id: activityId || undefined,
              source_document_hash: sourceFingerprint.document_hash,
              source_occurred_at: sourceOccurredAt,
              account_scope: accountScope,
              records_examined: recordsExamined,
              resolution_summary: resolutionSummary,
              ...(proposedRecords.length > 0 ? { proposed_records: proposedRecords } : {}),
              ...(proposalHandoffs.length > 0 ? { handoff_request_ids: proposalHandoffs.map(item => item.request_id) } : {}),
            },
          },
        );

        return {
          subjects_resolved: subjectResults,
          entries_created: totalCreated,
          extracted_count: totalCreated,
          memory_created: memoryCreated,
          signals_created: signalsCreated,
          skipped: skippedCount,
          message: totalCreated > 0
            ? undefined
            : noExtractionReason,
          processing_receipts: subjectResults
            .map(result => result.processing_receipt)
            .filter(Boolean),
          source: await rawContextRepo.getRawContextSourceByRef(
            db,
            actor.tenant_id,
            sourceType,
            sourceRef,
          ) ?? undefined,
          proposed_records: proposedRecords.length > 0 ? proposedRecords : undefined,
          handoff_requests: proposalHandoffs.length > 0 ? proposalHandoffs : undefined,
          account_scope: accountScope,
          records_examined: recordsExamined,
          resolution_summary: resolutionSummary,
          low_confidence_skipped: skipped.length > 0 ? skipped : undefined,
          mutation: mutationReceipt(actor, {
            objectType: 'context_entry',
            objectId: subjectResults.find(result => result.activity_id)?.activity_id ?? 'multiple',
            sideEffects: ['context_extraction:completed'],
          }),
        };
        });
      },
    },
    {
      name: 'context_stale_assign',
      tier: 'admin',
      description: 'Trigger the Memory Health review loop for the current tenant: finds Current Memory past its review date and creates review assignments for the most knowledgeable actors. Normally runs automatically in the background every 60 seconds. Use this to trigger it on-demand.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(20)
          .describe('Maximum number of stale entries to process in this call'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input: { limit: number; idempotency_key?: string }, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_stale_assign',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        const assignments_created = await processStaleEntriesForTenant(
          db, actor.tenant_id, input.limit,
        );
        return {
          assignments_created,
          mutation: mutationReceipt(actor, {
            objectType: 'assignment',
            objectId: 'stale-context-review',
            sideEffects: ['assignments:created'],
          }),
        };
        });
      },
    },
    {
      name: 'context_semantic_search',
      tier: 'extended',
      description: 'Semantic (vector) search over context entries using embedding similarity — finds entries that are conceptually related to your query even when no keywords match. Use this when context_search returns poor results for natural language queries like "budget concerns", "team friction", or "implementation challenges". Requires ENABLE_PGVECTOR=true and EMBEDDING_PROVIDER to be configured on the server. Returns entries ranked by similarity score (0.0–1.0). If embeddings are not configured, returns a structured error with fallback_available: true — retry with context_search in that case.',
      inputSchema: contextSemanticSearch,
      handler: async (input: z.infer<typeof contextSemanticSearch>, actor: ActorContext) => {
        if (input.subject_type && input.subject_id) {
          await assertSubjectAccess(db, actor, input.subject_type as SubjectType, input.subject_id);
        }
        const pgvectorResult = await db.query(`
          SELECT
            EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS extension_enabled,
            EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_name = 'context_entries'
                 AND column_name = 'embedding'
            ) AS embedding_column_ready
        `);
        const pgvectorReady = Boolean(pgvectorResult.rows[0]?.extension_enabled) && Boolean(pgvectorResult.rows[0]?.embedding_column_ready);
        if (!pgvectorReady) {
          return {
            error: 'Semantic search is not enabled on this server. Use a pgvector-capable Postgres database, set ENABLE_PGVECTOR=true, and run migrations.',
            fallback_available: true,
            fallback_tool: 'context_search',
          };
        }
        const embConfig = loadEmbeddingConfig();
        if (!embConfig) {
          return {
            error: 'Semantic search is not enabled on this server. Enable pgvector in Postgres, set ENABLE_PGVECTOR=true, and configure EMBEDDING_PROVIDER/EMBEDDING_API_KEY in the CRMy server environment.',
            fallback_available: true,
            fallback_tool: 'context_search',
          };
        }

        let queryEmbedding: number[];
        try {
          queryEmbedding = await embedText(input.query, embConfig);
        } catch (err) {
          return {
            error: `Embedding generation failed: ${(err as Error).message}. Use context_search for full-text search instead.`,
            fallback_available: true,
            fallback_tool: 'context_search',
          };
        }

        const ownerIds = await visibleOwnerIds(db, actor);
        const entries = await contextRepo.semanticSearch(db, actor.tenant_id, queryEmbedding, {
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          context_type: input.context_type,
          tag: input.tag,
          current_only: input.current_only,
          memory_status: input.memory_status,
          limit: input.limit,
          structured_data_filter: input.structured_data_filter as Record<string, unknown> | undefined,
          owner_ids: ownerIds,
        });

        return { context_entries: entries, total: entries.length, semantic_search: true };
      },
    },
    {
      name: 'context_detect_contradictions',
      tier: 'extended',
      description: 'Scan a subject\'s Current Memory for conflicting facts — e.g. two entries that claim different budget amounts, different champions, or contradictory next steps. Returns contradiction warnings with the two conflicting entries, a description of the conflict, and a suggested resolution action. Call before important decisions to ensure you\'re not acting on contradictory beliefs. Use context_resolve_contradiction to fix them.',
      inputSchema: z.object({
        subject_type: z.enum(['contact', 'account', 'opportunity', 'use_case'])
          .describe('Type of the CRM subject to check'),
        subject_id: z.string().uuid()
          .describe('ID of the subject to check'),
        context_type: z.string().optional()
          .describe('If provided, only check entries of this context type. Omit to check all eligible types.'),
      }),
      handler: async (
        input: { subject_type: SubjectType; subject_id: string; context_type?: string },
        actor: ActorContext,
      ) => {
        await assertSubjectAccess(db, actor, input.subject_type, input.subject_id);
        const warnings = await detectContradictions(
          db, actor.tenant_id, input.subject_type, input.subject_id, input.context_type,
        );
        return {
          contradiction_warnings: warnings,
          total: warnings.length,
          subject_type: input.subject_type,
          subject_id: input.subject_id,
        };
      },
    },
    {
      name: 'context_contradiction_assign',
      tier: 'extended',
      description: 'Scan a subject for contradictory Current Memory and create review assignments for unresolved conflicts. Assignments are deduplicated by the conflicting entry pair so repeated scans do not spam reviewers. Use this when briefing_get or context_detect_contradictions returns warnings that need human or agent resolution.',
      inputSchema: z.object({
        subject_type: z.enum(['contact', 'account', 'opportunity', 'use_case'])
          .describe('Type of the CRM subject to check'),
        subject_id: z.string().uuid()
          .describe('ID of the subject to check'),
        context_type: z.string().optional()
          .describe('If provided, only check entries of this context type. Omit to check all eligible types.'),
        limit: z.number().int().min(1).max(50).default(20),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (
        input: { subject_type: SubjectType; subject_id: string; context_type?: string; limit: number; idempotency_key?: string },
        actor: ActorContext,
      ) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_contradiction_assign',
          key: input.idempotency_key,
          request: input,
        }, async () => {
          await assertSubjectAccess(db, actor, input.subject_type, input.subject_id);
          const actorRecordId = await ensureActorRecordForContext(db, actor);
          const result = await createContradictionReviewAssignments(
            db,
            actor.tenant_id,
            actorRecordId,
            {
              subject_type: input.subject_type,
              subject_id: input.subject_id,
              context_type: input.context_type,
              limit: input.limit,
            },
          );

          return {
            assignments_created: result.assignments.length,
            assignments: result.assignments,
            contradiction_warnings: result.warnings,
            skipped_existing: result.skipped_existing,
            mutation: mutationReceipt(actor, {
              objectType: 'assignment',
              objectId: result.assignments[0]?.id ?? input.subject_id,
              sideEffects: result.assignments.length > 0 ? ['assignments:created'] : [],
            }),
          };
        });
      },
    },
    {
      name: 'context_resolve_contradiction',
      tier: 'extended',
      description: 'Resolve a contradiction between two context entries by superseding the incorrect one with the correct one. The kept entry is preserved as-is; the superseded entry is marked not current (full audit trail maintained). Provide a resolution_note explaining why you chose to keep one over the other. Find the entry IDs from context_detect_contradictions or briefing_get contradiction_warnings.',
      inputSchema: z.object({
        keep_entry_id: z.string().uuid()
          .describe('ID of the entry to keep as the authoritative fact'),
        supersede_entry_id: z.string().uuid()
          .describe('ID of the entry to supersede (mark as no longer current)'),
        resolution_note: z.string().min(1).max(500)
          .describe('Brief explanation of why the kept entry is correct'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (
        input: { keep_entry_id: string; supersede_entry_id: string; resolution_note: string; idempotency_key?: string },
        actor: ActorContext,
      ) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_resolve_contradiction',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        // Fetch the entry to keep so we can supersede with its content
        const keepEntry = await contextRepo.getContextEntry(db, actor.tenant_id, input.keep_entry_id);
        if (!keepEntry) return notFound('context_entry', input.keep_entry_id);
        await assertSubjectAccess(db, actor, keepEntry.subject_type as SubjectType, keepEntry.subject_id);
        const supersededEntry = await contextRepo.getContextEntry(db, actor.tenant_id, input.supersede_entry_id);
        if (!supersededEntry) return notFound('context_entry', input.supersede_entry_id);
        await assertSubjectAccess(db, actor, supersededEntry.subject_type as SubjectType, supersededEntry.subject_id);

        // Supersede the incorrect entry with the kept entry's content + resolution note
        const actorRecordId = await ensureActorRecordForContext(db, actor);
        const result = await contextRepo.supersedeContextEntry(
          db, actor.tenant_id, input.supersede_entry_id,
          {
            body: keepEntry.body,
            title: keepEntry.title,
            structured_data: {
              ...keepEntry.structured_data,
              resolved_by_entry_id: input.keep_entry_id,
              resolution_note: input.resolution_note,
            },
            confidence: keepEntry.confidence,
            tags: keepEntry.tags,
            authored_by: actorRecordId,
          },
        );
        const resolvedByKept = await completeOpenReviewAssignmentsForContextEntry(db, actor.tenant_id, keepEntry.id, {
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          reason: 'contradiction_resolved',
        });
        const resolvedBySuperseded = await completeOpenReviewAssignmentsForContextEntry(db, actor.tenant_id, result.old.id, {
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          reason: 'contradiction_resolved',
        });
        const resolvedAssignmentCount = new Set([
          ...resolvedByKept.map(assignment => assignment.id),
          ...resolvedBySuperseded.map(assignment => assignment.id),
        ]).size;

        return {
          resolved: true,
          kept_entry: keepEntry,
          superseded_entry: result.old,
          resolution_entry: result.new,
          resolution_note: input.resolution_note,
          mutation: mutationReceipt(actor, {
            objectType: 'context_entry',
            objectId: result.new.id,
            sideEffects: resolvedAssignmentCount > 0 ? ['review_assignments:completed'] : [],
          }),
        };
        });
      },
    },
    {
      name: 'context_consolidate',
      tier: 'extended',
      description: 'Synthesise multiple Current Memory entries of the same type for a subject into a single authoritative entry. Uses the tenant\'s configured LLM to merge bodies, resolve conflicts (preferring recent + high-confidence), and deduplicate. All source entries are superseded (is_current=false, audit trail preserved). Call when a subject has accumulated many redundant entries of the same type — e.g. 5 "next_step" entries that have piled up. If entry_ids is omitted, consolidates all current entries of context_type for the subject (up to max_entries).',
      inputSchema: z.object({
        subject_type: z.enum(['contact', 'account', 'opportunity', 'use_case'])
          .describe('Type of the CRM subject'),
        subject_id: z.string().uuid()
          .describe('ID of the CRM subject'),
        context_type: z.string().min(1)
          .describe('Context type to consolidate (e.g. "next_step", "objection")'),
        entry_ids: z.array(z.string().uuid()).min(2).optional()
          .describe('Specific entry IDs to consolidate. If omitted, uses all current entries of context_type.'),
        max_entries: z.number().int().min(2).max(20).default(10)
          .describe('Maximum number of entries to consolidate when entry_ids is omitted.'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input: {
        subject_type: 'contact' | 'account' | 'opportunity' | 'use_case';
        subject_id: string;
        context_type: string;
        entry_ids?: string[];
        max_entries?: number;
        idempotency_key?: string;
      }, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_consolidate',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        await assertSubjectAccess(db, actor, input.subject_type, input.subject_id);
        const actorRecordId = await ensureActorRecordForContext(db, actor);
        const result = await consolidateContextEntries(
          db,
          actor.tenant_id,
          actorRecordId,
          input.subject_type,
          input.subject_id,
          input.context_type,
          input.entry_ids as UUID[] | undefined,
          input.max_entries ?? 10,
        );
        return {
          ...result,
          mutation: mutationReceipt(actor, {
            objectType: 'context_entry',
            objectId: result.consolidated_entry?.id ?? input.subject_id,
          }),
        };
        });
      },
    },
    {
      name: 'context_embed_backfill',
      tier: 'admin',
      description: 'Admin tool: generate embeddings for context entries that have not yet been embedded. Call with dry_run: true first to see how many entries are pending, then with dry_run: false to process a batch. Loop calls until pending reaches 0. Requires ENABLE_PGVECTOR=true and EMBEDDING_PROVIDER to be configured.',
      inputSchema: contextEmbedBackfill,
      handler: async (input: z.infer<typeof contextEmbedBackfill>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_embed_backfill',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        const embConfig = loadEmbeddingConfig();
        if (!embConfig) {
          return { error: 'Embedding provider is not configured. Enable pgvector in Postgres, set ENABLE_PGVECTOR=true, and configure EMBEDDING_PROVIDER/EMBEDDING_API_KEY in the CRMy server environment.' };
        }

        const stats = await contextRepo.backfillEmbeddings(
          db,
          actor.tenant_id,
          embConfig,
          input.batch_size,
          input.subject_type,
          input.dry_run,
        );
        return {
          ...stats,
          dry_run: input.dry_run,
          mutation: mutationReceipt(actor, {
            objectType: 'context_entry',
            objectId: 'embedding-backfill',
            sideEffects: input.dry_run ? [] : ['embeddings:updated'],
          }),
        };
        });
      },
    },

    // ── Bulk operations ────────────────────────────────────────────────────────

    {
      name: 'context_review_batch',
      tier: 'core',
      description: 'Mark multiple Memory entries as reviewed in a single call — far more efficient than calling context_review for each one. Optionally extend valid_until by a number of days for all entries at once. Useful after a quarterly review or account health check where multiple facts have been re-verified. Returns counts of updated and not-found entries.',
      inputSchema: z.object({
        entry_ids:   z.array(z.string().uuid()).min(1).max(200)
          .describe('UUIDs of the context entries to mark reviewed (max 200 per call)'),
        extend_days: z.number().int().min(1).max(730).optional()
          .describe('Extend valid_until by this many days from now for all reviewed entries. Omit to clear staleness without extending.'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (
        input: { entry_ids: string[]; extend_days?: number; idempotency_key?: string },
        actor: ActorContext,
      ) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_review_batch',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        let updated = 0;
        let not_found = 0;
        let resolvedAssignments = 0;
        // Process in parallel batches of 20 to avoid overwhelming the DB
        const batchSize = 20;
        for (let i = 0; i < input.entry_ids.length; i += batchSize) {
          const batch = input.entry_ids.slice(i, i + batchSize);
          const results = await Promise.allSettled(
            batch.map(async id => {
              const existing = await contextRepo.getContextEntry(db, actor.tenant_id as UUID, id as UUID);
              if (!existing) return null;
              await assertSubjectAccess(db, actor, existing.subject_type as SubjectType, existing.subject_id);
              const reviewed = await contextRepo.reviewContextEntry(db, actor.tenant_id as UUID, id as UUID, input.extend_days);
              if (reviewed) {
                const completed = await completeOpenReviewAssignmentsForContextEntry(db, actor.tenant_id, reviewed.id, {
                  actorId: actor.actor_id,
                  actorType: actor.actor_type,
                  reason: 'context_reviewed_batch',
                });
                resolvedAssignments += completed.length;
              }
              return reviewed;
            }),
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) updated++;
            else not_found++;
          }
        }
        return {
          updated,
          not_found,
          extend_days: input.extend_days ?? null,
          message: `Marked ${updated} entr${updated !== 1 ? 'ies' : 'y'} as reviewed${input.extend_days ? `, extended by ${input.extend_days} days` : ''}.`,
          mutation: mutationReceipt(actor, {
            objectType: 'context_entry',
            objectId: 'batch',
            sideEffects: resolvedAssignments > 0 ? ['review_assignments:completed'] : [],
          }),
        };
        });
      },
    },

    {
      name: 'context_bulk_mark_stale',
      tier: 'core',
      description: 'Immediately mark multiple context entries as expired/stale by setting their valid_until to now. Use this after learning that previously recorded information is no longer accurate — for example, after a contact changes roles, a competitor announces a product change, or an org chart restructure. This flags entries for reverification without deleting them (history is preserved). Optionally supply a reason that gets appended to each entry\'s tags for audit purposes.',
      inputSchema: z.object({
        entry_ids: z.array(z.string().uuid()).min(1).max(200)
          .describe('UUIDs of the context entries to mark stale (max 200 per call)'),
        reason:    z.string().max(200).optional()
          .describe('Human-readable reason for marking stale, e.g. "Contact left the company" or "Competitor product discontinued". Added as a tag for audit purposes.'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (
        input: { entry_ids: string[]; reason?: string; idempotency_key?: string },
        actor: ActorContext,
      ) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'context_bulk_mark_stale',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        if (input.entry_ids.length === 0) return { updated: 0 };

        // Parameterized bulk UPDATE — sets valid_until = now() for all listed IDs
        const placeholders = input.entry_ids.map((_, i) => `$${i + 3}`).join(', ');
        const reasonTag = input.reason ? input.reason.slice(0, 200) : null;

        const result = await db.query(
          `UPDATE context_entries
           SET valid_until = now(),
               tags = CASE
                 WHEN $2::text IS NOT NULL
                 THEN tags || jsonb_build_array($2::text)
                 ELSE tags
               END,
               updated_at = now()
           WHERE tenant_id = $1
             AND id IN (${placeholders})
             AND is_current = TRUE
           RETURNING id`,
          [actor.tenant_id, reasonTag, ...input.entry_ids],
        );

        return {
          updated: result.rows.length,
          not_found_or_already_stale: input.entry_ids.length - result.rows.length,
          reason: input.reason ?? null,
          message: `Marked ${result.rows.length} entr${result.rows.length !== 1 ? 'ies' : 'y'} as stale.`,
          mutation: mutationReceipt(actor, {
            objectType: 'context_entry',
            objectId: 'batch',
          }),
        };
        });
      },
    },
  ];
}
