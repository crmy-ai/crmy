// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { useCreateContact } from '../../api/hooks';
import { CustomFieldsForm } from '../../components/CustomFields';

export function ContactCreatePage() {
  const navigate = useNavigate();
  const create = useCreateContact();
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    title: '', company_name: '', lifecycle_stage: 'lead',
  });
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...form, custom_fields: customFields };
    const result = await create.mutateAsync(payload);
    navigate(`/app/contacts/${(result as any).id ?? (result as any).data?.id}`);
  };

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader><CardTitle>New Contact</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">First name *</label>
                <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Last name *</label>
                <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Phone</label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Title</label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Company</label>
              <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Lifecycle stage</label>
              <Select value={form.lifecycle_stage} onChange={(e) => setForm({ ...form, lifecycle_stage: e.target.value })}>
                <option value="lead">Lead</option>
                <option value="prospect">Prospect</option>
                <option value="customer">Customer</option>
                <option value="churned">Churned</option>
              </Select>
            </div>
            <CustomFieldsForm objectType="contact" values={customFields} onChange={setCustomFields} />
            <div className="flex gap-2">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating...' : 'Create Contact'}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/app/contacts')}>Cancel</Button>
            </div>
            {create.isError && <p className="text-sm text-destructive">{(create.error as Error).message}</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
