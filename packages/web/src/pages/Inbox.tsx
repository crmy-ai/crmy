// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TopBar } from '@/components/layout/TopBar';
import { useAppStore } from '@/store/appStore';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { headerDescription } from '@/lib/headerCopy';
import {
  useHITLRequests,
  useResolveHITL,
  useAssignments,
  useActors,
  useWhoAmI,
  useAcceptAssignment,
  useStartAssignment,
  useCompleteAssignment,
  useDeclineAssignment,
  useBlockAssignment,
  useCancelAssignment,
  useBriefing,
  useHandoffSnapshot,
} from '@/api/hooks';
import { toast } from '@/components/ui/use-toast';
import {
  Inbox as InboxIcon,
  CheckCircle2,
  XCircle,
  Play,
  Ban,
  AlertOctagon,
  ChevronRight,
  Clock,
  AlertTriangle,
  Bot,
  User,
  Calendar,
  ArrowRight,
  Loader2,
  List,
  LayoutGrid,
  ChevronUp,
  ChevronDown,
  Mail,
  FileText,
  ShieldCheck,
} from 'lucide-react';
import { formatDistanceToNow, isPast, parseISO } from 'date-fns';

type Tab = 'needs_attention' | 'delegated' | 'all';
type ViewMode = 'card' | 'table';

interface HITLRequest {
  id: string;
  action_type: string;
  agent_id?: string;
  created_at: string;
  expires_at?: string;
  action_summary: string;
  action_payload: Record<string, unknown>;
  status: string;
  priority?: string;
  sla_minutes?: number;
  escalated_at?: string;
  auto_approve_after?: string;
  handoff_snapshot_id?: string;
}

interface Assignment {
  id: string;
  title: string;
  description?: string;
  assignment_type: string;
  status: string;
  priority: string;
  subject_type?: string;
  subject_id?: string;
  assigned_to: string;
  assigned_by: string;
  context?: string;
  created_at: string;
  due_at?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-destructive/15 text-destructive',
  high:   'bg-orange-500/15 text-orange-500',
  normal: 'bg-primary/10 text-primary',
  low:    'bg-muted text-muted-foreground',
};

const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-amber-500/15 text-amber-600',
  accepted:    'bg-blue-500/15 text-blue-600',
  in_progress: 'bg-violet-500/15 text-violet-600',
  blocked:     'bg-destructive/15 text-destructive',
  completed:   'bg-success/15 text-success',
  declined:    'bg-muted text-muted-foreground',
  cancelled:   'bg-muted text-muted-foreground',
};

const ACTIVE_STATUSES = ['pending', 'accepted', 'in_progress', 'blocked'];

const TABS: { key: Tab; label: string }[] = [
  { key: 'needs_attention', label: 'Needs Attention' },
  { key: 'delegated',       label: 'Delegated' },
  { key: 'all',             label: 'All' },
];

const FILTER_CONFIGS: FilterConfig[] = [
  { key: 'status', label: 'Status', options: [
    { value: 'pending', label: 'Pending' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'completed', label: 'Completed' },
    { value: 'declined', label: 'Declined' },
    { value: 'cancelled', label: 'Cancelled' },
  ]},
  { key: 'priority', label: 'Priority', options: [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'normal', label: 'Normal' },
    { value: 'low', label: 'Low' },
  ]},
  { key: 'assignment_type', label: 'Type', options: [
    { value: 'call', label: 'Call' },
    { value: 'draft', label: 'Draft' },
    { value: 'email', label: 'Email' },
    { value: 'follow_up', label: 'Follow Up' },
    { value: 'research', label: 'Research' },
    { value: 'review', label: 'Review' },
    { value: 'send', label: 'Send' },
  ]},
];

const SORT_OPTIONS: SortOption[] = [
  { key: 'created_at', label: 'Created' },
  { key: 'due_at',     label: 'Due Date' },
  { key: 'priority',   label: 'Priority' },
  { key: 'status',     label: 'Status' },
  { key: 'title',      label: 'Title' },
];

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function timeAgo(iso: string) {
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }); } catch { return ''; }
}

