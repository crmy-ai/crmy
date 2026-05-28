// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * WorkflowEditor — full-screen dialog for creating and editing automations.
 *
 * Layout:
 *   ┌─ Header ────────────────────────────────────────────────────────────────┐
 *   │  name · active toggle · [Test ▸] · [Save] · [Cancel]                   │
 *   ├─ Left: Trigger config ──────┬─ Centre: Action flow ────────────────────┤
 *   │  event combobox             │  TRIGGER node                             │
 *   │  conditions filter          │  ActionCard × n  (HITL cards are amber)  │
 *   │  description                │  [+ Add action]                           │
 *   │                             ├─ Right: Test panel (collapsible) ─────────┤
 *   │                             │  payload editor · dry-run results         │
 *   └─────────────────────────────┴───────────────────────────────────────────┘
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useCreateWorkflow, useUpdateWorkflow, useTestWorkflow, useTestDraftWorkflow, useDraftWorkflowContentPreview, useSequences, useWorkflow,
  useSystemsOfRecord, useSystemMappings, useWhoAmI,
} from '@/api/hooks';
import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ToastAction } from '@/components/ui/toast';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import {
  Zap, X, Plus, Loader2, ChevronUp, ChevronDown, Trash2,
  FlaskConical, CheckCircle2, XCircle, Bot, UserCheck,
  Play, ArrowRight, AlertTriangle, Sparkles, Check,
} from 'lucide-react';
import {
  TRIGGER_EVENTS, ACTION_TYPES, VISIBLE_ACTION_TYPES, ACTION_GROUPS, ACTION_GROUP_HELP,
  isActionValid, filterToConditions, conditionsToFilter,
  getSuggestionsForTrigger, getSamplePayload,
  type FilterCondition,
} from '@/lib/workflowConstants';
import { WorkflowFilterBuilder } from './WorkflowFilterBuilder';
import { VarField } from '@/components/ui/VarField';
import { EditorErrorBoundary } from './EditorErrorBoundary';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActionDraft = { type: string; config: Record<string, string> };

export interface WorkflowEditorProps {
  open:        boolean;
  onClose:     () => void;
  /** Existing workflow object — omit for create mode */
  workflow?:   any;
  /** Alternatively supply just the ID; editor will fetch the workflow itself */
  workflowId?: string | null;
  onSaved?:    () => void;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const fieldCls    = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const smFieldCls  = 'w-full h-8 px-2.5 rounded-md border border-border bg-background text-xs placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const areaCls     = 'w-full px-2.5 py-2 rounded-md border border-border bg-background text-xs placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none font-mono leading-relaxed';
const labelCls    = 'block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1';

// ── Helpers ───────────────────────────────────────────────────────────────────

function requiresApproval(action: ActionDraft): boolean {
  const def = ACTION_TYPES.find(a => a.value === action.type);
  if (def?.isHITL) return true;
  return action.config.require_approval === 'true';
}

// ── Trigger combobox ──────────────────────────────────────────────────────────

function TriggerCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const lower   = value.toLowerCase();
  const matches = value.trim()
    ? TRIGGER_EVENTS.filter(e =>
        e.value.includes(lower) || e.label.toLowerCase().includes(lower))
    : TRIGGER_EVENTS;

