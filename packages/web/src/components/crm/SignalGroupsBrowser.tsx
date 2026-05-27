// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  GitBranch,
  Settings,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  usePromoteSignalGroup,
  useRejectSignalGroup,
  useSendSignalGroupToHandoff,
  useSignalGroup,
  useSignalGroups,
  type SignalGroup,
} from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/hooks/use-toast';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { CompactList } from '@/components/crm/CompactList';

function pct(value: number | null | undefined) {
  return `${Math.round(Number(value ?? 0) * 100)}%`;
}

function statusTone(status: SignalGroup['status']) {
  if (status === 'ready') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (status === 'conflicting') return 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  if (status === 'blocked') return 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400';
  if (status === 'promoted') return 'border-primary/20 bg-primary/10 text-primary';
  if (status === 'dismissed') return 'border-muted bg-muted text-muted-foreground';
  return 'border-border bg-muted/60 text-muted-foreground';
}

function statusLabel(status: SignalGroup['status']) {
  if (status === 'ready') return 'Ready for Memory';
  if (status === 'conflicting') return 'Blocked by conflict';
  if (status === 'blocked') return 'Needs approval';
  if (status === 'promoted') return 'Memory created';
  if (status === 'dismissed') return 'Dismissed';
  return 'Needs more evidence';
}

function subjectLabel(group: SignalGroup) {
  if (group.subject_name) return group.subject_name;
  const type = group.subject_type === 'use_case' ? 'Use Case' : group.subject_type[0].toUpperCase() + group.subject_type.slice(1);
  return `${type} ${group.subject_id.slice(0, 8)}`;
}

