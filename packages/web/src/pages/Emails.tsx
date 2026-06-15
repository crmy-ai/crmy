// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Fragment, useEffect, useMemo, useState } from 'react';
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
  useDeleteMailboxConnection,
  useProcessEmailMessage,
  useRefreshMailboxAliases,
  useStartMailboxConnection,
  useSyncMailboxConnection,
  useUpdateMailboxConnectionStatus,
  useUpdateMailboxSender,
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
import { getUser } from '@/api/client';

type CustomerEmailTab = 'customer' | 'review' | 'outbound' | 'connections';
type MailboxProvider = 'google' | 'microsoft';
type AccountIngestScope = 'owned_accounts' | 'accessible_accounts';
type OutboundFilter = 'attention' | 'drafts' | 'approvals' | 'sent_failed';
type ScopedEmailFilter = 'all' | 'context' | 'actions';

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
	  mailbox_email_address?: string | null;
	  mailbox_display_name?: string | null;
	  reply_to_email_message_id?: string | null;
	  conversation_root_email_message_id?: string | null;
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
	  context_sync_enabled?: boolean;
	  send_enabled?: boolean;
	  provider_draft_enabled?: boolean;
	  send_status?: string;
	  send_last_error?: string | null;
	  is_default_sender?: boolean;
	  settings?: {
      account_ingest_scope?: AccountIngestScope;
	    send_as_aliases?: Array<{ email_address: string; display_name?: string | null; verified?: boolean; is_primary?: boolean; is_default?: boolean }>;
	    selected_send_as_email?: string;
	    selected_send_as_name?: string | null;
	    alias_sync_status?: string;
	    alias_sync_warning?: string | null;
	  };
	};

type EmailSubjectSummary = {
  total?: number;
  inbound?: number;
  outbound?: number;
  drafts?: number;
  pending_approvals?: number;
  needs_review?: number;
  inbound_needs_review?: number;
  outbound_drafts?: number;
  outbound_pending_approvals?: number;
  outbound_failed?: number;
  outbound_rejected?: number;
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
};

