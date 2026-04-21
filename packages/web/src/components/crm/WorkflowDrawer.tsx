// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import {
  useWorkflow, useUpdateWorkflow, useDeleteWorkflow,
  useWorkflowRuns, useTestWorkflow, useCloneWorkflow,
} from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import {
  Zap, Play, Pause, Pencil, Trash2, Clock, Copy,
  CheckCircle2, XCircle, Loader2, Plus, X, ChevronDown, ChevronRight,
  FlaskConical,
} from 'lucide-react';
import {
  TRIGGER_EVENTS, VISIBLE_ACTION_TYPES, ACTION_TYPES, isActionValid,
  filterToConditions, conditionsToFilter, getSamplePayload,
  type FilterCondition,
} from '@/lib/workflowConstants';
import { WorkflowFilterBuilder } from './WorkflowFilterBuilder';
import { WorkflowVariablePicker } from './WorkflowVariablePicker';

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_ACTIONS = 20;

// ── Shared input styles ────────────────────────────────────────────────────────

const inputCls   = 'w-full h-8 px-2.5 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const smallInput = 'w-full h-7 px-2 rounded border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const textareaCls = 'w-full px-2.5 py-1.5 rounded-md border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none font-mono';

// ── Trigger Event Combobox ─────────────────────────────────────────────────────

function TriggerCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);

  const matches = value.trim()
    ? TRIGGER_EVENTS.filter(e =>
        e.value.includes(value.toLowerCase()) ||
        e.label.toLowerCase().includes(value.toLowerCase()),
      )
    : TRIGGER_EVENTS;

  return (
    <div className="relative">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="e.g. contact.created"
        className={inputCls + ' font-mono'}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {matches.map(e => (
            <button
              key={e.value}
              type="button"
              onMouseDown={() => { onChange(e.value); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center justify-between gap-3"
            >
              <span className="font-mono text-foreground">{e.value}</span>
              <span className="text-muted-foreground shrink-0">{e.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Action Row ────────────────────────────────────────────────────────────────

type ActionDraft = { type: string; config: Record<string, string> };

function ActionRow({
  action,
  onChange,
  onRemove,
  canRemove,
  triggerEvent,
}: {
  action: ActionDraft;
  onChange: (a: ActionDraft) => void;
  onRemove: () => void;
  canRemove: boolean;
  triggerEvent: string;
}) {
  const def = VISIBLE_ACTION_TYPES.find(a => a.value === action.type)
    ?? ACTION_TYPES.find(a => a.value === action.type)
    ?? VISIBLE_ACTION_TYPES[0];

  const supportsVars = def.supportsVariables ?? false;

  function insertVariable(fieldKey: string, token: string) {
    const current = action.config[fieldKey] ?? '';
    onChange({ ...action, config: { ...action.config, [fieldKey]: current + token } });
  }

  return (
    <div className="p-2.5 rounded-lg border border-border bg-muted/20 space-y-2">
      <div className="flex items-center gap-2">
        <Select
          value={action.type}
          onValueChange={type => onChange({ type, config: {} })}
        >
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VISIBLE_ACTION_TYPES.map(a => (
              <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
            aria-label="Remove action"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {def.configFields.map(field => {
        const val = action.config[field.key] ?? '';

        // Boolean toggle field
        if (field.type === 'boolean') {
          const checked = val === 'true' || val === '';
          return (
            <div key={field.key} className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-medium text-muted-foreground">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </span>
                {field.hint && (
                  <p className="text-[10px] text-muted-foreground/70">{field.hint}</p>
                )}
              </div>
              <Switch
                checked={checked}
                onCheckedChange={v =>
                  onChange({ ...action, config: { ...action.config, [field.key]: String(v) } })
                }
              />
            </div>
          );
        }

        // Textarea field
        if (field.type === 'textarea') {
          return (
            <div key={field.key}>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[10px] font-medium text-muted-foreground">
                  {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                {supportsVars && (
                  <WorkflowVariablePicker
                    triggerEvent={triggerEvent}
                    onInsert={token => insertVariable(field.key, token)}
                  />
                )}
              </div>
              <textarea
                value={val}
                onChange={e => onChange({ ...action, config: { ...action.config, [field.key]: e.target.value } })}
                placeholder={field.placeholder}
                rows={3}
                className={textareaCls}
              />
              {field.hint && (
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{field.hint}</p>
              )}
            </div>
          );
        }

        // Number / text field
        return (
          <div key={field.key}>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[10px] font-medium text-muted-foreground">
                {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
              </label>
              {supportsVars && field.type !== 'number' && (
                <WorkflowVariablePicker
                  triggerEvent={triggerEvent}
                  onInsert={token => insertVariable(field.key, token)}
                />
              )}
            </div>
            <input
              type={field.type === 'number' ? 'number' : 'text'}
              value={val}
              onChange={e => onChange({ ...action, config: { ...action.config, [field.key]: e.target.value } })}
              placeholder={field.placeholder}
              className={smallInput + ' font-mono'}
            />
            {field.hint && (
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">{field.hint}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Run row with expandable action logs ───────────────────────────────────────

function RunRow({ run }: { run: any }) {
  const [expanded, setExpanded] = useState(false);
  const ok   = run.status === 'completed' || run.status === 'success';
  const fail = run.status === 'failed'    || run.status === 'error';
  const logs: any[] = Array.isArray(run.action_logs) ? run.action_logs : [];

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        className="w-full flex items-start gap-2 p-2.5 text-left hover:bg-muted/20 transition-colors"
        onClick={() => logs.length > 0 && setExpanded(e => !e)}
      >
        {ok   ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
        : fail ? <XCircle      className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
        :        <Clock        className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant={ok ? 'default' : fail ? 'destructive' : 'secondary'}
              className="text-[10px]"
            >
              {run.status}
            </Badge>
            {run.actions_run != null && run.actions_total != null && (
              <span className="text-[10px] text-muted-foreground">
                {run.actions_run}/{run.actions_total} actions
              </span>
            )}
            {run.duration_ms != null && (
              <span className="text-[10px] text-muted-foreground">{run.duration_ms}ms</span>
            )}
          </div>
          {run.error && (
            <p className="text-[10px] text-destructive truncate mt-0.5">{run.error}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-muted-foreground">
            {run.started_at ? new Date(run.started_at).toLocaleString() : ''}
          </span>
          {logs.length > 0 && (
            expanded
              ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
              : <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && logs.length > 0 && (
        <div className="border-t border-border px-2.5 pb-2.5 pt-2">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left pb-1 pr-2 font-medium">#</th>
                <th className="text-left pb-1 pr-2 font-medium">Type</th>
                <th className="text-left pb-1 pr-2 font-medium">Status</th>
                <th className="text-left pb-1 pr-2 font-medium">Duration</th>
                <th className="text-left pb-1 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any, i: number) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-1 pr-2 text-muted-foreground">{log.index ?? i + 1}</td>
                  <td className="py-1 pr-2 font-mono text-foreground">{log.type}</td>
                  <td className="py-1 pr-2">
                    <span className={
                      log.status === 'completed' ? 'text-emerald-500'
                      : log.status === 'failed'  ? 'text-destructive'
                      : 'text-muted-foreground'
                    }>
                      {log.status}
                    </span>
                  </td>
                  <td className="py-1 pr-2 text-muted-foreground">
                    {log.duration_ms != null ? `${log.duration_ms}ms` : '—'}
                  </td>
                  <td className="py-1 text-destructive truncate max-w-[120px]">
                    {log.error ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Test tab ──────────────────────────────────────────────────────────────────

function TestTab({ workflowId, triggerEvent }: { workflowId: string; triggerEvent: string }) {
  const skeleton = getSamplePayload(triggerEvent);
  const [payload, setPayload] = useState(() => JSON.stringify(skeleton, null, 2));
  const [parseError, setParseError] = useState('');
  const testMutation = useTestWorkflow();

  const runTest = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload);
      setParseError('');
    } catch {
      setParseError('Invalid JSON — fix the payload and try again.');
      return;
    }
    await testMutation.mutateAsync({ id: workflowId, sample_payload: parsed });
  };

  const result = testMutation.data as any;

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted-foreground">
        Test your workflow with a sample payload. No actions will be executed.
      </p>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Sample Payload
        </label>
        <textarea
          value={payload}
          onChange={e => { setPayload(e.target.value); setParseError(''); }}
          rows={8}
          className={textareaCls + ' text-[11px]'}
          spellCheck={false}
        />
        {parseError && <p className="text-xs text-destructive">{parseError}</p>}
      </div>

      <Button
        size="sm"
        onClick={runTest}
        disabled={testMutation.isPending}
        className="text-xs gap-1.5"
      >
        {testMutation.isPending
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <FlaskConical className="w-3 h-3" />}
        Run test
      </Button>

      {testMutation.isError && (
        <div className="p-2.5 rounded-lg border border-destructive/30 bg-destructive/5 text-xs text-destructive">
          Test failed — check the console for details.
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {/* Trigger banner */}
          <div className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium ${
            result.would_trigger
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-muted border-border text-muted-foreground'
          }`}>
            {result.would_trigger
              ? <CheckCircle2 className="w-4 h-4 shrink-0" />
              : <XCircle      className="w-4 h-4 shrink-0" />}
            {result.would_trigger ? 'Would trigger' : 'Would NOT trigger'}
          </div>

          {/* Filter details */}
          {result.filter_match_details && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Filter Conditions
              </p>
              {result.filter_match_details.mismatches?.length > 0
                ? result.filter_match_details.mismatches.map((m: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] text-destructive">
                      <XCircle className="w-3 h-3 shrink-0" />
                      <span>
                        <span className="font-mono">{m.field}</span>: expected{' '}
                        <span className="font-mono">"{String(m.expected)}"</span> but got{' '}
                        <span className="font-mono">"{String(m.actual)}"</span>
                      </span>
                    </div>
                  ))
                : (
                    <p className="text-[10px] text-emerald-500 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> All conditions match
                    </p>
                  )
              }
            </div>
          )}

          {/* Actions table */}
          {Array.isArray(result.actions) && result.actions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Actions
              </p>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-[10px]">
                  <thead className="bg-muted/40">
                    <tr className="text-muted-foreground">
                      <th className="text-left px-2.5 py-1.5 font-medium">#</th>
                      <th className="text-left px-2 py-1.5 font-medium">Type</th>
                      <th className="text-left px-2 py-1.5 font-medium">Resolved Config</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.actions.map((a: any, i: number) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="px-2.5 py-1.5 text-muted-foreground">{a.index ?? i + 1}</td>
                        <td className="px-2 py-1.5 font-mono text-foreground">{a.type}</td>
                        <td className="px-2 py-1.5 text-muted-foreground font-mono truncate max-w-[180px]">
                          {Object.entries(a.resolved_config ?? {})
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function WorkflowDrawer() {
  const { drawerEntityId, closeDrawer, openDrawer } = useAppStore();
  const id = drawerEntityId ?? '';
  const { data, isLoading } = useWorkflow(id) as any;
  const updateWorkflow = useUpdateWorkflow(id);
  const deleteWorkflow = useDeleteWorkflow();
  const cloneWorkflow  = useCloneWorkflow();
  const { data: runsData, isLoading: runsLoading } = useWorkflowRuns(id, { limit: 20 });

  const [editing,     setEditing]     = useState(false);
  const [editName,    setEditName]    = useState('');
  const [editDesc,    setEditDesc]    = useState('');
  const [editTrigger, setEditTrigger] = useState('');
  const [editFilter,  setEditFilter]  = useState<FilterCondition[]>([]);
  const [editActions, setEditActions] = useState<ActionDraft[]>([]);
  const [errors,      setErrors]      = useState<Record<string, string>>({});
  const [activeTab,   setActiveTab]   = useState<'details' | 'runs' | 'test'>('details');

  const wf   = (data as any)?.workflow ?? data;
  const runs: any[] = (runsData as any)?.data ?? (runsData as any)?.runs ?? [];

  if (isLoading || !wf) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }

  // ── Edit helpers ─────────────────────────────────────────────────────────────

  const startEdit = () => {
    setEditName(wf.name ?? '');
    setEditDesc(wf.description ?? '');
    setEditTrigger(wf.trigger_event ?? '');
    setEditFilter(
      wf.trigger_filter && typeof wf.trigger_filter === 'object'
        ? filterToConditions(wf.trigger_filter as Record<string, unknown>)
        : [],
    );
    const stored: ActionDraft[] = Array.isArray(wf.actions) && wf.actions.length > 0
      ? wf.actions.map((a: any) => ({
          type:   a.type ?? 'send_notification',
          config: Object.fromEntries(
            Object.entries(a.config ?? {}).map(([k, v]) => [k, String(v)]),
          ),
        }))
      : [{ type: 'send_notification', config: {} }];
    setEditActions(stored);
    setErrors({});
    setEditing(true);
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!editName.trim())    e.name    = 'Name is required.';
    if (!editTrigger.trim()) e.trigger = 'Trigger event is required.';
    editActions.forEach((a, i) => {
      if (!isActionValid(a)) e[`action_${i}`] = 'Fill in all required fields.';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const saveEdit = async () => {
    if (!validate()) return;
    try {
      await updateWorkflow.mutateAsync({
        name:           editName.trim(),
        description:    editDesc.trim() || undefined,
        trigger_event:  editTrigger.trim(),
        trigger_filter: editFilter.length > 0 ? conditionsToFilter(editFilter) : undefined,
        actions:        editActions.map(a => ({
          type:   a.type,
          config: Object.fromEntries(
            Object.entries(a.config).map(([k, v]) => [k, v.trim()]),
          ),
        })),
      });
      setEditing(false);
      toast({ title: 'Workflow updated' });
    } catch {
      toast({ title: 'Update failed', variant: 'destructive' });
    }
  };

  const toggleActive = async () => {
    try {
      await updateWorkflow.mutateAsync({ is_active: !wf.is_active });
      toast({ title: wf.is_active ? 'Workflow paused' : 'Workflow activated' });
    } catch {
      toast({ title: 'Error', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteWorkflow.mutateAsync(id);
      closeDrawer();
      toast({ title: 'Workflow deleted' });
    } catch {
      toast({ title: 'Error', variant: 'destructive' });
    }
  };

  const handleClone = async () => {
    try {
      const result = await cloneWorkflow.mutateAsync({ id });
      const newId = (result as any)?.workflow?.id ?? (result as any)?.id;
      toast({ title: 'Workflow duplicated' });
      if (newId && openDrawer) openDrawer('workflow', newId);
    } catch {
      toast({ title: 'Clone failed', variant: 'destructive' });
    }
  };

  const updateAction = (i: number, a: ActionDraft) => {
    setEditActions(prev => prev.map((x, idx) => idx === i ? a : x));
    setErrors(prev => { const next = { ...prev }; delete next[`action_${i}`]; return next; });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-amber-500 shrink-0" />
        <h3 className="text-lg font-display font-bold text-foreground flex-1 truncate">
          {wf.name}
        </h3>
        <Badge variant={wf.is_active !== false ? 'default' : 'secondary'} className="text-[10px] shrink-0">
          {wf.is_active !== false ? 'Active' : 'Paused'}
        </Badge>
        <button
          type="button"
          onClick={handleClone}
          disabled={cloneWorkflow.isPending}
          title="Duplicate workflow"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          {cloneWorkflow.isPending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Copy className="w-4 h-4" />}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg border border-border overflow-hidden">
        {(['details', 'runs', 'test'] as const).map((tab) => (
          <button
            key={tab}
            className={`flex-1 px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'test' ? (
              <span className="flex items-center justify-center gap-1">
                <FlaskConical className="w-3 h-3" /> Test
              </span>
            ) : tab}
          </button>
        ))}
      </div>

      {/* ── Details tab ────────────────────────────────────────────────────── */}
      {activeTab === 'details' && (
        <div className="space-y-4">
          {editing ? (
            /* Edit mode */
            <div className="space-y-3">
              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</label>
                <input
                  value={editName}
                  onChange={e => { setEditName(e.target.value); setErrors(p => ({ ...p, name: '' })); }}
                  className={inputCls}
                />
                {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Description <span className="text-muted-foreground/50 normal-case">(optional)</span>
                </label>
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  placeholder="What does this workflow do?"
                  rows={2}
                  className={textareaCls}
                />
              </div>

              {/* Trigger Event */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trigger Event</label>
                <TriggerCombobox
                  value={editTrigger}
                  onChange={v => { setEditTrigger(v); setErrors(p => ({ ...p, trigger: '' })); }}
                />
                {errors.trigger && <p className="text-xs text-destructive">{errors.trigger}</p>}
              </div>

              {/* Trigger Filter */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Trigger Conditions
                </label>
                <WorkflowFilterBuilder
                  conditions={editFilter}
                  onChange={setEditFilter}
                />
              </div>

              {/* Actions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</label>
                  <span className="text-[10px] text-muted-foreground">{editActions.length}/{MAX_ACTIONS}</span>
                </div>
                {editActions.map((action, i) => (
                  <div key={i}>
                    <ActionRow
                      action={action}
                      onChange={a => updateAction(i, a)}
                      onRemove={() => setEditActions(prev => prev.filter((_, idx) => idx !== i))}
                      canRemove={editActions.length > 1}
                      triggerEvent={editTrigger}
                    />
                    {errors[`action_${i}`] && (
                      <p className="text-xs text-destructive mt-1">{errors[`action_${i}`]}</p>
                    )}
                  </div>
                ))}
                {editActions.length < MAX_ACTIONS && (
                  <button
                    type="button"
                    onClick={() => setEditActions(prev => [...prev, { type: 'send_notification', config: {} }])}
                    className="w-full py-1.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add action
                  </button>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={saveEdit} disabled={updateWorkflow.isPending} className="text-xs gap-1">
                  {updateWorkflow.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                  Save changes
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="text-xs">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            /* View mode */
            <div className="space-y-3">
              {/* Description */}
              {wf.description && (
                <p className="text-xs text-muted-foreground italic">{wf.description}</p>
              )}

              {/* Trigger */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Trigger Event</p>
                  <p className="text-sm font-mono text-foreground">{wf.trigger_event}</p>
                  {(() => {
                    const known = TRIGGER_EVENTS.find(e => e.value === wf.trigger_event);
                    return known ? (
                      <p className="text-xs text-muted-foreground mt-0.5">{known.label}</p>
                    ) : null;
                  })()}
                </div>
                <Button size="sm" variant="ghost" onClick={startEdit} className="text-xs gap-1 shrink-0">
                  <Pencil className="w-3 h-3" /> Edit
                </Button>
              </div>

              {/* Filter conditions */}
              {wf.trigger_filter && Object.keys(wf.trigger_filter).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    Trigger Conditions
                  </p>
                  <WorkflowFilterBuilder
                    conditions={filterToConditions(wf.trigger_filter as Record<string, unknown>)}
                    onChange={() => {}}
                    disabled
                  />
                </div>
              )}

              {/* Actions */}
              {Array.isArray(wf.actions) && wf.actions.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Actions ({wf.actions.length})
                  </p>
                  <div className="space-y-1.5">
                    {wf.actions.map((action: any, i: number) => {
                      const def = ACTION_TYPES.find(a => a.value === action.type);
                      return (
                        <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg border border-border bg-muted/20">
                          <span className="text-xs font-medium text-foreground min-w-0 shrink-0">
                            {def?.label ?? action.type}
                          </span>
                          {action.config && Object.keys(action.config).length > 0 && (
                            <span className="text-xs text-muted-foreground font-mono truncate">
                              {Object.entries(action.config)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(' · ')}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground pt-1">
                {wf.run_count != null && (
                  <span>{wf.run_count} total runs</span>
                )}
                {wf.last_run_at && (
                  <span>Last run {new Date(wf.last_run_at).toLocaleString()}</span>
                )}
                {wf.error_count > 0 && (
                  <span className="text-amber-500">⚠ {wf.error_count} errors</span>
                )}
              </div>

              {/* Controls */}
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button
                  size="sm" variant="outline" onClick={toggleActive}
                  disabled={updateWorkflow.isPending} className="text-xs gap-1"
                >
                  {wf.is_active !== false ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  {wf.is_active !== false ? 'Pause' : 'Activate'}
                </Button>
                <Button
                  size="sm" variant="outline" onClick={handleDelete}
                  className="text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Runs tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'runs' && (
        <div className="space-y-2">
          {runsLoading ? (
            <div className="text-xs text-muted-foreground text-center py-6">Loading runs…</div>
          ) : runs.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No runs yet. Waiting for the trigger event.</p>
            </div>
          ) : runs.map((run: any) => (
            <RunRow key={run.id} run={run} />
          ))}
        </div>
      )}

      {/* ── Test tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'test' && (
        <TestTab workflowId={id} triggerEvent={wf.trigger_event ?? ''} />
      )}
    </div>
  );
}
