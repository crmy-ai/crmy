// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useContextEntries, useStaleContextEntries, useReviewContextEntry, useContextTypes, useSemanticSearch, useContextIngest } from '@/api/hooks';
import { motion, AnimatePresence } from 'framer-motion';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import {
  Library,
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Tag,
  Filter,
  X,
  Sparkles,
  Upload,
  FileText,
  Loader2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const SUBJECT_TYPES = ['contact', 'account', 'opportunity', 'use_case'] as const;

function ConfidencePill({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const cls = pct >= 80 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    : pct >= 50 ? 'bg-warning/15 text-warning'
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
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/15 text-violet-600 dark:text-violet-400">
      <Sparkles className="w-2.5 h-2.5" />
      {pct}%
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

export default function ContextPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [subjectType, setSubjectType] = useState<string>(searchParams.get('subject_type') ?? '');
  const [contextType, setContextType] = useState('');
  const [staleOnly, setStaleOnly] = useState(searchParams.get('stale') === 'true');
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword');
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestText, setIngestText] = useState('');
  const [ingestSubjectType, setIngestSubjectType] = useState('');
  const [ingestSubjectId, setIngestSubjectId] = useState('');
  const [ingestSource, setIngestSource] = useState('');

  const reviewEntry = useReviewContextEntry();
  const ingestMutation = useContextIngest();

  // Dynamic context types from registry
  const { data: contextTypesData } = useContextTypes();
  const dynamicContextTypes: string[] = useMemo(() => {
    const types = (contextTypesData as any)?.data ?? [];
    return types.map((t: any) => t.type_name);
  }, [contextTypesData]);
  const FALLBACK_CONTEXT_TYPES = ['transcript', 'objection', 'summary', 'research', 'note', 'action_plan', 'competitor_intel', 'stakeholder_map'];
  const contextTypeOptions = dynamicContextTypes.length > 0 ? dynamicContextTypes : FALLBACK_CONTEXT_TYPES;

  const params = useMemo(() => ({
    subject_type: subjectType || undefined,
    context_type: contextType || undefined,
    is_current: staleOnly ? false : undefined,
    limit: 50,
  }), [subjectType, contextType, staleOnly]);

  const { data, isLoading, refetch } = useContextEntries(params) as any;
  const entries: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;

  // Semantic search query
  const semanticParams = useMemo(() => ({
    subject_type: subjectType || undefined,
    context_type: contextType || undefined,
    current_only: staleOnly ? false : undefined,
    limit: 50,
  }), [subjectType, contextType, staleOnly]);
  const { data: semanticData, isLoading: semanticLoading, isError: semanticError } = useSemanticSearch(
    searchMode === 'semantic' ? q : '',
    semanticParams,
  );
  const semanticEntries: any[] = (semanticData as any)?.entries ?? (semanticData as any)?.data ?? [];
  const semanticUnavailable = semanticError;

  // Local text filter for keyword mode
  const filtered = useMemo(() => {
    if (searchMode === 'semantic') return semanticEntries;
    if (!q.trim()) return entries;
    const lower = q.toLowerCase();
    return entries.filter((e: any) =>
      (e.title ?? '').toLowerCase().includes(lower) ||
      (e.body ?? '').toLowerCase().includes(lower) ||
      (e.tags ?? []).some((t: string) => t.toLowerCase().includes(lower))
    );
  }, [entries, semanticEntries, q, searchMode]);

  const isSearching = searchMode === 'keyword' ? isLoading : semanticLoading;

  function clearFilters() {
    setSubjectType('');
    setContextType('');
    setStaleOnly(false);
    setQ('');
    setSearchParams({});
  }

  const hasFilters = subjectType || contextType || staleOnly || q;

  const handleIngest = useCallback(async () => {
    if (!ingestText.trim() || !ingestSubjectType || !ingestSubjectId) {
      toast({ title: 'Missing fields', description: 'Text, subject type, and subject ID are required.', variant: 'destructive' });
      return;
    }
    try {
      await ingestMutation.mutateAsync({
        text: ingestText,
        subject_type: ingestSubjectType,
        subject_id: ingestSubjectId,
        source: ingestSource || undefined,
      });
      toast({ title: 'Ingestion complete', description: 'Context entries extracted and saved.' });
      setIngestOpen(false);
      setIngestText('');
      setIngestSubjectType('');
      setIngestSubjectId('');
      setIngestSource('');
    } catch (err) {
      toast({ title: 'Ingestion failed', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    }
  }, [ingestText, ingestSubjectType, ingestSubjectId, ingestSource, ingestMutation]);

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Context"
        icon={Library}
        iconClassName="text-[#0ea5e9]"
        description="Structured memory written by agents after every interaction. Used to power briefings."
        badge={total > 0 && searchMode === 'keyword' ? (
          <span className="text-xs text-muted-foreground">{total.toLocaleString()} total</span>
        ) : undefined}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">

        {/* Filters */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }} className="flex flex-wrap gap-2 mb-4">
          {/* Search mode toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden h-8">
            <button
              className={`px-3 text-xs font-medium transition-colors flex items-center gap-1.5 ${searchMode === 'keyword' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
              onClick={() => setSearchMode('keyword')}
            >
              <Search className="w-3 h-3" />
              Keyword
            </button>
            <button
              className={`px-3 text-xs font-medium transition-colors flex items-center gap-1.5 border-l border-border ${searchMode === 'semantic' ? 'bg-violet-600 text-white' : 'bg-background text-muted-foreground hover:text-foreground'}`}
              onClick={() => setSearchMode('semantic')}
            >
              <Sparkles className="w-3 h-3" />
              Semantic
            </button>
          </div>

          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={searchMode === 'semantic' ? 'Ask a question about your context…' : 'Search title, body, tags…'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>

          <Select value={subjectType || '__all__'} onValueChange={(v) => setSubjectType(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-8 w-[140px] text-sm">
              <SelectValue placeholder="Subject type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All subjects</SelectItem>
              {SUBJECT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{subjectTypeLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={contextType || '__all__'} onValueChange={(v) => setContextType(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-8 w-[150px] text-sm">
              <SelectValue placeholder="Context type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {contextTypeOptions.map((t) => (
                <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={staleOnly ? 'destructive' : 'outline'}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setStaleOnly(!staleOnly)}
          >
            <AlertTriangle className="w-3 h-3" />
            Stale only
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setIngestOpen(true)}
          >
            <Upload className="w-3 h-3" />
            Import
          </Button>

          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={clearFilters}>
              <X className="w-3 h-3" />
              Clear
            </Button>
          )}
        </motion.div>

        {/* Semantic search unavailable banner */}
        {searchMode === 'semantic' && semanticUnavailable && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4 px-3 py-2 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>Semantic search requires pgvector. Set <code className="px-1 py-0.5 bg-warning/20 rounded">ENABLE_PGVECTOR=true</code> and configure an embedding provider. Falling back to keyword search.</span>
          </motion.div>
        )}

        {/* Content */}
        {isSearching ? (
          <div className="text-sm text-muted-foreground py-8 text-center flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {searchMode === 'semantic' ? 'Searching semantically…' : 'Loading…'}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20 text-center">
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
          <div className="space-y-2">
            {filtered.map((entry: any, i: number) => {
              const expired = entry.valid_until ? isPast(new Date(entry.valid_until)) : false;
              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className={`bg-card border rounded-xl p-4 transition-colors ${expired ? 'border-destructive/30' : 'border-border'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Title row */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {entry.title && (
                          <span className="text-sm font-semibold text-foreground truncate max-w-xs">{entry.title}</span>
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

                      {/* Body preview */}
                      {entry.body && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{entry.body}</p>
                      )}

                      {/* Tags + metadata */}
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

                    {/* Actions */}
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
          </div>
        )}
      </div>

      {/* Ingest Dialog */}
      <Dialog open={ingestOpen} onOpenChange={setIngestOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#0ea5e9]" />
              Import context
            </DialogTitle>
            <DialogDescription>
              Paste a document (meeting transcript, research notes, etc.) and CRMy will auto-extract structured context entries.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="Paste document text here…"
              value={ingestText}
              onChange={(e) => setIngestText(e.target.value)}
              className="min-h-[160px] text-sm"
            />
            <div className="flex gap-2">
              <Select value={ingestSubjectType} onValueChange={setIngestSubjectType}>
                <SelectTrigger className="h-9 flex-1 text-sm">
                  <SelectValue placeholder="Subject type" />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{subjectTypeLabel(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Subject ID (UUID)"
                value={ingestSubjectId}
                onChange={(e) => setIngestSubjectId(e.target.value)}
                className="h-9 flex-1 text-sm"
              />
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
            <Button onClick={handleIngest} disabled={ingestMutation.isPending} className="gap-1.5">
              {ingestMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Extract & Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
