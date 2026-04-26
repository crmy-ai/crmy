// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect, useMemo } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { PaginationBar } from '@/components/crm/PaginationBar';
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
import {
  ClipboardList, Play, CheckCircle2, XCircle, Ban, AlertOctagon,
  Search, Filter, ArrowUpDown, X, ChevronDown, Calendar, Plus,
} from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';

type Tab = 'mine' | 'delegated' | 'all';
type DrawerType = 'contact' | 'opportunity' | 'use-case' | 'account' | 'assignment';
type SortKey = 'created_at' | 'due_at' | 'priority' | 'status' | 'title';
type SortDir = 'asc' | 'desc';
type DatePreset = 'today' | 'this_week' | 'this_month' | 'this_quarter' | 'overdue' | 'no_due_date' | 'custom' | '';

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

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
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

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open (all active)' },
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'completed', label: 'Completed' },
  { value: 'declined', label: 'Declined' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

const TYPE_OPTIONS = [
  { value: 'call', label: 'Call' },
  { value: 'draft', label: 'Draft' },
  { value: 'email', label: 'Email' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'research', label: 'Research' },
  { value: 'review', label: 'Review' },
  { value: 'send', label: 'Send' },
];

const DUE_DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due Today' },
  { value: 'this_week', label: 'Due This Week' },
  { value: 'this_month', label: 'Due This Month' },
  { value: 'no_due_date', label: 'No Due Date' },
  { value: 'custom', label: 'Custom Range…' },
];

const CREATED_DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'custom', label: 'Custom Range…' },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'created_at', label: 'Date Created' },
  { key: 'due_at', label: 'Due Date' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'title', label: 'Title' },
];

function getPresetRange(preset: DatePreset): { start: Date; end: Date } | null {
  const now = new Date();
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  if (preset === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    return { start, end: endOfDay };
  }
  if (preset === 'this_week') {
    const start = new Date(now);
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
    start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (preset === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }
  if (preset === 'this_quarter') {
    const q = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), q * 3, 1);
    const end = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999);
    return { start, end };
  }
  if (preset === 'overdue') {
    return { start: new Date(0), end: new Date(now.getTime() - 1) };
  }
  return null;
}

