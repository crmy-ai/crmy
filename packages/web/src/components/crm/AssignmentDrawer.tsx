// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import {
  useAssignment, useUpdateAssignment,
  useAcceptAssignment, useStartAssignment, useCompleteAssignment,
  useDeclineAssignment, useBlockAssignment, useCancelAssignment,
  useActor,
} from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import {
  Pencil, ChevronLeft, ClipboardList,
  Play, CheckCircle2, XCircle, Ban, AlertOctagon,
} from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import { toast } from '@/components/ui/use-toast';

const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const labelClass = 'text-xs font-mono text-muted-foreground uppercase tracking-wider';

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

const ASSIGNMENT_TYPES = ['call', 'draft', 'email', 'follow_up', 'research', 'review', 'send'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const SUBJECT_TYPES = ['contact', 'account', 'opportunity', 'use_case'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ActorName({ id }: { id: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = useActor(id) as any;
  const actor = data?.actor;
  if (!actor) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="text-sm text-foreground">
      {actor.display_name}
      <span className="text-xs text-muted-foreground ml-1.5 capitalize">({actor.actor_type})</span>
    </span>
  );
}

function AssignmentEditForm({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assignment,
  onSave,
  onCancel,
  isSaving,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assignment: any;
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [fields, setFields] = useState({
    title: assignment.title ?? '',
    assignment_type: assignment.assignment_type ?? '',
    priority: assignment.priority ?? 'normal',
    due_at: assignment.due_at ? assignment.due_at.split('T')[0] : '',
    context: assignment.context ?? '',
    description: assignment.description ?? '',
    subject_type: assignment.subject_type ?? '',
    subject_id: assignment.subject_id ?? '',
  });

  const set = (key: string, val: string) => setFields(prev => ({ ...prev, [key]: val }));

  const handleSave = () => {
    const payload: Record<string, unknown> = { ...fields };
    if (!payload.due_at) delete payload.due_at;
    if (!payload.context) delete payload.context;
    if (!payload.description) delete payload.description;
    if (!payload.subject_type) { delete payload.subject_type; delete payload.subject_id; }
    else if (!payload.subject_id) delete payload.subject_id;
    if (payload.due_at) payload.due_at = new Date(payload.due_at as string).toISOString();
    onSave(payload);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
        <button onClick={onCancel} className="flex items-center gap-1 text-xs text-accent hover:underline">
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </button>
        <span className="text-xs text-muted-foreground ml-auto">Editing assignment</span>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="space-y-1.5">
          <label className={labelClass}>Title <span className="text-destructive">*</span></label>
          <input
            type="text"
            value={fields.title}
            onChange={e => set('title', e.target.value)}
            placeholder="e.g. Follow up with Acme about contract"
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Type <span className="text-destructive">*</span></label>
          <select value={fields.assignment_type} onChange={e => set('assignment_type', e.target.value)} className={`${inputClass} pr-3`}>
            <option value="">Select type…</option>
            {ASSIGNMENT_TYPES.map(t => (
              <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Priority</label>
          <select value={fields.priority} onChange={e => set('priority', e.target.value)} className={`${inputClass} pr-3`}>
            {PRIORITIES.map(p => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Due Date</label>
          <DatePicker value={fields.due_at} onChange={val => set('due_at', val)} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Linked To</label>
          <select value={fields.subject_type} onChange={e => { set('subject_type', e.target.value); set('subject_id', ''); }} className={`${inputClass} pr-3`}>
            <option value="">None (no link)</option>
            {SUBJECT_TYPES.map(t => (
              <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
            ))}
          </select>
        </div>
        {fields.subject_type && (
          <div className="space-y-1.5">
            <label className={labelClass}>Subject ID</label>
            <input
              type="text"
              value={fields.subject_id}
              onChange={e => set('subject_id', e.target.value)}
              placeholder="Record ID"
              className={inputClass}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <label className={labelClass}>Context</label>
          <textarea
            value={fields.context}
            onChange={e => set('context', e.target.value)}
            placeholder="Brief context for the assignee"
            rows={3}
            className={`${inputClass} h-auto py-2 resize-none`}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Description</label>
          <textarea
            value={fields.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Additional details"
            rows={3}
            className={`${inputClass} h-auto py-2 resize-none`}
          />
        </div>
        <button
          onClick={handleSave}
          disabled={!fields.title.trim() || !fields.assignment_type || isSaving}
          className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          {isSaving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

export function AssignmentDrawer() {
  const { drawerEntityId, openDrawer, closeDrawer } = useAppStore();
  const [editing, setEditing] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: assignmentData, isLoading } = useAssignment(drawerEntityId ?? '') as any;
  const updateAssignment = useUpdateAssignment(drawerEntityId ?? '');
  const acceptMutation = useAcceptAssignment();
  const startMutation = useStartAssignment();
  const completeMutation = useCompleteAssignment();
  const declineMutation = useDeclineAssignment();
  const blockMutation = useBlockAssignment();
  const cancelMutation = useCancelAssignment();

  const handleAction = async (action: string) => {
    if (!drawerEntityId) return;
    try {
      switch (action) {
        case 'accept': await acceptMutation.mutateAsync(drawerEntityId); break;
        case 'start': await startMutation.mutateAsync(drawerEntityId); break;
        case 'complete': await completeMutation.mutateAsync({ id: drawerEntityId }); break;
        case 'decline': await declineMutation.mutateAsync({ id: drawerEntityId }); break;
        case 'block': await blockMutation.mutateAsync({ id: drawerEntityId }); break;
        case 'cancel': await cancelMutation.mutateAsync({ id: drawerEntityId }); break;
      }
      toast({ title: `Assignment ${action}ed` });
    } catch (err) {
      toast({ title: `Failed to ${action} assignment`, description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6 animate-pulse">
        <div className="space-y-2">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-5 bg-muted rounded w-3/4" />
        </div>
      </div>
    );
  }

  const assignment = assignmentData?.assignment;
  if (!assignment) return <div className="p-4 text-muted-foreground">Assignment not found</div>;

  if (editing) {
    return (
      <AssignmentEditForm
        assignment={assignment}
        onSave={async (data) => {
          try {
            await updateAssignment.mutateAsync(data);
            setEditing(false);
            toast({ title: 'Assignment updated' });
          } catch (err) {
            toast({ title: 'Failed to update assignment', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
          }
        }}
        onCancel={() => setEditing(false)}
        isSaving={updateAssignment.isPending}
      />
    );
  }

  const statusColor = STATUS_COLORS[assignment.status] ?? '#94a3b8';
  const priorityColor = PRIORITY_COLORS[assignment.priority] ?? '#94a3b8';
  const isOverdue = assignment.due_at && new Date(assignment.due_at) < new Date() && !['completed', 'declined', 'cancelled'].includes(assignment.status);

  const actions: { label: string; action: string; icon: React.ReactNode; variant?: string }[] = [];
  switch (assignment.status) {
    case 'pending':
      actions.push({ label: 'Accept', action: 'accept', icon: <CheckCircle2 className="w-3.5 h-3.5" /> });
      actions.push({ label: 'Decline', action: 'decline', icon: <XCircle className="w-3.5 h-3.5" />, variant: 'muted' });
      break;
    case 'accepted':
      actions.push({ label: 'Start', action: 'start', icon: <Play className="w-3.5 h-3.5" /> });
      actions.push({ label: 'Block', action: 'block', icon: <AlertOctagon className="w-3.5 h-3.5" />, variant: 'warning' });
      break;
    case 'in_progress':
      actions.push({ label: 'Complete', action: 'complete', icon: <CheckCircle2 className="w-3.5 h-3.5" /> });
      actions.push({ label: 'Block', action: 'block', icon: <AlertOctagon className="w-3.5 h-3.5" />, variant: 'warning' });
      break;
    case 'blocked':
      actions.push({ label: 'Resume', action: 'start', icon: <Play className="w-3.5 h-3.5" /> });
      actions.push({ label: 'Cancel', action: 'cancel', icon: <Ban className="w-3.5 h-3.5" />, variant: 'destructive' });
      break;
  }
  if (!['completed', 'declined', 'cancelled', 'blocked'].includes(assignment.status)) {
    if (!actions.find(a => a.action === 'cancel')) {
      actions.push({ label: 'Cancel', action: 'cancel', icon: <Ban className="w-3.5 h-3.5" />, variant: 'destructive' });
    }
  }

  const SUBJECT_TYPE_DRAWER: Record<string, 'contact' | 'account' | 'opportunity' | 'use-case'> = {
    contact: 'contact', account: 'account', opportunity: 'opportunity', use_case: 'use-case',
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="px-2 py-0.5 rounded text-xs font-semibold capitalize"
                style={{ backgroundColor: statusColor + '18', color: statusColor }}
              >
                {assignment.status.replace(/_/g, ' ')}
              </span>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: priorityColor }} />
              <span className="text-xs text-muted-foreground capitalize">{assignment.priority}</span>
            </div>
            <h2 className="font-display font-extrabold text-xl text-foreground leading-snug">{assignment.title}</h2>
            {assignment.assignment_type && (
              <span className="text-xs text-muted-foreground capitalize mt-1 inline-block">
                {assignment.assignment_type.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          {actions.map(act => (
            <button
              key={act.action}
              onClick={() => handleAction(act.action)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all press-scale ${
                act.variant === 'destructive'
                  ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                  : act.variant === 'warning'
                  ? 'bg-warning/10 text-warning hover:bg-warning/20'
                  : act.variant === 'muted'
                  ? 'bg-muted text-muted-foreground hover:bg-muted/80'
                  : 'bg-primary/10 text-primary hover:bg-primary/20'
              }`}
            >
              {act.icon} {act.label}
            </button>
          ))}
        </div>
      </div>

      {/* Details */}
      <div className="p-4 mx-4 mt-4 space-y-3">
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">Details</h3>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Assigned To</span>
          <ActorName id={assignment.assigned_to} />
        </div>
        {assignment.assigned_by && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Assigned By</span>
            <ActorName id={assignment.assigned_by} />
          </div>
        )}
        {assignment.due_at && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Due</span>
            <span className={`text-sm flex items-center gap-1 ${isOverdue ? 'text-destructive font-medium' : 'text-foreground'}`}>
              {isOverdue && <AlertOctagon className="w-3.5 h-3.5" />}
              {new Date(assignment.due_at).toLocaleDateString()}
            </span>
          </div>
        )}
        {assignment.subject_type && SUBJECT_TYPE_DRAWER[assignment.subject_type] && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground capitalize">Linked {assignment.subject_type.replace(/_/g, ' ')}</span>
            <button
              onClick={() => { openDrawer(SUBJECT_TYPE_DRAWER[assignment.subject_type], assignment.subject_id); }}
              className="text-sm text-primary hover:underline"
            >
              View
            </button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Created</span>
          <span className="text-sm text-foreground">{new Date(assignment.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Context */}
      {assignment.context && (
        <div className="p-4 mx-4 mt-2">
          <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide mb-2">Context</h3>
          <p className="text-sm text-foreground leading-relaxed italic">{assignment.context}</p>
        </div>
      )}

      {/* Description */}
      {assignment.description && (
        <div className="p-4 mx-4 mt-2 mb-6">
          <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide mb-2">Description</h3>
          <p className="text-sm text-foreground leading-relaxed">{assignment.description}</p>
        </div>
      )}
    </div>
  );
}
