// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as agentRepo from '../db/repos/agent.js';
import { runAgentTurn } from './engine.js';
import { trimForPersistence, estimateHistoryChars } from './compaction.js';
import type { AgentEvent, AgentSessionAttachment, ConversationMessage } from './types.js';

const ATTACHED_CONTEXT_PREFIX = '[ATTACHED_CONTEXT]';
const activeTurnControllers = new Map<string, AbortController>();

function normalizeAgentContextType(contextType?: string | null): 'account' | 'contact' | 'opportunity' | 'use_case' | null {
  if (!contextType) return null;
  if (contextType === 'account' || contextType === 'contact' || contextType === 'opportunity' || contextType === 'use_case') return contextType;
  if (contextType === 'use-case' || contextType === 'useCase') return 'use_case';
  return null;
}

function safeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Agent turn failed';
}

async function actorForUser(db: DbPool, tenantId: string, userId: string): Promise<ActorContext | null> {
  const { rows } = await db.query(
    'SELECT id, role FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1',
    [tenantId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    tenant_id: tenantId,
    actor_id: row.id,
    actor_type: 'user',
    role: row.role,
    scopes: ['read'],
  };
}

function attachmentMessage(attachments: AgentSessionAttachment[]): ConversationMessage | null {
  const usable = attachments.filter(att => att.extracted_text?.trim());
  if (usable.length === 0) return null;
  const blocks = usable.map((att, index) => [
    `<attachment index="${index + 1}">`,
    `<filename>${att.filename}</filename>`,
    `<mode>active_context</mode>`,
    `<content>`,
    att.extracted_text,
    `</content>`,
    `</attachment>`,
  ].join('\n'));
  return {
    role: 'user',
    content: [
      ATTACHED_CONTEXT_PREFIX,
      'The user attached this temporary Active Context for the next request. Use it as source material for this chat turn only unless the user asks you to save or process it.',
      blocks.join('\n\n'),
    ].join('\n\n'),
  };
}

async function appendEventSerially(
  db: DbPool,
  tenantId: string,
  turnId: string,
  event: AgentEvent,
  chainRef: { current: Promise<unknown> },
): Promise<void> {
  chainRef.current = chainRef.current
    .then(() => agentRepo.appendTurnEvent(db, tenantId, turnId, event))
    .catch(err => {
      console.error('[agent-turn] failed to persist event:', err);
    });
  await chainRef.current;
}

export async function runAgentTurnById(db: DbPool, turnId: string): Promise<void> {
  const turn = (await db.query('SELECT * FROM agent_turns WHERE id = $1 LIMIT 1', [turnId])).rows[0];
  if (!turn) return;

  const claimed = turn.status === 'queued'
    ? await agentRepo.claimTurn(db, turn.tenant_id, turn.id)
    : turn;
  if (!claimed || claimed.status === 'cancelled') return;

  const controller = new AbortController();
  activeTurnControllers.set(turn.id, controller);
  const eventChain = { current: Promise.resolve() as Promise<unknown> };

  try {
    const session = await agentRepo.getSession(db, turn.tenant_id, turn.session_id);
    if (!session || session.user_id !== turn.user_id) {
      throw new Error('Session not found for queued agent turn');
    }

    const actor = await actorForUser(db, turn.tenant_id, turn.user_id);
    if (!actor) throw new Error('User not found for queued agent turn');

    const config = await agentRepo.getConfig(db, turn.tenant_id);
    if (!config?.enabled) throw new Error('Workspace Agent is not enabled for this workspace');

    const history: ConversationMessage[] = [...(session.messages as ConversationMessage[])];
    const attachments = await agentRepo.listPendingActiveContextAttachments(db, turn.tenant_id, turn.session_id);
    const attachmentContext = attachmentMessage(attachments);
    if (attachmentContext) {
      history.push(attachmentContext);
      await agentRepo.markAttachmentsConsumed(
        db,
        turn.tenant_id,
        turn.session_id,
        attachments.map(att => att.id),
        turn.id,
      );
    }
    history.push({ role: 'user', content: turn.input_message });

    const normalizedContextType = normalizeAgentContextType(session.context_type);
    const contextMeta = normalizedContextType
      ? {
        type: normalizedContextType,
        id: session.context_id ?? '',
        name: session.context_name ?? '',
        detail: turn.context_detail ?? undefined,
      }
      : undefined;

    const sendEvent = (event: AgentEvent) => {
      void appendEventSerially(db, turn.tenant_id, turn.id, event, eventChain);
    };

    const updatedHistory = await runAgentTurn(history, config, actor, db, sendEvent, {
      sessionId: session.id,
      turnId: turn.id,
      contextMeta,
      abortSignal: controller.signal,
    });

    await eventChain.current;

    if (controller.signal.aborted) {
      await agentRepo.cancelTurn(db, turn.tenant_id, turn.id);
      await appendEventSerially(db, turn.tenant_id, turn.id, { type: 'error', message: 'Agent turn was cancelled.' }, eventChain);
      return;
    }

    const label = session.label ?? deriveSessionLabel(turn.input_message);
    const persistHistory = trimForPersistence(updatedHistory);
    const tokenCount = Math.round(estimateHistoryChars(persistHistory) / 4);
    await agentRepo.updateSession(db, turn.tenant_id, session.id, {
      messages: persistHistory,
      label,
      token_count: tokenCount,
    });

    await agentRepo.completeTurn(db, turn.tenant_id, turn.id, { final_label: label });
    await appendEventSerially(db, turn.tenant_id, turn.id, { type: 'done', session_id: session.id, label }, eventChain);
  } catch (err) {
    const message = safeErrorMessage(err);
    await agentRepo.failTurn(db, turn.tenant_id, turn.id, message);
    await appendEventSerially(db, turn.tenant_id, turn.id, { type: 'error', message }, eventChain);
  } finally {
    await eventChain.current.catch(() => undefined);
    activeTurnControllers.delete(turn.id);
  }
}

export function startAgentTurnRunner(db: DbPool, turnId: string): void {
  void runAgentTurnById(db, turnId).catch(err => {
    console.error('[agent-turn] runner failed:', err);
  });
}

export async function cancelRunningAgentTurn(db: DbPool, tenantId: string, turnId: string): Promise<boolean> {
  const controller = activeTurnControllers.get(turnId);
  controller?.abort();
  const turn = await agentRepo.cancelTurn(db, tenantId, turnId);
  if (turn) {
    await agentRepo.appendTurnEvent(db, tenantId, turnId, { type: 'error', message: 'Agent turn was cancelled.' });
  }
  return Boolean(turn);
}

export async function processPendingAgentTurns(db: DbPool, limit = 5): Promise<void> {
  const turns = await agentRepo.claimPendingTurns(db, limit);
  for (const turn of turns) {
    if (activeTurnControllers.has(turn.id)) continue;
    startAgentTurnRunner(db, turn.id);
  }
}

function deriveSessionLabel(message: string): string {
  const label = message
    .replace(/^\s*(please|can you|could you|would you|help me|i need you to|let'?s)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label) return 'New conversation';
  return label.length > 60 ? `${label.slice(0, 57).trimEnd()}...` : label;
}

export { ATTACHED_CONTEXT_PREFIX };
