// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { useOpsDataQuality, useOpsStatus } from '@/api/hooks';
import { countLabel } from '@/lib/headerCopy';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Loader2,
  RefreshCw,
} from 'lucide-react';

function statusClass(counts: Record<string, number>, available: boolean) {
  if (!available) return 'border-destructive/30 bg-destructive/5';
  const failures = (counts.failed ?? 0) + (counts.retrying ?? 0) + (counts.parked ?? 0);
  if (failures > 0) return 'border-warning/40 bg-warning/5';
  if (Object.values(counts).some(v => v > 0)) return 'border-primary/25 bg-primary/5';
  return 'border-border bg-card';
}

const DATA_QUALITY_COPY: Record<string, { label: string; description: string }> = {
  invalid_contact_lifecycle_stage: {
    label: 'Invalid contact lifecycle stage',
    description: 'Contacts have lifecycle values outside the typed stage model agents rely on.',
  },
  invalid_opportunity_stage: {
    label: 'Invalid opportunity stage',
    description: 'Opportunities have stages outside the supported pipeline model.',
  },
  invalid_opportunity_forecast_category: {
    label: 'Invalid opportunity forecast category',
    description: 'Opportunities have forecast categories outside the supported revenue forecast model.',
  },
  activities_missing_canonical_subject: {
    label: 'Activities missing canonical subject',
    description: 'Activities are linked to an object but lack subject_type/subject_id for reliable timeline assembly.',
  },
  context_entries_missing_author_actor: {
    label: 'Context entries missing author actor',
    description: 'Memory entries reference actors that no longer resolve, weakening auditability.',
  },
  activities_missing_performer_actor: {
    label: 'Activities missing performer actor',
    description: 'Activities reference performers that no longer resolve, reducing agent attribution quality.',
  },
  open_assignments_missing_assignee: {
    label: 'Open assignments missing assignee',
    description: 'Open human handoffs or assignments point to an actor that no longer resolves.',
  },
  current_context_missing_search_index: {
    label: 'Current context missing search index',
    description: 'Current memory exists but is missing search rows, so agents may fail to retrieve it.',
  },
  stuck_context_outbox_processing: {
    label: 'Stuck context indexing work',
    description: 'Context indexing jobs have been processing too long and may need operator review.',
  },
};

