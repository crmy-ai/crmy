// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState, type ReactNode } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { useOpsDataQuality, useOpsStatus, useRepairOpsDataQuality, useSystemConflicts, useSystemSyncRuns, useSystemsOfRecord, useSystemWritebacks } from '@/api/hooks';
import { toast } from '@/hooks/use-toast';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Loader2,
  RefreshCw,
  Server,
} from 'lucide-react';

const OPERATIONS_SHOW_ALL_KEY = 'crmy_operations_show_all';

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
    label: 'Current Memory missing search index',
    description: 'Current Memory exists but is missing search rows, so agents may fail to retrieve it.',
  },
  stuck_context_outbox_processing: {
    label: 'Stuck context indexing work',
    description: 'Context indexing jobs have been processing too long and may need operator review.',
  },
  stale_sources_processing: {
    label: 'Stale Source processing',
    description: 'Source receipts are stuck mid-processing and may need retry or review.',
  },
  failed_sources_retryable: {
    label: 'Retryable Source failures',
    description: 'Source extraction failed in a way that may succeed after retrying.',
  },
  failed_source_extraction_attempts: {
    label: 'Failed Source extraction attempts',
    description: 'Recent extraction attempts failed during model, parsing, repair, or write processing.',
  },
  stuck_agent_turns_running: {
    label: 'Stuck Workspace Agent turns',
    description: 'Agent work has been running too long and may need to be failed or retried.',
  },
  stale_mailbox_sync_jobs: {
    label: 'Mailbox sync needs attention',
    description: 'Customer Email sync jobs are stuck or failed but still retryable.',
  },
  stale_calendar_sync_jobs: {
    label: 'Calendar sync needs attention',
    description: 'Customer Activity sync jobs are stuck or failed but still retryable.',
  },
  customer_calendar_events_missing_link: {
    label: 'Customer meetings missing links',
    description: 'Calendar meetings look customer-facing but are not linked to customer records yet.',
  },
};

const QUEUE_COPY: Record<string, { label: string; description?: string }> = {
  email_delivery_jobs: {
    label: 'Outbound email delivery',
    description: 'Provider send jobs for approved or direct customer emails.',
  },
  mailbox_sync_jobs: {
    label: 'Mailbox sync',
    description: 'Customer Email mailbox sync jobs.',
  },
  calendar_sync_jobs: {
    label: 'Calendar sync',
    description: 'Customer Activity calendar sync jobs.',
  },
};

const REPAIRABLE_DATA_QUALITY_CHECKS = new Set([
  'activities_missing_canonical_subject',
  'current_context_missing_search_index',
  'stuck_context_outbox_processing',
  'stale_sources_processing',
  'failed_sources_retryable',
  'stuck_agent_turns_running',
]);

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

function systemHealthClass(status?: string, issues = 0) {
  if (status === 'error' || issues > 0) return 'border-warning/40 bg-warning/5';
  if (status === 'connected') return 'border-success/30 bg-success/5';
  return 'border-border bg-card';
}

function queueFailureCount(queue: any) {
  const counts = queue.counts_by_status ?? {};
  return (counts.failed ?? 0) + (counts.retrying ?? 0) + (counts.parked ?? 0);
}

function queueNeedsAttention(queue: any) {
  return queue.available === false || queueFailureCount(queue) > 0 || Boolean(queue.oldest_pending_at) || Boolean(queue.error);
}

function getDataQualityKey(check: any) {
  return check.name ?? check.check_name ?? check.label ?? 'data_quality_check';
}

function dataQualityHasIssue(check: any) {
  return Number(check.count ?? 0) > 0 || Boolean(check.error);
}

function getDataQualityCopy(check: any) {
  const key = getDataQualityKey(check);
  return DATA_QUALITY_COPY[key] ?? {
    label: check.label ?? humanizeName(key),
    description: check.description ?? 'This check found data that may reduce agent context quality.',
  };
}

