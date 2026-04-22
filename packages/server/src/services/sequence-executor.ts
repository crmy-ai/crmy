// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Sequence execution engine.
 *
 * Runs on the 60-second background tick. Fetches due enrollments, dispatches
 * each step by type, logs the result, and advances or completes the enrollment.
 *
 * Also handles:
 *   - Reply detection  → exit enrollment on inbound email reply
 *   - Goal-event exit  → complete enrollment when a goal event fires
 *   - AI generation    → LLM-drafted step content with optional HITL gate
 *   - Branch steps     → conditional jumps based on triggers
 */

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';
import { emitEvent } from '../events/emitter.js';
import * as seqRepo from '../db/repos/email-sequences.js';
import * as emailRepo from '../db/repos/emails.js';
import * as contactRepo from '../db/repos/contacts.js';
import * as assignmentRepo from '../db/repos/assignments.js';
import * as activityRepo from '../db/repos/activities.js';
import { deliverEmail } from '../email/delivery.js';
import { interpolate, buildVariableContext } from '../workflows/variables.js';
import { callLLM } from '../agent/providers/llm.js';
import { triggerExtraction } from '../agent/extraction.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface EmailStep {
  type?: 'email';
  delay_days: number;
  delay_hours?: number;
  subject: string;
  body_text?: string;
  body_html?: string;
  require_approval?: boolean;
  ai_generate?: boolean;
  ai_prompt?: string;
}

interface NotificationStep {
  type: 'notification';
  delay_days: number;
  channel_id?: string;
  message: string;
}

interface TaskStep {
  type: 'task';
  delay_days: number;
  title: string;
  description?: string;
  assign_to?: string;
  priority?: 'low' | 'normal' | 'high';
}

interface WebhookStep {
  type: 'webhook';
  delay_days: number;
  url: string;
  method?: 'POST' | 'GET';
  headers?: Record<string, string>;
  body_template?: string;
}

interface WaitStep {
  type: 'wait';
  delay_days: number;
  condition?: {
    event: string;
    timeout_days: number;
    timeout_branch?: number;
  };
}

interface BranchStep {
  type: 'branch';
  delay_days?: number;
  conditions: Array<{
    trigger: 'replied' | 'opened' | 'clicked' | 'goal_met' | 'custom_event';
    event?: string;
    jump_to_step?: number;
    exit?: boolean;
  }>;
}

interface AiActionStep {
  type: 'ai_action';
  delay_days: number;
  prompt: string;
  tool_names?: string[];
  require_approval?: boolean;
}

type SequenceStep = EmailStep | NotificationStep | TaskStep | WebhookStep | WaitStep | BranchStep | AiActionStep;

// ── Main pump ──────────────────────────────────────────────────────────────────

