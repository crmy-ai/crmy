// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/table';
import { useUseCases } from '../../api/hooks';

function formatCurrency(cents?: number) {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

const STAGES = ['', 'discovery', 'poc', 'production', 'scaling', 'sunset'];

export function UseCaseListPage() {
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [stage, setStage] = useState(searchParams.get('stage') ?? '');
  const { data, isLoading } = useUseCases({ q: q || undefined, stage: stage || undefined, limit: 50 });
  const useCases = (data as any)?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Use Cases</h1>
        <Link to="/app/use-cases/new">
          <Button><Plus className="mr-2 h-4 w-4" />New Use Case</Button>
        </Link>
      </div>
      <div className="flex gap-3">
        <Input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Select value={stage} onChange={(e) => setStage(e.target.value)} className="w-40">
          <option value="">All stages</option>
          {STAGES.filter(Boolean).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>ARR</TableHead>
              <TableHead>Consumption</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {useCases.map((uc: any) => {
              const pct = uc.consumption_capacity
                ? Math.round(((uc.consumption_current ?? 0) / uc.consumption_capacity) * 100)
                : null;
              return (
                <TableRow key={uc.id}>
                  <TableCell>
                    <Link to={`/app/use-cases/${uc.id}`} className="font-medium text-primary hover:underline">{uc.name}</Link>
                  </TableCell>
                  <TableCell><Badge variant="outline">{uc.stage?.replace('_', ' ')}</Badge></TableCell>
                  <TableCell>{formatCurrency(uc.attributed_arr)}</TableCell>
                  <TableCell>
                    {pct != null ? (
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="text-xs">{pct}%</span>
                      </div>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    {uc.health_score != null ? (
                      <Badge variant={uc.health_score >= 70 ? 'success' : uc.health_score >= 40 ? 'warning' : 'danger'}>
                        {uc.health_score}
                      </Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{new Date(uc.updated_at).toLocaleDateString()}</TableCell>
                </TableRow>
              );
            })}
            {useCases.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No use cases found</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
