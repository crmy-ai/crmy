// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  useActivities,
  useContextEntries,
  useEmails,
  useRawContextSources,
  useReprocessRawContextSource,
  useSignalGroups,
  useSystemSyncRuns,
} from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/hooks/use-toast';
import { useSlashSearchFocus } from '@/hooks/useSlashSearchFocus';

type ObservationStatus = 'Processed' | 'Needs review' | 'No context found' | 'Failed';
type ObservationSource = 'activity' | 'inbound_email' | 'outbound_email' | 'system_sync' | 'add_context' | 'mcp' | 'context_api';
type VolumeStatus = 'processed' | 'failed';

const SOURCE_OPTIONS: Array<{ value: ObservationSource; label: string; color: string }> = [
  { value: 'activity',       label: 'Activities',      color: 'bg-sky-500' },
  { value: 'inbound_email',  label: 'Inbound emails',  color: 'bg-blue-500' },
  { value: 'outbound_email', label: 'Outbound emails', color: 'bg-indigo-500' },
  { value: 'system_sync',    label: 'System syncs',    color: 'bg-amber-500' },
  { value: 'add_context',    label: 'Add Context',     color: 'bg-[#0ea5e9]' },
  { value: 'mcp',            label: 'Agent/MCP',       color: 'bg-fuchsia-500' },
  { value: 'context_api',    label: 'Context API',     color: 'bg-slate-500' },
];

const STATUS_OPTIONS: ObservationStatus[] = ['Processed', 'Needs review', 'No context found', 'Failed'];
const VOLUME_STATUS_OPTIONS: Array<{ value: VolumeStatus; label: string; color: string }> = [
  { value: 'processed', label: 'Processed', color: 'bg-emerald-500' },
  { value: 'failed',    label: 'Failed',    color: 'bg-destructive' },
];

function formatDate(value?: string | null) {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No timestamp';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function dayKey(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function statusTone(status: ObservationStatus) {
  if (status === 'Processed') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (status === 'Needs review') return 'border-violet-500/20 bg-violet-500/10 text-violet-500';
  if (status === 'Failed') return 'border-destructive/20 bg-destructive/10 text-destructive';
  return 'border-border bg-muted text-muted-foreground';
}

function normalizeSourceLabel(value?: string | null) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Direct context';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function classifyContextSource(entry: any): { source: ObservationSource; type: string } {
  const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
  const evidenceSource = evidence
    .map((item: any) => item?.source_type ?? item?.source ?? item?.channel ?? item?.system_type)
    .find(Boolean);
  const raw = String(entry.source ?? evidenceSource ?? '').toLowerCase();
  if (raw.includes('mcp') || raw.includes('agent')) return { source: 'mcp', type: 'Agent/MCP context' };
  if (raw.includes('activity')) return { source: 'activity', type: 'Activity context' };
  if (raw.includes('email')) return { source: raw.includes('inbound') ? 'inbound_email' : 'outbound_email', type: 'Email context' };
  if (raw.includes('sync') || raw.includes('hubspot') || raw.includes('salesforce') || raw.includes('databricks') || raw.includes('snowflake')) {
    return { source: 'system_sync', type: `${normalizeSourceLabel(entry.source ?? evidenceSource)} context` };
  }
  if (raw.includes('import') || raw.includes('upload') || raw.includes('paste') || raw.includes('document')) {
    return { source: 'add_context', type: 'Add Context' };
  }
  return { source: 'context_api', type: normalizeSourceLabel(entry.source ?? evidenceSource) };
}

function evidenceDetail(entry: any) {
  const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
  const first = evidence[0] ?? {};
  const sourceRef = entry.source_ref ?? first.source_ref ?? first.ref ?? first.id;
  const snippet = first.snippet ?? first.quote ?? first.text;
  if (snippet) return String(snippet).slice(0, 120);
  if (sourceRef) return `Evidence: ${String(sourceRef).slice(0, 80)}`;
  return entry.memory_status === 'signal'
    ? 'Signal created from direct context input'
    : 'Memory created from direct context input';
}

function statusFromRawSource(status?: string): ObservationStatus {
  if (status === 'failed') return 'Failed';
  if (status === 'needs_review' || status === 'pending' || status === 'processing') return 'Needs review';
  if (status === 'skipped') return 'No context found';
  return 'Processed';
}

