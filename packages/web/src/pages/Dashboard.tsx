// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { ContextGovernance } from '@/components/crm/ContextGovernance';
import { SeedSampleDataButton } from '@/components/crm/OnboardingEmptyState';
import { EntityCombobox, type EntityType } from '@/components/ui/entity-combobox';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import {
  useAccounts,
  useActors,
  useActivities,
  useContacts,
  useContextEntries,
  useDbConfig,
  useHITLRequests,
  useOpportunities,
  usePipelineSummary,
  useSignalGroups,
  useStaleContextEntries,
  useSystemSyncRuns,
  useSystemWritebacks,
  useUseCases,
} from '@/api/hooks';
import { getUser } from '@/api/client';
import { useAppStore } from '@/store/appStore';
import { ENTITY_COLORS } from '@/lib/entityColors';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  Bot,
  UsersRound,
  Library,
  Inbox,
  FileText,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Layers,
  Brain,
  Database,
  Sparkles,
  ArrowUpRight,
  X,
  RotateCcw,
  Zap,
  Server,
  Building2,
  Briefcase,
  GitCompareArrows,
  CalendarClock,
  DollarSign,
  HeartPulse,
  PlusCircle,
  Target,
  XCircle,
  ChevronDown,
} from 'lucide-react';

const ACTIVATION_SKIPPED_STORAGE_KEY = 'crmy-activation-skipped-steps';
type FocusRecordType = EntityType | 'handoff' | 'unknown';
type FocusFilterType = 'all' | EntityType | 'handoff';
type DrawerRecordType = 'account' | 'contact' | 'opportunity' | 'use-case';
type FocusQueueKind = 'handoff' | 'signal' | 'memory' | 'opportunity' | 'account' | 'use_case';

interface FocusQueueItem {
  icon: React.ElementType;
  title: string;
  detail: string;
  href: string;
  action: string;
  tone: 'action' | 'watch' | 'danger' | 'success';
  queue_kind: FocusQueueKind;
  record_type: FocusRecordType;
  record_id?: string;
  record_name?: string;
  record_detail?: string;
  account_id?: string;
  account_name?: string;
  onOpenRecord?: () => void;
}

const RECORD_TYPE_META: Record<FocusRecordType, {
  label: string;
  plural: string;
  icon: React.ElementType;
  color: { bg: string; text: string };
}> = {
  account: { label: 'Account', plural: 'Accounts', icon: Building2, color: ENTITY_COLORS.accounts },
  contact: { label: 'Contact', plural: 'Contacts', icon: UsersRound, color: ENTITY_COLORS.contacts },
  opportunity: { label: 'Opportunity', plural: 'Opportunities', icon: Briefcase, color: ENTITY_COLORS.opportunities },
  use_case: { label: 'Use Case', plural: 'Use Cases', icon: GitCompareArrows, color: ENTITY_COLORS.useCases },
  handoff: { label: 'Handoff', plural: 'Handoffs', icon: Inbox, color: ENTITY_COLORS.assignments },
  unknown: { label: 'Record', plural: 'Records', icon: FileText, color: { bg: 'bg-muted', text: 'text-muted-foreground' } },
};

