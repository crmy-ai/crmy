// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { UUID, Activity } from '@crmy/shared';
import * as wfRepo from '../db/repos/workflows.js';
import { emitEvent } from '../events/emitter.js';

export interface WorkflowEngine {
  processEvent(tenantId: UUID, eventType: string, eventId: number, payload: unknown): Promise<void>;
}

export function createWorkflowEngine(db: DbPool): WorkflowEngine {
  return {
    async processEvent(tenantId, eventType, eventId, payload) {
      const workflows = await wfRepo.getActiveWorkflowsForEvent(db, tenantId, eventType);

      for (const workflow of workflows) {
        // Check trigger filter
        if (!matchesFilter(workflow.trigger_filter, payload)) continue;

        const run = await wfRepo.createRun(db, {
          workflow_id: workflow.id,
          event_id: eventId,
          actions_total: workflow.actions.length,
        });

        try {
          let actionsRun = 0;
          for (const action of workflow.actions as { type: string; config: Record<string, unknown> }[]) {
            await executeAction(db, tenantId, action, payload);
            actionsRun++;
            await wfRepo.updateRun(db, run.id, { actions_run: actionsRun });
          }

          await wfRepo.updateRun(db, run.id, { status: 'completed', actions_run: actionsRun });
          await wfRepo.incrementRunCount(db, workflow.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          await wfRepo.updateRun(db, run.id, { status: 'failed', error: message });
        }
      }
    },
  };
}

function matchesFilter(filter: Record<string, unknown>, payload: unknown): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;
  if (!payload || typeof payload !== 'object') return false;

  const data = payload as Record<string, unknown>;
  for (const [key, expected] of Object.entries(filter)) {
    if (data[key] !== expected) return false;
  }
  return true;
}

async function executeAction(
  db: DbPool, tenantId: UUID,
  action: { type: string; config: Record<string, unknown> },
  _payload: unknown,
): Promise<void> {
  switch (action.type) {
    case 'create_note': {
      const { createNote } = await import('../db/repos/notes.js');
      await createNote(db, tenantId, {
        object_type: action.config.object_type as string,
        object_id: action.config.object_id as string,
        body: action.config.body as string,
        visibility: (action.config.visibility as string) ?? 'internal',
        author_type: 'system',
      });
      break;
    }
    case 'create_activity': {
      const { createActivity } = await import('../db/repos/activities.js');
      await createActivity(db, tenantId, {
        type: (action.config.type as Activity['type']) ?? 'task',
        subject: action.config.subject as string,
        body: action.config.body as string | undefined,
        contact_id: action.config.contact_id as string | undefined,
        account_id: action.config.account_id as string | undefined,
      });
      break;
    }
    case 'send_notification': {
      let channelId = action.config.channel_id as string | undefined;

      // If no channel_id specified, try the tenant's default channel
      if (!channelId) {
        const { getDefaultChannel } = await import('../db/repos/messaging.js');
        const defaultChannel = await getDefaultChannel(db, tenantId);
        if (defaultChannel) channelId = defaultChannel.id;
      }

      if (channelId) {
        // Use the messaging delivery system with tracking + retries
        const { sendMessage } = await import('../messaging/delivery.js');
        const delivery = await sendMessage(db, tenantId, {
          channel_id: channelId,
          recipient: action.config.recipient as string | undefined,
          subject: action.config.subject as string | undefined,
          body: action.config.message as string,
          metadata: { workflow_run: true },
        });

        await emitEvent(db, {
          tenantId,
          eventType: 'workflow.notification',
          actorType: 'system',
          objectType: 'message_delivery',
          objectId: delivery.id,
          afterData: {
            channel_id: channelId,
            delivery_id: delivery.id,
            status: delivery.status,
            message: action.config.message,
            recipient: action.config.recipient,
          },
        });
      } else {
        // Fallback: emit event only (backward compat for plugin-based handling)
        await emitEvent(db, {
          tenantId,
          eventType: 'workflow.notification',
          actorType: 'system',
          objectType: 'workflow',
          afterData: {
            channel: action.config.channel ?? 'internal',
            message: action.config.message,
            recipient: action.config.recipient,
          },
        });
      }
      break;
    }
    case 'send_email': {
      const emailRepo = await import('../db/repos/emails.js');
      const hitlRepo = await import('../db/repos/hitl.js');

      const toAddress = action.config.to_address as string;
      const subject = action.config.subject as string;
      const bodyText = action.config.body_text as string;
      const bodyHtml = action.config.body_html as string | undefined;
      const requireApproval = action.config.require_approval !== 'false' && action.config.require_approval !== false;

      let hitlRequestId: string | undefined;
      let status = 'draft';

      if (requireApproval) {
        const hitl = await hitlRepo.createHITLRequest(db, tenantId, {
          agent_id: 'system',
          action_type: 'email.send',
          action_summary: `Send email to ${toAddress}: "${subject}"`,
          action_payload: {
            to_address: toAddress,
            subject,
            body_preview: bodyText.slice(0, 200),
          },
        });
        hitlRequestId = hitl.id;
        status = 'pending_approval';
      }

      const email = await emailRepo.createEmail(db, tenantId, {
        contact_id: action.config.contact_id as string | undefined,
        account_id: action.config.account_id as string | undefined,
        opportunity_id: action.config.opportunity_id as string | undefined,
        use_case_id: action.config.use_case_id as string | undefined,
        to_email: toAddress,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        status,
        hitl_request_id: hitlRequestId,
        created_by: 'system',
      });

      await emitEvent(db, {
        tenantId,
        eventType: 'email.created',
        actorType: 'system',
        objectType: 'email',
        objectId: email.id,
        afterData: { id: email.id, to: email.to_email, subject: email.subject, status: email.status },
      });
      break;
    }
    case 'update_field':
    case 'add_tag':
    case 'remove_tag':
    case 'assign_owner':
    case 'webhook':
      // Emit event for plugin/external handling
      await emitEvent(db, {
        tenantId,
        eventType: `workflow.action.${action.type}`,
        actorType: 'system',
        objectType: 'workflow',
        afterData: action.config,
      });
      break;
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}
