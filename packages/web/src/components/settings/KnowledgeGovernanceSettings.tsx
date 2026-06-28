// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Trusted Facts governance (admin).
 *
 * The UI surface for the Phase 7 governance tools (knowledge_claim_list,
 * knowledge_claim_review, knowledge_conflicts_detect). Optional and
 * non-blocking: when no Trusted Facts are configured this shows an
 * explanatory empty state, never an error. Customer-facing eligibility
 * (approved + external use) is the most consequential decision here, so it is
 * an explicit, separate action from internal approval.
 */

import React, { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import {
  useKnowledgeClaims, useReviewKnowledgeClaim, useDetectKnowledgeConflicts,
  type KnowledgeClaimListFilters,
} from '@/api/hooks';
import type { KnowledgeClaimRecord, KnowledgeReviewDecision } from '@crmy/shared';
import {
  BookOpen, CheckCircle2, XCircle, Archive, Clock, RotateCcw, ShieldCheck,
  AlertTriangle, Search, GitCompareArrows, Loader2, Filter,
} from 'lucide-react';

const btnPrimary = 'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40';
const btnApprove = 'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-600/90 disabled:opacity-40';
const btnApproveOutline = 'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-500/30 px-3 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-500/10 disabled:opacity-40 dark:text-emerald-400';
const btnOutline = 'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40';
const inputCls = 'h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

type FilterKey = 'needs_review' | 'all' | 'active' | 'stale' | 'conflicting' | 'pending';
type KnowledgeTypeFilter = 'all' | KnowledgeClaimRecord['knowledge_type'];

const FILTERS: { key: FilterKey; label: string; filters: KnowledgeClaimListFilters }[] = [
  { key: 'needs_review', label: 'Needs review', filters: { needs_review: true } },
  { key: 'active',       label: 'Trusted',       filters: { status: 'active' } },
  { key: 'stale',        label: 'Stale',         filters: { status: 'stale' } },
  { key: 'conflicting',  label: 'Conflicting',   filters: { status: 'conflicting' } },
  { key: 'pending',      label: 'Fact candidates', filters: { approval_status: 'pending' } },
  { key: 'all',          label: 'All',           filters: {} },
];

const TYPE_FILTERS: { key: KnowledgeTypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'company', label: 'Company' },
  { key: 'product', label: 'Product' },
  { key: 'competitor', label: 'Competitor' },
];

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
  stale: 'border-warning/30 bg-warning/10 text-warning',
  conflicting: 'border-destructive/30 bg-destructive/10 text-destructive',
  deprecated: 'border-border bg-muted text-muted-foreground',
  rejected: 'border-border bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'live',
  stale: 'needs review',
  conflicting: 'conflict',
  deprecated: 'retired',
  rejected: 'rejected',
};

const APPROVAL_TONE: Record<string, string> = {
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
  pending: 'border-warning/30 bg-warning/10 text-warning',
  unapproved: 'border-border bg-muted text-muted-foreground',
  rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
};

const APPROVAL_LABEL: Record<string, string> = {
  approved: 'approved',
  pending: 'fact candidate',
  unapproved: 'fact candidate',
  rejected: 'rejected',
};

const CONFLICT_TONE: Record<string, string> = {
  prefer_authoritative: 'border-info/30 bg-info/10 text-info',
  prefer_approved: 'border-info/30 bg-info/10 text-info',
  manual_review: 'border-warning/30 bg-warning/10 text-warning',
};

function formatDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function typeLabel(type: KnowledgeClaimRecord['knowledge_type']): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatFactCount(count: number): string {
  return `${count} ${count === 1 ? 'fact' : 'facts'}`;
}