const DRAWER_TYPE_BY_RECORD: Partial<Record<FocusRecordType, DrawerRecordType>> = {
  account: 'account',
  contact: 'contact',
  opportunity: 'opportunity',
  use_case: 'use-case',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function normalizeRecordType(value?: string): FocusRecordType {
  const normalized = value === 'use-case' ? 'use_case' : value;
  if (normalized === 'account' || normalized === 'contact' || normalized === 'opportunity' || normalized === 'use_case') return normalized;
  return 'unknown';
}

function compactName(value?: string | null, fallback = 'No linked record'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readSkippedActivationSteps(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(ACTIVATION_SKIPPED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

function SetupStep({
  icon: Icon,
  title,
  detail,
  status,
  href,
  skipped,
  onSkipToggle,
}: {
  icon: React.ElementType;
  title: string;
  detail: string;
  status: 'ready' | 'action' | 'watch';
  href: string;
  skipped: boolean;
  onSkipToggle: () => void;
}) {
  const isReady = status === 'ready';
  const effectiveSkipped = skipped && !isReady;
  const color = effectiveSkipped
    ? 'text-muted-foreground bg-muted border-border'
    : status === 'ready'
    ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20'
    : status === 'watch'
      ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20'
      : 'text-primary bg-primary/10 border-primary/20';
  const isComplete = isReady || effectiveSkipped;

  return (
    <div className={`group flex items-start gap-3 rounded-xl border bg-card p-3 transition-all ${
      effectiveSkipped ? 'border-border/70 opacity-80' : 'border-border hover:border-primary/30 hover:shadow-sm'
    }`}>
      <Link to={href} className="flex min-w-0 flex-1 items-start gap-3">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground truncate">{title}</p>
            {effectiveSkipped && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Skipped
              </span>
            )}
            <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-primary transition-colors" />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
        </div>
      </Link>
      <div className="flex flex-shrink-0 items-start gap-2">
        {!isReady && (
          <button
            type="button"
            onClick={onSkipToggle}
            className="mt-0.5 h-6 rounded-md px-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {effectiveSkipped ? 'Undo' : 'Skip'}
          </button>
        )}
        <div
          className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-md border ${
            isComplete
              ? effectiveSkipped
                ? 'border-muted-foreground/30 bg-muted text-muted-foreground'
                : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'border-border bg-background text-transparent'
          }`}
          aria-label={isReady ? 'Complete' : effectiveSkipped ? 'Skipped' : 'Incomplete'}
        >
          {isComplete && (effectiveSkipped ? <X className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />)}
        </div>
      </div>
    </div>
  );
}

function FlowStep({
  icon: Icon,
  title,
  value,
  detail,
  action,
  href,
  color,
}: {
  icon: React.ElementType;
  title: string;
  value: number | string;
  detail: string;
  action: string;
  href: string;
  color: string;
}) {
  return (
    <Link
      to={href}
      className="group flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
    >
      <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="font-display text-xl font-bold leading-none text-foreground">{value}</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
          {action}
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

function AttentionItem({
  icon: Icon,
  title,
  detail,
  href,
  tone = 'action',
}: {
  icon: React.ElementType;
  title: string;
  detail: string;
  href: string;
  tone?: 'action' | 'watch';
}) {
  const color = tone === 'watch'
    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    : 'bg-primary/10 text-primary';

  return (
    <Link
      to={href}
      className="group flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-2.5 transition-all hover:border-primary/30 hover:shadow-sm"
    >
      <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
    </Link>
  );
}

function ReadinessItem({
  icon: Icon,
  title,
  value,
  detail,
  href,
  ready,
}: {
  icon: React.ElementType;
  title: string;
  value: string;
  detail: string;
  href: string;
  ready: boolean;
}) {
  return (
    <Link
      to={href}
      className="group flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-all hover:border-primary/30 hover:shadow-sm"
    >
      <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
        ready
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      }`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <span className={`text-xs font-semibold ${ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {value}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
    </Link>
  );
}

function CoverageItem({
  icon: Icon,
  title,
  value,
  detail,
  href,
  iconClassName,
  valueClassName = 'text-foreground',
}: {
  icon: React.ElementType;
  title: string;
  value: string;
  detail: string;
  href: string;
  iconClassName: string;
  valueClassName?: string;
}) {
  return (
    <Link
      to={href}
      className="group flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-all hover:border-primary/30 hover:shadow-sm"
    >
      <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${iconClassName}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <span className={`text-xs font-semibold ${valueClassName}`}>{value}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
    </Link>
  );
}

function CommandStatusChip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone: 'ready' | 'action' | 'watch';
}) {
  const color = tone === 'ready'
    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : tone === 'watch'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'bg-primary/10 text-primary';

  return (
    <div className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
      <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="block truncate text-sm font-semibold text-foreground">{value}</span>
      </span>
    </div>
  );
}

function LifecycleStripStep({
  icon: Icon,
  title,
  value,
  href,
  color,
}: {
  icon: React.ElementType;
  title: string;
  value: number | string;
  href: string;
  color: string;
}) {
  return (
    <Link
      to={href}
      className="group flex min-w-[8rem] items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 transition-colors hover:border-primary/30 hover:bg-muted/25"
    >
      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-base font-semibold leading-5 text-foreground">{value}</span>
        <span className="block truncate text-xs text-muted-foreground group-hover:text-foreground">{title}</span>
      </span>
    </Link>
  );
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function daysUntil(dateString?: string | null): number | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
}

function inferHandoffRecord(request: any): {
  record_type: FocusRecordType;
  record_id?: string;
  record_name?: string;
  account_id?: string;
  account_name?: string;
} {
  const payload = isRecord(request?.action_payload) ? request.action_payload : {};
  const directType = firstString(payload, ['subject_type', '_subject_type', 'entity_type', 'record_type']);
  const directId = firstString(payload, ['subject_id', '_subject_id', 'entity_id', 'record_id']);
  const directName = firstString(payload, ['subject_name', '_subject_name', 'entity_name', 'record_name', 'name']);
  if (directType && directId) {
    return {
      record_type: normalizeRecordType(directType),
      record_id: directId,
      record_name: directName,
      account_id: firstString(payload, ['account_id']),
      account_name: firstString(payload, ['account_name', 'company_name']),
    };
  }

  const keyedSubjects: Array<[FocusRecordType, string[], string[]]> = [
    ['opportunity', ['opportunity_id'], ['opportunity_name', 'deal_name']],
    ['account', ['account_id'], ['account_name', 'company_name']],
    ['contact', ['contact_id'], ['contact_name', 'to_name', 'recipient_name']],
    ['use_case', ['use_case_id', 'useCaseId'], ['use_case_name', 'use_case']],
  ];
  for (const [recordType, idKeys, nameKeys] of keyedSubjects) {
    const id = firstString(payload, idKeys);
    if (id) {
      return {
        record_type: recordType,
        record_id: id,
        record_name: firstString(payload, nameKeys),
        account_id: firstString(payload, ['account_id']),
        account_name: firstString(payload, ['account_name', 'company_name']),
      };
    }
  }
  return { record_type: 'handoff', record_name: 'No linked record' };
}

function SnapshotChip({
  icon: Icon,
  label,
  value,
  href,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  href: string;
  color: { bg: string; text: string };
}) {
  return (
    <Link
      to={href}
      className="group flex min-w-[8.5rem] items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 transition-colors hover:border-primary/30 hover:bg-muted/30"
    >
      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${color.bg} ${color.text}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-base font-semibold leading-5 text-foreground">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </Link>
  );
}

function FocusQueueRow({
  icon: Icon,
  title,
  detail,
  href,
  action,
  record_type,
  record_id,
  record_name,
  record_detail,
  onOpenRecord,
}: {
  icon: React.ElementType;
  title: string;
  detail: string;
  href: string;
  action: string;
  record_type: FocusRecordType;
  record_id?: string;
  record_name?: string;
  record_detail?: string;
  onOpenRecord?: () => void;
  tone?: 'action' | 'watch' | 'danger' | 'success';
}) {
  const recordMeta = RECORD_TYPE_META[record_type] ?? RECORD_TYPE_META.unknown;
  const RecordIcon = recordMeta.icon;
  const recordLabel = compactName(record_name);
  const canOpenRecord = Boolean(record_id && onOpenRecord);

  return (
    <Link
      to={href}
      className="group flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-all hover:border-primary/30 hover:bg-muted/25"
    >
      <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${recordMeta.color.bg} ${recordMeta.color.text}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${recordMeta.color.bg} ${recordMeta.color.text}`}>
            <RecordIcon className="h-3 w-3" />
            {recordMeta.label}
          </span>
          {canOpenRecord ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenRecord?.();
              }}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-foreground hover:border-primary/30 hover:text-primary"
            >
              <span className="truncate">{recordLabel}</span>
              {record_detail && <span className="hidden text-muted-foreground sm:inline">· {record_detail}</span>}
            </button>
          ) : (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              <span className="truncate">{recordLabel}</span>
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      <span className="mt-1 inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary group-hover:bg-primary/10">
        {action}
        <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}

function ActNowLink({
  icon: Icon,
  label,
  href,
  primary = false,
  variant = 'primary',
}: {
  icon: React.ElementType;
  label: string;
  href: string;
  primary?: boolean;
  variant?: 'primary' | 'purple' | 'context';
}) {
  const primaryClass = variant === 'purple'
    ? 'bg-violet-600 text-white hover:bg-violet-500'
    : variant === 'context'
      ? 'bg-[#0ea5e9] text-white hover:bg-[#0284c7]'
    : 'bg-primary text-primary-foreground hover:bg-primary/90';
  const secondaryClass = variant === 'purple'
    ? 'border border-violet-500/30 bg-violet-500/10 text-violet-700 hover:bg-violet-500/15 dark:text-violet-200'
    : variant === 'context'
      ? 'border border-[#0ea5e9]/30 bg-[#0ea5e9]/10 text-[#0284c7] hover:bg-[#0ea5e9]/15 dark:text-[#7dd3fc]'
    : 'border border-border bg-background text-foreground hover:bg-muted';

  return (
    <Link
      to={href}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors ${
        primary
          ? primaryClass
          : secondaryClass
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function PipelinePulseItem({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  tone?: 'default' | 'watch' | 'danger';
}) {
  const color = tone === 'danger'
    ? 'text-rose-500 bg-rose-500/10'
    : tone === 'watch'
      ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
      : 'text-muted-foreground bg-muted';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3">
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="font-display text-base font-semibold leading-5 text-foreground">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function ScopedOverviewDashboard() {
  const user = getUser();
  const isManager = user?.role === 'manager';
  const openDrawer = useAppStore(s => s.openDrawer);
  const [focusTypeFilter, setFocusTypeFilter] = useState<FocusFilterType>('all');
  const [focusRecordId, setFocusRecordId] = useState('');
  const { data: hitlData } = useHITLRequests() as any;
  const { data: memoryData } = useContextEntries({ memory_status: 'active', limit: 1 }) as any;
  const { data: nextStepMemoryData } = useContextEntries({ memory_status: 'active', context_type: 'next_step', limit: 200 }) as any;
  const { data: staleData } = useStaleContextEntries({ limit: 50 }) as any;
  const { data: signalGroupData } = useSignalGroups({ attention_only: true, limit: 10 }) as any;
  const { data: activitiesData } = useActivities({ limit: 1 }) as any;
  const { data: accountsData } = useAccounts({ limit: 100 }) as any;
  const { data: contactsData } = useContacts({ limit: 100 }) as any;
  const { data: opportunitiesData } = useOpportunities({ limit: 100 }) as any;
  const { data: useCasesData } = useUseCases({ limit: 100 }) as any;
  const { data: pipelineData } = usePipelineSummary() as any;

  const scopedDescription = isManager
    ? 'Your team’s accounts, opportunities, Signals, Memory, and handoffs.'
    : 'Your accounts, opportunities, Signals, Memory, and handoffs.';
  const pendingHITL = ((hitlData?.data ?? []) as any[]).filter((r: any) => r.status === 'pending');
  const accounts: any[] = accountsData?.data ?? [];
  const contacts: any[] = contactsData?.data ?? [];
  const opportunities: any[] = opportunitiesData?.data ?? [];
  const useCases: any[] = useCasesData?.data ?? [];
  const signalGroups: any[] = signalGroupData?.data ?? [];
  const staleEntries: any[] = staleData?.stale_entries ?? staleData?.data ?? [];
  const nextStepMemory: any[] = nextStepMemoryData?.data ?? [];
  const nextStepOppIds = new Set(nextStepMemory.filter(entry => entry.subject_type === 'opportunity').map(entry => entry.subject_id).filter(Boolean));
  const accountTotal = Number(accountsData?.total ?? 0);
  const contactTotal = Number(contactsData?.total ?? 0);
  const openOpportunityTotal = Number(pipelineData?.count ?? opportunitiesData?.total ?? 0);
  const useCaseTotal = Number(useCasesData?.total ?? 0);
  const memoryTotal = Number(memoryData?.total ?? 0);
  const signalGroupTotal = Number(signalGroupData?.total ?? 0);
  const observationsTotal = Number(activitiesData?.total ?? 0);
  const openPipelineValue = Number(pipelineData?.total_value ?? 0);
  const openOpportunities = opportunities.filter(opp => !['closed_won', 'closed_lost'].includes(String(opp.stage ?? '')));
  const closingSoon = openOpportunities
    .map(opp => ({ ...opp, days_to_close: daysUntil(opp.close_date) }))
    .filter(opp => opp.days_to_close !== null && opp.days_to_close >= 0 && opp.days_to_close <= 30)
    .sort((a, b) => Number(a.days_to_close) - Number(b.days_to_close));
  const missingNextStep = openOpportunities.filter(opp => !nextStepOppIds.has(opp.id));
  const lowHealthOpps = openOpportunities.filter(opp => Number(opp.deal_health_score ?? 100) > 0 && Number(opp.deal_health_score ?? 100) < 60);
  const lowHealthAccounts = accounts.filter(account => Number(account.health_score ?? 100) > 0 && Number(account.health_score ?? 100) < 60);
  const lowHealthUseCases = useCases.filter(useCase => Number(useCase.health_score ?? 100) > 0 && Number(useCase.health_score ?? 100) < 60);
  const accountById = new Map(accounts.map(account => [account.id, account]));
  const contactById = new Map(contacts.map(contact => [contact.id, contact]));
  const opportunityById = new Map(opportunities.map(opp => [opp.id, opp]));
  const useCaseById = new Map(useCases.map(useCase => [useCase.id, useCase]));
  const recordName = (recordType: FocusRecordType, id?: string, fallback?: string) => {
    if (!id) return fallback;
    if (recordType === 'account') return accountById.get(id)?.name ?? fallback;
    if (recordType === 'contact') {
      const contact = contactById.get(id);
      const name = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') : '';
      return name || contact?.email || fallback;
    }
    if (recordType === 'opportunity') return opportunityById.get(id)?.name ?? fallback;
    if (recordType === 'use_case') return useCaseById.get(id)?.name ?? fallback;
    return fallback;
  };
  const recordAccountContext = (recordType: FocusRecordType, id?: string, fallbackName?: string) => {
    if (!id) return { account_id: undefined, account_name: fallbackName };
    if (recordType === 'account') return { account_id: id, account_name: accountById.get(id)?.name ?? fallbackName };
    if (recordType === 'contact') {
      const contact = contactById.get(id);
      return {
        account_id: contact?.account_id,
        account_name: contact?.account_name ?? contact?.company_name ?? fallbackName,
      };
    }
    if (recordType === 'opportunity') {
      const opp = opportunityById.get(id);
      return { account_id: opp?.account_id, account_name: opp?.account_name ?? fallbackName };
    }
    if (recordType === 'use_case') {
      const useCase = useCaseById.get(id);
      return { account_id: useCase?.account_id, account_name: useCase?.account_name ?? fallbackName };
    }
    return { account_id: undefined, account_name: fallbackName };
  };
  const makeOpenRecord = (recordType: FocusRecordType, id?: string) => {
    const drawerType = DRAWER_TYPE_BY_RECORD[recordType];
    return drawerType && id ? () => openDrawer(drawerType, id) : undefined;
  };

  const snapshot = [
    { label: 'Accounts', value: accountTotal.toLocaleString(), href: '/accounts', icon: Building2, color: ENTITY_COLORS.accounts },
    { label: 'Contacts', value: contactTotal.toLocaleString(), href: '/contacts', icon: UsersRound, color: ENTITY_COLORS.contacts },
    { label: 'Open Opps', value: openOpportunityTotal.toLocaleString(), href: '/opportunities', icon: Briefcase, color: ENTITY_COLORS.opportunities },
    { label: 'Use Cases', value: useCaseTotal.toLocaleString(), href: '/use-cases', icon: GitCompareArrows, color: ENTITY_COLORS.useCases },
    { label: 'Open Pipeline', value: formatMoney(openPipelineValue), href: '/opportunities', icon: DollarSign, color: ENTITY_COLORS.opportunities },
  ];

  const focusItems: FocusQueueItem[] = [
    ...pendingHITL.slice(0, 2).map(request => {
      const record = inferHandoffRecord(request);
      const recordType = record.record_type;
      const recordId = record.record_id;
      const recordNameValue = recordName(recordType, recordId, record.record_name);
      const relatedOpp = recordType === 'opportunity' && recordId ? opportunityById.get(recordId) : null;
      return {
        icon: Inbox,
        title: request.action_summary ?? request.title ?? 'Handoff needs a decision',
        detail: request.reason ?? 'Approve, reject, or route this policy-gated action.',
        href: '/handoffs',
        action: 'Resolve',
        tone: 'action' as const,
        queue_kind: 'handoff' as const,
        record_type: recordType,
        record_id: recordId,
        record_name: recordNameValue,
        record_detail: record.account_name ?? relatedOpp?.account_name,
        account_id: record.account_id ?? relatedOpp?.account_id,
        account_name: record.account_name ?? relatedOpp?.account_name,
        onOpenRecord: makeOpenRecord(recordType, recordId),
      };
    }),
    ...signalGroups.slice(0, 2).map(group => {
      const recordType = normalizeRecordType(group.subject_type);
      const accountContext = recordAccountContext(recordType, group.subject_id, group.subject_name);
      return {
        icon: Sparkles,
        title: group.title ?? group.normalized_claim ?? 'Signal needs attention',
        detail: `${Math.round(Number(group.aggregate_confidence ?? 0) * 100)}% trust · evidence is ready for review`,
        href: `/context?tab=signals&signal_group_id=${group.id}`,
        action: 'Review',
        tone: group.status === 'conflicting' || group.status === 'blocked' ? 'danger' as const : 'action' as const,
        queue_kind: 'signal' as const,
        record_type: recordType,
        record_id: group.subject_id,
        record_name: recordName(recordType, group.subject_id, group.subject_name ?? group.subject_type),
        record_detail: String(group.context_type ?? '').replace(/_/g, ' '),
        account_id: accountContext.account_id,
        account_name: accountContext.account_name,
        onOpenRecord: makeOpenRecord(recordType, group.subject_id),
      };
    }),
    ...staleEntries.slice(0, 1).map(entry => {
      const recordType = normalizeRecordType(entry.subject_type);
      const accountContext = recordAccountContext(recordType, entry.subject_id, entry.subject_name);
      return {
        icon: AlertCircle,
        title: entry.title ?? 'Memory needs review',
        detail: `${String(entry.context_type ?? 'Memory').replace(/_/g, ' ')} may be stale before an agent acts.`,
        href: '/context?tab=browser&stale=true',
        action: 'Review',
        tone: 'watch' as const,
        queue_kind: 'memory' as const,
        record_type: recordType,
        record_id: entry.subject_id,
        record_name: recordName(recordType, entry.subject_id, entry.subject_name ?? entry.subject_type),
        record_detail: String(entry.context_type ?? '').replace(/_/g, ' '),
        account_id: accountContext.account_id,
        account_name: accountContext.account_name,
        onOpenRecord: makeOpenRecord(recordType, entry.subject_id),
      };
    }),
    ...closingSoon.slice(0, 2).map(opp => ({
      icon: CalendarClock,
      title: `${opp.name ?? 'Opportunity'} closes ${opp.days_to_close === 0 ? 'today' : `in ${opp.days_to_close} days`}`,
      detail: `${opp.account_name ?? 'Account'} · ${formatMoney(Number(opp.amount ?? 0))} · ${String(opp.stage ?? 'open').replace(/_/g, ' ')}`,
      href: '/opportunities',
      action: 'Open Deal',
      tone: Number(opp.days_to_close) <= 7 ? 'danger' as const : 'watch' as const,
      queue_kind: 'opportunity' as const,
      record_type: 'opportunity' as const,
      record_id: opp.id,
      record_name: opp.name,
      record_detail: opp.account_name,
      account_id: opp.account_id,
      account_name: opp.account_name,
      onOpenRecord: makeOpenRecord('opportunity', opp.id),
    })),
    ...lowHealthOpps.slice(0, 1).map(opp => ({
      icon: HeartPulse,
      title: `${opp.name ?? 'Opportunity'} has low deal health`,
      detail: `Health ${opp.deal_health_score}/100 · ask the agent to prep risks and next action.`,
      href: '/agent',
      action: 'Ask Agent',
      tone: 'danger' as const,
      queue_kind: 'opportunity' as const,
      record_type: 'opportunity' as const,
      record_id: opp.id,
      record_name: opp.name,
      record_detail: opp.account_name,
      account_id: opp.account_id,
      account_name: opp.account_name,
      onOpenRecord: makeOpenRecord('opportunity', opp.id),
    })),
    ...missingNextStep.slice(0, 2).map(opp => ({
      icon: Target,
      title: `${opp.name ?? 'Opportunity'} is missing a next step`,
      detail: `${opp.account_name ?? 'Account'} needs confirmed Memory before follow-up or forecast work.`,
      href: '/context?tab=observations&add=context',
      action: 'Add Context',
      tone: 'watch' as const,
      queue_kind: 'opportunity' as const,
      record_type: 'opportunity' as const,
      record_id: opp.id,
      record_name: opp.name,
      record_detail: opp.account_name,
      account_id: opp.account_id,
      account_name: opp.account_name,
      onOpenRecord: makeOpenRecord('opportunity', opp.id),
    })),
    ...lowHealthAccounts.slice(0, 1).map(account => ({
      icon: Building2,
      title: `${account.name ?? 'Account'} health is low`,
      detail: `Health ${account.health_score}/100 · review Memory and recent activity.`,
      href: '/accounts',
      action: 'Review',
      tone: 'danger' as const,
      queue_kind: 'account' as const,
      record_type: 'account' as const,
      record_id: account.id,
      record_name: account.name,
      account_id: account.id,
      account_name: account.name,
      onOpenRecord: makeOpenRecord('account', account.id),
    })),
    ...lowHealthUseCases.slice(0, 1).map(useCase => ({
      icon: GitCompareArrows,
      title: `${useCase.name ?? 'Use case'} needs attention`,
      detail: `Health ${useCase.health_score}/100 · confirm adoption risk and next owner.`,
      href: '/use-cases',
      action: 'Review',
      tone: 'danger' as const,
      queue_kind: 'use_case' as const,
      record_type: 'use_case' as const,
      record_id: useCase.id,
      record_name: useCase.name,
      record_detail: useCase.account_name,
      account_id: useCase.account_id,
      account_name: useCase.account_name,
      onOpenRecord: makeOpenRecord('use_case', useCase.id),
    })),
  ];
  const focusTypeOptions: Array<{ value: FocusFilterType; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'account', label: 'Accounts' },
    { value: 'contact', label: 'Contacts' },
    { value: 'opportunity', label: 'Opportunities' },
    { value: 'use_case', label: 'Use Cases' },
    { value: 'handoff', label: 'Handoffs' },
  ];
  const selectedEntityType = focusTypeFilter !== 'all' && focusTypeFilter !== 'handoff' ? focusTypeFilter : null;
  const hasFocusFilters = focusTypeFilter !== 'all' || Boolean(focusRecordId);
  const filteredFocusItems = focusItems.filter(item => {
    if (focusTypeFilter !== 'all') {
      if (focusTypeFilter === 'handoff') {
        if (item.queue_kind !== 'handoff') return false;
      } else if (focusTypeFilter === 'account') {
        if (item.record_type !== 'account' && !item.account_id) return false;
      } else if (item.record_type !== focusTypeFilter) {
        return false;
      }
    }
    if (!focusRecordId || !selectedEntityType) return true;
    if (selectedEntityType === 'account') {
      return item.record_id === focusRecordId || item.account_id === focusRecordId;
    }
    return item.record_type === selectedEntityType && item.record_id === focusRecordId;
  });
  const visibleFocusItems = filteredFocusItems.slice(0, 7);

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Overview" icon={Brain} iconClassName="text-primary" description={scopedDescription} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-foreground">Book Snapshot</h2>
              <p className="text-sm text-muted-foreground">
                {isManager ? 'Team coverage at a glance.' : 'Your customer coverage at a glance.'}
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {memoryTotal.toLocaleString()} Memory · {signalGroupTotal.toLocaleString()} Signals · {observationsTotal.toLocaleString()} Raw Context
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {snapshot.map(item => (
              <SnapshotChip key={item.label} {...item} />
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-foreground">Focus Queue</h2>
                <p className="text-sm text-muted-foreground">The customer work most likely to need attention next.</p>
              </div>
              <ActNowLink icon={Bot} label="Ask Agent" href="/agent" primary variant="purple" />
            </div>
            <div className="mb-3 rounded-xl border border-border bg-background/60 p-2">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="flex flex-wrap gap-1">
                  {focusTypeOptions.map(option => {
                    const selected = focusTypeFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setFocusTypeFilter(option.value);
                          setFocusRecordId('');
                        }}
                        className={`h-8 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                          selected
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {selectedEntityType && (
                  <div className="min-w-0 flex-1 lg:max-w-xs">
                    <EntityCombobox
                      entityType={selectedEntityType}
                      value={focusRecordId}
                      onChange={setFocusRecordId}
                      placeholder={`Filter by ${RECORD_TYPE_META[selectedEntityType].label.toLowerCase()}`}
                      className="h-8 text-xs"
                    />
                  </div>
                )}
                {hasFocusFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setFocusTypeFilter('all');
                      setFocusRecordId('');
                    }}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Clear filters
                  </button>
                )}
              </div>
            </div>
            {visibleFocusItems.length > 0 ? (
              <div className="space-y-2">
                {visibleFocusItems.map((item, index) => (
                  <FocusQueueRow key={`${item.title}-${index}`} {...item} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-300">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{hasFocusFilters ? 'No queue items match these filters' : 'No urgent work in your queue'}</p>
                    <p className="mt-1 text-xs opacity-80">
                      {hasFocusFilters
                        ? 'Try another record or clear filters to see the full queue.'
                        : 'Signals, handoffs, close dates, and Memory health look clear for now.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h2 className="font-display text-base font-semibold text-foreground">Act Now</h2>
              <p className="mt-1 text-sm text-muted-foreground">Fast paths for common daily work.</p>
              <div className="mt-4 grid gap-2">
                <ActNowLink icon={PlusCircle} label="Add Context" href="/context?tab=observations&add=context" primary variant="context" />
                <ActNowLink icon={Bot} label="Ask Agent" href="/agent" variant="purple" />
                <ActNowLink icon={Brain} label="Review Signals" href="/context?tab=signals" />
                <ActNowLink icon={Inbox} label="Review Handoffs" href="/handoffs" />
                <ActNowLink icon={Briefcase} label="Open Opportunities" href="/opportunities" />
              </div>
            </div>

            {openOpportunityTotal > 0 && (
              <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-semibold text-foreground">Pipeline Pulse</h2>
                    <p className="text-sm text-muted-foreground">Deal motion in your scope.</p>
                  </div>
                  <Link to="/opportunities" className="text-xs font-semibold text-primary hover:underline">Open</Link>
                </div>
                <div className="grid gap-2">
                  <PipelinePulseItem icon={DollarSign} label="Open pipeline" value={formatMoney(openPipelineValue)} />
                  <PipelinePulseItem icon={CalendarClock} label="Closing in 30 days" value={closingSoon.length} tone={closingSoon.length > 0 ? 'watch' : 'default'} />
                  <PipelinePulseItem icon={HeartPulse} label="Low-health deals" value={lowHealthOpps.length} tone={lowHealthOpps.length > 0 ? 'danger' : 'default'} />
                </div>
              </div>
            )}
          </aside>
        </section>
      </div>
    </div>
  );
}

function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activationDismissed, setActivationDismissed] = useState(() => localStorage.getItem('crmy-activation-dismissed') === 'true');
  const [skippedActivationSteps, setSkippedActivationSteps] = useState<Record<string, boolean>>(readSkippedActivationSteps);
  const [snapshotExpanded, setSnapshotExpanded] = useState(() => localStorage.getItem('crmy-command-center-system-snapshot') === 'expanded');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: hitlData } = useHITLRequests() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memoryData } = useContextEntries({ memory_status: 'active', limit: 1 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memoryCoverageData } = useContextEntries({ memory_status: 'active', limit: 200 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signalData } = useContextEntries({ memory_status: 'signal', limit: 1 }) as any;
  const { data: signalGroupData } = useSignalGroups({ attention_only: true, limit: 1 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staleData } = useStaleContextEntries({ limit: 200 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: actorsData } = useActors({ limit: 200 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: activitiesData } = useActivities({ limit: 1 }) as any;
  const { data: accountsData } = useAccounts({ limit: 1 }) as any;
  const { data: contactsData } = useContacts({ limit: 1 }) as any;
  const { data: opportunitiesData } = useOpportunities({ limit: 1 }) as any;
  const { data: useCasesData } = useUseCases({ limit: 1 }) as any;
  const { data: writebacksData } = useSystemWritebacks({ limit: 50 }) as any;
  const { data: syncRunsData } = useSystemSyncRuns({ limit: 20 }) as any;
  const { data: dbInfo } = useDbConfig() as any;
  const { enabled: agentEnabled } = useAgentSettings();

  const hitlRequests: any[] = hitlData?.data ?? [];
  const pendingHITL = hitlRequests.filter((r: any) => r.status === 'pending');
  const memoryTotal: number = memoryData?.total ?? 0;
  const signalTotal: number = signalData?.total ?? 0;
  const signalGroupTotal: number = signalGroupData?.total ?? 0;
  const observationsTotal: number = activitiesData?.total ?? 0;
  const accountTotal = Number(accountsData?.total ?? 0);
  const contactTotal = Number(contactsData?.total ?? 0);
  const opportunityTotal = Number(opportunitiesData?.total ?? 0);
  const useCaseTotal = Number(useCasesData?.total ?? 0);
  const memoryCoverageEntries: any[] = memoryCoverageData?.data ?? [];
  const memoryBackedAccounts = new Set(memoryCoverageEntries.filter(entry => entry.subject_type === 'account').map(entry => entry.subject_id).filter(Boolean)).size;
  const memoryBackedOpportunities = new Set(memoryCoverageEntries.filter(entry => entry.subject_type === 'opportunity').map(entry => entry.subject_id).filter(Boolean)).size;
  const writebacks: any[] = writebacksData?.data ?? [];
  const syncRuns: any[] = syncRunsData?.data ?? [];
  const pendingWritebacks = writebacks.filter(writeback => ['approval_required', 'approved', 'pending', 'queued'].includes(String(writeback.status ?? '').toLowerCase())).length;
  const failedExternalOps = [
    ...writebacks.filter(writeback => ['failed', 'blocked', 'rejected'].includes(String(writeback.status ?? '').toLowerCase())),
    ...syncRuns.filter(run => ['failed', 'error'].includes(String(run.status ?? '').toLowerCase())),
  ].length;
  const staleCount: number = (staleData?.stale_entries ?? staleData?.data ?? []).length;
  const actors: any[] = actorsData?.data ?? [];
  const agents = actors.filter((a: any) => a.actor_type === 'agent');
  const activeAgents = agents.filter((a: any) => a.is_active);
  const dbConnected = Boolean(dbInfo?.database || dbInfo?.host);
  const sampleSeeded = Boolean(dbInfo?.sample_data?.seeded);
  const pgvectorEnabled = Boolean(dbInfo?.pgvector_enabled);
  const handoffReady = pendingHITL.length === 0;
  const activeTab = searchParams.get('tab') === 'health' ? 'health' : 'overview';
  const activationSteps = [
    {
      id: 'database',
      complete: dbConnected,
      icon: Database,
      title: dbConnected ? 'Database connected' : 'Connect database',
      detail: dbConnected ? 'Operational state is available.' : 'Choose local Postgres, Neon, Supabase, Lakebase, or RDS.',
      status: dbConnected ? 'ready' as const : 'action' as const,
      href: '/settings/database',
    },
    {
      id: 'sample-data',
      complete: sampleSeeded,
      icon: Layers,
      title: sampleSeeded ? 'Sample data loaded' : 'Load sample data',
      detail: sampleSeeded ? 'Demo records are available for evaluation.' : 'Seed demo records to try the workflow quickly.',
      status: sampleSeeded ? 'ready' as const : 'action' as const,
      href: '/settings/database',
    },
    {
      id: 'workspace-agent',
      complete: agentEnabled,
      icon: Bot,
      title: agentEnabled ? 'Workspace Agent enabled' : 'Configure Workspace Agent',
      detail: agentEnabled ? 'The app can reason over local customer context.' : 'Use a local or hosted model for extraction and agent work.',
      status: agentEnabled ? 'ready' as const : 'action' as const,
      href: '/settings/model',
    },
    {
      id: 'context-memory',
      complete: memoryTotal > 0 || signalTotal > 0,
      icon: Library,
      title: memoryTotal > 0 ? 'Memory exists' : signalTotal > 0 ? 'Signals exist' : 'Add Context',
      detail: memoryTotal > 0 ? `${memoryTotal} Current Memory ${memoryTotal === 1 ? 'entry is' : 'entries are'} available.` : 'Paste notes or transcripts so CRMy can find Signals and create Memory.',
      status: (memoryTotal > 0 || signalTotal > 0) ? 'ready' as const : 'action' as const,
      href: '/context?tab=observations&add=context',
    },
    {
      id: 'handoffs',
      complete: handoffReady,
      icon: ShieldCheck,
      title: 'Handoff loop ready',
      detail: pendingHITL.length > 0 ? `${pendingHITL.length} decisions need review.` : 'Agent escalations and human approvals appear here.',
      status: pendingHITL.length > 0 ? 'watch' as const : 'ready' as const,
      href: '/handoffs',
    },
    {
      id: 'pgvector',
      complete: pgvectorEnabled,
      icon: Brain,
      title: pgvectorEnabled ? 'Semantic context ready' : 'Enable pgvector',
      detail: pgvectorEnabled ? 'Vector search can retrieve related customer context.' : 'Keyword search works; pgvector improves retrieval.',
      status: pgvectorEnabled ? 'ready' as const : 'watch' as const,
      href: '/settings/database',
    },
  ];
  const activationTotal = activationSteps.length;
  const activationComplete = activationSteps.filter(step => step.complete || skippedActivationSteps[step.id]).length;
  const activationIsComplete = activationComplete === activationTotal;
  const coreSetupReady = dbConnected && agentEnabled && (sampleSeeded || memoryTotal > 0 || signalTotal > 0) && handoffReady;
  const showActivation = !coreSetupReady && !activationDismissed;
  const nextSetupSteps = activationSteps.filter(step => !step.complete && !skippedActivationSteps[step.id]).slice(0, 2);

  const hideActivation = () => {
    localStorage.setItem('crmy-activation-dismissed', 'true');
    setActivationDismissed(true);
  };

  const restoreActivation = () => {
    localStorage.removeItem('crmy-activation-dismissed');
    setActivationDismissed(false);
  };

  const toggleActivationSkip = (stepId: string) => {
    setSkippedActivationSteps(prev => {
      const next = { ...prev };
      if (next[stepId]) delete next[stepId];
      else next[stepId] = true;
      localStorage.setItem(ACTIVATION_SKIPPED_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const toggleSnapshotExpanded = () => {
    setSnapshotExpanded(prev => {
      const next = !prev;
      localStorage.setItem('crmy-command-center-system-snapshot', next ? 'expanded' : 'collapsed');
      return next;
    });
  };

  const attentionItems = [
    ...(signalGroupTotal > 0 ? [{
      icon: Sparkles,
      title: `${signalGroupTotal.toLocaleString()} Signal${signalGroupTotal === 1 ? '' : 's'} need attention`,
      detail: 'Promote trusted claims, review conflicts, or dismiss noise.',
      href: '/context?tab=signals',
      tone: 'action' as const,
    }] : []),
    ...(staleCount > 0 ? [{
      icon: AlertCircle,
      title: `${staleCount.toLocaleString()} Memory ${staleCount === 1 ? 'entry needs' : 'entries need'} review`,
      detail: 'Refresh or retire outdated customer context.',
      href: '/?tab=health',
      tone: 'watch' as const,
    }] : []),
    ...(pendingHITL.length > 0 ? [{
      icon: ShieldCheck,
      title: `${pendingHITL.length.toLocaleString()} handoff${pendingHITL.length === 1 ? '' : 's'} pending`,
      detail: 'Approve, reject, or route agent decisions.',
      href: '/handoffs',
      tone: 'action' as const,
    }] : []),
    ...(!pgvectorEnabled ? [{
      icon: Brain,
      title: 'Semantic search is not enabled',
      detail: 'Keyword search works; pgvector improves context retrieval.',
      href: '/settings/database',
      tone: 'watch' as const,
    }] : []),
    ...(!agentEnabled ? [{
      icon: Bot,
      title: 'Workspace Agent is not configured',
      detail: 'Enable private reasoning over customer context.',
      href: '/settings/model',
      tone: 'action' as const,
    }] : []),
    ...(memoryTotal === 0 && signalTotal === 0 ? [{
      icon: Library,
      title: 'No context has been added yet',
      detail: 'Paste notes, transcripts, emails, or research to create Signals and Memory.',
      href: '/context',
      tone: 'action' as const,
    }] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={activeTab === 'health' ? 'Memory Health' : 'Overview'}
        icon={activeTab === 'health' ? ShieldCheck : Brain}
        iconClassName="text-primary"
        description={activeTab === 'health'
          ? 'Review Memory that needs attention before agents rely on it.'
          : 'Watch raw context become trusted Memory that agents retrieve into Active Context.'}
      />

      <div className="flex items-center justify-between gap-3 overflow-x-auto border-b border-border px-4 pt-4 md:px-6">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSearchParams({ tab: 'overview' })}
            className={`flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium -mb-px transition-colors ${
              activeTab === 'overview'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Command Center
          </button>
          <button
            type="button"
            onClick={() => setSearchParams({ tab: 'health' })}
            className={`flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium -mb-px transition-colors ${
              activeTab === 'health'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Memory Health
          </button>
        </div>
        {activeTab === 'overview' && !showActivation && (
          <button
            type="button"
            onClick={restoreActivation}
            className="mb-1 inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Show setup
          </button>
        )}
      </div>

      {activeTab === 'health' ? (
        <ContextGovernance />
      ) : (
      <div className="flex-1 overflow-y-auto p-4 pb-24 md:p-6 md:pb-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}>
          <div className="mb-4 rounded-2xl border border-border bg-surface p-4 shadow-sm md:mb-6 md:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <h2 className="font-display text-lg font-bold text-foreground">Command Center</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Is CRMy set up, is context flowing, and what needs action?
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:min-w-[36rem]">
                <CommandStatusChip
                  icon={CheckCircle2}
                  label="Setup"
                  value={coreSetupReady ? 'Ready' : `${activationComplete}/${activationTotal} ready`}
                  tone={coreSetupReady ? 'ready' : 'action'}
                />
                <CommandStatusChip
                  icon={Layers}
                  label="Context Flow"
                  value={`${observationsTotal.toLocaleString()} → ${signalGroupTotal.toLocaleString()} → ${memoryTotal.toLocaleString()}`}
                  tone={memoryTotal > 0 ? 'ready' : observationsTotal > 0 || signalGroupTotal > 0 ? 'watch' : 'action'}
                />
                <CommandStatusChip
                  icon={Inbox}
                  label="Action Boundary"
                  value={pendingHITL.length > 0 ? `${pendingHITL.length} pending` : 'Clear'}
                  tone={pendingHITL.length > 0 ? 'action' : 'ready'}
                />
              </div>
            </div>

            {showActivation && (
              <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Start here
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Complete the next step or expand setup details for the full checklist.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!sampleSeeded && <SeedSampleDataButton />}
                    <button
                      type="button"
                      onClick={hideActivation}
                      className="h-8 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      Hide
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {(nextSetupSteps.length > 0 ? nextSetupSteps : activationSteps.slice(0, 1)).map(step => (
                    <SetupStep
                      key={step.id}
                      icon={step.icon}
                      title={step.title}
                      detail={step.detail}
                      status={step.status}
                      href={step.href}
                      skipped={Boolean(skippedActivationSteps[step.id])}
                      onSkipToggle={() => toggleActivationSkip(step.id)}
                    />
                  ))}
                </div>
                <details className="group mt-3">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                    Setup details
                  </summary>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {activationSteps.map(step => (
                      <SetupStep
                        key={step.id}
                        icon={step.icon}
                        title={step.title}
                        detail={step.detail}
                        status={step.status}
                        href={step.href}
                        skipped={Boolean(skippedActivationSteps[step.id])}
                        onSkipToggle={() => toggleActivationSkip(step.id)}
                      />
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
          <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-sm md:mb-6 md:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display font-bold text-foreground">Needs Attention</h2>
                <p className="mt-1 text-sm text-muted-foreground">Ranked next steps for the workspace.</p>
              </div>
              {attentionItems.length === 0 && (
                <Link to="/context?tab=observations&add=context" className="hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-primary hover:bg-primary/10 md:inline-flex">
                  Add Context
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
            {attentionItems.length > 0 ? (
              <div className="space-y-2">
                {attentionItems.map(item => (
                  <AttentionItem key={item.title} {...item} />
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">No action needed right now</p>
                  <p className="text-xs opacity-80">Signals, Memory, handoffs, and search readiness are in good shape.</p>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}>
          <div className="mb-4 rounded-2xl border border-border bg-surface p-4 shadow-sm md:mb-6 md:p-5">
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-display font-bold text-foreground">Context Flow</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Raw Context becomes Signals, trusted Memory, and governed Handoffs.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link to="/automations" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Zap className="h-3.5 w-3.5" />
                  Automations
                </Link>
                <Link to="/settings/systems" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Server className="h-3.5 w-3.5" />
                  Systems of Record
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] xl:items-center">
              <LifecycleStripStep
                icon={FileText}
                title="Raw Context"
                value={observationsTotal}
                href="/context?tab=observations&add=context"
                color="bg-sky-500/15 text-sky-500"
              />
              <ArrowRight className="hidden h-4 w-4 text-muted-foreground/40 xl:block" />
              <LifecycleStripStep
                icon={Sparkles}
                title="Signals"
                value={signalGroupTotal}
                href="/context?tab=signals"
                color="bg-violet-500/15 text-violet-500"
              />
              <ArrowRight className="hidden h-4 w-4 text-muted-foreground/40 xl:block" />
              <LifecycleStripStep
                icon={Library}
                title="Memory"
                value={memoryTotal}
                href="/context"
                color="bg-emerald-500/15 text-emerald-500"
              />
              <ArrowRight className="hidden h-4 w-4 text-muted-foreground/40 xl:block" />
              <LifecycleStripStep
                icon={Inbox}
                title="Handoffs"
                value={pendingHITL.length}
                href="/handoffs"
                color={`${ENTITY_COLORS.assignments.bg} ${ENTITY_COLORS.assignments.text}`}
              />
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display font-bold text-foreground">System Snapshot</h2>
                <p className="mt-1 text-sm text-muted-foreground">The essentials behind safe agent operation.</p>
              </div>
              <button
                type="button"
                onClick={toggleSnapshotExpanded}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {snapshotExpanded ? 'Hide details' : 'View details'}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${snapshotExpanded ? 'rotate-180' : ''}`} />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
              <CoverageItem
                icon={Building2}
                title="Memory coverage"
                value={`${memoryBackedAccounts + memoryBackedOpportunities}/${accountTotal + opportunityTotal}`}
                detail="Accounts and opportunities with confirmed Memory."
                href="/context"
                iconClassName={`${ENTITY_COLORS.context.bg} ${ENTITY_COLORS.context.text}`}
              />
              <CoverageItem
                icon={GitCompareArrows}
                title="Pending writebacks"
                value={pendingWritebacks.toLocaleString()}
                detail="Governed updates waiting for approval or execution."
                href="/settings/systems"
                iconClassName={`${ENTITY_COLORS.workflows.bg} ${ENTITY_COLORS.workflows.text}`}
                valueClassName={pendingWritebacks > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}
              />
              <ReadinessItem
                icon={Bot}
                title="Workspace Agent"
                value={agentEnabled ? 'Enabled' : 'Configure'}
                detail={agentEnabled ? 'Private reasoning can use local context.' : 'Configure a model for extraction and agent work.'}
                href="/settings/model"
                ready={agentEnabled}
              />
              <ReadinessItem
                icon={Brain}
                title="Semantic retrieval"
                value={pgvectorEnabled ? 'Enabled' : 'Keyword'}
                detail={pgvectorEnabled ? 'Semantic search can find related context.' : 'Keyword search works; pgvector improves recall.'}
                href="/settings/database"
                ready={pgvectorEnabled}
              />
            </div>
            {snapshotExpanded && (
              <div className="mt-3 grid grid-cols-1 gap-2 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-4">
                <CoverageItem
                  icon={Building2}
                  title="Accounts"
                  value={accountTotal.toLocaleString()}
                  detail={`${memoryBackedAccounts} with confirmed Memory.`}
                  href="/accounts"
                  iconClassName={`${ENTITY_COLORS.accounts.bg} ${ENTITY_COLORS.accounts.text}`}
                />
                <CoverageItem
                  icon={UsersRound}
                  title="Contacts"
                  value={contactTotal.toLocaleString()}
                  detail="Visible customer contacts."
                  href="/contacts"
                  iconClassName={`${ENTITY_COLORS.contacts.bg} ${ENTITY_COLORS.contacts.text}`}
                />
                <CoverageItem
                  icon={Briefcase}
                  title="Opportunities"
                  value={opportunityTotal.toLocaleString()}
                  detail={`${memoryBackedOpportunities} with confirmed Memory.`}
                  href="/opportunities"
                  iconClassName={`${ENTITY_COLORS.opportunities.bg} ${ENTITY_COLORS.opportunities.text}`}
                />
                <CoverageItem
                  icon={Target}
                  title="Use Cases"
                  value={useCaseTotal.toLocaleString()}
                  detail="Customer outcomes and deployments."
                  href="/use-cases"
                  iconClassName={`${ENTITY_COLORS.useCases.bg} ${ENTITY_COLORS.useCases.text}`}
                />
                <ReadinessItem
                  icon={Database}
                  title="State store"
                  value={dbConnected ? 'Ready' : 'Setup'}
                  detail={dbConnected ? 'Operational state is available.' : 'Connect a local or hosted Postgres database.'}
                  href="/settings/database"
                  ready={dbConnected}
                />
                <ReadinessItem
                  icon={UsersRound}
                  title="Active agents"
                  value={`${activeAgents.length} active`}
                  detail={activeAgents.length > 0 ? 'Agents are registered and scoped.' : 'Add or approve agents before production use.'}
                  href="/settings/actors"
                  ready={activeAgents.length > 0}
                />
                <CoverageItem
                  icon={Server}
                  title="External issues"
                  value={failedExternalOps.toLocaleString()}
                  detail="Failed sync or writeback operations needing review."
                  href="/operations"
                  iconClassName={`${ENTITY_COLORS.operations.bg} ${ENTITY_COLORS.operations.text}`}
                  valueClassName={failedExternalOps > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}
                />
                <CoverageItem
                  icon={ShieldCheck}
                  title="Memory review"
                  value={staleCount.toLocaleString()}
                  detail="Stale or weak Memory needing attention."
                  href="/?tab=health"
                  iconClassName={`${ENTITY_COLORS.context.bg} ${ENTITY_COLORS.context.text}`}
                  valueClassName={staleCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}
                />
              </div>
            )}
          </div>
        </motion.div>
      </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const role = getUser()?.role;
  if (role !== 'admin' && role !== 'owner') return <ScopedOverviewDashboard />;
  return <AdminDashboard />;
}
