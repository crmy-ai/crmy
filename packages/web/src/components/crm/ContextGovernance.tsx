// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  GitCompareArrows,
  Loader2,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  useAssignContextContradictions,
  useBulkMarkContextStale,
  useContextContradictions,
  useReviewContextBatch,
  useReviewContextEntry,
  useResolveContextContradiction,
  useStaleContextEntries,
} from '@/api/hooks';
import { EntityCombobox, type EntityType } from '@/components/ui/entity-combobox';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { toast } from '@/components/ui/use-toast';

type SubjectType = 'account' | 'contact' | 'opportunity' | 'use_case';

interface ContextEntry {
  id: string;
  subject_type?: SubjectType;
  subject_id?: string;
  context_type: string;
  title?: string;
  body: string;
  confidence?: number;
  valid_until?: string;
  created_at?: string;
}

interface ContradictionWarning {
  entry_a: ContextEntry;
  entry_b: ContextEntry;
  conflict_field: string;
  conflict_evidence: string;
  suggested_action: string;
}

const SUBJECT_OPTIONS: Array<{ value: SubjectType; label: string }> = [
  { value: 'account', label: 'Account' },
  { value: 'contact', label: 'Contact' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'use_case', label: 'Use Case' },
];

function confidence(entry: ContextEntry) {
  return entry.confidence == null ? 'n/a' : `${Math.round(entry.confidence * 100)}%`;
}

function daysStale(entry: ContextEntry) {
  if (!entry.valid_until) return 'No expiry';
  const ms = Date.now() - new Date(entry.valid_until).getTime();
  if (!Number.isFinite(ms)) return 'Expired';
  const days = Math.max(0, Math.floor(ms / 86400000));
  return days === 0 ? 'Expired today' : `${days}d stale`;
}

function entryTitle(entry: ContextEntry) {
  return entry.title || entry.body.slice(0, 96) || entry.id;
}

function normalizeStale(data: any): ContextEntry[] {
  return data?.stale_entries ?? data?.data ?? [];
}

