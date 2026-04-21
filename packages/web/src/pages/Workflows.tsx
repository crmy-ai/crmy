// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useRef } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { useWorkflows, useCreateWorkflow, useDeleteWorkflow, useUpdateWorkflowById } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { motion } from 'framer-motion';
import { Zap, Trash2, Loader2, Play, Pause, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { TRIGGER_EVENTS, ACTION_TYPES, VISIBLE_ACTION_TYPES, isActionValid, type ActionTypeDef } from '@/lib/workflowConstants';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ACTIONS = 20;

const FILTER_CONFIGS: FilterConfig[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'paused', label: 'Paused' },
    ],
  },
];

const SORT_OPTIONS: SortOption[] = [
  { key: 'name',          label: 'Name'         },
  { key: 'trigger_event', label: 'Trigger Event' },
  { key: 'updated_at',    label: 'Last Updated'  },
  { key: 'created_at',    label: 'Date Created'  },
];

const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const smallInputCls = 'w-full h-8 px-2 rounded-md border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

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
        <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-52 overflow-y-auto">
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
  const def: ActionTypeDef = VISIBLE_ACTION_TYPES.find(a => a.value === action.type) ?? ACTION_TYPES.find(a => a.value === action.type) ?? VISIBLE_ACTION_TYPES[0];

  return (
    <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-2">
      <div className="flex items-center gap-2">
        <Select
          value={action.type}
          onValueChange={type => onChange({ type, config: {} })}
        >
          <SelectTrigger className="h-8 text-xs flex-1">
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
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {def.configFields.map(field => (
        <div key={field.key}>
          <label className="block text-[10px] font-medium text-muted-foreground mb-1">
            {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <input
            value={action.config[field.key] ?? ''}
            onChange={e => onChange({ ...action, config: { ...action.config, [field.key]: e.target.value } })}
            placeholder={field.placeholder}
            className={smallInputCls + ' font-mono'}
          />
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const DEFAULT_ACTION: ActionDraft = { type: 'send_notification', config: {} };

export default function WorkflowsPage() {
  const { openDrawer } = useAppStore();

  const [search,        setSearch]        = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort,          setSort]          = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [createOpen,    setCreateOpen]    = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Create dialog state
  const [newName,    setNewName]    = useState('');
  const [newTrigger, setNewTrigger] = useState('');
  const [actions,    setActions]    = useState<ActionDraft[]>([{ ...DEFAULT_ACTION }]);
  const [errors,     setErrors]     = useState<Record<string, string>>({});

  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data, isLoading } = useWorkflows() as any;
  const createWorkflow = useCreateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();
  const updateWorkflowById = useUpdateWorkflowById();

  const handleToggleActive = async (e: React.MouseEvent, wf: any) => {
    e.stopPropagation();
    setTogglingId(wf.id);
    try {
      await updateWorkflowById.mutateAsync({ id: wf.id, is_active: !wf.is_active });
      toast({ title: wf.is_active ? 'Workflow paused' : 'Workflow activated' });
    } catch {
      toast({ title: 'Error', variant: 'destructive' });
    } finally {
      setTogglingId(null);
    }
  };

  const workflows: any[] = (data as any)?.data ?? [];

  // ── Validation ──────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!newName.trim())    e.name    = 'Name is required.';
    if (!newTrigger.trim()) e.trigger = 'Trigger event is required.';
    actions.forEach((a, i) => {
      if (!isActionValid(a)) e[`action_${i}`] = 'Fill in all required fields.';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      if (values.length === 0) delete next[key];
      else next[key] = values;
      return next;
    });
  };

  const handleSortChange = (key: string) => {
    setSort(prev =>
      prev?.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  };

  const resetDialog = () => {
    setNewName('');
    setNewTrigger('');
    setActions([{ ...DEFAULT_ACTION }]);
    setErrors({});
  };

  const openCreate = () => { resetDialog(); setCreateOpen(true); };

  const handleCreate = async () => {
    if (!validate()) return;
    try {
      await createWorkflow.mutateAsync({
        name:           newName.trim(),
        trigger_event:  newTrigger.trim(),
        trigger_filter: {},
        is_active:      true,
        actions: actions.map(a => ({
          type:   a.type,
          config: Object.fromEntries(
            Object.entries(a.config).map(([k, v]) => [k, v.trim()]),
          ),
        })),
      });
      resetDialog();
      setCreateOpen(false);
      toast({ title: 'Workflow created' });
    } catch {
      toast({ title: 'Error', description: 'Failed to create workflow.', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkflow.mutateAsync(id);
      setConfirmDelete(null);
      toast({ title: 'Workflow deleted' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete workflow.', variant: 'destructive' });
    }
  };

  const updateAction = (i: number, a: ActionDraft) => {
    setActions(prev => prev.map((x, idx) => idx === i ? a : x));
    setErrors(prev => { const next = { ...prev }; delete next[`action_${i}`]; return next; });
  };

  const removeAction = (i: number) => {
    setActions(prev => prev.filter((_, idx) => idx !== i));
  };

  // ── Filtered list ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let items = [...workflows];

    if (search.trim()) {
      const lower = search.toLowerCase();
      items = items.filter((w: any) =>
        (w.name ?? '').toLowerCase().includes(lower) ||
        (w.trigger_event ?? '').toLowerCase().includes(lower),
      );
    }

    if (activeFilters.status?.length) {
      items = items.filter((w: any) => {
        const active = w.is_active !== false;
        return (activeFilters.status.includes('active') && active) ||
               (activeFilters.status.includes('paused') && !active);
      });
    }

    if (sort) {
      items.sort((a: any, b: any) => {
        const av = String(a[sort.key] ?? '');
        const bv = String(b[sort.key] ?? '');
        return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    return items;
  }, [workflows, search, activeFilters, sort]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Workflows"
        icon={Zap}
        iconClassName="text-amber-500"
        description="Event-driven automations that trigger on CRM events and execute a chain of actions."
        badge={workflows.length > 0 ? (
          <span className="text-xs text-muted-foreground">{workflows.length} total</span>
        ) : undefined}
      />

      <ListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search workflows…"
        filters={FILTER_CONFIGS}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})}
        sortOptions={SORT_OPTIONS}
        currentSort={sort}
        onSortChange={handleSortChange}
        onAdd={openCreate}
        addLabel="New Workflow"
        entityType="workflows"
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6">
        {isLoading ? (
          <div className="space-y-2 pt-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-muted/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <Zap className="w-14 h-14 text-muted-foreground/30 mb-4" />
            <p className="text-base font-display font-semibold text-foreground mb-1">
              {workflows.length === 0 ? 'No workflows yet' : 'No matches'}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {workflows.length === 0
                ? 'Create your first workflow to automate CRM actions on events.'
                : 'Try adjusting your search or filter.'}
            </p>
          </motion.div>
        ) : (
          <div className="space-y-2 pt-2">
            {filtered.map((wf: any, i: number) => (
              <motion.div
                key={wf.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className="flex items-center gap-3 p-4 bg-card border border-border rounded-xl cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => openDrawer('workflow', wf.id)}
              >
                {/* Inline active toggle */}
                <button
                  onClick={(e) => handleToggleActive(e, wf)}
                  disabled={togglingId === wf.id}
                  title={wf.is_active !== false ? 'Pause workflow' : 'Activate workflow'}
                  className="flex-shrink-0 p-1 rounded transition-colors hover:bg-muted"
                >
                  {togglingId === wf.id
                    ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    : wf.is_active !== false
                      ? <Pause className="w-4 h-4 text-emerald-500" />
                      : <Play className="w-4 h-4 text-muted-foreground" />
                  }
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-foreground truncate">{wf.name}</span>
                    <Badge
                      variant={wf.is_active !== false ? 'default' : 'secondary'}
                      className="text-[10px]"
                    >
                      {wf.is_active !== false ? 'Active' : 'Paused'}
                    </Badge>
                    {wf.error_count > 0 && (
                      <span className="text-[10px] text-amber-500">⚠ {wf.error_count} errors</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span className="font-mono">{wf.trigger_event}</span>
                    {Array.isArray(wf.actions) && wf.actions.length > 0 && (
                      <span>{wf.actions.length} action{wf.actions.length !== 1 ? 's' : ''}</span>
                    )}
                    {wf.run_count != null && (
                      <span>{wf.run_count} run{wf.run_count !== 1 ? 's' : ''}</span>
                    )}
                    {wf.last_run_at && (
                      <span>last run {new Date(wf.last_run_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirmDelete === wf.id) {
                      handleDelete(wf.id);
                    } else {
                      setConfirmDelete(wf.id);
                      setTimeout(() => setConfirmDelete(null), 3000);
                    }
                  }}
                  className={`p-1.5 rounded-lg transition-colors ${
                    confirmDelete === wf.id
                      ? 'text-destructive bg-destructive/10'
                      : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                  }`}
                  title={confirmDelete === wf.id ? 'Click again to confirm' : 'Delete'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* ── Create Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) resetDialog(); setCreateOpen(o); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              New Workflow
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                value={newName}
                onChange={e => { setNewName(e.target.value); setErrors(p => ({ ...p, name: '' })); }}
                placeholder="e.g. Notify on new deal"
                className={inputCls}
                autoFocus
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>

            {/* Trigger Event */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Trigger Event <span className="text-destructive">*</span>
              </label>
              <TriggerCombobox
                value={newTrigger}
                onChange={v => { setNewTrigger(v); setErrors(p => ({ ...p, trigger: '' })); }}
              />
              {errors.trigger
                ? <p className="text-xs text-destructive">{errors.trigger}</p>
                : <p className="text-[10px] text-muted-foreground">
                    Start typing to filter known events, or enter a custom event name.
                  </p>
              }
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Actions <span className="text-destructive">*</span>
                </label>
                <span className="text-[10px] text-muted-foreground">{actions.length}/{MAX_ACTIONS}</span>
              </div>
              {actions.map((action, i) => (
                <div key={i}>
                  <ActionRow
                    action={action}
                    onChange={a => updateAction(i, a)}
                    onRemove={() => removeAction(i)}
                    canRemove={actions.length > 1}
                  />
                  {errors[`action_${i}`] && (
                    <p className="text-xs text-destructive mt-1">{errors[`action_${i}`]}</p>
                  )}
                </div>
              ))}
              {actions.length < MAX_ACTIONS && (
                <button
                  type="button"
                  onClick={() => setActions(prev => [...prev, { ...DEFAULT_ACTION }])}
                  className="w-full py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Add another action
                </button>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetDialog(); setCreateOpen(false); }}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createWorkflow.isPending}
              className="gap-1.5"
            >
              {createWorkflow.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
