// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { useEmails, useCreateEmail } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import {
  Mail,
  Search,
  Plus,
  Loader2,
  Send,
  FileEdit,
  AlertCircle,
  CheckCircle2,
  Clock,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Mail }> = {
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground', icon: FileEdit },
  pending_approval: { label: 'Pending', color: 'bg-warning/15 text-warning', icon: Clock },
  sent: { label: 'Sent', color: 'bg-emerald-500/15 text-emerald-500', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-destructive/15 text-destructive', icon: AlertCircle },
};

export default function EmailsPage() {
  const { openDrawer } = useAppStore();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');

  const { data, isLoading } = useEmails({ status: statusFilter || undefined }) as any;
  const createEmail = useCreateEmail();

  const emails: any[] = (data as any)?.data ?? [];

  const filtered = useMemo(() => {
    if (!q.trim()) return emails;
    const lower = q.toLowerCase();
    return emails.filter((e: any) =>
      (e.subject ?? '').toLowerCase().includes(lower) ||
      (e.to ?? '').toLowerCase().includes(lower)
    );
  }, [emails, q]);

  const handleCompose = async (status: string) => {
    if (!composeTo.trim() || !composeSubject.trim()) {
      toast({ title: 'Missing fields', description: 'To and subject are required.', variant: 'destructive' });
      return;
    }
    try {
      await createEmail.mutateAsync({
        to: composeTo.trim(),
        subject: composeSubject.trim(),
        body: composeBody.trim(),
        status,
      });
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      setComposeOpen(false);
      toast({ title: status === 'draft' ? 'Draft saved' : 'Submitted for approval' });
    } catch {
      toast({ title: 'Error', description: 'Failed to create email.', variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Emails"
        icon={Mail}
        iconClassName="text-blue-500"
        description="Drafted, pending, and sent emails across the CRM."
        badge={emails.length > 0 ? (
          <span className="text-xs text-muted-foreground">{emails.length} total</span>
        ) : undefined}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">

        {/* Toolbar */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }} className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by subject or recipient…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>

          <Select value={statusFilter || '__all__'} onValueChange={(v) => setStatusFilter(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-8 w-[130px] text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending_approval">Pending</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setComposeOpen(true)}>
            <Plus className="w-3 h-3" />
            Compose
          </Button>
        </motion.div>

        {/* Content */}
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20 text-center">
            <Mail className="w-14 h-14 text-muted-foreground/30 mb-4" />
            <p className="text-base font-display font-semibold text-foreground mb-1">
              {emails.length === 0 ? 'No emails yet' : 'No matches'}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {emails.length === 0
                ? 'Compose an email or let an agent draft one for approval.'
                : 'Try adjusting your search or filter.'}
            </p>
          </motion.div>
        ) : (
          <div className="space-y-2">
            {filtered.map((email: any, i: number) => {
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
                      <Badge variant="outline" className={`text-[10px] ${cfg.color}`}>
                        {cfg.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {email.to && <span className="truncate max-w-[200px]">To: {email.to}</span>}
                      {email.created_at && (
                        <span>· {formatDistanceToNow(new Date(email.created_at), { addSuffix: true })}</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Compose Dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-blue-500" />
              Compose Email
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">To</label>
              <Input
                placeholder="recipient@example.com"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subject</label>
              <Input
                placeholder="Email subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Body</label>
              <Textarea
                placeholder="Write your email…"
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                className="min-h-[140px] text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => handleCompose('draft')} disabled={createEmail.isPending} className="gap-1.5">
              <FileEdit className="w-3.5 h-3.5" />
              Save Draft
            </Button>
            <Button onClick={() => handleCompose('pending_approval')} disabled={createEmail.isPending} className="gap-1.5">
              {createEmail.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <Send className="w-3.5 h-3.5" />
              Send for Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
