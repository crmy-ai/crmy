// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Product Knowledge governance (admin).
 *
 * The UI surface for the Phase 7 governance tools (knowledge_claim_list,
 * knowledge_claim_review, knowledge_conflicts_detect). Optional and
 * non-blocking: when no product knowledge is configured this shows an
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
  AlertTriangle, Search, GitCompareArrows, Loader2,
} from 'lucide-react';

const btnPrimary = 'px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40';
const btnOutline = 'px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40';
const inputCls = 'h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

type FilterKey = 'needs_review' | 'all' | 'active' | 'stale' | 'conflicting' | 'pending';

const FILTERS: { key: FilterKey; label: string; filters: KnowledgeClaimListFilters }[] = [
  { key: 'needs_review', label: 'Needs review', filters: { needs_review: true } },
  { key: 'active',       label: 'Active',        filters: { status: 'active' } },
  { key: 'stale',        label: 'Stale',         filters: { status: 'stale' } },
  { key: 'conflicting',  label: 'Conflicting',   filters: { status: 'conflicting' } },
  { key: 'pending',      label: 'Pending approval', filters: { approval_status: 'pending' } },
  { key: 'all',          label: 'All',           filters: {} },
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

const APPROVAL_TONE: Record<string, string> = {
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
  pending: 'border-warning/30 bg-warning/10 text-warning',
  unapproved: 'border-border bg-muted text-muted-foreground',
  rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
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

function ClaimCard({ claim }: { claim: KnowledgeClaimRecord }) {
  const review = useReviewKnowledgeClaim();
  const expired = !!claim.valid_until && new Date(claim.valid_until).getTime() < Date.now();

  const apply = (decision: KnowledgeReviewDecision, approved_for_external_use?: boolean) => {
    review.mutate(
      { id: claim.id, decision, approved_for_external_use },
      {
        onSuccess: (updated) => toast({ title: 'Claim updated', description: `"${claim.title}" → ${updated.status} / ${updated.approval_status}` }),
        onError: (err: unknown) => toast({ title: 'Review failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' }),
      },
    );
  };

  const isRetired = claim.status === 'deprecated' || claim.status === 'rejected';

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="border-border bg-muted text-muted-foreground">{claim.category}</Badge>
            <span className="font-semibold text-sm text-foreground truncate">{claim.title}</span>
          </div>
          {claim.summary && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{claim.summary}</p>}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
        <Badge tone={STATUS_TONE[claim.status] ?? STATUS_TONE.deprecated}>{claim.status}</Badge>
        <Badge tone={APPROVAL_TONE[claim.approval_status] ?? APPROVAL_TONE.unapproved}>{claim.approval_status}</Badge>
        {claim.approved_for_external_use
          ? <Badge tone="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">customer-facing</Badge>
          : <Badge tone="border-border bg-muted text-muted-foreground">internal-only</Badge>}
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
        <button className={btnPrimary} disabled={review.isPending} onClick={() => apply('approve', true)} title="Approve and allow in customer-facing drafts">
          <ShieldCheck className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Approve for customer use
        </button>
        <button className={btnOutline} disabled={review.isPending} onClick={() => apply('approve', false)} title="Approve for internal use only">
          <CheckCircle2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Approve (internal)
        </button>
        {claim.status === 'active' && (
          <button className={btnOutline} disabled={review.isPending} onClick={() => apply('mark_stale')}>
            <Clock className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Mark stale
          </button>
        )}
        {(claim.status === 'stale' || isRetired) && (
          <button className={btnOutline} disabled={review.isPending} onClick={() => apply('reactivate')}>
            <RotateCcw className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Reactivate
          </button>
        )}
        {claim.status !== 'deprecated' && (
          <button className={btnOutline} disabled={review.isPending} onClick={() => apply('deprecate')}>
            <Archive className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Deprecate
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
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="w-4 h-4 text-info" />
          <span className="font-semibold text-sm text-foreground">Conflict detection</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={applyResolution} onChange={(e) => setApplyResolution(e.target.checked)} />
            Mark the lower-priority claim conflicting
          </label>
          <button
            className={btnPrimary}
            disabled={detect.isPending}
            onClick={() => detect.mutate({ apply: applyResolution }, {
              onSuccess: (r) => toast({ title: 'Conflict scan complete', description: `${r.conflicts.length} conflict(s)${r.applied ? `, ${r.applied} marked conflicting` : ''}` }),
              onError: (err: unknown) => toast({ title: 'Scan failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' }),
            })}
          >
            {detect.isPending ? <Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" /> : null}
            Detect conflicts
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Finds same-category claims that cover the same competitor or product scope and may state competing truth, and recommends which should win.
      </p>

      {result && result.conflicts.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No competing claims detected.</p>
      )}
      {result && result.conflicts.length > 0 && (
        <div className="mt-3 space-y-2">
          {result.conflicts.map((c, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
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
    </div>
  );
}

export default function KnowledgeGovernanceSettings() {
  const [filterKey, setFilterKey] = useState<FilterKey>('needs_review');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');

  const active = FILTERS.find(f => f.key === filterKey)!;
  const { data, isLoading, isError, error } = useKnowledgeClaims({ ...active.filters, query: query || undefined, limit: 50 });
  const claims = data?.claims ?? [];
  const noKnowledgeConfigured = filterKey === 'all' && !query && !isLoading && claims.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Product Knowledge</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Govern the approved, source-grounded product and competitive claims agents may cite in customer-facing drafts.
          Optional — when nothing is configured, briefings and Action Context work unchanged.
        </p>
      </div>

      <ConflictsPanel />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilterKey(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filterKey === f.key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); setQuery(searchInput.trim()); }}
        >
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className={`${inputCls} pl-8 w-56`}
              placeholder="Search claims…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
        </form>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-28 rounded-xl border border-border bg-card animate-pulse" />)}
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error instanceof Error ? error.message : 'Failed to load product knowledge claims.'}
        </div>
      )}

      {!isLoading && !isError && noKnowledgeConfigured && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <BookOpen className="w-6 h-6 mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">No product knowledge configured</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Author approved, source-grounded claims via the <code>knowledge_claim_upsert</code> tool or your source adapters.
            Until then, CRMy works exactly as it does today.
          </p>
        </div>
      )}

      {!isLoading && !isError && !noKnowledgeConfigured && claims.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {filterKey === 'needs_review' ? 'Nothing needs review right now.' : 'No claims match this filter.'}
        </div>
      )}

      {!isLoading && !isError && claims.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{data?.count ?? claims.length} claim(s)</p>
          {claims.map(c => <ClaimCard key={c.id} claim={c} />)}
        </div>
      )}
    </div>
  );
}