function expiryLabel(iso?: string) {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    if (isPast(d)) return { label: 'Expired', urgent: true };
    return { label: `Expires ${formatDistanceToNow(d, { addSuffix: true })}`, urgent: d.getTime() - Date.now() < 30 * 60 * 1000 };
  } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function labelize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function inferApprovalSubject(req: HITLRequest): { subjectType?: string; subjectId?: string; label?: string } {
  const payload = isRecord(req.action_payload) ? req.action_payload : {};
  const subjectType = firstString(payload, ['subject_type', '_subject_type', 'entity_type', 'record_type']);
  const subjectId = firstString(payload, ['subject_id', '_subject_id', 'entity_id', 'record_id']);
  if (subjectType && subjectId) return { subjectType, subjectId, label: labelize(subjectType) };

  const keyedSubjects: Array<[string, string[], string[]]> = [
    ['contact', ['contact_id'], ['contact_name', 'to_name', 'recipient_name']],
    ['account', ['account_id'], ['account_name', 'company_name']],
    ['opportunity', ['opportunity_id'], ['opportunity_name']],
    ['use_case', ['use_case_id', 'useCaseId'], ['use_case_name', 'use_case']],
  ];
  for (const [type, idKeys, labelKeys] of keyedSubjects) {
    const id = firstString(payload, idKeys);
    if (id) return { subjectType: type, subjectId: id, label: firstString(payload, labelKeys) ?? labelize(type) };
  }
  return {};
}

function findSnapshotId(req: HITLRequest): string | undefined {
  const payload = isRecord(req.action_payload) ? req.action_payload : {};
  return req.handoff_snapshot_id ?? firstString(payload, ['handoff_snapshot_id', 'handoffSnapshotId', 'snapshot_id']);
}

function payloadHighlights(payload: Record<string, unknown>) {
  const fields: Array<[string, unknown, ReactNode]> = [
    ['To', firstString(payload, ['to_email', 'recipient_email', 'email']), <Mail className="w-3.5 h-3.5" />],
    ['Subject', firstString(payload, ['subject', 'email_subject']), <FileText className="w-3.5 h-3.5" />],
    ['Sequence', firstString(payload, ['sequence_name']), <List className="w-3.5 h-3.5" />],
    ['Step', stepLabel(payload), <ShieldCheck className="w-3.5 h-3.5" />],
    ['Objective', firstString(payload, ['objective', 'goal']), <ShieldCheck className="w-3.5 h-3.5" />],
  ];
  return fields.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
}

function stepLabel(payload: Record<string, unknown>) {
  const step = firstNumber(payload, ['step_index', 'step']);
  const total = firstNumber(payload, ['total_steps']);
  if (step == null && total == null) return undefined;
  return total ? `${step ?? '?'} of ${total}` : String(step);
}

function ApprovalPayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const [showBody, setShowBody] = useState(false);
  const body = firstString(payload, ['body_text', 'body', 'message', 'content']);
  const highlights = payloadHighlights(payload);

  if (highlights.length === 0 && !body) return null;

  return (
    <div className="mx-4 mb-3 rounded-xl border border-border bg-muted/20 overflow-hidden">
      {highlights.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
          {highlights.map(([label, value, icon]) => (
            <div key={label} className="flex items-start gap-2 min-w-0 text-xs">
              <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
              <div className="min-w-0">
                <p className="font-medium text-muted-foreground">{label}</p>
                <p className="text-foreground truncate">{String(value)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {body && (
        <div className="border-t border-border px-3 py-2">
          <button onClick={() => setShowBody(!showBody)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showBody ? 'rotate-90' : ''}`} />Message body
          </button>
          {showBody && <p className="mt-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">{body}</p>}
        </div>
      )}
    </div>
  );
}

function HandoffSnapshotPreview({ snapshotId }: { snapshotId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useHandoffSnapshot(open ? snapshotId : null) as any;
  const snapshot = data;

  return (
    <div className="mx-4 mb-3 border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <Bot className="w-3.5 h-3.5 text-violet-500" />
        Agent handoff packet
        {open ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border bg-muted/20">
          {isLoading ? (
            <p className="text-xs text-muted-foreground pt-2">Loading...</p>
          ) : snapshot ? (
            <>
              {snapshot.reasoning && (
                <div className="pt-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Reasoning</p>
                  <p className="text-xs text-foreground whitespace-pre-wrap">{snapshot.reasoning}</p>
                </div>
              )}
              {snapshot.key_findings?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Key findings</p>
                  <ul className="space-y-1">
                    {snapshot.key_findings.slice(0, 5).map((finding: any, index: number) => (
                      <li key={index} className="flex items-start gap-2 text-xs text-foreground">
                        <span className="text-muted-foreground shrink-0">
                          {finding.confidence != null ? `${Math.round(finding.confidence * 100)}%` : '-'}
                        </span>
                        <span>{finding.finding}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {snapshot.tools_called?.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Tool trace: <span className="text-foreground font-medium">{snapshot.tools_called.length}</span> calls
                </p>
              )}
              {snapshot.confidence != null && (
                <p className="text-xs text-muted-foreground">
                  Overall confidence: <span className="text-foreground font-medium">{Math.round(snapshot.confidence * 100)}%</span>
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground pt-2">Snapshot not found.</p>
          )}
        </div>
      )}
    </div>
  );
}

function BriefingContextPreview({ subject }: { subject: { subjectType?: string; subjectId?: string; label?: string } }) {
  const hasSubject = !!subject.subjectType && !!subject.subjectId;
  const { data, isLoading } = useBriefing(subject.subjectType ?? '', subject.subjectId ?? '', {
    format: 'json',
    include_stale: true,
    context_radius: 'adjacent',
    token_budget: 900,
  }) as any;

  if (!hasSubject) return null;

  const briefing = data?.briefing ?? data;
  const contextEntries = isRecord(briefing?.context_entries) ? briefing.context_entries : {};
  const contextCount = Object.values(contextEntries).reduce<number>(
    (sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0),
    0,
  );
  const activities = Array.isArray(briefing?.activities) ? briefing.activities.length : 0;
  const assignments = Array.isArray(briefing?.open_assignments) ? briefing.open_assignments.length : 0;
  const stale = Array.isArray(briefing?.staleness_warnings) ? briefing.staleness_warnings.length : 0;
  const contradictions = Array.isArray(briefing?.contradiction_warnings) ? briefing.contradiction_warnings.length : 0;
  const tokens = typeof briefing?.token_estimate === 'number' ? briefing.token_estimate : undefined;

  return (
    <div className="mx-4 mb-3 rounded-xl border border-border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-foreground">Customer context</p>
        <span className="text-[11px] text-muted-foreground font-mono truncate">{subject.label ?? labelize(subject.subjectType ?? 'record')}</span>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading context...</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <Metric label="Context" value={contextCount} />
          <Metric label="Activity" value={activities} />
          <Metric label="Open tasks" value={assignments} />
          <Metric label="Stale" value={stale} tone={stale > 0 ? 'warning' : undefined} />
          <Metric label="Conflicts" value={contradictions} tone={contradictions > 0 ? 'danger' : undefined} />
          {tokens != null && <p className="sm:col-span-5 text-[11px] text-muted-foreground">Briefing packed to ~{tokens} tokens.</p>}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'danger' }) {
  const toneClass = tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-amber-600' : 'text-foreground';
  return (
    <div>
      <p className={`font-semibold ${toneClass}`}>{value}</p>
      <p className="text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── HITL Approval Card ──────────────────────────────────────────────────────

function HITLCard({ req }: { req: HITLRequest }) {
  const resolve = useResolveHITL();
  const [note, setNote] = useState('');
  const [showPayload, setShowPayload] = useState(false);
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const expiry = expiryLabel(req.expires_at);
  const autoApprove = expiryLabel(req.auto_approve_after);
  const payload = isRecord(req.action_payload) ? req.action_payload : {};
  const subject = inferApprovalSubject(req);
  const snapshotId = findSnapshotId(req);

  async function handle(status: 'approved' | 'rejected') {
    setActing(status === 'approved' ? 'approve' : 'reject');
    try {
      await resolve.mutateAsync({ id: req.id, status, note: note.trim() || undefined });
      toast({ title: status === 'approved' ? 'Approved' : 'Rejected', description: req.action_summary });
    } catch {
      toast({ title: 'Error', description: 'Could not resolve request.', variant: 'destructive' });
    } finally { setActing(null); }
  }

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot className="w-4 h-4 text-violet-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-600">Approval Request</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{req.action_type}</span>
            {req.priority && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[req.priority] ?? PRIORITY_COLORS.normal}`}>{req.priority}</span>}
            {req.escalated_at && <span className="text-xs flex items-center gap-1 text-destructive"><AlertTriangle className="w-3 h-3" />Escalated</span>}
            {expiry && (
              <span className={`text-xs flex items-center gap-1 ${expiry.urgent ? 'text-destructive' : 'text-muted-foreground'}`}>
                <Clock className="w-3 h-3" />{expiry.label}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground">{req.action_summary}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(req.created_at)}</p>
        </div>
      </div>
      <ApprovalPayloadSummary payload={payload} />
      <BriefingContextPreview subject={subject} />
      {snapshotId && <HandoffSnapshotPreview snapshotId={snapshotId} />}
      {(autoApprove || req.sla_minutes) && (
        <div className="mx-4 mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {req.sla_minutes && <span className="px-2 py-1 rounded-lg bg-muted/50">SLA {req.sla_minutes} min</span>}
          {autoApprove && <span className="px-2 py-1 rounded-lg bg-muted/50">Auto approval {autoApprove.label.toLowerCase()}</span>}
        </div>
      )}
      <div className="px-4 pb-2">
        <button onClick={() => setShowPayload(!showPayload)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showPayload ? 'rotate-90' : ''}`} />View raw payload
        </button>
        <AnimatePresence>
          {showPayload && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              <pre className="mt-2 p-3 rounded-xl bg-muted/50 text-xs text-muted-foreground overflow-x-auto max-h-48">{JSON.stringify(payload, null, 2)}</pre>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="border-t border-border p-3 flex flex-col sm:flex-row gap-2 items-end bg-surface-sunken/30">
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note (optional)..."
          className="flex-1 h-8 px-3 rounded-lg border border-border bg-card text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30" />
        <div className="flex gap-2 flex-shrink-0">
          <ActionBtn label="Reject" icon={<XCircle className="w-3.5 h-3.5" />} onClick={() => handle('rejected')} loading={acting === 'reject'} color="destructive" />
          <ActionBtn label="Approve" icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => handle('approved')} loading={acting === 'approve'} color="success" />
        </div>
      </div>
    </div>
  );
}

// ─── Assignment Card ──────────────────────────────────────────────────────────

function AssignmentCard({ task, actorMap }: { task: Assignment; actorMap: Map<string, string> }) {
  const accept   = useAcceptAssignment();
  const start    = useStartAssignment();
  const complete = useCompleteAssignment();
  const decline  = useDeclineAssignment();
  const block    = useBlockAssignment();
  const cancel   = useCancelAssignment();
  const [acting, setActing] = useState<string | null>(null);

  async function act(action: string) {
    setActing(action);
    try {
      if (action === 'accept')        await accept.mutateAsync(task.id);
      else if (action === 'start')    await start.mutateAsync(task.id);
      else if (action === 'complete') await complete.mutateAsync({ id: task.id });
      else if (action === 'decline')  await decline.mutateAsync({ id: task.id });
      else if (action === 'block')    await block.mutateAsync({ id: task.id });
      else if (action === 'cancel')   await cancel.mutateAsync({ id: task.id });
      toast({ title: `Assignment ${action}ed` });
    } catch {
      toast({ title: 'Error', description: `Could not ${action} assignment.`, variant: 'destructive' });
    } finally { setActing(null); }
  }

  const isOverdue = task.due_at && isPast(parseISO(task.due_at)) && !['completed', 'cancelled', 'declined'].includes(task.status);
  const assignedByName = actorMap.get(task.assigned_by) ?? task.assigned_by.slice(0, 8) + '…';

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.normal}`}>{task.priority}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[task.status] ?? 'bg-muted text-muted-foreground'}`}>{task.status.replace('_', ' ')}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{task.assignment_type.replace('_', ' ')}</span>
            {isOverdue && <span className="text-xs flex items-center gap-1 text-destructive"><AlertTriangle className="w-3 h-3" />Overdue</span>}
          </div>
          <p className="text-sm font-medium text-foreground leading-snug">{task.title}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <ArrowRight className="w-3 h-3" />from {assignedByName}
            </span>
            {task.due_at && (
              <span className={`text-xs flex items-center gap-1 ${isOverdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                <Calendar className="w-3 h-3" />{timeAgo(task.due_at)}
              </span>
            )}
          </div>
          {task.context && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.context}</p>}
        </div>
      </div>
      {ACTIVE_STATUSES.includes(task.status) && (
        <div className="border-t border-border px-3 py-2 flex gap-2 flex-wrap bg-surface-sunken/30">
          {task.status === 'pending' && <>
            <ActionBtn label="Accept" icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => act('accept')} loading={acting === 'accept'} color="success" />
            <ActionBtn label="Decline" icon={<XCircle className="w-3.5 h-3.5" />} onClick={() => act('decline')} loading={acting === 'decline'} color="destructive" />
          </>}
          {task.status === 'accepted' && <>
            <ActionBtn label="Start" icon={<Play className="w-3.5 h-3.5" />} onClick={() => act('start')} loading={acting === 'start'} color="primary" />
            <ActionBtn label="Decline" icon={<XCircle className="w-3.5 h-3.5" />} onClick={() => act('decline')} loading={acting === 'decline'} color="ghost" />
          </>}
          {task.status === 'in_progress' && <>
            <ActionBtn label="Complete" icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => act('complete')} loading={acting === 'complete'} color="success" />
            <ActionBtn label="Block" icon={<Ban className="w-3.5 h-3.5" />} onClick={() => act('block')} loading={acting === 'block'} color="warning" />
          </>}
          {task.status === 'blocked' && <>
            <ActionBtn label="Resume" icon={<Play className="w-3.5 h-3.5" />} onClick={() => act('start')} loading={acting === 'start'} color="primary" />
            <ActionBtn label="Cancel" icon={<AlertOctagon className="w-3.5 h-3.5" />} onClick={() => act('cancel')} loading={acting === 'cancel'} color="ghost" />
          </>}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ label, icon, onClick, loading, color }: { label: string; icon: ReactNode; onClick: () => void; loading: boolean; color: string }) {
  const colorMap: Record<string, string> = {
    success:     'bg-success text-white hover:bg-success/90',
    destructive: 'border border-destructive/30 text-destructive hover:bg-destructive/10',
    primary:     'bg-primary text-primary-foreground hover:bg-primary/90',
    warning:     'border border-amber-500/30 text-amber-600 hover:bg-amber-500/10',
    ghost:       'border border-border text-muted-foreground hover:bg-muted/50',
  };
  return (
    <button onClick={onClick} disabled={loading} className={`h-7 px-2.5 flex items-center gap-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${colorMap[color]}`}>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}{label}
    </button>
  );
}

// ─── Table Row ────────────────────────────────────────────────────────────────

function AssignmentTableRow({ task, actorMap, index }: { task: Assignment; actorMap: Map<string, string>; index: number }) {
  const accept   = useAcceptAssignment();
  const start    = useStartAssignment();
  const complete = useCompleteAssignment();
  const decline  = useDeclineAssignment();
  const block    = useBlockAssignment();
  const cancel   = useCancelAssignment();
  const [acting, setActing] = useState<string | null>(null);

  async function act(action: string) {
    setActing(action);
    try {
      if (action === 'accept')        await accept.mutateAsync(task.id);
      else if (action === 'start')    await start.mutateAsync(task.id);
      else if (action === 'complete') await complete.mutateAsync({ id: task.id });
      else if (action === 'decline')  await decline.mutateAsync({ id: task.id });
      else if (action === 'block')    await block.mutateAsync({ id: task.id });
      else if (action === 'cancel')   await cancel.mutateAsync({ id: task.id });
      toast({ title: `Assignment ${action}ed` });
    } catch {
      toast({ title: 'Error', description: `Could not ${action} assignment.`, variant: 'destructive' });
    } finally { setActing(null); }
  }

  const isOverdue = task.due_at && isPast(parseISO(task.due_at)) && !['completed', 'cancelled', 'declined'].includes(task.status);
  const assignedByName = actorMap.get(task.assigned_by) ?? task.assigned_by.slice(0, 8) + '…';
  const assignedToName = actorMap.get(task.assigned_to) ?? task.assigned_to.slice(0, 8) + '…';

  return (
    <tr className={`border-b border-border hover:bg-primary/5 transition-colors group ${index % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
      <td className="px-4 py-3">
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.normal}`}>{task.priority}</span>
      </td>
      <td className="px-4 py-3 max-w-xs">
        <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
        {task.context && <p className="text-xs text-muted-foreground truncate">{task.context}</p>}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{task.assignment_type.replace('_', ' ')}</span>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_COLORS[task.status] ?? 'bg-muted text-muted-foreground'}`}>{task.status.replace('_', ' ')}</span>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{assignedToName}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{assignedByName}</td>
      <td className={`px-4 py-3 text-xs ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
        {task.due_at ? timeAgo(task.due_at) : '—'}
      </td>
      <td className="px-4 py-3">
        {ACTIVE_STATUSES.includes(task.status) && (
          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {task.status === 'pending' && <>
              <ActionBtn label="Accept" icon={<CheckCircle2 className="w-3 h-3" />} onClick={() => act('accept')} loading={acting === 'accept'} color="success" />
              <ActionBtn label="Decline" icon={<XCircle className="w-3 h-3" />} onClick={() => act('decline')} loading={acting === 'decline'} color="ghost" />
            </>}
            {task.status === 'accepted' && <ActionBtn label="Start" icon={<Play className="w-3 h-3" />} onClick={() => act('start')} loading={acting === 'start'} color="primary" />}
            {task.status === 'in_progress' && <ActionBtn label="Complete" icon={<CheckCircle2 className="w-3 h-3" />} onClick={() => act('complete')} loading={acting === 'complete'} color="success" />}
            {task.status === 'blocked' && <ActionBtn label="Resume" icon={<Play className="w-3 h-3" />} onClick={() => act('start')} loading={acting === 'start'} color="primary" />}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: Tab }) {
  const copy: Record<Tab, { title: string; sub: string }> = {
    needs_attention: { title: 'Handoff queue is clear', sub: 'Agent approvals, escalations, and assigned work that need your action will appear here.' },
    delegated:       { title: 'Nothing delegated', sub: 'Tasks handed to humans or agents will appear here for follow-through.' },
    all:             { title: 'No handoffs yet', sub: 'This queue records the agent-to-human loop for approvals, reviews, and delegated tasks.' },
  };
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
        <InboxIcon className="w-7 h-7 text-muted-foreground/50" />
      </div>
      <p className="text-base font-semibold text-foreground">{copy[tab].title}</p>
      <p className="text-sm text-muted-foreground mt-1">{copy[tab].sub}</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [tab, setTab] = useState<Tab>('needs_attention');
  const [view, setView] = useState<ViewMode>('card');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>({ key: 'created_at', dir: 'desc' });
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { openQuickAdd } = useAppStore();
  const { data: whoami } = useWhoAmI() as any;
  const myActorId: string | undefined = whoami?.actor_id;

  const hitlQ = useHITLRequests();
  const myAssignQ = useAssignments(myActorId ? { assigned_to: myActorId, limit: 200 } : undefined);
  const delegatedQ = useAssignments(myActorId ? { assigned_by: myActorId, limit: 200 } : undefined);
  const allAssignQ = useAssignments({ limit: 200 });
  const actorsQ = useActors({ limit: 100 }) as any;

  // Build actor name lookup
  const actorMap = useMemo(() => {
    const map = new Map<string, string>();
    (actorsQ.data?.actors ?? actorsQ.data?.data ?? []).forEach((a: any) => {
      map.set(a.id, a.display_name ?? a.name ?? a.email ?? a.id);
    });
    return map;
  }, [actorsQ.data]);

  const pendingHitl: HITLRequest[] = useMemo(() =>
    ((hitlQ.data as any)?.data ?? []).filter((r: any) => r.status === 'pending'), [hitlQ.data]);

  const myAssignments: Assignment[] = (myAssignQ.data as any)?.assignments ?? [];
  const delegatedRaw: Assignment[] = (delegatedQ.data as any)?.assignments ?? [];
  const allAssignmentsRaw: Assignment[] = (allAssignQ.data as any)?.assignments ?? [];

  const activeMyAssignments = useMemo(
    () => myAssignments.filter(a => ACTIVE_STATUSES.includes(a.status)),
    [myAssignments]
  );
  const activeDelegated = useMemo(
    () => delegatedRaw.filter(a => ACTIVE_STATUSES.includes(a.status) && a.assigned_to !== myActorId),
    [delegatedRaw, myActorId]
  );

  // Source list based on tab
  const sourceList = useMemo(() => {
    if (tab === 'needs_attention') return activeMyAssignments;
    if (tab === 'delegated') return activeDelegated;
    return allAssignmentsRaw;
  }, [tab, activeMyAssignments, activeDelegated, allAssignmentsRaw]);

  // Filter + search + sort
  const filtered = useMemo(() => {
    let result = [...sourceList];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.title.toLowerCase().includes(q) ||
        (a.context ?? '').toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q)
      );
    }
    if (activeFilters.status?.length)          result = result.filter(a => activeFilters.status.includes(a.status));
    if (activeFilters.priority?.length)        result = result.filter(a => activeFilters.priority.includes(a.priority));
    if (activeFilters.assignment_type?.length) result = result.filter(a => activeFilters.assignment_type.includes(a.assignment_type));

    if (sort) {
      result.sort((a, b) => {
        if (sort.key === 'priority') {
          return sort.dir === 'asc'
            ? (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
            : (PRIORITY_ORDER[b.priority] ?? 2) - (PRIORITY_ORDER[a.priority] ?? 2);
        }
        const aVal = (a as any)[sort.key] ?? '';
        const bVal = (b as any)[sort.key] ?? '';
        return sort.dir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
      });
    }
    return result;
  }, [sourceList, search, activeFilters, sort]);

  useEffect(() => { setPage(1); }, [tab, search, activeFilters, sort]);

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const needsAttentionCount = pendingHitl.length + activeMyAssignments.length;
  const isLoading = hitlQ.isLoading || myAssignQ.isLoading || allAssignQ.isLoading;

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => { const next = { ...prev }; if (values.length === 0) delete next[key]; else next[key] = values; return next; });
  };
  const handleSortChange = (key: string) => {
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: string }) => (
    <th onClick={() => handleSortChange(sortKey)} className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
      <span className="inline-flex items-center gap-1">
        {label}
        {sort?.key === sortKey && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Handoffs"
        icon={InboxIcon}
        iconClassName="text-destructive"
        description={headerDescription('Review agent requests and assignments', filtered.length, 'handoff')}
      >
        <div className="hidden md:flex items-center gap-1 bg-muted rounded-xl p-0.5">
          {([{ mode: 'card', icon: LayoutGrid }, { mode: 'table', icon: List }] as const).map(({ mode, icon: Icon }) => (
            <button key={mode} onClick={() => setView(mode)}
              className={`p-1.5 rounded-lg transition-all ${view === mode ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </TopBar>

      {/* Tab strip — same pill style as Use Cases prod date */}
      <div className="px-4 md:px-6 pt-3 pb-1 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-border bg-muted/40 p-0.5 gap-0.5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={['px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5',
                tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}>
              {t.label}
              {t.key === 'needs_attention' && needsAttentionCount > 0 && (
                <span className={`min-w-[16px] h-4 px-1 rounded-full text-xs font-bold flex items-center justify-center ${
                  tab === t.key ? 'bg-destructive text-white' : 'bg-muted-foreground/20 text-muted-foreground'
                }`}>{needsAttentionCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <ListToolbar
        searchValue={search} onSearchChange={setSearch}
        searchPlaceholder="Search assignments..."
        filters={FILTER_CONFIGS} activeFilters={activeFilters}
        onFilterChange={handleFilterChange} onClearFilters={() => setActiveFilters({})}
        sortOptions={SORT_OPTIONS} currentSort={sort} onSortChange={handleSortChange}
        onAdd={() => openQuickAdd('assignment')} addLabel="New Assignment"
        entityType="assignments"
      />

      <div className="flex-1 overflow-y-auto pb-24 md:pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* HITL requests — only on Needs Attention tab */}
            {tab === 'needs_attention' && pendingHitl.length > 0 && (
              <div className="px-4 md:px-6 pt-4 pb-2">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">Approval Requests</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">{pendingHitl.length}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {pendingHitl.map(r => <HITLCard key={r.id} req={r} />)}
                </div>
              </div>
            )}

            {/* Assignments */}
            {paginated.length === 0 && pendingHitl.length === 0 ? (
              <EmptyState tab={tab} />
            ) : paginated.length === 0 && tab === 'needs_attention' ? null : paginated.length === 0 ? (
              <EmptyState tab={tab} />
            ) : view === 'card' ? (
              <div className="px-4 md:px-6 pt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {tab === 'needs_attention' && paginated.length > 0 && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">My Tasks</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">{paginated.length}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                {paginated.map(a => <AssignmentCard key={a.id} task={a} actorMap={actorMap} />)}
              </div>
            ) : (
              <div className="px-4 md:px-6 pt-4 overflow-x-auto">
                <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-sunken/50">
                        <SortHeader label="Priority" sortKey="priority" />
                        <SortHeader label="Title" sortKey="title" />
                        <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Type</th>
                        <SortHeader label="Status" sortKey="status" />
                        <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Assigned To</th>
                        <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Assigned By</th>
                        <SortHeader label="Due" sortKey="due_at" />
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((a, i) => (
                        <AssignmentTableRow key={a.id} task={a} actorMap={actorMap} index={i} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {filtered.length > pageSize && (
              <div className="px-4 md:px-6 pt-4">
                <PaginationBar page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={() => {}} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