function rawStatusFilter(status: 'all' | ObservationStatus) {
  if (status === 'Failed') return 'failed';
  if (status === 'No context found') return 'skipped';
  if (status === 'Processed') return 'processed';
  // "Needs review" includes pending and processing rows too, so keep that
  // broader filter in the UI until the API supports multi-status queries.
  if (status === 'Needs review') return undefined;
  return undefined;
}

function classifyRawSource(sourceType?: string | null): { source: ObservationSource; type: string } {
  const raw = String(sourceType ?? '').toLowerCase();
  if (raw.includes('mcp') || raw.includes('agent')) return { source: 'mcp', type: 'Agent/MCP' };
  if (raw.includes('inbound') && raw.includes('email')) return { source: 'inbound_email', type: 'Inbound email' };
  if (raw.includes('email')) return { source: 'outbound_email', type: 'Outbound email' };
  if (raw.includes('sync') || raw.includes('hubspot') || raw.includes('salesforce') || raw.includes('databricks') || raw.includes('snowflake')) {
    return { source: 'system_sync', type: normalizeSourceLabel(sourceType) };
  }
  if (raw.includes('add_context') || raw.includes('import') || raw.includes('upload') || raw.includes('document')) {
    return { source: 'add_context', type: 'Add Context' };
  }
  if (raw.includes('activity')) return { source: 'activity', type: 'Activity' };
  return { source: 'context_api', type: normalizeSourceLabel(sourceType) };
}

function OutcomeCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>{value.toLocaleString()}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function ObservationRow({ row }: {
  row: {
    id: string;
    type: string;
    source: ObservationSource;
    title: string;
    detail: string;
    timestamp?: string | null;
    status: ObservationStatus;
    href?: string;
    onClick?: () => void;
    actionLabel?: string;
    onAction?: () => void;
    actionDisabled?: boolean;
  };
}) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {row.type}
          </span>
          <p className="truncate text-sm font-semibold text-foreground">{row.title}</p>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{row.detail}</p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <span className={`hidden rounded-full border px-2 py-0.5 text-xs font-semibold sm:inline-flex ${statusTone(row.status)}`}>
          {row.status}
        </span>
        <span className="hidden text-xs text-muted-foreground md:inline">{formatDate(row.timestamp)}</span>
        {row.actionLabel && row.onAction && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              row.onAction?.();
            }}
            disabled={row.actionDisabled}
            className="inline-flex h-7 items-center justify-center rounded-md border border-border px-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {row.actionLabel}
          </button>
        )}
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
      </div>
    </>
  );

  const className = 'flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-all hover:border-primary/30 hover:shadow-sm';

  if (row.onClick) {
    return <button type="button" onClick={row.onClick} className={className}>{content}</button>;
  }

  if (row.onAction) {
    return <div className={className}>{content}</div>;
  }

  return <Link to={row.href ?? '/context'} className={className}>{content}</Link>;
}

