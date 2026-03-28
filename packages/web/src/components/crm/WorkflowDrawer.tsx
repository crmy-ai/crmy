// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useWorkflow, useUpdateWorkflow, useDeleteWorkflow, useWorkflowRuns } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import {
  Zap,
  Play,
  Pause,
  Pencil,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';

export function WorkflowDrawer() {
  const { drawerEntityId, closeDrawer } = useAppStore();
  const id = drawerEntityId ?? '';
  const { data, isLoading } = useWorkflow(id) as any;
  const updateWorkflow = useUpdateWorkflow(id);
  const deleteWorkflow = useDeleteWorkflow();
  const { data: runsData, isLoading: runsLoading } = useWorkflowRuns(id, { limit: 20 });
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editTrigger, setEditTrigger] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'runs'>('details');

  const wf = (data as any)?.workflow ?? data;
  const runs: any[] = (runsData as any)?.data ?? (runsData as any)?.runs ?? [];

  if (isLoading || !wf) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }

  const startEdit = () => {
    setEditName(wf.name ?? '');
    setEditTrigger(wf.trigger_event ?? '');
    setEditing(true);
  };

  const saveEdit = async () => {
    try {
      await updateWorkflow.mutateAsync({ name: editName, trigger_event: editTrigger });
      setEditing(false);
      toast({ title: 'Workflow updated' });
    } catch {
      toast({ title: 'Error', variant: 'destructive' });
    }
  };

  const toggleEnabled = async () => {
    try {
      await updateWorkflow.mutateAsync({ enabled: !wf.enabled });
      toast({ title: wf.enabled ? 'Workflow paused' : 'Workflow activated' });
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

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-amber-500" />
        <h3 className="text-lg font-display font-bold text-foreground flex-1 truncate">
          {wf.name}
        </h3>
        <Badge variant={wf.enabled !== false ? 'default' : 'secondary'} className="text-[10px]">
          {wf.enabled !== false ? 'Active' : 'Paused'}
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

      {activeTab === 'details' && (
        <div className="space-y-4">
          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trigger Event</label>
                <Input value={editTrigger} onChange={(e) => setEditTrigger(e.target.value)} className="h-8 text-sm font-mono" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={saveEdit} disabled={updateWorkflow.isPending} className="text-xs gap-1">
                  {updateWorkflow.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="text-xs">Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trigger Event</p>
                  <p className="text-sm font-mono text-foreground">{wf.trigger_event}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={startEdit} className="text-xs gap-1">
                  <Pencil className="w-3 h-3" /> Edit
                </Button>
              </div>

              {wf.conditions && Object.keys(wf.conditions).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Conditions</p>
                  <pre className="text-[10px] p-2 rounded-lg bg-muted text-muted-foreground overflow-x-auto">
                    {JSON.stringify(wf.conditions, null, 2)}
                  </pre>
                </div>
              )}

              {wf.actions?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Actions ({wf.actions.length})</p>
                  <pre className="text-[10px] p-2 rounded-lg bg-muted text-muted-foreground overflow-x-auto max-h-40">
                    {JSON.stringify(wf.actions, null, 2)}
                  </pre>
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-border">
                <Button size="sm" variant="outline" onClick={toggleEnabled} className="text-xs gap-1">
                  {wf.enabled !== false ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  {wf.enabled !== false ? 'Pause' : 'Activate'}
                </Button>
                <Button size="sm" variant="outline" onClick={handleDelete} className="text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10">
                  <Trash2 className="w-3 h-3" /> Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'runs' && (
        <div className="space-y-2">
          {runsLoading ? (
            <div className="text-xs text-muted-foreground text-center py-4">Loading runs…</div>
          ) : runs.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No runs yet.</p>
          ) : runs.map((run: any) => (
            <div key={run.id} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card">
              {run.status === 'completed' || run.status === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              ) : run.status === 'failed' || run.status === 'error' ? (
                <XCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={run.status === 'completed' || run.status === 'success' ? 'default' : run.status === 'failed' || run.status === 'error' ? 'destructive' : 'secondary'} className="text-[10px]">
                    {run.status}
                  </Badge>
                  {run.duration_ms != null && (
                    <span className="text-[10px] text-muted-foreground">{run.duration_ms}ms</span>
                  )}
                </div>
                {run.error && (
                  <p className="text-[10px] text-destructive truncate mt-0.5">{run.error}</p>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">
                {run.created_at ? new Date(run.created_at).toLocaleString() : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
