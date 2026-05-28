// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Database,
  Filter,
  FileText,
  GitBranch,
  Library,
  Loader2,
  Search,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useAccounts, useContacts, useContextLineage, useOpportunities, useUseCases, type ContextLineageEdge, type ContextLineageNode } from '@/api/hooks';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useSlashSearchFocus } from '@/hooks/useSlashSearchFocus';

type SubjectType = 'contact' | 'account' | 'opportunity' | 'use_case';
type LineagePhase = 'sources' | 'signals' | 'memory' | 'actions' | 'audit';

const PHASES: Array<{ key: LineagePhase; label: string }> = [
  { key: 'sources', label: 'Sources' },
  { key: 'signals', label: 'Signals' },
  { key: 'memory', label: 'Memory' },
  { key: 'actions', label: 'Handoffs & Actions' },
  { key: 'audit', label: 'Audit' },
];

const NODE_CONFIG: Record<ContextLineageNode['type'], { label: string; icon: typeof FileText; className: string; dotClassName: string }> = {
  record:       { label: 'Record',       icon: UserRound,     className: 'bg-card text-foreground border-border',                       dotClassName: 'bg-muted-foreground' },
  raw_context:  { label: 'Raw Context',  icon: FileText,      className: 'bg-sky-500/10 text-sky-500 border-sky-500/20',                dotClassName: 'bg-sky-500' },
  activity:     { label: 'Activity',     icon: Activity,      className: 'bg-blue-500/10 text-blue-500 border-blue-500/20',             dotClassName: 'bg-blue-500' },
  signal:       { label: 'Signal',       icon: Sparkles,      className: 'bg-violet-500/10 text-violet-500 border-violet-500/20',       dotClassName: 'bg-violet-500' },
  signal_group: { label: 'Signal',       icon: GitBranch,     className: 'bg-violet-500/10 text-violet-500 border-violet-500/20',       dotClassName: 'bg-violet-500' },
  memory:       { label: 'Memory',       icon: Library,       className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',    dotClassName: 'bg-emerald-500' },
  handoff:      { label: 'Handoff',      icon: ClipboardList, className: 'bg-rose-500/10 text-rose-500 border-rose-500/20',             dotClassName: 'bg-rose-500' },
  writeback:    { label: 'Writeback',    icon: Database,      className: 'bg-slate-500/10 text-slate-500 border-slate-500/20',          dotClassName: 'bg-slate-500' },
  audit:        { label: 'Audit',        icon: CheckCircle2,  className: 'bg-muted text-muted-foreground border-border',                dotClassName: 'bg-muted-foreground' },
};

function nodeTime(node: ContextLineageNode) {
  if (!node.timestamp) return '';
  return new Date(node.timestamp).toLocaleString();
}

function resultName(record: Record<string, unknown>, type: SubjectType) {
  if (type === 'contact') {
    return [record.first_name, record.last_name].filter(Boolean).join(' ') || String(record.email ?? 'Contact');
  }
  return String(record.name ?? record.title ?? type.replace('_', ' '));
}

function phaseFor(node: ContextLineageNode): LineagePhase | 'record' {
  if (node.type === 'record') return 'record';
  if (node.type === 'raw_context' || node.type === 'activity') return 'sources';
  if (node.type === 'signal' || node.type === 'signal_group') return 'signals';
  if (node.type === 'memory') return 'memory';
  if (node.type === 'handoff' || node.type === 'writeback') return 'actions';
  return 'audit';
}

function phaseSummary(summary: Record<string, number>, phase: LineagePhase) {
  if (phase === 'sources') return (summary.raw_context ?? 0) + (summary.activity ?? 0);
  if (phase === 'signals') return (summary.signals ?? 0) + (summary.signal_groups ?? 0);
  if (phase === 'memory') return summary.memory ?? 0;
  if (phase === 'actions') return (summary.handoffs ?? 0) + (summary.writebacks ?? 0);
  return summary.audit_events ?? 0;
}

function relationLabel(relation: string) {
  const labels: Record<string, string> = {
    about_record: 'attached to record',
    recorded_as_activity: 'recorded',
    extracted_signal: 'extracted',
    supports: 'supports',
    conflicts: 'conflicts',
    supersedes: 'supersedes',
    promoted_to_memory: 'promoted',
    sent_to_handoff: 'sent to handoff',
    approved_writeback: 'approved',
    requested_writeback: 'written back',
    audits: 'audited',
  };
  return labels[relation] ?? relation.replace(/_/g, ' ');
}

function compareOldestFirst(a: ContextLineageNode, b: ContextLineageNode) {
  const orderA = a.display_order ?? 99;
  const orderB = b.display_order ?? 99;
  if (orderA !== orderB) return orderA - orderB;
  return String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? ''));
}

