// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Link } from 'react-router-dom';
import { DollarSign, Target, Briefcase, ShieldCheck } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { usePipelineSummary, useUseCaseAnalytics, useHITLRequests, useActivities } from '../api/hooks';

const USE_CASE_STAGES = ['discovery', 'onboarding', 'active', 'at_risk', 'churned', 'expansion'] as const;
const stageColors: Record<string, string> = {
  discovery: 'bg-slate-100 text-slate-800',
  onboarding: 'bg-slate-100 text-slate-800',
  active: 'bg-emerald-100 text-emerald-800',
  at_risk: 'bg-amber-100 text-amber-800',
  churned: 'bg-red-100 text-red-800',
  expansion: 'bg-teal-100 text-teal-800',
};

function formatCurrency(cents?: number) {
  if (cents == null) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

export function DashboardPage() {
  const { data: pipeline } = usePipelineSummary();
  const { data: ucData } = useUseCaseAnalytics({ group_by: 'stage' });
  const { data: hitlData } = useHITLRequests();
  const { data: activityData } = useActivities({ limit: 20 });

  const pipelineValue = (pipeline as any)?.total_value ?? 0;
  const openDeals = (pipeline as any)?.total_count ?? 0;
  const pendingHitl = ((hitlData as any)?.data ?? []).length;

  const ucGroups = (ucData as any)?.by_group ?? (ucData as any)?.data ?? [];
  const activeUcCount = ucGroups.reduce((sum: number, g: any) =>
    ['active', 'expansion'].includes(g.label ?? g.stage) ? sum + (g.count ?? 0) : sum, 0);

  const stats = [
    { label: 'Pipeline Value', value: formatCurrency(pipelineValue), icon: DollarSign, color: 'text-blue-600' },
    { label: 'Open Deals', value: openDeals, icon: Target, color: 'text-emerald-600' },
    { label: 'Active Use Cases', value: activeUcCount, icon: Briefcase, color: 'text-purple-600' },
    { label: 'HITL Pending', value: pendingHitl, icon: ShieldCheck, color: pendingHitl > 0 ? 'text-red-600' : 'text-slate-600' },
  ];

  const activities = (activityData as any)?.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-4 p-6">
              <s.icon className={`h-8 w-8 ${s.color}`} />
              <div>
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Use Case stage summary strip */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Use Cases by Stage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {USE_CASE_STAGES.map((stage) => {
              const group = ucGroups.find((g: any) => (g.label ?? g.stage) === stage);
              const count = group?.count ?? 0;
              const arr = group?.attributed_arr ?? group?.total_attributed_arr ?? 0;
              return (
                <Link
                  key={stage}
                  to={`/app/use-cases?stage=${stage}`}
                  className="rounded-lg border p-3 hover:bg-accent transition-colors"
                >
                  <Badge className={stageColors[stage]}>{stage.replace('_', ' ')}</Badge>
                  <p className="mt-2 text-xl font-bold">{count}</p>
                  <p className="text-xs text-muted-foreground">{formatCurrency(arr)} ARR</p>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {activities.slice(0, 10).map((a: any) => (
                <div key={a.id} className="flex items-start gap-3 border-b pb-3 last:border-0">
                  <Badge variant="outline">{a.type}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{a.subject}</p>
                    {a.body && <p className="text-xs text-muted-foreground truncate">{a.body}</p>}
                  </div>
                  <time className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(a.created_at).toLocaleDateString()}
                  </time>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
