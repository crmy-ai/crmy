// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { useEvents } from '@/api/hooks';
import {
  ScrollText, Filter, X, ChevronDown, ChevronUp, Bot, User as UserIcon,
  Cpu, Clock, RefreshCw, Search,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CrmyEvent {
  id: number;
  event_type: string;
  actor_id?: string;
  actor_type: 'user' | 'agent' | 'system';
  object_type: string;
  object_id?: string;
  before_data?: unknown;
  after_data?: unknown;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_display_name?: string;
  actor_agent_model?: string;
  actor_agent_identifier?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTOR_TYPE_CONFIG = {
  user:   { label: 'User',   icon: UserIcon, cls: 'text-primary bg-primary/10 border-primary/20' },
  agent:  { label: 'Agent',  icon: Bot,      cls: 'text-violet-500 bg-violet-500/10 border-violet-500/20' },
  system: { label: 'System', icon: Cpu,      cls: 'text-muted-foreground bg-muted border-border' },
} as const;

const EVENT_TYPE_COLORS: Record<string, string> = {
  created:     'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  updated:     'text-blue-500 bg-blue-500/10 border-blue-500/20',
  deleted:     'text-destructive bg-destructive/10 border-destructive/20',
  completed:   'text-emerald-600 bg-emerald-600/10 border-emerald-600/20',
  submitted:   'text-amber-500 bg-amber-500/10 border-amber-500/20',
  resolved:    'text-teal-500 bg-teal-500/10 border-teal-500/20',
  approved:    'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  rejected:    'text-destructive bg-destructive/10 border-destructive/20',
  superseded:  'text-purple-500 bg-purple-500/10 border-purple-500/20',
};

function eventTypeColor(eventType: string): string {
  const verb = eventType.split('.').pop() ?? '';
  return EVENT_TYPE_COLORS[verb] ?? 'text-muted-foreground bg-muted border-border';
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `${days}d ago`;
  if (hrs > 0) return `${hrs}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'Just now';
}

function formatEventLabel(eventType: string): string {
  return eventType
    .split('.')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' › ');
}

// ─── Diff Viewer ──────────────────────────────────────────────────────────────

function DiffViewer({ before, after }: { before?: unknown; after?: unknown }) {
  if (!before && !after) return null;

  const beforeObj = typeof before === 'object' && before !== null ? before as Record<string, unknown> : {};
  const afterObj  = typeof after  === 'object' && after  !== null ? after  as Record<string, unknown> : {};

  const allKeys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
  const changed = allKeys.filter(k => JSON.stringify(beforeObj[k]) !== JSON.stringify(afterObj[k]));
  const unchanged = allKeys.filter(k => !changed.includes(k));

  if (changed.length === 0 && unchanged.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      {changed.length > 0 && (
        <div className="p-3 space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Changed</p>
          {changed.map(key => (
            <div key={key} className="grid grid-cols-[auto_1fr_1fr] gap-2 text-xs items-start">
              <span className="font-mono text-muted-foreground shrink-0 pt-0.5">{key}</span>
              <div className="px-1.5 py-0.5 rounded bg-destructive/10 border border-destructive/20 text-destructive font-mono break-all">
                {key in beforeObj ? JSON.stringify(beforeObj[key]) : <em className="text-muted-foreground not-italic">(absent)</em>}
              </div>
              <div className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 font-mono break-all">
                {key in afterObj ? String(JSON.stringify(afterObj[key])) : <em className="text-muted-foreground not-italic">(removed)</em>}
              </div>
            </div>
          ))}
        </div>
      )}
      {unchanged.length > 0 && changed.length > 0 && (
        <div className="px-3 pb-3">
          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
            {unchanged.length} unchanged field{unchanged.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
      {!before && after != null && (
        <div className="p-3">
          <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-2">Created with</p>
          <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(after, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Event Row ────────────────────────────────────────────────────────────────

/** Shorten a model name for display: "claude-sonnet-4-20250514" → "claude-sonnet-4" */
function shortModel(model?: string): string {
  if (!model) return '';
  // Strip trailing date-like suffix (e.g. -20250514)
  return model.replace(/-\d{8}$/, '');
}

function EventRow({ event }: { event: CrmyEvent }) {
  const [expanded, setExpanded] = useState(false);
  const actorCfg = ACTOR_TYPE_CONFIG[event.actor_type] ?? ACTOR_TYPE_CONFIG.system;
  const ActorIcon = actorCfg.icon;

  const hasDiff = event.before_data !== undefined || event.after_data !== undefined;
  const hasMetadata = Boolean(event.metadata && Object.keys(event.metadata).length > 0);

  // Resolved actor display — prefer name, fall back to truncated ID
  const actorName = event.actor_display_name
    ?? (event.actor_id ? event.actor_id.slice(0, 8) : null);

  const modelLabel = shortModel(event.actor_agent_model);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => (hasDiff || hasMetadata) && setExpanded(!expanded)}
      >
        {/* Actor block */}
        <div className="flex flex-col items-start gap-0.5 shrink-0 min-w-[100px] max-w-[160px]">
          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-semibold ${actorCfg.cls}`}>
            <ActorIcon className="w-2.5 h-2.5" />
            {actorName ?? actorCfg.label}
          </span>
          {/* Model badge for agents */}
          {event.actor_type === 'agent' && modelLabel && (
            <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 font-mono leading-none">
              <Cpu className="w-2 h-2" />
              {modelLabel}
            </span>
          )}
          {/* Agent identifier if present and different from display name */}
          {event.actor_agent_identifier && event.actor_agent_identifier !== event.actor_display_name && (
            <span className="text-[9px] text-muted-foreground/60 font-mono truncate max-w-full leading-none">
              {event.actor_agent_identifier}
            </span>
          )}
        </div>

        {/* Event type */}
        <span className={`inline-flex text-[10px] px-1.5 py-0.5 rounded border font-mono font-semibold shrink-0 ${eventTypeColor(event.event_type)}`}>
          {event.event_type}
        </span>

        {/* Object info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {formatEventLabel(event.event_type)}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {event.object_type}
            {event.object_id ? ` · ${event.object_id.slice(0, 8)}` : ''}
          </p>
        </div>

        {/* Time */}
        <div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          {relativeTime(event.created_at)}
        </div>

        {/* Expand indicator */}
        {(hasDiff || hasMetadata) && (
          <div className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-3">
          {/* Actor detail panel */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {actorName && (
              <span className="text-muted-foreground">
                Actor: <span className="text-foreground font-medium">{actorName}</span>
              </span>
            )}
            {event.actor_id && (
              <span className="text-muted-foreground font-mono">
                ID: <span className="text-foreground">{event.actor_id}</span>
              </span>
            )}
            {event.actor_agent_model && (
              <span className="text-muted-foreground">
                Model: <span className="text-violet-400 font-mono">{event.actor_agent_model}</span>
              </span>
            )}
            {event.actor_agent_identifier && (
              <span className="text-muted-foreground">
                Identifier: <span className="text-foreground font-mono">{event.actor_agent_identifier}</span>
              </span>
            )}
          </div>

          {hasDiff && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Data Changes</p>
              <DiffViewer before={event.before_data} after={event.after_data} />
            </div>
          )}

          {hasMetadata && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Metadata</p>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(event.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Full timestamp: {new Date(event.created_at).toLocaleString()}
            {' '}· Event #{event.id}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Filters Bar ──────────────────────────────────────────────────────────────

const COMMON_OBJECT_TYPES = [
  'contact', 'account', 'opportunity', 'activity', 'context_entry',
  'hitl_request', 'assignment', 'email', 'email_sequence', 'actor',
];

const COMMON_EVENT_TYPES = [
  'contact.created', 'contact.updated',
  'opportunity.created', 'opportunity.updated',
  'activity.created',
  'context_entry.created', 'context_entry.superseded',
  'hitl_request.submitted', 'hitl_request.resolved',
  'assignment.created', 'assignment.completed',
];

function FiltersBar({
  objectType, setObjectType,
  eventType, setEventType,
  actorId, setActorId,
}: {
  objectType: string; setObjectType: (v: string) => void;
  eventType: string;  setEventType:  (v: string) => void;
  actorId: string;    setActorId:    (v: string) => void;
}) {
  const selectCls = 'h-8 px-2 pr-6 rounded-lg border border-border bg-background text-xs text-foreground outline-none focus:ring-1 focus:ring-ring appearance-none cursor-pointer';
  const inputCls  = 'h-8 px-2 rounded-lg border border-border bg-background text-xs text-foreground outline-none focus:ring-1 focus:ring-ring';

  const hasFilters = objectType || eventType || actorId;

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Filter className="w-3.5 h-3.5" />
        <span className="font-semibold">Filter</span>
      </div>

      <select value={objectType} onChange={e => setObjectType(e.target.value)} className={selectCls}>
        <option value="">All object types</option>
        {COMMON_OBJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <select value={eventType} onChange={e => setEventType(e.target.value)} className={selectCls}>
        <option value="">All event types</option>
        {COMMON_EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <input
        type="text"
        value={actorId}
        onChange={e => setActorId(e.target.value)}
        placeholder="Actor ID…"
        className={inputCls}
        style={{ width: 140 }}
      />

      {hasFilters && (
        <button
          onClick={() => { setObjectType(''); setEventType(''); setActorId(''); }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" /> Clear
        </button>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const [objectType, setObjectType] = useState('');
  const [eventType, setEventType]   = useState('');
  const [actorId, setActorId]       = useState('');
  const [q, setQ]                   = useState('');

  const { data, isLoading, refetch, isFetching } = useEvents({
    object_type: objectType || undefined,
    event_type:  eventType  || undefined,
    actor_id:    actorId    || undefined,
    limit: 100,
  }) as {
    data: { data: CrmyEvent[]; total: number } | undefined;
    isLoading: boolean;
    refetch: () => void;
    isFetching: boolean;
  };

  const events = data?.data ?? [];
  const filtered = q
    ? events.filter(e =>
        e.event_type.includes(q.toLowerCase()) ||
        e.object_type.includes(q.toLowerCase()) ||
        (e.object_id ?? '').startsWith(q.toLowerCase()) ||
        (e.actor_id ?? '').startsWith(q.toLowerCase())
      )
    : events;

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Audit Log"
        icon={ScrollText}
        iconClassName="text-violet-400"
        description={`${data?.total ?? 0} event${(data?.total ?? 0) !== 1 ? 's' : ''} in total`}
      >
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6 space-y-4">
        {/* Filters */}
        <FiltersBar
          objectType={objectType} setObjectType={setObjectType}
          eventType={eventType}   setEventType={setEventType}
          actorId={actorId}       setActorId={setActorId}
        />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search events, object IDs, actor IDs…"
            className="w-full h-9 pl-9 pr-8 rounded-lg border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Event list */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 rounded-xl bg-muted/50 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-violet-500/15 flex items-center justify-center mb-4">
              <ScrollText className="w-8 h-8 text-violet-400" />
            </div>
            <h2 className="text-lg font-display font-semibold text-foreground mb-1">
              {q || objectType || eventType || actorId ? 'No matching events' : 'No events yet'}
            </h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              {q || objectType || eventType || actorId
                ? 'Try adjusting your filters or search query.'
                : 'All system events — creates, updates, deletions, HITL decisions — are recorded here automatically.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(event => (
              <EventRow key={event.id} event={event} />
            ))}
            {data && data.total > events.length && (
              <p className="text-center text-xs text-muted-foreground py-2">
                Showing {events.length} of {data.total} events. Use filters to narrow results.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
