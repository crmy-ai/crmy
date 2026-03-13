// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAccount, useUseCases } from '../../api/hooks';
import { CustomFieldsDisplay } from '../../components/CustomFields';

function formatCurrency(cents?: number) {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

type Tab = 'overview' | 'use-cases';

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useAccount(id!);
  const { data: ucData } = useUseCases({ account_id: id });
  const [tab, setTab] = useState<Tab>('overview');

  const account = (data as any)?.data ?? data;
  const useCases = (ucData as any)?.data ?? [];
  const contacts = account?.contacts ?? [];
  const opportunities = account?.opportunities ?? [];

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;
  if (!account) return <p className="text-muted-foreground">Account not found</p>;

  const totalArr = useCases.reduce((sum: number, uc: any) => sum + (uc.attributed_arr ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{account.name}</h1>
        <p className="text-muted-foreground">{account.industry ?? 'No industry'}{account.domain ? ` · ${account.domain}` : ''}</p>
      </div>

      <div className="flex gap-2 border-b">
        <Button variant={tab === 'overview' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('overview')}>Overview</Button>
        <Button variant={tab === 'use-cases' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('use-cases')}>
          Use Cases ({useCases.length})
        </Button>
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Account Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Revenue</span><span>{formatCurrency(account.annual_revenue)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Employees</span><span>{account.employee_count ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Health</span><span>{account.health_score != null ? `${account.health_score}/100` : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Website</span><span>{account.website ?? '—'}</span></div>
              <CustomFieldsDisplay objectType="account" customFields={account.custom_fields} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Contacts ({contacts.length})</CardTitle></CardHeader>
            <CardContent>
              {contacts.length === 0 ? <p className="text-sm text-muted-foreground">No contacts</p> : (
                <div className="space-y-2">
                  {contacts.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between text-sm border-b pb-2">
                      <Link to={`/app/contacts/${c.id}`} className="text-primary hover:underline">{c.first_name} {c.last_name}</Link>
                      <span className="text-muted-foreground">{c.title ?? ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Opportunities ({opportunities.length})</CardTitle></CardHeader>
            <CardContent>
              {opportunities.length === 0 ? <p className="text-sm text-muted-foreground">No opportunities</p> : (
                <div className="space-y-2">
                  {opportunities.map((o: any) => (
                    <div key={o.id} className="flex items-center gap-3 text-sm border-b pb-2">
                      <Link to={`/app/opportunities/${o.id}`} className="font-medium text-primary hover:underline">{o.name}</Link>
                      <Badge variant="outline">{o.stage}</Badge>
                      <span className="ml-auto">{formatCurrency(o.amount)}</span>
                    </div>
                  ))}
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
              <span className="text-sm text-muted-foreground">Total ARR: {formatCurrency(totalArr)}</span>
            </div>
          </CardHeader>
          <CardContent>
            {useCases.length === 0 ? <p className="text-sm text-muted-foreground">No use cases</p> : (
              <div className="space-y-3">
                {useCases.map((uc: any) => (
                  <div key={uc.id} className="flex items-center gap-3 border-b pb-3">
                    <Link to={`/app/use-cases/${uc.id}`} className="font-medium text-primary hover:underline">{uc.name}</Link>
                    <Badge variant="outline">{uc.stage}</Badge>
                    <span className="text-sm">{formatCurrency(uc.attributed_arr)}</span>
                    {uc.consumption_capacity && (
                      <div className="ml-auto flex items-center gap-2">
                        <div className="h-2 w-20 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              (uc.consumption_current / uc.consumption_capacity) > 0.9 ? 'bg-red-500'
                              : (uc.consumption_current / uc.consumption_capacity) > 0.7 ? 'bg-amber-500'
                              : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, ((uc.consumption_current ?? 0) / uc.consumption_capacity) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">{Math.round(((uc.consumption_current ?? 0) / uc.consumption_capacity) * 100)}%</span>
                      </div>
                    )}
                    {uc.health_score != null && (
                      <Badge variant={uc.health_score >= 70 ? 'success' : uc.health_score >= 40 ? 'warning' : 'danger'}>
                        {uc.health_score}
                      </Badge>
                    )}
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
