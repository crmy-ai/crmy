// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActionContext } from '@crmy/shared';
import { AlertTriangle, Ban, CheckCircle2, ClipboardList, Database, FileText, Loader2, ShieldCheck, Sparkles } from 'lucide-react';

interface ActionReadinessPanelProps {
  actionContext?: ActionContext | null;
  isLoading?: boolean;
  isError?: boolean;
}

const STATUS_CONFIG = {
  ready: {
    label: 'Ready',
    icon: CheckCircle2,
    className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    dotClassName: 'bg-emerald-500',
  },
  review_needed: {
    label: 'Warnings',
    icon: AlertTriangle,
    className: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    dotClassName: 'bg-amber-500',
  },
  blocked: {
    label: 'Blocked',
    icon: Ban,
    className: 'border-destructive/25 bg-destructive/10 text-destructive',
    dotClassName: 'bg-destructive',
  },
} as const;

const MODE_CONFIG = {
  inform: {
    label: 'Inform',
    icon: CheckCircle2,
    className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  warn: {
    label: 'Warn',
    icon: AlertTriangle,
    className: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  require_review: {
    label: 'Review required',
    icon: ShieldCheck,
    className: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  },
} as const;

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function reasonText(actionContext: ActionContext) {
  const guidance = actionContext.guidance;
  const reasons = [
    guidance?.summary,
    ...(guidance?.review_reasons ?? []),
    ...(guidance?.warning_reasons ?? []),
  ].filter((reason): reason is string => Boolean(reason));
  return reasons.length > 0 ? reasons.slice(0, 3) : ['Action Context is available for this record.'];
}

export function ActionReadinessPanel({ actionContext, isLoading, isError }: ActionReadinessPanelProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking Action Context...
        </div>
      </div>
    );
  }

  if (isError || !actionContext) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Action Context unavailable
        </div>
      </div>
    );
  }

  const mode = actionContext.operating_mode ?? (actionContext.readiness.review_required ? 'require_review' : actionContext.readiness.status === 'ready' ? 'inform' : 'warn');
  const modeConfig = MODE_CONFIG[mode];
  const readinessConfig = STATUS_CONFIG[actionContext.readiness.status];
  const Icon = modeConfig.icon;
  const checks = actionContext.checks;
  const mappings = checks.systems_of_record.mappings;
  const unresolvedSignalCount = checks.signals.unresolved_readiness_count ?? checks.signals.conflicting_count;

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border ${modeConfig.className}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-display font-bold text-foreground">Action Context</p>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${modeConfig.className}`}>
              {modeConfig.label}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${readinessConfig.className}`}>
              {readinessConfig.label}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {actionContext.readiness.risk_level} risk
            </span>
          </div>
          <div className="mt-1 space-y-1">
            {reasonText(actionContext).map(reason => (
              <p key={reason} className="text-xs text-muted-foreground leading-relaxed">{reason}</p>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric icon={FileText} label="Confirmed Memory" value={checks.memory.confirmed_count} detail={countLabel(checks.memory.stale_count, 'warning')} />
        <Metric icon={Sparkles} label="Signals" value={checks.signals.signal_count} detail={countLabel(unresolvedSignalCount, 'readiness check')} />
        <Metric icon={ClipboardList} label="Handoffs" value={actionContext.required_handoffs.length} detail={countLabel(checks.assignments.open_count, 'assignment')} />
        <Metric icon={Database} label="Source Authority" value={mappings.length} detail={countLabel(checks.systems_of_record.open_conflict_count, 'conflict')} />
      </div>

      {mappings.length > 0 && (
        <div className="space-y-1.5">
          {mappings.slice(0, 2).map(mapping => (
            <div key={mapping.mapping_id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-2 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${mapping.source_authority === 'read_only' ? 'bg-slate-400' : 'bg-cyan-500'}`} />
              <span className="min-w-0 flex-1 truncate text-foreground">{mapping.external_object}</span>
              <span className="rounded bg-background px-1.5 py-0.5 font-semibold text-muted-foreground">
                {mapping.source_authority.replace(/_/g, ' ')}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          Proof {actionContext.proof.retrieval_event_id ? `#${actionContext.proof.retrieval_event_id}` : 'pending'}
        </span>
        <span>{countLabel(actionContext.proof.used_context_entry_ids.length, 'context item')}</span>
        <span>{countLabel(actionContext.proof.used_signal_group_ids.length, 'Signal group')}</span>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }: {
  icon: typeof FileText;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-lg font-display font-bold text-foreground">{value}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </div>
    </div>
  );
}
