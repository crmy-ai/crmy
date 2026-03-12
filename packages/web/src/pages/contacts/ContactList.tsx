// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/table';
import { useContacts } from '../../api/hooks';

export function ContactListPage() {
  const [q, setQ] = useState('');
  const { data, isLoading } = useContacts({ q: q || undefined, limit: 50 });
  const contacts = (data as any)?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Contacts</h1>
        <Link to="/app/contacts/new">
          <Button><Plus className="mr-2 h-4 w-4" />New Contact</Button>
        </Link>
      </div>
      <Input
        placeholder="Search contacts..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-sm"
      />
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((c: any) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link to={`/app/contacts/${c.id}`} className="font-medium text-primary hover:underline">
                    {c.first_name} {c.last_name}
                  </Link>
                </TableCell>
                <TableCell>{c.email ?? '—'}</TableCell>
                <TableCell>{c.company_name ?? '—'}</TableCell>
                <TableCell><Badge variant="outline">{c.lifecycle_stage}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
            {contacts.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">No contacts found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
