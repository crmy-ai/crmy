// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import {
  useContextEntriesInfinite,
  useReviewContextEntry,
  useContextTypes,
  useSemanticSearch,
  useContextIngest,
  useContacts,
  useAccounts,
  useOpportunities,
  useUseCases,
} from '@/api/hooks';
import { motion } from 'framer-motion';
import { formatDistanceToNow, isPast } from 'date-fns';
import {
  Library,
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Tag,
  Sparkles,
  FileText,
  Loader2,
  X,
  Plus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';

// ── Helper components ────────────────────────────────────────────────────────

const SUBJECT_TYPES = ['contact', 'account', 'opportunity', 'use_case'] as const;

function ConfidencePill({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const cls = pct >= 80
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    : pct >= 50
    ? 'bg-warning/15 text-warning'
    : 'bg-destructive/15 text-destructive';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>
      {pct}%
    </span>
  );
}

function SimilarityPill({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const label = pct >= 80 ? 'Strong match' : pct >= 50 ? 'Partial match' : 'Weak match';
  const cls   = pct >= 80
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    : pct >= 50
    ? 'bg-warning/15 text-warning'
    : 'bg-muted text-muted-foreground';
  return (
    <span title={`${pct}% similarity`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>
      <Sparkles className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

function ValidUntilBadge({ date }: { date: string | null | undefined }) {
  if (!date) return null;
  const expired = isPast(new Date(date));
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${expired ? 'text-destructive' : 'text-muted-foreground'}`}>
      {expired && <AlertTriangle className="w-3 h-3" />}
      {expired ? 'Expired ' : 'Valid until '}
      {formatDistanceToNow(new Date(date), { addSuffix: true })}
    </span>
  );
}

function subjectTypeLabel(t: string) {
  return t === 'use_case' ? 'Use Case' : t.charAt(0).toUpperCase() + t.slice(1);
}

// ── Entity picker ─────────────────────────────────────────────────────────────

function EntityPicker({
  subjectType,
  selectedId,
  selectedLabel,
  onSelect,
}: {
  subjectType: string;
  selectedId: string;
  selectedLabel: string;
  onSelect: (id: string, name: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const { data: contactsData }  = useContacts({ q: q || undefined, limit: 8 });
  const { data: accountsData }  = useAccounts({ q: q || undefined, limit: 8 });
  const { data: oppsData }      = useOpportunities({ q: q || undefined, limit: 8 });
  const { data: ucData }        = useUseCases({ q: q || undefined, limit: 8 });

  const results = useMemo(() => {
    if (subjectType === 'contact') {
      return (contactsData?.data ?? []).map((c: any) => ({
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '(unknown)',
        sub: c.email,
      }));
    }
    if (subjectType === 'account') {
      return (accountsData?.data ?? []).map((a: any) => ({ id: a.id, name: a.name, sub: a.website }));
    }
    if (subjectType === 'opportunity') {
      return (oppsData?.data ?? []).map((o: any) => ({ id: o.id, name: o.name, sub: o.stage }));
    }
    if (subjectType === 'use_case') {
      return (ucData?.data ?? []).map((u: any) => ({ id: u.id, name: u.name || u.title, sub: u.stage }));
    }
    return [];
  }, [subjectType, contactsData, accountsData, oppsData, ucData]);

  const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  if (selectedId) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-background text-sm flex-1">
        <span className="flex-1 text-foreground truncate">{selectedLabel}</span>
        <button
          type="button"
          onClick={() => { onSelect('', ''); setQ(''); }}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          aria-label="Clear selection"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex-1">
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={`Search ${subjectTypeLabel(subjectType)}…`}
        className={inputCls}
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {results.map((r: any) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={() => { onSelect(r.id, r.name); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
            >
              <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
              {r.sub && <p className="text-xs text-muted-foreground truncate">{r.sub}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SORT_OPTIONS: SortOption[] = [
  { key: 'created_at',       label: 'Date Created' },
  { key: 'confidence_score', label: 'Confidence' },
  { key: 'valid_until',      label: 'Valid Until' },
];

// ── ContextBrowser ────────────────────────────────────────────────────────────

export function ContextBrowser() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialise filters from URL params
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    const st = searchParams.get('subject_type');
    if (st) init.subject_type = [st];
    if (searchParams.get('stale') === 'true') init.validity = ['stale'];
    return init;
  });
  const [q,          setQ]          = useState('');
  const [sort,       setSort]       = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword');

  // Ingest dialog state
  type IngestSubject = { type: string; id: string; label: string };
  const [ingestOpen,     setIngestOpen]     = useState(false);
  const [ingestText,     setIngestText]     = useState('');
  const [ingestSubjects, setIngestSubjects] = useState<IngestSubject[]>([{ type: '', id: '', label: '' }]);
  const [ingestSource,   setIngestSource]   = useState('');
  const [ingesting,      setIngesting]      = useState(false);

  const reviewEntry    = useReviewContextEntry();
  const ingestMutation = useContextIngest();

  // Dynamic context types from registry
  const { data: contextTypesData } = useContextTypes();
  const dynamicContextTypes: string[] = useMemo(() => {
    const types = (contextTypesData as any)?.data ?? [];
    return types.map((t: any) => t.type_name);
  }, [contextTypesData]);
  const FALLBACK_CONTEXT_TYPES = [
    'transcript', 'objection', 'summary', 'research',
    'note', 'action_plan', 'competitor_intel', 'stakeholder_map',
  ];
  const contextTypeOptions = dynamicContextTypes.length > 0 ? dynamicContextTypes : FALLBACK_CONTEXT_TYPES;

  const subjectType = activeFilters.subject_type?.[0] ?? '';
  const contextType = activeFilters.context_type?.[0] ?? '';
  const staleOnly   = activeFilters.validity?.includes('stale') ?? false;

  const filterConfigs: FilterConfig[] = useMemo(() => [
    {
      key: 'subject_type',
      label: 'Subject',
      options: [
        { value: 'contact',     label: 'Contact' },
        { value: 'account',     label: 'Account' },
        { value: 'opportunity', label: 'Opportunity' },
        { value: 'use_case',    label: 'Use Case' },
      ],
    },
    {
      key: 'context_type',
      label: 'Context type',
      options: contextTypeOptions.map(t => ({ value: t, label: t.replace(/_/g, ' ') })),
    },
    {
      key: 'validity',
      label: 'Validity',
      options: [{ value: 'stale', label: 'Stale / Expired' }],
    },
  ], [contextTypeOptions]);

  // Preserve the `tab` param when clearing/changing filters so Workspace's
  // Knowledge tab doesn't get popped back to Overview.
  const preservedSetSearchParams = (updates: Record<string, string>) => {
    const tab = searchParams.get('tab');
    setSearchParams(tab ? { tab, ...updates } : updates);
  };

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      if (values.length === 0) delete next[key];
      else next[key] = values;
      return next;
    });
    preservedSetSearchParams({});
  };

  const handleSortChange = (key: string) => {
    setSort(prev =>
      prev?.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  };

  const clearFilters = () => {
    setActiveFilters({});
    setQ('');
    preservedSetSearchParams({});
  };

  const params = useMemo(() => ({
    subject_type: subjectType || undefined,
    context_type: contextType || undefined,
    is_current:   staleOnly ? false : undefined,
    limit:        20,
  }), [subjectType, contextType, staleOnly]);

  const {
    data: infiniteData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useContextEntriesInfinite(params);
  const entries: any[] = useMemo(
    () => infiniteData?.pages.flatMap((p: any) => p.data ?? []) ?? [],
    [infiniteData],
  );
  const total: number = infiniteData?.pages[0]?.total ?? 0;

  const semanticParams = useMemo(() => ({
    subject_type:  subjectType || undefined,
    context_type:  contextType || undefined,
    current_only:  staleOnly ? false : undefined,
    limit:         50,
  }), [subjectType, contextType, staleOnly]);

  const {
    data: semanticData,
    isLoading: semanticLoading,
    isError: semanticError,
  } = useSemanticSearch(searchMode === 'semantic' ? q : '', semanticParams);
  const semanticEntries: any[] = (semanticData as any)?.entries ?? (semanticData as any)?.data ?? [];

  const filtered = useMemo(() => {
    let items = searchMode === 'semantic' ? semanticEntries : entries;

    if (searchMode === 'keyword' && q.trim()) {
      const lower = q.toLowerCase();
      items = items.filter((e: any) =>
        (e.title ?? '').toLowerCase().includes(lower) ||
        (e.body ?? '').toLowerCase().includes(lower) ||
        (e.tags ?? []).some((t: string) => t.toLowerCase().includes(lower)),
      );
    }

    if (sort) {
      items = [...items].sort((a: any, b: any) => {
        const av = String(a[sort.key] ?? '');
        const bv = String(b[sort.key] ?? '');
        return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    return items;
  }, [entries, semanticEntries, q, searchMode, sort]);

  const isSearching = searchMode === 'keyword' ? isLoading : semanticLoading;
  const hasFilters  = Object.keys(activeFilters).length > 0 || q;

  const handleIngest = useCallback(async () => {
    const validSubjects = ingestSubjects.filter(s => s.type && s.id);
    if (!ingestText.trim() || validSubjects.length === 0) {
      toast({
        title: 'Missing fields',
        description: 'Paste a document and select at least one subject.',
        variant: 'destructive',
      });
      return;
    }
    setIngesting(true);
    try {
      const results = await Promise.all(validSubjects.map(s =>
        ingestMutation.mutateAsync({
          text:         ingestText,
          subject_type: s.type,
          subject_id:   s.id,
          source:       ingestSource || undefined,
        }),
      ));
      const totalExtracted: number = results.reduce((sum: number, r: any) => sum + (r?.extracted_count ?? 0), 0);
      if (totalExtracted > 0) {
        toast({
          title: 'Ingestion complete',
          description: `${totalExtracted} context ${totalExtracted === 1 ? 'entry' : 'entries'} extracted across ${validSubjects.length === 1 ? '1 subject' : `${validSubjects.length} subjects`}.`,
        });
      } else {
        toast({
          title: 'Document saved',
          description: 'No entries were extracted — the Workspace Agent may not be configured, or no extractable context types are defined.',
          variant: 'destructive',
        });
      }
      setIngestOpen(false);
      setIngestText('');
      setIngestSubjects([{ type: '', id: '', label: '' }]);
      setIngestSource('');
    } catch (err) {
      toast({
        title: 'Ingestion failed',
        description: err instanceof Error ? err.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setIngesting(false);
    }
  }, [ingestText, ingestSubjects, ingestSource, ingestMutation]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Search-mode toggle */}
      <div className="px-4 md:px-6 pt-3 pb-0 flex items-center gap-2">
        <div className="flex items-center gap-0.5 bg-muted rounded-xl p-0.5">
          <button
            onClick={() => setSearchMode('keyword')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              searchMode === 'keyword'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Search className="w-3 h-3" />
            Keyword
          </button>
          <button
            onClick={() => setSearchMode('semantic')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              searchMode === 'semantic'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            Semantic
          </button>
        </div>
        {total > 0 && searchMode === 'keyword' && (
          <span className="text-xs text-muted-foreground">{total.toLocaleString()} total</span>
        )}
      </div>

      <ListToolbar
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder={
          searchMode === 'semantic'
            ? 'Ask a question about your context…'
            : 'Search title, body, tags…'
        }
        filters={filterConfigs}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearFilters={clearFilters}
        sortOptions={SORT_OPTIONS}
        currentSort={sort}
        onSortChange={handleSortChange}
        onAdd={() => setIngestOpen(true)}
        addLabel="Import"
        entityType="context"
      />

      {/* Search-mode banner */}
      <motion.div
        key={searchMode}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className={`mx-4 md:mx-6 mt-2 mb-1 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 border ${
          searchMode === 'semantic'
            ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20'
            : 'bg-muted text-muted-foreground border-border'
        }`}
      >
        {searchMode === 'semantic'
          ? <><Sparkles className="w-3.5 h-3.5 flex-shrink-0" /> Semantic search — AI-ranked by meaning, not keywords</>
          : <><Search className="w-3.5 h-3.5 flex-shrink-0" /> Keyword search — matching titles, bodies, and tags</>
        }
      </motion.div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6">

        {/* Semantic unavailable banner */}
        {searchMode === 'semantic' && semanticError && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-4 px-3 py-2 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              Semantic search requires pgvector. Set{' '}
              <code className="px-1 py-0.5 bg-warning/20 rounded">ENABLE_PGVECTOR=true</code>{' '}
              and configure an embedding provider. Falling back to keyword search.
            </span>
          </motion.div>
        )}

        {/* Content */}
        {isSearching ? (
          <div className="text-sm text-muted-foreground py-8 text-center flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {searchMode === 'semantic' ? 'Searching semantically…' : 'Loading…'}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <Library className="w-14 h-14 text-muted-foreground/30 mb-4" />
            <p className="text-base font-display font-semibold text-foreground mb-1">
              {hasFilters ? 'No entries match your filters' : 'No context entries yet'}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {hasFilters
                ? searchMode === 'semantic'
                  ? 'Try rephrasing your question or adjusting filters.'
                  : 'Try adjusting your search or filters.'
                : 'Agents write context entries after every interaction. They power the briefings returned by briefing_get.'}
            </p>
            {hasFilters && (
              <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </motion.div>
        ) : (
          <div className="space-y-2 pt-2">
            {filtered.map((entry: any, i: number) => {
              const expired = entry.valid_until ? isPast(new Date(entry.valid_until)) : false;
              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className={`bg-card border rounded-xl p-4 transition-colors ${
                    expired
                      ? 'border-destructive/30'
                      : searchMode === 'semantic'
                      ? 'border-border border-l-2 border-l-violet-500/50'
                      : 'border-border'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {entry.title && (
                          <span className="text-sm font-semibold text-foreground truncate max-w-xs">
                            {entry.title}
                          </span>
                        )}
                        {entry.context_type && (
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {entry.context_type.replace(/_/g, ' ')}
                          </Badge>
                        )}
                        {entry.subject_type && (
                          <Badge variant="secondary" className="text-[10px]">
                            {subjectTypeLabel(entry.subject_type)}
                          </Badge>
                        )}
                        {entry.is_current === false && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted">
                            superseded
                          </Badge>
                        )}
                        <ConfidencePill value={entry.confidence_score} />
                        {searchMode === 'semantic' && <SimilarityPill value={entry.similarity} />}
                      </div>
                      {entry.body && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{entry.body}</p>
                      )}
                      <div className="flex items-center gap-3 flex-wrap">
                        {entry.tags?.length > 0 && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Tag className="w-3 h-3" />
                            {entry.tags.slice(0, 4).join(', ')}
                            {entry.tags.length > 4 && ` +${entry.tags.length - 4}`}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                        </span>
                        <ValidUntilBadge date={entry.valid_until} />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      {expired && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={() => reviewEntry.mutate(entry.id)}
                          disabled={reviewEntry.isPending}
                        >
                          Mark reviewed
                        </Button>
                      )}
                      {!expired && entry.is_current && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5" />
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
            {searchMode === 'keyword' && hasNextPage && (
              <div className="flex justify-center pt-4 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="gap-2"
                >
                  {isFetchingNextPage && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isFetchingNextPage ? 'Loading…' : `Load more (${total - entries.length} remaining)`}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Import Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={ingestOpen} onOpenChange={setIngestOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#0ea5e9]" />
              Import context
            </DialogTitle>
            <DialogDescription>
              Paste a document (meeting transcript, research notes, etc.) and CRMy will
              auto-extract structured context entries.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="Paste document text here…"
              value={ingestText}
              onChange={(e) => setIngestText(e.target.value)}
              className="min-h-[160px] text-sm"
            />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Subjects <span className="font-normal">(context will be extracted once per subject)</span>
              </p>
              {ingestSubjects.map((subject, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Select
                    value={subject.type}
                    onValueChange={(v) => setIngestSubjects(prev => prev.map((s, i) =>
                      i === idx ? { type: v, id: '', label: '' } : s
                    ))}
                  >
                    <SelectTrigger className="h-9 w-36 flex-shrink-0 text-sm">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBJECT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{subjectTypeLabel(t)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {subject.type ? (
                    <EntityPicker
                      subjectType={subject.type}
                      selectedId={subject.id}
                      selectedLabel={subject.label}
                      onSelect={(id, name) => setIngestSubjects(prev => prev.map((s, i) =>
                        i === idx ? { ...s, id, label: name } : s
                      ))}
                    />
                  ) : (
                    <div className="flex-1 h-9 px-3 rounded-lg border border-border bg-muted/40 text-sm text-muted-foreground flex items-center">
                      Select a type first
                    </div>
                  )}
                  {ingestSubjects.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setIngestSubjects(prev => prev.filter((_, i) => i !== idx))}
                      className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                      aria-label="Remove subject"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              {ingestSubjects.length < 5 && (
                <button
                  type="button"
                  onClick={() => setIngestSubjects(prev => [...prev, { type: '', id: '', label: '' }])}
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add subject
                </button>
              )}
            </div>
            <Input
              placeholder="Source label (optional, e.g. 'Q1 review call')"
              value={ingestSource}
              onChange={(e) => setIngestSource(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIngestOpen(false)}>Cancel</Button>
            <Button onClick={handleIngest} disabled={ingesting} className="gap-1.5">
              {ingesting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Extract &amp; Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
