// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useContextEntries, useStaleContextEntries, useReviewContextEntry } from '@/api/hooks';
import { motion } from 'framer-motion';
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
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const SUBJECT_TYPES = ['contact', 'account', 'opportunity', 'use_case'] as const;
const CONTEXT_TYPES = ['transcript', 'objection', 'summary', 'research', 'note', 'action_plan', 'competitor_intel', 'stakeholder_map'] as const;

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

  const reviewEntry = useReviewContextEntry();

  const params = useMemo(() => ({
    subject_type: subjectType || undefined,
    context_type: contextType || undefined,
    is_current: staleOnly ? false : undefined,
    limit: 50,
  }), [subjectType, contextType, staleOnly]);

  const { data, isLoading, refetch } = useContextEntries(params) as any;
  const entries: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;

  // Local text filter on top of API results
  const filtered = useMemo(() => {
    if (!q.trim()) return entries;
    const lower = q.toLowerCase();
    return entries.filter((e: any) =>
      (e.title ?? '').toLowerCase().includes(lower) ||
      (e.body ?? '').toLowerCase().includes(lower) ||
      (e.tags ?? []).some((t: string) => t.toLowerCase().includes(lower))
    );
  }, [entries, q]);

  function clearFilters() {
    setSubjectType('');
    setContextType('');
    setStaleOnly(false);
    setQ('');
    setSearchParams({});
  }

  const hasFilters = subjectType || contextType || staleOnly || q;

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Context" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Library className="w-5 h-5 text-[#0ea5e9]" />
            <h1 className="text-xl font-display font-bold text-foreground">Context entries</h1>
            {total > 0 && (
              <span className="text-xs text-muted-foreground ml-1">
                {total.toLocaleString()} total
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Structured memory written by agents after every interaction. Used to power briefings.
          </p>
        </motion.div>

        {/* Filters */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }} className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search title, body, tags…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>

          <Select value={subjectType} onValueChange={setSubjectType}>
            <SelectTrigger className="h-8 w-[140px] text-sm">
              <SelectValue placeholder="Subject type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All subjects</SelectItem>
              {SUBJECT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{subjectTypeLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={contextType} onValueChange={setContextType}>
            <SelectTrigger className="h-8 w-[150px] text-sm">
              <SelectValue placeholder="Context type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All types</SelectItem>
              {CONTEXT_TYPES.map((t) => (
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

          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={clearFilters}>
              <X className="w-3 h-3" />
              Clear
            </Button>
          )}
        </motion.div>

        {/* Content */}
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20 text-center">
            <Library className="w-14 h-14 text-muted-foreground/30 mb-4" />
            <p className="text-base font-display font-semibold text-foreground mb-1">
              {hasFilters ? 'No entries match your filters' : 'No context entries yet'}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {hasFilters
                ? 'Try adjusting your search or filters.'
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
    </div>
  );
}
