// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Loader2, Send, Sparkles, X } from 'lucide-react';
import { useContact, usePreviewEmailDraft, useSaveEmailDraft } from '@/api/hooks';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { useAppStore, type EmailDraftContext } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { EntityCombobox, type EntityType } from '@/components/ui/entity-combobox';
import { toast } from '@/hooks/use-toast';

type DraftIntent = 'reply' | 'follow_up' | 'recap_next_steps' | 'nudge_stalled_deal' | 'custom';

const INTENTS: Array<{ value: DraftIntent; label: string; description: string }> = [
  { value: 'reply', label: 'Reply', description: 'Respond to the selected customer email.' },
  { value: 'follow_up', label: 'Follow up', description: 'Send a useful next-step note.' },
  { value: 'recap_next_steps', label: 'Recap next steps', description: 'Summarize decisions and actions.' },
  { value: 'nudge_stalled_deal', label: 'Nudge stalled deal', description: 'Restart momentum with context.' },
  { value: 'custom', label: 'Custom', description: 'Use your instruction.' },
];

function normalizeContext(ctx: EmailDraftContext | null): EmailDraftContext {
  if (!ctx) return {};
  return {
    ...ctx,
    subject_type: ctx.subject_type === 'use-case' ? 'use_case' : ctx.subject_type,
  };
}

function subjectEntityType(subjectType?: string): EntityType {
  if (subjectType === 'opportunity') return 'opportunity';
  if (subjectType === 'use_case' || subjectType === 'use-case') return 'use_case';
  if (subjectType === 'contact') return 'contact';
  return 'account';
}

