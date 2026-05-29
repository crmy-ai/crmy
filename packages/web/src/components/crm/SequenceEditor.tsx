// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * SequenceEditor — full-screen dialog for creating and editing sequences.
 *
 * Layout mirrors WorkflowEditor:
 *   ┌─ Header ─────────────────────────────────────────────────────────────────┐
 *   │  name · active toggle · HITL badge · [Save] · [Cancel]                   │
 *   ├─ Left: Settings (270px) ──┬─ Centre: Step flow ─────────────────────────┤
 *   │  goal_event               │  StepCard × n  (HITL steps are amber)        │
 *   │  exit_on_reply            │  [+ Add step]                                │
 *   │  ai_persona               │                                              │
 *   │  description              │                                              │
 *   └───────────────────────────┴──────────────────────────────────────────────┘
 */

import { useState, useCallback, useEffect } from 'react';
import { useSequence, useCreateSequence, useUpdateSequence } from '@/api/hooks';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import {
  ListOrdered, X, Loader2, UserCheck, AlertTriangle, FlaskConical, CheckCircle2, XCircle,
} from 'lucide-react';
import {
  TypedStepBuilder, SEQUENCE_TRIGGER_EVENTS,
  type SequenceStep,
} from '@/pages/Sequences';
import { EditorErrorBoundary } from './EditorErrorBoundary';

// ── Styles ────────────────────────────────────────────────────────────────────

const fieldCls   = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const areaCls    = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none';
const labelCls   = 'block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1';

