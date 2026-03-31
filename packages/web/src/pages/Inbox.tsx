// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TopBar } from '@/components/layout/TopBar';
import { useAppStore } from '@/store/appStore';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { PaginationBar } from '@/components/crm/PaginationBar';
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

// ─── HITL Approval Card ──────────────────────────────────────────────────────

function HITLCard({ req }: { req: HITLRequest }) {
  const resolve = useResolveHITL();
  const [note, setNote] = useState('');
  const [showPayload, setShowPayload] = useState(false);
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const expiry = expiryLabel(req.expires_at);

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
      <div className="px-4 pb-2">
        <button onClick={() => setShowPayload(!showPayload)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showPayload ? 'rotate-90' : ''}`} />View payload
        </button>
        <AnimatePresence>
          {showPayload && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              <pre className="mt-2 p-3 rounded-xl bg-muted/50 text-xs text-muted-foreground overflow-x-auto max-h-48">{JSON.stringify(req.action_payload, null, 2)}</pre>
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

function ActionBtn({ label, icon, onClick, loading, color }: { label: string; icon: React.ReactNode; onClick: () => void; loading: boolean; color: string }) {
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
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.normal}`}>{task.priority}</span>
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
    needs_attention: { title: 'All clear!', sub: 'No approvals or tasks waiting for your action.' },
    delegated:       { title: 'Nothing delegated', sub: 'Assignments you create will appear here.' },
    all:             { title: 'Nothing here yet', sub: 'Assignments will appear as they are created.' },
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
        description="Review and respond to agent requests and assignments."
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
                <span className={`min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
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
                  <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold">{pendingHitl.length}</span>
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
                    <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold">{paginated.length}</span>
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
