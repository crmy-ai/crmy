// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Compound action tools — orchestrate multiple primitives in a single call.
 * These are tier 'core' tools designed to cover the highest-frequency agent workflows
 * without requiring multiple sequential round trips.
 */

import { z } from 'zod';
import { dealAdvance, contactOutreach } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as oppRepo from '../../db/repos/opportunities.js';
import * as contactRepo from '../../db/repos/contacts.js';
import * as activityRepo from '../../db/repos/activities.js';
import * as contextRepo from '../../db/repos/context-entries.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, validationError } from '@crmy/shared';
import { validateOpportunityTransition } from '../../services/state-machine.js';
import { indexDocument } from '../../search/SearchIndexerService.js';
import type { ToolDef } from '../server.js';

export function compoundTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'deal_advance',
      tier: 'core',
      description: 'Advance an opportunity to a new stage, log a stage-change activity, and optionally capture a context entry — all in a single call. This replaces the 3-step sequence of opportunity_advance_stage + activity_create + context_add for deal progression. Validates the stage transition before applying it. Provide a note to record what drove the advancement (e.g. "Demo went well, customer requested proposal"). Provide context to store a durable insight (e.g. decision criteria, competitive intel gathered).',
      inputSchema: dealAdvance,
      handler: async (input: z.infer<typeof dealAdvance>, actor: ActorContext) => {
        // 1. Fetch opportunity
        const before = await oppRepo.getOpportunity(db, actor.tenant_id, input.opportunity_id);
        if (!before) throw notFound('Opportunity', input.opportunity_id);

        // 2. Validate stage transition
        const transition = await validateOpportunityTransition(
          db, actor.tenant_id, input.opportunity_id, before.stage, input.stage,
        );
        if (!transition.allowed) {
          throw validationError(transition.blockers.join('; '));
        }

        // 3. Advance the stage
        const opportunity = await oppRepo.updateOpportunity(db, actor.tenant_id, input.opportunity_id, {
          stage: input.stage,
          ...(input.stage === 'closed_won' || input.stage === 'closed_lost' ? { forecast_cat: 'closed' } : {}),
        });
        if (!opportunity) throw notFound('Opportunity', input.opportunity_id);

        // 4. Log a stage_change activity
        const activity = await activityRepo.createActivity(db, actor.tenant_id, {
          type: 'stage_change' as never,
          subject: `Stage advanced: ${before.stage} → ${input.stage}`,
          body: input.note,
          opportunity_id: input.opportunity_id,
          subject_type: 'opportunity',
          subject_id: input.opportunity_id,
          detail: { from_stage: before.stage, to_stage: input.stage },
          occurred_at: new Date().toISOString(),
          created_by: actor.actor_id,
          source_agent: actor.actor_type === 'agent' ? actor.actor_id : undefined,
        });

        // 5. Optionally add a context entry
        let context_entry = null;
        if (input.context) {
          context_entry = await contextRepo.createContextEntry(db, actor.tenant_id, {
            subject_type: 'opportunity',
            subject_id: input.opportunity_id,
            context_type: input.context.context_type,
            title: input.context.title,
            body: input.context.body,
            authored_by: actor.actor_id,
          });
        }

        // 6. Emit event
        const eventType = (input.stage === 'closed_won' || input.stage === 'closed_lost')
          ? 'opportunity.closed'
          : 'opportunity.stage_changed';

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType,
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'opportunity',
          objectId: opportunity.id,
          beforeData: { stage: before.stage },
          afterData: { stage: opportunity.stage },
          metadata: input.note ? { note: input.note } : {},
        });

        // 7. Index opportunity (fire-and-forget)
        indexDocument(db, 'opportunity', opportunity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] opportunity index ${opportunity.id}: ${(err as Error).message}`));

        return { opportunity, activity, context_entry, event_id };
      },
    },
    {
      name: 'contact_outreach',
      tier: 'core',
      description: 'Log a customer outreach interaction (email, call, LinkedIn, or other) and optionally capture a context insight — all in one call. This replaces the common activity_create + context_add sequence for outreach logging. Set channel to the medium used. Set body to the content or summary of the outreach. Use outcome to record the result (e.g. "Responded positively", "No reply", "Scheduled follow-up"). Use context to store durable insights learned from the interaction (e.g. pain points shared, stakeholder sentiment).',
      inputSchema: contactOutreach,
      handler: async (input: z.infer<typeof contactOutreach>, actor: ActorContext) => {
        // 1. Verify contact exists
        const contact = await contactRepo.getContact(db, actor.tenant_id, input.contact_id);
        if (!contact) throw notFound('Contact', input.contact_id);

        // Map channel to activity type
        const channelToType: Record<string, string> = {
          email: 'outreach_email',
          call: 'outreach_call',
          linkedin: 'outreach_linkedin',
          other: 'outreach_other',
        };
        const activityType = channelToType[input.channel] ?? 'outreach_other';

        // 2. Create the activity
        const activity = await activityRepo.createActivity(db, actor.tenant_id, {
          type: activityType as never,
          subject: input.subject,
          body: input.body,
          contact_id: input.contact_id,
          subject_type: 'contact',
          subject_id: input.contact_id,
          outcome: input.outcome,
          detail: { channel: input.channel },
          occurred_at: new Date().toISOString(),
          direction: 'outbound' as const,
          created_by: actor.actor_id,
          source_agent: actor.actor_type === 'agent' ? actor.actor_id : undefined,
        });

        // 3. Optionally add a context entry
        let context_entry = null;
        if (input.context) {
          context_entry = await contextRepo.createContextEntry(db, actor.tenant_id, {
            subject_type: 'contact',
            subject_id: input.contact_id,
            context_type: 'insight',
            title: input.context.title,
            body: input.context.body,
            source_activity_id: activity.id,
            authored_by: actor.actor_id,
          });
        }

        // 4. Emit event
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'activity.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'activity',
          objectId: activity.id,
          afterData: activity,
        });

        // 5. Index activity (fire-and-forget)
        indexDocument(db, 'activity', activity as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] activity index ${activity.id}: ${(err as Error).message}`));

        return { activity, context_entry, event_id };
      },
    },
  ];
}
