// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { ContextGovernance } from '@/components/crm/ContextGovernance';
import { SeedSampleDataButton } from '@/components/crm/OnboardingEmptyState';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import {
  useAccounts,
  useActors,
  useActivities,
  useContextEntries,
  useDbConfig,
  useHITLRequests,
  useOpportunities,
  useSignalGroups,
  useStaleContextEntries,
  useSystemSyncRuns,
  useSystemWritebacks,
} from '@/api/hooks';
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
} from 'lucide-react';

const ACTIVATION_SKIPPED_STORAGE_KEY = 'crmy-activation-skipped-steps';

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

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activationDismissed, setActivationDismissed] = useState(() => localStorage.getItem('crmy-activation-dismissed') === 'true');
  const [skippedActivationSteps, setSkippedActivationSteps] = useState<Record<string, boolean>>(readSkippedActivationSteps);

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
  const { data: opportunitiesData } = useOpportunities({ limit: 1 }) as any;
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
  const opportunityTotal = Number(opportunitiesData?.total ?? 0);
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
    { id: 'database', complete: dbConnected },
    { id: 'sample-data', complete: sampleSeeded },
    { id: 'pgvector', complete: pgvectorEnabled },
    { id: 'workspace-agent', complete: agentEnabled },
    { id: 'context-memory', complete: memoryTotal > 0 },
    { id: 'handoffs', complete: handoffReady },
  ];
  const activationTotal = activationSteps.length;
  const activationComplete = activationSteps.filter(step => step.complete || skippedActivationSteps[step.id]).length;
  const activationIsComplete = activationComplete === activationTotal;
  const showActivation = !activationDismissed || !activationIsComplete;

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
        {activeTab === 'overview' && !showActivation && activationIsComplete && (
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
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
        {/* Activation checklist */}
        {showActivation && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}>
            <div className="mb-4 md:mb-6 rounded-2xl border border-border bg-surface p-4 md:p-5 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
                <div>
                  <h2 className="font-display font-bold text-foreground flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    Activate CRMy
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Follow the path from stored state to agent action, or skip anything that does not apply to this workspace.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    activationIsComplete
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {activationIsComplete && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {activationComplete}/{activationTotal} ready
                  </span>
                  {!sampleSeeded && <SeedSampleDataButton />}
                  {activationIsComplete && (
                    <button
                      onClick={hideActivation}
                      className="h-9 px-3 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      Hide setup
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                <SetupStep
                  icon={Database}
                  title={dbConnected ? 'Database connected' : 'Connect database'}
                  detail={dbConnected ? 'Operational state is available.' : 'Choose local Postgres, Neon, Supabase, Lakebase, or RDS.'}
                  status={dbConnected ? 'ready' : 'action'}
                  href="/settings/database"
                  skipped={Boolean(skippedActivationSteps.database)}
                  onSkipToggle={() => toggleActivationSkip('database')}
                />
                <SetupStep
                  icon={Layers}
                  title={sampleSeeded ? 'Sample data loaded' : 'Load sample data'}
                  detail={sampleSeeded ? 'Demo records are available for evaluation.' : 'Seed demo objects to try briefings and context search quickly.'}
                  status={sampleSeeded ? 'ready' : 'action'}
                  href="/settings/database"
                  skipped={Boolean(skippedActivationSteps['sample-data'])}
                  onSkipToggle={() => toggleActivationSkip('sample-data')}
                />
                <SetupStep
                  icon={Brain}
                  title={pgvectorEnabled ? 'Semantic context ready' : 'Enable pgvector'}
                  detail={pgvectorEnabled ? 'Vector search can retrieve related customer context.' : 'Keyword search still works; pgvector unlocks semantic retrieval.'}
                  status={pgvectorEnabled ? 'ready' : 'watch'}
                  href="/settings/database"
                  skipped={Boolean(skippedActivationSteps.pgvector)}
                  onSkipToggle={() => toggleActivationSkip('pgvector')}
                />
                <SetupStep
                  icon={Bot}
                  title={agentEnabled ? 'Workspace Agent enabled' : 'Configure Workspace Agent'}
                  detail={agentEnabled ? 'The app can reason over local customer context.' : 'Use a local or hosted model for private workspace reasoning.'}
                  status={agentEnabled ? 'ready' : 'action'}
                  href="/settings/model"
                  skipped={Boolean(skippedActivationSteps['workspace-agent'])}
                  onSkipToggle={() => toggleActivationSkip('workspace-agent')}
                />
                <SetupStep
                  icon={Library}
                  title={memoryTotal > 0 ? 'Memory exists' : 'Add Context'}
                  detail={memoryTotal > 0 ? `${memoryTotal} Current Memory ${memoryTotal === 1 ? 'entry is' : 'entries are'} available.` : 'Paste notes or transcripts so CRMy can find Signals and create high-confidence Memory.'}
                  status={memoryTotal > 0 ? 'ready' : 'action'}
                  href="/context"
                  skipped={Boolean(skippedActivationSteps['context-memory'])}
                  onSkipToggle={() => toggleActivationSkip('context-memory')}
                />
                <SetupStep
                  icon={ShieldCheck}
                  title="Handoff loop ready"
                  detail={pendingHITL.length > 0 ? `${pendingHITL.length} decisions need review.` : 'Agent escalations and human approvals appear here.'}
                  status={pendingHITL.length > 0 ? 'watch' : 'ready'}
                  href="/handoffs"
                  skipped={Boolean(skippedActivationSteps.handoffs)}
                  onSkipToggle={() => toggleActivationSkip('handoffs')}
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* Context engine flow */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }}>
          <div className="mb-4 md:mb-6 rounded-2xl border border-border bg-surface p-4 md:p-5 shadow-sm">
            <div className="mb-4">
              <div>
                <h2 className="font-display font-bold text-foreground">Context Engine Flow</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Raw Context creates Signals. Trusted Signals become Memory. Agents retrieve Memory into Active Context before taking safe action.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
              <FlowStep
                icon={FileText}
                title="Raw Context"
                value={observationsTotal}
                detail="Calls, notes, transcripts, emails, and system updates before extraction."
                action="View Sources"
                href="/context?tab=observations"
                color="bg-sky-500/15 text-sky-500"
              />
              <ArrowRight className="hidden h-4 w-4 self-center text-muted-foreground/40 md:block" />
              <FlowStep
                icon={Sparkles}
                title="Signals"
                value={signalGroupTotal}
                detail="Inferred customer context with confidence and evidence."
                action="Review Signals"
                href="/context?tab=signals"
                color="bg-violet-500/15 text-violet-500"
              />
              <ArrowRight className="hidden h-4 w-4 self-center text-muted-foreground/40 md:block" />
              <FlowStep
                icon={Library}
                title="Memory"
                value={memoryTotal}
                detail="Confirmed context agents can retrieve into Active Context."
                action="View Memory"
                href="/context"
                color="bg-emerald-500/15 text-emerald-500"
              />
              <ArrowRight className="hidden h-4 w-4 self-center text-muted-foreground/40 md:block" />
              <FlowStep
                icon={Inbox}
                title="Handoffs"
                value={pendingHITL.length}
                detail="Human review for approvals, escalations, and governed agent decisions."
                action="Review Handoffs"
                href="/handoffs"
                color={`${ENTITY_COLORS.assignments.bg} ${ENTITY_COLORS.assignments.text}`}
              />
            </div>
            <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-card/70 px-3 py-2.5 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
              <p>
                Take safe action from trusted Memory, or write back to systems of record through governed workflows.
              </p>
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
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}>
          <div className="mb-4 md:mb-6 rounded-2xl border border-border bg-surface p-4 md:p-5 shadow-sm">
            <div className="mb-3">
              <h2 className="font-display font-bold text-foreground">Operational Coverage</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Where trusted Memory and governed writebacks are supporting revenue work.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
              <CoverageItem
                icon={Building2}
                title="Accounts with Memory"
                value={`${memoryBackedAccounts}/${accountTotal}`}
                detail="Account records with confirmed Memory attached."
                href="/accounts"
                iconClassName={`${ENTITY_COLORS.accounts.bg} ${ENTITY_COLORS.accounts.text}`}
              />
              <CoverageItem
                icon={Briefcase}
                title="Opps with Memory"
                value={`${memoryBackedOpportunities}/${opportunityTotal}`}
                detail="Deals with confirmed Memory agents can use."
                href="/opportunities"
                iconClassName={`${ENTITY_COLORS.opportunities.bg} ${ENTITY_COLORS.opportunities.text}`}
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
              <CoverageItem
                icon={Server}
                title="External issues"
                value={failedExternalOps.toLocaleString()}
                detail="Failed sync or writeback operations needing review."
                href="/operations"
                iconClassName={`${ENTITY_COLORS.operations.bg} ${ENTITY_COLORS.operations.text}`}
                valueClassName={failedExternalOps > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}
              />
            </div>
          </div>
        </motion.div>

        {/* Needs attention */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <div className="mb-4 md:mb-6 rounded-2xl border border-border bg-card p-4 md:p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display font-bold text-foreground">Needs Attention</h2>
                <p className="mt-1 text-sm text-muted-foreground">The highest-value next steps for this workspace.</p>
              </div>
              {attentionItems.length === 0 && (
                <Link to="/context" className="hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-primary hover:bg-primary/10 md:inline-flex">
                  Add Context
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
            {attentionItems.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
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

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <div className="rounded-2xl border border-border bg-surface p-4 md:p-5 shadow-sm">
            <div className="mb-3">
              <h2 className="font-display font-bold text-foreground">Agent Readiness</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A quick check that CRMy has the basics needed to keep agents grounded in customer context.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
              <ReadinessItem
                icon={Database}
                title="State store"
                value={dbConnected ? 'Ready' : 'Setup'}
                detail={dbConnected ? 'Operational state is available.' : 'Connect a local or hosted Postgres database.'}
                href="/settings/database"
                ready={dbConnected}
              />
              <ReadinessItem
                icon={Brain}
                title="Retrieval"
                value={pgvectorEnabled ? 'Semantic' : 'Keyword'}
                detail={pgvectorEnabled ? 'Semantic search can find related context.' : 'Keyword search is working; pgvector improves recall.'}
                href="/settings/database"
                ready={pgvectorEnabled}
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
                icon={UsersRound}
                title="Actors"
                value={`${activeAgents.length} active`}
                detail={activeAgents.length > 0 ? 'Agents are registered and scoped.' : 'Add or approve agents before production use.'}
                href="/settings/actors"
                ready={activeAgents.length > 0}
              />
            </div>
          </div>
        </motion.div>
      </div>
      )}
    </div>
  );
}
