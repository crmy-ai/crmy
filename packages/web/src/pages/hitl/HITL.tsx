// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useMemo } from 'react';
import { ShieldCheck, Clock, Bot, ChevronDown, ChevronUp, AlertTriangle, Flame, AlertCircle, Mail, ListOrdered, CheckCircle2, Send } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHITLRequests, useResolveHITL, useHandoffSnapshot } from '@/api/hooks';

function AgentContextSection({ snapshotId }: { snapshotId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useHandoffSnapshot(open ? snapshotId : null);
  const snapshot = data as any;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <Bot className="w-3.5 h-3.5 text-violet-500" />
        Agent context
        {open ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border bg-muted/20">
          {isLoading ? (
            <p className="text-xs text-muted-foreground pt-2">Loading…</p>
          ) : snapshot ? (
            <>
              <div className="pt-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Reasoning</p>
                <p className="text-xs text-foreground whitespace-pre-wrap">{snapshot.reasoning}</p>
              </div>
              {snapshot.key_findings?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Key Findings</p>
                  <ul className="space-y-1">
                    {snapshot.key_findings.map((f: any, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                        <span className="text-muted-foreground shrink-0">
                          {f.confidence != null ? `${Math.round(f.confidence * 100)}%` : '•'}
                        </span>
                        <span>{f.finding}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {snapshot.confidence != null && (
                <p className="text-xs text-muted-foreground">
                  Overall confidence: <span className="text-foreground font-medium">{Math.round(snapshot.confidence * 100)}%</span>
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground pt-2">Snapshot not found.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Rich preview for sequence.step.send HITL requests.
 * Shows the email to be sent plus enrollment progress context.
 */
function SequenceStepPreview({ payload }: { payload: Record<string, unknown> }) {
  const [showBody, setShowBody] = useState(false);

  const toEmail      = payload.to_email      as string | undefined;
  const subject      = payload.subject       as string | undefined;
  const bodyText     = payload.body_text     as string | undefined;
  const enrollmentId = payload.enrollment_id as string | undefined;
  const stepIndex    = payload.step_index    as number | undefined;
  const totalSteps   = payload.total_steps   as number | undefined;
  const sequenceName = payload.sequence_name as string | undefined;
  const contactName  = payload.contact_name  as string | undefined;

  return (
    <div className="rounded-lg border border-border overflow-hidden text-xs">
      {/* Email header */}
      <div className="px-3 py-2.5 bg-muted/30 border-b border-border flex items-center gap-2">
        <Mail className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="font-semibold text-foreground">Email to send</span>
        {sequenceName && (
          <span className="ml-auto text-muted-foreground flex items-center gap-1">
            <ListOrdered className="w-3 h-3" />
            {sequenceName}
            {stepIndex != null && totalSteps != null && (
              <span className="ml-1">· Step {stepIndex + 1}/{totalSteps}</span>
            )}
          </span>
        )}
      </div>

      <div className="p-3 space-y-2">
        {/* Envelope fields */}
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          {contactName && (
            <>
              <span className="text-muted-foreground font-medium">To:</span>
              <span className="text-foreground font-medium">{contactName} {toEmail ? `<${toEmail}>` : ''}</span>
            </>
          )}
          {!contactName && toEmail && (
            <>
              <span className="text-muted-foreground font-medium">To:</span>
              <span className="text-foreground">{toEmail}</span>
            </>
          )}
          {subject && (
            <>
              <span className="text-muted-foreground font-medium">Subject:</span>
              <span className="text-foreground font-medium">{subject}</span>
            </>
          )}
        </div>

        {/* Body preview */}
        {bodyText && (
          <div>
            <button
              className="text-[11px] text-primary hover:underline"
              onClick={() => setShowBody(b => !b)}
            >
              {showBody ? 'Hide body' : 'Preview body'}
            </button>
            {showBody && (
              <pre className="mt-2 whitespace-pre-wrap text-[11px] text-foreground bg-muted/30 rounded-md p-2.5 max-h-48 overflow-auto border border-border">
                {bodyText}
              </pre>
            )}
          </div>
        )}

        {/* Enrollment context */}
        {enrollmentId && (
          <p className="text-muted-foreground">
            Enrollment: <span className="font-mono text-[10px]">{enrollmentId.slice(0, 8)}…</span>
          </p>
        )}
      </div>
    </div>
  );
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const PRIORITY_CONFIG: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  urgent: { label: 'Urgent',  cls: 'text-destructive border-destructive/30 bg-destructive/10', icon: Flame },
  high:   { label: 'High',    cls: 'text-orange-500 border-orange-500/30 bg-orange-500/10',   icon: AlertCircle },
  normal: { label: 'Normal',  cls: 'text-muted-foreground border-border bg-muted',             icon: Clock },
  low:    { label: 'Low',     cls: 'text-muted-foreground border-border bg-muted',             icon: Clock },
};

type FilterTab = 'pending' | 'escalated';

export function HITLPage() {
  const { data, isLoading } = useHITLRequests();
  const resolve = useResolveHITL();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filterTab, setFilterTab] = useState<FilterTab>('pending');

  const allRequests = (data as any)?.data ?? [];
  const escalated = useMemo(() => allRequests.filter((r: any) => !!r.escalated_at), [allRequests]);
  const requests = filterTab === 'escalated' ? escalated : allRequests;

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Approvals"
        icon={ShieldCheck}
        iconClassName="text-destructive"
        description="Human-in-the-loop approvals for agent actions."
      />

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 md:px-6 pt-4 border-b border-border pb-0">
        {(['pending', 'escalated'] as FilterTab[]).map((tab) => {
          const count = tab === 'escalated' ? escalated.length : allRequests.length;
          return (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                filterTab === tab
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'escalated' && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                  tab === 'escalated' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6 space-y-4">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : requests.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              {filterTab === 'escalated' ? (
                <>
                  <AlertTriangle className="h-14 w-14 text-muted-foreground/30 mb-4" />
                  <p className="text-lg font-display font-semibold">No escalated requests</p>
                  <p className="text-sm text-muted-foreground mt-1">All requests are within their SLA window</p>
                </>
              ) : (
                <>
                  <ShieldCheck className="h-14 w-14 text-emerald-500 mb-4" />
                  <p className="text-lg font-display font-semibold">No pending approvals</p>
                  <p className="text-sm text-muted-foreground mt-1">Your agents are running autonomously</p>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          requests.map((r: any) => {
            const priority = r.priority ?? 'normal';
            const PriorityIcon = PRIORITY_CONFIG[priority]?.icon ?? Clock;
            const isEscalated = !!r.escalated_at;

            return (
              <Card key={r.id} className={isEscalated ? 'border-destructive/30' : ''}>
                <CardContent className="p-4 space-y-3">
                  {/* Header row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{r.action_type}</Badge>

                    {/* Priority badge */}
                    {priority !== 'normal' && (
                      <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-semibold ${PRIORITY_CONFIG[priority]?.cls}`}>
                        <PriorityIcon className="w-3 h-3" />
                        {PRIORITY_CONFIG[priority]?.label}
                      </span>
                    )}

                    {/* Escalated badge */}
                    {isEscalated && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-destructive/30 bg-destructive/10 text-destructive font-semibold">
                        <AlertTriangle className="w-3 h-3" />
                        Escalated {timeAgo(r.escalated_at)}
                      </span>
                    )}

                    <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeAgo(r.created_at)}
                    </span>
                    {r.sla_minutes && (
                      <span className="text-xs text-muted-foreground">
                        SLA {r.sla_minutes}m
                      </span>
                    )}
                  </div>

                  {/* Summary */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">
                      Submitted by {r.agent_id ?? r.created_by ?? 'agent'}
                    </p>
                    <p className="text-sm text-foreground">{r.action_summary}</p>
                  </div>

                  {/* Sequence step rich preview — shown instead of raw payload */}
                  {r.action_type === 'sequence.step.send' ? (
                    <SequenceStepPreview payload={r.action_payload ?? {}} />
                  ) : (
                    <div>
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => setExpanded({ ...expanded, [r.id]: !expanded[r.id] })}
                      >
                        {expanded[r.id] ? 'Hide payload' : 'Show payload'}
                      </button>
                      {expanded[r.id] && (
                        <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-3 text-xs">
                          {JSON.stringify(r.action_payload, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* Agent reasoning snapshot */}
                  {r.handoff_snapshot_id && (
                    <AgentContextSection snapshotId={r.handoff_snapshot_id} />
                  )}

                  {/* Approve / Reject */}
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Note (optional)"
                      value={notes[r.id] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                      className="flex-1"
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => resolve.mutate({ id: r.id, status: 'rejected', note: notes[r.id] })}
                      disabled={resolve.isPending}
                      className={r.action_type === 'sequence.step.send' ? 'bg-muted text-foreground border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30' : ''}
                    >
                      {r.action_type === 'sequence.step.send' ? 'Decline & Skip' : 'Reject'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => resolve.mutate({ id: r.id, status: 'approved', note: notes[r.id] })}
                      disabled={resolve.isPending}
                      className={r.action_type === 'sequence.step.send' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
                    >
                      {r.action_type === 'sequence.step.send' ? (
                        <><Send className="w-3.5 h-3.5 mr-1.5" />Approve &amp; Send</>
                      ) : 'Approve'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
