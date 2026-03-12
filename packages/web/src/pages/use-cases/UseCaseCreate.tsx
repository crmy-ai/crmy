// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { useCreateUseCase, useAccounts } from '../../api/hooks';

const STAGES = ['discovery', 'onboarding', 'active', 'at_risk', 'churned', 'expansion'];
const UNITS = ['api_calls', 'credits', 'tokens', 'gb', 'seats', 'workflows', 'events', 'custom'];

export function UseCaseCreatePage() {
  const navigate = useNavigate();
  const create = useCreateUseCase();
  const { data: accountsData } = useAccounts({ limit: 100 });
  const accounts = (accountsData as any)?.data ?? [];

  const [form, setForm] = useState({
    name: '', account_id: '', description: '', stage: 'discovery',
    consumption_unit: '', unit_label: '', consumption_current: '',
    consumption_capacity: '', attributed_arr: '', expansion_potential: '',
    started_at: '', target_prod_date: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      name: form.name,
      account_id: form.account_id,
      stage: form.stage,
    };
    if (form.description) payload.description = form.description;
    if (form.consumption_unit) payload.consumption_unit = form.consumption_unit;
    if (form.unit_label) payload.unit_label = form.unit_label;
    if (form.consumption_current) payload.consumption_current = parseInt(form.consumption_current);
    if (form.consumption_capacity) payload.consumption_capacity = parseInt(form.consumption_capacity);
    if (form.attributed_arr) payload.attributed_arr = Math.round(parseFloat(form.attributed_arr) * 100);
    if (form.expansion_potential) payload.expansion_potential = Math.round(parseFloat(form.expansion_potential) * 100);
    if (form.started_at) payload.started_at = form.started_at;
    if (form.target_prod_date) payload.target_prod_date = form.target_prod_date;

    const result = await create.mutateAsync(payload);
    navigate(`/app/use-cases/${(result as any).id ?? (result as any).data?.id}`);
  };

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader><CardTitle>New Use Case</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Name *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Account *</label>
              <Select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} required>
                <option value="">Select account...</option>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Stage</label>
              <Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                {STAGES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Description</label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Consumption unit</label>
                <Select value={form.consumption_unit} onChange={(e) => setForm({ ...form, consumption_unit: e.target.value })}>
                  <option value="">None</option>
                  {UNITS.map((u) => <option key={u} value={u}>{u.replace('_', ' ')}</option>)}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Unit label</label>
                <Input value={form.unit_label} onChange={(e) => setForm({ ...form, unit_label: e.target.value })} placeholder="e.g. API calls" />
              </div>
            </div>
            {form.consumption_unit && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">Current usage</label>
                  <Input type="number" value={form.consumption_current} onChange={(e) => setForm({ ...form, consumption_current: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Capacity</label>
                  <Input type="number" value={form.consumption_capacity} onChange={(e) => setForm({ ...form, consumption_capacity: e.target.value })} />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Attributed ARR ($)</label>
                <Input type="number" step="0.01" value={form.attributed_arr} onChange={(e) => setForm({ ...form, attributed_arr: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Expansion potential ($)</label>
                <Input type="number" step="0.01" value={form.expansion_potential} onChange={(e) => setForm({ ...form, expansion_potential: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Started at</label>
                <Input type="date" value={form.started_at} onChange={(e) => setForm({ ...form, started_at: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Target production date</label>
                <Input type="date" value={form.target_prod_date} onChange={(e) => setForm({ ...form, target_prod_date: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating...' : 'Create Use Case'}</Button>
              <Button type="button" variant="outline" onClick={() => navigate('/app/use-cases')}>Cancel</Button>
            </div>
            {create.isError && <p className="text-sm text-destructive">{(create.error as Error).message}</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