function sourceLabel(raw: string | undefined) {
  const value = String(raw || 'source').toLowerCase();
  const labels: Record<string, string> = {
    activity: 'Activity',
    call: 'Call',
    meeting: 'Meeting',
    transcript: 'Transcript',
    email: 'Email',
    inbound_email: 'Email',
    outbound_email: 'Email',
    mcp: 'MCP',
    crm_sync: 'CRM',
    warehouse_sync: 'Warehouse',
    hubspot: 'HubSpot',
    salesforce: 'Salesforce',
    databricks: 'Databricks',
    snowflake: 'Snowflake',
    manual: 'Manual Add Context',
    add_context: 'Add Context',
    raw_context: 'Raw Context',
  };
  return labels[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function metadata(group: SignalGroup) {
  return (group.metadata ?? {}) as Record<string, any>;
}

function confidenceComponents(group: SignalGroup) {
  const stored = (metadata(group).confidence_components ?? {}) as Record<string, any>;
  if (Object.keys(stored).length > 0) return stored;
  const members = (group.members ?? []) as any[];
  const supporting = members.filter(member => member.relation === 'supports');
  const evidenceConfidence = supporting.map(member => Number(member.context_entry?.confidence ?? 0.5));
  const sourceWeights = supporting.map(member => Number(member.evidence_weight ?? 0.85));
  return {
    strongest_evidence_confidence: evidenceConfidence.length ? Math.max(...evidenceConfidence) : 0,
    strongest_source_weight: sourceWeights.length ? Math.max(...sourceWeights) : 0,
    source_trust_label: sourceWeights.length && Math.max(...sourceWeights) >= 0.98 ? 'High' : sourceWeights.length && Math.max(...sourceWeights) >= 0.85 ? 'Medium' : 'Lower',
    support_boost: Math.min(0.16, Math.max(0, group.support_count - 1) * 0.04),
    source_boost: Math.min(0.12, Math.max(0, group.independent_source_count - 1) * 0.06),
    conflict_penalty: Math.min(0.35, group.conflict_count * 0.18),
  };
}

function promotionThreshold(group: SignalGroup) {
  const threshold = metadata(group).threshold;
  return typeof threshold === 'number' ? threshold : 0.85;
}

function trustExplanation(group: SignalGroup) {
  const components = confidenceComponents(group);
  const confidence = Number(components.strongest_evidence_confidence ?? 0);
  const sourceWeight = Number(components.strongest_source_weight ?? 0);
  if (confidence >= 0.85 && sourceWeight < 0.98) {
    return 'The model was confident, but this source type is weighted as medium trust.';
  }
  if (group.independent_source_count < 2 && group.aggregate_confidence < promotionThreshold(group)) {
    return 'Add another independent source or manually promote this Signal.';
  }
  if (group.conflict_count > 0) {
    return 'Conflicting evidence lowers trust and blocks automatic promotion.';
  }
  if (group.aggregate_confidence >= promotionThreshold(group)) {
    return 'This Signal meets the current promotion threshold.';
  }
  return 'Trust increases when CRMy finds stronger evidence or support from independent sources.';
}

function promotionStatusText(group: SignalGroup) {
  if (group.status === 'promoted') return 'Memory created';
  if (group.status === 'conflicting') return 'Blocked by conflict';
  if (group.status === 'blocked') return 'Needs approval';
  if (group.aggregate_confidence >= promotionThreshold(group)) return 'Will become Memory automatically';
  return 'Below threshold';
}

function promotionBlockers(group: SignalGroup) {
  const blockers = metadata(group).promotion_blockers;
  if (Array.isArray(blockers)) return blockers.filter(Boolean).map(String);
  return group.blocked_reason ? [group.blocked_reason] : [];
}

function canPromote(group: SignalGroup) {
  return !['blocked', 'conflicting', 'promoted', 'dismissed'].includes(group.status);
}

function sourceTypes(group: SignalGroup) {
  const members = group.members ?? [];
  const values = new Set<string>();
  for (const member of members as any[]) {
    const entry = member.context_entry ?? {};
    const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
    const first = evidence[0] ?? {};
    values.add(sourceLabel(first.source_type ?? entry.source));
  }
  return Array.from(values).slice(0, 5);
}

function evidenceItems(group: SignalGroup) {
  return ((group.members ?? []) as any[]).flatMap(member => {
    const entry = member.context_entry ?? {};
    const evidence = Array.isArray(entry.evidence) && entry.evidence.length > 0
      ? entry.evidence
      : [{}];
    return evidence.map((item: any, index: number) => ({
      id: `${member.id}-${index}`,
      relation: member.relation,
      entry,
      evidence: item,
      source: sourceLabel(item.source_type ?? entry.source),
      sourceLabel: item.source_label ?? item.source_ref ?? item.source_id ?? entry.source_ref,
      snippet: item.snippet,
      observedAt: item.observed_at,
    }));
  });
}

function supportingSignalCount(group: SignalGroup) {
  if (typeof group.support_count === 'number' && group.support_count > 0) return group.support_count;
  return ((group.members ?? []) as any[]).filter(member => member.relation === 'supports').length;
}

function independentSourceCount(group: SignalGroup) {
  if (typeof group.independent_source_count === 'number' && group.independent_source_count > 0) return group.independent_source_count;
  const keys = new Set<string>();
  for (const member of (group.members ?? []) as any[]) {
    if (member.relation !== 'supports') continue;
    const entry = member.context_entry ?? {};
    const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
    const first = evidence[0] ?? {};
    keys.add(String(member.source_key ?? first.source_id ?? first.source_ref ?? first.source_url ?? entry.source_ref ?? entry.id ?? member.id));
  }
  return keys.size;
}

function evidenceItemCount(group: SignalGroup) {
  if (typeof group.evidence_count === 'number' && group.evidence_count > 0) return group.evidence_count;
  return evidenceItems(group).filter(item => item.snippet || item.sourceLabel || item.evidence?.source_id || item.evidence?.source_ref).length;
}

export function SignalGroupsBrowser() {
  const navigate = useNavigate();
  const [attentionOnly, setAttentionOnly] = useState(true);
  const [q, setQ] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerView, setDrawerView] = useState<'details' | 'evidence'>('details');
  const { data, isLoading } = useSignalGroups({ attention_only: attentionOnly, limit: 50 }) as any;
  const groups: SignalGroup[] = data?.data ?? [];
  const selected = groups.find(g => g.id === selectedId) ?? null;
  const detail = useSignalGroup(selectedId);
  const detailedGroup = (detail.data as any)?.signal_group ?? selected;
  const promote = usePromoteSignalGroup();
  const reject = useRejectSignalGroup();
  const handoff = useSendSignalGroupToHandoff();

  const filterConfigs: FilterConfig[] = useMemo(() => {
    const contextTypes = Array.from(new Set(groups.map(group => group.context_type).filter(Boolean))).sort();
    return [
      {
        key: 'status',
        label: 'Status',
        options: [
          { value: 'gathering', label: 'Needs more evidence' },
          { value: 'ready', label: 'Ready for Memory' },
          { value: 'blocked', label: 'Needs approval' },
          { value: 'conflicting', label: 'Conflict' },
          { value: 'promoted', label: 'Memory created' },
          { value: 'dismissed', label: 'Dismissed' },
        ],
      },
      {
        key: 'subject_type',
        label: 'Record',
        options: [
          { value: 'account', label: 'Accounts' },
          { value: 'contact', label: 'Contacts' },
          { value: 'opportunity', label: 'Opportunities' },
          { value: 'use_case', label: 'Use Cases' },
        ],
      },
      {
        key: 'context_type',
        label: 'Type',
        options: contextTypes.map(type => ({ value: type, label: type.replace(/_/g, ' ') })),
      },
    ];
  }, [groups]);

  const sortOptions: SortOption[] = [
    { key: 'updated_at', label: 'Updated' },
    { key: 'aggregate_confidence', label: 'Trust score' },
    { key: 'evidence_count', label: 'Evidence' },
    { key: 'independent_source_count', label: 'Sources' },
  ];

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      if (values.length) next[key] = values;
      else delete next[key];
      return next;
    });
  };

  const handleSortChange = (key: string) => {
    setSort(prev => {
      if (prev?.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'desc' };
    });
  };

  const clearFilters = () => {
    setActiveFilters({});
    setQ('');
  };

  const groupedByStatus = useMemo(() => {
    const order: SignalGroup['status'][] = ['conflicting', 'blocked', 'ready', 'gathering', 'promoted', 'dismissed'];
    const normalizedQuery = q.trim().toLowerCase();
    const statusFilter = activeFilters.status ?? [];
    const subjectFilter = activeFilters.subject_type ?? [];
    const typeFilter = activeFilters.context_type ?? [];
    const filtered = groups.filter(group => {
      if (statusFilter.length && !statusFilter.includes(group.status)) return false;
      if (subjectFilter.length && !subjectFilter.includes(group.subject_type)) return false;
      if (typeFilter.length && !typeFilter.includes(group.context_type)) return false;
      if (!normalizedQuery) return true;
      return [
        group.title,
        group.normalized_claim,
        group.context_type,
        group.status,
        subjectLabel(group),
        ...sourceTypes(group),
      ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);
    });
    if (sort) {
      return [...filtered].sort((a, b) => {
        const aValue = sort.key === 'updated_at'
          ? new Date(a.updated_at ?? a.created_at).getTime()
          : Number((a as any)[sort.key] ?? 0);
        const bValue = sort.key === 'updated_at'
          ? new Date(b.updated_at ?? b.created_at).getTime()
          : Number((b as any)[sort.key] ?? 0);
        return sort.dir === 'asc' ? aValue - bValue : bValue - aValue;
      });
    }
    return [...filtered].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  }, [activeFilters, groups, q, sort]);

  const relatedSignals = useMemo(() => {
    if (!detailedGroup) return [];
    return groups
      .filter(group => group.id !== detailedGroup.id)
      .filter(group => group.subject_id === detailedGroup.subject_id || group.context_type === detailedGroup.context_type)
      .slice(0, 4);
  }, [detailedGroup, groups]);

  const onPromote = async (id: string) => {
    try {
      await promote.mutateAsync(id);
      toast({ title: 'Memory created', description: 'The Signal was promoted with its supporting evidence.' });
      setSelectedId(null);
    } catch (err) {
      toast({ title: 'Could not promote Signal', description: err instanceof Error ? err.message : 'Review the evidence and try again.', variant: 'destructive' });
    }
  };

  const onDismiss = async (id: string) => {
    try {
      await reject.mutateAsync({ id, reason: 'Dismissed from Signals review.' });
      toast({ title: 'Signal dismissed', description: 'CRMy will not promote this Signal to Memory. Evidence is preserved for audit.' });
      setSelectedId(null);
    } catch (err) {
      toast({ title: 'Could not dismiss Signal', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    }
  };

  const onHandoff = async (id: string) => {
    try {
      const result = await handoff.mutateAsync(id) as any;
      const requestId = result?.hitl_request?.id;
      toast({ title: 'Handoff created', description: 'A human review request was added for this Signal.' });
      setSelectedId(null);
      navigate(requestId ? `/handoffs?hitl=${requestId}` : '/handoffs');
    } catch (err) {
      toast({ title: 'Could not create handoff', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    }
  };

  return (
    <>
      <ListToolbar
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="Search Signals..."
        filters={filterConfigs}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearFilters={clearFilters}
        sortOptions={sortOptions}
        currentSort={sort}
        onSortChange={handleSortChange}
        entityType="signals"
        searchSuffix={(
          <div className="inline-flex h-9 flex-shrink-0 rounded-xl border border-border bg-muted p-1">
            <button
              type="button"
              onClick={() => setAttentionOnly(true)}
              aria-pressed={attentionOnly}
              className={`rounded-lg px-3 text-sm font-medium transition-colors ${
                attentionOnly
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Needs attention
            </button>
            <button
              type="button"
              onClick={() => setAttentionOnly(false)}
              aria-pressed={!attentionOnly}
              className={`rounded-lg px-3 text-sm font-medium transition-colors ${
                !attentionOnly
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Signals
            </button>
          </div>
        )}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading Signals...
          </div>
        ) : groupedByStatus.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card text-center">
            <Sparkles className="mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="font-display text-lg font-semibold text-foreground">
              {q || Object.keys(activeFilters).length > 0 ? 'No Signals match your filters' : attentionOnly ? 'No Signals need attention' : 'No Signals yet'}
            </h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {q || Object.keys(activeFilters).length > 0
                ? 'Try adjusting search or filters.'
                : 'Reviewable Signals appear here when Raw Context creates inferred customer context.'}
            </p>
          </div>
        ) : (
          <CompactList className="space-y-1">
            {groupedByStatus.map(group => {
              return (
                <button
                  key={group.id}
                  onClick={() => {
                    setSelectedId(group.id);
                    setDrawerView('details');
                  }}
                  className="group w-full rounded-xl p-3 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-500">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="max-w-xl truncate text-sm font-semibold text-foreground">
                          {group.title || group.normalized_claim}
                        </h3>
                        <Badge variant="outline" className={statusTone(group.status)}>
                          {statusLabel(group.status)}
                        </Badge>
                        <Badge variant="outline" className="text-xs capitalize">
                          {group.context_type.replace(/_/g, ' ')}
                        </Badge>
                        <span className="text-xs font-medium text-muted-foreground">{subjectLabel(group)}</span>
                      </div>
                      <p className="line-clamp-2 text-sm text-muted-foreground">{group.normalized_claim}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {pct(group.aggregate_confidence)} Trust score
                        </span>
                        <span>{supportingSignalCount(group)} supporting Signal{supportingSignalCount(group) === 1 ? '' : 's'}</span>
                        <span>{independentSourceCount(group)} independent source{independentSourceCount(group) === 1 ? '' : 's'}</span>
                        <span>{evidenceItemCount(group)} evidence item{evidenceItemCount(group) === 1 ? '' : 's'}</span>
                        {group.conflict_count > 0 && (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            {group.conflict_count} conflict{group.conflict_count === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </CompactList>
        )}
      </div>

      <Sheet open={!!selectedId} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          {detailedGroup ? (
            <>
              <SheetHeader className="border-b border-border px-5 pb-4 pt-5 text-left">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={statusTone(detailedGroup.status)}>
                    {statusLabel(detailedGroup.status)}
                  </Badge>
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    {subjectLabel(detailedGroup)}
                  </Badge>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <SheetTitle className="font-display text-lg leading-snug">
                    {drawerView === 'evidence' ? 'Signal Evidence' : detailedGroup.title || detailedGroup.normalized_claim}
                  </SheetTitle>
                  {drawerView === 'evidence' && (
                    <Button variant="outline" size="sm" onClick={() => setDrawerView('details')}>
                      Back
                    </Button>
                  )}
                </div>
                <SheetDescription>
                  {drawerView === 'evidence'
                    ? 'Source lineage and confidence for each supporting or conflicting item.'
                    : 'Review the evidence, trust score, and Memory readiness for this Signal.'}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {drawerView === 'details' ? (
                  <>
                    <div className="rounded-2xl border border-border bg-surface p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trust score</p>
                          <p className="mt-1 text-3xl font-bold text-foreground">{pct(detailedGroup.aggregate_confidence)}</p>
                        </div>
                        <Sparkles className="h-8 w-8 text-[#0ea5e9]" />
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{detailedGroup.normalized_claim}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDrawerView('evidence')}>
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          View Evidence
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link to="/settings/model">
                            <Settings className="mr-1 h-3.5 w-3.5" />
                            Signal promotion controls
                          </Link>
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/context?tab=lineage&signal_group_id=${detailedGroup.id}`}>
                            <GitBranch className="mr-1 h-3.5 w-3.5" />
                            View Lineage
                          </Link>
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-muted p-3">
                        <p className="text-lg font-bold text-foreground">{supportingSignalCount(detailedGroup)}</p>
                        <p className="text-[11px] text-muted-foreground">Signals</p>
                      </div>
                      <div className="rounded-xl bg-muted p-3">
                        <p className="text-lg font-bold text-foreground">{independentSourceCount(detailedGroup)}</p>
                        <p className="text-[11px] text-muted-foreground">Sources</p>
                      </div>
                      <div className="rounded-xl bg-muted p-3">
                        <p className="text-lg font-bold text-foreground">{evidenceItemCount(detailedGroup)}</p>
                        <p className="text-[11px] text-muted-foreground">Evidence</p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-4">
                      <p className="text-sm font-semibold text-foreground">Memory readiness</p>
                      <div className="mt-2 rounded-xl bg-muted p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Promotion state</span>
                          <span className="font-medium text-foreground">{promotionStatusText(detailedGroup)}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Promotion threshold</span>
                          <span className="font-medium text-foreground">{pct(promotionThreshold(detailedGroup))}</span>
                        </div>
                      </div>
                      {promotionBlockers(detailedGroup).length > 0 ? (
                        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                          {promotionBlockers(detailedGroup).map(blocker => (
                            <li key={blocker} className="flex gap-2">
                              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                              <span>{blocker}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          This Signal has enough evidence to become Memory.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Why this score?</p>
                          <p className="mt-1 text-sm text-muted-foreground">{trustExplanation(detailedGroup)}</p>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Extracted confidence</span>
                          <span className="font-medium text-foreground">{pct(confidenceComponents(detailedGroup).strongest_evidence_confidence)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Source trust</span>
                          <span className="font-medium text-foreground">
                            {confidenceComponents(detailedGroup).source_trust_label ?? 'Medium'} ({pct(confidenceComponents(detailedGroup).strongest_source_weight)})
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            Corroboration boost
                            <span className="ml-1 text-xs">
                              ({supportingSignalCount(detailedGroup)} Signal{supportingSignalCount(detailedGroup) === 1 ? '' : 's'}, {evidenceItemCount(detailedGroup)} evidence item{evidenceItemCount(detailedGroup) === 1 ? '' : 's'})
                            </span>
                          </span>
                          <span className="font-medium text-foreground">+{pct(confidenceComponents(detailedGroup).support_boost)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            Source diversity boost
                            <span className="ml-1 text-xs">
                              ({independentSourceCount(detailedGroup)} source{independentSourceCount(detailedGroup) === 1 ? '' : 's'})
                            </span>
                          </span>
                          <span className="font-medium text-foreground">+{pct(confidenceComponents(detailedGroup).source_boost)}</span>
                        </div>
                        {Number(confidenceComponents(detailedGroup).conflict_penalty ?? 0) > 0 && (
                          <div className="flex justify-between gap-3">
                            <span className="text-muted-foreground">Conflicts</span>
                            <span className="font-medium text-foreground">-{pct(confidenceComponents(detailedGroup).conflict_penalty)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {relatedSignals.length > 0 && (
                      <div className="rounded-2xl border border-border bg-card p-4">
                        <p className="text-sm font-semibold text-foreground">Related Signals</p>
                        <div className="mt-3 space-y-2">
                          {relatedSignals.map(group => (
                            <button
                              key={group.id}
                              onClick={() => {
                                setSelectedId(group.id);
                                setDrawerView('details');
                              }}
                              className="w-full rounded-xl bg-muted p-3 text-left transition-colors hover:bg-muted/80"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="line-clamp-1 text-sm font-medium text-foreground">{group.title || group.normalized_claim}</span>
                                <span className="text-xs font-semibold text-muted-foreground">{pct(group.aggregate_confidence)}</span>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">{statusLabel(group.status)}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {evidenceItems(detailedGroup).map(item => (
                      <div key={item.id} className="rounded-2xl border border-border bg-card p-4">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={item.relation === 'conflicts' ? 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}>
                            {item.relation}
                          </Badge>
                          <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{item.source}</span>
                          <span className="text-xs font-semibold text-foreground">{pct(item.entry.confidence)}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground">{item.entry.title || item.entry.body}</p>
                        {item.snippet && (
                          <p className="mt-3 border-l-2 border-border pl-3 text-sm text-muted-foreground">
                            {item.snippet}
                          </p>
                        )}
                        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                          {item.sourceLabel && <p>Source: {String(item.sourceLabel)}</p>}
                          {item.observedAt && <p>Observed: {new Date(item.observedAt).toLocaleString()}</p>}
                          <p>Subject: {item.entry.subject_name ?? item.entry.subject_type}</p>
                        </div>
                      </div>
                    ))}
                    {evidenceItems(detailedGroup).length === 0 && (
                      <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center text-muted-foreground">
                        <FileText className="mb-2 h-8 w-8" />
                        <p className="text-sm font-medium">No evidence details available</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-border bg-card p-4">
                <Button
                  onClick={() => onPromote(detailedGroup.id)}
                  disabled={promote.isPending || !canPromote(detailedGroup)}
                >
                  {promote.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                  Promote to Memory
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onHandoff(detailedGroup.id)}
                  disabled={handoff.isPending || detailedGroup.status === 'promoted' || detailedGroup.status === 'dismissed'}
                >
                  {handoff.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1 h-3.5 w-3.5" />}
                  Send to Handoff
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onDismiss(detailedGroup.id)}
                  disabled={reject.isPending || detailedGroup.status === 'promoted' || detailedGroup.status === 'dismissed'}
                  title="Dismiss this Signal so it will not become Memory. Evidence is preserved for audit."
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Dismiss Signal
                </Button>
                <Button variant="outline" onClick={() => setDrawerView(drawerView === 'evidence' ? 'details' : 'evidence')}>
                  <Eye className="mr-1 h-3.5 w-3.5" />
                  {drawerView === 'evidence' ? 'View Details' : 'View Evidence'}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading Signal...
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
