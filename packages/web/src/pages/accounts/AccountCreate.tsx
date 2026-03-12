// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { useCreateAccount } from '../../api/hooks';

export function AccountCreatePage() {
  const navigate = useNavigate();
  const create = useCreateAccount();
  const [form, setForm] = useState({ name: '', domain: '', industry: '', website: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await create.mutateAsync(form);
    navigate(`/app/accounts/${(result as any).id ?? (result as any).data?.id}`);
  };

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader><CardTitle>New Account</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Name *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Domain</label>
              <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Industry</label>
              <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Website</label>
              <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating...' : 'Create Account'}</Button>
              <Button type="button" variant="outline" onClick={() => navigate('/app/accounts')}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
