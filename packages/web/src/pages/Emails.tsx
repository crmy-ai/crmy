// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { useEmails, useCreateEmail, useInboundEmails, useContact } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import {
  Mail, Loader2, Send, FileEdit, AlertCircle, CheckCircle2, Clock,
  XCircle, ArrowDownLeft, ArrowUpRight, Brain, User, RefreshCw,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';

// ─── Outbound config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Mail }> = {
  draft:            { label: 'Draft',            color: 'bg-muted text-muted-foreground',        icon: FileEdit },
  pending_approval: { label: 'Pending Approval', color: 'bg-warning/15 text-warning',            icon: Clock },
  approved:         { label: 'Approved',         color: 'bg-emerald-500/15 text-emerald-500',    icon: CheckCircle2 },
  sending:          { label: 'Sending',          color: 'bg-blue-500/15 text-blue-500',          icon: Send },
  sent:             { label: 'Sent',             color: 'bg-emerald-500/15 text-emerald-500',    icon: CheckCircle2 },
  failed:           { label: 'Failed',           color: 'bg-destructive/15 text-destructive',    icon: AlertCircle },
  rejected:         { label: 'Rejected',         color: 'bg-destructive/15 text-destructive',    icon: XCircle },
};

const FILTER_CONFIGS: FilterConfig[] = [
  {
    key: 'status',
    label: 'Status',
    options: Object.entries(STATUS_CONFIG).map(([value, { label }]) => ({ value, label })),
  },
];

const SORT_OPTIONS: SortOption[] = [
  { key: 'created_at', label: 'Date Created' },
  { key: 'subject',    label: 'Subject' },
  { key: 'to_email',   label: 'Recipient' },
];

// ─── Types ───────────────────────────────────────────────────────────────────

type View = 'outbound' | 'inbound';

// ─── Contact badge (for inbound) ──────────────────────────────────────────────

function ContactBadge({ contactId }: { contactId?: string }) {
  const { data } = useContact(contactId ?? '') as { data?: { first_name?: string; last_name?: string; email?: string } };
  const { openDrawer } = useAppStore();

  if (!contactId) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">
        <User className="w-2.5 h-2.5" /> Unknown sender
      </span>
    );
  }

  const name = data
    ? ([data.first_name, data.last_name].filter(Boolean).join(' ') || data.email || contactId.slice(0, 8))
    : contactId.slice(0, 8);

  return (
    <button
      onClick={e => { e.stopPropagation(); openDrawer('contact', contactId); }}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors font-semibold"
    >
      <User className="w-2.5 h-2.5" /> {name}
    </button>
  );
}

// ─── Inbound email row ────────────────────────────────────────────────────────

