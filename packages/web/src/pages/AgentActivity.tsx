// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Fingerprint,
  Gauge,
  KeyRound,
  MessagesSquare,
  ReceiptText,
  Search,
  ShieldCheck,
  User,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  useAgentActivity,
  useAgentToolCatalog,
  type ActivityFilters,
  type ActivityLogEntry,
  type AgentToolCatalogEntry,
} from '@/api/hooks';
import { TopBar } from '@/components/layout/TopBar';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { CompactList, CompactListRow } from '@/components/crm/CompactList';
import { headerDescription } from '@/lib/headerCopy';

function formatDuration(ms: number | null): string {
  if (ms === null) return 'n/a';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function shortDescription(description?: string) {
  if (!description) return '';
  const first = description.split('. ')[0] ?? description;
  return first.length > 160 ? `${first.slice(0, 160)}...` : first;
}

function mutationReceipt(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) return null;
  return isRecord(result.mutation) ? result.mutation : null;
}

function idempotencyKey(args: unknown): string | undefined {
  if (!isRecord(args)) return undefined;
  const value = args.idempotency_key;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function eventIdFromMutation(mutation: Record<string, unknown> | null): string | undefined {
  const eventId = mutation?.event_id;
  return eventId == null ? undefined : String(eventId);
}

function toolCategory(name: string) {
  const [prefix] = name.split('_');
  return prefix || 'tool';
}

function dateInputValue(iso: string) {
  return iso ? iso.slice(0, 10) : '';
}

function tierClass(tier?: string) {
  if (tier === 'admin') return 'bg-destructive/10 text-destructive border-destructive/20';
  if (tier === 'extended') return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
  if (tier === 'analytics') return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
  return 'bg-success/10 text-success border-success/20';
}

function ActivityRow({ entry, tool }: { entry: ActivityLogEntry; tool?: AgentToolCatalogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const mutation = mutationReceipt(entry.tool_result);
  const idem = idempotencyKey(entry.tool_args);
  const eventId = eventIdFromMutation(mutation);

  return (
    <CompactListRow className="overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-2 py-2 text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        <span className={`flex items-center gap-1.5 font-mono text-sm font-medium min-w-0 ${entry.is_error ? 'text-destructive' : 'text-foreground'}`}>
          {entry.is_error ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : <Wrench className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate">{entry.tool_name}</span>
        </span>

        <div className="hidden lg:flex items-center gap-1.5 min-w-0">
          <span className={`text-[11px] px-1.5 py-0.5 rounded border font-semibold ${tierClass(tool?.tier)}`}>{tool?.tier ?? 'unknown'}</span>
          {mutation && <span className="text-[11px] px-1.5 py-0.5 rounded border border-primary/20 bg-primary/10 text-primary">mutation</span>}
          {idem && <span className="text-[11px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">idempotent</span>}
          {eventId && <span className="text-[11px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">event #{eventId}</span>}
        </div>

        <span className="flex-1" />

        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {entry.session_label && (
            <span className="hidden md:flex items-center gap-1">
              <MessagesSquare className="w-3 h-3" />
              <span className="max-w-[120px] truncate">{entry.session_label}</span>
            </span>
          )}
          {entry.user_name && (
            <span className="hidden sm:flex items-center gap-1">
              <User className="w-3 h-3" />
              {entry.user_name}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(entry.duration_ms)}
          </span>
          <span title={new Date(entry.created_at).toLocaleString()}>{formatRelative(entry.created_at)}</span>
        </span>
      </button>

      {expanded && (
        <div className="mx-2 mb-2 rounded-xl border border-border/70 bg-background/60 px-3 py-3 space-y-3">
          {tool && (
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${tierClass(tool.tier)}`}>{tool.tier}</span>
                <span className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground">{toolCategory(tool.name)}</span>
                {tool.required_scopes.length === 0 ? (
                  <span className="text-xs px-2 py-0.5 rounded border border-success/20 bg-success/10 text-success">public</span>
                ) : tool.required_scopes.map(scope => (
                  <span key={scope} className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground">{scope}</span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{shortDescription(tool.description)}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <DetailCard icon={<Fingerprint className="w-3.5 h-3.5" />} label="Idempotency key" value={idem ?? 'none'} mono />
            <DetailCard icon={<ReceiptText className="w-3.5 h-3.5" />} label="Mutation receipt" value={mutation ? `${mutation.object_type ?? 'object'}:${mutation.object_id ?? 'unknown'}` : 'none'} mono />
            <DetailCard icon={<Gauge className="w-3.5 h-3.5" />} label="Latency" value={formatDuration(entry.duration_ms)} />
          </div>

          <JsonBlock title="Arguments" value={entry.tool_args} />
          {entry.tool_result !== null && (
            <JsonBlock title={entry.is_error ? 'Error' : 'Result'} value={entry.tool_result} error={entry.is_error} />
          )}
        </div>
      )}
    </CompactListRow>
  );
}

function DetailCard({ icon, label, value, mono }: { icon: ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3 min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">{icon}{label}</p>
      <p className={`text-xs text-foreground truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function JsonBlock({ title, value, error }: { title: string; value: unknown; error?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{title}</p>
      <pre className={`text-xs font-mono border rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-56 overflow-y-auto ${
        error ? 'bg-destructive/5 border-destructive/30 text-destructive' : 'bg-background border-border text-foreground'
      }`}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function StatCard({ icon, label, value, tone = 'normal' }: { icon: ReactNode; label: string; value: string | number; tone?: 'normal' | 'bad' | 'good' }) {
  const toneClass = tone === 'bad'
    ? 'text-destructive bg-destructive/10'
    : tone === 'good'
      ? 'text-success bg-success/10'
      : 'text-primary bg-primary/10';
  return (
    <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${toneClass}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xl font-semibold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export default function AgentActivity() {
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [toolFilter, setToolFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [errorFilter, setErrorFilter] = useState<'all' | 'errors'>('all');
  const [since, setSince] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPageSize, setCatalogPageSize] = useState(25);

  const activeFilters: ActivityFilters = {
    ...filters,
    tool_name: toolFilter || undefined,
    is_error: errorFilter === 'errors' ? true : undefined,
    since: since || undefined,
    limit: 50,
  };

  const activityQ = useAgentActivity(activeFilters);
  const catalogQ = useAgentToolCatalog();
  const entries = activityQ.data?.data ?? [];
  const total = activityQ.data?.total ?? 0;
  const tools = catalogQ.data?.data ?? [];
  const toolMap = useMemo(() => new Map(tools.map(tool => [tool.name, tool])), [tools]);
  const categories = useMemo(() => [...new Set(tools.map(tool => tool.category || toolCategory(tool.name)))].sort(), [tools]);
	  const filteredTools = useMemo(() => tools.filter(tool => {
    if (categoryFilter && (tool.category || toolCategory(tool.name)) !== categoryFilter) return false;
    if (!catalogSearch.trim()) return true;
    const q = catalogSearch.toLowerCase();
    return tool.name.toLowerCase().includes(q)
      || tool.description.toLowerCase().includes(q)
      || tool.required_scopes.some(scope => scope.toLowerCase().includes(q));
	  }), [tools, categoryFilter, catalogSearch]);

  useEffect(() => { setCatalogPage(1); }, [catalogSearch, categoryFilter]);
  const paginatedTools = filteredTools.slice((catalogPage - 1) * catalogPageSize, catalogPage * catalogPageSize);

  const summary = useMemo(() => {
    const errors = entries.filter(entry => entry.is_error).length;
    const mutations = entries.filter(entry => mutationReceipt(entry.tool_result)).length;
    const durations = entries.map(entry => entry.duration_ms).filter((ms): ms is number => typeof ms === 'number');
    const avg = durations.length ? Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length) : null;
    return { errors, mutations, avg };
  }, [entries]);

  const clearFilters = () => {
    setToolFilter('');
    setCategoryFilter('');
    setErrorFilter('all');
    setSince('');
    setFilters({});
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Agent Activity"
        icon={Wrench}
        iconClassName="text-[#6366f1]"
        description={headerDescription('Review agent tool calls and tool access', total, 'call')}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard icon={<Wrench className="w-4 h-4" />} label="Visible tools" value={tools.length} />
          <StatCard icon={<XCircle className="w-4 h-4" />} label="Errors in view" value={summary.errors} tone={summary.errors > 0 ? 'bad' : 'good'} />
          <StatCard icon={<ReceiptText className="w-4 h-4" />} label="Mutation receipts" value={summary.mutations} tone="good" />
          <StatCard icon={<Clock className="w-4 h-4" />} label="Avg latency" value={summary.avg == null ? 'n/a' : formatDuration(summary.avg)} />
        </div>

        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Tool Calls</p>
              <p className="text-xs text-muted-foreground">{headerDescription('Recent agent actions', total, 'call')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select className="h-9 px-3 rounded-md border border-input bg-background text-sm" value={toolFilter} onChange={e => setToolFilter(e.target.value)}>
                <option value="">All tools</option>
                {tools.map(tool => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
              </select>
              <select className="h-9 px-3 rounded-md border border-input bg-background text-sm" value={errorFilter} onChange={e => setErrorFilter(e.target.value as 'all' | 'errors')}>
                <option value="all">All results</option>
                <option value="errors">Errors only</option>
              </select>
              <input type="date" value={dateInputValue(since)} className="h-9 px-3 rounded-md border border-input bg-background text-sm" onChange={e => setSince(e.target.value ? new Date(e.target.value).toISOString() : '')} />
              {(toolFilter || errorFilter !== 'all' || since || filters.cursor) && (
                <button className="h-9 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:text-foreground" onClick={clearFilters}>
                  Clear
                </button>
              )}
              <span className="self-center text-sm text-muted-foreground">{total.toLocaleString()} calls</span>
            </div>
          </div>

          <div className="p-4">
            {activityQ.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
              </div>
            ) : activityQ.isError ? (
              <div className="text-center py-12 text-muted-foreground">
                <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>Failed to load activity log.</p>
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Wrench className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No agent tool calls recorded yet.</p>
                <p className="text-xs mt-1 opacity-70">Activity appears here as the agent uses tools in chat sessions.</p>
              </div>
            ) : (
              <CompactList className="space-y-1">
                {entries.map(entry => <ActivityRow key={entry.id} entry={entry} tool={toolMap.get(entry.tool_name)} />)}
                {activityQ.data?.next_cursor && (
                  <button className="w-full mt-2 py-2 text-sm text-muted-foreground hover:text-foreground border border-dashed border-border rounded-lg" onClick={() => setFilters(f => ({ ...f, cursor: activityQ.data?.next_cursor }))}>
                    Load more
                  </button>
                )}
              </CompactList>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">MCP Tool Catalog</p>
              <p className="text-xs text-muted-foreground">{headerDescription('Review tools visible to this actor', filteredTools.length, 'tool')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} placeholder="Search tools" className="h-9 pl-8 pr-3 rounded-md border border-input bg-background text-sm" />
              </label>
              <select className="h-9 px-3 rounded-md border border-input bg-background text-sm" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                <option value="">All categories</option>
                {categories.map(category => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
          </div>
          <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
            {catalogQ.isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading tool catalog...</div>
            ) : filteredTools.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No tools match the current filters.</div>
            ) : (
              <>
                {paginatedTools.map(tool => (
                  <div key={tool.name} className="p-4 flex flex-col md:flex-row md:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-mono text-sm font-semibold text-foreground">{tool.name}</span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded border font-semibold ${tierClass(tool.tier)}`}>{tool.tier}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">{tool.category}</span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{shortDescription(tool.description)}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 md:justify-end md:max-w-sm">
                      {tool.required_scopes.length === 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-success/10 text-success">
                          <ShieldCheck className="w-3 h-3" />public
                        </span>
                      ) : tool.required_scopes.map(scope => (
                        <span key={scope} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-muted text-muted-foreground">
                          <KeyRound className="w-3 h-3" />{scope}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="px-4 pb-3">
                  <PaginationBar page={catalogPage} pageSize={catalogPageSize} total={filteredTools.length} onPageChange={setCatalogPage} onPageSizeChange={setCatalogPageSize} />
                </div>
              </>
            )}
	          </div>
        </section>
      </div>
    </div>
  );
}