function systemIssueCount(status?: string, latestRun?: any, openConflicts = 0, pendingWritebacks = 0) {
  return openConflicts + pendingWritebacks + (latestRun?.status === 'failed' ? 1 : 0) + (status && status !== 'connected' ? 1 : 0);
}

function schedulerMetricValue(value: unknown) {
  return Number(value ?? 0);
}

function schedulerNeedsAttention(schedulerHealth: any) {
  if (!schedulerHealth) return false;
  return Boolean(schedulerHealth.last_tick_error)
    || schedulerMetricValue(schedulerHealth.due_sequence_backlog) > 0
    || schedulerMetricValue(schedulerHealth.workflow_catchup_backlog) > 0
    || schedulerMetricValue(schedulerHealth.recent_failed_workflow_runs) > 0
    || schedulerMetricValue(schedulerHealth.recent_failed_sequence_steps) > 0;
}

function SystemOfRecordCard({
  system,
  latestRun,
  openConflicts,
  pendingWritebacks,
}: {
  system: any;
  latestRun?: any;
  openConflicts: number;
  pendingWritebacks: number;
}) {
  const issueCount = systemIssueCount(system.status, latestRun, openConflicts, pendingWritebacks);
  const healthy = system.status === 'connected' && issueCount === 0;
  return (
    <div className={`rounded-xl border p-4 ${systemHealthClass(system.status, issueCount)}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-lg p-2 ${healthy ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary'}`}>
          {healthy ? <CheckCircle2 className="w-4 h-4" /> : <Server className="w-4 h-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground truncate">{system.name}</p>
            <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs capitalize text-muted-foreground">
              {system.system_type}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Status {system.status ?? 'unknown'}
            {system.last_sync_at ? ` • Last sync ${new Date(system.last_sync_at).toLocaleString()}` : ' • Not synced yet'}
          </p>
          {latestRun?.error && <p className="mt-1 text-xs text-destructive line-clamp-2">{latestRun.error}</p>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-background/70 p-2">
          <p className="text-sm font-semibold text-foreground">{latestRun?.status ?? 'none'}</p>
          <p className="text-xs text-muted-foreground">Latest run</p>
        </div>
        <div className="rounded-lg bg-background/70 p-2">
          <p className={`text-sm font-semibold ${openConflicts > 0 ? 'text-warning' : 'text-foreground'}`}>{openConflicts}</p>
          <p className="text-xs text-muted-foreground">Conflicts</p>
        </div>
        <div className="rounded-lg bg-background/70 p-2">
          <p className={`text-sm font-semibold ${pendingWritebacks > 0 ? 'text-warning' : 'text-foreground'}`}>{pendingWritebacks}</p>
          <p className="text-xs text-muted-foreground">Writebacks</p>
        </div>
      </div>
    </div>
  );
}

function QueueCard({ queue }: { queue: any }) {
  const counts = queue.counts_by_status ?? {};
  const failureCount = queueFailureCount(queue);
  const copy = QUEUE_COPY[queue.name] ?? { label: queue.label ?? queue.name };
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
            <p className="text-sm font-semibold text-foreground truncate">{copy.label}</p>
            <span className="text-xs font-mono text-muted-foreground">{queue.name}</span>
          </div>
          {copy.description && <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>}
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

function RawContextReliabilityNote() {
  return (
    <details className="rounded-xl border border-border bg-card px-4 py-3">
      <summary className="cursor-pointer text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
        Source replay and dedupe
      </summary>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Re-sending the same source returns the existing receipt instead of extracting again. When a source includes the real event time,
        repeated or lightly reworded uploads from that same event count as one evidence source for trust scoring; later events can still
        strengthen a Signal.
      </p>
    </details>
  );
}

function IssueSummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const valueClass = tone === 'danger'
    ? 'text-destructive'
    : tone === 'warning'
    ? 'text-warning'
    : 'text-foreground';
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-display font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

function SectionHeader({
  title,
  count,
  total,
  showAll,
  right,
}: {
  title: string;
  count?: number;
  total?: number;
  showAll?: boolean;
  right?: ReactNode;
}) {
  const countCopy = typeof count === 'number' && typeof total === 'number'
    ? showAll ? `${total} monitored` : `${count} need attention`
    : null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-display font-bold text-foreground">{title}</h2>
        {countCopy && <span className="text-xs text-muted-foreground">{countCopy}</span>}
      </div>
      {right}
    </div>
  );
}

function EmptyHealthyState({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="rounded-xl border border-success/30 bg-success/5 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-success/15 p-2 text-success">
          <CheckCircle2 className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Reliability looks clear</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No queues, syncs, scheduler work, or data-quality checks need attention right now.
          </p>
          <button
            type="button"
            onClick={onShowAll}
            className="mt-3 inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Show all monitored work
          </button>
        </div>
      </div>
    </div>
  );
}

function NeedsAttentionList({ items }: { items: { id: string; type: string; title: string; detail: string; tone?: 'warning' | 'danger' }[] }) {
  if (items.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-warning/30 bg-warning/5">
      <div className="border-b border-warning/20 px-4 py-3">
        <h2 className="text-sm font-display font-bold text-foreground">Needs Attention</h2>
        <p className="mt-1 text-xs text-muted-foreground">Issues below are grouped again in their source sections for details and repair actions.</p>
      </div>
      <div className="divide-y divide-border/70 bg-card/70">
        {items.map(item => (
          <div key={item.id} className="flex items-start gap-3 px-4 py-3">
            <div className={`mt-0.5 rounded-md p-1.5 ${item.tone === 'danger' ? 'bg-destructive/10 text-destructive' : 'bg-warning/15 text-warning'}`}>
              <AlertTriangle className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                  {item.type}
                </span>
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DataQualityRow({ check }: { check: any }) {
  const [expanded, setExpanded] = useState(false);
  const repairMutation = useRepairOpsDataQuality();
  const count = Number(check.count ?? 0);
  const hasIssue = dataQualityHasIssue(check);
  const key = getDataQualityKey(check);
  const copy = getDataQualityCopy(check);
  const samples: Record<string, unknown>[] = Array.isArray(check.sample) ? check.sample : [];
  const canExpand = samples.length > 0 || Boolean(check.error);
  const canRepair = REPAIRABLE_DATA_QUALITY_CHECKS.has(key) && count > 0;

  function runRepair(dryRun: boolean) {
    if (!dryRun && !window.confirm(`Run safe repair for ${copy.label}?`)) return;
    repairMutation.mutate(
      { check_name: key, dry_run: dryRun, limit: 100 },
      {
        onSuccess: (result: any) => {
          toast({
            title: dryRun ? 'Repair preview ready' : 'Repair queued',
            description: dryRun
              ? `${result.repaired_count ?? 0} record${Number(result.repaired_count ?? 0) === 1 ? '' : 's'} can be repaired safely.`
              : `${result.repaired_count ?? 0} record${Number(result.repaired_count ?? 0) === 1 ? '' : 's'} repaired or requeued.`,
          });
        },
        onError: (err) => {
          toast({
            title: 'Repair failed',
            description: err instanceof Error ? err.message : 'Try again or check server logs.',
            variant: 'destructive',
          });
        },
      },
    );
  }

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
            {canRepair && (
              <span className="rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-xs font-semibold text-primary">
                repairable
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
          <p className="mt-1 text-xs font-mono text-muted-foreground/80">{key}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canRepair && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                runRepair(true);
              }}
              disabled={repairMutation.isPending}
              className="hidden rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 md:inline-flex"
            >
              Preview repair
            </button>
          )}
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
          {canRepair && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                CRMy can safely repair or requeue this finding without manual database work.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => runRepair(true)}
                  disabled={repairMutation.isPending}
                  className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => runRepair(false)}
                  disabled={repairMutation.isPending}
                  className="rounded-lg border border-primary/30 bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  Run repair
                </button>
              </div>
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
  const [showAll, setShowAll] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(OPERATIONS_SHOW_ALL_KEY) === 'true';
  });
  function updateShowAll(value: boolean) {
    setShowAll(value);
    if (value) window.localStorage.setItem(OPERATIONS_SHOW_ALL_KEY, 'true');
    else window.localStorage.removeItem(OPERATIONS_SHOW_ALL_KEY);
  }

  const statusQ = useOpsStatus({ sample_limit: 3, include_samples: true }) as any;
  const qualityQ = useOpsDataQuality({ sample_limit: 5, include_clean: showAll }) as any;
  const systemsQ = useSystemsOfRecord({ limit: 50 }) as any;
  const syncRunsQ = useSystemSyncRuns({ limit: 50 }) as any;
  const conflictsQ = useSystemConflicts({ status: 'open', limit: 50 }) as any;
  const writebacksQ = useSystemWritebacks({ status: 'approval_required', limit: 50 }) as any;
  const queues: any[] = statusQ.data?.queues ?? [];
  const attention: any[] = statusQ.data?.attention_required ?? [];
  const checks: any[] = qualityQ.data?.checks ?? [];
  const systems: any[] = systemsQ.data?.data ?? [];
  const syncRuns: any[] = syncRunsQ.data?.data ?? [];
  const conflicts: any[] = conflictsQ.data?.data ?? [];
  const writebacks: any[] = writebacksQ.data?.data ?? [];
  const schedulerHealth = statusQ.data?.scheduler_health;

  const isLoading = statusQ.isLoading || qualityQ.isLoading;
  const isError = statusQ.isError || qualityQ.isError;
  const error = statusQ.error ?? qualityQ.error;
  const errorMessage = error instanceof Error ? error.message : 'Check the server logs and try again.';
  const latestRunBySystem = useMemo(() => {
    const map = new Map<string, any>();
    for (const run of syncRuns) {
      const systemId = String(run.system_id ?? '');
      if (systemId && !map.has(systemId)) map.set(systemId, run);
    }
    return map;
  }, [syncRuns]);
  const attentionQueues = useMemo(() => queues.filter(queueNeedsAttention), [queues]);
  const visibleQueues = showAll ? queues : attentionQueues;
  const systemRows = useMemo(() => systems.map(system => {
    const latestRun = latestRunBySystem.get(system.id);
    const openConflicts = conflicts.filter(conflict => conflict.system_id === system.id).length;
    const pendingWritebacks = writebacks.filter(writeback => writeback.system_id === system.id).length;
    return {
      system,
      latestRun,
      openConflicts,
      pendingWritebacks,
      issueCount: systemIssueCount(system.status, latestRun, openConflicts, pendingWritebacks),
    };
  }), [conflicts, latestRunBySystem, systems, writebacks]);
  const systemsNeedingAttention = systemRows.filter(row => row.issueCount > 0);
  const visibleSystems = showAll ? systemRows : systemsNeedingAttention;
  const dataQualityFindings = useMemo(() => checks.filter(dataQualityHasIssue), [checks]);
  const visibleChecks = showAll ? checks : dataQualityFindings;
  const totalDataQualityFindings = dataQualityFindings.reduce((sum, check) => {
    const count = Number(check.count ?? 0);
    return sum + (count > 0 ? count : check.error ? 1 : 0);
  }, 0);
  const schedulerHasAttention = schedulerNeedsAttention(schedulerHealth);
  const sourceHasFindings = dataQualityFindings.some(check => {
    const key = getDataQualityKey(check);
    return key.includes('source') || key.includes('extraction');
  });
  const attentionItems = useMemo(() => {
    const queueItems = attentionQueues.map(queue => {
      const failures = queueFailureCount(queue);
      const copy = QUEUE_COPY[queue.name] ?? { label: queue.label ?? queue.name };
      return {
        id: `queue-${queue.name}`,
        type: 'Work queue',
        title: copy.label,
        detail: queue.available === false
          ? 'Queue is unavailable.'
          : failures > 0
          ? `${failures} failed, retrying, or parked job${failures === 1 ? '' : 's'}.`
          : queue.oldest_pending_at
          ? `Oldest pending work started ${new Date(queue.oldest_pending_at).toLocaleString()}.`
          : queue.error ?? 'Queue needs operator review.',
        tone: queue.available === false || failures > 0 ? 'danger' as const : 'warning' as const,
      };
    });
    const systemItems = systemsNeedingAttention.map(row => {
      const details = [
        row.system.status && row.system.status !== 'connected' ? `Status ${row.system.status}` : null,
        row.latestRun?.status === 'failed' ? 'Latest sync failed' : null,
        row.openConflicts > 0 ? `${row.openConflicts} open conflict${row.openConflicts === 1 ? '' : 's'}` : null,
        row.pendingWritebacks > 0 ? `${row.pendingWritebacks} pending writeback${row.pendingWritebacks === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      return {
        id: `system-${row.system.id}`,
        type: 'System of Record',
        title: row.system.name,
        detail: details.join(' • ') || 'System needs operator review.',
        tone: 'warning' as const,
      };
    });
    const schedulerItems = schedulerHasAttention ? [{
      id: 'scheduler',
      type: 'Scheduler',
      title: 'Automation Scheduler',
      detail: schedulerHealth?.last_tick_error
        ? `Last scheduler error: ${schedulerHealth.last_tick_error}`
        : 'Automation or sequence work has backlog or recent failures.',
      tone: schedulerHealth?.last_tick_error ? 'danger' as const : 'warning' as const,
    }] : [];
    const qualityItems = dataQualityFindings.map(check => {
      const copy = getDataQualityCopy(check);
      const count = Number(check.count ?? 0);
      return {
        id: `quality-${getDataQualityKey(check)}`,
        type: 'Data quality',
        title: copy.label,
        detail: check.error
          ? String(check.error)
          : `${count} sampled finding${count === 1 ? '' : 's'}. ${copy.description}`,
        tone: check.severity === 'critical' ? 'danger' as const : 'warning' as const,
      };
    });
    return [...queueItems, ...systemItems, ...schedulerItems, ...qualityItems];
  }, [attentionQueues, dataQualityFindings, schedulerHasAttention, schedulerHealth, systemsNeedingAttention]);
  const needsAttentionCount = attentionItems.length;
  const queueFailureCountTotal = attentionQueues.filter(queue => queue.available === false || queueFailureCount(queue) > 0).length;
  const showEmptyHealthyState = !showAll && needsAttentionCount === 0;

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Reliability"
        icon={Database}
        iconClassName="text-[#a78bfa]"
        description="Monitor durable work, sync health, and data quality."
      >
        <button
          onClick={() => updateShowAll(!showAll)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {showAll ? 'Show attention only' : 'Show all'}
        </button>
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <IssueSummaryCard label="Needs attention" value={needsAttentionCount} tone={needsAttentionCount > 0 ? 'warning' : 'default'} />
              <IssueSummaryCard label="Queue issues" value={queueFailureCountTotal} tone={queueFailureCountTotal > 0 ? 'danger' : 'default'} />
              <IssueSummaryCard label="Data quality findings" value={totalDataQualityFindings} tone={totalDataQualityFindings > 0 ? 'warning' : 'default'} />
              <IssueSummaryCard label="Systems with issues" value={systemsNeedingAttention.length} tone={systemsNeedingAttention.length > 0 ? 'warning' : 'default'} />
            </div>

            {showEmptyHealthyState ? <EmptyHealthyState onShowAll={() => updateShowAll(true)} /> : <NeedsAttentionList items={attentionItems} />}

            {(showAll || systemsNeedingAttention.length > 0 || systemsQ.isError) && (
              <section>
                <SectionHeader
                  title="Systems of Record"
                  count={systemsNeedingAttention.length}
                  total={systems.length}
                  showAll={showAll}
                  right={systemsQ.isError ? (
                    <span className="text-xs text-warning">Requires systems access</span>
                  ) : null}
                />
                {systemsQ.isLoading ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="h-32 rounded-xl bg-muted/50 animate-pulse" />
                    <div className="h-32 rounded-xl bg-muted/50 animate-pulse" />
                  </div>
                ) : systemsQ.isError ? (
                  <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-muted-foreground">
                    Systems of Record health is available to actors with <span className="font-mono text-foreground">systems:read</span> access.
                  </div>
                ) : visibleSystems.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                    No systems connected yet. Add one in Settings to monitor sync health here.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {visibleSystems.map(row => (
                      <SystemOfRecordCard
                        key={row.system.id}
                        system={row.system}
                        latestRun={row.latestRun}
                        openConflicts={row.openConflicts}
                        pendingWritebacks={row.pendingWritebacks}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {(showAll || attentionQueues.length > 0) && (
              <section>
                <SectionHeader
                  title="Work Queues"
                  count={attentionQueues.length}
                  total={queues.length}
                  showAll={showAll}
                  right={statusQ.data?.generated_at ? (
                    <span className="text-xs text-muted-foreground">Updated {new Date(statusQ.data.generated_at).toLocaleTimeString()}</span>
                  ) : null}
                />
                {visibleQueues.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                    No monitored queues returned by the server.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {visibleQueues.map(queue => <QueueCard key={queue.name} queue={queue} />)}
                  </div>
                )}
                {(showAll || sourceHasFindings) && (
                  <div className="mt-3">
                    <RawContextReliabilityNote />
                  </div>
                )}
              </section>
            )}

            {schedulerHealth && (showAll || schedulerHasAttention) && (
              <section>
                <SectionHeader
                  title="Automation Scheduler"
                  right={(
                    <span className="text-xs text-muted-foreground">
                    {schedulerHealth.last_successful_tick_at
                      ? `Last tick ${new Date(schedulerHealth.last_successful_tick_at).toLocaleTimeString()}`
                      : 'Waiting for first tick'}
                    </span>
                  )}
                />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  {[
                    ['Due sequence steps', schedulerHealth.due_sequence_backlog],
                    ['Workflow catch-up', schedulerHealth.workflow_catchup_backlog],
                    ['Failed workflow runs', schedulerHealth.recent_failed_workflow_runs],
                    ['Failed sequence steps', schedulerHealth.recent_failed_sequence_steps],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-border bg-card p-4">
                      <p className="text-xs text-muted-foreground">{String(label)}</p>
                      <p className={`mt-1 text-2xl font-display font-bold ${Number(value) > 0 ? 'text-warning' : 'text-foreground'}`}>
                        {Number(value)}
                      </p>
                    </div>
                  ))}
                </div>
                {schedulerHealth.last_tick_error && (
                  <div className="mt-3 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
                    Last scheduler error: {schedulerHealth.last_tick_error}
                  </div>
                )}
              </section>
            )}

            {(showAll || visibleChecks.length > 0) && (
              <section>
                <SectionHeader
                  title="Data Quality"
                  count={dataQualityFindings.length}
                  total={checks.length}
                  showAll={showAll}
                />
                {visibleChecks.length > 0 && <DataQualitySummary checks={visibleChecks} />}
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {visibleChecks.length === 0 ? (
                    <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      No data-quality findings.
                    </div>
                  ) : visibleChecks.map((check, index) => (
                    <DataQualityRow
                      key={`${getDataQualityKey(check)}-${index}`}
                      check={check}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
