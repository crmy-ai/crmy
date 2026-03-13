// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Badge } from '../../components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/table';
import { useActivities } from '../../api/hooks';

export function ActivityListPage() {
  const { data, isLoading } = useActivities({ limit: 50 });
  const activities = (data as any)?.data ?? [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Activities</h1>
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell><Badge variant="outline">{a.type}</Badge></TableCell>
                <TableCell className="font-medium">{a.subject}</TableCell>
                <TableCell>{a.status ?? '—'}</TableCell>
                <TableCell>{a.direction ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
            {activities.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No activities</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
