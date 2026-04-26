// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo } from 'react';
import { formatDistanceToNow, format, isPast, addDays } from 'date-fns';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from '@/hooks/use-toast';
import { useAppStore } from '@/store/appStore';
import { useSupersedeContextEntry, useReviewContextEntry, useContextTypes } from '@/api/hooks';
import {
  User, Building2, Briefcase, FolderKanban,
  Bot, UserCircle2, Clock, Tag, ExternalLink,
  ChevronDown, ChevronRight, Copy, CheckCircle2,
  AlertTriangle, RefreshCcw, Trash2, Edit3,
  ShieldCheck, Activity,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEntry = Record<string, any>;

export interface ContextEntryDrawerProps {
  entry: AnyEntry | null;
  open: boolean;
  onClose: () => void;
}

// ── Constants shared with ContextBrowser ──────────────────────────────────────

const SUBJECT_ICONS: Record<string, React.ElementType> = {
  contact:     User,
  account:     Building2,
  opportunity: Briefcase,
  use_case:    FolderKanban,
};
const SUBJECT_COLORS: Record<string, string> = {
  contact:     '#f97316',
  account:     '#8b5cf6',
  opportunity: '#0ea5e9',
  use_case:    '#22c55e',
};
const DRAWER_TYPE_MAP: Record<string, 'contact' | 'account' | 'opportunity' | 'use-case'> = {
  contact: 'contact', account: 'account', opportunity: 'opportunity', use_case: 'use-case',
};

// Context type color map (from ContextPanel)
const TYPE_COLORS: Record<string, string> = {
  objection:         '#ef4444',
  preference:        '#f97316',
  competitive_intel: '#eab308',
  research:          '#22c55e',
  summary:           '#3b82f6',
  relationship_map:  '#8b5cf6',
  meeting_notes:     '#06b6d4',
  agent_reasoning:   '#6366f1',
  commitment:        '#10b981',
  next_step:         '#f59e0b',
  deal_risk:         '#dc2626',
  stakeholder:       '#7c3aed',
  key_fact:          '#0284c7',
  note:              '#64748b',
};

// ── Confidence decay helpers ───────────────────────────────────────────────────

function effectiveConfidence(stored: number, createdAt: string, halfLifeDays: number | null): number {
  if (!halfLifeDays) return stored;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  return stored * Math.pow(0.5, ageDays / halfLifeDays);
}

function confColor(pct: number): string {
  if (pct >= 70) return '#22c55e';
  if (pct >= 40) return '#f59e0b';
  return '#ef4444';
}

function confLabel(pct: number): string {
  if (pct >= 80) return 'High';
  if (pct >= 50) return 'Medium';
  return 'Low';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const color = confColor(pct);
  return (
    <div className="space-y-1">
      {label && <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        <span className="text-xs font-semibold tabular-nums" style={{ color }}>{pct}%</span>
        <span className="text-xs text-muted-foreground">{confLabel(pct)}</span>
      </div>
    </div>
  );
}

function DecayTimeline({
  stored,
  createdAt,
  halfLifeDays,
}: {
  stored: number;
  createdAt: string;
  halfLifeDays: number;
}) {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  const points = [
    { label: 'Created', days: 0,               value: stored },
    { label: `${halfLifeDays}d`,  days: halfLifeDays,     value: stored * 0.5 },
    { label: `${halfLifeDays * 2}d`, days: halfLifeDays * 2, value: stored * 0.25 },
  ];
  const todayValue = effectiveConfidence(stored, createdAt, halfLifeDays);
  const todayPct = Math.round(Math.min(1, Math.max(0, todayValue)) * 100);
  const todayX = Math.min(100, (ageDays / (halfLifeDays * 2)) * 100);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Decay timeline (half-life: {halfLifeDays}d)</p>
      {/* Bar markers */}
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-0.5 bg-muted rounded" />
        {points.map((p, i) => {
          const x = (i / (points.length - 1)) * 100;
          const pct = Math.round(p.value * 100);
          const color = confColor(pct);
          return (
            <div key={p.label} style={{ left: `${x}%` }} className="absolute top-0 flex flex-col items-center gap-0.5 -translate-x-1/2">
              <div className="w-2 h-2 rounded-full border-2 border-background" style={{ backgroundColor: color }} />
              <span className="text-xs text-muted-foreground mt-3 whitespace-nowrap">{p.label}</span>
            </div>
          );
        })}
        {/* Today marker */}
        <div style={{ left: `${todayX}%` }} className="absolute top-0 flex flex-col items-center -translate-x-1/2">
          <div
            className="w-2.5 h-2.5 rounded-full border-2 border-background ring-1"
            style={{ backgroundColor: confColor(todayPct), outlineColor: confColor(todayPct) }}
          />
          <span className="text-xs font-semibold mt-3 whitespace-nowrap" style={{ color: confColor(todayPct) }}>
            Today ({todayPct}%)
          </span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border pt-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full mb-3 group"
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">
          {title}
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && children}
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────

export function ContextEntryDrawer({ entry, open, onClose }: ContextEntryDrawerProps) {
  const openDrawer      = useAppStore(s => s.openDrawer);
  const supersedeEntry  = useSupersedeContextEntry();
  const reviewEntry     = useReviewContextEntry();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contextTypesData } = useContextTypes() as any;
  const contextTypes: Record<string, { confidence_half_life_days?: number | null }> = useMemo(() => {
    const arr: { type_name: string; confidence_half_life_days?: number | null }[] = contextTypesData?.data ?? [];
    return Object.fromEntries(arr.map(t => [t.type_name, t]));
  }, [contextTypesData]);

  // Supersede form state
  const [supersedeOpen, setSupersedeOpen] = useState(false);
  const [supersedeBody, setSupersedeBody] = useState('');
  const [supersedeConf, setSupersedeConf] = useState<number | null>(null);

  // Forget confirm state
  const [forgetOpen, setForgetOpen] = useState(false);

  // Copied-to-clipboard feedback
  const [copied, setCopied] = useState(false);

  if (!entry) return null;

  const halfLife = contextTypes[entry.context_type]?.confidence_half_life_days ?? null;
  const storedConf: number | null = entry.confidence ?? entry.confidence_score ?? null;
  const effectiveConf = storedConf !== null && halfLife
    ? effectiveConfidence(storedConf, entry.created_at, halfLife)
    : storedConf;

  const expired = entry.valid_until ? isPast(new Date(entry.valid_until)) : false;
  const isSuperseded = entry.is_current === false;

  const SubjectIcon = SUBJECT_ICONS[entry.subject_type] ?? User;
  const subjectColor = SUBJECT_COLORS[entry.subject_type] ?? '#94a3b8';
  const typeColor = TYPE_COLORS[entry.context_type] ?? '#64748b';

  const structuredDataKeys = Object.keys(entry.structured_data ?? {}).filter(k => entry.structured_data[k] != null && entry.structured_data[k] !== '');

  // Actions
  async function handleReview() {
    if (!entry) return;
    try {
      await reviewEntry.mutateAsync(entry.id);
      toast({ title: 'Marked as reviewed', description: 'Validity extended by 30 days.' });
      onClose();
    } catch {
      toast({ title: 'Failed to review', variant: 'destructive' });
    }
  }

  async function handleSupersede() {
    if (!entry || !supersedeBody.trim()) return;
    try {
      await supersedeEntry.mutateAsync({
        id: entry.id,
        body: supersedeBody.trim(),
        ...(supersedeConf !== null ? { confidence: supersedeConf } : {}),
      });
      toast({ title: 'Entry superseded', description: 'The old entry has been replaced.' });
      setSupersedeOpen(false);
      setSupersedeBody('');
      setSupersedeConf(null);
      onClose();
    } catch {
      toast({ title: 'Failed to supersede', variant: 'destructive' });
    }
  }

  async function handleForget() {
    if (!entry) return;
    const now = format(new Date(), 'yyyy-MM-dd');
    try {
      await supersedeEntry.mutateAsync({
        id: entry.id,
        body: `[Forgotten by user on ${now}]`,
        confidence: 0,
      });
      toast({ title: 'Entry forgotten', description: 'The belief has been invalidated. Audit record preserved.' });
      setForgetOpen(false);
      onClose();
    } catch {
      toast({ title: 'Failed to forget', variant: 'destructive' });
    }
  }

  function handleCopyId() {
    if (!entry) return;
    navigator.clipboard.writeText(entry.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col gap-0 p-0 overflow-hidden"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {/* Type badge */}
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize"
              style={{ backgroundColor: typeColor + '18', color: typeColor, border: `1px solid ${typeColor}30` }}
            >
              {entry.context_type?.replace(/_/g, ' ')}
            </span>
            {/* Subject chip */}
            <button
              onClick={() => entry.subject_id && openDrawer(DRAWER_TYPE_MAP[entry.subject_type] ?? 'contact', entry.subject_id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors hover:opacity-80"
              style={{ backgroundColor: subjectColor + '18', color: subjectColor, border: `1px solid ${subjectColor}30` }}
            >
              <SubjectIcon className="w-2.5 h-2.5" />
              {entry.subject_name || entry.subject_type}
              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
            </button>
            {/* Status badges */}
            {isSuperseded && (
              <Badge variant="outline" className="text-xs text-muted-foreground border-muted">superseded</Badge>
            )}
            {expired && !isSuperseded && (
              <Badge variant="outline" className="text-xs text-destructive border-destructive/30">expired</Badge>
            )}
          </div>
          <SheetTitle className="text-base font-semibold text-foreground text-left leading-snug">
            {entry.title || <span className="text-muted-foreground italic">Untitled entry</span>}
          </SheetTitle>
          <SheetDescription className="sr-only">Context entry detail view</SheetDescription>
        </SheetHeader>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Confidence & decay */}
          {storedConf !== null && (
            <Section title="Confidence" defaultOpen>
              <div className="space-y-3">
                <ConfidenceBar value={storedConf} label="Stored confidence" />
                {halfLife && (
                  <>
                    <ConfidenceBar value={effectiveConf!} label="Effective today (after decay)" />
                    <DecayTimeline stored={storedConf} createdAt={entry.created_at} halfLifeDays={halfLife} />
                  </>
                )}
                {!halfLife && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    No decay — this knowledge type is treated as a permanent record.
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* Body */}
          <Section title="Content" defaultOpen>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{entry.body}</p>
            {structuredDataKeys.length > 0 && (
              <div className="mt-3 rounded-lg border border-border overflow-hidden">
                {structuredDataKeys.map(k => (
                  <div key={k} className="flex items-start gap-3 px-3 py-2 border-b border-border last:border-0 text-xs">
                    <span className="text-muted-foreground font-medium capitalize min-w-[100px] flex-shrink-0">
                      {k.replace(/_/g, ' ')}
                    </span>
                    <span className="text-foreground break-words">
                      {typeof entry.structured_data[k] === 'object'
                        ? JSON.stringify(entry.structured_data[k])
                        : String(entry.structured_data[k])}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Provenance */}
          <Section title="Provenance" defaultOpen>
            <div className="space-y-2.5 text-xs">
              {/* Author */}
              <div className="flex items-center gap-2">
                {entry.authored_by_type === 'agent'
                  ? <Bot className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                  : <UserCircle2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                }
                <span className="text-muted-foreground">Authored by</span>
                <span className="font-medium text-foreground">{entry.authored_by_name ?? 'Unknown'}</span>
                <span
                  className="px-1.5 py-0.5 rounded text-xs font-semibold uppercase"
                  style={entry.authored_by_type === 'agent'
                    ? { background: '#7c3aed18', color: '#7c3aed' }
                    : { background: '#3b82f618', color: '#3b82f6' }
                  }
                >
                  {entry.authored_by_type ?? 'human'}
                </span>
              </div>
              {/* Source label */}
              {entry.source && (
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground">Source</span>
                  <span className="font-medium text-foreground">{entry.source}</span>
                  {entry.source_ref && (
                    <span className="text-muted-foreground">({entry.source_ref})</span>
                  )}
                </div>
              )}
              {/* Created at */}
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">Created</span>
                <span className="font-medium text-foreground">
                  {format(new Date(entry.created_at), 'MMM d, yyyy')}
                </span>
                <span className="text-muted-foreground">
                  ({formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })})
                </span>
              </div>
              {/* Last reviewed */}
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">Last reviewed</span>
                <span className={`font-medium ${entry.reviewed_at ? 'text-foreground' : 'text-muted-foreground italic'}`}>
                  {entry.reviewed_at
                    ? formatDistanceToNow(new Date(entry.reviewed_at), { addSuffix: true })
                    : 'Never reviewed'}
                </span>
              </div>
            </div>
          </Section>

          {/* Tags */}
          {(entry.tags ?? []).length > 0 && (
            <Section title="Tags" defaultOpen>
              <div className="flex flex-wrap gap-1.5">
                {(entry.tags as string[]).map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs font-medium text-muted-foreground"
                  >
                    <Tag className="w-2.5 h-2.5" />
                    {tag}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Validity */}
          <Section title="Validity" defaultOpen>
            {entry.valid_until ? (
              <div className="space-y-2">
                <div className={`flex items-center gap-2 text-xs ${expired ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {expired && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                  <span>
                    {expired ? 'Expired ' : 'Valid until '}
                    <span className="font-medium">
                      {format(new Date(entry.valid_until), 'MMM d, yyyy')}
                    </span>
                    {' '}({formatDistanceToNow(new Date(entry.valid_until), { addSuffix: true })})
                  </span>
                </div>
                {expired && !isSuperseded && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={handleReview}
                    disabled={reviewEntry.isPending}
                  >
                    <RefreshCcw className="w-3 h-3" />
                    Extend validity (30 days)
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No expiry set — entry does not expire automatically.</p>
            )}
          </Section>

          {/* History (supersession chain) */}
          {entry.supersedes_id && (
            <Section title="History" defaultOpen={false}>
              <div className="rounded-lg border border-border p-3 bg-muted/30 space-y-1 opacity-60">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Supersedes</p>
                <p className="text-xs text-foreground font-medium truncate">Entry {entry.supersedes_id.slice(0, 8)}…</p>
                <p className="text-xs text-muted-foreground">This entry replaced an older belief. The original is preserved in audit history.</p>
              </div>
            </Section>
          )}

          {/* Supersede form (inline) */}
          {supersedeOpen && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Replace with new content</p>
                <button onClick={() => { setSupersedeOpen(false); setSupersedeBody(''); setSupersedeConf(null); }} className="text-muted-foreground hover:text-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <Textarea
                placeholder="Enter the updated knowledge (the old entry will be archived)…"
                value={supersedeBody}
                onChange={e => setSupersedeBody(e.target.value)}
                className="text-sm min-h-[100px]"
                autoFocus
              />
              {/* Confidence slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    New confidence
                  </label>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: confColor(Math.round((supersedeConf ?? storedConf ?? 0.8) * 100)) }}>
                    {Math.round((supersedeConf ?? storedConf ?? 0.8) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round((supersedeConf ?? storedConf ?? 0.8) * 100)}
                  onChange={e => setSupersedeConf(Number(e.target.value) / 100)}
                  className="w-full accent-primary h-1.5 rounded cursor-pointer"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Speculative</span><span>Confirmed</span>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setSupersedeOpen(false); setSupersedeBody(''); }}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleSupersede}
                  disabled={!supersedeBody.trim() || supersedeEntry.isPending}
                >
                  {supersedeEntry.isPending ? 'Saving…' : 'Replace entry'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Sticky footer actions ───────────────────────────────────────── */}
        {!isSuperseded && (
          <div className="flex-shrink-0 border-t border-border px-5 py-3 bg-card flex items-center gap-2 flex-wrap">
            {/* Mark reviewed — highlighted if expired */}
            {expired && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={handleReview}
                disabled={reviewEntry.isPending}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mark reviewed
              </Button>
            )}

            {/* Supersede */}
            {!supersedeOpen && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => { setSupersedeOpen(true); setSupersedeBody(''); setSupersedeConf(storedConf); }}
              >
                <Edit3 className="w-3.5 h-3.5" />
                Update
              </Button>
            )}

            {/* Forget / Invalidate */}
            <Popover open={forgetOpen} onOpenChange={setForgetOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Forget
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-4 space-y-3" side="top" align="start">
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">Forget this belief?</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    The entry will be marked as intentionally forgotten and removed from active context.
                    The original record is preserved in audit history.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs flex-1"
                    onClick={() => setForgetOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs flex-1"
                    onClick={handleForget}
                    disabled={supersedeEntry.isPending}
                  >
                    {supersedeEntry.isPending ? 'Forgetting…' : 'Forget'}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Copy ID */}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={handleCopyId}
            >
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy ID'}
            </Button>
          </div>
        )}

        {/* Superseded banner */}
        {isSuperseded && (
          <div className="flex-shrink-0 border-t border-border px-5 py-3 bg-muted/30 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              This entry has been superseded and is no longer active. It is preserved for audit purposes.
            </p>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground flex-shrink-0"
              onClick={handleCopyId}
            >
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'ID'}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
