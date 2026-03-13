// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { useCreateOpportunity } from '../../api/hooks';
import { CustomFieldsForm } from '../../components/CustomFields';

export function OpportunityCreatePage() {
  const navigate = useNavigate();
  const create = useCreateOpportunity();
  const [form, setForm] = useState({
    name: '', stage: 'prospecting', amount: '', close_date: '', description: '',
  });
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      ...form,
      amount: form.amount ? Math.round(parseFloat(form.amount) * 100) : undefined,
      custom_fields: customFields,
    };
    const result = await create.mutateAsync(payload);
    navigate(`/app/opportunities/${(result as any).id ?? (result as any).data?.id}`);
  };

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader><CardTitle>New Opportunity</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Name *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Stage</label>
              <Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                <option value="prospecting">Prospecting</option>
                <option value="qualification">Qualification</option>
                <option value="proposal">Proposal</option>
                <option value="negotiation">Negotiation</option>
                <option value="closed_won">Closed Won</option>
                <option value="closed_lost">Closed Lost</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Amount ($)</label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Close date</label>
              <Input type="date" value={form.close_date} onChange={(e) => setForm({ ...form, close_date: e.target.value })} />
            </div>
            <CustomFieldsForm objectType="opportunity" values={customFields} onChange={setCustomFields} />
            <div className="flex gap-2">
              <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating...' : 'Create Deal'}</Button>
              <Button type="button" variant="outline" onClick={() => navigate('/app/pipeline')}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
