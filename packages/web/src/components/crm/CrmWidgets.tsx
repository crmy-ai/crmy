// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Phone, Mail, StickyNote, CheckSquare, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { ContactAvatar } from './ContactAvatar';
import { useOpportunities, useUseCases, useAccounts, useActivities, useCustomFields } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { stageConfig, useCaseStageConfig } from '@/lib/stageConfig';

export function StageBadge({ stage }: { stage: string }) {
  const config = stageConfig[stage] ?? { label: stage, color: '#94a3b8' };
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ backgroundColor: config.color + '18', color: config.color }}
    >
      {config.label}
    </span>
  );
}

export function LeadScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'hsl(152, 55%, 42%)' : score >= 50 ? 'hsl(38, 92%, 50%)' : 'hsl(var(--muted-foreground))';
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-6 rounded-lg text-xs font-mono font-bold"
      style={{ backgroundColor: color + '18', color }}
    >
      {score}
    </span>
  );
}

export function AgentStatusDot() {
  return <div className="w-2.5 h-2.5 rounded-full bg-success animate-pulse-dot" />;
}

function activityIcon(type: string) {
  switch (type) {
    case 'call': return <Phone className="w-3.5 h-3.5" />;
    case 'email': return <Mail className="w-3.5 h-3.5" />;
    case 'meeting': return <MessageSquare className="w-3.5 h-3.5" />;
    case 'task': return <CheckSquare className="w-3.5 h-3.5" />;
    default: return <StickyNote className="w-3.5 h-3.5" />;
  }
}

interface Activity {
  id: string;
  type: string;
  description?: string;
  body?: string;
  contact_name?: string;
  contactName?: string;
  created_at?: string;
  timestamp?: string;
}

interface ActivityFeedProps {
  limit?: number;
  activities?: Activity[];
  filterWindow?: 'today' | 'week';
}

