// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Eye, Inbox, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import {
  usePromoteSignalGroup,
  useRejectSignalGroup,
  useSignalGroup,
  useSignalGroups,
  type SignalGroup,
} from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { SeedSampleDataButton } from '@/components/crm/OnboardingEmptyState';

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
  if (status === 'conflicting') return 'Conflict';
  if (status === 'blocked') return 'Needs approval';
  if (status === 'promoted') return 'Memory created';
  if (status === 'dismissed') return 'Dismissed';
  return 'Gathering evidence';
}

function subjectLabel(group: SignalGroup) {
  const type = group.subject_type === 'use_case' ? 'Use Case' : group.subject_type[0].toUpperCase() + group.subject_type.slice(1);
  return `${type} ${group.subject_id.slice(0, 8)}`;
}

function sourceTypes(group: SignalGroup) {
  const members = group.members ?? [];
  const values = new Set<string>();
  for (const member of members as any[]) {
    const entry = member.context_entry ?? {};
    const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
    const first = evidence[0] ?? {};
    values.add(String(first.source_type ?? entry.source ?? 'source').replace(/_/g, ' '));
  }
  return Array.from(values).slice(0, 4);
}

export function SignalGroupsBrowser() {
  const [attentionOnly, setAttentionOnly] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading } = useSignalGroups({ attention_only: attentionOnly, limit: 50 }) as any;
  const groups: SignalGroup[] = data?.data ?? [];
  const selected = groups.find(g => g.id === selectedId) ?? null;
  const detail = useSignalGroup(selectedId);
  const detailedGroup = (detail.data as any)?.signal_group ?? selected;
  const promote = usePromoteSignalGroup();
  const reject = useRejectSignalGroup();

  const groupedByStatus = useMemo(() => {
    const order: SignalGroup['status'][] = ['conflicting', 'blocked', 'ready', 'gathering', 'promoted', 'dismissed'];
    return [...groups].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  }, [groups]);

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
      toast({ title: 'Signal dismissed', description: 'Supporting evidence was preserved for audit and hidden from normal review.' });
      setSelectedId(null);
    } catch (err) {
      toast({ title: 'Could not dismiss Signal', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    }
  };

  return (
    <div className="flex-1 overflow-hidden p-4 md:p-6">
      <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">Signals</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              CRMy combines supporting evidence across sources, shows confidence, and promotes trusted Signals to Memory.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAttentionOnly(v => !v)}
            className="self-start md:self-auto"
          >
            {attentionOnly ? 'View all Signals' : 'Show needs attention'}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading Signals…
        </div>
      ) : groupedByStatus.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card text-center">
          <Sparkles className="mb-3 h-10 w-10 text-muted-foreground" />
          <h3 className="font-display text-lg font-semibold text-foreground">No Signals need attention</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Add Raw Context from calls, notes, emails, or agent tools. CRMy will combine supporting evidence and create Memory when confidence is high enough.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Link
              to="/context?tab=browser&add=context"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[#0ea5e9] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#0284c7]"
            >
              Add Context
            </Link>
            <SeedSampleDataButton className="bg-card" />
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-3 overflow-y-auto pr-1">
            {groupedByStatus.map(group => (
              <button
                key={group.id}
                onClick={() => setSelectedId(group.id)}
                className={`w-full rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md ${
                  selectedId === group.id ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#0ea5e9]/15 text-[#0ea5e9]">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={statusTone(group.status)}>
                        {statusLabel(group.status)}
                      </Badge>
                      <span className="text-xs font-medium text-muted-foreground">{subjectLabel(group)}</span>
                      <span className="text-xs text-muted-foreground">{group.context_type.replace(/_/g, ' ')}</span>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-foreground">
                      {group.title || group.normalized_claim}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{group.normalized_claim}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 font-semibold text-foreground">
                        {pct(group.aggregate_confidence)} confidence
                      </span>
                      <span>{group.support_count} supporting Signal{group.support_count === 1 ? '' : 's'}</span>
                      <span>{group.independent_source_count} source{group.independent_source_count === 1 ? '' : 's'}</span>
                      <span>{group.evidence_count} evidence item{group.evidence_count === 1 ? '' : 's'}</span>
                      {group.conflict_count > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          {group.conflict_count} conflict{group.conflict_count === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    {group.blocked_reason && (
                      <p className="mt-2 text-xs text-muted-foreground">{group.blocked_reason}</p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <aside className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            {!detailedGroup ? (
              <div className="flex h-full min-h-64 flex-col items-center justify-center text-center text-muted-foreground">
                <Eye className="mb-2 h-8 w-8" />
                <p className="text-sm font-medium">Select a Signal</p>
                <p className="mt-1 text-xs">Review why CRMy trusts, blocks, or questions this claim.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={statusTone(detailedGroup.status)}>
                      {statusLabel(detailedGroup.status)}
                    </Badge>
                    <span className="text-xs font-semibold text-foreground">{pct(detailedGroup.aggregate_confidence)}</span>
                  </div>
                  <h3 className="mt-3 font-display text-base font-bold text-foreground">
                    {detailedGroup.title || detailedGroup.normalized_claim}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{detailedGroup.normalized_claim}</p>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-muted p-2">
                    <p className="text-lg font-bold text-foreground">{detailedGroup.support_count}</p>
                    <p className="text-[11px] text-muted-foreground">Signals</p>
                  </div>
                  <div className="rounded-xl bg-muted p-2">
                    <p className="text-lg font-bold text-foreground">{detailedGroup.independent_source_count}</p>
                    <p className="text-[11px] text-muted-foreground">Sources</p>
                  </div>
                  <div className="rounded-xl bg-muted p-2">
                    <p className="text-lg font-bold text-foreground">{detailedGroup.evidence_count}</p>
                    <p className="text-[11px] text-muted-foreground">Evidence</p>
                  </div>
                </div>

                <div>
                  <p className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
                    {detailedGroup.status === 'ready'
                      ? `This Signal can become Memory because CRMy found ${detailedGroup.evidence_count} evidence item${detailedGroup.evidence_count === 1 ? '' : 's'} across ${detailedGroup.independent_source_count} source${detailedGroup.independent_source_count === 1 ? '' : 's'}.`
                      : detailedGroup.blocked_reason
                      ? `This Signal is blocked because ${detailedGroup.blocked_reason.toLowerCase()}`
                      : `CRMy found supporting evidence across ${detailedGroup.independent_source_count} source${detailedGroup.independent_source_count === 1 ? '' : 's'} and is still gathering confidence before creating Memory.`}
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source types</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sourceTypes(detailedGroup).length > 0 ? sourceTypes(detailedGroup).map(source => (
                      <span key={source} className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                        {source}
                      </span>
                    )) : (
                      <span className="text-xs text-muted-foreground">No source details available</span>
                    )}
                  </div>
                </div>

                <div id="signal-evidence">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</p>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {((detailedGroup.members ?? []) as any[]).slice(0, 8).map(member => {
                      const entry = member.context_entry ?? {};
                      const evidence = Array.isArray(entry.evidence) ? entry.evidence[0] : null;
                      return (
                        <div key={member.id} className="rounded-xl border border-border bg-surface p-3">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className={`text-xs font-semibold ${member.relation === 'conflicts' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                              {member.relation}
                            </span>
                            <span className="text-xs text-muted-foreground">{pct(entry.confidence)}</span>
                          </div>
                          <p className="text-sm text-foreground">{entry.title || entry.body}</p>
                          {evidence?.snippet && (
                            <p className="mt-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                              {evidence.snippet}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={() => onPromote(detailedGroup.id)}
                    disabled={promote.isPending || detailedGroup.status === 'promoted' || detailedGroup.status === 'dismissed'}
                  >
                    {promote.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                    Promote to Memory
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => onDismiss(detailedGroup.id)}
                    disabled={reject.isPending || detailedGroup.status === 'promoted' || detailedGroup.status === 'dismissed'}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Dismiss
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/handoffs">
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                      Send to Handoff
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => document.getElementById('signal-evidence')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
                  >
                    <Inbox className="mr-1 h-3.5 w-3.5" />
                    View Evidence
                  </Button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
