// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActionContext, useBriefingSummary } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { ArrowLeft, FileText, ChevronDown, ChevronUp, AlertTriangle, ClipboardList, Brain, Phone, Mail, Calendar, Monitor, CheckSquare, Activity, Swords, Sparkles, Loader2, Network, Gauge, EyeOff, Bot, CheckCircle2 } from 'lucide-react';
import { ACTIVITY_COLORS } from './GraphSidebar';
import { TYPE_COLORS } from './ContextPanel';
import { toast } from '@/components/ui/use-toast';
import { ActionReadinessPanel } from './ActionReadinessPanel';

interface BriefingPanelProps {
  subjectType: string;
  subjectId: string;
  subjectName?: string;
  onClose: () => void;
}

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  call:          Phone,
  email:         Mail,
  meeting:       Calendar,
  note:          FileText,
  task:          CheckSquare,
  demo:          Monitor,
  proposal:      FileText,
  research:      FileText,
  status_update: Activity,
};

type ContextRadius = 'direct' | 'adjacent' | 'account_wide';
type TokenBudget = 'none' | 'compact' | 'standard' | 'deep';

const RADIUS_OPTIONS: Array<{ value: ContextRadius; label: string; hint: string }> = [
  { value: 'direct', label: 'Direct', hint: 'Only this record' },
  { value: 'adjacent', label: 'Adjacent', hint: 'Related customer state' },
  { value: 'account_wide', label: 'Account-wide', hint: 'Full account context' },
];

const TOKEN_BUDGETS: Record<TokenBudget, { label: string; value?: number; hint: string }> = {
  none:     { label: 'Full',     hint: 'No budget cap' },
  compact:  { label: 'Compact',  value: 900,  hint: 'Small agent window' },
  standard: { label: 'Standard', value: 1800, hint: 'Default preflight' },
  deep:     { label: 'Deep',     value: 3600, hint: 'Detailed review' },
};

function evidenceSummary(entry: any): string | null {
  const first = Array.isArray(entry.evidence) ? entry.evidence[0] : null;
  if (!first) return null;
  const source = first.source_label ?? first.source_type ?? first.source_ref ?? 'source';
  const speaker = first.speaker ? `${first.speaker}: ` : '';
  const snippet = first.snippet ? String(first.snippet).replace(/\s+/g, ' ').slice(0, 140) : '';
  return snippet ? `${source} — "${speaker}${snippet}"` : String(source);
}

function flattenBriefingEntries(groups: Record<string, any[]> | undefined | null) {
  return Object.entries(groups ?? {}).flatMap(([type, entries]) =>
    (entries ?? []).map(entry => ({ ...entry, _context_type: entry.context_type ?? type })),
  );
}

function shortText(value: unknown, fallback: string) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 150 ? `${text.slice(0, 147).trimEnd()}...` : text;
}

// ── Main component ────────────────────────────────────────────────────────────