export function ActivityFeed({ limit, activities: propActivities, filterWindow }: ActivityFeedProps) {
  const { openDrawer } = useAppStore();
  const fetchLimit = filterWindow ? 100 : (limit ?? 20);
  const { data, isLoading } = useActivities(propActivities ? undefined : { limit: fetchLimit });
  let items: Activity[] = (propActivities ?? data?.data ?? []) as Activity[];

  if (filterWindow) {
    const cutoff = new Date();
    if (filterWindow === 'today') {
      cutoff.setHours(0, 0, 0, 0);
    } else {
      cutoff.setDate(cutoff.getDate() - 7);
      cutoff.setHours(0, 0, 0, 0);
    }
    items = items.filter((a) => {
      const ts = a.created_at ?? a.timestamp;
      return ts ? new Date(ts) >= cutoff : false;
    });
  }

  const displayed = limit ? items.slice(0, limit) : items;

  if (isLoading && !propActivities) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-7 h-7 rounded-xl bg-muted flex-shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-3 bg-muted rounded w-3/4" />
              <div className="h-2.5 bg-muted rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (displayed.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <div className="space-y-3">
      {displayed.map((a) => {
        const name = a.contact_name ?? a.contactName ?? 'Unknown';
        const desc = a.description ?? a.body ?? '';
        const ts = a.created_at ?? a.timestamp ?? '';
        const contactId = (a as unknown as Record<string, unknown>).contact_id as string | undefined;
        return (
          <div
            key={a.id}
            className={`flex gap-3 ${contactId ? 'cursor-pointer hover:bg-muted/40 rounded-xl px-2 -mx-2 transition-colors' : ''}`}
            onClick={() => contactId && openDrawer('contact', contactId)}
          >
            <div className="w-7 h-7 rounded-xl bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0">
              {activityIcon(a.type)}
            </div>
            <div>
              <p className="text-sm text-foreground">{desc || `${a.type} with ${name}`}</p>
              <p className="text-xs text-muted-foreground">
                {name} · {ts ? new Date(ts).toLocaleDateString() : ''}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PipelineSnapshot() {
  const [view, setView] = useState<'opportunities' | 'use-cases'>('opportunities');
  const { data: oppsData } = useOpportunities({ limit: 200 });
  const { data: ucData } = useUseCases({ limit: 200 });

  const opps = (oppsData?.data ?? []) as Record<string, unknown>[];
  const ucs = (ucData?.data ?? []) as Record<string, unknown>[];

  const dealStages = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];
  const ucStages = ['discovery', 'poc', 'production', 'scaling', 'sunset'];

  const dealData = dealStages.map((stage) => {
    const stageDeals = opps.filter((d: Record<string, unknown>) => d.stage === stage);
    const cfg = stageConfig[stage] ?? { label: stage, color: '#94a3b8' };
    return {
      key: stage,
      label: cfg.label,
      color: cfg.color,
      count: stageDeals.length,
      total: stageDeals.reduce((sum: number, d: Record<string, unknown>) => sum + ((d.amount as number) || 0), 0),
    };
  });

  const ucStateData = ucStages.map((stage) => {
    const stageUCs = ucs.filter((u: Record<string, unknown>) => u.stage === stage);
    const cfg = useCaseStageConfig[stage] ?? { label: stage, color: '#94a3b8' };
    return {
      key: stage,
      label: cfg.label,
      color: cfg.color,
      count: stageUCs.length,
      total: stageUCs.reduce((sum: number, u: Record<string, unknown>) => sum + ((u.attributed_arr as number) || 0), 0),
    };
  });

  const data = view === 'opportunities' ? dealData : ucStateData;
  const maxTotal = Math.max(...data.map((s) => s.total), 1);
  const valueLabel = (v: number) =>
    v >= 1_000_000_000 ? `$${(v / 1_000_000_000).toFixed(1)}B`
    : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}K`
    : v > 0 ? `$${v}` : '$0';

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-bold text-foreground">Pipeline health</h3>
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => setView('opportunities')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'opportunities' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Opps
          </button>
          <button
            onClick={() => setView('use-cases')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'use-cases' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Use Cases
          </button>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar md:hidden pb-1 -mx-1 px-1">
        {data.map((s) => (
          <div key={s.key} className="flex-shrink-0 w-28 rounded-xl p-3 border border-border" style={{ backgroundColor: s.color + '08' }}>
            <div className="w-3 h-3 rounded-full mb-2" style={{ backgroundColor: s.color }} />
            <p className="text-[10px] text-muted-foreground font-medium truncate">{s.label}</p>
            <p className="text-lg font-display font-bold text-foreground">{s.count}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{valueLabel(s.total)}</p>
          </div>
        ))}
      </div>
      <div className="hidden md:block space-y-3">
        {data.map((s) => (
          <div key={s.key} className="flex items-center gap-3">
            <span className="text-xs w-28 truncate font-medium" style={{ color: s.color }}>{s.label}</span>
            <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(s.total / maxTotal) * 100}%`, backgroundColor: s.color }} />
            </div>
            <span className="text-xs text-muted-foreground font-mono w-8 text-right">{s.count}</span>
            <span className="text-xs text-foreground font-mono w-16 text-right">{valueLabel(s.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccountHealth() {
  const { data } = useAccounts({ limit: 200 });
  const accounts = (data?.data ?? []) as Record<string, unknown>[];

  const green = accounts.filter((a: Record<string, unknown>) => ((a.health_score as number) ?? 0) >= 80);
  const yellow = accounts.filter((a: Record<string, unknown>) => {
    const s = (a.health_score as number) ?? 0;
    return s >= 50 && s < 80;
  });
  const red = accounts.filter((a: Record<string, unknown>) => ((a.health_score as number) ?? 0) < 50);
  const total = accounts.length;

  const segments = [
    { label: 'Healthy', count: green.length, color: 'hsl(152, 55%, 42%)' },
    { label: 'At Risk', count: yellow.length, color: 'hsl(38, 92%, 50%)' },
    { label: 'Critical', count: red.length, color: 'hsl(var(--destructive))' },
  ];

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <h3 className="font-display font-bold text-foreground mb-4">Account health</h3>
      <div className="flex gap-3 overflow-x-auto no-scrollbar md:hidden pb-1 -mx-1 px-1">
        {segments.map((s) => (
          <div key={s.label} className="flex-shrink-0 w-28 rounded-xl p-3 border border-border" style={{ backgroundColor: s.color + '08' }}>
            <div className="w-3 h-3 rounded-full mb-2" style={{ backgroundColor: s.color }} />
            <p className="text-[10px] text-muted-foreground font-medium truncate">{s.label}</p>
            <p className="text-lg font-display font-bold text-foreground">{s.count}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{total > 0 ? Math.round((s.count / total) * 100) : 0}%</p>
          </div>
        ))}
      </div>
      <div className="hidden md:block space-y-3">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span className="text-xs w-28 truncate font-medium" style={{ color: s.color }}>{s.label}</span>
            <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: total > 0 ? `${(s.count / total) * 100}%` : '0%', backgroundColor: s.color }} />
            </div>
            <span className="text-xs text-foreground font-mono">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatCustomFieldValue(fieldType: string, val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (fieldType === 'boolean') return val ? 'Yes' : 'No';
  if (fieldType === 'date') { try { return new Date(String(val)).toLocaleDateString(); } catch { return String(val); } }
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

export function CustomFieldsSection({ objectType, values }: { objectType: string; values: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = useCustomFields(objectType) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldDefs: any[] = data?.fields ?? [];

  if (fieldDefs.length === 0) return null;

  return (
    <div className="px-4 mx-4 mt-2 border-t border-border pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-left"
      >
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide flex-1">
          Custom Fields
          <span className="ml-1.5 font-mono font-normal text-muted-foreground/50">({fieldDefs.length})</span>
        </h3>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {fieldDefs.map((def: any) => {
            const val = values?.[def.field_key];
            const hasValue = val !== undefined && val !== null && val !== '';
            return (
              <div key={def.field_key} className="flex items-center justify-between gap-4">
                <span className="text-xs text-muted-foreground shrink-0">
                  {def.label}
                  {def.is_required && <span className="text-destructive ml-0.5">*</span>}
                </span>
                <span className={hasValue ? 'text-sm text-foreground text-right' : 'text-xs text-muted-foreground/50'}>
                  {hasValue ? formatCustomFieldValue(def.field_type, val) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
