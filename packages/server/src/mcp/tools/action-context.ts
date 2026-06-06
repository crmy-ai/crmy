// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { actionContextGet, type ActorContext } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import { getActionContext } from '../../services/action-context.js';
import type { ToolDef } from '../server.js';

export function actionContextTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'action_context_get',
      tier: 'core',
      description: 'Assemble action-aware customer context before an agent prepares work. Returns the briefing, operating_mode (inform, warn, require_review), readiness, policy/source-authority checks, allowed actions, required handoffs, guidance, and a compact retrieval proof event. This does not mutate CRM records or execute writebacks.',
      inputSchema: actionContextGet,
      handler: async (input: z.infer<typeof actionContextGet>, actor: ActorContext) => {
        return {
          action_context: await getActionContext(db, actor, input),
        };
      },
    },
  ];
}
