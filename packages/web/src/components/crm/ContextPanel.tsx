// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useContextEntries, useReviewContextEntry, useStaleContextEntries, useConsolidateContext } from '@/api/hooks';
import { Brain, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Tag, Layers, Loader2, SquareCheck, Square } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

interface ContextPanelProps {
  subjectType: string;
  subjectId: string;
}

interface ContextEntry {
  id: string;
  context_type: string;
  title?: string;
  body: string;
  confidence?: number;
  source?: string;
  tags?: string[];
  is_current: boolean;
  valid_until?: string;
  reviewed_at?: string;
  created_at: string;
}

export const TYPE_COLORS: Record<string, string> = {
  note: '#6366f1',
  research: '#8b5cf6',
  preference: '#ec4899',
  objection: '#ef4444',
  competitive_intel: '#f97316',
  relationship_map: '#14b8a6',
  meeting_notes: '#3b82f6',
  summary: '#06b6d4',
  transcript: '#64748b',
  agent_reasoning: '#a855f7',
};

export const TYPE_DESCRIPTIONS: Record<string, string> = {
  note: 'Manual note added by a user or agent',
  research: 'Background research about this contact or account',
  preference: 'Known preferences — communication style, product focus, etc.',
  objection: 'Stated blockers or objections during the sales process',
  competitive_intel: 'Insights about competing vendors or alternatives under evaluation',
  relationship_map: 'Org chart details, key stakeholders, and internal dynamics',
  meeting_notes: 'Notes captured during a call or meeting',
  summary: 'AI-generated or manual summary of interactions',
  transcript: 'Verbatim or edited call/meeting transcript',
  agent_reasoning: 'Reasoning trace captured by an AI agent during a task',
};

