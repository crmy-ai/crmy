// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { useWorkflow, useUpdateWorkflow, useDeleteWorkflow, useWorkflowRuns } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import {
  Zap, Play, Pause, Pencil, Trash2, Clock,
  CheckCircle2, XCircle, Loader2, Plus, X,
} from 'lucide-react';
import { TRIGGER_EVENTS, ACTION_TYPES, isActionValid } from '@/lib/workflowConstants';

// ── Shared input styles ────────────────────────────────────────────────────────

const inputCls   = 'w-full h-8 px-2.5 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const smallInput = 'w-full h-7 px-2 rounded border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

// ── Trigger Event Combobox ─────────────────────────────────────────────────────

function TriggerCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = value.trim()
    ? TRIGGER_EVENTS.filter(e =>
        e.value.includes(value.toLowerCase()) ||
        e.label.toLowerCase().includes(value.toLowerCase()),
      )
    : TRIGGER_EVENTS;

  return (
    <div className="relative">
      <input
        ref={inputRef}
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
}: {
  action: ActionDraft;
  onChange: (a: ActionDraft) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const def = ACTION_TYPES.find(a => a.value === action.type) ?? ACTION_TYPES[0];

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
            {ACTION_TYPES.map(a => (
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

      {def.configFields.map(field => (
        <div key={field.key}>
          <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">
            {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <input
            value={action.config[field.key] ?? ''}
            onChange={e => onChange({ ...action, config: { ...action.config, [field.key]: e.target.value } })}
            placeholder={field.placeholder}
            className={smallInput + ' font-mono'}
          />
        </div>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function WorkflowDrawer() {
  const { drawerEntityId, closeDrawer } = useAppStore();
  const id = drawerEntityId ?? '';
  const { data, isLoading } = useWorkflow(id) as any;
  const updateWorkflow = useUpdateWorkflow(id);
  const deleteWorkflow = useDeleteWorkflow();
  const { data: runsData, isLoading: runsLoading } = useWorkflowRuns(id, { limit: 20 });

  const [editing,    setEditing]    = useState(false);
  const [editName,   setEditName]   = useState('');
  const [editTrigger,setEditTrigger]= useState('');
  const [editActions,setEditActions]= useState<ActionDraft[]>([]);
  const [errors,     setErrors]     = useState<Record<string, string>>({});
  const [activeTab,  setActiveTab]  = useState<'details' | 'runs'>('details');

  const wf   = (data as any)?.workflow ?? data;
  const runs: any[] = (runsData as any)?.data ?? (runsData as any)?.runs ?? [];

  if (isLoading || !wf) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }

  // ── Edit helpers ─────────────────────────────────────────────────────────────

  const startEdit = () => {
    setEditName(wf.name ?? '');
    setEditTrigger(wf.trigger_event ?? '');
    // Normalise stored actions (config values may be non-string from DB)
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
        name:          editName.trim(),
        trigger_event: editTrigger.trim(),
        actions:       editActions.map(a => ({
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
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg border border-border overflow-hidden">
        {(['details', 'runs'] as const).map((tab) => (
          <button
            key={tab}
            className={`flex-1 px-3 py-1.5 text-xs font-medium capitalize transition-colors ${activeTab === tab ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
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

              {/* Trigger Event */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trigger Event</label>
                <TriggerCombobox
                  value={editTrigger}
                  onChange={v => { setEditTrigger(v); setErrors(p => ({ ...p, trigger: '' })); }}
                />
                {errors.trigger && <p className="text-xs text-destructive">{errors.trigger}</p>}
              </div>

              {/* Actions */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</label>
                {editActions.map((action, i) => (
                  <div key={i}>
                    <ActionRow
                      action={action}
                      onChange={a => updateAction(i, a)}
                      onRemove={() => setEditActions(prev => prev.filter((_, idx) => idx !== i))}
                      canRemove={editActions.length > 1}
                    />
                    {errors[`action_${i}`] && (
                      <p className="text-xs text-destructive mt-1">{errors[`action_${i}`]}</p>
                    )}
                  </div>
                ))}
                {editActions.length < 5 && (
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
              {/* Trigger */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Trigger Event</p>
                  <p className="text-sm font-mono text-foreground">{wf.trigger_event}</p>
                  {/* Friendly label if it's a known event */}
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
                          <span className="text-xs font-medium text-foreground min-w-0">
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

              {/* Controls */}
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button size="sm" variant="outline" onClick={toggleActive} disabled={updateWorkflow.isPending} className="text-xs gap-1">
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
          ) : runs.map((run: any) => {
            const ok = run.status === 'completed' || run.status === 'success';
            const fail = run.status === 'failed' || run.status === 'error';
            return (
              <div key={run.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-border bg-card">
                {ok   ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                : fail? <XCircle      className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                :       <Clock        className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />}
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
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {run.started_at ? new Date(run.started_at).toLocaleString() : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
