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
      description: 'Submit a human-in-the-loop approval request before executing a high-impact action',
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
      description: 'Check the status of a HITL approval request',
      inputSchema: hitlCheckStatus,
      handler: async (input: z.infer<typeof hitlCheckStatus>, actor: ActorContext) => {
        const request = await hitlRepo.getHITLRequest(db, actor.tenant_id, input.request_id);
        if (!request) throw notFound('HITL Request', input.request_id);
        return { status: request.status, review_note: request.review_note };
      },
    },
    {
      name: 'hitl_list_pending',
      description: 'List pending HITL approval requests',
      inputSchema: hitlListPending,
      handler: async (input: z.infer<typeof hitlListPending>, actor: ActorContext) => {
        const requests = await hitlRepo.listPendingHITL(db, actor.tenant_id, input.limit ?? 20);
        return { requests };
      },
    },
    {
      name: 'hitl_resolve',
      description: 'Approve or reject a HITL request',
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