export default function AssignmentsPage() {
  const [tab, setTab] = useState<Tab>('mine');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({ status: ['open'] });
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'created_at', dir: 'desc' });

  // Due date range
  const [dueDatePreset, setDueDatePreset] = useState<DatePreset>('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');

  // Created date range
  const [createdPreset, setCreatedPreset] = useState<DatePreset>('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '/' && !isInput) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const { openQuickAdd } = useAppStore();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: whoami } = useWhoAmI() as any;
  const myActorId = whoami?.actor_id;

  const apiParams: Record<string, string | number | boolean | undefined> = { limit: 200 };
  if (tab === 'mine' && myActorId) apiParams.assigned_to = myActorId;
  if (tab === 'delegated' && myActorId) apiParams.assigned_by = myActorId;
  const statusFilters = activeFilters.status ?? [];
  if (statusFilters.length === 1) {
    const s = statusFilters[0];
    apiParams.status = s === 'open' ? 'pending,accepted,in_progress,blocked' : s;
  } else if (statusFilters.length > 1) {
    apiParams.status = statusFilters.join(',');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = useAssignments(apiParams) as any;
  const raw: Assignment[] = data?.assignments ?? [];

  const assignments = useMemo(() => {
    let list = raw;

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.title.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q) ||
        a.context?.toLowerCase().includes(q) ||
        a.assignment_type.toLowerCase().includes(q),
      );
    }

    // Priority / type filters
    const pf = activeFilters.priority ?? [];
    if (pf.length > 0) list = list.filter(a => pf.includes(a.priority));
    const tf = activeFilters.type ?? [];
    if (tf.length > 0) list = list.filter(a => tf.includes(a.assignment_type));

    // Due date filter
    if (dueDatePreset === 'no_due_date') {
      list = list.filter(a => !a.due_at);
    } else if (dueDatePreset === 'overdue') {
      const now = new Date();
      list = list.filter(a => a.due_at && new Date(a.due_at) < now);
    } else if (dueDatePreset === 'custom') {
      const start = dueFrom ? new Date(dueFrom + 'T00:00:00') : null;
      const end = dueTo ? new Date(dueTo + 'T23:59:59') : null;
      list = list.filter(a => {
        if (!a.due_at) return false;
        const d = new Date(a.due_at);
        return (!start || d >= start) && (!end || d <= end);
      });
    } else if (dueDatePreset) {
      const range = getPresetRange(dueDatePreset);
      if (range) list = list.filter(a => {
        if (!a.due_at) return false;
        const d = new Date(a.due_at);
        return d >= range.start && d <= range.end;
      });
    }

    // Created date filter
    if (createdPreset === 'custom') {
      const start = createdFrom ? new Date(createdFrom + 'T00:00:00') : null;
      const end = createdTo ? new Date(createdTo + 'T23:59:59') : null;
      list = list.filter(a => {
        const d = new Date(a.created_at);
        return (!start || d >= start) && (!end || d <= end);
      });
    } else if (createdPreset) {
      const range = getPresetRange(createdPreset);
      if (range) list = list.filter(a => {
        const d = new Date(a.created_at);
        return d >= range.start && d <= range.end;
      });
    }

    // Sort
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'priority': cmp = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99); break;
        case 'due_at': {
          const ad = a.due_at ? new Date(a.due_at).getTime() : Infinity;
          const bd = b.due_at ? new Date(b.due_at).getTime() : Infinity;
          cmp = ad - bd;
          break;
        }
        default: cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [raw, search, activeFilters, sort, dueDatePreset, dueFrom, dueTo, createdPreset, createdFrom, createdTo]);

  useEffect(() => { setPage(1); }, [tab, search, activeFilters, sort, dueDatePreset, dueFrom, dueTo, createdPreset, createdFrom, createdTo]);
  const paginated = assignments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleFilterChange = (key: string, values: string[]) => setActiveFilters(prev => ({ ...prev, [key]: values }));
  const handleClearFilters = () => {
    setActiveFilters({ status: ['open'] });
    setDueDatePreset(''); setDueFrom(''); setDueTo('');
    setCreatedPreset(''); setCreatedFrom(''); setCreatedTo('');
  };
  const handleSortChange = (key: SortKey) => {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  };

  const activeFilterCount = Object.entries(activeFilters).reduce((sum, [k, vals]) => {
    if (k === 'status' && vals.length === 1 && vals[0] === 'open') return sum;
    return sum + vals.length;
  }, 0) + (dueDatePreset ? 1 : 0) + (createdPreset ? 1 : 0);

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
    } catch (err) {
      toast({ title: `Failed to ${action} assignment`, description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
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
    if (!['completed', 'declined', 'cancelled', 'blocked'].includes(a.status)) {
      actions.push({ label: 'Cancel', action: 'cancel', icon: <Ban className="w-3 h-3" />, variant: 'destructive' });
    }
    return actions;
  };

  // Build active filter pills including date ranges
  const filterPills: { key: string; label: string; onRemove: () => void }[] = [];
  Object.entries(activeFilters).forEach(([key, values]) => {
    if (key === 'status' && values.length === 1 && values[0] === 'open') return;
    const allOpts = { status: STATUS_OPTIONS, priority: PRIORITY_OPTIONS, type: TYPE_OPTIONS } as Record<string, { value: string; label: string }[]>;
    values.forEach(val => {
      const label = allOpts[key]?.find(o => o.value === val)?.label ?? val;
      filterPills.push({
        key: `${key}-${val}`,
        label: `${key}: ${label}`,
        onRemove: () => handleFilterChange(key, values.filter(v => v !== val)),
      });
    });
  });
  if (dueDatePreset) {
    const label = dueDatePreset === 'custom'
      ? `Due: ${dueFrom || '…'} → ${dueTo || '…'}`
      : `Due: ${DUE_DATE_PRESETS.find(p => p.value === dueDatePreset)?.label ?? dueDatePreset}`;
    filterPills.push({ key: 'due_date', label, onRemove: () => { setDueDatePreset(''); setDueFrom(''); setDueTo(''); } });
  }
  if (createdPreset) {
    const label = createdPreset === 'custom'
      ? `Created: ${createdFrom || '…'} → ${createdTo || '…'}`
      : `Created: ${CREATED_DATE_PRESETS.find(p => p.value === createdPreset)?.label ?? createdPreset}`;
    filterPills.push({ key: 'created_date', label, onRemove: () => { setCreatedPreset(''); setCreatedFrom(''); setCreatedTo(''); } });
  }

  return (
    <>
      <TopBar
        title="Assignments"
        icon={ClipboardList}
        iconClassName="text-destructive"
        description="Task queue and handoffs between agents and humans."
      />

      {/* Tabs */}
      <div className="flex items-center gap-3 px-4 md:px-6 pt-4 pb-1">
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
          {(['mine', 'delegated', 'all'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${tab === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t === 'mine' ? 'My Queue' : t === 'delegated' ? 'Delegated' : 'All'}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{assignments.length} assignment{assignments.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 px-4 md:px-6 py-2">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-0 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search assignments..."
              className="w-full h-9 pl-9 pr-8 rounded-xl border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 transition-all"
            />
            {search ? (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1">
                <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            ) : (
              <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-mono text-muted-foreground/50 bg-muted border border-border">
                /
              </kbd>
            )}
          </div>

          {/* Filter */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="h-9 px-3 flex items-center gap-1.5 rounded-xl border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all flex-shrink-0">
                <Filter className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Filter</span>
                {activeFilterCount > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-96 p-0 rounded-xl" align="start">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <span className="text-sm font-display font-bold text-foreground">Filters</span>
                {activeFilterCount > 0 && (
                  <button onClick={handleClearFilters} className="text-xs text-muted-foreground hover:text-foreground">
                    Reset all
                  </button>
                )}
              </div>
              <div className="p-2 max-h-[480px] overflow-y-auto space-y-1">
                <FilterSection
                  label="Status" filterKey="status"
                  options={STATUS_OPTIONS} selected={activeFilters.status ?? []}
                  onChange={v => handleFilterChange('status', v)}
                />
                <FilterSection
                  label="Priority" filterKey="priority"
                  options={PRIORITY_OPTIONS} selected={activeFilters.priority ?? []}
                  onChange={v => handleFilterChange('priority', v)}
                />
                <FilterSection
                  label="Type" filterKey="type"
                  options={TYPE_OPTIONS} selected={activeFilters.type ?? []}
                  onChange={v => handleFilterChange('type', v)}
                />
                <DateRangeSection
                  label="Due Date"
                  icon={<Calendar className="w-3 h-3" />}
                  presets={DUE_DATE_PRESETS}
                  selectedPreset={dueDatePreset}
                  onPresetChange={p => { setDueDatePreset(p); if (p !== 'custom') { setDueFrom(''); setDueTo(''); } }}
                  customFrom={dueFrom}
                  customTo={dueTo}
                  onFromChange={setDueFrom}
                  onToChange={setDueTo}
                />
                <DateRangeSection
                  label="Created Date"
                  icon={<Calendar className="w-3 h-3" />}
                  presets={CREATED_DATE_PRESETS}
                  selectedPreset={createdPreset}
                  onPresetChange={p => { setCreatedPreset(p); if (p !== 'custom') { setCreatedFrom(''); setCreatedTo(''); } }}
                  customFrom={createdFrom}
                  customTo={createdTo}
                  onFromChange={setCreatedFrom}
                  onToChange={setCreatedTo}
                />
              </div>
            </PopoverContent>
          </Popover>

          {/* Sort */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="h-9 px-3 flex items-center gap-1.5 rounded-xl border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all flex-shrink-0">
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{SORT_OPTIONS.find(s => s.key === sort.key)?.label ?? 'Sort'}</span>
                <span className="text-xs font-mono">{sort.dir === 'asc' ? '↑' : '↓'}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1 rounded-xl" align="start">
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => handleSortChange(opt.key)}
                  className={`w-full text-left px-3 py-2.5 text-sm rounded-lg transition-colors ${sort.key === opt.key ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
                >
                  {opt.label}
                  {sort.key === opt.key && (
                    <span className="ml-auto float-right text-xs font-mono">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <button
            onClick={() => openQuickAdd('assignment')}
            className="h-9 px-4 flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-destructive to-destructive/80 text-destructive-foreground text-sm font-semibold hover:shadow-md transition-all flex-shrink-0 press-scale"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Assignment</span>
          </button>
        </div>

        {/* Active filter pills */}
        {filterPills.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {filterPills.map(pill => (
              <span key={pill.key} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-xs text-foreground">
                {pill.label}
                <button onClick={pill.onRemove} className="ml-0.5 hover:text-destructive p-0.5">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {filterPills.length > 1 && (
              <button onClick={() => { setSearch(''); handleClearFilters(); }} className="text-xs text-muted-foreground hover:text-foreground px-1">
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Assignment list */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-6 space-y-2">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        ) : assignments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardList className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {search ? `No assignments match "${search}"` : 'No assignments found'}
            </p>
            {(search || activeFilterCount > 0) && (
              <button
                onClick={() => { setSearch(''); handleClearFilters(); }}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Clear search & filters
              </button>
            )}
          </div>
        ) : (
          <>
          {paginated.map(a => {
            const statusColor = STATUS_COLORS[a.status] ?? '#94a3b8';
            const priorityColor = PRIORITY_COLORS[a.priority] ?? '#94a3b8';
            const actions = getActions(a);
            const canOpenSubject = SUBJECT_TYPE_DRAWER[a.subject_type];
            const isOverdue = a.due_at && new Date(a.due_at) < new Date() && !['completed', 'declined', 'cancelled'].includes(a.status);

            return (
              <div key={a.id} onClick={() => openDrawer('assignment', a.id)} className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="px-1.5 py-0.5 rounded text-xs font-semibold capitalize"
                        style={{ backgroundColor: statusColor + '18', color: statusColor }}
                      >
                        {a.status.replace(/_/g, ' ')}
                      </span>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: priorityColor }} title={a.priority} />
                      <span className="text-xs text-muted-foreground capitalize">{a.priority}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(a.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <h4 className="text-base font-medium text-foreground truncate">{a.title}</h4>
                    {a.description && (
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{a.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-muted-foreground capitalize px-1.5 py-0.5 rounded bg-muted">
                        {a.assignment_type.replace(/_/g, ' ')}
                      </span>
                      {canOpenSubject && (
                        <button onClick={e => { e.stopPropagation(); openDrawer(canOpenSubject, a.subject_id); }} className="text-xs text-primary hover:underline">
                          View {a.subject_type.replace(/_/g, ' ')}
                        </button>
                      )}
                      {a.due_at && (
                        <span className={`text-xs ml-auto flex items-center gap-1 ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                          {isOverdue && <AlertOctagon className="w-3 h-3" />}
                          Due: {new Date(a.due_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {a.context && (
                      <p className="text-xs text-muted-foreground/80 mt-1.5 italic line-clamp-2">{a.context}</p>
                    )}
                  </div>
                </div>

                {actions.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border">
                    {actions.map(act => (
                      <button
                        key={act.action}
                        onClick={e => { e.stopPropagation(); handleAction(act.action, a.id); }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          act.variant === 'destructive' ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                          : act.variant === 'warning' ? 'text-warning hover:bg-warning/10'
                          : act.variant === 'muted' ? 'text-muted-foreground hover:bg-muted'
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
          <PaginationBar page={page} pageSize={PAGE_SIZE} total={assignments.length} onPageChange={setPage} />
          </>
        )}
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FilterSection({
  label, options, selected, onChange,
}: {
  label: string; filterKey: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2 py-2 text-xs font-display font-semibold text-muted-foreground hover:text-foreground"
      >
        {label}
        {selected.length > 0 && <span className="text-primary font-sans">{selected.length}</span>}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="space-y-0.5 pl-1 pb-1">
          {options.map(opt => {
            const checked = selected.includes(opt.value);
            return (
              <label key={opt.value} className="flex items-center gap-2 px-2 py-2 text-sm text-foreground hover:bg-muted/50 rounded-lg cursor-pointer min-h-[40px]">
                <Checkbox checked={checked} onCheckedChange={() => onChange(checked ? selected.filter(v => v !== opt.value) : [...selected, opt.value])} className="w-4 h-4" />
                {opt.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DateRangeSection({
  label, icon, presets, selectedPreset, onPresetChange,
  customFrom, customTo, onFromChange, onToChange,
}: {
  label: string;
  icon: React.ReactNode;
  presets: { value: DatePreset; label: string }[];
  selectedPreset: DatePreset;
  onPresetChange: (p: DatePreset) => void;
  customFrom: string;
  customTo: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2 py-2 text-xs font-display font-semibold text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">{icon}{label}</span>
        {selectedPreset && <span className="text-primary font-sans text-xs">1</span>}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="pl-1 pb-1 space-y-0.5">
          {/* Clear option */}
          {selectedPreset && (
            <button
              onClick={() => onPresetChange('')}
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50"
            >
              — Any date
            </button>
          )}
          {presets.map(p => (
            <button
              key={p.value}
              onClick={() => onPresetChange(selectedPreset === p.value ? '' : p.value)}
              className={`w-full text-left px-2 py-2 text-sm rounded-lg transition-colors flex items-center gap-2 ${
                selectedPreset === p.value ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-muted/50'
              }`}
            >
              {selectedPreset === p.value && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
              {p.label}
            </button>
          ))}
          {selectedPreset === 'custom' && (
            <div className="px-2 pt-1 pb-2 space-y-2">
              <div className="flex items-center gap-2">
                <DatePicker value={customFrom} onChange={onFromChange} size="sm" placeholder="From" className="flex-1" />
                <span className="text-xs text-muted-foreground">→</span>
                <DatePicker value={customTo} onChange={onToChange} size="sm" placeholder="To" className="flex-1" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