export function BriefingPanel({ subjectType, subjectId, subjectName, onClose }: BriefingPanelProps) {
  const [includeStale, setIncludeStale] = useState(true);
  const [contextRadius, setContextRadius] = useState<ContextRadius>('direct');
  const [tokenBudget, setTokenBudget] = useState<TokenBudget>('standard');
  const tokenBudgetValue = TOKEN_BUDGETS[tokenBudget].value;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading, error } = useActionContext(subjectType, subjectId, {
    include_stale: includeStale,
    context_radius: contextRadius,
    token_budget: tokenBudgetValue,
  }) as any;
  const summaryMutation = useBriefingSummary(subjectType, subjectId);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const { enabled: agentEnabled, connectivity } = useAgentSettings();
  const { openAIWithContext } = useAppStore();
  const navigate = useNavigate();

  // Clear the cached summary when subject changes
  useEffect(() => { setAiSummary(null); }, [subjectId]);

  const canUseLLM = agentEnabled && connectivity !== 'offline';

  const handleGetSummary = () => {
    summaryMutation.mutate(undefined, {
      onSuccess: (d) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const summary = (d as any)?.summary ?? (d as any)?.data?.summary ?? null;
        if (!summary) {
          toast({ title: 'Not enough context yet to summarize', description: 'Try logging an activity or adding a note first.' });
        } else {
          setAiSummary(summary);
        }
      },
      onError: () => toast({ title: 'Summary unavailable', description: 'Check your agent configuration.', variant: 'destructive' }),
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <BriefingHeader onClose={onClose} />
        <div className="flex-1 p-5 space-y-4 animate-pulse">
          <div className="h-24 bg-muted rounded-xl" />
          <div className="h-6 bg-muted rounded w-1/2" />
          <div className="h-24 bg-muted rounded" />
          <div className="h-24 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <BriefingHeader onClose={onClose} />
        <div className="p-5 text-sm text-destructive">Failed to load briefing.</div>
      </div>
    );
  }

  const actionContext = data?.action_context;
  const briefing = actionContext?.briefing;
  const activityCount: number = briefing?.activities?.length ?? 0;
  const contextTypes = briefing?.context_entries ? Object.keys(briefing.context_entries) : [];
  const signalTypes = briefing?.signals ? Object.keys(briefing.signals) : [];
  const assignmentCount: number = briefing?.open_assignments?.length ?? 0;
  const adjacentSubjects: any[] = briefing?.adjacent_context ?? [];
  const droppedEntries: any[] = briefing?.dropped_entries ?? [];
  const isEmpty = activityCount === 0 && assignmentCount === 0 && contextTypes.length === 0 && signalTypes.length === 0;
  const memoryEntries = flattenBriefingEntries(briefing?.context_entries);
  const signalEntries = flattenBriefingEntries(briefing?.signals);

  return (
    <div className="flex flex-col h-full">
      <BriefingHeader onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        <BriefingAnswerSummary
          subjectName={subjectName}
          memoryEntries={memoryEntries}
          signalEntries={signalEntries}
          assignments={briefing?.open_assignments ?? []}
          contradictions={briefing?.contradiction_warnings ?? []}
          stalenessWarnings={briefing?.staleness_warnings ?? []}
        />

        {/* AI Summary button + card */}
        <div className="flex items-center gap-2">
          {canUseLLM && (
            <button
              onClick={handleGetSummary}
              disabled={summaryMutation.isPending}
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors py-1 disabled:opacity-60"
            >
              {summaryMutation.isPending
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Summarizing…</>
                : <><Sparkles className="w-3 h-3" /> {aiSummary ? 'Regenerate narrative' : 'Generate narrative summary'}</>}
            </button>
          )}
        </div>

        {aiSummary && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground leading-relaxed">
            {aiSummary}
          </div>
        )}

        <ActionReadinessPanel actionContext={actionContext} isLoading={isLoading} isError={Boolean(error)} />

        {/* Briefing controls */}
        <details className="group rounded-xl border border-border bg-muted/20 p-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
            <Gauge className="w-3.5 h-3.5" />
            Tune briefing
            {briefing?.token_estimate != null && (
              <span className="ml-auto normal-case tracking-normal font-mono text-muted-foreground">
                ~{briefing.token_estimate} tokens
              </span>
            )}
            <ChevronDown className="ml-1 h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          </summary>

          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Network className="w-3 h-3" />
                Context radius
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {RADIUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setContextRadius(opt.value)}
                    className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
                      contextRadius === opt.value
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className="block text-xs font-semibold">{opt.label}</span>
                    <span className="block text-xs opacity-70 truncate">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Brain className="w-3 h-3" />
                Token budget
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(Object.entries(TOKEN_BUDGETS) as Array<[TokenBudget, typeof TOKEN_BUDGETS[TokenBudget]]>).map(([key, opt]) => (
                  <button
                    key={key}
                    onClick={() => setTokenBudget(key)}
                    className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
                      tokenBudget === key
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className="block text-xs font-semibold">{opt.label}</span>
                    <span className="block text-xs opacity-70 truncate">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </details>

        {/* Empty state */}
        {isEmpty && (
          <div className="rounded-xl border border-dashed border-border px-5 py-7 flex flex-col items-center gap-3 text-center">
            <Brain className="w-8 h-8 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-foreground">No context yet</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-[220px]">
                Log an activity, add a note, or chat with the agent to start building context.
              </p>
            </div>
            {canUseLLM && subjectName && (
              <button
                onClick={() => {
                  // Store uses 'use-case' (hyphen), API uses 'use_case' (underscore)
                  const storeType = subjectType === 'use_case' ? 'use-case' : subjectType;
                  openAIWithContext({ type: storeType as 'contact' | 'account' | 'opportunity' | 'use-case', id: subjectId, name: subjectName });
                  navigate('/agent');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-500 text-xs font-medium hover:bg-violet-500/20 transition-colors"
              >
                <Bot className="w-3 h-3" /> Chat with Agent
              </button>
            )}
          </div>
        )}

        {/* Contradiction warnings */}
        {briefing?.contradiction_warnings?.length > 0 && (
          <BriefingSection
            icon={<Swords className="w-4 h-4 text-destructive" />}
            title="Contradictions Detected"
            pill={briefing.contradiction_warnings.length}
            pillColor="#ef4444"
            defaultOpen
          >
            <div className="space-y-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {briefing.contradiction_warnings.map((w: any, idx: number) => (
                <div key={idx} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-destructive">{w.conflict_field ?? 'Conflict'}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${
                      w.suggested_action === 'manual_review'
                        ? 'bg-amber-500/10 border-amber-500/20 text-amber-600'
                        : 'bg-muted border-border text-muted-foreground'
                    }`}>
                      {(w.suggested_action ?? 'manual_review').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-foreground leading-relaxed">{w.conflict_evidence}</p>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Entry A: <span className="font-mono text-foreground">{w.entry_a?.id?.slice(0, 8)}</span></span>
                    <span>Entry B: <span className="font-mono text-foreground">{w.entry_b?.id?.slice(0, 8)}</span></span>
                  </div>
                </div>
              ))}
            </div>
          </BriefingSection>
        )}

        {/* Memory review warnings */}
        {briefing?.staleness_warnings?.length > 0 && (
          <BriefingSection
            icon={<AlertTriangle className="w-4 h-4 text-warning" />}
            title="Memory Needs Review"
            defaultOpen
          >
            <div className="space-y-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {briefing.staleness_warnings.map((w: any) => (
                <div key={w.id} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-foreground">{w.title ?? w.context_type}</span>
                    <span className="text-muted-foreground ml-1.5">
                      needs review since {w.valid_until ? new Date(w.valid_until).toLocaleDateString() : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </BriefingSection>
        )}

        {/* Activities */}
        {activityCount > 0 && (
          <BriefingSection
            icon={<Activity className="w-4 h-4" style={{ color: '#f97316' }} />}
            title="Recent Activities"
            pill={activityCount}
            pillColor="#f97316"
            defaultOpen
          >
            <div className="space-y-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {briefing.activities.slice(0, 10).map((a: any) => {
                const actType = (a.type ?? a.activity_type ?? '') as string;
                const actColor = ACTIVITY_COLORS[actType] ?? '#94a3b8';
                const Icon = ACTIVITY_ICONS[actType] ?? Activity;
                return (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center" style={{ backgroundColor: actColor + '18' }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: actColor }} strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold capitalize" style={{ color: actColor }}>
                          {actType.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(a.occurred_at ?? a.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      {(a.description ?? a.body) && (
                        <p className="text-sm text-foreground leading-snug">{a.description ?? a.body}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </BriefingSection>
        )}

        {/* Open Assignments */}
        {assignmentCount > 0 && (
          <BriefingSection
            icon={<ClipboardList className="w-4 h-4 text-primary" />}
            title="Open Assignments"
            pill={assignmentCount}
            defaultOpen
          >
            <div className="space-y-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {briefing.open_assignments.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2">
                  <StatusBadge status={a.status} />
                  <span className="text-sm text-foreground flex-1 truncate">{a.title}</span>
                  <PriorityDot priority={a.priority} />
                </div>
              ))}
            </div>
          </BriefingSection>
        )}

        {/* Memory entries (grouped by type) */}
        {contextTypes.length > 0 && (
          <BriefingSection
            icon={<Brain className="w-4 h-4 text-primary" />}
            title="Memory"
            defaultOpen
          >
            <div className="space-y-4">
              {Object.entries(briefing.context_entries).map(([type, entries]) => {
                const typeColor = TYPE_COLORS[type] ?? '#94a3b8';
                return (
                  <div key={type}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: typeColor }} />
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: typeColor }}>
                        {type.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <div className="space-y-2 pl-3.5">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(entries as any[]).map((c: any) => (
                        <div key={c.id} className="rounded-xl border border-border bg-card p-3">
                          {c.title && <p className="text-sm font-medium text-foreground mb-1">{c.title}</p>}
                          <p className="text-sm text-muted-foreground leading-relaxed">{c.body}</p>
                          {evidenceSummary(c) && (
                            <p className="text-xs text-muted-foreground mt-2 flex gap-1.5">
                              <FileText className="w-3 h-3 mt-0.5 shrink-0" />
                              <span>Evidence: {evidenceSummary(c)}</span>
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </BriefingSection>
        )}

        {signalTypes.length > 0 && (
          <BriefingSection
            icon={<Sparkles className="w-4 h-4 text-violet-500" />}
            title="Signals"
            pill={signalTypes.reduce((sum, type) => sum + ((briefing.signals?.[type] as any[])?.length ?? 0), 0)}
            pillColor="#8b5cf6"
          >
            <p className="text-xs text-muted-foreground mb-3">
              Signals are evidence-backed but unconfirmed. Promote or approve them before using them for writeback, forecast, assignments, or customer-facing guidance.
            </p>
            <div className="space-y-4">
              {Object.entries(briefing.signals ?? {}).map(([type, entries]) => {
                const typeColor = TYPE_COLORS[type] ?? '#8b5cf6';
                return (
                  <div key={type}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: typeColor }} />
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: typeColor }}>
                        {type.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <div className="space-y-2 pl-3.5">
                      {(entries as any[]).map((c: any) => (
                        <div key={c.id} className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
                          {c.title && <p className="text-sm font-medium text-foreground mb-1">{c.title}</p>}
                          <p className="text-sm text-muted-foreground leading-relaxed">{c.body}</p>
                          {evidenceSummary(c) && (
                            <p className="text-xs text-muted-foreground mt-2 flex gap-1.5">
                              <FileText className="w-3 h-3 mt-0.5 shrink-0" />
                              <span>Evidence: {evidenceSummary(c)}</span>
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </BriefingSection>
        )}

        {/* Dropped context */}
        {droppedEntries.length > 0 && (
          <BriefingSection
            icon={<EyeOff className="w-4 h-4 text-warning" />}
            title="Dropped From Budget"
            pill={droppedEntries.length}
            pillColor="#f59e0b"
          >
            <div className="space-y-2">
              {droppedEntries.map((entry: any, idx: number) => (
                <div key={`${entry.context_type}-${idx}`} className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-warning">{entry.context_type?.replace(/_/g, ' ') ?? 'context'}</span>
                    {entry.confidence != null && (
                      <span className="text-xs text-muted-foreground">{Math.round(entry.confidence * 100)}% confidence</span>
                    )}
                  </div>
                  <p className="text-sm text-foreground mt-1">{entry.title ?? 'Untitled context entry'}</p>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Increase the token budget or switch to Full when an agent needs these entries before acting.
              </p>
            </div>
          </BriefingSection>
        )}

        {/* Adjacent context */}
        {adjacentSubjects.length > 0 && (
          <BriefingSection
            icon={<Network className="w-4 h-4 text-[#0ea5e9]" />}
            title="Related Context"
            pill={adjacentSubjects.length}
            pillColor="#0ea5e9"
          >
            <div className="space-y-3">
              {adjacentSubjects.map((subject: any) => {
                const groups = Object.entries(subject.context_entries ?? {});
                const count = groups.reduce((sum, [, entries]) => sum + ((entries as any[])?.length ?? 0), 0);
                return (
                  <div key={`${subject.subject_type}:${subject.subject_id}`} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono text-muted-foreground">{subject.subject_type}</span>
                      <span className="text-xs text-muted-foreground truncate">{subject.subject_id}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{count} entries</span>
                    </div>
                    <div className="space-y-2">
                      {groups.slice(0, 3).map(([type, entries]) => (
                        <div key={type}>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{type.replace(/_/g, ' ')}</p>
                          {(entries as any[]).slice(0, 2).map((entry: any) => (
                            <p key={entry.id} className="text-sm text-foreground line-clamp-2">{entry.title ?? entry.body}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </BriefingSection>
        )}

        {/* Active Sequences */}
        {briefing?.active_sequences?.length > 0 && (
          <BriefingSection
            icon={<Activity className="w-4 h-4 text-accent" />}
            title="Active Sequences"
            pill={briefing.active_sequences.length}
            pillColor="#6366f1"
          >
            <div className="space-y-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {briefing.active_sequences.map((s: any) => (
                <div key={s.enrollment_id} className="text-sm text-foreground">
                  <span className="font-medium">{s.sequence_name}</span>
                  {s.current_step != null && <span className="text-muted-foreground ml-1.5">Step {s.current_step}</span>}
                </div>
              ))}
            </div>
          </BriefingSection>
        )}

        {/* Toggle stale */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <input
            type="checkbox"
            checked={includeStale}
            onChange={e => setIncludeStale(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-border accent-primary"
          />
          <span className="text-sm text-muted-foreground">Include Memory that needs review</span>
        </div>
      </div>
    </div>
  );
}

function BriefingHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
      <FileText className="w-4 h-4 text-primary" />
      <h2 className="font-display font-bold text-foreground flex-1">Briefing</h2>
      <button
        onClick={onClose}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Back to record details"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>
    </div>
  );
}

function BriefingAnswerSummary({
  subjectName,
  memoryEntries,
  signalEntries,
  assignments,
  contradictions,
  stalenessWarnings,
}: {
  subjectName?: string;
  memoryEntries: any[];
  signalEntries: any[];
  assignments: any[];
  contradictions: any[];
  stalenessWarnings: any[];
}) {
  const trustedMemory = memoryEntries[0];
  const riskOrReview = signalEntries.find(entry => String(entry._context_type ?? '').includes('risk'))
    ?? signalEntries[0]
    ?? contradictions[0]
    ?? stalenessWarnings[0];
  const nextAction = memoryEntries.find(entry => String(entry._context_type ?? '').includes('next_step'))
    ?? assignments[0];
  const evidence = trustedMemory ? evidenceSummary(trustedMemory) : null;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Agent-ready briefing</p>
          <h3 className="mt-1 font-display text-base font-bold text-foreground">
            {subjectName ? `What to know before acting on ${subjectName}` : 'What to know before acting'}
          </h3>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3" />
          Retrieved
        </span>
      </div>
      <div className="grid gap-2">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <Brain className="h-3.5 w-3.5" />
            Trusted Memory
          </div>
          <p className="text-sm leading-6 text-foreground">
            {trustedMemory
              ? shortText(trustedMemory.title ?? trustedMemory.body, 'Confirmed Memory is available.')
              : 'No confirmed Memory yet. Add context or confirm a Signal before relying on this record.'}
          </p>
          {evidence && <p className="mt-1 text-xs leading-5 text-muted-foreground">Evidence: {evidence}</p>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Risk Or Review
            </div>
            <p className="text-sm leading-6 text-foreground">
              {riskOrReview
                ? shortText(riskOrReview.title ?? riskOrReview.body ?? riskOrReview.conflict_evidence ?? riskOrReview.context_type, 'Review required before action.')
                : 'No open Signal, contradiction, or stale warning is blocking this briefing.'}
            </p>
          </div>
          <div className="rounded-lg border border-[#6366f1]/20 bg-[#6366f1]/5 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[#6366f1]">
              <ClipboardList className="h-3.5 w-3.5" />
              Safest Next Action
            </div>
            <p className="text-sm leading-6 text-foreground">
              {nextAction
                ? shortText(nextAction.title ?? nextAction.body ?? nextAction.action ?? nextAction.description, 'Review the next action with evidence.')
                : trustedMemory
                  ? 'Use confirmed Memory, then check Signals before preparing any writeback or customer-facing action.'
                  : 'Add raw context first so CRMy can create Signals and a trusted briefing.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function BriefingSection({ icon, title, children, defaultOpen = false, pill, pillColor }: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  pill?: number;
  pillColor?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-4 py-3 text-left"
      >
        {icon}
        <span className="text-sm font-display font-bold text-foreground flex-1">{title}</span>
        {pill !== undefined && (
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full mr-1"
            style={{
              backgroundColor: (pillColor ?? '#6366f1') + '20',
              color: pillColor ?? '#6366f1',
            }}
          >
            {pill}
          </span>
        )}
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: '#f59e0b',
    accepted: '#3b82f6',
    in_progress: '#8b5cf6',
    blocked: '#ef4444',
    completed: '#22c55e',
    declined: '#94a3b8',
    cancelled: '#94a3b8',
  };
  const color = colors[status] ?? '#94a3b8';
  return (
    <span
      className="px-2 py-0.5 rounded-lg text-xs font-medium capitalize flex-shrink-0"
      style={{ backgroundColor: color + '18', color }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const colors: Record<string, string> = { urgent: '#ef4444', high: '#f97316', normal: '#3b82f6', low: '#94a3b8' };
  return <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colors[priority] ?? '#94a3b8' }} title={priority} />;
}