function customerGate(claim: KnowledgeClaimRecord, expired: boolean): { label: string; tone: string } {
  if (claim.status === 'deprecated' || claim.status === 'rejected') {
    return { label: 'retired', tone: 'border-border bg-muted text-muted-foreground' };
  }
  if (!claim.grounded) {
    return { label: 'needs review', tone: 'border-warning/30 bg-warning/10 text-warning' };
  }
  if (claim.status === 'conflicting') {
    return { label: 'needs review', tone: 'border-destructive/30 bg-destructive/10 text-destructive' };
  }
  if (claim.status === 'stale' || expired) {
    return { label: 'needs review', tone: 'border-warning/30 bg-warning/10 text-warning' };
  }
  if (claim.approval_status !== 'approved') {
    return { label: 'fact candidate', tone: 'border-warning/30 bg-warning/10 text-warning' };
  }
  if (!claim.approved_for_external_use || claim.visibility !== 'external') {
    return { label: 'internal only', tone: 'border-border bg-muted text-muted-foreground' };
  }
  return { label: 'trusted', tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' };
}

function ClaimCard({ claim }: { claim: KnowledgeClaimRecord }) {
  const review = useReviewKnowledgeClaim();
  const expired = !!claim.valid_until && new Date(claim.valid_until).getTime() < Date.now();
  const isApproved = claim.approval_status === 'approved';
  const needsApproval = claim.approval_status === 'pending' || claim.approval_status === 'unapproved';
  const isRetired = claim.status === 'deprecated' || claim.status === 'rejected';
  const canApproveForCustomer = !isRetired && claim.grounded && (
    needsApproval ||
    !claim.approved_for_external_use ||
    claim.visibility !== 'external' ||
    claim.status === 'stale' ||
    claim.status === 'conflicting'
  ) && !expired;
  const canApproveInternal = !isRetired && needsApproval;
  const gate = customerGate(claim, expired);
  const customerActionLabel = isApproved
    ? claim.status === 'stale'
      ? 'Re-verify as trusted'
      : claim.status === 'conflicting'
        ? 'Mark trusted'
        : 'Trust for customer use'
    : 'Approve as trusted';

  const apply = (decision: KnowledgeReviewDecision, approved_for_external_use?: boolean) => {
    review.mutate(
      { id: claim.id, decision, approved_for_external_use },
      {
        onSuccess: (updated) => toast({ title: 'Trusted Fact updated', description: `"${claim.title}" -> ${updated.status} / ${updated.approval_status}` }),
        onError: (err: unknown) => toast({ title: 'Review failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="border-info/30 bg-info/10 text-info">{typeLabel(claim.knowledge_type)}</Badge>
            <Badge tone="border-border bg-muted text-muted-foreground">{claim.category}</Badge>
            <span className="font-semibold text-sm text-foreground truncate">{claim.title}</span>
          </div>
          {claim.summary && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{claim.summary}</p>}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
        <Badge tone={STATUS_TONE[claim.status] ?? STATUS_TONE.deprecated}>{STATUS_LABEL[claim.status] ?? claim.status}</Badge>
        <Badge tone={APPROVAL_TONE[claim.approval_status] ?? APPROVAL_TONE.unapproved}>{APPROVAL_LABEL[claim.approval_status] ?? claim.approval_status}</Badge>
        <Badge tone={gate.tone}>{gate.label}</Badge>
        <Badge tone="border-border bg-muted text-muted-foreground">{claim.source_priority}</Badge>
        {!claim.grounded && <Badge tone="border-warning/30 bg-warning/10 text-warning">ungrounded</Badge>}
        {claim.valid_until && (
          <Badge tone={expired ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-border bg-muted text-muted-foreground'}>
            {expired ? `expired ${formatDate(claim.valid_until)}` : `valid until ${formatDate(claim.valid_until)}`}
          </Badge>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {review.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {canApproveForCustomer && (
          <button className={btnApprove} disabled={review.isPending} onClick={() => apply('approve', true)} title="Approve and allow in customer-facing drafts">
            <ShieldCheck className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />{customerActionLabel}
          </button>
        )}
        {canApproveInternal && (
          <button className={btnApproveOutline} disabled={review.isPending} onClick={() => apply('approve', false)} title="Approve for internal use only">
            <CheckCircle2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Approve internal
          </button>
        )}
        {claim.status === 'active' && (
          <button className={btnOutline} disabled={review.isPending} onClick={() => apply('mark_stale')}>
            <Clock className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Mark needs review
          </button>
        )}
        {((claim.status === 'stale' && !expired) || isRetired) && (
          <button className={btnOutline} disabled={review.isPending} onClick={() => apply('reactivate')}>
            <RotateCcw className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Restore
          </button>
        )}
        {claim.status !== 'deprecated' && (
          <button className={btnOutline} disabled={review.isPending} onClick={() => apply('deprecate')}>
            <Archive className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Retire
          </button>
        )}
        {claim.status !== 'rejected' && (
          <button className={btnOutline} disabled={review.isPending} onClick={() => apply('reject')}>
            <XCircle className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Reject
          </button>
        )}
      </div>
    </div>
  );
}

function ConflictsPanel() {
  const detect = useDetectKnowledgeConflicts();
  const [applyResolution, setApplyResolution] = useState(false);
  const result = detect.data;

  return (
    <details className="rounded-lg border border-border bg-card p-3">
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-foreground">
        <span className="flex items-center gap-2">
          <GitCompareArrows className="w-4 h-4 text-info" />
          Advanced conflict scan
        </span>
        <span className="text-xs font-normal text-muted-foreground">Run when facts disagree</span>
      </summary>
      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">
          CRMy already keeps stale, conflicting, unapproved, and ungrounded facts out of customer-facing retrieval. Use this scan when you want to review competing facts across sources.
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={applyResolution} onChange={(e) => setApplyResolution(e.target.checked)} />
            Mark lower-priority fact conflicting
          </label>
          <button
            className={btnPrimary}
            disabled={detect.isPending}
            onClick={() => detect.mutate({ apply: applyResolution }, {
              onSuccess: (r) => toast({ title: 'Conflict scan complete', description: `${r.conflicts.length} conflict(s)${r.applied ? `, ${r.applied} marked conflicting` : ''}` }),
              onError: (err: unknown) => toast({ title: 'Scan failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' }),
            })}
          >
            {detect.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Detect conflicts
          </button>
        </div>
      </div>
      {result && result.conflicts.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No competing facts detected.</p>
      )}
      {result && result.conflicts.length > 0 && (
        <div className="mt-3 space-y-2">
          {result.conflicts.map((c, i) => (
            <div key={i} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone={CONFLICT_TONE[c.suggested_action] ?? CONFLICT_TONE.manual_review}>{c.suggested_action.replace(/_/g, ' ')}</Badge>
                <Badge tone="border-border bg-muted text-muted-foreground">{c.category}</Badge>
                <span className="text-xs text-muted-foreground">by {c.basis}{c.shared.length ? `: ${c.shared.join(', ')}` : ''}</span>
              </div>
              <p className="mt-1.5 text-sm text-foreground">{c.detail}</p>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

export default function KnowledgeGovernanceSettings() {
  const [typeFilter, setTypeFilter] = useState<KnowledgeTypeFilter>('all');
  const [filterKey, setFilterKey] = useState<FilterKey>('needs_review');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');

  const active = FILTERS.find(f => f.key === filterKey)!;
  const { data, isLoading, isError, error } = useKnowledgeClaims({
    ...active.filters,
    ...(typeFilter === 'all' ? {} : { knowledge_type: typeFilter }),
    query: query || undefined,
    limit: 50,
  });
  const claims = data?.claims ?? [];
  const noKnowledgeConfigured = filterKey === 'all' && typeFilter === 'all' && !query && !isLoading && claims.length === 0;
  const visibleFactCount = data?.count ?? claims.length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Trusted Facts</span>
            <span className="text-xs text-muted-foreground">{formatFactCount(visibleFactCount)} shown</span>
          </div>
          <form
            className="flex min-w-0 items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); setQuery(searchInput.trim()); }}
          >
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                className={`${inputCls} w-full pl-8`}
                placeholder="Search facts..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </form>
        </div>

        <div className="flex flex-col gap-3 px-3 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              Type
            </span>
            {TYPE_FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setTypeFilter(f.key)}
                className={`h-8 rounded-lg border px-3 text-xs font-medium transition-colors ${typeFilter === f.key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilterKey(f.key)}
                className={`h-8 rounded-lg border px-3 text-xs font-medium transition-colors ${filterKey === f.key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ConflictsPanel />

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-28 rounded-lg border border-border bg-card animate-pulse" />)}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error instanceof Error ? error.message : 'Failed to load Trusted Facts.'}
        </div>
      )}

      {!isLoading && !isError && noKnowledgeConfigured && (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <BookOpen className="w-6 h-6 mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">No Trusted Facts configured</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Connect an MCP Knowledge Source when you are ready to sync company, product, or competitor facts.
            Until then, briefings and drafts keep working from customer context.
          </p>
        </div>
      )}

      {!isLoading && !isError && !noKnowledgeConfigured && claims.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {filterKey === 'needs_review' ? 'Nothing needs review right now.' : 'No facts match this filter.'}
        </div>
      )}

      {!isLoading && !isError && claims.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{formatFactCount(visibleFactCount)}</p>
          {claims.map(c => <ClaimCard key={c.id} claim={c} />)}
        </div>
      )}
    </div>
  );
}
