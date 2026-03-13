// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { usePipelineSummary, usePipelineForecast, useUseCaseAnalytics } from '../../api/hooks';

function formatCurrency(cents?: number) {
  if (cents == null) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

export function AnalyticsPage() {
  const { data: pipeline } = usePipelineSummary();
  const { data: forecast } = usePipelineForecast();
  const { data: ucStage } = useUseCaseAnalytics({ group_by: 'stage' });
  const { data: ucAccount } = useUseCaseAnalytics({ group_by: 'account' });

  const pipelineData = pipeline as any;
  const forecastData = forecast as any;
  const ucStageGroups = (ucStage as any)?.by_group ?? (ucStage as any)?.data ?? [];
  const ucAccountGroups = (ucAccount as any)?.by_group ?? (ucAccount as any)?.data ?? [];

  const stageByName = (pipelineData?.by_stage ?? pipelineData?.stages ?? []) as any[];
  const forecastRows = (forecastData?.forecast ?? forecastData?.data ?? []) as any[];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Analytics</h1>

      {/* Pipeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Pipeline by Stage</CardTitle></CardHeader>
          <CardContent>
            {stageByName.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pipeline data</p>
            ) : (
              <div className="space-y-3">
                {stageByName.map((s: any) => (
                  <div key={s.stage ?? s.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{s.stage ?? s.label}</Badge>
                      <span className="text-sm text-muted-foreground">{s.count ?? 0} deals</span>
                    </div>
                    <span className="text-sm font-medium">{formatCurrency(s.total_value ?? s.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Forecast</CardTitle></CardHeader>
          <CardContent>
            {forecastRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No forecast data</p>
            ) : (
              <div className="space-y-2">
                {forecastRows.map((f: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm border-b pb-2">
                    <span>{f.category ?? f.forecast_cat ?? f.label}</span>
                    <span className="font-medium">{formatCurrency(f.total_value ?? f.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Use Cases section */}
      <h2 className="font-display text-lg font-semibold">Use Cases</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">ARR by Stage</CardTitle></CardHeader>
          <CardContent>
            {ucStageGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data</p>
            ) : (
              <div className="space-y-3">
                {ucStageGroups.map((g: any) => {
                  const arr = g.attributed_arr ?? g.total_attributed_arr ?? 0;
                  return (
                    <div key={g.label ?? g.stage} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{(g.label ?? g.stage ?? '').replace('_', ' ')}</Badge>
                        <span className="text-sm text-muted-foreground">{g.count ?? 0}</span>
                      </div>
                      <span className="text-sm font-medium">{formatCurrency(arr)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">ARR by Account</CardTitle></CardHeader>
          <CardContent>
            {ucAccountGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data</p>
            ) : (
              <div className="space-y-2">
                {ucAccountGroups.slice(0, 10).map((g: any) => (
                  <div key={g.label ?? g.account_id} className="flex items-center justify-between text-sm border-b pb-2">
                    <div>
                      <span className="font-medium">{g.label ?? g.account_name ?? 'Account'}</span>
                      <span className="ml-2 text-muted-foreground">{g.count ?? 0} use cases</span>
                    </div>
                    <span className="font-medium">{formatCurrency(g.attributed_arr ?? g.total_attributed_arr ?? 0)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Health Distribution</CardTitle></CardHeader>
          <CardContent>
            {ucStageGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data</p>
            ) : (() => {
              const allUc = ucStageGroups;
              const healthy = allUc.filter((g: any) => (g.avg_health ?? g.health_score ?? 100) >= 70).length;
              const atRisk = allUc.filter((g: any) => {
                const h = g.avg_health ?? g.health_score ?? 100;
                return h >= 40 && h < 70;
              }).length;
              const critical = allUc.filter((g: any) => (g.avg_health ?? g.health_score ?? 100) < 40).length;
              return (
                <div className="flex gap-4">
                  <div className="text-center">
                    <Badge variant="success" className="text-lg px-3 py-1">{healthy}</Badge>
                    <p className="text-xs text-muted-foreground mt-1">Healthy</p>
                  </div>
                  <div className="text-center">
                    <Badge variant="warning" className="text-lg px-3 py-1">{atRisk}</Badge>
                    <p className="text-xs text-muted-foreground mt-1">At Risk</p>
                  </div>
                  <div className="text-center">
                    <Badge variant="danger" className="text-lg px-3 py-1">{critical}</Badge>
                    <p className="text-xs text-muted-foreground mt-1">Critical</p>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
