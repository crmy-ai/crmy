// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TopBar } from '@/components/layout/TopBar';
import { useAppStore } from '@/store/appStore';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { headerDescription } from '@/lib/headerCopy';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  useHITLRequests,
  useResolveHITL,
  useUpdateHITL,
  useAssignments,
  useActors,
  useWhoAmI,
  useAcceptAssignment,
  useStartAssignment,
  useCompleteAssignment,
  useDeclineAssignment,
  useBlockAssignment,
  useCancelAssignment,
  useBriefing,
  useHandoffSnapshot,
} from '@/api/hooks';
import { toast } from '@/components/ui/use-toast';
import {
  Inbox as InboxIcon,
  CheckCircle2,
  XCircle,
  Play,
  Ban,
  AlertOctagon,
  ChevronRight,
  Clock,
  AlertTriangle,
  Bot,
  User,
  Calendar,
  ArrowRight,
  Loader2,
  List,
  LayoutGrid,
  ChevronUp,
  ChevronDown,
  Mail,
  FileText,
  ShieldCheck,
  Pencil,
  Save,
  X,
  Eye,
  UserCheck,
  Check,
  ChevronsUpDown,
} from 'lucide-react';
import { formatDistanceToNow, isPast, parseISO } from 'date-fns';

type Tab = 'needs_attention' | 'delegated' | 'all';
type ViewMode = 'card' | 'table';

interface HITLRequest {
  id: string;
  action_type: string;
  agent_id?: string;
  created_at: string;
  expires_at?: string;
  action_summary: string;
  action_payload: Record<string, unknown>;
  status: string;
  priority?: string;
  sla_minutes?: number;
  escalated_at?: string;
  auto_approve_after?: string;
  handoff_snapshot_id?: string;
  escalate_to_id?: string;
  reviewer_id?: string;
  resolved_at?: string;
  review_note?: string;
}

interface Assignment {
  id: string;
  title: string;
  description?: string;
  assignment_type: string;
  status: string;
  priority: string;
  subject_type?: string;
  subject_id?: string;
  assigned_to: string;
  assigned_by: string;
  context?: string;
  created_at: string;
  due_at?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-destructive/15 text-destructive',
  high:   'bg-orange-500/15 text-orange-500',
  normal: 'bg-primary/10 text-primary',
  low:    'bg-muted text-muted-foreground',
};

const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-amber-500/15 text-amber-600',
  approved:    'bg-success/15 text-success',
  rejected:    'bg-destructive/15 text-destructive',
  expired:     'bg-muted text-muted-foreground',
  auto_approved: 'bg-success/15 text-success',
  accepted:    'bg-blue-500/15 text-blue-600',
  in_progress: 'bg-violet-500/15 text-violet-600',
  blocked:     'bg-destructive/15 text-destructive',
  completed:   'bg-success/15 text-success',
  declined:    'bg-muted text-muted-foreground',
  cancelled:   'bg-muted text-muted-foreground',
};

const ACTIVE_STATUSES = ['pending', 'accepted', 'in_progress', 'blocked'];

const TABS: { key: Tab; label: string }[] = [
  { key: 'needs_attention', label: 'Needs Attention' },
  { key: 'delegated',       label: 'Delegated' },
  { key: 'all',             label: 'All' },
];

const FILTER_CONFIGS: FilterConfig[] = [
  { key: 'status', label: 'Status', options: [
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'expired', label: 'Expired' },
    { value: 'auto_approved', label: 'Auto Approved' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'completed', label: 'Completed' },
    { value: 'declined', label: 'Declined' },
    { value: 'cancelled', label: 'Cancelled' },
  ]},
  { key: 'priority', label: 'Priority', options: [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'normal', label: 'Normal' },
    { value: 'low', label: 'Low' },
  ]},
  { key: 'assignment_type', label: 'Type', options: [
    { value: 'call', label: 'Call' },
    { value: 'draft', label: 'Draft' },
    { value: 'email', label: 'Email' },
    { value: 'follow_up', label: 'Follow Up' },
    { value: 'research', label: 'Research' },
    { value: 'review', label: 'Review' },
    { value: 'send', label: 'Send' },
  ]},
];

const SORT_OPTIONS: SortOption[] = [
  { key: 'created_at', label: 'Created' },
  { key: 'due_at',     label: 'Due Date' },
  { key: 'priority',   label: 'Priority' },
  { key: 'status',     label: 'Status' },
  { key: 'title',      label: 'Title' },
];

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const SLA_PRESETS = [
  { label: '1 hour', value: 60 },
  { label: '4 hours', value: 240 },
  { label: 'Tomorrow', value: 1440 },
  { label: '2 days', value: 2880 },
  { label: '1 week', value: 10080 },
  { label: 'Custom', value: 'custom' as const },
];

function timeAgo(iso: string) {
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }); } catch { return ''; }
}

function expiryLabel(iso?: string) {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    if (isPast(d)) return { label: 'Expired', urgent: true };
    return { label: `Expires ${formatDistanceToNow(d, { addSuffix: true })}`, urgent: d.getTime() - Date.now() < 30 * 60 * 1000 };
  } catch { return null; }
}

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

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function labelize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function slaLabel(minutes?: number | null) {
  if (!minutes) return 'No SLA';
  if (minutes < 60) return `${minutes} min`;
  if (minutes === 60) return '1 hour';
  if (minutes < 1440) return `${Math.round(minutes / 60)} hours`;
  if (minutes === 1440) return 'Tomorrow';
  if (minutes < 10080) return `${Math.round(minutes / 1440)} days`;
  if (minutes === 10080) return '1 week';
  return `${minutes} min`;
}

function slaPreset(minutes?: number | null): string {
  if (!minutes) return '';
  const preset = SLA_PRESETS.find(option => option.value === minutes);
  return preset ? String(preset.value) : 'custom';
}

