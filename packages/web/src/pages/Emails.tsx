// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { CompactList } from '@/components/crm/CompactList';
import { ListToolbar, type FilterConfig } from '@/components/crm/ListToolbar';
import {
  useEmails,
  useEmailMessage,
  useEmailMessages,
  useEmailSubjectSummary,
  useIgnoreEmailMessage,
  useMailboxConnections,
  useProcessEmailMessage,
  useStartMailboxConnection,
  useSyncMailboxConnection,
  useUpdateEmailMessage,
  useUpdateEmailMessageClassification,
} from '@/api/hooks';
import { EntityCombobox, type EntityType } from '@/components/ui/entity-combobox';
import { useAppStore } from '@/store/appStore';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock,
  FileEdit,
  Inbox,
  Loader2,
  Mail,
  MailCheck,
  MailPlus,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  X,
  XCircle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { STATUS_TONES } from '@/lib/entityColors';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';

type CustomerEmailTab = 'customer' | 'review' | 'outbound' | 'connections';
type MailboxProvider = 'google' | 'microsoft' | 'webhook';
type OutboundFilter = 'attention' | 'drafts' | 'approvals' | 'sent_failed';

type EmailMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  from_email: string;
  from_name?: string | null;
  to_emails?: string[];
  subject?: string;
  body_text?: string | null;
  snippet?: string | null;
  classification: 'customer' | 'mixed' | 'internal' | 'automated' | 'unknown';
  processing_status: 'unprocessed' | 'processing' | 'processed' | 'needs_review' | 'skipped' | 'failed' | 'ignored';
  processing_reason?: string | null;
  email_id?: string | null;
  email_status?: string | null;
  draft_origin?: string | null;
  hitl_request_id?: string | null;
  provider_draft_status?: string | null;
  contact_id?: string | null;
  contact_name?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  opportunity_id?: string | null;
  opportunity_name?: string | null;
  use_case_id?: string | null;
  use_case_name?: string | null;
  activity_id?: string | null;
  raw_context_source_id?: string | null;
  extraction_receipt?: Record<string, unknown>;
  received_at?: string | null;
  sent_at?: string | null;
  created_at: string;
};

type Connection = {
  id: string;
  provider: MailboxProvider;
  email_address: string;
  display_name?: string | null;
  status: string;
  last_sync_at?: string | null;
  last_error?: string | null;
  sync_stats?: Record<string, number>;
};

const MAILBOX_PROVIDER_COPY: Record<MailboxProvider, {
  label: string;
  title: string;
  description: string;
  credentialLabel: string;
  callbackPath?: string;
}> = {
  google: {
    label: 'Gmail',
    title: 'Set up Gmail',
    description: 'Capture customer replies from Google Workspace mailboxes and process them as Raw Context.',
    credentialLabel: 'Google Cloud OAuth app',
    callbackPath: '/api/v1/mailbox/oauth/google/callback',
  },
  microsoft: {
    label: 'Outlook',
    title: 'Set up Outlook',
    description: 'Sync customer communication from Microsoft 365 and connect it to revenue records.',
    credentialLabel: 'Microsoft Entra OAuth app',
    callbackPath: '/api/v1/mailbox/oauth/microsoft/callback',
  },
  webhook: {
    label: 'Inbound webhook',
    title: 'Set up inbound webhook',
    description: 'Use SendGrid, Postmark, Mailgun, or another provider to post inbound customer email to CRMy.',
    credentialLabel: 'Inbound parse provider',
  },
};

const TABS: Array<{ key: CustomerEmailTab; label: string; icon: typeof Mail }> = [
  { key: 'customer', label: 'Customer Inbox', icon: Inbox },
  { key: 'review', label: 'Needs Review', icon: AlertCircle },
  { key: 'outbound', label: 'Drafts & Approvals', icon: Send },
  { key: 'connections', label: 'Connections', icon: SlidersHorizontal },
];

const CLASSIFICATION: Record<string, { label: string; className: string }> = {
  customer: { label: 'Customer', className: 'bg-blue-500/12 text-blue-300 border-blue-500/25' },
  mixed: { label: 'Mixed', className: 'bg-purple-500/12 text-purple-300 border-purple-500/25' },
  internal: { label: 'Internal', className: STATUS_TONES.muted },
  automated: { label: 'Automated', className: STATUS_TONES.muted },
  unknown: { label: 'Unknown', className: STATUS_TONES.warning },
};

const PROCESSING: Record<string, { label: string; className: string; icon: typeof Clock }> = {
  unprocessed: { label: 'Ready to process', className: STATUS_TONES.info, icon: Clock },
  processing: { label: 'Processing', className: STATUS_TONES.info, icon: Loader2 },
  processed: { label: 'Processed', className: STATUS_TONES.success, icon: CheckCircle2 },
  needs_review: { label: 'Needs review', className: STATUS_TONES.warning, icon: AlertCircle },
  skipped: { label: 'Skipped', className: STATUS_TONES.muted, icon: XCircle },
  failed: { label: 'Failed', className: STATUS_TONES.destructive, icon: AlertCircle },
  ignored: { label: 'Ignored', className: STATUS_TONES.muted, icon: XCircle },
};

