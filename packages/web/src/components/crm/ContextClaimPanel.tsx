// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react';

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function claimScoreColor(value: number) {
  const pct = Math.round(clamp01(value) * 100);
  if (pct >= 70) return '#22c55e';
  if (pct >= 40) return '#f59e0b';
  return '#ef4444';
}

export function ClaimScoreBar({
  label,
  value,
  trailing,
  marker,
}: {
  label: string;
  value: number;
  trailing?: ReactNode;
  marker?: { value: number; label: string };
}) {
  const pct = Math.round(clamp01(value) * 100);
  const color = claimScoreColor(value);
  const markerPct = marker ? Math.round(clamp01(marker.value) * 100) : null;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold tabular-nums" style={{ color }}>{pct}%</span>
          {trailing}
        </div>
      </div>
      <div className="relative pb-3">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        {markerPct !== null && (
          <>
            <div
              className="absolute top-[-3px] h-4 w-px bg-foreground/70"
              style={{ left: `${markerPct}%` }}
              aria-hidden="true"
            />
            <div
              className="absolute top-3 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-muted-foreground"
              style={{ left: `${markerPct}%` }}
            >
              {marker?.label}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function CompactScoreBar({
  label,
  value,
  trailing,
}: {
  label: string;
  value: number;
  trailing?: ReactNode;
}) {
  const pct = Math.round(clamp01(value) * 100);
  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-muted-foreground">{trailing ?? `${pct}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/30 transition-all duration-500 dark:bg-foreground/35"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ContextClaimPanel({
  label,
  title,
  tone = 'memory',
  chips,
  score,
  lifecycle,
  helper,
}: {
  label: string;
  title: ReactNode;
  tone?: 'memory' | 'signal';
  chips?: ReactNode;
  score?: ReactNode;
  lifecycle?: ReactNode;
  helper?: ReactNode;
}) {
  const borderClass = tone === 'signal' ? 'border-primary/20 bg-primary/5' : 'border-emerald-500/20 bg-emerald-500/5';
  const labelClass = tone === 'signal' ? 'text-primary' : 'text-emerald-600 dark:text-emerald-400';
  return (
    <div className={`rounded-2xl border p-4 ${borderClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className={`text-xs font-semibold uppercase tracking-wide ${labelClass}`}>{label}</p>
        {chips}
      </div>
      <div className="mt-2 text-base font-semibold leading-snug text-foreground">{title}</div>
      {score}
      {lifecycle && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium">{lifecycle}</div>}
      {helper && <p className="mt-2 text-sm text-muted-foreground">{helper}</p>}
    </div>
  );
}

export function DetailDisclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="rounded-2xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
