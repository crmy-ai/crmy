// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { useOpportunities } from '../../api/hooks';

const STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] as const;

const stageColors: Record<string, string> = {
  prospecting: 'border-t-slate-400',
  qualification: 'border-t-blue-400',
  proposal: 'border-t-indigo-400',
  negotiation: 'border-t-amber-400',
  closed_won: 'border-t-emerald-400',
  closed_lost: 'border-t-red-400',
};

function formatCurrency(cents?: number) {
  if (cents == null) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

export function PipelinePage() {
  const { data, isLoading } = useOpportunities({ limit: 100 });
  const opps = (data as any)?.data ?? [];

  if (isLoading) return <p className="text-muted-foreground">Loading pipeline...</p>;

  const byStage = STAGES.map((stage) => ({
    stage,
    opps: opps.filter((o: any) => o.stage === stage),
    total: opps.filter((o: any) => o.stage === stage).reduce((sum: number, o: any) => sum + (o.amount ?? 0), 0),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Pipeline</h1>
        <Link to="/app/opportunities/new">
          <Button><Plus className="mr-2 h-4 w-4" />New Deal</Button>
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {byStage.map(({ stage, opps: stageOpps, total }) => (
          <div key={stage} className="space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant="outline">{stage.replace('_', ' ')}</Badge>
              <span className="text-xs text-muted-foreground">{stageOpps.length}</span>
            </div>
            <p className="text-sm font-medium">{formatCurrency(total)}</p>
            <div className="space-y-2">
              {stageOpps.map((o: any) => (
                <Link key={o.id} to={`/app/opportunities/${o.id}`}>
                  <Card className={`border-t-4 ${stageColors[stage]} hover:shadow-md transition-shadow cursor-pointer`}>
                    <CardContent className="p-3">
                      <p className="text-sm font-medium truncate">{o.name}</p>
                      <p className="text-xs text-muted-foreground">{formatCurrency(o.amount)}</p>
                      {o.close_date && (
                        <p className="mt-1 text-xs text-muted-foreground">Close: {new Date(o.close_date).toLocaleDateString()}</p>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