export function ContextGovernance() {
  const staleQ = useStaleContextEntries({ limit: 100 }) as any;
  const reviewOne = useReviewContextEntry();
  const reviewBatch = useReviewContextBatch();
  const markStale = useBulkMarkContextStale();
  const assignContradictions = useAssignContextContradictions();
  const resolveContradiction = useResolveContextContradiction();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subjectType, setSubjectType] = useState<SubjectType>('account');
  const [subjectId, setSubjectId] = useState('');
  const [contextType, setContextType] = useState('');
  const [resolutionNote, setResolutionNote] = useState('Verified during context governance review.');
  const [markIds, setMarkIds] = useState('');
  const [markReason, setMarkReason] = useState('');
  const [stalePage, setStalePage] = useState(1);
  const [stalePageSize, setStalePageSize] = useState(25);

  const staleEntries = normalizeStale(staleQ.data);
  const contradictionQ = useContextContradictions({
    subject_type: subjectType,
    subject_id: subjectId,
    context_type: contextType || undefined,
  }) as any;
  const warnings: ContradictionWarning[] = contradictionQ.data?.contradiction_warnings ?? [];
  const paginatedStaleEntries = staleEntries.slice((stalePage - 1) * stalePageSize, stalePage * stalePageSize);

  useEffect(() => { setStalePage(1); }, [staleEntries.length]);

  const stats = useMemo(() => {
    const byType = new Map<string, number>();
    for (const entry of staleEntries) byType.set(entry.context_type, (byType.get(entry.context_type) ?? 0) + 1);
    return {
      total: staleEntries.length,
      selected: selected.size,
      noisyTypes: [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  }, [staleEntries, selected.size]);

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(staleEntries.map(e => e.id)));
  const clearSelection = () => setSelected(new Set());

  const reviewSelected = async (extendDays: number) => {
    if (selected.size === 0) return;
    try {
      await reviewBatch.mutateAsync({ entry_ids: [...selected], extend_days: extendDays });
      toast({ title: 'Context reviewed', description: `${selected.size} entries extended ${extendDays} days.` });
      clearSelection();
    } catch (err) {
      toast({ title: 'Review failed', description: err instanceof Error ? err.message : 'Could not review entries.', variant: 'destructive' });
    }
  };

  const reviewSingle = async (id: string) => {
    try {
      await reviewOne.mutateAsync({ id, extend_days: 30 });
      toast({ title: 'Entry reviewed', description: 'The entry was marked current for another 30 days.' });
      setSelected(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      toast({ title: 'Review failed', description: err instanceof Error ? err.message : 'Could not review entry.', variant: 'destructive' });
    }
  };

  const markExplicitIdsStale = async () => {
    const entryIds = markIds.split(/[\s,]+/).map(v => v.trim()).filter(Boolean);
    if (entryIds.length === 0) return;
    try {
      await markStale.mutateAsync({ entry_ids: entryIds, reason: markReason.trim() || undefined });
      toast({ title: 'Entries marked stale', description: `${entryIds.length} entries queued for reverification.` });
      setMarkIds('');
      setMarkReason('');
    } catch (err) {
      toast({ title: 'Mark stale failed', description: err instanceof Error ? err.message : 'Could not mark entries stale.', variant: 'destructive' });
    }
  };

  const assignReviews = async () => {
    if (!subjectId) return;
    try {
      await assignContradictions.mutateAsync({
        subject_type: subjectType,
        subject_id: subjectId,
        context_type: contextType || undefined,
        limit: 20,
      });
      toast({ title: 'Review assignments created', description: 'Contradictions were routed for human review.' });
    } catch (err) {
      toast({ title: 'Assignment failed', description: err instanceof Error ? err.message : 'Could not create review assignments.', variant: 'destructive' });
    }
  };

  const resolve = async (warning: ContradictionWarning, keep: 'a' | 'b') => {
    const keepEntry = keep === 'a' ? warning.entry_a : warning.entry_b;
    const dropEntry = keep === 'a' ? warning.entry_b : warning.entry_a;
    try {
      await resolveContradiction.mutateAsync({
        keep_entry_id: keepEntry.id,
        supersede_entry_id: dropEntry.id,
        resolution_note: resolutionNote.trim() || 'Resolved from context governance queue.',
      });
      toast({ title: 'Contradiction resolved', description: 'The superseded entry is no longer current.' });
    } catch (err) {
      toast({ title: 'Resolution failed', description: err instanceof Error ? err.message : 'Could not resolve contradiction.', variant: 'destructive' });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-10 space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-4">
        <StatCard icon={<AlertTriangle className="w-4 h-4" />} label="Stale context" value={stats.total} tone={stats.total > 0 ? 'warning' : 'normal'} />
        <StatCard icon={<ClipboardCheck className="w-4 h-4" />} label="Selected for review" value={stats.selected} />
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Noisiest stale types</p>
          {stats.noisyTypes.length === 0 ? (
            <p className="text-sm text-foreground">All current</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {stats.noisyTypes.map(([type, count]) => (
                <span key={type} className="px-2 py-1 rounded-lg bg-muted text-xs text-foreground">{type} · {count}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Stale Review Queue</p>
            <p className="text-xs text-muted-foreground">Reconfirm context before agents rely on it.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={selectAll} disabled={staleEntries.length === 0} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-muted/50 disabled:opacity-40">Select all</button>
            <button onClick={() => reviewSelected(30)} disabled={selected.size === 0 || reviewBatch.isPending} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40">Review 30d</button>
            <button onClick={() => reviewSelected(90)} disabled={selected.size === 0 || reviewBatch.isPending} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40">Review 90d</button>
          </div>
        </div>
        {staleQ.isLoading ? (
          <LoadingRow />
        ) : staleEntries.length === 0 ? (
          <EmptyQueue title="No stale context" subtitle="Current customer memory is inside its validity window." />
        ) : (
          <div className="divide-y divide-border">
	            {paginatedStaleEntries.map(entry => (
	              <div key={entry.id} className="p-4 flex gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(entry.id)}
                  onChange={() => toggleSelected(entry.id)}
                  className="mt-1 h-4 w-4 rounded border-border"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="px-2 py-0.5 rounded-full bg-muted text-xs font-mono text-muted-foreground">{entry.context_type}</span>
                    <span className="text-xs text-amber-600">{daysStale(entry)}</span>
                    <span className="text-xs text-muted-foreground">confidence {confidence(entry)}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{entryTitle(entry)}</p>
	                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{entry.body}</p>
                  <p className="text-[11px] text-muted-foreground font-mono mt-2">{entry.subject_type ?? 'record'}:{entry.subject_id ?? 'unknown'} · {entry.id}</p>
                </div>
                <button
                  onClick={() => reviewSingle(entry.id)}
                  disabled={reviewOne.isPending}
                  className="h-8 px-3 rounded-lg border border-success/30 text-success text-xs font-semibold hover:bg-success/10 disabled:opacity-40"
                >
                  Review
                </button>
	              </div>
	            ))}
	            <div className="px-4 pb-3">
	              <PaginationBar page={stalePage} pageSize={stalePageSize} total={staleEntries.length} onPageChange={setStalePage} onPageSizeChange={setStalePageSize} />
	            </div>
	          </div>
	        )}
      </section>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Contradiction Scanner</p>
          <p className="text-xs text-muted-foreground">Scan a customer object for conflicting current context and resolve or assign review.</p>
        </div>
        <div className="p-4 grid grid-cols-1 lg:grid-cols-[160px_1fr_220px_auto] gap-3 items-end">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Object type</span>
            <select value={subjectType} onChange={e => { setSubjectType(e.target.value as SubjectType); setSubjectId(''); }} className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground">
              {SUBJECT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Object</span>
            <EntityCombobox entityType={subjectType as EntityType} value={subjectId} onChange={setSubjectId} placeholder={`Select ${subjectType.replace('_', ' ')}`} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Context type</span>
            <input value={contextType} onChange={e => setContextType(e.target.value)} placeholder="Optional" className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground" />
          </label>
          <button onClick={() => contradictionQ.refetch()} disabled={!subjectId || contradictionQ.isFetching} className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 flex items-center gap-2 justify-center">
            {contradictionQ.isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Scan
          </button>
        </div>
        {subjectId && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
              <input value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-xs text-foreground" />
              <button onClick={assignReviews} disabled={warnings.length === 0 || assignContradictions.isPending} className="h-9 px-3 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted/50 disabled:opacity-40">
                Assign review
              </button>
            </div>
            {contradictionQ.isLoading ? (
              <LoadingRow />
            ) : warnings.length === 0 ? (
              <EmptyQueue title="No contradictions found" subtitle="Current context for this object is internally consistent." />
            ) : (
              <div className="space-y-3">
                {warnings.map((warning, index) => (
                  <ContradictionCard
                    key={`${warning.entry_a.id}:${warning.entry_b.id}:${index}`}
                    warning={warning}
                    onKeepA={() => resolve(warning, 'a')}
                    onKeepB={() => resolve(warning, 'b')}
                    resolving={resolveContradiction.isPending}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground mb-1">Mark Known-Bad Context Stale</p>
        <p className="text-xs text-muted-foreground mb-3">Paste entry IDs when a source event invalidates existing memory.</p>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px_auto] gap-3 items-end">
          <textarea value={markIds} onChange={e => setMarkIds(e.target.value)} rows={3} placeholder="Entry IDs separated by spaces, commas, or new lines" className="w-full px-3 py-2 rounded-md border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground resize-none" />
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Reason</span>
            <input value={markReason} onChange={e => setMarkReason(e.target.value)} placeholder="e.g. Contact changed roles" className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground" />
          </label>
          <button onClick={markExplicitIdsStale} disabled={!markIds.trim() || markStale.isPending} className="h-10 px-3 rounded-lg border border-amber-500/30 text-amber-600 text-xs font-semibold hover:bg-amber-500/10 disabled:opacity-40">Mark stale</button>
        </div>
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, tone = 'normal' }: { icon: ReactNode; label: string; value: number; tone?: 'normal' | 'warning' }) {
  const toneClass = tone === 'warning' ? 'text-amber-600 bg-amber-500/10' : 'text-primary bg-primary/10';
  return (
    <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${toneClass}`}>{icon}</span>
      <div>
        <p className="text-xl font-semibold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="p-8 flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyQueue({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="p-8 text-center">
      <CheckCircle2 className="w-7 h-7 text-success mx-auto mb-2" />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}

function ContradictionCard({
  warning,
  onKeepA,
  onKeepB,
  resolving,
}: {
  warning: ContradictionWarning;
  onKeepA: () => void;
  onKeepB: () => void;
  resolving: boolean;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-start gap-2">
        <GitCompareArrows className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-foreground">{warning.conflict_field}</p>
          <p className="text-xs text-muted-foreground">{warning.conflict_evidence}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
        <EntryResolutionPanel label="Entry A" entry={warning.entry_a} onKeep={onKeepA} resolving={resolving} />
        <EntryResolutionPanel label="Entry B" entry={warning.entry_b} onKeep={onKeepB} resolving={resolving} />
      </div>
      <div className="px-3 py-2 bg-muted/10 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldAlert className="w-3.5 h-3.5" />
        Suggested action: {warning.suggested_action.replace(/_/g, ' ')}
      </div>
    </div>
  );
}

function EntryResolutionPanel({ label, entry, onKeep, resolving }: { label: string; entry: ContextEntry; onKeep: () => void; resolving: boolean }) {
  return (
    <div className="p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{confidence(entry)}</span>
      </div>
      <p className="text-sm font-medium text-foreground">{entryTitle(entry)}</p>
      <p className="text-xs text-muted-foreground line-clamp-3 mt-1">{entry.body}</p>
      <p className="text-[11px] text-muted-foreground font-mono mt-2 truncate">{entry.id}</p>
      <button onClick={onKeep} disabled={resolving} className="mt-3 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40">Keep this</button>
    </div>
  );
}
