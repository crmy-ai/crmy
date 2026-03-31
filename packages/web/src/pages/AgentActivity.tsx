// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, AlertTriangle, Clock, User, MessagesSquare } from 'lucide-react';
import { useAgentActivity, type ActivityLogEntry, type ActivityFilters } from '@/api/hooks';
import { TopBar } from '@/components/layout/TopBar';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

function truncateJson(obj: unknown, maxLen = 120): string {
  const s = JSON.stringify(obj, null, 2);
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

// ─── Row component ───────────────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: ActivityLogEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-2">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        {/* Tool icon + name */}
        <span className={`flex items-center gap-1.5 font-mono text-sm font-medium ${entry.is_error ? 'text-destructive' : 'text-foreground'}`}>
          {entry.is_error
            ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            : <Wrench className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
          {entry.tool_name}
        </span>

        <span className="flex-1" />

        {/* Meta: session, user, duration, time */}
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {entry.session_label && (
            <span className="flex items-center gap-1">
              <MessagesSquare className="w-3 h-3" />
              <span className="max-w-[120px] truncate">{entry.session_label}</span>
            </span>
          )}
          {entry.user_name && (
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {entry.user_name}
            </span>
          )}
          {entry.duration_ms !== null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDuration(entry.duration_ms)}
            </span>
          )}
          <span title={new Date(entry.created_at).toLocaleString()}>{formatRelative(entry.created_at)}</span>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border bg-muted/30 px-4 py-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Arguments</p>
            <pre className="text-xs font-mono bg-background border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
              {JSON.stringify(entry.tool_args, null, 2)}
            </pre>
          </div>
          {entry.tool_result !== null && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                {entry.is_error ? 'Error' : 'Result'}
              </p>
              <pre className={`text-xs font-mono border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto ${
                entry.is_error
                  ? 'bg-destructive/5 border-destructive/30 text-destructive'
                  : 'bg-background border-border'
              }`}>
                {JSON.stringify(entry.tool_result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TOOL_NAMES = [
  'contact_get', 'contact_search', 'contact_create', 'contact_update',
  'account_get', 'account_search', 'account_create',
  'opportunity_get', 'opportunity_list', 'opportunity_create', 'opportunity_update',
  'activity_create', 'activity_complete', 'activity_update',
  'context_add', 'context_list', 'context_extract', 'context_supersede',
  'briefing_get',
  'assignment_create', 'assignment_list',
];

export default function AgentActivity() {
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [toolFilter, setToolFilter] = useState('');
  const [errorFilter, setErrorFilter] = useState<'all' | 'errors'>('all');
  const [since, setSince] = useState('');

  const activeFilters: ActivityFilters = {
    ...filters,
    tool_name: toolFilter || undefined,
    is_error: errorFilter === 'errors' ? true : undefined,
    since: since || undefined,
    limit: 50,
  };

  const { data, isLoading, isError } = useAgentActivity(activeFilters);
  const entries = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Agent Activity"
        icon={Wrench}
        iconClassName="text-[#6366f1]"
        description="Real-time agent tool usage and performance."
      />

      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <select
            className="h-9 px-3 rounded-md border border-input bg-background text-sm"
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
          >
            <option value="">All tools</option>
            {TOOL_NAMES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select
            className="h-9 px-3 rounded-md border border-input bg-background text-sm"
            value={errorFilter}
            onChange={(e) => setErrorFilter(e.target.value as 'all' | 'errors')}
          >
            <option value="all">All results</option>
            <option value="errors">Errors only</option>
          </select>

          <input
            type="date"
            className="h-9 px-3 rounded-md border border-input bg-background text-sm"
            value={since}
            onChange={(e) => setSince(e.target.value ? new Date(e.target.value).toISOString() : '')}
            placeholder="Since date"
          />

          {(toolFilter || errorFilter !== 'all' || since) && (
            <button
              className="h-9 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:text-foreground"
              onClick={() => { setToolFilter(''); setErrorFilter('all'); setSince(''); }}
            >
              Clear filters
            </button>
          )}

          <span className="ml-auto self-center text-sm text-muted-foreground">
            {total.toLocaleString()} tool call{total !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Activity list */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <div className="text-center py-12 text-muted-foreground">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Failed to load activity log.</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Wrench className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">No agent tool calls recorded yet.</p>
            <p className="text-xs mt-1 opacity-70">Activity appears here as the agent uses tools in chat sessions.</p>
          </div>
        ) : (
          <>
            {entries.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
            {data?.next_cursor && (
              <button
                className="w-full mt-2 py-2 text-sm text-muted-foreground hover:text-foreground border border-dashed border-border rounded-lg"
                onClick={() => setFilters((f) => ({ ...f, cursor: data.next_cursor }))}
              >
                Load more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