export function EmailDraftDrawer() {
  const { emailDraftOpen, emailDraftContext, closeEmailDraft } = useAppStore();
  const context = useMemo(() => normalizeContext(emailDraftContext), [emailDraftContext]);
  const { enabled: agentEnabled, connectivity } = useAgentSettings();
  const previewDraft = usePreviewEmailDraft();
  const saveDraft = useSaveEmailDraft();

  const [toAddress, setToAddress] = useState('');
  const [toName, setToName] = useState('');
  const [contactId, setContactId] = useState('');
  const [subjectType, setSubjectType] = useState<'account' | 'contact' | 'opportunity' | 'use_case'>('contact');
  const [subjectId, setSubjectId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [useCaseId, setUseCaseId] = useState('');
  const [intent, setIntent] = useState<DraftIntent>('follow_up');
  const [instruction, setInstruction] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [generated, setGenerated] = useState(false);
  const [generationMetadata, setGenerationMetadata] = useState<Record<string, unknown>>({});
  const [contextUsed, setContextUsed] = useState<Record<string, unknown> | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const { data: contactData } = useContact(contactId) as any;
  const contact = contactData?.contact ?? contactData;
  const agentReady = agentEnabled && connectivity !== 'offline';

  useEffect(() => {
    if (!emailDraftOpen) return;
    setToAddress(context.to_address ?? '');
    setToName(context.to_name ?? '');
    setContactId(context.contact_id ?? (context.subject_type === 'contact' ? context.subject_id ?? '' : ''));
    setAccountId(context.account_id ?? (context.subject_type === 'account' ? context.subject_id ?? '' : ''));
    setOpportunityId(context.opportunity_id ?? (context.subject_type === 'opportunity' ? context.subject_id ?? '' : ''));
    setUseCaseId(context.use_case_id ?? (context.subject_type === 'use_case' ? context.subject_id ?? '' : ''));
    setSubjectType((context.subject_type as 'account' | 'contact' | 'opportunity' | 'use_case' | undefined) ?? (context.contact_id ? 'contact' : 'account'));
    setSubjectId(context.subject_id ?? context.contact_id ?? context.account_id ?? context.opportunity_id ?? context.use_case_id ?? '');
    setIntent(context.intent ?? (context.source_email_message_id ? 'reply' : 'follow_up'));
    setInstruction('');
    setSubject('');
    setBody('');
    setGenerated(false);
    setGenerationMetadata({});
    setContextUsed(null);
    setWarnings([]);
  }, [emailDraftOpen, context]);

  useEffect(() => {
    if (!contact || !contactId) return;
    if (!toAddress && contact.email) setToAddress(contact.email);
    if (!toName) {
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
      if (name) setToName(name);
    }
    if (!accountId && contact.account_id) setAccountId(contact.account_id);
  }, [contact, contactId, toAddress, toName, accountId]);

  if (!emailDraftOpen) return null;

  const linkedPayload = {
    source_email_message_id: context.source_email_message_id,
    subject_type: subjectId ? subjectType : undefined,
    subject_id: subjectId || undefined,
    contact_id: contactId || undefined,
    account_id: accountId || undefined,
    opportunity_id: opportunityId || undefined,
    use_case_id: useCaseId || undefined,
    to_address: toAddress || undefined,
    to_name: toName || undefined,
  };

  const generate = async () => {
    try {
      const result = await previewDraft.mutateAsync({
        ...linkedPayload,
        intent,
        instruction,
        tone: 'concise, helpful, and specific',
        target: 'crmy',
      });
      setSubject(result.subject);
      setBody(result.body_text);
      setGenerated(true);
      setGenerationMetadata(result.model_metadata ?? {});
      setContextUsed(result.context_used ?? null);
      setWarnings(result.warnings ?? []);
      toast({ title: 'Draft generated', description: 'Review and edit before saving or sending.' });
    } catch (err) {
      toast({
        title: 'Could not generate draft',
        description: err instanceof Error ? err.message : 'Check Workspace Agent settings and try again.',
        variant: 'destructive',
      });
    }
  };

  const save = async (deliveryAction: 'save_draft' | 'request_approval' | 'send_now') => {
    if (!toAddress.trim() || !subject.trim() || !body.trim()) {
      toast({ title: 'Missing details', description: 'Recipient, subject, and body are required.', variant: 'destructive' });
      return;
    }
    try {
      await saveDraft.mutateAsync({
        ...linkedPayload,
        to_address: toAddress.trim(),
        to_name: toName.trim() || undefined,
        subject: subject.trim(),
        body_text: body.trim(),
        draft_origin: generated ? 'agent_generated' : 'manual',
        draft_target: 'crmy',
        delivery_action: deliveryAction,
        generation_metadata: {
          ...generationMetadata,
          context_used: contextUsed,
          warnings,
          instruction,
          intent,
        },
      });
      toast({
        title: deliveryAction === 'request_approval' ? 'Sent for approval' : deliveryAction === 'send_now' ? 'Sending email' : 'Draft saved',
        description: deliveryAction === 'save_draft' ? 'Find it in Drafts & Approvals.' : undefined,
      });
      closeEmailDraft();
    } catch (err) {
      toast({
        title: 'Could not save draft',
        description: err instanceof Error ? err.message : 'Check the recipient and email settings.',
        variant: 'destructive',
      });
    }
  };

  const providerDraftReason = 'Provider draft folders need Gmail/Outlook draft-write support. Save a CRMy draft or send for approval for now.';

  return (
    <div className="fixed inset-y-0 right-0 z-[70] w-full max-w-2xl border-l border-border bg-background shadow-2xl">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer response</p>
            <h2 className="mt-1 text-lg font-display font-bold text-foreground">Draft follow-up</h2>
            <p className="mt-1 text-sm text-muted-foreground">Use Memory, Signals, and customer email context to prepare a first draft.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={closeEmailDraft}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <section className="rounded-xl border border-border bg-card/70 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contact</label>
                <EntityCombobox
                  entityType="contact"
                  value={contactId}
                  onChange={setContactId}
                  placeholder="Select recipient contact"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recipient email</label>
                <Input value={toAddress} onChange={event => setToAddress(event.target.value)} placeholder="customer@example.com" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recipient name</label>
                <Input value={toName} onChange={event => setToName(event.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Primary record</label>
                <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-2">
                  <select
                    value={subjectType}
                    onChange={event => {
                      const next = event.target.value as 'account' | 'contact' | 'opportunity' | 'use_case';
                      setSubjectType(next);
                      setSubjectId('');
                    }}
                    className="h-10 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                  >
                    <option value="contact">Contact</option>
                    <option value="account">Account</option>
                    <option value="opportunity">Opportunity</option>
                    <option value="use_case">Use Case</option>
                  </select>
                  <EntityCombobox
                    entityType={subjectEntityType(subjectType)}
                    value={subjectId}
                    onChange={(id) => {
                      setSubjectId(id);
                      if (subjectType === 'account') setAccountId(id);
                      if (subjectType === 'contact') setContactId(id);
                      if (subjectType === 'opportunity') setOpportunityId(id);
                      if (subjectType === 'use_case') setUseCaseId(id);
                    }}
                    placeholder="Select record"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="mt-4 rounded-xl border border-border bg-card/70 p-4">
            <div className="flex flex-wrap gap-2">
              {INTENTS.map(item => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setIntent(item.value)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    intent === item.value ? 'border-blue-500/40 bg-blue-500/10 text-blue-100' : 'border-border bg-background/40 text-foreground hover:bg-muted/40'
                  }`}
                  title={item.description}
                >
                  <span className="text-sm font-semibold">{item.label}</span>
                </button>
              ))}
            </div>
            <Textarea
              value={instruction}
              onChange={event => setInstruction(event.target.value)}
              placeholder="Optional instruction for the Workspace Agent..."
              className="mt-3 min-h-[82px]"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Bot className="h-3.5 w-3.5 text-purple-300" />
                {agentReady ? 'Workspace Agent ready' : agentEnabled ? 'Workspace Agent unreachable' : 'Workspace Agent not enabled'}
              </div>
              <Button
                onClick={generate}
                disabled={!agentReady || previewDraft.isPending}
                className="gap-1.5 bg-purple-600 text-white hover:bg-purple-500"
              >
                {previewDraft.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Generate draft
              </Button>
            </div>
            {!agentReady && (
              <p className="mt-2 text-xs text-muted-foreground">
                Manual drafting is still available. Ask an admin to enable Workspace Agent for generated first drafts.
              </p>
            )}
          </section>

          <section className="mt-4 rounded-xl border border-border bg-card/70 p-4">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Subject</label>
                <Input value={subject} onChange={event => setSubject(event.target.value)} placeholder="Follow-up subject" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Body</label>
                <Textarea value={body} onChange={event => setBody(event.target.value)} placeholder="Write or generate the follow-up..." className="min-h-[220px]" />
              </div>
            </div>
            {(generated || warnings.length > 0 || contextUsed) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {generated && (
                  <Badge variant="outline" className="border-purple-500/25 bg-purple-500/10 text-purple-200">
                    <Sparkles className="mr-1 h-3 w-3" /> Agent generated
                  </Badge>
                )}
                {contextUsed && (
                  <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/10 text-emerald-200">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    {Number(contextUsed.memory_count ?? 0)} Memory · {Number(contextUsed.signal_count ?? 0)} Signals
                  </Badge>
                )}
                {warnings.map(warning => (
                  <Badge key={warning} variant="outline" className="border-amber-500/25 bg-amber-500/10 text-amber-200">
                    {warning}
                  </Badge>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-border px-5 py-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={closeEmailDraft}>Cancel</Button>
            <Button variant="outline" disabled title={providerDraftReason}>
              Push to provider draft
            </Button>
            <Button variant="outline" onClick={() => save('save_draft')} disabled={saveDraft.isPending}>
              Save draft
            </Button>
            <Button onClick={() => save('request_approval')} disabled={saveDraft.isPending} className="gap-1.5 bg-blue-600 text-white hover:bg-blue-500">
              {saveDraft.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Send for approval
            </Button>
            <Button variant="outline" onClick={() => save('send_now')} disabled={saveDraft.isPending} className="gap-1.5">
              <Send className="h-3.5 w-3.5" /> Send now
            </Button>
          </div>
        </div>
      </div>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-black/20" />
    </div>
  );
}
