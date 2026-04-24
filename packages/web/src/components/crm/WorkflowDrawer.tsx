// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import {
  useWorkflow, useUpdateWorkflow, useDeleteWorkflow,
  useWorkflowRuns, useTestWorkflow, useCloneWorkflow,
  useManualTriggerWorkflow,
} from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
  Zap, Play, Pause, Pencil, Trash2, Clock, Copy,
  CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight,
  FlaskConical, UserCheck, Bot,
} from 'lucide-react';
import {
  TRIGGER_EVENTS, ACTION_TYPES, getSamplePayload,
} from '@/lib/workflowConstants';
import { WorkflowFilterBuilder } from './WorkflowFilterBuilder';
import { filterToConditions } from '@/lib/workflowConstants';

// ── Shared styles ──────────────────────────────────────────────────────────────

const textareaCls = 'w-full px-2.5 py-1.5 rounded-md border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none font-mono';


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
  const { drawerEntityId, closeDrawer, openDrawer, openWorkflowEditor } = useAppStore();
  const id = drawerEntityId ?? '';
  const { data, isLoading } = useWorkflow(id) as any;
  const updateWorkflow  = useUpdateWorkflow(id);
  const deleteWorkflow  = useDeleteWorkflow();
  const cloneWorkflow   = useCloneWorkflow();
  const manualTrigger   = useManualTriggerWorkflow();
  const { data: runsData, isLoading: runsLoading } = useWorkflowRuns(id, { limit: 20 });

  const [activeTab,   setActiveTab]   = useState<'details' | 'runs' | 'test'>('details');
  const [runningNow,  setRunningNow]  = useState(false);

  const wf   = (data as any)?.workflow ?? data;
  const runs: any[] = (runsData as any)?.data ?? (runsData as any)?.runs ?? [];

  if (isLoading || !wf) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }

  const isManual = wf.trigger_event === 'manual';

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

  const handleRunNow = async () => {
    setRunningNow(true);
    try {
      await manualTrigger.mutateAsync({ id, payload: {} });
      toast({ title: 'Automation triggered', description: 'Check Runs tab for status.' });
      setActiveTab('runs');
    } catch {
      toast({ title: 'Trigger failed', variant: 'destructive' });
    } finally {
      setRunningNow(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const hasHITL = Array.isArray(wf.actions) && wf.actions.some((a: any) => {
    const def = ACTION_TYPES.find(d => d.value === a.type);
    return def?.isHITL || a.config?.require_approval === true || a.config?.require_approval === 'true';
  });

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-amber-500 shrink-0" />
        <h3 className="text-base font-display font-bold text-foreground flex-1 truncate">
          {wf.name}
        </h3>
        <Badge variant={wf.is_active !== false ? 'default' : 'secondary'} className="text-[10px] shrink-0">
          {wf.is_active !== false ? 'Active' : 'Paused'}
        </Badge>
        {hasHITL && (
          <Badge className="shrink-0 text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15 px-1.5">
            <UserCheck className="w-2.5 h-2.5 mr-0.5" />Human
          </Badge>
        )}
        <button
          type="button"
          onClick={handleClone}
          disabled={cloneWorkflow.isPending}
          title="Duplicate"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          {cloneWorkflow.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Copy className="w-3.5 h-3.5" />}
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
        <div className="space-y-3">
          {/* Description */}
          {wf.description && (
            <p className="text-xs text-muted-foreground italic">{wf.description}</p>
          )}

          {/* Trigger */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Trigger</p>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
              isManual
                ? 'bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400'
                : 'bg-amber-500/10 border-amber-500/20'
            }`}>
              <Zap className={`w-3.5 h-3.5 shrink-0 ${isManual ? 'text-blue-500' : 'text-amber-500'}`} />
              <span className="font-mono font-medium">{wf.trigger_event}</span>
            </div>
            {isManual && (
              <p className="text-[10px] text-muted-foreground mt-1">Manual only — no automatic trigger.</p>
            )}
          </div>

          {/* Filter conditions */}
          {wf.trigger_filter && Object.keys(wf.trigger_filter).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Conditions
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
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Actions ({wf.actions.length})
              </p>
              <div className="space-y-1">
                {wf.actions.map((action: any, i: number) => {
                  const def = ACTION_TYPES.find(a => a.value === action.type);
                  const isHITLStep = def?.isHITL ||
                    action.config?.require_approval === true ||
                    action.config?.require_approval === 'true';
                  return (
                    <div key={i} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs ${
                      isHITLStep
                        ? 'border-amber-500/30 bg-amber-500/5'
                        : 'border-border bg-muted/20'
                    }`}>
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                        isHITLStep ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground'
                      }`}>
                        {i + 1}
                      </span>
                      {isHITLStep
                        ? <UserCheck className="w-3 h-3 text-amber-500 shrink-0" />
                        : <Bot className="w-3 h-3 text-muted-foreground shrink-0" />}
                      <span className={`font-medium min-w-0 truncate ${isHITLStep ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'}`}>
                        {def?.label ?? action.type}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            {wf.run_count != null && <span>{wf.run_count} total runs</span>}
            {wf.last_run_at && <span>Last run {new Date(wf.last_run_at).toLocaleString()}</span>}
            {wf.error_count > 0 && <span className="text-amber-500">⚠ {wf.error_count} errors</span>}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            {/* Manual trigger Run Now button */}
            {isManual && (
              <Button
                size="sm" onClick={handleRunNow} disabled={runningNow}
                className="text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {runningNow ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Run now
              </Button>
            )}
            <Button
              size="sm" variant="outline" onClick={() => { closeDrawer(); openWorkflowEditor(wf.id); }}
              className="text-xs gap-1"
            >
              <Pencil className="w-3 h-3" /> Edit
            </Button>
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
