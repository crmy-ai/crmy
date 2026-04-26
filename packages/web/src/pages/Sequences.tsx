// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TopBar } from '@/components/layout/TopBar';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { VariableAwareField } from '@/components/crm/VariableAwareField';
import { toast } from '@/hooks/use-toast';
import { useAppStore } from '@/store/appStore';
import {
  useSequences, useUpdateSequence,
  useDeleteSequence, useSequenceEnrollments,
  useUnenrollFromSequence, useContacts, useSequenceAnalytics,
  useEnrollmentActivities, useEnrollmentContext, useEnrollInSequenceWithObjective,
} from '@/api/hooks';
import {
  ListOrdered, Plus, Trash2, Pencil, Power, PowerOff, ChevronDown, ChevronUp,
  X, GripVertical, Users, CheckCircle2, Clock, XCircle, Loader2,
  PlayCircle, BarChart3, Mail, Bell, ClipboardList, Webhook,
  Timer, GitBranch, Bot, Zap, TrendingUp, Activity,
  ChevronRight, MessageSquare, Lightbulb, Variable, Target,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StepType = 'email' | 'notification' | 'task' | 'webhook' | 'wait' | 'branch' | 'ai_action';

interface BaseStep {
  type: StepType;
  delay_days?: number;
  delay_hours?: number;
}
interface EmailStep extends BaseStep {
  type: 'email';
  subject?: string;
  body_text?: string;
  body_html?: string;
  ai_generate?: boolean;
  ai_prompt?: string;
  require_approval?: boolean;
}
interface NotificationStep extends BaseStep {
  type: 'notification';
  title: string;
  body: string;
  actor_id?: string;
}
interface TaskStep extends BaseStep {
  type: 'task';
  title: string;
  notes?: string;
  assign_to?: string;
  due_in_days?: number;
}
interface WebhookStep extends BaseStep {
  type: 'webhook';
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body_template?: string;
}
interface WaitStep extends BaseStep {
  type: 'wait';
  wait_for?: 'delay' | 'reply' | 'goal_event' | 'custom_event';
  custom_event?: string;
}
interface BranchStep extends BaseStep {
  type: 'branch';
  condition: 'replied' | 'opened' | 'clicked' | 'goal_met' | 'custom_event';
  custom_event?: string;
  on_true_step?: number;
  on_false_step?: number;
}
interface AiActionStep extends BaseStep {
  type: 'ai_action';
  prompt: string;
  output_variable?: string;
  require_approval?: boolean;
}

export type SequenceStep = EmailStep | NotificationStep | TaskStep | WebhookStep | WaitStep | BranchStep | AiActionStep;

interface Sequence {
  id: string;
  name: string;
  description?: string;
  steps: SequenceStep[];
  is_active: boolean;
  channel_types?: string[];
  goal_event?: string;
  exit_on_reply?: boolean;
  ai_persona?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

interface Enrollment {
  id: string;
  sequence_id: string;
  contact_id: string;
  current_step: number;
  status: 'active' | 'completed' | 'paused' | 'cancelled';
  next_send_at?: string;
  exit_reason?: string;
  created_at: string;
  contact?: { first_name?: string; last_name?: string; email?: string };
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const STEP_TYPES: { value: StepType; label: string; icon: typeof Mail; color: string; desc: string }[] = [
  { value: 'email',        label: 'Email',         icon: Mail,         color: 'text-blue-500',    desc: 'Send a personalized email' },
  { value: 'notification', label: 'Notification',  icon: Bell,         color: 'text-amber-500',   desc: 'Notify a team member' },
  { value: 'task',         label: 'Task',          icon: ClipboardList,color: 'text-emerald-500', desc: 'Create a CRM task' },
  { value: 'webhook',      label: 'Webhook',       icon: Webhook,      color: 'text-purple-500',  desc: 'Call an external endpoint' },
  { value: 'wait',         label: 'Wait / Gate',   icon: Timer,        color: 'text-sky-500',     desc: 'Pause until a condition is met' },
  { value: 'branch',       label: 'Branch',        icon: GitBranch,    color: 'text-rose-500',    desc: 'Conditional fork based on engagement' },
  { value: 'ai_action',    label: 'AI Action',     icon: Bot,          color: 'text-violet-500',  desc: 'Run an AI prompt and store output' },
];

export const SEQUENCE_TRIGGER_EVENTS = [
  'contact.created', 'contact.updated', 'opportunity.created', 'opportunity.updated',
  'opportunity.stage_changed', 'opportunity.closed_won', 'opportunity.closed_lost',
  'activity.created', 'email.sent', 'email.replied',
  'hitl.submitted', 'hitl.resolved',
];

const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const textareaCls = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none';
const btnPrimary = 'px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors';
const btnOutline = 'px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors';

const ENROLLMENT_STATUS: Record<string, { label: string; cls: string; icon: typeof Mail }> = {
  active:    { label: 'Active',    cls: 'text-blue-500 bg-blue-500/10 border-blue-500/20',          icon: PlayCircle },
  completed: { label: 'Completed', cls: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  paused:    { label: 'Paused',    cls: 'text-amber-500 bg-amber-500/10 border-amber-500/20',       icon: Clock },
  cancelled: { label: 'Cancelled', cls: 'text-muted-foreground bg-muted border-border',             icon: XCircle },
};

export function stepIcon(type: StepType) {
  return STEP_TYPES.find(s => s.value === type)?.icon ?? Mail;
}
export function stepColor(type: StepType) {
  return STEP_TYPES.find(s => s.value === type)?.color ?? 'text-muted-foreground';
}
export function stepLabel(type: StepType) {
  return STEP_TYPES.find(s => s.value === type)?.label ?? type;
}
function contactName(e: Enrollment): string {
  if (!e.contact) return e.contact_id.slice(0, 8);
  const name = [e.contact.first_name, e.contact.last_name].filter(Boolean).join(' ');
  return name || e.contact.email || e.contact_id.slice(0, 8);
}
export function defaultStep(type: StepType): SequenceStep {
  const base = { delay_days: 1 };
  switch (type) {
    case 'email':        return { ...base, type, subject: '', body_text: '', ai_generate: false, require_approval: false };
    case 'notification': return { ...base, type, title: '', body: '' };
    case 'task':         return { ...base, type, title: '', due_in_days: 3 };
    case 'webhook':      return { ...base, type, url: '', method: 'POST' };
    case 'wait':         return { ...base, type, wait_for: 'delay' };
    case 'branch':       return { ...base, type, condition: 'replied' };
    case 'ai_action':    return { ...base, type, prompt: '', require_approval: false };
  }
}

// ─── Step Type Builder ─────────────────────────────────────────────────────────

export function StepFields({
  step, onChange, enrollmentVariables,
}: {
  step: SequenceStep;
  onChange: (patch: Partial<SequenceStep>) => void;
  enrollmentVariables?: Record<string, unknown>;
}) {
  const up = (patch: Record<string, unknown>) => onChange(patch as Partial<SequenceStep>);
  const vaf = (extraVars?: Record<string, unknown>) => ({ extraVariables: { ...enrollmentVariables, ...extraVars } });

  switch (step.type) {
    case 'email': return (
      <div className="space-y-2">
        <VariableAwareField
          label="Subject"
          value={step.subject ?? ''}
          onChange={v => up({ subject: v })}
          placeholder="e.g. Following up, {{contact.first_name}}"
          {...vaf()}
        />
        <VariableAwareField
          as="textarea"
          label="Body"
          value={step.body_text ?? ''}
          onChange={v => up({ body_text: v })}
          placeholder="Email body — supports {{variables}}"
          rows={4}
          {...vaf()}
        />
        <div className="flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!step.ai_generate} onChange={e => up({ ai_generate: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-primary" />
            <span className="text-xs font-medium text-foreground">AI generate content</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!step.require_approval} onChange={e => up({ require_approval: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-primary" />
            <span className="text-xs font-medium text-foreground">Require approval before send</span>
          </label>
        </div>
        {step.ai_generate && (
          <VariableAwareField
            as="textarea"
            label="AI prompt"
            value={step.ai_prompt ?? ''}
            onChange={v => up({ ai_prompt: v })}
            placeholder="Describe what to write, or leave blank for contact-aware generation"
            rows={2}
            {...vaf()}
          />
        )}
      </div>
    );
    case 'notification': return (
      <div className="space-y-2">
        <VariableAwareField
          label="Title"
          value={step.title ?? ''}
          onChange={v => up({ title: v })}
          placeholder="Notification title"
          {...vaf()}
        />
        <VariableAwareField
          as="textarea"
          label="Body"
          value={step.body ?? ''}
          onChange={v => up({ body: v })}
          placeholder="Notification body"
          rows={2}
          {...vaf()}
        />
      </div>
    );
    case 'task': return (
      <div className="space-y-2">
        <VariableAwareField
          label="Task title"
          value={step.title ?? ''}
          onChange={v => up({ title: v })}
          placeholder="e.g. Follow up with {{contact.first_name}}"
          {...vaf()}
        />
        <VariableAwareField
          as="textarea"
          label="Notes"
          value={step.notes ?? ''}
          onChange={v => up({ notes: v })}
          placeholder="Task notes (optional)"
          rows={2}
          {...vaf()}
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Due in</label>
          <input type="number" min={0} value={step.due_in_days ?? 3} onChange={e => up({ due_in_days: parseInt(e.target.value) || 0 })}
            className="w-20 h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring" />
          <span className="text-xs text-muted-foreground">days</span>
        </div>
      </div>
    );
    case 'webhook': return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <select value={step.method ?? 'POST'} onChange={e => up({ method: e.target.value as 'POST' | 'PUT' | 'PATCH' })}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring shrink-0">
            <option>POST</option><option>PUT</option><option>PATCH</option>
          </select>
          <input type="url" placeholder="https://hooks.zapier.com/..." value={step.url ?? ''} onChange={e => up({ url: e.target.value })} className={inputCls} />
        </div>
        <VariableAwareField
          as="textarea"
          label="Body template (JSON)"
          value={step.body_template ?? ''}
          onChange={v => up({ body_template: v })}
          placeholder='{"contact": "{{contact.first_name}}", "step": "{{enrollment.step}}"}'
          rows={3}
          {...vaf()}
        />
      </div>
    );
    case 'wait': return (
      <div className="space-y-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Wait until</label>
          <select value={step.wait_for ?? 'delay'} onChange={e => up({ wait_for: e.target.value as WaitStep['wait_for'] })}
            className={inputCls}>
            <option value="delay">Delay only (use step delay fields above)</option>
            <option value="reply">Contact replies to any email in sequence</option>
            <option value="goal_event">Sequence goal event fires</option>
            <option value="custom_event">Custom CRM event</option>
          </select>
        </div>
        {step.wait_for === 'custom_event' && (
          <input type="text" placeholder="Event type e.g. opportunity.stage_changed" value={step.custom_event ?? ''} onChange={e => up({ custom_event: e.target.value })} className={inputCls} />
        )}
      </div>
    );
    case 'branch': return (
      <div className="space-y-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Branch on</label>
          <select value={step.condition ?? 'replied'} onChange={e => up({ condition: e.target.value as BranchStep['condition'] })}
            className={inputCls}>
            <option value="replied">Contact replied</option>
            <option value="opened">Email opened</option>
            <option value="clicked">Link clicked</option>
            <option value="goal_met">Goal event met</option>
            <option value="custom_event">Custom event</option>
          </select>
        </div>
        {step.condition === 'custom_event' && (
          <input type="text" placeholder="Event type" value={step.custom_event ?? ''} onChange={e => up({ custom_event: e.target.value })} className={inputCls} />
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">If true → step #</label>
            <input type="number" min={0} placeholder="Next" value={step.on_true_step ?? ''} onChange={e => up({ on_true_step: parseInt(e.target.value) || undefined })}
              className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">If false → step #</label>
            <input type="number" min={0} placeholder="Next" value={step.on_false_step ?? ''} onChange={e => up({ on_false_step: parseInt(e.target.value) || undefined })}
              className={inputCls} />
          </div>
        </div>
      </div>
    );
    case 'ai_action': return (
      <div className="space-y-2">
        <VariableAwareField
          as="textarea"
          label="AI prompt"
          value={step.prompt ?? ''}
          onChange={v => up({ prompt: v })}
          placeholder="e.g. Draft a follow-up email based on {{contact.first_name}}'s context and store it"
          rows={4}
          {...vaf()}
        />
        <VariableAwareField
          label="Output variable name"
          value={step.output_variable ?? ''}
          onChange={v => up({ output_variable: v || undefined })}
          placeholder="e.g. draft_email (optional)"
          {...vaf()}
        />
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!step.require_approval} onChange={e => up({ require_approval: e.target.checked })}
            className="w-4 h-4 rounded border-border accent-primary" />
          <span className="text-xs font-medium text-foreground">Require human approval before executing</span>
        </label>
      </div>
    );
  }
}

// ─── Typed Step Builder ────────────────────────────────────────────────────────

export function TypedStepBuilder({
  steps, onChange, enrollmentVariables,
}: {
  steps: SequenceStep[];
  onChange: (s: SequenceStep[]) => void;
  enrollmentVariables?: Record<string, unknown>;
}) {
  const [addingType, setAddingType] = useState(false);

  const add = (type: StepType) => {
    onChange([...steps, defaultStep(type)]);
    setAddingType(false);
  };
  const remove = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<SequenceStep>) =>
    onChange(steps.map((s, idx) => idx === i ? ({ ...s, ...patch } as SequenceStep) : s));

  return (
    <div className="space-y-3">
      {steps.map((step, i) => {
        const Icon = stepIcon(step.type);
        return (
          <div key={i} className="rounded-lg border border-border bg-card overflow-hidden">
            {/* Step header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border">
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <Icon className={`w-3.5 h-3.5 shrink-0 ${stepColor(step.type)}`} />
              <span className="text-xs font-semibold text-foreground flex-1">
                Step {i + 1} · {stepLabel(step.type)}
              </span>
              {/* Type selector */}
              <select value={step.type} onChange={e => { const t = e.target.value as StepType; update(i, defaultStep(t)); }}
                className="h-7 px-2 rounded border border-border bg-background text-xs text-foreground outline-none focus:ring-1 focus:ring-ring">
                {STEP_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {/* Delay */}
              <div className="flex items-center gap-1">
                <input type="number" min={0} value={step.delay_days ?? 0}
                  onChange={e => update(i, { delay_days: parseInt(e.target.value) || 0 })}
                  className="w-14 h-7 px-2 rounded border border-border bg-background text-xs text-foreground outline-none focus:ring-1 focus:ring-ring" />
                <span className="text-xs text-muted-foreground">d</span>
                <input type="number" min={0} max={23} value={step.delay_hours ?? 0}
                  onChange={e => update(i, { delay_hours: parseInt(e.target.value) || 0 })}
                  className="w-14 h-7 px-2 rounded border border-border bg-background text-xs text-foreground outline-none focus:ring-1 focus:ring-ring" />
                <span className="text-xs text-muted-foreground">h</span>
              </div>
              <button onClick={() => remove(i)} className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Step body */}
            <div className="p-3">
              <StepFields step={step} onChange={patch => update(i, patch)} enrollmentVariables={enrollmentVariables} />
            </div>
          </div>
        );
      })}

      {/* Add step */}
      {addingType ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Choose step type</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {STEP_TYPES.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.value} onClick={() => add(t.value)}
                  className="flex items-start gap-2 p-2.5 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-left">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${t.color}`} />
                  <div>
                    <p className="text-xs font-semibold text-foreground">{t.label}</p>
                    <p className="text-xs text-muted-foreground leading-tight">{t.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <button onClick={() => setAddingType(false)} className="mt-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAddingType(true)} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
          <Plus className="w-3.5 h-3.5" /> Add step
        </button>
      )}

      {steps.length === 0 && !addingType && (
        <p className="text-xs text-muted-foreground">No steps yet. Add at least one step.</p>
      )}
    </div>
  );
}

// ─── Read-only step list ──────────────────────────────────────────────────────

function StepReadView({ steps }: { steps: SequenceStep[] }) {
  if (steps.length === 0) return (
    <div className="text-center py-6 text-muted-foreground">
      <ListOrdered className="w-6 h-6 mx-auto mb-2 opacity-30" />
      <p className="text-sm">No steps configured</p>
    </div>
  );
  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const Icon = stepIcon(step.type);
        const delayLabel = step.delay_days || step.delay_hours
          ? `+${step.delay_days ?? 0}d ${step.delay_hours ? `${step.delay_hours}h` : ''}`.trim()
          : 'Immediate';
        const preview = (() => {
          if (step.type === 'email') return step.subject ? `"${step.subject}"` : '(no subject)';
          if (step.type === 'notification') return step.title || '(no title)';
          if (step.type === 'task') return step.title || '(no title)';
          if (step.type === 'webhook') return step.url || '(no URL)';
          if (step.type === 'wait') return `Wait for: ${step.wait_for ?? 'delay'}`;
          if (step.type === 'branch') return `Branch on: ${step.condition ?? 'replied'}`;
          if (step.type === 'ai_action') return step.prompt ? step.prompt.slice(0, 60) + (step.prompt.length > 60 ? '…' : '') : '(no prompt)';
          return '';
        })();
        return (
          <div key={i} className="flex gap-3 items-start">
            <div className="flex flex-col items-center shrink-0 pt-0.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${STEP_TYPES.find(s => s.value === step.type)?.color?.replace('text-', 'bg-')?.replace('500', '500/15') ?? 'bg-muted'}`}>
                <Icon className={`w-3 h-3 ${stepColor(step.type)}`} />
              </div>
              {i < steps.length - 1 && <div className="w-px flex-1 bg-border mt-1 min-h-[16px]" />}
            </div>
            <div className="flex-1 pb-2 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className="text-xs font-semibold text-foreground">{stepLabel(step.type)}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">{delayLabel}</span>
                {step.type === 'email' && step.ai_generate && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 border border-violet-500/20">AI</span>
                )}
                {(step.type === 'email' || step.type === 'ai_action') && step.require_approval && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">Needs approval</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">{preview}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Enrollment Sandbox Card (expanded) ──────────────────────────────────────

function EnrollmentSandbox({ enrollment, totalSteps }: { enrollment: Enrollment & { objective?: string; enrolled_by_name?: string }; totalSteps: number }) {
  const [sandboxTab, setSandboxTab] = useState<'timeline' | 'context' | 'variables'>('timeline');
  const { data: activitiesData, isLoading: actLoading } = useEnrollmentActivities(enrollment.id) as { data: { data: any[] } | undefined; isLoading: boolean };
  const { data: contextData, isLoading: ctxLoading } = useEnrollmentContext(enrollment.id) as { data: { data: any[] } | undefined; isLoading: boolean };

  const activities = activitiesData?.data ?? [];
  const contextEntries = contextData?.data ?? [];

  const sandboxTabs = [
    { key: 'timeline', label: 'Timeline', icon: MessageSquare, count: activities.length },
    { key: 'context',  label: 'Context',  icon: Lightbulb,     count: contextEntries.length },
    { key: 'variables', label: 'Variables', icon: Variable,    count: Object.keys((enrollment as any).variables ?? {}).length },
  ] as const;

  return (
    <div className="border-t border-border bg-background/50">
      {/* Sub-tab bar */}
      <div className="flex gap-0.5 px-3 pt-2 pb-0">
        {sandboxTabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setSandboxTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-xs font-medium transition-colors border-b-2 ${
                sandboxTab === t.key
                  ? 'border-orange-500 text-orange-500 bg-orange-500/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}>
              <Icon className="w-3 h-3" />
              {t.label}
              {t.count > 0 && (
                <span className="text-xs px-1 rounded-full bg-muted text-muted-foreground">{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sub-tab content */}
      <div className="p-3 pt-2 space-y-1.5 max-h-64 overflow-y-auto">
        {sandboxTab === 'timeline' && (
          actLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : activities.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No activities yet — step executions will appear here once this sequence runs.</p>
          ) : (
            activities.map((a: any) => (
              <div key={a.id} className="flex gap-2 items-start">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500/60 mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{a.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.type.replace(/_/g, ' ')} · {new Date(a.occurred_at ?? a.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))
          )
        )}
        {sandboxTab === 'context' && (
          ctxLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : contextEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No extracted context yet — auto-extraction runs after each email or AI action step.</p>
          ) : (
            contextEntries.map((c: any) => (
              <div key={c.id} className="flex gap-2 items-start">
                <Lightbulb className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{c.title ?? c.context_type}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{c.body}</p>
                </div>
                {c.confidence != null && (
                  <span className="text-xs text-muted-foreground shrink-0">{Math.round(c.confidence * 100)}%</span>
                )}
              </div>
            ))
          )
        )}
        {sandboxTab === 'variables' && (
          <div className="space-y-1">
            {Object.entries((enrollment as any).variables ?? {}).length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No custom variables set for this enrollment.</p>
            ) : (
              Object.entries((enrollment as any).variables ?? {}).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/40 border border-border">
                  <span className="font-mono text-xs text-muted-foreground shrink-0">{`{{variables.${k}}}`}</span>
                  <span className="text-xs text-foreground flex-1 truncate">{String(v)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Enrollment Tab ───────────────────────────────────────────────────────────

function EnrollmentTab({ sequence }: { sequence: Sequence }) {
  const { data, isLoading } = useSequenceEnrollments({ sequence_id: sequence.id, limit: 100 }) as {
    data: { data: (Enrollment & { objective?: string; enrolled_by_name?: string })[] } | undefined; isLoading: boolean;
  };
  const unenroll = useUnenrollFromSequence();
  const enrollWithObjective = useEnrollInSequenceWithObjective();
  const { data: contactsData } = useContacts({ limit: 200 }) as { data: { data: any[] } | undefined };
  const [contactId, setContactId] = useState('');
  const [objective, setObjective] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const enrollments = data?.data ?? [];
  const contacts = contactsData?.data ?? [];
  const filtered = statusFilter === 'all' ? enrollments : enrollments.filter(e => e.status === statusFilter);

  const handleEnroll = async () => {
    if (!contactId) return;
    try {
      await enrollWithObjective.mutateAsync({
        sequence_id: sequence.id,
        contact_id: contactId,
        objective: objective.trim() || undefined,
      });
      setContactId('');
      setObjective('');
      toast({ title: 'Contact enrolled' });
    } catch (err: any) {
      toast({ title: err?.message ?? 'Enrollment failed', variant: 'destructive' });
    }
  };

  const handleUnenroll = async (id: string) => {
    try {
      await unenroll.mutateAsync(id);
      if (expandedId === id) setExpandedId(null);
      toast({ title: 'Enrollment cancelled' });
    } catch {
      toast({ title: 'Failed to cancel enrollment', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Quick enroll form */}
      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Enroll Contact</p>
        <div className="flex gap-2">
          <select value={contactId} onChange={e => setContactId(e.target.value)} className={`${inputCls} flex-1`}>
            <option value="">Select a contact…</option>
            {contacts.map((c: any) => {
              const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || c.id;
              return <option key={c.id} value={c.id}>{name}</option>;
            })}
          </select>
          <button onClick={handleEnroll} disabled={!contactId || enrollWithObjective.isPending} className={`${btnPrimary} shrink-0`}>
            {enrollWithObjective.isPending ? 'Enrolling…' : 'Enroll'}
          </button>
        </div>
        <div className="space-y-1">
          <input
            type="text"
            placeholder="Objective (optional) — e.g. Close Q1 renewal, Warm up for demo"
            value={objective}
            onChange={e => setObjective(e.target.value)}
            className={`${inputCls} text-xs`}
          />
          <p className="text-xs text-muted-foreground">
            <Target className="w-3 h-3 inline-block mr-0.5 align-middle" />
            Setting an objective gives agents context when working with this contact.
          </p>
        </div>
      </div>

      {/* Status filters */}
      <div className="flex gap-1 flex-wrap">
        {['all', 'active', 'completed', 'paused', 'cancelled'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
              statusFilter === s ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="ml-1 opacity-60">
              {s === 'all' ? enrollments.length : enrollments.filter(e => e.status === s).length}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No enrollments{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(e => {
            const cfg = ENROLLMENT_STATUS[e.status] ?? ENROLLMENT_STATUS.active;
            const StatusIcon = cfg.icon;
            const isExpanded = expandedId === e.id;
            const isActive = e.status === 'active' || e.status === 'paused';

            return (
              <div key={e.id} className="rounded-lg border border-border bg-card overflow-hidden">
                {/* Card header */}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-semibold shrink-0 ${cfg.cls}`}>
                    <StatusIcon className="w-3 h-3" /> {cfg.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{contactName(e)}</p>
                    <p className="text-xs text-muted-foreground">
                      Step {e.current_step + 1}/{sequence.steps.length}
                      {e.next_send_at && ` · Next ${new Date(e.next_send_at).toLocaleDateString()}`}
                      {e.exit_reason && ` · ${e.exit_reason.replace(/_/g, ' ')}`}
                      {e.objective && (
                        <span className="ml-1 text-orange-500 font-medium">· "{e.objective}"</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isActive && (
                      <button onClick={() => handleUnenroll(e.id)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Cancel enrollment">
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => setExpandedId(isExpanded ? null : e.id)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title={isExpanded ? 'Collapse' : 'Expand sandbox'}>
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                {/* Sandbox panel */}
                {isExpanded && (
                  <EnrollmentSandbox enrollment={e} totalSteps={sequence.steps.length} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────

function AnalyticsTab({ sequenceId }: { sequenceId: string }) {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const { data, isLoading } = useSequenceAnalytics(sequenceId, period) as {
    data: any; isLoading: boolean;
  };

  if (isLoading) return <div className="text-sm text-muted-foreground py-4">Loading analytics…</div>;
  if (!data) return <div className="text-sm text-muted-foreground py-4">No analytics yet</div>;

  const funnelRows = [
    { label: 'Total Enrolled', value: data.total_enrolled, color: 'bg-blue-500' },
    { label: 'Active',         value: data.total_active,   color: 'bg-sky-400' },
    { label: 'Completed',      value: data.total_completed, color: 'bg-emerald-500' },
    { label: 'Exited',         value: data.total_exited,   color: 'bg-rose-400' },
    { label: 'Paused',         value: data.total_paused,   color: 'bg-amber-400' },
  ];
  const rateRows = [
    { label: 'Open Rate',       value: data.open_rate,       icon: Activity },
    { label: 'Click Rate',      value: data.click_rate,      icon: TrendingUp },
    { label: 'Reply Rate',      value: data.reply_rate,      icon: Mail },
    { label: 'Completion Rate', value: data.completion_rate, icon: CheckCircle2 },
  ];
  const maxEnrolled = data.total_enrolled || 1;

  return (
    <div className="space-y-5">
      {/* Funnel */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Enrollment Funnel</p>
        <div className="space-y-1.5">
          {funnelRows.map(r => (
            <div key={r.label} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-28 shrink-0">{r.label}</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full ${r.color}`} style={{ width: `${Math.min((r.value / maxEnrolled) * 100, 100)}%` }} />
              </div>
              <span className="text-xs font-semibold text-foreground w-8 text-right">{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Email rates */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Email Engagement</p>
        <div className="grid grid-cols-2 gap-2">
          {rateRows.map(r => {
            const Icon = r.icon;
            return (
              <div key={r.label} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{r.label}</span>
                </div>
                <span className="text-xl font-bold text-foreground">{r.value}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Step metrics */}
      {data.step_metrics?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Per-Step Execution</p>
          <div className="space-y-1">
            {data.step_metrics.map((sm: any) => {
              const Icon = stepIcon(sm.step_type as StepType);
              return (
                <div key={sm.step_index} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-card text-xs">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${stepColor(sm.step_type as StepType)}`} />
                  <span className="text-muted-foreground w-14 shrink-0">Step {sm.step_index + 1}</span>
                  <span className="flex-1 font-medium text-foreground">{stepLabel(sm.step_type as StepType)}</span>
                  <span className="text-emerald-500">{sm.sent} sent</span>
                  {sm.failed > 0 && <span className="text-destructive">{sm.failed} failed</span>}
                  {sm.approval_pending > 0 && <span className="text-amber-500">{sm.approval_pending} pending</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Period selector + rollup */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">History</p>
          <div className="flex gap-1">
            {(['day', 'week', 'month'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${period === p ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {data.rollup?.length === 0 ? (
          <p className="text-xs text-muted-foreground">No rollup data yet — history builds after 24h</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {data.rollup?.slice(0, 30).map((r: any) => (
              <div key={r.period_start} className="flex items-center gap-3 text-xs text-muted-foreground px-2 py-1.5 rounded hover:bg-muted/50">
                <span className="font-mono w-24 shrink-0">{r.period_start}</span>
                <span className="text-foreground">{r.enrolled_count} enrolled</span>
                <span>{r.emails_sent} sent</span>
                <span className="text-emerald-500">{r.completed_count} completed</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sequence Row ─────────────────────────────────────────────────────────────

type RowTab = 'steps' | 'enrollments' | 'analytics';

function SequenceRow({ sequence }: { sequence: Sequence }) {
  const { openSequenceEditor } = useAppStore();
  const update = useUpdateSequence(sequence.id);
  const del = useDeleteSequence(sequence.id);
  const [tab, setTab] = useState<RowTab>('steps');
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toggling, setToggling] = useState(false);

  // Channel type icons
  const channels = sequence.channel_types ?? ['email'];
  const hasMultiChannel = channels.length > 1 || !channels.includes('email');

  const handleToggleActive = async () => {
    setToggling(true);
    try {
      await update.mutateAsync({ is_active: !sequence.is_active });
      toast({ title: sequence.is_active ? 'Sequence paused' : 'Sequence activated' });
    } catch {
      toast({ title: 'Failed to update', variant: 'destructive' });
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    try {
      await del.mutateAsync();
      toast({ title: 'Sequence deleted' });
    } catch { toast({ title: 'Failed to delete', variant: 'destructive' }); }
  };

  const TABS: { key: RowTab; label: string; icon: typeof ListOrdered }[] = [
    { key: 'steps',       label: 'Steps',     icon: ListOrdered },
    { key: 'enrollments', label: 'Contacts',  icon: Users },
    { key: 'analytics',   label: 'Analytics', icon: BarChart3 },
  ];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${sequence.is_active ? 'bg-primary/15' : 'bg-muted'}`}>
          {hasMultiChannel ? (
            <Zap className={`w-4 h-4 ${sequence.is_active ? 'text-primary' : 'text-muted-foreground'}`} />
          ) : (
            <Mail className={`w-4 h-4 ${sequence.is_active ? 'text-blue-500' : 'text-muted-foreground'}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-semibold text-foreground truncate">{sequence.name}</span>
            <Badge variant={sequence.is_active ? 'default' : 'secondary'} className="text-xs shrink-0">
              {sequence.is_active ? 'Active' : 'Paused'}
            </Badge>
            {sequence.tags?.map(tag => (
              <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">{tag}</span>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span>{sequence.steps.length} step{sequence.steps.length !== 1 ? 's' : ''}</span>
            {sequence.goal_event && <span>goal: <span className="font-mono">{sequence.goal_event}</span></span>}
            {sequence.description && <span className="truncate max-w-[240px]">{sequence.description}</span>}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Toggle active */}
          <button
            onClick={handleToggleActive}
            disabled={toggling}
            title={sequence.is_active ? 'Pause' : 'Activate'}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
          >
            {toggling
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : sequence.is_active
                ? <Power className="w-4 h-4 text-emerald-500" />
                : <PowerOff className="w-4 h-4" />}
          </button>

          {/* Edit */}
          <button
            onClick={() => openSequenceEditor(sequence.id)}
            title="Edit sequence"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <Pencil className="w-4 h-4" />
          </button>

          {/* Delete */}
          {!confirmDelete ? (
            <button
              onClick={() => { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }}
              title="Delete"
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={handleDelete} className="text-xs font-semibold text-destructive hover:underline px-1">
                Delete
              </button>
              <button onClick={() => setConfirmDelete(false)} className="p-1 text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Expand */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="border-t border-border">
              {/* Tab bar */}
              <div className="flex border-b border-border px-4">
                {TABS.map(({ key, label, icon: Icon }) => (
                  <button key={key} onClick={() => setTab(key)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                      tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}>
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="p-4 bg-muted/10 space-y-4">
                {tab === 'steps' && <StepReadView steps={sequence.steps as SequenceStep[]} />}
                {tab === 'enrollments' && <EnrollmentTab sequence={sequence} />}
                {tab === 'analytics' && <AnalyticsTab sequenceId={sequence.id} />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const SEQ_SORT_OPTIONS: SortOption[] = [
  { key: 'name',       label: 'Name'    },
  { key: 'created_at', label: 'Created' },
  { key: 'step_count', label: 'Steps'   },
];

export default function SequencesPage({ embedded }: { embedded?: boolean } = {}) {
  const { openSequenceEditor } = useAppStore();
  const { data, isLoading } = useSequences({ limit: 50 }) as { data: { data: Sequence[] } | undefined; isLoading: boolean };
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const sequences = data?.data ?? [];
  const active = sequences.filter(s => s.is_active).length;

  // Derive tag options dynamically from loaded sequences
  const tagOptions = useMemo(() => {
    const seen = new Set<string>();
    sequences.forEach(s => s.tags?.forEach((t: string) => seen.add(t)));
    return Array.from(seen).sort().map(t => ({ value: t, label: t }));
  }, [sequences]);

  const filterConfigs: FilterConfig[] = [
    { key: 'status', label: 'Status', options: [
      { value: 'active',   label: 'Active'   },
      { value: 'inactive', label: 'Inactive' },
    ]},
    ...(tagOptions.length > 0 ? [{ key: 'tags', label: 'Tags', options: tagOptions }] : []),
  ];

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => { const next = { ...prev }; if (values.length === 0) delete next[key]; else next[key] = values; return next; });
  };
  const handleSortChange = (key: string) => {
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const filtered = useMemo(() => {
    let result = [...sequences];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.tags ?? []).some((t: string) => t.toLowerCase().includes(q)),
      );
    }

    if (activeFilters.status?.length) {
      result = result.filter(s =>
        activeFilters.status.some(v => v === 'active' ? s.is_active : !s.is_active),
      );
    }

    if (activeFilters.tags?.length) {
      result = result.filter(s =>
        activeFilters.tags.some(tag => s.tags?.includes(tag)),
      );
    }

    if (sort) {
      result.sort((a, b) => {
        let aVal: string | number = sort.key === 'step_count' ? a.steps.length
          : (a[sort.key as keyof Sequence] ?? '') as string;
        let bVal: string | number = sort.key === 'step_count' ? b.steps.length
          : (b[sort.key as keyof Sequence] ?? '') as string;
        if (typeof aVal === 'number' && typeof bVal === 'number')
          return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
        return sort.dir === 'asc'
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });
    }

    return result;
  }, [sequences, search, activeFilters, sort]);

  return (
    <div className={embedded ? 'flex-1 min-h-0 flex flex-col' : 'flex flex-col h-full'}>
      {!embedded && (
        <TopBar
          title="Sequences"
          icon={Zap}
          iconClassName="text-orange-500"
          description={`${sequences.length} sequence${sequences.length !== 1 ? 's' : ''} · ${active} active`}
        />
      )}

      <ListToolbar
        searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search sequences..."
        filters={filterConfigs} activeFilters={activeFilters} onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})} sortOptions={SEQ_SORT_OPTIONS} currentSort={sort}
        onSortChange={handleSortChange} entityType="sequences"
        onAdd={() => openSequenceEditor(null)} addLabel="New Sequence"
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pt-2 pb-24 md:pb-6">
        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-muted/50 animate-pulse" />)}</div>
        ) : sequences.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Zap className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-display font-semibold text-foreground mb-1">No sequences yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
              Build multi-channel, AI-personalized sequences with email, tasks, webhooks, branches, and AI actions.
            </p>
            <button onClick={() => openSequenceEditor(null)} className={btnPrimary}>
              <span className="flex items-center gap-1.5"><Plus className="w-4 h-4" /> Create your first sequence</span>
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <Zap className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">No sequences match your search</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(seq => <SequenceRow key={seq.id} sequence={seq} />)}
          </div>
        )}
      </div>
    </div>
  );
}