function isVisibleNode(node: ContextLineageNode, phases: Set<LineagePhase>) {
  const phase = phaseFor(node);
  return phase === 'record' || phases.has(phase);
}

function journeySummary(summary: Record<string, number>) {
  const sources = (summary.raw_context ?? 0) + (summary.activity ?? 0);
  const signals = (summary.signals ?? 0) + (summary.signal_groups ?? 0);
  const memory = summary.memory ?? 0;
  const handoffs = summary.handoffs ?? 0;
  const writebacks = summary.writebacks ?? 0;
  const parts = [
    `${sources} source${sources === 1 ? '' : 's'}`,
    `${signals} Signal${signals === 1 ? '' : 's'}`,
    `${memory} Memory ${memory === 1 ? 'entry' : 'entries'}`,
    `${handoffs} Handoff${handoffs === 1 ? '' : 's'}`,
    `${writebacks} writeback${writebacks === 1 ? '' : 's'}`,
  ];
  return `${parts[0]} produced ${parts.slice(1).join(', ')}.`;
}

function shortValue(value: unknown) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value).slice(0, 180);
}

function connectionEdgesFor(node: ContextLineageNode, edges: ContextLineageEdge[]) {
  return edges.filter(edge => edge.relation !== 'about_record' && (edge.source === node.id || edge.target === node.id));
}