function inferApprovalSubject(req: HITLRequest): { subjectType?: string; subjectId?: string; label?: string } {
  const payload = isRecord(req.action_payload) ? req.action_payload : {};
  const subjectType = firstString(payload, ['subject_type', '_subject_type', 'entity_type', 'record_type']);
  const subjectId = firstString(payload, ['subject_id', '_subject_id', 'entity_id', 'record_id']);
  if (subjectType && subjectId) {
    return {
      subjectType,
      subjectId,
      label: firstString(payload, ['subject_name', 'record_name', 'entity_name', 'object_name']) ?? labelize(subjectType),
    };
  }

  const keyedSubjects: Array<[string, string[], string[]]> = [
    ['contact', ['contact_id'], ['contact_name', 'to_name', 'recipient_name']],
    ['account', ['account_id'], ['account_name', 'company_name']],
    ['opportunity', ['opportunity_id'], ['opportunity_name']],
    ['use_case', ['use_case_id', 'useCaseId'], ['use_case_name', 'use_case']],
  ];
  for (const [type, idKeys, labelKeys] of keyedSubjects) {
    const id = firstString(payload, idKeys);
    if (id) return { subjectType: type, subjectId: id, label: firstString(payload, labelKeys) ?? labelize(type) };
  }
  return {};
}

function findSnapshotId(req: HITLRequest): string | undefined {
  const payload = isRecord(req.action_payload) ? req.action_payload : {};
  return req.handoff_snapshot_id ?? firstString(payload, ['handoff_snapshot_id', 'handoffSnapshotId', 'snapshot_id']);
}

function payloadHighlights(payload: Record<string, unknown>) {
  const fields: Array<[string, unknown, ReactNode]> = [
    ['To', firstString(payload, ['to_email', 'recipient_email', 'email']), <Mail className="w-3.5 h-3.5" />],
    ['Subject', firstString(payload, ['subject', 'email_subject']), <FileText className="w-3.5 h-3.5" />],
    ['Sequence', firstString(payload, ['sequence_name']), <List className="w-3.5 h-3.5" />],
    ['Step', stepLabel(payload), <ShieldCheck className="w-3.5 h-3.5" />],
    ['Objective', firstString(payload, ['objective', 'goal']), <ShieldCheck className="w-3.5 h-3.5" />],
  ];
  return fields.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
}

