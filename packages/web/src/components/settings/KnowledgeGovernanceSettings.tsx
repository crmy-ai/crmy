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

import React, { useMemo, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  ClaimScoreBar,
  CompactScoreBar,
  ContextClaimPanel,
} from '@/components/crm/ContextClaimPanel';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useKnowledgeClaims, useReviewKnowledgeClaim, useDetectKnowledgeConflicts,
  type KnowledgeClaimListFilters,
} from '@/api/hooks';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { Switch } from '@/components/ui/switch';
import type { KnowledgeClaimRecord, KnowledgeReviewDecision } from '@crmy/shared';
import {
  BookOpen, CheckCircle2, XCircle, Archive, Clock, RotateCcw, ShieldCheck,
  AlertTriangle, GitCompareArrows, Loader2, Eye, ExternalLink, MoreHorizontal,
} from 'lucide-react';

const btnPrimary = 'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40';
const btnApprove = 'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-600/90 disabled:opacity-40';
const btnApproveOutline = 'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-500/30 px-3 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-500/10 disabled:opacity-40 dark:text-emerald-400';
const btnOutline = 'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40';

type FilterKey = 'needs_review' | 'all' | 'active' | 'stale' | 'conflicting' | 'pending';
type KnowledgeTypeFilter = 'all' | KnowledgeClaimRecord['knowledge_type'];
type KnowledgeSortKey = 'updated_at' | 'confidence' | 'source_priority' | 'title';

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

const KNOWLEDGE_FILTER_CONFIGS: FilterConfig[] = [
  {
    key: 'review_state',
    label: 'Review state',
    options: FILTERS.filter(filter => filter.key !== 'all').map(filter => ({ value: filter.key, label: filter.label })),
  },
  {
    key: 'knowledge_type',
    label: 'Type',
    options: TYPE_FILTERS.filter(filter => filter.key !== 'all').map(filter => ({ value: filter.key, label: filter.label })),
  },
];

const KNOWLEDGE_SORT_OPTIONS: SortOption[] = [
  { key: 'updated_at', label: 'Updated' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'source_priority', label: 'Source priority' },
  { key: 'title', label: 'Title' },
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

function formatDateTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

function knowledgeDetailLabel(claim: KnowledgeClaimRecord, expired: boolean): string {
  const gate = customerGate(claim, expired).label;
  if (gate === 'trusted') return 'Trusted Fact';
  if (gate === 'fact candidate') return 'Fact Candidate';
  if (gate === 'internal only') return 'Internal Fact';
  if (gate === 'retired') return 'Retired Fact';
  return 'Fact Needs Review';
}

function isClaimExpired(claim: KnowledgeClaimRecord): boolean {
  return !!claim.valid_until && new Date(claim.valid_until).getTime() < Date.now();
}

function claimSourceLabel(claim: KnowledgeClaimRecord): string {
  return claim.source_label || claim.source_ref || claim.source_url || 'No source label';
}

function claimReviewState(claim: KnowledgeClaimRecord) {
  const expired = isClaimExpired(claim);
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

  return {
    expired,
    isRetired,
    canApproveForCustomer,
    canApproveInternal,
    gate,
    customerActionLabel,
  };
}

function handleOpenKey(event: React.KeyboardEvent<HTMLElement>, onOpen: () => void) {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onOpen();
  }
}

