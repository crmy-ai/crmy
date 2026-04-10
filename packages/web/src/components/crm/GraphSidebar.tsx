// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Tag } from 'lucide-react';
import { TYPE_COLORS, TYPE_DESCRIPTIONS } from './ContextPanel';
import { Sheet, SheetContent } from '@/components/ui/sheet';

// ── Entity colors — match the app's ENTITY_COLORS token system ────────────────

export const ENTITY_HEX: Record<string, string> = {
  contact:     '#f97316',  // primary (orange)
  account:     '#8b5cf6',  // accounts purple
  opportunity: '#0ea5e9',  // accent (sky)
  use_case:    '#22c55e',  // success (green)
};

export const ACTIVITY_COLORS: Record<string, string> = {
  call:          '#f97316',
  email:         '#3b82f6',
  meeting:       '#8b5cf6',
  note:          '#94a3b8',
  task:          '#eab308',
  demo:          '#0ea5e9',
  proposal:      '#14b8a6',
  research:      '#a855f7',
  handoff:       '#ef4444',
  status_update: '#06b6d4',
};

export const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  high:   '#f97316',
  normal: '#3b82f6',
  low:    '#94a3b8',
};

// ── GraphNodeData — carried on every node ─────────────────────────────────────

export interface GraphNodeData {
  nodeType: string;
  label: string;
  color: string;
  subjectType?: string;
  entityType?: string;
  entityId?: string;
  contextType?: string;
  count?: number;
  entries?: Array<{ id: string; title?: string; body: string }>;
  body?: string;
  confidence?: number;
  tags?: string[];
  source?: string;
  createdAt?: string;
  isStale?: boolean;
  activityType?: string;
  subject?: string;
  outcome?: string;
  occurredAt?: string;
  status?: string;
  priority?: string;
  dueAt?: string;
  description?: string;
  isSelected?: boolean;
  [key: string]: unknown;
}

export interface FilterCounts {
  context:     number;
  related:     number;
  activities:  number;
  assignments: number;
}

// ── GraphSidebar ──────────────────────────────────────────────────────────────

interface GraphSidebarProps {
  subjectType:    string;
  subjectName:    string;
  activeFilters:  Set<string>;
  filterCounts:   FilterCounts;
  onFilterChange: (next: Set<string>) => void;
  onFitView:      () => void;
}

