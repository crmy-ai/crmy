// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { useInboundEmails, useContact } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import {
  Inbox, Mail, User, ArrowDownLeft, Brain, Clock, RefreshCw, Search, X,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InboundActivity {
  id: string;
  subject?: string;
  body?: string;
  contact_id?: string;
  account_id?: string;
  direction: 'inbound';
  source_agent?: string;
  occurred_at?: string;
  created_at: string;
  detail?: Record<string, unknown>;
  contact?: { first_name?: string; last_name?: string; email?: string };
}

// ─── Contact Badge ────────────────────────────────────────────────────────────

function ContactBadge({ contactId }: { contactId?: string }) {
  const { data } = useContact(contactId ?? '') as { data?: { first_name?: string; last_name?: string; email?: string } };
  const { openDrawer } = useAppStore();

  if (!contactId) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">
        <User className="w-2.5 h-2.5" />
        Unknown sender
      </span>
    );
  }

  const name = data
    ? ([data.first_name, data.last_name].filter(Boolean).join(' ') || data.email || contactId.slice(0, 8))
    : contactId.slice(0, 8);

  return (
    <button
      onClick={() => openDrawer('contact', contactId)}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors font-semibold"
    >
      <User className="w-2.5 h-2.5" />
      {name}
    </button>
  );
}

// ─── Email Card ───────────────────────────────────────────────────────────────

function InboundEmailCard({ email }: { email: InboundActivity }) {
  const [expanded, setExpanded] = useState(false);

  const receivedAt = email.occurred_at ?? email.created_at;
  const relativeTime = (() => {
    const diff = Date.now() - new Date(receivedAt).getTime();
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    if (days > 0) return `${days}d ago`;
    if (hrs > 0) return `${hrs}h ago`;
    if (mins > 0) return `${mins}m ago`;
    return 'Just now';
  })();

  const contextExtracted = email.source_agent === 'context_extraction' ||
    (email.detail && Object.keys(email.detail).length > 0);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:border-border/80 transition-colors">
      {/* Header */}
      <button
        className="w-full flex items-start gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
          <ArrowDownLeft className="w-4 h-4 text-blue-500" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <ContactBadge contactId={email.contact_id} />
            {contextExtracted && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 font-semibold">
                <Brain className="w-2.5 h-2.5" />
                Context extracted
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-foreground truncate">
            {email.subject || '(no subject)'}
          </p>
          {!expanded && email.body && (
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
              {email.body}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          {relativeTime}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-3">
          {email.body ? (
            <div className="rounded-lg bg-muted/30 border border-border px-3 py-2.5">
              <p className="text-xs text-muted-foreground font-semibold mb-1.5 uppercase tracking-wider">Email Body</p>
              <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">{email.body}</pre>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">(empty body)</p>
          )}

          {email.detail && Object.keys(email.detail).length > 0 && (
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Brain className="w-3.5 h-3.5 text-emerald-500" />
                <p className="text-xs text-emerald-600 font-semibold">Extracted Context</p>
              </div>
              <div className="space-y-1">
                {Object.entries(email.detail).map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0 font-mono">{k}:</span>
                    <span className="text-foreground">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>Received {new Date(receivedAt).toLocaleString()}</span>
            {email.source_agent && <span className="text-muted-foreground/60">via {email.source_agent}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InboundInboxPage() {
  const [q, setQ] = useState('');
  const { data, isLoading, refetch, isFetching } = useInboundEmails({ limit: 50 }) as {
    data: { data: InboundActivity[]; total: number } | undefined;
    isLoading: boolean;
    refetch: () => void;
    isFetching: boolean;
  };

  const emails = data?.data ?? [];
  const filtered = q
    ? emails.filter(e =>
        (e.subject ?? '').toLowerCase().includes(q.toLowerCase()) ||
        (e.body ?? '').toLowerCase().includes(q.toLowerCase())
      )
    : emails;

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Inbound Inbox"
        icon={Inbox}
        iconClassName="text-blue-500"
        description={`${data?.total ?? 0} received email${(data?.total ?? 0) !== 1 ? 's' : ''}`}
      >
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search subject or body…"
            className="w-full h-9 pl-9 pr-8 rounded-lg border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Info callout */}
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-xs font-semibold text-foreground mb-1">How inbound email works</p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Emails arrive via your provider's inbound webhook (<code className="bg-muted px-1 rounded">POST /api/v1/email/inbound</code>)</li>
            <li>Each email is stored as an activity with <strong className="text-foreground">direction = inbound</strong></li>
            <li>CRMy resolves the sender to a known contact and extracts context automatically</li>
            <li>Configure your webhook secret in <strong className="text-foreground">Settings → Email</strong></li>
          </ul>
        </div>

        {/* Email list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-muted/50 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/15 flex items-center justify-center mb-4">
              <Mail className="w-8 h-8 text-blue-500" />
            </div>
            <h2 className="text-lg font-display font-semibold text-foreground mb-1">
              {q ? 'No matching emails' : 'No inbound emails yet'}
            </h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              {q
                ? 'Try adjusting your search query.'
                : 'Replies from prospects will appear here once your inbound webhook is configured.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(email => (
              <InboundEmailCard key={email.id} email={email} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