function payloadList(payload: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function percent(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return `${Math.round(value * 100)}%`;
  if (typeof value === 'string' && Number.isFinite(Number(value))) return `${Math.round(Number(value) * 100)}%`;
  return undefined;
}

function decisionFields(payload: Record<string, unknown>) {
  const requestedAction = firstString(payload, ['proposed_action', 'requested_action', 'action', 'operation', 'decision']);
  const impact = firstString(payload, ['business_impact', 'impact', 'objective', 'goal']);
  const policyReason = firstString(payload, ['policy_reason', 'reason', 'approval_reason']);
  const proposedChange = firstString(payload, ['proposed_change', 'change_summary', 'body_preview', 'body_text', 'message', 'content']);
  const trust = percent(payload.trust_score ?? payload.confidence ?? payload.aggregate_confidence);
  const blockers = payloadList(payload, ['promotion_blockers', 'blockers', 'policy_blockers'])
    .map(item => String(item))
    .filter(Boolean);
  const evidence = payloadList(payload, ['evidence', 'evidence_summary'])
    .map(item => isRecord(item)
      ? firstString(item, ['snippet', 'body', 'summary', 'text']) ?? JSON.stringify(item)
      : String(item))
    .filter(Boolean);
  return { requestedAction, impact, policyReason, proposedChange, trust, blockers, evidence };
}

function stepLabel(payload: Record<string, unknown>) {
  const step = firstNumber(payload, ['step_index', 'step']);
  const total = firstNumber(payload, ['total_steps']);
  if (step == null && total == null) return undefined;
  return total ? `${step ?? '?'} of ${total}` : String(step);
}

function ApprovalPayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const [showBody, setShowBody] = useState(false);
  const body = firstString(payload, ['body_text', 'body', 'message', 'content']);
  const highlights = payloadHighlights(payload);

  if (highlights.length === 0 && !body) return null;

  return (
    <div className="mx-4 mb-3 rounded-xl border border-border bg-muted/20 overflow-hidden">
      {highlights.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
          {highlights.map(([label, value, icon]) => (
            <div key={label} className="flex items-start gap-2 min-w-0 text-xs">
              <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
              <div className="min-w-0">
                <p className="font-medium text-muted-foreground">{label}</p>
                <p className="text-foreground truncate">{String(value)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {body && (
        <div className="border-t border-border px-3 py-2">
          <button onClick={() => setShowBody(!showBody)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showBody ? 'rotate-90' : ''}`} />Message body
          </button>
          {showBody && <p className="mt-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">{body}</p>}
        </div>
      )}
    </div>
  );
}

function HandoffSnapshotPreview({ snapshotId }: { snapshotId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useHandoffSnapshot(open ? snapshotId : null) as any;
  const snapshot = data;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <Bot className="w-3.5 h-3.5 text-violet-500" />
        Agent handoff packet
        {open ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border bg-muted/20">
          {isLoading ? (
            <p className="text-xs text-muted-foreground pt-2">Loading...</p>
          ) : snapshot ? (
            <>
              {snapshot.reasoning && (
                <div className="pt-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Reasoning</p>
                  <p className="text-xs text-foreground whitespace-pre-wrap">{snapshot.reasoning}</p>
                </div>
              )}
              {snapshot.key_findings?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Key findings</p>
                  <ul className="space-y-1">
                    {snapshot.key_findings.slice(0, 5).map((finding: any, index: number) => (
                      <li key={index} className="flex items-start gap-2 text-xs text-foreground">
                        <span className="text-muted-foreground shrink-0">
                          {finding.confidence != null ? `${Math.round(finding.confidence * 100)}%` : '-'}
                        </span>
                        <span>{finding.finding}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {snapshot.tools_called?.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Tool trace: <span className="text-foreground font-medium">{snapshot.tools_called.length}</span> calls
                </p>
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

function DecisionPacket({ req, compact = false }: { req: HITLRequest; compact?: boolean }) {
  const payload = isRecord(req.action_payload) ? req.action_payload : {};
  const subject = inferApprovalSubject(req);
  const snapshotId = findSnapshotId(req);
  const fields = decisionFields(payload);
  const highlights = payloadHighlights(payload);
  const visibleEvidence = fields.evidence.slice(0, compact ? 2 : 4);
  const visibleBlockers = fields.blockers.slice(0, compact ? 1 : 3);

  return (
    <div className="rounded-xl border border-border bg-muted/15 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decision packet</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{fields.requestedAction ?? req.action_summary}</p>
        </div>
        {fields.trust && <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-1 text-xs font-semibold text-violet-600">{fields.trust} trust</span>}
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <DecisionField label="Record" value={subject.label ?? 'No linked record'} />
        <DecisionField label="Type" value={labelize(req.action_type)} />
        {fields.impact && <DecisionField label="Impact" value={fields.impact} />}
        {fields.policyReason && <DecisionField label="Policy" value={fields.policyReason} />}
      </div>

      {highlights.length > 0 && (
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          {highlights.map(([label, value, icon]) => (
            <div key={label} className="flex items-start gap-2 rounded-lg bg-card/70 p-2">
              <span className="mt-0.5 text-muted-foreground">{icon}</span>
              <div className="min-w-0">
                <p className="font-medium text-muted-foreground">{label}</p>
                <p className="truncate text-foreground">{String(value)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {fields.proposedChange && (
        <div className="rounded-lg bg-card/70 p-2 text-xs">
          <p className="font-medium text-muted-foreground">Proposed change</p>
          <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-foreground">{fields.proposedChange}</p>
        </div>
      )}

      {visibleEvidence.length > 0 && (
        <div className="text-xs">
          <p className="font-medium text-muted-foreground">Evidence</p>
          <ul className="mt-1 space-y-1">
            {visibleEvidence.map((item, index) => <li key={index} className="line-clamp-2 text-foreground">- {item}</li>)}
          </ul>
        </div>
      )}

      {visibleBlockers.length > 0 && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-xs">
          <p className="font-medium text-amber-600">Needs review because</p>
          <ul className="mt-1 space-y-1 text-foreground">
            {visibleBlockers.map((item, index) => <li key={index}>- {item}</li>)}
          </ul>
        </div>
      )}

      {!compact && subject.subjectType && subject.subjectId && <BriefingContextPreview subject={subject} />}
      {!compact && snapshotId && <HandoffSnapshotPreview snapshotId={snapshotId} />}
    </div>
  );
}

function DecisionField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-card/70 p-2">
      <p className="font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-foreground">{value}</p>
    </div>
  );
}

function BriefingContextPreview({ subject }: { subject: { subjectType?: string; subjectId?: string; label?: string } }) {
  const hasSubject = !!subject.subjectType && !!subject.subjectId;
  const { data, isLoading } = useBriefing(subject.subjectType ?? '', subject.subjectId ?? '', {
    format: 'json',
    include_stale: true,
    context_radius: 'adjacent',
    token_budget: 900,
  }) as any;

  if (!hasSubject) return null;

  const briefing = data?.briefing ?? data;
  const contextEntries = isRecord(briefing?.context_entries) ? briefing.context_entries : {};
  const memories = Object.values(contextEntries)
    .flatMap(entries => Array.isArray(entries) ? entries : [])
    .map((entry: any) => firstString(entry, ['title', 'body']) ?? entry.body)
    .filter(Boolean)
    .slice(0, 3);
  const activities = (Array.isArray(briefing?.activities) ? briefing.activities : [])
    .map((activity: any) => firstString(activity, ['subject', 'body', 'outcome']))
    .filter(Boolean)
    .slice(0, 2);
  const warnings = [
    ...(Array.isArray(briefing?.staleness_warnings) ? briefing.staleness_warnings : []),
    ...(Array.isArray(briefing?.contradiction_warnings) ? briefing.contradiction_warnings : []),
  ].map((warning: any) => typeof warning === 'string' ? warning : firstString(warning, ['message', 'title', 'body']) ?? JSON.stringify(warning)).slice(0, 2);
  const hasContext = memories.length > 0 || activities.length > 0 || warnings.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-foreground">Relevant context</p>
        <span className="text-[11px] text-muted-foreground font-mono truncate">{subject.label ?? labelize(subject.subjectType ?? 'record')}</span>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading context...</p>
      ) : !hasContext ? (
        <p className="text-xs text-muted-foreground">No linked Memory, activity, or warnings were found for this record yet.</p>
      ) : (
        <div className="space-y-2 text-xs">
          {memories.length > 0 && <ContextBulletGroup label="Memory" items={memories} />}
          {activities.length > 0 && <ContextBulletGroup label="Recent activity" items={activities} />}
          {warnings.length > 0 && <ContextBulletGroup label="Warnings" items={warnings} tone="warning" />}
        </div>
      )}
    </div>
  );
}

function ContextBulletGroup({ label, items, tone }: { label: string; items: string[]; tone?: 'warning' }) {
  return (
    <div>
      <p className={`font-semibold ${tone === 'warning' ? 'text-amber-600' : 'text-muted-foreground'}`}>{label}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item, index) => (
          <li key={index} className="text-foreground line-clamp-2">- {item}</li>
        ))}
      </ul>
    </div>
  );
}

// ─── HITL Approval Card ──────────────────────────────────────────────────────

function HITLCard({ req, onOpenDetails }: { req: HITLRequest; onOpenDetails: () => void }) {
  const expiry = expiryLabel(req.expires_at);
  const autoApprove = expiryLabel(req.auto_approve_after);
  const subject = inferApprovalSubject(req);
  const isPending = req.status === 'pending';

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <InboxIcon className="w-4 h-4 text-destructive" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-600">{isPending ? 'Decision required' : 'Decision complete'}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{req.action_type}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[req.status] ?? STATUS_COLORS.pending}`}>{req.status.replace('_', ' ')}</span>
            {req.priority && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[req.priority] ?? PRIORITY_COLORS.normal}`}>{req.priority}</span>}
            {req.escalated_at && <span className="text-xs flex items-center gap-1 text-destructive"><AlertTriangle className="w-3 h-3" />Escalated</span>}
            {expiry && (
              <span className={`text-xs flex items-center gap-1 ${expiry.urgent ? 'text-destructive' : 'text-muted-foreground'}`}>
                <Clock className="w-3 h-3" />{expiry.label}
              </span>
            )}
          </div>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-foreground">{req.action_summary}</p>
            <button
              type="button"
              onClick={onOpenDetails}
              className="h-7 px-2 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors flex items-center gap-1"
            >
              <Eye className="w-3.5 h-3.5" />
              Details
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {subject.label ?? 'No linked record'} · {timeAgo(req.created_at)}
          </p>
        </div>
      </div>
      <div className="mx-4 mb-3">
        <DecisionPacket req={req} compact />
      </div>
      {(autoApprove || req.sla_minutes) && (
        <div className="mx-4 mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {req.sla_minutes && <span className="px-2 py-1 rounded-lg bg-muted/50">Due {slaLabel(req.sla_minutes).toLowerCase()}</span>}
          {autoApprove && <span className="px-2 py-1 rounded-lg bg-muted/50">Auto approval {autoApprove.label.toLowerCase()}</span>}
        </div>
      )}
      <div className="border-t border-border p-3 flex justify-end gap-2 bg-surface-sunken/30">
        <ActionBtn label="Details" icon={<Eye className="w-3.5 h-3.5" />} onClick={onOpenDetails} loading={false} color="ghost" />
        {isPending && <HITLDecisionActions req={req} />}
      </div>
    </div>
  );
}

function HITLDecisionActions({ req, note }: { req: HITLRequest; note?: string }) {
  const resolve = useResolveHITL();
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  if (req.status !== 'pending') return null;

  async function handle(decision: 'approved' | 'rejected') {
    setActing(decision === 'approved' ? 'approve' : 'reject');
    try {
      await resolve.mutateAsync({ id: req.id, decision, note: note?.trim() || undefined });
      toast({ title: decision === 'approved' ? 'Approved' : 'Rejected', description: req.action_summary });
    } catch (err) {
      toast({ title: 'Could not resolve handoff', description: errorMessage(err, 'Check access and try again.'), variant: 'destructive' });
    } finally {
      setActing(null);
    }
  }

  return (
    <>
      <ActionBtn label="Reject" icon={<XCircle className="w-3.5 h-3.5" />} onClick={() => handle('rejected')} loading={acting === 'reject'} color="destructive" />
      <ActionBtn label="Approve" icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => handle('approved')} loading={acting === 'approve'} color="success" />
    </>
  );
}

function slaMinutesFromForm(presetValue: string, customValue: string): number | null {
  if (!presetValue) return null;
  if (presetValue === 'custom') {
    const custom = Number(customValue);
    return Number.isFinite(custom) && custom > 0 ? Math.round(custom) : null;
  }
  const preset = Number(presetValue);
  return Number.isFinite(preset) && preset > 0 ? preset : null;
}

function actorLabel(actor: any): string {
  return actor?.display_name ?? actor?.name ?? actor?.email ?? actor?.agent_identifier ?? actor?.id ?? 'Reviewer';
}

function ReviewerCombobox({
  value,
  onChange,
  fallbackActors,
  actorMap,
}: {
  value: string;
  onChange: (id: string) => void;
  fallbackActors: any[];
  actorMap: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const actorsQ = useActors({ q: query || undefined, is_active: true, limit: 25 }) as any;
  const remoteActors = ((actorsQ.data?.actors ?? actorsQ.data?.data ?? []) as any[]).filter(actor => actor.is_active !== false);
  const actors = remoteActors.length > 0 || query ? remoteActors : fallbackActors.slice(0, 25);
  const selectedLabel = value ? actorMap.get(value) ?? actorLabel(actors.find(actor => actor.id === value)) : 'Unassigned';

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-1 flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors hover:border-ring focus:ring-2 focus:ring-primary/30"
        >
          <span className={cn('truncate text-left', !value && 'text-muted-foreground')}>{selectedLabel}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[240px] p-0" align="start" sideOffset={4}>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search reviewers..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">
              {actorsQ.isLoading ? 'Searching reviewers...' : 'No reviewers found.'}
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="unassigned"
                onSelect={() => {
                  onChange('');
                  setOpen(false);
                  setQuery('');
                }}
                className="flex items-center gap-2"
              >
                <Check className={cn('h-3.5 w-3.5 shrink-0', !value ? 'opacity-100' : 'opacity-0')} />
                <span>Unassigned</span>
              </CommandItem>
              {actors.map(actor => (
                <CommandItem
                  key={actor.id}
                  value={actor.id}
                  onSelect={() => {
                    onChange(actor.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex items-center gap-2"
                >
                  <Check className={cn('h-3.5 w-3.5 shrink-0', value === actor.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0 flex-1 truncate">{actorLabel(actor)}</span>
                  {actor.actor_type && <span className="shrink-0 text-xs capitalize text-muted-foreground">{actor.actor_type}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function HITLDetailDrawer({
  req,
  actors,
  actorMap,
  onClose,
}: {
  req: HITLRequest;
  actors: any[];
  actorMap: Map<string, string>;
  onClose: () => void;
}) {
  const update = useUpdateHITL();
  const [note, setNote] = useState('');
  const [showPayload, setShowPayload] = useState(false);
  const [summary, setSummary] = useState(req.action_summary);
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>(
    (['low', 'normal', 'high', 'urgent'].includes(req.priority ?? '') ? req.priority : 'normal') as 'low' | 'normal' | 'high' | 'urgent',
  );
  const [slaPresetValue, setSlaPresetValue] = useState(slaPreset(req.sla_minutes));
  const [customSla, setCustomSla] = useState(req.sla_minutes && slaPreset(req.sla_minutes) === 'custom' ? String(req.sla_minutes) : '');
  const [reviewerId, setReviewerId] = useState(req.escalate_to_id ?? '');
  const payload = isRecord(req.action_payload) ? req.action_payload : {};
  const reviewerName = reviewerId ? actorMap.get(reviewerId) ?? 'Selected reviewer' : 'Unassigned';
  const isPending = req.status === 'pending';
  const resolvedBy = req.reviewer_id ? actorMap.get(req.reviewer_id) ?? 'Reviewer' : 'Reviewer';

  useEffect(() => {
    setSummary(req.action_summary);
    setPriority((['low', 'normal', 'high', 'urgent'].includes(req.priority ?? '') ? req.priority : 'normal') as 'low' | 'normal' | 'high' | 'urgent');
    setSlaPresetValue(slaPreset(req.sla_minutes));
    setCustomSla(req.sla_minutes && slaPreset(req.sla_minutes) === 'custom' ? String(req.sla_minutes) : '');
    setReviewerId(req.escalate_to_id ?? '');
  }, [req]);

  async function saveEdit() {
    try {
      await update.mutateAsync({
        id: req.id,
        action_summary: summary.trim() || req.action_summary,
        priority,
        sla_minutes: slaMinutesFromForm(slaPresetValue, customSla),
        escalate_to_id: reviewerId || null,
      });
      toast({ title: 'Handoff updated', description: reviewerId ? `Assigned to ${reviewerName}.` : 'The pending review request was updated.' });
    } catch (err) {
      toast({ title: 'Could not update handoff', description: errorMessage(err, 'Check the fields and try again.'), variant: 'destructive' });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/55 backdrop-blur-sm">
      <button aria-label="Close handoff details" className="absolute inset-0 cursor-default" onClick={onClose} />
      <motion.aside
        initial={{ x: 420, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 420, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="relative flex h-full w-full max-w-2xl flex-col border-l border-border bg-background shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-600">{isPending ? 'Decision required' : 'Decision complete'}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[req.status] ?? STATUS_COLORS.pending}`}>{req.status.replace('_', ' ')}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.normal}`}>{priority}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Due {slaLabel(slaMinutesFromForm(slaPresetValue, customSla)).toLowerCase()}</span>
            </div>
            <h2 className="text-lg font-display font-semibold text-foreground">{req.action_summary}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{labelize(req.action_type)} · Created {timeAgo(req.created_at)}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <DecisionPacket req={req} />

          {isPending && <div className="rounded-xl border border-border bg-card p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edit routing</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-muted-foreground sm:col-span-2">
                Summary
                <input
                  value={summary}
                  onChange={event => setSummary(event.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Priority
                <select value={priority} onChange={event => setPriority(event.target.value as typeof priority)} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Reassign reviewer
                <ReviewerCombobox
                  value={reviewerId}
                  onChange={setReviewerId}
                  fallbackActors={actors}
                  actorMap={actorMap}
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Due / SLA
                <select value={slaPresetValue} onChange={event => setSlaPresetValue(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">No SLA</option>
                  {SLA_PRESETS.map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
                </select>
              </label>
              {slaPresetValue === 'custom' && (
                <label className="block text-xs font-medium text-muted-foreground">
                  Custom minutes
                  <input
                    type="number"
                    min={1}
                    value={customSla}
                    onChange={event => setCustomSla(event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </label>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={saveEdit} disabled={update.isPending} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save routing
              </button>
            </div>
          </div>}

          {!isPending && (
            <div className="rounded-xl border border-border bg-card p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decision outcome</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[req.status] ?? STATUS_COLORS.pending}`}>{req.status.replace('_', ' ')}</span>
                <span className="text-xs text-muted-foreground">
                  {req.resolved_at ? `${resolvedBy} resolved this ${timeAgo(req.resolved_at)}` : 'This request is no longer pending.'}
                </span>
              </div>
              {req.review_note && <p className="mt-3 rounded-lg bg-muted/40 p-2 text-sm text-foreground">{req.review_note}</p>}
            </div>
          )}

          {isPending && <div className="rounded-xl border border-border bg-card p-3">
            <label className="block text-xs font-medium text-muted-foreground">
              Decision note
              <textarea
                value={note}
                onChange={event => setNote(event.target.value)}
                placeholder="Add why you approved or rejected this handoff..."
                className="mt-1 min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
          </div>}

          <div className="rounded-xl border border-border bg-card p-3">
            <button onClick={() => setShowPayload(!showPayload)} className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showPayload ? 'rotate-90' : ''}`} />
              Advanced details
            </button>
            <AnimatePresence>
              {showPayload && (
                <motion.pre
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"
                >
                  {JSON.stringify(payload, null, 2)}
                </motion.pre>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border bg-surface-sunken/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <UserCheck className="h-3.5 w-3.5" />
            {reviewerName}
          </div>
          <div className="flex justify-end gap-2">
            {isPending ? <HITLDecisionActions req={req} note={note} /> : <ActionBtn label="Close" icon={<X className="w-3.5 h-3.5" />} onClick={onClose} loading={false} color="ghost" />}
          </div>
        </div>
      </motion.aside>
    </div>
  );
}

// ─── Assignment Card ──────────────────────────────────────────────────────────

function AssignmentCard({ task, actorMap }: { task: Assignment; actorMap: Map<string, string> }) {
  const accept   = useAcceptAssignment();
  const start    = useStartAssignment();
  const complete = useCompleteAssignment();
  const decline  = useDeclineAssignment();
  const block    = useBlockAssignment();
  const cancel   = useCancelAssignment();
  const [acting, setActing] = useState<string | null>(null);

  async function act(action: string) {
    setActing(action);
    try {
      if (action === 'accept')        await accept.mutateAsync(task.id);
      else if (action === 'start')    await start.mutateAsync(task.id);
      else if (action === 'complete') await complete.mutateAsync({ id: task.id });
      else if (action === 'decline')  await decline.mutateAsync({ id: task.id });
      else if (action === 'block')    await block.mutateAsync({ id: task.id });
      else if (action === 'cancel')   await cancel.mutateAsync({ id: task.id });
      toast({ title: `Assignment ${action}ed` });
    } catch {
      toast({ title: 'Error', description: `Could not ${action} assignment.`, variant: 'destructive' });
    } finally { setActing(null); }
  }

  const isOverdue = task.due_at && isPast(parseISO(task.due_at)) && !['completed', 'cancelled', 'declined'].includes(task.status);
  const assignedByName = actorMap.get(task.assigned_by) ?? task.assigned_by.slice(0, 8) + '…';

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.normal}`}>{task.priority}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[task.status] ?? 'bg-muted text-muted-foreground'}`}>{task.status.replace('_', ' ')}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{task.assignment_type.replace('_', ' ')}</span>
            {isOverdue && <span className="text-xs flex items-center gap-1 text-destructive"><AlertTriangle className="w-3 h-3" />Overdue</span>}
          </div>
          <p className="text-sm font-medium text-foreground leading-snug">{task.title}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <ArrowRight className="w-3 h-3" />from {assignedByName}
            </span>
            {task.due_at && (
              <span className={`text-xs flex items-center gap-1 ${isOverdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                <Calendar className="w-3 h-3" />{timeAgo(task.due_at)}
              </span>
            )}
          </div>
          {task.context && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.context}</p>}
        </div>
      </div>
      {ACTIVE_STATUSES.includes(task.status) && (
        <div className="border-t border-border px-3 py-2 flex gap-2 flex-wrap bg-surface-sunken/30">
          {task.status === 'pending' && <>
            <ActionBtn label="Accept" icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => act('accept')} loading={acting === 'accept'} color="success" />
            <ActionBtn label="Decline" icon={<XCircle className="w-3.5 h-3.5" />} onClick={() => act('decline')} loading={acting === 'decline'} color="destructive" />
          </>}
          {task.status === 'accepted' && <>
            <ActionBtn label="Start" icon={<Play className="w-3.5 h-3.5" />} onClick={() => act('start')} loading={acting === 'start'} color="primary" />
            <ActionBtn label="Decline" icon={<XCircle className="w-3.5 h-3.5" />} onClick={() => act('decline')} loading={acting === 'decline'} color="ghost" />
          </>}
          {task.status === 'in_progress' && <>
            <ActionBtn label="Complete" icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => act('complete')} loading={acting === 'complete'} color="success" />
            <ActionBtn label="Block" icon={<Ban className="w-3.5 h-3.5" />} onClick={() => act('block')} loading={acting === 'block'} color="warning" />
          </>}
          {task.status === 'blocked' && <>
            <ActionBtn label="Resume" icon={<Play className="w-3.5 h-3.5" />} onClick={() => act('start')} loading={acting === 'start'} color="primary" />
            <ActionBtn label="Cancel" icon={<AlertOctagon className="w-3.5 h-3.5" />} onClick={() => act('cancel')} loading={acting === 'cancel'} color="ghost" />
          </>}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ label, icon, onClick, loading, color }: { label: string; icon: ReactNode; onClick: () => void; loading: boolean; color: string }) {
  const colorMap: Record<string, string> = {
    success:     'bg-success text-white hover:bg-success/90',
    destructive: 'border border-destructive/30 text-destructive hover:bg-destructive/10',
    primary:     'bg-primary text-primary-foreground hover:bg-primary/90',
    warning:     'border border-amber-500/30 text-amber-600 hover:bg-amber-500/10',
    ghost:       'border border-border text-muted-foreground hover:bg-muted/50',
  };
  return (
    <button onClick={onClick} disabled={loading} className={`h-7 px-2.5 flex items-center gap-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${colorMap[color]}`}>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}{label}
    </button>
  );
}

