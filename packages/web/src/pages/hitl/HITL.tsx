// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { ShieldCheck, Clock } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHITLRequests, useResolveHITL } from '@/api/hooks';

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
    <div className="flex flex-col h-full">
      <TopBar
        title="Approvals"
        icon={ShieldCheck}
        iconClassName="text-destructive"
        description="Human-in-the-loop approvals for agent actions."
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6 space-y-4">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : requests.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <ShieldCheck className="h-14 w-14 text-emerald-500 mb-4" />
              <p className="text-lg font-display font-semibold">No pending approvals</p>
              <p className="text-sm text-muted-foreground mt-1">Your agents are running autonomously</p>
            </CardContent>
          </Card>
        ) : (
          requests.map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge variant="outline">{r.action_type}</Badge>
                  <span className="text-sm text-muted-foreground">
                    Agent action pending approval
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {timeAgo(r.created_at)}
                  </span>
                  {r.expires_at && (
                    <span className="text-xs text-muted-foreground">
                      Expires {new Date(r.expires_at).toLocaleString()}
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">
                    Submitted by {r.agent_id ?? r.created_by ?? 'agent'}
                  </p>
                  <p className="text-sm text-foreground">{r.action_summary}</p>
                </div>
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
          ))
        )}
      </div>
    </div>
  );
}
