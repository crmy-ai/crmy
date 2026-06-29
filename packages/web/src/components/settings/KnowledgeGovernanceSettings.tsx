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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  ClaimScoreBar,
  ContextClaimPanel,
} from '@/components/crm/ContextClaimPanel';
import {
  useKnowledgeClaims, useReviewKnowledgeClaim, useDetectKnowledgeConflicts,
  type KnowledgeClaimListFilters,
} from '@/api/hooks';
import type { KnowledgeClaimRecord, KnowledgeReviewDecision } from '@crmy/shared';
import {
  BookOpen, CheckCircle2, XCircle, Archive, Clock, RotateCcw, ShieldCheck,
  AlertTriangle, Search, GitCompareArrows, Loader2, Filter, Eye, ExternalLink,
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

function ClaimCard({ claim, onOpen }: { claim: KnowledgeClaimRecord; onOpen: (claim: KnowledgeClaimRecord) => void }) {
  const { expired, gate } = claimReviewState(claim);

  return (
    <div
      className="rounded-lg border border-border bg-card p-4 cursor-pointer transition-colors hover:border-primary/30 hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(claim)}
      onKeyDown={(event) => handleOpenKey(event, () => onOpen(claim))}
    >
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
        <KnowledgeClaimActions claim={claim} onOpen={() => onOpen(claim)} />
      </div>
    </div>
  );
}

function freshnessLabel(claim: KnowledgeClaimRecord, expired: boolean): string {
  if (expired && claim.valid_until) return `Expired ${formatDate(claim.valid_until)}`;
  if (claim.status === 'stale') return 'Needs review';
  if (claim.last_verified_at) return `Verified ${formatDate(claim.last_verified_at)}`;
  if (claim.valid_until) return `Valid until ${formatDate(claim.valid_until)}`;
  return 'Current';
}

function KnowledgeClaimsTable({
  claims,
  onOpen,
}: {
  claims: KnowledgeClaimRecord[];
  onOpen: (claim: KnowledgeClaimRecord) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Fact</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Trust state</th>
              <th className="px-3 py-2">Type/category</th>
              <th className="px-3 py-2">Freshness</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {claims.map(claim => {
              const { expired, gate } = claimReviewState(claim);
              return (
                <tr
                  key={claim.id}
                  className="cursor-pointer align-top transition-colors hover:bg-muted/40 focus-within:bg-muted/40"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(claim)}
                  onKeyDown={(event) => handleOpenKey(event, () => onOpen(claim))}
                >
                  <td className="max-w-sm px-3 py-3">
                    <p className="font-semibold text-foreground">{claim.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{claim.summary || claim.body}</p>
                  </td>
                  <td className="max-w-[14rem] px-3 py-3">
                    <p className="truncate text-xs font-medium text-foreground">{claimSourceLabel(claim)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{claim.source_priority}</p>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex max-w-[12rem] flex-wrap gap-1.5">
                      <Badge tone={gate.tone}>{gate.label}</Badge>
                      <Badge tone={APPROVAL_TONE[claim.approval_status] ?? APPROVAL_TONE.unapproved}>{APPROVAL_LABEL[claim.approval_status] ?? claim.approval_status}</Badge>
                      {!claim.grounded && <Badge tone="border-warning/30 bg-warning/10 text-warning">ungrounded</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex max-w-[12rem] flex-wrap gap-1.5">
                      <Badge tone="border-info/30 bg-info/10 text-info">{typeLabel(claim.knowledge_type)}</Badge>
                      <Badge tone="border-border bg-muted text-muted-foreground">{claim.category}</Badge>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{freshnessLabel(claim, expired)}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{formatDate(claim.updated_at)}</td>
                  <td className="px-3 py-3">
                    <KnowledgeClaimActions claim={claim} compact onOpen={() => onOpen(claim)} />
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
                Trusted Fact detail, source provenance, governance, and scope.
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <ContextClaimPanel
                label="Trusted Fact"
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
                  <ClaimScoreBar label="Confidence" value={claim.confidence} />
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

export default function KnowledgeGovernanceSettings({ viewMode = 'cards' }: { viewMode?: 'cards' | 'table' } = {}) {
  const [typeFilter, setTypeFilter] = useState<KnowledgeTypeFilter>('all');
  const [filterKey, setFilterKey] = useState<FilterKey>('needs_review');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
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
          {viewMode === 'table' ? (
            <KnowledgeClaimsTable claims={claims} onOpen={setSelectedClaim} />
          ) : (
            <div className="space-y-3">
              {claims.map(c => <ClaimCard key={c.id} claim={c} onOpen={setSelectedClaim} />)}
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