function InboundRow({ email }: { email: any }) {
  const [expanded, setExpanded] = useState(false);
  const contextExtracted = email.source_agent === 'context_extraction' ||
    (email.detail && Object.keys(email.detail).length > 0);
  const receivedAt = email.occurred_at ?? email.created_at;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl overflow-hidden cursor-pointer hover:border-primary/30 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-3 p-4">
        <ArrowDownLeft className="w-4 h-4 flex-shrink-0 text-blue-500" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-semibold text-foreground truncate">{email.subject || '(no subject)'}</span>
            {contextExtracted && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 font-semibold">
                <Brain className="w-2.5 h-2.5" /> Context extracted
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <ContactBadge contactId={email.contact_id} />
            <span>· {formatDistanceToNow(new Date(receivedAt), { addSuffix: true })}</span>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-2">
          {email.body ? (
            <div className="rounded-lg bg-muted/30 border border-border px-3 py-2.5">
              <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">{email.body}</pre>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">(empty body)</p>
          )}
          <p className="text-xs text-muted-foreground">{new Date(receivedAt).toLocaleString()}</p>
        </div>
      )}
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EmailsPage() {
  const { openDrawer } = useAppStore();
  const [view, setView] = useState<View>('outbound');
  const [q, setQ] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');

  // Outbound
  const statusFilter = activeFilters.status?.[0] ?? '';
  const { data: outboundData, isLoading: outboundLoading } = useEmails({ status: statusFilter || undefined }) as any;
  const createEmail = useCreateEmail();
  const outboundEmails: any[] = outboundData?.data ?? [];

  // Inbound
  const { data: inboundData, isLoading: inboundLoading, refetch: refetchInbound, isFetching: inboundFetching } =
    useInboundEmails({ limit: 100 }) as any;
  const inboundEmails: any[] = inboundData?.data ?? [];

  const filteredOutbound = useMemo(() => {
    let items = outboundEmails;
    if (q.trim()) {
      const lower = q.toLowerCase();
      items = items.filter((e: any) =>
        (e.subject ?? '').toLowerCase().includes(lower) ||
        (e.to_email ?? '').toLowerCase().includes(lower)
      );
    }
    if (sort) {
      items = [...items].sort((a: any, b: any) => {
        const av = String(a[sort.key] ?? '');
        const bv = String(b[sort.key] ?? '');
        return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return items;
  }, [outboundEmails, q, sort]);

  const filteredInbound = useMemo(() => {
    if (!q.trim()) return inboundEmails;
    const lower = q.toLowerCase();
    return inboundEmails.filter((e: any) =>
      (e.subject ?? '').toLowerCase().includes(lower) ||
      (e.body ?? '').toLowerCase().includes(lower)
    );
  }, [inboundEmails, q]);

  const handleCompose = async (status: string) => {
    if (!composeTo.trim() || !composeSubject.trim()) {
      toast({ title: 'Missing fields', description: 'To and subject are required.', variant: 'destructive' });
      return;
    }
    try {
      await createEmail.mutateAsync({
        to_address: composeTo.trim(),
        subject: composeSubject.trim(),
        body_text: composeBody.trim(),
        require_approval: status === 'pending_approval',
      });
      setComposeTo(''); setComposeSubject(''); setComposeBody('');
      setComposeOpen(false);
      toast({ title: status === 'draft' ? 'Draft saved' : 'Submitted for approval' });
    } catch {
      toast({ title: 'Error', description: 'Failed to create email.', variant: 'destructive' });
    }
  };

  const isLoading = view === 'outbound' ? outboundLoading : inboundLoading;
  const isEmpty   = view === 'outbound' ? filteredOutbound.length === 0 : filteredInbound.length === 0;
  const totalRaw  = view === 'outbound' ? outboundEmails.length : inboundEmails.length;

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Emails"
        icon={Mail}
        iconClassName="text-blue-500"
        description={view === 'outbound'
          ? 'Drafted, pending, and sent emails across the CRM.'
          : 'Received emails from prospects and customers.'}
      />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 md:px-6 pt-4 border-b border-border pb-0">
        {(['outbound', 'inbound'] as View[]).map(v => (
          <button
            key={v}
            onClick={() => { setView(v); setQ(''); setActiveFilters({}); }}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              view === v
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {v === 'outbound' ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
        <div className="ml-auto pb-1">
          {view === 'outbound' ? (
            <button
              onClick={() => setComposeOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <Send className="w-3.5 h-3.5" /> Compose
            </button>
          ) : (
            <button
              onClick={() => refetchInbound()}
              disabled={inboundFetching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${inboundFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {view === 'outbound' && (
        <ListToolbar
          searchValue={q}
          onSearchChange={setQ}
          searchPlaceholder="Search by subject or recipient…"
          filters={FILTER_CONFIGS}
          activeFilters={activeFilters}
          onFilterChange={(key, values) => setActiveFilters(prev => {
            const next = { ...prev };
            if (values.length === 0) delete next[key]; else next[key] = values;
            return next;
          })}
          onClearFilters={() => { setActiveFilters({}); setQ(''); }}
          sortOptions={SORT_OPTIONS}
          currentSort={sort}
          onSortChange={(key) => setSort(prev =>
            prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
          )}
          onAdd={() => setComposeOpen(true)}
          addLabel="Compose"
          entityType="emails"
        />
      )}

      {view === 'inbound' && (
        <div className="px-4 md:px-6 pt-3 pb-1">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search subject or body…"
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6 pt-2">
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : isEmpty ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20 text-center">
            {view === 'outbound'
              ? <ArrowUpRight className="w-14 h-14 text-muted-foreground/30 mb-4" />
              : <ArrowDownLeft className="w-14 h-14 text-muted-foreground/30 mb-4" />}
            <p className="text-base font-display font-semibold text-foreground mb-1">
              {totalRaw === 0
                ? (view === 'outbound' ? 'No emails yet' : 'No inbound emails yet')
                : 'No matches'}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {totalRaw === 0
                ? (view === 'outbound'
                    ? 'Compose an email or let an agent draft one for approval.'
                    : 'Replies from prospects will appear here once your inbound webhook is configured.')
                : 'Try adjusting your search or filter.'}
            </p>
          </motion.div>
        ) : view === 'outbound' ? (
          <div className="space-y-2">
            {filteredOutbound.map((email: any, i: number) => {
              const cfg = STATUS_CONFIG[email.status] ?? STATUS_CONFIG.draft;
              const Icon = cfg.icon;
              return (
                <motion.div
                  key={email.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className="flex items-center gap-3 p-4 bg-card border border-border rounded-xl cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => openDrawer('email', email.id)}
                >
                  <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-foreground truncate">{email.subject || '(no subject)'}</span>
                      <Badge variant="outline" className={`text-[10px] ${cfg.color}`}>{cfg.label}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {email.to_email && <span className="truncate max-w-[200px]">To: {email.to_email}</span>}
                      {email.created_at && <span>· {formatDistanceToNow(new Date(email.created_at), { addSuffix: true })}</span>}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredInbound.map((email: any) => (
              <InboundRow key={email.id} email={email} />
            ))}
          </div>
        )}
      </div>

      {/* Compose Dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-blue-500" /> Compose Email
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">To</label>
              <Input placeholder="recipient@example.com" value={composeTo} onChange={e => setComposeTo(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subject</label>
              <Input placeholder="Email subject" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Body</label>
              <Textarea placeholder="Write your email…" value={composeBody} onChange={e => setComposeBody(e.target.value)} className="min-h-[140px] text-sm" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => handleCompose('draft')} disabled={createEmail.isPending} className="gap-1.5">
              <FileEdit className="w-3.5 h-3.5" /> Save Draft
            </Button>
            <Button onClick={() => handleCompose('pending_approval')} disabled={createEmail.isPending} className="gap-1.5">
              {createEmail.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <Send className="w-3.5 h-3.5" /> Send for Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
