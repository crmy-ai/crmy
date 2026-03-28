// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { useWorkflows, useCreateWorkflow, useDeleteWorkflow } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { motion } from 'framer-motion';
import {
  Zap,
  Search,
  Plus,
  Trash2,
  Loader2,
  Play,
  Pause,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';

export default function WorkflowsPage() {
  const { openDrawer } = useAppStore();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTrigger, setNewTrigger] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isLoading } = useWorkflows() as any;
  const createWorkflow = useCreateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();

  const workflows: any[] = (data as any)?.data ?? [];

  const filtered = useMemo(() => {
    let items = workflows;
    if (q.trim()) {
      const lower = q.toLowerCase();
      items = items.filter((w: any) =>
        (w.name ?? '').toLowerCase().includes(lower) ||
        (w.trigger_event ?? '').toLowerCase().includes(lower)
      );
    }
    if (statusFilter === 'active') items = items.filter((w: any) => w.enabled !== false);
    if (statusFilter === 'paused') items = items.filter((w: any) => w.enabled === false);
    return items;
  }, [workflows, q, statusFilter]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createWorkflow.mutateAsync({
        name: newName.trim(),
        trigger_event: newTrigger.trim() || 'contact.created',
        enabled: true,
        conditions: {},
        actions: [],
      });
      setNewName('');
      setNewTrigger('');
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

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Workflows" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-5 h-5 text-amber-500" />
            <h1 className="text-xl font-display font-bold text-foreground">Workflows</h1>
            {workflows.length > 0 && (
              <span className="text-xs text-muted-foreground ml-1">{workflows.length} total</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Event-driven automations. Workflows trigger on CRM events and execute a chain of actions.
          </p>
        </motion.div>

        {/* Toolbar */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }} className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search workflows…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden h-8">
            {(['all', 'active', 'paused'] as const).map((s) => (
              <button
                key={s}
                className={`px-3 text-xs font-medium transition-colors capitalize ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'} ${s !== 'all' ? 'border-l border-border' : ''}`}
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3 h-3" />
            New Workflow
          </Button>
        </motion.div>

        {/* Content */}
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20 text-center">
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
          <div className="space-y-2">
            {filtered.map((wf: any, i: number) => (
              <motion.div
                key={wf.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className="flex items-center gap-3 p-4 bg-card border border-border rounded-xl cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => openDrawer('workflow', wf.id)}
              >
                <div className="flex-shrink-0">
                  {wf.enabled !== false ? (
                    <Play className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Pause className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-foreground truncate">{wf.name}</span>
                    <Badge variant={wf.enabled !== false ? 'default' : 'secondary'} className="text-[10px]">
                      {wf.enabled !== false ? 'Active' : 'Paused'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{wf.trigger_event}</span>
                    {wf.updated_at && (
                      <span>· Updated {new Date(wf.updated_at).toLocaleDateString()}</span>
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
                  className={`p-1.5 rounded-lg transition-colors ${confirmDelete === wf.id ? 'text-destructive bg-destructive/10' : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              New Workflow
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</label>
              <Input
                placeholder="e.g. Notify on new deal"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trigger Event</label>
              <Input
                placeholder="e.g. opportunity.created"
                value={newTrigger}
                onChange={(e) => setNewTrigger(e.target.value)}
                className="h-9 text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Events: contact.created, contact.updated, opportunity.created, opportunity.stage_changed, activity.created, etc.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createWorkflow.isPending} className="gap-1.5">
              {createWorkflow.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
