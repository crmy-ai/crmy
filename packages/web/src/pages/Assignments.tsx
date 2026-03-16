// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import {
  useAssignments,
  useWhoAmI,
  useAcceptAssignment,
  useStartAssignment,
  useCompleteAssignment,
  useDeclineAssignment,
  useBlockAssignment,
  useCancelAssignment,
} from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { ClipboardList, Play, CheckCircle2, XCircle, Ban, AlertOctagon } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

type Tab = 'mine' | 'delegated' | 'all';
type DrawerType = 'contact' | 'opportunity' | 'use-case' | 'account';

const SUBJECT_TYPE_DRAWER: Record<string, DrawerType> = {
  contact: 'contact',
  account: 'account',
  opportunity: 'opportunity',
  use_case: 'use-case',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  accepted: '#3b82f6',
  in_progress: '#8b5cf6',
  blocked: '#ef4444',
  completed: '#22c55e',
  declined: '#94a3b8',
  cancelled: '#94a3b8',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  normal: '#3b82f6',
  low: '#94a3b8',
};

interface Assignment {
  id: string;
  title: string;
  description?: string;
  assignment_type: string;
  status: string;
  priority: string;
  subject_type: string;
  subject_id: string;
  assigned_to: string;
  assigned_by: string;
  context?: string;
  created_at: string;
  due_at?: string;
}

export default function AssignmentsPage() {
  const [tab, setTab] = useState<Tab>('mine');
  const [statusFilter, setStatusFilter] = useState<string>('open');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: whoami } = useWhoAmI() as any;
  const myActorId = whoami?.actor_id;

  const params: Record<string, string | number | boolean | undefined> = { limit: 50 };
  if (tab === 'mine' && myActorId) params.assigned_to = myActorId;
  if (tab === 'delegated' && myActorId) params.assigned_by = myActorId;
  if (statusFilter && statusFilter !== 'all') {
    params.status = statusFilter === 'open' ? 'pending,accepted,in_progress,blocked' : statusFilter;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = useAssignments(params) as any;
  const assignments: Assignment[] = data?.data ?? [];

  const acceptMutation = useAcceptAssignment();
  const startMutation = useStartAssignment();
  const completeMutation = useCompleteAssignment();
  const declineMutation = useDeclineAssignment();
  const blockMutation = useBlockAssignment();
  const cancelMutation = useCancelAssignment();
  const { openDrawer } = useAppStore();

  const handleAction = async (action: string, id: string) => {
    try {
      switch (action) {
        case 'accept': await acceptMutation.mutateAsync(id); break;
        case 'start': await startMutation.mutateAsync(id); break;
        case 'complete': await completeMutation.mutateAsync({ id }); break;
        case 'decline': await declineMutation.mutateAsync({ id }); break;
        case 'block': await blockMutation.mutateAsync({ id }); break;
        case 'cancel': await cancelMutation.mutateAsync({ id }); break;
      }
      toast({ title: `Assignment ${action}ed` });
    } catch {
      toast({ title: `Failed to ${action} assignment`, variant: 'destructive' });
    }
  };

  const getActions = (a: Assignment) => {
    const actions: { label: string; action: string; icon: React.ReactNode; variant?: string }[] = [];
    switch (a.status) {
      case 'pending':
        actions.push({ label: 'Accept', action: 'accept', icon: <CheckCircle2 className="w-3 h-3" /> });
        actions.push({ label: 'Decline', action: 'decline', icon: <XCircle className="w-3 h-3" />, variant: 'muted' });
        break;
      case 'accepted':
        actions.push({ label: 'Start', action: 'start', icon: <Play className="w-3 h-3" /> });
        actions.push({ label: 'Block', action: 'block', icon: <AlertOctagon className="w-3 h-3" />, variant: 'warning' });
        break;
      case 'in_progress':
        actions.push({ label: 'Complete', action: 'complete', icon: <CheckCircle2 className="w-3 h-3" /> });
        actions.push({ label: 'Block', action: 'block', icon: <AlertOctagon className="w-3 h-3" />, variant: 'warning' });
        break;
      case 'blocked':
        actions.push({ label: 'Start', action: 'start', icon: <Play className="w-3 h-3" /> });
        actions.push({ label: 'Cancel', action: 'cancel', icon: <Ban className="w-3 h-3" />, variant: 'destructive' });
        break;
    }
    if (!['completed', 'declined', 'cancelled'].includes(a.status)) {
      actions.push({ label: 'Cancel', action: 'cancel', icon: <Ban className="w-3 h-3" />, variant: 'destructive' });
    }
    return actions;
  };

  return (
    <>
      <TopBar title="Assignments" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {/* Tabs */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
            {(['mine', 'delegated', 'all'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all capitalize ${tab === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {t === 'mine' ? 'My Queue' : t === 'delegated' ? 'Delegated' : 'All'}
              </button>
            ))}
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-8 px-2 rounded-md border border-border bg-background text-xs text-foreground"
          >
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="in_progress">In Progress</option>
            <option value="blocked">Blocked</option>
            <option value="completed">Completed</option>
            <option value="declined">Declined</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </div>

        {/* Assignment list */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        ) : assignments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardList className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No assignments found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {assignments.map(a => {
              const statusColor = STATUS_COLORS[a.status] ?? '#94a3b8';
              const priorityColor = PRIORITY_COLORS[a.priority] ?? '#94a3b8';
              const actions = getActions(a);
              const canOpenSubject = SUBJECT_TYPE_DRAWER[a.subject_type];

              return (
                <div
                  key={a.id}
                  className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize"
                          style={{ backgroundColor: statusColor + '18', color: statusColor }}
                        >
                          {a.status.replace(/_/g, ' ')}
                        </span>
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: priorityColor }}
                          title={a.priority}
                        />
                        <span className="text-[10px] text-muted-foreground capitalize">{a.priority}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {new Date(a.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className="text-sm font-medium text-foreground truncate">{a.title}</h4>
                      {a.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{a.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] text-muted-foreground capitalize px-1.5 py-0.5 rounded bg-muted">
                          {a.assignment_type.replace(/_/g, ' ')}
                        </span>
                        {canOpenSubject && (
                          <button
                            onClick={() => openDrawer(canOpenSubject, a.subject_id)}
                            className="text-[10px] text-primary hover:underline"
                          >
                            View {a.subject_type.replace(/_/g, ' ')}
                          </button>
                        )}
                        {a.due_at && (
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            Due: {new Date(a.due_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {a.context && (
                        <p className="text-[10px] text-muted-foreground/80 mt-1.5 italic line-clamp-2">{a.context}</p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {actions.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border">
                      {actions.map(act => (
                        <button
                          key={act.action}
                          onClick={() => handleAction(act.action, a.id)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                            act.variant === 'destructive'
                              ? 'text-destructive hover:bg-destructive/10'
                              : act.variant === 'warning'
                              ? 'text-warning hover:bg-warning/10'
                              : act.variant === 'muted'
                              ? 'text-muted-foreground hover:bg-muted'
                              : 'bg-primary/10 text-primary hover:bg-primary/20'
                          }`}
                        >
                          {act.icon} {act.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