function humanizeName(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function severityClass(severity?: string) {
  if (severity === 'critical') return 'border-destructive/30 bg-destructive/10 text-destructive';
  if (severity === 'warning') return 'border-warning/30 bg-warning/10 text-warning';
  return 'border-border bg-muted text-muted-foreground';
}

function QueueCard({ queue }: { queue: any }) {
  const counts = queue.counts_by_status ?? {};
  const failureCount = (counts.failed ?? 0) + (counts.retrying ?? 0) + (counts.parked ?? 0);
  return (
    <div className={`rounded-xl border p-4 ${statusClass(counts, queue.available !== false)}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-lg p-2 ${
          queue.available === false || failureCount > 0 ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary'
        }`}>
          {queue.available === false || failureCount > 0
            ? <AlertTriangle className="w-4 h-4" />
            : <CheckCircle2 className="w-4 h-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground truncate">{queue.label ?? queue.name}</p>
            <span className="text-xs font-mono text-muted-foreground">{queue.name}</span>
          </div>
          {queue.oldest_pending_at && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              Oldest pending {new Date(queue.oldest_pending_at).toLocaleString()}
            </p>
          )}
          {queue.error && <p className="mt-1 text-xs text-destructive">{queue.error}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.keys(counts).length === 0 ? (
          <span className="text-xs text-muted-foreground">No queued work</span>
        ) : Object.entries(counts).map(([status, count]) => (
          <span key={status} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{String(count)}</span> {status}
          </span>
        ))}
      </div>
      {queue.recent_failures?.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {queue.recent_failures.slice(0, 2).map((failure: any, idx: number) => (
            <div key={failure.id ?? idx} className="rounded-lg border border-destructive/20 bg-background px-2.5 py-2">
              <p className="text-xs text-destructive line-clamp-2">{failure.error ?? failure.last_error ?? 'Failed job'}</p>
              {failure.id && <p className="mt-1 text-xs font-mono text-muted-foreground">{failure.id}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DataQualityRow({ check }: { check: any }) {
  const [expanded, setExpanded] = useState(false);
  const count = Number(check.count ?? 0);
  const hasIssue = count > 0 || Boolean(check.error);
  const key = check.name ?? check.check_name ?? check.label ?? 'data_quality_check';
  const copy = DATA_QUALITY_COPY[key] ?? {
    label: check.label ?? humanizeName(key),
    description: check.description ?? 'This check found data that may reduce agent context quality.',
  };
  const samples: Record<string, unknown>[] = Array.isArray(check.sample) ? check.sample : [];
  const canExpand = samples.length > 0 || Boolean(check.error);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => canExpand && setExpanded(value => !value)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 disabled:cursor-default disabled:hover:bg-transparent"
        disabled={!canExpand}
      >
        <div className={`mt-0.5 rounded-md p-1.5 ${hasIssue ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>
          {hasIssue ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{copy.label}</p>
            <span className={`rounded-md border px-1.5 py-0.5 text-xs font-semibold capitalize ${severityClass(check.severity)}`}>
              {check.severity ?? 'info'}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
          <p className="mt-1 text-xs font-mono text-muted-foreground/80">{key}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-md px-2 py-1 text-xs font-mono ${hasIssue ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'}`}>
            {count}
          </span>
          {canExpand && (
            expanded
              ? <ChevronDown className="mt-1 h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/60 bg-muted/10 px-4 py-3">
          {check.error && (
            <div className="mb-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {check.error}
            </div>
          )}
          {samples.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sample records
              </p>
              <div className="space-y-2">
                {samples.map((sample, index) => (
                  <pre
                    key={`${key}-sample-${sample.id ?? index}`}
                    className="overflow-x-auto rounded-lg border border-border bg-background p-3 text-xs text-foreground"
                  >
                    {JSON.stringify(sample, null, 2)}
                  </pre>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No sample records returned for this check.</p>
          )}
        </div>
      )}
    </div>
  );
}

function DataQualitySummary({ checks }: { checks: any[] }) {
  const totalSampledFindings = checks.reduce((sum, check) => sum + Number(check.count ?? 0), 0);
  const criticalCount = checks.filter(check => check.severity === 'critical').length;
  const warningCount = checks.filter(check => check.severity === 'warning').length;

  return (
    <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Active checks</p>
        <p className="mt-1 text-2xl font-display font-bold text-foreground">{checks.length}</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Sampled findings</p>
        <p className="mt-1 text-2xl font-display font-bold text-warning">{totalSampledFindings}</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Severity</p>
        <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <span className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-destructive">
            {criticalCount} critical
          </span>
          <span className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-warning">
            {warningCount} warning
          </span>
        </p>
      </div>
    </div>
  );
}

export default function OperationsPage() {
  const statusQ = useOpsStatus({ sample_limit: 3, include_samples: true }) as any;
  const qualityQ = useOpsDataQuality({ sample_limit: 5, include_clean: false }) as any;
  const queues: any[] = statusQ.data?.queues ?? [];
  const attention: any[] = statusQ.data?.attention_required ?? [];
  const checks: any[] = qualityQ.data?.checks ?? [];

  const queueSummary = useMemo(() => {
    const unavailable = queues.filter(q => q.available === false).length;
    const failureQueues = queues.filter(q => {
      const counts = q.counts_by_status ?? {};
      return (counts.failed ?? 0) + (counts.retrying ?? 0) + (counts.parked ?? 0) > 0;
    }).length;
    return { unavailable, failureQueues };
  }, [queues]);

  const isLoading = statusQ.isLoading || qualityQ.isLoading;
  const isError = statusQ.isError || qualityQ.isError;
  const error = statusQ.error ?? qualityQ.error;
  const errorMessage = error instanceof Error ? error.message : 'Check the server logs and try again.';

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Reliability"
        icon={Database}
        iconClassName="text-[#a78bfa]"
        description={`Review queues and data quality • ${countLabel(queues.length, 'queue')} • ${countLabel(checks.length, 'check')}`}
      >
        <button
          onClick={() => { statusQ.refetch(); qualityQ.refetch(); }}
          className="hidden md:flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${statusQ.isFetching || qualityQ.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Could not load reliability status. {errorMessage}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Queues monitored</p>
                <p className="mt-1 text-2xl font-display font-bold text-foreground">{queues.length}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Need attention</p>
                <p className={`mt-1 text-2xl font-display font-bold ${attention.length > 0 ? 'text-warning' : 'text-foreground'}`}>{attention.length}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Queue failures</p>
                <p className={`mt-1 text-2xl font-display font-bold ${queueSummary.failureQueues > 0 || queueSummary.unavailable > 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {queueSummary.failureQueues + queueSummary.unavailable}
                </p>
              </div>
            </div>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-display font-bold text-foreground">Work Queues</h2>
                {statusQ.data?.generated_at && (
                  <span className="text-xs text-muted-foreground">Updated {new Date(statusQ.data.generated_at).toLocaleTimeString()}</span>
                )}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {queues.map(queue => <QueueCard key={queue.name} queue={queue} />)}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-display font-bold text-foreground">Data Quality</h2>
                <span className="text-xs text-muted-foreground">
                  {checks.length} active check{checks.length === 1 ? '' : 's'}
                </span>
              </div>
              {checks.length > 0 && <DataQualitySummary checks={checks} />}
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {checks.length === 0 ? (
                  <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    No data-quality findings.
                  </div>
                ) : checks.map((check, index) => (
                  <DataQualityRow
                    key={`${check.name ?? check.check_name ?? check.label ?? 'check'}-${index}`}
                    check={check}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