function TimelineItem({
  node,
  edges,
  nodesById,
  onSelect,
}: {
  node: ContextLineageNode;
  edges: ContextLineageEdge[];
  nodesById: Map<string, ContextLineageNode>;
  onSelect: (node: ContextLineageNode) => void;
}) {
  const config = NODE_CONFIG[node.type];
  const Icon = config.icon;
  const connections = connectionEdgesFor(node, edges)
    .map(edge => {
      const outgoing = edge.source === node.id;
      const other = nodesById.get(outgoing ? edge.target : edge.source);
      return { edge, outgoing, other };
    })
    .filter((item): item is { edge: ContextLineageEdge; outgoing: boolean; other: ContextLineageNode } => Boolean(item.other))
    .slice(0, 4);

  return (
    <div className="relative flex gap-3">
      <div className="relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-background">
        <div className={`flex h-9 w-9 items-center justify-center rounded-full border ${config.className}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <button
        type="button"
        onClick={() => onSelect(node)}
        className="min-w-0 flex-1 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/30 hover:bg-muted/20"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {config.label}
            </span>
            {node.status && (
              <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {String(node.status).replace(/_/g, ' ')}
              </span>
            )}
            {node.timestamp && <span className="text-xs text-muted-foreground">{nodeTime(node)}</span>}
          </div>
          <p className="mt-1 font-semibold text-foreground">{node.label}</p>
          {node.description && <p className="mt-1 text-sm text-muted-foreground">{node.description}</p>}
          {connections.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {connections.map(({ edge, outgoing, other }) => (
                <span key={edge.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  <span className={`h-1.5 w-1.5 rounded-full ${NODE_CONFIG[other.type].dotClassName}`} />
                  <span className="truncate">{outgoing ? relationLabel(edge.relation) : other.label}</span>
                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{outgoing ? other.label : relationLabel(edge.relation)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </button>
    </div>
  );
}

function PhaseSection({
  title,
  description,
  nodes,
  edges,
  nodesById,
  onSelect,
}: {
  title: string;
  description: string;
  nodes: ContextLineageNode[];
  edges: ContextLineageEdge[];
  nodesById: Map<string, ContextLineageNode>;
  onSelect: (node: ContextLineageNode) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-display text-sm font-bold text-foreground">{title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="relative space-y-3 before:absolute before:left-5 before:bottom-5 before:top-5 before:w-px before:bg-border">
        {nodes.map(node => (
          <TimelineItem key={node.id} node={node} edges={edges} nodesById={nodesById} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

function NodeDetailSheet({
  node,
  edges,
  nodesById,
  onClose,
}: {
  node: ContextLineageNode | null;
  edges: ContextLineageEdge[];
  nodesById: Map<string, ContextLineageNode>;
  onClose: () => void;
}) {
  const config = node ? NODE_CONFIG[node.type] : NODE_CONFIG.audit;
  const Icon = config.icon;
  const incoming = node ? edges.filter(edge => edge.relation !== 'about_record' && edge.target === node.id) : [];
  const outgoing = node ? edges.filter(edge => edge.relation !== 'about_record' && edge.source === node.id) : [];
  const data = node?.data ?? {};

  return (
    <Sheet open={Boolean(node)} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {node && (
          <>
            <SheetHeader className="border-b border-border px-5 pb-4 pt-5 text-left">
              <div className="mb-2 flex items-center gap-2">
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full border ${config.className}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {config.label}
                </span>
              </div>
              <SheetTitle className="font-display text-lg leading-snug">{node.label}</SheetTitle>
              <SheetDescription>
                {node.description ?? 'Lineage item details, related edges, and source payload.'}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <DetailItem label="Status" value={node.status} />
                  <DetailItem label="When" value={node.timestamp ? nodeTime(node) : undefined} />
                  <DetailItem label="Subject" value={node.subject_type && node.subject_id ? `${node.subject_type} · ${String(node.subject_id).slice(0, 8)}` : undefined} />
                  <DetailItem label="Object ID" value={node.object_id ? String(node.object_id) : undefined} />
                </div>

                {(incoming.length > 0 || outgoing.length > 0) && (
                  <div className="rounded-xl border border-border bg-card p-3">
                    <p className="text-sm font-semibold text-foreground">Connections</p>
                    <div className="mt-2 space-y-2">
                      {incoming.map(edge => (
                        <ConnectionRow key={edge.id} edge={edge} other={nodesById.get(edge.source)} direction="from" />
                      ))}
                      {outgoing.map(edge => (
                        <ConnectionRow key={edge.id} edge={edge} other={nodesById.get(edge.target)} direction="to" />
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-border bg-card p-3">
                  <p className="text-sm font-semibold text-foreground">Payload</p>
                  <div className="mt-2 space-y-2">
                    {Object.entries(data).slice(0, 12).map(([key, value]) => (
                      <div key={key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 text-xs">
                        <span className="text-muted-foreground">{key.replace(/_/g, ' ')}</span>
                        <span className="break-words text-foreground">{shortValue(value) ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailItem({ label, value }: { label: string; value?: unknown }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-foreground">{shortValue(value) ?? '—'}</p>
    </div>
  );
}

function ConnectionRow({ edge, other, direction }: { edge: ContextLineageEdge; other?: ContextLineageNode; direction: 'from' | 'to' }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-xs">
      <span className="text-muted-foreground">{direction}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{other?.label ?? 'Unknown item'}</span>
      <span className="rounded-full bg-background px-2 py-0.5 font-semibold text-muted-foreground">{relationLabel(edge.relation)}</span>
    </div>
  );
}

export function ContextLineageView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState<{ type: SubjectType; id: string; name: string } | null>(null);
  const [phases, setPhases] = useState<Set<LineagePhase>>(() => new Set(PHASES.map(phase => phase.key)));
  const [viewMode, setViewMode] = useState<'path' | 'events'>('path');
  const [selectedNode, setSelectedNode] = useState<ContextLineageNode | null>(null);
  const { data: contacts } = useContacts({ q: query || undefined, limit: 4 }) as any;
  const { data: accounts } = useAccounts({ q: query || undefined, limit: 4 }) as any;
  const { data: opportunities } = useOpportunities({ q: query || undefined, limit: 4 }) as any;
  const { data: useCases } = useUseCases({ q: query || undefined, limit: 4 }) as any;
  const urlSubjectType = searchParams.get('subject_type');
  const urlSubjectId = searchParams.get('subject_id');
  const urlSubject = urlSubjectType && ['contact', 'account', 'opportunity', 'use_case'].includes(urlSubjectType) && urlSubjectId
    ? { type: urlSubjectType as SubjectType, id: urlSubjectId }
    : null;

  const lineageParams = subject
    ? { subject_type: subject.type, subject_id: subject.id }
    : urlSubject
    ? { subject_type: urlSubject.type, subject_id: urlSubject.id }
    : {
      context_entry_id: searchParams.get('context_entry_id') ?? undefined,
      signal_group_id: searchParams.get('signal_group_id') ?? undefined,
      raw_context_source_id: searchParams.get('raw_context_source_id') ?? undefined,
    };
  const lineage = useContextLineage(lineageParams);
  const data = lineage.data?.lineage;
  const hasLineageTarget = Boolean(
    subject
    || urlSubject
    || searchParams.get('context_entry_id')
    || searchParams.get('signal_group_id')
    || searchParams.get('raw_context_source_id'),
  );
  const visibleData = hasLineageTarget ? data : undefined;

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return [
      ...((contacts?.data ?? []).map((record: Record<string, unknown>) => ({ type: 'contact' as const, record }))),
      ...((accounts?.data ?? []).map((record: Record<string, unknown>) => ({ type: 'account' as const, record }))),
      ...((opportunities?.data ?? []).map((record: Record<string, unknown>) => ({ type: 'opportunity' as const, record }))),
      ...((useCases?.data ?? []).map((record: Record<string, unknown>) => ({ type: 'use_case' as const, record }))),
    ].slice(0, 8);
  }, [accounts?.data, contacts?.data, opportunities?.data, query, useCases?.data]);

  const nodesById = useMemo(() => new Map((visibleData?.nodes ?? []).map(node => [node.id, node])), [visibleData?.nodes]);
  const visibleNodes = useMemo(() => {
    const nodes = visibleData?.nodes ?? [];
    return nodes
      .filter(node => isVisibleNode(node, phases))
      .sort(compareOldestFirst);
  }, [visibleData?.nodes, phases]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map(node => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => (visibleData?.edges ?? []).filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [visibleData?.edges, visibleIds],
  );

  const activePhaseCount = phases.size;
  const selectedRecordLabel = subject?.name
    ?? visibleNodes.find(node => node.type === 'record')?.label
    ?? (urlSubject ? `${urlSubject.type.replace('_', ' ')} · ${urlSubject.id.slice(0, 8)}` : '');
  const recordNodes = visibleNodes.filter(node => node.type === 'record');
  const nonRecordNodes = visibleNodes.filter(node => node.type !== 'record');
  const nodesByPhase = {
    sources: visibleNodes.filter(node => phaseFor(node) === 'sources'),
    signals: visibleNodes.filter(node => phaseFor(node) === 'signals'),
    memory: visibleNodes.filter(node => phaseFor(node) === 'memory'),
    actions: visibleNodes.filter(node => phaseFor(node) === 'actions'),
    audit: visibleNodes.filter(node => phaseFor(node) === 'audit'),
  };
  const lifecycleEdges = visibleEdges.filter(edge => edge.relation !== 'about_record');
  const hasGaps = visibleData && nonRecordNodes.length > 1 && lifecycleEdges.length === 0;
  useSlashSearchFocus(searchRef);

  function togglePhase(phase: LineagePhase) {
    setPhases(prev => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  }

  function clearSubject() {
    setSubject(null);
    const existing = Object.fromEntries(searchParams.entries());
    delete existing.subject_type;
    delete existing.subject_id;
    setSearchParams({ ...existing, tab: 'lineage' });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 px-4 py-2 md:px-6 md:py-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={selectedRecordLabel || 'Search records...'}
              className="h-9 w-full rounded-xl border border-border bg-card pl-9 pr-8 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1">
                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            )}
            {!query && (
              <kbd className="absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground/50 md:inline-flex">
                /
              </kbd>
            )}
            {results.length > 0 && (
              <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                {results.map(({ type, record }) => {
                  const id = String(record.id);
                  const name = resultName(record, type);
                  return (
                    <button
                      key={`${type}:${id}`}
                      type="button"
                      onClick={() => {
                        setSubject({ type, id, name });
                        setQuery('');
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="truncate font-medium text-foreground">{name}</span>
                      <span className="flex-shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {type.replace('_', ' ')}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex h-9 rounded-xl border border-border bg-card p-0.5">
            {(['path', 'events'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`rounded-lg px-3 text-sm font-semibold capitalize transition-colors ${
                  viewMode === mode ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <button className="h-9 flex-shrink-0 rounded-xl border border-border bg-card px-3 text-sm text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Filter className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Phase filters</span>
                  {activePhaseCount !== PHASES.length && (
                    <span className="ml-0.5 rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
                      {activePhaseCount}
                    </span>
                  )}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 rounded-xl p-0" align="start">
              <div className="flex items-center justify-between border-b border-border p-3">
                <span className="text-sm font-display font-bold text-foreground">Phase filters</span>
                {activePhaseCount !== PHASES.length && (
                  <button onClick={() => setPhases(new Set(PHASES.map(phase => phase.key)))} className="text-xs text-muted-foreground hover:text-foreground">
                    Show all
                  </button>
                )}
              </div>
              <div className="max-h-80 space-y-0.5 overflow-y-auto p-2">
                {PHASES.map(phase => (
                  <label key={phase.key} className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted/50">
                    <Checkbox checked={phases.has(phase.key)} onCheckedChange={() => togglePhase(phase.key)} className="h-4 w-4" />
                    <span className="flex-1">{phase.label}</span>
                    <span className="text-xs text-muted-foreground">{visibleData ? phaseSummary(visibleData.summary, phase.key) : 0}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

        </div>

        {(subject || urlSubject || activePhaseCount !== PHASES.length) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {(subject || urlSubject) && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1 text-xs text-foreground">
                <span className="text-muted-foreground">Record:</span> {selectedRecordLabel}
                <button onClick={clearSubject} className="ml-0.5 p-0.5 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {PHASES.filter(phase => !phases.has(phase.key)).map(phase => (
              <span key={phase.key} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1 text-xs text-foreground">
                <span className="text-muted-foreground">Hidden:</span> {phase.label}
                <button onClick={() => togglePhase(phase.key)} className="ml-0.5 p-0.5 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6 md:pb-6">
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card/70 px-3 py-2.5 text-sm text-muted-foreground">
            Trace how source material becomes Signals, trusted Memory, handoffs, writebacks, and audit history. This shows the source-to-Memory trail, not the agent&apos;s temporary Active Context window.
          </div>

          {visibleData && nonRecordNodes.length > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Journey Summary</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{journeySummary(visibleData.summary)}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PHASES.map(phase => (
                  <span key={phase.key} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    {phase.label}: {phaseSummary(visibleData.summary, phase.key)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!hasLineageTarget ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 font-semibold text-foreground">Search for a record to view lineage</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Search for a customer record to trace how context became Memory and action.
              </p>
            </div>
          ) : lineage.isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading lineage…
            </div>
          ) : lineage.isError ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-10 text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
              <p className="mt-3 font-semibold text-foreground">Could not load lineage</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                CRMy could not trace this context item right now. Refresh the page or check the server logs for the lineage endpoint.
              </p>
            </div>
          ) : visibleNodes.length === 0 || (hasLineageTarget && nonRecordNodes.length === 0) ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 font-semibold text-foreground">
                {hasLineageTarget ? 'No lineage found' : 'Search for a record to view lineage'}
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                {hasLineageTarget
                  ? 'This record does not have linked Raw Context, Signals, Memory, handoffs, or writebacks yet.'
                  : 'Search for a customer record to trace how context became Memory and action.'}
              </p>
              {hasLineageTarget && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Link to="/context?tab=observations&add=context" className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Add Context</Link>
                  <Link to="/context?tab=observations" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">View Raw Context</Link>
                  <Link to="/context" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">View Memory</Link>
                </div>
              )}
            </div>
          ) : viewMode === 'events' ? (
            <div className="space-y-3">
              {visibleNodes.map(node => (
                <TimelineItem key={node.id} node={node} edges={visibleEdges} nodesById={nodesById} onSelect={setSelectedNode} />
              ))}
            </div>
          ) : (
            <div className="space-y-5">
              {recordNodes.length > 0 && (
                <PhaseSection
                  title="Customer Record"
                  description="The customer object this lineage is attached to."
                  nodes={recordNodes}
                  edges={visibleEdges}
                  nodesById={nodesById}
                  onSelect={setSelectedNode}
                />
              )}
              <PhaseSection
                title="Sources"
                description="Raw customer context and activities that produced extracted Signals."
                nodes={nodesByPhase.sources}
                edges={visibleEdges}
                nodesById={nodesById}
                onSelect={setSelectedNode}
              />
              <PhaseSection
                title="Signals"
                description="Inferred claims and evidence consolidation before Memory."
                nodes={nodesByPhase.signals}
                edges={visibleEdges}
                nodesById={nodesById}
                onSelect={setSelectedNode}
              />
              <PhaseSection
                title="Confirmed Memory"
                description="Trusted operational context available for briefings, workflows, and governed action."
                nodes={nodesByPhase.memory}
                edges={visibleEdges}
                nodesById={nodesById}
                onSelect={setSelectedNode}
              />
              <PhaseSection
                title="Handoffs & Actions"
                description="Human reviews, governed writebacks, and action receipts connected to this context."
                nodes={nodesByPhase.actions}
                edges={visibleEdges}
                nodesById={nodesById}
                onSelect={setSelectedNode}
              />
              <PhaseSection
                title="Audit Receipts"
                description="Immutable events preserved for traceability."
                nodes={nodesByPhase.audit}
                edges={visibleEdges}
                nodesById={nodesById}
                onSelect={setSelectedNode}
              />
              {hasGaps && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
                  Some actions do not have linked source evidence yet. They are still shown here so operators can inspect the available path.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <NodeDetailSheet node={selectedNode} edges={visibleEdges} nodesById={nodesById} onClose={() => setSelectedNode(null)} />
    </div>
  );
}
