// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { hitlSubmit, hitlCheckStatus, hitlListPending, hitlResolve } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext, UUID } from '@crmy/shared';
import { withTransaction } from '../../db/transaction.js';
import * as hitlRepo from '../../db/repos/hitl.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, validationError } from '@crmy/shared';
import type { ToolDef } from '../server.js';
import { runToolOperation } from '../tool-operation.js';
import { mutationReceipt } from '../mutation-receipt.js';
import { assertHITLAccess, assertHITLPayloadAccess, filterVisibleHITLRequests } from '../../services/access-control.js';
import { applyApprovedRecordCreation } from '../../services/record-proposals.js';

export function hitlTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'hitl_submit_request',
      tier: 'core',
      description: 'Submit a human-in-the-loop approval request before executing any high-stakes action that should not be taken autonomously: sending proposals, making commitments, escalating pricing, or contacting executives for the first time. For enterprise handoffs, call agent_capture_handoff first and pass handoff_snapshot_id so the reviewer sees the agent reasoning, findings, and tool trace. Set auto_approve_after_seconds to enable time-boxed autonomy (e.g. 3600 for "proceed in 1 hour if no human response"). Set priority ("low"|"normal"|"high"|"urgent") and sla_minutes to control notification urgency and escalation timing. Always poll hitl_check_status before proceeding — never assume approval. The human sees the request in the Handoffs queue in the web UI and can approve, reject, or add a note.',
      inputSchema: hitlSubmit,
      handler: async (input: z.infer<typeof hitlSubmit>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'hitl_submit_request', input, async () => {
        await assertHITLPayloadAccess(db, actor, input.action_payload, undefined);
        const request = await hitlRepo.createHITLRequest(db, actor.tenant_id, {
          agent_id: actor.actor_id,
          action_type: input.action_type,
          action_summary: input.action_summary,
          action_payload: input.action_payload,
          auto_approve_after_seconds: input.auto_approve_after_seconds,
          priority: input.priority,
          sla_minutes: input.sla_minutes,
          escalate_to_id: input.escalate_to_id,
          handoff_snapshot_id: input.handoff_snapshot_id,
        });

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'hitl.submitted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'hitl_request',
          objectId: request.id,
          afterData: request,
        });

        return {
          request_id: request.id,
          status: request.status,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'hitl_request',
            objectId: request.id,
            eventId: event_id,
          }),
        };
        });
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
        await assertHITLAccess(db, actor, request);
        return { status: request.status, review_note: request.review_note };
      },
    },
    {
      name: 'hitl_list_pending',
      tier: 'admin',
      description: 'List all pending HITL approval requests awaiting human review. Use this to check your queue of outstanding requests or to see what other agents are waiting on. Returns requests sorted by creation time with action summaries and auto-approve deadlines.',
      inputSchema: hitlListPending,
      handler: async (input: z.infer<typeof hitlListPending>, actor: ActorContext) => {
        const limit = input.limit ?? 20;
        const candidates = await hitlRepo.listHITLRequests(db, actor.tenant_id, {
          status: 'pending',
          limit: Math.min(500, Math.max(limit * 10, limit)),
        });
        const requests = await filterVisibleHITLRequests(db, actor, candidates, limit);
        return { requests };
      },
    },
    {
      name: 'hitl_resolve',
      tier: 'admin',
      description: 'Approve or reject a pending HITL request as a human reviewer. Pass the request_id, decision ("approved" or "rejected"), and an optional note explaining your reasoning. The requesting agent will see the decision when it next polls hitl_check_status. Typically called from the web UI or by a human actor through the CLI.',
      inputSchema: hitlResolve,
      handler: async (input: z.infer<typeof hitlResolve>, actor: ActorContext) => {
        return runToolOperation(db, actor, 'hitl_resolve', input, async () => {
        const before = await hitlRepo.getHITLRequest(db, actor.tenant_id, input.request_id);
        if (!before) throw notFound('HITL Request (or already resolved)', input.request_id);
        await assertHITLAccess(db, actor, before);
        const { request, created_record, event_id } = await withTransaction(db, async tx => {
          const request = await hitlRepo.resolveHITLRequest(
            tx,
            actor.tenant_id,
            input.request_id,
            input.decision,
            actor.actor_id,
            input.note,
          );
          if (!request) throw notFound('HITL Request (or already resolved)', input.request_id);
          const created_record = input.decision === 'approved'
            ? await applyApprovedRecordCreation(tx, actor, request)
            : null;

          const event_id = await emitEvent(tx, {
            tenantId: actor.tenant_id,
            eventType: input.decision === 'approved' ? 'hitl.approved' : 'hitl.rejected',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'hitl_request',
            objectId: request.id,
            afterData: request,
          });
          return { request, created_record, event_id };
        });

        return {
          request,
          ...(created_record ? { created_record } : {}),
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'hitl_request',
            objectId: request.id,
            eventId: event_id,
          }),
        };
        });
      },
    },
    // ── Action Policy auto-approval management ───────────────────────────────
    {
      name: 'hitl_rule_create',
      tier: 'admin',
      description: 'Create an Action Policy that automatically approves or rejects HITL requests matching the specified criteria without human review. Policies are evaluated in descending priority order; first match wins. condition is a JSON object {field, op, value} or array of conditions (all must match). Operators: <, >, =, !=, contains, not_contains. field is a dot-path into action_payload. Use this to automate routine low-risk actions while preserving the policy boundary for high-risk changes.',
      inputSchema: z.object({
        name: z.string().min(1).max(100).describe('Human-readable name for the rule'),
        action_type: z.string().optional().describe('action_type to match. Omit to match all types.'),
        condition: z.union([
          z.object({
            field: z.string(),
            op: z.enum(['<', '>', '=', '!=', 'contains', 'not_contains']),
            value: z.unknown(),
          }),
          z.array(z.object({
            field: z.string(),
            op: z.enum(['<', '>', '=', '!=', 'contains', 'not_contains']),
            value: z.unknown(),
          })),
          z.record(z.never()),
        ]).default({}).describe('Condition expression (empty = always match)'),
        decision: z.enum(['approved', 'rejected']).describe('Decision to apply when rule matches'),
        priority: z.number().int().default(0).describe('Higher priority rules are evaluated first'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input: {
        name: string;
        action_type?: string;
        condition: unknown;
        decision: 'approved' | 'rejected';
        priority?: number;
        idempotency_key?: string;
      }, actor: ActorContext) => {
        return runToolOperation(db, actor, 'hitl_rule_create', input, async () => {
        try {
          const result = await db.query(
            `INSERT INTO hitl_approval_rules (tenant_id, name, action_type, condition, decision, priority)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
              actor.tenant_id,
              input.name,
              input.action_type ?? null,
              JSON.stringify(input.condition ?? {}),
              input.decision,
              input.priority ?? 0,
            ],
          );
          const rule = result.rows[0];
          return {
            rule,
            mutation: mutationReceipt(actor, {
              objectType: 'hitl_approval_rule',
              objectId: rule.id,
            }),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to create approval rule';
          if (msg.includes('unique') || msg.includes('duplicate')) {
            throw validationError(`An approval rule named "${input.name}" already exists`);
          }
          throw err;
        }
        });
      },
    },
    {
      name: 'hitl_rule_list',
      tier: 'admin',
      description: 'List all Action Policies for this tenant, sorted by priority. Use this to audit which policies may automatically approve or reject agent requests.',
      inputSchema: z.object({}),
      handler: async (_input: Record<never, never>, actor: ActorContext) => {
        const result = await db.query(
          'SELECT * FROM hitl_approval_rules WHERE tenant_id = $1 ORDER BY priority DESC, created_at ASC',
          [actor.tenant_id],
        );
        return { rules: result.rows, total: result.rows.length };
      },
    },
    {
      name: 'hitl_rule_delete',
      tier: 'admin',
      description: 'Delete an auto-approval rule by ID. The rule is permanently removed. Use hitl_rule_list to find rule IDs.',
      inputSchema: z.object({
        id: z.string().uuid().describe('ID of the rule to delete'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input: { id: string; idempotency_key?: string }, actor: ActorContext) => {
        return runToolOperation(db, actor, 'hitl_rule_delete', input, async () => {
        const result = await db.query(
          'DELETE FROM hitl_approval_rules WHERE id = $1 AND tenant_id = $2 RETURNING id',
          [input.id, actor.tenant_id],
        );
        if (result.rows.length === 0) throw notFound('HITL approval rule', input.id as UUID);
        return {
          deleted: true,
          id: input.id,
          mutation: mutationReceipt(actor, {
            objectType: 'hitl_approval_rule',
            objectId: input.id,
          }),
        };
        });
      },
    },
  ];
}
