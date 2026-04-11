// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as snapshotRepo from '../../db/repos/handoff-snapshots.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

const keyFindingSchema = z.object({
  finding: z.string().min(1).describe('A specific finding, belief, or observation the agent holds'),
  confidence: z.number().min(0).max(1).optional().describe('Confidence in this finding, 0–1'),
  entry_id: z.string().uuid().optional().describe('Context entry ID that supports this finding'),
});

const toolCalledSchema = z.object({
  tool_name: z.string().describe('Name of the MCP tool called'),
  args_summary: z.string().optional().describe('Brief summary of the arguments (no sensitive data)'),
  result_summary: z.string().optional().describe('Brief summary of what the tool returned'),
});

export function agentHandoffTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'agent_capture_handoff',
      tier: 'core',
      description: 'Capture a snapshot of your current reasoning and findings BEFORE creating a HITL request or assignment handoff. This preserves your context so a human reviewer or resuming agent can understand what you found and why you stopped. Always call this before hitl_submit_request or assignment_create when the action is non-trivial. Returns a snapshot_id to include in the HITL or assignment.',
      inputSchema: z.object({
        subject_type: z.enum(['contact', 'account', 'opportunity', 'use_case']).optional()
          .describe('The primary CRM subject you were working on'),
        subject_id: z.string().uuid().optional()
          .describe('The ID of the primary CRM subject'),
        reasoning: z.string().min(1).max(4000)
          .describe('Your summary of what you found, decided, and why you are handing off. Be specific — this is what the human will read.'),
        key_findings: z.array(keyFindingSchema).default([])
          .describe('Structured list of specific findings with confidence scores'),
        tools_called: z.array(toolCalledSchema).default([])
          .describe('List of MCP tools you called in this session with brief summaries'),
        confidence: z.number().min(0).max(1).optional()
          .describe('Your overall confidence in the current state, 0–1'),
        handoff_type: z.enum(['hitl', 'assignment', 'pause']).default('hitl')
          .describe('Why you are handing off: hitl = approval needed, assignment = delegate to human, pause = resuming later'),
      }),
      handler: async (input: {
        subject_type?: 'contact' | 'account' | 'opportunity' | 'use_case';
        subject_id?: string;
        reasoning: string;
        key_findings: Array<{ finding: string; confidence?: number; entry_id?: string }>;
        tools_called: Array<{ tool_name: string; args_summary?: string; result_summary?: string }>;
        confidence?: number;
        handoff_type: 'hitl' | 'assignment' | 'pause';
      }, actor: ActorContext) => {
        const snapshot = await snapshotRepo.createSnapshot(db, actor.tenant_id, {
          actor_id: actor.actor_id,
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          reasoning: input.reasoning,
          key_findings: input.key_findings,
          tools_called: input.tools_called,
          confidence: input.confidence,
          handoff_type: input.handoff_type,
        });

        return {
          snapshot_id: snapshot.id,
          handoff_type: snapshot.handoff_type,
          created_at: snapshot.created_at,
        };
      },
    },
    {
      name: 'agent_resume_handoff',
      tier: 'core',
      description: 'Recover your context when resuming after a HITL approval, assignment completion, or pause. Returns your original reasoning and findings plus any new context entries, activities, or HITL decisions that occurred since the snapshot. Call this at the start of a resumed session before taking any action.',
      inputSchema: z.object({
        snapshot_id: z.string().uuid()
          .describe('The snapshot_id returned by agent_capture_handoff'),
      }),
      handler: async (input: { snapshot_id: string }, actor: ActorContext) => {
        const snapshot = await snapshotRepo.getSnapshot(db, actor.tenant_id, input.snapshot_id);
        if (!snapshot) throw notFound('Handoff snapshot', input.snapshot_id);

        await snapshotRepo.markResumed(db, snapshot.id);

        // Fetch new context/activities since the snapshot was created
        let new_context: Record<string, unknown> = {};
        let new_activities: unknown[] = [];

        if (snapshot.subject_type && snapshot.subject_id) {
          try {
            const { assembleBriefing } = await import('../../services/briefing.js');
            const briefing = await assembleBriefing(
              db,
              actor.tenant_id,
              snapshot.subject_type as 'contact' | 'account' | 'opportunity' | 'use_case',
              snapshot.subject_id,
              { since: snapshot.created_at },
            );
            new_context = briefing.context_entries ?? {};
            new_activities = briefing.activities ?? [];
          } catch { /* best-effort */ }
        }

        return {
          snapshot,
          new_context_since_snapshot: new_context,
          new_activities_since_snapshot: new_activities,
          resumed_at: new Date().toISOString(),
        };
      },
    },
  ];
}
