// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TopBar } from '@/components/layout/TopBar';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import {
  useWorkflows, useDeleteWorkflow, useUpdateWorkflowById,
  useManualTriggerWorkflow, useWorkflowRuns, useTestWorkflow,
} from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import {
  Zap, Trash2, Loader2, Play, Pause, UserCheck, Bot,
  ChevronDown, ChevronUp, Pencil, Power, PowerOff, X,
  ListOrdered, CheckCircle2, XCircle, AlertCircle, Clock,
  FlaskConical, ArrowRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { ACTION_TYPES } from '@/lib/workflowConstants';

// ── Constants ─────────────────────────────────────────────────────────────────

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

const RUN_STATUS: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  completed: { label: 'Completed', cls: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', Icon: CheckCircle2 },
  failed:    { label: 'Failed',    cls: 'text-destructive bg-destructive/10 border-destructive/20', Icon: XCircle },
  running:   { label: 'Running',   cls: 'text-blue-500 bg-blue-500/10 border-blue-500/20',         Icon: Loader2 },
  pending:   { label: 'Pending',   cls: 'text-amber-500 bg-amber-500/10 border-amber-500/20',      Icon: Clock },
  skipped:   { label: 'Skipped',   cls: 'text-muted-foreground bg-muted border-border',            Icon: ArrowRight },
};

// ── Action read view ───────────────────────────────────────────────────────────

function ActionReadView({ actions }: { actions: any[] }) {
  if (!actions?.length) return (
    <div className="text-center py-6 text-muted-foreground">
      <ListOrdered className="w-6 h-6 mx-auto mb-2 opacity-30" />
      <p className="text-sm">No actions configured</p>
    </div>
  );

  return (
    <div className="space-y-2">
      {actions.map((action: any, i: number) => {
        const def = ACTION_TYPES.find(d => d.value === action.type);
        const isHITL = def?.isHITL || action.config?.require_approval === true || action.config?.require_approval === 'true';
        const cfg = action.config ?? {};

        // Short preview of config
        const preview = cfg.title ?? cfg.subject ?? cfg.body ?? cfg.url ?? cfg.tag ?? cfg.field ?? '';
        const previewStr = preview ? String(preview).slice(0, 80) : '';

        return (
          <div key={i} className="flex gap-3 items-start">
            <div className="flex flex-col items-center shrink-0 pt-0.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                isHITL ? 'bg-amber-500/15' : 'bg-primary/10'
              }`}>
                {isHITL
                  ? <UserCheck className="w-3 h-3 text-amber-500" />
                  : <Bot className="w-3 h-3 text-primary" />}
              </div>
              {i < actions.length - 1 && <div className="w-px flex-1 bg-border mt-1 min-h-[16px]" />}
            </div>
            <div className="flex-1 pb-2 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className="text-xs font-semibold text-foreground">
                  {def?.label ?? action.type}
                </span>
                {isHITL && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-semibold">
                    Human review
                  </span>
                )}
              </div>
              {previewStr && (
                <p className="text-xs text-muted-foreground truncate">{previewStr}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Runs tab ───────────────────────────────────────────────────────────────────

function RunsTab({ workflowId }: { workflowId: string }) {
  const { data, isLoading } = useWorkflowRuns(workflowId, { limit: 20 }) as any;
  const runs: any[] = data?.data ?? data?.runs ?? [];

  if (isLoading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  );

  if (runs.length === 0) return (
    <div className="text-center py-8 text-muted-foreground">
      <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
      <p className="text-sm">No runs yet</p>
      <p className="text-xs mt-1">Runs will appear here after this trigger fires</p>
    </div>
  );

  return (
    <div className="space-y-2">
      {runs.map((run: any) => {
        const cfg = RUN_STATUS[run.status] ?? RUN_STATUS.pending;
        const Icon = cfg.Icon;
        return (
          <div key={run.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card text-xs">
            <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded border font-semibold shrink-0 ${cfg.cls}`}>
              <Icon className={`w-3 h-3 ${run.status === 'running' ? 'animate-spin' : ''}`} />
              {cfg.label}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-foreground font-medium truncate">
                {run.trigger_event ?? 'manual'}
              </p>
              {run.objective && (
                <p className="text-[10px] text-orange-500 truncate font-medium">"{run.objective}"</p>
              )}
              {run.error && (
                <p className="text-destructive truncate">{run.error}</p>
              )}
            </div>
            <div className="text-right text-muted-foreground shrink-0">
              <p>{run.actions_run ?? 0}/{run.actions_total ?? '?'} actions</p>
              <p>{run.started_at ? new Date(run.started_at).toLocaleString() : ''}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Test tab ───────────────────────────────────────────────────────────────────

function TestTab({ workflowId, triggerEvent }: { workflowId: string; triggerEvent: string }) {
  const isManual = triggerEvent === 'manual';
  const testWorkflow = useTestWorkflow();
  const manualTrigger = useManualTriggerWorkflow();
  const [payload, setPayload] = useState('{}');
  const [payloadError, setPayloadError] = useState('');
  const [objective, setObjective] = useState('');
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const parsePayload = (): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(payload || '{}');
      setPayloadError('');
      return parsed;
    } catch {
      setPayloadError('Invalid JSON');
      return null;
    }
  };

  const handleDryRun = async () => {
    const p = parsePayload();
    if (!p) return;
    try {
      const res = await testWorkflow.mutateAsync({ id: workflowId, sample_payload: p });
      setResult(res);
    } catch (err: any) {
      toast({ title: 'Test failed', description: err?.message, variant: 'destructive' });
    }
  };

  const handleRunNow = async () => {
    const p = parsePayload();
    if (!p) return;
    // Inject objective into the payload when provided
    const enriched = objective.trim() ? { ...p, objective: objective.trim() } : p;
    setRunning(true);
    try {
      const res = await manualTrigger.mutateAsync({ id: workflowId, payload: enriched });
      setResult(res);
      toast({ title: 'Trigger executed', description: `Run ${(res as any)?.run_id?.slice(0, 8) ?? ''}` });
    } catch (err: any) {
      toast({ title: 'Trigger failed', description: err?.message, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Objective field — only for manual triggers */}
      {isManual && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Objective <span className="normal-case font-normal text-muted-foreground/60">(optional)</span>
          </label>
          <input
            type="text"
            value={objective}
            onChange={e => setObjective(e.target.value)}
            placeholder="e.g. Follow up on Q2 renewal — contact opened email twice"
            className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-[10px] text-muted-foreground">
            Gives agents context about why this run was triggered. Passed as <code className="font-mono bg-muted px-1 rounded">payload.objective</code>.
          </p>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {isManual ? 'Input Variables (JSON)' : 'Sample Payload (JSON)'}
        </label>
        <textarea
          value={payload}
          onChange={e => { setPayload(e.target.value); setPayloadError(''); }}
          rows={4}
          spellCheck={false}
          className={`w-full px-3 py-2 rounded-lg border bg-background text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none ${
            payloadError ? 'border-destructive' : 'border-border'
          }`}
          placeholder={isManual ? '{\n  "contact_id": "..."\n}' : '{\n  "contact": { "first_name": "Jane" }\n}'}
        />
        {payloadError && <p className="text-xs text-destructive">{payloadError}</p>}
      </div>

      <div className="flex items-center gap-2">
        {!isManual && (
          <button
            onClick={handleDryRun}
            disabled={testWorkflow.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
          >
            {testWorkflow.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <FlaskConical className="w-3.5 h-3.5" />}
            Dry run
          </button>
        )}
        <button
          onClick={handleRunNow}
          disabled={running || manualTrigger.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          {(running || manualTrigger.isPending)
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Play className="w-3.5 h-3.5" />}
          {isManual ? 'Run now' : 'Run live'}
        </button>
      </div>

      {result && (
        <div className="rounded-lg bg-muted/40 border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Result</p>
          <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Trigger Row ────────────────────────────────────────────────────────────────

type RowTab = 'actions' | 'runs' | 'test';

const ROW_TABS: { key: RowTab; label: string }[] = [
  { key: 'actions', label: 'Actions' },
  { key: 'runs',    label: 'Runs'    },
  { key: 'test',    label: 'Test'    },
];

function TriggerRow({ wf }: { wf: any }) {
  const { openWorkflowEditor } = useAppStore();
  const updateWorkflowById = useUpdateWorkflowById();
  const deleteWorkflow = useDeleteWorkflow();

  const [expanded,      setExpanded]      = useState(false);
  const [tab,           setTab]           = useState<RowTab>('actions');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toggling,      setToggling]      = useState(false);

  const isActive = wf.is_active !== false;
  const isManual = wf.trigger_event === 'manual';
  const hasHITL  = Array.isArray(wf.actions) && wf.actions.some((a: any) => {
    const def = ACTION_TYPES.find(d => d.value === a.type);
    return def?.isHITL || a.config?.require_approval === true || a.config?.require_approval === 'true';
  });

  const handleToggleActive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setToggling(true);
    try {
      await updateWorkflowById.mutateAsync({ id: wf.id, is_active: !isActive });
      toast({ title: isActive ? 'Trigger paused' : 'Trigger activated' });
    } catch {
      toast({ title: 'Error', variant: 'destructive' });
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteWorkflow.mutateAsync(wf.id);
      toast({ title: 'Trigger deleted' });
    } catch {
      toast({ title: 'Failed to delete', variant: 'destructive' });
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Active icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isActive ? 'bg-amber-500/15' : 'bg-muted'
        }`}>
          <Zap className={`w-4 h-4 ${isActive ? 'text-amber-500' : 'text-muted-foreground'}`} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-semibold text-foreground truncate">{wf.name}</span>
            <Badge variant={isActive ? 'default' : 'secondary'} className="text-[10px] shrink-0">
              {isActive ? 'Active' : 'Paused'}
            </Badge>
            {hasHITL && (
              <Badge className="text-[9px] px-1.5 bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15 shrink-0">
                <UserCheck className="w-2.5 h-2.5 mr-0.5" />Human
              </Badge>
            )}
            {isManual && (
              <Badge variant="outline" className="text-[9px] px-1.5 text-blue-600 dark:text-blue-400 border-blue-500/30 shrink-0">
                On demand
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="font-mono">{wf.trigger_event}</span>
            {Array.isArray(wf.actions) && wf.actions.length > 0 && (
              <span className="flex items-center gap-1">
                {hasHITL
                  ? <UserCheck className="w-3 h-3 text-amber-500" />
                  : <Bot className="w-3 h-3" />}
                {wf.actions.length} action{wf.actions.length !== 1 ? 's' : ''}
              </span>
            )}
            {wf.run_count != null && (
              <span>{wf.run_count} run{wf.run_count !== 1 ? 's' : ''}</span>
            )}
            {wf.last_run_at && (
              <span>last run {new Date(wf.last_run_at).toLocaleDateString()}</span>
            )}
            {wf.error_count > 0 && (
              <span className="text-amber-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />{wf.error_count} error{wf.error_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Toggle active */}
          <button
            onClick={handleToggleActive}
            disabled={toggling}
            title={isActive ? 'Pause' : 'Activate'}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
          >
            {toggling
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : isActive
                ? <Power className="w-4 h-4 text-emerald-500" />
                : <PowerOff className="w-4 h-4" />}
          </button>

          {/* Edit */}
          <button
            onClick={() => openWorkflowEditor(wf.id)}
            title="Edit trigger"
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
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border">
              {/* Tab bar */}
              <div className="flex border-b border-border px-4">
                {ROW_TABS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                      tab === key
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                    {key === 'runs' && wf.run_count > 0 && (
                      <span className="text-[10px] px-1 rounded-full bg-muted text-muted-foreground">{wf.run_count}</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-4 bg-muted/10">
                {tab === 'actions' && (
                  <ActionReadView actions={wf.actions ?? []} />
                )}
                {tab === 'runs' && (
                  <RunsTab workflowId={wf.id} />
                )}
                {tab === 'test' && (
                  <TestTab workflowId={wf.id} triggerEvent={wf.trigger_event ?? ''} />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkflowsPage({ embedded }: { embedded?: boolean } = {}) {
  const { openWorkflowEditor } = useAppStore();

  const [search,        setSearch]        = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort,          setSort]          = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const { data, isLoading } = useWorkflows() as any;
  const workflows: any[] = (data as any)?.data ?? [];

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

  return (
    <div className={embedded ? 'flex-1 min-h-0 flex flex-col' : 'flex flex-col h-full'}>
      {!embedded && (
        <TopBar
          title="Triggers"
          icon={Zap}
          iconClassName="text-amber-500"
          description="Event-driven automations that trigger on CRM events and execute a chain of actions."
          badge={workflows.length > 0 ? (
            <span className="text-xs text-muted-foreground">{workflows.length} total</span>
          ) : undefined}
        />
      )}

      <ListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search triggers…"
        filters={FILTER_CONFIGS}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})}
        sortOptions={SORT_OPTIONS}
        currentSort={sort}
        onSortChange={handleSortChange}
        entityType="workflows"
        onAdd={() => openWorkflowEditor(null)}
        addLabel="New Trigger"
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6 pt-2">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-muted/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-4">
              <Zap className="w-8 h-8 text-amber-500" />
            </div>
            <h2 className="text-lg font-display font-semibold text-foreground mb-1">No triggers yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
              Create your first trigger to automate CRM actions when events occur.
            </p>
            <button
              onClick={() => openWorkflowEditor(null)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <span className="flex items-center gap-1.5"><Zap className="w-4 h-4" /> Create your first trigger</span>
            </button>
          </motion.div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <Zap className="w-8 h-8 mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No triggers match your search</p>
          </motion.div>
        ) : (
          <div className="space-y-3">
            {filtered.map((wf: any) => (
              <TriggerRow key={wf.id} wf={wf} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
