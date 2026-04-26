// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useAppStore } from '@/store/appStore';
import { useEmail } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import {
  Mail,
  FileEdit,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Send,
  User,
} from 'lucide-react';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Mail }> = {
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground', icon: FileEdit },
  pending_approval: { label: 'Pending Approval', color: 'bg-warning/15 text-warning', icon: Clock },
  approved: { label: 'Approved', color: 'bg-emerald-500/15 text-emerald-500', icon: CheckCircle2 },
  sending: { label: 'Sending', color: 'bg-blue-500/15 text-blue-500', icon: Send },
  sent: { label: 'Sent', color: 'bg-emerald-500/15 text-emerald-500', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-destructive/15 text-destructive', icon: AlertCircle },
  rejected: { label: 'Rejected', color: 'bg-destructive/15 text-destructive', icon: XCircle },
};

export function EmailDrawer() {
  const { drawerEntityId } = useAppStore();
  const id = drawerEntityId ?? '';
  const { data, isLoading } = useEmail(id) as any;

  const email = (data as any)?.email ?? data;

  if (isLoading || !email) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }

  const cfg = STATUS_CONFIG[email.status] ?? STATUS_CONFIG.draft;
  const Icon = cfg.icon;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Mail className="w-5 h-5 text-blue-500 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-display font-bold text-foreground">
            {email.subject || '(no subject)'}
          </h3>
          <Badge variant="outline" className={`text-xs mt-1 ${cfg.color}`}>
            <Icon className="w-3 h-3 mr-1" />
            {cfg.label}
          </Badge>
        </div>
      </div>

      {/* Metadata */}
      <div className="space-y-2 border-t border-border pt-3">
        {email.to && (
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">To:</span>
            <span className="text-sm text-foreground">{email.to}</span>
          </div>
        )}
        {email.from && (
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">From:</span>
            <span className="text-sm text-foreground">{email.from}</span>
          </div>
        )}
        {email.created_at && (
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Created:</span>
            <span className="text-sm text-foreground">{format(new Date(email.created_at), 'PPp')}</span>
          </div>
        )}
        {email.sent_at && (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-xs text-muted-foreground">Sent:</span>
            <span className="text-sm text-foreground">{format(new Date(email.sent_at), 'PPp')}</span>
          </div>
        )}
      </div>

      {/* Body */}
      {email.body && (
        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Body</p>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-foreground bg-muted/30 p-3 rounded-lg">
              {email.body}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