function KnowledgeClaimActions({
  claim,
  onOpen,
  onReviewed,
  compact = false,
}: {
  claim: KnowledgeClaimRecord;
  onOpen?: () => void;
  onReviewed?: (claim: KnowledgeClaimRecord) => void;
  compact?: boolean;
}) {
  const review = useReviewKnowledgeClaim();
  const {
    expired,
    isRetired,
    canApproveForCustomer,
    canApproveInternal,
    customerActionLabel,
  } = claimReviewState(claim);

  const apply = (decision: KnowledgeReviewDecision, approved_for_external_use?: boolean) => {
    review.mutate(
      { id: claim.id, decision, approved_for_external_use },
      {
        onSuccess: (updated) => {
          onReviewed?.(updated);
          toast({ title: 'Trusted Fact updated', description: `"${claim.title}" -> ${updated.status} / ${updated.approval_status}` });
        },
        onError: (err: unknown) => toast({ title: 'Review failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' }),
      },
    );
  };

  return (
    <div className={`flex items-center gap-2 flex-wrap ${compact ? 'min-w-max justify-end' : ''}`} onClick={(event) => event.stopPropagation()}>
      {review.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      {onOpen && (
        <button className={btnOutline} type="button" onClick={onOpen}>
          <Eye className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Details
        </button>
      )}
      {canApproveForCustomer && (
        <button className={btnApprove} type="button" disabled={review.isPending} onClick={() => apply('approve', true)} title="Approve and allow in customer-facing drafts">
          <ShieldCheck className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />{customerActionLabel}
        </button>
      )}
      {canApproveInternal && (
        <button className={btnApproveOutline} type="button" disabled={review.isPending} onClick={() => apply('approve', false)} title="Approve for internal use only">
          <CheckCircle2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Approve internal
        </button>
      )}
      {claim.status === 'active' && (
        <button className={btnOutline} type="button" disabled={review.isPending} onClick={() => apply('mark_stale')}>
          <Clock className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Mark needs review
        </button>
      )}
      {((claim.status === 'stale' && !expired) || isRetired) && (
        <button className={btnOutline} type="button" disabled={review.isPending} onClick={() => apply('reactivate')}>
          <RotateCcw className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Restore
        </button>
      )}
      {claim.status !== 'deprecated' && (
        <button className={btnOutline} type="button" disabled={review.isPending} onClick={() => apply('deprecate')}>
          <Archive className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Retire
        </button>
      )}
      {claim.status !== 'rejected' && (
        <button className={btnOutline} type="button" disabled={review.isPending} onClick={() => apply('reject')}>
          <XCircle className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Reject
        </button>
      )}
    </div>
  );
}

function KnowledgeClaimCardActions({
  claim,
  onOpen,
  onReviewed,
}: {
  claim: KnowledgeClaimRecord;
  onOpen: () => void;
  onReviewed?: (claim: KnowledgeClaimRecord) => void;
}) {
  const review = useReviewKnowledgeClaim();
  const {
    expired,
    isRetired,
    canApproveForCustomer,
    canApproveInternal,
    customerActionLabel,
  } = claimReviewState(claim);

  const apply = (decision: KnowledgeReviewDecision, approved_for_external_use?: boolean) => {
    review.mutate(
      { id: claim.id, decision, approved_for_external_use },
      {
        onSuccess: (updated) => {
          onReviewed?.(updated);
          toast({ title: 'Trusted Fact updated', description: `"${claim.title}" -> ${updated.status} / ${updated.approval_status}` });
        },
        onError: (err: unknown) => toast({ title: 'Review failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' }),
      },
    );
  };

  const primaryAction = canApproveForCustomer
    ? {
      label: customerActionLabel,
      Icon: ShieldCheck,
      className: btnApprove,
      onClick: () => apply('approve', true),
    }
    : canApproveInternal
    ? {
      label: 'Approve internal',
      Icon: CheckCircle2,
      className: btnApproveOutline,
      onClick: () => apply('approve', false),
    }
    : ((claim.status === 'stale' && !expired) || isRetired)
    ? {
      label: 'Restore',
      Icon: RotateCcw,
      className: btnOutline,
      onClick: () => apply('reactivate'),
    }
    : null;

  const showApproveInternalInMenu = canApproveInternal && primaryAction?.label !== 'Approve internal';
  const showRestoreInMenu = ((claim.status === 'stale' && !expired) || isRetired) && primaryAction?.label !== 'Restore';

  return (
    <div className="flex w-full items-center justify-between gap-2" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            aria-label="Knowledge fact actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={onOpen}>
            <Eye className="mr-2 h-3.5 w-3.5" />
            Details
          </DropdownMenuItem>
          {showApproveInternalInMenu && (
            <DropdownMenuItem onClick={() => apply('approve', false)} disabled={review.isPending}>
              <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
              Approve internal
            </DropdownMenuItem>
          )}
          {claim.status === 'active' && (
            <DropdownMenuItem onClick={() => apply('mark_stale')} disabled={review.isPending}>
              <Clock className="mr-2 h-3.5 w-3.5" />
              Mark needs review
            </DropdownMenuItem>
          )}
          {showRestoreInMenu && (
            <DropdownMenuItem onClick={() => apply('reactivate')} disabled={review.isPending}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Restore
            </DropdownMenuItem>
          )}
          {claim.status !== 'deprecated' && (
            <DropdownMenuItem onClick={() => apply('deprecate')} disabled={review.isPending}>
              <Archive className="mr-2 h-3.5 w-3.5" />
              Retire
            </DropdownMenuItem>
          )}
          {claim.status !== 'rejected' && (
            <DropdownMenuItem
              onClick={() => apply('reject')}
              disabled={review.isPending}
              className="text-rose-600 focus:text-rose-600 dark:text-rose-400"
            >
              <XCircle className="mr-2 h-3.5 w-3.5" />
              Reject
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        {review.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {primaryAction && (
          <button className={primaryAction.className} type="button" disabled={review.isPending} onClick={primaryAction.onClick}>
            <primaryAction.Icon className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />{primaryAction.label}
          </button>
        )}
      </div>
    </div>
  );
}

function ClaimCard({ claim, onOpen }: { claim: KnowledgeClaimRecord; onOpen: (claim: KnowledgeClaimRecord) => void }) {
  const { expired, gate } = claimReviewState(claim);

  return (
    <article
      className="group flex min-h-[14rem] cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors hover:border-primary/30 hover:bg-card/95 focus:outline-none focus:ring-2 focus:ring-ring"
      role="button"
      tabIndex={0}
      aria-label={`View knowledge fact details for ${claim.title}`}
      onClick={() => onOpen(claim)}
      onKeyDown={(event) => handleOpenKey(event, () => onOpen(claim))}
    >
      <div className="flex flex-1 items-start gap-3 p-4">
        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
          <BookOpen className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Badge tone={gate.tone}>{gate.label}</Badge>
            <Badge tone={APPROVAL_TONE[claim.approval_status] ?? APPROVAL_TONE.unapproved}>{APPROVAL_LABEL[claim.approval_status] ?? claim.approval_status}</Badge>
            <Badge tone={STATUS_TONE[claim.status] ?? STATUS_TONE.deprecated}>{STATUS_LABEL[claim.status] ?? claim.status}</Badge>
            <Badge tone="border-info/30 bg-info/10 text-info">{typeLabel(claim.knowledge_type)}</Badge>
          </div>
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{claim.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{claim.summary || claim.body}</p>
          {typeof claim.confidence === 'number' && (
            <CompactScoreBar label="Confidence" value={claim.confidence} colorMode="neutral" />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/70 bg-background/50 px-2.5 py-1 font-medium">{claim.category}</span>
            <span className="rounded-full border border-border/70 bg-background/50 px-2.5 py-1 font-medium">{claim.source_priority}</span>
            <span className={`rounded-full border px-2.5 py-1 font-medium ${claim.grounded ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-warning/30 bg-warning/10 text-warning'}`}>
              {claim.grounded ? 'Grounded' : 'Ungrounded'}
            </span>
            <span className="line-clamp-1 min-w-0 max-w-full">{claimSourceLabel(claim)}</span>
            {claim.valid_until && (
              <span className={expired ? 'text-destructive' : 'text-muted-foreground'}>
                {expired ? `Expired ${formatDate(claim.valid_until)}` : `Valid until ${formatDate(claim.valid_until)}`}
              </span>
            )}
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary opacity-80 transition-opacity group-hover:opacity-100">
            <Eye className="h-3.5 w-3.5" />
            View details
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-sunken/30 px-3 py-2" onClick={event => event.stopPropagation()}>
        <KnowledgeClaimCardActions claim={claim} onOpen={() => onOpen(claim)} />
      </div>
    </article>
  );
}

function freshnessLabel(claim: KnowledgeClaimRecord, expired: boolean): string {
  if (expired && claim.valid_until) return `Expired ${formatDate(claim.valid_until)}`;
  if (claim.status === 'stale') return 'Needs review';
  if (claim.last_verified_at) return `Verified ${formatDate(claim.last_verified_at)}`;
  if (claim.valid_until) return `Valid until ${formatDate(claim.valid_until)}`;
  return 'Current';
}

function compactTrustLabel(claim: KnowledgeClaimRecord, expired: boolean): string {
  if (claim.status === 'deprecated' || claim.status === 'rejected') return 'Retired';
  if (claim.status === 'conflicting') return 'Needs review: conflict';
  if (!claim.grounded) return 'Needs review: ungrounded';
  if (claim.status === 'stale' || expired) return 'Needs review: stale';
  if (claim.approval_status !== 'approved') return 'Fact candidate';
  if (!claim.approved_for_external_use || claim.visibility !== 'external') return 'Internal only';
  return 'Customer-ready';
}

function compactTrustDotClass(claim: KnowledgeClaimRecord, expired: boolean): string {
  if (claim.status === 'deprecated' || claim.status === 'rejected') return 'bg-muted-foreground/50';
  if (claim.status === 'conflicting') return 'bg-destructive';
  if (!claim.grounded || claim.status === 'stale' || expired || claim.approval_status !== 'approved') return 'bg-warning';
  if (!claim.approved_for_external_use || claim.visibility !== 'external') return 'bg-muted-foreground';
  return 'bg-emerald-500';
}

function formatCompactCategory(category?: string): string {
  if (!category) return 'Uncategorized';
  return category.replace(/[_-]/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function KnowledgeClaimsTable({
  claims,
  onOpen,
}: {
  claims: KnowledgeClaimRecord[];
  onOpen: (claim: KnowledgeClaimRecord) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-sunken/50">
              <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Fact</th>
              <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Source</th>
              <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Trust state</th>
              <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Type</th>
              <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Freshness</th>
              <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Updated</th>
              <th className="px-4 py-3 text-right text-xs font-display font-semibold text-muted-foreground"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim, index) => {
              const { expired } = claimReviewState(claim);
              return (
                <tr
                  key={claim.id}
                  className={`cursor-pointer border-b border-border align-top transition-colors hover:bg-primary/5 focus-within:bg-primary/5 last:border-0 ${index % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(claim)}
                  onKeyDown={(event) => handleOpenKey(event, () => onOpen(claim))}
                >
                  <td className="max-w-[28rem] px-4 py-3">
                    <div className="line-clamp-1 font-semibold text-foreground">{claim.title}</div>
                    <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{claim.summary || claim.body}</div>
                    {!claim.grounded && (
                      <div className="mt-1 line-clamp-1 text-xs text-amber-600 dark:text-amber-400">Why: source grounding needed before customer use</div>
                    )}
                  </td>
                  <td className="max-w-[14rem] px-4 py-3 text-muted-foreground">
                    <div className="line-clamp-1">{claimSourceLabel(claim)}</div>
                    <div className="mt-1 text-xs">{claim.source_priority}</div>
                  </td>
                  <td className="max-w-[12rem] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-xs font-semibold text-foreground">
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${compactTrustDotClass(claim, expired)}`} />
                      <span className="truncate">{compactTrustLabel(claim, expired)}</span>
                    </div>
                  </td>
                  <td className="max-w-[13rem] px-4 py-3">
                    <div className="truncate whitespace-nowrap text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{typeLabel(claim.knowledge_type)}</span>
                      <span className="px-1.5 text-muted-foreground/70">/</span>
                      <span>{formatCompactCategory(claim.category)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{freshnessLabel(claim, expired)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(claim.updated_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="inline-flex h-7 items-center rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(claim);
                      }}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children?: React.ReactNode }) {
  const empty = children === undefined || children === null || children === '';
  return (
    <div className="grid gap-1 text-sm sm:grid-cols-[9rem_1fr]">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="min-w-0 break-words text-foreground">
        {empty ? <span className="text-muted-foreground">Not provided</span> : children}
      </div>
    </div>
  );
}

function TokenList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => (
        <Badge key={item} tone="border-border bg-muted text-muted-foreground">{item}</Badge>
      ))}
    </div>
  );
}

function KnowledgeClaimDrawer({
  claim,
  onClose,
  onReviewed,
}: {
  claim: KnowledgeClaimRecord | null;
  onClose: () => void;
  onReviewed: (claim: KnowledgeClaimRecord) => void;
}) {
  const expired = claim ? isClaimExpired(claim) : false;
  const gate = claim ? customerGate(claim, expired) : null;
  const detailLabel = claim ? knowledgeDetailLabel(claim, expired) : 'Knowledge Fact';

  return (
    <Sheet open={Boolean(claim)} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {claim && gate ? (
          <>
            <SheetHeader className="border-b border-border px-5 pb-4 pt-5 text-left">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone="border-info/30 bg-info/10 text-info">{typeLabel(claim.knowledge_type)}</Badge>
                <Badge tone="border-border bg-muted text-muted-foreground">{claim.category}</Badge>
                <Badge tone={gate.tone}>{gate.label}</Badge>
                <Badge tone={APPROVAL_TONE[claim.approval_status] ?? APPROVAL_TONE.unapproved}>{APPROVAL_LABEL[claim.approval_status] ?? claim.approval_status}</Badge>
                <Badge tone={STATUS_TONE[claim.status] ?? STATUS_TONE.deprecated}>{STATUS_LABEL[claim.status] ?? claim.status}</Badge>
              </div>
              <SheetTitle className="font-display text-lg leading-snug">{claim.title}</SheetTitle>
              <SheetDescription>
                Knowledge fact detail, source provenance, governance, and scope.
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <ContextClaimPanel
                label={detailLabel}
                tone="memory"
                title={claim.body || claim.title}
                chips={(
                  <div className="flex flex-wrap items-center justify-end gap-2 text-xs font-medium">
                    <span className="rounded-full border border-border/70 bg-background/50 px-2.5 py-1 text-muted-foreground">
                      {claim.source_priority}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 ${claim.grounded ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-warning/30 bg-warning/10 text-warning'}`}>
                      {claim.grounded ? 'Grounded' : 'Ungrounded'}
                    </span>
                  </div>
                )}
                score={typeof claim.confidence === 'number' ? (
                  <ClaimScoreBar label="Confidence" value={claim.confidence} colorMode="neutral" />
                ) : undefined}
                lifecycle={(
                  <>
                    <span className={`rounded-full border px-2.5 py-1 ${gate.tone}`}>{gate.label}</span>
                    <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">
                      {claim.approved_for_external_use ? 'Customer use allowed' : 'Internal use only'}
                    </span>
                  </>
                )}
                helper={claim.summary}
              />

              <DetailPanel title="Claim">
                <DetailRow label="Title">{claim.title}</DetailRow>
                <DetailRow label="Body">{claim.body}</DetailRow>
                <DetailRow label="Summary">{claim.summary}</DetailRow>
              </DetailPanel>

              <DetailPanel title="Source and provenance">
                <DetailRow label="Source label">{claim.source_label}</DetailRow>
                <DetailRow label="Source URL">
                  {claim.source_url ? (
                    <a
                      href={claim.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
                    >
                      <span className="truncate">{claim.source_url}</span>
                      <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                    </a>
                  ) : undefined}
                </DetailRow>
                <DetailRow label="Source ref">{claim.source_ref}</DetailRow>
                <DetailRow label="Version">{claim.source_version}</DetailRow>
                <DetailRow label="External key">{claim.external_key}</DetailRow>
                <DetailRow label="Priority">{claim.source_priority}</DetailRow>
                <DetailRow label="Grounding">{claim.grounded ? 'Grounded in source material' : 'Not grounded in source material'}</DetailRow>
              </DetailPanel>

              <DetailPanel title="Governance">
                <DetailRow label="Approval">{APPROVAL_LABEL[claim.approval_status] ?? claim.approval_status}</DetailRow>
                <DetailRow label="External use">{claim.approved_for_external_use ? 'Allowed' : 'Not allowed'}</DetailRow>
                <DetailRow label="Visibility">{claim.visibility}</DetailRow>
                <DetailRow label="Status">{STATUS_LABEL[claim.status] ?? claim.status}</DetailRow>
                <DetailRow label="Effective">{formatDateTime(claim.effective_at)}</DetailRow>
                <DetailRow label="Valid until">{formatDateTime(claim.valid_until)}</DetailRow>
                <DetailRow label="Last verified">{formatDateTime(claim.last_verified_at)}</DetailRow>
                <DetailRow label="Review owner">{claim.review_owner_id}</DetailRow>
                <DetailRow label="Updated">{formatDateTime(claim.updated_at)}</DetailRow>
              </DetailPanel>

              <DetailPanel title="Scope">
                <DetailRow label="Products"><TokenList items={claim.product_scope} empty="All products" /></DetailRow>
                <DetailRow label="Competitors"><TokenList items={claim.competitors} empty="None" /></DetailRow>
              </DetailPanel>
            </div>

            <div className="border-t border-border px-5 py-4">
              <KnowledgeClaimActions claim={claim} onReviewed={onReviewed} />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
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
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
            <Switch
              id="knowledge-conflict-apply"
              checked={applyResolution}
              onCheckedChange={setApplyResolution}
              aria-label="Auto-mark lower-priority facts conflicting"
            />
            <label htmlFor="knowledge-conflict-apply" className="cursor-pointer">
              <span className="block text-xs font-semibold text-foreground">
                {applyResolution ? 'Auto-mark conflicts' : 'Review only'}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Lower-priority facts {applyResolution ? 'will be marked conflicting' : 'stay unchanged'}
              </span>
            </label>
          </div>
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

export default function KnowledgeGovernanceSettings({ viewMode = 'cards' }: { viewMode?: 'cards' | 'table' } = {}) {
  const [typeFilter, setTypeFilter] = useState<KnowledgeTypeFilter>('all');
  const [filterKey, setFilterKey] = useState<FilterKey>('needs_review');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<KnowledgeClaimRecord | null>(null);

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
  const toolbarFilters = useMemo(() => {
    const next: Record<string, string[]> = {};
    if (filterKey !== 'all') next.review_state = [filterKey];
    if (typeFilter !== 'all') next.knowledge_type = [typeFilter];
    return next;
  }, [filterKey, typeFilter]);
  const sortedClaims = useMemo(() => {
    if (!sort) return claims;
    const valueFor = (claim: KnowledgeClaimRecord, key: KnowledgeSortKey) => {
      if (key === 'updated_at') return new Date(claim.updated_at ?? 0).getTime();
      if (key === 'confidence') return typeof claim.confidence === 'number' ? claim.confidence : -1;
      if (key === 'source_priority') return claim.source_priority ?? '';
      return claim.title ?? '';
    };
    return [...claims].sort((a, b) => {
      const aValue = valueFor(a, sort.key as KnowledgeSortKey);
      const bValue = valueFor(b, sort.key as KnowledgeSortKey);
      const result = typeof aValue === 'number' && typeof bValue === 'number'
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue));
      return sort.dir === 'asc' ? result : -result;
    });
  }, [claims, sort]);

  const handleFilterChange = (key: string, values: string[]) => {
    const selected = values.at(-1);
    if (key === 'review_state') {
      setFilterKey((selected as FilterKey | undefined) ?? 'all');
      return;
    }
    if (key === 'knowledge_type') {
      setTypeFilter((selected as KnowledgeTypeFilter | undefined) ?? 'all');
    }
  };

  const handleSortChange = (key: string) => {
    setSort(prev => (prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'title' ? 'asc' : 'desc' }));
  };

  const clearFilters = () => {
    setFilterKey('all');
    setTypeFilter('all');
    setQuery('');
  };

  return (
    <div className="space-y-4">
      <div className="-mx-4 border-b border-border bg-background md:-mx-6">
        <ListToolbar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Search Trusted Facts..."
          filters={KNOWLEDGE_FILTER_CONFIGS}
          activeFilters={toolbarFilters}
          onFilterChange={handleFilterChange}
          onClearFilters={clearFilters}
          sortOptions={KNOWLEDGE_SORT_OPTIONS}
          currentSort={sort}
          onSortChange={handleSortChange}
          entityType="knowledge"
          searchSuffix={(
            <div className="hidden h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-medium text-muted-foreground md:inline-flex">
              <BookOpen className="h-3.5 w-3.5 text-primary" />
              {formatFactCount(visibleFactCount)}
            </div>
          )}
        />
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
          {viewMode === 'table' ? (
            <KnowledgeClaimsTable claims={sortedClaims} onOpen={setSelectedClaim} />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {sortedClaims.map(c => <ClaimCard key={c.id} claim={c} onOpen={setSelectedClaim} />)}
            </div>
          )}
        </div>
      )}

      <KnowledgeClaimDrawer
        claim={selectedClaim}
        onClose={() => setSelectedClaim(null)}
        onReviewed={setSelectedClaim}
      />
    </div>
  );
}
