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

import { useState, useCallback } from 'react';
import { useSequence, useCreateSequence, useUpdateSequence } from '@/api/hooks';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import {
  ListOrdered, X, Loader2, UserCheck, AlertTriangle,
} from 'lucide-react';
import {
  TypedStepBuilder, SEQUENCE_TRIGGER_EVENTS,
  type SequenceStep,
} from '@/pages/Sequences';

// ── Styles ────────────────────────────────────────────────────────────────────

const fieldCls   = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const areaCls    = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none';
const labelCls   = 'block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SequenceEditorProps {
  open:        boolean;
  onClose:     () => void;
  /** Supply just the ID; editor fetches the sequence itself */
  sequenceId?: string | null;
  onSaved?:    () => void;
}

// ── Settings panel ────────────────────────────────────────────────────────────

function SettingsPanel({
  description, onDescriptionChange,
  goalEvent, onGoalEventChange,
  exitOnReply, onExitOnReplyChange,
  aiPersona, onAiPersonaChange,
}: {
  description:          string;
  onDescriptionChange:  (v: string) => void;
  goalEvent:            string;
  onGoalEventChange:    (v: string) => void;
  exitOnReply:          boolean;
  onExitOnReplyChange:  (v: boolean) => void;
  aiPersona:            string;
  onAiPersonaChange:    (v: string) => void;
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
        <p className="text-[10px] text-muted-foreground mb-1.5">
          When this CRM event fires for the contact, the sequence auto-completes.
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
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Stop email steps when the contact replies to any email in this sequence.
          </p>
        </div>
      </div>

      {/* AI Persona */}
      <div>
        <label className={labelCls}>AI persona / system prompt</label>
        <p className="text-[10px] text-muted-foreground mb-1.5">
          Used when AI-generate is enabled on email steps.
        </p>
        <textarea
          value={aiPersona}
          onChange={e => onAiPersonaChange(e.target.value)}
          rows={4}
          placeholder="You are a sales development rep at Acme Corp. Write concise, personalized emails focused on the prospect's pain around..."
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

export function SequenceEditor({ open, onClose, sequenceId, onSaved }: SequenceEditorProps) {
  // Self-fetch when only an ID is supplied
  const { data: fetchedData } = useSequence(sequenceId ?? '') as any;
  const sequence = sequenceId ? ((fetchedData as any)?.data ?? fetchedData) : undefined;

  const isEdit = Boolean(sequence?.id);

  const createSequence = useCreateSequence();
  const updateSequence = useUpdateSequence(sequence?.id ?? '') as any;

  // ── Editor state ─────────────────────────────────────────────────────────

  const [name,        setName]        = useState(() => sequence?.name        ?? '');
  const [description, setDescription] = useState(() => sequence?.description ?? '');
  const [isActive,    setIsActive]    = useState(() => sequence?.is_active   ?? true);
  const [goalEvent,   setGoalEvent]   = useState(() => sequence?.goal_event  ?? '');
  const [exitOnReply, setExitOnReply] = useState(() => sequence?.exit_on_reply ?? true);
  const [aiPersona,   setAiPersona]   = useState(() => sequence?.ai_persona  ?? '');
  const [steps,       setSteps]       = useState<SequenceStep[]>(() =>
    Array.isArray(sequence?.steps) ? sequence.steps as SequenceStep[] : [],
  );

  const [errors,  setErrors]  = useState<Record<string, string>>({});
  const [saving,  setSaving]  = useState(false);

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
    setAiPersona(seq?.ai_persona ?? '');
    setSteps(Array.isArray(seq?.steps) ? seq.steps as SequenceStep[] : []);
    setErrors({});
  }, []);

  // ── Validation ───────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (steps.length === 0) e.steps = 'Add at least one step';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        name:          name.trim(),
        description:   description.trim() || undefined,
        is_active:     isActive,
        goal_event:    goalEvent || undefined,
        exit_on_reply: exitOnReply,
        ai_persona:    aiPersona.trim() || undefined,
        steps,
      };

      if (isEdit) {
        await updateSequence.mutateAsync(payload);
        toast({ title: 'Sequence saved' });
      } else {
        await createSequence.mutateAsync(payload);
        toast({ title: 'Sequence created' });
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
        if (v && sequence) resetFromSequence(sequence);
      }}
    >
      <DialogContent className="max-w-none p-0 gap-0 w-[min(95vw,1440px)] h-[min(90vh,920px)] flex flex-col overflow-hidden rounded-2xl">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-background/95 backdrop-blur shrink-0">
          <ListOrdered className="w-5 h-5 text-primary shrink-0" />

          {/* Editable name */}
          <input
            value={name}
            onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }}
            placeholder="Sequence name…"
            className="flex-1 bg-transparent text-base font-bold text-foreground placeholder:text-muted-foreground/50 outline-none min-w-0"
          />

          {errors.name && (
            <span className="text-xs text-destructive shrink-0">{errors.name}</span>
          )}

          {/* HITL indicator */}
          {hasHITL && (
            <Badge className="shrink-0 text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15">
              <UserCheck className="w-3 h-3 mr-1" />Requires human review
            </Badge>
          )}

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {/* Active toggle */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <span>{isActive ? 'Active' : 'Paused'}</span>
            </div>

            <div className="w-px h-5 bg-border" />

            <Button size="sm" variant="outline" onClick={onClose} className="h-8 text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-8 text-xs gap-1.5">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? 'Save changes' : 'Create'}
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
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-0.5">
                    Sequence Journey
                  </p>
                  <p className="text-sm font-medium text-foreground truncate">
                    {name || <span className="text-muted-foreground">Unnamed sequence</span>}
                  </p>
                  {goalEvent && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">Goal: {goalEvent}</p>
                  )}
                </div>
              </div>

              {/* Step builder */}
              <TypedStepBuilder steps={steps} onChange={setSteps} />

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

              <p className="text-center text-[10px] text-muted-foreground/40">
                {steps.length} step{steps.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