const TABS: Array<{ key: CustomerEmailTab; label: string; icon: typeof Mail }> = [
	  { key: 'customer', label: 'Mailbox Context', icon: Inbox },
	  { key: 'review', label: 'Needs Review', icon: AlertCircle },
	  { key: 'outbound', label: 'Outbound Actions', icon: Send },
	  { key: 'connections', label: 'Mailboxes & Senders', icon: SlidersHorizontal },
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
  queued_for_delivery: { label: 'Queued to send', className: STATUS_TONES.info, icon: Send },
  sending: { label: 'Sending', className: STATUS_TONES.info, icon: Send },
  sent: { label: 'Sent', className: STATUS_TONES.success, icon: CheckCircle2 },
  failed: { label: 'Failed', className: STATUS_TONES.destructive, icon: AlertCircle },
  rejected: { label: 'Rejected', className: STATUS_TONES.destructive, icon: XCircle },
  delivery_uncertain: { label: 'Delivery uncertain', className: STATUS_TONES.warning, icon: AlertCircle },
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
  onToggleActive,
  onDisconnect,
  onRefreshAliases,
  onSelectSender,
  aliasActionPending,
  connectionActionPending,
}: {
  connection: Connection;
  onSync: (id: string) => void;
  onSetup: (provider: MailboxProvider, connection?: Connection) => void;
  onToggleActive: (connection: Connection, active: boolean) => void;
  onDisconnect: (connection: Connection) => void;
  onRefreshAliases: (id: string) => void;
  onSelectSender: (id: string, email: string) => void;
  aliasActionPending?: boolean;
  connectionActionPending?: boolean;
}) {
  const connected = connection.status === 'connected';
  const paused = connection.status === 'disconnected';
  const canToggle = connected || paused;
  const provider = MAILBOX_PROVIDER_COPY[connection.provider];
  const statusLabel = connected ? `Connected as ${connection.email_address}` : paused ? 'Paused' : connection.status === 'error' ? 'Sync needs attention' : 'Waiting for admin OAuth setup';
  const statusTone = connected ? STATUS_TONES.success : connection.status === 'error' ? STATUS_TONES.destructive : paused ? STATUS_TONES.muted : STATUS_TONES.warning;
  const aliases = (connection.settings?.send_as_aliases ?? []).filter(alias => alias?.email_address && alias.verified !== false);
  const selectedSender = connection.settings?.selected_send_as_email ?? connection.email_address;
  const selectedAlias = aliases.find(alias => alias.email_address?.toLowerCase() === selectedSender.toLowerCase());
  const accountScope = connection.settings?.account_ingest_scope === 'accessible_accounts' ? 'Accounts I can access' : 'Only my accounts';
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
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {connected ? (
            <Button variant="outline" size="sm" onClick={() => onSync(connection.id)} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Sync
            </Button>
          ) : !paused ? (
            <Button variant="outline" size="sm" onClick={() => onSetup(connection.provider, connection)} className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Setup guide
            </Button>
          ) : null}
          {canToggle && (
            <Button
              variant="outline"
              size="sm"
              disabled={connectionActionPending}
              onClick={() => onToggleActive(connection, !connected)}
            >
              {connected ? 'Deactivate' : 'Activate'}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={connectionActionPending}
            onClick={() => onDisconnect(connection)}
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            Disconnect mailbox
          </Button>
        </div>
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
            <span className="rounded-md border border-border bg-muted/20 px-2 py-0.5">
              {connection.sync_stats.out_of_scope_skipped ?? 0} outside scope
            </span>
	          </div>
	        )}
	        <div className="mb-2 flex flex-wrap gap-1.5">
	          <span className={`rounded-md border px-2 py-0.5 ${connection.context_sync_enabled === false ? 'border-border bg-muted/20' : 'border-emerald-500/20 bg-emerald-500/8 text-emerald-200'}`}>
	            Context {connection.context_sync_enabled === false ? 'off' : 'on'}
	          </span>
            <span className="rounded-md border border-blue-500/20 bg-blue-500/8 px-2 py-0.5 text-blue-200">
              Ingest: {accountScope}
            </span>
	          <span className={`rounded-md border px-2 py-0.5 ${connection.send_enabled ? 'border-blue-500/20 bg-blue-500/8 text-blue-200' : 'border-border bg-muted/20'}`}>
	            Sender {connection.send_enabled ? connection.send_status ?? 'enabled' : 'off'}
	          </span>
	          {connection.provider_draft_enabled && (
	            <span className="rounded-md border border-purple-500/20 bg-purple-500/8 px-2 py-0.5 text-purple-200">Provider drafts</span>
	          )}
	          {connection.is_default_sender && (
	            <span className="rounded-md border border-amber-500/20 bg-amber-500/8 px-2 py-0.5 text-amber-200">Default sender</span>
	          )}
	        </div>
	        {connection.send_enabled && (
	          <div className="mb-2 rounded-lg border border-border bg-background/40 p-3">
	            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
	              <div className="min-w-0">
	                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Send as</p>
	                <p className="mt-0.5 truncate text-sm text-foreground">
	                  {selectedAlias?.display_name ? `${selectedAlias.display_name} <${selectedSender}>` : selectedSender}
	                </p>
	                {connection.settings?.alias_sync_warning && (
	                  <p className="mt-1 text-xs text-warning">{connection.settings.alias_sync_warning}</p>
	                )}
	              </div>
	              <div className="flex shrink-0 items-center gap-2">
	                {aliases.length > 1 && (
	                  <select
	                    value={selectedSender}
	                    disabled={aliasActionPending}
	                    onChange={event => onSelectSender(connection.id, event.target.value)}
	                    className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
	                  >
	                    {aliases.map(alias => (
	                      <option key={alias.email_address} value={alias.email_address}>
	                        {alias.display_name ? `${alias.display_name} <${alias.email_address}>` : alias.email_address}
	                      </option>
	                    ))}
	                  </select>
	                )}
	                {connection.provider === 'google' && (
	                  <Button variant="outline" size="sm" onClick={() => onRefreshAliases(connection.id)} disabled={!connected || aliasActionPending} className="h-8 gap-1.5">
	                    <RefreshCw className="h-3.5 w-3.5" /> Aliases
	                  </Button>
	                )}
	              </div>
	            </div>
	          </div>
	        )}
	        {paused ? (
	          <p>Paused. CRMy is not reading this mailbox or using it as a sender.</p>
	        ) : !connected && (
	          <p>
	            Live sync or sender permissions are waiting for provider setup. The guide shows the mailbox, customer filtering, and OAuth steps needed before CRMy can use this mailbox.
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
	                <div>
	                  <span className="text-muted-foreground">Source mailbox </span>
	                  <span className="text-foreground">{message.mailbox_email_address ?? 'Manual / outbound action'}</span>
	                </div>
	                <div>
	                  <span className="text-muted-foreground">Context authorship </span>
	                  <span className="text-foreground">
	                    {message.direction === 'outbound'
	                      ? 'CRMy-authored sent email, not customer-authored truth'
	                      : 'Customer / external email context'}
	                  </span>
	                </div>
	                {message.email_id && (
	                  <div>
	                    <span className="text-muted-foreground">Linked outbound action </span>
	                    <span className="text-foreground">{String(message.email_id).slice(0, 8)}</span>
	                  </div>
	                )}
	                {message.activity_id && (
	                  <div>
	                    <span className="text-muted-foreground">Account activity </span>
	                    <span className="text-foreground">{String(message.activity_id).slice(0, 8)}</span>
	                  </div>
	                )}
	                {message.raw_context_source_id && (
	                  <div>
	                    <span className="text-muted-foreground">Raw Context source </span>
	                    <span className="text-foreground">{String(message.raw_context_source_id).slice(0, 8)}</span>
	                  </div>
	                )}
	                {(message.reply_to_email_message_id || message.conversation_root_email_message_id) && (
	                  <div>
	                    <span className="text-muted-foreground">Reply chain </span>
	                    <span className="text-foreground">
	                      {message.reply_to_email_message_id ? `reply to ${message.reply_to_email_message_id.slice(0, 8)}` : 'conversation root'}
	                      {message.conversation_root_email_message_id ? ` · root ${message.conversation_root_email_message_id.slice(0, 8)}` : ''}
	                    </span>
	                  </div>
	                )}
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
  const [scopedFilter, setScopedFilter] = useState<ScopedEmailFilter>('all');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupProvider, setSetupProvider] = useState<MailboxProvider | null>(null);
	  const [setupStep, setSetupStep] = useState(0);
	  const [setupEmail, setSetupEmail] = useState('');
	  const [setupDisplayName, setSetupDisplayName] = useState('');
	  const [setupContextSync, setSetupContextSync] = useState(true);
	  const [setupSendEnabled, setSetupSendEnabled] = useState(true);
	  const [setupProviderDrafts, setSetupProviderDrafts] = useState(true);
  const [setupAccountScope, setSetupAccountScope] = useState<AccountIngestScope>('owned_accounts');

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

  useEffect(() => {
    const message = scopedParams.get('mailbox_error');
    if (!message) return;
    toast({
      title: 'Mailbox connection needs attention',
      description: message,
      variant: 'destructive',
    });
    const next = new URLSearchParams(scopedParams);
    next.delete('mailbox_error');
    navigate(`${location.pathname}?${next.toString()}`, { replace: true });
  }, [location.pathname, navigate, scopedParams]);

  const scopedSummaryQ = useEmailSubjectSummary(scopedSubjectType, scopedSubjectId ? [scopedSubjectId] : []);
  const scopedSummary = ((scopedSummaryQ.data as any)?.data ?? [])[0] as EmailSubjectSummary | undefined;
  const scopedInboundReviewCount = scopedSummary?.inbound_needs_review ?? scopedSummary?.needs_review ?? 0;
  const scopedOutboundDraftCount = scopedSummary?.outbound_drafts ?? scopedSummary?.drafts ?? 0;
  const scopedOutboundPendingCount = scopedSummary?.outbound_pending_approvals ?? scopedSummary?.pending_approvals ?? 0;
  const scopedOutboundFailedCount = scopedSummary?.outbound_failed ?? 0;
  const scopedOutboundRejectedCount = scopedSummary?.outbound_rejected ?? 0;
  const scopedOutboundActionCount = scopedOutboundDraftCount + scopedOutboundPendingCount + scopedOutboundFailedCount + scopedOutboundRejectedCount;
  const scopedClearHref = scopedOutboundActionCount > 0 && ((scopedSummary?.inbound ?? 0) === 0 || scopedFilter === 'actions')
    ? '/emails?tab=outbound'
    : '/emails';

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
  const mailboxSummary = summary as {
    customer?: number;
    needs_review?: number;
    processed?: number;
    inbound_customer?: number;
    inbound_needs_review?: number;
    inbound_processed?: number;
  };
  const connectionsQ = useMailboxConnections() as any;
  const connections: Connection[] = connectionsQ.data?.data ?? [];
  const mailboxConnections = connections.filter(connection => connection.provider === 'google' || connection.provider === 'microsoft');
  const oauthReady = connectionsQ.data?.oauth_ready as Record<'google' | 'microsoft', boolean> | undefined;
  const currentUser = getUser();
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const mailboxConnected = mailboxConnections.some(connection => connection.status === 'connected');
  const startGoogle = useStartMailboxConnection('google');
  const startMicrosoft = useStartMailboxConnection('microsoft');
  const syncConnection = useSyncMailboxConnection();
  const refreshAliases = useRefreshMailboxAliases();
  const updateMailboxSender = useUpdateMailboxSender();
  const updateMailboxStatus = useUpdateMailboxConnectionStatus();
  const deleteMailboxConnection = useDeleteMailboxConnection();
  const setupCopy = setupProvider ? MAILBOX_PROVIDER_COPY[setupProvider] : null;
  const selectedProviderReady = (setupProvider === 'google' || setupProvider === 'microsoft')
    ? oauthReady?.[setupProvider] === true
    : false;
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
    if (outboundFilter === 'sent_failed') return searched.filter(email => ['sent', 'failed', 'rejected', 'delivery_uncertain'].includes(email.status));
    return searched.filter(email => ['draft', 'pending_approval', 'queued_for_delivery', 'sending', 'failed', 'rejected', 'delivery_uncertain'].includes(email.status));
  }, [outboundEmails, outboundFilter, q]);
  const outboundAttentionCount = outboundEmails.filter(email => ['draft', 'pending_approval', 'queued_for_delivery', 'sending', 'failed', 'rejected', 'delivery_uncertain'].includes(email.status)).length;
  const mailboxCustomerCount = mailboxSummary.inbound_customer ?? mailboxSummary.customer ?? 0;
  const mailboxReviewCount = mailboxSummary.inbound_needs_review ?? mailboxSummary.needs_review ?? 0;
  const mailboxProcessedCount = mailboxSummary.inbound_processed ?? mailboxSummary.processed ?? 0;
  const searchStats = scoped
    ? [
        `${scopedSummary?.total ?? messages.length} linked`,
        `${scopedInboundReviewCount} mailbox ${scopedInboundReviewCount === 1 ? 'item' : 'items'} need review`,
        `${scopedOutboundActionCount} outbound ${scopedOutboundActionCount === 1 ? 'action' : 'actions'}`,
      ]
    : tab === 'outbound'
    ? [
        `${outboundEmails.length} outbound`,
        `${outboundAttentionCount} need attention`,
        `${outboundEmails.filter(email => email.status === 'sent').length} sent`,
      ]
    : [
        `${mailboxCustomerCount} customer`,
        `${mailboxReviewCount} need review`,
        `${mailboxProcessedCount} processed`,
      ];

  const filteredMessages = useMemo(() => {
    let list = !scoped && tab === 'outbound'
      ? messages.filter(message => message.direction === 'outbound')
      : messages;
    if (scoped && scopedFilter === 'context') {
      list = list.filter(message => message.direction === 'inbound');
    } else if (scoped && scopedFilter === 'actions') {
      list = list.filter(message => message.direction === 'outbound');
    }
    return list;
  }, [messages, scoped, scopedFilter, tab]);
  const visibleMessages = useMemo(() => {
    return filteredMessages.slice((page - 1) * pageSize, page * pageSize);
  }, [filteredMessages, page, pageSize]);

  const openMessage = (message: EmailMessage) => {
    if (message.direction === 'outbound' && message.email_id) {
      openDrawer('email', message.email_id);
      return;
    }
    setSelectedMessageId(message.id);
  };

  const openSetup = (provider?: MailboxProvider, connection?: Connection) => {
    setSetupOpen(true);
    setSetupProvider(provider ?? null);
	    setSetupStep(0);
	    setSetupEmail(connection?.email_address ?? '');
	    setSetupDisplayName(connection?.display_name ?? '');
	    setSetupContextSync(connection?.context_sync_enabled ?? true);
	    setSetupSendEnabled(connection?.send_enabled ?? true);
	    setSetupProviderDrafts(connection?.provider_draft_enabled ?? true);
    setSetupAccountScope(connection?.settings?.account_ingest_scope ?? 'owned_accounts');
	  };

  const closeSetup = () => {
    setSetupOpen(false);
    setSetupProvider(null);
    setSetupStep(0);
	    setSetupEmail('');
	    setSetupDisplayName('');
	    setSetupContextSync(true);
	    setSetupSendEnabled(true);
	    setSetupProviderDrafts(true);
    setSetupAccountScope('owned_accounts');
	  };

  const toggleMailboxActive = (connection: Connection, active: boolean) => {
    updateMailboxStatus.mutate({ id: connection.id, active }, {
      onSuccess: () => toast({ title: active ? 'Mailbox activated' : 'Mailbox paused' }),
      onError: (err) => toast({
        title: active ? 'Could not activate mailbox' : 'Could not pause mailbox',
        description: err instanceof Error ? err.message : 'Try again or reconnect the mailbox.',
        variant: 'destructive',
      }),
    });
  };

  const disconnectMailbox = (connection: Connection) => {
    const email = connection.email_address || MAILBOX_PROVIDER_COPY[connection.provider]?.label || 'this mailbox';
    const ok = window.confirm(`Disconnect ${email}? This removes the mailbox connection and OAuth tokens. Reconnecting requires provider consent again.`);
    if (!ok) return;
    deleteMailboxConnection.mutate(connection.id, {
      onSuccess: () => toast({ title: 'Mailbox disconnected' }),
      onError: (err) => toast({
        title: 'Could not disconnect mailbox',
        description: err instanceof Error ? err.message : 'Try again from Mailboxes & Senders.',
        variant: 'destructive',
      }),
    });
  };

  const nextSetupStep = () => {
    if (setupStep === 0 && !setupProvider) {
      toast({ title: 'Choose a mailbox provider', description: 'Select Gmail or Outlook to continue.', variant: 'destructive' });
      return;
    }
    if (setupStep === 1 && !setupEmail.trim().includes('@')) {
      toast({ title: 'Mailbox email required', description: 'Enter the Gmail or Outlook mailbox CRMy should watch.', variant: 'destructive' });
      return;
    }
    setSetupStep(step => Math.min(step + 1, 3));
  };

  const saveMailboxSetup = async () => {
    if (!setupProvider) {
      toast({ title: 'Choose a mailbox provider', description: 'Select Gmail or Outlook before connecting.', variant: 'destructive' });
      return;
    }
    if (!setupEmail.trim().includes('@')) {
      toast({ title: 'Mailbox email required', description: 'Enter a valid mailbox email before saving setup.', variant: 'destructive' });
      return;
    }
	    const payload = {
	      email_address: setupEmail.trim().toLowerCase(),
	      display_name: setupDisplayName.trim(),
	      context_sync_enabled: setupContextSync,
	      send_enabled: setupSendEnabled,
	      provider_draft_enabled: setupSendEnabled && setupProviderDrafts,
	      is_default_sender: setupSendEnabled,
        account_ingest_scope: setupAccountScope,
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
        title: 'Admin setup requested',
        description: `${MAILBOX_PROVIDER_COPY[setupProvider].label} is waiting for an admin to finish OAuth setup before live sync or sender permissions can run.`,
      });
      closeSetup();
      if (isAdmin) navigate('/settings/connections');
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
                    Email context and actions{scopedLabel ? ` for ${scopedLabel}` : ''}
                  </p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Mailbox context and outbound draft actions linked to this {scopedSubjectType}.
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{scopedSummary?.total ?? messages.length} linked</span>
                  <span>·</span>
                  <span>{scopedSummary?.inbound ?? messages.filter(message => message.direction === 'inbound').length} in</span>
                  <span>·</span>
                  <span>{scopedSummary?.outbound ?? messages.filter(message => message.direction === 'outbound').length} out</span>
                  {scopedOutboundDraftCount > 0 && <span>· {scopedOutboundDraftCount} draft{scopedOutboundDraftCount === 1 ? '' : 's'}</span>}
                  {scopedOutboundPendingCount > 0 && <span>· {scopedOutboundPendingCount} approval{scopedOutboundPendingCount === 1 ? '' : 's'} waiting</span>}
                  {scopedOutboundRejectedCount > 0 && <span>· {scopedOutboundRejectedCount} rejected action{scopedOutboundRejectedCount === 1 ? '' : 's'}</span>}
                  {scopedOutboundFailedCount > 0 && <span>· {scopedOutboundFailedCount} failed send{scopedOutboundFailedCount === 1 ? '' : 's'}</span>}
                  {scopedInboundReviewCount > 0 && <span>· {scopedInboundReviewCount} mailbox item{scopedInboundReviewCount === 1 ? '' : 's'} need review</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {[
                    { key: 'all' as const, label: 'All linked', count: scopedSummary?.total ?? messages.length },
                    { key: 'context' as const, label: 'Mailbox context', count: scopedSummary?.inbound ?? 0 },
                    { key: 'actions' as const, label: 'Outbound actions', count: scopedSummary?.outbound ?? 0 },
                  ].map(item => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setScopedFilter(item.key);
                        setPage(1);
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        scopedFilter === item.key
                          ? 'border-blue-500/40 bg-blue-500/15 text-blue-100'
                          : 'border-border bg-background/50 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {item.label} · {item.count}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button variant="outline" onClick={() => navigate('/emails?tab=outbound')}>View outbound actions</Button>
                <Button variant="outline" onClick={() => navigate(scopedClearHref)}>Clear scope</Button>
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
                <Button
                  variant="outline"
                  onClick={() => setTab('connections')}
                  className="border-primary/30 bg-primary/10 text-primary hover:border-primary/40 hover:bg-primary/15 hover:text-primary"
                >
                  Connect mailbox
                </Button>
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
                {item.key === 'review' && mailboxReviewCount > 0 && (
                  <span className="ml-0.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                    {mailboxReviewCount}
                  </span>
                )}
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
              {searchStats.map((stat, index) => (
                <Fragment key={stat}>
                  {index > 0 && <span>·</span>}
                  <span>{stat}</span>
                </Fragment>
              ))}
            </div>
          )}
        />
      ) : null}

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {!scoped && tab === 'connections' ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => openSetup()}
              className="flex w-full flex-col gap-4 rounded-xl border border-blue-500/25 bg-blue-500/8 p-4 text-left hover:bg-blue-500/12 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-500/25 bg-blue-500/12">
                  <MailCheck className="h-5 w-5 text-blue-200" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">
                    {mailboxConnections.length > 0 ? 'Connect another mailbox' : 'Connect your work mailbox'}
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Choose Gmail or Outlook, then decide whether CRMy should use the mailbox for customer context, approved sends, and provider drafts.
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-200">
                Start setup <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </button>
            <div className="grid gap-3 md:grid-cols-2">
              {mailboxConnections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground md:col-span-2">
                  No personal mailbox connected yet. Connect Gmail or Outlook to capture customer email context and use your mailbox as a governed sender.
                </div>
              ) : mailboxConnections.map(connection => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  onSync={(id) => syncConnection.mutate(id, { onSuccess: () => toast({ title: 'Mailbox sync queued' }) })}
                  onSetup={openSetup}
                  onToggleActive={toggleMailboxActive}
                  onDisconnect={disconnectMailbox}
                  onRefreshAliases={(id) => refreshAliases.mutate(id, {
                    onSuccess: () => toast({ title: 'Sender aliases refreshed', description: 'Verified Gmail send-as addresses are available for this mailbox.' }),
                    onError: (err) => toast({ title: 'Could not refresh aliases', description: err instanceof Error ? err.message : 'Try again after reauthorizing Gmail.', variant: 'destructive' }),
                  })}
                  onSelectSender={(id, selected_send_as_email) => updateMailboxSender.mutate({ id, selected_send_as_email }, {
                    onSuccess: () => toast({ title: 'Sender updated', description: `Outbound drafts will use ${selected_send_as_email}.` }),
                    onError: (err) => toast({ title: 'Could not update sender', description: err instanceof Error ? err.message : 'Choose a verified alias.', variant: 'destructive' }),
                  })}
                  aliasActionPending={refreshAliases.isPending || updateMailboxSender.isPending}
                  connectionActionPending={updateMailboxStatus.isPending || deleteMailboxConnection.isPending}
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
	                    <p className="mt-1 truncate text-xs text-muted-foreground">
	                      To {email.to_email} · From {email.from_email ?? (email.sender_type === 'unknown' ? 'not configured' : 'fallback provider')}
	                    </p>
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
                ? 'Mailbox context and outbound actions linked to this record will appear here.'
                : tab === 'review'
                ? 'Ambiguous, unmatched, or failed customer emails will appear here.'
                : 'Connect a mailbox so customer conversations can become Raw Context, Signals, and Memory.'}
            </p>
          </div>
        ) : (
          <CompactList className="space-y-2">
            {visibleMessages.map(message => <MessageRow key={message.id} message={message} onOpen={openMessage} />)}
            <PaginationBar page={page} pageSize={pageSize} total={filteredMessages.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </CompactList>
        )}
      </div>

      <MessageDetail id={selectedMessageId} onClose={() => setSelectedMessageId(null)} />

      <Dialog open={setupOpen} onOpenChange={(open) => { if (!open) closeSetup(); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MailCheck className="h-5 w-5 text-blue-500" /> Connect mailbox
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connect a Gmail or Outlook mailbox so CRMy can capture customer email context and, when enabled, send approved drafts from the right identity.
            </p>
            <div className="grid gap-2 md:grid-cols-4">
              {['Choose provider', 'Choose mailbox', 'What CRMy uses', 'Connect'].map((label, index) => (
                <MailboxSetupStep key={label} active={setupStep === index} index={index} label={label} />
              ))}
            </div>

            {setupStep === 0 && (
              <section className="rounded-xl border border-border bg-card/70 p-4">
                <h3 className="text-sm font-semibold text-foreground">Choose your mailbox provider</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick the work inbox CRMy should connect. Provider setup details stay in System Connections for admins.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {(['google', 'microsoft'] as MailboxProvider[]).map(providerKey => {
                    const provider = MAILBOX_PROVIDER_COPY[providerKey];
                    const selected = setupProvider === providerKey;
                    const ready = oauthReady?.[providerKey];
                    return (
                      <button
                        key={providerKey}
                        type="button"
                        onClick={() => setSetupProvider(providerKey)}
                        className={`rounded-xl border p-4 text-left transition-colors ${
                          selected ? 'border-blue-500/45 bg-blue-500/12' : 'border-border bg-background/40 hover:bg-muted/35'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-blue-300" />
                            <span className="text-sm font-semibold text-foreground">{provider.label}</span>
                          </div>
                          <Badge variant="outline" className={ready === false ? STATUS_TONES.warning : ready === true ? STATUS_TONES.success : STATUS_TONES.muted}>
                            {ready === false ? 'Admin setup needed' : ready === true ? 'Ready' : 'Checking setup'}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{provider.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {setupStep === 1 && (
              <section className="rounded-xl border border-border bg-card/70 p-4">
                <h3 className="text-sm font-semibold text-foreground">Choose the mailbox CRMy should watch</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  CRMy can use this mailbox for customer context, and optionally as the visible sender for approved outbound drafts.
                </p>
                <div className="mt-4 space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
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
                  <label className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3">
                    <input type="checkbox" checked={setupContextSync} onChange={event => setSetupContextSync(event.target.checked)} className="mt-1" />
                    <span>
                      <span className="block text-sm font-semibold text-foreground">Use email for customer context</span>
                      <span className="block text-xs text-muted-foreground">Read customer-facing threads, link them to records, and process useful messages into Raw Context, Signals, and Memory.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3">
                    <input type="checkbox" checked={setupSendEnabled} onChange={event => setSetupSendEnabled(event.target.checked)} className="mt-1" />
                    <span>
                      <span className="block text-sm font-semibold text-foreground">Send approved drafts from this mailbox</span>
                      <span className="block text-xs text-muted-foreground">Outbound Actions will show this mailbox as From. Customer replies can sync back through the same mailbox as context.</span>
                    </span>
                  </label>
                  <label className={`flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3 ${!setupSendEnabled ? 'opacity-60' : ''}`}>
                    <input type="checkbox" checked={setupProviderDrafts && setupSendEnabled} disabled={!setupSendEnabled} onChange={event => setSetupProviderDrafts(event.target.checked)} className="mt-1" />
                    <span>
                      <span className="block text-sm font-semibold text-foreground">Create provider drafts when available</span>
                      <span className="block text-xs text-muted-foreground">CRMy drafts stay governed; this also allows pushing a reviewed draft into the mailbox draft folder.</span>
                    </span>
                  </label>
                </div>
              </section>
            )}

            {setupStep === 2 && (
              <section className="rounded-xl border border-border bg-card/70 p-4">
                <h3 className="text-sm font-semibold text-foreground">CRMy filters for customer conversations</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  CRMy reads customer-facing threads so agents can brief, draft, and follow up with context.
                </p>
                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/8 p-3">
                    <p className="text-sm font-semibold text-blue-200">Customer context</p>
                    <p className="mt-1 text-xs text-muted-foreground">Customer and mixed customer-facing threads.</p>
                  </div>
                  <div className="rounded-lg border border-border bg-background/40 p-3">
                    <p className="text-sm font-semibold text-foreground">Approved sending</p>
                    <p className="mt-1 text-xs text-muted-foreground">If enabled, approved drafts can use this mailbox as the From address.</p>
                  </div>
                  <div className="rounded-lg border border-purple-500/20 bg-purple-500/8 p-3">
                    <p className="text-sm font-semibold text-purple-200">Replies return</p>
                    <p className="mt-1 text-xs text-muted-foreground">Replies can sync back through this mailbox and become customer context.</p>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-border bg-background/40 p-3">
                  <p className="text-sm font-semibold text-foreground">Which accounts should this mailbox feed?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    CRMy matches customer emails by contact email and account domains, including additional domains on the account.
                  </p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {([
                      ['owned_accounts', 'Only my accounts', 'Use this for a focused personal inbox.'],
                      ['accessible_accounts', 'All accounts I can access', 'Use this when your inbox covers a team or shared book.'],
                    ] as Array<[AccountIngestScope, string, string]>).map(([value, label, description]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSetupAccountScope(value)}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          setupAccountScope === value ? 'border-blue-500/45 bg-blue-500/12' : 'border-border bg-card/40 hover:bg-muted/35'
                        }`}
                      >
                        <span className="block text-sm font-semibold text-foreground">{label}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {setupStep === 3 && setupCopy && (
              <section className="rounded-xl border border-border bg-card/70 p-4">
                <h3 className="text-sm font-semibold text-foreground">
                  {selectedProviderReady
                    ? `Connect ${setupCopy.label}`
                    : isAdmin
                      ? 'OAuth setup required'
                      : `Ask an admin to enable ${setupCopy.label} connections`}
                </h3>
                <div className="mt-3 grid gap-2 text-sm">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                    <span className="text-muted-foreground">Provider</span>
                    <span className="font-medium text-foreground">{setupCopy.label}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                    <span className="text-muted-foreground">Mailbox</span>
                    <span className="font-medium text-foreground">{setupEmail.trim() || 'Required'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                    <span className="text-muted-foreground">Context</span>
                    <span className="font-medium text-foreground">{setupContextSync ? 'Customer conversations on' : 'Off'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                    <span className="text-muted-foreground">Ingest scope</span>
                    <span className="font-medium text-foreground">{setupAccountScope === 'accessible_accounts' ? 'Accounts I can access' : 'Only my accounts'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                    <span className="text-muted-foreground">Outbound email</span>
                    <span className="font-medium text-foreground">{setupSendEnabled ? 'Use mailbox as sender' : 'Fallback provider only'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                    <span className="text-muted-foreground">Provider drafts</span>
                    <span className="font-medium text-foreground">{setupSendEnabled && setupProviderDrafts ? 'Enabled when supported' : 'Off'}</span>
                  </div>
                </div>
                <div className={`mt-4 rounded-lg border p-3 text-sm ${
                  selectedProviderReady ? 'border-blue-500/20 bg-blue-500/8 text-muted-foreground' : 'border-amber-500/20 bg-amber-500/8 text-muted-foreground'
                }`}>
                  {selectedProviderReady
                    ? `CRMy will send you to ${setupCopy.label} consent. When you return, mailbox context and sender options will appear here.`
                    : isAdmin
                      ? 'Prepare System Connections -> OAuth, then users can connect their own mailbox here.'
                      : 'Your workspace admin needs to enable this provider before you can connect your mailbox.'}
                  {!selectedProviderReady && isAdmin && (
                    <Button variant="outline" size="sm" onClick={() => navigate('/settings/connections')} className="mt-3">
                      Open System Connections
                    </Button>
                  )}
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
              <Button onClick={saveMailboxSetup} disabled={setupSaving || !setupProvider} className="gap-1.5 bg-blue-600 text-white hover:bg-blue-500">
                {setupSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {selectedProviderReady
                  ? `Connect ${setupCopy?.label ?? 'mailbox'}`
                  : isAdmin
                    ? 'Save and open OAuth setup'
                    : 'Request admin setup'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