export function GraphSidebar({
  subjectType, subjectName,
  activeFilters, filterCounts, onFilterChange, onFitView,
}: GraphSidebarProps) {
  const navigate = useNavigate();
  const entityColor = ENTITY_HEX[subjectType] ?? '#f97316';

  const toggleFilter = (key: string) => {
    const next = new Set(activeFilters);
    if (next.has(key)) { next.delete(key); } else { next.add(key); }
    onFilterChange(next);
  };

  const filterRows = [
    { key: 'context',     label: 'Context',     color: '#8b5cf6', count: filterCounts.context },
    { key: 'related',     label: 'Related',     color: ENTITY_HEX.account, count: filterCounts.related },
    { key: 'activities',  label: 'Activities',  color: '#f97316', count: filterCounts.activities },
    { key: 'assignments', label: 'Assignments', color: '#ef4444', count: filterCounts.assignments },
  ];

  return (
    <div className="w-[220px] flex-shrink-0 flex flex-col border-r border-border bg-card overflow-hidden">

      {/* Entity header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-border">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" /> Back
        </button>
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold"
            style={{ backgroundColor: entityColor + '18', border: `1.5px solid ${entityColor}50`, color: entityColor }}
          >
            {(subjectName || '??').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{subjectName || 'Loading…'}</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
              {subjectType.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex-1 px-3 py-3">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1.5">Show</p>
        <div className="space-y-0.5">
          {filterRows.map(row => (
            <button
              key={row.key}
              onClick={() => toggleFilter(row.key)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all hover:bg-muted/50 ${
                activeFilters.has(row.key) ? 'text-foreground' : 'text-muted-foreground opacity-50'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: activeFilters.has(row.key) ? row.color : row.color + '50' }}
              />
              <span className="flex-1 text-left font-medium">{row.label}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{row.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 p-3 border-t border-border">
        <button
          onClick={onFitView}
          className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 px-3 rounded-lg border border-border hover:bg-muted/50 transition-all"
        >
          Reset view
        </button>
      </div>
    </div>
  );
}

// ── GraphNodeSheet — full detail drawer ───────────────────────────────────────

interface GraphNodeSheetProps {
  node:    GraphNodeData | null;
  onClose: () => void;
  onNodeFocus?: (nodeId: string) => void;
}

export function GraphNodeSheet({ node, onClose, onNodeFocus }: GraphNodeSheetProps) {
  return (
    <Sheet open={!!node} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[420px] sm:max-w-[420px] p-0 flex flex-col overflow-hidden"
      >
        {node && <NodeSheetContent node={node} onNodeFocus={onNodeFocus} />}
      </SheetContent>
    </Sheet>
  );
}

function NodeSheetContent({ node, onNodeFocus }: { node: GraphNodeData; onNodeFocus?: (id: string) => void }) {
  if (node.nodeType === 'clusterNode') {
    const typeColor = TYPE_COLORS[node.contextType ?? ''] ?? node.color;
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: typeColor }} />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Context type</span>
          </div>
          <h2 className="text-xl font-bold text-foreground capitalize">
            {(node.contextType ?? node.label).replace(/_/g, ' ')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {node.count} {node.count === 1 ? 'entry' : 'entries'}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {TYPE_DESCRIPTIONS[node.contextType ?? ''] && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {TYPE_DESCRIPTIONS[node.contextType ?? '']}
            </p>
          )}
          {node.entries && node.entries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Entries</p>
              {node.entries.map(e => (
                <button
                  key={e.id}
                  onClick={() => onNodeFocus?.(`entry-${e.id}`)}
                  className="w-full text-left px-3 py-2.5 rounded-xl border border-border hover:bg-muted/50 transition-colors"
                >
                  <p className="text-sm text-foreground font-medium leading-snug">
                    {e.title || e.body.slice(0, 80)}
                  </p>
                  {e.title && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.body}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (node.nodeType === 'leafNode') {
    const typeColor = TYPE_COLORS[node.contextType ?? ''] ?? node.color;
    const conf = node.confidence != null ? Math.round((node.confidence as number) * 100) : null;
    const confLabel = conf == null ? null : conf >= 80 ? 'Verified' : conf >= 50 ? 'Likely' : 'Uncertain';
    const confClass = conf == null ? '' : conf >= 80 ? 'text-green-500 bg-green-500/10' : conf >= 50 ? 'text-amber-500 bg-amber-500/10' : 'text-muted-foreground bg-muted';
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span
              className="text-xs px-2.5 py-0.5 rounded-full font-semibold capitalize"
              style={{ backgroundColor: typeColor + '20', color: typeColor }}
            >
              {(node.contextType ?? '').replace(/_/g, ' ')}
            </span>
            {confLabel && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${confClass}`}>
                {confLabel} {conf != null && `(${conf}%)`}
              </span>
            )}
            {node.isStale && (
              <span className="text-xs px-2 py-0.5 rounded bg-destructive/15 text-destructive font-semibold">Stale</span>
            )}
          </div>
          {node.label && (
            <h2 className="text-xl font-bold text-foreground leading-snug">{node.label as string}</h2>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {node.body && (
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{node.body as string}</p>
          )}
          {node.tags && (node.tags as string[]).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                <Tag className="w-3 h-3 text-muted-foreground mt-0.5" />
                {(node.tags as string[]).map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">#{t}</span>
                ))}
              </div>
            </div>
          )}
          {(node.source || node.createdAt) && (
            <div className="pt-2 border-t border-border space-y-1">
              {node.source && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Source:</span> {node.source as string}
                </p>
              )}
              {node.createdAt && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Added:</span> {new Date(node.createdAt as string).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (node.nodeType === 'activityNode') {
    const actColor = ACTIVITY_COLORS[node.activityType as string ?? ''] ?? '#94a3b8';
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <div className="mb-2">
            <span
              className="text-xs px-2.5 py-0.5 rounded-full font-semibold capitalize"
              style={{ backgroundColor: actColor + '20', color: actColor }}
            >
              {((node.activityType as string | undefined) ?? 'activity').replace(/_/g, ' ')}
            </span>
          </div>
          <h2 className="text-xl font-bold text-foreground leading-snug">
            {(node.subject as string | undefined) ?? node.label}
          </h2>
          {node.occurredAt && (
            <p className="text-sm text-muted-foreground mt-1">
              {new Date(node.occurredAt as string).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {node.body && (
            <p className="text-sm text-foreground leading-relaxed">{node.body as string}</p>
          )}
          {node.outcome && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Outcome</p>
              <span className="text-sm px-3 py-1.5 rounded-lg bg-muted text-foreground capitalize inline-block">
                {node.outcome as string}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (node.nodeType === 'relatedNode') {
    const relColor = ENTITY_HEX[node.entityType as string ?? ''] ?? '#94a3b8';
    const entityType = node.entityType as string | undefined;
    const entityId   = node.entityId   as string | undefined;
    const path = entityType === 'account'     ? `/accounts/${entityId}`
               : entityType === 'opportunity' ? `/opportunities/${entityId}`
               : `/contacts/${entityId}`;
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: relColor }} />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide capitalize">
              {(entityType ?? '').replace(/_/g, ' ')}
            </span>
          </div>
          <h2 className="text-xl font-bold text-foreground">{node.label}</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {entityId && (
            <Link
              to={path}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border hover:bg-muted/50 text-sm font-medium text-foreground transition-colors"
            >
              Open {(entityType ?? '').replace(/_/g, ' ')} →
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (node.nodeType === 'assignmentNode') {
    const priColor = PRIORITY_COLORS[(node.priority as string | undefined) ?? 'normal'] ?? '#3b82f6';
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
              {node.status as string}
            </span>
            <span
              className="text-xs px-2.5 py-0.5 rounded-full font-semibold capitalize"
              style={{ backgroundColor: priColor + '20', color: priColor }}
            >
              {node.priority as string}
            </span>
          </div>
          <h2 className="text-xl font-bold text-foreground leading-snug">{node.label}</h2>
          {node.dueAt && (
            <p className="text-sm text-muted-foreground mt-1">
              Due {new Date(node.dueAt as string).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {node.description && (
            <p className="text-sm text-foreground leading-relaxed">{node.description as string}</p>
          )}
        </div>
      </div>
    );
  }

  // Fallback (entity center node — shouldn't normally be selected)
  return (
    <div className="px-6 pt-6">
      <h2 className="text-xl font-bold text-foreground">{node.label}</h2>
      <p className="text-sm text-muted-foreground capitalize mt-1">
        {((node.subjectType as string | undefined) ?? '').replace(/_/g, ' ')}
      </p>
    </div>
  );
}
