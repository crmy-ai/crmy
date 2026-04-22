// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  sequenceCreate, sequenceGet, sequenceUpdate, sequenceDelete, sequenceList,
  sequenceEnroll, sequenceUnenroll, sequencePause, sequenceResume,
  sequenceAdvance, sequenceEnrollmentGet, sequenceEnrollmentList,
  sequenceEnrollmentContext,
  sequenceDraftStep, sequenceAnalytics,
  // backward-compat aliases
  emailSequenceCreate, emailSequenceGet, emailSequenceUpdate, emailSequenceDelete,
  emailSequenceList, emailSequenceEnroll, emailSequenceUnenroll, emailSequenceEnrollmentList,
} from '@crmy/shared';
import type { ActorContext } from '@crmy/shared';
import { validationError } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ToolDef } from '../server.js';
import * as seqRepo from '../../db/repos/email-sequences.js';
import { getSequenceAnalytics } from '../../services/sequence-analytics.js';
import { interpolate, buildVariableContext } from '../../workflows/variables.js';
import { callLLM } from '../../agent/providers/llm.js';

export function emailSequenceTools(db: DbPool): ToolDef[] {
  return [

    // ── Core CRUD ────────────────────────────────────────────────────────────

    {
      name: 'sequence_create',
      tier: 'extended',
      description:
        'Create a multi-channel sequence. Steps can be email, task, notification, webhook, ' +
        'wait, branch, or ai_action. Each step has a delay_days and type-specific config. ' +
        'Set goal_event to auto-complete enrollments when that event fires for the contact. ' +
        'Set exit_on_reply=true (default) to stop sending when a contact replies.',
      inputSchema: sequenceCreate,
      handler: async (input: z.infer<typeof sequenceCreate>, actor: ActorContext) => {
        return seqRepo.createSequence(db, actor.tenant_id, {
          ...input,
          created_by: actor.actor_id as any,
        });
      },
    },

    {
      name: 'sequence_get',
      tier: 'extended',
      description: 'Get a sequence by ID including its steps and settings.',
      inputSchema: sequenceGet,
      handler: async (input: z.infer<typeof sequenceGet>, actor: ActorContext) => {
        return (await seqRepo.getSequence(db, actor.tenant_id, input.id)) ?? { error: 'Sequence not found' };
      },
    },

    {
      name: 'sequence_update',
      tier: 'extended',
      description: 'Update a sequence name, description, steps, settings, or active status.',
      inputSchema: sequenceUpdate,
      handler: async (input: z.infer<typeof sequenceUpdate>, actor: ActorContext) => {
        return (await seqRepo.updateSequence(db, actor.tenant_id, input.id, input.patch)) ?? { error: 'Sequence not found' };
      },
    },

    {
      name: 'sequence_delete',
      tier: 'extended',
      description: 'Delete a sequence. All active enrollments will be cancelled.',
      inputSchema: sequenceDelete,
      handler: async (input: z.infer<typeof sequenceDelete>, actor: ActorContext) => {
        return { deleted: await seqRepo.deleteSequence(db, actor.tenant_id, input.id) };
      },
    },

    {
      name: 'sequence_list',
      tier: 'extended',
      description: 'List sequences with optional filters for active status and tags.',
      inputSchema: sequenceList,
      handler: async (input: z.infer<typeof sequenceList>, actor: ActorContext) => {
        return seqRepo.listSequences(db, actor.tenant_id, {
          is_active: input.is_active,
          tags: input.tags,
          limit: input.limit,
          cursor: input.cursor,
        });
      },
    },

    // ── Enrollment management ────────────────────────────────────────────────

    {
      name: 'sequence_enroll',
      tier: 'extended',
      description:
        'Enroll a contact in a sequence. Pass variables to personalise step content at execution time ' +
        '(e.g. { pain_point: "slow onboarding", competitor: "Salesforce" }). ' +
        'Use start_at_step to skip early steps.',
      inputSchema: sequenceEnroll,
      handler: async (input: z.infer<typeof sequenceEnroll>, actor: ActorContext) => {
        try {
          return await seqRepo.enrollContact(db, actor.tenant_id, {
            sequence_id: input.sequence_id,
            contact_id: input.contact_id,
            enrolled_by: actor.actor_id,
            enrolled_by_actor_id: actor.actor_id as any,
            variables: input.variables,
            start_at_step: input.start_at_step,
            objective: input.objective,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Enrollment failed';
          if (msg.includes('unique') || msg.includes('duplicate')) {
            throw validationError('Contact is already actively enrolled in this sequence');
          }
          throw err;
        }
      },
    },

    {
      name: 'sequence_unenroll',
      tier: 'extended',
      description: 'Cancel an active enrollment by enrollment ID.',
      inputSchema: sequenceUnenroll,
      handler: async (input: z.infer<typeof sequenceUnenroll>, actor: ActorContext) => {
        const cancelled = await seqRepo.unenrollContact(db, actor.tenant_id, input.id);
        return { cancelled };
      },
    },

    {
      name: 'sequence_pause',
      tier: 'extended',
      description: 'Pause an active enrollment. The contact will not receive any more steps until resumed.',
      inputSchema: sequencePause,
      handler: async (input: z.infer<typeof sequencePause>, actor: ActorContext) => {
        const enrollment = await seqRepo.getEnrollment(db, actor.tenant_id, input.id);
        if (!enrollment) throw validationError('Enrollment not found');
        const paused = await seqRepo.pauseEnrollment(db, input.id);
        return { paused };
      },
    },

    {
      name: 'sequence_resume',
      tier: 'extended',
      description: 'Resume a paused enrollment. The next step will execute on its next scheduled time.',
      inputSchema: sequenceResume,
      handler: async (input: z.infer<typeof sequenceResume>, actor: ActorContext) => {
        const enrollment = await seqRepo.getEnrollment(db, actor.tenant_id, input.id);
        if (!enrollment) throw validationError('Enrollment not found');
        const resumed = await seqRepo.resumeEnrollment(db, input.id);
        return { resumed };
      },
    },

    {
      name: 'sequence_advance',
      tier: 'extended',
      description:
        'Immediately advance an enrollment to the next step (or a specific step). ' +
        'Useful when you want to fast-track a contact based on a conversation or signal. ' +
        'The skipped step is not executed.',
      inputSchema: sequenceAdvance,
      handler: async (input: z.infer<typeof sequenceAdvance>, actor: ActorContext) => {
        const enrollment = await seqRepo.getEnrollment(db, actor.tenant_id, input.id);
        if (!enrollment) throw validationError('Enrollment not found');
        const seq = await seqRepo.getSequence(db, actor.tenant_id, enrollment.sequence_id);
        if (!seq) throw validationError('Sequence not found');
        const targetStep = input.skip_to_step ?? enrollment.current_step + 1;
        const updated = await seqRepo.advanceToStep(db, actor.tenant_id, input.id, targetStep);
        return { enrollment: updated, advanced_to_step: targetStep };
      },
    },

    {
      name: 'sequence_enrollment_get',
      tier: 'extended',
      description:
        'Get the full state of an enrollment including per-step execution log. ' +
        'Shows what was sent at each step, when, and whether it succeeded. ' +
        'Returns objective, enrolled_by_actor_id, and context_entry_count.',
      inputSchema: sequenceEnrollmentGet,
      handler: async (input: z.infer<typeof sequenceEnrollmentGet>, actor: ActorContext) => {
        const result = await seqRepo.getEnrollmentWithStepLog(db, actor.tenant_id, input.id);
        if (!result) return { error: 'Enrollment not found' };

        // Count context entries extracted from this enrollment
        const contextCount = await db.query(
          `SELECT count(*)::int AS count FROM context_entries WHERE tenant_id = $1 AND source_ref = $2`,
          [actor.tenant_id, input.id],
        );
        return { ...result, context_entry_count: contextCount.rows[0].count ?? 0 };
      },
    },

    {
      name: 'sequence_enrollment_context',
      tier: 'extended',
      description:
        'Get the full collaboration sandbox for an enrollment: activities from sequence steps, ' +
        'context entries extracted from those activities, and enrollment variables. ' +
        'Use this before taking action on a contact to understand what has already happened in the sequence ' +
        'and what the agent knows about them from this campaign.',
      inputSchema: sequenceEnrollmentContext,
      handler: async (input: z.infer<typeof sequenceEnrollmentContext>, actor: ActorContext) => {
        const enrollment = await seqRepo.getEnrollmentWithStepLog(db, actor.tenant_id, input.enrollment_id);
        if (!enrollment) return { error: 'Enrollment not found' };

        const seq = await seqRepo.getSequence(db, actor.tenant_id, enrollment.sequence_id);

        const [activitiesResult, contextResult] = await Promise.all([
          db.query(
            `SELECT * FROM activities WHERE tenant_id = $1 AND detail->>'enrollment_id' = $2 ORDER BY occurred_at DESC, created_at DESC LIMIT 50`,
            [actor.tenant_id, input.enrollment_id],
          ),
          db.query(
            `SELECT * FROM context_entries WHERE tenant_id = $1 AND source_ref = $2 ORDER BY created_at DESC LIMIT 50`,
            [actor.tenant_id, input.enrollment_id],
          ),
        ]);

        return {
          enrollment: {
            ...enrollment,
            sequence_name: seq?.name,
            total_steps: (seq?.steps as unknown[])?.length ?? 0,
          },
          activities: activitiesResult.rows,
          context_entries: contextResult.rows,
          variables: enrollment.variables ?? {},
          objective: (enrollment as any).objective ?? null,
        };
      },
    },

    {
      name: 'sequence_enrollment_list',
      tier: 'extended',
      description: 'List sequence enrollments filtered by sequence, contact, or status.',
      inputSchema: sequenceEnrollmentList,
      handler: async (input: z.infer<typeof sequenceEnrollmentList>, actor: ActorContext) => {
        return seqRepo.listEnrollments(db, actor.tenant_id, {
          sequence_id: input.sequence_id,
          contact_id: input.contact_id,
          status: input.status,
          limit: input.limit,
          cursor: input.cursor,
        });
      },
    },

    // ── AI draft ─────────────────────────────────────────────────────────────

    {
      name: 'sequence_draft_step',
      tier: 'extended',
      description:
        'Generate a draft for a pending email step using the contact\'s context and your instructions. ' +
        'Returns the draft subject and body for review before it is sent. ' +
        'Call this before the step fires if you want to review or iterate on the content. ' +
        'The draft is NOT saved — call sequence_advance or let the scheduled send proceed.',
      inputSchema: sequenceDraftStep,
      handler: async (input: z.infer<typeof sequenceDraftStep>, actor: ActorContext) => {
        const enrollment = await seqRepo.getEnrollment(db, actor.tenant_id, input.enrollment_id);
        if (!enrollment) throw validationError('Enrollment not found');

        const seq = await seqRepo.getSequence(db, actor.tenant_id, enrollment.sequence_id);
        if (!seq) throw validationError('Sequence not found');

        const steps = seq.steps as any[];
        const step = steps[input.step_index];
        if (!step) throw validationError(`Step ${input.step_index} not found`);
        if ((step.type ?? 'email') !== 'email') throw validationError('Draft is only available for email steps');

        // Build variable context
        const contactRepo = await import('../../db/repos/contacts.js');
        const contact = await contactRepo.getContact(db, actor.tenant_id, enrollment.contact_id);
        const varContext = buildVariableContext({
          ...(contact ?? {}),
          ...((enrollment.variables as Record<string, unknown>) ?? {}),
        });

        // Attempt AI draft
        let subject = interpolate(step.subject ?? '', varContext);
        let bodyText = interpolate(step.body_text ?? '', varContext);

        try {
          const systemPrompt = (seq as any).ai_persona ??
            'You are a sales assistant drafting personalized outreach emails. Return JSON: {"subject":"...","body_text":"..."}';

          const contactInfo = JSON.stringify({
            name: [(contact as any)?.first_name, (contact as any)?.last_name].filter(Boolean).join(' '),
            email: (contact as any)?.email,
            title: (contact as any)?.title,
            company: (contact as any)?.company_name,
          });
          const instructions = input.instructions ?? step.ai_prompt ?? 'Write a short, personalized email.';

          const text = await callLLM(db, actor.tenant_id, {
            system: systemPrompt,
            user: `Contact: ${contactInfo}\nTemplate subject: ${subject}\nTemplate body: ${bodyText}\nInstruction: ${instructions}\n\nReturn only JSON: {"subject":"...","body_text":"..."}`,
          });
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            subject = parsed.subject ?? subject;
            bodyText = parsed.body_text ?? bodyText;
          }
        } catch { /* use interpolated template */ }

        return {
          step_index: input.step_index,
          step_type: 'email',
          draft: { subject, body_text: bodyText },
          contact_email: (contact as any)?.email,
          note: 'This draft is not saved. The scheduled step will execute normally unless you advance or modify the enrollment.',
        };
      },
    },

    // ── Analytics ────────────────────────────────────────────────────────────

    {
      name: 'sequence_analytics',
      tier: 'extended',
      description:
        'Get performance analytics for a sequence: enrollment funnel, open/click/reply rates, ' +
        'per-step execution breakdown, and historical rollup data.',
      inputSchema: sequenceAnalytics,
      handler: async (input: z.infer<typeof sequenceAnalytics>, actor: ActorContext) => {
        return getSequenceAnalytics(
          db, actor.tenant_id, input.sequence_id,
          input.period_type ?? 'day', input.limit ?? 30,
        );
      },
    },

    // ── Backward-compat aliases (old email_sequence_* names) ─────────────────

    {
      name: 'email_sequence_create',
      tier: 'extended',
      description: 'Alias for sequence_create (backward compat).',
      inputSchema: emailSequenceCreate,
      handler: async (input: z.infer<typeof emailSequenceCreate>, actor: ActorContext) => {
        return seqRepo.createSequence(db, actor.tenant_id, { ...input, created_by: actor.actor_id as any });
      },
    },
    {
      name: 'email_sequence_get',
      tier: 'extended',
      description: 'Alias for sequence_get (backward compat).',
      inputSchema: emailSequenceGet,
      handler: async (input: z.infer<typeof emailSequenceGet>, actor: ActorContext) => {
        return (await seqRepo.getSequence(db, actor.tenant_id, input.id)) ?? { error: 'Sequence not found' };
      },
    },
    {
      name: 'email_sequence_update',
      tier: 'extended',
      description: 'Alias for sequence_update (backward compat).',
      inputSchema: emailSequenceUpdate,
      handler: async (input: z.infer<typeof emailSequenceUpdate>, actor: ActorContext) => {
        return (await seqRepo.updateSequence(db, actor.tenant_id, input.id, input.patch)) ?? { error: 'Not found' };
      },
    },
    {
      name: 'email_sequence_delete',
      tier: 'extended',
      description: 'Alias for sequence_delete (backward compat).',
      inputSchema: emailSequenceDelete,
      handler: async (input: z.infer<typeof emailSequenceDelete>, actor: ActorContext) => {
        return { deleted: await seqRepo.deleteSequence(db, actor.tenant_id, input.id) };
      },
    },
    {
      name: 'email_sequence_list',
      tier: 'extended',
      description: 'Alias for sequence_list (backward compat).',
      inputSchema: emailSequenceList,
      handler: async (input: z.infer<typeof emailSequenceList>, actor: ActorContext) => {
        return seqRepo.listSequences(db, actor.tenant_id, { is_active: input.is_active, limit: input.limit, cursor: input.cursor });
      },
    },
    {
      name: 'email_sequence_enroll',
      tier: 'extended',
      description: 'Alias for sequence_enroll (backward compat).',
      inputSchema: emailSequenceEnroll,
      handler: async (input: z.infer<typeof emailSequenceEnroll>, actor: ActorContext) => {
        try {
          return await seqRepo.enrollContact(db, actor.tenant_id, {
            sequence_id: input.sequence_id,
            contact_id: input.contact_id,
            enrolled_by: actor.actor_id,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('unique') || msg.includes('duplicate')) {
            throw validationError('Contact is already actively enrolled in this sequence');
          }
          throw err;
        }
      },
    },
    {
      name: 'email_sequence_unenroll',
      tier: 'extended',
      description: 'Alias for sequence_unenroll (backward compat).',
      inputSchema: emailSequenceUnenroll,
      handler: async (input: z.infer<typeof emailSequenceUnenroll>, actor: ActorContext) => {
        return { cancelled: await seqRepo.unenrollContact(db, actor.tenant_id, input.id) };
      },
    },
    {
      name: 'email_sequence_enrollment_list',
      tier: 'extended',
      description: 'Alias for sequence_enrollment_list (backward compat).',
      inputSchema: emailSequenceEnrollmentList,
      handler: async (input: z.infer<typeof emailSequenceEnrollmentList>, actor: ActorContext) => {
        return seqRepo.listEnrollments(db, actor.tenant_id, {
          sequence_id: input.sequence_id,
          contact_id: input.contact_id,
          status: input.status,
          limit: input.limit,
          cursor: input.cursor,
        });
      },
    },
  ];
}
