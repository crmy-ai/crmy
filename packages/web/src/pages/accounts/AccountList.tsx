// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/table';
import { useAccounts } from '../../api/hooks';

function formatCurrency(cents?: number) {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

export function AccountListPage() {
  const [q, setQ] = useState('');
  const { data, isLoading } = useAccounts({ q: q || undefined, limit: 50 });
  const accounts = (data as any)?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Accounts</h1>
        <Link to="/app/accounts/new">
          <Button><Plus className="mr-2 h-4 w-4" />New Account</Button>
        </Link>
      </div>
      <Input placeholder="Search accounts..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Revenue</TableHead>
              <TableHead>Employees</TableHead>
              <TableHead>Health</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link to={`/app/accounts/${a.id}`} className="font-medium text-primary hover:underline">{a.name}</Link>
                </TableCell>
                <TableCell>{a.industry ?? '—'}</TableCell>
                <TableCell>{formatCurrency(a.annual_revenue)}</TableCell>
                <TableCell>{a.employee_count ?? '—'}</TableCell>
                <TableCell>{a.health_score != null ? `${a.health_score}/100` : '—'}</TableCell>
              </TableRow>
            ))}
            {accounts.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No accounts found</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
