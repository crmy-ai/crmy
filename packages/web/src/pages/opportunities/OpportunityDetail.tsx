// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useOpportunity, useUseCases } from '../../api/hooks';

function formatCurrency(cents?: number) {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

type Tab = 'details' | 'use-cases';

export function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useOpportunity(id!);
  const { data: ucData } = useUseCases({ limit: 50 });
  const [tab, setTab] = useState<Tab>('details');

  const opp = (data as any)?.data ?? data;
  // Filter use cases that belong to this opportunity
  const allUc = (ucData as any)?.data ?? [];
  const useCases = allUc.filter((uc: any) => uc.opportunity_id === id);

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;
  if (!opp) return <p className="text-muted-foreground">Opportunity not found</p>;

  const totalArr = useCases.reduce((sum: number, uc: any) => sum + (uc.attributed_arr ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{opp.name}</h1>
        <div className="flex items-center gap-3 mt-1">
          <Badge variant="outline">{opp.stage?.replace('_', ' ')}</Badge>
          <span className="text-lg font-semibold">{formatCurrency(opp.amount)}</span>
          {opp.close_date && <span className="text-sm text-muted-foreground">Close: {new Date(opp.close_date).toLocaleDateString()}</span>}
        </div>
      </div>

      <div className="flex gap-2 border-b">
        <Button variant={tab === 'details' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('details')}>Details</Button>
        <Button variant={tab === 'use-cases' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('use-cases')}>
          Use Cases ({useCases.length})
        </Button>
      </div>

      {tab === 'details' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Opportunity Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Stage</span><span>{opp.stage}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span>{formatCurrency(opp.amount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Probability</span><span>{opp.probability != null ? `${opp.probability}%` : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Forecast</span><span>{opp.forecast_cat ?? '—'}</span></div>
              {opp.description && <p className="pt-2 text-muted-foreground">{opp.description}</p>}
              {opp.account_id && (
                <div className="flex justify-between pt-2">
                  <span className="text-muted-foreground">Account</span>
                  <Link to={`/app/accounts/${opp.account_id}`} className="text-primary hover:underline">View</Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'use-cases' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Use Cases</CardTitle>
              <span className="text-sm text-muted-foreground">Attributed ARR: {formatCurrency(totalArr)}</span>
            </div>
          </CardHeader>
          <CardContent>
            {useCases.length === 0 ? <p className="text-sm text-muted-foreground">No use cases linked</p> : (
              <div className="space-y-2">
                {useCases.map((uc: any) => (
                  <div key={uc.id} className="flex items-center gap-3 border-b pb-2 text-sm">
                    <Link to={`/app/use-cases/${uc.id}`} className="font-medium text-primary hover:underline">{uc.name}</Link>
                    <Badge variant="outline">{uc.stage}</Badge>
                    <span className="ml-auto">{formatCurrency(uc.attributed_arr)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
