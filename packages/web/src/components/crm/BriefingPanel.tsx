// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useBriefing } from '@/api/hooks';
import { FileText, ChevronDown, ChevronUp, AlertTriangle, Activity, ClipboardList, Brain, X } from 'lucide-react';

interface BriefingPanelProps {
  subjectType: string;
  subjectId: string;
  onClose: () => void;
}

export function BriefingPanel({ subjectType, subjectId, onClose }: BriefingPanelProps) {
  const [includeStale, setIncludeStale] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading, error } = useBriefing(subjectType, subjectId, { format: 'json', include_stale: includeStale }) as any;

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <BriefingHeader onClose={onClose} />
        <div className="flex-1 p-5 space-y-4 animate-pulse">
          <div className="h-6 bg-muted rounded w-1/2" />
          <div className="h-20 bg-muted rounded" />
          <div className="h-20 bg-muted rounded" />
          <div className="h-20 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <BriefingHeader onClose={onClose} />
        <div className="p-5 text-sm text-destructive">Failed to load briefing.</div>
      </div>
    );
  }

  const briefing = data?.briefing ?? data;

  return (
    <div className="flex flex-col h-full">
      <BriefingHeader onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Staleness warnings */}
        {briefing?.staleness_warnings?.length > 0 && (
          <BriefingSection
            icon={<AlertTriangle className="w-3.5 h-3.5 text-warning" />}
            title="Stale Context"
            defaultOpen
          >
            <div className="space-y-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {briefing.staleness_warnings.map((w: any) => (
                <div key={w.id} className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="w-3 h-3 text-warning flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-foreground">{w.title ?? w.context_type}</span>
                    <span className="text-muted-foreground ml-1.5">
                      expired {w.valid_until ? new Date(w.valid_until).toLocaleDateString() : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </BriefingSection>
        )}

        {/* Activities */}
        {briefing?.activities?.length > 0 && (
          <BriefingSection
            icon={<Activity className="w-3.5 h-3.5 text-primary" />}
            title={`Recent Activities (${briefing.activities.length})`}
            defaultOpen
          >
            <div className="space-y-1.5">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {briefing.activities.slice(0, 10).map((a: any) => (
                <div key={a.id} className="flex items-start gap-2 text-xs">
                  <span className="w-16 flex-shrink-0 text-muted-foreground">
                    {new Date(a.occurred_at ?? a.created_at).toLocaleDateString()}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium capitalize flex-shrink-0">
                    {(a.type ?? a.activity_type ?? '').replace(/_/g, ' ')}
                  </span>
                  <span className="text-foreground truncate">{a.description ?? a.body ?? ''}</span>
                </div>
              ))}
            </div>
          </BriefingSection>
        )}

        {/* Open Assignments */}
        {briefing?.open_assignments?.length > 0 && (
          <BriefingSection
            icon={<ClipboardList className="w-3.5 h-3.5 text-primary" />}
            title={`Open Assignments (${briefing.open_assignments.length})`}
            defaultOpen
          >
            <div className="space-y-1.5">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {briefing.open_assignments.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <StatusBadge status={a.status} />
                  <span className="text-foreground flex-1 truncate">{a.title}</span>
                  <PriorityDot priority={a.priority} />
                </div>
              ))}
            </div>
          </BriefingSection>
        )}

        {/* Context Entries (grouped by type) */}
        {briefing?.context_entries && Object.keys(briefing.context_entries).length > 0 && (
          <BriefingSection
            icon={<Brain className="w-3.5 h-3.5 text-primary" />}
            title="Context"
            defaultOpen
          >
            <div className="space-y-3">
              {Object.entries(briefing.context_entries).map(([type, entries]) => (
                <div key={type}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    {type.replace(/_/g, ' ')}
                  </p>
                  <div className="space-y-1.5">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(entries as any[]).map((c: any) => (
                      <div key={c.id} className="rounded-lg bg-muted/50 p-2">
                        {c.title && <p className="text-xs font-medium text-foreground">{c.title}</p>}
                        <p className="text-[11px] text-muted-foreground line-clamp-2">{c.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </BriefingSection>
        )}

        {/* Toggle stale */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <input
            type="checkbox"
            checked={includeStale}
            onChange={e => setIncludeStale(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-border accent-primary"
          />
          <span className="text-xs text-muted-foreground">Include stale context</span>
        </div>
      </div>
    </div>
  );
}

function BriefingHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
      <FileText className="w-4 h-4 text-primary" />
      <h2 className="font-display font-bold text-foreground flex-1">Briefing</h2>
      <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
        <X className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
  );
}

function BriefingSection({ icon, title, children, defaultOpen = false }: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full p-3 text-left"
      >
        {icon}
        <span className="text-xs font-display font-bold text-foreground flex-1">{title}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: '#f59e0b',
    accepted: '#3b82f6',
    in_progress: '#8b5cf6',
    blocked: '#ef4444',
    completed: '#22c55e',
    declined: '#94a3b8',
    cancelled: '#94a3b8',
  };
  const color = colors[status] ?? '#94a3b8';
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-medium capitalize flex-shrink-0"
      style={{ backgroundColor: color + '18', color }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const colors: Record<string, string> = { urgent: '#ef4444', high: '#f97316', normal: '#3b82f6', low: '#94a3b8' };
  return <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colors[priority] ?? '#94a3b8' }} title={priority} />;
}
