// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBriefing, useBriefingSummary } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { FileText, ChevronDown, ChevronUp, AlertTriangle, ClipboardList, Brain, X, Phone, Mail, Calendar, Monitor, CheckSquare, Activity, Swords, Sparkles, Loader2 } from 'lucide-react';
import { ACTIVITY_COLORS } from './GraphSidebar';
import { TYPE_COLORS } from './ContextPanel';
import { toast } from '@/components/ui/use-toast';

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

// ── Main component ────────────────────────────────────────────────────────────

export function BriefingPanel({ subjectType, subjectId, subjectName, onClose }: BriefingPanelProps) {
  const [includeStale, setIncludeStale] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading, error } = useBriefing(subjectType, subjectId, { format: 'json', include_stale: includeStale }) as any;
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

  const briefing = data?.briefing ?? data;
  const activityCount: number = briefing?.activities?.length ?? 0;
  const contextTypes = briefing?.context_entries ? Object.keys(briefing.context_entries) : [];
  const assignmentCount: number = briefing?.open_assignments?.length ?? 0;
  const isEmpty = activityCount === 0 && assignmentCount === 0 && contextTypes.length === 0;

  return (
    <div className="flex flex-col h-full">
      <BriefingHeader onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-5 space-y-3">

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
                : <><Sparkles className="w-3 h-3" /> {aiSummary ? 'Regenerate Summary' : 'Get AI Summary'}</>}
            </button>
          )}
        </div>

        {aiSummary && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground leading-relaxed">
            {aiSummary}
          </div>
        )}

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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
              >
                <Sparkles className="w-3 h-3" /> Chat with Agent
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

        {/* Staleness warnings */}
        {briefing?.staleness_warnings?.length > 0 && (
          <BriefingSection
            icon={<AlertTriangle className="w-4 h-4 text-warning" />}
            title="Stale Context"
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
                      expired {w.valid_until ? new Date(w.valid_until).toLocaleDateString() : ''}
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

        {/* Context Entries (grouped by type) */}
        {contextTypes.length > 0 && (
          <BriefingSection
            icon={<Brain className="w-4 h-4 text-primary" />}
            title="Context"
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
          <span className="text-sm text-muted-foreground">Include stale context</span>
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
      <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
        <X className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
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