  return (
    <div className="relative">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 130)}
        placeholder="e.g. contact.created"
        className={fieldCls + ' font-mono text-sm'}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-[110] left-0 right-0 mt-0.5 bg-popover border border-border rounded-lg shadow-xl max-h-56 overflow-y-auto">
          {(() => {
            const groups = [...new Set(matches.map(e => e.group))];
            return groups.map(g => (
              <div key={g}>
                <p className="px-3 pt-2 pb-0.5 text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
                  {g}
                </p>
                {matches.filter(e => e.group === g).map(e => (
                  <button
                    key={e.value}
                    type="button"
                    onMouseDown={() => { onChange(e.value); setOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center justify-between gap-3"
                  >
                    <span className="font-mono text-foreground">{e.value}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">{e.label}</span>
                  </button>
                ))}
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}

// ── Trigger panel (left sidebar) ──────────────────────────────────────────────

function TriggerPanel({
  trigger, onTriggerChange,
  conditions, onConditionsChange,
  description, onDescriptionChange,
  isManual,
}: {
  trigger:              string;
  onTriggerChange:      (v: string) => void;
  conditions:           FilterCondition[];
  onConditionsChange:   (c: FilterCondition[]) => void;
  description:          string;
  onDescriptionChange:  (v: string) => void;
  isManual:             boolean;
}) {
  const triggerDef = TRIGGER_EVENTS.find(e => e.value === trigger);

  return (
    <div className="space-y-5">
      {/* Section heading */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
        </div>
        <span className="text-xs font-bold text-foreground uppercase tracking-wider">Trigger</span>
      </div>

      {/* Event picker */}
      <div>
        <label className={labelCls}>Event</label>
        <TriggerCombobox value={trigger} onChange={onTriggerChange} />
        {triggerDef && trigger !== 'manual' && (
          <p className="text-xs text-muted-foreground mt-1">{triggerDef.label}</p>
        )}
        {isManual && (
          <div className="mt-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-600 dark:text-blue-400 space-y-1">
            <p className="font-semibold">Manual / On Demand</p>
            <p>This automation has no automatic trigger. Run it on-demand via the <span className="font-mono">▶ Run</span> button or the <span className="font-mono">workflow_trigger</span> MCP tool.</p>
          </div>
        )}
      </div>

      {/* Conditions (hide for manual trigger — no event payload to filter) */}
      {!isManual && (
        <div>
          <label className={labelCls}>
            Conditions
            <span className="ml-1 normal-case font-normal text-muted-foreground/60">(all must match)</span>
          </label>
          <WorkflowFilterBuilder
            conditions={conditions}
            onChange={onConditionsChange}
            triggerEvent={trigger}
          />
        </div>
      )}

      {/* Description */}
      <div>
        <label className={labelCls}>
          Description
          <span className="ml-1 normal-case font-normal text-muted-foreground/60">(optional)</span>
        </label>
        <textarea
          value={description}
          onChange={e => onDescriptionChange(e.target.value)}
          placeholder="What does this automation do?"
          rows={3}
          className={areaCls}
        />
      </div>
    </div>
  );
}

// ── Grouped action type selector ──────────────────────────────────────────────

function ActionTypeSelect({
  value,
  onChange,
}: {
  value:    string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-[320px]">
        {ACTION_GROUPS.map((group, gi) => {
          const items = VISIBLE_ACTION_TYPES.filter(a => a.group === group);
          if (items.length === 0) return null;
          return (
            <SelectGroup key={group}>
              {gi > 0 && <SelectSeparator />}
              <SelectLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 px-2 py-1">
                {group}
              </SelectLabel>
              {ACTION_GROUP_HELP[group] && (
                <div className="px-2 pb-1 text-xs text-muted-foreground">{ACTION_GROUP_HELP[group]}</div>
              )}
              {items.map(a => (
                <SelectItem key={a.value} value={a.value} className="text-xs">
                  <span className="flex items-center gap-1.5">
                    {a.isHITL && <UserCheck className="w-3 h-3 text-amber-500" />}
                    {a.value}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
        {/* Items without a group */}
        {VISIBLE_ACTION_TYPES.filter(a => !a.group).map(a => (
          <SelectItem key={a.value} value={a.value} className="text-xs">{a.value}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Action card ───────────────────────────────────────────────────────────────

function ActionCard({
  index,
  action,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  canRemove,
  triggerEvent,
  sequences,
  systems,
  mappings: allMappings,
}: {
  index:      number;
  action:     ActionDraft;
  onChange:   (a: ActionDraft) => void;
  onRemove:   () => void;
  onMoveUp:   () => void;
  onMoveDown: () => void;
  canMoveUp:  boolean;
  canMoveDown:boolean;
  canRemove:  boolean;
  triggerEvent: string;
  sequences: any[];
  systems: any[];
  mappings: any[];
}) {
  const navigate = useNavigate();
  const { enabled: agentEnabled, config: agentConfig, connectivity } = useAgentSettings();
  const previewMutation = useDraftWorkflowContentPreview();
  const [preview, setPreview] = useState<{ subject?: string; body_text?: string; message?: string } | null>(null);
  const def        = VISIBLE_ACTION_TYPES.find(a => a.value === action.type)
                  ?? ACTION_TYPES.find(a => a.value === action.type)
                  ?? VISIBLE_ACTION_TYPES[0];
  const isHITL     = requiresApproval(action);
  const suggestions = getSuggestionsForTrigger(triggerEvent);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mappings: any[] = allMappings.filter((m: any) => !action.config.system_id || m.system_id === action.config.system_id);
  const { data: whoami } = useWhoAmI() as any;
  const isAdminUser = whoami?.user?.role === 'admin' || whoami?.user?.role === 'owner';
  const agentReady = agentEnabled && Boolean(agentConfig?.model && agentConfig?.base_url) && connectivity !== 'offline';
  const canPreviewAi = action.config.ai_generate === 'true' && (action.type === 'send_email' || action.type === 'send_notification');

  function promptConfigureAgent() {
    toast({
      title: isAdminUser ? 'Configure the Local Workspace Agent' : 'Workspace Agent needs admin setup',
      description: isAdminUser
        ? 'AI-generated trigger messages need an enabled model in Model Settings.'
        : 'Ask an admin to enable the Workspace Agent before using AI-generated trigger messages.',
      action: isAdminUser ? (
        <ToastAction altText="Open Model Settings" onClick={() => navigate('/settings/model')}>
          Configure
        </ToastAction>
      ) : undefined,
    });
  }

  function set(key: string, val: string) {
    if (key === 'ai_generate' && val === 'true' && !agentReady) {
      promptConfigureAgent();
      return;
    }
    if (key === 'ai_generate' || key === 'ai_prompt') setPreview(null);
    onChange({ ...action, config: { ...action.config, [key]: val } });
  }

  async function previewAiContent() {
    if (!canPreviewAi) return;
    if (!agentReady) {
      promptConfigureAgent();
      return;
    }
    setPreview(null);
    try {
      const result = await previewMutation.mutateAsync({
        action_type: action.type as 'send_email' | 'send_notification',
        config: action.config,
        sample_payload: getSamplePayload(triggerEvent) as Record<string, unknown>,
      });
      setPreview(result);
    } catch {
      toast({
        title: 'Preview failed',
        description: 'Could not generate content. Check Model Settings and try again.',
        variant: 'destructive',
      });
    }
  }

  return (
    <div className={`relative rounded-xl border transition-colors ${
      isHITL
        ? 'border-amber-500/40 bg-amber-500/5 shadow-sm shadow-amber-500/10'
        : 'border-border bg-card'
    }`}>
      {/* HITL accent bar */}
      {isHITL && (
        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl bg-amber-500" />
      )}

      {/* Card header */}
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${
        isHITL ? 'border-amber-500/20 pl-5' : 'border-border'
      }`}>
        {/* Step number */}
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          isHITL ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground'
        }`}>
          {index + 1}
        </span>

        {/* Type selector */}
        <ActionTypeSelect
          value={action.type}
          onChange={type => onChange({ type, config: {} })}
        />

        {/* HITL / Auto badge */}
        {isHITL ? (
          <Badge className="shrink-0 text-xs px-1.5 bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20">
            <UserCheck className="w-2.5 h-2.5 mr-0.5" />Human
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0 text-xs px-1.5 text-muted-foreground">
            <Bot className="w-2.5 h-2.5 mr-0.5" />Auto
          </Badge>
        )}

        {/* Move up / down */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button" onClick={onMoveUp} disabled={!canMoveUp}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button" onClick={onMoveDown} disabled={!canMoveDown}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Remove */}
        {canRemove && (
          <button
            type="button" onClick={onRemove}
            className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
            aria-label="Remove step"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Card body — config fields */}
      <div className={`px-4 py-3 space-y-3 ${isHITL ? 'pl-5' : ''}`}>
        {def.configFields.map(field => {
          const val = action.config[field.key] ?? '';
          const aiGenerate = action.config.ai_generate === 'true';
          const aiControlled = aiGenerate && field.aiControlled;

          if (field.key === 'ai_prompt' && !aiGenerate) return null;

          // Boolean toggle
          if (field.type === 'boolean') {
            const checked = val === 'true';
            return (
              <div key={field.key} className="flex items-start gap-3">
                <Switch
                  id={`${index}-${field.key}`}
                  checked={checked}
                  onCheckedChange={v => set(field.key, String(v))}
                  className="mt-0.5 shrink-0"
                />
                <div>
                  <label htmlFor={`${index}-${field.key}`} className="text-xs font-medium cursor-pointer">
                    {field.label}
                  </label>
                  {field.hint && (
                    <p className="text-xs text-muted-foreground mt-0.5">{field.hint}</p>
                  )}
                </div>
              </div>
            );
          }

          // Sequence picker
          if (field.type === 'sequence_picker') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sel = sequences.find((s: any) => s.id === val);
            return (
              <div key={field.key}>
                <label className={labelCls}>
                  {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                <select
                  value={val}
                  onChange={e => set(field.key, e.target.value)}
                  className={smFieldCls}
                >
                  <option value="">{sequences.length === 0 ? 'No active sequences' : 'Select a sequence…'}</option>
                  {sequences.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {sel && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {sel.steps?.length ?? 0} step{sel.steps?.length !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            );
          }

          // System-of-record picker
          if (field.type === 'system_picker') {
            const selected = systems.find(s => s.id === val);
            return (
              <div key={field.key}>
                <label className={labelCls}>
                  {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                <select
                  value={val}
                  onChange={e => {
                    const nextSystemId = e.target.value;
                    const patch: Record<string, string> = { ...action.config, [field.key]: nextSystemId };
                    if (action.config.mapping_id && !allMappings.some((m: any) => m.id === action.config.mapping_id && m.system_id === nextSystemId)) {
                      delete patch.mapping_id;
                    }
                    onChange({ ...action, config: patch });
                  }}
                  className={smFieldCls}
                >
                  <option value="">{systems.length === 0 ? 'No systems configured' : 'Select a system…'}</option>
                  {systems.map(system => (
                    <option key={system.id} value={system.id}>
                      {system.name} ({system.system_type})
                    </option>
                  ))}
                </select>
                {selected && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selected.status ?? 'configured'} • {selected.has_credentials ? 'credentials stored' : 'credentials needed'}
                  </p>
                )}
                {systems.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">Create a connection in Settings → Systems of Record first.</p>
                )}
              </div>
            );
          }

          // System mapping picker
          if (field.type === 'mapping_picker') {
            const selected = mappings.find(m => m.id === val);
            return (
              <div key={field.key}>
                <label className={labelCls}>
                  {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                <select
                  value={val}
                  onChange={e => set(field.key, e.target.value)}
                  className={smFieldCls}
                >
                  <option value="">
                    {action.config.system_id
                      ? mappings.length === 0 ? 'No active mappings for this system' : 'Use default mapping…'
                      : 'Select a system first'}
                  </option>
                  {mappings.map(mapping => (
                    <option key={mapping.id} value={mapping.id}>
                      {mapping.object_type?.replace('_', ' ')} → {mapping.external_object}
                    </option>
                  ))}
                </select>
                {selected ? (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selected.writeback_mode ?? 'read mapping'} • {selected.source_authority ?? 'external'} authority
                  </p>
                ) : field.hint ? (
                  <p className="text-xs text-muted-foreground mt-0.5">{field.hint}</p>
                ) : null}
              </div>
            );
          }

          // Number field
          if (field.type === 'number') {
            return (
              <div key={field.key}>
                <label className={labelCls}>
                  {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                <input
                  type="number"
                  value={val}
                  onChange={e => set(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className={smFieldCls + ' font-mono'}
                />
                {field.hint && <p className="text-xs text-muted-foreground mt-0.5">{field.hint}</p>}
              </div>
            );
          }

          // Textarea with {{ autocomplete
          if (field.type === 'textarea') {
            return (
              <div key={field.key}>
                <label className={labelCls}>
                  {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                <VarField
                  multiline
                  rows={3}
                  value={val}
                  onChange={v => set(field.key, v)}
                  placeholder={aiControlled ? 'Generated dynamically from the AI prompt at run time' : field.placeholder}
                  suggestions={def.supportsVariables ? suggestions : []}
                  disabled={aiControlled}
                  className={`${areaCls} ${aiControlled ? 'bg-muted/60 border-dashed text-muted-foreground' : ''}`}
                />
                {field.hint && (
                  <p className="text-xs text-muted-foreground mt-0.5">{field.hint}</p>
                )}
                {field.key === 'ai_prompt' && canPreviewAi && (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={previewAiContent}
                        disabled={previewMutation.isPending}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 transition-colors hover:text-amber-500 disabled:opacity-50 dark:text-amber-400"
                      >
                        {previewMutation.isPending
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating preview…</>
                          : <><Sparkles className="h-3 w-3" /> Preview AI content</>}
                      </button>
                      {!agentReady && isAdminUser && (
                        <button
                          type="button"
                          onClick={() => navigate('/settings/model')}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Configure Model Settings
                        </button>
                      )}
                    </div>
                    {preview && (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="font-semibold text-primary">AI preview</span>
                          <button
                            type="button"
                            onClick={() => {
                              const next = { ...action.config };
                              if (preview.subject) next.subject = preview.subject;
                              if (preview.body_text) next.body_text = preview.body_text;
                              if (preview.message) next.message = preview.message;
                              onChange({ ...action, config: next });
                              setPreview(null);
                            }}
                            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                          >
                            <Check className="h-3 w-3" /> Use preview
                          </button>
                        </div>
                        {preview.subject && <p className="mb-1"><span className="font-semibold">Subject:</span> {preview.subject}</p>}
                        <p className="whitespace-pre-wrap text-foreground">{preview.body_text ?? preview.message}</p>
                      </div>
                    )}
                  </div>
                )}
                {aiControlled && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Turn off AI generation to write a fixed {action.type === 'send_email' ? 'body' : 'message'} manually.
                  </p>
                )}
              </div>
            );
          }

          // Default: text input with {{ autocomplete
          return (
            <div key={field.key}>
              <label className={labelCls}>
                {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <VarField
                value={val}
                onChange={v => set(field.key, v)}
                placeholder={field.placeholder}
                suggestions={def.supportsVariables ? suggestions : []}
                className={smFieldCls + ' font-mono'}
              />
              {field.hint && (
                <p className="text-xs text-muted-foreground mt-0.5">{field.hint}</p>
              )}
            </div>
          );
        })}

        {/* Human review notice on HITL actions */}
        {isHITL && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              {def.isHITL
                ? 'This step creates a review request in Handoffs. Subsequent actions run only after a human approves.'
                : 'This email will not send until a human approves the HITL request in Handoffs.'}
            </span>
          </div>
        )}
        {action.type === 'request_external_writeback' && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-xs text-violet-700 dark:text-violet-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              This creates a governed writeback request; execution still follows system policy, source authority, and approval rules.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Flow connector ────────────────────────────────────────────────────────────

function FlowConnector({ isHITL }: { isHITL?: boolean }) {
  return (
    <div className="flex flex-col items-center my-1 select-none">
      <div className={`w-px h-3 ${isHITL ? 'bg-amber-500/40' : 'bg-border'}`} />
      <ArrowRight className={`w-3 h-3 rotate-90 ${isHITL ? 'text-amber-500/60' : 'text-border'}`} />
    </div>
  );
}

// ── Trigger node ──────────────────────────────────────────────────────────────

function TriggerNode({ triggerEvent, isManual }: { triggerEvent: string; isManual: boolean }) {
  const def = TRIGGER_EVENTS.find(e => e.value === triggerEvent);
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center gap-3">
      <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
        {isManual ? <Play className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> : <Zap className="w-3.5 h-3.5 text-amber-500" />}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-0.5">
          {isManual ? 'Manual Trigger' : 'Trigger'}
        </p>
        <p className="text-sm font-mono text-foreground truncate">
          {triggerEvent || <span className="text-muted-foreground">No trigger selected</span>}
        </p>
        {def && !isManual && (
          <p className="text-xs text-muted-foreground mt-0.5">{def.label}</p>
        )}
      </div>
    </div>
  );
}

// ── Add action popover ────────────────────────────────────────────────────────

function AddActionButton({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex justify-center">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/30 transition-all"
      >
        <Plus className="w-3.5 h-3.5" /> Add action
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setOpen(false)} />
          <div className="absolute z-[100] top-full mt-1 w-72 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
            {ACTION_GROUPS.map((group, gi) => {
              const items = VISIBLE_ACTION_TYPES.filter(a => a.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  {gi > 0 && <div className="border-t border-border/60" />}
                  <p className="px-3 pt-2.5 pb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
                    {group}
                  </p>
                  {ACTION_GROUP_HELP[group] && (
                    <p className="px-3 pb-1 text-xs text-muted-foreground">{ACTION_GROUP_HELP[group]}</p>
                  )}
                  {items.map(a => (
                    <button
                      key={a.value}
                      type="button"
                      onClick={() => { onAdd(a.value); setOpen(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        {a.isHITL && <UserCheck className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                        <span className="text-xs font-medium text-foreground">{a.label}</span>
                      </div>
                      {a.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {a.description}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Test panel ────────────────────────────────────────────────────────────────

function TestPanel({
  workflowId,
  triggerEvent,
  getDraftWorkflow,
  validateDraft,
}: {
  workflowId?: string;
  triggerEvent: string;
  getDraftWorkflow: () => Record<string, unknown>;
  validateDraft: () => boolean;
}) {
  const skeleton = getSamplePayload(triggerEvent);
  const [payload, setPayload]       = useState(() => JSON.stringify(skeleton, null, 2));
  const [parseError, setParseError] = useState('');
  const testMutation = useTestWorkflow();
  const draftMutation = useTestDraftWorkflow();

  useEffect(() => {
    setPayload(JSON.stringify(getSamplePayload(triggerEvent), null, 2));
    setParseError('');
  }, [triggerEvent]);

  const run = async () => {
    if (!validateDraft()) {
      toast({ title: 'Fix required fields before testing.', variant: 'destructive' });
      return;
    }
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(payload); setParseError(''); }
    catch { setParseError('Invalid JSON'); return; }
    try {
      if (workflowId) {
        await testMutation.mutateAsync({ id: workflowId, sample_payload: parsed });
      } else {
        await draftMutation.mutateAsync({ workflow: getDraftWorkflow(), sample_payload: parsed });
      }
    } catch (err: any) {
      toast({ title: 'Dry run failed', description: err?.message ?? 'Check the trigger and action configuration.', variant: 'destructive' });
    }
  };

  const result = (workflowId ? testMutation.data : draftMutation.data) as any;
  const isPending = workflowId ? testMutation.isPending : draftMutation.isPending;

  return (
    <div className="space-y-4 text-xs">
      <div>
        <p className={labelCls}>Sample payload</p>
        <textarea
          value={payload}
          onChange={e => { setPayload(e.target.value); setParseError(''); }}
          rows={9}
          className={areaCls + ' text-xs'}
          spellCheck={false}
        />
        {parseError && <p className="text-destructive mt-1 text-xs">{parseError}</p>}
      </div>

      <Button size="sm" onClick={run} disabled={isPending} className="w-full gap-1.5 text-xs">
        {isPending
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <FlaskConical className="w-3 h-3" />}
        Dry run
      </Button>

      {!workflowId && (
        <p className="text-xs text-muted-foreground text-center">Testing this draft will not create or activate the trigger.</p>
      )}

      {result && (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border font-medium ${
            result.would_trigger
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-muted border-border text-muted-foreground'
          }`}>
            {result.would_trigger
              ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              : <XCircle      className="w-3.5 h-3.5 shrink-0" />}
            {result.would_trigger ? 'Would trigger' : 'Would NOT trigger'}
          </div>

          {result.filter_match_details?.mismatches?.length > 0 && (
            <div className="space-y-1">
              <p className={labelCls}>Filter mismatches</p>
              {result.filter_match_details.mismatches.map((m: any, i: number) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                  <XCircle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span><span className="font-mono">{m.field}</span>: got <span className="font-mono">"{String(m.actual)}"</span></span>
                </div>
              ))}
            </div>
          )}

          {Array.isArray(result.actions) && result.actions.length > 0 && (
            <div>
              <p className={labelCls}>Resolved actions</p>
              <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                {result.actions.map((a: any, i: number) => (
                  <div key={i} className="px-2.5 py-1.5 flex items-start gap-2 text-xs">
                    <span className="shrink-0 text-muted-foreground w-4">{i + 1}.</span>
                    <span className="font-mono text-foreground shrink-0">{a.type}</span>
                    <span className="text-muted-foreground font-mono truncate flex-1">
                      {Object.entries(a.resolved_config ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                    </span>
                    {a.note && <span className="text-muted-foreground shrink-0">{a.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const MAX_ACTIONS = 20;

export function WorkflowEditor({ open, onClose, workflow: workflowProp, workflowId, onSaved }: WorkflowEditorProps) {
  // If only an ID was supplied, fetch the workflow ourselves
  const { data: fetchedData } = useWorkflow(workflowId ?? '') as any;
  const workflow = workflowProp ?? (workflowId ? (fetchedData as any)?.data ?? fetchedData : undefined);

  const isEdit = Boolean(workflow?.id);

  const createWorkflow = useCreateWorkflow();
  const updateWorkflow = useUpdateWorkflow(workflow?.id ?? '');
  const { data: seqData } = useSequences({ is_active: true }) as any;
  const { data: systemsData } = useSystemsOfRecord({ limit: 100 }) as any;
  const { data: mappingsData } = useSystemMappings({ limit: 100, is_active: true }) as any;
  const sequences: any[] = seqData?.data ?? [];
  const systems: any[] = systemsData?.data ?? [];
  const systemMappings: any[] = mappingsData?.data ?? [];

  // ── Editor state ─────────────────────────────────────────────────────────

  const [name,        setName]        = useState(() => workflow?.name        ?? '');
  const [description, setDescription] = useState(() => workflow?.description ?? '');
  const [trigger,     setTrigger]     = useState(() => workflow?.trigger_event ?? '');
  const [isActive,    setIsActive]    = useState(() => workflow?.is_active    ?? false);
  const [conditions,  setConditions]  = useState<FilterCondition[]>(() =>
    workflow?.trigger_filter && typeof workflow.trigger_filter === 'object'
      ? filterToConditions(workflow.trigger_filter as Record<string, unknown>)
      : [],
  );
  const [actions, setActions] = useState<ActionDraft[]>(() =>
    Array.isArray(workflow?.actions) && workflow.actions.length > 0
      ? workflow.actions.map((a: any) => ({
          type: a.type ?? 'send_notification',
          config: Object.fromEntries(
            Object.entries(a.config ?? {}).map(([k, v]) => [k, String(v)]),
          ),
        }))
      : [{ type: 'send_notification', config: {} }],
  );
  const [errors,   setErrors]   = useState<Record<string, string>>({});
  const [testOpen, setTestOpen] = useState(false);
  const [saving,   setSaving]   = useState(false);

  const isManual = trigger === 'manual';

  // Sync when workflow prop changes (re-opening with different data)
  const resetFromWorkflow = useCallback((wf: any) => {
    setName(wf?.name ?? '');
    setDescription(wf?.description ?? '');
    setTrigger(wf?.trigger_event ?? '');
    setIsActive(wf?.is_active ?? true);
    setConditions(
      wf?.trigger_filter && typeof wf.trigger_filter === 'object'
        ? filterToConditions(wf.trigger_filter as Record<string, unknown>)
        : [],
    );
    setActions(
      Array.isArray(wf?.actions) && wf.actions.length > 0
        ? wf.actions.map((a: any) => ({
            type: a.type ?? 'send_notification',
            config: Object.fromEntries(
              Object.entries(a.config ?? {}).map(([k, v]) => [k, String(v)]),
            ),
          }))
        : [{ type: 'send_notification', config: {} }],
    );
    setErrors({});
    setTestOpen(false);
  }, []);

  const resetToBlank = useCallback(() => {
    setName('');
    setDescription('');
    setTrigger('');
    setIsActive(false);
    setConditions([]);
    setActions([{ type: 'send_notification', config: {} }]);
    setErrors({});
    setTestOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (workflow) resetFromWorkflow(workflow);
    else resetToBlank();
  }, [open, workflow?.id, workflowProp, workflowId, resetFromWorkflow, resetToBlank]);

  // ── Validation ───────────────────────────────────────────────────────────

  /** Detect an opening {{ that is never closed, e.g. {{contact.name */
  const UNCLOSED_VAR = /\{\{(?![^{}]*\}\})/;

  const validateCore = (requireName: boolean): boolean => {
    const e: Record<string, string> = {};
    if (requireName && !name.trim()) e.name = 'Enter a trigger name before saving.';
    if (!trigger.trim()) e.trigger = 'Trigger event is required';
    actions.forEach((a, i) => {
      if (!isActionValid(a)) {
        e[`action_${i}`] = 'Fill in all required fields';
      } else {
        // Variable syntax check on all string config values
        const def = ACTION_TYPES.find(d => d.value === a.type);
        if (def) {
          for (const field of def.configFields) {
            const val = a.config[field.key];
            if (typeof val === 'string' && UNCLOSED_VAR.test(val)) {
              e[`action_${i}_${field.key}`] = `Unclosed {{ in "${field.label}" — did you forget }}?`;
              if (!e[`action_${i}`]) e[`action_${i}`] = `Variable syntax error in "${field.label}"`;
            }
          }
        }
      }
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validate = (): boolean => validateCore(true);
  const validateForTest = (): boolean => validateCore(false);

  const buildWorkflowPayload = useCallback((requireName = true) => ({
    name:           name.trim() || (requireName ? '' : 'Untitled trigger draft'),
    description:    description.trim() || undefined,
    trigger_event:  trigger.trim(),
    trigger_filter: (!isManual && conditions.length > 0) ? conditionsToFilter(conditions) : {},
    is_active:      isActive,
    actions: actions.map(a => ({
      type:   a.type,
      config: Object.fromEntries(
        Object.entries(a.config).map(([k, v]) => [k, v.trim()]),
      ),
    })),
  }), [actions, conditions, description, isActive, isManual, name, trigger]);

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = buildWorkflowPayload(true);

      if (isEdit) {
        await updateWorkflow.mutateAsync(payload);
        toast({ title: 'Trigger saved' });
      } else {
        await createWorkflow.mutateAsync(payload);
        toast({ title: isActive ? 'Trigger created and activated' : 'Draft trigger saved' });
      }
      onSaved?.();
      onClose();
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Action list helpers ──────────────────────────────────────────────────

  const updateAction = (i: number, a: ActionDraft) => {
    setActions(prev => prev.map((x, idx) => idx === i ? a : x));
    setErrors(prev => { const n = { ...prev }; delete n[`action_${i}`]; return n; });
  };
  const removeAction  = (i: number) => setActions(prev => prev.filter((_, idx) => idx !== i));
  const addAction     = (type: string) => {
    if (actions.length >= MAX_ACTIONS) return;
    setActions(prev => [...prev, { type, config: {} }]);
  };
  const moveUp   = (i: number) => {
    if (i === 0) return;
    setActions(prev => {
      const n = [...prev];
      [n[i - 1], n[i]] = [n[i], n[i - 1]];
      return n;
    });
  };
  const moveDown = (i: number) => {
    if (i >= actions.length - 1) return;
    setActions(prev => {
      const n = [...prev];
      [n[i], n[i + 1]] = [n[i + 1], n[i]];
      return n;
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const hasHITL = actions.some(requiresApproval);

  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-none p-0 gap-0 w-[min(95vw,1440px)] h-[min(90vh,920px)] flex flex-col overflow-hidden rounded-2xl [&>button]:hidden">
        <DialogTitle className="sr-only">
          {workflow ? 'Edit automation' : 'Create automation'}
        </DialogTitle>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-background/95 backdrop-blur shrink-0">
          <Zap className="w-5 h-5 text-amber-500 shrink-0" />

          {/* Editable name */}
          <label className={`flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border bg-background px-3 py-1.5 transition-colors ${
            errors.name ? 'border-destructive' : 'border-border focus-within:border-primary/50'
          }`}>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Trigger name
            </span>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }}
              placeholder="Name this trigger…"
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground placeholder:text-muted-foreground/60 outline-none"
            />
          </label>

          {errors.name && (
            <span className="text-xs text-destructive shrink-0">{errors.name}</span>
          )}

          {/* HITL present indicator */}
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

            {/* Test toggle */}
            <Button
              size="sm" variant={testOpen ? 'default' : 'outline'}
              onClick={() => setTestOpen(o => !o)}
              className="text-xs gap-1.5 h-8"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Test
            </Button>

            <div className="w-px h-5 bg-border" />

            <Button size="sm" variant="outline" onClick={onClose} className="h-8 text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-8 text-xs gap-1.5">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? 'Save changes' : isActive ? 'Create active trigger' : 'Save draft'}
            </Button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">

          {/* Left: Trigger panel */}
          <div className="w-[270px] shrink-0 border-r border-border overflow-y-auto p-5 bg-muted/20">
            <TriggerPanel
              trigger={trigger}
              onTriggerChange={v => { setTrigger(v); setErrors(p => ({ ...p, trigger: '' })); }}
              conditions={conditions}
              onConditionsChange={setConditions}
              description={description}
              onDescriptionChange={setDescription}
              isManual={isManual}
            />
            {errors.trigger && (
              <p className="text-xs text-destructive mt-2">{errors.trigger}</p>
            )}
          </div>

          {/* Centre: Action flow */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-[680px] mx-auto space-y-0">

              {/* Trigger node */}
              <TriggerNode triggerEvent={trigger} isManual={isManual} />

              {/* Action cards */}
              {actions.map((action, i) => (
                <div key={i}>
                  <FlowConnector isHITL={requiresApproval(action)} />
                  <EditorErrorBoundary label="action">
                    <ActionCard
                      index={i}
                      action={action}
                      onChange={a => updateAction(i, a)}
                      onRemove={() => removeAction(i)}
                      onMoveUp={() => moveUp(i)}
                      onMoveDown={() => moveDown(i)}
                      canMoveUp={i > 0}
                      canMoveDown={i < actions.length - 1}
                      canRemove={actions.length > 1}
                      triggerEvent={trigger}
                      sequences={sequences}
                      systems={systems}
                      mappings={systemMappings}
                    />
                  </EditorErrorBoundary>
                  {errors[`action_${i}`] && (
                    <p className="text-xs text-destructive mt-1 pl-1">{errors[`action_${i}`]}</p>
                  )}
                </div>
              ))}

              {/* Add action */}
              {actions.length < MAX_ACTIONS && (
                <>
                  <FlowConnector />
                  <AddActionButton onAdd={addAction} />
                </>
              )}

              <p className="text-center text-xs text-muted-foreground/40 mt-4">
                {actions.length}/{MAX_ACTIONS} actions
              </p>
            </div>
          </div>

          {/* Right: Test panel */}
          {testOpen && (
            <div className="w-[320px] shrink-0 border-l border-border overflow-y-auto p-5 bg-muted/10">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Test run</span>
                <button type="button" onClick={() => setTestOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <TestPanel
                workflowId={workflow?.id}
                triggerEvent={trigger}
                getDraftWorkflow={() => buildWorkflowPayload(false)}
                validateDraft={validateForTest}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
