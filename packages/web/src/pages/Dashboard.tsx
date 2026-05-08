// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ContextBrowser } from '@/components/crm/ContextBrowser';
import { GraphTab } from './GraphExplorerPage';
import { TopBar } from '@/components/layout/TopBar';
import { ActivityFeed } from '@/components/crm/CrmWidgets';
import { SeedSampleDataButton } from '@/components/crm/OnboardingEmptyState';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { useHITLRequests, useResolveHITL, useContextEntries, useActors, useDbConfig } from '@/api/hooks';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  Bot,
  UsersRound,
  Library,
  Inbox,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Clock,
  Layers,
  Brain,
  Network,
  Database,
  Sparkles,
  ArrowUpRight,
  X,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

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

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  href,
  delay,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  color: string;
  href: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <Link
        to={href}
        className="flex items-start gap-3 p-4 rounded-2xl bg-card border border-border shadow-sm hover:shadow-md hover:border-border/80 transition-all press-scale group"
      >
        <div className={`w-9 h-9 rounded-xl ${color} flex items-center justify-center flex-shrink-0 mt-0.5`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          <p className="text-2xl font-display font-bold text-foreground leading-tight">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground ml-auto mt-1 transition-colors" />
      </Link>
    </motion.div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'overview';
  const [activityWindow, setActivityWindow] = useState<'today' | 'week'>('today');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [activationDismissed, setActivationDismissed] = useState(() => localStorage.getItem('crmy-activation-dismissed') === 'true');
  const [skippedActivationSteps, setSkippedActivationSteps] = useState<Record<string, boolean>>(readSkippedActivationSteps);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: hitlData } = useHITLRequests() as any;
  const resolveHITL = useResolveHITL();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contextData } = useContextEntries({ limit: 1 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staleData } = useContextEntries({ is_current: false, limit: 200 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: actorsData } = useActors({ limit: 200 }) as any;
  const { data: dbInfo } = useDbConfig() as any;
  const { enabled: agentEnabled } = useAgentSettings();

  const hitlRequests: any[] = hitlData?.data ?? [];
  const pendingHITL = hitlRequests.filter((r: any) => r.status === 'pending');
  const contextTotal: number = contextData?.total ?? 0;
  const staleCount: number = staleData?.data?.length ?? 0;
  const actors: any[] = actorsData?.data ?? [];
  const activeActors = actors.filter((a: any) => a.is_active);
  const agents = actors.filter((a: any) => a.actor_type === 'agent');
  const dbConnected = Boolean(dbInfo?.database || dbInfo?.host);
  const sampleSeeded = Boolean(dbInfo?.sample_data?.seeded);
  const pgvectorEnabled = Boolean(dbInfo?.pgvector_enabled);
  const handoffReady = pendingHITL.length === 0;
  const activationSteps = [
    { id: 'database', complete: dbConnected },
    { id: 'sample-data', complete: sampleSeeded },
    { id: 'pgvector', complete: pgvectorEnabled },
    { id: 'workspace-agent', complete: agentEnabled },
    { id: 'context-memory', complete: contextTotal > 0 },
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

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Overview"
        icon={Brain}
        iconClassName="text-primary"
        description="Operational state, customer context, scoped agents, handoffs, and reliability at a glance."
      />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 md:px-6 pt-4 border-b border-border pb-0">
        <button
          onClick={() => setSearchParams({})}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'overview' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Brain className="w-3.5 h-3.5" /> Status
        </button>
        <button
          onClick={() => setSearchParams({ tab: 'knowledge' })}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'knowledge' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Library className="w-3.5 h-3.5" /> Knowledge
        </button>
        <button
          onClick={() => setSearchParams({ tab: 'graph' })}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'graph' ? 'border-[#0ea5e9] text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Network className="w-3.5 h-3.5" /> Memory Graph
        </button>
      </div>

      {activeTab === 'knowledge' ? (
        <ContextBrowser />
      ) : activeTab === 'graph' ? (
        <GraphTab />
      ) : (
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
        {!showActivation && activationIsComplete && (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={restoreActivation}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Show setup
            </button>
          </div>
        )}

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
                  title={contextTotal > 0 ? 'Context memory exists' : 'Add first context'}
                  detail={contextTotal > 0 ? `${contextTotal} context entries available.` : 'Paste notes or add a manual memory for a customer object.'}
                  status={contextTotal > 0 ? 'ready' : 'action'}
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

        {/* Stat row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-4 md:mb-6">
          <StatCard
            icon={Inbox}
            label="Open handoffs"
            value={pendingHITL.length}
            sub={pendingHITL.length > 0 ? 'needs your review' : 'all clear'}
            color="bg-amber-500/15 text-amber-500"
            href="/handoffs"
            delay={0.04}
          />
          <StatCard
            icon={Layers}
            label="Context entries"
            value={contextTotal}
            sub={staleCount > 0 ? `${staleCount} stale` : 'all current'}
            color="bg-[#0ea5e9]/15 text-[#0ea5e9]"
            href="/context"
            delay={0.07}
          />
          <StatCard
            icon={UsersRound}
            label="Active actors"
            value={activeActors.length}
            sub={actors.length > 0 ? `of ${actors.length} registered` : 'none registered'}
            color="bg-[#6366f1]/15 text-[#6366f1]"
            href="/settings/agents"
            delay={0.1}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-4 md:space-y-5">

            {/* Pending approvals card */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display font-bold text-foreground flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-destructive" />
                    Pending handoffs
                  </h2>
                  {pendingHITL.length > 0 && (
                    <Link to="/handoffs" className="text-xs text-primary hover:underline flex items-center gap-1">
                      View all <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}
                </div>

                {pendingHITL.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
                    <p className="text-sm font-medium text-foreground">No pending approvals</p>
                    <p className="text-xs text-muted-foreground mt-1">Your agents are running autonomously</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingHITL.slice(0, 3).map((r: any) => (
                      <div key={r.id} className="rounded-xl border border-border bg-surface p-3 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">{r.action_type}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {r.agent_id ?? r.created_by ?? 'agent'}
                          </span>
                          <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {timeAgo(r.created_at)}
                          </span>
                        </div>
                        <p className="text-sm text-foreground line-clamp-2">{r.action_summary}</p>
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="Note (optional)"
                            value={notes[r.id] ?? ''}
                            onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                            className="flex-1 h-7 text-xs"
                          />
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => resolveHITL.mutate({ id: r.id, status: 'rejected', note: notes[r.id] })}
                            disabled={resolveHITL.isPending}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => resolveHITL.mutate({ id: r.id, status: 'approved', note: notes[r.id] })}
                            disabled={resolveHITL.isPending}
                          >
                            Approve
                          </Button>
                        </div>
                      </div>
                    ))}
                    {pendingHITL.length > 3 && (
                      <button
                        onClick={() => navigate('/handoffs')}
                        className="w-full text-xs text-primary hover:underline py-1"
                      >
                        +{pendingHITL.length - 3} more — view all handoffs
                      </button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>

            {/* Agent activity feed */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display font-bold text-foreground">Agent activity</h3>
                  <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
                    <button
                      onClick={() => setActivityWindow('today')}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${activityWindow === 'today' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Today
                    </button>
                    <button
                      onClick={() => setActivityWindow('week')}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${activityWindow === 'week' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      This Week
                    </button>
                  </div>
                </div>
                <ActivityFeed limit={8} filterWindow={activityWindow} />
              </div>
            </motion.div>
          </div>

          {/* Right column */}
          <div className="space-y-4 md:space-y-5">

            {/* Active agents */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
              <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display font-bold text-foreground flex items-center gap-2">
                    <Bot className="w-4 h-4 text-[#6366f1]" />
                    Agents
                  </h3>
                  <Link to="/settings/agents" className="text-xs text-primary hover:underline flex items-center gap-1">
                    Manage <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
                {agents.length === 0 ? (
                  <div className="text-center py-6">
                    <Bot className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No agents registered yet.</p>
                    <Link to="/settings/agents" className="text-xs text-primary hover:underline mt-1 inline-block">
                      Register your first agent
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {agents.slice(0, 5).map((agent: any) => (
                      <div key={agent.id} className="flex items-center gap-2.5 py-1.5">
                        <div className="w-7 h-7 rounded-lg bg-[#6366f1]/15 flex items-center justify-center flex-shrink-0">
                          <Bot className="w-3.5 h-3.5 text-[#6366f1]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{agent.display_name}</p>
                          {agent.agent_model && (
                            <p className="text-xs text-muted-foreground truncate">{agent.agent_model}</p>
                          )}
                        </div>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${agent.is_active ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />
                      </div>
                    ))}
                    {agents.length > 5 && (
                      <Link to="/settings/agents" className="text-xs text-muted-foreground hover:text-primary block text-center pt-1">
                        +{agents.length - 5} more
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </motion.div>

            {/* Context health */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.11 }}>
              <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display font-bold text-foreground flex items-center gap-2">
                    <Library className="w-4 h-4 text-[#0ea5e9]" />
                    Context health
                  </h3>
                  <Link to="/context" className="text-xs text-primary hover:underline flex items-center gap-1">
                    Browse <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Total entries</span>
                    <span className="text-sm font-bold text-foreground">{contextTotal}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      {staleCount > 0 && <AlertCircle className="w-3 h-3 text-destructive" />}
                      Stale / expired
                    </span>
                    <span className={`text-sm font-bold ${staleCount > 0 ? 'text-destructive' : 'text-foreground'}`}>
                      {staleCount}
                    </span>
                  </div>
                  {staleCount > 0 && (
                    <Link
                      to="/context"
                      className="flex items-center gap-1 text-xs text-destructive hover:underline"
                    >
                      <AlertCircle className="w-3 h-3" />
                      Review stale entries
                    </Link>
                  )}
                  {contextTotal === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Agents write context entries after each interaction.
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
