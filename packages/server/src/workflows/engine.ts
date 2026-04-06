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
  payload: unknown,
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

      // When no approval required, deliver immediately
      if (!requireApproval) {
        const { deliverEmail } = await import('../email/delivery.js');
        await deliverEmail(db, tenantId, email.id);
      }
      break;
    }
    case 'update_field': {
      const objectType = action.config.object_type as string || (payload as Record<string, unknown>)?.object_type as string;
      const objectId = action.config.object_id as string || (payload as Record<string, unknown>)?.id as string;
      const field = action.config.field as string;
      const value = action.config.value;

      if (objectType && objectId && field) {
        const repoMap: Record<string, string> = {
          contact: '../db/repos/contacts.js',
          account: '../db/repos/accounts.js',
          opportunity: '../db/repos/opportunities.js',
        };
        const repoPath = repoMap[objectType];
        if (repoPath) {
          const repo = await import(repoPath);
          const updateFn = repo[`update${objectType.charAt(0).toUpperCase() + objectType.slice(1)}`];
          if (updateFn) await updateFn(db, tenantId, objectId, { [field]: value });
        }
      }

      await emitEvent(db, {
        tenantId,
        eventType: 'workflow.action.update_field',
        actorType: 'system',
        objectType: objectType || 'workflow',
        objectId,
        afterData: action.config,
      });
      break;
    }
    case 'add_tag':
    case 'remove_tag': {
      const tagPayload = payload as Record<string, unknown> | undefined;
      const objType = action.config.object_type as string || tagPayload?.object_type as string;
      const objId = action.config.object_id as string || tagPayload?.id as string;
      const tag = action.config.tag as string;

      if (objType && objId && tag) {
        const repoMap: Record<string, string> = {
          contact: '../db/repos/contacts.js',
          account: '../db/repos/accounts.js',
          opportunity: '../db/repos/opportunities.js',
        };
        const repoPath = repoMap[objType];
        if (repoPath) {
          const repo = await import(repoPath);
          const getFn = repo[`get${objType.charAt(0).toUpperCase() + objType.slice(1)}`];
          const updateFn = repo[`update${objType.charAt(0).toUpperCase() + objType.slice(1)}`];
          if (getFn && updateFn) {
            const record = await getFn(db, tenantId, objId);
            if (record) {
              const tags: string[] = Array.isArray(record.tags) ? [...record.tags] : [];
              if (action.type === 'add_tag' && !tags.includes(tag)) {
                tags.push(tag);
              } else if (action.type === 'remove_tag') {
                const idx = tags.indexOf(tag);
                if (idx >= 0) tags.splice(idx, 1);
              }
              await updateFn(db, tenantId, objId, { tags });
            }
          }
        }
      }

      await emitEvent(db, {
        tenantId,
        eventType: `workflow.action.${action.type}`,
        actorType: 'system',
        objectType: objType || 'workflow',
        objectId: objId,
        afterData: action.config,
      });
      break;
    }
    case 'assign_owner': {
      const ownerPayload = payload as Record<string, unknown> | undefined;
      const ownerObjType = action.config.object_type as string || ownerPayload?.object_type as string;
      const ownerObjId = action.config.object_id as string || ownerPayload?.id as string;
      const ownerId = action.config.owner_id as string;

      if (ownerObjType && ownerObjId && ownerId) {
        const repoMap: Record<string, string> = {
          contact: '../db/repos/contacts.js',
          account: '../db/repos/accounts.js',
          opportunity: '../db/repos/opportunities.js',
        };
        const repoPath = repoMap[ownerObjType];
        if (repoPath) {
          const repo = await import(repoPath);
          const updateFn = repo[`update${ownerObjType.charAt(0).toUpperCase() + ownerObjType.slice(1)}`];
          if (updateFn) await updateFn(db, tenantId, ownerObjId, { owner_id: ownerId });
        }
      }

      await emitEvent(db, {
        tenantId,
        eventType: 'workflow.action.assign_owner',
        actorType: 'system',
        objectType: ownerObjType || 'workflow',
        objectId: ownerObjId,
        afterData: action.config,
      });
      break;
    }
    case 'webhook': {
      // Emit event — the webhook dispatcher on the event bus will deliver to matching endpoints
      await emitEvent(db, {
        tenantId,
        eventType: 'workflow.action.webhook',
        actorType: 'system',
        objectType: 'workflow',
        afterData: action.config,
      });
      break;
    }
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}
