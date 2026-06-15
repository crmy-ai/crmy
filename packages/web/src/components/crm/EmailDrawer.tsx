// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useEmail, useHITLRequest, useRequestEmailApproval, useResolveEmailDelivery, useRetryProviderDraft, useSendEmailNow, useUpdateEmailDraft } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { friendlyErrorMessage } from '@/lib/friendlyErrors';
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
  Loader2,
} from 'lucide-react';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Mail }> = {
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground', icon: FileEdit },
  pending_approval: { label: 'Pending Approval', color: 'bg-warning/15 text-warning', icon: Clock },
  approved: { label: 'Approved', color: 'bg-emerald-500/15 text-emerald-500', icon: CheckCircle2 },
  queued_for_delivery: { label: 'Queued to Send', color: 'bg-blue-500/15 text-blue-500', icon: Send },
  sending: { label: 'Sending', color: 'bg-blue-500/15 text-blue-500', icon: Send },
  sent: { label: 'Sent', color: 'bg-emerald-500/15 text-emerald-500', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-destructive/15 text-destructive', icon: AlertCircle },
  rejected: { label: 'Rejected', color: 'bg-destructive/15 text-destructive', icon: XCircle },
  delivery_uncertain: { label: 'Delivery Uncertain', color: 'bg-warning/15 text-warning', icon: AlertCircle },
};

export function EmailDrawer() {
  const { drawerEntityId } = useAppStore();
  const id = drawerEntityId ?? '';
  const { data, isLoading } = useEmail(id) as any;
  const updateDraft = useUpdateEmailDraft();
  const requestApproval = useRequestEmailApproval();
  const sendNow = useSendEmailNow();
  const retryProviderDraft = useRetryProviderDraft();
  const resolveDelivery = useResolveEmailDelivery();
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');

  const email = (data as any)?.email ?? data;
  const hitlQ = useHITLRequest(email?.hitl_request_id);
  const hitlRequest = (hitlQ.data as any)?.request;

  useEffect(() => {
    if (!email) return;
    setToEmail(email.to_email ?? email.to ?? '');
    setSubject(email.subject ?? '');
    setBodyText(email.body_text ?? email.body ?? '');
  }, [email?.id, email?.to_email, email?.to, email?.subject, email?.body_text, email?.body]);

  if (isLoading || !email) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }

  const cfg = STATUS_CONFIG[email.status] ?? STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  const editable = ['draft', 'failed', 'rejected'].includes(email.status);
  const rejected = email.status === 'rejected';
  const dirty = toEmail !== (email.to_email ?? email.to ?? '') || subject !== (email.subject ?? '') || bodyText !== (email.body_text ?? email.body ?? '');
  const actionPending = updateDraft.isPending || requestApproval.isPending || sendNow.isPending || retryProviderDraft.isPending || resolveDelivery.isPending;
  const actionContext = email.generation_metadata?.action_context;
  const hitlResolution = email.generation_metadata?.hitl_resolution;
  const reviewNote = hitlRequest?.review_note ?? hitlResolution?.review_note;
  const resolvedAt = hitlRequest?.resolved_at ?? hitlResolution?.resolved_at;
  const directSendBlocked = Boolean(actionContext?.review_required || actionContext?.guidance?.can_execute === false);

  const saveChanges = async () => {
    if (!toEmail.trim() || !subject.trim() || !bodyText.trim()) {
      toast({ title: 'Missing draft details', description: 'Recipient, subject, and body are required.', variant: 'destructive' });
      return false;
    }
    try {
      await updateDraft.mutateAsync({
        id,
        to_email: toEmail.trim(),
        subject: subject.trim(),
        body_text: bodyText.trim(),
      });
      toast({ title: 'Draft updated' });
      return true;
    } catch (err) {
      toast({ title: 'Could not update draft', description: friendlyErrorMessage(err, 'Try again.'), variant: 'destructive' });
      return false;
    }
  };

  const requestReview = async () => {
    if (dirty && !(await saveChanges())) return;
    try {
      await requestApproval.mutateAsync(id);
      toast({ title: 'Sent for approval', description: 'The draft is now in Handoffs for governed review.' });
    } catch (err) {
      toast({ title: 'Could not request approval', description: friendlyErrorMessage(err, 'Try again.'), variant: 'destructive' });
    }
  };

  const sendDirectly = async () => {
    if (dirty && !(await saveChanges())) return;
    try {
      await sendNow.mutateAsync(id);
      toast({ title: 'Email send started' });
    } catch (err) {
      toast({ title: 'Could not send email', description: friendlyErrorMessage(err, 'Check email settings or send for approval.'), variant: 'destructive' });
    }
  };

  const retryDraftPush = async () => {
    try {
      await retryProviderDraft.mutateAsync(id);
      toast({ title: 'Provider draft retry started', description: 'CRMy refreshed the provider draft status for this email.' });
    } catch (err) {
      toast({ title: 'Could not create provider draft', description: friendlyErrorMessage(err, 'Save as a CRMy draft or reauthorize the mailbox.'), variant: 'destructive' });
    }
  };

  const repairDelivery = async (action: 'retry' | 'mark_sent' | 'mark_failed') => {
    const note = action === 'mark_sent'
      ? window.prompt('Optional note: where did you confirm this email was sent?') ?? undefined
      : action === 'mark_failed'
      ? window.prompt('Optional note: why should this be marked failed?') ?? undefined
      : undefined;
    try {
      await resolveDelivery.mutateAsync({ id, action, note });
      toast({
        title: action === 'retry' ? 'Delivery retry queued' : action === 'mark_sent' ? 'Email marked sent' : 'Email marked failed',
        description: action === 'retry' ? 'Reliability will pick this up on the next background worker tick.' : undefined,
      });
    } catch (err) {
      toast({ title: 'Could not repair delivery state', description: friendlyErrorMessage(err, 'Try again from Reliability.'), variant: 'destructive' });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
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
        {(email.to || email.to_email) && (
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">To:</span>
            <span className="text-sm text-foreground">{email.to ?? email.to_email}</span>
          </div>
        )}
        {(email.from || email.from_email) && (
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">From:</span>
            <span className="text-sm text-foreground">{email.from ?? email.from_email}</span>
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

      {rejected && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <div className="flex items-start gap-2">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Rejected by reviewer</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Revise this draft in place, then send it for approval again. Direct send is disabled for rejected drafts.
              </p>
              {reviewNote && (
                <p className="mt-2 rounded-md bg-background/60 px-2 py-1.5 text-xs text-foreground">
                  {reviewNote}
                </p>
              )}
              {resolvedAt && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Rejected {format(new Date(resolvedAt), 'PPp')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {email.provider_draft_status === 'failed' && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Provider draft was not created</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The CRMy draft is still saved. Retry pushing it to Gmail or Outlook after checking mailbox authorization.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={retryDraftPush} disabled={actionPending}>
              {retryProviderDraft.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Retry
            </Button>
          </div>
        </div>
      )}

      {email.status === 'delivery_uncertain' && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Delivery needs confirmation</p>
              <p className="mt-1 text-xs text-muted-foreground">
                CRMy started provider delivery but could not confirm the final state. Check the mailbox or provider before retrying.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => repairDelivery('retry')} disabled={actionPending}>
                  Retry delivery
                </Button>
                <Button size="sm" variant="outline" onClick={() => repairDelivery('mark_sent')} disabled={actionPending}>
                  Mark sent
                </Button>
                <Button size="sm" variant="outline" onClick={() => repairDelivery('mark_failed')} disabled={actionPending}>
                  Mark failed
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="border-t border-border pt-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          {editable ? 'Draft' : 'Body'}
        </p>
        {editable ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Recipient</label>
              <Input value={toEmail} onChange={event => setToEmail(event.target.value)} placeholder="customer@example.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Subject</label>
              <Input value={subject} onChange={event => setSubject(event.target.value)} placeholder="Subject" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Body</label>
              <Textarea value={bodyText} onChange={event => setBodyText(event.target.value)} className="min-h-[260px]" />
            </div>
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-foreground bg-muted/30 p-3 rounded-lg">
              {email.body ?? email.body_text ?? email.body_html ?? '(empty body)'}
            </pre>
          </div>
        )}
      </div>
      </div>

      <div className="border-t border-border p-4">
        {email.status === 'pending_approval' && email.hitl_request_id ? (
          <p className="text-xs text-muted-foreground">
            This draft is waiting for governed review in Handoffs.
          </p>
        ) : editable ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={saveChanges} disabled={!dirty || actionPending}>
              {updateDraft.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save changes
            </Button>
            <Button variant="outline" onClick={requestReview} disabled={actionPending}>
              {requestApproval.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {rejected ? 'Send revised draft for approval' : 'Send for approval'}
            </Button>
            {!rejected && (
              <Button
                onClick={sendDirectly}
                disabled={actionPending || directSendBlocked}
                title={directSendBlocked ? 'Action Context requires approval before this email can be sent.' : undefined}
                className="bg-blue-600 text-white hover:bg-blue-500"
              >
                {sendNow.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                Send now
              </Button>
            )}
            {directSendBlocked && (
              <p className="basis-full text-right text-xs text-muted-foreground">
                Action Context requires approval before sending this draft.
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No draft actions are available for emails with status {cfg.label.toLowerCase()}.
          </p>
        )}
      </div>
    </div>
  );
}
