// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react';
import { Bot, CalendarClock, FileText, Link2, User } from 'lucide-react';
import { useActivity } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { DrawerSection } from './DrawerSection';
import { activityIcon } from './CrmWidgets';

const SUBJECT_TYPE_LABELS: Record<string, string> = {
  contact: 'Contact',
  account: 'Account',
  opportunity: 'Opportunity',
  use_case: 'Use Case',
};

const SUBJECT_TYPE_DRAWER = {
  contact: 'contact',
  account: 'account',
  opportunity: 'opportunity',
  use_case: 'use-case',
} as const;

function formatDate(value?: unknown): string {
  if (typeof value !== 'string' || !value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatLabel(value?: unknown): string {
  return typeof value === 'string' && value ? value.replace(/_/g, ' ') : 'None';
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shortId(value: unknown) {
  const text = textValue(value);
  return text ? text.slice(0, 8) : null;
}

function detailValueLabel(key: string, value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') return key.endsWith('_id') ? shortId(value) : formatLabel(value);
  if (Array.isArray(value)) {
    const primitiveValues = value.filter(item => ['string', 'number', 'boolean'].includes(typeof item));
    return primitiveValues.length === value.length ? primitiveValues.map(String).join(', ') : `${value.length} items`;
  }
  if (isRecord(value)) {
    const sourceLabel = textValue(value.source_label);
    const type = textValue(value.type);
    if (sourceLabel || type) return [type ? formatLabel(type) : null, sourceLabel].filter(Boolean).join(' · ');
    const counts = [
      countLabel(numberValue(value.memory_created), 'Memory'),
      countLabel(numberValue(value.signals_created), 'Signal'),
      countLabel(numberValue(value.skipped), 'skipped'),
    ].filter(Boolean);
    if (counts.length > 0) return counts.join(', ');
    return 'Structured details';
  }
  return String(value);
}

function countLabel(value: number | null, label: string) {
  if (value == null) return null;
  const plural = value === 1 || label === 'Memory' || label === 'skipped' ? label : `${label}s`;
  return `${value.toLocaleString()} ${plural}`;
}

function actorLabel(activity: Record<string, unknown>) {
  const performerName = textValue(activity.performer_name);
  if (performerName) return performerName;
  const sourceAgent = textValue(activity.source_agent);
  if (sourceAgent) return formatLabel(sourceAgent);
  if (activity.performed_by) return 'Unknown actor';
  if (activity.created_by) return 'User';
  return null;
}

function sourceLabel(activity: Record<string, unknown>) {
  const label = textValue(activity.source_label);
  if (label) return label;
  const sourceAgent = textValue(activity.source_agent);
  if (sourceAgent) return formatLabel(sourceAgent);
  return null;
}

function hasProcessingSummary(processing: Record<string, unknown> | undefined, activity: Record<string, unknown>) {
  if (!processing) return false;
  return numberValue(processing.memory_created) != null
    || numberValue(processing.signals_created) != null
    || numberValue(processing.skipped) != null
    || Boolean(sourceLabel(activity))
    || Boolean(textValue(activity.source_status))
    || Boolean(textValue(activity.source_stage));
}

function ProcessingSummary({
  processing,
  activity,
}: {
  processing?: Record<string, unknown>;
  activity: Record<string, unknown>;
}) {
  if (!processing) return null;
  const counts = [
    countLabel(numberValue(processing.memory_created), 'Memory'),
    countLabel(numberValue(processing.signals_created), 'Signal'),
    countLabel(numberValue(processing.skipped), 'skipped'),
  ].filter(Boolean);
  const label = sourceLabel(activity);
  const status = textValue(activity.source_status);
  const stage = textValue(activity.source_stage);

  if (counts.length === 0 && !label && !status && !stage) return null;

  return (
    <div className="text-right">
      {counts.length > 0 && <p className="font-medium text-foreground">{counts.join(', ')}</p>}
      {(label || status || stage) && (
        <p className="mt-0.5 inline-flex max-w-full items-center justify-end gap-1.5 text-xs text-muted-foreground">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {[label, status ? formatLabel(status) : null, stage ? formatLabel(stage) : null].filter(Boolean).join(' · ')}
          </span>
        </p>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="max-w-[65%] text-right text-sm text-foreground break-words">
        {value}
      </span>
    </div>
  );
}

export function ActivityDrawer() {
  const { drawerEntityId, openDrawer } = useAppStore();
  const { data, isLoading, error } = useActivity(drawerEntityId);
  const activity = data?.data ?? null;

  if (!drawerEntityId) {
    return <div className="p-5 text-sm text-muted-foreground">No activity selected.</div>;
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-5">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-muted/50 animate-pulse" />)}
      </div>
    );
  }

  if (error || !activity) {
    return (
      <div className="p-5">
        <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-4">
          <p className="text-sm font-semibold text-destructive">Could not load activity</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'The activity may have been removed or you may not have access.'}
          </p>
        </div>
      </div>
    );
  }

  const subjectType = typeof activity.subject_type === 'string' ? activity.subject_type : '';
  const subjectId = typeof activity.subject_id === 'string' ? activity.subject_id : '';
  const drawerType = SUBJECT_TYPE_DRAWER[subjectType as keyof typeof SUBJECT_TYPE_DRAWER];
  const subjectName = textValue(activity.subject_name) ?? (drawerType ? `${SUBJECT_TYPE_LABELS[subjectType] ?? formatLabel(subjectType)} record` : null);
  const actor = actorLabel(activity);
  const detail = activity.detail && typeof activity.detail === 'object' && !Array.isArray(activity.detail)
    ? activity.detail as Record<string, unknown>
    : {};
  const processing = isRecord(detail.processing) ? detail.processing : undefined;
  const showProcessing = hasProcessingSummary(processing, activity);

  return (
    <div className="pb-6">
      <div className="border-b border-border p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            {activityIcon(String(activity.type ?? 'note'))}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {formatLabel(activity.type)}
            </p>
            <h2 className="mt-1 text-lg font-display font-bold text-foreground">
              {String(activity.subject ?? 'Untitled activity')}
            </h2>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
            <CalendarClock className="h-3 w-3" />
            {formatDate(activity.occurred_at ?? activity.created_at)}
          </span>
          {typeof activity.outcome === 'string' && activity.outcome && (
            <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning">
              {formatLabel(activity.outcome)}
            </span>
          )}
        </div>
      </div>

      {typeof activity.body === 'string' && activity.body && (
        <DrawerSection title="Notes" defaultOpen>
          <p className="whitespace-pre-wrap rounded-xl border border-border bg-background/50 p-3 text-sm leading-relaxed text-foreground">
            {String(activity.body)}
          </p>
        </DrawerSection>
      )}

      <DrawerSection title="Linked Record" defaultOpen={Boolean(drawerType && subjectId)}>
        {drawerType && subjectId ? (
          <button
            onClick={() => openDrawer(drawerType, subjectId)}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-background/50 px-3 py-2 text-left hover:border-primary/30 hover:bg-muted/40 transition-colors"
          >
            <span className="flex items-center gap-2 text-sm text-foreground">
              <Link2 className="h-4 w-4 text-primary" />
              <span className="min-w-0">
                <span className="block truncate">{subjectName}</span>
                <span className="block text-xs text-muted-foreground">{SUBJECT_TYPE_LABELS[subjectType] ?? formatLabel(subjectType)}</span>
              </span>
            </span>
            <span className="text-xs font-medium text-primary">Open</span>
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">This activity is not linked to a customer record.</p>
        )}
      </DrawerSection>

      <DrawerSection title="Details" defaultOpen={Object.keys(detail).length > 0}>
        <div className="rounded-xl border border-border bg-background/50 px-3">
          <DetailRow label="Direction" value={formatLabel(activity.direction)} />
          <DetailRow label="Performed by" value={actor} />
          <DetailRow label="Source" value={sourceLabel(activity)} />
          {showProcessing && <DetailRow label="Processing" value={<ProcessingSummary processing={processing} activity={activity} />} />}
          {Object.entries(detail).filter(([key]) => key !== 'processing').map(([key, value]) => (
            <DetailRow key={key} label={key.replace(/_/g, ' ')} value={detailValueLabel(key, value)} />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          {activity.source_agent ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
          Activity ID <span className="font-mono">{drawerEntityId}</span>
        </div>
      </DrawerSection>
    </div>
  );
}