/** Called from the 60-second background tick in index.ts */
export async function processSequenceDue(db: DbPool): Promise<void> {
  const enrollments = await seqRepo.getDueEnrollments(db, 50);
  for (const enrollment of enrollments) {
    try {
      await processEnrollment(db, enrollment);
    } catch (err) {
      console.error(`[sequences] enrollment ${enrollment.id} failed:`, err);
      // Log failure but keep processing other enrollments
      await seqRepo.logStepExecution(db, {
        enrollment_id: enrollment.id,
        tenant_id: enrollment.tenant_id,
        step_index: enrollment.current_step,
        step_type: 'unknown',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function processEnrollment(db: DbPool, enrollment: Awaited<ReturnType<typeof seqRepo.getDueEnrollments>>[number]): Promise<void> {
  const sequence = await seqRepo.getSequence(db, enrollment.tenant_id, enrollment.sequence_id);
  if (!sequence || !sequence.is_active) {
    await seqRepo.cancelEnrollment(db, enrollment.id, 'sequence_inactive');
    return;
  }

  const steps = (sequence.steps as SequenceStep[]);
  const stepIndex = enrollment.current_step;

  if (stepIndex >= steps.length) {
    await seqRepo.completeEnrollment(db, enrollment.id, 'completed');
    return;
  }

  const step = steps[stepIndex];
  const stepType = (step as { type?: string }).type ?? 'email';

  await executeStep(db, enrollment, sequence, step, stepIndex);
}

async function executeStep(
  db: DbPool,
  enrollment: Awaited<ReturnType<typeof seqRepo.getDueEnrollments>>[number],
  sequence: seqRepo.SequenceRow,
  step: SequenceStep,
  stepIndex: number,
): Promise<void> {
  const stepType = (step as { type?: string }).type ?? 'email';

  // Build variable context from contact data
  const contact = await contactRepo.getContact(db, enrollment.tenant_id, enrollment.contact_id);
  const contactPayload = contact ? {
    first_name: (contact as any).first_name,
    last_name: (contact as any).last_name,
    email: (contact as any).email,
    title: (contact as any).title,
    company_name: (contact as any).company_name,
    lifecycle_stage: (contact as any).lifecycle_stage,
  } : {};

  const varContext = {
    ...buildVariableContext({ ...contactPayload, ...((enrollment as any).variables ?? {}) }),
    contact: { ...contactPayload, ...((enrollment as any).variables ?? {}) },
    enrollment: {
      step: stepIndex,
      sequence_name: sequence.name,
      ...(enrollment as any).variables,
    },
  };

  try {
    switch (stepType) {
      case 'email':
        await executeEmailStep(db, enrollment, sequence, step as EmailStep, stepIndex, varContext, contact);
        break;
      case 'notification':
        await executeNotificationStep(db, enrollment, step as NotificationStep, stepIndex, varContext);
        break;
      case 'task':
        await executeTaskStep(db, enrollment, sequence, step as TaskStep, stepIndex, varContext);
        break;
      case 'webhook':
        await executeWebhookStep(db, enrollment, step as WebhookStep, stepIndex, varContext);
        break;
      case 'wait':
        await executeWaitStep(db, enrollment, step as WaitStep, stepIndex);
        return; // Wait steps reschedule without advancing
      case 'branch':
        await executeBranchStep(db, enrollment, sequence, step as BranchStep, stepIndex);
        return; // Branch steps handle their own advancement
      case 'ai_action':
        await executeAiActionStep(db, enrollment, sequence, step as AiActionStep, stepIndex, varContext, contact);
        break;
      default:
        await seqRepo.logStepExecution(db, {
          enrollment_id: enrollment.id,
          tenant_id: enrollment.tenant_id,
          step_index: stepIndex,
          step_type: stepType,
          status: 'skipped',
          error: `Unknown step type: ${stepType}`,
        });
    }

    // Advance to next step
    const steps = sequence.steps as SequenceStep[];
    const nextIndex = stepIndex + 1;
    if (nextIndex >= steps.length) {
      await seqRepo.completeEnrollment(db, enrollment.id, 'completed');
      emitEvent(db, {
        tenantId: enrollment.tenant_id,
        eventType: 'sequence.enrollment_completed',
        actorType: 'system',
        objectType: 'sequence_enrollment',
        objectId: enrollment.id,
        afterData: { enrollment_id: enrollment.id, sequence_id: enrollment.sequence_id },
      }).catch(() => {});
    } else {
      const nextStep = steps[nextIndex];
      const delayDays = (nextStep as { delay_days?: number }).delay_days ?? 0;
      const delayHours = (nextStep as { delay_hours?: number }).delay_hours ?? 0;
      const delayMs = (delayDays * 86_400_000) + (delayHours * 3_600_000);
      const nextSendAt = new Date(Date.now() + delayMs).toISOString();
      await seqRepo.setCurrentStep(db, enrollment.id, nextIndex, nextSendAt);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await seqRepo.logStepExecution(db, {
      enrollment_id: enrollment.id,
      tenant_id: enrollment.tenant_id,
      step_index: stepIndex,
      step_type: stepType,
      status: 'failed',
      error: errMsg,
    });
    // Reschedule with exponential backoff (max 3 retries then cancel)
    const retries = ((enrollment as any).metadata?.retries ?? 0) as number;
    if (retries >= 2) {
      await seqRepo.cancelEnrollment(db, enrollment.id, 'step_failed');
    } else {
      const backoffMs = Math.pow(2, retries + 1) * 3_600_000; // 2h, 4h
      const retryAt = new Date(Date.now() + backoffMs).toISOString();
      await db.query(
        `UPDATE sequence_enrollments
         SET next_send_at = $1,
             metadata = COALESCE(metadata,'{}')::jsonb || jsonb_build_object('retries', $2),
             updated_at = now()
         WHERE id = $3`,
        [retryAt, retries + 1, enrollment.id],
      );
    }
    throw err;
  }
}

// ── Step executors ─────────────────────────────────────────────────────────────

async function executeEmailStep(
  db: DbPool,
  enrollment: any,
  sequence: seqRepo.SequenceRow,
  step: EmailStep,
  stepIndex: number,
  varContext: Record<string, unknown>,
  contact: any,
): Promise<void> {
  // Resolve variables in subject and body
  let subject = interpolate(step.subject ?? '', varContext);
  let bodyText = interpolate(step.body_text ?? '', varContext);

  // AI generation
  if (step.ai_generate && step.ai_prompt) {
    const generated = await generateEmailContent(db, enrollment, sequence, step, varContext, contact);
    if (generated) {
      subject = generated.subject ?? subject;
      bodyText = generated.body_text ?? bodyText;
    }
  }

  const toEmail = (contact as any)?.email;
  if (!toEmail) {
    await seqRepo.logStepExecution(db, {
      enrollment_id: enrollment.id,
      tenant_id: enrollment.tenant_id,
      step_index: stepIndex,
      step_type: 'email',
      status: 'skipped',
      error: 'Contact has no email address',
    });
    return;
  }

  // HITL approval gate
  if (step.require_approval) {
    const { createHITLRequest } = await import('../db/repos/hitl.js');
    const hitl = await createHITLRequest(db, enrollment.tenant_id, {
      action_type: 'sequence.step.send',
      action_summary: `Send sequence email step ${stepIndex + 1} of "${sequence.name}" to ${toEmail}: "${subject}"`,
      action_payload: {
        enrollment_id: enrollment.id,
        step_index: stepIndex,
        to_email: toEmail,
        subject,
        body_text: bodyText,
      },
      agent_id: 'system',
      priority: 'normal',
      sla_minutes: 1440,
    });

    // Pause enrollment awaiting HITL
    await db.query(
      `UPDATE sequence_enrollments SET status = 'paused', paused_at = now(), updated_at = now() WHERE id = $1`,
      [enrollment.id],
    );
    await seqRepo.logStepExecution(db, {
      enrollment_id: enrollment.id,
      tenant_id: enrollment.tenant_id,
      step_index: stepIndex,
      step_type: 'email',
      status: 'approval_pending',
      metadata: { hitl_request_id: hitl.id },
    });
    return;
  }

  // Create and deliver email
  const email = await emailRepo.createEmail(db, enrollment.tenant_id, {
    contact_id: enrollment.contact_id,
    to_email: toEmail,
    to_name: [(contact as any)?.first_name, (contact as any)?.last_name].filter(Boolean).join(' ') || undefined,
    subject,
    body_text: bodyText,
    body_html: step.body_html ? interpolate(step.body_html, varContext) : undefined,
    status: 'draft',
  } as any);

  await deliverEmail(db, enrollment.tenant_id, email.id);

  // Back-link email → enrollment for analytics + reply threading
  await db.query(
    `UPDATE emails SET enrollment_id = $1, sequence_id = $2 WHERE id = $3`,
    [enrollment.id, sequence.id, email.id],
  );

  // Create Activity so this email appears in the contact timeline and feeds context extraction
  const activity = await activityRepo.createActivity(db, enrollment.tenant_id, {
    type: 'outreach_email',
    subject,
    body: bodyText?.slice(0, 500),
    direction: 'outbound',
    status: 'completed',
    subject_type: 'contact',
    subject_id: enrollment.contact_id,
    contact_id: enrollment.contact_id,
    performed_by: (enrollment as any).enrolled_by_actor_id ?? undefined,
    source_agent: `sequence:${sequence.id}`,
    occurred_at: new Date().toISOString(),
    detail: {
      sequence_id: sequence.id,
      sequence_name: sequence.name,
      enrollment_id: enrollment.id,
      step_index: stepIndex,
      email_id: email.id,
    },
  });

  // Fire-and-forget context extraction from the email content
  triggerExtraction(db, enrollment.tenant_id, activity.id).catch(() => {});

  const execution = await seqRepo.logStepExecution(db, {
    enrollment_id: enrollment.id,
    tenant_id: enrollment.tenant_id,
    step_index: stepIndex,
    step_type: 'email',
    status: 'sent',
    email_id: email.id,
    metadata: { to: toEmail, subject },
  });

  // Back-link step execution → activity
  await db.query(
    `UPDATE sequence_step_executions SET activity_id = $1 WHERE id = $2`,
    [activity.id, execution.id],
  );

  emitEvent(db, {
    tenantId: enrollment.tenant_id,
    eventType: 'sequence.step_executed',
    actorType: 'system',
    objectType: 'sequence_enrollment',
    objectId: enrollment.id,
    afterData: { step_index: stepIndex, step_type: 'email', email_id: email.id, activity_id: activity.id },
  }).catch(() => {});
}

async function executeNotificationStep(
  db: DbPool,
  enrollment: any,
  step: NotificationStep,
  stepIndex: number,
  varContext: Record<string, unknown>,
): Promise<void> {
  const { sendMessage } = await import('../messaging/delivery.js');
  const message = interpolate(step.message, varContext);

  if (!step.channel_id) {
    throw new Error('Notification step requires a channel_id');
  }

  await sendMessage(db, enrollment.tenant_id, {
    channel_id: step.channel_id,
    subject: `Sequence: ${message.slice(0, 80)}`,
    body: message,
  });

  // Create Activity so this notification appears in the contact timeline
  const activity = await activityRepo.createActivity(db, enrollment.tenant_id, {
    type: 'note',
    subject: `Sequence notification: ${message.slice(0, 80)}`,
    body: message,
    status: 'completed',
    subject_type: 'contact',
    subject_id: enrollment.contact_id,
    contact_id: enrollment.contact_id,
    performed_by: (enrollment as any).enrolled_by_actor_id ?? undefined,
    source_agent: `sequence:${(enrollment as any).sequence_id}`,
    occurred_at: new Date().toISOString(),
    detail: {
      enrollment_id: enrollment.id,
      step_index: stepIndex,
      channel_id: step.channel_id,
    },
  });

  const execution = await seqRepo.logStepExecution(db, {
    enrollment_id: enrollment.id,
    tenant_id: enrollment.tenant_id,
    step_index: stepIndex,
    step_type: 'notification',
    status: 'sent',
    metadata: { message: message.slice(0, 200) },
  });

  await db.query(
    `UPDATE sequence_step_executions SET activity_id = $1 WHERE id = $2`,
    [activity.id, execution.id],
  );
}

async function executeTaskStep(
  db: DbPool,
  enrollment: any,
  sequence: seqRepo.SequenceRow,
  step: TaskStep,
  stepIndex: number,
  varContext: Record<string, unknown>,
): Promise<void> {
  const title = interpolate(step.title, varContext);
  const description = step.description ? interpolate(step.description, varContext) : undefined;

  // Resolve assignee — 'contact_owner' means we look up the contact's assigned owner
  let assignedTo: UUID | undefined;
  if (step.assign_to && step.assign_to !== 'contact_owner') {
    assignedTo = step.assign_to as UUID;
  }

  const enrolledByActor = (enrollment as any).enrolled_by_actor_id as UUID | undefined;
  const ownerActor = (enrollment as any).owner_actor_id as UUID | undefined;
  const assignedByActor = enrolledByActor ?? ownerActor ?? ('system' as unknown as UUID);

  await assignmentRepo.createAssignment(db, enrollment.tenant_id, {
    title,
    description,
    assignment_type: 'task',
    assigned_by: assignedByActor,
    assigned_to: assignedTo,
    subject_type: 'contact',
    subject_id: enrollment.contact_id,
    priority: step.priority ?? 'normal',
    context: `Sequence: ${sequence.name} — step ${stepIndex + 1}`,
    metadata: { sequence_id: enrollment.sequence_id, enrollment_id: enrollment.id, step_index: stepIndex },
  });

  // Create Activity so the task appears in the contact timeline
  const activity = await activityRepo.createActivity(db, enrollment.tenant_id, {
    type: 'task',
    subject: title,
    body: description,
    status: 'pending',
    subject_type: 'contact',
    subject_id: enrollment.contact_id,
    contact_id: enrollment.contact_id,
    performed_by: enrolledByActor ?? undefined,
    source_agent: `sequence:${sequence.id}`,
    occurred_at: new Date().toISOString(),
    detail: {
      sequence_id: sequence.id,
      sequence_name: sequence.name,
      enrollment_id: enrollment.id,
      step_index: stepIndex,
      assign_to: step.assign_to,
    },
  });

  const execution = await seqRepo.logStepExecution(db, {
    enrollment_id: enrollment.id,
    tenant_id: enrollment.tenant_id,
    step_index: stepIndex,
    step_type: 'task',
    status: 'sent',
    metadata: { title },
  });

  await db.query(
    `UPDATE sequence_step_executions SET activity_id = $1 WHERE id = $2`,
    [activity.id, execution.id],
  );
}

async function executeWebhookStep(
  db: DbPool,
  enrollment: any,
  step: WebhookStep,
  stepIndex: number,
  varContext: Record<string, unknown>,
): Promise<void> {
  const url = interpolate(step.url, varContext);
  const method = step.method ?? 'POST';
  const body = step.body_template
    ? interpolate(step.body_template, varContext)
    : JSON.stringify({ enrollment_id: enrollment.id, contact_id: enrollment.contact_id, step_index: stepIndex });

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...step.headers };

  const res = await Promise.race([
    fetch(url, { method, headers, body: method !== 'GET' ? body : undefined }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Webhook timed out')), 30_000)),
  ]);

  if (!res.ok) throw new Error(`Webhook returned HTTP ${res.status}`);

  // Create Activity for the webhook firing
  const activity = await activityRepo.createActivity(db, enrollment.tenant_id, {
    type: 'status_update',
    subject: `Webhook fired: ${url}`,
    body: body,
    status: 'completed',
    subject_type: 'contact',
    subject_id: enrollment.contact_id,
    contact_id: enrollment.contact_id,
    performed_by: (enrollment as any).enrolled_by_actor_id ?? undefined,
    source_agent: `sequence:${(enrollment as any).sequence_id}`,
    occurred_at: new Date().toISOString(),
    detail: {
      enrollment_id: enrollment.id,
      step_index: stepIndex,
      url,
      http_status: res.status,
    },
  });

  const execution = await seqRepo.logStepExecution(db, {
    enrollment_id: enrollment.id,
    tenant_id: enrollment.tenant_id,
    step_index: stepIndex,
    step_type: 'webhook',
    status: 'sent',
    metadata: { url, status: res.status },
  });

  await db.query(
    `UPDATE sequence_step_executions SET activity_id = $1 WHERE id = $2`,
    [activity.id, execution.id],
  );
}

async function executeWaitStep(
  db: DbPool,
  enrollment: any,
  step: WaitStep,
  stepIndex: number,
): Promise<void> {
  // If no condition, this is a pure delay — advance to next step immediately
  // (the delay was already applied when setting next_send_at)
  if (!step.condition) {
    const sequence = await seqRepo.getSequence(db, enrollment.tenant_id, enrollment.sequence_id);
    if (!sequence) return;
    const steps = sequence.steps as SequenceStep[];
    const nextIndex = stepIndex + 1;
    if (nextIndex >= steps.length) {
      await seqRepo.completeEnrollment(db, enrollment.id, 'completed');
    } else {
      const nextStep = steps[nextIndex];
      const delayDays = (nextStep as { delay_days?: number }).delay_days ?? 0;
      const nextSendAt = new Date(Date.now() + delayDays * 86_400_000).toISOString();
      await seqRepo.setCurrentStep(db, enrollment.id, nextIndex, nextSendAt);
    }
    return;
  }

  // Has a condition: check if condition event has occurred
  const condition = step.condition;
  const executions = await seqRepo.getStepExecutions(db, enrollment.id);
  const conditionMet = executions.some((e: any) =>
    e.metadata?.trigger_event === condition.event ||
    e.metadata?.event === condition.event,
  );

  if (conditionMet) {
    // Condition met — advance
    const sequence = await seqRepo.getSequence(db, enrollment.tenant_id, enrollment.sequence_id);
    if (!sequence) return;
    const steps = sequence.steps as SequenceStep[];
    const nextIndex = stepIndex + 1;
    if (nextIndex >= steps.length) {
      await seqRepo.completeEnrollment(db, enrollment.id, 'completed');
    } else {
      const nextStep = steps[nextIndex];
      const delayDays = (nextStep as { delay_days?: number }).delay_days ?? 0;
      const nextSendAt = new Date(Date.now() + delayDays * 86_400_000).toISOString();
      await seqRepo.setCurrentStep(db, enrollment.id, nextIndex, nextSendAt);
    }
  } else {
    // Check timeout
    const enrolledAt = new Date(enrollment.created_at).getTime();
    const timeoutMs = condition.timeout_days * 86_400_000;
    if (Date.now() - enrolledAt > timeoutMs) {
      if (condition.timeout_branch != null) {
        // Jump to timeout branch step
        const sequence = await seqRepo.getSequence(db, enrollment.tenant_id, enrollment.sequence_id);
        if (!sequence) return;
        const steps = sequence.steps as SequenceStep[];
        const branchIdx = Math.min(condition.timeout_branch, steps.length - 1);
        const branchStep = steps[branchIdx];
        const delayDays = (branchStep as { delay_days?: number }).delay_days ?? 0;
        const nextSendAt = new Date(Date.now() + delayDays * 86_400_000).toISOString();
        await seqRepo.setCurrentStep(db, enrollment.id, branchIdx, nextSendAt);
      } else {
        await seqRepo.completeEnrollment(db, enrollment.id, 'timeout');
      }
    } else {
      // Re-check in 1 hour
      const recheckAt = new Date(Date.now() + 3_600_000).toISOString();
      await db.query(
        'UPDATE sequence_enrollments SET next_send_at = $1, updated_at = now() WHERE id = $2',
        [recheckAt, enrollment.id],
      );
    }
  }
}

async function executeBranchStep(
  db: DbPool,
  enrollment: any,
  sequence: seqRepo.SequenceRow,
  step: BranchStep,
  stepIndex: number,
): Promise<void> {
  const executions = await seqRepo.getStepExecutions(db, enrollment.id);
  const steps = sequence.steps as SequenceStep[];

  for (const condition of step.conditions) {
    let matched = false;

    switch (condition.trigger) {
      case 'replied':
        matched = (enrollment.exit_reason === 'replied') ||
          executions.some((e: any) => e.metadata?.trigger === 'replied');
        break;
      case 'opened':
        matched = executions.some((e: any) => e.metadata?.opened === true);
        break;
      case 'clicked':
        matched = executions.some((e: any) => e.metadata?.clicked === true);
        break;
      case 'goal_met':
        matched = !!enrollment.goal_met_at;
        break;
      case 'custom_event':
        matched = executions.some((e: any) => e.metadata?.event === condition.event);
        break;
    }

    if (matched) {
      const sequence = await seqRepo.getSequence(db, enrollment.tenant_id, enrollment.sequence_id);
      const branchDesc = condition.exit
        ? `Branch: ${condition.trigger} → exit`
        : `Branch: ${condition.trigger} → step ${(condition.jump_to_step ?? 0) + 1}`;

      // Activity for branch evaluation
      activityRepo.createActivity(db, enrollment.tenant_id, {
        type: 'note',
        subject: branchDesc,
        body: branchDesc,
        status: 'completed',
        subject_type: 'contact',
        subject_id: enrollment.contact_id,
        contact_id: enrollment.contact_id,
        source_agent: `sequence:${enrollment.sequence_id}`,
        occurred_at: new Date().toISOString(),
        detail: { enrollment_id: enrollment.id, step_index: stepIndex, condition },
      }).catch(() => {});

      if (condition.exit) {
        await seqRepo.completeEnrollment(db, enrollment.id, 'branch_exit');
      } else if (condition.jump_to_step != null) {
        const targetIdx = Math.min(condition.jump_to_step, steps.length - 1);
        const targetStep = steps[targetIdx];
        const delayDays = (targetStep as { delay_days?: number }).delay_days ?? 0;
        const nextSendAt = new Date(Date.now() + delayDays * 86_400_000).toISOString();
        await seqRepo.setCurrentStep(db, enrollment.id, targetIdx, nextSendAt);
      }
      return;
    }
  }

  // No branch matched — advance normally
  const nextIndex = stepIndex + 1;
  if (nextIndex >= steps.length) {
    await seqRepo.completeEnrollment(db, enrollment.id, 'completed');
  } else {
    const nextStep = steps[nextIndex];
    const delayDays = (nextStep as { delay_days?: number }).delay_days ?? 0;
    const nextSendAt = new Date(Date.now() + delayDays * 86_400_000).toISOString();
    await seqRepo.setCurrentStep(db, enrollment.id, nextIndex, nextSendAt);
  }
}

async function executeAiActionStep(
  db: DbPool,
  enrollment: any,
  sequence: seqRepo.SequenceRow,
  step: AiActionStep,
  stepIndex: number,
  varContext: Record<string, unknown>,
  contact: any,
): Promise<void> {
  const prompt = interpolate(step.prompt, varContext);

  // Build a concise context summary for the LLM
  const contextSummary = JSON.stringify({
    contact: {
      name: [(contact as any)?.first_name, (contact as any)?.last_name].filter(Boolean).join(' '),
      email: (contact as any)?.email,
      title: (contact as any)?.title,
      company: (contact as any)?.company_name,
    },
    sequence: sequence.name,
    step: stepIndex + 1,
    enrollment_variables: (enrollment as any).variables ?? {},
  }, null, 2);

  let result = `[AI action executed for contact ${enrollment.contact_id}]`;
  try {
    result = await callLLM(db, enrollment.tenant_id, {
      system: (sequence as any).ai_persona ?? 'You are a helpful sales assistant.',
      user: `Context:\n${contextSummary}\n\nTask: ${prompt}`,
    }) ?? result;
  } catch (err) {
    console.warn('[sequences] AI action LLM call failed:', err);
  }

  // Create Activity for the AI action — this also triggers context extraction
  const activity = await activityRepo.createActivity(db, enrollment.tenant_id, {
    type: 'note_added',
    subject: `AI action: ${prompt.slice(0, 80)}`,
    body: `[Sequence: ${sequence.name} — step ${stepIndex + 1}]\n\nPrompt: ${prompt}\n\nResult: ${result.slice(0, 500)}`,
    status: 'completed',
    subject_type: 'contact',
    subject_id: enrollment.contact_id,
    contact_id: enrollment.contact_id,
    performed_by: (enrollment as any).enrolled_by_actor_id ?? undefined,
    source_agent: `sequence:${sequence.id}`,
    occurred_at: new Date().toISOString(),
    detail: {
      sequence_id: sequence.id,
      sequence_name: sequence.name,
      enrollment_id: enrollment.id,
      step_index: stepIndex,
      prompt: prompt.slice(0, 500),
    },
  });

  // Fire-and-forget context extraction from the AI action result
  triggerExtraction(db, enrollment.tenant_id, activity.id).catch(() => {});

  const execution = await seqRepo.logStepExecution(db, {
    enrollment_id: enrollment.id,
    tenant_id: enrollment.tenant_id,
    step_index: stepIndex,
    step_type: 'ai_action',
    status: 'sent',
    metadata: { prompt: prompt.slice(0, 200), result: result.slice(0, 500) },
  });

  await db.query(
    `UPDATE sequence_step_executions SET activity_id = $1 WHERE id = $2`,
    [activity.id, execution.id],
  );
}

// ── AI content generation helper ───────────────────────────────────────────────

async function generateEmailContent(
  _db: DbPool,
  _enrollment: any,
  sequence: seqRepo.SequenceRow,
  step: EmailStep,
  varContext: Record<string, unknown>,
  contact: any,
): Promise<{ subject?: string; body_text?: string } | null> {
  try {
    const contactInfo = JSON.stringify({
      name: [(contact as any)?.first_name, (contact as any)?.last_name].filter(Boolean).join(' '),
      email: (contact as any)?.email,
      title: (contact as any)?.title,
      company: (contact as any)?.company_name,
      lifecycle_stage: (contact as any)?.lifecycle_stage,
    });

    const aiPrompt = step.ai_prompt
      ? interpolate(step.ai_prompt, varContext)
      : `Write a short, personalized sales email for this contact. Be concise and genuine.`;

    const systemPrompt = (sequence as any).ai_persona ??
      'You are a helpful sales assistant writing personalized outreach emails. Keep emails short, genuine, and focused on value. Return JSON: { "subject": "...", "body_text": "..." }';

    const text = await callLLM(_db, _enrollment.tenant_id, {
      system: systemPrompt,
      user: `Contact info:\n${contactInfo}\n\nTemplate subject: ${step.subject}\nTemplate body: ${step.body_text ?? ''}\n\nInstruction: ${aiPrompt}\n\nReturn only valid JSON: {"subject":"...","body_text":"..."}`,
    });

    if (text) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as { subject?: string; body_text?: string };
      }
    }
  } catch (err) {
    console.warn('[sequences] AI generation failed, using template:', err);
  }
  return null;
}

// ── Reply detection ────────────────────────────────────────────────────────────

/**
 * Called by the inbound email handler when a reply is received.
 * Matches the In-Reply-To header against sequence step execution records.
 */
export async function handleSequenceReply(
  db: DbPool,
  tenantId: UUID,
  inReplyToMsgId: string,
  fromEmail: string,
): Promise<void> {
  // Find step execution with matching provider_msg_id
  const result = await db.query(
    `SELECT sse.enrollment_id, se.sequence_id, se.contact_id, seq.exit_on_reply
     FROM sequence_step_executions sse
     JOIN sequence_enrollments se ON se.id = sse.enrollment_id
     JOIN sequences seq ON seq.id = se.sequence_id
     WHERE sse.tenant_id = $1
       AND sse.metadata->>'provider_msg_id' = $2
       AND se.status IN ('active','paused')
     LIMIT 1`,
    [tenantId, inReplyToMsgId],
  );

  if (!result.rows[0]) return;

  const { enrollment_id, sequence_id, exit_on_reply } = result.rows[0];

  // Log the reply event on the enrollment
  await db.query(
    `UPDATE sequence_enrollments
     SET metadata = COALESCE(metadata,'{}')::jsonb || jsonb_build_object('last_reply_from', $1, 'last_reply_at', $2),
         updated_at = now()
     WHERE id = $3`,
    [fromEmail, new Date().toISOString(), enrollment_id],
  );

  if (exit_on_reply) {
    await seqRepo.cancelEnrollment(db, enrollment_id, 'replied');
    emitEvent(db, {
      tenantId,
      eventType: 'sequence.contact_replied',
      actorType: 'system',
      objectType: 'sequence_enrollment',
      objectId: enrollment_id,
      afterData: { enrollment_id, sequence_id, from_email: fromEmail, exit_reason: 'replied' },
    }).catch(() => {});
  }
}

// ── Goal-event detection ───────────────────────────────────────────────────────

/**
 * Called from the event bus listener in index.ts for every CRM event.
 * Checks if any active enrollments in sequences with a matching goal_event should be completed.
 */
export async function handleSequenceGoalEvent(
  db: DbPool,
  tenantId: UUID,
  eventType: string,
  contactId: UUID | undefined,
): Promise<void> {
  if (!contactId) return;

  const result = await db.query(
    `SELECT se.id AS enrollment_id
     FROM sequence_enrollments se
     JOIN sequences seq ON seq.id = se.sequence_id
     WHERE se.tenant_id = $1
       AND se.contact_id = $2
       AND seq.goal_event = $3
       AND se.status = 'active'`,
    [tenantId, contactId, eventType],
  );

  for (const row of result.rows) {
    await db.query(
      `UPDATE sequence_enrollments
       SET status = 'completed', goal_met_at = now(), exit_reason = 'goal_met', updated_at = now()
       WHERE id = $1`,
      [row.enrollment_id],
    );
    emitEvent(db, {
      tenantId,
      eventType: 'sequence.goal_met',
      actorType: 'system',
      objectType: 'sequence_enrollment',
      objectId: row.enrollment_id,
      afterData: { enrollment_id: row.enrollment_id, goal_event: eventType },
    }).catch(() => {});
  }
}