function SequenceTestPanel({
  name,
  steps,
  goalEvent,
}: {
  name: string;
  steps: SequenceStep[];
  goalEvent: string;
}) {
  const issues: string[] = [];
  if (!name.trim()) issues.push('Add a sequence name before saving.');
  if (steps.length === 0) issues.push('Add at least one step.');
  steps.forEach((step, index) => {
    if (step.type === 'email') {
      if (!step.subject?.trim()) issues.push(`Step ${index + 1}: email subject is empty.`);
      if (!step.ai_generate && !step.body_text?.trim()) issues.push(`Step ${index + 1}: add body text or enable AI generation.`);
      if (step.ai_generate && !step.ai_prompt?.trim()) issues.push(`Step ${index + 1}: add an AI prompt.`);
    }
    if (step.type === 'notification' && !step.body?.trim()) issues.push(`Step ${index + 1}: notification message is empty.`);
    if (step.type === 'task' && !step.title?.trim()) issues.push(`Step ${index + 1}: task title is empty.`);
    if (step.type === 'webhook' && !step.url?.trim()) issues.push(`Step ${index + 1}: webhook URL is empty.`);
    if (step.type === 'ai_action' && !step.prompt?.trim()) issues.push(`Step ${index + 1}: AI action prompt is empty.`);
  });
  const totalDelayHours = steps.reduce((sum, step) => sum + Number(step.delay_hours ?? 0) + Number(step.delay_days ?? 0) * 24, 0);
  const ok = issues.length === 0;

  return (
    <div className="w-[320px] shrink-0 border-l border-border bg-muted/10 p-5 overflow-y-auto">
      <div className="mb-4 flex items-center gap-2">
        <div className={`rounded-lg p-2 ${ok ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
          {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Sequence test</p>
          <p className="text-xs text-muted-foreground">Checks this draft without saving or enrolling contacts.</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Journey</p>
          <p className="mt-2 text-sm text-foreground">{steps.length} step{steps.length === 1 ? '' : 's'}</p>
          <p className="text-xs text-muted-foreground">
            {totalDelayHours === 0 ? 'Runs immediately' : `About ${Math.round(totalDelayHours)} hours across delays`}
          </p>
          {goalEvent && <p className="mt-1 text-xs text-muted-foreground">Goal exits on {goalEvent}</p>}
        </div>

        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Readiness</p>
          {ok ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Ready to save as a draft.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {issues.map(issue => (
                <p key={issue} className="flex items-start gap-2 text-xs text-warning">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {issue}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SequenceEditorProps {
  open:        boolean;
  onClose:     () => void;
  /** Optional draft object used by templates */
  sequence?:    any;
  /** Supply just the ID; editor fetches the sequence itself */
  sequenceId?: string | null;
  onSaved?:    () => void;
}

// ── Settings panel ────────────────────────────────────────────────────────────

function SettingsPanel({
  description, onDescriptionChange,
  goalEvent, onGoalEventChange,
  exitOnReply, onExitOnReplyChange,
  exitOnUnsubscribe, onExitOnUnsubscribeChange,
  maxActiveEnrollments, onMaxActiveEnrollmentsChange,
  aiPersona, onAiPersonaChange,
}: {
  description:                    string;
  onDescriptionChange:            (v: string) => void;
  goalEvent:                      string;
  onGoalEventChange:              (v: string) => void;
  exitOnReply:                    boolean;
  onExitOnReplyChange:            (v: boolean) => void;
  exitOnUnsubscribe:              boolean;
  onExitOnUnsubscribeChange:      (v: boolean) => void;
  maxActiveEnrollments:           string;
  onMaxActiveEnrollmentsChange:   (v: string) => void;
  aiPersona:                      string;
  onAiPersonaChange:              (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Section heading */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <ListOrdered className="w-3.5 h-3.5 text-primary" />
        </div>
        <span className="text-xs font-bold text-foreground uppercase tracking-wider">Settings</span>
      </div>

      {/* Goal event */}
      <div>
        <label className={labelCls}>Goal event</label>
        <p className="text-xs text-muted-foreground mb-1.5">
          When this operational event fires for the contact, the sequence auto-completes.
        </p>
        <select
          value={goalEvent}
          onChange={e => onGoalEventChange(e.target.value)}
          className={fieldCls}
        >
          <option value="">None — run all steps</option>
          {SEQUENCE_TRIGGER_EVENTS.map(e => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
      </div>

      {/* Exit on reply */}
      <div className="flex items-start gap-3">
        <Switch
          id="exit-on-reply"
          checked={exitOnReply}
          onCheckedChange={onExitOnReplyChange}
          className="mt-0.5 shrink-0"
        />
        <div>
          <label htmlFor="exit-on-reply" className="text-xs font-medium text-foreground cursor-pointer">
            Exit on reply
          </label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Stop email steps when the contact replies to any email in this sequence.
          </p>
        </div>
      </div>

      {/* Exit on unsubscribe */}
      <div className="flex items-start gap-3">
        <Switch
          id="exit-on-unsubscribe"
          checked={exitOnUnsubscribe}
          onCheckedChange={onExitOnUnsubscribeChange}
          className="mt-0.5 shrink-0"
        />
        <div>
          <label htmlFor="exit-on-unsubscribe" className="text-xs font-medium text-foreground cursor-pointer">
            Exit on unsubscribe
          </label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Stop sending when a contact opts out. Recommended for CAN-SPAM / GDPR compliance.
          </p>
        </div>
      </div>

      {/* Max active enrollments */}
      <div>
        <label className={labelCls}>
          Max active enrollments
          <span className="ml-1 normal-case font-normal text-muted-foreground/60">(optional)</span>
        </label>
        <p className="text-xs text-muted-foreground mb-1.5">
          Cap the number of contacts actively progressing through this sequence. Leave blank for unlimited.
        </p>
        <input
          type="number"
          min="1"
          value={maxActiveEnrollments}
          onChange={e => onMaxActiveEnrollmentsChange(e.target.value)}
          placeholder="Unlimited"
          className={fieldCls}
        />
      </div>

      {/* AI Persona */}
      <div>
        <label className={labelCls}>AI persona / system prompt</label>
        <p className="text-xs text-muted-foreground mb-1.5">
          Used when AI-generate is enabled on email steps.
        </p>
        <textarea
          value={aiPersona}
          onChange={e => onAiPersonaChange(e.target.value)}
          rows={4}
          placeholder="You are a revenue teammate at Northstar Labs. Write concise, personalized emails focused on the customer's current priorities..."
          className={areaCls}
        />
      </div>

      {/* Description */}
      <div>
        <label className={labelCls}>
          Description
          <span className="ml-1 normal-case font-normal text-muted-foreground/60">(optional)</span>
        </label>
        <textarea
          value={description}
          onChange={e => onDescriptionChange(e.target.value)}
          placeholder="What is this sequence for?"
          rows={3}
          className={areaCls}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SequenceEditor({ open, onClose, sequence: sequenceProp, sequenceId, onSaved }: SequenceEditorProps) {
  // Self-fetch when only an ID is supplied
  const { data: fetchedData } = useSequence(sequenceId ?? '') as any;
  const sequence = sequenceProp ?? (sequenceId ? ((fetchedData as any)?.data ?? fetchedData) : undefined);

  const isEdit = Boolean(sequence?.id);

  const createSequence = useCreateSequence();
  const updateSequence = useUpdateSequence(sequence?.id ?? '') as any;

  // ── Editor state ─────────────────────────────────────────────────────────

  const [name,                  setName]                  = useState(() => sequence?.name        ?? '');
  const [description,           setDescription]           = useState(() => sequence?.description ?? '');
  const [isActive,              setIsActive]              = useState(() => sequence?.is_active   ?? false);
  const [goalEvent,             setGoalEvent]             = useState(() => sequence?.goal_event  ?? '');
  const [exitOnReply,           setExitOnReply]           = useState(() => sequence?.exit_on_reply ?? true);
  const [exitOnUnsubscribe,     setExitOnUnsubscribe]     = useState(() => sequence?.exit_on_unsubscribe ?? true);
  const [maxActiveEnrollments,  setMaxActiveEnrollments]  = useState(() =>
    sequence?.max_active_enrollments != null ? String(sequence.max_active_enrollments) : '',
  );
  const [aiPersona,             setAiPersona]             = useState(() => sequence?.ai_persona  ?? '');
  const [steps,                 setSteps]                 = useState<SequenceStep[]>(() =>
    Array.isArray(sequence?.steps) ? sequence.steps as SequenceStep[] : [],
  );

  const [errors,  setErrors]  = useState<Record<string, string>>({});
  const [saving,  setSaving]  = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  // Whether any step requires human approval
  const hasHITL = steps.some(s =>
    (s as any).require_approval === true,
  );

  // Reset state when dialog opens with new sequence data
  const resetFromSequence = useCallback((seq: any) => {
    setName(seq?.name ?? '');
    setDescription(seq?.description ?? '');
    setIsActive(seq?.is_active ?? true);
    setGoalEvent(seq?.goal_event ?? '');
    setExitOnReply(seq?.exit_on_reply ?? true);
    setExitOnUnsubscribe(seq?.exit_on_unsubscribe ?? true);
    setMaxActiveEnrollments(seq?.max_active_enrollments != null ? String(seq.max_active_enrollments) : '');
    setAiPersona(seq?.ai_persona ?? '');
    setSteps(Array.isArray(seq?.steps) ? seq.steps as SequenceStep[] : []);
    setErrors({});
    setTestOpen(false);
  }, []);

  const resetToBlank = useCallback(() => {
    setName('');
    setDescription('');
    setIsActive(false);
    setGoalEvent('');
    setExitOnReply(true);
    setExitOnUnsubscribe(true);
    setMaxActiveEnrollments('');
    setAiPersona('');
    setSteps([]);
    setErrors({});
    setTestOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (sequence) resetFromSequence(sequence);
    else resetToBlank();
  }, [open, sequence?.id, sequenceProp, sequenceId, resetFromSequence, resetToBlank]);

  // ── Validation ───────────────────────────────────────────────────────────

  /** Detect an opening {{ that is never closed, e.g. {{contact.name */
  const UNCLOSED_VAR = /\{\{(?![^{}]*\}\})/;

  /** String fields in sequence steps that support {{variables}} */
  const STEP_VAR_FIELDS: Record<string, string[]> = {
    email:        ['subject', 'body_text', 'body_html', 'ai_prompt'],
    notification: ['title', 'body'],
    webhook:      ['url', 'body_template'],
    ai_action:    ['prompt'],
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Enter a sequence name before saving.';
    if (steps.length === 0) e.steps = 'Add at least one step';

    // Variable syntax check
    steps.forEach((step, i) => {
      const fields = STEP_VAR_FIELDS[step.type] ?? [];
      for (const field of fields) {
        const val = (step as unknown as Record<string, unknown>)[field];
        if (typeof val === 'string' && UNCLOSED_VAR.test(val)) {
          e[`step_${i}_${field}`] = `Unclosed {{ in "${field}" on step ${i + 1} — did you forget }}?`;
          if (!e.steps) e.steps = `Variable syntax error in step ${i + 1}`;
        }
      }
    });

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const maxEnroll = maxActiveEnrollments.trim() ? Number(maxActiveEnrollments) : undefined;
      const payload = {
        name:                   name.trim(),
        description:            description.trim() || undefined,
        is_active:              isActive,
        goal_event:             goalEvent || undefined,
        exit_on_reply:          exitOnReply,
        exit_on_unsubscribe:    exitOnUnsubscribe,
        max_active_enrollments: maxEnroll && maxEnroll > 0 ? maxEnroll : null,
        ai_persona:             aiPersona.trim() || undefined,
        steps,
      };

      if (isEdit) {
        await updateSequence.mutateAsync(payload);
        toast({ title: 'Sequence saved' });
      } else {
        await createSequence.mutateAsync(payload);
        toast({ title: isActive ? 'Sequence created and activated' : 'Draft sequence saved' });
      }
      onSaved?.();
      onClose();
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-none p-0 gap-0 w-[min(95vw,1440px)] h-[min(90vh,920px)] flex flex-col overflow-hidden rounded-2xl [&>button]:hidden">
        <DialogTitle className="sr-only">
          {sequence ? 'Edit sequence' : 'Create sequence'}
        </DialogTitle>

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-background/95 backdrop-blur shrink-0">
          <ListOrdered className="w-5 h-5 text-primary shrink-0" />

          {/* Editable name */}
          <label className={`flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border bg-background px-3 py-1.5 transition-colors ${
            errors.name ? 'border-destructive' : 'border-border focus-within:border-primary/50'
          }`}>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sequence name
            </span>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }}
              placeholder="Name this sequence…"
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground placeholder:text-muted-foreground/60 outline-none"
            />
          </label>

          {errors.name && (
            <span className="text-xs text-destructive shrink-0">{errors.name}</span>
          )}

          {/* HITL indicator */}
          {hasHITL && (
            <Badge className="shrink-0 text-xs bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15">
              <UserCheck className="w-3 h-3 mr-1" />Requires human review
            </Badge>
          )}

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {/* Active toggle */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <span>{isActive ? 'Active' : isEdit ? 'Paused' : 'Paused draft'}</span>
            </div>

            <Button
              size="sm"
              variant={testOpen ? 'default' : 'outline'}
              onClick={() => setTestOpen(o => !o)}
              className="h-8 gap-1.5 text-xs"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Test
            </Button>

            <div className="w-px h-5 bg-border" />

            <Button size="sm" variant="outline" onClick={onClose} className="h-8 text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-8 text-xs gap-1.5">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? 'Save changes' : isActive ? 'Create active sequence' : 'Save draft'}
            </Button>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">

          {/* Left: Settings panel */}
          <div className="w-[270px] shrink-0 border-r border-border overflow-y-auto p-5 bg-muted/20">
            <SettingsPanel
              description={description}
              onDescriptionChange={setDescription}
              goalEvent={goalEvent}
              onGoalEventChange={setGoalEvent}
              exitOnReply={exitOnReply}
              onExitOnReplyChange={setExitOnReply}
              exitOnUnsubscribe={exitOnUnsubscribe}
              onExitOnUnsubscribeChange={setExitOnUnsubscribe}
              maxActiveEnrollments={maxActiveEnrollments}
              onMaxActiveEnrollmentsChange={setMaxActiveEnrollments}
              aiPersona={aiPersona}
              onAiPersonaChange={setAiPersona}
            />
          </div>

          {/* Centre: Step flow */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-[720px] mx-auto space-y-4">

              {/* Sequence start node */}
              <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <ListOrdered className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-primary mb-0.5">
                    Sequence Journey
                  </p>
                  <p className="text-sm font-medium text-foreground truncate">
                    {name || <span className="text-muted-foreground">Unnamed sequence</span>}
                  </p>
                  {goalEvent && (
                    <p className="text-xs text-muted-foreground mt-0.5">Goal: {goalEvent}</p>
                  )}
                </div>
              </div>

              {/* Step builder */}
              <EditorErrorBoundary label="step">
                <TypedStepBuilder steps={steps} onChange={setSteps} />
              </EditorErrorBoundary>

              {errors.steps && (
                <p className="text-xs text-destructive">{errors.steps}</p>
              )}

              {/* HITL notice at bottom */}
              {hasHITL && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    One or more steps require human review before executing. A handoff request will be created
                    in <strong>Approvals</strong> and the sequence will pause until a human approves.
                  </span>
                </div>
              )}

              <p className="text-center text-xs text-muted-foreground/40">
                {steps.length} step{steps.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {testOpen && (
            <SequenceTestPanel
              name={name}
              steps={steps}
              goalEvent={goalEvent}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
