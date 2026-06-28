// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { activityCreate, activityUpdate, activitySearch, activityComplete, activityGetTimeline } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as activityRepo from '../../db/repos/activities.js';
import * as rawContextRepo from '../../db/repos/raw-context-sources.js';
import * as governorLimits from '../../db/repos/governor-limits.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import { indexDocument } from '../../search/SearchIndexerService.js';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import { extractContextFromActivity, triggerExtraction } from '../../agent/extraction.js';
import { runIdempotent } from '../../db/repos/idempotency.js';
import { mutationReceipt } from '../mutation-receipt.js';
import type { ToolDef } from '../server.js';
import { writeToolUx } from '../tool-ux.js';
import { runToolOperation } from '../tool-operation.js';
import { assertActivityAccess, assertSubjectAccess, defaultOwnerForCreate, resolveOwnerFilter } from '../../services/access-control.js';
import { verifiedActionContextMetadataForReceipt } from '../../services/action-context.js';

export function activityTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'activity_create',
      tier: 'core',
      description: 'Log a meaningful observation: outreach sent, call made, meeting held, stage changed, proposal drafted, research completed. Set occurred_at to when the event actually happened, not when you are logging it — this is critical for accurate timelines when logging retroactively. The detail field is a free JSONB payload for type-specific data: for outreach_email include {to, subject, channel}, for meeting_held include {duration_minutes, attendees}, for stage_change include {from_stage, to_stage}. If an LLM backend is configured, CRMy auto-extracts reviewable Signals from the activity description. Prefer setting subject_type and subject_id. If you pass contact_id, account_id, opportunity_id, or use_case_id without subject_type/subject_id, CRMy derives the canonical subject automatically.',
      inputSchema: activityCreate,
      ux: writeToolUx({
        displayName: 'Log activity',
        actionPhrase: 'log the activity',
        objectLabel: 'activity',
      }),
      handler: async (input: z.infer<typeof activityCreate>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'activity_create',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        // Enforce governor limit on daily activity count
        const todayCount = await governorLimits.countActivitiesToday(db, actor.tenant_id);
        await governorLimits.enforceLimit(db, actor.tenant_id, 'activities_per_day', todayCount);

        if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
          input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'activity', input.custom_fields, { isCreate: true });
        }
        await assertSubjectAccess(db, actor, input.subject_type, input.subject_id);
        const owner_id = await defaultOwnerForCreate(db, actor, input.owner_id);
        const activity = await activityRepo.createActivity(db, actor.tenant_id, {
          ...input,
          owner_id: owner_id ?? undefined,
          source_agent: actor.actor_type === 'agent' ? actor.actor_id : undefined,
          created_by: actor.actor_id,
        });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'activity.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'activity',
          objectId: activity.id,
          afterData: activity,
        });

        // Fire-and-forget extraction — does not affect the response
        triggerExtraction(db, actor.tenant_id, activity.id).catch(err =>
          console.error('[extraction] trigger failed:', err),
        );

        indexDocument(db, 'activity', activity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] activity index ${activity.id}: ${(err as Error).message}`));

        return {
          activity,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'activity',
            objectId: activity.id,
            eventId: event_id,
            sideEffects: ['context_extraction:queued', 'search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'activity_get',
      tier: 'core',
      description: 'Retrieve a single activity by UUID including its full body, detail payload, outcome, and linked subject. Use this when you need the complete activity record from a timeline or search result.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const activity = await activityRepo.getActivity(db, actor.tenant_id, input.id);
        if (!activity) throw notFound('Activity', input.id);
        await assertActivityAccess(db, actor, input.id);
        return { activity };
      },
    },
    {
      name: 'activity_search',
      tier: 'core',
      description: 'Search activities across the CRM with flexible filters. Use type to filter by activity kind (outreach_email, meeting_held, stage_change, etc.), performed_by to see a specific actor contributions, outcome to find activities with a particular result, or subject_type/subject_id to scope to a specific CRM record. Returns paginated results sorted by occurred_at descending.',
      inputSchema: activitySearch,
      handler: async (input: z.infer<typeof activitySearch>, actor: ActorContext) => {
        const ownerFilter = await resolveOwnerFilter(db, actor);
        const result = await activityRepo.searchActivities(db, actor.tenant_id, {
          ...input,
          owner_ids: ownerFilter.owner_ids,
          limit: input.limit ?? 20,
        });
        return { activities: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'activity_complete',
      tier: 'extended',
      description: 'Mark an activity as completed, setting its status and completed_at timestamp. Optionally add a completion note that appends to the activity body. If a note is added and an LLM backend is configured, context extraction re-runs on the updated content.',
      inputSchema: activityComplete,
      handler: async (input: z.infer<typeof activityComplete>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'activity_complete',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        const before = await activityRepo.getActivity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Activity', input.id);
        await assertActivityAccess(db, actor, input.id);

        const activity = await activityRepo.completeActivity(
          db,
          actor.tenant_id,
          input.id,
          input.completed_at,
        );
        if (!activity) throw notFound('Activity', input.id);

        // If a note was provided, update the body
        if (input.note) {
          await activityRepo.updateActivity(db, actor.tenant_id, input.id, {
            body: before.body ? `${before.body}\n\n---\n${input.note}` : input.note,
          });
          // Re-extract now that body has changed
          triggerExtraction(db, actor.tenant_id, input.id).catch(err =>
            console.error('[extraction] trigger on complete failed:', err),
          );
        }

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'activity.completed',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'activity',
          objectId: activity.id,
          beforeData: { status: before.status },
          afterData: { status: 'completed' },
        });
        indexDocument(db, 'activity', activity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] activity index ${activity.id}: ${(err as Error).message}`));
        return {
          activity,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'activity',
            objectId: activity.id,
            eventId: event_id,
            sideEffects: input.note ? ['context_extraction:queued', 'search_index:queued'] : ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'activity_update',
      tier: 'extended',
      description: 'Update an existing activity record. Pass the id and a patch object with fields to change (body, subject, outcome, detail, occurred_at, custom_fields, etc.). If extractable content changes, context extraction automatically re-runs to capture any new information.',
      inputSchema: activityUpdate,
      ux: writeToolUx({
        displayName: 'Update activity',
        actionPhrase: 'update the activity',
        objectLabel: 'activity',
      }),
      handler: async (input: z.infer<typeof activityUpdate>, actor: ActorContext) => {
        return runIdempotent(db, {
          tenantId: actor.tenant_id,
          actorId: actor.actor_id,
          operation: 'activity_update',
          key: input.idempotency_key,
          request: input,
        }, async () => {
        const before = await activityRepo.getActivity(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Activity', input.id);
        await assertActivityAccess(db, actor, input.id);

        if (input.patch.custom_fields && Object.keys(input.patch.custom_fields).length > 0) {
          input.patch.custom_fields = await validateCustomFields(db, actor.tenant_id, 'activity', input.patch.custom_fields);
        }
        const activity = await activityRepo.updateActivity(db, actor.tenant_id, input.id, input.patch);
        if (!activity) throw notFound('Activity', input.id);
        const actionContextMetadata = activity.subject_type && activity.subject_id
          ? await verifiedActionContextMetadataForReceipt(db, actor, activity.subject_type, activity.subject_id, input.action_context)
          : undefined;

        // Re-extract if content used by the extraction prompt changed.
        if (input.patch.body != null || input.patch.detail != null || input.patch.outcome != null) {
          triggerExtraction(db, actor.tenant_id, input.id).catch(err =>
            console.error('[extraction] trigger on update failed:', err),
          );
        }

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'activity.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'activity',
          objectId: activity.id,
          beforeData: before,
          afterData: activity,
          metadata: actionContextMetadata ? { action_context: actionContextMetadata } : undefined,
        });
        indexDocument(db, 'activity', activity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] activity index ${activity.id}: ${(err as Error).message}`));
        const extractionQueued = input.patch.body != null || input.patch.detail != null || input.patch.outcome != null;
        return {
          activity,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'activity',
            objectId: activity.id,
            eventId: event_id,
            sideEffects: extractionQueued ? ['context_extraction:queued', 'search_index:queued'] : ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'activity_add_context',
      tier: 'extended',
      description: 'Add debrief notes, a transcript, or a meeting summary to an existing activity and immediately process it as a Source. Use this for phone calls, in-person meetings, or calendar meetings that are missing notes.',
      inputSchema: z.object({
        id: z.string().uuid(),
        text: z.string().min(1),
        artifact_type: z.enum(['notes', 'transcript', 'summary', 'debrief']).optional().default('debrief'),
        source_label: z.string().optional(),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input: { id: string; text: string; artifact_type?: 'notes' | 'transcript' | 'summary' | 'debrief'; source_label?: string; idempotency_key?: string }, actor: ActorContext) => {
        return runToolOperation(db, actor, 'activity_add_context', input, async () => {
          const before = await activityRepo.getActivity(db, actor.tenant_id, input.id);
          if (!before) throw notFound('Activity', input.id);
          await assertActivityAccess(db, actor, input.id);
          const body = before.body?.trim()
            ? `${before.body}\n\n--- ${input.artifact_type ?? 'debrief'} ---\n${input.text.trim()}`
            : input.text.trim();
          const activity = await activityRepo.updateActivity(db, actor.tenant_id, input.id, {
            body,
            detail: {
              ...(before.detail ?? {}),
              latest_context_artifact: {
                type: input.artifact_type ?? 'debrief',
                source_label: input.source_label ?? 'Activity context',
                added_at: new Date().toISOString(),
              },
            },
          });
          if (!activity) throw notFound('Activity', input.id);
          const extraction = await extractContextFromActivity(db, actor.tenant_id, activity.id, {
            ownerIds: (await resolveOwnerFilter(db, actor)).owner_ids ?? undefined,
          });
          const rawSource = await rawContextRepo.getRawContextSourceByRef(db, actor.tenant_id, 'activity', activity.id)
            ?? await rawContextRepo.getRawContextSourceByRef(db, actor.tenant_id, 'calendar_meeting', activity.id);
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id,
            eventType: 'activity.context_added',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'activity',
            objectId: activity.id,
            afterData: {
              raw_context_source_id: rawSource?.id ?? null,
              memory_created: extraction.memory_created,
              signals_created: extraction.signals_created,
            },
          });
          indexDocument(db, 'activity', activity as unknown as Record<string, unknown>)
            .catch((err: unknown) => console.warn(`[search] activity index ${activity.id}: ${(err as Error).message}`));
          return {
            activity,
            raw_context_source_id: rawSource?.id ?? null,
            extraction: {
              memory_created: extraction.memory_created,
              signals_created: extraction.signals_created,
              skipped: extraction.skipped,
            },
            event_id,
            mutation: mutationReceipt(actor, {
              objectType: 'activity',
              objectId: activity.id,
              eventId: event_id,
              sideEffects: ['raw_context:processed', 'search_index:queued'],
            }),
          };
        });
      },
    },
    {
      name: 'activity_get_timeline',
      tier: 'core',
      description: 'Get a chronological activity timeline for any customer record (contact, account, opportunity, or use_case) via polymorphic subject_type and subject_id. Optionally filter by activity types to see only specific kinds of activities. Returns activities sorted by occurred_at descending with the total count for pagination.',
      inputSchema: activityGetTimeline,
      handler: async (input: z.infer<typeof activityGetTimeline>, actor: ActorContext) => {
        await assertSubjectAccess(db, actor, input.subject_type, input.subject_id);
        const result = await activityRepo.getSubjectTimeline(
          db,
          actor.tenant_id,
          input.subject_type,
          input.subject_id,
          { limit: input.limit ?? 50, types: input.types },
        );
        return { activities: result.activities, total: result.total };
      },
    },
  ];
}
