// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';
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
      const { default: noteRepo } = await import('../db/repos/notes.js');
      await noteRepo.createNote(db, tenantId, {
        object_type: action.config.object_type as string,
        object_id: action.config.object_id as string,
        body: action.config.body as string,
        visibility: (action.config.visibility as string) ?? 'internal',
        author_type: 'system',
      });
      break;
    }
    case 'create_activity': {
      const { default: activityRepo } = await import('../db/repos/activities.js');
      await activityRepo.createActivity(db, tenantId, {
        type: (action.config.type as string) ?? 'task',
        subject: action.config.subject as string,
        body: action.config.body as string | undefined,
        contact_id: action.config.contact_id as string | undefined,
        account_id: action.config.account_id as string | undefined,
      });
      break;
    }
    case 'send_notification': {
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
