// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { hitlSubmit, hitlCheckStatus, hitlListPending, hitlResolve } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as hitlRepo from '../../db/repos/hitl.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function hitlTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'hitl_submit_request',
      tier: 'core',
      description: 'Submit a human-in-the-loop approval request before executing any high-stakes action that should not be taken autonomously: sending proposals, making commitments, escalating pricing, or contacting executives for the first time. Set auto_approve_after_seconds to enable time-boxed autonomy (e.g. 3600 for "proceed in 1 hour if no human response"). Always poll hitl_check_status before proceeding — never assume approval. The human sees the request in the HITL Queue in the web UI and can approve, reject, or add a note.',
      inputSchema: hitlSubmit,
      handler: async (input: z.infer<typeof hitlSubmit>, actor: ActorContext) => {
        const request = await hitlRepo.createHITLRequest(db, actor.tenant_id, {
          agent_id: actor.actor_id,
          action_type: input.action_type,
          action_summary: input.action_summary,
          action_payload: input.action_payload,
          auto_approve_after_seconds: input.auto_approve_after_seconds,
        });

        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'hitl.submitted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'hitl_request',
          objectId: request.id,
          afterData: request,
        });

        return { request_id: request.id, status: request.status };
      },
    },
    {
      name: 'hitl_check_status',
      tier: 'core',
      description: 'Check the current status of a HITL approval request by its request_id. Returns "pending", "approved", or "rejected" along with any review_note the human added. Call this in a poll loop before proceeding with the gated action — never assume approval without checking. Typically poll every 30–60 seconds for time-sensitive actions.',
      inputSchema: hitlCheckStatus,
      handler: async (input: z.infer<typeof hitlCheckStatus>, actor: ActorContext) => {
        const request = await hitlRepo.getHITLRequest(db, actor.tenant_id, input.request_id);
        if (!request) throw notFound('HITL Request', input.request_id);
        return { status: request.status, review_note: request.review_note };
      },
    },
    {
      name: 'hitl_list_pending',
      tier: 'admin',
      description: 'List all pending HITL approval requests awaiting human review. Use this to check your queue of outstanding requests or to see what other agents are waiting on. Returns requests sorted by creation time with action summaries and auto-approve deadlines.',
      inputSchema: hitlListPending,
      handler: async (input: z.infer<typeof hitlListPending>, actor: ActorContext) => {
        const requests = await hitlRepo.listPendingHITL(db, actor.tenant_id, input.limit ?? 20);
        return { requests };
      },
    },
    {
      name: 'hitl_resolve',
      tier: 'admin',
      description: 'Approve or reject a pending HITL request as a human reviewer. Pass the request_id, decision ("approved" or "rejected"), and an optional note explaining your reasoning. The requesting agent will see the decision when it next polls hitl_check_status. Typically called from the web UI or by a human actor through the CLI.',
      inputSchema: hitlResolve,
      handler: async (input: z.infer<typeof hitlResolve>, actor: ActorContext) => {
        const request = await hitlRepo.resolveHITLRequest(
          db,
          actor.tenant_id,
          input.request_id,
          input.decision,
          actor.actor_id,
          input.note,
        );
        if (!request) throw notFound('HITL Request (or already resolved)', input.request_id);

        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: input.decision === 'approved' ? 'hitl.approved' : 'hitl.rejected',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'hitl_request',
          objectId: request.id,
          afterData: request,
        });

        return { request };
      },
    },
  ];
}