export function ObservationsDashboard({ onAddContext }: { onAddContext?: () => void }) {
  const { openDrawer } = useAppStore();
  const [sourceFilter, setSourceFilter] = useState<'all' | ObservationSource>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ObservationStatus>('all');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const reprocessSource = useReprocessRawContextSource();
  const activitiesQ = useActivities({ limit: 100 }) as any;
  const outboundQ = useEmails({ limit: 100 }) as any;
  const syncRunsQ = useSystemSyncRuns({ limit: 100 }) as any;
  const rawSourcesQ = useRawContextSources({
    q: query.trim() || undefined,
    status: rawStatusFilter(statusFilter),
    limit: 100,
  }) as any;
  const memoryQ = useContextEntries({ memory_status: 'active', limit: 100 }) as any;
  const signalsQ = useContextEntries({ memory_status: 'signal', limit: 100 }) as any;
  const signalGroupsQ = useSignalGroups({ attention_only: true, limit: 1 }) as any;
  const staleQ = useContextEntries({ is_current: false, limit: 100 }) as any;

  const activities: any[] = activitiesQ.data?.data ?? [];
  const outboundEmails: any[] = outboundQ.data?.data ?? [];
  const syncRuns: any[] = syncRunsQ.data?.data ?? [];
  const rawSources: any[] = rawSourcesQ.data?.data ?? [];
  const memoryEntries: any[] = memoryQ.data?.data ?? [];
  const signalEntries: any[] = signalsQ.data?.data ?? [];
  const staleEntries: any[] = staleQ.data?.data ?? [];

  const contextByActivity = useMemo(() => {
    const map = new Map<string, { memory: number; signals: number }>();
    for (const entry of memoryEntries) {
      if (!entry.source_activity_id) continue;
      const current = map.get(entry.source_activity_id) ?? { memory: 0, signals: 0 };
      current.memory += 1;
      map.set(entry.source_activity_id, current);
    }
    for (const entry of signalEntries) {
      if (!entry.source_activity_id) continue;
      const current = map.get(entry.source_activity_id) ?? { memory: 0, signals: 0 };
      current.signals += 1;
      map.set(entry.source_activity_id, current);
    }
    return map;
  }, [memoryEntries, signalEntries]);

  const rows = useMemo(() => {
    const rawSourceRows = rawSources.slice(0, 50).map(source => {
      const classified = classifyRawSource(source.source_type);
      const status = statusFromRawSource(source.status);
      const memory = Number(source.memory_created ?? 0);
      const signals = Number(source.signals_created ?? 0);
      const skipped = Number(source.skipped ?? 0);
      const counts = memory > 0 || signals > 0 || skipped > 0
        ? `${memory} Memory, ${signals} Signals${skipped > 0 ? `, ${skipped} skipped` : ''}`
        : source.failure_reason ?? 'Processing source context';
      return {
        id: `raw-source-${source.id}`,
        source: classified.source,
        type: classified.type,
        title: source.source_label ?? source.source_ref ?? 'Raw context source',
        detail: source.failure_reason ? `${counts}; ${source.failure_reason}` : counts,
        timestamp: source.processed_at ?? source.created_at,
        status,
        href: source.subject_type && source.subject_id ? `/context?tab=${signals > 0 ? 'signals' : 'browser'}` : '/context?tab=observations',
        actionLabel: ['Failed', 'No context found'].includes(status) ? 'Retry' : undefined,
        actionDisabled: reprocessSource.isPending,
        onAction: ['Failed', 'No context found'].includes(status)
          ? () => reprocessSource.mutate(source.id, {
              onSuccess: () => toast({ title: 'Raw Context reprocessed', description: 'Refresh the review queues to inspect any new Signals or Memory.' }),
              onError: (err) => toast({
                title: 'Reprocess failed',
                description: err instanceof Error ? err.message : 'Try again after checking the source.',
                variant: 'destructive',
              }),
            })
          : undefined,
      };
    });
    const rawSourceRefs = new Set(rawSources.map(source => String(source.source_ref)));

    const activityRows = activities.slice(0, 30).map(activity => {
      const subject = String(activity.subject ?? '').toLowerCase();
      const isManualImport = activity.type === 'note' && (subject.includes('ingested document') || subject.includes('auto-ingested'));
      const isInboundEmail = activity.type === 'email' && activity.direction === 'inbound';
      const counts = contextByActivity.get(activity.id);
      const hasMemory = Boolean(counts?.memory);
      const hasSignals = Boolean(counts?.signals);
      const status: ObservationStatus = hasMemory ? 'Processed' : hasSignals ? 'Needs review' : 'No context found';
      const source: ObservationSource = isManualImport ? 'add_context' : isInboundEmail ? 'inbound_email' : 'activity';
      const sourceType = isManualImport ? 'Add Context' : isInboundEmail ? 'Inbound email' : activity.type ?? 'Activity';
      const title = activity.subject ?? activity.body?.slice?.(0, 80) ?? 'Untitled activity';
      return {
        id: `activity-${activity.id}`,
        source,
        type: sourceType,
        title,
        detail: hasMemory || hasSignals
          ? `${counts?.memory ?? 0} Memory, ${counts?.signals ?? 0} Signals`
          : `${activity.subject_type ? `Linked to ${String(activity.subject_type).replace('_', ' ')}` : 'Captured source'}; no extracted context in recent results`,
        timestamp: activity.occurred_at ?? activity.created_at,
        status,
        onClick: () => openDrawer('activity', activity.id),
      };
    }).filter(row => !rawSourceRefs.has(row.id.replace(/^activity-/, '')));

    const outboundRows = outboundEmails.slice(0, 20).map(email => {
      const rawStatus = String(email.status ?? '').toLowerCase();
      const status: ObservationStatus = rawStatus === 'failed'
        ? 'Failed'
        : rawStatus === 'pending_approval'
          ? 'Needs review'
          : rawStatus === 'sent' || rawStatus === 'approved'
            ? 'Processed'
            : 'No context found';
      return {
        id: `email-${email.id}`,
        source: 'outbound_email' as const,
        type: 'Outbound email',
        title: email.subject ?? email.to_email ?? 'Untitled email',
        detail: email.to_email ? `To ${email.to_email}` : 'Outbound email source',
        timestamp: email.sent_at ?? email.created_at,
        status,
        href: '/emails',
      };
    });

    const syncRows = syncRuns.slice(0, 20).map(run => {
      const rawStatus = String(run.status ?? '').toLowerCase();
      const status: ObservationStatus = rawStatus === 'failed' || rawStatus === 'error'
        ? 'Failed'
        : rawStatus === 'completed' || rawStatus === 'complete' || rawStatus === 'success'
          ? 'Processed'
          : 'Needs review';
      const changed = Number(run.records_changed ?? run.updated_count ?? run.created_count ?? 0);
      return {
        id: `sync-${run.id}`,
        source: 'system_sync' as const,
        type: 'System sync',
        title: String(run.system_name ?? run.system_type ?? run.system_id ?? 'System of record sync'),
        detail: changed > 0 ? `${changed.toLocaleString()} changed records` : 'Sync run captured from connected system',
        timestamp: String(run.completed_at ?? run.started_at ?? run.created_at ?? ''),
        status,
        href: '/settings/systems',
      };
    });

    const contextRows = [...memoryEntries, ...signalEntries]
      .filter(entry => !entry.source_activity_id)
      .slice(0, 40)
      .map(entry => {
        const classified = classifyContextSource(entry);
        const isSignal = entry.memory_status === 'signal';
        const status: ObservationStatus = isSignal ? 'Needs review' : 'Processed';
        const title = entry.title ?? String(entry.body ?? '').slice(0, 80) ?? 'Untitled context';
        const subject = entry.subject_type ? `${String(entry.subject_type).replace('_', ' ')} context` : 'Customer context';
        return {
          id: `context-${entry.id}`,
          source: classified.source,
          type: classified.type,
          title,
          detail: `${subject}; ${evidenceDetail(entry)}`,
          timestamp: entry.created_at,
          status,
          href: isSignal ? '/context?tab=signals' : '/context?tab=browser',
        };
      });

    return [...rawSourceRows, ...activityRows, ...outboundRows, ...syncRows, ...contextRows]
      .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())
      .slice(0, 20);
  }, [activities, contextByActivity, memoryEntries, openDrawer, outboundEmails, rawSources, reprocessSource, signalEntries, syncRuns]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter(row => {
      if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return `${row.type} ${row.title} ${row.detail} ${row.status}`.toLowerCase().includes(normalizedQuery);
    });
  }, [query, rows, sourceFilter, statusFilter]);

  const failedRows = rows.filter(row => row.status === 'Failed').length;
  const sevenDayBuckets = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      const counts = VOLUME_STATUS_OPTIONS.reduce((acc, status) => {
        acc[status.value] = 0;
        return acc;
      }, {} as Record<VolumeStatus, number>);
      return { key, label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date), counts, total: 0 };
    });
    const byKey = new Map(days.map(day => [day.key, day]));
    for (const row of rows) {
      const key = dayKey(row.timestamp);
      const day = byKey.get(key);
      if (!day) continue;
      const status: VolumeStatus = row.status === 'Failed' ? 'failed' : 'processed';
      day.counts[status] += 1;
      day.total += 1;
    }
    return days;
  }, [rows]);

  const signalReviewTotal = Number(signalGroupsQ.data?.total ?? 0);
  const isLoading = activitiesQ.isLoading || outboundQ.isLoading || rawSourcesQ.isLoading || memoryQ.isLoading || signalsQ.isLoading || signalGroupsQ.isLoading;
  const hasFilters = sourceFilter !== 'all' || statusFilter !== 'all' || query.trim().length > 0;
  useSlashSearchFocus(searchRef);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6 space-y-4 md:space-y-6">
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4 md:p-5 shadow-sm lg:col-span-2">
          <div className="mb-4">
            <h2 className="font-display font-bold text-foreground">Processing Outcomes</h2>
            <p className="mt-1 text-sm text-muted-foreground">What recent raw context is turning into.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <OutcomeCard label="Memory available" value={Number(memoryQ.data?.total ?? 0)} detail="Confirmed context agents can rely on." tone="border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
            <OutcomeCard label="Signals needing review" value={signalReviewTotal} detail="Corroborated Signals waiting for Memory, dismissal, or more evidence." tone="border-violet-500/20 bg-violet-500/10 text-violet-500" />
            <OutcomeCard label="Memory Needs Review" value={Number(staleQ.data?.total ?? staleEntries.length)} detail="Current Memory that needs reconfirmation or retirement." tone="border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400" />
            <OutcomeCard label="Failed sources" value={failedRows} detail="Recent rows with failed source processing or delivery." tone="border-destructive/20 bg-destructive/10 text-destructive" />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 md:p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-display font-bold text-foreground">Context Volume</h2>
            <p className="mt-1 text-sm text-muted-foreground">Last 7 days by processing outcome.</p>
          </div>
          <div className="mb-4 flex flex-wrap gap-x-3 gap-y-1">
            {VOLUME_STATUS_OPTIONS.map(status => (
              <span key={status.value} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${status.color}`} />
                {status.label}
              </span>
            ))}
          </div>
          <div className="space-y-3">
            {sevenDayBuckets.map(day => (
              <div key={day.key} className="grid grid-cols-[2.5rem_1fr_2rem] items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">{day.label}</span>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                  {day.total === 0 ? (
                    <div className="h-full w-full bg-muted" />
                  ) : VOLUME_STATUS_OPTIONS.map(status => (
                    day.counts[status.value] > 0 && (
                      <div
                        key={status.value}
                        className={`h-full ${status.color}`}
                        style={{ width: `${(day.counts[status.value] / day.total) * 100}%` }}
                        title={`${status.label}: ${day.counts[status.value]}`}
                      />
                    )
                  ))}
                </div>
                <span className="text-right text-xs font-semibold text-foreground">{day.total}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 md:p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-foreground">Recent Sources</h2>
            <p className="mt-1 text-sm text-muted-foreground">Activities, emails, systems, MCP/API writes, and imports that produced or attempted context.</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {isLoading && <Clock className="h-4 w-4 animate-pulse text-muted-foreground" />}
            <button
              type="button"
              onClick={onAddContext}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#0ea5e9] to-[#0ea5e9]/80 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Add Context
            </button>
          </div>
        </div>
        <div className="mb-4 flex flex-col gap-2 lg:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search recent sources..."
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            {!query && (
              <kbd className="absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground/50 md:inline-flex">
                /
              </kbd>
            )}
          </div>
          <select
            value={sourceFilter}
            onChange={event => setSourceFilter(event.target.value as 'all' | ObservationSource)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">All sources</option>
            {SOURCE_OPTIONS.map(source => <option key={source.value} value={source.value}>{source.label}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value as 'all' | ObservationStatus)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSourceFilter('all');
                setStatusFilter('all');
                setQuery('');
              }}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Showing recent and top matching sources. Search runs against Raw Context before CRMy trims the review list, so large workspaces stay searchable without loading the full archive.
        </p>

        {filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center">
            <FileText className="mb-3 h-9 w-9 text-muted-foreground/50" />
            <p className="text-sm font-semibold text-foreground">{rows.length === 0 ? 'No raw context yet' : 'No sources match these filters'}</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {rows.length === 0
                ? 'Add notes, transcripts, emails, connect a system of record, or let an agent send context through MCP to start building Signals and Memory.'
                : 'Adjust the source, status, or search filters to broaden the list.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRows.map(row => <ObservationRow key={row.id} row={row} />)}
          </div>
        )}

        {syncRunsQ.isError && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p className="text-xs">
              System sync data requires Systems of Record access. Other raw context sources are still shown.
            </p>
          </div>
        )}
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p className="text-xs">
            Source rows use recent visible data. Direct MCP, REST, CLI, and workflow context writes are shown from their evidence or source metadata; when CRMy cannot prove raw context produced Signals or Memory, it shows “No context found” instead of guessing.
          </p>
        </div>
      </section>
    </div>
  );
}
