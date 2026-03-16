// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useContextEntries, useReviewContextEntry, useStaleContextEntries } from '@/api/hooks';
import { Brain, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Tag } from 'lucide-react';
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

const TYPE_COLORS: Record<string, string> = {
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

export function ContextPanel({ subjectType, subjectId }: ContextPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [activeType, setActiveType] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contextData, isLoading } = useContextEntries({ subject_type: subjectType, subject_id: subjectId, is_current: true, limit: 50 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staleData } = useStaleContextEntries({ subject_type: subjectType, subject_id: subjectId, limit: 10 }) as any;
  const reviewMutation = useReviewContextEntry();

  const entries: ContextEntry[] = contextData?.data ?? [];
  const staleEntries: ContextEntry[] = staleData?.data ?? [];

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
        <div className="h-16 bg-muted rounded" />
        <div className="h-16 bg-muted rounded" />
      </div>
    );
  }

  if (entries.length === 0 && staleEntries.length === 0) {
    return null;
  }

  return (
    <div className="px-4 mx-4 mt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left mb-2"
      >
        <Brain className="w-3.5 h-3.5 text-primary" />
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide flex-1">
          Context
          <span className="ml-1.5 font-mono font-normal text-muted-foreground/50">({entries.length})</span>
        </h3>
        {staleEntries.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-warning font-medium">
            <AlertTriangle className="w-3 h-3" /> {staleEntries.length} stale
          </span>
        )}
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="space-y-3">
          {/* Type filter tabs */}
          {types.length > 1 && (
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setActiveType(null)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all ${!activeType ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
              >
                All
              </button>
              {types.map(type => (
                <button
                  key={type}
                  onClick={() => setActiveType(activeType === type ? null : type)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all ${activeType === type ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
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
              <p className="text-[10px] font-semibold text-warning uppercase tracking-wide">Needs Review</p>
              {staleEntries.map(entry => (
                <div key={entry.id} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{entry.title ?? entry.context_type}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Expired {entry.valid_until ? new Date(entry.valid_until).toLocaleDateString() : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => handleReview(entry.id)}
                    disabled={reviewMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Review
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Context entries */}
          {displayed.map(entry => {
            const color = TYPE_COLORS[entry.context_type] ?? '#94a3b8';
            const isStale = entry.valid_until && new Date(entry.valid_until) < new Date();
            return (
              <div
                key={entry.id}
                className={`rounded-xl border p-3 space-y-1.5 ${isStale ? 'border-warning/30 bg-warning/5' : 'border-border bg-card'}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize"
                    style={{ backgroundColor: color + '18', color }}
                  >
                    {entry.context_type.replace(/_/g, ' ')}
                  </span>
                  {entry.confidence != null && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {Math.round(entry.confidence * 100)}%
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </span>
                </div>
                {entry.title && (
                  <p className="text-sm font-medium text-foreground">{entry.title}</p>
                )}
                <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                  {entry.body}
                </p>
                {entry.tags && entry.tags.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <Tag className="w-2.5 h-2.5 text-muted-foreground" />
                    {entry.tags.map(tag => (
                      <span key={tag} className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">{tag}</span>
                    ))}
                  </div>
                )}
                {entry.source && (
                  <p className="text-[10px] text-muted-foreground/60">Source: {entry.source}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