// ─── Table Row ────────────────────────────────────────────────────────────────

function HITLTableRow({ req, index, actorMap, onOpenDetails }: { req: HITLRequest; index: number; actorMap: Map<string, string>; onOpenDetails: () => void }) {
  const subject = inferApprovalSubject(req);
  const reviewer = req.escalate_to_id ? actorMap.get(req.escalate_to_id) ?? 'Assigned reviewer' : 'Unassigned';
  const isPending = req.status === 'pending';

  return (
    <tr className={`border-b border-border hover:bg-primary/5 transition-colors ${index % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
      <td className="px-4 py-3">
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[req.priority ?? 'normal'] ?? PRIORITY_COLORS.normal}`}>{req.priority ?? 'normal'}</span>
      </td>
      <td className="px-4 py-3 max-w-md cursor-pointer" onClick={onOpenDetails}>
        <p className="text-sm font-medium text-foreground truncate">{req.action_summary}</p>
        <p className="text-xs text-muted-foreground truncate">{subject.label ?? 'No linked record'}</p>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-600">Decision</span>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_COLORS[req.status] ?? STATUS_COLORS.pending}`}>{req.status.replace('_', ' ')}</span>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{timeAgo(req.created_at)}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{reviewer}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{slaLabel(req.sla_minutes)}</td>
      <td className="px-4 py-3">
        <div className="flex gap-1.5">
          <ActionBtn label="Details" icon={<Eye className="w-3 h-3" />} onClick={onOpenDetails} loading={false} color="ghost" />
          {isPending && <HITLDecisionActions req={req} />}
        </div>
      </td>
    </tr>
  );
}