export function ContextPanel({ subjectType, subjectId }: ContextPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contextData, isLoading, isError } = useContextEntries({ subject_type: subjectType, subject_id: subjectId, is_current: true, limit: 50 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staleData } = useStaleContextEntries({ subject_type: subjectType, subject_id: subjectId, limit: 10 }) as any;
  const reviewMutation = useReviewContextEntry();
  const consolidate = useConsolidateContext();

  const entries: ContextEntry[] = contextData?.data ?? [];
  const staleEntries: ContextEntry[] = staleData?.data ?? [];

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleConsolidate = async () => {
    const selectedEntries = entries.filter(e => selected.has(e.id));
    const types = [...new Set(selectedEntries.map(e => e.context_type))];
    if (types.length !== 1) {
      toast({ title: 'Select entries of the same type to consolidate', variant: 'destructive' });
      return;
    }
    try {
      await consolidate.mutateAsync({
        subject_type: subjectType,
        subject_id: subjectId,
        context_type: types[0],
        entry_ids: [...selected],
      });
      setSelected(new Set());
      setSelectMode(false);
      toast({ title: 'Entries consolidated', description: 'A new consolidated entry has been created.' });
    } catch {
      toast({ title: 'Consolidation failed', variant: 'destructive' });
    }
  };

  // Group entries by context_type
  const grouped = entries.reduce<Record<string, ContextEntry[]>>((acc, entry) => {
    const type = entry.context_type ?? 'note';
    if (!acc[type]) acc[type] = [];
    acc[type].push(entry);
    return acc;
  }, {});

  const types = Object.keys(grouped).sort();
  const displayed = activeType ? (grouped[activeType] ?? []) : entries;

  const handleReview = async (id: string) => {
    await reviewMutation.mutateAsync(id);
    toast({ title: 'Context entry reviewed' });
  };

  if (isLoading) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3" />
        <div className="h-20 bg-muted rounded" />
        <div className="h-20 bg-muted rounded" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="px-4 mx-4 mt-4">
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Could not load context entries. Check your connection and try refreshing.</span>
        </div>
      </div>
    );
  }

  if (entries.length === 0 && staleEntries.length === 0) {
    return null;
  }

  return (
    <div className="px-4 mx-4 mt-4">
      <div className="flex items-center gap-1.5 mb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 flex-1 text-left"
        >
          <Brain className="w-3.5 h-3.5 text-primary" />
          <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide flex-1">
            Context
            <span className="ml-1.5 font-mono font-normal text-muted-foreground/50">({entries.length})</span>
          </h3>
        </button>
        {staleEntries.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-warning font-medium">
            <AlertTriangle className="w-3 h-3" /> {staleEntries.length} stale
          </span>
        )}
        {entries.length >= 2 && (
          <button
            onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}
            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border transition-colors ${
              selectMode ? 'bg-primary/10 text-primary border-primary/30' : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <Layers className="w-3 h-3" />
            {selectMode ? 'Cancel' : 'Consolidate'}
          </button>
        )}
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        }
      </div>

      {expanded && (
        <div className="space-y-3">
          {/* Type filter tabs */}
          {types.length > 1 && (
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setActiveType(null)}
                className={`px-2 py-0.5 rounded-md text-xs font-semibold transition-all ${!activeType ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
              >
                All
              </button>
              {types.map(type => (
                <button
                  key={type}
                  onClick={() => setActiveType(activeType === type ? null : type)}
                  className={`px-2 py-0.5 rounded-md text-xs font-semibold transition-all ${activeType === type ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                >
                  {type.replace(/_/g, ' ')}
                  <span className="ml-1 opacity-50">{grouped[type].length}</span>
                </button>
              ))}
            </div>
          )}

          {/* Stale warnings */}
          {staleEntries.length > 0 && !activeType && (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 space-y-2">
              <p className="text-xs font-semibold text-warning uppercase tracking-wide">Needs Review</p>
              {staleEntries.map(entry => (
                <div key={entry.id} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{entry.title ?? entry.context_type}</p>
                    <p className="text-xs text-muted-foreground">
                      Expired {entry.valid_until ? new Date(entry.valid_until).toLocaleDateString() : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => handleReview(entry.id)}
                    disabled={reviewMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Review
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Consolidation toolbar */}
          {selectMode && (
            <div className="flex items-center gap-2 p-2 rounded-lg border border-primary/30 bg-primary/5">
              <span className="text-xs text-muted-foreground flex-1">
                {selected.size === 0
                  ? 'Select 2+ entries of the same type to consolidate'
                  : `${selected.size} selected`}
              </span>
              {selected.size >= 2 && (
                <button
                  onClick={handleConsolidate}
                  disabled={consolidate.isPending}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40"
                >
                  {consolidate.isPending
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Layers className="w-3 h-3" />
                  }
                  {consolidate.isPending ? 'Consolidating…' : 'Consolidate'}
                </button>
              )}
            </div>
          )}

          {/* Context entries */}
          {displayed.map(entry => {
            const color = TYPE_COLORS[entry.context_type] ?? '#94a3b8';
            const isStale = entry.valid_until && new Date(entry.valid_until) < new Date();
            const isSelected = selected.has(entry.id);
            return (
              <div
                key={entry.id}
                onClick={selectMode ? () => toggleSelect(entry.id) : undefined}
                className={`rounded-xl border p-3.5 space-y-2 ${
                  selectMode ? 'cursor-pointer' : ''
                } ${
                  isSelected ? 'border-primary/50 bg-primary/5' : isStale ? 'border-warning/30 bg-warning/5' : 'border-border bg-card'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {selectMode && (
                    <span className="text-primary shrink-0">
                      {isSelected ? <SquareCheck className="w-4 h-4" /> : <Square className="w-4 h-4 text-muted-foreground" />}
                    </span>
                  )}
                  <span
                    className="px-2 py-0.5 rounded text-xs font-semibold capitalize cursor-help"
                    style={{ backgroundColor: color + '18', color }}
                    title={TYPE_DESCRIPTIONS[entry.context_type] ?? entry.context_type.replace(/_/g, ' ')}
                  >
                    {entry.context_type.replace(/_/g, ' ')}
                  </span>
                  {entry.confidence != null && (
                    <span
                      title={`${Math.round(entry.confidence * 100)}% confidence`}
                      className={`text-xs font-semibold px-1.5 py-0.5 rounded cursor-help ${
                        entry.confidence >= 0.8
                          ? 'text-green-500 bg-green-500/10'
                          : entry.confidence >= 0.5
                            ? 'text-amber-500 bg-amber-500/10'
                            : 'text-muted-foreground bg-muted'
                      }`}
                    >
                      {entry.confidence >= 0.8 ? 'Verified' : entry.confidence >= 0.5 ? 'Likely' : 'Uncertain'}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </span>
                </div>
                {entry.title && (
                  <p className="text-sm font-medium text-foreground">{entry.title}</p>
                )}
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {entry.body}
                </p>
                {entry.tags && entry.tags.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Tag className="w-3 h-3 text-muted-foreground" />
                    {entry.tags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">#{tag}</span>
                    ))}
                  </div>
                )}
                {entry.source && (
                  <p className="text-xs text-muted-foreground/70 flex items-center gap-1">
                    {entry.source === 'consolidation' && <Layers className="w-3 h-3 text-primary" />}
                    {entry.source === 'consolidation' ? 'Consolidated entry' : `Source: ${entry.source}`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