const OUTBOUND_STATUS: Record<string, { label: string; className: string; icon: typeof Mail }> = {
  draft: { label: 'Draft', className: STATUS_TONES.muted, icon: FileEdit },
  pending_approval: { label: 'Pending approval', className: STATUS_TONES.warning, icon: Clock },
  approved: { label: 'Approved', className: STATUS_TONES.success, icon: CheckCircle2 },
  sending: { label: 'Sending', className: STATUS_TONES.info, icon: Send },
  sent: { label: 'Sent', className: STATUS_TONES.success, icon: CheckCircle2 },
  failed: { label: 'Failed', className: STATUS_TONES.destructive, icon: AlertCircle },
  rejected: { label: 'Rejected', className: STATUS_TONES.destructive, icon: XCircle },
};

function ts(message: EmailMessage): string {
  return message.received_at ?? message.sent_at ?? message.created_at;
}

function countFromReceipt(receipt: Record<string, unknown> | undefined, key: string): number {
  const raw = receipt?.[key];
  return typeof raw === 'number' ? raw : Number(raw ?? 0) || 0;
}

function RecordChip({
  type,
  id,
  name,
}: {
  type: 'account' | 'contact' | 'opportunity' | 'use_case';
  id?: string | null;
  name?: string | null;
}) {
  const { openDrawer } = useAppStore();
  if (!id || !name) return null;
  const label = type === 'use_case' ? 'Use Case' : type.charAt(0).toUpperCase() + type.slice(1);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        openDrawer(type === 'use_case' ? 'use-case' : type, id);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-xs text-foreground hover:bg-muted"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[180px] truncate font-semibold">{name}</span>
    </button>
  );
}

function MessageRow({ message, onOpen }: { message: EmailMessage; onOpen: (message: EmailMessage) => void }) {
  const processing = PROCESSING[message.processing_status] ?? PROCESSING.unprocessed;
  const ProcessingIcon = processing.icon;
  const outboundStatus = message.email_status ? OUTBOUND_STATUS[message.email_status] : null;
  const OutboundIcon = outboundStatus?.icon;
  const from = message.from_name ? `${message.from_name} <${message.from_email}>` : message.from_email;
  const memory = countFromReceipt(message.extraction_receipt, 'memory_created');
  const signals = countFromReceipt(message.extraction_receipt, 'signals_created');

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onOpen(message)}
      className="w-full rounded-xl border border-border/70 bg-card/60 px-3 py-3 text-left transition-colors hover:bg-muted/35"
    >
      <div className="flex items-start gap-3">
        {message.direction === 'inbound' ? (
          <ArrowDownLeft className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
        ) : (
          <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{message.subject || '(no subject)'}</span>
            <Badge variant="outline" className={CLASSIFICATION[message.classification]?.className}>
              {CLASSIFICATION[message.classification]?.label ?? message.classification}
            </Badge>
            <Badge variant="outline" className={processing.className}>
              <ProcessingIcon className={`mr-1 h-3 w-3 ${message.processing_status === 'processing' ? 'animate-spin' : ''}`} />
              {processing.label}
            </Badge>
            {outboundStatus && OutboundIcon && (
              <Badge variant="outline" className={outboundStatus.className}>
                <OutboundIcon className="mr-1 h-3 w-3" />
                {outboundStatus.label}
              </Badge>
            )}
            {message.draft_origin === 'agent_generated' && (
              <Badge variant="outline" className="border-purple-500/25 bg-purple-500/10 text-purple-200">Agent generated</Badge>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{from}</p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{message.snippet || message.body_text || 'No preview available.'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <RecordChip type="account" id={message.account_id} name={message.account_name} />
            <RecordChip type="opportunity" id={message.opportunity_id} name={message.opportunity_name} />
            <RecordChip type="use_case" id={message.use_case_id} name={message.use_case_name} />
            <RecordChip type="contact" id={message.contact_id} name={message.contact_name} />
            {!message.account_id && !message.contact_id && !message.opportunity_id && !message.use_case_id && (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">No linked record</span>
            )}
            {(signals > 0 || memory > 0) && (
              <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-300">
                {signals} Signals · {memory} Memory
              </span>
            )}
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{formatDistanceToNow(new Date(ts(message)), { addSuffix: true })}</span>
      </div>
    </motion.button>
  );
}

function ConnectionCard({
  connection,
  onSync,
  onSetup,
}: {
  connection: Connection;
  onSync: (id: string) => void;
  onSetup: (provider: MailboxProvider, connection?: Connection) => void;
}) {
  const connected = connection.status === 'connected';
  const provider = MAILBOX_PROVIDER_COPY[connection.provider];
  const statusLabel = connected ? 'Connected' : connection.status === 'error' ? 'Sync needs attention' : 'Needs OAuth setup';
  const statusTone = connected ? STATUS_TONES.success : connection.status === 'error' ? STATUS_TONES.destructive : STATUS_TONES.warning;
  return (
    <div className="rounded-xl border border-border bg-card/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MailCheck className={`h-4 w-4 ${connected ? 'text-emerald-400' : 'text-muted-foreground'}`} />
            <h3 className="text-sm font-semibold text-foreground">{provider.label}</h3>
            <Badge variant="outline" className={statusTone}>
              {statusLabel}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{connection.email_address}</p>
        </div>
        {connected ? (
          <Button variant="outline" size="sm" onClick={() => onSync(connection.id)} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Sync
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => onSetup(connection.provider, connection)} className="gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Setup guide
          </Button>
        )}
      </div>
      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        {connection.sync_stats && Object.keys(connection.sync_stats).length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <span className="rounded-md border border-blue-500/20 bg-blue-500/8 px-2 py-0.5 text-blue-200">
              {connection.sync_stats.customer_synced ?? 0} customer synced
            </span>
            <span className="rounded-md border border-border bg-muted/20 px-2 py-0.5">
              {connection.sync_stats.filtered_internal ?? 0} internal skipped
            </span>
            <span className="rounded-md border border-border bg-muted/20 px-2 py-0.5">
              {(connection.sync_stats.filtered_spam_trash ?? 0) + (connection.sync_stats.filtered_automated ?? 0)} noise skipped
            </span>
          </div>
        )}
        {!connected && (
          <p>
            Live sync is waiting for provider setup. The guide shows the mailbox, customer filtering, and OAuth steps needed before CRMy can poll this inbox.
          </p>
        )}
        {connection.last_sync_at
          ? <p>{`Last sync ${formatDistanceToNow(new Date(connection.last_sync_at), { addSuffix: true })}`}</p>
          : <p>{connection.last_error || 'OAuth credentials are required before live mailbox sync can run.'}</p>}
      </div>
    </div>
  );
}

function MailboxSetupStep({
  active,
  index,
  label,
}: {
  active: boolean;
  index: number;
  label: string;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${
      active ? 'border-blue-500/35 bg-blue-500/10 text-blue-200' : 'border-border bg-muted/20 text-muted-foreground'
    }`}
    >
      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
        active ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'
      }`}
      >
        {index + 1}
      </span>
      {label}
    </div>
  );
}