function AssignmentTableRow({ task, actorMap, index }: { task: Assignment; actorMap: Map<string, string>; index: number }) {
  const accept   = useAcceptAssignment();
  const start    = useStartAssignment();
  const complete = useCompleteAssignment();
  const decline  = useDeclineAssignment();
  const block    = useBlockAssignment();
  const cancel   = useCancelAssignment();
  const [acting, setActing] = useState<string | null>(null);

  async function act(action: string) {
    setActing(action);
    try {
      if (action === 'accept')        await accept.mutateAsync(task.id);
      else if (action === 'start')    await start.mutateAsync(task.id);
      else if (action === 'complete') await complete.mutateAsync({ id: task.id });
      else if (action === 'decline')  await decline.mutateAsync({ id: task.id });
      else if (action === 'block')    await block.mutateAsync({ id: task.id });
      else if (action === 'cancel')   await cancel.mutateAsync({ id: task.id });
      toast({ title: `Assignment ${action}ed` });
    } catch {
      toast({ title: 'Error', description: `Could not ${action} assignment.`, variant: 'destructive' });
    } finally { setActing(null); }
  }

  const isOverdue = task.due_at && isPast(parseISO(task.due_at)) && !['completed', 'cancelled', 'declined'].includes(task.status);
  const assignedByName = actorMap.get(task.assigned_by) ?? task.assigned_by.slice(0, 8) + '…';
  const assignedToName = actorMap.get(task.assigned_to) ?? task.assigned_to.slice(0, 8) + '…';

  return (
    <tr className={`border-b border-border hover:bg-primary/5 transition-colors group ${index % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
      <td className="px-4 py-3">
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.normal}`}>{task.priority}</span>
      </td>
      <td className="px-4 py-3 max-w-xs">
        <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
        {task.context && <p className="text-xs text-muted-foreground truncate">{task.context}</p>}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{task.assignment_type.replace('_', ' ')}</span>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_COLORS[task.status] ?? 'bg-muted text-muted-foreground'}`}>{task.status.replace('_', ' ')}</span>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{assignedToName}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{assignedByName}</td>
      <td className={`px-4 py-3 text-xs ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
        {task.due_at ? timeAgo(task.due_at) : '—'}
      </td>
      <td className="px-4 py-3">
        {ACTIVE_STATUSES.includes(task.status) && (
          <div className="flex gap-1.5">
            {task.status === 'pending' && <>
              <ActionBtn label="Accept" icon={<CheckCircle2 className="w-3 h-3" />} onClick={() => act('accept')} loading={acting === 'accept'} color="success" />
              <ActionBtn label="Decline" icon={<XCircle className="w-3 h-3" />} onClick={() => act('decline')} loading={acting === 'decline'} color="ghost" />
            </>}
            {task.status === 'accepted' && <ActionBtn label="Start" icon={<Play className="w-3 h-3" />} onClick={() => act('start')} loading={acting === 'start'} color="primary" />}
            {task.status === 'in_progress' && <ActionBtn label="Complete" icon={<CheckCircle2 className="w-3 h-3" />} onClick={() => act('complete')} loading={acting === 'complete'} color="success" />}
            {task.status === 'blocked' && <ActionBtn label="Resume" icon={<Play className="w-3 h-3" />} onClick={() => act('start')} loading={acting === 'start'} color="primary" />}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: Tab }) {
  const copy: Record<Tab, { title: string; sub: string }> = {
    needs_attention: { title: 'Handoff queue is clear', sub: 'Agent approvals, escalations, and assigned work that need your action will appear here.' },
    delegated:       { title: 'Nothing delegated', sub: 'Tasks handed to humans or agents will appear here for follow-through.' },
    all:             { title: 'No handoffs yet', sub: 'This queue records the agent-to-human loop for approvals, reviews, and delegated tasks.' },
  };
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
        <InboxIcon className="w-7 h-7 text-muted-foreground/50" />
      </div>
      <p className="text-base font-semibold text-foreground">{copy[tab].title}</p>
      <p className="text-sm text-muted-foreground mt-1">{copy[tab].sub}</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [tab, setTab] = useState<Tab>('needs_attention');
  const [view, setView] = useState<ViewMode>('card');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>({ key: 'created_at', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [selectedHitl, setSelectedHitl] = useState<HITLRequest | null>(null);
  const pageSize = 25;

  const { openQuickAdd } = useAppStore();
  const { data: whoami } = useWhoAmI() as any;
  const myActorId: string | undefined = whoami?.actor_id;

  const hitlQ = useHITLRequests({ status: 'pending', limit: 200 });
  const allHitlQ = useHITLRequests({ status: 'all', limit: 200 });
  const myAssignQ = useAssignments(myActorId ? { assigned_to: myActorId, limit: 200 } : undefined);
  const delegatedQ = useAssignments(myActorId ? { assigned_by: myActorId, limit: 200 } : undefined);
  const allAssignQ = useAssignments({ limit: 200 });
  const actorsQ = useActors({ limit: 100 }) as any;

  // Build actor name lookup
  const actorMap = useMemo(() => {
    const map = new Map<string, string>();
    (actorsQ.data?.actors ?? actorsQ.data?.data ?? []).forEach((a: any) => {
      map.set(a.id, a.display_name ?? a.name ?? a.email ?? a.id);
    });
    return map;
  }, [actorsQ.data]);
  const actors = useMemo(
    () => ((actorsQ.data?.actors ?? actorsQ.data?.data ?? []) as any[]).filter(actor => actor.is_active !== false),
    [actorsQ.data],
  );

  const pendingHitl: HITLRequest[] = useMemo(() =>
    ((hitlQ.data as any)?.data ?? []).filter((r: any) => r.status === 'pending'), [hitlQ.data]);
  const allHitl: HITLRequest[] = useMemo(() =>
    ((allHitlQ.data as any)?.data ?? []), [allHitlQ.data]);
  const visibleHitl = tab === 'all' ? allHitl : pendingHitl;

  useEffect(() => {
    if (!selectedHitl) return;
    const fresh = [...pendingHitl, ...allHitl].find(req => req.id === selectedHitl.id);
    if (fresh) setSelectedHitl(fresh);
  }, [pendingHitl, allHitl, selectedHitl]);

  const myAssignments: Assignment[] = (myAssignQ.data as any)?.assignments ?? [];
  const delegatedRaw: Assignment[] = (delegatedQ.data as any)?.assignments ?? [];
  const allAssignmentsRaw: Assignment[] = (allAssignQ.data as any)?.assignments ?? [];

  const activeMyAssignments = useMemo(
    () => myAssignments.filter(a => ACTIVE_STATUSES.includes(a.status)),
    [myAssignments]
  );
  const activeDelegated = useMemo(
    () => delegatedRaw.filter(a => ACTIVE_STATUSES.includes(a.status) && a.assigned_to !== myActorId),
    [delegatedRaw, myActorId]
  );

  // Source list based on tab
  const sourceList = useMemo(() => {
    if (tab === 'needs_attention') return activeMyAssignments;
    if (tab === 'delegated') return activeDelegated;
    return allAssignmentsRaw;
  }, [tab, activeMyAssignments, activeDelegated, allAssignmentsRaw]);

  // Filter + search + sort
  const filtered = useMemo(() => {
    let result = [...sourceList];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.title.toLowerCase().includes(q) ||
        (a.context ?? '').toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q)
      );
    }
    if (activeFilters.status?.length)          result = result.filter(a => activeFilters.status.includes(a.status));
    if (activeFilters.priority?.length)        result = result.filter(a => activeFilters.priority.includes(a.priority));
    if (activeFilters.assignment_type?.length) result = result.filter(a => activeFilters.assignment_type.includes(a.assignment_type));

    if (sort) {
      result.sort((a, b) => {
        if (sort.key === 'priority') {
          return sort.dir === 'asc'
            ? (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
            : (PRIORITY_ORDER[b.priority] ?? 2) - (PRIORITY_ORDER[a.priority] ?? 2);
        }
        const aVal = (a as any)[sort.key] ?? '';
        const bVal = (b as any)[sort.key] ?? '';
        return sort.dir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
      });
    }
    return result;
  }, [sourceList, search, activeFilters, sort]);

  const filteredHitl = useMemo(() => {
    let result = [...visibleHitl];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(req => {
        const subject = inferApprovalSubject(req);
        const payloadText = isRecord(req.action_payload) ? JSON.stringify(req.action_payload).toLowerCase() : '';
        return req.action_summary.toLowerCase().includes(q) ||
          req.action_type.toLowerCase().includes(q) ||
          (subject.label ?? '').toLowerCase().includes(q) ||
          payloadText.includes(q);
      });
    }
    if (activeFilters.status?.length) result = result.filter(req => activeFilters.status.includes(req.status));
    if (activeFilters.priority?.length) result = result.filter(req => activeFilters.priority.includes(req.priority ?? 'normal'));
    if (activeFilters.assignment_type?.length) result = result.filter(req => activeFilters.assignment_type.includes(req.action_type));
    if (sort) {
      result.sort((a, b) => {
        if (sort.key === 'priority') {
          return sort.dir === 'asc'
            ? (PRIORITY_ORDER[a.priority ?? 'normal'] ?? 2) - (PRIORITY_ORDER[b.priority ?? 'normal'] ?? 2)
            : (PRIORITY_ORDER[b.priority ?? 'normal'] ?? 2) - (PRIORITY_ORDER[a.priority ?? 'normal'] ?? 2);
        }
        const aVal = sort.key === 'title' ? a.action_summary : (a as any)[sort.key] ?? '';
        const bVal = sort.key === 'title' ? b.action_summary : (b as any)[sort.key] ?? '';
        return sort.dir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
      });
    }
    return result;
  }, [visibleHitl, search, activeFilters, sort]);

  useEffect(() => { setPage(1); }, [tab, search, activeFilters, sort]);

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const needsAttentionCount = pendingHitl.length + activeMyAssignments.length;
  const isLoading = hitlQ.isLoading || allHitlQ.isLoading || myAssignQ.isLoading || allAssignQ.isLoading;

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => { const next = { ...prev }; if (values.length === 0) delete next[key]; else next[key] = values; return next; });
  };
  const handleSortChange = (key: string) => {
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: string }) => (
    <th onClick={() => handleSortChange(sortKey)} className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
      <span className="inline-flex items-center gap-1">
        {label}
        {sort?.key === sortKey && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Handoffs"
        icon={InboxIcon}
        iconClassName="text-destructive"
        description={headerDescription('Review agent requests and assignments', tab === 'needs_attention' ? needsAttentionCount : tab === 'all' ? filteredHitl.length + filtered.length : filtered.length, 'handoff')}
      >
        <div className="hidden h-9 rounded-xl border border-border bg-muted p-0.5 md:inline-flex md:mr-2">
          {([{ mode: 'card', icon: LayoutGrid }, { mode: 'table', icon: List }] as const).map(({ mode, icon: Icon }) => (
            <button key={mode} onClick={() => setView(mode)}
              className={`p-1.5 rounded-lg transition-all ${view === mode ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </TopBar>

      {/* Tab strip — same pill style as Use Cases prod date */}
      <div className="px-4 md:px-6 pt-3 pb-1 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-border bg-muted/40 p-0.5 gap-0.5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={['px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5',
                tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}>
              {t.label}
              {t.key === 'needs_attention' && needsAttentionCount > 0 && (
                <span className={`min-w-[16px] h-4 px-1 rounded-full text-xs font-bold flex items-center justify-center ${
                  tab === t.key ? 'bg-destructive text-white' : 'bg-muted-foreground/20 text-muted-foreground'
                }`}>{needsAttentionCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <ListToolbar
        searchValue={search} onSearchChange={setSearch}
        searchPlaceholder="Search requests and assignments..."
        filters={FILTER_CONFIGS} activeFilters={activeFilters}
        onFilterChange={handleFilterChange} onClearFilters={() => setActiveFilters({})}
        sortOptions={SORT_OPTIONS} currentSort={sort} onSortChange={handleSortChange}
        onAdd={() => openQuickAdd('assignment')} addLabel="New Assignment"
        entityType="assignments"
      />

      <div className="flex-1 overflow-y-auto pb-24 md:pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* HITL requests — shown in Needs Attention and All; Delegated remains assignment-focused. */}
            {(tab === 'needs_attention' || tab === 'all') && filteredHitl.length > 0 && (
              <div className="px-4 md:px-6 pt-4 pb-2">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">Approval Requests</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">{filteredHitl.length}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {view === 'card' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredHitl.map(r => <HITLCard key={r.id} req={r} onOpenDetails={() => setSelectedHitl(r)} />)}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-surface-sunken/50">
                            <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Priority</th>
                            <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Request</th>
                            <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Type</th>
                            <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Status</th>
                            <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Created</th>
                            <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Reviewer</th>
                            <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Due</th>
                            <th className="px-4 py-3" />
                          </tr>
                        </thead>
                        <tbody>
                          {filteredHitl.map((r, i) => <HITLTableRow key={r.id} req={r} index={i} actorMap={actorMap} onOpenDetails={() => setSelectedHitl(r)} />)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Assignments */}
            {paginated.length === 0 && filteredHitl.length === 0 ? (
              <EmptyState tab={tab} />
            ) : paginated.length === 0 && (tab === 'needs_attention' || tab === 'all') ? null : paginated.length === 0 ? (
              <EmptyState tab={tab} />
            ) : view === 'card' ? (
              <div className="px-4 md:px-6 pt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {tab === 'needs_attention' && paginated.length > 0 && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">My Tasks</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">{paginated.length}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                {paginated.map(a => <AssignmentCard key={a.id} task={a} actorMap={actorMap} />)}
              </div>
            ) : (
              <div className="px-4 md:px-6 pt-4 overflow-x-auto">
                <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-sunken/50">
                        <SortHeader label="Priority" sortKey="priority" />
                        <SortHeader label="Title" sortKey="title" />
                        <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Type</th>
                        <SortHeader label="Status" sortKey="status" />
                        <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Assigned To</th>
                        <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Assigned By</th>
                        <SortHeader label="Due" sortKey="due_at" />
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((a, i) => (
                        <AssignmentTableRow key={a.id} task={a} actorMap={actorMap} index={i} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {filtered.length > pageSize && (
              <div className="px-4 md:px-6 pt-4">
                <PaginationBar page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={() => {}} />
              </div>
            )}
          </>
        )}
      </div>
      <AnimatePresence>
        {selectedHitl && (
          <HITLDetailDrawer
            key={selectedHitl.id}
            req={selectedHitl}
            actors={actors}
            actorMap={actorMap}
            onClose={() => setSelectedHitl(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
