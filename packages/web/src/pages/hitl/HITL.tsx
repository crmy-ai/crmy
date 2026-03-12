// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useHITLRequests, useResolveHITL } from '../../api/hooks';

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function HITLPage() {
  const { data, isLoading } = useHITLRequests();
  const resolve = useResolveHITL();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const requests = (data as any)?.data ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">HITL Queue</h1>
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldCheck className="h-12 w-12 text-emerald-500 mb-3" />
            <p className="text-lg font-medium">No pending approvals</p>
            <p className="text-sm text-muted-foreground">Your agents are running autonomously</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Badge variant="outline">{r.action_type}</Badge>
                  <span className="text-sm text-muted-foreground">Submitted by: {r.agent_id ?? r.created_by ?? 'agent'}</span>
                  <span className="text-sm text-muted-foreground">{timeAgo(r.created_at)}</span>
                  {r.expires_at && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Expires: {new Date(r.expires_at).toLocaleString()}
                    </span>
                  )}
                </div>
                <p className="text-sm">{r.action_summary}</p>
                <div>
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => setExpanded({ ...expanded, [r.id]: !expanded[r.id] })}
                  >
                    {expanded[r.id] ? 'Hide payload' : 'Show payload'}
                  </button>
                  {expanded[r.id] && (
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-3 text-xs">
                      {JSON.stringify(r.action_payload, null, 2)}
                    </pre>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Note (optional)"
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                    className="flex-1"
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => resolve.mutate({ id: r.id, status: 'rejected', note: notes[r.id] })}
                    disabled={resolve.isPending}
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => resolve.mutate({ id: r.id, status: 'approved', note: notes[r.id] })}
                    disabled={resolve.isPending}
                  >
                    Approve
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