function MessageDetail({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { openEmailDraft } = useAppStore();
  const { data, isLoading } = useEmailMessage(id);
  const processMessage = useProcessEmailMessage();
  const updateClassification = useUpdateEmailMessageClassification();
  const updateMessage = useUpdateEmailMessage();
  const ignoreMessage = useIgnoreEmailMessage();
  const [linkType, setLinkType] = useState<EntityType>('account');
  const [linkId, setLinkId] = useState('');
  const message = ((data as any)?.email_message ?? null) as EmailMessage | null;
  const hasLinkedRecord = Boolean(message?.account_id || message?.contact_id || message?.opportunity_id || message?.use_case_id);

  if (!id) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl border-l border-border bg-background shadow-2xl">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer Email</p>
            <h2 className="mt-1 truncate text-lg font-display font-bold text-foreground">
              {message?.subject ?? 'Loading email...'}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {isLoading || !message ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading email...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={CLASSIFICATION[message.classification]?.className}>
                {CLASSIFICATION[message.classification]?.label}
              </Badge>
              <Badge variant="outline" className={PROCESSING[message.processing_status]?.className}>
                {PROCESSING[message.processing_status]?.label}
              </Badge>
              <span className="text-xs text-muted-foreground">{new Date(ts(message)).toLocaleString()}</span>
            </div>

            <section className="mt-5 rounded-xl border border-border bg-card/70 p-4">
              <h3 className="text-sm font-semibold text-foreground">Linked customer context</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <RecordChip type="account" id={message.account_id} name={message.account_name} />
                <RecordChip type="opportunity" id={message.opportunity_id} name={message.opportunity_name} />
                <RecordChip type="use_case" id={message.use_case_id} name={message.use_case_name} />
                <RecordChip type="contact" id={message.contact_id} name={message.contact_name} />
                {!hasLinkedRecord && (
                  <span className="text-sm text-muted-foreground">No linked record yet. Keep this in Needs Review until the customer record is known.</span>
                )}
              </div>
              {message.processing_reason && (
                <p className="mt-3 text-sm text-muted-foreground">{message.processing_reason}</p>
              )}
              {!hasLinkedRecord && (
                <div className="mt-4 rounded-lg border border-dashed border-border bg-background/35 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Link and process</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Choose the safest customer record, then CRMy will process this email as Raw Context.
                  </p>
                  <div className="mt-3 grid gap-2 md:grid-cols-[150px,1fr,auto]">
                    <select
                      value={linkType}
                      onChange={event => {
                        setLinkType(event.target.value as EntityType);
                        setLinkId('');
                      }}
                      className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                    >
                      <option value="account">Account</option>
                      <option value="contact">Contact</option>
                      <option value="opportunity">Opportunity</option>
                      <option value="use_case">Use Case</option>
                    </select>
                    <EntityCombobox
                      entityType={linkType}
                      value={linkId}
                      onChange={setLinkId}
                      placeholder={`Search ${linkType.replace('_', ' ')}`}
                    />
                    <Button
                      disabled={!linkId || updateMessage.isPending}
                      onClick={() => {
                        const payload: Record<string, unknown> = {
                          id: message.id,
                          classification: message.classification === 'unknown' ? 'customer' : message.classification,
                          process: true,
                        };
                        payload[`${linkType}_id`] = linkId;
                        updateMessage.mutate(payload as { id: string } & Record<string, unknown>, {
                          onSuccess: () => toast({ title: 'Email linked', description: 'CRMy linked the customer record and processed the email.' }),
                          onError: (err) => toast({ title: 'Could not link email', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' }),
                        });
                      }}
                      className="bg-blue-600 text-white hover:bg-blue-500"
                    >
                      {updateMessage.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Link
                    </Button>
                  </div>
                </div>
              )}
            </section>

            <section className="mt-4 rounded-xl border border-border bg-card/70 p-4">
              <h3 className="text-sm font-semibold text-foreground">Processing receipt</h3>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-border bg-background/50 p-3">
                  <p className="text-xs text-muted-foreground">Signals</p>
                  <p className="mt-1 text-xl font-bold text-purple-300">{countFromReceipt(message.extraction_receipt, 'signals_created')}</p>
                </div>
                <div className="rounded-lg border border-border bg-background/50 p-3">
                  <p className="text-xs text-muted-foreground">Memory</p>
                  <p className="mt-1 text-xl font-bold text-emerald-300">{countFromReceipt(message.extraction_receipt, 'memory_created')}</p>
                </div>
                <div className="rounded-lg border border-border bg-background/50 p-3">
                  <p className="text-xs text-muted-foreground">Skipped</p>
                  <p className="mt-1 text-xl font-bold text-muted-foreground">{countFromReceipt(message.extraction_receipt, 'skipped')}</p>
                </div>
              </div>
            </section>

            <section className="mt-4 rounded-xl border border-border bg-card/70 p-4">
              <div className="grid gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">From </span>
                  <span className="text-foreground">{message.from_name ? `${message.from_name} <${message.from_email}>` : message.from_email}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">To </span>
                  <span className="text-foreground">{(message.to_emails ?? []).join(', ') || 'Unknown'}</span>
                </div>
              </div>
              <pre className="mt-4 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/25 p-3 font-sans text-sm leading-relaxed text-foreground">
                {message.body_text || message.snippet || '(empty body)'}
              </pre>
            </section>
          </div>
        )}

        {message && (
          <div className="border-t border-border px-5 py-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" onClick={() => updateClassification.mutate({ id: message.id, classification: 'internal' })}>
                Mark internal
              </Button>
              <Button variant="outline" onClick={() => ignoreMessage.mutate({ id: message.id, reason: 'Ignored from Customer Email.' })}>
                Ignore
              </Button>
              <Button variant="outline" onClick={() => navigate('/app/context?tab=signals')}>
                Review Signals
              </Button>
              <Button
                onClick={() => openEmailDraft({
                  source_email_message_id: message.id,
                  to_address: message.from_email,
                  to_name: message.from_name ?? undefined,
                  contact_id: message.contact_id ?? undefined,
                  account_id: message.account_id ?? undefined,
                  opportunity_id: message.opportunity_id ?? undefined,
                  use_case_id: message.use_case_id ?? undefined,
                  subject_type: message.opportunity_id ? 'opportunity' : message.use_case_id ? 'use_case' : message.contact_id ? 'contact' : message.account_id ? 'account' : undefined,
                  subject_id: message.opportunity_id ?? message.use_case_id ?? message.contact_id ?? message.account_id ?? undefined,
                  intent: 'reply',
                })}
                className="gap-1.5 bg-blue-600 text-white hover:bg-blue-500"
              >
                <MailPlus className="h-3.5 w-3.5" /> Draft reply
              </Button>
              <Button variant="outline" onClick={() => navigate('/app/agent')}>
                <Bot className="mr-1.5 h-3.5 w-3.5 text-purple-300" /> Ask Agent
              </Button>
              <Button
                onClick={() => processMessage.mutate(message.id, {
                  onSuccess: () => toast({ title: 'Email processed', description: 'CRMy processed this email as Raw Context.' }),
                  onError: (err) => toast({ title: 'Could not process email', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' }),
                })}
                disabled={processMessage.isPending}
                className="gap-1.5 bg-blue-600 text-white hover:bg-blue-500"
              >
                {processMessage.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Process as Raw Context
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EmailsPage() {
  const { openDrawer, openEmailDraft } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState<CustomerEmailTab>('customer');
  const [q, setQ] = useState('');
  const [classification, setClassification] = useState('');
  const [outboundFilter, setOutboundFilter] = useState<OutboundFilter>('attention');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [setupProvider, setSetupProvider] = useState<MailboxProvider | null>(null);
  const [setupStep, setSetupStep] = useState(0);
  const [setupEmail, setSetupEmail] = useState('');
  const [setupDisplayName, setSetupDisplayName] = useState('');

  const scopedParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const tabParam = scopedParams.get('tab') as CustomerEmailTab | null;
  const scopedContactId = scopedParams.get('contact_id') || undefined;
  const scopedAccountId = scopedParams.get('account_id') || undefined;
  const scopedLabel = scopedParams.get('scope_label') || undefined;
  const scopedSubjectType: 'contact' | 'account' = scopedAccountId ? 'account' : 'contact';
  const scopedSubjectId = scopedAccountId ?? scopedContactId;
  const scoped = Boolean(scopedSubjectId);

  useEffect(() => {
    if (scoped) return;
    if (tabParam && TABS.some(item => item.key === tabParam)) {
      setTab(tabParam);
    }
  }, [scoped, tabParam]);
  const scopedSummaryQ = useEmailSubjectSummary(scopedSubjectType, scopedSubjectId ? [scopedSubjectId] : []);
  const scopedSummary = ((scopedSummaryQ.data as any)?.data ?? [])[0] as { total?: number; inbound?: number; outbound?: number; drafts?: number; pending_approvals?: number; needs_review?: number } | undefined;

  const messageView = scoped ? 'all' : tab === 'review' ? 'review' : tab === 'customer' ? 'customer' : 'all';
  const messagesQ = useEmailMessages({
    view: messageView,
    q,
    classification: classification || undefined,
    direction: scoped ? undefined : tab === 'outbound' ? 'outbound' : tab === 'customer' || tab === 'review' ? 'inbound' : undefined,
    contact_id: scopedContactId,
    account_id: scopedAccountId,
    include_internal: !scoped && (tab === 'review' || classification === 'internal' || classification === 'automated'),
    limit: 100,
  }) as any;
  const messages: EmailMessage[] = messagesQ.data?.data ?? [];
  const summary = messagesQ.data?.summary ?? {};

  const outboundQ = useEmails({ limit: 500 }) as any;
  const outboundEmails: any[] = outboundQ.data?.data ?? [];
  const connectionsQ = useMailboxConnections() as any;
  const connections: Connection[] = connectionsQ.data?.data ?? [];
  const mailboxConnected = connections.some(connection => connection.status === 'connected');
  const startGoogle = useStartMailboxConnection('google');
  const startMicrosoft = useStartMailboxConnection('microsoft');
  const syncConnection = useSyncMailboxConnection();
  const setupCopy = setupProvider ? MAILBOX_PROVIDER_COPY[setupProvider] : null;
  const setupSaving = startGoogle.isPending || startMicrosoft.isPending;
  const emailFilterConfigs: FilterConfig[] = !scoped && (tab === 'outbound' || tab === 'connections') ? [] : [
    {
      key: 'classification',
      label: 'Type',
      options: [
        { value: 'customer', label: 'Customer' },
        { value: 'mixed', label: 'Mixed' },
        { value: 'unknown', label: 'Unknown' },
        { value: 'internal', label: 'Internal' },
        { value: 'automated', label: 'Automated' },
      ],
    },
  ];
  const emailActiveFilters: Record<string, string[]> = classification ? { classification: [classification] } : {};
  const handleEmailFilterChange = (key: string, values: string[]) => {
    if (key === 'classification') setClassification(values[0] ?? '');
  };

  const filteredOutboundEmails = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const searched = !needle ? outboundEmails : outboundEmails.filter(email => {
      return String(email.subject ?? '').toLowerCase().includes(needle)
        || String(email.to_email ?? '').toLowerCase().includes(needle)
        || String(email.status ?? '').toLowerCase().includes(needle);
    });
    if (outboundFilter === 'drafts') return searched.filter(email => email.status === 'draft');
    if (outboundFilter === 'approvals') return searched.filter(email => email.status === 'pending_approval');
    if (outboundFilter === 'sent_failed') return searched.filter(email => ['sent', 'failed', 'rejected'].includes(email.status));
    return searched.filter(email => ['draft', 'pending_approval', 'failed', 'rejected'].includes(email.status));
  }, [outboundEmails, outboundFilter, q]);
  const outboundAttentionCount = outboundEmails.filter(email => ['draft', 'pending_approval', 'failed', 'rejected'].includes(email.status)).length;

  const visibleMessages = useMemo(() => {
    const list = !scoped && tab === 'outbound'
      ? messages.filter(message => message.direction === 'outbound')
      : messages;
    return list.slice((page - 1) * pageSize, page * pageSize);
  }, [messages, page, pageSize, scoped, tab]);

  const openMessage = (message: EmailMessage) => {
    if (message.direction === 'outbound' && message.email_id) {
      openDrawer('email', message.email_id);
      return;
    }
    setSelectedMessageId(message.id);
  };

  const openSetup = (provider: MailboxProvider, connection?: Connection) => {
    setSetupProvider(provider);
    setSetupStep(0);
    setSetupEmail(connection?.email_address ?? '');
    setSetupDisplayName(connection?.display_name ?? '');
  };

  const closeSetup = () => {
    setSetupProvider(null);
    setSetupStep(0);
    setSetupEmail('');
    setSetupDisplayName('');
  };

  const nextSetupStep = () => {
    if (setupStep === 0 && setupProvider !== 'webhook' && !setupEmail.trim().includes('@')) {
      toast({ title: 'Mailbox email required', description: 'Enter the Gmail or Outlook mailbox CRMy should watch.', variant: 'destructive' });
      return;
    }
    setSetupStep(step => Math.min(step + 1, 3));
  };

  const saveMailboxSetup = async () => {
    if (!setupProvider || setupProvider === 'webhook') {
      navigate('/app/settings/messaging');
      closeSetup();
      return;
    }
    if (!setupEmail.trim().includes('@')) {
      toast({ title: 'Mailbox email required', description: 'Enter a valid mailbox email before saving setup.', variant: 'destructive' });
      return;
    }
    const payload = {
      email_address: setupEmail.trim().toLowerCase(),
      display_name: setupDisplayName.trim(),
    };
    try {
      const result = setupProvider === 'google'
        ? await startGoogle.mutateAsync(payload) as any
        : await startMicrosoft.mutateAsync(payload) as any;
      if (result?.auth_url) {
        window.location.assign(result.auth_url);
        return;
      }
      toast({
        title: `${MAILBOX_PROVIDER_COPY[setupProvider].label} setup saved`,
        description: 'CRMy saved the mailbox and setup steps. Complete OAuth credentials before live sync runs.',
      });
      closeSetup();
    } catch (err) {
      toast({
        title: 'Could not save mailbox setup',
        description: err instanceof Error ? err.message : 'Check the mailbox address and try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar
        title="Customer Email"
        icon={Mail}
        iconClassName="text-blue-500"
        description="Use customer emails as optional context for customer records, Signals, Memory, and safe follow-up drafts."
      />

      <div className="border-b border-border px-4 pt-4 md:px-6">
        {scoped ? (
          <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/8 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-blue-300" />
                  <p className="text-sm font-semibold text-foreground">
                    Email context{scopedLabel ? ` for ${scopedLabel}` : ''}
                  </p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Linked inbound, outbound, draft, and approval-gated email for this {scopedSubjectType}.
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{scopedSummary?.total ?? messages.length} linked</span>
                  <span>·</span>
                  <span>{scopedSummary?.inbound ?? messages.filter(message => message.direction === 'inbound').length} in</span>
                  <span>·</span>
                  <span>{scopedSummary?.outbound ?? messages.filter(message => message.direction === 'outbound').length} out</span>
                  {(scopedSummary?.drafts ?? 0) > 0 && <span>· {scopedSummary?.drafts} drafts</span>}
                  {(scopedSummary?.pending_approvals ?? 0) > 0 && <span>· {scopedSummary?.pending_approvals} approvals</span>}
                  {(scopedSummary?.needs_review ?? 0) > 0 && <span>· {scopedSummary?.needs_review} need review</span>}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button variant="outline" onClick={() => navigate('/emails?tab=outbound')}>View all drafts</Button>
                <Button variant="outline" onClick={() => navigate('/emails')}>Clear scope</Button>
              </div>
            </div>
          </div>
        ) : (
        <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/8 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-blue-300" />
                <p className="text-sm font-semibold text-foreground">Customer emails can become Signals and Memory</p>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Connect your mailbox when you want customer threads auto matched to customer records and processed into Signal and Memory. This is optional: emails can still feed context and agent memory through{' '}
                <button
                  type="button"
                  onClick={() => navigate('/context?tab=observations&add=context')}
                  className="font-medium text-blue-300 underline-offset-2 hover:underline"
                >
                  Add Context
                </button>
                {' '}or MCP (<code className="font-mono text-xs text-foreground">context_ingest_auto</code>).
              </p>
            </div>
            {!mailboxConnected && (
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={() => navigate('/context?tab=sources')}>View Sources</Button>
                <Button variant="outline" onClick={() => setTab('connections')}>Connect mailbox</Button>
              </div>
            )}
            {mailboxConnected && (
              <Button className="shrink-0" variant="ghost" onClick={() => navigate('/context?tab=sources')}>View Sources</Button>
            )}
          </div>
        </div>
        )}

        {!scoped && (
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map(item => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setTab(item.key);
                  setPage(1);
                  setQ('');
                  setClassification('');
                }}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  active ? 'border-blue-500 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
                {item.key === 'outbound' && outboundAttentionCount > 0 && (
                  <span className="ml-0.5 rounded-full border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-200">
                    {outboundAttentionCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        )}
      </div>

      {scoped || tab !== 'connections' ? (
        <ListToolbar
          searchValue={q}
          onSearchChange={setQ}
          searchPlaceholder={scoped ? 'Search email context...' : 'Search customer emails...'}
          filters={emailFilterConfigs}
          activeFilters={emailActiveFilters}
          onFilterChange={handleEmailFilterChange}
          onClearFilters={() => setClassification('')}
          sortOptions={[]}
          currentSort={null}
          onSortChange={() => undefined}
          entityType="emails"
          searchSuffix={(
            <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
              <span>{scoped ? (scopedSummary?.total ?? messages.length) : (summary.customer ?? 0)} customer</span>
              <span>·</span>
              <span>{scoped ? (scopedSummary?.needs_review ?? 0) : (summary.needs_review ?? 0)} need review</span>
              <span>·</span>
              <span>{scoped ? messages.filter(message => message.processing_status === 'processed').length : (summary.processed ?? 0)} processed</span>
            </div>
          )}
        />
      ) : null}

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {!scoped && tab === 'connections' ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <button
                type="button"
                onClick={() => openSetup('google')}
                className="rounded-xl border border-border bg-card/70 p-4 text-left hover:bg-muted/35"
              >
                <Mail className="h-5 w-5 text-blue-300" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">Set up Gmail</h3>
                <p className="mt-1 text-sm text-muted-foreground">Guided setup for read-only customer email sync from Google Workspace.</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-300">
                  Open setup guide <ArrowRight className="h-3 w-3" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => openSetup('microsoft')}
                className="rounded-xl border border-border bg-card/70 p-4 text-left hover:bg-muted/35"
              >
                <Mail className="h-5 w-5 text-blue-300" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">Set up Outlook</h3>
                <p className="mt-1 text-sm text-muted-foreground">Guided setup for read-only customer email sync from Microsoft 365.</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-300">
                  Open setup guide <ArrowRight className="h-3 w-3" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => openSetup('webhook')}
                className="rounded-xl border border-border bg-card/70 p-4 text-left hover:bg-muted/35"
              >
                <SlidersHorizontal className="h-5 w-5 text-blue-300" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">Set up inbound webhook</h3>
                <p className="mt-1 text-sm text-muted-foreground">Guided path for SendGrid, Postmark, Mailgun, or another inbound provider.</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-300">
                  Open setup guide <ArrowRight className="h-3 w-3" />
                </span>
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {connections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground md:col-span-2">
                  No mailbox connections yet. Set up Gmail, Outlook, or an inbound webhook to start capturing customer email.
                </div>
              ) : connections.map(connection => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  onSync={(id) => syncConnection.mutate(id, { onSuccess: () => toast({ title: 'Mailbox sync queued' }) })}
                  onSetup={openSetup}
                />
              ))}
            </div>
          </div>
        ) : !scoped && tab === 'outbound' ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  ['attention', 'Needs attention'],
                  ['drafts', 'Drafts'],
                  ['approvals', 'Approvals'],
                  ['sent_failed', 'Sent / Failed'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setOutboundFilter(key as OutboundFilter)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      outboundFilter === key ? 'border-blue-500/35 bg-blue-500/10 text-blue-100' : 'border-border bg-card/60 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button onClick={() => openEmailDraft({ intent: 'follow_up' })} className="gap-1.5 bg-blue-600 text-white hover:bg-blue-500">
                <Send className="h-3.5 w-3.5" /> Draft follow-up
              </Button>
            </div>
            <CompactList className="space-y-2">
            {outboundQ.isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading...</div>
            ) : filteredOutboundEmails.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <Send className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm font-semibold text-foreground">No follow-ups yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Draft customer follow-ups here or let the Workspace Agent prepare one for approval.</p>
              </div>
            ) : filteredOutboundEmails.map(email => {
              const cfg = OUTBOUND_STATUS[email.status] ?? OUTBOUND_STATUS.draft;
              const Icon = cfg.icon;
              return (
                <button
                  key={email.id}
                  type="button"
                  onClick={() => openDrawer('email', email.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-3 text-left hover:bg-muted/35"
                >
                  <Icon className="h-4 w-4 text-blue-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{email.subject || '(no subject)'}</span>
                      <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
                      {email.draft_origin === 'agent_generated' && (
                        <Badge variant="outline" className="border-purple-500/25 bg-purple-500/10 text-purple-200">Agent generated</Badge>
                      )}
                      {email.provider_draft_status && email.provider_draft_status !== 'not_requested' && (
                        <Badge variant="outline" className={STATUS_TONES.muted}>Provider draft: {email.provider_draft_status}</Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">To {email.to_email}</p>
                    {email.hitl_request_id && (
                      <p className="mt-1 truncate text-xs text-blue-300">Approval linked · {String(email.hitl_request_id).slice(0, 8)}</p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(email.created_at), { addSuffix: true })}</span>
                </button>
              );
            })}
            </CompactList>
          </div>
        ) : messagesQ.isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading customer emails...</div>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <Mail className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-semibold text-foreground">
              {scoped ? 'No email context linked yet' : tab === 'review' ? 'No emails need review' : 'No customer emails yet'}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {scoped
                ? 'Inbound, outbound, draft, and approval-gated email linked to this record will appear here.'
                : tab === 'review'
                ? 'Ambiguous, unmatched, or failed customer emails will appear here.'
                : 'Connect a mailbox or inbound webhook so customer conversations can become Raw Context, Signals, and Memory.'}
            </p>
          </div>
        ) : (
          <CompactList className="space-y-2">
            {visibleMessages.map(message => <MessageRow key={message.id} message={message} onOpen={openMessage} />)}
            <PaginationBar page={page} pageSize={pageSize} total={messages.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </CompactList>
        )}
      </div>

      <MessageDetail id={selectedMessageId} onClose={() => setSelectedMessageId(null)} />

      <Dialog open={Boolean(setupProvider)} onOpenChange={(open) => { if (!open) closeSetup(); }}>
        {setupProvider && setupCopy && (
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MailCheck className="h-5 w-5 text-blue-500" /> {setupCopy.title}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{setupCopy.description}</p>
              <div className="grid gap-2 md:grid-cols-4">
                {['Mailbox', 'Customer filter', 'Provider setup', 'Review'].map((label, index) => (
                  <MailboxSetupStep key={label} active={setupStep === index} index={index} label={label} />
                ))}
              </div>

              {setupStep === 0 && (
                <section className="rounded-xl border border-border bg-card/70 p-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    {setupProvider === 'webhook' ? 'Choose inbound provider setup' : 'Choose the mailbox CRMy should watch'}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {setupProvider === 'webhook'
                      ? 'Inbound webhooks are best for provider-level parse routes. They post received customer email to CRMy without giving CRMy mailbox polling access.'
                      : 'CRMy uses this mailbox as an observation source. It reads customer-facing email for context extraction, but outbound sending still goes through governed Drafts & Approvals.'}
                  </p>
                  {setupProvider !== 'webhook' && (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Mailbox email</label>
                        <Input
                          value={setupEmail}
                          onChange={event => setSetupEmail(event.target.value)}
                          placeholder="seller@company.com"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Display name</label>
                        <Input
                          value={setupDisplayName}
                          onChange={event => setSetupDisplayName(event.target.value)}
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  )}
                </section>
              )}

              {setupStep === 1 && (
                <section className="rounded-xl border border-border bg-card/70 p-4">
                  <h3 className="text-sm font-semibold text-foreground">Keep the inbox focused on customer communication</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    CRMy classifies email before extraction so internal noise does not become Raw Context by accident.
                  </p>
                  <div className="mt-4 grid gap-2 md:grid-cols-3">
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/8 p-3">
                      <p className="text-sm font-semibold text-blue-200">Shown by default</p>
                      <p className="mt-1 text-xs text-muted-foreground">Customer and mixed customer-facing threads.</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background/40 p-3">
                      <p className="text-sm font-semibold text-foreground">Skipped by default</p>
                      <p className="mt-1 text-xs text-muted-foreground">Internal-only and automated messages.</p>
                    </div>
                    <div className="rounded-lg border border-purple-500/20 bg-purple-500/8 p-3">
                      <p className="text-sm font-semibold text-purple-200">Reviewable</p>
                      <p className="mt-1 text-xs text-muted-foreground">Ambiguous messages go to Needs Review instead of being over-linked.</p>
                    </div>
                  </div>
                </section>
              )}

              {setupStep === 2 && (
                <section className="rounded-xl border border-border bg-card/70 p-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    {setupProvider === 'webhook' ? 'Configure the inbound parse endpoint' : `Prepare ${setupCopy.credentialLabel}`}
                  </h3>
                  {setupProvider === 'webhook' ? (
                    <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                      <p>Use this path when your email provider can post inbound messages to CRMy. Provider setup lives with advanced messaging settings.</p>
                      <div className="rounded-lg border border-border bg-background/40 p-3">
                        <p className="font-medium text-foreground">Next step</p>
                        <p className="mt-1">Open advanced inbound setup, choose your provider, and copy the webhook endpoint into that provider.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                      <p>
                        Live mailbox sync requires OAuth credentials configured by an admin. Until then, CRMy saves this as a setup request and shows exactly what remains.
                      </p>
                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="rounded-lg border border-border bg-background/40 p-3">
                          <p className="font-medium text-foreground">Redirect path</p>
                          <code className="mt-1 block break-all rounded bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                            {setupCopy.callbackPath}
                          </code>
                        </div>
                        <div className="rounded-lg border border-border bg-background/40 p-3">
                          <p className="font-medium text-foreground">Access model</p>
                          <p className="mt-1 text-xs">Read customer mail, classify threads, and process customer-facing messages as Raw Context. Writeback and outbound sends remain governed.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {setupStep === 3 && (
                <section className="rounded-xl border border-border bg-card/70 p-4">
                  <h3 className="text-sm font-semibold text-foreground">Review setup</h3>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                      <span className="text-muted-foreground">Source</span>
                      <span className="font-medium text-foreground">{setupCopy.label}</span>
                    </div>
                    {setupProvider !== 'webhook' && (
                      <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                        <span className="text-muted-foreground">Mailbox</span>
                        <span className="font-medium text-foreground">{setupEmail.trim() || 'Required'}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                      <span className="text-muted-foreground">Default processing</span>
                      <span className="font-medium text-foreground">Customer and mixed threads only</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                      <span className="text-muted-foreground">Outbound email</span>
                      <span className="font-medium text-foreground">Governed separately</span>
                    </div>
                  </div>
                </section>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={closeSetup}>Cancel</Button>
              {setupStep > 0 && (
                <Button variant="outline" onClick={() => setSetupStep(step => Math.max(step - 1, 0))}>
                  Back
                </Button>
              )}
              {setupStep < 3 ? (
                <Button onClick={nextSetupStep} className="gap-1.5 bg-blue-600 text-white hover:bg-blue-500">
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button onClick={saveMailboxSetup} disabled={setupSaving} className="gap-1.5 bg-blue-600 text-white hover:bg-blue-500">
                  {setupSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {setupProvider === 'webhook' ? 'Open inbound setup' : 'Save setup request'}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

    </div>
  );
}
